-- Floor plan of dining areas (table positions and shapes) and an optional guest table choice
-- for reservation requests. Additive only: new nullable columns or columns with defaults.

-- CreateEnum
CREATE TYPE "TableShape" AS ENUM ('ROUND', 'SQUARE', 'RECTANGLE');

-- AlterTable
ALTER TABLE "ReservationSettings" ADD COLUMN     "guestTableChoice" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RestaurantTable" ADD COLUMN     "planRotation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "planShape" "TableShape" NOT NULL DEFAULT 'ROUND',
ADD COLUMN     "planX" INTEGER,
ADD COLUMN     "planY" INTEGER;
