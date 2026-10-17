-- SA-B2 (Smart AI Phase 0, P2): pgvector + KnowledgeEmbedding.
-- Enables the vector extension in the SAME Postgres (Master Plan
-- §3: pgvector now, Qdrant only at ~2–5M vectors via the
-- VectorStore port). The Dokploy compose image is swapped to
-- pgvector/pgvector:pg16 in this batch so the extension exists on
-- the deployment; on a stock postgres:16-alpine this migration
-- would fail at CREATE EXTENSION — that is deliberate (no silent
-- half-state: hybrid search must never pretend to run without
-- the extension).
-- The embedding column is UNTYPED vector: providers return
-- different dimensions, and each row records its own
-- provider/model/dimension; search filters to the query vector's
-- model + dimension. No HNSW index (impossible on untyped
-- vectors); exact cosine scan is the recorded choice at current
-- tenant scale.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "KnowledgeEmbedding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimension" INTEGER NOT NULL,
    "embedding" vector,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KnowledgeEmbedding_organizationId_sourceType_sourceId_idx" ON "KnowledgeEmbedding"("organizationId", "sourceType", "sourceId");
CREATE INDEX "KnowledgeEmbedding_organizationId_contentHash_idx" ON "KnowledgeEmbedding"("organizationId", "contentHash");
CREATE INDEX "KnowledgeEmbedding_organizationId_model_idx" ON "KnowledgeEmbedding"("organizationId", "model");

ALTER TABLE "KnowledgeEmbedding" ADD CONSTRAINT "KnowledgeEmbedding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
