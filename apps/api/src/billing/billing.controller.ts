import { Body, Controller, Get, HttpCode, Param, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { checkoutSchema, type BillingDto, type CheckoutInput } from '@electro/shared';
import { AllowReadOnly, Auth, Public, type AuthContext } from '../auth/auth-context.js';
import { ZodPipe } from '../common/zod-validation.pipe.js';
import { BillingService } from './billing.service.js';

const devCompleteSchema = z.object({ token: z.string().min(10).max(2000) });
const devSimulateSchema = z.object({ action: z.enum(['cancel', 'resume', 'payment_failed', 'payment_succeeded', 'end_now']) });

/** Billing stays reachable when the company is read-only, so it can always subscribe or renew. */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  get(@Auth() auth: AuthContext): Promise<BillingDto> {
    return this.billing.get(auth.organizationId);
  }

  @Post('checkout')
  @AllowReadOnly()
  @HttpCode(200)
  checkout(@Auth() auth: AuthContext, @Body(new ZodPipe(checkoutSchema)) body: CheckoutInput): Promise<{ url: string }> {
    return this.billing.checkout(auth, body.interval);
  }

  @Post('portal')
  @AllowReadOnly()
  @HttpCode(200)
  portal(@Auth() auth: AuthContext): Promise<{ url: string }> {
    return this.billing.portal(auth);
  }

  /** Called by the payment provider; authenticated by its signature over the raw body, not by a session. */
  @Post('webhooks/:provider')
  @Public()
  @HttpCode(200)
  async webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>): Promise<{ received: true; duplicate: boolean }> {
    const applied = await this.billing.handleWebhook(provider, req.rawBody, req.headers);
    return { received: true, duplicate: !applied };
  }

  @Post('dev/complete')
  @AllowReadOnly()
  @HttpCode(200)
  devComplete(@Auth() auth: AuthContext, @Body(new ZodPipe(devCompleteSchema)) body: z.infer<typeof devCompleteSchema>): Promise<BillingDto> {
    return this.billing.devCompleteCheckout(auth, body.token);
  }

  @Post('dev/simulate')
  @AllowReadOnly()
  @HttpCode(200)
  devSimulate(@Auth() auth: AuthContext, @Body(new ZodPipe(devSimulateSchema)) body: z.infer<typeof devSimulateSchema>): Promise<BillingDto> {
    return this.billing.devSimulate(auth, body.action);
  }
}
