-- EC3 (Catalog Write-Back): Product enrichment (dimensions, barcode,
-- SEO, structured category link), ProductImage gallery, Category tree,
-- ProductTag + ProductTagAssignment, StoreTaxonomyMap, plus
-- StoreListing sale window / push bookkeeping.
-- All additive: new Product/StoreListing columns are nullable (or
-- defaulted) and the legacy Product.category display field is
-- untouched; no existing row is rewritten.
-- NOT run on any real DB from the build sandbox; required at deploy.

ALTER TABLE "Product" ADD COLUMN "weightGrams" INTEGER;
ALTER TABLE "Product" ADD COLUMN "lengthCm" INTEGER;
ALTER TABLE "Product" ADD COLUMN "widthCm" INTEGER;
ALTER TABLE "Product" ADD COLUMN "heightCm" INTEGER;
ALTER TABLE "Product" ADD COLUMN "barcode" TEXT;
ALTER TABLE "Product" ADD COLUMN "seoTitle" TEXT;
ALTER TABLE "Product" ADD COLUMN "seoDescription" TEXT;
ALTER TABLE "Product" ADD COLUMN "categoryId" TEXT;

ALTER TABLE "StoreListing" ADD COLUMN "saleStartsAt" TIMESTAMP(3);
ALTER TABLE "StoreListing" ADD COLUMN "saleEndsAt" TIMESTAMP(3);
ALTER TABLE "StoreListing" ADD COLUMN "saleActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreListing" ADD COLUMN "lastPushedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTagAssignment" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ProductTagAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreTaxonomyMap" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "localId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreTaxonomyMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductImage_productId_position_idx" ON "ProductImage"("productId", "position");
CREATE UNIQUE INDEX "Category_organizationId_slug_key" ON "Category"("organizationId", "slug");
CREATE INDEX "Category_organizationId_parentId_idx" ON "Category"("organizationId", "parentId");
CREATE UNIQUE INDEX "ProductTag_organizationId_slug_key" ON "ProductTag"("organizationId", "slug");
CREATE UNIQUE INDEX "ProductTagAssignment_productId_tagId_key" ON "ProductTagAssignment"("productId", "tagId");
CREATE INDEX "ProductTagAssignment_tagId_idx" ON "ProductTagAssignment"("tagId");
CREATE UNIQUE INDEX "StoreTaxonomyMap_storeId_kind_localId_key" ON "StoreTaxonomyMap"("storeId", "kind", "localId");
CREATE INDEX "StoreTaxonomyMap_organizationId_storeId_idx" ON "StoreTaxonomyMap"("organizationId", "storeId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductTag" ADD CONSTRAINT "ProductTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductTagAssignment" ADD CONSTRAINT "ProductTagAssignment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductTagAssignment" ADD CONSTRAINT "ProductTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "ProductTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreTaxonomyMap" ADD CONSTRAINT "StoreTaxonomyMap_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreTaxonomyMap" ADD CONSTRAINT "StoreTaxonomyMap_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
