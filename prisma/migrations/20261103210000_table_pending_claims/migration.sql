-- Enforceable pending-order cap per table seating (final QA). The cap used to be a count of NEW orders
-- read before the order transaction, so orders sent at the same moment all passed it together. Now
-- every table order first claims a place: claim_table_pending_slot() counts NEW orders plus places
-- already claimed by orders in flight, under a per-seating lock that lasts for that one statement
-- only (no lock is held across round trips, so orders of one table still do not queue behind each
-- other), and the order's own transaction deletes its claim as the order appears.
-- Additive only.
-- menuniva: reviewed-destructive the only DELETE is inside the new function body and removes expired rows of the new TablePendingClaim table at run time; this migration deletes no existing data.
-- CreateTable
CREATE TABLE "TablePendingClaim" (
    "id" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TablePendingClaim_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "TablePendingClaim_tableSessionId_createdAt_idx" ON "TablePendingClaim"("tableSessionId", "createdAt");
-- AddForeignKey
ALTER TABLE "TablePendingClaim" ADD CONSTRAINT "TablePendingClaim_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Claims one place in a seating's pending-order cap. TRUE = claimed (row p_claim inserted), FALSE = the
-- seating already has p_cap orders waiting for staff (NEW) or claimed by orders being written.
-- VOLATILE plpgsql in READ COMMITTED: each statement below takes a fresh snapshot after the lock, so
-- every order and claim committed by an earlier caller is counted. The advisory lock is
-- transaction-level: called on its own (autocommit) it is released as soon as the call returns.
-- Claims older than 60 s belong to requests that died before cleaning up (the order transaction is
-- limited to 5 s) and no longer count.
CREATE FUNCTION claim_table_pending_slot(p_session TEXT, p_cap INTEGER, p_claim TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('table-pending:' || p_session, 0));
  DELETE FROM "TablePendingClaim" WHERE "tableSessionId" = p_session AND "createdAt" < now() - interval '60 seconds';
  IF (SELECT count(*) FROM "Order" WHERE "tableSessionId" = p_session AND "status" = 'NEW')
     + (SELECT count(*) FROM "TablePendingClaim" WHERE "tableSessionId" = p_session) >= p_cap THEN
    RETURN FALSE;
  END IF;
  INSERT INTO "TablePendingClaim" ("id", "tableSessionId") VALUES (p_claim, p_session);
  RETURN TRUE;
END
$$;
