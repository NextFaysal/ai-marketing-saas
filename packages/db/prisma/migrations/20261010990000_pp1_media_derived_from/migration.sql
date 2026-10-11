-- Social Posts Completion PP1 (SVG → PNG rasterizer): MediaAsset
-- gains derivedFromId — for a mechanically derived asset (the PNG
-- rasterized from an SVG template poster), the id of the source
-- MediaAsset. The publish path caches derived PNGs by
-- (organizationId, derivedFromId, contentType) so each SVG is
-- rasterized at most once per organization. Nullable: uploads,
-- AI-generated and template assets themselves have no source.

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN "derivedFromId" TEXT;
