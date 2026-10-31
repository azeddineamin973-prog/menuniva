'use client';

import { useState } from 'react';
import { Label } from '@/components/ui';
import { cn } from '@/lib/cn';

const PRESETS = {
  moroccan: { label: 'Moroccan', primaryColor: '#1F5C4A', accentColor: '#B8975A', backgroundColor: '#FBF7EE', textColor: '#1E2420' },
  classic: { label: 'Classic', primaryColor: '#2B2B2B', accentColor: '#C0392B', backgroundColor: '#FFFFFF', textColor: '#1A1A1A' },
  minimal: { label: 'Minimal', primaryColor: '#171A1D', accentColor: '#6B7280', backgroundColor: '#FAFAFA', textColor: '#171A1D' },
  bistro: { label: 'Bistro', primaryColor: '#7A2E1F', accentColor: '#D4A64A', backgroundColor: '#FFF8F0', textColor: '#2A1A14' },
} as const;

type Colors = { themePreset: string; primaryColor: string; accentColor: string; backgroundColor: string; textColor: string };

export function BrandingPresetPicker({ initial, restaurantName }: { initial: Colors; restaurantName: string }) {
  const [c, setC] = useState<Colors>(initial);
  return (
    <div className="space-y-4">
      <div>
        <Label>Style preset</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(PRESETS).map(([key, p]) => (
            <button
              type="button"
              key={key}
              onClick={() => setC({ themePreset: key, ...p })}
              className={cn('rounded-xl border p-2 text-start text-xs', c.themePreset === key ? 'border-graphite ring-2 ring-lime' : 'border-line')}
            >
              <span className="mb-1.5 flex gap-1">
                {[p.primaryColor, p.accentColor, p.backgroundColor].map((col) => (
                  <span key={col} className="h-4 w-4 rounded-full border border-black/10" style={{ background: col }} />
                ))}
              </span>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <input type="hidden" name="themePreset" value={c.themePreset} />
      <div className="grid grid-cols-2 gap-3">
        {(['primaryColor', 'accentColor', 'backgroundColor', 'textColor'] as const).map((k) => (
          <label key={k} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
            <input type="color" name={k} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value.toUpperCase() })} className="h-8 w-10 shrink-0 cursor-pointer rounded border-0 bg-transparent" />
            {k === 'primaryColor' ? 'Main colour' : k === 'accentColor' ? 'Accent' : k === 'backgroundColor' ? 'Background' : 'Text'}
          </label>
        ))}
      </div>
      <div className={cn('overflow-hidden rounded-2xl border border-line', c.themePreset === 'moroccan' && 'sf-pattern')} style={{ background: c.backgroundColor, color: c.textColor }}>
        <div className="px-4 py-5" style={{ background: c.primaryColor, color: '#fff' }}>
          <p className="font-serif text-xl">{restaurantName}</p>
          <p className="text-xs opacity-80">Preview</p>
        </div>
        <div className="space-y-2 p-4">
          <div className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2 text-sm">
            <span>Dish name</span>
            <span style={{ color: c.accentColor }} className="font-semibold">0,00 €</span>
          </div>
          <button type="button" className="w-full rounded-xl py-2 text-sm font-medium text-white" style={{ background: c.primaryColor }}>
            Add to order
          </button>
        </div>
      </div>
    </div>
  );
}
