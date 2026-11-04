import { AutoRefresh } from '@/components/dashboard/auto-refresh';
import { ActionForm } from '@/components/forms/action-form';
import { Icon, type IconName } from '@/components/ui';
import { getMessages } from '@/i18n';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/money';
import { db } from '@/server/db';
import { myDeliveries } from '@/server/services/fulfilment';
import { requireModulePage } from '@/server/module-page';
import { requireTenantPage } from '@/server/tenant';
import { driverUpdateAction } from '../delivery/actions';

type Delivery = Awaited<ReturnType<typeof myDeliveries>>[number];

/**
 * Driver view, made for a phone in one hand (and a tablet or laptop at the counter):
 * only the deliveries assigned to the signed-in staff member, grouped by what to do next —
 * collect at the restaurant, on the way, still in the kitchen. Each card shows where to go, whom
 * to call, what to collect and ONE action. Finished deliveries shrink to a short list.
 * No GPS or location tracking. The page re-reads itself every 20 s.
 */
export default async function DriverPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'delivery.driver');
  await requireModulePage(ctx, 'delivery');
  const lang = ctx.user.preferredLanguage;
  const m = getMessages(lang);
  const t = m.staff;
  const orders = await myDeliveries(ctx);
  const zones = new Map((await db.restaurantLocation.findMany({ where: { id: { in: [...new Set(orders.map((o) => o.locationId))] } }, select: { id: true, timeZone: true } })).map((l) => [l.id, l.timeZone]));
  const time = (d: Date, locationId: string) => new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', timeZone: zones.get(locationId) ?? 'Europe/Lisbon' }).format(d);
  const due = (o: Delivery) => Math.max(0, o.totalCents - o.paidCents);
  const collectsCash = (o: Delivery) => due(o) > 0 && o.paymentMethodIntent !== 'CARD_TERMINAL';

  const ready = orders.filter((o) => o.status === 'READY');
  const onTheWay = orders.filter((o) => o.status === 'OUT_FOR_DELIVERY');
  const preparing = orders.filter((o) => ['NEW', 'ACCEPTED', 'PREPARING'].includes(o.status));
  const done = orders.filter((o) => o.status === 'DELIVERED' || o.status === 'COMPLETED');
  const active = [...onTheWay, ...ready, ...preparing];
  const toCollect = active.filter(collectsCash).reduce((s, o) => s + due(o), 0);
  // Both "on the way" and "ready": side by side on large screens, one card per column.
  const both = onTheWay.length > 0 && ready.length > 0;

  const card = (o: Delivery, tone: 'ready' | 'way' | 'prep') => {
    const d = o.delivery!;
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.addressLine}, ${d.postalCode} ${d.city}`)}`;
    const amount = due(o);
    return (
      <article
        key={o.id}
        id={`order-${o.id}`}
        className={cn('scroll-mt-20 overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 target:ring-4 target:ring-warning/70', tone === 'way' ? 'ring-2 ring-info/50' : tone === 'ready' ? 'ring-2 ring-lime' : 'ring-line')}
        data-testid="driver-order"
      >
        <div className="p-4 sm:p-5">
          <header className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[1.6rem] leading-none font-bold tracking-tight tabular-nums">#{o.number}</p>
              <p className="mt-1.5 text-xs text-muted">{fmt(t.orderedAt, { time: time(o.createdAt, o.locationId) })}</p>
              {d.driverMembershipId !== ctx.membershipId && (
                <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-info/10 px-1.5 py-0.5 text-[11px] font-semibold text-info" data-testid="open-delivery">
                  <Icon name="users" className="size-3" />
                  {t.openToAllDrivers}
                </p>
              )}
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                tone === 'way' ? 'bg-info/12 text-info' : tone === 'ready' ? 'bg-lime/25 text-ink' : 'bg-surface-2 text-ink-2',
              )}
            >
              <span className={cn('size-1.5 rounded-full', tone === 'way' ? 'bg-info' : tone === 'ready' ? 'bg-[#6cb30a]' : 'bg-warning')} aria-hidden />
              {m.orderStatus[o.status as keyof typeof m.orderStatus] ?? o.status}
            </span>
          </header>

          {/* Where to go: the whole block opens the map. */}
          <a href={mapUrl} target="_blank" rel="noopener noreferrer" aria-label={`${t.openMap}: ${d.addressLine}, ${d.postalCode} ${d.city}`} className="group mt-4 flex items-center gap-3 rounded-xl bg-surface-2 p-3.5 transition-colors hover:bg-surface-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-info text-white" aria-hidden>
              <Icon name="map" className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] leading-snug font-semibold break-words text-ink">{d.addressLine}</span>
              <span className="block text-sm text-ink-2">
                {d.postalCode} {d.city}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-info">
              <span className="hidden sm:inline">{t.openMap}</span>
              <Icon name="arrowRight" className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
            </span>
          </a>
          {d.notes && (
            <p className="mt-2 flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm font-medium wrap-anywhere text-warning">
              <Icon name="info" className="mt-0.5 size-4 shrink-0" />“{d.notes}”
            </p>
          )}

          {/* Whom to call. */}
          <div className="mt-4 flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-ink-2" aria-hidden>
              {d.recipientName.trim().slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink">{d.recipientName}</p>
              <p className="truncate text-[13px] text-muted">{o.items.map((i) => `${i.quantity}× ${i.nameSnapshot}`).join(' · ')}</p>
            </div>
            <a href={`tel:${d.phone.replace(/\s/g, '')}`} className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-surface px-4 text-sm font-semibold text-ink shadow-xs ring-1 ring-line hover:bg-surface-2" aria-label={`${t.callCustomer} ${d.recipientName}`}>
              <Icon name="phone" className="size-4" />
              {t.callCustomer}
            </a>
          </div>
        </div>

        {/* What to collect. */}
        <div className={cn('flex items-center justify-between gap-3 border-y px-4 py-3 sm:px-5', amount > 0 && collectsCash(o) ? 'border-warning/20 bg-warning/8' : 'border-line bg-surface-2/60')}>
          <span className="flex items-center gap-2 text-sm text-ink-2">
            <Icon name={amount === 0 ? 'checkCircle' : 'card'} className="size-4" />
            {amount === 0 ? t.paidAlready : o.paymentMethodIntent === 'CARD_TERMINAL' ? m.customer.cardOnDelivery : m.customer.cashOnDelivery}
          </span>
          <span className="text-end">
            {amount > 0 && <span className="block text-[11px] font-medium tracking-wide text-muted uppercase">{t.statCollect}</span>}
            <span className="text-xl font-bold tabular-nums">{formatCents(amount > 0 ? amount : o.totalCents)}</span>
          </span>
        </div>

        {/* The one next step. */}
        <div className="p-4 sm:px-5">
          {o.status === 'READY' && (
            // The driver confirms pickup when the staff hand the order over (this also takes an
            // order that is open to all drivers).
            <ActionForm action={driverUpdateAction} submitLabel={t.confirmPickup} testId="driver-out" submitVariant="primary" className="space-y-2 [&_button[type=submit]]:h-13 [&_button[type=submit]]:w-full [&_button[type=submit]]:rounded-xl [&_button[type=submit]]:text-base [&_button[type=submit]]:font-semibold">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <input type="hidden" name="orderId" value={o.id} />
              <input type="hidden" name="to" value="OUT_FOR_DELIVERY" />
              <p className="text-center text-xs text-muted">{t.confirmPickupHint}</p>
            </ActionForm>
          )}
          {o.status === 'OUT_FOR_DELIVERY' && (
            <ActionForm action={driverUpdateAction} submitLabel={t.delivered} testId="driver-delivered" submitVariant="dark" className="space-y-3 [&_button[type=submit]]:h-13 [&_button[type=submit]]:w-full [&_button[type=submit]]:rounded-xl [&_button[type=submit]]:text-base [&_button[type=submit]]:font-semibold">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <input type="hidden" name="orderId" value={o.id} />
              <input type="hidden" name="to" value="DELIVERED" />
              {collectsCash(o) && (
                <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl bg-surface-2 px-3.5 text-[15px] font-medium text-ink">
                  <input type="checkbox" name="cashCollected" className="size-5 shrink-0 accent-[#6cb30a]" />
                  {fmt(t.cashCollected, { amount: formatCents(amount) })}
                </label>
              )}
            </ActionForm>
          )}
          {tone === 'prep' && (
            <p className="flex items-center justify-center gap-2 rounded-xl bg-surface-2 px-3 py-3.5 text-sm font-medium text-ink-2">
              <Icon name="flame" className="size-4 text-warning" />
              {t.kitchenPreparing}
            </p>
          )}
        </div>
      </article>
    );
  };

  // Still in the kitchen: nothing to do yet, so one short row each (where, who, how much).
  const upcoming = (list: Delivery[]) =>
    list.length > 0 && (
      <section className="space-y-3" aria-label={t.groupPreparing}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-2">
          <Icon name="flame" className="size-4" />
          {t.groupPreparing}
          <span className="rounded-md bg-surface-2 px-1.5 text-xs tabular-nums">{list.length}</span>
        </h2>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
          {list.map((o) => {
            const d = o.delivery!;
            return (
              <li key={o.id} className="flex items-center gap-3 px-4 py-3" data-testid="driver-order">
                <span className="w-12 shrink-0 text-lg font-bold tabular-nums">#{o.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink">{d.addressLine}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {d.postalCode} {d.city} · {d.recipientName}
                  </span>
                </span>
                <span className="hidden shrink-0 text-end sm:block">
                  <span className="block text-sm font-semibold tabular-nums">{formatCents(due(o) || o.totalCents)}</span>
                  <span className="block text-[11px] text-muted">{fmt(t.orderedAt, { time: time(o.createdAt, o.locationId) })}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2">
                  <span className="size-1.5 rounded-full bg-warning" aria-hidden />
                  <span className="hidden sm:inline">{m.orderStatus[o.status as keyof typeof m.orderStatus] ?? o.status}</span>
                  <Icon name="flame" className="size-3.5 text-warning sm:hidden" />
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    );

  const group = (title: string, icon: IconName, list: Delivery[], tone: 'ready' | 'way' | 'prep') =>
    list.length > 0 && (
      <section className="space-y-3" aria-label={title}>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-2">
          <Icon name={icon} className="size-4" />
          {title}
          <span className="rounded-md bg-surface-2 px-1.5 text-xs tabular-nums">{list.length}</span>
        </h2>
        <div className={cn('grid gap-4', !both && (done.length > 0 ? 'xl:grid-cols-2' : 'md:grid-cols-2'))}>{list.map((o) => card(o, tone))}</div>
      </section>
    );

  return (
    <div className="mx-auto max-w-6xl">
      {/* New on every render: lets the page say when its deliveries and totals stopped updating. */}
      <AutoRefresh seconds={20} renderedAt={new Date().toISOString()} staleText={t.staleBoard} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.driverTitle}</h1>
          <p className="mt-0.5 text-sm text-muted capitalize">{new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
        </div>
      </div>

      {/* Today at a glance. */}
      <dl className="mb-6 grid grid-cols-3 gap-2 sm:gap-3" data-testid="driver-summary">
        {[
          { label: t.statActive, value: String(active.length), icon: 'truck' as const, strong: active.length > 0 },
          { label: t.statCollect, value: formatCents(toCollect), icon: 'card' as const, strong: toCollect > 0 },
          { label: t.statDone, value: String(done.length), icon: 'checkCircle' as const, strong: false },
        ].map((s) => (
          <div key={s.label} className={cn('rounded-2xl p-3 ring-1 sm:p-4', s.strong ? 'bg-surface shadow-xs ring-line' : 'bg-surface-2/60 ring-transparent')}>
            <dt className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase sm:text-xs">
              <Icon name={s.icon} className="hidden size-3.5 sm:block" />
              {s.label}
            </dt>
            <dd className="mt-1 text-lg font-bold text-ink tabular-nums sm:text-2xl">{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className={cn('grid gap-8 lg:items-start', done.length > 0 && 'lg:grid-cols-[minmax(0,1fr)_20rem]')}>
        <div className="space-y-8">
          {active.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl bg-surface px-6 py-14 text-center ring-1 ring-line">
              <span className="flex size-14 items-center justify-center rounded-full bg-lime/25 text-ink" aria-hidden>
                <Icon name="checkCircle" className="size-7" />
              </span>
              <p className="mt-4 text-lg font-semibold text-ink">{orders.length === 0 ? t.driverEmpty : t.caughtUp}</p>
              <p className="mt-1 max-w-sm text-sm text-muted">{t.caughtUpHint}</p>
            </div>
          ) : (
            <>
              {(onTheWay.length > 0 || ready.length > 0) && (
                <div className={cn('grid items-start gap-8', both && 'lg:grid-cols-2')}>
                  {group(t.groupOnTheWay, 'truck', onTheWay, 'way')}
                  {group(t.groupReady, 'bag', ready, 'ready')}
                </div>
              )}
              {upcoming(preparing)}
            </>
          )}
        </div>

        {/* Finished today: a short list, not full cards. */}
        {done.length > 0 && (
          <aside className="rounded-2xl bg-surface ring-1 ring-line lg:sticky lg:top-20" aria-label={t.deliveredToday}>
            <h2 className="flex items-center justify-between px-4 pt-4 pb-2 text-sm font-semibold text-ink">
              {t.deliveredToday}
              <span className="rounded-md bg-surface-2 px-1.5 text-xs text-muted tabular-nums">{done.length}</span>
            </h2>
            <ul className="divide-y divide-line">
              {done.map((o) => {
                const unpaid = due(o) > 0;
                return (
                  <li key={o.id} className="flex items-center gap-3 px-4 py-3" data-testid="driver-order">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/12 text-success" aria-hidden>
                      <Icon name="check" className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="font-semibold tabular-nums">#{o.number}</span>
                        <span className="truncate text-[13px] text-ink-2">{o.delivery?.addressLine}</span>
                      </span>
                      <span className="block text-xs text-muted">
                        {m.orderStatus.DELIVERED}
                        {o.delivery?.deliveredAt && ` · ${fmt(t.deliveredAt, { time: time(o.delivery.deliveredAt, o.locationId) })}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-end">
                      <span className="block text-sm font-semibold tabular-nums">{formatCents(o.totalCents)}</span>
                      <span className={cn('block text-[11px] font-medium', unpaid ? 'text-warning' : 'text-success')}>{unpaid ? t.notCollected : t.paid}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
