'use client';

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Badge } from '@/components/ui';
import { Icon, type IconName } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

type Device = 'phone' | 'tablet' | 'desktop';
/** Real device viewports (CSS pixels) and the frame drawn around them. */
const DEVICES: Record<Device, { label: string; icon: IconName; w: number; h: number; bezel: number; radius: number }> = {
  phone: { label: 'Mobile', icon: 'smartphone', w: 390, h: 844, bezel: 12, radius: 54 },
  tablet: { label: 'Tablet', icon: 'tablet', w: 820, h: 1180, bezel: 18, radius: 36 },
  desktop: { label: 'Desktop', icon: 'monitor', w: 1280, h: 800, bezel: 0, radius: 12 },
};
const DEVICE_KEYS = Object.keys(DEVICES) as Device[];
/** Browser bar drawn above the desktop viewport. */
const CHROME = 40;
/** Phone status bar (47 px) and home indicator (21 px): the page gets the rest of the screen. */
const PHONE_BARS = 68;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5];
const MIN_SCALE = 0.15;
const PAGE_ICONS: Record<string, IconName> = { menu: 'book', pickup: 'bag', delivery: 'truck', whatsapp: 'chat', reserve: 'calendar' };

export type PreviewPage = { key: string; label: string; path: string };

/** A guest page address in preview mode and in the chosen language. */
function previewUrl(path: string, lang: string) {
  const u = new URL(path, 'http://preview.invalid');
  u.searchParams.set('preview', '1');
  u.searchParams.set('lang', lang);
  return `${u.pathname}${u.search}${u.hash}`;
}

/**
 * Preview Studio: compact controls on the left (restaurant, device, page, language, then sharing
 * passed in as `aside`), the real guest pages in a large device frame on the right. The frame is
 * scaled to fit the space it has (or zoomed), and the page scrolls inside it as on a real device.
 *
 * The language and page travel as URL parameters, so the owner's own language cookie never
 * changes. Pages open in place in the same frame (`location.replace`): the old page stays visible
 * until the next one is ready, and the browser's Back button still leaves the studio.
 */
export function PreviewStudio({
  restaurantName,
  locationName,
  published,
  eyebrow = 'Preview & share',
  pages,
  languages,
  defaultLang,
  displayHost,
  initialPage,
  stageOffset = '7.75rem',
  aside,
}: {
  restaurantName: string;
  /** Shown under the name when the restaurant has several locations. */
  locationName?: string;
  published: boolean;
  eyebrow?: string;
  pages: PreviewPage[];
  languages: { code: string; label: string }[];
  defaultLang: string;
  /** Shown in the desktop frame's address bar. */
  displayHost: string;
  /** Page to open first (`?page=reserve` from "Preview as guest" links). */
  initialPage?: string;
  /** Space above and below the stage on large screens, so it fits the window without scrolling. */
  stageOffset?: string;
  /** Sharing and publication (and step-specific cards), under the controls. */
  aside?: ReactNode;
}) {
  const first = pages.find((p) => p.key === initialPage) ?? pages[0];
  const [device, setDevice] = useState<Device>('phone');
  const [page, setPage] = useState(first?.key ?? 'menu');
  const [lang, setLang] = useState(defaultLang);
  // The frame keeps its first address; later pages open in place (see `go`). `n` recreates it
  // only when that is impossible.
  const [frame, setFrame] = useState(() => ({ src: previewUrl(first?.path ?? '/', defaultLang), n: 0 }));
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const loadingRef = useRef(true);
  const [current, setCurrent] = useState<string | null>(null);
  const [fitScale, setFitScale] = useState(0.6);
  const [measured, setMeasured] = useState(false);
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const areaRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const d = DEVICES[device];
  const outerW = d.w + d.bezel * 2;
  const outerH = d.h + d.bezel * 2 + (device === 'desktop' ? CHROME : 0);
  const scale = zoom === 'fit' ? fitScale : zoom;
  const pagePath = (pages.find((p) => p.key === page) ?? first)?.path ?? '/';

  // Fit the whole device into the stage. The stage's size comes from CSS (the screen height beside
  // the controls on large screens, the device's proportions on smaller ones), so nothing around
  // it moves when the script measures it.
  const fit = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    const cs = getComputedStyle(area);
    const w = area.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = area.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (w <= 0 || h <= 0) return;
    const s = Math.max(MIN_SCALE, Math.min(1, (w - 1) / outerW, (h - 1) / outerH));
    setFitScale(Math.floor(s * 1000) / 1000);
    setMeasured(true);
  }, [outerW, outerH]);
  useLayoutEffect(fit, [fit]);
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const ro = new ResizeObserver(fit);
    ro.observe(area);
    return () => ro.disconnect();
  }, [fit]);
  // Zoomed in: start from the middle of the device rather than its left edge.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (area && zoom !== 'fit') area.scrollLeft = (area.scrollWidth - area.clientWidth) / 2;
  }, [zoom, device]);

  const busy = (b: boolean) => {
    loadingRef.current = b;
    setLoading(b);
  };

  // Keep the controls in step when the owner navigates or switches language inside the preview.
  // Guest pages also navigate without a full load, so the frame address is checked periodically
  // (same-origin, cheap). Skipped while a page is opening, so the old page cannot win.
  const sync = useCallback(() => {
    if (loadingRef.current) return;
    try {
      const loc = frameRef.current?.contentWindow?.location;
      if (!loc || loc.href === 'about:blank') return;
      const q = new URLSearchParams(loc.search);
      const l = q.get('lang');
      q.delete('preview');
      q.delete('lang');
      const rest = q.toString();
      setCurrent(`${loc.pathname}${rest ? `?${rest}` : ''}`);
      if (l && languages.some((x) => x.code === l)) setLang(l);
      const match = pages.find((p) => p.path.split('?')[0] === loc.pathname);
      if (match) setPage(match.key);
    } catch {
      // A page on another site (an external link): nothing to read.
    }
  }, [languages, pages]);
  useEffect(() => {
    const t = setInterval(sync, 700);
    return () => clearInterval(t);
  }, [sync]);

  const loaded = () => {
    busy(false);
    setLoadedOnce(true);
    sync();
  };
  // The frame starts loading with the page itself and may be done before this script runs.
  const checkLoaded = useEffectEvent(() => {
    const doc = frameRef.current?.contentDocument;
    if (doc && doc.readyState === 'complete' && doc.URL !== 'about:blank') loaded();
  });
  useEffect(() => checkLoaded(), []);
  // Never leave the spinner up if a load event goes missing (e.g. a page that never finishes).
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      loadingRef.current = false;
      setLoading(false);
    }, 15000);
    return () => clearTimeout(t);
  }, [loading]);

  /** Opens a page in the frame, in place. */
  const go = (url: string) => {
    busy(true);
    try {
      const win = frameRef.current?.contentWindow;
      if (!win) throw new Error('no frame');
      win.location.replace(url);
    } catch {
      setFrame((f) => ({ src: url, n: f.n + 1 }));
    }
  };
  const openPage = (key: string) => {
    const p = pages.find((x) => x.key === key);
    if (!p) return;
    setPage(key);
    go(previewUrl(p.path, lang));
  };
  const changeLang = (code: string) => {
    setLang(code);
    // Stay on the page the owner is looking at (a dish, the cart, the booking form…).
    let target = previewUrl(pagePath, code);
    try {
      const loc = frameRef.current?.contentWindow?.location;
      if (loc && loc.href !== 'about:blank' && loc.origin === window.location.origin) target = previewUrl(`${loc.pathname}${loc.search}`, code);
    } catch {
      // another site in the frame: open the selected page instead
    }
    go(target);
  };
  const reload = () => {
    busy(true);
    try {
      frameRef.current!.contentWindow!.location.reload();
    } catch {
      setFrame((f) => ({ ...f, n: f.n + 1 }));
    }
  };
  const chooseDevice = (k: Device) => {
    setDevice(k);
    setZoom('fit');
  };
  const canZoomIn = ZOOM_STEPS.some((z) => z > scale + 0.001);
  const canZoomOut = ZOOM_STEPS.some((z) => z < scale - 0.001);
  const zoomBy = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOM_STEPS.find((z) => z > scale + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < scale - 0.001);
    if (next !== undefined) setZoom(next);
  };
  const openHref = previewUrl(current ?? pagePath, lang);
  const viewportH = device === 'phone' ? d.h - PHONE_BARS : d.h;
  const iconBtn = 'flex size-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-35 pointer-coarse:size-10';

  return (
    <div
      className="grid gap-4 lg:grid-cols-[18.5rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-6 xl:grid-cols-[minmax(19rem,29%)_minmax(0,1fr)]"
      data-testid="restaurant-preview"
      data-device={device}
      data-page={page}
      data-zoom={zoom === 'fit' ? 'fit' : String(zoom)}
    >
      {/* Controls */}
      <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">{eyebrow}</p>
            <h1 className="text-xl leading-tight font-semibold tracking-tight break-words text-ink">{restaurantName}</h1>
            {locationName && <p className="truncate text-[13px] text-muted">{locationName}</p>}
          </div>
          <Badge tone={published ? 'success' : 'warning'} dot className="mt-0.5 shrink-0" data-testid="link-status">
            {published ? 'Published' : 'Draft · not public'}
          </Badge>
        </div>

        <div className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <div>
            <p id="pv-device" className="mb-1.5 text-xs font-medium text-muted">
              Device
            </p>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1" role="group" aria-labelledby="pv-device">
              {DEVICE_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={device === k}
                  onClick={() => chooseDevice(k)}
                  className={cn(
                    'inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md px-1.5 text-[13px] font-medium transition-colors pointer-coarse:h-11',
                    device === k ? 'bg-surface text-ink shadow-xs ring-1 ring-line' : 'text-ink-2 hover:text-ink',
                  )}
                  data-testid={`preview-device-${k}`}
                >
                  <Icon name={DEVICES[k].icon} className="size-4 shrink-0" />
                  <span className="truncate">{DEVICES[k].label}</span>
                </button>
              ))}
            </div>
          </div>

          {pages.length > 1 && (
            <div>
              <p id="pv-page" className="mb-1.5 text-xs font-medium text-muted">
                Page
              </p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2" role="group" aria-labelledby="pv-page">
                {pages.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={page === p.key}
                    onClick={() => openPage(p.key)}
                    className={cn(
                      'inline-flex h-9 min-w-0 items-center gap-2 rounded-lg px-2.5 text-start text-[13px] font-medium ring-1 transition-colors pointer-coarse:h-11',
                      page === p.key ? 'bg-ink text-bg ring-ink' : 'bg-surface text-ink-2 ring-line hover:text-ink hover:ring-line-strong',
                    )}
                    data-testid={`preview-page-${p.key}`}
                  >
                    <Icon name={PAGE_ICONS[p.key] ?? 'globe'} className="size-4 shrink-0" />
                    <span className="truncate">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {languages.length > 1 && (
            <label className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted">Language</span>
              <span className="relative min-w-0">
                <Icon name="globe" className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <select
                  value={lang}
                  onChange={(e) => changeLang(e.target.value)}
                  className="h-9 max-w-full rounded-lg border border-line bg-surface ps-8 pe-8 text-[13px] shadow-xs pointer-coarse:h-11 pointer-coarse:text-base"
                  data-testid="preview-language"
                >
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </span>
            </label>
          )}

          <p className="flex items-start gap-1.5 border-t border-line pt-3 text-xs text-muted" data-testid="preview-mode-note">
            <Icon name={published ? 'info' : 'lock'} className="mt-px size-3.5 shrink-0" />
            {published ? 'These are your live pages: orders and bookings made here are real.' : 'Draft preview: only your team can open it, and ordering and booking are switched off.'}
          </p>
        </div>
      </div>

      {/* Stage */}
      <section
        className="@container min-w-0 overflow-hidden rounded-[var(--radius-card)] border border-line bg-[radial-gradient(circle_at_50%_0%,var(--mn-surface-3),var(--mn-surface-2)_60%)] lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex lg:h-[calc(100dvh-var(--stage-offset))] lg:min-h-[34rem] lg:flex-col lg:self-start"
        style={{ '--stage-offset': stageOffset } as CSSProperties}
        aria-label="Live preview"
        data-testid="preview-stage"
      >
        <div className="flex items-center gap-2 border-b border-line/70 bg-surface/70 px-2 py-1.5 backdrop-blur sm:px-3">
          <p className="hidden min-w-0 truncate text-xs text-muted tabular-nums sm:block" data-testid="preview-viewport">
            {d.label} · {d.w} × {viewportH}
          </p>
          <div className="ms-auto flex items-center gap-0.5" role="group" aria-label="Zoom">
            <button type="button" className={iconBtn} onClick={() => zoomBy(-1)} disabled={!canZoomOut} aria-label="Zoom out" title="Zoom out" data-testid="preview-zoom-out">
              <Icon name="zoomOut" className="size-4" />
            </button>
            <span className="w-11 text-center text-xs font-medium text-ink-2 tabular-nums" aria-live="polite" data-testid="preview-zoom-level">
              {Math.round(scale * 100)}%
            </span>
            <button type="button" className={iconBtn} onClick={() => zoomBy(1)} disabled={!canZoomIn} aria-label="Zoom in" title="Zoom in" data-testid="preview-zoom-in">
              <Icon name="zoomIn" className="size-4" />
            </button>
            <button
              type="button"
              aria-pressed={zoom === 'fit'}
              onClick={() => setZoom('fit')}
              className={cn('ms-0.5 inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors pointer-coarse:h-10', zoom === 'fit' ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}
              title="Fit the whole device on screen"
              data-testid="preview-zoom-fit"
            >
              <Icon name="maximize" className="size-3.5" /> Fit
            </button>
          </div>
          <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
          <button type="button" className={iconBtn} onClick={reload} aria-label="Reload preview" title="Reload preview" data-testid="preview-reload">
            <Icon name="refresh" className="size-4" />
          </button>
          <a href={openHref} target="_blank" rel="noopener" className={iconBtn} aria-label="Open this page in a new tab" title={published ? 'Open this page in a new tab' : 'Open the draft in a new tab (only your team can see it)'} data-testid="preview-open-tab">
            <Icon name="external" className="size-4" />
          </a>
        </div>

        {/* Below `lg` the stage is as tall as the device at full width (container units), capped
            to the screen height; CSS alone, so nothing moves when the script measures it. (Not
            `aspect-ratio`: with a max-height it would also narrow the stage.) */}
        <div
          ref={areaRef}
          className={cn(
            'relative flex h-[min(calc(100cqw*var(--device-ratio)),max(28rem,calc(100dvh-10.5rem)))] p-4 sm:p-6 lg:h-auto lg:min-h-0 lg:flex-1 lg:p-5',
            zoom === 'fit' ? 'overflow-hidden' : 'overflow-auto overscroll-contain',
          )}
          style={{ '--device-ratio': outerH / outerW } as CSSProperties}
          data-testid="preview-area"
        >
          {!measured && (
            <span className="absolute inset-0 m-auto size-8 animate-spin rounded-full border-[3px] border-ink/10 border-t-ink/50 motion-reduce:animate-none" role="status" aria-label="Loading preview" />
          )}
          <div className={cn('relative m-auto shrink-0 motion-safe:transition-opacity motion-safe:duration-300', measured ? 'opacity-100' : 'opacity-0')} style={{ width: outerW * scale, height: outerH * scale }}>
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
                    <span className="truncate">
                      {displayHost}
                      {current ?? pagePath}
                    </span>
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
                    key={frame.n}
                    src={frame.src}
                    title="Customer menu preview"
                    className={cn('block h-full w-full border-0 bg-white motion-safe:transition-opacity motion-safe:duration-200', loading && loadedOnce && 'opacity-70')}
                    onLoad={loaded}
                    data-testid="preview-frame"
                  />
                  {/* Opening another page: the current one stays visible under a thin progress line. */}
                  <div className={cn('pointer-events-none absolute inset-x-0 top-0 h-1 overflow-hidden transition-opacity duration-150', loading && loadedOnce ? 'opacity-100' : 'opacity-0')} aria-hidden>
                    <div className="h-full w-1/4 animate-progress rounded-full bg-lime motion-reduce:animate-none" />
                  </div>
                  {loading && !loadedOnce && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white">
                      <span className="size-8 animate-spin rounded-full border-[3px] border-black/10 border-t-black/60 motion-reduce:animate-none" />
                    </div>
                  )}
                  <span className="sr-only" role="status" aria-live="polite">
                    {loading ? 'Loading preview' : ''}
                  </span>
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
      </section>

      {/* Sharing, publication */}
      {aside && <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-2 lg:self-start">{aside}</div>}
    </div>
  );
}
