-- AB6 (AX11–AX14): discovery & content — PostgreSQL FTS shop
-- search (Product.searchVector + merchant synonyms + search
-- query analytics), the shop blog (BlogPost), multi-language
-- product content (Product.nameEn / descriptionEn).
-- Additive only: new tables + nullable columns + one new index.
--
-- The searchVector backfill below uses the EXACT expression the
-- runtime builder maintains (apps/api/src/products/
-- search-vector.ts searchVectorExpression): weights A = name /
-- nameEn / SKUs (product + variants), B = structured category
-- name + legacy category string + brand name, C = description /
-- descriptionEn. Config 'simple' throughout (Bengali + English
-- token matching; no stemming is claimed).

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "descriptionEn" TEXT,
ADD COLUMN     "nameEn" TEXT,
ADD COLUMN     "searchVector" tsvector;

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "coverImageUrl" TEXT,
    "blocks" JSONB NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchSynonym" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "expansions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchSynonym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchQueryLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "resultsCount" INTEGER NOT NULL,
    "viaFallback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchQueryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlogPost_organizationId_status_idx" ON "BlogPost"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_organizationId_slug_key" ON "BlogPost"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "SearchSynonym_organizationId_idx" ON "SearchSynonym"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchSynonym_organizationId_term_key" ON "SearchSynonym"("organizationId", "term");

-- CreateIndex
CREATE INDEX "SearchQueryLog_organizationId_createdAt_idx" ON "SearchQueryLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Product_searchVector_idx" ON "Product" USING GIN ("searchVector");

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchSynonym" ADD CONSTRAINT "SearchSynonym_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchQueryLog" ADD CONSTRAINT "SearchQueryLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AB6 (AX11): backfill the search vector for every existing
-- product from its CURRENT relations (structured category +
-- brand resolved by id subqueries, variant SKUs aggregated) —
-- the same expression the runtime hooks maintain from here on.
UPDATE "Product" p SET "searchVector" =
  setweight(to_tsvector('simple', coalesce(p."name", '') || ' ' || coalesce(p."nameEn", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(p."sku", '') || ' ' || coalesce((SELECT string_agg(v."sku", ' ') FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."sku" IS NOT NULL), '')), 'A') ||
  setweight(to_tsvector('simple', coalesce((SELECT c."name" FROM "Category" c WHERE c."id" = p."categoryId"), '') || ' ' || coalesce(p."category", '') || ' ' || coalesce((SELECT b."name" FROM "Brand" b WHERE b."id" = p."brandId"), '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(p."description", '') || ' ' || coalesce(p."descriptionEn", '')), 'C');
