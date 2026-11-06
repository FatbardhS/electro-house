import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { BILLING_INTERVALS, SUBSCRIPTION_STATUSES, type BillingInterval } from '@electro/shared';
import { z } from 'zod';
import { env } from '../config/env.js';
import { WebhookError, header, type BillingProvider, type CheckoutRequest, type ProviderEvent, type ProviderSubscription } from './provider.js';

const DAY = 86_400_000;

const devEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  occurredAt: z.iso.datetime(),
  subscription: z
    .object({
      id: z.string(),
      customerId: z.string().nullable(),
      organizationId: z.string().nullable(),
      status: z.enum(SUBSCRIPTION_STATUSES),
      interval: z.enum(BILLING_INTERVALS).nullable(),
      seats: z.number().int().min(1),
      currentPeriodEnd: z.iso.datetime().nullable(),
      cancelAtPeriodEnd: z.boolean(),
    })
    .nullable(),
});

export type DevAction = 'cancel' | 'resume' | 'payment_failed' | 'payment_succeeded' | 'end_now';

/**
 * Development-only provider: a simulated checkout inside the app, events signed with a per-process secret and
 * delivered through the same webhook handling as the real provider. No money moves. Refused in production by env.
 */
export class DevBillingProvider implements BillingProvider {
  readonly name = 'dev' as const;
  private readonly secret = randomBytes(32);

  async checkoutUrl(req: CheckoutRequest): Promise<string> {
    const token = this.sign({ org: req.organizationId, interval: req.interval, seats: req.seats, exp: Date.now() + 30 * 60_000 });
    return `${env().WEB_ORIGIN}/settings?tab=billing&dev-checkout=${encodeURIComponent(token)}`;
  }

  async portalUrl(): Promise<string> {
    return `${env().WEB_ORIGIN}/settings?tab=billing&dev-portal=1`;
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderEvent {
    const sig = header(headers, 'x-dev-signature') ?? '';
    const expected = createHmac('sha256', this.secret).update(rawBody).digest('hex');
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      throw new WebhookError('Invalid signature.');
    }
    const parsed = devEventSchema.safeParse(JSON.parse(rawBody.toString('utf8')));
    if (!parsed.success) throw new WebhookError('Invalid event.');
    const e = parsed.data;
    return {
      id: e.id,
      type: e.type,
      occurredAt: new Date(e.occurredAt),
      subscription: e.subscription
        ? { ...e.subscription, currentPeriodEnd: e.subscription.currentPeriodEnd ? new Date(e.subscription.currentPeriodEnd) : null }
        : null,
      raw: e,
    };
  }

  /** The confirmation arrives as a webhook (see `seatsEvent`), like with the real provider. */
  async updateSeats(): Promise<void> {}

  /** Signed "subscription updated" webhook with a new seat count. */
  seatsEvent(current: ProviderSubscription, seats: number): { body: Buffer; headers: Record<string, string> } {
    return this.event('subscription.updated', { ...current, seats });
  }

  /** Turns a dev checkout token into a signed "subscription activated" webhook. */
  checkoutCompletedEvent(token: string): { body: Buffer; headers: Record<string, string> } {
    const t = this.verify(token) as { org: string; interval: BillingInterval; seats: number; exp: number } | null;
    if (!t || t.exp < Date.now()) throw new WebhookError('This test checkout link has expired. Start the checkout again.');
    return this.event('subscription.activated', {
      id: `dev_sub_${randomUUID()}`,
      customerId: `dev_ctm_${t.org.slice(0, 8)}`,
      organizationId: t.org,
      status: 'active',
      interval: t.interval,
      seats: t.seats,
      currentPeriodEnd: new Date(Date.now() + (t.interval === 'year' ? 365 : 30) * DAY),
      cancelAtPeriodEnd: false,
    });
  }

  /** Signed webhook for a simulated portal action on an existing subscription. */
  actionEvent(action: DevAction, current: ProviderSubscription): { body: Buffer; headers: Record<string, string> } {
    const next: ProviderSubscription = { ...current };
    if (action === 'cancel') Object.assign(next, { status: 'canceled', cancelAtPeriodEnd: true });
    if (action === 'resume') Object.assign(next, { status: 'active', cancelAtPeriodEnd: false });
    if (action === 'payment_failed') Object.assign(next, { status: 'past_due' });
    if (action === 'payment_succeeded') {
      const days = current.interval === 'year' ? 365 : 30;
      Object.assign(next, { status: 'active', currentPeriodEnd: new Date(Date.now() + days * DAY) });
    }
    if (action === 'end_now') Object.assign(next, { status: 'expired', currentPeriodEnd: new Date(), cancelAtPeriodEnd: false });
    return this.event(`subscription.${action}`, next);
  }

  private event(type: string, s: ProviderSubscription): { body: Buffer; headers: Record<string, string> } {
    const body = Buffer.from(
      JSON.stringify({
        id: `dev_evt_${randomUUID()}`,
        type,
        occurredAt: new Date().toISOString(),
        subscription: { ...s, currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null },
      }),
    );
    return { body, headers: { 'x-dev-signature': createHmac('sha256', this.secret).update(body).digest('hex') } };
  }

  private sign(data: object): string {
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    return `${payload}.${createHmac('sha256', this.secret).update(payload).digest('base64url')}`;
  }

  private verify(token: string): unknown {
    const [payload, mac] = token.split('.');
    if (!payload || !mac) return null;
    const expected = createHmac('sha256', this.secret).update(payload).digest('base64url');
    if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  }
}
