import Link from 'next/link';
import { Badge, Card, PageHeader } from '@/components/ui';
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
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Import Studio" description="Bring your existing menu into MenuNiva. Nothing changes on your menu until you review and save." />

      <GlovoImportForm org={ctx.org.slug} defaultUrl={glovoUrl} />

      <AdvancedImport org={ctx.org.slug} adapters={adapterStatuses()} menuHref={`${base}/menu`} />

      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">Recent imports</h2>
          {jobs.length > 0 && <span className="text-xs text-muted tabular-nums">{jobs.length}</span>}
        </div>
        {jobs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted" data-testid="no-imports">
            No imports yet. Paste your Glovo link above to start.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {jobs.map((j) => {
              const s = JOB[j.status];
              const first = j.sources[0];
              const detail = first ? sourceDetail(first) : null;
              return (
                <li key={j.id} data-testid="recent-import">
                  <Link href={`${base}/import/${j.id}`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {[...new Set(j.sources.map((x) => SRC[x.type]))].join(' + ') || 'No source'}
                        {detail && <span className="font-normal text-muted"> · {detail}</span>}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted tabular-nums">
                        {formatDateTimeInZone(j.createdAt, tz, tag)} · {j._count.products} {j._count.products === 1 ? 'product' : 'products'}
                      </span>
                    </span>
                    <Badge tone={s.tone} className="shrink-0">
                      {s.label}
                    </Badge>
                    <span className="shrink-0 text-sm text-muted" aria-hidden>
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
