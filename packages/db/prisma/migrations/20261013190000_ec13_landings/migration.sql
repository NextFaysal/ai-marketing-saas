-- EC13 (Landing Page & Funnel Builder): LandingPage,
-- LandingVariant, LandingEvent + Order landing attribution.
-- All additive. NOT run on any real DB from the build sandbox;
-- required at deploy.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "landingPageId" TEXT;
ALTER TABLE "Order" ADD COLUMN "landingVariantId" TEXT;

-- CreateIndex
CREATE INDEX "Order_organizationId_landingPageId_idx" ON "Order"("organizationId", "landingPageId");

-- CreateTable
CREATE TABLE "LandingPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sections" JSONB,
    "upsellProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingVariant" (
    "id" TEXT NOT NULL,
    "landingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isControl" BOOLEAN NOT NULL DEFAULT false,
    "weight" INTEGER NOT NULL DEFAULT 100,
    "headline" TEXT,
    "heroImageUrl" TEXT,
    "ctaText" TEXT,
    "showCompareAt" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingEvent" (
    "id" TEXT NOT NULL,
    "landingId" TEXT NOT NULL,
    "variantId" TEXT,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LandingPage_slug_key" ON "LandingPage"("slug");

-- CreateIndex
CREATE INDEX "LandingPage_organizationId_status_idx" ON "LandingPage"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LandingPage_organizationId_productId_idx" ON "LandingPage"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "LandingVariant_landingId_idx" ON "LandingVariant"("landingId");

-- CreateIndex
CREATE INDEX "LandingEvent_landingId_kind_createdAt_idx" ON "LandingEvent"("landingId", "kind", "createdAt");
