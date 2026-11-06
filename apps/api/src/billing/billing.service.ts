import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { billingSummary, type BillingDto, type BillingInterval } from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { Prisma } from '../generated/prisma/client.js';
import { billingStateOf } from './billing-state.js';
import { DevBillingProvider, type DevAction } from './dev-provider.js';
import { BILLING_PROVIDER, WebhookError, type BillingProvider, type ProviderEvent } from './provider.js';

/** Subscription state of each company, kept in sync with the payment provider through signed webhooks. */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
  ) {}

  async get(organizationId: string): Promise<BillingDto> {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { _count: { select: { members: true } } },
    });
    const state = billingStateOf(org);
    return {
      ...billingSummary(state),
      interval: state.interval,
      seats: state.seats,
      members: org._count.members,
      pastDueSince: state.pastDueSince,
      provider: this.provider.name,
      hasSubscription: !!org.providerSubscriptionId && !!org.providerCustomerId,
    };
  }

  /** Hosted checkout for the whole company: one seat per user. */
  async checkout(auth: AuthContext, interval: BillingInterval): Promise<{ url: string }> {
    this.assertManager(auth);
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: auth.organizationId },
      include: { _count: { select: { members: true } } },
    });
    const status = billingSummary(billingStateOf(org)).status;
    if (org.providerSubscriptionId && (status === 'active' || status === 'past_due' || status === 'canceled')) {
      throw new BadRequestException('This company already has a subscription. Use “Manage billing” to change or renew it.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { email: true } });
    const url = await this.provider.checkoutUrl({
      organizationId: org.id,
      email: user.email,
      interval,
      seats: Math.max(1, org._count.members),
      customerId: org.billingProvider === this.provider.name ? org.providerCustomerId : null,
    });
    return { url };
  }

  async portal(auth: AuthContext): Promise<{ url: string }> {
    this.assertManager(auth);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } });
    if (!org.providerCustomerId) throw new BadRequestException('There is no subscription to manage yet. Subscribe first.');
    return { url: await this.provider.portalUrl(org.providerCustomerId, org.providerSubscriptionId) };
  }

  /**
   * Verifies and applies a webhook. Each event id is stored first, so a retried delivery is applied only once.
   * Returns false for duplicates.
   */
  async handleWebhook(providerName: string, rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>): Promise<boolean> {
    if (providerName !== this.provider.name) throw new NotFoundException('Unknown billing provider.');
    if (!rawBody?.length) throw new BadRequestException('Empty webhook.');
    let event: ProviderEvent;
    try {
      event = this.provider.parseWebhook(rawBody, headers);
    } catch (err) {
      if (err instanceof WebhookError || err instanceof SyntaxError) throw new BadRequestException(`Webhook rejected: ${err.message}`);
      throw err;
    }
    const orgId = event.subscription ? await this.findOrganization(event) : null;
    try {
      await this.prisma.billingEvent.create({
        data: {
          provider: this.provider.name,
          eventId: event.id,
          type: event.type,
          organizationId: orgId,
          payload: event.raw as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false; // already applied
      throw err;
    }
    if (!event.subscription) return true;
    if (!orgId) {
      this.logger.warn(`Billing event ${event.id} (${event.type}) matches no company; stored but not applied.`);
      return true;
    }
    const s = event.subscription;
    const current = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { pastDueSince: true } });
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        subscriptionStatus: s.status,
        billingInterval: s.interval,
        seats: s.seats,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        pastDueSince: s.status === 'past_due' ? (current.pastDueSince ?? event.occurredAt) : null,
        billingProvider: this.provider.name,
        providerCustomerId: s.customerId,
        providerSubscriptionId: s.id,
      },
    });
    return true;
  }

  // ── development provider only ──

  /** Completes a simulated checkout through the normal webhook path. */
  async devCompleteCheckout(auth: AuthContext, token: string): Promise<BillingDto> {
    const dev = this.devProvider();
    this.assertManager(auth);
    let delivery: { body: Buffer; headers: Record<string, string> };
    try {
      delivery = dev.checkoutCompletedEvent(token);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const target = JSON.parse(delivery.body.toString('utf8')) as { subscription: { organizationId: string } };
    if (target.subscription.organizationId !== auth.organizationId) throw new ForbiddenException('This test checkout belongs to another company.');
    await this.handleWebhook('dev', delivery.body, delivery.headers);
    return this.get(auth.organizationId);
  }

  /** Simulates a customer-portal action or a payment result for the current subscription. */
  async devSimulate(auth: AuthContext, action: DevAction): Promise<BillingDto> {
    const dev = this.devProvider();
    this.assertManager(auth);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: auth.organizationId } });
    if (!org.providerSubscriptionId) throw new BadRequestException('Subscribe first (test checkout).');
    const state = billingStateOf(org);
    const delivery = dev.actionEvent(action, {
      id: org.providerSubscriptionId,
      customerId: org.providerCustomerId,
      organizationId: org.id,
      status: state.status,
      interval: state.interval,
      seats: state.seats,
      currentPeriodEnd: org.currentPeriodEnd,
      cancelAtPeriodEnd: org.cancelAtPeriodEnd,
    });
    await this.handleWebhook('dev', delivery.body, delivery.headers);
    return this.get(auth.organizationId);
  }

  // ── helpers ──

  private devProvider(): DevBillingProvider {
    if (!(this.provider instanceof DevBillingProvider)) throw new NotFoundException('Not available.');
    return this.provider;
  }

  /** The company an event belongs to: our id echoed by the provider, else the stored subscription or customer id. */
  private async findOrganization(event: ProviderEvent): Promise<string | null> {
    const s = event.subscription!;
    if (s.organizationId && /^[0-9a-f-]{36}$/i.test(s.organizationId)) {
      const org = await this.prisma.organization.findUnique({ where: { id: s.organizationId }, select: { id: true } });
      if (org) return org.id;
    }
    const bySub = await this.prisma.organization.findUnique({ where: { providerSubscriptionId: s.id }, select: { id: true } });
    if (bySub) return bySub.id;
    if (s.customerId) {
      const byCustomer = await this.prisma.organization.findFirst({ where: { providerCustomerId: s.customerId }, select: { id: true } });
      if (byCustomer) return byCustomer.id;
    }
    return null;
  }

  private assertManager(auth: AuthContext): void {
    if (auth.role === 'MEMBER') throw new ForbiddenException('Only the owner or an admin can manage billing.');
  }
}
