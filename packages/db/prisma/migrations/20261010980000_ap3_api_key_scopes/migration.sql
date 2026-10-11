-- Admin Polish AP3: scope grants for admin API keys.
-- Empty array = legacy key (full access), the documented default.
ALTER TABLE "AdminApiKey" ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
