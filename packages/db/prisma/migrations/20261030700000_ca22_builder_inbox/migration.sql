-- Campaign Builder Advanced CA22 (CB5): builder inbox
-- signals. One observation -> one suggestPlan DRAFT
-- (never published). Manual entry plus merchant-triggered
-- imports from REAL stored competitor rows; the import
-- composes summary text only (competitor creative text
-- is never copied — the CN18 leak-proof rule). The
-- AUTOMATED competitor feed is NOT built here (Smart AI
-- C1–C2 sequence, owner decision 2026-10-17).
CREATE TABLE IF NOT EXISTS "BuilderInboxSignal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRefId" TEXT,
    "competitorId" TEXT,
    "text" TEXT NOT NULL,
    "productId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "draftPlanId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuilderInboxSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BuilderInboxSignal_organizationId_status_createdAt_idx" ON "BuilderInboxSignal"("organizationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "BuilderInboxSignal_organizationId_source_sourceRefId_idx" ON "BuilderInboxSignal"("organizationId", "source", "sourceRefId");
