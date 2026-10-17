-- CA7 + CA8 (Campaign Builder Advanced, CB2) — migration claim
-- 20261030100000 (CB2's single migration; CB1 used
-- 20261030000000). Two additive tables, no existing table is
-- touched:
--
-- AudiencePerformanceRollup: per-audience delivery totals
-- computed from REAL DailyAdMetric rows joined per ad set to
-- the ONE audience that ad set unambiguously used. Ad sets
-- with 2+ distinct audiences (or an unresolvable one) are
-- excluded from attribution and counted in the coverage
-- note — spend is never split or guessed across audiences.
--
-- AudienceMembershipSnapshot: the SHA-256 [emailHash,
-- phoneHash] pairs a full sync last established on Meta
-- (CA8). One-way hashes only — raw contacts are never
-- stored. Kept in its own table so audience list/read paths
-- can never leak pair data.
CREATE TABLE "AudiencePerformanceRollup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "audienceKey" TEXT NOT NULL,
    "audienceKind" TEXT NOT NULL,
    "audienceRecordId" TEXT,
    "savedAudienceId" TEXT,
    "name" TEXT NOT NULL,
    "adAccountId" TEXT,
    "spendMinor" BIGINT NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "windowDays" INTEGER NOT NULL DEFAULT 90,
    "adSetsCounted" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudiencePerformanceRollup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AudiencePerformanceRollup_organizationId_audienceKey_key" ON "AudiencePerformanceRollup"("organizationId", "audienceKey");

CREATE INDEX "AudiencePerformanceRollup_organizationId_idx" ON "AudiencePerformanceRollup"("organizationId");

CREATE TABLE "AudienceMembershipSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "audienceRecordId" TEXT NOT NULL,
    "pairs" JSONB NOT NULL,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudienceMembershipSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AudienceMembershipSnapshot_audienceRecordId_key" ON "AudienceMembershipSnapshot"("audienceRecordId");

CREATE INDEX "AudienceMembershipSnapshot_organizationId_idx" ON "AudienceMembershipSnapshot"("organizationId");
