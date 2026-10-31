'use client';
import { useState } from 'react';
import { Icon, Label } from '@/components/ui';
import { cn } from '@/lib/cn';
import { contrast, storefrontPalette } from '@/lib/color';
import { THEME_PRESETS } from '@/lib/storefront-themes';

type Colors = { themePreset: string; primaryColor: string; accentColor: string; backgroundColor: string; textColor: string };
const FIELDS = [
  ['primaryColor', 'Main colour', 'Header, buttons, active category'],
  ['accentColor', 'Accent', 'Highlights and the line under the header'],
  ['backgroundColor', 'Background', 'Page background'],
  ['textColor', 'Text', 'Body text (adjusted automatically if hard to read)'],
] as const;

/**
 * Storefront theme: pick a preset (all six colour roles) or set your own colours. Changing a
 * colour switches to "Custom"; secondary and card colours are then derived, and text that would
 * be hard to read is corrected automatically on the guest menu, as the preview shows.
 */
export function BrandingPresetPicker({ initial, restaurantName }: { initial: Colors; restaurantName: string }) {
  const [c, setC] = useState<Colors>(initial);
  const p = storefrontPalette(c);
  const adjusted = p.text.toLowerCase() !== c.textColor.toLowerCase();
  return (
    <div className="space-y-5">
      <div>
        <Label>Theme</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Theme">
          {THEME_PRESETS.map((t) => {
            const active = c.themePreset === t.key;
            return (
              <button
                type="button"
                key={t.key}
                role="radio"
                aria-checked={active}
                onClick={() => setC({ themePreset: t.key, primaryColor: t.primary, accentColor: t.accent, backgroundColor: t.background, textColor: t.text })}
                className={cn(
                  'group relative flex flex-col gap-2 rounded-lg border p-2.5 text-start transition-colors',
                  active ? 'border-ink ring-2 ring-[var(--mn-focus)]/40' : 'border-line hover:border-line-strong',
                )}
                data-testid={`theme-${t.key}`}
              >
                <span className="flex h-10 overflow-hidden rounded-md border border-black/10" style={{ background: t.background }} aria-hidden>
                  <span className="w-1/3" style={{ background: t.primary }} />
                  <span className="flex flex-1 items-center justify-center gap-1">
                    <span className="h-4 w-6 rounded-sm shadow-sm" style={{ background: t.surface }} />
                    <span className="size-3 rounded-full" style={{ background: t.accent }} />
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">{t.label}</span>
                  <span className="block truncate text-[11px] text-muted">{t.description}</span>
                </span>
                {active && <Icon name="checkCircle" className="absolute end-2 top-2 size-4 text-ink" />}
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={c.themePreset === 'custom'}
            onClick={() => setC({ ...c, themePreset: 'custom' })}
            className={cn('relative flex flex-col justify-center gap-1 rounded-lg border border-dashed p-2.5 text-start', c.themePreset === 'custom' ? 'border-ink ring-2 ring-[var(--mn-focus)]/40' : 'border-line-strong hover:border-ink-2')}
            data-testid="theme-custom"
          >
            <Icon name="edit" className="size-4 text-muted" />
            <span className="block text-[13px] font-medium text-ink">Custom</span>
            <span className="block text-[11px] text-muted">Your own colours</span>
          </button>
        </div>
      </div>
      <input type="hidden" name="themePreset" value={c.themePreset} />
      <div className="grid gap-2 sm:grid-cols-2">
        {FIELDS.map(([k, label, hint]) => (
          <label key={k} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 hover:border-line-strong">
            <input
              type="color"
              name={k}
              value={c[k]}
              onChange={(e) => setC({ ...c, themePreset: 'custom', [k]: e.target.value.toUpperCase() })}
              className="h-9 w-11 shrink-0 cursor-pointer rounded border-0 bg-transparent"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">{label}</span>
              <span className="block truncate text-[11px] text-muted">{hint}</span>
            </span>
          </label>
        ))}
      </div>
      {adjusted && (
        <p className="flex items-start gap-1.5 text-xs text-warning" data-testid="contrast-note">
          <Icon name="info" className="mt-px size-3.5 shrink-0" />
          This text colour is hard to read on your background ({contrast(c.textColor, p.bg).toFixed(1)}:1), so guests will see {p.text.toUpperCase()} instead.
        </p>
      )}

      {/* Live preview with the exact palette the guest menu uses. */}
      <div className={cn('overflow-hidden rounded-xl border border-line', c.themePreset === 'moroccan' && 'sf-pattern')} style={{ background: p.bg, color: p.text }} aria-label="Theme preview">
        <div className="px-4 pt-5 pb-4" style={{ background: p.primary, color: p.onPrimary }}>
          <p className="font-serif text-xl leading-tight">{restaurantName}</p>
          <p className="text-xs opacity-80">Open now · Preview</p>
        </div>
        <div className="h-1" style={{ background: p.accent }} />
        <div className="space-y-2.5 p-4">
          <div className="flex gap-1.5">
            <span className="rounded-full px-3 py-1 text-xs font-medium" style={{ background: p.primary, color: p.onPrimary }}>Starters</span>
            <span className="rounded-full px-3 py-1 text-xs" style={{ background: p.card, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.08)' }}>Mains</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 shadow-sm" style={{ background: p.card }}>
            <span className="min-w-0">
              <span className="block text-sm font-medium">Dish name</span>
              <span className="block text-xs opacity-70">Short description</span>
            </span>
            <span className="text-sm font-semibold" style={{ color: p.primaryInk }}>
              0,00 €
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <span className="rounded-xl py-2 text-center text-sm font-medium" style={{ background: p.primary, color: p.onPrimary }}>Add to order</span>
            <span className="rounded-xl py-2 text-center text-sm font-medium" style={{ background: p.secondary, color: p.onSecondary }}>Secondary</span>
          </div>
        </div>
      </div>
    </div>
  );
}
