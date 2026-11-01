-- Floor plan builder: each restaurant sizes its own rooms and labels them (entrance, bar…),
-- chooses automatic table assignment, and every table on a reservation records who put it
-- there (staff, the guest, automatic). Additive only: new columns with defaults or nullable.
-- Existing areas keep the previous 1000 × 640 canvas; existing assignments count as staff ones.

-- CreateEnum
CREATE TYPE "TableAssignmentSource" AS ENUM ('STAFF', 'GUEST', 'AUTOMATIC');

-- AlterTable
ALTER TABLE "DiningArea" ADD COLUMN     "planHeight" INTEGER NOT NULL DEFAULT 640,
ADD COLUMN     "planLabels" JSONB,
ADD COLUMN     "planWidth" INTEGER NOT NULL DEFAULT 1000;

-- AlterTable
ALTER TABLE "ReservationSettings" ADD COLUMN     "autoAssignTables" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ReservationTableAssignment" ADD COLUMN     "source" "TableAssignmentSource" NOT NULL DEFAULT 'STAFF';
