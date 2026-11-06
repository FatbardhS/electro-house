import { SUBSCRIPTION_STATUSES, type BillingInterval, type BillingState, type SubscriptionStatus } from '@electro/shared';
import type { Organization } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

export type BillingColumns = Pick<
  Organization,
  'subscriptionStatus' | 'trialEndsAt' | 'currentPeriodEnd' | 'cancelAtPeriodEnd' | 'pastDueSince' | 'billingInterval' | 'seats'
>;

/** Prisma select for the columns `billingStateOf` needs. */
export const BILLING_SELECT = {
  subscriptionStatus: true,
  trialEndsAt: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  pastDueSince: true,
  billingInterval: true,
  seats: true,
} as const;

/** With `BILLING_PROVIDER=none` every company counts as active (full access, no trial banners). */
export function billingEnabled(): boolean {
  return env().BILLING_PROVIDER !== 'none';
}

export function billingStateOf(o: BillingColumns): BillingState {
  if (!billingEnabled()) {
    return { status: 'active', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, pastDueSince: null, interval: null, seats: o.seats };
  }
  const status = (SUBSCRIPTION_STATUSES as readonly string[]).includes(o.subscriptionStatus)
    ? (o.subscriptionStatus as SubscriptionStatus)
    : 'expired';
  return {
    status,
    trialEndsAt: o.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: o.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: o.cancelAtPeriodEnd,
    pastDueSince: o.pastDueSince?.toISOString() ?? null,
    interval: o.billingInterval === 'month' || o.billingInterval === 'year' ? (o.billingInterval as BillingInterval) : null,
    seats: o.seats,
  };
}
