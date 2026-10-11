-- Social Media Post Scheduler SP7 (Post Insights + Approval Flow):
-- SocialPost gains the platform-insights snapshot (JSONB, stored
-- exactly as Graph returns it — absent metrics stay absent, never
-- 0-filled) plus the approval-flow columns (approvalStatus /
-- submittedById / reviewedById / reviewNote, all nullable: null =
-- no approval state). Organization gains the socialRequireApproval
-- switch that turns the approval flow on for the tenant.

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN "insights" JSONB;
ALTER TABLE "SocialPost" ADD COLUMN "insightsFetchedAt" TIMESTAMP(3);
ALTER TABLE "SocialPost" ADD COLUMN "approvalStatus" TEXT;
ALTER TABLE "SocialPost" ADD COLUMN "submittedById" TEXT;
ALTER TABLE "SocialPost" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "SocialPost" ADD COLUMN "reviewNote" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "socialRequireApproval" BOOLEAN NOT NULL DEFAULT false;
