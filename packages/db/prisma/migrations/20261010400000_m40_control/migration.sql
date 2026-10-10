-- Milestone 40 (Admin Phase A4): admin API keys.
CREATE TABLE "AdminApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminApiKey_keyHash_key" ON "AdminApiKey"("keyHash");
CREATE INDEX "AdminApiKey_createdById_idx" ON "AdminApiKey"("createdById");
