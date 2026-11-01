'use client';

import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { fmt } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { chairPositions, DEFAULT_ROOM, labelSize, planViewBox, tableSize, type PlanArea, type PlanTable, type TableStatus } from '@/lib/floor-plan';

export type FloorPlanLabels = {
  floorPlan: string;
  tableAvailable: string;
  tableSelected: string;
  tableUnavailable: string;
  tableTooSmall: string;
  tableNotBookable: string;
  seats: string;
  tableLabel: string;
  pickTimeFirst: string;
};

/** Colours per state, from the restaurant's own palette (CSS variables of the storefront). */
const LOOK = {
  available: { fill: 'var(--sf-card)', stroke: 'var(--sf-primary)', text: 'var(--sf-text)', chair: 'color-mix(in srgb, var(--sf-primary) 34%, var(--sf-card))', dash: undefined, opacity: 1 },
  selected: { fill: 'var(--sf-primary)', stroke: 'var(--sf-primary)', text: 'var(--sf-on-primary)', chair: 'var(--sf-primary)', dash: undefined, opacity: 1 },
  unavailable: { fill: 'color-mix(in srgb, var(--sf-text) 7%, var(--sf-card))', stroke: 'color-mix(in srgb, var(--sf-text) 26%, var(--sf-card))', text: 'var(--sf-text)', chair: 'color-mix(in srgb, var(--sf-text) 14%, var(--sf-card))', dash: '7 6', opacity: 0.5 },
  unknown: { fill: 'var(--sf-card)', stroke: 'color-mix(in srgb, var(--sf-text) 32%, var(--sf-card))', text: 'var(--sf-text)', chair: 'color-mix(in srgb, var(--sf-text) 16%, var(--sf-card))', dash: undefined, opacity: 0.85 },
} as const;

/**
 * The restaurant's dining areas drawn to scale, with every table the guest can (or cannot) pick
 * at the chosen time. Tables are buttons: Tab reaches the free ones, the arrow keys move between
 * them, Enter or Space picks one. Without a chosen time nothing can be picked (availability is
 * unknown), so an unavailable table can never look bookable.
 */
export function FloorPlan({
  areas,
  status,
  selectedId,
  onSelect,
  labels,
  disabled = false,
}: {
  areas: PlanArea[];
  /** Per-table status at the chosen time; null while no time is chosen (or it is loading). */
  status: Record<string, TableStatus> | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  labels: FloorPlanLabels;
  disabled?: boolean;
}) {
  const [areaId, setAreaId] = useState(() => areas.find((a) => a.tables.some((t) => t.id === selectedId))?.id ?? areas[0]?.id);
  const area = areas.find((a) => a.id === areaId) ?? areas[0];
  const titleId = useId();
  const box = useMemo(() => planViewBox(area?.tables ?? [], area?.labels ?? [], { w: area?.width ?? DEFAULT_ROOM.w, h: area?.height ?? DEFAULT_ROOM.h }), [area]);
  if (!area) return null;
  const stateOf = (t: PlanTable) => (t.id === selectedId ? 'selected' : !status ? 'unknown' : status[t.id] === 'available' ? 'available' : 'unavailable');
  const selectable = (t: PlanTable) => !disabled && !!status && status[t.id] === 'available';
  const describe = (t: PlanTable) => {
    const what = t.id === selectedId ? labels.tableSelected : !status ? labels.pickTimeFirst : { available: labels.tableAvailable, booked: labels.tableUnavailable, too_small: labels.tableTooSmall, not_bookable: labels.tableNotBookable }[status[t.id] ?? 'booked'];
    return `${fmt(labels.tableLabel, { label: t.label })}${t.seats ? `, ${fmt(labels.seats, { n: t.seats })}` : ''}: ${what}`;
  };
  // Smallest table at least ~44 px on screen: a wide plan scrolls sideways on a phone instead.
  const smallest = Math.min(...area.tables.map((t) => Math.min(tableSize(t.shape, t.seats, t.rotation).w, tableSize(t.shape, t.seats, t.rotation).h)));
  const minWidth = Math.round(Math.min(900, Math.max(300, (box.w * 44) / Math.max(smallest, 40))));

  const onKey = (e: KeyboardEvent<SVGGElement>, t: PlanTable) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (selectable(t)) onSelect(t.id === selectedId ? null : t.id);
      return;
    }
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    if (!dir) return;
    e.preventDefault();
    // Nearest table in the arrow's direction.
    const next = area.tables
      .filter((o) => o.id !== t.id)
      .map((o) => ({ o, dx: o.x - t.x, dy: o.y - t.y }))
      .filter(({ dx, dy }) => dx * dir[0] + dy * dir[1] > 0)
      .sort((a, b) => Math.hypot(a.dx, a.dy) * (1 + Math.abs(a.dx * dir[1] - a.dy * dir[0]) / 200) - Math.hypot(b.dx, b.dy) * (1 + Math.abs(b.dx * dir[1] - b.dy * dir[0]) / 200))[0];
    if (next) (e.currentTarget.ownerSVGElement?.querySelector(`[data-table-id="${next.o.id}"]`) as SVGGElement | null)?.focus();
  };

  return (
    <div className="space-y-3" data-testid="floor-plan">
      {areas.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={labels.floorPlan}>
          {areas.map((a) => {
            const free = status ? a.tables.filter((t) => status[t.id] === 'available').length : null;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={a.id === area.id}
                onClick={() => setAreaId(a.id)}
                className={cn('inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ring-1 transition-colors', a.id === area.id ? 'bg-sf-primary text-sf-on-primary ring-sf-primary' : 'bg-sf-card ring-sf-text/12 hover:ring-sf-text/30')}
                data-testid="plan-area"
              >
                {a.name}
                {free !== null && <span className={cn('rounded-full px-1.5 text-xs tabular-nums', a.id === area.id ? 'bg-sf-on-primary/20' : 'bg-sf-text/8')}>{free}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl ring-1 ring-sf-text/10" style={{ background: 'color-mix(in srgb, var(--sf-text) 3%, var(--sf-card))' }}>
        <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="block h-auto w-full select-none" style={{ minWidth }} role="group" aria-labelledby={titleId}>
          <title id={titleId}>{`${labels.floorPlan}: ${area.name}`}</title>
          <defs>
            <pattern id={`${titleId}-dots`} width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.6" fill="color-mix(in srgb, var(--sf-text) 12%, transparent)" />
            </pattern>
          </defs>
          {/* The room as the restaurant drew it: its walls, then its labels (entrance, bar…). */}
          <rect x={0} y={0} width={area.width} height={area.height} rx="14" fill={`url(#${titleId}-dots)`} stroke="color-mix(in srgb, var(--sf-text) 22%, transparent)" strokeWidth="4" data-testid="plan-room" />
          {area.labels.map((l) => {
            const s = labelSize(l.text);
            return (
              <g key={l.id} transform={`translate(${l.x} ${l.y})`} data-testid="plan-label">
                <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} rx="8" fill="color-mix(in srgb, var(--sf-text) 6%, var(--sf-card))" />
                <text y="6" textAnchor="middle" fontSize="17" fontWeight="600" fill="var(--sf-text)" opacity="0.7">
                  {l.text}
                </text>
              </g>
            );
          })}
          {area.tables.map((t) => {
            const look = LOOK[stateOf(t)];
            const { w, h } = tableSize(t.shape, t.seats, t.rotation);
            const can = selectable(t);
            return (
              <g
                key={t.id}
                transform={`translate(${t.x} ${t.y})`}
                role="button"
                tabIndex={can || t.id === selectedId ? 0 : -1}
                aria-pressed={t.id === selectedId}
                aria-disabled={!can && t.id !== selectedId}
                aria-label={describe(t)}
                data-testid="plan-table"
                data-table={t.label}
                data-table-id={t.id}
                data-status={status ? (t.id === selectedId ? 'selected' : (status[t.id] ?? 'booked')) : 'unknown'}
                onClick={() => (can || t.id === selectedId) && onSelect(t.id === selectedId ? null : t.id)}
                onKeyDown={(e) => onKey(e, t)}
                className={cn('group outline-none', can ? 'cursor-pointer' : 'cursor-not-allowed')}
                opacity={look.opacity}
              >
                {chairPositions(t.shape, t.seats, t.rotation).map((c, i) => (
                  <rect key={i} x={c.x - 9} y={c.y - 9} width="18" height="18" rx="6" fill={look.chair} />
                ))}
                {/* Focus ring (SVG has no reliable outline). */}
                {t.shape === 'ROUND' ? (
                  <circle r={w / 2 + 7} fill="none" stroke="var(--sf-primary)" strokeWidth="3" className="opacity-0 group-focus-visible:opacity-100" />
                ) : (
                  <rect x={-w / 2 - 7} y={-h / 2 - 7} width={w + 14} height={h + 14} rx="22" fill="none" stroke="var(--sf-primary)" strokeWidth="3" className="opacity-0 group-focus-visible:opacity-100" />
                )}
                {t.shape === 'ROUND' ? (
                  <circle r={w / 2} fill={look.fill} stroke={look.stroke} strokeWidth="3" strokeDasharray={look.dash} className={cn(can && 'transition-[stroke-width] group-hover:[stroke-width:5]')} />
                ) : (
                  <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={t.shape === 'SQUARE' ? 14 : 18} fill={look.fill} stroke={look.stroke} strokeWidth="3" strokeDasharray={look.dash} className={cn(can && 'transition-[stroke-width] group-hover:[stroke-width:5]')} />
                )}
                <text y={t.seats ? -3 : 7} textAnchor="middle" fontSize="22" fontWeight="700" fill={look.text}>
                  {t.label}
                </text>
                {t.seats !== null && (
                  <text y="19" textAnchor="middle" fontSize="14" fill={look.text} opacity="0.75">
                    {fmt(labels.seats, { n: t.seats })}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs opacity-80" aria-hidden>
        <li className="flex items-center gap-1.5"><span className="size-3.5 rounded-full border-2 border-sf-primary bg-sf-card" />{labels.tableAvailable}</li>
        <li className="flex items-center gap-1.5"><span className="size-3.5 rounded-full bg-sf-primary" />{labels.tableSelected}</li>
        <li className="flex items-center gap-1.5"><span className="size-3.5 rounded-full border-2 border-dashed border-sf-text/30 bg-sf-text/5" />{labels.tableUnavailable}</li>
      </ul>
    </div>
  );
}
