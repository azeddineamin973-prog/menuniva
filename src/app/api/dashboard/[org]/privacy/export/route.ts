import { assertSameOrigin, handleRouteError } from '@/server/http';
import { exportGuestData } from '@/server/services/privacy';
import { requireTenantAction } from '@/server/tenant';

// GDPR access request: JSON download of one guest's data. POST so the identifier stays out of URLs and logs.
export async function POST(req: Request, { params }: { params: Promise<{ org: string }> }) {
  try {
    assertSameOrigin(req);
    const { org } = await params;
    const ctx = await requireTenantAction(org, 'settings.manage');
    const form = await req.formData().catch(() => null);
    const data = await exportGuestData(ctx, String(form?.get('q') ?? ''));
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="guest-data-${ctx.org.slug}-${new Date().toISOString().slice(0, 10)}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return handleRouteError('privacy-export', e);
  }
}
