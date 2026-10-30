import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Badge, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input, PageHeader, Select } from '@/components/ui';
import { getMessages } from '@/i18n';
import { db } from '@/server/db';
import { loyaltyMembers, rewardText } from '@/server/services/loyalty';
import { requireModulePage } from '@/server/modules';
import { requireTenantPage } from '@/server/tenant';
import { deleteMemberAction, redeemAction, saveLoyaltyProgramAction, withdrawMarketingAction } from './actions';

export default async function LoyaltyPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ q?: string }> }) {
  const { org } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(org, 'loyalty.manage');
  await requireModulePage(ctx, 'loyalty');
  const m = getMessages(ctx.user.preferredLanguage);
  const [program, orgRow, members] = await Promise.all([
    db.loyaltyProgram.findUnique({ where: { organizationId: ctx.org.id } }),
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true } }),
    loyaltyMembers(ctx, sp.q?.slice(0, 40)),
  ]);
  const unit = program?.type === 'POINTS' ? 'points' : 'stamps';
  const target = program?.stampsForReward ?? 10;
  return (
    <>
      <PageHeader
        title={m.nav.loyalty}
        description="Guests join voluntarily from their order page, with consent. Stamps or points are added only when an order is completed and fully paid. Loyalty is never linked to reviews."
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader
            title={`Members (${members.length})`}
            action={
              <form className="flex items-center gap-2">
                <Input name="q" defaultValue={sp.q ?? ''} placeholder="Phone or name" className="h-8 w-48" aria-label="Search members" data-testid="member-search" />
                <button className="text-sm underline">Search</button>
              </form>
            }
          />
          {members.length === 0 ? (
            <CardBody><EmptyState title={sp.q ? 'No member matches this search' : 'No members yet'} description={program?.enabled ? 'Guests see the invitation on their order page.' : 'Switch the programme on to invite guests.'} /></CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {members.map((a) => (
                <li key={a.id} className="space-y-2 px-5 py-4" data-testid="member-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{a.phone}</span>
                    {a.name && <span className="text-muted">· {a.name}</span>}
                    <Badge tone={a.balance >= target ? 'lime' : 'neutral'} data-testid="member-balance">{a.balance} / {target} {unit}</Badge>
                    {a.marketingOptIn && <Badge tone="info">marketing opt-in</Badge>}
                    {a.birthday && <Badge tone="neutral">birthday {a.birthday.split('-').reverse().join('/')}</Badge>}
                    <span className="ms-auto text-xs text-muted">joined {a.createdAt.toLocaleDateString('pt-PT')}</span>
                  </div>
                  {a.transactions.length > 0 && (
                    <p className="text-xs text-muted">
                      {a.transactions.map((t) => `${t.type.toLowerCase()} ${t.amount > 0 ? '+' : ''}${t.amount}${t.note ? ` (${t.note})` : ''}`).join(' · ')}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {a.balance >= target && <InlineAction action={redeemAction} fields={{ org: ctx.org.slug, accountId: a.id }} label="Redeem reward" variant="primary" testId="member-redeem" confirm={`Redeem ${target} ${unit} for this guest?`} />}
                    {a.marketingOptIn && <InlineAction action={withdrawMarketingAction} fields={{ org: ctx.org.slug, accountId: a.id }} label="Withdraw marketing consent" variant="ghost" />}
                    <InlineAction action={deleteMemberAction} fields={{ org: ctx.org.slug, accountId: a.id }} label="Delete member" variant="danger" confirm="Delete this member and their history? This cannot be undone." testId="member-delete" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Programme settings" />
          <CardBody>
            <ActionForm action={saveLoyaltyProgramAction} testId="loyalty-settings-form">
              <input type="hidden" name="org" value={ctx.org.slug} />
              <Checkbox name="enabled" label="Loyalty programme on" defaultChecked={program?.enabled ?? false} />
              <Field label="Type" htmlFor="ly-type">
                <Select id="ly-type" name="type" defaultValue={program?.type ?? 'STAMPS'}>
                  <option value="STAMPS">Stamps (1 per paid order)</option>
                  <option value="POINTS">Points (per euro spent)</option>
                </Select>
              </Field>
              <Field label="Needed for a reward" htmlFor="ly-target" hint="Number of stamps, or points, to earn one reward.">
                <Input id="ly-target" name="stampsForReward" type="number" min={1} defaultValue={target} />
              </Field>
              <Field label="Points per euro" htmlFor="ly-ppe" hint="Only used for points. Delivery fees do not earn points.">
                <Input id="ly-ppe" name="pointsPerEuro" type="number" min={1} defaultValue={program?.pointsPerEuro ?? 1} />
              </Field>
              <Field label="Reward" htmlFor="ly-reward" hint="Shown to guests, e.g. what they receive. Required to switch on.">
                <Input id="ly-reward" name="rewardText" maxLength={200} defaultValue={rewardText(program, orgRow.sourceLanguage, orgRow.sourceLanguage) ?? ''} />
              </Field>
              <Field label="Expire unused after (days)" htmlFor="ly-exp" optionalLabel="optional" hint="30–1095 days. Leave empty for no expiry.">
                <Input id="ly-exp" name="expiryDays" type="number" min={30} max={1095} defaultValue={program?.expiryDays ?? ''} />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
