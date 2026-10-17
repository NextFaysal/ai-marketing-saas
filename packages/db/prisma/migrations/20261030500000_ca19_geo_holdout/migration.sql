-- CB5 (Campaign Builder Advanced, CA19) — migration claim
-- 20261030500000 (CB5's second migration; CB5's first was
-- CA18's 20261030400000).
--
-- CA19: PlanGeoHoldout — a geo holdout DEFINITION on a
-- plan (test vs holdout region name sets + window). Spike
-- verdict from official Meta docs: an Ad Study CANNOT
-- split by geography (SPLIT_TEST cells split the audience
-- randomly across campaigns; no region field exists), so
-- NO study is created from this row and the row changes
-- NO delivery by itself. The measurement view compares
-- stored DailyAdBreakdown region rows between the two
-- sets over the window, labelled observational.
-- Additive new table; nothing existing is touched.
CREATE TABLE "PlanGeoHoldout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "testRegions" JSONB NOT NULL,
    "holdoutRegions" JSONB NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanGeoHoldout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlanGeoHoldout_organizationId_planId_status_idx" ON "PlanGeoHoldout"("organizationId", "planId", "status");
