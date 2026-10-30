'use server';

import type { ActionResult } from '@/lib/action-result';
import { runTenantAction } from '@/server/action';
import { addFeedbackNote, setFeedbackStatus, updateReviewSettings } from '@/server/services/feedback';

const R = { revalidate: '/dashboard/[org]' };

export async function feedbackStatusAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'reviews.manage', (ctx) => setFeedbackStatus(ctx, String(form.get('feedbackId')), String(form.get('status'))), R);
}

export async function feedbackNoteAction(_p: ActionResult, form: FormData) {
  return runTenantAction(form.get('org'), 'reviews.manage', (ctx) => addFeedbackNote(ctx, String(form.get('feedbackId')), String(form.get('body') ?? '')), R);
}

export async function reviewSettingsAction(_p: ActionResult, form: FormData) {
  return runTenantAction(
    form.get('org'),
    'reviews.manage',
    (ctx) => updateReviewSettings(ctx, String(form.get('locationId')), { lowRatingThreshold: Number(form.get('lowRatingThreshold')), feedbackEnabled: form.get('feedbackEnabled') === 'on' }),
    R,
  );
}
