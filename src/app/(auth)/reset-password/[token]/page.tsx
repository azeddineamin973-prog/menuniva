import type { Metadata } from 'next';
import { getMessages } from '@/i18n';
import { getRequestLang } from '@/server/request-lang';
import { ResetPasswordForm } from '../../auth-forms';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false } };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const m = getMessages(await getRequestLang());
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{m.auth.resetTitle}</h1>
      <ResetPasswordForm m={m} token={token} />
    </>
  );
}
