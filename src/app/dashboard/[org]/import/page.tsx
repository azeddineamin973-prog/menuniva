import Link from 'next/link';
import { Badge, Card, CardHeader, Icon, PageHeader } from '@/components/ui';
import { LANGUAGE_TAG } from '@/i18n/config';
import { formatDateTimeInZone } from '@/lib/time';
import { currentLocation } from '@/server/current-location';
import { adapterStatuses, listImportJobs, savedGlovoUrl } from '@/server/import/service';
import { requireModulePage } from '@/server/module-page';
import { requireTenantPage } from '@/server/tenant';
import { AdvancedImport } from './advanced-import';
import { GlovoImportForm } from './glovo-import-form';

const SRC: Record<string, string> = { CSV: 'CSV', XLSX: 'Excel', PDF: 'PDF', TEXT: 'Text', GLOVO: 'Glovo', UBER_EATS: 'Uber Eats', IMAGE: 'Photo', MANUAL: 'Manual' };
const JOB: Record<string, { tone: 'neutral' | 'warning' | 'success' | 'danger'; label: string }> = {
  DRAFT: { tone: 'neutral', label: 'Empty' },
  NEEDS_REVIEW: { tone: 'warning', label: 'Ready to review' },
  PUBLISHED: { tone: 'success', label: 'Saved to menu' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
  FAILED: { tone: 'danger', label: 'Failed' },
};

/** "glovoapp.com/…/stores/casa-de-marrocos-brg" → "casa-de-marrocos-brg"; file sources show the file name. */
function sourceDetail(s: { url: string | null; fileName: string | null }) {
  if (s.fileName) return s.fileName;
  if (!s.url) return null;
  try {
    return new URL(s.url).pathname.split('/').filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

export default async function ImportStudioPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await requireTenantPage(org, 'import.manage');
  await requireModulePage(ctx, 'import');
  const [jobs, glovoUrl, location] = await Promise.all([listImportJobs(ctx), savedGlovoUrl(ctx), currentLocation(ctx)]);
  const base = `/dashboard/${ctx.org.slug}`;
  const tz = location?.timeZone ?? 'Europe/Lisbon';
  const tag = LANGUAGE_TAG[ctx.user.preferredLanguage];

  return (
    <>
      <PageHeader title="Import Studio" description="Bring your existing menu into MenuNiva. Nothing changes on your menu until you review and save." />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <GlovoImportForm org={ctx.org.slug} defaultUrl={glovoUrl} />
          <AdvancedImport org={ctx.org.slug} adapters={adapterStatuses()} menuHref={`${base}/menu`} />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Recent imports" icon="clock" action={jobs.length > 0 && <span className="text-xs text-muted tabular-nums">{jobs.length}</span>} />
            {jobs.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted" data-testid="no-imports">
                No imports yet. Paste your Glovo link to start.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {jobs.map((j) => {
                  const s = JOB[j.status];
                  const first = j.sources[0];
                  const detail = first ? sourceDetail(first) : null;
                  return (
                    <li key={j.id} data-testid="recent-import">
                      <Link href={`${base}/import/${j.id}`} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60 sm:px-5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">
                            {[...new Set(j.sources.map((x) => SRC[x.type]))].join(' + ') || 'No source'}
                            {detail && <span className="font-normal text-muted"> · {detail}</span>}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted tabular-nums">
                            {formatDateTimeInZone(j.createdAt, tz, tag)} · {j._count.products} {j._count.products === 1 ? 'product' : 'products'}
                          </span>
                        </span>
                        <Badge tone={s.tone} dot className="shrink-0">
                          {s.label}
                        </Badge>
                        <Icon name="chevronRight" className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* The three steps, so the owner knows nothing is published behind their back. */}
          <Card className="p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-ink">How importing works</h2>
            <ol className="mt-3 space-y-3">
              {(
                [
                  ['import', 'Bring your menu in', 'From a Glovo link or a file. Takes a few seconds.'],
                  ['eye', 'Review what was found', 'Fix names, prices, categories and photos.'],
                  ['check', 'Save as drafts', 'Dishes stay hidden from guests until you make them visible.'],
                ] as const
              ).map(([icon, title, text], i) => (
                <li key={title} className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2" aria-hidden>
                    <Icon name={icon} className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">
                      {i + 1}. {title}
                    </span>
                    <span className="block text-xs text-muted">{text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
