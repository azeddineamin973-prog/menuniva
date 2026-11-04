import 'server-only';
import { z } from 'zod';
import { audit, logError } from '../audit';
import { db } from '../db';
import { UserFacingError } from '../errors';
import { asIdentity, type ClientIdentity } from '../client-identity';
import { limitPublic } from '../rate-limit';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { resolveTableToken } from './orders';

export const tableRequestSchema = z.object({ qrToken: z.string().min(10).max(64), type: z.enum(['CALL_WAITER', 'REQUEST_BILL', 'OPEN_TABLE']) });

const TASK_TITLE = { CALL_WAITER: 'Waiter called', REQUEST_BILL: 'Bill requested', OPEN_TABLE: 'Guests ask to open the table' } as const;

/**
 * "Call waiter", "Request the bill" or "Please open my table" from the table. Creates a visible
 * staff task. Duplicate open requests of the same type for a table are merged (not repeated), also
 * when several phones ask at the same moment: the check and the insert run under a transaction-level
 * advisory lock on (table, type) (audit V9, Q20). This does not create an invoice.
 */
export async function createTableRequest(input: unknown, client: string | ClientIdentity) {
  const d = tableRequestSchema.parse(input);
  const table = await resolveTableToken(d.qrToken);
  if (!table || !table.location.isPublished) throw new UserFacingError('qr_invalid', 404);
  const countForTable = await limitPublic(`table-request:${table.id}`, asIdentity(client), { guest: [6, 600], ip: [60, 600], cookieless: [20, 600], scope: { key: 'table', limit: [30, 600] } });
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`table-request:${table.id}:${d.type}`}))::text`;
    const session = await tx.tableSession.findFirst({ where: { tableId: table.id, status: 'OPEN' }, select: { id: true } });
    // An open table needs no "open my table" request: the guest can order (or enter the PIN) now.
    if (d.type === 'OPEN_TABLE' && session) return { taskId: null, duplicate: true, alreadyOpen: true };
    const existing = await tx.staffTask.findFirst({ where: { tableId: table.id, type: d.type, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, select: { id: true } });
    if (existing) return { taskId: existing.id, duplicate: true, alreadyOpen: false };
    const task = await tx.staffTask.create({
      data: { organizationId: table.organizationId, locationId: table.locationId, tableId: table.id, tableSessionId: session?.id ?? null, type: d.type },
    });
    await tx.notification.create({
      data: { organizationId: table.organizationId, locationId: table.locationId, type: 'STAFF_TASK', title: `${TASK_TITLE[d.type]} — table ${table.label}`, entityId: task.id },
    });
    return { taskId: task.id, duplicate: false, alreadyOpen: false };
  });
  if (!result.duplicate) await countForTable().catch((e) => logError('rate-limit-count', e));
  return result;
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
