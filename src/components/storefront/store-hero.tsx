import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icons';
import { MediaImage } from '@/components/ui/media-image';
import { OpenStatus } from './order-modes';

/**
 * Store banner at the top of the pickup / delivery menu, like a big shop's store page: the
 * restaurant's cover photo, its logo resting on the photo's edge, then its name, tagline and
 * whether it is open. Only rendered when the restaurant uploaded a cover (Settings → Branding).
 */
export function StoreHero({
  name,
  coverUrl,
  logoUrl,
  tagline,
  address,
  openNow,
  labels,
  serif,
  homeHref,
  homeLabel,
}: {
  name: string;
  coverUrl: string;
  logoUrl: string | null;
  tagline: string | null;
  address: string | null;
  openNow: boolean | null;
  labels: { openNow: string; closedNow: string };
  serif: boolean;
  /** The restaurant's home page: the logo and name link to it. */
  homeHref?: string;
  homeLabel?: string;
}) {
  const logo = logoUrl && (
    <MediaImage src={logoUrl} sizes="96px" widths={[160, 320]} className="size-20 shrink-0 rounded-2xl bg-white object-contain p-1 shadow-[var(--sf-shadow-card)] ring-4 ring-sf-bg sm:size-24" width={96} height={96} decoding="async" />
  );
  const title = (
    <p dir="auto" title={name} className={cn('min-w-0 flex-1 truncate pb-0.5 text-[1.6rem] leading-tight sm:text-[2.2rem]', serif ? 'font-serif' : 'font-semibold tracking-tight')}>
      {name}
    </p>
  );
  return (
    <section className="mx-auto max-w-7xl sm:px-6 sm:pt-5" data-testid="store-hero">
      <div className="relative h-44 overflow-hidden bg-sf-sunken sm:h-60 sm:rounded-3xl lg:h-72">
        {/* The largest image of the page: requested first. Phones get at most the 960 px copy. */}
        <MediaImage src={coverUrl} sizes="(min-width: 1280px) 1232px, 100vw" widths={[640, 960, 1280, 1920]} phoneWidths={[640, 960]} className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" decoding="async" />
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
      </div>
      {/* The logo rests on the photo's lower edge; the name sits beside it, below the photo. */}
      <div className={cn('relative flex items-end gap-4 px-4 sm:px-0', logoUrl ? '-mt-10 sm:-mt-12 sm:ps-6' : 'pt-4')}>
        {homeHref ? (
          <Link href={homeHref} title={homeLabel} className="flex min-w-0 flex-1 items-end gap-4 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current" data-testid="store-hero-home-link">
            {logo}
            {title}
          </Link>
        ) : (
          <>
            {logo}
            {title}
          </>
        )}
      </div>
      <div className="px-4 pt-2.5 sm:px-0">
        {tagline && (
          <p dir="auto" className="mb-2 max-w-2xl text-[15px] text-sf-muted">
            {tagline}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sf-text">
          <OpenStatus open={openNow} labels={labels} />
          {address && (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-sf-muted">
              <Icon name="map" className="size-4 shrink-0" />
              <span className="truncate">{address}</span>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
