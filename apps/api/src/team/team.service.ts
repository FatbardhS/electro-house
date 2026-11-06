import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import {
  INVITATION_DAYS,
  MAX_PENDING_INVITATIONS,
  canManageMember,
  canManageTeam,
  type AssignableRole,
  type CreatedInvitationDto,
  type InvitationDto,
  type InvitationPreviewDto,
  type InvitationSignUpInput,
  type InvitationStatus,
  type InviteInput,
  type Role,
  type TeamDto,
} from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { env } from '../config/env.js';
import type { AuthContext } from '../auth/auth-context.js';
import { AuthService, hashToken, type NewSession } from '../auth/auth.service.js';
import { BillingService } from '../billing/billing.service.js';
import type { Invitation, User } from '../generated/prisma/client.js';

function toInvitationDto(i: Invitation & { invitedBy: Pick<User, 'name'> }): InvitationDto {
  return {
    id: i.id,
    email: i.email,
    role: i.role as AssignableRole,
    invitedBy: i.invitedBy.name,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
  };
}

function statusOf(i: Invitation): InvitationStatus {
  if (i.acceptedAt) return 'used';
  if (i.revokedAt) return 'revoked';
  if (i.expiresAt.getTime() <= Date.now()) return 'expired';
  return 'valid';
}

const STATUS_MESSAGE: Record<Exclude<InvitationStatus, 'valid'>, string> = {
  used: 'This invitation has already been used.',
  revoked: 'This invitation was withdrawn. Ask for a new one.',
  expired: 'This invitation has expired. Ask for a new one.',
};

/**
 * Members, roles and invitations of a company. Invitation links carry a random token; only its hash is stored.
 * Seats on the subscription follow the number of members (see BillingService.syncSeats).
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly billing: BillingService,
  ) {}

  async get(auth: AuthContext): Promise<TeamDto> {
    const members = await this.prisma.membership.findMany({
      where: { organizationId: auth.organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const invitations = canManageTeam(auth.role)
      ? await this.prisma.invitation.findMany({
          where: { organizationId: auth.organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          include: { invitedBy: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    return {
      members: members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, role: m.role, joinedAt: m.createdAt.toISOString() })),
      invitations: invitations.map(toInvitationDto),
    };
  }

  /** Creates (or replaces) an invitation. The link is returned once and cannot be read back later. */
  async invite(auth: AuthContext, input: InviteInput): Promise<CreatedInvitationDto> {
    this.assertManager(auth);
    const existingMember = await this.prisma.membership.findFirst({ where: { organizationId: auth.organizationId, user: { email: input.email } } });
    if (existingMember) throw new ConflictException('This person is already a member of the company.');
    const now = new Date();
    const pending = await this.prisma.invitation.count({
      where: { organizationId: auth.organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now }, NOT: { email: input.email } },
    });
    if (pending >= MAX_PENDING_INVITATIONS) throw new BadRequestException(`At most ${MAX_PENDING_INVITATIONS} invitations can be pending.`);

    const token = randomBytes(32).toString('base64url');
    const created = await this.prisma.$transaction(async (tx) => {
      // A new invitation for the same email replaces the old one (the old link stops working).
      await tx.invitation.updateMany({
        where: { organizationId: auth.organizationId, email: input.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      return tx.invitation.create({
        data: {
          organizationId: auth.organizationId,
          email: input.email,
          role: input.role,
          tokenHash: hashToken(token),
          invitedById: auth.userId,
          expiresAt: new Date(now.getTime() + INVITATION_DAYS * 86_400_000),
        },
        include: { invitedBy: { select: { name: true } } },
      });
    });
    return { invitation: toInvitationDto(created), link: `${env().WEB_ORIGIN}/invite/${token}` };
  }

  async revoke(auth: AuthContext, invitationId: string): Promise<void> {
    this.assertManager(auth);
    const res = await this.prisma.invitation.updateMany({
      where: { id: invitationId, organizationId: auth.organizationId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw new NotFoundException('Invitation not found.');
  }

  async changeRole(auth: AuthContext, userId: string, role: AssignableRole): Promise<void> {
    const target = await this.member(auth.organizationId, userId);
    if (userId === auth.userId) throw new BadRequestException('You cannot change your own role.');
    if (!canManageMember(auth.role, target.role)) throw new ForbiddenException('You cannot change the role of this person.');
    await this.prisma.membership.update({ where: { organizationId_userId: { organizationId: auth.organizationId, userId } }, data: { role } });
  }

  /** Removes a member and ends their sessions in this company at once. Their work stays with the company. */
  async remove(auth: AuthContext, userId: string): Promise<{ seatsError: string | null }> {
    if (userId === auth.userId) throw new BadRequestException('Use “Leave company” to remove yourself.');
    const target = await this.member(auth.organizationId, userId);
    if (!canManageMember(auth.role, target.role)) throw new ForbiddenException('You cannot remove this person.');
    await this.detach(auth.organizationId, userId);
    return { seatsError: (await this.billing.syncSeats(auth.organizationId)).error };
  }

  /**
   * Leaves the active company (not possible for the owner). This ends the session, which belonged to that company;
   * the next sign-in opens another company of the user, if any.
   */
  async leave(auth: AuthContext): Promise<void> {
    if (auth.role === 'OWNER') throw new BadRequestException('The owner cannot leave. Transfer ownership to an admin first.');
    await this.detach(auth.organizationId, auth.userId);
    await this.billing.syncSeats(auth.organizationId);
  }

  /** Hands ownership to an admin; the previous owner becomes an admin. */
  async transferOwnership(auth: AuthContext, userId: string): Promise<void> {
    if (auth.role !== 'OWNER') throw new ForbiddenException('Only the owner can transfer ownership.');
    if (userId === auth.userId) throw new BadRequestException('You are already the owner.');
    const target = await this.member(auth.organizationId, userId);
    if (target.role !== 'ADMIN') throw new BadRequestException('Make this person an admin first; ownership can only go to an admin.');
    const key = (u: string) => ({ organizationId_userId: { organizationId: auth.organizationId, userId: u } });
    await this.prisma.$transaction([
      this.prisma.membership.update({ where: key(userId), data: { role: 'OWNER' } }),
      this.prisma.membership.update({ where: key(auth.userId), data: { role: 'ADMIN' } }),
    ]);
  }

  // ── invitation links (used by the invitee) ──

  async preview(token: string): Promise<InvitationPreviewDto> {
    const i = await this.byToken(token);
    const accountExists = (await this.prisma.user.count({ where: { email: i.email } })) > 0;
    return {
      status: statusOf(i),
      organizationName: i.organization.name,
      role: i.role as AssignableRole,
      invitedBy: i.invitedBy.name,
      email: i.email,
      accountExists,
    };
  }

  /** A signed-in user joins with an invitation sent to their own email. Returns the company to switch to. */
  async accept(auth: AuthContext, token: string): Promise<string> {
    const i = await this.usable(token);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { email: true } });
    if (user.email.toLowerCase() !== i.email.toLowerCase()) {
      throw new ForbiddenException(`This invitation is for ${i.email}. Sign in with that account to accept it.`);
    }
    await this.join(i, auth.userId);
    return i.organizationId;
  }

  /** Creates an account for the invited email and joins the company. */
  async signUpAndAccept(token: string, input: InvitationSignUpInput): Promise<NewSession> {
    const i = await this.usable(token);
    if (await this.prisma.user.count({ where: { email: i.email } })) {
      throw new ConflictException('An account with this email already exists. Sign in to accept the invitation.');
    }
    const passwordHash = await hash(input.password);
    const user = await this.prisma.user.create({ data: { email: i.email, name: input.name, passwordHash, language: input.language } });
    await this.join(i, user.id);
    return this.auth.startSession(user.id, i.organizationId);
  }

  // ── helpers ──

  private async join(i: Invitation, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Marking it used first makes a second, concurrent accept fail instead of joining twice.
      const claimed = await tx.invitation.updateMany({ where: { id: i.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date() } });
      if (claimed.count === 0) throw new GoneException(STATUS_MESSAGE.used);
      const already = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: i.organizationId, userId } } });
      if (!already) await tx.membership.create({ data: { organizationId: i.organizationId, userId, role: i.role } });
    });
    await this.billing.syncSeats(i.organizationId);
  }

  private async detach(organizationId: string, userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.membership.delete({ where: { organizationId_userId: { organizationId, userId } } }),
      this.prisma.session.deleteMany({ where: { organizationId, userId } }),
      this.prisma.user.updateMany({ where: { id: userId, lastOrganizationId: organizationId }, data: { lastOrganizationId: null } }),
    ]);
  }

  private async byToken(token: string) {
    const i = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { organization: { select: { name: true } }, invitedBy: { select: { name: true } } },
    });
    if (!i) throw new NotFoundException('This invitation link is not valid. Check that you copied the whole link.');
    return i;
  }

  private async usable(token: string) {
    const i = await this.byToken(token);
    const status = statusOf(i);
    if (status !== 'valid') throw new GoneException(STATUS_MESSAGE[status]);
    return i;
  }

  private async member(organizationId: string, userId: string): Promise<{ role: Role }> {
    const m = await this.prisma.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!m) throw new NotFoundException('This person is not a member of the company.');
    return m;
  }

  private assertManager(auth: AuthContext): void {
    if (!canManageTeam(auth.role)) throw new ForbiddenException('Only the owner or an admin can manage the team.');
  }
}
