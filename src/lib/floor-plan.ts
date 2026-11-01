/**
 * Floor plan geometry shared by the owner's editor and the guest booking map. Pure and client-safe.
 *
 * Each dining area is drawn on a fixed canvas of PLAN_W × PLAN_H plan units; a table is stored by
 * its centre (planX, planY), shape and rotation. Its drawn size follows its seats, so the plan stays
 * readable without the owner having to size every table.
 */
export const PLAN_W = 1000;
export const PLAN_H = 640;
/** Tables snap to this grid while dragged or moved with the arrow keys. */
export const PLAN_GRID = 10;

export const TABLE_SHAPES = ['ROUND', 'SQUARE', 'RECTANGLE'] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

/** A table placed on a dining area's plan. */
export type PlanTable = { id: string; label: string; seats: number | null; shape: TableShape; rotation: number; x: number; y: number };
export type PlanArea = { id: string; name: string; tables: PlanTable[] };

/** What a guest can do with a table at the chosen time. */
export type TableStatus = 'available' | 'booked' | 'too_small' | 'not_bookable';

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

export const snapToGrid = (v: number) => Math.round(v / PLAN_GRID) * PLAN_GRID;

/** Keeps a table (centre x, y; size w × h) inside the canvas, chairs included. */
export function clampToPlan(x: number, y: number, w: number, h: number) {
  const m = 22; // room for the chairs drawn around the table
  return {
    x: Math.round(Math.min(PLAN_W - w / 2 - m, Math.max(w / 2 + m, x))),
    y: Math.round(Math.min(PLAN_H - h / 2 - m, Math.max(h / 2 + m, y))),
  };
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

/** Smallest view of the canvas that shows every table (with margins), for compact guest maps. */
export function planViewBox(tables: Pick<PlanTable, 'shape' | 'seats' | 'rotation' | 'x' | 'y'>[]) {
  if (!tables.length) return { x: 0, y: 0, w: PLAN_W, h: PLAN_H };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const t of tables) {
    const { w, h } = tableSize(t.shape, t.seats, t.rotation);
    x0 = Math.min(x0, t.x - w / 2);
    y0 = Math.min(y0, t.y - h / 2);
    x1 = Math.max(x1, t.x + w / 2);
    y1 = Math.max(y1, t.y + h / 2);
  }
  const pad = 56;
  let w = x1 - x0 + pad * 2;
  let h = y1 - y0 + pad * 2;
  // Not narrower than a phone-friendly 3:2, not smaller than a few tables need.
  w = Math.max(w, 420, h * 1.2);
  h = Math.max(h, 280);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) };
}

/** First free spot on the canvas for a table of this size (left to right, top to bottom). */
export function freeSpot(existing: Pick<PlanTable, 'shape' | 'seats' | 'rotation' | 'x' | 'y'>[], shape: TableShape, seats: number | null, rotation = 0) {
  const { w, h } = tableSize(shape, seats, rotation);
  const clear = 36;
  for (let y = 80; y <= PLAN_H - 60; y += 40) {
    for (let x = 80; x <= PLAN_W - 60; x += 40) {
      const p = clampToPlan(x, y, w, h);
      const hit = existing.some((t) => {
        const o = tableSize(t.shape, t.seats, t.rotation);
        return Math.abs(t.x - p.x) < (o.w + w) / 2 + clear && Math.abs(t.y - p.y) < (o.h + h) / 2 + clear;
      });
      if (!hit) return p;
    }
  }
  return clampToPlan(PLAN_W / 2, PLAN_H / 2, w, h);
}
