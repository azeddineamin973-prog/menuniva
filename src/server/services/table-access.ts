import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import type { TableOrderingPolicy } from '@/generated/prisma/enums';
import { audit, logError } from '../audit';
import { hashToken, safeEqual } from '../crypto';
import { db, type Tx } from '../db';
import { env } from '../env';
import { AccessDeniedError, UserFacingError } from '../errors';
import type { ClientIdentity } from '../client-identity';
import { limitPublic, rateLimit } from '../rate-limit';
import { assertLocationAccess, type TenantContext } from '../tenant';
import { resolveTableToken } from './orders';

/**
 * Who may order at a table (QR-ORDERING-DESIGN.md, option D).
 *
 * The printed QR only says which table. Under SESSION and SESSION_PIN a member of staff must have
 * opened the table; under SESSION_PIN each phone must also have entered the table's temporary PIN
 * once. That phone then holds a random token in an httpOnly cookie; the database keeps only its
 * SHA-256 hash, bound to one organisation, location, table and session. The authorisation ends
 * when the table closes (every device of the session is revoked in the closing transaction, and an
 * order is only accepted on the table's current OPEN session), when staff revoke the phone, or when
 * it expires.
 */

export const PIN_LENGTH = 6;
/** Wrong PINs allowed per issued PIN, for the whole table (not per caller, which an attacker can rotate). */
export const PIN_MAX_FAILURES = 8;
/** One phone stays authorised for at most this long within a seating. */
export const DEVICE_TTL_MS = 12 * 60 * 60 * 1000;
/** Upper bound of authorised phones per seating (someone who learned the PIN cannot mint unlimited grants). */
export const MAX_DEVICES_PER_SESSION = 30;
export const GRANT_COOKIE = 'mn_tg';
const MAX_GRANTS_IN_COOKIE = 4;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type TableAccess = {
  policy: TableOrderingPolicy;
  /** The table has an OPEN session (always true for OPEN: MenuNiva opens it on the first order). */
  open: boolean;
  /** This phone may order now. */
  authorized: boolean;
  /** SESSION_PIN only: enrolment is blocked until staff issue a new PIN. */
  locked: boolean;
  /** The phone held an authorisation for a seating that has ended (the table was closed). */
  ended: boolean;
};

// ------------------------------------------------------------------ PIN secret at rest

/** A fresh 6-digit PIN from the operating system's CSPRNG. Every value is equally likely. */
export function newPin(): string {
  return String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, '0');
}

const pinKey = () => createHash('sha256').update(`${env.APP_SECRET}|table-pin-v1`).digest();

/**
 * AES-256-GCM with a key derived from APP_SECRET; the session id is authenticated data, so a cipher
 * copied onto another session does not open. Staff need to read the PIN out loud again (a late
 * guest), so it is encrypted rather than hashed; a database copy alone does not reveal it.
 */
export function sealPin(pin: string, sessionId: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', pinKey(), iv);
  c.setAAD(Buffer.from(sessionId));
  const ct = Buffer.concat([c.update(pin, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function openPin(cipher: string | null | undefined, sessionId: string): string | null {
  if (!cipher) return null;
  const [v, iv, tag, ct] = cipher.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', pinKey(), Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(sessionId));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** The PIN a guest must type for this session: the sealed PIN, or a 4-digit code of a session opened before SESSION_PIN. */
function expectedPin(s: { id: string; pinCipher: string | null; verificationCode: string | null }) {
  return openPin(s.pinCipher, s.id) ?? s.verificationCode ?? null;
}

/** Fields that issue a new PIN on a session row (inside the caller's transaction). */
export function pinFields(sessionId: string, userId: string) {
  const pin = newPin();
  return { pin, data: { pinCipher: sealPin(pin, sessionId), pinIssuedAt: new Date(), pinIssuedById: userId, pinFailedAttempts: 0, pinLockedAt: null, verificationCode: null } };
}

// ------------------------------------------------------------------ guest cookie

/** Tokens held by this browser, newest first (one per table seating it joined recently). */
export function grantTokensFrom(cookieValue: string | null | undefined): string[] {
  return (cookieValue ?? '')
    .split('.')
    .filter((t) => TOKEN_RE.test(t))
    .slice(0, MAX_GRANTS_IN_COOKIE);
}
export function grantTokensFromRequest(req: Request): string[] {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === GRANT_COOKIE) return grantTokensFrom(decodeURIComponent(v.join('=')));
  }
  return [];
}
export function grantCookie(token: string, existing: string[], secure: boolean) {
  const value = [token, ...existing.filter((t) => t !== token)].slice(0, MAX_GRANTS_IN_COOKIE).join('.');
  return { name: GRANT_COOKIE, value, options: { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: Math.floor(DEVICE_TTL_MS / 1000) } };
}

// ------------------------------------------------------------------ checks used by ordering

/**
 * The device grant of this browser for the table's open session, or why there is none. Bound to the
 * exact organisation, location, table and session; revoked and expired grants never match.
 */
export async function findGrant(table: { id: string; organizationId: string; locationId: string }, session: string | null | Promise<string | null>, tokens: string[]) {
  if (!tokens.length) return { device: null, ended: false, sessionId: await session };
  const hashes = tokens.map(hashToken);
  // The session may still be loading (order path): both reads run side by side.
  const [sessionId, devices] = await Promise.all([
    session,
    db.tableSessionDevice.findMany({
      where: { tokenHash: { in: hashes }, organizationId: table.organizationId, locationId: table.locationId, tableId: table.id },
      select: { id: true, tableSessionId: true, revokedAt: true, expiresAt: true },
    }),
  ]);
  const now = Date.now();
  const device = sessionId ? devices.find((d) => d.tableSessionId === sessionId && !d.revokedAt && d.expiresAt.getTime() > now) ?? null : null;
  return { device, ended: !device && devices.length > 0, sessionId };
}

/** What the guest page shows for this browser at this table (no secret is ever sent). */
export async function tableAccessFor(table: { id: string; organizationId: string; locationId: string; location: { tableOrderingPolicy: TableOrderingPolicy } }, tokens: string[]): Promise<TableAccess> {
  const policy = table.location.tableOrderingPolicy;
  const session = await db.tableSession.findFirst({ where: { tableId: table.id, status: 'OPEN' }, select: { id: true, pinLockedAt: true } });
  if (policy === 'OPEN') return { policy, open: true, authorized: true, locked: false, ended: false };
  if (!session) {
    const { ended } = await findGrant(table, null, tokens);
    return { policy, open: false, authorized: false, locked: false, ended };
  }
  if (policy === 'SESSION') return { policy, open: true, authorized: true, locked: false, ended: false };
  const { device, ended } = await findGrant(table, session.id, tokens);
  return { policy, open: true, authorized: !!device, locked: !device && !!session.pinLockedAt, ended };
}

/**
 * Re-checks a device grant under the session's shared lock, inside the order transaction (one
 * statement): staff revoking the phone or closing the table at the same moment wins or loses cleanly.
 */
export async function grantStillValid(tx: Tx, deviceId: string, sessionId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "TableSessionDevice" WHERE id = ${deviceId} AND "tableSessionId" = ${sessionId} AND "revokedAt" IS NULL AND "expiresAt" > now()`;
  return rows.length === 1;
}

// ------------------------------------------------------------------ guest: enter the PIN once

export const joinSchema = z.object({ qrToken: z.string().min(10).max(64), pin: z.string().trim().regex(/^\d{4,6}$/, 'pin_format') });

export class TableAccessError extends UserFacingError {}

/**
 * A guest phone enters the table PIN. Order of checks, cheapest first, nothing written until the PIN
 * is right: rate limits (per phone, per trusted network, shared bucket for cookieless callers),
 * QR token, open session, lock, then a constant-time compare. A wrong PIN increments the session's
 * counter in ONE statement (UPDATE … RETURNING), so parallel guesses cannot slip past the limit;
 * the request that reaches the limit locks enrolment and alerts staff, exactly once. Phones that are
 * already authorised keep ordering.
 */
export async function joinTableSession(input: unknown, client: ClientIdentity & { cookieless?: boolean }, existingTokens: string[]) {
  const d = joinSchema.safeParse(input);
  if (!d.success) throw new TableAccessError('pin_invalid', 422);
  const table = await resolveTableToken(d.data.qrToken);
  if (!table || !table.location.isPublished || table.location.organization.status === 'ARCHIVED') throw new TableAccessError('qr_invalid', 404);
  await limitPublic(`join:${table.id}`, client, { guest: [6, 600], ip: [30, 600] });
  if (client.cookieless) await rateLimit(`join:${table.id}:cookieless`, 10, 600, true);

  const policy = table.location.tableOrderingPolicy;
  if (policy !== 'SESSION_PIN') return { joined: false as const, required: false, tableLabel: table.label };
  const session = await db.tableSession.findFirst({
    where: { tableId: table.id, status: 'OPEN' },
    select: { id: true, organizationId: true, locationId: true, pinCipher: true, verificationCode: true, pinLockedAt: true },
  });
  if (!session) throw new TableAccessError('table_not_open', 409);

  // Already authorised for this seating: nothing to do (a double tap, a second tab).
  const { device: current } = await findGrant(table, session.id, existingTokens);
  if (current) return { joined: true as const, required: true, tableLabel: table.label, token: null };

  if (session.pinLockedAt) throw new TableAccessError('pin_locked', 423);
  const expected = expectedPin(session);
  if (!expected) throw new TableAccessError('pin_locked', 423);

  if (!safeEqual(d.data.pin, expected)) {
    const rows = await db.$queryRaw<{ attempts: number; locked: boolean }[]>`
      UPDATE "TableSession"
         SET "pinFailedAttempts" = "pinFailedAttempts" + 1,
             "pinLockedAt" = CASE WHEN "pinFailedAttempts" + 1 >= ${PIN_MAX_FAILURES} THEN now() ELSE NULL END
       WHERE id = ${session.id} AND status = 'OPEN' AND "pinLockedAt" IS NULL
   RETURNING "pinFailedAttempts" AS attempts, "pinLockedAt" IS NOT NULL AS locked`;
    const r = rows[0];
    if (!r) throw new TableAccessError('pin_locked', 423);
    if (r.locked && r.attempts === PIN_MAX_FAILURES) {
      // Exactly one request crosses the limit: one alert for staff, one audit entry.
      await Promise.all([
        db.notification.create({ data: { organizationId: session.organizationId, locationId: session.locationId, type: 'STAFF_TASK', title: `Table ${table.label}: PIN locked after ${PIN_MAX_FAILURES} wrong attempts — issue a new PIN`, entityId: session.id } }),
        audit({ organizationId: session.organizationId, action: 'table.pin_locked', entityType: 'TableSession', entityId: session.id, metadata: { table: table.label, attempts: r.attempts } }),
      ]).catch((e) => logError('table-pin-lock', e));
    }
    throw new TableAccessError(r.locked ? 'pin_locked' : 'pin_invalid', r.locked ? 423 : 422);
  }

  const token = randomBytes(32).toString('base64url');
  const created = await db.$transaction(async (tx) => {
    // The session must still be open and not locked; closing the table locks this row FOR UPDATE.
    const ok = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "TableSession" WHERE id = ${session.id} AND status = 'OPEN' AND "pinLockedAt" IS NULL FOR SHARE`;
    if (!ok.length) return null;
    if ((await tx.tableSessionDevice.count({ where: { tableSessionId: session.id, revokedAt: null } })) >= MAX_DEVICES_PER_SESSION) throw new TableAccessError('too_many_devices', 429);
    return tx.tableSessionDevice.create({
      data: { organizationId: session.organizationId, locationId: session.locationId, tableId: table.id, tableSessionId: session.id, tokenHash: hashToken(token), guestHash: client.guest, expiresAt: new Date(Date.now() + DEVICE_TTL_MS) },
      select: { id: true },
    });
  });
  if (!created) throw new TableAccessError('table_not_open', 409);
  await audit({ organizationId: session.organizationId, action: 'table.device_enrolled', entityType: 'TableSession', entityId: session.id, metadata: { table: table.label, device: created.id } }).catch((e) => logError('audit', e));
  return { joined: true as const, required: true, tableLabel: table.label, token };
}

// ------------------------------------------------------------------ staff

/**
 * PINs and phone authorisations are for staff who seat guests (tables.sessions: owner, manager, waiter).
 * The dashboard actions check it first; the services check it again, so no other caller (a new route,
 * a script) can hand a PIN to kitchen, Café or delivery staff.
 */
export function assertSeatsGuests(ctx: TenantContext) {
  if (!ctx.can('tables.sessions')) throw new AccessDeniedError('forbidden');
}

async function ownedOpenSession(ctx: TenantContext, sessionId: string) {
  assertSeatsGuests(ctx);
  const s = await db.tableSession.findFirst({
    where: { id: sessionId, organizationId: ctx.org.id },
    include: { table: { select: { label: true } }, location: { select: { tableOrderingPolicy: true } } },
  });
  if (!s) throw new UserFacingError('Table session not found.', 404);
  await assertLocationAccess(ctx, s.locationId);
  if (s.status !== 'OPEN') throw new UserFacingError('This table is closed. Open it again for new guests.');
  return s;
}

/**
 * Shows the current PIN to a member of staff (audited, never logged). A session opened before
 * SESSION_PIN shows its 4-digit code.
 */
export async function revealPin(ctx: TenantContext, sessionId: string) {
  const s = await ownedOpenSession(ctx, sessionId);
  if (s.location.tableOrderingPolicy !== 'SESSION_PIN') throw new UserFacingError('This location does not use table PINs.');
  const pin = expectedPin(s);
  if (!pin) throw new UserFacingError('No PIN yet. Issue a new PIN.');
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'table.pin_viewed', entityType: 'TableSession', entityId: s.id, metadata: { table: s.table.label } });
  return { pin, locked: !!s.pinLockedAt, failures: s.pinFailedAttempts };
}

/**
 * Issues a new PIN for the seating and clears a lock. Phones that already entered the old PIN stay
 * authorised: a late guest's typos must never stop a table that is already ordering.
 */
export async function regeneratePin(ctx: TenantContext, sessionId: string) {
  const s = await ownedOpenSession(ctx, sessionId);
  if (s.location.tableOrderingPolicy !== 'SESSION_PIN') throw new UserFacingError('This location does not use table PINs.');
  const { pin, data } = pinFields(s.id, ctx.userId);
  const r = await db.tableSession.updateMany({ where: { id: s.id, status: 'OPEN' }, data });
  if (r.count !== 1) throw new UserFacingError('This table is closed. Open it again for new guests.');
  await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'table.pin_issued', entityType: 'TableSession', entityId: s.id, metadata: { table: s.table.label, wasLocked: !!s.pinLockedAt } });
  return { pin };
}

/** Staff remove one phone's authorisation (e.g. a guest who left, or a suspicious order). */
export async function revokeDevice(ctx: TenantContext, deviceId: string) {
  assertSeatsGuests(ctx);
  const dvc = await db.tableSessionDevice.findFirst({ where: { id: deviceId, organizationId: ctx.org.id } });
  if (!dvc) throw new UserFacingError('Phone not found.', 404);
  await assertLocationAccess(ctx, dvc.locationId);
  const r = await db.tableSessionDevice.updateMany({ where: { id: dvc.id, revokedAt: null }, data: { revokedAt: new Date(), revokedById: ctx.userId } });
  if (r.count) await audit({ organizationId: ctx.org.id, actorUserId: ctx.userId, action: 'table.device_revoked', entityType: 'TableSession', entityId: dvc.tableSessionId, metadata: { device: dvc.id } });
}

/** Phones and PIN state of a seating, for the bill and tables pages (no secret). */
export async function sessionAccessSummary(ctx: TenantContext, sessionId: string) {
  const s = await db.tableSession.findFirst({
    where: { id: sessionId, organizationId: ctx.org.id },
    select: { id: true, locationId: true, status: true, pinIssuedAt: true, pinFailedAttempts: true, pinLockedAt: true, pinCipher: true, verificationCode: true, location: { select: { tableOrderingPolicy: true } } },
  });
  if (!s) throw new UserFacingError('Table session not found.', 404);
  await assertLocationAccess(ctx, s.locationId);
  const devices = await db.tableSessionDevice.findMany({
    where: { tableSessionId: s.id },
    orderBy: { enrolledAt: 'asc' },
    select: { id: true, enrolledAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true, _count: { select: { orders: true } } },
  });
  return {
    policy: s.location.tableOrderingPolicy,
    status: s.status,
    pinIssued: !!(s.pinCipher || s.verificationCode),
    pinIssuedAt: s.pinIssuedAt,
    failures: s.pinFailedAttempts,
    locked: !!s.pinLockedAt,
    devices: devices.map((d, i) => ({ id: d.id, n: i + 1, enrolledAt: d.enrolledAt, lastUsedAt: d.lastUsedAt, active: !d.revokedAt && d.expiresAt.getTime() > Date.now(), revokedAt: d.revokedAt, orders: d._count.orders })),
  };
}

/**
 * How often guests ordered on tables nobody had opened (MenuNiva opened them itself) in the last 30
 * days: the real exposure of the OPEN policy at this location, shown next to the setting so an owner
 * can decide with numbers.
 */
export async function unopenedTableOrders(ctx: TenantContext, locationId: string) {
  await assertLocationAccess(ctx, locationId);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [orders, sessions] = await Promise.all([
    db.order.count({ where: { organizationId: ctx.org.id, locationId, channel: 'TABLE', createdAt: { gte: since }, tableSession: { openedById: null } } }),
    db.tableSession.count({ where: { organizationId: ctx.org.id, locationId, openedAt: { gte: since }, openedById: null } }),
  ]);
  return { orders, sessions };
}
