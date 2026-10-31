import Link from 'next/link';
import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { SetupStepNav } from '@/components/dashboard/setup-nav';
import { Alert, Badge, Button, ButtonLink, Card, CardBody, CardHeader, Checkbox, Input, PageHeader, Select, Stat, statGrid } from '@/components/ui';
import { LANGUAGE_NATIVE_NAME, dirOf } from '@/i18n/config';
import { translationPlan } from '@/server/services/ai-translate';
import { getTranslationGrid } from '@/server/services/translations';
import { requireTenantPage } from '@/server/tenant';
import { MenuTabs } from '../menu-tabs';
import { approveAllTranslationsAction, approveTranslationAction, markTranslationsReviewedAction, saveTranslationAction } from '../actions';
import { AiTranslatePanel, RowTranslateButton } from './ai-panel';

const FILTERS = [
  { key: 'missing', label: 'Not translated' },
  { key: 'machine', label: 'Waiting for review' },
  { key: 'done', label: 'Reviewed' },
  { key: 'all', label: 'All' },
] as const;

type Search = { filter?: string; language?: string; q?: string; page?: string };

export default async function TranslationsPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<Search> }) {
  const { org } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(org, 'menu.edit');
  const filter = (FILTERS.find((f) => f.key === sp.filter)?.key ?? 'missing') as 'all' | 'missing' | 'machine' | 'done';
  const grid = await getTranslationGrid(ctx, { filter, language: sp.language || undefined, query: sp.q ?? '', page: Number(sp.page) || 1 });
  const plan = await translationPlan(ctx);
  const { org: o, rows, targets } = grid;
  const base = `/dashboard/${ctx.org.slug}`;
  const href = (next: Partial<Search>) => {
    const q = new URLSearchParams();
    const merged = { filter, language: sp.language ?? '', q: sp.q ?? '', page: '1', ...next };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, String(v));
    return `${base}/menu/translations?${q.toString()}`;
  };

  return (
    <>
      <SetupStepNav orgSlug={ctx.org.slug} orgId={ctx.org.id} stepKey="translations" />
      <PageHeader
        title="Translations"
        description="Machine translations stay hidden from guests until you approve them here. Nothing is ever invented: a language with no translation falls back to your original text."
        actions={
          <ActionForm action={markTranslationsReviewedAction} submitLabel="Mark translations as reviewed" submitVariant="secondary" successText="Recorded">
            <input type="hidden" name="org" value={ctx.org.slug} />
          </ActionForm>
        }
      />
      <MenuTabs base={base} active="translations" ctx={ctx} />

      <div className={statGrid(3, 'mb-6')}>
        <Stat label="Not translated" value={<span data-testid="missing-count">{grid.missing}</span>} hint={`${targets.length} languages besides ${LANGUAGE_NATIVE_NAME[o.sourceLanguage]}`} />
        <Stat label="Waiting for your review" value={<span data-testid="unreviewed-count">{grid.unreviewed}</span>} hint="Guests still see your original text" />
        <Stat label="Dishes and categories" value={grid.total} />
      </div>

      {targets.length === 0 ? (
        <Alert tone="info">
          Only one language is enabled. <Link href={`${base}/settings`} className="underline">Enable more languages in Settings</Link> to translate your menu.
        </Alert>
      ) : (
        <>
          <div className="mb-6">
            <AiTranslatePanel
              org={ctx.org.slug}
              plan={{
                cells: plan.cells,
                requests: plan.requests,
                characters: plan.characters,
                estimatedInputTokens: plan.estimatedInputTokens,
                estimatedOutputTokens: plan.estimatedOutputTokens,
                unreviewed: plan.unreviewed,
                sourceLanguageName: LANGUAGE_NATIVE_NAME[plan.sourceLanguage],
                targetNames: plan.targets.map((l) => LANGUAGE_NATIVE_NAME[l]),
                provider: plan.provider,
                cost: plan.cost,
              }}
            />
          </div>

          {grid.unreviewed > 0 && (
            <Card className="mb-6">
              <CardHeader title="Review and approve" description="Approving makes these translations visible to guests. Read through them first — the list below is filtered to exactly these items." />
              <CardBody className="space-y-3">
                <ButtonLink href={href({ filter: 'machine', page: '1' })} variant="secondary" size="sm" data-testid="review-all">
                  Review all {grid.unreviewed} waiting translations
                </ButtonLink>
                <ActionForm action={approveAllTranslationsAction} submitLabel={`Approve all ${grid.unreviewed} translations`} submitVariant="dark" successText="Approved — now visible to guests" testId="approve-all-form">
                  <input type="hidden" name="org" value={ctx.org.slug} />
                  {sp.language && <input type="hidden" name="language" value={sp.language} />}
                  <Checkbox name="confirmReviewed" label="I have read these translations and they are correct" description="Required. This is the moment the text becomes visible to your guests." />
                </ActionForm>
              </CardBody>
            </Card>
          )}

          <Card className="mb-4">
            <CardBody className="flex flex-wrap items-end gap-3">
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <ButtonLink key={f.key} href={href({ filter: f.key })} variant={filter === f.key ? 'dark' : 'secondary'} size="sm" data-testid={`filter-${f.key}`}>
                    {f.label}
                  </ButtonLink>
                ))}
              </div>
              <form className="flex flex-wrap items-end gap-2" action={`${base}/menu/translations`}>
                <input type="hidden" name="filter" value={filter} />
                <Input name="q" defaultValue={sp.q ?? ''} placeholder="Search a dish…" aria-label="Search a dish" className="w-48" data-testid="tr-search" />
                <Select name="language" defaultValue={sp.language ?? ''} aria-label="Language" className="w-40">
                  <option value="">All languages</option>
                  {targets.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_NATIVE_NAME[l]}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="secondary">
                  Filter
                </Button>
              </form>
              <p className="ms-auto text-sm text-muted" data-testid="tr-count">
                {grid.matched} of {grid.total} shown
              </p>
            </CardBody>
          </Card>

          {rows.length === 0 ? (
            <Alert tone="success">
              {grid.total === 0 ? 'Your menu has no categories or dishes yet.' : filter === 'missing' ? 'Every language is translated.' : filter === 'machine' ? 'Nothing is waiting for review.' : 'Nothing matches this filter.'}
            </Alert>
          ) : (
            <div className="space-y-3">
              {rows.map((r) => {
                const shown = sp.language ? targets.filter((l) => l === sp.language) : targets;
                return (
                  <Card key={`${r.kind}-${r.id}`} data-testid="tr-row" data-name={r.sourceName}>
                    <CardHeader
                      title={r.sourceName || '(no source name)'}
                      description={r.kind === 'category' ? 'Category' : 'Dish'}
                      action={shown.some((l) => !r.cells[l]) && plan.provider.configured ? <RowTranslateButton org={ctx.org.slug} kind={r.kind} id={r.id} /> : undefined}
                    />
                    <CardBody className="grid gap-3 lg:grid-cols-2">
                      {shown.map((l) => {
                        const c = r.cells[l];
                        return (
                          <div key={l} className="rounded-xl border border-line p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">{LANGUAGE_NATIVE_NAME[l]}</span>
                              {!c ? <Badge tone="warning">Not translated</Badge> : c.status === 'MACHINE' ? <Badge tone="info">Waiting for review</Badge> : <Badge tone="success">Reviewed</Badge>}
                            </div>
                            <ActionForm action={saveTranslationAction} submitLabel="Save" submitVariant="secondary" className="space-y-2">
                              <input type="hidden" name="org" value={ctx.org.slug} />
                              <input type="hidden" name="kind" value={r.kind} />
                              <input type="hidden" name="id" value={r.id} />
                              <input type="hidden" name="language" value={l} />
                              <Input
                                name="name"
                                dir={dirOf(l)}
                                defaultValue={c?.name ?? ''}
                                placeholder={`Name in ${LANGUAGE_NATIVE_NAME[l]}`}
                                aria-label={`Name in ${LANGUAGE_NATIVE_NAME[l]}`}
                                data-testid={`tr-${r.kind}-${l}`}
                              />
                              {r.kind === 'product' && <Input name="description" dir={dirOf(l)} defaultValue={c?.description ?? ''} placeholder="Description (optional)" aria-label="Description" />}
                            </ActionForm>
                            {c?.status === 'MACHINE' && (
                              <div className="mt-2">
                                <InlineAction action={approveTranslationAction} fields={{ org: ctx.org.slug, kind: r.kind, id: r.id, language: l }} label="Approve as is" variant="primary" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}

          {grid.pages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3" data-testid="tr-pagination">
              <ButtonLink href={href({ page: String(grid.page - 1) })} variant="secondary" size="sm" aria-disabled={grid.page === 1} icon="chevronLeft" className={grid.page === 1 ? 'pointer-events-none opacity-50' : ''}>
                Previous
              </ButtonLink>
              <span className="text-sm text-muted">
                Page {grid.page} of {grid.pages}
              </span>
              <ButtonLink
                href={href({ page: String(grid.page + 1) })}
                variant="secondary"
                size="sm"
                aria-disabled={grid.page === grid.pages}
                iconEnd="chevronRight"
                className={grid.page === grid.pages ? 'pointer-events-none opacity-50' : ''}
              >
                Next
              </ButtonLink>
            </div>
          )}
        </>
      )}
    </>
  );
}
