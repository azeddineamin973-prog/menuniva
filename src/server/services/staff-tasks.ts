import 'server-only';
import { z } from 'zod';
import { audit } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { asIdentity, type ClientIdentity } from '../client-identity';
import { limitPublic } from '../rate-limit';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { resolveTableToken } from './orders';

export const tableRequestSchema = z.object({ qrToken: z.string().min(10).max(64), type: z.enum(['CALL_WAITER', 'REQUEST_BILL']) });

/**
 * "Call waiter" / "Request the bill" from the table. Creates a visible staff task.
 * Duplicate open requests of the same type for a table are merged (not repeated).
 * This does not create an invoice.
 */
export async function createTableRequest(input: unknown, client: string | ClientIdentity) {
  const d = tableRequestSchema.parse(input);
  const table = await resolveTableToken(d.qrToken);
  if (!table || !table.location.isPublished) throw new UserFacingError('qr_invalid', 404);
  await limitPublic(`table-request:${table.id}`, asIdentity(client), { guest: [6, 600], ip: [60, 600], scope: { key: 'table', limit: [30, 600] } });
  const existing = await db.staffTask.findFirst({ where: { tableId: table.id, type: d.type, status: { in: ['OPEN', 'ACKNOWLEDGED'] } } });
  if (existing) return { taskId: existing.id, duplicate: true };
  const session = await db.tableSession.findFirst({ where: { tableId: table.id, status: 'OPEN' } });
  const task = await db.staffTask.create({
    data: { organizationId: table.organizationId, locationId: table.locationId, tableId: table.id, tableSessionId: session?.id ?? null, type: d.type },
  });
  await db.notification.create({
    data: { organizationId: table.organizationId, locationId: table.locationId, type: 'STAFF_TASK', title: `${d.type === 'CALL_WAITER' ? 'Waiter called' : 'Bill requested'} — table ${table.label}`, entityId: task.id },
  });
  return { taskId: task.id, duplicate: false };
}

export async function listOpenTasks(ctx: TenantContext, locationId: string) {
  await assertLocationAccess(ctx, locationId);
  return db.staffTask.findMany({
    where: { organizationId: ctx.org.id, locationId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
    include: { table: { select: { label: true, area: { select: { name: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function updateTask(ctx: TenantContext, taskId: string, to: 'ACKNOWLEDGED' | 'DONE') {
  const task = await db.staffTask.findFirst({ where: { id: taskId, organizationId: ctx.org.id } });
  if (!task) throw new UserFacingError('Request not found.', 404);
  await assertLocationAccess(ctx, task.locationId);
  const from = to === 'ACKNOWLEDGED' ? ['OPEN'] : ['OPEN', 'ACKNOWLEDGED'];
  const res = await db.staffTask.updateMany({
    where: { id: task.id, status: { in: from as ('OPEN' | 'ACKNOWLEDGED')[] } },
    data: { status: to, ...(to === 'ACKNOWLEDGED' ? { acknowledgedAt: new Date(), acknowledgedById: ctx.userId } : { doneAt: new Date() }) },
  });
  if (res.count) await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: `task.${to.toLowerCase()}`, entityType: 'StaffTask', entityId: task.id });
}
