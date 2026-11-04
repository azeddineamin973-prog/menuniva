import { ActionForm, FieldError } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Alert, Card, CardBody, CardHeader, Input, PageHeader } from '@/components/ui';
import { ATTENTION_KINDS, DEFAULT_THRESHOLDS, KIND_INFO, MAX_THRESHOLD_MINUTES } from '@/lib/attention';
import { currentLocation } from '@/server/current-location';
import { getAttentionThresholds } from '@/server/services/attention';
import { requireTenantPage } from '@/server/tenant';
import { resetAttentionSettingsAction, saveAttentionSettingsAction } from '../actions';
import { SettingsTabs } from '../tabs';

/**
 * Settings → Alerts & timings (audit OPS-01, D4): per location, after how many minutes unfinished
 * work is shown as late, and when it becomes urgent and is escalated to the owner and managers.
 */
export default async function AlertSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'settings.manage');
  const location = await currentLocation(ctx);
  const base = `/dashboard/${ctx.org.slug}`;
  if (!location) return <Alert tone="warning">No location found.</Alert>;
  const { thresholds, custom } = await getAttentionThresholds(ctx, location.id);
  return (
    <>
      <PageHeader title="Alerts & timings" description={`When unfinished work is shown as late, and when it is escalated, at ${location.name}.`} />
      <SettingsTabs base={base} active="alerts" />
      <Card className="mb-4">
        <CardBody className="space-y-2 text-sm text-ink-2">
          <p>
            Every dashboard page shows a <strong className="text-ink">Needs attention</strong> bar with the work that is still open. Each item goes to the people who do that work: reception (waiters) for new orders, pickups, table and booking requests; Kitchen
            and Café staff for their station&rsquo;s tickets; drivers for deliveries waiting for a driver.
          </p>
          <p>
            An item turns <strong className="text-warning">late</strong> after the first time below and <strong className="text-danger">urgent</strong> after the second. Owners and managers only see urgent items, unless nobody with that job works at
            this location. Nothing is ever resolved by these settings: an item disappears only when the order, ticket, request or booking is done.
          </p>
        </CardBody>
      </Card>
      <ActionForm action={saveAttentionSettingsAction} testId="attention-settings-form" submitLabel="Save timings">
        <input type="hidden" name="org" value={ctx.org.slug} />
        <input type="hidden" name="locationId" value={location.id} />
        <Card>
          <CardHeader title="Timings in minutes" description={custom ? 'Your own timings for this location.' : 'The recommended timings are in use. Change any of them and save.'} />
          <CardBody className="divide-y divide-line p-0">
            {ATTENTION_KINDS.map((k) => (
              <div key={k} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_8rem_8rem] sm:items-start sm:px-5" data-testid={`attention-setting-${k}`}>
                <div className="min-w-0">
                  <p className="font-medium text-ink">{KIND_INFO[k].title}</p>
                  <p className="mt-0.5 text-[13px] text-muted">{KIND_INFO[k].from}</p>
                  <p className="mt-1 text-xs text-muted">
                    Recommended: late after {DEFAULT_THRESHOLDS[k].warn} min, urgent after {DEFAULT_THRESHOLDS[k].urgent} min.
                  </p>
                </div>
                <label className="block text-xs font-medium text-ink-2">
                  Late after
                  <Input name={`${k}.warn`} type="number" inputMode="numeric" min={1} max={MAX_THRESHOLD_MINUTES} step={1} required defaultValue={thresholds[k].warn} className="mt-1" aria-label={`${KIND_INFO[k].title}: late after (minutes)`} />
                  <FieldError name={`${k}.warn`} />
                </label>
                <label className="block text-xs font-medium text-ink-2">
                  Urgent after
                  <Input name={`${k}.urgent`} type="number" inputMode="numeric" min={2} max={MAX_THRESHOLD_MINUTES} step={1} required defaultValue={thresholds[k].urgent} className="mt-1" aria-label={`${KIND_INFO[k].title}: urgent after (minutes)`} />
                  <FieldError name={`${k}.urgent`} />
                </label>
              </div>
            ))}
          </CardBody>
        </Card>
      </ActionForm>
      {custom && (
        <div className="mt-4">
          <InlineAction
            action={resetAttentionSettingsAction}
            fields={{ org: ctx.org.slug, locationId: location.id }}
            label="Use the recommended timings"
            confirm="Replace this location's timings with the recommended ones?"
            testId="attention-reset"
          />
        </div>
      )}
    </>
  );
}
