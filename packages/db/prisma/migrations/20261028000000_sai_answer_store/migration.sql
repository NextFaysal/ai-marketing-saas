-- SA-B3 (Smart AI Phase 0, P4): the Answer Store.
-- Verified question -> answer pairs the Brain can serve without
-- an LLM call (Master Plan P4), each carrying the sources it was
-- grounded on so a lookup can re-verify it against LIVE data
-- before serving (law L4: a stored answer never beats live
-- data). INTERNAL and CUSTOMER-OWN/personal answers are refused
-- at store time in AnswerStoreService (law L3) — nothing about
-- this table weakens that.
-- The embedding column follows the SA-B2 KnowledgeEmbedding
-- precedent exactly: UNTYPED vector (providers return different
-- dimensions; each row records its own provider/model/dimension
-- and search filters to the query vector's model + dimension).
-- Rows stored while embeddings were unavailable carry NULL
-- provider/model/dimension/embedding and are reachable only by
-- exact normalized-question match.
-- Additive only: one new table, no existing table is touched.
-- Requires the pgvector extension, enabled by
-- 20261027000000_sai_vector (which runs before this migration).

CREATE TABLE "AiStoredAnswer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "normalizedQuestion" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'inbox',
    "language" TEXT,
    "sourceRefs" JSONB,
    "containsLiveFacts" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "invalidReason" TEXT,
    "origin" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "groundedAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "dimension" INTEGER,
    "embedding" vector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiStoredAnswer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiStoredAnswer_organizationId_normalizedQuestion_channel_key" ON "AiStoredAnswer"("organizationId", "normalizedQuestion", "channel");
CREATE INDEX "AiStoredAnswer_organizationId_status_idx" ON "AiStoredAnswer"("organizationId", "status");
CREATE INDEX "AiStoredAnswer_organizationId_model_idx" ON "AiStoredAnswer"("organizationId", "model");

ALTER TABLE "AiStoredAnswer" ADD CONSTRAINT "AiStoredAnswer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
