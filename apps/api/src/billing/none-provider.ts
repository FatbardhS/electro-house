import { BadRequestException } from '@nestjs/common';
import { WebhookError, type BillingProvider } from './provider.js';

const OFF = 'Billing is not enabled on this server yet. All companies have full access.';

/**
 * `BILLING_PROVIDER=none`: billing is switched off (e.g. a free test deployment). There is no checkout; every company
 * has full access regardless of its trial (see `billingStateFor`). Switching to `paddle` later needs only settings.
 */
export class NoBillingProvider implements BillingProvider {
  readonly name = 'none' as const;

  async checkoutUrl(): Promise<string> {
    throw new BadRequestException(OFF);
  }

  async portalUrl(): Promise<string> {
    throw new BadRequestException(OFF);
  }

  parseWebhook(): never {
    throw new WebhookError('Billing is not enabled.');
  }

  async updateSeats(): Promise<void> {}
}
