import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { ActionForm } from '@/components/forms/action-form';
import { LanguageCookieSwitcher } from '@/components/language-cookie-switcher';
import { Alert, Card, CardBody, CardHeader, Field, Input, Select, Icon } from '@/components/ui';
import { LANGUAGE_NATIVE_NAME, LANGUAGES } from '@/i18n/config';
import { getDashText } from '@/i18n/dash';
import { getCurrentUser } from '@/server/auth/session';
import { changePasswordAction, deleteAccountAction, updateProfileAction } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const user = await getCurrentUser();
  return { title: getDashText(user?.preferredLanguage ?? 'en').account.metaTitle, robots: { index: false } };
}

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=/account');
  const d = getDashText(user.preferredLanguage);
  const t = d.account;
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageCookieSwitcher current={user.preferredLanguage} saveToAccount label={d.layout.language} />
          <Link href="/dashboard" className="inline-flex min-h-10 items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"><Icon name="arrowLeft" className="size-3.5 rtl:rotate-180" /> {t.dashboard}</Link>
        </div>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      <Card>
        <CardHeader title={t.profile} description={user.email} />
        <CardBody>
          <ActionForm action={updateProfileAction} testId="profile-form">
            <Field label={t.name} htmlFor="ac-name"><Input id="ac-name" name="name" defaultValue={user.name} maxLength={120} /></Field>
            <Field label={t.language} htmlFor="ac-lang" hint={t.languageHint}>
              <Select id="ac-lang" name="preferredLanguage" defaultValue={user.preferredLanguage}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{LANGUAGE_NATIVE_NAME[l]}</option>)}
              </Select>
            </Field>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t.password} description={t.passwordDesc} />
        <CardBody>
          <ActionForm action={changePasswordAction} submitLabel={t.changePassword} resetOnSuccess testId="password-form">
            <Field label={t.currentPassword} htmlFor="ac-cur"><Input id="ac-cur" name="current" type="password" autoComplete="current-password" /></Field>
            <Field label={t.newPassword} htmlFor="ac-new"><Input id="ac-new" name="next" type="password" autoComplete="new-password" minLength={10} /></Field>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t.data} description={t.dataDesc} />
        <CardBody>
          <a href="/api/account/export" className="inline-block rounded-xl px-4 py-2 text-sm font-medium ring-1 ring-line" data-testid="account-export">{t.download}</a>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t.deleteTitle} />
        <CardBody className="space-y-3">
          <Alert tone="warning">{t.deleteWarning}</Alert>
          <ActionForm action={deleteAccountAction} submitLabel={t.deleteButton} submitVariant="danger" testId="delete-account-form">
            <Field label={t.passwordField} htmlFor="ac-del-pw"><Input id="ac-del-pw" name="password" type="password" autoComplete="current-password" /></Field>
            <Field label={t.typeDelete} htmlFor="ac-del-confirm"><Input id="ac-del-confirm" name="confirm" autoComplete="off" /></Field>
          </ActionForm>
        </CardBody>
      </Card>
    </main>
  );
}
