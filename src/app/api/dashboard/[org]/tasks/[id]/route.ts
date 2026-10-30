import { UserFacingError } from '@/server/errors';
import { tenantRoute } from '@/server/route-tenant';
import { updateTask } from '@/server/services/staff-tasks';

export async function POST(req: Request, { params }: { params: Promise<{ org: string; id: string }> }) {
  const { org, id } = await params;
  const body = await req.json().catch(() => ({}));
  return tenantRoute(
    req,
    org,
    'tasks.manage',
    async (ctx) => {
      if (body?.to !== 'ACKNOWLEDGED' && body?.to !== 'DONE') throw new UserFacingError('Invalid status.');
      await updateTask(ctx, id, body.to);
    },
    'task-update',
  );
}
