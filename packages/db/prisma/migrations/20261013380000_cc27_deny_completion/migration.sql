-- CC27 (Connect Center Next, B12): deny-list completion — the
-- CONFIGURING actor of the two autopilot settings surfaces.
--
-- InboxSetting.updatedById / SocialReplySetting.updatedById: the
-- member who last saved the settings, written by every
-- updateSettings call from CC27 on. The CC27 deny gate for
-- AI/auto-reply and system sends reads the actor chain
-- (conversation assignee -> settings configuring actor); a NULL
-- here means "no actor recorded" — rows that predate CC27 and
-- default-minted SocialReplySetting rows — and the gate
-- honestly does not apply to those paths (documented in
-- docs/connect-center-b12-acceptance.md, never faked).
--
-- Both columns are nullable with no default and no backfill:
-- existing rows keep NULL, which is the truthful state.
--
-- NOT run on any real DB from the build sandbox; required at
-- deploy (sequence-checked in the full fresh-Postgres run).

-- AlterTable
ALTER TABLE "InboxSetting" ADD COLUMN "updatedById" TEXT;

-- AlterTable
ALTER TABLE "SocialReplySetting" ADD COLUMN "updatedById" TEXT;
