-- CA5 (Campaign Builder Advanced): store pixel dimensions on
-- CreativeAsset so creative-health can run deterministic
-- aspect/resolution checks. Nullable: assets created before
-- this migration (and direct video uploads, whose bytes are
-- not probed) honestly report "not checked" for dimension
-- checks instead of a silent pass. Populated at direct image
-- upload completion (sharp metadata), CA1 AI image generation
-- and CA2 AI video rendering (exact render size).
ALTER TABLE "CreativeAsset" ADD COLUMN "width" INTEGER;
ALTER TABLE "CreativeAsset" ADD COLUMN "height" INTEGER;
