import 'server-only';
import { z } from 'zod';
import { parseMoneyToCents } from '@/lib/money';
import { audit } from '../audit';
import { db } from '../db';
import { env } from '../env';
import { UserFacingError } from '../errors';

/**
 * SaaS billing (how restaurants pay MenuNiva). Today billing is MANUAL: the operator invoices
 * outside MenuNiva and records each genuine payment here. A processor (e.g. Stripe) can be added
 * behind this interface later; its webhooks must be signature-verified before anything changes.
 */
export type BillingWebhookEvent = { type: 'payment_succeeded' | 'payment_failed' | 'subscription_cancelled'; externalSubscriptionId: string; amountCents?: number };

export interface BillingProvider {
  readonly id: 'manual' | 'stripe';
  status(): { mode: 'MANUAL' | 'NEEDS_CONFIGURATION' | 'CONFIGURED'; note: string };
  /** Returns a verified event, or throws. Never trust an unsigned payload. */
  verifyWebhook(req: Request, rawBody: string): Promise<BillingWebhookEvent>;
}

class ManualBilling implements BillingProvider {
  readonly id = 'manual' as const;
  status() {
    return { mode: 'MANUAL' as const, note: 'Invoices are issued outside MenuNiva; Super Admin records genuine payments.' };
  }
  async verifyWebhook(): Promise<BillingWebhookEvent> {
    throw new UserFacingError('billing_provider_not_configured', 501);
  }
}

/** Placeholder until a processor account, keys and a webhook secret exist. Refuses all webhooks. */
class UnconfiguredProcessor implements BillingProvider {
  readonly id = 'stripe' as const;
  status() {
    return { mode: 'NEEDS_CONFIGURATION' as const, note: 'BILLING_PROVIDER=stripe is set, but no processor integration is implemented or verified yet.' };
  }
  async verifyWebhook(): Promise<BillingWebhookEvent> {
    throw new UserFacingError('billing_provider_not_configured', 501);
  }
}

export function getBillingProvider(): BillingProvider {
  return env.BILLING_PROVIDER === 'stripe' ? new UnconfiguredProcessor() : new ManualBilling();
}

const manualRecordSchema = z
  .object({
    organizationId: z.string().min(1),
    amount: z.string().trim().min(1).max(20),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(300).optional(),
  })
  .refine((d) => d.periodEnd >= d.periodStart, { path: ['periodEnd'], message: 'End must be after start' });

/** Records a payment the operator really received (bank transfer etc.). */
export async function recordManualBilling(adminId: string, input: unknown) {
  const d = manualRecordSchema.parse(input);
  const cents = parseMoneyToCents(d.amount);
  if (cents === null || cents <= 0) throw new UserFacingError('Enter the amount received, e.g. 49,00.');
  const sub = await db.subscription.findUnique({ where: { organizationId: d.organizationId } });
  if (!sub) throw new UserFacingError('This tenant has no subscription.');
  const rec = await db.billingRecord.create({
    data: { subscriptionId: sub.id, amountCents: cents, periodStart: new Date(`${d.periodStart}T00:00:00Z`), periodEnd: new Date(`${d.periodEnd}T23:59:59Z`), status: 'RECORDED_MANUALLY', note: d.note || null, createdById: adminId },
  });
  await audit({ organizationId: d.organizationId, actorUserId: adminId, action: 'platform.billing_recorded', entityType: 'BillingRecord', entityId: rec.id, metadata: { amountCents: cents } });
  return rec;
}

export async function voidBillingRecord(adminId: string, recordId: string, reason: string) {
  if (reason.trim().length < 3) throw new UserFacingError('Give a reason for voiding this record.');
  const rec = await db.billingRecord.findUnique({ where: { id: recordId }, include: { subscription: true } });
  if (!rec || rec.status === 'VOIDED') throw new UserFacingError('Billing record not found.');
  await db.billingRecord.update({ where: { id: rec.id }, data: { status: 'VOIDED', note: `${rec.note ? `${rec.note} · ` : ''}Voided: ${reason.trim()}` } });
  await audit({ organizationId: rec.subscription.organizationId, actorUserId: adminId, action: 'platform.billing_voided', entityType: 'BillingRecord', entityId: rec.id, metadata: { reason } });
}
