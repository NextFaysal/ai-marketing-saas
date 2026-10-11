-- Milestone 47 (AI Assistant Write Actions with Approval): proposals
-- that a human must approve before anything executes.
CREATE TABLE "AIActionProposal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "recommendationId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AIActionProposal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AIActionProposal_organizationId_status_idx" ON "AIActionProposal"("organizationId", "status");
ALTER TABLE "AIActionProposal" ADD CONSTRAINT "AIActionProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
