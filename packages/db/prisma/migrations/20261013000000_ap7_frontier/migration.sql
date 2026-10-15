-- AP7 (Frontier): personas, autonomy + assistant identity settings,
-- and org-scoped Assistant API keys. All additive; defaults keep
-- every existing org on today's behaviour (general persona,
-- autonomy level 0 = approve everything, no API keys).
ALTER TABLE "AIConversation" ADD COLUMN "persona" TEXT NOT NULL DEFAULT 'general';
ALTER TABLE "AIProactiveSetting" ADD COLUMN "autonomyLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AIProactiveSetting" ADD COLUMN "assistantName" TEXT;

CREATE TABLE "AssistantApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssistantApiKey_keyHash_key" ON "AssistantApiKey"("keyHash");
CREATE INDEX "AssistantApiKey_organizationId_createdAt_idx" ON "AssistantApiKey"("organizationId", "createdAt");

ALTER TABLE "AssistantApiKey" ADD CONSTRAINT "AssistantApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
