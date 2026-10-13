-- CX9: Knowledge Base file ingestion — where a KnowledgeDocument
-- came from. Additive only: one column with a default, no backfill,
-- no index changes. Existing rows (all paste-created) read "paste";
-- file-ingested documents store "file:<original filename>".
ALTER TABLE "KnowledgeDocument" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'paste';
