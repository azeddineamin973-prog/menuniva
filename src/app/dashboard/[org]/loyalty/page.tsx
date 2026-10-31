import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Disclosure, EmptyState, Field, FilterChip, Icon, Input, PageHeader, Select, humanize } from '@/components/ui';
import { getMessages } from '@/i18n';
import { db } from '@/server/db';
import { loyaltyMembers, rewardText } from '@/server/services/loyalty';
import { requireModulePage } from '@/server/module-page';
import { requireTenantPage } from '@/server/tenant';
import { deleteMemberAction, redeemAction, saveLoyaltyProgramAction, withdrawMarketingAction } from './actions';

export default async function LoyaltyPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ q?: string; birthdays?: string }> }) {
  const { org } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(org, 'loyalty.manage');
  await requireModulePage(ctx, 'loyalty');
  const m = getMessages(ctx.user.preferredLanguage);
  const [program, orgRow, members] = await Promise.all([
    db.loyaltyProgram.findUnique({ where: { organizationId: ctx.org.id } }),
    db.restaurantOrganization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { sourceLanguage: true } }),
    loyaltyMembers(ctx, sp.q?.slice(0, 40), sp.birthdays ? new Date().getMonth() + 1 : undefined),
  ]);
  const birthdayCount = (await loyaltyMembers(ctx, undefined, new Date().getMonth() + 1)).length;
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
            icon="users"
            title={`Members (${members.length})`}
          />
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
            <form className="relative flex min-w-0 flex-1 basis-56 items-center gap-2" role="search">
              <Icon name="search" className="pointer-events-none absolute start-3 text-muted" />
              <Input name="q" type="search" defaultValue={sp.q ?? ''} placeholder="Phone or name" className="min-w-0 flex-1 ps-9" aria-label="Search members" data-testid="member-search" />
              <Button type="submit" variant="secondary">Search</Button>
            </form>
            <FilterChip href={sp.birthdays ? `/dashboard/${ctx.org.slug}/loyalty` : `/dashboard/${ctx.org.slug}/loyalty?birthdays=1`} active={!!sp.birthdays} count={sp.birthdays ? undefined : birthdayCount} data-testid="birthdays-filter">
              {sp.birthdays ? 'All members' : 'Birthdays this month'}
            </FilterChip>
          </div>
          {members.length === 0 ? (
            <CardBody><EmptyState icon="heart" title={sp.q ? 'No member matches this search' : 'No members yet'} description={program?.enabled ? 'Guests see the invitation on their order page.' : 'Switch the programme on to invite guests.'} /></CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {members.map((a) => (
                <li key={a.id} className="space-y-2 px-4 py-3.5 sm:px-5" data-testid="member-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{a.phone}</span>
                    {a.name && <span className="text-muted">· {a.name}</span>}
                    <Badge tone={a.balance >= target ? 'lime' : 'neutral'} data-testid="member-balance">{a.balance} / {target} {unit}</Badge>
                    {a.marketingOptIn && <Badge tone="info">Marketing opt-in</Badge>}
                    {a.birthday && <Badge tone="neutral">Birthday {a.birthday.split('-').reverse().join('/')}</Badge>}
                    <span className="ms-auto text-xs text-muted">joined {a.createdAt.toLocaleDateString('pt-PT')}</span>
                  </div>
                  {a.transactions.length > 0 && (
                    <p className="text-xs text-muted">
                      {a.transactions.map((t) => `${humanize(t.type)} ${t.amount > 0 ? '+' : ''}${t.amount}${t.note ? ` (${t.note})` : ''}`).join(' · ')}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {a.balance >= target && <InlineAction action={redeemAction} fields={{ org: ctx.org.slug, accountId: a.id }} label="Redeem reward" variant="primary" testId="member-redeem" confirm={`Redeem ${target} ${unit} for this guest?`} />}
                    {a.marketingOptIn && <InlineAction action={withdrawMarketingAction} fields={{ org: ctx.org.slug, accountId: a.id }} label="Withdraw marketing consent" variant="ghost" />}
                    <InlineAction action={deleteMemberAction} fields={{ org: ctx.org.slug, accountId: a.id }} label="Delete member" variant="dangerGhost" confirm="Delete this member and their history? This cannot be undone." testId="member-delete" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Disclosure icon="settings" title="Programme settings" description={program?.enabled ? `On · ${target} ${unit} for a reward` : 'Off · open to switch it on'} defaultOpen={!program?.enabled} className="xl:sticky xl:top-20">
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
        </Disclosure>
      </div>
    </>
  );
}
