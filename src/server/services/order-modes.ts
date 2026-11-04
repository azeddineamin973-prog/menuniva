import 'server-only';
import type { Messages } from '@/i18n';
import { isOpenAt, type OpeningHours } from '@/lib/opening-hours';
import { zonedParts } from '@/lib/time';
import { pickupOptions, type PickupOptions } from './fulfilment';

/**
 * Whether guests can order pickup or the restaurant's own delivery right now, and the figures
 * shown before they start (ready time, delivery fee from…). The storefront and the ordering
 * page both use this, so the choice screen never promises something the order page refuses.
 * The order endpoints still check everything again on submit.
 */
type LocationForModes = {
  orderingPaused: boolean;
  timeZone: string;
  openingHours: unknown;
  takeawaySettings: { paused: boolean; leadTimeMinutes: number; slotMinutes: number; pickupHours: unknown; minOrderCents: number; pickupPoint: string | null } | null;
  deliverySettings: { paused: boolean; deliveryHours: unknown; cashOnDeliveryEnabled: boolean; cardOnDeliveryEnabled: boolean; prepEstimateMinutes: number; deliveryEstimateMinutes: number } | null;
  deliveryZones: { feeCents: number; minOrderCents: number; estimatedMinutes: number | null }[];
};

export function pickupAvailability(location: LocationForModes, now = new Date()) {
  const opts = pickupOptions(location, location.takeawaySettings, now);
  const paused = location.orderingPaused || !!location.takeawaySettings?.paused;
  const noSlots = !opts.asap.allowed && opts.slots.length === 0;
  return { opts, paused, noSlots, open: !paused && !noSlots, minOrderCents: location.takeawaySettings?.minOrderCents ?? 0 };
}

export function deliveryAvailability(location: LocationForModes, now = new Date()) {
  const ds = location.deliverySettings;
  const cash = ds?.cashOnDeliveryEnabled ?? true;
  const card = ds?.cardOnDeliveryEnabled ?? false;
  const hours = (ds?.deliveryHours ?? location.openingHours ?? null) as OpeningHours | null;
  const p = zonedParts(now, location.timeZone);
  const closed = !!hours && !isOpenAt(hours, p.weekday, p.hour * 60 + p.minute);
  const zones = location.deliveryZones;
  const fallbackMinutes = (ds?.prepEstimateMinutes ?? 25) + (ds?.deliveryEstimateMinutes ?? 30);
  return {
    cash,
    card,
    closed,
    open: !location.orderingPaused && !ds?.paused && !closed && zones.length > 0 && (cash || card),
    minFeeCents: zones.length ? Math.min(...zones.map((z) => z.feeCents)) : null,
    minOrderCents: zones.length ? Math.min(...zones.map((z) => z.minOrderCents)) : 0,
    estimateMinutes: zones.length ? Math.min(...zones.map((z) => z.estimatedMinutes ?? fallbackMinutes)) : fallbackMinutes,
  };
}

/** Pickup slots with display labels in the restaurant's time zone ("Today" / "Tomorrow" / "Sat 14 Nov", and "13:30"). */
export function labelPickupSlots(opts: PickupOptions, tag: string, timeZone: string, o: Messages['ordering']) {
  const time = new Intl.DateTimeFormat(tag, { timeZone, hour: '2-digit', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat(tag, { timeZone, weekday: 'short', day: 'numeric', month: 'short' });
  return opts.slots.map((s) => {
    const at = new Date(s.value);
    const day = s.dayOffset === 0 ? o.today : s.dayOffset === 1 ? o.tomorrow : dayFmt.format(at);
    const t = time.format(at);
    // `label` keeps the day for other days, so 11:00 tomorrow never reads as 11:00 today.
    return { value: s.value, day, time: t, label: s.dayOffset === 0 ? t : `${day} ${t}` };
  });
}
