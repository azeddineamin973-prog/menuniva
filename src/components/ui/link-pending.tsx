'use client';

import { useLinkStatus } from 'next/link';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './icons';

/**
 * Instant feedback on the link that was tapped while its page is prepared on the server.
 * On a slow mobile connection a navigation can take a second or more; without this the tap
 * looked like it did nothing and people tapped again. Must be rendered inside a next/link
 * `<Link>` (that is where `useLinkStatus` reads the state).
 *
 * The indicator appears after 100 ms (still instant to the eye): a navigation that is quick
 * anyway finishes first, so fast connections see no flicker (as the Next.js docs recommend).
 */

/** The link's icon, replaced by a spinner while the page loads. */
export function LinkIcon({ icon, className }: { icon: IconName; className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return <Icon name={icon} className={className} />;
  // Icon and spinner share one grid cell: the icon fades out as the spinner fades in.
  // With reduced motion there is no fade: the spinner (not turning) replaces the icon at once.
  const size = /(^|\s)size-/.test(className ?? '') ? undefined : 'size-4';
  return (
    <span className="inline-grid shrink-0 *:[grid-area:1/1]" data-link-pending="">
      <Icon name={icon} className={cn(className, 'animate-[mn-fade-out_120ms_ease-in_100ms_both] motion-reduce:opacity-0')} />
      <svg viewBox="0 0 24 24" className={cn(size, 'shrink-0 animate-[mn-fade-in_160ms_ease-out_100ms_both,spin_1s_linear_infinite] motion-reduce:animate-none', className)} fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** A thin pulsing line along the bottom edge of the link (the link needs `position: relative`). */
export function LinkPendingBar({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      data-link-pending={pending ? '' : undefined}
      className={cn('pointer-events-none absolute inset-x-2 bottom-1 h-0.5 rounded-full bg-current transition-opacity duration-150', pending ? 'animate-pulse opacity-60 delay-100 motion-reduce:animate-none' : 'opacity-0', className)}
    />
  );
}
