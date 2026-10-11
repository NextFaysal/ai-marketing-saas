-- CX2: AI Instructions Desk — draft column on BusinessProfile,
-- versioned publish history, and unanswered-question capture.
ALTER TABLE "BusinessProfile" ADD COLUMN "aiInstructionsDraft" TEXT;

CREATE TABLE "AiInstructionVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL,
    "replyLanguage" TEXT,
    "note" TEXT,
    "publishedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInstructionVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiInstructionVersion_organizationId_version_key" ON "AiInstructionVersion"("organizationId", "version");
CREATE INDEX "AiInstructionVersion_organizationId_version_idx" ON "AiInstructionVersion"("organizationId", "version");

CREATE TABLE "AiUnansweredQuestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,
    "channel" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "normalizedQuestion" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUnansweredQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiUnansweredQuestion_organizationId_status_createdAt_idx" ON "AiUnansweredQuestion"("organizationId", "status", "createdAt");
CREATE INDEX "AiUnansweredQuestion_organizationId_normalizedQuestion_idx" ON "AiUnansweredQuestion"("organizationId", "normalizedQuestion");
