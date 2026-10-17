-- SA-B1 (Smart AI Phase 0, P3): KnowledgeDocument visibility classes.
-- public = the document may be quoted to a customer audience;
-- internal = org team only, never enters a customer-audience AI
-- context (Master Plan law L3, enforced by OrgBrainService).
-- Additive only: existing rows get 'public', which is exactly the
-- behaviour they had (inbox keyword matching could already quote
-- any document). The owner can reclassify a document at any time;
-- NEW documents of kind 'note' default to 'internal' in the
-- knowledge service layer (not here).
ALTER TABLE "KnowledgeDocument" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'public';
