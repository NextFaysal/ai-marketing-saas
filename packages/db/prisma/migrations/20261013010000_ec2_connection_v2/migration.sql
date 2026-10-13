-- EC2 (Connection v2): Integration gains the webhook-registration
-- record and the auth bookkeeping for Shopify client-credentials.
-- All additive + nullable: a null authType is the pre-EC2 legacy
-- token path; a null webhookStatus means no registration attempt
-- has been recorded yet (NOT that webhooks are registered).
-- NOT run on any real DB from the build sandbox; required at deploy.

ALTER TABLE "Integration" ADD COLUMN "webhookStatus" JSONB;
ALTER TABLE "Integration" ADD COLUMN "authType" TEXT;
ALTER TABLE "Integration" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);
