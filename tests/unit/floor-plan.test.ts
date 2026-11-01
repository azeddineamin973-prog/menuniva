import { describe, expect, it } from 'vitest';
import {
  arrangeTables,
  CHAIR_MARGIN,
  clampLabel,
  freeSpot,
  LAYOUT_TEMPLATES,
  naturalCompare,
  normalizeRoom,
  overlappingIds,
  planViewBox,
  ROOM_LIMITS,
  tableSize,
  type PlanRoom,
  type TableShape,
} from '@/lib/floor-plan';

/** Floor plan geometry: rooms, templates (positions only) and the guest map's view. */
type T = { id: string; label: string; seats: number | null; shape: TableShape; rotation: number };
const tables = (n: number, seats: (i: number) => number | null, shape: (i: number) => TableShape = () => 'ROUND', rotation: (i: number) => number = () => 0): T[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, label: String(i + 1), seats: seats(i), shape: shape(i), rotation: rotation(i) }));
const inside = (t: T & { x: number; y: number }, room: PlanRoom) => {
  const { w, h } = tableSize(t.shape, t.seats, t.rotation);
  return t.x - w / 2 - CHAIR_MARGIN >= -0.5 && t.y - h / 2 - CHAIR_MARGIN >= -0.5 && t.x + w / 2 + CHAIR_MARGIN <= room.w + 0.5 && t.y + h / 2 + CHAIR_MARGIN <= room.h + 0.5;
};

describe('layout templates', () => {
  const restaurants = [
    { name: 'bistro (6 mixed)', room: { w: 1000, h: 640 }, list: tables(6, (i) => [2, 2, 4, 4, 6, 8][i], (i) => (i >= 4 ? 'RECTANGLE' : i >= 2 ? 'SQUARE' : 'ROUND')) },
    { name: 'café (12 mixed, one long table turned)', room: { w: 1000, h: 640 }, list: tables(12, (i) => [2, 4, 4, 2, 6, 2, 4, 8, 2, 4, 2, 6][i], (i) => (i % 3 === 0 ? 'SQUARE' : i % 5 === 0 ? 'RECTANGLE' : 'ROUND'), (i) => (i === 5 ? 90 : 0)) },
    { name: 'brasserie (20 small)', room: { w: 1400, h: 800 }, list: tables(20, (i) => (i % 2 ? 2 : 4)) },
    { name: 'hall (30, some without seats)', room: { w: 2000, h: 1200 }, list: tables(30, (i) => (i % 7 === 0 ? null : i % 3 ? 2 : 4), (i) => (i % 2 ? 'SQUARE' : 'ROUND')) },
    { name: 'tiny room (3 long tables)', room: { w: 600, h: 400 }, list: tables(3, () => 6, () => 'RECTANGLE') },
  ];
  for (const r of restaurants) {
    for (const tpl of LAYOUT_TEMPLATES) {
      it(`${tpl.key}: ${r.name} — every table placed once, inside the walls, none overlapping, nothing else changed`, () => {
        const pos = arrangeTables(tpl.key, r.list, r.room);
        expect(Object.keys(pos).sort()).toEqual(r.list.map((t) => t.id).sort());
        const placed = r.list.map((t) => ({ ...t, ...pos[t.id] }));
        expect(placed.filter((t) => !inside(t, r.room)).map((t) => t.label)).toEqual([]);
        expect(overlappingIds(placed)).toEqual(new Set());
        // Positions only: the result has no seats, shapes or rotation to apply.
        for (const p of Object.values(pos)) expect(Object.keys(p).sort()).toEqual(['x', 'y']);
      });
    }
  }

  it('is deterministic, and an empty room gives nothing', () => {
    const list = tables(8, (i) => (i % 2 ? 2 : 4));
    expect(arrangeTables('walls', list, { w: 1200, h: 700 })).toEqual(arrangeTables('walls', [...list].reverse(), { w: 1200, h: 700 }));
    expect(arrangeTables('grid', [], { w: 1000, h: 640 })).toEqual({});
  });

  it('a room too small for its tables is reported as overlapping, not hidden', () => {
    const list = tables(30, () => 8, () => 'RECTANGLE');
    const pos = arrangeTables('rows', list, { w: 600, h: 400 });
    expect(overlappingIds(list.map((t) => ({ ...t, ...pos[t.id] }))).size).toBeGreaterThan(0);
  });
});

describe('rooms, labels and the guest view', () => {
  it('room sizes stay within the limits, on the grid', () => {
    expect(normalizeRoom(1234, 567)).toEqual({ w: 1230, h: 570 });
    expect(normalizeRoom(10, 10)).toEqual({ w: ROOM_LIMITS.minW, h: ROOM_LIMITS.minH });
    expect(normalizeRoom(99999, 99999)).toEqual({ w: ROOM_LIMITS.maxW, h: ROOM_LIMITS.maxH });
    expect(normalizeRoom(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ w: 1000, h: 640 });
  });

  it('labels stay inside the room', () => {
    const room = { w: 800, h: 500 };
    const p = clampLabel(-50, 900, 'Entrance', room);
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(500);
  });

  it('the next free spot keeps chairs apart from the tables already there', () => {
    const room = { w: 1000, h: 640 };
    const existing: (T & { x: number; y: number })[] = [];
    for (let i = 0; i < 10; i++) {
      const spot = freeSpot(existing, 'SQUARE', 4, 0, room);
      existing.push({ id: `n${i}`, label: `N${i}`, seats: 4, shape: 'SQUARE', rotation: 0, ...spot });
    }
    expect(overlappingIds(existing)).toEqual(new Set());
    expect(existing.every((t) => inside(t, room))).toBe(true);
  });

  it('the guest view frames the tables and labels without going far beyond the walls', () => {
    const room = { w: 1000, h: 640 };
    const box = planViewBox([{ shape: 'ROUND', seats: 2, rotation: 0, x: 120, y: 120 }], [{ text: 'Entrance', x: 500, y: 600 }], room);
    expect(box.x).toBeGreaterThanOrEqual(-16);
    expect(box.y).toBeGreaterThanOrEqual(-16);
    expect(box.x + box.w).toBeLessThanOrEqual(room.w + 16);
    expect(box.y + box.h).toBeLessThanOrEqual(room.h + 16);
    expect(box.y + box.h).toBeGreaterThan(600); // the label is in view
    expect(planViewBox([], [], room)).toEqual({ x: 0, y: 0, w: 1000, h: 640 });
  });

  it('labels sort like people count: 2 before 10', () => {
    expect(['10', '2', 'A10', 'A2', 'b1'].sort(naturalCompare)).toEqual(['2', '10', 'A2', 'A10', 'b1']);
  });
});
