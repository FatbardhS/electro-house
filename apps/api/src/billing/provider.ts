import type { BillingInterval, SubscriptionStatus } from '@electro/shared';

/** What the rest of the app needs from a payment provider. Card data never passes through our server. */
export interface BillingProvider {
  readonly name: 'paddle' | 'dev';
  /** URL of the provider's hosted checkout for one company. */
  checkoutUrl(req: CheckoutRequest): Promise<string>;
  /** URL of the provider's customer portal (payment method, invoices, cancel). */
  portalUrl(customerId: string, subscriptionId: string | null): Promise<string>;
  /** Verifies the signature and turns a webhook into a provider-neutral event. Throws `WebhookError` if invalid. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ProviderEvent;
}

export interface CheckoutRequest {
  organizationId: string;
  email: string;
  interval: BillingInterval;
  seats: number;
  customerId: string | null;
}

export interface ProviderSubscription {
  id: string;
  customerId: string | null;
  /** Our organization id, passed to the provider at checkout and echoed back. */
  organizationId: string | null;
  status: SubscriptionStatus;
  interval: BillingInterval | null;
  seats: number;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface ProviderEvent {
  id: string;
  type: string;
  occurredAt: Date;
  /** Null for events that do not change the subscription (they are only logged). */
  subscription: ProviderSubscription | null;
  raw: unknown;
}

export class WebhookError extends Error {}

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');

export function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}
