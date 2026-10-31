'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

type Device = 'phone' | 'tablet' | 'desktop';
const DEVICES: Record<Device, { label: string; icon: IconName; w: number; h: number; bezel: number; radius: number }> = {
  phone: { label: 'Mobile', icon: 'phone', w: 390, h: 844, bezel: 12, radius: 54 },
  tablet: { label: 'Tablet', icon: 'tables', w: 820, h: 1180, bezel: 18, radius: 36 },
  desktop: { label: 'Desktop', icon: 'sidebar', w: 1280, h: 800, bezel: 0, radius: 12 },
};
/** Height of the fake browser bar in desktop mode. */
const CHROME = 40;

export type PreviewPage = { key: string; label: string; path: string };

/**
 * The real customer menu (same pages guests get, in draft-preview mode) inside a phone, tablet or
 * desktop frame. Language and page are chosen here and passed as URL parameters, so switching
 * never changes the language cookie of the owner's own browser.
 */
export function RestaurantPreview({
  pages,
  languages,
  defaultLang,
  displayHost,
  initialDevice = 'phone',
}: {
  pages: PreviewPage[];
  languages: { code: string; label: string }[];
  defaultLang: string;
  /** Shown in the desktop frame's address bar. */
  displayHost: string;
  initialDevice?: Device;
}) {
  const [device, setDevice] = useState<Device>(initialDevice);
  // `lang` is what the toolbar shows (also follows the menu's own switcher); `frameLang` only
  // changes from the toolbar, so following the menu never reloads the frame.
  const [lang, setLang] = useState(defaultLang);
  const [frameLang, setFrameLang] = useState(defaultLang);
  const [page, setPage] = useState(pages[0]?.key ?? 'menu');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [scale, setScale] = useState(1);
  const [current, setCurrent] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const d = DEVICES[device];
  const outerW = d.w + d.bezel * 2;
  const outerH = d.h + d.bezel * 2 + (device === 'desktop' ? CHROME : 0);
  const path = pages.find((p) => p.key === page)?.path ?? pages[0]?.path ?? '/';
  const src = `${path}${path.includes('?') ? '&' : '?'}preview=1&lang=${encodeURIComponent(frameLang)}`;

  // Fit the device into the available width and a comfortable share of the viewport height.
  const fit = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const style = getComputedStyle(box);
    const availW = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    // Fit below the stage's top edge so the whole device is visible without scrolling.
    const top = box.getBoundingClientRect().top + window.scrollY;
    const availH = Math.max(460, Math.min(window.innerHeight - top - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 40, 980));
    setScale(Math.min(1, availW / outerW, availH / outerH));
  }, [outerW, outerH]);
  useLayoutEffect(fit, [fit]);
  useEffect(() => {
    const ro = new ResizeObserver(fit);
    if (boxRef.current) ro.observe(boxRef.current);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [fit]);
  useEffect(() => setLoading(true), [src, reload]);

  // Keep the controls in step when the owner navigates or switches language inside the preview.
  // Guest pages navigate client-side (no load event), so the frame address is also checked
  // periodically; reading it is cheap and same-origin.
  const sync = useCallback(() => {
    try {
      const loc = frameRef.current?.contentWindow?.location;
      if (!loc || loc.href === 'about:blank') return;
      const q = new URLSearchParams(loc.search);
      const l = q.get('lang');
      q.delete('preview');
      q.delete('lang');
      const rest = q.toString();
      setCurrent(`${loc.pathname}${rest ? `?${rest}` : ''}`);
      if (l && languages.some((x) => x.code === l)) setLang((cur) => (cur === l ? cur : l));
    } catch {
      // Cross-origin page (e.g. an external ordering link): nothing to sync.
    }
  }, [languages]);
  useEffect(() => {
    const t = setInterval(sync, 700);
    return () => clearInterval(t);
  }, [sync]);
  const onLoad = () => {
    setLoading(false);
    sync();
  };

  return (
    <div className="space-y-4" data-testid="restaurant-preview" data-device={device}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 shadow-xs" role="group" aria-label="Preview size">
          {(Object.keys(DEVICES) as Device[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={device === k}
              onClick={() => setDevice(k)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors pointer-coarse:h-10',
                device === k ? 'bg-ink text-bg shadow-xs' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
              )}
              data-testid={`preview-device-${k}`}
            >
              <Icon name={DEVICES[k].icon} className={cn('size-4', k === 'tablet' && 'rotate-0')} />
              <span className="hidden sm:inline">{DEVICES[k].label}</span>
              <span className="sr-only sm:hidden">{DEVICES[k].label}</span>
            </button>
          ))}
        </div>
        {pages.length > 1 && (
          <label className="inline-flex items-center gap-1.5">
            <span className="sr-only">Page</span>
            <select
              value={page}
              onChange={(e) => {
                setPage(e.target.value);
                setFrameLang(lang);
              }}
              className="h-9 rounded-lg border border-line bg-surface ps-2.5 pe-8 text-[13px] shadow-xs pointer-coarse:h-11 pointer-coarse:text-base"
              data-testid="preview-page"
            >
              {pages.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {languages.length > 1 && (
          <label className="inline-flex items-center gap-1.5">
            <Icon name="globe" className="size-4 text-muted" />
            <span className="sr-only">Language</span>
            <select
              value={lang}
              onChange={(e) => {
                setLang(e.target.value);
                setFrameLang(e.target.value);
                // The frame may show another language than `frameLang` after the menu's own switcher.
                setReload((n) => n + 1);
              }}
              className="h-9 rounded-lg border border-line bg-surface ps-2.5 pe-8 text-[13px] shadow-xs pointer-coarse:h-11 pointer-coarse:text-base"
              data-testid="preview-language"
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="ms-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setReload((n) => n + 1);
            }}
            className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink pointer-coarse:size-11"
            aria-label="Reload preview"
            title="Reload preview"
            data-testid="preview-reload"
          >
            <Icon name="refresh" />
          </button>
          <a
            href={src}
            target="_blank"
            rel="noopener"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink pointer-coarse:h-11"
            data-testid="preview-open-tab"
          >
            <Icon name="external" className="size-4" /> <span className="hidden sm:inline">Open in new tab</span>
            <span className="sr-only sm:hidden">Open in new tab</span>
          </a>
        </div>
      </div>

      {/* Stage */}
      <div ref={boxRef} className="flex justify-center rounded-[var(--radius-card)] border border-line bg-[radial-gradient(circle_at_50%_0%,var(--mn-surface-3),var(--mn-surface-2)_60%)] px-3 py-6 sm:px-6 sm:py-8">
        <div className="relative shrink-0 motion-safe:transition-[width,height] motion-safe:duration-300" style={{ width: outerW * scale, height: outerH * scale }}>
          <div
            className={cn(
              'absolute start-0 top-0 origin-top-left overflow-hidden rtl:origin-top-right',
              device === 'desktop' ? 'border border-line-strong bg-surface shadow-lg' : 'bg-[#0d0f11] shadow-[0_30px_60px_-20px_rgb(0_0_0/0.45),inset_0_0_0_1.5px_rgb(255_255_255/0.08)]',
            )}
            style={{ width: outerW, height: outerH, borderRadius: d.radius + d.bezel, transform: `scale(${scale})`, padding: d.bezel }}
          >
            {device === 'desktop' && (
              <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-3" style={{ height: CHROME }} aria-hidden>
                <span className="flex gap-1.5">
                  <span className="size-3 rounded-full bg-[#ff5f57]" />
                  <span className="size-3 rounded-full bg-[#febc2e]" />
                  <span className="size-3 rounded-full bg-[#28c840]" />
                </span>
                <span className="mx-auto flex h-6 w-full max-w-md items-center justify-center gap-1.5 rounded-md bg-surface px-3 text-xs text-muted">
                  <Icon name="lock" className="size-3" />
                  <span className="truncate">{displayHost}{current ?? path}</span>
                </span>
              </div>
            )}
            <div className="relative flex flex-col overflow-hidden bg-black" style={{ width: d.w, height: d.h, borderRadius: d.radius }}>
              {device === 'phone' && (
                // Status bar with the camera island, like a real phone: the page starts below it.
                <div className="relative flex h-[47px] shrink-0 items-center justify-between px-8 pt-1 text-[15px] font-semibold text-white" aria-hidden>
                  <span>9:41</span>
                  <span className="absolute top-2.5 left-1/2 h-[30px] w-[110px] -translate-x-1/2 rounded-full bg-[#050505] ring-1 ring-white/5" />
                  <span className="flex items-center gap-1.5">
                    <span className="flex items-end gap-px">
                      {[5, 7, 9, 11].map((h) => (
                        <span key={h} className="w-[3px] rounded-sm bg-white" style={{ height: h }} />
                      ))}
                    </span>
                    <span className="relative h-[11px] w-[22px] rounded-[3px] border border-white/60 p-px">
                      <span className="block h-full w-4/5 rounded-[1px] bg-white" />
                    </span>
                  </span>
                </div>
              )}
              <div className="relative min-h-0 flex-1 bg-white">
                <iframe
                  ref={frameRef}
                  key={`${src}#${reload}`}
                  src={src}
                  title="Customer menu preview"
                  className={cn('block h-full w-full border-0 bg-white motion-safe:transition-opacity motion-safe:duration-200', loading && 'opacity-40')}
                  onLoad={onLoad}
                  data-testid="preview-frame"
                />
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center" role="status" aria-label="Loading preview">
                    <span className="size-8 animate-spin rounded-full border-[3px] border-black/10 border-t-black/60 motion-reduce:animate-none" />
                  </div>
                )}
              </div>
              {device === 'phone' && (
                <div className="flex h-[21px] shrink-0 items-start justify-center pt-[7px]" aria-hidden>
                  <span className="h-[5px] w-[134px] rounded-full bg-white/85" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="text-center text-xs text-muted">
        {d.w} × {device === 'phone' ? d.h - 68 : d.h} px viewport{scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ''} · ordering is switched off in previews
      </p>
    </div>
  );
}
