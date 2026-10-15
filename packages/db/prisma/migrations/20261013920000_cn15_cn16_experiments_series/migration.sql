-- Campaign Builder Frontier NB7: CN15 Meta Experiments
-- (CampaignExperiment — the Ad Study link between two
-- variant plans; Meta payloads stored verbatim, a row
-- exists only when Meta confirmed the study) and CN16
-- full-funnel + recurring series (CampaignPlanSeries, the
-- CampaignPlan.seriesId / seriesInstanceDate markers on
-- generated instances, and the CampaignAdSet funnel layer
-- tags). All changes are additive and nullable/defaulted:
-- pre-existing plans and ad sets keep both new columns
-- null and behave exactly as before.
-- NOT run on any real DB from the build sandbox; the full
-- sequence is verified on a fresh Postgres only.

-- CreateTable
CREATE TABLE "CampaignExperiment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "planAId" TEXT NOT NULL,
    "planBId" TEXT NOT NULL,
    "splitA" INTEGER NOT NULL,
    "metricEvent" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "metaBusinessId" TEXT,
    "metaStudyId" TEXT,
    "createResponse" JSONB,
    "lastReadback" JSONB,
    "lastReadbackAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignPlanSeries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourcePlanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "anchorDate" TIMESTAMP(3),
    "dates" JSONB,
    "leadDays" INTEGER NOT NULL DEFAULT 3,
    "nextIndex" INTEGER NOT NULL DEFAULT 0,
    "pendingPlanId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastGeneratedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignPlanSeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignExperiment_organizationId_groupId_idx" ON "CampaignExperiment"("organizationId", "groupId");

-- CreateIndex
CREATE INDEX "CampaignExperiment_organizationId_planAId_idx" ON "CampaignExperiment"("organizationId", "planAId");

-- CreateIndex
CREATE INDEX "CampaignPlanSeries_organizationId_status_idx" ON "CampaignPlanSeries"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CampaignPlanSeries_organizationId_sourcePlanId_idx" ON "CampaignPlanSeries"("organizationId", "sourcePlanId");

-- AlterTable
ALTER TABLE "CampaignPlan" ADD COLUMN "seriesId" TEXT;
ALTER TABLE "CampaignPlan" ADD COLUMN "seriesInstanceDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CampaignAdSet" ADD COLUMN "funnelLayer" TEXT;
ALTER TABLE "CampaignAdSet" ADD COLUMN "funnelIncomplete" TEXT;
