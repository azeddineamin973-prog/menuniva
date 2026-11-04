-- Audit OPS-01 / D4: per-location times after which unresolved work (unaccepted orders, kitchen
-- tickets, uncollected pickups, deliveries without a driver, table requests, booking requests)
-- turns into a warning and then an escalation. Additive and nullable: NULL = recommended times.
ALTER TABLE "RestaurantLocation" ADD COLUMN "attentionThresholds" JSONB;
