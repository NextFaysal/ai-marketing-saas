-- ON1 (Orders Command Center v2): staff tags + order assignee.
-- All additive. tags is a JSON array of strings (replace semantics
-- in OrdersService.setTags); assigneeId is a scalar user id (no FK,
-- same style as Order.landingPageId), validated against ACTIVE org
-- membership at assign time.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "tags" JSONB;
ALTER TABLE "Order" ADD COLUMN "assigneeId" TEXT;

-- CreateIndex
CREATE INDEX "Order_organizationId_assigneeId_idx" ON "Order"("organizationId", "assigneeId");
