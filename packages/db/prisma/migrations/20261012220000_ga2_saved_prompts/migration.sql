-- GV3 (Global Assistant v2, G4): per-user saved prompts for the
-- AI Assistant "/" picker. Additive new table only; nothing existing
-- changes. Numbered after IN1's 20261012200000 (and IN3 used 20261012210000 on its branch) so the unmerged
-- in-package branch integrates without a migration collision.
CREATE TABLE "AiSavedPrompt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiSavedPrompt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiSavedPrompt_organizationId_userId_updatedAt_idx" ON "AiSavedPrompt"("organizationId", "userId", "updatedAt");
