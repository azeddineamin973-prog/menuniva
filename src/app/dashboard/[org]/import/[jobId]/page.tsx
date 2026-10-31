import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InlineAction } from '@/components/forms/inline-action';
import { ProductThumb } from '@/components/dashboard/product-thumb';
import { Alert, Badge, ButtonLink, Card, EmptyState, Icon } from '@/components/ui';
import { LANGUAGE_NATIVE_NAME, LANGUAGE_TAG } from '@/i18n/config';
import { formatCents } from '@/lib/money';
import { formatDateTimeInZone } from '@/lib/time';
import { currentLocation } from '@/server/current-location';
import { UserFacingError } from '@/server/errors';
import { PLATFORM_SOURCES } from '@/server/import/adapters';
import { adapterStatuses, getImportPreview } from '@/server/import/service';
import { requireModulePage } from '@/server/module-page';
import { requireTenantPage } from '@/server/tenant';
import { cancelImportAction, chooseCanonicalAction } from '../actions';
import { AdvancedImport } from '../advanced-import';
import { PublishPanel } from './publish-panel';
import { ReviewTable } from './review-table';
import { SOURCE_LABEL, type ReviewDecision, type ReviewExtraGroup, type ReviewItem, type ReviewSize } from './review-types';

const STATUS: Record<string, { tone: 'neutral' | 'warning' | 'success' | 'danger'; label: string }> = {
  DRAFT: { tone: 'neutral', label: 'Nothing imported yet' },
  NEEDS_REVIEW: { tone: 'warning', label: 'Ready to review' },
  PUBLISHED: { tone: 'success', label: 'Saved to menu' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
  FAILED: { tone: 'danger', label: 'Failed' },
};

type Summary = { created: number; visible: number; drafts: number; linkedPrices: number; modifierGroups?: number; imagesRequested?: number; imagesSaved?: number; ownPhotos?: number; withoutStation?: number };

/** Narrows the JSON columns written by the parsers; anything malformed is dropped, never guessed. */
function sizesOf(v: unknown): ReviewSize[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((s) => (s && typeof s === 'object' && typeof (s as ReviewSize).name === 'string' ? [{ name: (s as ReviewSize).name, priceCents: typeof (s as ReviewSize).priceCents === 'number' ? (s as ReviewSize).priceCents : undefined }] : []));
}
function extrasOf(v: unknown): ReviewExtraGroup[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((g) => {
    const group = g as ReviewExtraGroup | null;
    if (!group || typeof group.name !== 'string' || !Array.isArray(group.options)) return [];
    const options = group.options.filter((o) => o && typeof o.name === 'string').map((o) => ({ name: o.name, priceDeltaCents: typeof o.priceDeltaCents === 'number' ? o.priceDeltaCents : undefined }));
    return options.length ? [{ name: group.name, minSelect: group.minSelect, maxSelect: group.maxSelect, options }] : [];
  });
}
/** The photo the source gave: remembered in `raw` once the owner changes it, otherwise the current one. */
function sourcePhoto(raw: unknown, current: string | null): string | null {
  if (raw && typeof raw === 'object' && 'sourceImageUrl' in raw) {
    const v = (raw as { sourceImageUrl?: unknown }).sourceImageUrl;
    return typeof v === 'string' ? v : null;
  }
  return current && !current.startsWith('/media/') ? current : null;
}
function sourceDetail(s: { url: string | null; fileName: string | null }) {
  if (s.fileName) return s.fileName;
  if (!s.url) return null;
  try {
    return new URL(s.url).pathname.split('/').filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

export default async function ImportJobPage({ params }: { params: Promise<{ org: string; jobId: string }> }) {
  const { org, jobId } = await params;
  const ctx = await requireTenantPage(org, 'import.manage');
  await requireModulePage(ctx, 'import');
  let data;
  try {
    data = await getImportPreview(ctx, jobId);
  } catch (e) {
    if (e instanceof UserFacingError) notFound();
    throw e;
  }
  const location = await currentLocation(ctx);
  const { job, sources, products, mappings, summary, existingProducts, stations, stationTargets, categoryOptions } = data;
  const base = `/dashboard/${ctx.org.slug}`;
  const reviewing = job.status === 'NEEDS_REVIEW';
  const canAddSource = job.status === 'DRAFT' || job.status === 'NEEDS_REVIEW';
  const existingName = new Map(existingProducts.map((e) => [e.id, e.name]));

  const items: ReviewItem[] = products.map((p) => {
    const decision = (p.decision?.decision ?? 'CREATE') as ReviewDecision;
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      categoryName: p.categoryName,
      priceCents: p.priceCents,
      imageUrl: p.imageUrl,
      sourceImageUrl: sourcePhoto(p.raw, p.imageUrl),
      available: p.available,
      sizes: sizesOf(p.variants),
      extras: extrasOf(p.modifiers),
      warnings: p.warnings,
      sourceType: p.source.type,
      platform: PLATFORM_SOURCES.includes(p.source.type),
      decision,
      targetProductId: p.decision?.targetProductId ?? null,
      mergeGroupKey: p.decision?.mergeGroupKey ?? null,
      similarTo: decision === 'SKIP' && p.decision?.targetProductId ? (existingName.get(p.decision.targetProductId) ?? null) : null,
    };
  });
  const toCreate = items.filter((i) => i.decision === 'CREATE');
  const byId = new Map(items.map((i) => [i.id, i]));
  const groups = mappings.filter((m) => !m.existingProductId);
  const failedSources = sources.filter((s) => s.status !== 'PARSED' && s.errorMessage);
  const s = STATUS[job.status];
  const result = job.status === 'PUBLISHED' ? (job.summary as Summary | null) : null;
  const tz = location?.timeZone ?? 'Europe/Lisbon';
  const tag = LANGUAGE_TAG[ctx.user.preferredLanguage];
  const translationNote = summary.otherLanguages.length
    ? `Translation required for ${summary.otherLanguages.map((l) => LANGUAGE_NATIVE_NAME[l]).join(', ')} (names stay in ${LANGUAGE_NATIVE_NAME[job.sourceLanguage]}).`
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href={`${base}/import`} className="inline-flex min-h-9 items-center gap-1 text-[13px] text-muted hover:text-ink pointer-coarse:min-h-10">
            <Icon name="arrowLeft" className="size-3.5 rtl:rotate-180" /> Import Studio
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Review import</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={s.tone} data-testid="job-status">
              {s.label}
            </Badge>
            {sources.map((src) => {
              const detail = sourceDetail(src);
              return (
                <span key={src.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs" data-testid="import-source" title={src.url ?? undefined}>
                  <span className="font-medium text-ink">{SOURCE_LABEL[src.type]}</span>
                  {detail && <span className="truncate text-muted">{detail}</span>}
                  {src.status !== 'PARSED' && <span className="text-danger">· {src.status.toLowerCase()}</span>}
                </span>
              );
            })}
            <span className="text-xs text-muted">{formatDateTimeInZone(job.createdAt, tz, tag)}</span>
          </div>
        </div>
        {canAddSource && (
          <div className="flex flex-wrap items-center gap-2">
            <InlineAction action={cancelImportAction} fields={{ org: ctx.org.slug, jobId: job.id }} label="Cancel import" variant="ghost" size="md" confirm="Cancel this import? The extracted products are discarded. Your menu is not changed." />
            {reviewing && toCreate.length > 0 && (
              <ButtonLink href="#finish" data-testid="go-finish">
                Save to menu ↓
              </ButtonLink>
            )}
          </div>
        )}
      </div>

      {result && (
        <section className="rounded-[var(--radius-card)] border border-success/30 bg-success/5 p-5" data-testid="publish-result">
          <h2 className="text-base font-semibold text-ink">Import saved to your menu</h2>
          <p className="mt-1 text-sm text-ink/80" data-testid="publish-summary">
            {result.created} {result.created === 1 ? 'product' : 'products'} created: {result.drafts} {result.drafts === 1 ? 'draft' : 'drafts'}, {result.visible} visible.
            {result.imagesRequested ? ` ${result.imagesSaved ?? 0} of ${result.imagesRequested} photos copied.` : result.ownPhotos ? '' : ' No photos copied.'}
            {result.ownPhotos ? ` ${result.ownPhotos} uploaded ${result.ownPhotos === 1 ? 'photo' : 'photos'} added.` : ''}
            {result.modifierGroups ? ` ${result.modifierGroups} option ${result.modifierGroups === 1 ? 'group' : 'groups'} created.` : ''}
            {result.linkedPrices ? ` ${result.linkedPrices} platform ${result.linkedPrices === 1 ? 'price' : 'prices'} linked.` : ''}
          </p>
          {!!result.withoutStation && (
            <p className="mt-1 text-sm text-warning" data-testid="publish-unrouted">
              <Icon name="alert" className="me-1 inline size-4 align-[-3px]" />{result.withoutStation} dishes have no preparation station and will not appear on any kitchen screen.
            </p>
          )}
          <p className="mt-2 text-sm text-muted">Next: add your dine-in prices in the menu, then make the dishes visible to guests.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href={`${base}/menu`}>Open menu</ButtonLink>
            <ButtonLink href={`${base}/import`} variant="secondary">
              Back to Import Studio
            </ButtonLink>
          </div>
        </section>
      )}
      {job.status === 'CANCELLED' && <Alert tone="info">This import was cancelled. Your menu was not changed.</Alert>}
      {failedSources.map((src) => (
        <Alert key={src.id} tone="warning" title={`${SOURCE_LABEL[src.type]} could not be read`}>
          <span className="whitespace-pre-wrap">{src.errorMessage}</span>
        </Alert>
      ))}

      {items.length === 0 ? (
        canAddSource && <EmptyState title="Nothing imported yet" description="Add a source below to extract products into this import." />
      ) : (
        <ReviewTable org={ctx.org.slug} jobId={job.id} items={items} editable={reviewing} categories={categoryOptions} existingProducts={existingProducts} />
      )}

      {groups.length > 0 && (
        <Card>
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-base font-semibold text-ink">Same dish in several sources ({groups.length})</h2>
            <p className="mt-0.5 text-sm text-muted">Choose which version becomes your dish. The others only add their platform price as a reference.</p>
          </div>
          <ul className="divide-y divide-line">
            {groups.map((g) => (
              <li key={g.id} className="px-5 py-4" data-testid="duplicate-group">
                <p className="mb-2 text-xs text-muted">{g.confidence}% similar</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {g.importedProductIds.map((id) => {
                    const p = byId.get(id);
                    if (!p) return null;
                    const chosen = p.decision === 'CREATE';
                    return (
                      <div key={id} className={`flex gap-3 rounded-xl border p-3 text-sm ${chosen ? 'border-graphite ring-1 ring-graphite dark:border-lime dark:ring-lime' : 'border-line'}`}>
                        <ProductThumb src={p.imageUrl} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <Badge>{SOURCE_LABEL[p.sourceType]}</Badge>
                            {chosen ? <Badge tone="lime">Chosen version</Badge> : reviewing && <InlineAction action={chooseCanonicalAction} fields={{ org: ctx.org.slug, jobId: job.id, mappingId: g.id, importedProductId: id }} label="Use this version" testId="choose-canonical" />}
                          </div>
                          <p className="mt-1.5 truncate font-medium">{p.name}</p>
                          <p className="text-xs text-muted tabular-nums">
                            {p.priceCents === null ? 'No price' : formatCents(p.priceCents)}
                            {p.platform && ' · reference price'}
                            {p.categoryName && ` · ${p.categoryName}`}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {reviewing && (
        <PublishPanel
          org={ctx.org.slug}
          jobId={job.id}
          toCreate={summary.toCreate}
          photos={toCreate.filter((i) => i.imageUrl && !i.imageUrl.startsWith('/media/')).length}
          ownPhotos={toCreate.filter((i) => i.imageUrl?.startsWith('/media/')).length}
          canMakeVisible={toCreate.some((i) => !i.platform && i.priceCents !== null)}
          platformPrices={toCreate.some((i) => i.platform)}
          stations={stations}
          stationTargets={stationTargets}
          stationsHref={`${base}/stations`}
          before={summary.before}
          after={summary.after}
          newCategories={summary.after.newCategories}
          translationNote={translationNote}
        />
      )}

      {canAddSource && (
        <AdvancedImport org={ctx.org.slug} jobId={job.id} adapters={adapterStatuses()} title="Add another source" defaultOpen={items.length === 0} />
      )}
    </div>
  );
}
