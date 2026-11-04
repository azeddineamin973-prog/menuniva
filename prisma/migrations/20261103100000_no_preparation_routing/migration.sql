-- Explicit "no preparation" routing (audit OPS-08): a packaged drink handed over at the counter is
-- no longer indistinguishable from a dish whose station was forgotten. Additive only: every
-- existing category and dish keeps false, and no existing station assignment changes.
ALTER TABLE "MenuCategory" ADD COLUMN "noPreparation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MenuProduct" ADD COLUMN "noPreparation" BOOLEAN NOT NULL DEFAULT false;
