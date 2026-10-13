-- CX12b: automatic post-delivery review requests (+ 12e daily
-- report email copy flag).
--   OrderReview: one row per order (orderId UNIQUE is the
--     double-delivery guard). Created at delivery as pending_send;
--     the review_request_sweep sends the ask (chat -> SMS -> email,
--     the CX6 precedence) and stamps requested; a captured rating
--     stamps received. Never marked sent without a confirmed send.
--   InboxSetting.reviewRequestEnabled (default OFF — this messages
--     customers, so it is opt-in) + reviewRequestDelayHours (24).
--   AIProactiveSetting.dailyReportEmailEnabled (default OFF).
CREATE TABLE "OrderReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT,
    "conversationId" TEXT,
    "rating" INTEGER,
    "comment" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_send',
    "reviewToken" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL,
    "requestedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderReview_orderId_key" ON "OrderReview"("orderId");
CREATE UNIQUE INDEX "OrderReview_reviewToken_key" ON "OrderReview"("reviewToken");
CREATE INDEX "OrderReview_organizationId_status_idx" ON "OrderReview"("organizationId", "status");
CREATE INDEX "OrderReview_organizationId_conversationId_idx" ON "OrderReview"("organizationId", "conversationId");

ALTER TABLE "InboxSetting" ADD COLUMN "reviewRequestEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InboxSetting" ADD COLUMN "reviewRequestDelayHours" INTEGER NOT NULL DEFAULT 24;

ALTER TABLE "AIProactiveSetting" ADD COLUMN "dailyReportEmailEnabled" BOOLEAN NOT NULL DEFAULT false;
