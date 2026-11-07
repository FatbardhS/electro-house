import { z } from 'zod';

/**
 * Product owner panel (/admin): who uses the app and what they do.
 * Only accounts listed in the API's PLATFORM_ADMIN_EMAILS can open it.
 */

/** Everything the activity log records. The English label is also the i18n key. */
export const ACTIVITY_ACTIONS = {
  'auth.sign_up': 'Created an account',
  'auth.sign_in': 'Signed in',
  'auth.sign_in_failed': 'Failed sign-in',
  'auth.sign_out': 'Signed out',
  'invitation.accepted': 'Joined a company by invitation',
  'invitation.sign_up': 'Created an account by invitation',
  'team.invited': 'Invited someone',
  'team.role_changed': 'Changed a member’s role',
  'team.member_removed': 'Removed a member',
  'team.left': 'Left a company',
  'team.ownership_transferred': 'Transferred ownership',
  'client.created': 'Created a client',
  'client.deleted': 'Deleted a client',
  'project.created': 'Created a project',
  'project.deleted': 'Deleted a project',
  'floor.created': 'Added a floor',
  'floor.deleted': 'Deleted a floor',
  'plan.uploaded': 'Uploaded a plan PDF',
  'export.pdf': 'Exported a PDF',
  'export.dxf': 'Exported DXF',
  'admin.denied': 'Tried to open the admin panel',
} as const;

export type ActivityAction = keyof typeof ACTIVITY_ACTIONS;
export const ACTIVITY_ACTION_KEYS = Object.keys(ACTIVITY_ACTIONS) as ActivityAction[];

/** Actions shown in red: possible misuse or access problems. */
export const WARNING_ACTIONS: readonly ActivityAction[] = ['auth.sign_in_failed', 'admin.denied'];

export interface ActivityEventDto {
  id: string;
  createdAt: string;
  action: string;
  userId: string | null;
  email: string | null;
  /** Current name of the user, when the account still exists. */
  userName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface ActivityPageDto {
  events: ActivityEventDto[];
  /** Pass as `before` to load older events; null when there are no more. */
  nextCursor: string | null;
}

export const activityQuerySchema = z.object({
  userId: z.uuid().optional(),
  organizationId: z.uuid().optional(),
  action: z.enum(ACTIVITY_ACTION_KEYS as [ActivityAction, ...ActivityAction[]]).optional(),
  /** Free text: email, name, company or what the action was about. */
  search: z.string().trim().max(200).optional(),
  /** ISO time of the last event already loaded (newest first). */
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export interface AdminDayDto {
  /** YYYY-MM-DD (UTC). */
  day: string;
  signUps: number;
  /** Different users who did anything that day. */
  activeUsers: number;
  signIns: number;
  exports: number;
}

export interface AdminOverviewDto {
  totals: { users: number; companies: number; projects: number; clients: number; floors: number };
  /** Users seen in the last 24 hours / 7 days / 30 days. */
  active: { day: number; week: number; month: number };
  signUps: { week: number; month: number };
  /** Failed sign-ins in the last 24 hours (watch for password guessing). */
  failedSignIns24h: number;
  exportsWeek: number;
  /** Companies by subscription status (trialing, active…). */
  subscriptions: Record<string, number>;
  /** Last 30 days, oldest first. */
  days: AdminDayDto[];
  /** Users currently signed in somewhere (sessions not expired). */
  openSessions: number;
}

export interface AdminMembershipDto {
  organizationId: string;
  organizationName: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

export interface AdminUserDto {
  id: string;
  name: string;
  email: string;
  language: 'sq' | 'en';
  createdAt: string;
  lastSeenAt: string | null;
  lastSignInAt: string | null;
  openSessions: number;
  memberships: AdminMembershipDto[];
  isPlatformAdmin: boolean;
}

export interface AdminSessionDto {
  id: string;
  organizationName: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface AdminUserDetailDto extends AdminUserDto {
  sessions: AdminSessionDto[];
  /** Counts of what this user did (all time, from the log). */
  actionCounts: Record<string, number>;
}

export interface AdminCompanyDto {
  id: string;
  name: string;
  createdAt: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  members: number;
  projects: number;
  clients: number;
  owner: { id: string; name: string; email: string } | null;
  lastActivityAt: string | null;
}

export const adminListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});
