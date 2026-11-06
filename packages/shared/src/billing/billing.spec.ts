import { describe, expect, it } from 'vitest';
import { accessLevel, billingSummary, daysUntil, effectiveStatus, summaryBanner, type BillingState } from './billing.js';

const now = new Date('2026-11-06T12:00:00Z');
const days = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();
const base: BillingState = {
  status: 'trialing',
  trialEndsAt: days(10),
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  pastDueSince: null,
  interval: null,
  seats: 1,
};

describe('subscription access', () => {
  it('gives full access during the trial and read-only after it', () => {
    expect(accessLevel(base, now)).toBe('full');
    expect(effectiveStatus({ ...base, trialEndsAt: days(-1) }, now)).toBe('expired');
    expect(accessLevel({ ...base, trialEndsAt: days(-1) }, now)).toBe('read-only');
    expect(accessLevel({ ...base, trialEndsAt: null }, now)).toBe('read-only');
  });

  it('keeps access while active and until the end of a cancelled period', () => {
    expect(accessLevel({ ...base, status: 'active' }, now)).toBe('full');
    expect(accessLevel({ ...base, status: 'canceled', currentPeriodEnd: days(5) }, now)).toBe('full');
    expect(effectiveStatus({ ...base, status: 'canceled', currentPeriodEnd: days(-5) }, now)).toBe('expired');
  });

  it('allows a grace period after a failed payment', () => {
    expect(accessLevel({ ...base, status: 'past_due', pastDueSince: days(-3) }, now)).toBe('full');
    expect(accessLevel({ ...base, status: 'past_due', pastDueSince: days(-8) }, now)).toBe('read-only');
    expect(accessLevel({ ...base, status: 'expired' }, now)).toBe('read-only');
  });

  it('builds the right banner', () => {
    expect(summaryBanner(billingSummary(base, now), now)).toBeNull();
    expect(summaryBanner(billingSummary({ ...base, trialEndsAt: days(2) }, now), now)?.text).toContain('2 days');
    expect(summaryBanner(billingSummary({ ...base, trialEndsAt: days(-2) }, now), now)?.kind).toBe('error');
    expect(summaryBanner(billingSummary({ ...base, status: 'past_due', pastDueSince: days(-1) }, now), now)?.kind).toBe('warn');
    expect(daysUntil(days(1.5), now)).toBe(2);
  });
});
