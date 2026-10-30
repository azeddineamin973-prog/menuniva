import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { handleRouteError } from '@/server/http';
import { exportMyData } from '@/server/services/account';

// GDPR access request for the signed-in staff/owner account (own data only).
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    return new Response(JSON.stringify(await exportMyData(user.id), null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="menuniva-my-account.json"', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return handleRouteError('account-export', e);
  }
}
