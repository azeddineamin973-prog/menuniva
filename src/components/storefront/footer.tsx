import Link from 'next/link';
import type { Messages } from '@/i18n';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icons';
import { MediaImage } from '@/components/ui/media-image';
import type { FooterData, FooterSocial } from '@/server/services/storefront-footer';
import { StorefrontHours } from './opening-hours';

/** The footer's words, in the guest's language. */
export function footerLabels(m: Messages): Labels {
  const o = m.ordering;
  const c = m.customer;
  return {
    footerVisit: o.footerVisit,
    footerOrder: o.footerOrder,
    footerFollow: o.footerFollow,
    footerMenu: o.footerMenu,
    today: o.today,
    directions: c.directions,
    call: c.call,
    leaveFeedback: c.leaveFeedback,
    openingHours: c.openingHours,
    openNow: c.openNow,
    closedNow: c.closedNow,
    closedDay: c.closedDay,
    poweredBy: m.common.poweredBy,
  };
}

type Labels = {
  footerVisit: string;
  footerOrder: string;
  footerFollow: string;
  footerMenu: string;
  today: string;
  directions: string;
  call: string;
  leaveFeedback: string;
  openingHours: string;
  openNow: string;
  closedNow: string;
  closedDay: string;
  poweredBy: string;
};

/**
 * Storefront footer, the same on every tenant: a deep tone of the restaurant's own colour with
 * its name and links, where to find it, opening hours and the ways to order. Columns on desktop,
 * stacked on phones. Shows only what the restaurant entered.
 */
export function StorefrontFooter({ data, labels, wide = false, reserveBottom = false }: { data: FooterData; labels: Labels; wide?: boolean; reserveBottom?: boolean }) {
  const heading = 'mb-3 text-[12px] font-semibold tracking-[0.14em] text-white/55 uppercase';
  const row = 'flex min-h-11 items-center gap-3 rounded-xl text-[15px] text-white/90 transition-colors hover:text-white';
  return (
    <footer className="mt-14 bg-sf-footer text-white [color-scheme:dark]" data-testid="storefront-footer">
      <div aria-hidden className="h-[3px] bg-sf-accent" />
      {/* Phones: room for the fixed order bar, so it never covers the last line. */}
      <div className={cn('mx-auto px-5 pt-10 sm:px-6 lg:pt-14', wide ? 'max-w-7xl' : 'max-w-5xl', reserveBottom ? 'pb-32 lg:pb-8' : 'pb-8')}>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr] lg:gap-10">
          {/* The restaurant */}
          <div>
            <div className="flex items-center gap-3.5">
              {data.logoUrl && <MediaImage src={data.logoUrl} sizes="56px" widths={[160]} className="size-14 shrink-0 rounded-2xl bg-white object-contain p-1" width={56} height={56} loading="lazy" decoding="async" />}
              <div className="min-w-0">
                <p dir="auto" className="font-serif text-[1.45rem] leading-tight break-words">
                  {data.name}
                </p>
                {data.tagline && (
                  <p dir="auto" className="mt-0.5 line-clamp-2 text-sm text-white/65">
                    {data.tagline}
                  </p>
                )}
              </div>
            </div>
            <a href={data.menuHref} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-[15px] font-semibold ring-1 ring-white/15 transition-colors hover:bg-white/15">
              <Icon name="book" className="size-4" />
              {labels.footerMenu}
            </a>
            {data.socials.length > 0 && (
              <div className="mt-6">
                <p className={heading}>{labels.footerFollow}</p>
                <ul className="flex flex-wrap gap-2">
                  {data.socials.map((s) => (
                    <li key={s.href}>
                      <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label} title={s.label} className="flex size-11 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15 transition-colors hover:bg-white hover:text-[#111]">
                        <SocialIcon kind={s.kind} />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Where to find it */}
          {(data.address || data.phone) && (
            <div data-testid="storefront-contact">
              <h2 className={heading}>{labels.footerVisit}</h2>
              <div className="space-y-1">
                {data.address && (
                  <p className="flex items-start gap-3 py-2 text-[15px] text-white/90">
                    <Icon name="map" className="mt-0.5 size-5 shrink-0 opacity-70" />
                    <span>
                      <span className="block">{data.address}</span>
                      {data.mapsHref && (
                        <a href={data.mapsHref} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center gap-1.5 font-semibold text-white underline-offset-4 hover:underline">
                          {labels.directions}
                          <Icon name="arrowRight" className="size-4 rtl:rotate-180" />
                        </a>
                      )}
                    </span>
                  </p>
                )}
                {data.phone && (
                  <a href={`tel:${data.phone.replace(/\s/g, '')}`} className={row} aria-label={`${labels.call} ${data.phone}`}>
                    <Icon name="phone" className="size-5 shrink-0 opacity-70" />
                    <span dir="ltr" className="font-medium">
                      {data.phone}
                    </span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Opening hours */}
          {data.hours && Object.keys(data.hours).length > 0 && (
            <div>
              <h2 className={heading}>{labels.openingHours}</h2>
              <StorefrontHours hours={data.hours} timeZone={data.timeZone} tag={data.tag} m={labels} tone="dark" todayLabel={labels.today} />
            </div>
          )}

          {/* Ways to order */}
          {(data.order.length > 0 || data.feedbackHref) && (
            <nav aria-label={labels.footerOrder}>
              <h2 className={heading}>{labels.footerOrder}</h2>
              <ul className="space-y-0.5" data-testid="other-modes">
                {data.order.map((a) => (
                  <li key={a.href}>
                    {a.external ? (
                      <a href={a.href} target="_blank" rel="noopener noreferrer" className={row}>
                        <Icon name="truck" className="size-5 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1">{a.label}</span>
                        <Icon name="external" className="size-4 shrink-0 opacity-50" />
                      </a>
                    ) : (
                      <Link href={a.href} className={row}>
                        <Icon name={a.icon} className="size-5 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1">{a.label}</span>
                      </Link>
                    )}
                  </li>
                ))}
                {data.feedbackHref && (
                  <li>
                    <Link href={data.feedbackHref} className={row}>
                      <Icon name="star" className="size-5 shrink-0 opacity-70" />
                      <span className="min-w-0 flex-1">{labels.leaveFeedback}</span>
                    </Link>
                  </li>
                )}
              </ul>
            </nav>
          )}
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-white/10 pt-6 text-[13px] text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <p dir="auto">
            © {data.year} {data.name}
          </p>
          <p>{labels.poweredBy}</p>
        </div>
      </div>
    </footer>
  );
}

function SocialIcon({ kind }: { kind: FooterSocial['kind'] }) {
  const common = { viewBox: '0 0 24 24', className: 'size-5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (kind) {
    case 'instagram':
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.3" cy="6.7" r="0.6" fill="currentColor" />
        </svg>
      );
    case 'facebook':
      return (
        <svg {...common}>
          <path d="M14.5 8H17V4.5h-2.5A4 4 0 0 0 10.5 8.5V11H8v3.5h2.5v6H14v-6h2.6l.4-3.5h-3V8.6a.6.6 0 0 1 .5-.6z" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg {...common}>
          <path d="M14 3.5v11.2a3.8 3.8 0 1 1-3.8-3.8" />
          <path d="M14 3.5c.4 2.6 2.2 4.4 5 4.6" />
        </svg>
      );
    case 'google':
      return <Icon name="star" className="size-5" />;
    default:
      return <Icon name="globe" className="size-5" />;
  }
}
