-- Billing Package B5: billing contacts on the business profile.
ALTER TABLE "BusinessProfile" ADD COLUMN "billingEmails" JSONB;
ALTER TABLE "BusinessProfile" ADD COLUMN "billingAddress" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN "billingBin" TEXT;
