-- CP (Platform Completion Pack): SyncConflict.fieldDiffs
-- (per-field diff for field-level resolution), Store.weightUnit
-- (the store's own weight unit — ends the kg assumption),
-- ReturnRequest.shopifyRestock (partial-restock attempt outcome).
-- All additive. NOT run on any real DB from the build sandbox;
-- required at deploy.

-- AlterTable
ALTER TABLE "SyncConflict" ADD COLUMN "fieldDiffs" JSONB;
ALTER TABLE "Store" ADD COLUMN "weightUnit" TEXT;
ALTER TABLE "ReturnRequest" ADD COLUMN "shopifyRestock" JSONB;
