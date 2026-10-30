import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { Alert, Badge, ButtonLink, Card, CardBody, CardHeader, Checkbox, PageHeader, Select, Stat } from '@/components/ui';
import { LANGUAGE_NATIVE_NAME } from '@/i18n/config';
import { formatCents } from '@/lib/money';
import { UserFacingError } from '@/server/errors';
import { getImportPreview } from '@/server/import/service';
import { requireModulePage } from '@/server/modules';
import { requireTenantPage } from '@/server/tenant';
import { cancelImportAction, chooseCanonicalAction, publishImportAction, setDecisionAction } from '../actions';
import { AddSourceForm } from './source-form';

const SRC: Record<string, string> = { CSV: 'CSV', XLSX: 'Excel', PDF: 'PDF', TEXT: 'Text', GLOVO: 'Glovo', UBER_EATS: 'Uber Eats', IMAGE: 'Photo', MANUAL: 'Manual' };
const DECISION: Record<string, string> = { CREATE: 'Create new dish', MERGE_WITH_IMPORTED: 'Merge into chosen version', MERGE_INTO_EXISTING: 'Link to existing dish', SKIP: 'Skip' };
const METHOD: Record<string, string> = { STRUCTURED_FILE: 'Structured file', NATIVE_TEXT: 'Native PDF text', OCR: 'OCR', AI_ASSISTED: 'AI-assisted', PARTNER_API: 'Partner API', MANUAL_PASTE: 'Pasted text' };

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
  const { job, sources, products, mappings, summary, existingProducts } = data;
  const base = `/dashboard/${ctx.org.slug}`;
  const open = job.status === 'DRAFT' || job.status === 'NEEDS_REVIEW';
  const money = (c: number | null) => (c === null ? '—' : formatCents(c));
  const byId = new Map(products.map((p) => [p.id, p]));
  const groups = mappings.filter((m) => !m.existingProductId);
  const fields = (extra: Record<string, string>) => ({ org: ctx.org.slug, jobId: job.id, ...extra });

  return (
    <>
      <PageHeader
        title="Review import"
        description={`Source language: ${LANGUAGE_NATIVE_NAME[job.sourceLanguage]}. Check every item. Nothing changes on your menu until you press Publish.`}
        actions={
          <>
            <Badge tone={job.status === 'PUBLISHED' ? 'success' : job.status === 'NEEDS_REVIEW' ? 'warning' : 'neutral'} data-testid="job-status">{job.status.replace('_', ' ')}</Badge>
            {open && <InlineAction action={cancelImportAction} fields={fields({})} label="Cancel import" confirm="Cancel this import? Extracted items will be discarded. Your menu is not changed." />}
          </>
        }
      />

      {job.status === 'PUBLISHED' && (
        <div className="mb-6">
          <Alert tone="success" title="Import published">
            {JSON.stringify(job.summary) !== 'null' && (
              <span data-testid="publish-summary">
                {(job.summary as { created: number; visible: number; drafts: number; linkedPrices: number }).created} dishes created ({(job.summary as { visible: number }).visible} visible, {(job.summary as { drafts: number }).drafts} drafts to finish). {(job.summary as { linkedPrices: number }).linkedPrices} platform prices linked.{' '}
              </span>
            )}
            <Link href={`${base}/menu`} className="underline">Open the menu</Link> to add prices, translations and verified allergens.
          </Alert>
        </div>
      )}
      {job.status === 'CANCELLED' && <div className="mb-6"><Alert tone="info">This import was cancelled. Your menu was not changed.</Alert></div>}

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Sources" description="Combine several sources (e.g. Glovo and Uber Eats): duplicates are detected automatically." />
            {sources.length === 0 ? (
              <CardBody className="text-sm text-muted">No source added yet.</CardBody>
            ) : (
              <ul className="divide-y divide-line">
                {sources.map((s) => (
                  <li key={s.id} className="px-5 py-3 text-sm" data-testid="import-source">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{SRC[s.type]} {s.fileName && <span className="text-muted">· {s.fileName}</span>}</span>
                      <span className="flex gap-1.5">
                        {s.extractionMethod && <Badge>{METHOD[s.extractionMethod]}</Badge>}
                        <Badge tone={s.status === 'PARSED' ? 'success' : s.status === 'UNSUPPORTED' ? 'warning' : 'danger'}>{s.status.toLowerCase()}</Badge>
                      </span>
                    </div>
                    {s.url && <p className="truncate text-xs text-muted">Link: {s.url}</p>}
                    {s.errorMessage && <p className="mt-1 text-xs whitespace-pre-wrap text-muted">{s.errorMessage}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {products.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-4" data-testid="import-summary">
              <Stat label="Items detected" value={summary.items} />
              <Stat label="Categories" value={summary.categories} />
              <Stat label="With images" value={summary.images} />
              <Stat label="Warnings" value={summary.warnings} hint={`${summary.missingPrice} without price · ${summary.missingCategory} without category`} />
            </div>
          )}

          {groups.length > 0 && (
            <Card>
              <CardHeader title={`Likely duplicates (${groups.length})`} description="Choose which version becomes your dish. Prices from Glovo/Uber Eats are kept as references only." />
              <ul className="divide-y divide-line">
                {groups.map((g) => (
                  <li key={g.id} className="px-5 py-4" data-testid="duplicate-group">
                    <p className="mb-2 text-xs text-muted">{g.reason} · {g.confidence}% similar</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      {g.importedProductIds.map((id) => {
                        const p = byId.get(id);
                        if (!p) return null;
                        const canonical = p.decision?.decision === 'CREATE';
                        return (
                          <div key={id} className={`rounded-xl border p-3 text-sm ${canonical ? 'border-graphite ring-2 ring-lime' : 'border-line'}`}>
                            <div className="flex items-center justify-between">
                              <Badge>{SRC[p.source.type]}</Badge>
                              {canonical ? <Badge tone="lime">Chosen version</Badge> : open && <InlineAction action={chooseCanonicalAction} fields={fields({ mappingId: g.id, importedProductId: id })} label="Use this version" testId="choose-canonical" />}
                            </div>
                            <p className="mt-2 font-medium">{p.name}</p>
                            {p.description && <p className="text-muted">{p.description}</p>}
                            <p className="mt-1 tabular-nums">{money(p.priceCents)} {['GLOVO', 'UBER_EATS'].includes(p.source.type) && <span className="text-xs text-muted">(platform price — reference only)</span>}</p>
                            {p.imageUrl && <p className="truncate text-xs text-muted">Image: {p.imageUrl}</p>}
                            {p.categoryName && <p className="text-xs text-muted">Category: {p.categoryName}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {products.length > 0 && (
            <Card>
              <CardHeader title="Items" description="Decide what happens to each item. Items similar to dishes already on your menu are skipped by default — nothing is overwritten." />
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="import-items">
                  <thead className="text-xs text-muted uppercase">
                    <tr>
                      <th className="px-4 py-2 text-start">Item</th>
                      <th className="px-4 py-2 text-start">Category</th>
                      <th className="px-4 py-2 text-end">Price</th>
                      <th className="px-4 py-2 text-start">Source</th>
                      <th className="px-4 py-2 text-start">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id} className="border-t border-line align-top" data-testid="import-item">
                        <td className="px-4 py-2">
                          <p className="font-medium">{p.name}</p>
                          {p.description && <p className="line-clamp-2 text-xs text-muted">{p.description}</p>}
                          {(p.variants as { name: string }[] | null)?.length ? <p className="text-xs text-muted">Sizes: {(p.variants as { name: string }[]).map((v) => v.name).join(', ')}</p> : null}
                          {p.warnings.map((w) => <p key={w} className="text-xs text-warning">⚠ {w}</p>)}
                        </td>
                        <td className="px-4 py-2">{p.categoryName ?? <span className="text-muted">—</span>}</td>
                        <td className="px-4 py-2 text-end tabular-nums">{money(p.priceCents)}</td>
                        <td className="px-4 py-2"><Badge>{SRC[p.source.type]}</Badge></td>
                        <td className="px-4 py-2">
                          {open ? (
                            <ActionForm action={setDecisionAction} submitLabel="Apply" submitVariant="secondary" className="flex flex-wrap items-center gap-2 space-y-0">
                              <input type="hidden" name="org" value={ctx.org.slug} />
                              <input type="hidden" name="jobId" value={job.id} />
                              <input type="hidden" name="importedProductId" value={p.id} />
                              <Select name="decision" defaultValue={p.decision?.decision ?? 'CREATE'} className="h-8 w-48 text-xs" aria-label="Decision">
                                <option value="CREATE">{DECISION.CREATE}</option>
                                {p.decision?.mergeGroupKey && <option value="MERGE_WITH_IMPORTED">{DECISION.MERGE_WITH_IMPORTED}</option>}
                                <option value="MERGE_INTO_EXISTING">{DECISION.MERGE_INTO_EXISTING}</option>
                                <option value="SKIP">{DECISION.SKIP}</option>
                              </Select>
                              {existingProducts.length > 0 && (
                                <Select name="targetProductId" defaultValue={p.decision?.targetProductId ?? ''} className="h-8 w-44 text-xs" aria-label="Existing dish">
                                  <option value="">Existing dish…</option>
                                  {existingProducts.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                                </Select>
                              )}
                            </ActionForm>
                          ) : (
                            <span className="text-xs">{DECISION[p.decision?.decision ?? 'CREATE']}</span>
                          )}
                          {p.decision?.decision === 'SKIP' && p.decision.targetProductId && <p className="mt-1 text-xs text-muted">Similar to an existing dish</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {open && (
            <Card>
              <CardHeader title="Add a source" />
              <CardBody><AddSourceForm org={ctx.org.slug} jobId={job.id} /></CardBody>
            </Card>
          )}
          {products.length > 0 && (
            <Card>
              <CardHeader title="Before → after" />
              <CardBody className="space-y-2 text-sm" data-testid="before-after">
                <p className="flex justify-between"><span>Dishes</span><span className="tabular-nums">{summary.before.products} → <strong>{summary.after.products}</strong></span></p>
                <p className="flex justify-between"><span>Categories</span><span className="tabular-nums">{summary.before.categories} → <strong>{summary.after.categories}</strong></span></p>
                {summary.after.newCategories.length > 0 && <p className="text-xs text-muted">New categories: {summary.after.newCategories.join(', ')}</p>}
                <p className="flex justify-between"><span>Skipped / merged</span><span className="tabular-nums">{summary.skipped} / {summary.merged}</span></p>
                <p className="flex justify-between"><span>Missing descriptions</span><span className="tabular-nums">{summary.missingDescription}</span></p>
                {summary.otherLanguages.length > 0 && (
                  <p className="text-xs text-muted">
                    Translation required: {summary.translationRequired} texts ({summary.otherLanguages.map((l) => LANGUAGE_NATIVE_NAME[l]).join(', ')}). Imported text is kept in {LANGUAGE_NATIVE_NAME[job.sourceLanguage]}; translate it afterwards in Menu → Translations.
                  </p>
                )}
                <p className="text-xs text-muted">Allergen information is never imported as verified — declare and confirm it per dish.</p>
              </CardBody>
            </Card>
          )}
          {job.status === 'NEEDS_REVIEW' && (
            <Card>
              <CardHeader title="Publish" />
              <CardBody>
                <ActionForm action={publishImportAction} submitLabel={`Publish ${summary.toCreate} new dishes`} testId="publish-import-form">
                  <input type="hidden" name="org" value={ctx.org.slug} />
                  <input type="hidden" name="jobId" value={job.id} />
                  <Checkbox name="makeVisible" label="Make dishes visible to guests now" description="Only dishes with a price from your own file. Platform-only prices and dishes without price stay as drafts." />
                  {summary.images > 0 && <Checkbox name="imageRights" label="I have the right to publish the imported photos" description="Photos are copied to MenuNiva only with this confirmation." />}
                  <Checkbox name="confirm" label="I reviewed the items above." />
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {job.status === 'PUBLISHED' && <ButtonLink href={`${base}/import`} variant="secondary">Back to Import Studio</ButtonLink>}
        </div>
      </div>
    </>
  );
}
