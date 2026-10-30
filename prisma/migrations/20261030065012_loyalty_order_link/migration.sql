-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "loyaltyAccountId" TEXT;

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_orderId_idx" ON "LoyaltyTransaction"("orderId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_loyaltyAccountId_fkey" FOREIGN KEY ("loyaltyAccountId") REFERENCES "LoyaltyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
