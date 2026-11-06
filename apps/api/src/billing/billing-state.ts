import { SUBSCRIPTION_STATUSES, type BillingInterval, type BillingState, type SubscriptionStatus } from '@electro/shared';
import type { Organization } from '../generated/prisma/client.js';

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

export function billingStateOf(o: BillingColumns): BillingState {
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
