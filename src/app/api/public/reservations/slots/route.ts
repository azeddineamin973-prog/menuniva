import { NextResponse } from 'next/server';
import { clientKeyFromRequest } from '@/server/client-key';
import { db } from '@/server/db';
import { handleRouteError } from '@/server/http';
import { rateLimit } from '@/server/rate-limit';
import { availability } from '@/server/services/reservations';

// Public: available reservation times for a date and party size (no personal data).
export async function GET(req: Request) {
  try {
    await rateLimit(`res-slots:${clientKeyFromRequest(req)}`, 120, 600);
    const u = new URL(req.url).searchParams;
    const org = await db.restaurantOrganization.findUnique({ where: { slug: u.get('org') ?? '' } });
    if (!org || org.status === 'SUSPENDED' || org.status === 'ARCHIVED') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const location = await db.restaurantLocation.findFirst({ where: { organizationId: org.id, isPublished: true, reservationsEnabled: true, ...(u.get('l') ? { slug: u.get('l')! } : {}) }, include: { reservationSettings: true }, orderBy: { createdAt: 'asc' } });
    if (!location) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const party = Math.max(1, Math.min(100, Number(u.get('party') ?? 2) || 2));
    const av = await availability(db, location, location.reservationSettings, u.get('date') ?? '', party);
    return NextResponse.json({ ...av, slots: av.slots.map((s) => ({ time: s.time, available: s.available })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return handleRouteError('public-reservation-slots', e);
  }
}
