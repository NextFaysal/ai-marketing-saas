-- EC14 (Product Feeds & Marketplace Channels): ProductFeed table.
-- The feed is served at a secret token URL for scheduled fetch by
-- Meta Commerce / Google Merchant Center (XML) or as a generic
-- CSV (TikTok column set = Google columns, labelled generic —
-- see docs/ec14-marketplace-research.md: no public TikTok feed
-- spec exists, and neither TikTok Shop nor Daraz exposes a public
-- BD seller API, so no marketplace integration is built).
-- All additive. NOT run on any real DB from the build sandbox;
-- required at deploy.

-- CreateTable
CREATE TABLE "ProductFeed" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "includeOutOfStock" BOOLEAN NOT NULL DEFAULT false,
    "defaultGoogleCategory" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductFeed_token_key" ON "ProductFeed"("token");

-- CreateIndex
CREATE INDEX "ProductFeed_organizationId_active_idx" ON "ProductFeed"("organizationId", "active");

-- AddForeignKey
ALTER TABLE "ProductFeed" ADD CONSTRAINT "ProductFeed_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
