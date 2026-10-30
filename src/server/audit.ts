import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { db, type Tx } from './db';
import { forwardError, scrub } from './monitoring';

export type AuditEntry = {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
};

/** Append-only audit trail. Pass `tx` to record inside the same transaction as the change. */
export async function audit(entry: AuditEntry, tx?: Tx) {
  const client = tx ?? db;
  await client.auditLog.create({
    data: {
      organizationId: entry.organizationId ?? null,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata,
      ip: entry.ip ?? null,
    },
  });
}

/** Records unexpected server errors for the Super Admin "System errors" view. Never throws. */
export async function logError(source: string, error: unknown, context?: Prisma.InputJsonValue) {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[${source}]`, err);
    const safe = context === undefined ? undefined : (scrub(context) as Prisma.InputJsonValue);
    await db.errorLog.create({
      data: { source, message: err.message.slice(0, 1000), stack: err.stack?.slice(0, 4000), context: safe },
    });
    await forwardError({ source, message: err.message.slice(0, 1000), stack: err.stack, context: safe });
  } catch {
    // logging must never break the request
  }
}
