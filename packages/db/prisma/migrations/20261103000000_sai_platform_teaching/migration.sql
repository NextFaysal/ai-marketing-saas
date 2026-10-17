-- SA-B22 (Smart AI Phase 6, T1): the Admin Training Console's
-- teaching table.
--
-- PlatformTeaching is PLATFORM scope — deliberately NO
-- organizationId and no foreign keys: a row is general style /
-- policy / how-to guidance written by a SUPER admin that applies
-- to every org's Brain at the LOWEST precedence (plan D8: admin
-- global teaching ranks below org instructions on facts; org
-- truth wins). It must live in its own table: every existing
-- knowledge home (KnowledgeDocument, LearnedItem, AiStoredAnswer)
-- is org-scoped by law L1, and platform guidance has no org to
-- belong to — putting it in an org table would either fake an
-- owner or break the isolation filters.
--
-- Enforcement is by construction, not by this table: teaching
-- reaches AI consumers ONLY as OrgBrainContext.platformGuidance
-- (the guidance channel, rendered after all org sections under a
-- yield label) and never enters facts / factsText / knowledge
-- matches, so its numbers can never ground a customer answer
-- (the number guard and the Answer Store draw from facts only).
CREATE TABLE "PlatformTeaching" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'bn',
    "kind" TEXT NOT NULL DEFAULT 'guidance',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformTeaching_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformTeaching_enabled_sortOrder_idx" ON "PlatformTeaching"("enabled", "sortOrder");
