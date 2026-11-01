import { NextResponse } from 'next/server';
import { clientKeyFromRequest } from '@/server/client-key';
import { handleRouteError } from '@/server/http';
import { limitPublic } from '@/server/rate-limit';
import { publicReservationLocation } from '@/server/services/reservation-public';
import { tableStatuses } from '@/server/services/reservations';
// Public: which tables are free at one date, time and party size (the booking floor plan). Only
// table ids and statuses; nothing about who booked. Exists only where the restaurant lets guests
// choose their table.
export async function GET(req: Request) {
  try {
    await limitPublic('res-tables', clientKeyFromRequest(req), { guest: [120, 600], ip: [3000, 600] });
    const u = new URL(req.url).searchParams;
    const location = await publicReservationLocation(u.get('org') ?? '', u.get('l'), u.get('preview') === '1');
    if (!location?.reservationSettings?.guestTableChoice) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const time = u.get('time') ?? '';
    if (!/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: 'invalid_time' }, { status: 422 });
    const party = Math.max(1, Math.min(100, Number(u.get('party') ?? 2) || 2));
    const result = await tableStatuses(location, location.reservationSettings, u.get('date') ?? '', time, party);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return handleRouteError('public-reservation-tables', e);
  }
}
