import Link from 'next/link';
import { Badge, buttonClass, ButtonLink, Card, CardHeader, Icon } from '@/components/ui';
import { cn } from '@/lib/cn';
import { displayUrl } from '@/lib/restaurant-link';
import type { RestaurantLink } from '@/server/services/restaurant-link';
import { CopyLinkButton } from './copy-link-button';

/**
 * "Your restaurant link": the public address of the guest menu, with open / copy / preview /
 * QR actions, and — while still a draft — exactly what remains before publishing.
 * Publishing is never automatic: the last step is always the owner's confirmation.
 */
export function RestaurantLinkCard({
  link,
  orgSlug,
  canPublish,
  showPreviewButton = true,
  className,
}: {
  link: RestaurantLink;
  orgSlug: string;
  canPublish: boolean;
  showPreviewButton?: boolean;
  className?: string;
}) {
  const base = `/dashboard/${orgSlug}`;
  const live = link.location.isPublished;
  const qrHref = `/api/dashboard/${orgSlug}/restaurant-qr?location=${link.location.id}`;
  return (
    <Card className={cn('overflow-hidden', className)} data-testid="restaurant-link-card" data-status={live ? 'published' : 'draft'}>
      <CardHeader
        icon="globe"
        title="Your restaurant link"
        description={live ? 'Guests open your menu here. Share it anywhere or print the QR code.' : 'This will be your public address. It shows the menu once you publish.'}
        action={
          live ? (
            <Badge tone="success" dot data-testid="link-status">
              Published
            </Badge>
          ) : (
            <Badge tone="warning" dot data-testid="link-status">
              Draft · not public
            </Badge>
          )
        }
      />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-line bg-surface-2/60 px-3 py-2.5">
          <Icon name="globe" className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink select-all" title={link.url} data-testid="restaurant-url" data-url={link.url}>
            {displayUrl(link.url)}
          </span>
          {link.local && (
            <Badge tone="warning" className="shrink-0">
              Local
            </Badge>
          )}
        </div>
        {link.local && (
          <p className="flex items-start gap-2 text-xs text-warning" data-testid="link-local-warning">
            <Icon name="alert" className="mt-px size-3.5 shrink-0" />
            This is a development address that guests cannot reach. Set APP_BASE_URL to your public domain before sharing the link or printing the QR code.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {live ? (
            <a href={link.path} target="_blank" rel="noopener" className={buttonClass('primary', 'md')} data-testid="open-restaurant">
              <Icon name="external" /> Open restaurant website
            </a>
          ) : (
            <span className={buttonClass('primary', 'md', 'pointer-events-none opacity-45')} aria-disabled="true" title="Available once your restaurant is published" data-testid="open-restaurant">
              <Icon name="lock" /> Open restaurant website
            </span>
          )}
          <CopyLinkButton value={link.url} label="Copy restaurant link" testId="copy-restaurant-link" />
          {showPreviewButton && (
            <ButtonLink href={`${base}/preview`} variant="secondary" icon="phone" data-testid="preview-mobile-menu">
              Preview mobile menu
            </ButtonLink>
          )}
          <a href={qrHref} download className={buttonClass('secondary', 'md')} data-testid="download-restaurant-qr">
            <Icon name="qr" /> Download QR code
          </a>
        </div>
        {!live && <p className="text-xs text-muted">The QR code can be printed now: until you publish, scanning it shows a “not published yet” notice, never your draft menu.</p>}

        {!live && (
          <div className="rounded-lg border border-line" data-testid="publish-remaining">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
              <p className="text-[13px] font-semibold text-ink">{link.blockers.length > 0 ? `Before you can publish · ${link.blockers.length} left` : 'Ready to publish'}</p>
              {canPublish && (
                <ButtonLink href={`${base}/setup/publish`} size="sm" variant={link.blockers.length > 0 ? 'secondary' : 'primary'} iconEnd="arrowRight" data-testid="go-publish">
                  {link.blockers.length > 0 ? 'Open publish checklist' : 'Review and publish'}
                </ButtonLink>
              )}
            </div>
            {link.blockers.length > 0 ? (
              <ul className="space-y-1.5 px-3.5 py-3">
                {link.blockers.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-[13px] text-ink-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                    {b}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3.5 py-3 text-[13px] text-ink-2">Everything required is in place. Publishing only happens when you confirm it on the publish page.</p>
            )}
            {link.warnings.length > 0 && (
              <details className="group border-t border-line px-3.5 py-1 text-xs text-muted">
                <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 font-medium text-ink-2 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                  <Icon name="chevronRight" className="size-3.5 transition-transform group-open:rotate-90 rtl:rotate-180" />
                  {link.warnings.length} recommendations
                </summary>
                <ul className="mb-2 space-y-1 ps-4.5">
                  {link.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {live && link.location.publishedAt && (
          <p className="text-xs text-muted">
            Live since {link.location.publishedAt.toISOString().slice(0, 10)}.{' '}
            {canPublish && (
              <Link href={`${base}/setup/publish`} className="underline underline-offset-2 hover:text-ink">
                Publication settings
              </Link>
            )}
          </p>
        )}
      </div>
    </Card>
  );
}
