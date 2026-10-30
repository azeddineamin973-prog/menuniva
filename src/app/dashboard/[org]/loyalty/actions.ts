'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { deleteLoyaltyAccount, redeemReward, setMarketingOptIn, updateLoyaltyProgram } from '@/server/services/loyalty';

const R = { revalidate: '/dashboard/[org]' };

export async function saveLoyaltyProgramAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'loyalty.manage',
    (ctx) =>
      updateLoyaltyProgram(ctx, {
        enabled: form.get('enabled') === 'on',
        type: form.get('type'),
        stampsForReward: form.get('stampsForReward'),
        pointsPerEuro: form.get('pointsPerEuro') || 1,
        rewardText: form.get('rewardText') || undefined,
        expiryDays: form.get('expiryDays'),
      }),
    R,
  );
}

export async function redeemAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'loyalty.manage', (ctx) => redeemReward(ctx, String(form.get('accountId'))), R);
}

export async function deleteMemberAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'loyalty.manage', (ctx) => deleteLoyaltyAccount(ctx, String(form.get('accountId'))), R);
}

export async function withdrawMarketingAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'loyalty.manage', (ctx) => setMarketingOptIn(ctx, String(form.get('accountId')), false), R);
}
