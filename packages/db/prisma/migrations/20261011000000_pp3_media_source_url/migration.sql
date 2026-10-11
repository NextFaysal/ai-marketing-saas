-- Social Posts Completion PP3 (product image import): MediaAsset
-- gains sourceUrl — for an asset with origin "imported", the
-- external URL the bytes were fetched from (the product's
-- imageUrl). It is the dedupe key per organization: importing the
-- same URL again returns the existing asset instead of fetching
-- it a second time. Nullable: uploads, AI-generated, template and
-- derived assets have no source URL.

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN "sourceUrl" TEXT;
