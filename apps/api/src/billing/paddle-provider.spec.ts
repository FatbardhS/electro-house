import { createHmac } from 'node:crypto';
import { PaddleBillingProvider, type PaddleSubscription } from './paddle-provider.js';
import { WebhookError } from './provider.js';

const SECRET = 'pdl_ntfset_test_secret';
const paddle = new PaddleBillingProvider({
  environment: 'sandbox',
  apiKey: 'test',
  webhookSecret: SECRET,
  prices: { month: 'pri_month', year: 'pri_year' },
});

const sub: PaddleSubscription = {
  id: 'sub_01',
  status: 'active',
  customer_id: 'ctm_01',
  custom_data: { organization_id: '6f1c2c56-6a0e-4b8e-9a5a-0d6c1f0f3a11' },
  items: [{ quantity: 3, price: { billing_cycle: { interval: 'year' } } }],
  current_billing_period: { starts_at: '2026-11-06T00:00:00Z', ends_at: '2027-11-06T00:00:00Z' },
  scheduled_change: null,
};

function signed(body: object, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const raw = Buffer.from(JSON.stringify(body));
  const h1 = createHmac('sha256', secret).update(`${ts}:${raw.toString()}`).digest('hex');
  return { raw, headers: { 'paddle-signature': `ts=${ts};h1=${h1}` } };
}

const event = { event_id: 'evt_01', event_type: 'subscription.activated', occurred_at: '2026-11-06T12:00:00Z', data: sub };

describe('Paddle webhooks', () => {
  it('accepts a correctly signed event and maps the subscription', () => {
    const { raw, headers } = signed(event);
    const e = paddle.parseWebhook(raw, headers);
    expect(e).toMatchObject({ id: 'evt_01', type: 'subscription.activated' });
    expect(e.subscription).toMatchObject({
      id: 'sub_01',
      customerId: 'ctm_01',
      organizationId: '6f1c2c56-6a0e-4b8e-9a5a-0d6c1f0f3a11',
      status: 'active',
      interval: 'year',
      seats: 3,
      cancelAtPeriodEnd: false,
    });
    expect(e.subscription?.currentPeriodEnd?.toISOString()).toBe('2027-11-06T00:00:00.000Z');
  });

  it('rejects a wrong secret, a changed body and an old signature', () => {
    const bad = signed(event, 'other-secret');
    expect(() => paddle.parseWebhook(bad.raw, bad.headers)).toThrow(WebhookError);
    const ok = signed(event);
    expect(() => paddle.parseWebhook(Buffer.from(ok.raw.toString().replace('sub_01', 'sub_02')), ok.headers)).toThrow(WebhookError);
    const old = signed(event, SECRET, Math.floor(Date.now() / 1000) - 3600);
    expect(() => paddle.parseWebhook(old.raw, old.headers)).toThrow(/too old/);
    expect(() => paddle.parseWebhook(ok.raw, {})).toThrow(/Missing/);
  });

  it('maps a scheduled cancellation, failed payment and ended subscription', () => {
    expect(paddle.mapSubscription({ ...sub, scheduled_change: { action: 'cancel', effective_at: '2027-11-06T00:00:00Z' } })).toMatchObject({
      status: 'canceled',
      cancelAtPeriodEnd: true,
    });
    expect(paddle.mapSubscription({ ...sub, status: 'past_due' }).status).toBe('past_due');
    expect(paddle.mapSubscription({ ...sub, status: 'canceled', current_billing_period: null }).status).toBe('expired');
    expect(paddle.mapSubscription({ ...sub, status: 'trialing' }).status).toBe('active');
  });

  it('does not treat non-subscription events as subscription changes', () => {
    const { raw, headers } = signed({ ...event, event_type: 'transaction.completed', data: { id: 'txn_01' } });
    expect(paddle.parseWebhook(raw, headers).subscription).toBeNull();
  });
});
