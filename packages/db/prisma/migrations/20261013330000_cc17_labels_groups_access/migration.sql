-- CC17/CC18 (Connect Center Advanced): tenant-chosen display
-- labels + free-text group names on the connection rows that did
-- not have them (AdAccount got its label in AD6), a per-member
-- CONNECTION deny-list on Membership, and the CC18 sync-pause
-- flag on Integration.
--
-- Grouping is deliberately a free-text `groupName` string, NOT a
-- separate Group entity: grouping is a display concern (brand /
-- branch) over a value the tenant controls; there is no group
-- lifecycle (ownership, permissions, deletion semantics) that
-- would justify an entity in this batch.
--
-- Membership.deniedConnections is a JSON array of connection
-- target ids (Integration / SocialAccount row ids) the member
-- may not USE. It lives apart from permissionOverrides because
-- that JSON is strictly permission-area keys (normalizeOverrides
-- strips anything else). Never applies to the OWNER (M72
-- semantics).
--
-- Integration.syncPaused is the CC18 pause switch honoured by
-- the store/channel sync entry points. Ad accounts keep their
-- AD5 syncDisabled flag — no duplicate flag is added for them.
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked after 20261013320000_cc14_provider_health).

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN "label" TEXT;
ALTER TABLE "Integration" ADD COLUMN "groupName" TEXT;
ALTER TABLE "Integration" ADD COLUMN "syncPaused" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN "label" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN "groupName" TEXT;

-- AlterTable
ALTER TABLE "AdAccount" ADD COLUMN "groupName" TEXT;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "deniedConnections" JSONB;
