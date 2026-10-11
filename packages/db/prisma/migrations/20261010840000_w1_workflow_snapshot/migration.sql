-- Workflows W1: runs snapshot their steps at start.
ALTER TABLE "WorkflowRun" ADD COLUMN "stepsSnapshot" JSONB;
