import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { ActivityAction } from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

export type TargetType = 'project' | 'floor' | 'client' | 'user' | 'invitation';

export interface ActivityInput {
  action: ActivityAction;
  userId?: string | null;
  email?: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
  targetType?: TargetType | null;
  targetId?: string | null;
  targetName?: string | null;
  details?: Record<string, unknown> | null;
  req?: Request;
}

/** Last-seen times are written at most this often per user (one small UPDATE, not one per request). */
const LAST_SEEN_EVERY_MS = 5 * 60_000;

/** Visitor address. Render runs behind Cloudflare, which puts the original address in cf-connecting-ip. */
export function clientIp(req: Request): string | null {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf.slice(0, 64);
  return req.ip ? req.ip.slice(0, 64) : null;
}

/**
 * Writes the activity log for the product owner panel. Recording never breaks the user's request:
 * failures are logged and swallowed.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger('Activity');
  private readonly lastSeenWritten = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async record(input: ActivityInput): Promise<void> {
    // Read the request now: once the response is sent the socket closes and its address is gone.
    const ip = input.req ? clientIp(input.req) : null;
    const ua = input.req?.headers['user-agent'];
    try {
      let { email, organizationName } = input;
      if (input.userId && !email) {
        email = (await this.prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } }))?.email ?? null;
      }
      if (input.organizationId && !organizationName) {
        organizationName =
          (await this.prisma.organization.findUnique({ where: { id: input.organizationId }, select: { name: true } }))?.name ?? null;
      }
      await this.prisma.activityEvent.create({
        data: {
          action: input.action,
          userId: input.userId ?? null,
          email: email ?? null,
          organizationId: input.organizationId ?? null,
          organizationName: organizationName ?? null,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          targetName: input.targetName?.slice(0, 300) ?? null,
          ip,
          userAgent: typeof ua === 'string' ? ua.slice(0, 400) : null,
          details: input.details ? (input.details as Prisma.InputJsonValue) : Prisma.DbNull,
        },
      });
    } catch (err) {
      this.logger.warn(`Could not record ${input.action}: ${(err as Error).message}`);
    }
  }

  /** Name of the thing an action is about, read before it is deleted. */
  async targetName(type: TargetType, id: string, organizationId?: string): Promise<string | null> {
    try {
      switch (type) {
        case 'project':
          return (await this.prisma.project.findFirst({ where: { id, organizationId }, select: { name: true } }))?.name ?? null;
        case 'client':
          return (await this.prisma.client.findFirst({ where: { id, organizationId }, select: { name: true } }))?.name ?? null;
        case 'floor': {
          const f = await this.prisma.floor.findFirst({
            where: { id, project: { organizationId } },
            select: { name: true, project: { select: { name: true } } },
          });
          return f ? `${f.project.name} · ${f.name}` : null;
        }
        case 'user': {
          const u = await this.prisma.user.findUnique({ where: { id }, select: { name: true, email: true } });
          return u ? `${u.name} <${u.email}>` : null;
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /** Marks the user as active now (throttled in memory, so most requests write nothing). */
  touch(userId: string): void {
    const now = Date.now();
    const last = this.lastSeenWritten.get(userId) ?? 0;
    if (now - last < LAST_SEEN_EVERY_MS) return;
    this.lastSeenWritten.set(userId, now);
    if (this.lastSeenWritten.size > 10_000) this.lastSeenWritten.clear();
    this.prisma.user
      .updateMany({ where: { id: userId }, data: { lastSeenAt: new Date(now) } })
      .catch((err: Error) => this.logger.warn(`Could not update last-seen: ${err.message}`));
  }
}
