import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getMessages } from '@/i18n';
import { safeNextPath } from '@/lib/action-result';
import { getCurrentUser } from '@/server/auth/session';
import { getRequestLang } from '@/server/request-lang';
import { SignupForm } from '../auth-forms';

export const metadata: Metadata = { title: 'Create account', robots: { index: false } };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(safeNextPath(next, '/dashboard'));
  const m = getMessages(await getRequestLang());
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">{m.auth.signUp}</h1>
      <p className="mb-8 text-sm text-muted">{m.auth.noAccount}</p>
      <SignupForm m={m} next={next ? safeNextPath(next) : undefined} />
    </>
  );
}
