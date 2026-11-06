import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { TRIAL_DAYS, accessLevel, billingSummary, type SessionDto, type SignInInput, type SignUpInput } from '@electro/shared';
import { BILLING_SELECT, billingStateOf } from '../billing/billing-state.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { env } from '../config/env.js';
import type { AuthContext } from './auth-context.js';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// A valid hash of a random password, so sign-in for an unknown email costs the same time as a wrong password.
const DUMMY_HASH_PROMISE = hash(randomBytes(16).toString('hex'));

export interface NewSession {
  token: string;
  expiresAt: Date;
  session: SessionDto;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the user, their company (organization) and owner membership in one transaction. */
  async signUp(input: SignUpInput): Promise<NewSession> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('An account with this email already exists. Sign in instead.');

    const passwordHash = await hash(input.password);
    const { user, organization } = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: input.organizationName, subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000) },
      });
      const user = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash, lastOrganizationId: organization.id } });
      await tx.membership.create({ data: { userId: user.id, organizationId: organization.id, role: 'OWNER' } });
      return { user, organization };
    });
    return this.startSession(user.id, organization.id);
  }

  /** Opens the company used last (or the first one the user joined). */
  async signIn(input: SignInInput): Promise<NewSession> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { memberships: { orderBy: { createdAt: 'asc' } } },
    });
    const ok = user
      ? await verify(user.passwordHash, input.password)
      : (await verify(await DUMMY_HASH_PROMISE, input.password), false);
    if (!user || !ok) throw new UnauthorizedException('Email or password is incorrect.');
    // Only after a correct password, so this does not reveal which emails have accounts.
    if (user.memberships.length === 0) {
      throw new ForbiddenException('Your account no longer belongs to any company. Ask for a new invitation to join one.');
    }
    const membership = user.memberships.find((m) => m.organizationId === user.lastOrganizationId) ?? user.memberships[0]!;
    return this.startSession(user.id, membership.organizationId);
  }

  async signOut(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  /** Makes another company of the same user the active one for this session. */
  async switchOrganization(auth: AuthContext, organizationId: string): Promise<SessionDto> {
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId: auth.userId } },
    });
    if (!membership) throw new ForbiddenException('You are not a member of that company.');
    await this.prisma.$transaction([
      this.prisma.session.update({ where: { id: auth.sessionId }, data: { organizationId } }),
      this.prisma.user.update({ where: { id: auth.userId }, data: { lastOrganizationId: organizationId } }),
    ]);
    return this.sessionDto(auth.userId, organizationId);
  }

  /** Resolves a cookie token to an auth context, or null if missing, expired or revoked. */
  async resolve(token: string | undefined): Promise<AuthContext | null> {
    if (!token || token.length > 200) return null;
    const session = await this.prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: session.organizationId, userId: session.userId } },
      include: { organization: { select: BILLING_SELECT } },
    });
    if (!membership) return null;
    return {
      sessionId: session.id,
      userId: session.userId,
      organizationId: session.organizationId,
      role: membership.role,
      access: accessLevel(billingStateOf(membership.organization)),
    };
  }

  describe(auth: AuthContext): Promise<SessionDto> {
    return this.sessionDto(auth.userId, auth.organizationId);
  }

  /** Creates a session in a company the user belongs to (sign-in, sign-up, joining by invitation). */
  async startSession(userId: string, organizationId: string): Promise<NewSession> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + env().SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.session.create({ data: { tokenHash: hashToken(token), userId, organizationId, expiresAt } });
    await this.prisma.user.update({ where: { id: userId }, data: { lastOrganizationId: organizationId } });
    return { token, expiresAt, session: await this.sessionDto(userId, organizationId) };
  }

  async sessionDto(userId: string, organizationId: string): Promise<SessionDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { include: { organization: true }, orderBy: { createdAt: 'asc' } } },
    });
    const active = user.memberships.find((m) => m.organizationId === organizationId);
    if (!active) throw new ForbiddenException('You are not a member of that company.');
    return {
      user: { id: user.id, email: user.email, name: user.name },
      organization: {
        id: active.organization.id,
        name: active.organization.name,
        role: active.role,
        billing: billingSummary(billingStateOf(active.organization)),
      },
      organizations: user.memberships
        .map((m) => ({ id: m.organization.id, name: m.organization.name, role: m.role }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
}
