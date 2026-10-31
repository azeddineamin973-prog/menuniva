import Link from 'next/link';
import { Alert, Button, buttonClass, Card, CardBody, CardHeader, EmptyState, Input, PageHeader, Stat, statGrid } from '@/components/ui';
import { getMessages } from '@/i18n';
import { formatCents } from '@/lib/money';
import { cn } from '@/lib/cn';
import { currentLocation } from '@/server/current-location';
import { hasModule } from '@/server/modules';
import { resolveRange, restaurantAnalytics } from '@/server/services/analytics';
import { requireTenantPage } from '@/server/tenant';

const CHANNEL: Record<string, string> = { TABLE: 'Table (QR)', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery', WHATSAPP: 'WhatsApp' };
const PRESETS = [
  ['today', 'Today'],
  ['7d', '7 days'],
  ['30d', '30 days'],
] as const;

function Bars({ rows, label }: { rows: { key: string; label: string; value: number; hint: string }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0 tabular-nums text-muted">{r.label}</span>
          <span className="h-2.5 flex-1 rounded bg-surface-2"><span className="block h-2.5 rounded bg-lime" style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="w-24 shrink-0 text-end tabular-nums">{r.hint}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function AnalyticsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ p?: string; from?: string; to?: string }> }) {
  const { org } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(org, 'analytics.view');
  const location = await currentLocation(ctx);
  if (!location) return <Alert tone="warning">No location.</Alert>;
  const m = getMessages(ctx.user.preferredLanguage);
  let range;
  try {
    range = resolveRange(location.timeZone, sp.p, sp.from, sp.to);
  } catch {
    range = resolveRange(location.timeZone, 'today');
  }
  const [a, canExport] = await Promise.all([restaurantAnalytics(ctx, location.id, range), hasModule(ctx.org.id, 'analytics_export')]);
  const base = `/dashboard/${ctx.org.slug}/analytics`;
  const money = (c: number) => formatCents(c);
  const q = `p=${range.preset}${range.preset === 'custom' ? `&from=${range.from}&to=${range.to}` : ''}`;
  return (
    <>
      <PageHeader
        title={m.nav.analytics}
        description={`${location.name} · ${range.from === range.to ? range.from : `${range.from} → ${range.to}`} · times in ${a.timeZone}. Every figure comes from recorded orders and payments.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map(([k, label]) => (
              <Link key={k} href={`${base}?p=${k}`} aria-current={range.preset === k ? 'page' : undefined} className={cn('inline-flex h-9 items-center rounded-full px-3.5 text-sm font-medium ring-1 ring-line pointer-coarse:h-10', range.preset === k ? 'bg-graphite text-white dark:bg-lime dark:text-graphite' : 'hover:bg-surface-2')} data-testid={`range-${k}`}>{label}</Link>
            ))}
            <form className="flex flex-wrap items-center gap-1.5" data-testid="range-custom">
              <input type="hidden" name="p" value="custom" />
              <Input type="date" name="from" defaultValue={range.from} className="w-38!" aria-label="From" />
              <Input type="date" name="to" defaultValue={range.to} className="w-38!" aria-label="To" />
              <Button type="submit" variant="secondary" size="sm">Apply</Button>
            </form>
            {canExport ? (
              <a href={`/api/dashboard/${ctx.org.slug}/analytics/export?${q}`} className={buttonClass('primary', 'sm')} data-testid="export-csv">Export CSV</a>
            ) : (
              <span className="text-xs text-muted" title="Not included in your plan">CSV export not in plan</span>
            )}
          </div>
        }
      />
      <div className="mb-4">
        <Alert tone="info">Order value is what orders were worth. Collected is money actually recorded as paid. They are different numbers on purpose.</Alert>
      </div>
      <div className={statGrid(4, 'mb-6')}>
        <Stat label="Order value" value={<span data-testid="m-order-value">{money(a.money.orderValueCents)}</span>} hint={`${a.orders.total - a.orders.cancelled} orders, cancelled excluded`} />
        <Stat label="Collected payments" value={<span data-testid="m-collected">{money(a.money.collectedCents)}</span>} hint="Recorded in this period, voided excluded" />
        <Stat label="Unpaid" value={<span data-testid="m-unpaid">{money(a.money.unpaidCents)}</span>} hint={`${money(a.money.unpaidFinishedCents)} on finished orders`} />
        <Stat label="Cancelled value" value={<span data-testid="m-cancelled">{money(a.money.cancelledValueCents)}</span>} hint={`${a.orders.cancelled} cancelled orders`} />
        <Stat label="Average order" value={a.orders.averageCents === null ? '—' : money(a.orders.averageCents)} />
        <Stat label="Discounts given" value={money(a.money.discountCents)} />
        <Stat label="Delivery fees" value={money(a.money.deliveryFeesCents)} />
        <Stat label="Completed orders" value={a.orders.completed} />
      </div>
      {a.orders.total === 0 ? (
        <EmptyState title="No orders in this period" description="Pick another period, or come back once guests have ordered." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Channels" />
            <CardBody>
              <Bars label="Orders by channel" rows={Object.entries(a.orders.byChannel).map(([k, b]) => ({ key: k, label: CHANNEL[k] ?? k, value: b!.count, hint: `${b!.count} · ${money(b!.valueCents)}` }))} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Busiest hours" description="Orders started in each hour (local time)." />
            <CardBody>
              <Bars label="Orders by hour" rows={a.byHour.filter((h) => h.count > 0).map((h) => ({ key: String(h.hour), label: `${String(h.hour).padStart(2, '0')}:00`, value: h.count, hint: `${h.count} · ${money(h.valueCents)}` }))} />
            </CardBody>
          </Card>
          {a.byDay.length > 1 && (
            <Card>
              <CardHeader title="By day" />
              <CardBody>
                <Bars label="Order value by day" rows={a.byDay.map((d) => ({ key: d.date, label: d.date.slice(5), value: d.valueCents, hint: `${d.count} · ${money(d.valueCents)}` }))} />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Popular dishes" />
            <CardBody>
              <ol className="space-y-1 text-sm" data-testid="top-items">
                {a.topItems.map((i) => <li key={i.name} className="flex justify-between gap-2"><span>{i.name}</span><span className="tabular-nums text-muted">{i.quantity} × · {money(i.valueCents)}</span></li>)}
              </ol>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Popular categories" />
            <CardBody>
              <ol className="space-y-1 text-sm">
                {a.topCategories.map((c) => <li key={c.name} className="flex justify-between gap-2"><span>{c.name}</span><span className="tabular-nums text-muted">{c.quantity} × · {money(c.valueCents)}</span></li>)}
              </ol>
            </CardBody>
          </Card>
          {a.zones.length > 0 && (
            <Card>
              <CardHeader title="Delivery zones" />
              <CardBody>
                <Bars label="Deliveries by zone" rows={a.zones.map((z) => ({ key: z.name, label: z.name, value: z.count, hint: `${z.count} · ${money(z.valueCents)}` }))} />
              </CardBody>
            </Card>
          )}
          {a.discounts.length > 0 && (
            <Card>
              <CardHeader title="Promotions used" />
              <CardBody>
                <ul className="space-y-1 text-sm">{a.discounts.map((d) => <li key={d.description} className="flex justify-between"><span>{d.description}</span><span className="tabular-nums text-muted">{d.count} × · −{money(d.amountCents)}</span></li>)}</ul>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Payments by method" />
            <CardBody>
              {a.money.collectedByMethod.length === 0 ? <p className="text-sm text-muted">No payments recorded.</p> : (
                <ul className="space-y-1 text-sm">{a.money.collectedByMethod.map(([method, c]) => <li key={method} className="flex justify-between"><span>{method.toLowerCase().replace(/_/g, ' ')}</span><span className="tabular-nums">{money(c)}</span></li>)}</ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
      <div className={statGrid(3, 'mt-6')}>
        <Stat label="Reservations" value={a.reservations.total} hint={`${a.reservations.covers} confirmed guests · ${a.reservations.byStatus.NO_SHOW ?? 0} no-shows`} />
        <Stat label="Guest feedback" value={a.feedback.average ?? '—'} hint={`${a.feedback.count} ratings · ${a.feedback.complaints} complaints, ${a.feedback.complaintsResolved} resolved`} />
        <Stat label="Cart suggestions" value={a.upsell.acceptanceRate === null ? '—' : `${a.upsell.acceptanceRate} %`} hint={`${a.upsell.accepted} accepted of ${a.upsell.shown} shown (all locations)`} />
      </div>
    </>
  );
}
