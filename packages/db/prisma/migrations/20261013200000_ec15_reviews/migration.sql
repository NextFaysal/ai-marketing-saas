-- EC15 (Reviews & Social Proof Engine): ExternalReview table +
-- OrderReview staff reply / visibility fields. All additive.
-- NOT run on any real DB from the build sandbox; required at
-- deploy. (The review-request toggle stays the CX12b
-- InboxSetting.reviewRequestEnabled — no second toggle is added.)

-- AlterTable
ALTER TABLE "OrderReview" ADD COLUMN "replyText" TEXT;
ALTER TABLE "OrderReview" ADD COLUMN "repliedAt" TIMESTAMP(3);
ALTER TABLE "OrderReview" ADD COLUMN "isVisible" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ExternalReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "authorName" TEXT,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "imageUrls" JSONB,
    "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAtRemote" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalReview_storeId_externalId_key" ON "ExternalReview"("storeId", "externalId");

-- CreateIndex
CREATE INDEX "ExternalReview_organizationId_productId_idx" ON "ExternalReview"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "ExternalReview_organizationId_status_idx" ON "ExternalReview"("organizationId", "status");
