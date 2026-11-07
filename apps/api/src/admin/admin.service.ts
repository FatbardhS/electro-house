import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ActivityEventDto,
  ActivityPageDto,
  ActivityQuery,
  AdminCompanyDto,
  AdminDayDto,
  AdminOverviewDto,
  AdminUserDetailDto,
  AdminUserDto,
} from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { isPlatformAdmin } from '../auth/auth.service.js';
import type { Prisma } from '../generated/prisma/client.js';

const DAY_MS = 86_400_000;
/** Lists show the most recent rows; the search box finds the rest. */
const LIST_LIMIT = 500;

const ago = (ms: number) => new Date(Date.now() - ms);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Read-only queries for the product owner panel. Every method sees all companies: only reachable via PlatformAdminGuard. */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<AdminOverviewDto> {
    const now = new Date();
    const [users, companies, projects, clients, floors, activeDay, activeWeek, activeMonth, signUpsWeek, signUpsMonth, failed, exportsWeek, subs, openSessions] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.organization.count(),
        this.prisma.project.count(),
        this.prisma.client.count(),
        this.prisma.floor.count(),
        this.prisma.user.count({ where: { lastSeenAt: { gte: ago(DAY_MS) } } }),
        this.prisma.user.count({ where: { lastSeenAt: { gte: ago(7 * DAY_MS) } } }),
        this.prisma.user.count({ where: { lastSeenAt: { gte: ago(30 * DAY_MS) } } }),
        this.prisma.user.count({ where: { createdAt: { gte: ago(7 * DAY_MS) } } }),
        this.prisma.user.count({ where: { createdAt: { gte: ago(30 * DAY_MS) } } }),
        this.prisma.activityEvent.count({ where: { action: 'auth.sign_in_failed', createdAt: { gte: ago(DAY_MS) } } }),
        this.prisma.activityEvent.count({ where: { action: { in: ['export.pdf', 'export.dxf'] }, createdAt: { gte: ago(7 * DAY_MS) } } }),
        this.prisma.organization.groupBy({ by: ['subscriptionStatus'], _count: { _all: true } }),
        this.prisma.session.groupBy({ by: ['userId'], where: { expiresAt: { gt: now } } }),
      ]);

    return {
      totals: { users, companies, projects, clients, floors },
      active: { day: activeDay, week: activeWeek, month: activeMonth },
      signUps: { week: signUpsWeek, month: signUpsMonth },
      failedSignIns24h: failed,
      exportsWeek,
      subscriptions: Object.fromEntries(subs.map((s) => [s.subscriptionStatus, s._count._all])),
      days: await this.days(30),
      openSessions: openSessions.length,
    };
  }

  /** Daily numbers for the chart, oldest first, including days without activity. */
  private async days(count: number): Promise<AdminDayDto[]> {
    const start = new Date(Date.now() - (count - 1) * DAY_MS);
    start.setUTCHours(0, 0, 0, 0);
    const [events, signUps] = await Promise.all([
      this.prisma.$queryRaw<{ day: string; active: bigint; signins: bigint; exports: bigint }[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               COUNT(DISTINCT "userId") AS active,
               COUNT(*) FILTER (WHERE action = 'auth.sign_in') AS signins,
               COUNT(*) FILTER (WHERE action IN ('export.pdf', 'export.dxf')) AS exports
        FROM "ActivityEvent" WHERE "createdAt" >= ${start} GROUP BY 1`,
      this.prisma.$queryRaw<{ day: string; n: bigint }[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, COUNT(*) AS n
        FROM "User" WHERE "createdAt" >= ${start} GROUP BY 1`,
    ]);
    const byDay = new Map(events.map((e) => [e.day, e]));
    const signUpsByDay = new Map(signUps.map((s) => [s.day, Number(s.n)]));
    return Array.from({ length: count }, (_, i) => {
      const day = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10);
      const e = byDay.get(day);
      return {
        day,
        signUps: signUpsByDay.get(day) ?? 0,
        activeUsers: e ? Number(e.active) : 0,
        signIns: e ? Number(e.signins) : 0,
        exports: e ? Number(e.exports) : 0,
      };
    });
  }

  async users(search?: string): Promise<AdminUserDto[]> {
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
            { memberships: { some: { organization: { name: { contains: search, mode: 'insensitive' } } } } },
          ],
        }
      : {};
    const users = await this.prisma.user.findMany({
      where,
      orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: LIST_LIMIT,
      include: {
        memberships: { include: { organization: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        _count: { select: { sessions: { where: { expiresAt: { gt: new Date() } } } } },
      },
    });
    const lastSignIns = await this.lastSignIns(users.map((u) => u.id));
    return users.map((u) => this.toUserDto(u, lastSignIns.get(u.id) ?? null));
  }

  async user(id: string): Promise<AdminUserDetailDto> {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: {
        memberships: { include: { organization: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        sessions: { where: { expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } },
        _count: { select: { sessions: { where: { expiresAt: { gt: new Date() } } } } },
      },
    });
    if (!u) throw new NotFoundException('User not found.');
    const [lastSignIns, counts] = await Promise.all([
      this.lastSignIns([u.id]),
      this.prisma.activityEvent.groupBy({ by: ['action'], where: { userId: u.id }, _count: { _all: true } }),
    ]);
    const orgNames = new Map(u.memberships.map((m) => [m.organizationId, m.organization.name]));
    return {
      ...this.toUserDto(u, lastSignIns.get(u.id) ?? null),
      sessions: u.sessions.map((s) => ({
        id: s.id,
        organizationName: orgNames.get(s.organizationId) ?? null,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      })),
      actionCounts: Object.fromEntries(counts.map((c) => [c.action, c._count._all])),
    };
  }

  async companies(search?: string): Promise<AdminCompanyDto[]> {
    const orgs = await this.prisma.organization.findMany({
      where: search ? { name: { contains: search, mode: 'insensitive' } } : {},
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      include: {
        _count: { select: { members: true, projects: true, clients: true } },
        members: { where: { role: 'OWNER' }, include: { user: { select: { id: true, name: true, email: true } } }, take: 1 },
      },
    });
    const last = await this.prisma.activityEvent.groupBy({
      by: ['organizationId'],
      where: { organizationId: { in: orgs.map((o) => o.id) } },
      _max: { createdAt: true },
    });
    const lastByOrg = new Map(last.map((l) => [l.organizationId, l._max.createdAt]));
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      createdAt: o.createdAt.toISOString(),
      subscriptionStatus: o.subscriptionStatus,
      trialEndsAt: iso(o.trialEndsAt),
      members: o._count.members,
      projects: o._count.projects,
      clients: o._count.clients,
      owner: o.members[0]?.user ?? null,
      lastActivityAt: iso(lastByOrg.get(o.id)),
    }));
  }

  async activity(q: ActivityQuery): Promise<ActivityPageDto> {
    const where: Prisma.ActivityEventWhereInput = {
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.organizationId ? { organizationId: q.organizationId } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      ...(q.search
        ? {
            OR: [
              { email: { contains: q.search, mode: 'insensitive' } },
              { organizationName: { contains: q.search, mode: 'insensitive' } },
              { targetName: { contains: q.search, mode: 'insensitive' } },
              { ip: { contains: q.search } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.activityEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const userIds = [...new Set(page.map((r) => r.userId).filter((v): v is string => !!v))];
    const names = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
    );
    const events: ActivityEventDto[] = page.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      action: r.action,
      userId: r.userId,
      email: r.email,
      userName: r.userId ? names.get(r.userId) ?? null : null,
      organizationId: r.organizationId,
      organizationName: r.organizationName,
      targetType: r.targetType,
      targetId: r.targetId,
      targetName: r.targetName,
      ip: r.ip,
      userAgent: r.userAgent,
    }));
    return { events, nextCursor: rows.length > q.limit ? page[page.length - 1]!.createdAt.toISOString() : null };
  }

  /** Latest successful sign-in per user, from the log; falls back to the newest session for older accounts. */
  private async lastSignIns(userIds: string[]): Promise<Map<string, Date>> {
    if (userIds.length === 0) return new Map();
    const [events, sessions] = await Promise.all([
      this.prisma.activityEvent.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, action: { in: ['auth.sign_in', 'auth.sign_up', 'invitation.sign_up'] } },
        _max: { createdAt: true },
      }),
      this.prisma.session.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _max: { createdAt: true } }),
    ]);
    const out = new Map<string, Date>();
    for (const s of sessions) if (s._max.createdAt) out.set(s.userId, s._max.createdAt);
    for (const e of events) {
      const d = e._max.createdAt;
      const prev = e.userId ? out.get(e.userId) : undefined;
      if (e.userId && d && (!prev || d > prev)) out.set(e.userId, d);
    }
    return out;
  }

  private toUserDto(
    u: Prisma.UserGetPayload<{ include: { memberships: { include: { organization: { select: { name: true } } } }; _count: { select: { sessions: true } } } }>,
    lastSignIn: Date | null,
  ): AdminUserDto {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      language: u.language === 'en' ? 'en' : 'sq',
      createdAt: u.createdAt.toISOString(),
      lastSeenAt: iso(u.lastSeenAt),
      lastSignInAt: iso(lastSignIn),
      openSessions: u._count.sessions,
      memberships: u.memberships.map((m) => ({ organizationId: m.organizationId, organizationName: m.organization.name, role: m.role })),
      isPlatformAdmin: isPlatformAdmin(u.email),
    };
  }
}
