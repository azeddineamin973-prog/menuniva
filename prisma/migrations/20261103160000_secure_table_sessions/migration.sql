-- Secure QR table ordering: one table-ordering policy per location, staff-opened sessions with a
-- temporary PIN, and per-phone authorisations ("devices") bound to one session.
-- Additive only: no existing column is dropped or rewritten. `tableCodeRequired` stays for one
-- release (no longer read) so a code rollback needs no data repair.

-- CreateEnum
CREATE TYPE "TableOrderingPolicy" AS ENUM ('OPEN', 'SESSION', 'SESSION_PIN');

-- AlterEnum
ALTER TYPE "StaffTaskType" ADD VALUE 'OPEN_TABLE';

-- Existing locations keep exactly their current behaviour (no silent change of an active workflow):
-- the columns are added with OPEN and a pending-order cap of 50 (above the 40-per-hour table limit,
-- so it never bites first); locations that already required a table code move to SESSION_PIN (a
-- staff-opened table plus a code, as today). Only then do SESSION_PIN and a cap of 15 become the
-- defaults for locations created from now on. Owners change both in Settings → Ordering channels.
ALTER TABLE "RestaurantLocation" ADD COLUMN "tableOrderingPolicy" "TableOrderingPolicy" NOT NULL DEFAULT 'OPEN',
ADD COLUMN "tablePendingOrderCap" INTEGER NOT NULL DEFAULT 50;
UPDATE "RestaurantLocation" SET "tableOrderingPolicy" = 'SESSION_PIN' WHERE "tableCodeRequired" = true;
ALTER TABLE "RestaurantLocation" ALTER COLUMN "tableOrderingPolicy" SET DEFAULT 'SESSION_PIN';
ALTER TABLE "RestaurantLocation" ALTER COLUMN "tablePendingOrderCap" SET DEFAULT 15;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "tableSessionDeviceId" TEXT;

-- AlterTable
ALTER TABLE "TableSession" ADD COLUMN "pinCipher" TEXT,
ADD COLUMN "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "pinIssuedAt" TIMESTAMP(3),
ADD COLUMN "pinIssuedById" TEXT,
ADD COLUMN "pinLockedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TableSessionDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "tableSessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "guestHash" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "TableSessionDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TableSessionDevice_tokenHash_key" ON "TableSessionDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "TableSessionDevice_tableSessionId_idx" ON "TableSessionDevice"("tableSessionId");

-- CreateIndex
CREATE INDEX "TableSessionDevice_organizationId_locationId_idx" ON "TableSessionDevice"("organizationId", "locationId");

-- AddForeignKey
ALTER TABLE "TableSessionDevice" ADD CONSTRAINT "TableSessionDevice_tableSessionId_fkey" FOREIGN KEY ("tableSessionId") REFERENCES "TableSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableSessionDeviceId_fkey" FOREIGN KEY ("tableSessionDeviceId") REFERENCES "TableSessionDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
