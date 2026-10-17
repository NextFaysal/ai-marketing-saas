-- MX4: Visual Journey Builder (Messaging-native).
-- Additive only, no backfill:
--   Workflow.journey — journey metadata for workflows owned by
--     the Messaging journey builder: { origin: "messaging",
--     exitOnPurchase?: boolean, layout?: unknown }. NULL on
--     every pre-MX4 workflow and on every workflow created
--     outside the journey builder — the engine treats a NULL
--     journey byte-identically to before (no resume-time fact
--     refresh, no exit-on-purchase evaluation).
--   MessageDelivery.stepRef — the workflow step position that
--     produced this delivery, in the engine's coupon format
--     ("3" for a top-level step, "3.then.0" / "3.else.1" for a
--     branch-arm sub-step). NULL on broadcast deliveries and on
--     every pre-MX4 workflow delivery. It is what makes honest
--     per-step delivery stats possible (grouped by stepRef).
--   MessageLinkClick.broadcastId — was NOT NULL (clicks could
--     only ever belong to a broadcast). Now nullable so a click
--     can belong to a workflow run instead; workflowRunId is
--     the new owner column for that case, indexed for the
--     journey stats / resume-refresh reads. NOTE: no code path
--     writes workflow clicks yet — the MS5 spec pins "workflow
--     sends are NEVER rewritten", so the tracking extension was
--     NOT built in MX4 (see docs/messaging-mx4-acceptance.md);
--     the column lands now so the schema never has to change
--     again if that pin is ever revisited.
ALTER TABLE "Workflow" ADD COLUMN "journey" JSONB;
ALTER TABLE "MessageDelivery" ADD COLUMN "stepRef" TEXT;
ALTER TABLE "MessageLinkClick" ALTER COLUMN "broadcastId" DROP NOT NULL;
ALTER TABLE "MessageLinkClick" ADD COLUMN "workflowRunId" TEXT;
CREATE INDEX "MessageLinkClick_organizationId_workflowRunId_idx" ON "MessageLinkClick"("organizationId", "workflowRunId");
