import { ActionForm } from '@/components/forms/action-form';
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Textarea } from '@/components/ui';
import { getMessages } from '@/i18n';
import { getPlatformConfig } from '@/server/services/platform-config';
import { mySupportRequests } from '@/server/services/support';
import { requireTenantPage } from '@/server/tenant';
import { supportRequestAction } from './actions';

const TONE: Record<string, 'warning' | 'info' | 'neutral'> = { OPEN: 'warning', IN_PROGRESS: 'info', CLOSED: 'neutral' };

export default async function SupportPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const m = getMessages(ctx.user.preferredLanguage);
  const [tickets, config] = await Promise.all([mySupportRequests(ctx), getPlatformConfig()]);
  return (
    <>
      <PageHeader title={m.nav.support} description="Ask the MenuNiva team for help. Do not include guests' personal data or passwords." />
      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader title="Your requests" />
          {tickets.length === 0 ? (
            <CardBody><EmptyState title="No requests yet" /></CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {tickets.map((t) => (
                <li key={t.id} className="space-y-1 px-5 py-3" data-testid="support-request">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.subject}</span>
                    <Badge tone={TONE[t.status] ?? 'neutral'}>{t.status.toLowerCase().replace('_', ' ')}</Badge>
                    <span className="ms-auto text-xs text-muted">{t.createdAt.toLocaleDateString('pt-PT')}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap text-muted">{t.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="New request" description={config.supportEmail ? `You can also write to ${config.supportEmail}.` : undefined} />
          <CardBody>
            <ActionForm action={supportRequestAction} submitLabel="Send request" successText="Sent" resetOnSuccess testId="support-form">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <Field label="Subject" htmlFor="sp-subject"><Input id="sp-subject" name="subject" maxLength={120} required /></Field>
              <Field label="What do you need?" htmlFor="sp-body"><Textarea id="sp-body" name="body" rows={6} maxLength={4000} required /></Field>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
