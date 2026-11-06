import { Module } from '@nestjs/common';
import { env } from '../config/env.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { DevBillingProvider } from './dev-provider.js';
import { PaddleBillingProvider } from './paddle-provider.js';
import { BILLING_PROVIDER, type BillingProvider } from './provider.js';

function createProvider(): BillingProvider {
  const e = env();
  if (e.BILLING_PROVIDER === 'paddle') {
    return new PaddleBillingProvider({
      environment: e.PADDLE_ENV,
      apiKey: e.PADDLE_API_KEY!,
      webhookSecret: e.PADDLE_WEBHOOK_SECRET!,
      prices: { month: e.PADDLE_PRICE_MONTHLY!, year: e.PADDLE_PRICE_YEARLY! },
    });
  }
  return new DevBillingProvider();
}

@Module({
  controllers: [BillingController],
  providers: [BillingService, { provide: BILLING_PROVIDER, useFactory: createProvider }],
})
export class BillingModule {}
