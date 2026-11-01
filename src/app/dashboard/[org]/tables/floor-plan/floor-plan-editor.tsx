'use client';

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { FloorPlan } from '@/components/storefront/floor-plan';
import { Badge, Button, Icon, Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import { chairPositions, clampToPlan, freeSpot, PLAN_GRID, PLAN_H, PLAN_W, snapToGrid, tableSize, type PlanTable, type TableShape } from '@/lib/floor-plan';
import type { SavedFloorPlan } from '@/server/services/floor-plan';
import { saveAreaAction, saveFloorPlanAction } from '../actions';

type Table = { id: string; label: string; seats: number | null; areaId: string | null; planX: number | null; planY: number | null; planShape: TableShape; planRotation: number };
type Item = { areaId: string | null; x: number | null; y: number | null; shape: TableShape; rotation: number; seats: number | null };

const SHAPES: { key: TableShape; label: string }[] = [
  { key: 'ROUND', label: 'Round' },
  { key: 'SQUARE', label: 'Square' },
  { key: 'RECTANGLE', label: 'Long' },
];
const same = (a: Item, b: Item) => a.areaId === b.areaId && a.x === b.x && a.y === b.y && a.shape === b.shape && a.rotation === b.rotation && a.seats === b.seats;
const onArea = (it: Item | undefined, areaId: string | null) => !!it && !!areaId && it.areaId === areaId && it.x !== null && it.y !== null;

/**
 * Drag-and-drop floor plan of the restaurant's existing tables, one dining area at a time. Tables
 * snap to a grid; the arrow keys move the selected table (Shift for bigger steps) and Delete takes
 * it off the plan. Each area is saved on its own; unsaved areas are marked and leaving the page
 * asks for confirmation.
 */
export function FloorPlanEditor({ org, locationId, areas, tables, canEdit, guestStyle }: { org: string; locationId: string; areas: { id: string; name: string }[]; tables: Table[]; canEdit: boolean; guestStyle: CSSProperties }) {
  const fromProps = () => Object.fromEntries(tables.map((t) => [t.id, { areaId: t.areaId, x: t.planX, y: t.planY, shape: t.planShape, rotation: t.planRotation, seats: t.seats }])) as Record<string, Item>;
  const [areaId, setAreaId] = useState<string | null>(areas[0]?.id ?? null);
  const [items, setItems] = useState<Record<string, Item>>(fromProps);
  const [saved, setSaved] = useState<Record<string, Item>>(fromProps);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'edit' | 'guest'>('edit');
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; pointer: number } | null>(null);
  const area = areas.find((a) => a.id === areaId) ?? areas[0] ?? null;
  const current = area?.id ?? null;

  const dirtyIn = (id: string | null) => tables.some((t) => (onArea(items[t.id], id) || onArea(saved[t.id], id)) && !same(items[t.id], saved[t.id]));
  const anyDirty = areas.some((a) => dirtyIn(a.id));
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  const here = tables.filter((t) => onArea(items[t.id], current));
  const notPlaced = tables.filter((t) => items[t.id].x === null || items[t.id].y === null || !items[t.id].areaId);
  const elsewhere = tables.filter((t) => !onArea(items[t.id], current) && !notPlaced.includes(t));
  const selected = selectedId ? tables.find((t) => t.id === selectedId) ?? null : null;
  const sel = selected ? items[selected.id] : null;

  const update = (id: string, patch: Partial<Item>) =>
    setItems((prev) => {
      const it = { ...prev[id], ...patch };
      if (it.x !== null && it.y !== null) {
        const { w, h } = tableSize(it.shape, it.seats, it.rotation);
        Object.assign(it, clampToPlan(it.x, it.y, w, h));
      }
      return { ...prev, [id]: it };
    });
  const place = (t: Table) => {
    const it = items[t.id];
    const spot = freeSpot(here.map((h) => ({ ...items[h.id], x: items[h.id].x!, y: items[h.id].y! })), it.shape, it.seats, it.rotation);
    update(t.id, { areaId: current, ...spot });
    setSelectedId(t.id);
  };
  const toPlan = (e: { clientX: number; clientY: number }) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const onDown = (e: PointerEvent<SVGGElement>, t: Table) => {
    setSelectedId(t.id);
    if (!canEdit) return;
    const p = toPlan(e);
    const it = items[t.id];
    if (!p || it.x === null || it.y === null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: t.id, dx: p.x - it.x, dy: p.y - it.y, pointer: e.pointerId };
  };
  const onMove = (e: PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const p = toPlan(e);
    if (p) update(d.id, { x: snapToGrid(p.x - d.dx), y: snapToGrid(p.y - d.dy) });
  };
  const onUp = (e: PointerEvent<SVGGElement>) => {
    if (drag.current?.pointer === e.pointerId) drag.current = null;
  };
  const onKey = (e: KeyboardEvent<SVGGElement>, t: Table) => {
    const it = items[t.id];
    if (!canEdit || it.x === null || it.y === null) return;
    const step = PLAN_GRID * (e.shiftKey ? 5 : 1);
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (delta) {
      e.preventDefault();
      update(t.id, { x: it.x + delta[0], y: it.y + delta[1] });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      update(t.id, { x: null, y: null });
      setSelectedId(null);
    }
  };

  const layout = current
    ? {
        placed: here.map((t) => ({ tableId: t.id, x: items[t.id].x!, y: items[t.id].y!, shape: items[t.id].shape, rotation: items[t.id].rotation, seats: items[t.id].seats })),
        removed: tables.filter((t) => onArea(saved[t.id], current) && !onArea(items[t.id], current)).map((t) => t.id),
      }
    : { placed: [], removed: [] };
  // Marks what the server stored (its reply), mirroring saveFloorPlan: placed tables move to the
  // area; removed ones lose their position only if they are still on that area.
  const markSaved = (data: unknown) => {
    const d = data as SavedFloorPlan | undefined;
    if (!d?.areaId) return;
    setSaved((prev) => {
      const next = { ...prev };
      for (const p of d.placed) next[p.tableId] = { areaId: d.areaId, x: p.x, y: p.y, shape: p.shape, rotation: p.rotation, seats: p.seats };
      for (const id of d.removed) if (next[id]?.areaId === d.areaId) next[id] = { ...next[id], x: null, y: null };
      return next;
    });
  };

  if (!tables.length) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-line p-8 text-center text-sm text-muted" data-testid="floor-plan-empty">
        Create your tables first (Tables → Add tables). The floor plan arranges the tables you already have; it never invents any.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="floor-plan-editor">
      {/* Dining areas */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dining areas">
          {areas.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={a.id === current}
              onClick={() => {
                setAreaId(a.id);
                setSelectedId(null);
              }}
              className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ring-1 transition-colors pointer-coarse:h-11', a.id === current ? 'bg-ink text-bg ring-ink' : 'bg-surface text-ink-2 ring-line hover:ring-line-strong')}
              data-testid="editor-area"
            >
              {a.name}
              {dirtyIn(a.id) && <span className="size-2 rounded-full bg-warning" aria-label="unsaved changes" />}
            </button>
          ))}
        </div>
        {canEdit && (
          <ActionForm
            action={saveAreaAction}
            submitLabel="Add area"
            submitVariant="secondary"
            resetOnSuccess
            successText="Added"
            // Open the new area at once, ready for its tables.
            onSuccess={(data) => {
              const id = (data as { id?: string } | undefined)?.id;
              if (id) {
                setAreaId(id);
                setSelectedId(null);
              }
            }}
            // `!`: ActionForm's own space-y-4 and the field's w-full would otherwise win.
            className="flex flex-wrap items-center gap-2 space-y-0!"
            testId="add-area-form"
          >
            <input type="hidden" name="org" value={org} />
            <input type="hidden" name="locationId" value={locationId} />
            <Input name="name" placeholder="New area, e.g. Terrace" aria-label="New dining area name" className="w-44! sm:w-52!" required maxLength={80} />
          </ActionForm>
        )}
        <div className="ms-auto inline-flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="View">
          {(['edit', 'guest'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn('h-8 rounded-md px-3 text-[13px] font-medium pointer-coarse:h-10', view === v ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-surface-2')} data-testid={`editor-view-${v}`}>
              {v === 'edit' ? (canEdit ? 'Edit' : 'Plan') : 'Guest view'}
            </button>
          ))}
        </div>
      </div>

      {!area ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line p-8 text-center text-sm text-muted" data-testid="floor-plan-no-area">
          Add a dining area (for example Main room or Terrace) to start the floor plan.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start">
          {/* Canvas */}
          <div className="min-w-0 space-y-2">
            {view === 'edit' ? (
              <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-surface-2/60">
                <svg ref={svgRef} viewBox={`0 0 ${PLAN_W} ${PLAN_H}`} className="block h-auto w-full min-w-[36rem] select-none" role="group" aria-label={`Floor plan of ${area.name}`} data-testid="editor-canvas">
                  <defs>
                    <pattern id="fp-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M20 0H0V20" fill="none" stroke="var(--mn-border)" strokeWidth="0.8" />
                    </pattern>
                    <pattern id="fp-grid-major" width="100" height="100" patternUnits="userSpaceOnUse">
                      <rect width="100" height="100" fill="url(#fp-grid)" />
                      <path d="M100 0H0V100" fill="none" stroke="var(--mn-border-strong)" strokeWidth="1.2" />
                    </pattern>
                  </defs>
                  <rect width={PLAN_W} height={PLAN_H} fill="url(#fp-grid-major)" onPointerDown={() => setSelectedId(null)} />
                  {here.map((t) => {
                    const it = items[t.id];
                    const { w, h } = tableSize(it.shape, it.seats, it.rotation);
                    const isSel = t.id === selectedId;
                    return (
                      <g
                        key={t.id}
                        transform={`translate(${it.x} ${it.y})`}
                        tabIndex={0}
                        role="button"
                        aria-pressed={isSel}
                        aria-label={`Table ${t.label}, ${it.seats ? `${it.seats} seats` : 'seats not set'}, ${it.shape.toLowerCase()}.${canEdit ? ' Drag or use the arrow keys to move it; Delete takes it off the plan.' : ''}`}
                        onPointerDown={(e) => onDown(e, t)}
                        onPointerMove={onMove}
                        onPointerUp={onUp}
                        onPointerCancel={onUp}
                        onKeyDown={(e) => onKey(e, t)}
                        onFocus={() => setSelectedId(t.id)}
                        className={cn('group outline-none', canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')}
                        style={{ touchAction: 'none' }}
                        data-testid="editor-table"
                        data-table={t.label}
                        data-x={it.x ?? undefined}
                        data-y={it.y ?? undefined}
                      >
                        {chairPositions(it.shape, it.seats, it.rotation).map((c, i) => (
                          <rect key={i} x={c.x - 9} y={c.y - 9} width="18" height="18" rx="6" className="fill-line-strong" />
                        ))}
                        {it.shape === 'ROUND' ? (
                          <circle r={w / 2 + 8} fill="none" strokeWidth="3" className={cn('stroke-[var(--mn-focus)]', isSel ? 'opacity-100' : 'opacity-0 group-focus-visible:opacity-100')} />
                        ) : (
                          <rect x={-w / 2 - 8} y={-h / 2 - 8} width={w + 16} height={h + 16} rx="22" fill="none" strokeWidth="3" className={cn('stroke-[var(--mn-focus)]', isSel ? 'opacity-100' : 'opacity-0 group-focus-visible:opacity-100')} />
                        )}
                        {it.shape === 'ROUND' ? <circle r={w / 2} strokeWidth="2.5" className={cn('fill-surface', it.seats ? 'stroke-ink' : 'stroke-warning [stroke-dasharray:6_5]')} /> : <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={it.shape === 'SQUARE' ? 14 : 18} strokeWidth="2.5" className={cn('fill-surface', it.seats ? 'stroke-ink' : 'stroke-warning [stroke-dasharray:6_5]')} />}
                        <text y={-3} textAnchor="middle" fontSize="22" fontWeight="700" className="fill-ink">
                          {t.label}
                        </text>
                        <text y="19" textAnchor="middle" fontSize="14" className={it.seats ? 'fill-muted' : 'fill-warning'}>
                          {it.seats ? `${it.seats} seats` : 'seats?'}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            ) : (
              <div style={guestStyle} className="rounded-[var(--radius-card)] p-3 text-sf-text sm:p-4" data-testid="editor-guest-view">
                {here.length ? (
                  <FloorPlan
                    areas={[{ id: area.id, name: area.name, tables: here.map((t) => ({ id: t.id, label: t.label, seats: items[t.id].seats, shape: items[t.id].shape, rotation: items[t.id].rotation, x: items[t.id].x!, y: items[t.id].y! }) satisfies PlanTable) }]}
                    status={Object.fromEntries(here.map((t) => [t.id, items[t.id].seats ? 'available' : 'not_bookable']))}
                    selectedId={null}
                    onSelect={() => {}}
                    labels={{ floorPlan: 'Floor plan', tableAvailable: 'Available', tableSelected: 'Your table', tableUnavailable: 'Unavailable', tableTooSmall: 'Too small', tableNotBookable: 'Not bookable online', seats: '{n} seats', tableLabel: 'Table {label}', pickTimeFirst: 'Choose a time' }}
                  />
                ) : (
                  <p className="p-6 text-center text-sm opacity-70">No tables on this plan yet.</p>
                )}
                <p className="mt-2 text-xs opacity-70">Guests see free tables in your colours, booked ones greyed out. Tables without a seat count are never offered online.</p>
              </div>
            )}
            {canEdit && view === 'edit' && <p className="text-xs text-muted">Drag a table to move it. With a table selected, the arrow keys move it (Shift for bigger steps) and Delete takes it off the plan.</p>}
          </div>

          {/* Side panel */}
          <div className="space-y-4">
            {selected && sel && (
              <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4" data-testid="table-inspector">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">Table {selected.label}</p>
                  <button type="button" onClick={() => setSelectedId(null)} className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 pointer-coarse:size-11" aria-label="Close table settings">
                    <Icon name="x" className="size-4" />
                  </button>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted">Seats</p>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="secondary" size="sm" disabled={!canEdit || (sel.seats ?? 1) <= 1} onClick={() => update(selected.id, { seats: Math.max(1, (sel.seats ?? 2) - 1) })} aria-label="One seat less" className="pointer-coarse:size-11">
                      <Icon name="minus" className="size-4" />
                    </Button>
                    <Input type="number" min={1} max={50} value={sel.seats ?? ''} placeholder="?" disabled={!canEdit} onChange={(e) => update(selected.id, { seats: e.target.value ? Math.max(1, Math.min(50, Number(e.target.value))) : null })} className="w-20 text-center" aria-label={`Seats at table ${selected.label}`} data-testid="inspector-seats" />
                    <Button type="button" variant="secondary" size="sm" disabled={!canEdit || (sel.seats ?? 0) >= 50} onClick={() => update(selected.id, { seats: Math.min(50, (sel.seats ?? 1) + 1) })} aria-label="One seat more" className="pointer-coarse:size-11">
                      <Icon name="plus" className="size-4" />
                    </Button>
                  </div>
                  {!sel.seats && <p className="mt-1 text-xs text-warning">Without a seat count, guests cannot pick this table online.</p>}
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted">Shape</p>
                  <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Table shape">
                    {SHAPES.map((s) => (
                      <button key={s.key} type="button" disabled={!canEdit} aria-pressed={sel.shape === s.key} onClick={() => update(selected.id, { shape: s.key, rotation: s.key === 'RECTANGLE' ? sel.rotation : 0 })} className={cn('h-9 rounded-lg text-[13px] font-medium ring-1 pointer-coarse:h-11', sel.shape === s.key ? 'bg-ink text-bg ring-ink' : 'ring-line hover:ring-line-strong')} data-testid={`shape-${s.key}`}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    {sel.shape === 'RECTANGLE' && (
                      <Button type="button" variant="secondary" size="sm" icon="refresh" onClick={() => update(selected.id, { rotation: sel.rotation === 90 ? 0 : 90 })} data-testid="inspector-rotate">
                        Turn 90°
                      </Button>
                    )}
                    {onArea(sel, current) ? (
                      <Button type="button" variant="ghost" size="sm" icon="x" onClick={() => { update(selected.id, { x: null, y: null }); setSelectedId(null); }} data-testid="inspector-remove">
                        Take off the plan
                      </Button>
                    ) : (
                      <Button type="button" size="sm" icon="plus" onClick={() => place(selected)}>
                        Place on {area.name}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {canEdit && (
              <div className="space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{area.name}</p>
                  {dirtyIn(current) ? <Badge tone="warning" dot data-testid="unsaved">Unsaved changes</Badge> : <Badge tone="success" dot>Saved</Badge>}
                </div>
                <p className="text-xs text-muted">{here.length} table{here.length === 1 ? '' : 's'} on this plan.</p>
                <ActionForm action={saveFloorPlanAction} submitLabel="Save floor plan" successText="Saved" onSuccess={markSaved} testId="save-floor-plan">
                  <input type="hidden" name="org" value={org} />
                  <input type="hidden" name="locationId" value={locationId} />
                  <input type="hidden" name="areaId" value={area.id} />
                  <input type="hidden" name="layout" value={JSON.stringify(layout)} />
                </ActionForm>
              </div>
            )}

            <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <p className="mb-2 font-semibold">Tables</p>
              {notPlaced.length === 0 && elsewhere.length === 0 ? (
                <p className="text-sm text-muted">Every table is on a plan.</p>
              ) : (
                <ul className="space-y-1.5" data-testid="unplaced-tables">
                  {[...notPlaced, ...elsewhere].map((t) => {
                    const it = items[t.id];
                    const other = elsewhere.includes(t) ? areas.find((a) => a.id === it.areaId)?.name : null;
                    return (
                      <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                        <button type="button" className="min-w-0 truncate text-start text-sm" onClick={() => setSelectedId(t.id)}>
                          <span className="font-medium">Table {t.label}</span>
                          <span className="text-muted"> · {it.seats ? `${it.seats} seats` : 'seats not set'}{other ? ` · on ${other}` : ''}</span>
                        </button>
                        {canEdit && (
                          <Button type="button" size="sm" variant="secondary" onClick={() => place(t)} data-testid="place-table" data-table={t.label}>
                            {other ? 'Move here' : 'Place'}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
