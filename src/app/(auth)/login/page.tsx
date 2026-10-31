import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getMessages } from '@/i18n';
import { safeNextPath } from '@/lib/action-result';
import { getCurrentUser } from '@/server/auth/session';
import { getRequestLang } from '@/server/request-lang';
import { LoginForm } from '../auth-forms';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(safeNextPath(next));
  const m = getMessages(await getRequestLang());
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{m.auth.signIn}</h1>
      <LoginForm m={m} next={next ? safeNextPath(next) : undefined} />
    </>
  );
}
