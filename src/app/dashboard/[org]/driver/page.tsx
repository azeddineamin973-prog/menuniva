import { ActionForm } from '@/components/forms/action-form';
import { Badge, buttonClass, Card, CardBody, Checkbox, EmptyState, Icon, PageHeader, humanize } from '@/components/ui';
import { getMessages } from '@/i18n';
import { fmt } from '@/i18n/config';
import { formatCents } from '@/lib/money';
import { myDeliveries } from '@/server/services/fulfilment';
import { requireModulePage } from '@/server/module-page';
import { requireTenantPage } from '@/server/tenant';
import { driverUpdateAction } from '../delivery/actions';

/** Mobile driver view: only the deliveries assigned to the signed-in staff member. No GPS tracking. */
export default async function DriverPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'delivery.driver');
  await requireModulePage(ctx, 'delivery');
  const m = getMessages(ctx.user.preferredLanguage);
  const t = m.staff;
  const orders = await myDeliveries(ctx);
  return (
    <>
      <PageHeader title={t.driverTitle} />
      {orders.length === 0 ? (
        <EmptyState icon="truck" title={t.driverEmpty} />
      ) : (
        <div className="space-y-4">
          {orders.map((o) => {
            const d = o.delivery!;
            const due = o.totalCents - o.paidCents;
            const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.addressLine}, ${d.postalCode} ${d.city}`)}`;
            return (
              <Card key={o.id} data-testid="driver-order">
                <CardBody className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xl font-semibold tabular-nums">#{o.number}</p>
                    <Badge tone={o.status === 'OUT_FOR_DELIVERY' ? 'info' : o.status === 'READY' ? 'lime' : 'neutral'} dot>{humanize(o.status)}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-muted">{t.deliverTo}</p>
                    <p className="font-medium">{d.recipientName}</p>
                    <p className="break-words">{d.addressLine}, {d.postalCode} {d.city}</p>
                    {d.notes && <p className="mt-1 flex items-start gap-1.5 text-sm text-warning"><Icon name="info" className="mt-0.5 size-3.5 shrink-0" />{d.notes}</p>}
                  </div>
                  <p className="text-sm text-muted">{o.items.map((i) => `${i.quantity}× ${i.nameSnapshot}`).join(', ')}</p>
                  <p className="text-sm">
                    <strong className="tabular-nums">{formatCents(o.totalCents)}</strong> · {o.paymentStatus === 'PAID' ? t.paid : o.paymentMethodIntent === 'CARD_TERMINAL' ? m.customer.cardOnDelivery : m.customer.cashOnDelivery}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <a href={`tel:${d.phone.replace(/\s/g, '')}`} className={buttonClass('secondary', 'lg')}><Icon name="phone" /> {t.callCustomer}</a>
                    <a href={mapUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'lg')}><Icon name="map" /> {t.openMap}</a>
                  </div>
                  {o.status === 'READY' && (
                    <ActionForm action={driverUpdateAction} submitLabel={t.outForDelivery} testId="driver-out">
                      <input type="hidden" name="org" value={ctx.org.slug} />
                      <input type="hidden" name="orderId" value={o.id} />
                      <input type="hidden" name="to" value="OUT_FOR_DELIVERY" />
                    </ActionForm>
                  )}
                  {o.status === 'OUT_FOR_DELIVERY' && (
                    <ActionForm action={driverUpdateAction} submitLabel={t.delivered} testId="driver-delivered">
                      <input type="hidden" name="org" value={ctx.org.slug} />
                      <input type="hidden" name="orderId" value={o.id} />
                      <input type="hidden" name="to" value="DELIVERED" />
                      {due > 0 && o.paymentMethodIntent !== 'CARD_TERMINAL' && <Checkbox name="cashCollected" label={fmt(t.cashCollected, { amount: formatCents(due) })} />}
                    </ActionForm>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
