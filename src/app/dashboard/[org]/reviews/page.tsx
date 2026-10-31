import Link from 'next/link';
import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Alert, Badge, Card, CardBody, CardHeader, ChipRow, Checkbox, Disclosure, EmptyState, Field, FilterChip, Icon, PageHeader, Select, Stat, Textarea, humanize, statGrid } from '@/components/ui';
import { getMessages } from '@/i18n';
import { formatTimeInZone } from '@/lib/time';
import { currentLocation } from '@/server/current-location';
import { db } from '@/server/db';
import { feedbackInbox, feedbackStats } from '@/server/services/feedback';
import { requireModulePage } from '@/server/module-page';
import { requireTenantPage } from '@/server/tenant';
import { feedbackNoteAction, feedbackStatusAction, reviewSettingsAction } from './actions';

const STATUSES = ['NEW', 'INVESTIGATING', 'RESOLVED', 'ARCHIVED'] as const;
const TONE: Record<string, 'warning' | 'info' | 'success' | 'neutral'> = { NEW: 'warning', INVESTIGATING: 'info', RESOLVED: 'success', ARCHIVED: 'neutral' };

export default async function ReviewsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ status?: string; max?: string }> }) {
  const { org } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(org, 'reviews.view');
  await requireModulePage(ctx, 'feedback');
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">No location.</Alert>;
  const m = getMessages(ctx.user.preferredLanguage);
  const status = STATUSES.includes(sp.status as never) ? sp.status : undefined;
  const maxRating = sp.max && /^[1-4]$/.test(sp.max) ? Number(sp.max) : undefined;
  const [items, stats, review, unread] = await Promise.all([
    feedbackInbox(ctx, { status, maxRating, locationId: location.id }),
    feedbackStats(ctx, 30, location.id),
    db.reviewSettings.findUnique({ where: { locationId: location.id } }),
    db.notification.count({ where: { organizationId: ctx.org.id, locationId: location.id, type: 'LOW_RATING', readAt: null } }),
  ]);
  const settings = await db.restaurantSettings.findUnique({ where: { organizationId: ctx.org.id } });
  const manage = ctx.can('reviews.manage');
  const base = `/dashboard/${ctx.org.slug}/reviews`;
  const q = (s?: string, mx?: number) => {
    const p = new URLSearchParams();
    if (s) p.set('status', s);
    if (mx) p.set('max', String(mx));
    const str = p.toString();
    return str ? `${base}?${str}` : base;
  };
  const max = Math.max(1, ...stats.distribution);
  return (
    <>
      <PageHeader
        title={m.nav.reviews}
        description="Private guest feedback. Nothing here is published. Every guest sees the same Google review link, whatever their rating."
      />
      {unread > 0 && (
        <div className="mb-4" data-testid="low-rating-alert">
          <Alert tone="danger" title={`${unread} low-rating ${unread === 1 ? 'alert' : 'alerts'} need attention`}>
            Open the feedback below and set it to “Investigating” or “Resolved” to clear the alert.
          </Alert>
        </div>
      )}
      {!review?.googleReviewUrl && (
        <div className="mb-4">
          <Alert tone="info" action={<Link className="inline-flex min-h-10 items-center text-sm font-medium whitespace-nowrap underline underline-offset-2" href={`/dashboard/${ctx.org.slug}/settings/channels`}>Add link</Link>}>
            No official Google review link is set for {location.name}. Until then guests only see the private feedback form.
          </Alert>
        </div>
      )}
      <div className={statGrid(4, 'mb-6')}>
        <Stat icon="star" label="Average (30 days)" value={<span data-testid="stat-average">{stats.average ?? '—'}</span>} hint={`${stats.count} responses`} />
        <Stat icon="inbox" tone={stats.open ? 'warning' : undefined} label="Open" value={<span data-testid="stat-open">{stats.open}</span>} hint="New or investigating" />
        <Stat icon="checkCircle" label="Low ratings resolved" value={`${stats.lowResolved} / ${stats.lowTotal}`} hint="Ratings of 3★ or less" />
        <Card aria-label="Rating distribution">
          <CardBody className="space-y-1.5">
            {[5, 4, 3, 2, 1].map((r) => (
              <div key={r} className="flex items-center gap-2 text-xs">
                <span className="flex w-7 items-center gap-0.5 tabular-nums text-muted">{r}<Icon name="star" className="size-3" /></span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full bg-lime" style={{ width: `${(stats.distribution[r - 1] / max) * 100}%` }} />
                </span>
                <span className="w-6 text-end tabular-nums">{stats.distribution[r - 1]}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Feedback inbox" icon="inbox" description={`${items.length} shown`} />
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <ChipRow label="Filter feedback">
              <FilterChip href={q(undefined, maxRating)} active={!status}>Active</FilterChip>
              {STATUSES.map((s) => (
                <FilterChip key={s} href={q(s, maxRating)} active={status === s}>{humanize(s)}</FilterChip>
              ))}
              <FilterChip href={q(status, maxRating ? undefined : 3)} active={!!maxRating} data-testid="filter-low">Only 3★ or less</FilterChip>
            </ChipRow>
          </div>
          {items.length === 0 ? (
            <CardBody><EmptyState icon="star" title="No feedback here yet" description="Guests can leave feedback from their order page or the feedback link." /></CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((f) => (
                <li key={f.id} className="space-y-2.5 px-4 py-4 sm:px-5" data-testid="feedback-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-px" role="img" aria-label={`${f.rating} out of 5`} data-testid="feedback-rating">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Icon key={n} name="star" className={n <= f.rating ? 'size-4 fill-current text-warning' : 'size-4 text-line-strong'} />
                      ))}
                    </span>
                    <Badge tone={TONE[f.status]} dot data-testid="feedback-status">{humanize(f.status)}</Badge>
                    {f.order && <Badge tone="neutral">Order #{f.order.number} · {humanize(f.order.channel)}</Badge>}
                    <span className="ms-auto text-xs text-muted">{f.createdAt.toLocaleDateString('pt-PT')} {formatTimeInZone(f.createdAt, location.timeZone)} · {f.language.toUpperCase()}</span>
                  </div>
                  {f.categories.length > 0 && (
                    <div className="flex flex-wrap gap-1">{f.categories.map((c) => <Badge key={c} tone="dark">{m.feedback.categories[c]}</Badge>)}</div>
                  )}
                  {f.comment && <p className="text-sm whitespace-pre-wrap text-ink break-words">“{f.comment}”</p>}
                  {f.wantsFollowUp && (
                    <p className="flex items-start gap-1.5 text-sm text-warning" data-testid="feedback-contact"><Icon name="phone" className="mt-0.5 size-3.5 shrink-0" />Asks to be contacted: {f.contactName ? `${f.contactName} · ` : ''}{f.contactInfo}</p>
                  )}
                  {f.notes.length > 0 && (
                    <ul className="space-y-1 rounded-lg border border-line bg-surface-2/60 p-3 text-sm">
                      {f.notes.map((n) => <li key={n.id} data-testid="feedback-note"><span className="text-xs text-muted">{n.createdAt.toLocaleDateString('pt-PT')} · </span>{n.body}</li>)}
                    </ul>
                  )}
                  {manage && (
                    <div className="flex flex-wrap items-start gap-2">
                      {STATUSES.filter((s) => s !== f.status).map((s) => (
                        <InlineAction key={s} action={feedbackStatusAction} fields={{ org: ctx.org.slug, feedbackId: f.id, status: s }} label={s === 'NEW' ? 'Reopen' : s.charAt(0) + s.slice(1).toLowerCase()} variant={s === 'RESOLVED' ? 'primary' : 'secondary'} testId={`fb-${s}`} />
                      ))}
                      <ActionForm action={feedbackNoteAction} submitLabel="Add note" submitVariant="secondary" resetOnSuccess className="flex w-full items-start gap-2 space-y-0">
                        <input type="hidden" name="org" value={ctx.org.slug} />
                        <input type="hidden" name="feedbackId" value={f.id} />
                        <Textarea name="body" rows={1} placeholder="Internal note (never shown to the guest)" className="min-h-9 flex-1" aria-label="Internal note" data-testid="feedback-note-input" />
                      </ActionForm>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader icon="alert" title="Repeated issues" description="Categories chosen in ratings of 3★ or less, last 30 days." />
            <CardBody>
              {stats.issues.length === 0 ? (
                <p className="text-sm text-muted">No repeated issues.</p>
              ) : (
                <ul className="space-y-1 text-sm" data-testid="issues">
                  {stats.issues.map(([c, n]) => (
                    <li key={c} className="flex justify-between"><span>{m.feedback.categories[c as keyof typeof m.feedback.categories]}</span><span className="tabular-nums">{n}</span></li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {manage && (
            <Disclosure icon="settings" title="Feedback settings" description="Guest form and low-rating alerts">
                <ActionForm action={reviewSettingsAction} testId="review-settings-form">
                  <input type="hidden" name="org" value={ctx.org.slug} />
                  <input type="hidden" name="locationId" value={location.id} />
                  <Checkbox name="feedbackEnabled" label="Accept guest feedback" defaultChecked={settings?.feedbackEnabled ?? true} />
                  <Field label="Alert managers for ratings up to" htmlFor="rv-threshold" hint="Alerts are internal. They never change what the guest sees.">
                    <Select id="rv-threshold" name="lowRatingThreshold" defaultValue={String(review?.lowRatingThreshold ?? 3)}>
                      {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}★</option>)}
                    </Select>
                  </Field>
                  <p className="text-xs break-all text-muted">Guest feedback link: <code>/r/{ctx.org.slug}/feedback?l={location.slug}</code></p>
                </ActionForm>
            </Disclosure>
          )}
        </div>
      </div>
    </>
  );
}
