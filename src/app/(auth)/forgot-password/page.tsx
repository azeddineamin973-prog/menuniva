import type { Metadata } from 'next';
import { getMessages } from '@/i18n';
import { getRequestLang } from '@/server/request-lang';
import { ForgotPasswordForm } from '../auth-forms';

export const metadata: Metadata = { title: 'Reset password', robots: { index: false } };

export default async function ForgotPasswordPage() {
  const m = getMessages(await getRequestLang());
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{m.auth.resetTitle}</h1>
      <ForgotPasswordForm m={m} />
      <p className="mt-6 text-xs text-muted">
        Email delivery requires SMTP configuration. Until it is configured, ask your restaurant owner or the MenuNiva
        administrator to generate a reset link for you.
      </p>
    </>
  );
}
