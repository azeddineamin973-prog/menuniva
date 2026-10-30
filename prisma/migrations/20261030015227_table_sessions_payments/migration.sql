-- AlterTable
ALTER TABLE "PaymentRecord" ADD COLUMN     "voidReason" TEXT;

-- AlterTable
ALTER TABLE "RestaurantLocation" ADD COLUMN     "tableCodeRequired" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TableSession" ADD COLUMN     "closeNote" TEXT,
ADD COLUMN     "openedById" TEXT;
