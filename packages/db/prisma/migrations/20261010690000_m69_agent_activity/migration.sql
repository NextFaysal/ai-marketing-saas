-- Milestone 69 (Team W1): org-level agent heartbeat timestamp.
ALTER TABLE "AgentState" ADD COLUMN "lastActiveAt" TIMESTAMP(3);
