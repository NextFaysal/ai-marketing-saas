-- IN2: reversible customer merges. Additive only: one new table
-- recording exactly which orders/conversations a merge moved and
-- which survivor fields it gap-filled, so an agent-confirmed merge
-- can be undone (unmerge) without guessing. No existing table is
-- altered; merges made before this migration have no record and
-- stay merged (they are honestly not unmergeable).
CREATE TABLE "CustomerMergeRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceCustomerId" TEXT NOT NULL,
    "targetCustomerId" TEXT NOT NULL,
    "movedOrderIds" JSONB NOT NULL,
    "movedConversationIds" JSONB NOT NULL,
    "filledFields" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertedAt" TIMESTAMP(3),
    "revertedByUserId" TEXT,

    CONSTRAINT "CustomerMergeRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerMergeRecord_organizationId_sourceCustomerId_idx" ON "CustomerMergeRecord"("organizationId", "sourceCustomerId");
CREATE INDEX "CustomerMergeRecord_organizationId_targetCustomerId_idx" ON "CustomerMergeRecord"("organizationId", "targetCustomerId");
