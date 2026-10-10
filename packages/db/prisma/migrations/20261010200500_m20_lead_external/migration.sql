-- Milestone 20 follow-up: Lead external id for idempotent Lead Ads sync
ALTER TABLE "Lead" ADD COLUMN "externalId" TEXT;
CREATE INDEX "Lead_organizationId_externalId_idx" ON "Lead"("organizationId","externalId");
