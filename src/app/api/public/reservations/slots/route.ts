import { NextResponse } from 'next/server';
import { clientKeyFromRequest } from '@/server/client-key';
import { db } from '@/server/db';
import { handleRouteError } from '@/server/http';
import { limitPublic } from '@/server/rate-limit';
import { publicReservationLocation } from '@/server/services/reservation-public';
import { availability } from '@/server/services/reservations';
// Public: available reservation times for a date and party size (no personal data). Members
// previewing a draft (preview=1) get the times of their unpublished location too.
export async function GET(req: Request) {
  try {
    await limitPublic('res-slots', clientKeyFromRequest(req), { guest: [120, 600], ip: [3000, 600] });
    const u = new URL(req.url).searchParams;
    const location = await publicReservationLocation(u.get('org') ?? '', u.get('l'), u.get('preview') === '1');
    if (!location) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const party = Math.max(1, Math.min(100, Number(u.get('party') ?? 2) || 2));
    const av = await availability(db, location, location.reservationSettings, u.get('date') ?? '', party);
    return NextResponse.json({ ...av, slots: av.slots.map((s) => ({ time: s.time, available: s.available })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return handleRouteError('public-reservation-slots', e);
  }
}
