import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/forms/action-form';
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, Checkbox, Field, Input, PageHeader, Select, disclosureClass, humanize } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { db } from '@/server/db';
import { UserFacingError } from '@/server/errors';
import { getSessionBill, PAYMENT_METHODS } from '@/server/services/bills';
import { requireTenantPage } from '@/server/tenant';
import { InlineAction } from '@/components/forms/inline-action';
import { sessionAccessSummary } from '@/server/services/table-access';
import { changeItemAction, closeSessionAction, recordPaymentAction, revokeDeviceAction, transferAction, voidPaymentAction } from '../actions';
import { TablePinPanel } from '../../tables/table-access-panel';
import { fmt } from '@/i18n/config';
import { getDashText } from '@/i18n/dash';

export const METHOD_LABEL: Record<(typeof PAYMENT_METHODS)[number], string> = {
  CASH: 'Cash',
  CARD_TERMINAL: 'Card (restaurant terminal)',
  PAY_AT_COUNTER: 'Paid at counter',
  CASH_ON_DELIVERY: 'Cash on delivery',
  OTHER_MANUAL: 'Other (recorded manually)',
};

export default async function BillPage({ params }: { params: Promise<{ org: string; sessionId: string }> }) {
  const { org, sessionId } = await params;
  const ctx = await requireTenantPage(org, 'payments.record');
  const d = getDashText(ctx.user.preferredLanguage);
  const t = d.bill;
  const methodLabel = (m: (typeof PAYMENT_METHODS)[number]) => t.methods[m] ?? METHOD_LABEL[m];
  let bill;
  try {
    bill = await getSessionBill(ctx, sessionId);
  } catch (e) {
    if (e instanceof UserFacingError) notFound();
    throw e;
  }
  const { session, orders, items, billedCents, paidCents, balanceCents } = bill;
  const freeTables = session.status === 'OPEN'
    ? await db.restaurantTable.findMany({ where: { locationId: session.locationId, organizationId: ctx.org.id, isActive: true, id: { not: session.tableId }, sessions: { none: { status: 'OPEN' } } }, orderBy: { sortOrder: 'asc' } })
    : [];
  const canModify = ctx.can('orders.modifyItems');
  const open = session.status === 'OPEN';
  const access = await sessionAccessSummary(ctx, session.id);
  const canSessions = ctx.can('tables.sessions');
  const activePhones = access.devices.filter((d) => d.active);
  const time = (d: Date) => d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const payments = orders.flatMap((o) => o.payments.map((p) => ({ ...p, orderNumber: o.number })));
  const hidden = { org: ctx.org.slug, sessionId: session.id };
  const hiddenFields = (extra: Record<string, string> = {}) => (
    <>
      {Object.entries({ ...hidden, ...extra }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    </>
  );

  return (
    <>
      <PageHeader
        title={fmt(t.title, { label: session.table.label })}
        description={`${fmt(open ? t.openSince : t.closedSince, { time: time(session.openedAt) })}${open && access.policy === 'SESSION_PIN' ? (activePhones.length === 1 ? t.phones1 : fmt(t.phonesN, { n: activePhones.length })) : ''}`}
        actions={<ButtonLink href={`/dashboard/${ctx.org.slug}/bills/${session.id}/receipt`} variant="secondary" target="_blank">{t.receipt}</ButtonLink>}
      />
      {/* Three figures side by side even on a phone: the waiter sees total, paid and balance at once. */}
      <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-4" data-testid="bill-totals">
        <Card className="p-3 sm:p-5"><p className="text-xs text-muted sm:text-sm">{t.total}</p><p className="mt-1 text-lg font-semibold tabular-nums sm:text-2xl" data-testid="bill-total">{formatCents(billedCents)}</p></Card>
        <Card className="p-3 sm:p-5"><p className="text-xs text-muted sm:text-sm">{t.paid}</p><p className="mt-1 text-lg font-semibold tabular-nums sm:text-2xl" data-testid="bill-paid">{formatCents(paidCents)}</p></Card>
        <Card className="p-3 sm:p-5"><p className="text-xs text-muted sm:text-sm">{t.balance}</p><p className={`mt-1 text-lg font-semibold tabular-nums sm:text-2xl ${balanceCents > 0 ? 'text-danger' : 'text-success'}`} data-testid="bill-balance">{formatCents(balanceCents)}</p></Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {orders.map((o) => (
            <Card key={o.id}>
              <CardHeader
                title={fmt(t.order, { n: o.number })}
                description={`${o.createdAt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })} · ${formatCents(o.totalCents)}`}
                action={<span className="flex gap-1.5"><Badge>{humanize(o.status)}</Badge><Badge tone={o.paymentStatus === 'PAID' ? 'success' : o.paymentStatus === 'PARTIALLY_PAID' ? 'warning' : 'neutral'}>{o.paymentStatus.replace('_', ' ').toLowerCase()}</Badge></span>}
              />
              <ul className="divide-y divide-line">
                {o.items.map((i) => {
                  const bi = items.find((x) => x.id === i.id);
                  return (
                    <li key={i.id} className={`flex flex-wrap items-center gap-3 px-5 py-3 text-sm ${i.voidedAt ? 'opacity-50' : ''}`} data-testid="bill-item">
                      <div className="min-w-0 flex-1">
                        <p className={i.voidedAt ? 'line-through' : 'font-medium'}>{i.quantity} × {i.nameSnapshot}</p>
                        {(i.variantNameSnapshot || i.modifiers.length > 0) && <p className="text-xs text-muted">{[i.variantNameSnapshot, ...i.modifiers.map((x) => x.nameSnapshot)].filter(Boolean).join(' · ')}</p>}
                        {i.voidedAt && <p className="text-xs text-danger">{fmt(t.removed, { reason: i.voidReason ?? '' })}</p>}
                      </div>
                      <span className="tabular-nums">{formatCents(i.lineTotalCents)}</span>
                      {bi && (bi.fullyPaid ? <Badge tone="success">{t.itemPaid}</Badge> : bi.allocatedCents > 0 ? <Badge tone="warning">{t.itemPartPaid}</Badge> : null)}
                      {canModify && open && !i.voidedAt && !['OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED'].includes(o.status) && (
                        <details className="w-full">
                          <summary className={disclosureClass}>{t.reduce}</summary>
                          <ActionForm action={changeItemAction} submitLabel={t.applyChange} submitVariant="danger" className="mt-2 flex flex-wrap items-end gap-2 space-y-0" testId={`change-item-${i.id}`}>
                            {hiddenFields({ itemId: i.id })}
                            <Field label={t.newQuantity} htmlFor={`q-${i.id}`}><Input id={`q-${i.id}`} name="quantity" type="number" min={0} max={i.quantity - 1} defaultValue={i.quantity - 1} className="w-24" /></Field>
                            <Field label={t.reason} htmlFor={`r-${i.id}`}><Input id={`r-${i.id}`} name="reason" required minLength={3} className="w-64" /></Field>
                            {/* Once a station started or finished the item, the change needs an explicit OK. */}
                            {o.status !== 'NEW' && i.stationId && (i.prepStatus === 'PREPARING' || i.prepStatus === 'READY') && (
                              <Checkbox name="kitchenNotified" label={i.prepStatus === 'READY' ? t.toldReady : t.toldStarted} />
                            )}
                            {o.status !== 'NEW' && i.stationId && <p className="w-full text-xs text-muted">{t.stationSees}</p>}
                          </ActionForm>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
          <Card>
            <CardHeader
              title={t.payments}
              description={t.paymentsDesc}
            />
            {payments.length === 0 ? (
              <CardBody className="text-sm text-muted">{t.noPayments}</CardBody>
            ) : (
              <ul className="divide-y divide-line">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm" data-testid="payment-row">
                    <span>
                      <span className={p.status === 'VOIDED' ? 'line-through' : 'font-medium'}>{formatCents(p.amountCents)}</span> · {methodLabel(p.method)} · {fmt(t.forOrder, { n: p.orderNumber })}
                      {p.allocations.length > 0 && <span className="text-xs text-muted">{fmt(t.itemsN, { n: p.allocations.length })}</span>}
                      {p.status === 'VOIDED' && <Badge tone="danger">{t.voided}</Badge>}
                      {p.status === 'VOIDED' && p.voidReason && <span className="block text-xs text-muted">{fmt(t.voidedReason, { reason: p.voidReason })}</span>}
                    </span>
                    {canModify && p.status === 'RECORDED' && (
                      <ActionForm action={voidPaymentAction} submitLabel={t.void} submitVariant="secondary" className="flex items-center gap-2 space-y-0">
                        {hiddenFields({ paymentId: p.id })}
                        <Input name="reason" required placeholder={t.voidReason} aria-label={t.voidReasonLabel} className="h-8 w-40" />
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          {open && balanceCents > 0 && (
            <Card>
              <CardHeader title={t.record} description={t.recordDesc} />
              <CardBody>
                <ActionForm action={recordPaymentAction} submitLabel={t.recordButton} resetOnSuccess testId="payment-form">
                  {hiddenFields()}
                  <Field label={t.method} htmlFor="method">
                    <Select id="method" name="method" defaultValue="CASH">
                      {/* Cash on delivery is refused by the server on table bills too. */}
                      {PAYMENT_METHODS.filter((x) => x !== 'CASH_ON_DELIVERY').map((x) => <option key={x} value={x}>{methodLabel(x)}</option>)}
                    </Select>
                  </Field>
                  <fieldset className="space-y-1">
                    <legend className="mb-1 text-sm font-medium">{t.paySelected}</legend>
                    {items.filter((i) => !i.fullyPaid).map((i) => (
                      <label key={i.id} className="flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-2">
                        <span className="flex items-center gap-2"><input type="checkbox" name="itemIds" value={i.id} className="size-4 shrink-0 accent-[#7ac70c] pointer-coarse:size-5" />{i.quantity} × {i.nameSnapshot}</span>
                        <span className="tabular-nums">{formatCents(i.remainingCents)}</span>
                      </label>
                    ))}
                  </fieldset>
                  <Field label={t.amount} htmlFor="amount" hint={fmt(t.remaining, { amount: formatCents(balanceCents) })}>
                    <Input id="amount" name="amount" inputMode="decimal" placeholder="0,00" />
                  </Field>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {open && access.policy === 'SESSION_PIN' && canSessions && (
            <Card data-testid="session-access">
              <CardHeader title={t.phones} description={t.phonesDesc} />
              <CardBody className="space-y-3">
                <TablePinPanel org={ctx.org.slug} sessionId={session.id} locked={access.locked} failures={access.failures} phones={activePhones.length} testId="bill-pin" t={d.pin} />
                {access.devices.length === 0 ? (
                  <p className="text-sm text-muted">{t.noPhones}</p>
                ) : (
                  <ul className="divide-y divide-line text-sm" data-testid="session-devices">
                    {access.devices.map((dv) => (
                      <li key={dv.id} className="flex items-center gap-2 py-2" data-testid="session-device">
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{fmt(t.phone, { n: dv.n })}</span>
                          <span className="text-muted">{fmt(t.joined, { time: time(dv.enrolledAt) })}{dv.orders === 1 ? t.orders1 : fmt(t.ordersN, { n: dv.orders })}</span>
                        </span>
                        {dv.active ? (
                          <InlineAction action={revokeDeviceAction} fields={{ org: ctx.org.slug, deviceId: dv.id }} label={t.remove} variant="dangerGhost" size="sm" confirm={fmt(t.removeConfirm, { n: dv.n })} testId="revoke-device" />
                        ) : (
                          <Badge>{dv.revokedAt ? t.removedBadge : t.expired}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}
          {open && freeTables.length > 0 && (
            <Card>
              <CardHeader title={t.move} />
              <CardBody>
                <ActionForm action={transferAction} submitLabel={t.moveButton} submitVariant="secondary" testId="transfer-form">
                  {hiddenFields()}
                  <Select name="toTableId" aria-label={t.targetTable}>
                    {freeTables.map((ft) => <option key={ft.id} value={ft.id}>{fmt(d.tables.table, { label: ft.label })}</option>)}
                  </Select>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {open && (
            <Card>
              <CardHeader title={t.close} description={t.closeDesc} />
              <CardBody>
                <ActionForm action={closeSessionAction} submitLabel={t.close} submitVariant="dark" testId="close-form">
                  {hiddenFields()}
                  {balanceCents > 0 && (
                    <Field label={t.closeReason} htmlFor="note" optionalLabel={t.closeReasonRequired}>
                      <Input id="note" name="note" />
                    </Field>
                  )}
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {!open && <Alert tone="info">{session.closeNote ? fmt(t.closedNote, { note: session.closeNote }) : t.closed}</Alert>}
        </div>
      </div>
    </>
  );
}
