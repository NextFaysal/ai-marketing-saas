-- Milestone 73 (Team T4): per-agent chat signature.
ALTER TABLE "AgentState" ADD COLUMN "signature" TEXT;
ALTER TABLE "AgentState" ADD COLUMN "signatureEnabled" BOOLEAN NOT NULL DEFAULT false;
