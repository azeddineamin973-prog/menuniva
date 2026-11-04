'use client';

import { useEffect, useState } from 'react';
import { Checkbox, Field, Icon, Input } from '@/components/ui';
import { MediaImage } from '@/components/ui/media-image';
import { cn } from '@/lib/cn';

const ACCEPT = 'image/png,image/jpeg,image/webp';

/**
 * Logo and cover photo, with a live preview of the store banner guests see at the top of the
 * restaurant page and of the pickup and delivery menus. A chosen file is previewed at once (it
 * is only uploaded when the form is saved); "Remove" shows the banner without it.
 */
export function BrandImages({ logoUrl, coverUrl, restaurantName, tagline, maxBytes }: { logoUrl: string | null; coverUrl: string | null; restaurantName: string; tagline: string | null; maxBytes: number }) {
  const [logoFile, setLogoFile] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [removeCover, setRemoveCover] = useState(false);
  useEffect(() => () => void (logoFile && URL.revokeObjectURL(logoFile)), [logoFile]);
  useEffect(() => () => void (coverFile && URL.revokeObjectURL(coverFile)), [coverFile]);

  const pick = (set: (v: string | null) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    set(f && f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  };
  const cover = coverFile ?? (removeCover ? null : coverUrl);
  const logo = logoFile ?? (removeLogo ? null : logoUrl);
  const mb = Math.round(maxBytes / 1024 / 1024);

  return (
    <div className="space-y-4">
      {/* Store banner preview, the same proportions as on a phone and a laptop. */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-ink">Store banner preview</p>
        <div className="overflow-hidden rounded-xl border border-line bg-surface" data-testid="cover-preview">
          <div className={cn('relative aspect-[16/7] overflow-hidden', cover ? 'bg-[#111]' : 'bg-gradient-to-br from-zinc-100 to-zinc-200')}>
            {cover ? (
              coverFile ? (
                // A local file not uploaded yet: shown as is.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <MediaImage src={cover} sizes="(min-width: 1024px) 520px, 90vw" widths={[640, 960, 1280]} className="absolute inset-0 h-full w-full object-cover" />
              )
            ) : (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-center text-zinc-500">
                <Icon name="photo" className="size-7" />
                <span className="text-xs">No cover photo yet. Guests see your main colour instead.</span>
              </span>
            )}
            {cover && <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />}
            {cover && (
              <span className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-3 text-white">
                {logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="size-11 shrink-0 rounded-xl bg-white object-contain p-0.5 ring-2 ring-white/90" />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-serif text-lg leading-tight">{restaurantName}</span>
                  {tagline && <span className="block truncate text-[11px] opacity-80">{tagline}</span>}
                </span>
              </span>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-xs text-muted">Shown big at the top of your restaurant page and of the pickup and delivery menus. The photo is cropped to fit each screen, so keep the important part near the centre.</p>
      </div>

      <Field label="Cover photo" htmlFor="cover" hint={`A wide (landscape) photo of your restaurant, dining room or signature dish, at least 1600 × 900 px. PNG, JPEG or WebP, up to ${mb} MB. Only upload photos you have the right to publish.`}>
        <Input id="cover" name="cover" type="file" accept={ACCEPT} data-max-bytes={maxBytes} className="pt-2" onChange={pick(setCoverFile)} data-testid="cover-input" />
        {coverUrl && <Checkbox name="removeCover" label="Remove the current cover photo" checked={removeCover} onChange={(e) => setRemoveCover(e.target.checked)} className="mt-2" />}
      </Field>

      <Field label="Logo" htmlFor="logo" hint={`PNG, JPEG or WebP, up to ${mb} MB. Square logos look best.`}>
        <div className="flex items-center gap-3">
          {logo && (
            <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white">
              {logoFile ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="New logo" className="size-full object-contain" />
              ) : (
                <MediaImage src={logo} alt="Current logo" sizes="56px" widths={[160, 320]} className="size-full object-contain" width={56} height={56} />
              )}
            </span>
          )}
          <Input id="logo" name="logo" type="file" accept={ACCEPT} data-max-bytes={maxBytes} className="min-w-0 flex-1 pt-2" onChange={pick(setLogoFile)} />
        </div>
        {logoUrl && <Checkbox name="removeLogo" label="Remove the current logo" checked={removeLogo} onChange={(e) => setRemoveLogo(e.target.checked)} className="mt-2" />}
      </Field>
    </div>
  );
}
