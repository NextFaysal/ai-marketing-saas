-- ON3 (Order Surgery): split / merge lineage on Order plus the
-- coupon code actually applied at checkout, so later item edits
-- can re-validate the SAME coupon instead of silently keeping an
-- unverifiable discount. All additive.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "splitFromId" TEXT;
ALTER TABLE "Order" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "Order" ADD COLUMN "couponCode" TEXT;

-- CreateIndex
CREATE INDEX "Order_organizationId_splitFromId_idx" ON "Order"("organizationId", "splitFromId");
CREATE INDEX "Order_organizationId_mergedIntoId_idx" ON "Order"("organizationId", "mergedIntoId");
