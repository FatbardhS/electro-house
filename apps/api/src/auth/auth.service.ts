import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { SessionDto, SignInInput, SignUpInput } from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { env } from '../config/env.js';
import type { AuthContext } from './auth-context.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// A valid hash of a random password, so sign-in for an unknown email costs the same time as a wrong password.
const DUMMY_HASH_PROMISE = hash(randomBytes(16).toString('hex'));

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the user, their company (organization) and owner membership in one transaction. */
  async signUp(input: SignUpInput): Promise<{ token: string; expiresAt: Date; session: SessionDto }> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('An account with this email already exists. Sign in instead.');

    const passwordHash = await hash(input.password);
    const { user, organization } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash } });
      const organization = await tx.organization.create({ data: { name: input.organizationName } });
      await tx.membership.create({ data: { userId: user.id, organizationId: organization.id, role: 'OWNER' } });
      return { user, organization };
    });

    const { token, expiresAt } = await this.createSession(user.id, organization.id);
    return {
      token,
      expiresAt,
      session: {
        user: { id: user.id, email: user.email, name: user.name },
        organization: { id: organization.id, name: organization.name, role: 'OWNER' },
      },
    };
  }

  async signIn(input: SignInInput): Promise<{ token: string; expiresAt: Date; session: SessionDto }> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { memberships: { include: { organization: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    const ok = user
      ? await verify(user.passwordHash, input.password)
      : (await verify(await DUMMY_HASH_PROMISE, input.password), false);
    const membership = user?.memberships[0];
    if (!user || !ok || !membership) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    const { token, expiresAt } = await this.createSession(user.id, membership.organizationId);
    return {
      token,
      expiresAt,
      session: {
        user: { id: user.id, email: user.email, name: user.name },
        organization: { id: membership.organization.id, name: membership.organization.name, role: membership.role },
      },
    };
  }

  async signOut(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
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
    });
    if (!membership) return null;
    return {
      sessionId: session.id,
      userId: session.userId,
      organizationId: session.organizationId,
      role: membership.role,
    };
  }

  async describe(auth: AuthContext): Promise<SessionDto> {
    const membership = await this.prisma.membership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: auth.organizationId, userId: auth.userId } },
      include: { user: true, organization: true },
    });
    return {
      user: { id: membership.user.id, email: membership.user.email, name: membership.user.name },
      organization: { id: membership.organization.id, name: membership.organization.name, role: membership.role },
    };
  }

  private async createSession(userId: string, organizationId: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + env().SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.session.create({ data: { tokenHash: hashToken(token), userId, organizationId, expiresAt } });
    return { token, expiresAt };
  }
}
