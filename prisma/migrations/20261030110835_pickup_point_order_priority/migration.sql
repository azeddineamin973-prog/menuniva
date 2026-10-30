-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "isPriority" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TakeawaySettings" ADD COLUMN     "pickupPoint" TEXT;
