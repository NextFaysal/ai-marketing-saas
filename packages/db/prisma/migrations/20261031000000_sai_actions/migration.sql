-- SA-B10 (Smart AI Phase 2, W1): the Action Engine.
--
-- 1) AIActionProposal is EXTENDED (not duplicated) for
-- catalog-driven proposals: the catalog action id + surface,
-- who proposed (ai | staff), the autonomy level snapshotted at
-- proposal time, the origin reference, and the verifier's
-- read-back outcome. Every new column is nullable — legacy
-- Milestone-47 rows (ads/broadcast proposals) are untouched.
-- "userId" relaxes to nullable because an AI-proposed row has
-- no human proposer; proposedBy records the truth instead.
--
-- 2) AiAutonomySetting: per-org autonomy level for ONE catalog
-- action (plan D5). No row = default level 1 (propose-only).
-- Level 3 is not storable through the settings API.

ALTER TABLE "AIActionProposal" ADD COLUMN "actionId" TEXT;
ALTER TABLE "AIActionProposal" ADD COLUMN "surface" TEXT;
ALTER TABLE "AIActionProposal" ADD COLUMN "proposedBy" TEXT;
ALTER TABLE "AIActionProposal" ADD COLUMN "autonomyLevel" INTEGER;
ALTER TABLE "AIActionProposal" ADD COLUMN "sourceRef" JSONB;
ALTER TABLE "AIActionProposal" ADD COLUMN "verification" JSONB;
ALTER TABLE "AIActionProposal" ALTER COLUMN "userId" DROP NOT NULL;

CREATE INDEX "AIActionProposal_organizationId_actionId_status_idx" ON "AIActionProposal"("organizationId", "actionId", "status");

CREATE TABLE "AiAutonomySetting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAutonomySetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiAutonomySetting_organizationId_actionId_key" ON "AiAutonomySetting"("organizationId", "actionId");
CREATE INDEX "AiAutonomySetting_organizationId_idx" ON "AiAutonomySetting"("organizationId");

ALTER TABLE "AiAutonomySetting" ADD CONSTRAINT "AiAutonomySetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
