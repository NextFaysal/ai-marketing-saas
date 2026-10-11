-- Milestone 77 (Business Command Center): owner AI behaviour on the profile.
ALTER TABLE "BusinessProfile" ADD COLUMN "aiInstructions" TEXT;
ALTER TABLE "BusinessProfile" ADD COLUMN "aiReplyLanguage" TEXT;
