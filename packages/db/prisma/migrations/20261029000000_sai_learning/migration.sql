-- SA-B4 (Smart AI Phase 0, P5/P6): the learning core.
-- LearnedItem holds knowledge the Brain MINED but may not use
-- yet: plan decision D3 — self-learned content is a SUGGESTION
-- until a human approves it (LearningService then applies it to
-- the Answer Store or a KnowledgeDocument and stamps appliedRef).
-- LearningState is the durable per-org watermark + last-run
-- summary for the conversation-mining and website-refresh sweeps.
-- BusinessProfile gains the two learning toggles where the org's
-- AI settings already live: conversationLearningEnabled defaults
-- FALSE (plan decision D4 — conversation mining is opt-in) and
-- websiteLearningEnabled defaults TRUE (it only ever fetches the
-- org's OWN public websiteUrl, and only when one is set).
-- Additive only: two new tables, two new columns with defaults.

CREATE TABLE "LearnedItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" JSONB,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "appliedRef" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnedItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearnedItem_organizationId_dedupeKey_key" ON "LearnedItem"("organizationId", "dedupeKey");
CREATE INDEX "LearnedItem_organizationId_status_idx" ON "LearnedItem"("organizationId", "status");
CREATE INDEX "LearnedItem_organizationId_sourceType_idx" ON "LearnedItem"("organizationId", "sourceType");

ALTER TABLE "LearnedItem" ADD CONSTRAINT "LearnedItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LearningState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "watermark" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastDetail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningState_organizationId_source_key" ON "LearningState"("organizationId", "source");

ALTER TABLE "LearningState" ADD CONSTRAINT "LearningState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessProfile" ADD COLUMN "conversationLearningEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BusinessProfile" ADD COLUMN "websiteLearningEnabled" BOOLEAN NOT NULL DEFAULT true;
