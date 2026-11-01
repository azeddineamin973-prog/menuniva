import Link from 'next/link';
import { Badge, ButtonLink, buttonClass, Icon, wrapButtonClass } from '@/components/ui';
import { cn } from '@/lib/cn';
import { displayUrl } from '@/lib/restaurant-link';
import type { RestaurantLink } from '@/server/services/restaurant-link';
import { CopyLinkButton } from './copy-link-button';

/**
 * Sharing and publication, compact, for the Preview Studio's control column: open the website,
 * copy the link, download the QR code, and what (if anything) still blocks publishing. A local or
 * test address is always labelled as such, so it is never mistaken for a link guests can open.
 * (The publication status badge is in the studio header, next to the restaurant name.)
 */
export function PreviewSharePanel({ link, orgSlug, canPublish }: { link: RestaurantLink; orgSlug: string; canPublish: boolean }) {
  const base = `/dashboard/${orgSlug}`;
  const live = link.location.isPublished;
  const qrHref = `/api/dashboard/${orgSlug}/restaurant-qr?location=${link.location.id}`;
  return (
    <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface" data-testid="restaurant-link-card" data-status={live ? 'published' : 'draft'}>
      <section className="space-y-3 p-4" aria-labelledby="share-title">
        <h2 id="share-title" className="text-sm font-semibold text-ink">
          Share
        </h2>
        {live ? (
          <a href={link.path} target="_blank" rel="noopener" className={buttonClass('primary', 'md', 'w-full justify-center')} data-testid="open-restaurant">
            <Icon name="external" /> Open restaurant website
          </a>
        ) : (
          <span className={buttonClass('primary', 'md', 'pointer-events-none w-full justify-center opacity-45')} aria-disabled="true" title="Available once your restaurant is published" data-testid="open-restaurant">
            <Icon name="lock" /> Open restaurant website
          </span>
        )}
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-3 py-2">
          <Icon name="globe" className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink select-all" title={link.url} data-testid="restaurant-url" data-url={link.url}>
            {displayUrl(link.url)}
          </span>
          {link.local && (
            <Badge tone="warning" className="shrink-0">
              Test address
            </Badge>
          )}
        </div>
        {link.local && (
          <p className="flex items-start gap-1.5 text-xs text-warning" data-testid="link-local-warning">
            <Icon name="alert" className="mt-px size-3.5 shrink-0" />
            Guests cannot open this development address. Set APP_BASE_URL to your public domain before sharing the link or printing the QR code.
          </p>
        )}
        <CopyLinkButton value={link.url} label={link.local ? 'Copy test link' : 'Copy restaurant link'} testId="copy-restaurant-link" className={cn('w-full justify-center', wrapButtonClass)} />
        <div className="flex items-start gap-3">
          {/* The real code, encoding the public address above (never the preview address). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${qrHref}&format=svg`} alt={`QR code for ${displayUrl(link.url)}`} width={72} height={72} className="size-18 shrink-0 rounded-md border border-line bg-white p-1" loading="lazy" decoding="async" data-testid="restaurant-qr-preview" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs text-muted">{live ? 'For tables, the window or flyers: it opens your menu.' : 'Printable now: until you publish, scanning it shows a “not published yet” notice, never your draft.'}</p>
            <a href={qrHref} download className={buttonClass('secondary', 'sm', cn('w-full justify-center', wrapButtonClass))} data-testid="download-restaurant-qr">
              <Icon name="download" /> {link.local ? 'Download test QR code' : 'Download QR code'}
            </a>
          </div>
        </div>
      </section>

      <section className="space-y-2.5 p-4" aria-labelledby="publication-title">
        <div className="flex items-center justify-between gap-2">
          <h2 id="publication-title" className="text-sm font-semibold text-ink">
            Publication
          </h2>
          {canPublish && (
            <ButtonLink href={`${base}/setup/publish`} size="sm" variant={!live && link.blockers.length === 0 ? 'primary' : 'secondary'} iconEnd="arrowRight" data-testid="go-publish">
              {live ? 'Settings' : link.blockers.length > 0 ? 'Checklist' : 'Review and publish'}
            </ButtonLink>
          )}
        </div>
        {live ? (
          <p className="text-[13px] text-ink-2">
            Live{link.location.publishedAt ? ` since ${link.location.publishedAt.toISOString().slice(0, 10)}` : ''}. Guests can order and book.
            {canPublish && (
              <>
                {' '}
                <Link href={`${base}/setup/publish`} className="underline underline-offset-2 hover:text-ink">
                  Publication settings
                </Link>
              </>
            )}
          </p>
        ) : (
          <div data-testid="publish-remaining">
            {link.blockers.length > 0 ? (
              <>
                <p className="mb-1.5 text-[13px] font-medium text-ink">Before you can publish · {link.blockers.length} left</p>
                <ul className="space-y-1">
                  {link.blockers.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-[13px] text-ink-2">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                      {b}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-[13px] text-ink-2">Ready to publish. Publishing happens only when you confirm it on the publish page.</p>
            )}
            {link.warnings.length > 0 && (
              <details className="group mt-2 text-xs text-muted">
                <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 font-medium text-ink-2 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                  <Icon name="chevronRight" className="size-3.5 transition-transform group-open:rotate-90 rtl:rotate-180" />
                  {link.warnings.length} recommendation{link.warnings.length === 1 ? '' : 's'}
                </summary>
                <ul className="mt-1 space-y-1 ps-4.5">
                  {link.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
