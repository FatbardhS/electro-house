import { z } from 'zod';

/**
 * Subscription rules shared by the API (enforcement) and the web app (banners, read-only mode).
 * One plan, priced per user (seat). Prices shown here are for display; the payment provider holds the real prices.
 */

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'canceled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const TRIAL_DAYS = 14;
/** After a failed payment the company keeps full access this long while the provider retries. */
export const PAST_DUE_GRACE_DAYS = 7;
/** The trial banner appears this many days before the end. */
export const TRIAL_WARNING_DAYS = 3;

export const PLAN = {
  name: 'Electro House',
  currency: 'EUR',
  /** Net price per user. */
  pricePerSeat: { month: 29, year: 290 } satisfies Record<BillingInterval, number>,
} as const;

const DAY = 24 * 60 * 60 * 1000;

/** What is stored on the organization (dates as ISO strings in DTOs). */
export interface BillingState {
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  interval: BillingInterval | null;
  seats: number;
}

export type AccessLevel = 'full' | 'read-only';

/**
 * Status as the user experiences it right now. A trial or cancelled subscription whose end date has passed
 * is "expired" even before any webhook says so.
 */
export function effectiveStatus(s: BillingState, now = new Date()): SubscriptionStatus {
  const t = now.getTime();
  const at = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  switch (s.status) {
    case 'trialing':
      return Number.isFinite(at(s.trialEndsAt)) && at(s.trialEndsAt) > t ? 'trialing' : 'expired';
    case 'canceled':
      return Number.isFinite(at(s.currentPeriodEnd)) && at(s.currentPeriodEnd) > t ? 'canceled' : 'expired';
    default:
      return s.status;
  }
}

/**
 * Full access while trialing, active, cancelled-but-paid-until-period-end, or past due within the grace period.
 * Otherwise read-only: the company can sign in, view and export, but not create or change anything.
 */
export function accessLevel(s: BillingState, now = new Date()): AccessLevel {
  const status = effectiveStatus(s, now);
  if (status === 'trialing' || status === 'active' || status === 'canceled') return 'full';
  if (status === 'past_due') {
    const since = s.pastDueSince ? Date.parse(s.pastDueSince) : now.getTime();
    return now.getTime() - since < PAST_DUE_GRACE_DAYS * DAY ? 'full' : 'read-only';
  }
  return 'read-only';
}

/** Whole days left (rounded up), 0 when past. */
export function daysUntil(iso: string | null, now = new Date()): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((Date.parse(iso) - now.getTime()) / DAY));
}

/** Compact billing info sent with the session, enough for banners and read-only mode. */
export interface BillingSummary {
  status: SubscriptionStatus;
  access: AccessLevel;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export function billingSummary(s: BillingState, now = new Date()): BillingSummary {
  return {
    status: effectiveStatus(s, now),
    access: accessLevel(s, now),
    trialEndsAt: s.trialEndsAt,
    currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  };
}

/** Full billing page data. */
export interface BillingDto extends BillingSummary {
  interval: BillingInterval | null;
  seats: number;
  /** Users in the company (seats follow this number). */
  members: number;
  pastDueSince: string | null;
  /** "paddle" or "dev" (development only, no real payments). */
  provider: string;
  /** True when the company has a subscription with the provider (portal available). */
  hasSubscription: boolean;
}

export const checkoutSchema = z.object({ interval: z.enum(BILLING_INTERVALS) });
export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** Message of the 402 error returned for changes while read-only. */
export const READ_ONLY_MESSAGE =
  'Your subscription is not active, so projects are read-only. You can still view and export. Renew in Settings → Billing.';

export function summaryBanner(b: BillingSummary, now = new Date()): { kind: 'info' | 'warn' | 'error'; text: string } | null {
  if (b.access === 'read-only') return { kind: 'error', text: 'Read-only: your subscription is not active. Viewing and exports still work.' };
  if (b.status === 'past_due') return { kind: 'warn', text: 'The last payment failed. Update your payment method to keep full access.' };
  if (b.status === 'trialing') {
    const d = daysUntil(b.trialEndsAt, now);
    if (d <= TRIAL_WARNING_DAYS) return { kind: 'info', text: `Your free trial ends in ${d} day${d === 1 ? '' : 's'}. Subscribe to keep editing.` };
  }
  if (b.status === 'canceled') {
    return { kind: 'info', text: `Your subscription ends in ${daysUntil(b.currentPeriodEnd, now)} day(s); after that projects become read-only.` };
  }
  return null;
}
