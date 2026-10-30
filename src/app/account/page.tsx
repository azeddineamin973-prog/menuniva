import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { ActionForm } from '@/components/forms/action-form';
import { Alert, Card, CardBody, CardHeader, Field, Input, Select } from '@/components/ui';
import { LANGUAGE_NATIVE_NAME, LANGUAGES } from '@/i18n/config';
import { getCurrentUser } from '@/server/auth/session';
import { changePasswordAction, deleteAccountAction, updateProfileAction } from './actions';

export const metadata: Metadata = { title: 'My account', robots: { index: false } };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/account');
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <Logo />
        <Link href="/dashboard" className="text-sm underline">← Dashboard</Link>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">My account</h1>
      <Card>
        <CardHeader title="Profile" description={user.email} />
        <CardBody>
          <ActionForm action={updateProfileAction} testId="profile-form">
            <Field label="Name" htmlFor="ac-name"><Input id="ac-name" name="name" defaultValue={user.name} maxLength={120} /></Field>
            <Field label="Dashboard language" htmlFor="ac-lang">
              <Select id="ac-lang" name="preferredLanguage" defaultValue={user.preferredLanguage}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{LANGUAGE_NATIVE_NAME[l]}</option>)}
              </Select>
            </Field>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Password" description="Changing it signs you out on every other device." />
        <CardBody>
          <ActionForm action={changePasswordAction} submitLabel="Change password" resetOnSuccess testId="password-form">
            <Field label="Current password" htmlFor="ac-cur"><Input id="ac-cur" name="current" type="password" autoComplete="current-password" /></Field>
            <Field label="New password (10+ characters)" htmlFor="ac-new"><Input id="ac-new" name="next" type="password" autoComplete="new-password" minLength={10} /></Field>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Your data" description="Download what MenuNiva stores about your account: profile, restaurants and roles, sign-in sessions, your actions, support requests." />
        <CardBody>
          <a href="/api/account/export" className="inline-block rounded-xl px-4 py-2 text-sm font-medium ring-1 ring-line" data-testid="account-export">Download my data (JSON)</a>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Delete account" />
        <CardBody className="space-y-3">
          <Alert tone="warning">Your name and email are erased and you lose access to every restaurant. Restaurant data (menus, orders) stays with the restaurant. If you are the only owner of a restaurant, invite another owner first.</Alert>
          <ActionForm action={deleteAccountAction} submitLabel="Delete my account" submitVariant="danger" testId="delete-account-form">
            <Field label="Password" htmlFor="ac-del-pw"><Input id="ac-del-pw" name="password" type="password" autoComplete="current-password" /></Field>
            <Field label="Type DELETE to confirm" htmlFor="ac-del-confirm"><Input id="ac-del-confirm" name="confirm" autoComplete="off" /></Field>
          </ActionForm>
        </CardBody>
      </Card>
    </main>
  );
}
