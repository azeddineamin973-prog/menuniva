/**
 * Floor plan geometry shared by the owner's builder and the guest booking map. Pure and client-safe.
 *
 * Each dining area is a room the restaurant sizes itself, in plan units of about 1 cm (the default
 * room is 1000 × 640, about 10 × 6.4 m). A table is stored by its centre (planX, planY), shape and
 * rotation; its drawn size follows its seats, so the plan stays readable without the owner sizing
 * every table. Rooms can carry text labels (entrance, bar, window…) placed by the owner.
 *
 * Nothing here invents tables, seats or layouts: templates only suggest positions for the tables
 * the restaurant already has, and the owner decides whether to keep and save them.
 */

/** Size of a room on the plan, in plan units (about 1 cm). */
export type PlanRoom = { w: number; h: number };
export const DEFAULT_ROOM: PlanRoom = { w: 1000, h: 640 };
/** Previous fixed canvas; kept as the default room size. */
export const PLAN_W = DEFAULT_ROOM.w;
export const PLAN_H = DEFAULT_ROOM.h;
export const ROOM_LIMITS = { minW: 400, maxW: 3000, minH: 300, maxH: 2000 } as const;
/** Tables snap to this grid while dragged or moved with the arrow keys. */
export const PLAN_GRID = 10;

export const TABLE_SHAPES = ['ROUND', 'SQUARE', 'RECTANGLE'] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

/** A table placed on a dining area's plan. */
export type PlanTable = { id: string; label: string; seats: number | null; shape: TableShape; rotation: number; x: number; y: number };
/** Free text on the plan (entrance, bar, window…), centred on (x, y). */
export type PlanLabel = { id: string; text: string; x: number; y: number };
export const LABEL_LIMITS = { maxPerArea: 40, maxLength: 40 } as const;
export type PlanArea = { id: string; name: string; width: number; height: number; labels: PlanLabel[]; tables: PlanTable[] };

/** What a guest can do with a table at the chosen time. */
export type TableStatus = 'available' | 'booked' | 'too_small' | 'not_bookable';

/** Room chairs need around a table (chair gap + half a chair), on every side. */
export const CHAIR_MARGIN = 22;

/** Drawn size of a table in plan units: a table for 8 is visibly bigger than one for 2. */
export function tableSize(shape: TableShape, seats: number | null, rotation = 0) {
  const n = Math.max(1, Math.min(seats ?? 2, 20));
  let w: number;
  let h: number;
  if (shape === 'ROUND') w = h = 60 + n * 7;
  else if (shape === 'SQUARE') w = h = 58 + n * 6;
  else {
    w = 48 + Math.ceil(n / 2) * 34;
    h = 70;
  }
  return rotation === 90 ? { w: h, h: w } : { w, h };
}

/** Approximate drawn size of a label (font size 17). */
export function labelSize(text: string) {
  return { w: 28 + Math.min(text.length, LABEL_LIMITS.maxLength) * 10, h: 34 };
}

export const snapToGrid = (v: number) => Math.round(v / PLAN_GRID) * PLAN_GRID;

/** A valid room size: within the limits, on the grid. */
export function normalizeRoom(w: number, h: number): PlanRoom {
  const fit = (v: number, min: number, max: number, fallback: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, snapToGrid(v))) : fallback);
  return { w: fit(w, ROOM_LIMITS.minW, ROOM_LIMITS.maxW, DEFAULT_ROOM.w), h: fit(h, ROOM_LIMITS.minH, ROOM_LIMITS.maxH, DEFAULT_ROOM.h) };
}

/** Keeps a table (centre x, y; size w × h) inside the room, chairs included. */
export function clampToPlan(x: number, y: number, w: number, h: number, room: PlanRoom = DEFAULT_ROOM) {
  const m = CHAIR_MARGIN;
  return {
    x: Math.round(Math.min(room.w - w / 2 - m, Math.max(w / 2 + m, x))),
    y: Math.round(Math.min(room.h - h / 2 - m, Math.max(h / 2 + m, y))),
  };
}

/** Keeps a label inside the room. */
export function clampLabel(x: number, y: number, text: string, room: PlanRoom = DEFAULT_ROOM) {
  const { w, h } = labelSize(text);
  return { x: Math.round(Math.min(room.w - w / 2, Math.max(w / 2, x))), y: Math.round(Math.min(room.h - h / 2, Math.max(h / 2, y))) };
}

/** Chair positions around a table, relative to its centre (drawing only; at most 16 drawn). */
export function chairPositions(shape: TableShape, seats: number | null, rotation = 0): { x: number; y: number }[] {
  const n = Math.max(0, Math.min(seats ?? 0, 16));
  if (!n) return [];
  const { w, h } = tableSize(shape, seats, rotation);
  const gap = 13;
  if (shape === 'ROUND') {
    const r = w / 2 + gap;
    return Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n - Math.PI / 2;
      return { x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r) };
    });
  }
  const along = (count: number, length: number) => Array.from({ length: count }, (_, i) => -length / 2 + ((i + 0.5) * length) / count);
  if (shape === 'SQUARE') {
    // Round-robin over the four sides: top, bottom, left, right.
    const per = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) per[i % 4]++;
    return [
      ...along(per[0], w).map((x) => ({ x, y: -h / 2 - gap })),
      ...along(per[1], w).map((x) => ({ x, y: h / 2 + gap })),
      ...along(per[2], h).map((y) => ({ x: -w / 2 - gap, y })),
      ...along(per[3], h).map((y) => ({ x: w / 2 + gap, y })),
    ];
  }
  // Long table: chairs along both long sides, one at each end when the count is odd.
  const long = rotation === 90 ? h : w;
  const short = rotation === 90 ? w : h;
  const ends = n % 2 === 1 ? 1 : 0;
  const sides = n - ends;
  const top = along(Math.ceil(sides / 2), long - 24);
  const bottom = along(Math.floor(sides / 2), long - 24);
  const pts = [...top.map((a) => ({ a, b: -short / 2 - gap })), ...bottom.map((a) => ({ a, b: short / 2 + gap }))];
  if (ends) pts.push({ a: long / 2 + gap, b: 0 });
  return pts.map(({ a, b }) => (rotation === 90 ? { x: b, y: a } : { x: a, y: b }));
}

type Placed = Pick<PlanTable, 'shape' | 'seats' | 'rotation' | 'x' | 'y'>;
type Box = { x0: number; y0: number; x1: number; y1: number };
/** A table's footprint with its chairs. */
function footprint(t: Placed): Box {
  const { w, h } = tableSize(t.shape, t.seats, t.rotation);
  const m = CHAIR_MARGIN;
  return { x0: t.x - w / 2 - m, y0: t.y - h / 2 - m, x1: t.x + w / 2 + m, y1: t.y + h / 2 + m };
}

/** Ids of tables whose footprints (chairs included) overlap another table's. */
export function overlappingIds<T extends Placed & { id: string }>(tables: T[]): Set<string> {
  const out = new Set<string>();
  const boxes = tables.map((t) => ({ id: t.id, b: footprint(t) }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b;
      const b = boxes[j].b;
      // Chairs of neighbouring tables may touch (2 units of tolerance), not overlap.
      if (a.x0 < b.x1 - 2 && b.x0 < a.x1 - 2 && a.y0 < b.y1 - 2 && b.y0 < a.y1 - 2) {
        out.add(boxes[i].id);
        out.add(boxes[j].id);
      }
    }
  }
  return out;
}

/** Smallest view of the room that shows every table and label (with margins), for compact guest maps. */
export function planViewBox(tables: Placed[], labels: Pick<PlanLabel, 'text' | 'x' | 'y'>[] = [], room: PlanRoom = DEFAULT_ROOM) {
  if (!tables.length && !labels.length) return { x: 0, y: 0, w: room.w, h: room.h };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const t of tables) {
    const b = footprint(t);
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  for (const l of labels) {
    const { w, h } = labelSize(l.text);
    x0 = Math.min(x0, l.x - w / 2);
    y0 = Math.min(y0, l.y - h / 2);
    x1 = Math.max(x1, l.x + w / 2);
    y1 = Math.max(y1, l.y + h / 2);
  }
  const pad = 34;
  let w = x1 - x0 + pad * 2;
  let h = y1 - y0 + pad * 2;
  // Not narrower than a phone-friendly shape, not smaller than a few tables need.
  w = Math.max(w, 420, h * 1.2);
  h = Math.max(h, 280);
  // Never far beyond the room's walls (a little outside, so the walls show when they are near);
  // when the tables already fill most of the room, the whole room, all four walls included.
  const edge = 16;
  w = Math.min(w, room.w + edge * 2);
  h = Math.min(h, room.h + edge * 2);
  if (w >= 0.8 * room.w) w = room.w + edge * 2;
  if (h >= 0.8 * room.h) h = room.h + edge * 2;
  let x = (x0 + x1) / 2 - w / 2;
  let y = (y0 + y1) / 2 - h / 2;
  x = Math.min(Math.max(x, -edge), room.w + edge - w);
  y = Math.min(Math.max(y, -edge), room.h + edge - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** First free spot in the room for a table of this size (left to right, top to bottom). */
export function freeSpot(existing: Placed[], shape: TableShape, seats: number | null, rotation = 0, room: PlanRoom = DEFAULT_ROOM) {
  const { w, h } = tableSize(shape, seats, rotation);
  // Between two tables: both rows of chairs plus a narrow aisle.
  const clear = CHAIR_MARGIN * 2 + 16;
  for (let y = 80; y <= room.h - 60; y += 40) {
    for (let x = 80; x <= room.w - 60; x += 40) {
      const p = clampToPlan(x, y, w, h, room);
      const hit = existing.some((t) => {
        const o = tableSize(t.shape, t.seats, t.rotation);
        return Math.abs(t.x - p.x) < (o.w + w) / 2 + clear && Math.abs(t.y - p.y) < (o.h + h) / 2 + clear;
      });
      if (!hit) return p;
    }
  }
  return clampToPlan(room.w / 2, room.h / 2, w, h, room);
}

/** "2" before "10", "A2" before "A10". */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// ------------------------------------------------------------------ layout templates

export const LAYOUT_TEMPLATES = [
  { key: 'rows', label: 'Rows', description: 'Even rows, smaller tables first.' },
  { key: 'grid', label: 'Grid', description: 'One table per cell of an even grid.' },
  { key: 'walls', label: 'Along the walls', description: 'Tables for up to 4 by the walls, bigger ones in the middle.' },
] as const;
export type LayoutTemplate = (typeof LAYOUT_TEMPLATES)[number]['key'];

type Arrangeable = Pick<PlanTable, 'id' | 'label' | 'seats' | 'shape' | 'rotation'>;
const GAP = 40;
const dims = (t: Arrangeable) => {
  const { w, h } = tableSize(t.shape, t.seats, t.rotation);
  return { w, h, fw: w + CHAIR_MARGIN * 2, fh: h + CHAIR_MARGIN * 2 };
};

/** Rows of footprints inside a rectangle, spread evenly in both directions. */
function rowsIn(tables: Arrangeable[], r: { x: number; y: number; w: number; h: number }) {
  const rows: Arrangeable[][] = [];
  let line: Arrangeable[] = [];
  let used = 0;
  for (const t of tables) {
    const { fw } = dims(t);
    if (line.length && used + GAP + fw > r.w) {
      rows.push(line);
      line = [];
      used = 0;
    }
    used += (line.length ? GAP : 0) + fw;
    line.push(t);
  }
  if (line.length) rows.push(line);
  const out: Record<string, { x: number; y: number }> = {};
  const heights = rows.map((row) => Math.max(...row.map((t) => dims(t).fh)));
  const spaceY = Math.max(GAP / 2, (r.h - heights.reduce((a, b) => a + b, 0)) / (rows.length + 1));
  let y = r.y + spaceY;
  rows.forEach((row, i) => {
    const widths = row.map((t) => dims(t).fw);
    const spaceX = Math.max(GAP / 2, (r.w - widths.reduce((a, b) => a + b, 0)) / (row.length + 1));
    let x = r.x + spaceX;
    row.forEach((t, j) => {
      out[t.id] = { x: x + widths[j] / 2, y: y + heights[i] / 2 };
      x += widths[j] + spaceX;
    });
    y += heights[i] + spaceY;
  });
  return out;
}

/**
 * Suggested positions for the given tables in a room, by template. Positions only: the tables,
 * their seats, shapes and rotation are the restaurant's own and are never changed. The result is
 * a starting point the owner adjusts; nothing is saved by arranging.
 */
export function arrangeTables(template: LayoutTemplate, tables: Arrangeable[], room: PlanRoom = DEFAULT_ROOM): Record<string, { x: number; y: number }> {
  if (!tables.length) return {};
  const byLabel = [...tables].sort((a, b) => naturalCompare(a.label, b.label));
  const bySize = [...tables].sort((a, b) => (a.seats ?? 0) - (b.seats ?? 0) || naturalCompare(a.label, b.label));
  let raw: Record<string, { x: number; y: number }>;
  if (template === 'grid') {
    const n = byLabel.length;
    const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * room.w) / room.h))));
    const rowsCount = Math.ceil(n / cols);
    const cw = room.w / cols;
    const ch = room.h / rowsCount;
    raw = {};
    byLabel.forEach((t, i) => {
      const row = Math.floor(i / cols);
      const inRow = row === rowsCount - 1 ? n - row * cols : cols;
      const offset = ((cols - inRow) * cw) / 2; // centre a shorter last row
      raw[t.id] = { x: offset + ((i % cols) + 0.5) * cw, y: (row + 0.5) * ch };
    });
  } else if (template === 'walls') {
    const small = bySize.filter((t) => (t.seats ?? 2) <= 4);
    const large = bySize.filter((t) => (t.seats ?? 2) > 4);
    const slot = Math.max(0, ...small.map((t) => Math.max(dims(t).fw, dims(t).fh)));
    const inset = 24 + slot / 2;
    // Corners belong to the top and bottom walls; the side walls start below and end above them.
    const sides = [
      { len: room.w - 2 * inset, at: (d: number) => ({ x: inset + d, y: inset }) },
      { len: room.w - 2 * inset, at: (d: number) => ({ x: room.w - inset - d, y: room.h - inset }) },
      { len: room.h - 2 * inset - 2 * (slot + GAP), at: (d: number) => ({ x: inset, y: room.h - inset - slot - GAP - d }) },
      { len: room.h - 2 * inset - 2 * (slot + GAP), at: (d: number) => ({ x: room.w - inset, y: inset + slot + GAP + d }) },
    ].map((s) => ({ ...s, cap: s.len >= 0 ? Math.floor((s.len + GAP) / (slot + GAP)) : 0 }));
    const totalCap = sides.reduce((n, s) => n + s.cap, 0);
    const onWalls = small.slice(0, totalCap);
    const middle = [...small.slice(totalCap), ...large];
    // Share the wall tables between the walls in proportion to their room, then spread them evenly.
    const counts = sides.map((s) => (totalCap ? Math.floor((onWalls.length * s.cap) / totalCap) : 0));
    for (let i = 0, left = onWalls.length - counts.reduce((a, b) => a + b, 0); left > 0; i = (i + 1) % 4) {
      if (counts[i] < sides[i].cap) {
        counts[i]++;
        left--;
      }
    }
    raw = {};
    let k = 0;
    sides.forEach((s, i) => {
      const step = counts[i] ? s.len / counts[i] : 0;
      for (let j = 0; j < counts[i]; j++) raw[onWalls[k++].id] = s.at(step * (j + 0.5));
    });
    const innerInset = onWalls.length ? inset + slot / 2 + GAP : 0;
    const inner = { x: innerInset, y: innerInset, w: room.w - innerInset * 2, h: room.h - innerInset * 2 };
    Object.assign(raw, rowsIn(middle, inner.w > 0 && inner.h > 0 ? inner : { x: 0, y: 0, w: room.w, h: room.h }));
  } else {
    raw = rowsIn(bySize, { x: 0, y: 0, w: room.w, h: room.h });
  }
  const out: Record<string, { x: number; y: number }> = {};
  for (const t of tables) {
    const p = raw[t.id];
    const { w, h } = tableSize(t.shape, t.seats, t.rotation);
    const c = clampToPlan(snapToGrid(p.x), snapToGrid(p.y), w, h, room);
    out[t.id] = c;
  }
  return out;
}
