-- CC20 (Connect Center Advanced, final batch): the Smart Setup
-- Assistant's ONLY persisted state — one row per (org, user,
-- finding key) dismissal. Findings themselves are computed from
-- real rows on every read and never stored, so nothing here can
-- go stale or fabricate a recommendation.
--
-- The batch's other surfaces need no schema: Google integrations
-- (google_analytics / google_merchant / google_business) are
-- plain Integration + IntegrationCredential rows, LinkedIn is a
-- SocialAccount (platform "linkedin_page") over the same OAuth
-- machinery as TikTok/YouTube, and linkedinAppConfig is a
-- platform-config SystemSetting key (M33 pattern).
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked after 20261013340000_cc19_payment_depth).

-- CreateTable
CREATE TABLE "SetupFindingDismissal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "findingKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetupFindingDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SetupFindingDismissal_organizationId_userId_idx" ON "SetupFindingDismissal"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SetupFindingDismissal_organizationId_userId_findingKey_key" ON "SetupFindingDismissal"("organizationId", "userId", "findingKey");
