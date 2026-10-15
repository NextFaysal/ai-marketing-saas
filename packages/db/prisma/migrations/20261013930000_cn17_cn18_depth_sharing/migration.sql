-- Campaign Builder Frontier NB8: CN17 native platform
-- depth (CrossPlatformDraft.kind — null keeps the legacy
-- CN9 behaviour: google → Search RSA; "pmax" marks a
-- Google Performance Max draft whose fields carry the
-- asset-group shape) and CN18 campaign report shares
-- (ReportShare.planId — set only for kind "campaign"
-- shares; the existing token/expiry/revoke lifecycle is
-- unchanged). Both changes are additive and nullable:
-- every pre-existing draft and share keeps both columns
-- null and behaves exactly as before.
-- NOT run on any real DB from the build sandbox; the full
-- sequence is verified on a fresh Postgres only.

-- AlterTable
ALTER TABLE "CrossPlatformDraft" ADD COLUMN "kind" TEXT;

-- AlterTable
ALTER TABLE "ReportShare" ADD COLUMN "planId" TEXT;
