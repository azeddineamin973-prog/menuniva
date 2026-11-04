-- A line reduced by staff after the kitchen received the ticket is shown as changed on the
-- station screen ("was 2"), instead of silently showing the new quantity. Additive only:
-- existing order items keep NULL (never amended).
ALTER TABLE "OrderItem" ADD COLUMN "amendedAt" TIMESTAMP(3);
ALTER TABLE "OrderItem" ADD COLUMN "originalQuantity" INTEGER;
