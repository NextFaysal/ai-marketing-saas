-- GB1 (G1 Storefront Completion, GC1–GC4): storefront theme /
-- favicon / WhatsApp / Messenger settings, product video,
-- merchant content pages (ShopPage), the single shop popup
-- (StorePopup) and shop contact-form messages
-- (ShopContactMessage).
-- All additive: new columns carry defaults or are nullable;
-- the three new tables are fresh.
-- NOT run on any real DB from the build sandbox; required at deploy.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "videoUrl" TEXT,
ADD COLUMN "videoPosterUrl" TEXT;

-- AlterTable
ALTER TABLE "StorefrontSetting" ADD COLUMN "themeId" TEXT NOT NULL DEFAULT 'classic',
ADD COLUMN "faviconUrl" TEXT,
ADD COLUMN "whatsappNumber" TEXT,
ADD COLUMN "messengerUrl" TEXT;

-- CreateTable
CREATE TABLE "ShopPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "showInFooter" BOOLEAN NOT NULL DEFAULT false,
    "showInMenu" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorePopup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "body" TEXT,
    "imageUrl" TEXT,
    "ctaText" TEXT,
    "ctaUrl" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'delay_seconds',
    "delaySeconds" INTEGER NOT NULL DEFAULT 5,
    "scrollPercent" INTEGER NOT NULL DEFAULT 50,
    "frequencyDays" INTEGER NOT NULL DEFAULT 7,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "showOn" TEXT NOT NULL DEFAULT 'home',
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorePopup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopContactMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "deliveredVia" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopPage_organizationId_slug_key" ON "ShopPage"("organizationId", "slug");
CREATE INDEX "ShopPage_organizationId_published_idx" ON "ShopPage"("organizationId", "published");
CREATE UNIQUE INDEX "StorePopup_organizationId_key" ON "StorePopup"("organizationId");
CREATE INDEX "ShopContactMessage_organizationId_createdAt_idx" ON "ShopContactMessage"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ShopPage" ADD CONSTRAINT "ShopPage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorePopup" ADD CONSTRAINT "StorePopup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopContactMessage" ADD CONSTRAINT "ShopContactMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
