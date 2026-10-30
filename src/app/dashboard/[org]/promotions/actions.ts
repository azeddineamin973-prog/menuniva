'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { savePromotion } from '@/server/services/promotions';

export async function savePromotionAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'promotions.manage',
    (ctx) =>
      savePromotion(ctx, {
        id: form.get('id') || undefined,
        name: form.get('name'),
        type: form.get('type'),
        percent: form.get('percent'),
        amount: form.get('amount'),
        buyQuantity: form.get('buyQuantity'),
        getQuantity: form.get('getQuantity'),
        comboPrice: form.get('comboPrice'),
        productIds: form.getAll('productIds').map(String),
        categoryIds: form.getAll('categoryIds').map(String),
        channels: form.getAll('channels').map(String),
        minOrder: form.get('minOrder'),
        usageLimit: form.get('usageLimit'),
        priority: form.get('priority') || 0,
        combinable: form.get('combinable') === 'on',
        couponCode: String(form.get('couponCode') ?? ''),
        couponLimit: form.get('couponLimit'),
        startsAt: form.get('startsAt'),
        endsAt: form.get('endsAt'),
        isActive: form.get('isActive') === 'on',
      }),
    { revalidate: '/dashboard/[org]' },
  );
}
