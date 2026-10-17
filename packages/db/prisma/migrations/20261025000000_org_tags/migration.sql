-- ORG13 (Organization Next OB4): SUPER-admin organization tags.
-- Internal classification labels for the platform team (support /
-- sales triage): set only through PATCH /admin/orgs/:id/tags,
-- filterable from the admin org list, and never shown to tenant
-- users. Existing rows get the empty list.
ALTER TABLE "Organization" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
