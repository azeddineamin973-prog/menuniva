import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/forms/action-form';
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, disclosureClass, humanize } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { db } from '@/server/db';
import { UserFacingError } from '@/server/errors';
import { getSessionBill, PAYMENT_METHODS } from '@/server/services/bills';
import { requireTenantPage } from '@/server/tenant';
import { changeItemAction, closeSessionAction, recordPaymentAction, transferAction, voidPaymentAction } from '../actions';

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
        title={`Table ${session.table.label}`}
        description={`${open ? 'Open' : 'Closed'} since ${session.openedAt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}${session.verificationCode && open ? ` · table code ${session.verificationCode}` : ''}`}
        actions={<ButtonLink href={`/dashboard/${ctx.org.slug}/bills/${session.id}/receipt`} variant="secondary" target="_blank">Print receipt (not an invoice)</ButtonLink>}
      />
      {/* Three figures side by side even on a phone: the waiter sees total, paid and balance at once. */}
      <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-4" data-testid="bill-totals">
        <Card className="p-3 sm:p-5"><p className="text-xs text-muted sm:text-sm">Bill total</p><p className="mt-1 text-lg font-semibold tabular-nums sm:text-2xl" data-testid="bill-total">{formatCents(billedCents)}</p></Card>
        <Card className="p-3 sm:p-5"><p className="text-xs text-muted sm:text-sm">Payments recorded</p><p className="mt-1 text-lg font-semibold tabular-nums sm:text-2xl" data-testid="bill-paid">{formatCents(paidCents)}</p></Card>
        <Card className="p-3 sm:p-5"><p className="text-xs text-muted sm:text-sm">Still to pay</p><p className={`mt-1 text-lg font-semibold tabular-nums sm:text-2xl ${balanceCents > 0 ? 'text-danger' : 'text-success'}`} data-testid="bill-balance">{formatCents(balanceCents)}</p></Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {orders.map((o) => (
            <Card key={o.id}>
              <CardHeader
                title={`Order #${o.number}`}
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
                        {i.voidedAt && <p className="text-xs text-danger">Removed: {i.voidReason}</p>}
                      </div>
                      <span className="tabular-nums">{formatCents(i.lineTotalCents)}</span>
                      {bi && (bi.fullyPaid ? <Badge tone="success">paid</Badge> : bi.allocatedCents > 0 ? <Badge tone="warning">part paid</Badge> : null)}
                      {canModify && open && !i.voidedAt && o.status !== 'COMPLETED' && o.status !== 'CANCELLED' && (
                        <details className="w-full">
                          <summary className={disclosureClass}>Reduce or remove</summary>
                          <ActionForm action={changeItemAction} submitLabel="Apply change" submitVariant="danger" className="mt-2 flex flex-wrap items-end gap-2 space-y-0">
                            {hiddenFields({ itemId: i.id })}
                            <Field label="New quantity" htmlFor={`q-${i.id}`}><Input id={`q-${i.id}`} name="quantity" type="number" min={0} max={i.quantity - 1} defaultValue={i.quantity - 1} className="w-24" /></Field>
                            <Field label="Reason (kept in the audit log)" htmlFor={`r-${i.id}`}><Input id={`r-${i.id}`} name="reason" required minLength={3} className="w-64" /></Field>
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
            <CardHeader title="Payments" description="Only payments recorded by staff. Card payments are taken on your own terminal." />
            {payments.length === 0 ? (
              <CardBody className="text-sm text-muted">No payments yet.</CardBody>
            ) : (
              <ul className="divide-y divide-line">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm" data-testid="payment-row">
                    <span>
                      <span className={p.status === 'VOIDED' ? 'line-through' : 'font-medium'}>{formatCents(p.amountCents)}</span> · {METHOD_LABEL[p.method]} · order #{p.orderNumber}
                      {p.allocations.length > 0 && <span className="text-xs text-muted"> · {p.allocations.length} item(s)</span>}
                      {p.status === 'VOIDED' && <Badge tone="danger">voided</Badge>}
                    </span>
                    {canModify && p.status === 'RECORDED' && (
                      <ActionForm action={voidPaymentAction} submitLabel="Void" submitVariant="secondary" className="flex items-center gap-2 space-y-0">
                        {hiddenFields({ paymentId: p.id })}
                        <Input name="reason" required placeholder="Reason" aria-label="Reason for voiding" className="h-8 w-40" />
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
              <CardHeader title="Record a payment" description="Split by items (each guest pays what they had) or by amount." />
              <CardBody>
                <ActionForm action={recordPaymentAction} submitLabel="Record payment" resetOnSuccess testId="payment-form">
                  {hiddenFields()}
                  <Field label="Method" htmlFor="method">
                    <Select id="method" name="method" defaultValue="CASH">
                      {PAYMENT_METHODS.filter((x) => x !== 'CASH_ON_DELIVERY').map((x) => <option key={x} value={x}>{METHOD_LABEL[x]}</option>)}
                    </Select>
                  </Field>
                  <fieldset className="space-y-1">
                    <legend className="mb-1 text-sm font-medium">Pay selected items</legend>
                    {items.filter((i) => !i.fullyPaid).map((i) => (
                      <label key={i.id} className="flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-2">
                        <span className="flex items-center gap-2"><input type="checkbox" name="itemIds" value={i.id} className="size-4 shrink-0 accent-[#7ac70c] pointer-coarse:size-5" />{i.quantity} × {i.nameSnapshot}</span>
                        <span className="tabular-nums">{formatCents(i.remainingCents)}</span>
                      </label>
                    ))}
                  </fieldset>
                  <Field label="…or an amount (€)" htmlFor="amount" hint={`Remaining: ${formatCents(balanceCents)}`}>
                    <Input id="amount" name="amount" inputMode="decimal" placeholder="0,00" />
                  </Field>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {open && freeTables.length > 0 && (
            <Card>
              <CardHeader title="Move to another table" />
              <CardBody>
                <ActionForm action={transferAction} submitLabel="Move guests" submitVariant="secondary" testId="transfer-form">
                  {hiddenFields()}
                  <Select name="toTableId" aria-label="Target table">
                    {freeTables.map((t) => <option key={t.id} value={t.id}>Table {t.label}</option>)}
                  </Select>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {open && (
            <Card>
              <CardHeader title="Close table" description="Closing frees the table for the next guests. Served orders are completed." />
              <CardBody>
                <ActionForm action={closeSessionAction} submitLabel="Close table" submitVariant="dark" testId="close-form">
                  {hiddenFields()}
                  {balanceCents > 0 && (
                    <Field label="Reason for closing with an unpaid balance" htmlFor="note" optionalLabel="required if not paid">
                      <Input id="note" name="note" />
                    </Field>
                  )}
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {!open && <Alert tone="info">This table was closed{session.closeNote ? `: ${session.closeNote}` : '.'}</Alert>}
        </div>
      </div>
    </>
  );
}
