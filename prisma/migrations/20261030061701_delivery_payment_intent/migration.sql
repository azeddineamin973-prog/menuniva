-- AlterTable
ALTER TABLE "DeliverySettings" ADD COLUMN     "cardOnDeliveryEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paymentMethodIntent" "PaymentMethod";
