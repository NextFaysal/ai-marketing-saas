-- MS3: Audience Builder v2.
-- Additive only:
--   MessagingSavedAudience — a named, reusable audience definition
--     ({ entity, match, conditions } Json, validated by
--     messaging/audience-rules.ts at write time). Broadcasts
--     reference it by id; the definition is read at resolve time,
--     so a deleted saved audience fails preview/send honestly.
--   Broadcast.audienceDefinition — inline custom rules when
--     audienceType = "custom".
--   Broadcast.audienceSavedId — the MessagingSavedAudience id when
--     audienceType = "saved".
--   Broadcast.audienceCsv — the raw address list (array of
--     strings) when audienceType = "csv".
--   Broadcast.audienceType stays a free String; its vocabulary
--     extends with custom | saved | csv (no enum migration needed).
CREATE TABLE "MessagingSavedAudience" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingSavedAudience_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessagingSavedAudience_organizationId_idx" ON "MessagingSavedAudience"("organizationId");

ALTER TABLE "MessagingSavedAudience" ADD CONSTRAINT "MessagingSavedAudience_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Broadcast" ADD COLUMN "audienceDefinition" JSONB;
ALTER TABLE "Broadcast" ADD COLUMN "audienceSavedId" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN "audienceCsv" JSONB;
