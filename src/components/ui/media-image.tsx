import type { ComponentProps } from 'react';
import { isOwnMedia, MEDIA_FORMATS, mediaSrcSet, type MediaWidth } from '@/lib/media';

/** Viewports narrower than Tailwind's `sm` breakpoint. */
const PHONE = '(max-width: 639px)';

type Props = Omit<ComponentProps<'img'>, 'src' | 'srcSet' | 'sizes'> & {
  src: string;
  /** Width the image takes on screen, as an HTML `sizes` value (e.g. "(min-width: 640px) 288px, 112px"). */
  sizes: string;
  /** Candidate widths; keep them close to the real display sizes (1×–3× screens). */
  widths: readonly MediaWidth[];
  /**
   * Shorter list of candidates for phones (viewports under 640 px), to cap the pixel density
   * there. Most phones have 2.6×–3× screens; at about 2.5× the display size a photo looks the
   * same to the eye but is often half the bytes of the next copy up (a 112 px tile: the 320 px
   * copy instead of the 480 px one). Tablets and computers still get `widths`.
   */
  phoneWidths?: readonly MediaWidth[];
};

/**
 * `<img>` that downloads a right-sized AVIF/WebP copy of MenuNiva's own photos.
 *
 * Renders `<picture>` with one `<source>` per format (preceded by phone-only sources when
 * `phoneWidths` is set) and the original as the `<img src>` fallback. The `<picture>` box is
 * `display: contents`, so the `<img>` keeps its place and every class it had: it can replace a
 * plain `<img>` anywhere. Photos from elsewhere (an import preview on Glovo's CDN) are rendered
 * as a plain `<img>`.
 */
export function MediaImage({ src, sizes, widths, phoneWidths, alt = '', ...img }: Props) {
  if (!isOwnMedia(src)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} {...img} />;
  }
  return (
    <picture className="contents">
      {phoneWidths &&
        MEDIA_FORMATS.map((f) => (
          <source key={`phone-${f}`} media={PHONE} type={`image/${f}`} srcSet={mediaSrcSet(src, f, phoneWidths)} sizes={sizes} />
        ))}
      {MEDIA_FORMATS.map((f) => (
        <source key={f} type={`image/${f}`} srcSet={mediaSrcSet(src, f, widths)} sizes={sizes} />
      ))}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} {...img} />
    </picture>
  );
}
