'use client';

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ActionForm } from '@/components/forms/action-form';
import { InlineAction } from '@/components/forms/inline-action';
import { FloorPlan } from '@/components/storefront/floor-plan';
import { Badge, Button, Icon, Input, Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  arrangeTables,
  chairPositions,
  clampLabel,
  clampToPlan,
  DEFAULT_ROOM,
  freeSpot,
  LABEL_LIMITS,
  labelSize,
  LAYOUT_TEMPLATES,
  normalizeRoom,
  overlappingIds,
  PLAN_GRID,
  ROOM_LIMITS,
  snapToGrid,
  tableSize,
  type LayoutTemplate,
  type PlanLabel,
  type PlanRoom,
  type PlanTable,
  type TableShape,
} from '@/lib/floor-plan';
import type { SavedFloorPlan } from '@/server/services/floor-plan';
import { tableAssignmentAction } from '../../reservations/actions';
import { addPlanTablesAction, removeAreaAction, saveAreaAction, saveFloorPlanAction } from '../actions';

type Table = { id: string; label: string; seats: number | null; areaId: string | null; planX: number | null; planY: number | null; planShape: TableShape; planRotation: number };
type Area = { id: string; name: string; width: number; height: number; labels: PlanLabel[] };
type Item = { areaId: string | null; x: number | null; y: number | null; shape: TableShape; rotation: number; seats: number | null };
type Plan = { w: number; h: number; labels: PlanLabel[] };
type Selection = { kind: 'table' | 'label'; id: string } | null;

const SHAPES: { key: TableShape; label: string }[] = [
  { key: 'ROUND', label: 'Round' },
  { key: 'SQUARE', label: 'Square' },
  { key: 'RECTANGLE', label: 'Long' },
];
/** Starting sizes; the owner sets the real measurements. */
const ROOM_PRESETS = [
  { label: 'Small', w: 600, h: 400 },
  { label: 'Medium', w: 1000, h: 640 },
  { label: 'Large', w: 1400, h: 900 },
  { label: 'Long', w: 1600, h: 500 },
];
/** Space drawn around the room so its walls stay visible. */
const PAD = 24;
const GUEST_LABELS = { floorPlan: 'Floor plan', tableAvailable: 'Available', tableSelected: 'Your table', tableUnavailable: 'Unavailable', tableTooSmall: 'Too small', tableNotBookable: 'Not bookable online', seats: '{n} seats', tableLabel: 'Table {label}', pickTimeFirst: 'Choose a time' };

const fromTable = (t: Table): Item => ({ areaId: t.areaId, x: t.planX, y: t.planY, shape: t.planShape, rotation: t.planRotation, seats: t.seats });
const fromArea = (a: Area): Plan => ({ w: a.width, h: a.height, labels: a.labels });
const same = (a: Item, b: Item) => a.areaId === b.areaId && a.x === b.x && a.y === b.y && a.shape === b.shape && a.rotation === b.rotation && a.seats === b.seats;
const samePlan = (a: Plan, b: Plan) => a.w === b.w && a.h === b.h && JSON.stringify(a.labels) === JSON.stringify(b.labels);
const onArea = (it: Item, areaId: string | null) => !!areaId && it.areaId === areaId && it.x !== null && it.y !== null;
const metres = (u: number) => (u / 100).toLocaleString('en', { maximumFractionDigits: 2 });
const newLabelId = () => Math.random().toString(36).slice(2, 10);
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Small label above a dense row of controls. */
const subLabel = 'text-[11px] font-medium text-muted';

/**
 * One panel of the side inspector: a titled, compact card. Several of these stack beside the
 * canvas instead of one long column, so the whole builder fits on a screen.
 */
function Block({ title, action, children, testId, tone }: { title: ReactNode; action?: ReactNode; children: ReactNode; testId?: string; tone?: 'selected' }) {
  return (
    <section className={cn('rounded-[var(--radius-card)] border bg-surface', tone === 'selected' ? 'border-[var(--mn-focus)]/40 ring-1 ring-[var(--mn-focus)]/20' : 'border-line')} data-testid={testId}>
      <header className="flex min-h-9 items-center justify-between gap-2 border-b border-line px-3">
        <h3 className="truncate text-[13px] font-semibold text-ink">{title}</h3>
        {action}
      </header>
      <div className="space-y-2.5 p-3">{children}</div>
    </section>
  );
}

/** A labelled row: name on the left, its controls on the right. Keeps the inspector short. */
function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <span className={cn(subLabel, 'shrink-0')}>{label}</span>
      {children}
    </div>
  );
}

function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="-me-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink pointer-coarse:size-10" aria-label={label}>
      <Icon name="x" className="size-4" />
    </button>
  );
}

/**
 * Floor plan builder for one location. Each dining area is a room the restaurant draws itself: its
 * size, its labels (entrance, bar…) and its existing tables, dragged into place (or moved with the
 * arrow keys and the nudge buttons on touch screens), with their seats and shape. Templates suggest
 * a tidy arrangement of the tables already there; nothing is invented and nothing is saved until
 * the owner presses Save. Each area is saved on its own; unsaved areas are marked and leaving the
 * page asks for confirmation.
 *
 * Layout: the canvas is the page, and the controls sit beside it in a side panel that follows the
 * screen (sticky) and scrolls on its own, so building a room needs no page scrolling.
 */
export function FloorPlanEditor({
  org,
  locationId,
  areas,
  tables,
  canEdit,
  guestStyle,
  guestMap,
  reservationsOn = false,
  reservationsEnabled = true,
  canSetMode = false,
}: {
  org: string;
  locationId: string;
  areas: Area[];
  tables: Table[];
  canEdit: boolean;
  guestStyle: CSSProperties;
  /** Guests currently see the plan when booking. */
  guestMap: boolean;
  /** The reservations module is available to this restaurant. */
  reservationsOn?: boolean;
  /** Online reservations are switched on for this location. */
  reservationsEnabled?: boolean;
  /** This staff member may change how tables get onto online requests. */
  canSetMode?: boolean;
}) {
  const [areaId, setAreaId] = useState<string | null>(areas[0]?.id ?? null);
  // Local edits and the last saved state, on top of what the server sent (new tables and areas
  // arriving from the server simply appear).
  const [items, setItems] = useState<Record<string, Item>>({});
  const [saved, setSaved] = useState<Record<string, Item>>({});
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [savedPlans, setSavedPlans] = useState<Record<string, Plan>>({});
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<'edit' | 'guest'>('edit');
  const [newLabel, setNewLabel] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const workRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'table' | 'label'; id: string; dx: number; dy: number; pointer: number } | null>(null);

  const [workTop, setWorkTop] = useState(0);

  const areaIds = new Set(areas.map((a) => a.id));
  // An edit that points at a removed area no longer counts: the server's state wins.
  const resolve = (map: Record<string, Item>, t: Table) => {
    const it = map[t.id];
    return it && (!it.areaId || areaIds.has(it.areaId)) ? it : fromTable(t);
  };
  const itemOf = (t: Table) => resolve(items, t);
  const savedOf = (t: Table) => resolve(saved, t);
  const planOf = (a: Area) => plans[a.id] ?? fromArea(a);
  const savedPlanOf = (a: Area) => savedPlans[a.id] ?? fromArea(a);
  const area = areas.find((a) => a.id === areaId) ?? areas[0] ?? null;
  const current = area?.id ?? null;
  const plan: Plan = area ? planOf(area) : { ...DEFAULT_ROOM, labels: [] };
  const room: PlanRoom = { w: plan.w, h: plan.h };
  const roomOf = (id: string | null): PlanRoom => {
    const a = areas.find((x) => x.id === id);
    return a ? { w: planOf(a).w, h: planOf(a).h } : room;
  };

  const dirtyIn = (a: Area) => !samePlan(planOf(a), savedPlanOf(a)) || tables.some((t) => (onArea(itemOf(t), a.id) || onArea(savedOf(t), a.id)) && !same(itemOf(t), savedOf(t)));
  const anyDirty = areas.some(dirtyIn);
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  const here = tables.filter((t) => onArea(itemOf(t), current));
  const notPlaced = tables.filter((t) => {
    const it = itemOf(t);
    return it.x === null || it.y === null || !it.areaId;
  });
  const elsewhere = tables.filter((t) => !onArea(itemOf(t), current) && !notPlaced.includes(t));
  const drawn: PlanTable[] = here.map((t) => {
    const it = itemOf(t);
    return { id: t.id, label: t.label, seats: it.seats, shape: it.shape, rotation: it.rotation, x: it.x!, y: it.y! };
  });
  const overlaps = overlappingIds(drawn);
  const selTable = selection?.kind === 'table' ? (here.find((t) => t.id === selection.id) ?? null) : null;
  const sel = selTable ? itemOf(selTable) : null;
  const selLabel = selection?.kind === 'label' ? (plan.labels.find((l) => l.id === selection.id) ?? null) : null;
  const isDirty = area ? dirtyIn(area) : false;
  // Tables drawn on any room of this location: what a guest would see on the booking page.
  const placedAnywhere = tables.some((t) => {
    const it = itemOf(t);
    return !!it.areaId && areaIds.has(it.areaId) && it.x !== null && it.y !== null;
  });
  const noSeats = here.filter((t) => !itemOf(t).seats).length;

  // Selecting something brings its settings into view: the panel scrolls, never the page, so the
  // canvas stays where it is while dragging.
  const selectedId = selection?.id ?? null;
  useEffect(() => {
    if (selectedId) panelRef.current?.scrollTo({ top: 0 });
  }, [selectedId]);

  // How far down the page the workspace starts, so on a wide screen it takes exactly the rest of
  // the window: the canvas and the side panel then scroll inside themselves instead of making the
  // page longer. Re-measured whenever anything above it changes height.
  const hasArea = !!current;
  useEffect(() => {
    const el = workRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setWorkTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [hasArea]);

  // -------------------------------------------------------------- edits
  const setItem = (id: string, patch: Partial<Item>) =>
    setItems((prev) => {
      const t = tables.find((x) => x.id === id);
      if (!t) return prev;
      const it = { ...resolve(prev, t), ...patch };
      if (it.x !== null && it.y !== null) {
        const { w, h } = tableSize(it.shape, it.seats, it.rotation);
        Object.assign(it, clampToPlan(it.x, it.y, w, h, roomOf(it.areaId)));
      }
      return { ...prev, [id]: it };
    });
  const setPlan = (patch: Partial<Plan>) => {
    if (!area) return;
    setPlans((prev) => ({ ...prev, [area.id]: { ...(prev[area.id] ?? fromArea(area)), ...patch } }));
  };
  const place = (t: Table) => {
    const it = itemOf(t);
    setItem(t.id, { areaId: current, ...freeSpot(drawn, it.shape, it.seats, it.rotation, room) });
    setSelection({ kind: 'table', id: t.id });
  };
  const placeAll = () =>
    setItems((prev) => {
      const next = { ...prev };
      const taken = [...drawn];
      for (const t of notPlaced) {
        const it = resolve(prev, t);
        const spot = freeSpot(taken, it.shape, it.seats, it.rotation, room);
        next[t.id] = { ...it, areaId: current, ...spot };
        taken.push({ id: t.id, label: t.label, seats: it.seats, shape: it.shape, rotation: it.rotation, ...spot });
      }
      return next;
    });
  const arrange = (key: LayoutTemplate) => {
    const pos = arrangeTables(key, drawn, room);
    setItems((prev) => {
      const next = { ...prev };
      for (const t of here) next[t.id] = { ...resolve(prev, t), ...pos[t.id] };
      return next;
    });
    setSelection(null);
  };
  const resizeRoom = (w: number, h: number) => {
    if (!(w > 0) || !(h > 0)) return; // an emptied field changes nothing
    const r = normalizeRoom(w, h);
    setPlan({ w: r.w, h: r.h, labels: plan.labels.map((l) => ({ ...l, ...clampLabel(l.x, l.y, l.text, r) })) });
    // Every table of this room stays inside the new walls.
    setItems((prev) => {
      const next = { ...prev };
      for (const t of here) {
        const it = resolve(prev, t);
        const { w: tw, h: th } = tableSize(it.shape, it.seats, it.rotation);
        next[t.id] = { ...it, ...clampToPlan(it.x!, it.y!, tw, th, r) };
      }
      return next;
    });
  };
  const discard = () => {
    if (!area) return;
    setItems((prev) => {
      const next = { ...prev };
      for (const t of tables) if (onArea(resolve(prev, t), area.id) || onArea(savedOf(t), area.id)) next[t.id] = savedOf(t);
      return next;
    });
    setPlans((prev) => ({ ...prev, [area.id]: savedPlanOf(area) }));
    setSelection(null);
  };
  const addLabel = () => {
    const text = newLabel.trim().slice(0, LABEL_LIMITS.maxLength);
    if (!text || plan.labels.length >= LABEL_LIMITS.maxPerArea) return;
    const id = newLabelId();
    setPlan({ labels: [...plan.labels, { id, text, ...clampLabel(room.w / 2, 40, text, room) }] });
    setNewLabel('');
    setSelection({ kind: 'label', id });
  };
  const updateLabel = (id: string, patch: Partial<PlanLabel>) =>
    setPlan({ labels: plan.labels.map((l) => (l.id === id ? { ...l, ...patch, ...clampLabel(patch.x ?? l.x, patch.y ?? l.y, patch.text ?? l.text, room) } : l)) });
  const removeLabel = (id: string) => {
    setPlan({ labels: plan.labels.filter((l) => l.id !== id) });
    setSelection(null);
  };
  const takeOff = (id: string) => {
    setItem(id, { x: null, y: null });
    setSelection(null);
  };
  const nudge = (kind: 'table' | 'label', id: string, dx: number, dy: number) => {
    if (kind === 'table') {
      const t = here.find((x) => x.id === id);
      const it = t && itemOf(t);
      if (it && it.x !== null && it.y !== null) setItem(id, { x: it.x + dx, y: it.y + dy });
    } else {
      const l = plan.labels.find((x) => x.id === id);
      if (l) updateLabel(id, { x: l.x + dx, y: l.y + dy });
    }
  };

  // -------------------------------------------------------------- pointer and keyboard
  const toPlan = (e: { clientX: number; clientY: number }) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const startDrag = (e: PointerEvent<SVGGElement>, kind: 'table' | 'label', id: string, x: number, y: number) => {
    setSelection({ kind, id });
    // Cancelling the pointer event also cancels the focus a click gives: focus it here, so the
    // arrow keys move what was just clicked.
    e.currentTarget.focus({ preventScroll: true });
    if (!canEdit) return;
    const p = toPlan(e);
    if (!p) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, id, dx: p.x - x, dy: p.y - y, pointer: e.pointerId };
  };
  const onMove = (e: PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const p = toPlan(e);
    if (!p) return;
    const x = snapToGrid(p.x - d.dx);
    const y = snapToGrid(p.y - d.dy);
    if (d.kind === 'table') setItem(d.id, { x, y });
    else updateLabel(d.id, { x, y });
  };
  const onUp = (e: PointerEvent<SVGGElement>) => {
    if (drag.current?.pointer === e.pointerId) drag.current = null;
  };
  const onKey = (e: KeyboardEvent<SVGGElement>, kind: 'table' | 'label', id: string) => {
    if (!canEdit) return;
    const step = PLAN_GRID * (e.shiftKey ? 5 : 1);
    const dir = ARROWS[e.key];
    if (dir) {
      e.preventDefault();
      nudge(kind, id, dir[0] * step, dir[1] * step);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (kind === 'table') takeOff(id);
      else removeLabel(id);
    }
  };

  // -------------------------------------------------------------- saving
  const layout = current
    ? {
        placed: here.map((t) => {
          const it = itemOf(t);
          return { tableId: t.id, x: it.x!, y: it.y!, shape: it.shape, rotation: it.rotation, seats: it.seats };
        }),
        removed: tables.filter((t) => onArea(savedOf(t), current) && !onArea(itemOf(t), current)).map((t) => t.id),
        room: { width: plan.w, height: plan.h },
        labels: plan.labels,
      }
    : null;
  // Marks what the server stored (its reply), mirroring saveFloorPlan.
  const markSaved = (data: unknown) => {
    const d = data as SavedFloorPlan | undefined;
    if (!d?.areaId) return;
    setSaved((prev) => {
      const next = { ...prev };
      for (const p of d.placed) next[p.tableId] = { areaId: d.areaId, x: p.x, y: p.y, shape: p.shape, rotation: p.rotation, seats: p.seats };
      for (const id of d.removed) {
        const t = tables.find((x) => x.id === id);
        const base = t ? resolve(prev, t) : null;
        if (base && base.areaId === d.areaId) next[id] = { ...base, x: null, y: null };
      }
      return next;
    });
    setSavedPlans((prev) => {
      const a = areas.find((x) => x.id === d.areaId);
      const before = prev[d.areaId] ?? (a ? fromArea(a) : { ...DEFAULT_ROOM, labels: [] });
      return { ...prev, [d.areaId]: { w: d.room.width, h: d.room.height, labels: d.labels ?? before.labels } };
    });
  };

  // -------------------------------------------------------------- views
  const addArea = canEdit && (
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
          setSelection(null);
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
  );

  const addTables = canEdit && area && (
    <ActionForm action={addPlanTablesAction} submitLabel="Add to plan" submitVariant="secondary" resetOnSuccess successText="Added" testId="add-plan-tables" className="space-y-2.5!">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="areaId" value={area.id} />
      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-2">
        <label className={cn('block min-w-0', subLabel)}>
          Table labels
          <Input name="labels" required placeholder="e.g. 1-6 or T1, T2" className="mt-1" data-testid="add-plan-labels" />
        </label>
        <label className={cn('block', subLabel)}>
          Seats
          <Input name="seats" type="number" min={1} max={50} placeholder="?" className="mt-1" data-testid="add-plan-seats" />
        </label>
      </div>
      <label className={cn('block', subLabel)}>
        Shape
        <Select name="shape" defaultValue="ROUND" className="mt-1" data-testid="add-plan-shape">
          {SHAPES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
      </label>
    </ActionForm>
  );

  /** One click from a saved plan to a plan guests can actually book on. */
  const showToGuests = (
    <ActionForm
      action={tableAssignmentAction}
      submitLabel="Show the plan to guests"
      successText="Guests now choose on the plan"
      className="flex flex-wrap items-center gap-2 space-y-0!"
      testId="enable-guest-plan"
    >
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="mode" value="guest" />
      {/* A guest who leaves the choice to the restaurant still gets a free table held. */}
      <input type="hidden" name="autoFallback" value="on" />
    </ActionForm>
  );

  if (!tables.length && !areas.length) {
    return (
      <div className="space-y-4" data-testid="floor-plan-editor">
        <div className="rounded-[var(--radius-card)] border border-dashed border-line p-6 text-sm text-muted" data-testid="floor-plan-empty">
          <p className="mb-2 font-medium text-ink">Start your floor plan</p>
          <ol className="mb-4 list-decimal space-y-1 ps-5">
            <li>Add a dining area for each room or zone (for example Main room, Terrace).</li>
            <li>Add your tables to it, with their seats and shape, or place the tables you already have.</li>
            <li>Drag them where they really are, then save. Guests see the plan only if you choose so above.</li>
          </ol>
          {addArea}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="floor-plan-editor">
      {/* Dining areas and view */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dining areas">
          {areas.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={a.id === current}
              onClick={() => {
                setAreaId(a.id);
                setSelection(null);
              }}
              className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ring-1 transition-colors pointer-coarse:h-11', a.id === current ? 'bg-ink text-bg ring-ink' : 'bg-surface text-ink-2 ring-line hover:ring-line-strong')}
              data-testid="editor-area"
            >
              {a.name}
              {dirtyIn(a) && <span className="size-2 rounded-full bg-warning" aria-label="unsaved changes" />}
            </button>
          ))}
        </div>
        {addArea}
        {area && (
          <div className="ms-auto inline-flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="View">
            {(['edit', 'guest'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn('h-8 rounded-md px-3 text-[13px] font-medium pointer-coarse:h-10', view === v ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-surface-2')} data-testid={`editor-view-${v}`}>
                {v === 'edit' ? (canEdit ? 'Edit' : 'Plan') : 'Guest view'}
              </button>
            ))}
          </div>
        )}
      </div>

      {!area ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line p-8 text-center text-sm text-muted" data-testid="floor-plan-no-area">
          Add a dining area (for example Main room or Terrace) to start the floor plan.
        </div>
      ) : (
        <div
          ref={workRef}
          style={{ '--fp-top': `${workTop}px` } as CSSProperties}
          className={cn('grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]', workTop > 0 && 'xl:h-[calc(100dvh-var(--fp-top)-1.5rem)] xl:min-h-[26rem]')}
        >
          {/* Canvas */}
          <div className="flex min-w-0 flex-col gap-2 xl:min-h-0">
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2" data-testid="plan-toolbar">
                <p className="min-w-0 flex-1 text-[13px] text-ink-2">
                  <span className="font-semibold text-ink">{area.name}</span> · {here.length} table{here.length === 1 ? '' : 's'} · {metres(plan.w)} × {metres(plan.h)} m
                  {overlaps.size > 0 && (
                    <span className="ms-2 inline-flex items-center gap-1 text-warning" data-testid="overlap-warning">
                      <Icon name="alert" className="size-3.5" /> {overlaps.size} tables overlap
                    </span>
                  )}
                </p>
                {reservationsOn && guestMap && placedAnywhere && (
                  <Badge tone="success" dot data-testid="guest-plan-live">
                    Guests see this plan
                  </Badge>
                )}
                {isDirty ? (
                  <Badge tone="warning" dot data-testid="unsaved">
                    Unsaved changes
                  </Badge>
                ) : (
                  <Badge tone="success" dot>
                    Saved
                  </Badge>
                )}
                {isDirty && (
                  <Button type="button" variant="ghost" size="sm" onClick={discard} data-testid="discard-plan">
                    Discard
                  </Button>
                )}
                <ActionForm action={saveFloorPlanAction} submitLabel="Save floor plan" successText="Saved" onSuccess={markSaved} className="flex flex-wrap items-center gap-2 space-y-0!" testId="save-floor-plan">
                  <input type="hidden" name="org" value={org} />
                  <input type="hidden" name="locationId" value={locationId} />
                  <input type="hidden" name="areaId" value={area.id} />
                  <input type="hidden" name="layout" value={JSON.stringify(layout)} />
                </ActionForm>
              </div>
            )}

            {/* Saving the plan does not publish it: the booking page shows it only in "Guests
                choose on the floor plan". Said here, where the plan is saved, with the switch. */}
            {reservationsOn && placedAnywhere && !guestMap && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] border border-warning/25 bg-warning/10 px-3 py-2" data-testid="guest-plan-off">
                <Icon name="alert" className="size-4 shrink-0 text-warning" />
                <p className="min-w-0 flex-1 text-[13px] text-ink-2">
                  <span className="font-medium text-ink">Guests do not see this plan yet.</span> The booking page still shows the simple form.
                </p>
                {canSetMode ? showToGuests : <span className="text-[13px] text-muted">Ask a manager to switch it on.</span>}
              </div>
            )}
            {reservationsOn && placedAnywhere && guestMap && !reservationsEnabled && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] border border-warning/25 bg-warning/10 px-3 py-2.5" data-testid="reservations-off">
                <Icon name="alert" className="size-4 shrink-0 text-warning" />
                <p className="min-w-0 flex-1 text-[13px] text-ink-2">
                  <span className="font-medium text-ink">Online reservations are off for this location.</span> Switch them on in Settings → Ordering channels before guests can book on this plan.
                </p>
              </div>
            )}

            {/* Below xl the plan keeps a readable width and scrolls sideways; from xl it is scaled
                to fit the pane, so the whole room is always in view without page scrolling. */}
            {view === 'edit' ? (
              <div className="mn-scroll overflow-auto rounded-[var(--radius-card)] border border-line bg-surface-2/60 xl:min-h-0 xl:flex-1 xl:overflow-hidden">
                <svg
                  ref={svgRef}
                  viewBox={`${-PAD} ${-PAD} ${plan.w + PAD * 2} ${plan.h + PAD * 2}`}
                  className="block h-auto w-full min-w-[var(--fp-min-w)] select-none xl:h-full xl:min-w-0"
                  style={{ '--fp-min-w': `${Math.max(560, Math.round((plan.w + PAD * 2) * 0.6))}px` } as CSSProperties}
                  role="group"
                  aria-label={`Floor plan of ${area.name}, ${metres(plan.w)} by ${metres(plan.h)} metres`}
                  data-testid="editor-canvas"
                >
                  <defs>
                    <pattern id="fp-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M20 0H0V20" fill="none" stroke="var(--mn-border)" strokeWidth="0.8" />
                    </pattern>
                    <pattern id="fp-grid-major" width="100" height="100" patternUnits="userSpaceOnUse">
                      <rect width="100" height="100" fill="url(#fp-grid)" />
                      <path d="M100 0H0V100" fill="none" stroke="var(--mn-border-strong)" strokeWidth="1.2" />
                    </pattern>
                  </defs>
                  <rect x={-PAD} y={-PAD} width={plan.w + PAD * 2} height={plan.h + PAD * 2} fill="transparent" onPointerDown={() => setSelection(null)} />
                  <rect x={0} y={0} width={plan.w} height={plan.h} rx="10" fill="url(#fp-grid-major)" className="stroke-ink/70" strokeWidth="4" onPointerDown={() => setSelection(null)} data-testid="editor-room" data-w={plan.w} data-h={plan.h} />
                  {plan.labels.map((l) => {
                    const s = labelSize(l.text);
                    const isSel = selection?.kind === 'label' && selection.id === l.id;
                    return (
                      <g
                        key={l.id}
                        transform={`translate(${l.x} ${l.y})`}
                        tabIndex={0}
                        role="button"
                        aria-pressed={isSel}
                        aria-label={`Label ${l.text}.${canEdit ? ' Drag or use the arrow keys to move it; Delete removes it.' : ''}`}
                        onPointerDown={(e) => startDrag(e, 'label', l.id, l.x, l.y)}
                        onPointerMove={onMove}
                        onPointerUp={onUp}
                        onPointerCancel={onUp}
                        onKeyDown={(e) => onKey(e, 'label', l.id)}
                        onFocus={() => setSelection({ kind: 'label', id: l.id })}
                        className={cn('group outline-none', canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')}
                        style={{ touchAction: 'none' }}
                        data-testid="editor-label"
                        data-label={l.text}
                        data-x={l.x}
                        data-y={l.y}
                      >
                        <rect x={-s.w / 2 - 6} y={-s.h / 2 - 6} width={s.w + 12} height={s.h + 12} rx="12" fill="none" strokeWidth="3" className={cn('stroke-[var(--mn-focus)]', isSel ? 'opacity-100' : 'opacity-0 group-focus-visible:opacity-100')} />
                        <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} rx="8" className="fill-surface stroke-line-strong" strokeWidth="1.5" strokeDasharray="5 4" />
                        <text y="6" textAnchor="middle" fontSize="17" fontWeight="600" className="fill-ink-2">
                          {l.text}
                        </text>
                      </g>
                    );
                  })}
                  {here.map((t) => {
                    const it = itemOf(t);
                    const { w, h } = tableSize(it.shape, it.seats, it.rotation);
                    const isSel = selection?.kind === 'table' && selection.id === t.id;
                    const overlapping = overlaps.has(t.id);
                    return (
                      <g
                        key={t.id}
                        transform={`translate(${it.x} ${it.y})`}
                        tabIndex={0}
                        role="button"
                        aria-pressed={isSel}
                        aria-label={`Table ${t.label}, ${it.seats ? `${it.seats} seats` : 'seats not set'}, ${{ ROUND: 'round', SQUARE: 'square', RECTANGLE: 'rectangle' }[it.shape]}${overlapping ? ', overlaps another table' : ''}.${canEdit ? ' Drag or use the arrow keys to move it; Delete takes it off the plan.' : ''}`}
                        onPointerDown={(e) => startDrag(e, 'table', t.id, it.x!, it.y!)}
                        onPointerMove={onMove}
                        onPointerUp={onUp}
                        onPointerCancel={onUp}
                        onKeyDown={(e) => onKey(e, 'table', t.id)}
                        onFocus={() => setSelection({ kind: 'table', id: t.id })}
                        className={cn('group outline-none', canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')}
                        style={{ touchAction: 'none' }}
                        data-testid="editor-table"
                        data-table={t.label}
                        data-x={it.x ?? undefined}
                        data-y={it.y ?? undefined}
                        data-overlap={overlapping || undefined}
                      >
                        {chairPositions(it.shape, it.seats, it.rotation).map((c, i) => (
                          <rect key={i} x={c.x - 9} y={c.y - 9} width="18" height="18" rx="6" className="fill-line-strong" />
                        ))}
                        {it.shape === 'ROUND' ? (
                          <circle r={w / 2 + 8} fill="none" strokeWidth="3" className={cn('stroke-[var(--mn-focus)]', isSel ? 'opacity-100' : 'opacity-0 group-focus-visible:opacity-100')} />
                        ) : (
                          <rect x={-w / 2 - 8} y={-h / 2 - 8} width={w + 16} height={h + 16} rx="22" fill="none" strokeWidth="3" className={cn('stroke-[var(--mn-focus)]', isSel ? 'opacity-100' : 'opacity-0 group-focus-visible:opacity-100')} />
                        )}
                        {it.shape === 'ROUND' ? (
                          <circle r={w / 2} strokeWidth="2.5" className={cn('fill-surface', overlapping ? 'stroke-danger' : it.seats ? 'stroke-ink' : 'stroke-warning [stroke-dasharray:6_5]')} />
                        ) : (
                          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={it.shape === 'SQUARE' ? 14 : 18} strokeWidth="2.5" className={cn('fill-surface', overlapping ? 'stroke-danger' : it.seats ? 'stroke-ink' : 'stroke-warning [stroke-dasharray:6_5]')} />
                        )}
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
              <div style={guestStyle} className="mn-scroll rounded-[var(--radius-card)] p-3 text-sf-text sm:p-4 xl:min-h-0 xl:flex-1 xl:overflow-y-auto" data-testid="editor-guest-view">
                {here.length ? (
                  <FloorPlan
                    areas={[{ id: area.id, name: area.name, width: plan.w, height: plan.h, labels: plan.labels, tables: drawn }]}
                    status={Object.fromEntries(drawn.map((t) => [t.id, t.seats ? 'available' : 'not_bookable']))}
                    selectedId={null}
                    onSelect={() => {}}
                    labels={GUEST_LABELS}
                  />
                ) : (
                  <p className="p-6 text-center text-sm opacity-70">No tables on this plan yet.</p>
                )}
                <p className="mt-2 text-xs opacity-70">In your colours, with unsaved changes. Guests see the tables free at the time they choose; tables without a seat count are never offered.</p>
              </div>
            )}
            {canEdit && view === 'edit' && (
              <p className="text-xs text-muted">Drag tables and labels to move them. With one selected, the arrow keys move it (Shift for bigger steps) and Delete takes it off the plan.</p>
            )}
          </div>

          {/* Side panel: scrolls on its own inside the workspace, so the page does not grow. */}
          <div ref={panelRef} className="mn-scroll space-y-3 xl:min-h-0 xl:overflow-y-auto xl:pe-0.5">
            {selTable && sel && (
              <Block testId="table-inspector" tone="selected" title={`Table ${selTable.label}`} action={<CloseButton onClick={() => setSelection(null)} label="Close table settings" />}>
                <Row label="Seats">
                  <div className="flex items-center gap-1.5">
                    <Button type="button" variant="secondary" size="sm" disabled={!canEdit || (sel.seats ?? 1) <= 1} onClick={() => setItem(selTable.id, { seats: Math.max(1, (sel.seats ?? 2) - 1) })} aria-label="One seat less" className="px-2!">
                      <Icon name="minus" className="size-4" />
                    </Button>
                    <Input type="number" min={1} max={50} value={sel.seats ?? ''} placeholder="?" disabled={!canEdit} onChange={(e) => setItem(selTable.id, { seats: e.target.value ? Math.max(1, Math.min(50, Number(e.target.value))) : null })} className="h-8! w-14 px-1 text-center pointer-coarse:h-10!" aria-label={`Seats at table ${selTable.label}`} data-testid="inspector-seats" />
                    <Button type="button" variant="secondary" size="sm" disabled={!canEdit || (sel.seats ?? 0) >= 50} onClick={() => setItem(selTable.id, { seats: Math.min(50, (sel.seats ?? 1) + 1) })} aria-label="One seat more" className="px-2!">
                      <Icon name="plus" className="size-4" />
                    </Button>
                  </div>
                </Row>
                {!sel.seats && <p className="text-xs text-warning">Without a seat count, this table is never offered online.</p>}
                <Row label="Shape">
                  <div className="grid flex-1 grid-cols-3 gap-1" role="group" aria-label="Table shape">
                    {SHAPES.map((s) => (
                      <button key={s.key} type="button" disabled={!canEdit} aria-pressed={sel.shape === s.key} onClick={() => setItem(selTable.id, { shape: s.key, rotation: s.key === 'RECTANGLE' ? sel.rotation : 0 })} className={cn('h-8 rounded-md px-2 text-xs font-medium ring-1 pointer-coarse:h-10', sel.shape === s.key ? 'bg-ink text-bg ring-ink' : 'text-ink-2 ring-line hover:ring-line-strong')} data-testid={`shape-${s.key}`}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </Row>
                {canEdit && (
                  <>
                    <Nudge onMove={(dx, dy) => nudge('table', selTable.id, dx, dy)} what={`table ${selTable.label}`} />
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
                      {sel.shape === 'RECTANGLE' && (
                        <Button type="button" variant="secondary" size="sm" icon="refresh" onClick={() => setItem(selTable.id, { rotation: sel.rotation === 90 ? 0 : 90 })} data-testid="inspector-rotate">
                          Turn 90°
                        </Button>
                      )}
                      <Button type="button" variant="ghost" size="sm" icon="x" onClick={() => takeOff(selTable.id)} data-testid="inspector-remove">
                        Take off the plan
                      </Button>
                    </div>
                  </>
                )}
              </Block>
            )}

            {selLabel && (
              <Block testId="label-inspector" tone="selected" title="Label" action={<CloseButton onClick={() => setSelection(null)} label="Close label settings" />}>
                <Input value={selLabel.text} maxLength={LABEL_LIMITS.maxLength} disabled={!canEdit} onChange={(e) => e.target.value.trim() && updateLabel(selLabel.id, { text: e.target.value.slice(0, LABEL_LIMITS.maxLength) })} aria-label="Label text" data-testid="label-text" />
                {canEdit && (
                  <>
                    <Nudge onMove={(dx, dy) => nudge('label', selLabel.id, dx, dy)} what={`label ${selLabel.text}`} />
                    <div className="border-t border-line pt-2.5">
                      <Button type="button" variant="dangerGhost" size="sm" icon="trash" onClick={() => removeLabel(selLabel.id)} data-testid="label-remove">
                        Remove label
                      </Button>
                    </div>
                  </>
                )}
              </Block>
            )}

            {canEdit && (
              <Block testId="area-panel" title="Room">
                <ActionForm action={saveAreaAction} submitLabel="Rename" submitVariant="secondary" successText="Renamed" className="flex items-center gap-2 space-y-0!" testId="rename-area-form">
                  <input type="hidden" name="org" value={org} />
                  <input type="hidden" name="locationId" value={locationId} />
                  <input type="hidden" name="id" value={area.id} />
                  <Input key={area.id} name="name" defaultValue={area.name} required maxLength={80} aria-label="Area name" className="min-w-0 flex-1" data-testid="rename-area" />
                </ActionForm>

                <div className="space-y-1.5 border-t border-line pt-2.5">
                  <Row label="Size (m)">
                    <div className="flex items-center gap-1.5">
                      <Input
                        key={`w${area.id}${plan.w}`}
                        type="number"
                        step="0.1"
                        min={ROOM_LIMITS.minW / 100}
                        max={ROOM_LIMITS.maxW / 100}
                        defaultValue={plan.w / 100}
                        onBlur={(e) => resizeRoom(Number(e.target.value) * 100, plan.h)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), resizeRoom(Number(e.currentTarget.value) * 100, plan.h))}
                        aria-label="Room width in metres"
                        className="h-8! w-16 px-2 text-center pointer-coarse:h-10!"
                        data-testid="room-width"
                      />
                      <span className="text-xs text-muted">×</span>
                      <Input
                        key={`h${area.id}${plan.h}`}
                        type="number"
                        step="0.1"
                        min={ROOM_LIMITS.minH / 100}
                        max={ROOM_LIMITS.maxH / 100}
                        defaultValue={plan.h / 100}
                        onBlur={(e) => resizeRoom(plan.w, Number(e.target.value) * 100)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), resizeRoom(plan.w, Number(e.currentTarget.value) * 100))}
                        aria-label="Room depth in metres"
                        className="h-8! w-16 px-2 text-center pointer-coarse:h-10!"
                        data-testid="room-height"
                      />
                    </div>
                  </Row>
                  <div className="grid grid-cols-4 gap-1">
                    {ROOM_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => resizeRoom(p.w, p.h)}
                        aria-pressed={plan.w === p.w && plan.h === p.h}
                        aria-label={`${p.label} room, ${metres(p.w)} by ${metres(p.h)} metres`}
                        title={`${p.label} — ${metres(p.w)} × ${metres(p.h)} m`}
                        className={cn('h-7 rounded-md px-1 text-[11px] font-medium tabular-nums ring-1 pointer-coarse:h-9', plan.w === p.w && plan.h === p.h ? 'bg-ink text-bg ring-ink' : 'text-ink-2 ring-line hover:ring-line-strong')}
                        data-testid={`room-preset-${p.label.toLowerCase()}`}
                      >
                        {metres(p.w)}×{metres(p.h)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-line pt-2.5">
                  <Row label="Labels">
                    <div className="flex min-w-0 flex-1 gap-1.5">
                      <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addLabel())} maxLength={LABEL_LIMITS.maxLength} placeholder="Entrance, bar, window…" aria-label="New label text" className="h-8! min-w-0 flex-1 pointer-coarse:h-10!" data-testid="new-label" />
                      <Button type="button" variant="secondary" size="sm" onClick={addLabel} disabled={!newLabel.trim() || plan.labels.length >= LABEL_LIMITS.maxPerArea} data-testid="add-label">
                        Add
                      </Button>
                    </div>
                  </Row>
                </div>

                <div className="border-t border-line pt-2.5">
                  <Row label="Arrange">
                    <div className="grid flex-1 grid-cols-3 gap-1" role="group" aria-label="Arrange the tables on this plan">
                      {LAYOUT_TEMPLATES.map((tpl) => (
                        <button key={tpl.key} type="button" disabled={!here.length} onClick={() => arrange(tpl.key)} title={`${tpl.description} A starting point you then adjust; nothing is saved until you press Save.`} className="h-8 rounded-md px-1 text-xs font-medium text-ink-2 ring-1 ring-line hover:text-ink hover:ring-line-strong disabled:opacity-40 pointer-coarse:h-10" data-testid={`template-${tpl.key}`}>
                          {tpl.label}
                        </button>
                      ))}
                    </div>
                  </Row>
                </div>

                <div className="border-t border-line pt-2.5">
                  <InlineAction
                    action={removeAreaAction}
                    fields={{ org, locationId, areaId: area.id }}
                    label={
                      <>
                        <Icon name="trash" className="size-4" /> Remove this area
                      </>
                    }
                    variant="dangerGhost"
                    confirm={`Remove “${area.name}” from the floor plan? Its ${here.length} table${here.length === 1 ? '' : 's'} are kept (with their QR codes and reservations) and stay bookable; they only lose their place on this plan.${isDirty ? ' Unsaved changes to this area are lost.' : ''}`}
                    testId="remove-area"
                  />
                </div>
              </Block>
            )}

            <Block
              title="Tables"
              action={
                canEdit && notPlaced.length > 1 ? (
                  <Button type="button" size="sm" variant="secondary" onClick={placeAll} data-testid="place-all">
                    Place all {notPlaced.length}
                  </Button>
                ) : undefined
              }
            >
              {noSeats > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-warning">
                  <Icon name="alert" className="mt-px size-3.5 shrink-0" />
                  {noSeats} table{noSeats === 1 ? '' : 's'} on this plan {noSeats === 1 ? 'has' : 'have'} no seat count, so {noSeats === 1 ? 'it is' : 'they are'} never offered online.
                </p>
              )}
              {notPlaced.length === 0 && elsewhere.length === 0 ? (
                <p className="text-[13px] text-muted">{tables.length ? 'Every table is on a plan.' : 'No tables yet.'}</p>
              ) : (
                <ul className="-mx-1 space-y-0.5" data-testid="unplaced-tables">
                  {[...notPlaced, ...elsewhere].map((t) => {
                    const it = itemOf(t);
                    const other = elsewhere.includes(t) ? areas.find((a) => a.id === it.areaId)?.name : null;
                    return (
                      <li key={t.id} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2">
                        <span className="min-w-0 truncate text-[13px]">
                          <span className="font-medium">Table {t.label}</span>
                          <span className="text-muted">
                            {' '}
                            · {it.seats ? `${it.seats} seats` : 'seats not set'}
                            {other ? ` · on ${other}` : ''}
                          </span>
                        </span>
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
              {addTables && (
                <details className="group border-t border-line pt-2.5" data-testid="add-tables-panel">
                  <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-ink pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                    <Icon name="plus" className="size-4" /> Add tables to {area.name}
                  </summary>
                  <div className="pt-2">{addTables}</div>
                </details>
              )}
            </Block>
          </div>
        </div>
      )}
    </div>
  );
}

/** Arrow buttons to move the selected table or label one grid step (touch screens have no arrow keys). */
function Nudge({ onMove, what }: { onMove: (dx: number, dy: number) => void; what: string }) {
  const btn = 'flex h-8 flex-1 items-center justify-center rounded-md text-ink-2 ring-1 ring-line hover:text-ink hover:ring-line-strong pointer-coarse:h-10';
  const step = PLAN_GRID * 2;
  return (
    <Row label="Move">
      <div className="flex min-w-0 flex-1 gap-1" role="group" aria-label={`Move ${what}`}>
        <button type="button" className={btn} onClick={() => onMove(-step, 0)} aria-label="Move left" data-testid="nudge-left">
          <Icon name="arrowLeft" className="size-4" />
        </button>
        <button type="button" className={btn} onClick={() => onMove(0, -step)} aria-label="Move up" data-testid="nudge-up">
          <Icon name="arrowUp" className="size-4" />
        </button>
        <button type="button" className={btn} onClick={() => onMove(0, step)} aria-label="Move down" data-testid="nudge-down">
          <Icon name="arrowDown" className="size-4" />
        </button>
        <button type="button" className={btn} onClick={() => onMove(step, 0)} aria-label="Move right" data-testid="nudge-right">
          <Icon name="arrowRight" className="size-4" />
        </button>
      </div>
    </Row>
  );
}
