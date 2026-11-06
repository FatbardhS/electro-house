import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BillingInterval, SubscriptionStatus } from '@electro/shared';
import { WebhookError, header, type BillingProvider, type CheckoutRequest, type ProviderEvent, type ProviderSubscription } from './provider.js';

/** Webhooks older than this are refused (replay protection), as Paddle recommends. */
const MAX_SIGNATURE_AGE_S = 5 * 60;

export interface PaddleConfig {
  environment: 'sandbox' | 'production';
  apiKey: string;
  webhookSecret: string;
  prices: Record<BillingInterval, string>;
}

/**
 * Paddle Billing (merchant of record: Paddle collects and remits VAT / sales tax).
 * Uses the REST API v1 directly with fetch (no SDK dependency).
 *
 * NOT YET VERIFIED against a real Paddle sandbox account: needs PADDLE_* settings (see .env.example).
 */
export class PaddleBillingProvider implements BillingProvider {
  readonly name = 'paddle' as const;
  private readonly base: string;

  constructor(private readonly config: PaddleConfig) {
    this.base = config.environment === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com';
  }

  /** Creates a draft transaction; Paddle returns a hosted checkout URL (requires a default payment link in Paddle). */
  async checkoutUrl(req: CheckoutRequest): Promise<string> {
    const body: Record<string, unknown> = {
      items: [{ price_id: this.config.prices[req.interval], quantity: req.seats }],
      custom_data: { organization_id: req.organizationId },
      collection_mode: 'automatic',
    };
    if (req.customerId) body['customer_id'] = req.customerId;
    const res = await this.call<{ data: { checkout?: { url?: string | null } } }>('POST', '/transactions', body);
    const url = res.data.checkout?.url;
    if (!url) throw new Error('Paddle did not return a checkout URL. Set a default payment link in Paddle → Checkout settings.');
    return url;
  }

  async portalUrl(customerId: string, subscriptionId: string | null): Promise<string> {
    const res = await this.call<{ data: { urls: { general: { overview: string } } } }>(
      'POST',
      `/customers/${encodeURIComponent(customerId)}/portal-sessions`,
      subscriptionId ? { subscription_ids: [subscriptionId] } : {},
    );
    return res.data.urls.general.overview;
  }

  /** New quantity on the subscription's item, prorated onto the next bill. */
  async updateSeats(subscriptionId: string, interval: BillingInterval, seats: number): Promise<void> {
    await this.call('PATCH', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      items: [{ price_id: this.config.prices[interval], quantity: Math.max(1, seats) }],
      proration_billing_mode: 'prorated_next_billing_period',
    });
  }

  /**
   * Verifies `Paddle-Signature: ts=<unix>;h1=<hex hmac>` where the signed payload is `<ts>:<raw body>`,
   * then maps subscription.* events.
   */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderEvent {
    const sigHeader = header(headers, 'paddle-signature') ?? '';
    const parts = Object.fromEntries(sigHeader.split(';').map((p) => p.split('=', 2) as [string, string]));
    const ts = Number(parts['ts']);
    const h1 = parts['h1'] ?? '';
    if (!Number.isFinite(ts) || !h1) throw new WebhookError('Missing signature.');
    if (Math.abs(Date.now() / 1000 - ts) > MAX_SIGNATURE_AGE_S) throw new WebhookError('Signature too old.');
    const expected = createHmac('sha256', this.config.webhookSecret).update(`${ts}:`).update(rawBody).digest('hex');
    if (h1.length !== expected.length || !timingSafeEqual(Buffer.from(h1), Buffer.from(expected))) {
      throw new WebhookError('Invalid signature.');
    }
    const event = JSON.parse(rawBody.toString('utf8')) as PaddleEvent;
    return {
      id: event.event_id,
      type: event.event_type,
      occurredAt: new Date(event.occurred_at),
      subscription: event.event_type.startsWith('subscription.') ? this.mapSubscription(event.data as PaddleSubscription) : null,
      raw: event,
    };
  }

  /** Paddle subscription → provider-neutral subscription. Our own trial is separate, so Paddle "trialing" counts as active. */
  mapSubscription(s: PaddleSubscription): ProviderSubscription {
    const item = s.items?.[0];
    const scheduledCancel = s.scheduled_change?.action === 'cancel';
    const statusMap: Record<string, SubscriptionStatus> = {
      active: 'active',
      trialing: 'active',
      past_due: 'past_due',
      paused: 'expired',
      canceled: 'expired',
    };
    let status = statusMap[s.status] ?? 'expired';
    if (status === 'active' && scheduledCancel) status = 'canceled';
    const interval = item?.price?.billing_cycle?.interval;
    return {
      id: s.id,
      customerId: s.customer_id ?? null,
      organizationId: typeof s.custom_data?.['organization_id'] === 'string' ? (s.custom_data['organization_id'] as string) : null,
      status,
      interval: interval === 'month' || interval === 'year' ? interval : null,
      seats: Math.max(1, item?.quantity ?? 1),
      currentPeriodEnd: s.current_billing_period?.ends_at ? new Date(s.current_billing_period.ends_at) : scheduledCancel && s.scheduled_change?.effective_at ? new Date(s.scheduled_change.effective_at) : null,
      cancelAtPeriodEnd: scheduledCancel,
    };
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { detail?: string } };
    if (!res.ok) throw new Error(`Paddle API ${method} ${path} failed (${res.status}): ${json.error?.detail ?? 'no details'}`);
    return json as T;
  }
}

interface PaddleEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: unknown;
}

export interface PaddleSubscription {
  id: string;
  status: string;
  customer_id?: string;
  custom_data?: Record<string, unknown> | null;
  items?: { quantity?: number; price?: { billing_cycle?: { interval?: string } } }[];
  current_billing_period?: { starts_at: string; ends_at: string } | null;
  scheduled_change?: { action?: string; effective_at?: string } | null;
}
