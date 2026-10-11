-- Milestone 72 (Team W3): per-member permission overrides.
ALTER TABLE "Membership" ADD COLUMN "permissionOverrides" JSONB;
