import { z } from 'zod';
import { signUpSchema } from '../schemas/schemas.js';

/** Company roles. Exactly one owner per company; admins manage; members work on projects. */
export const ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type Role = (typeof ROLES)[number];
/** Roles that can be given by invitation or role change (ownership only moves by transfer). */
export const ASSIGNABLE_ROLES = ['ADMIN', 'MEMBER'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_NAMES: Record<Role, string> = { OWNER: 'Owner', ADMIN: 'Admin', MEMBER: 'Member' };

export const INVITATION_DAYS = 7;
export const MAX_PENDING_INVITATIONS = 50;

export function canManageTeam(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/** Can `actor` change the role of, or remove, a member with role `target`? (Nobody manages the owner.) */
export function canManageMember(actor: Role, target: Role): boolean {
  return canManageTeam(actor) && target !== 'OWNER';
}

export interface MemberDto {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: AssignableRole;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
}

export interface TeamDto {
  members: MemberDto[];
  /** Pending invitations; only visible to owners and admins. */
  invitations: InvitationDto[];
}

/** Returned once, when an invitation is created: the link cannot be shown again later (only its hash is stored). */
export interface CreatedInvitationDto {
  invitation: InvitationDto;
  link: string;
}

export const inviteSchema = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase().max(254),
  role: z.enum(ASSIGNABLE_ROLES),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const roleChangeSchema = z.object({ role: z.enum(ASSIGNABLE_ROLES) });
export const transferOwnershipSchema = z.object({ userId: z.uuid() });
export const switchOrganizationSchema = z.object({ organizationId: z.uuid() });

/** Sign-up from an invitation: the email and company come from the invitation. */
export const invitationSignUpSchema = signUpSchema.pick({ name: true, password: true });
export type InvitationSignUpInput = z.infer<typeof invitationSignUpSchema>;

export type InvitationStatus = 'valid' | 'expired' | 'revoked' | 'used';

/** What the invitation page shows to whoever holds the link. */
export interface InvitationPreviewDto {
  status: InvitationStatus;
  organizationName: string;
  role: AssignableRole;
  invitedBy: string;
  email: string;
  /** True if an account with the invited email exists (then: sign in and join). */
  accountExists: boolean;
}

/** Companies the signed-in user belongs to (for the company switcher). */
export interface OrganizationChoiceDto {
  id: string;
  name: string;
  role: Role;
}

/** 32 bytes of randomness in base64url. */
export const INVITATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
