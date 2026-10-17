-- ORG3 (Organization Next OB1): tenant-side organization archive.
-- archivedAt is set by the OWNER (POST /organizations/:id/archive)
-- and cleared on restore. NULL = not archived (every existing row
-- stays exactly as it behaves today). The platform status column
-- (ACTIVE | SUSPENDED | DELETED) is untouched and stays admin-only.
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "archivedAt" TIMESTAMP(3);
