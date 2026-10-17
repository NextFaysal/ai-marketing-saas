-- NF2 (FB1): Short Video Commerce Studio — VideoProject.
-- Hand-written to match schema.prisma exactly (the repo's
-- hand-written migration style). One row per render project;
-- the rendered mp4 itself lives in a MediaAsset row (kind
-- "video", origin "video_studio") created ONLY on success —
-- mediaAssetId stays NULL and errorLabel carries the real
-- reason on failure. socialPostId is set once on publish
-- through SocialService.createPost.

CREATE TABLE "VideoProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "template" TEXT NOT NULL DEFAULT 'showcase',
    "language" TEXT NOT NULL DEFAULT 'bn',
    "offerText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "mediaAssetId" TEXT,
    "errorLabel" TEXT,
    "socialPostId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoProject_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VideoProject_organizationId_status_idx" ON "VideoProject"("organizationId", "status");
CREATE INDEX "VideoProject_organizationId_createdAt_idx" ON "VideoProject"("organizationId", "createdAt");
CREATE INDEX "VideoProject_productId_idx" ON "VideoProject"("productId");
CREATE INDEX "VideoProject_mediaAssetId_idx" ON "VideoProject"("mediaAssetId");
CREATE INDEX "VideoProject_socialPostId_idx" ON "VideoProject"("socialPostId");

ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE SET NULL ON UPDATE CASCADE;
