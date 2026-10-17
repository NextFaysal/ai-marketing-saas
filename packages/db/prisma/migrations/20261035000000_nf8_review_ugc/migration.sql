-- NF8 (FB3): Review & UGC upgrade.
-- Hand-written to match schema.prisma exactly (the repo's
-- hand-written migration style). All three columns are additive
-- and nullable — no existing row changes meaning.
--
-- OrderReview.media: Json array of { key, kind, contentType,
-- sizeBytes } for customer-uploaded photo/video on the public
-- review page. The objects live in the PRIVATE bucket (StoredFile
-- surface "review", registered through the existing RB3 storage
-- machinery with the creative upload guards); only keys are
-- stored here, never URLs, so an unapproved (not received, or
-- staff-hidden) review exposes no media URL anywhere.
--
-- OrderReview.socialDraftPostId: the exactly-once claim for the
-- staff "share as social draft" action — the SocialPost id the
-- existing SocialService.createPost created from this review.
--
-- Organization.googleReviewUrl: the org's own Google review
-- link, pasted in Settings. Offered (never auto-redirected, no
-- reward attached) on the post-submit thank-you screen only
-- when the submitted rating is 4–5 AND this is configured.

ALTER TABLE "OrderReview" ADD COLUMN "media" JSONB;
ALTER TABLE "OrderReview" ADD COLUMN "socialDraftPostId" TEXT;
ALTER TABLE "Organization" ADD COLUMN "googleReviewUrl" TEXT;
