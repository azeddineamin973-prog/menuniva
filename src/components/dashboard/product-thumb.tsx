'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { displayImageUrl, THUMBNAIL_WIDTH } from '@/lib/image-url';
import { MediaImage } from '@/components/ui/media-image';

const SIZES = { sm: 'size-10', md: 'size-12', lg: 'size-20' } as const;
const PX = { sm: 40, md: 48, lg: 80 } as const;

/**
 * A product photo thumbnail. The photo is shown straight from where the import found it; nothing
 * is downloaded into MenuNiva until the owner confirms the photo rights when saving.
 *
 * The placeholder appears only when there is no photo address, or the browser genuinely failed
 * to load it — never as a stand-in for a photo that exists.
 */
export function ProductThumb({ src, size = 'md', className }: { src: string | null | undefined; size?: keyof typeof SIZES; className?: string }) {
  // Own photos (/media/…) are shown as they are; platform photos are resized by their CDN.
  const url = displayImageUrl(src, THUMBNAIL_WIDTH);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // An image that fails before React attaches its handlers (fast cache miss during hydration)
  // never fires onError for us; check its state once mounted.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, [url]);

  if (!url || failed) {
    return (
      <div
        className={cn(SIZES[size], 'flex shrink-0 items-center justify-center rounded-xl border border-dashed border-line bg-surface-2 text-muted/70', className)}
        title={url ? 'The photo could not be loaded' : 'No photo'}
        data-testid="product-thumb-placeholder"
        data-reason={url ? 'failed' : 'missing'}
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="m21 16-5.2-5.2a1 1 0 0 0-1.4 0L6 19" />
        </svg>
      </div>
    );
  }
  return (
    // Own photos get a right-sized AVIF/WebP copy; platform photos (Glovo's CDN) are already
    // resized by their CDN through `url` and are shown as a plain image.
    <MediaImage
      ref={ref}
      src={url}
      sizes={`${PX[size]}px`}
      widths={size === 'lg' ? [160, 320] : [160]}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn(SIZES[size], 'shrink-0 rounded-xl border border-line bg-surface-2 object-cover', className)}
      width={PX[size]}
      height={PX[size]}
      data-testid="product-thumb"
    />
  );
}
