import { Prisma } from "@repo/db";

/**
 * AB6 (AX11) — Product.searchVector maintenance.
 *
 * The SET expression below EXACTLY mirrors the backfill in
 * migration 20261017060000_ab6_discovery_content:
 *   weight A: name + nameEn, product SKU + variant SKUs
 *             (string_agg subquery over ProductVariant)
 *   weight B: structured Category name (subquery) + legacy
 *             category string + Brand name (subquery)
 *   weight C: description + descriptionEn
 * Config 'simple' throughout (Bengali + English token matching;
 * no stemming is claimed). The Product table is aliased "p".
 *
 * These functions THROW on error — every caller wraps them
 * failure-isolated (a search-vector refresh must never fail the
 * merchant's own product write).
 */
export function searchVectorExpression(): Prisma.Sql {
  return Prisma.sql`setweight(to_tsvector('simple', coalesce(p."name", '') || ' ' || coalesce(p."nameEn", '')), 'A') || setweight(to_tsvector('simple', coalesce(p."sku", '') || ' ' || coalesce((SELECT string_agg(v."sku", ' ') FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."sku" IS NOT NULL), '')), 'A') || setweight(to_tsvector('simple', coalesce((SELECT c."name" FROM "Category" c WHERE c."id" = p."categoryId"), '') || ' ' || coalesce(p."category", '') || ' ' || coalesce((SELECT b."name" FROM "Brand" b WHERE b."id" = p."brandId"), '')), 'B') || setweight(to_tsvector('simple', coalesce(p."description", '') || ' ' || coalesce(p."descriptionEn", '')), 'C')`;
}

/** Refresh ONE product's search vector. Throws on error. */
export async function refreshProductSearchVector(prisma: any, productId: string): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "Product" p SET "searchVector" = ${searchVectorExpression()} WHERE p."id" = ${productId}`,
  );
}

/** Refresh every product of an org; returns the affected count. Throws on error. */
export async function refreshOrgSearchVectors(prisma: any, orgId: string): Promise<number> {
  const n = await prisma.$executeRaw(
    Prisma.sql`UPDATE "Product" p SET "searchVector" = ${searchVectorExpression()} WHERE p."organizationId" = ${orgId}`,
  );
  return Number(n ?? 0);
}

/** Refresh every product linked to a category; returns the affected count. Throws on error. */
export async function refreshCategorySearchVectors(prisma: any, categoryId: string): Promise<number> {
  const n = await prisma.$executeRaw(
    Prisma.sql`UPDATE "Product" p SET "searchVector" = ${searchVectorExpression()} WHERE p."categoryId" = ${categoryId}`,
  );
  return Number(n ?? 0);
}

/** Refresh every product linked to a brand; returns the affected count. Throws on error. */
export async function refreshBrandSearchVectors(prisma: any, brandId: string): Promise<number> {
  const n = await prisma.$executeRaw(
    Prisma.sql`UPDATE "Product" p SET "searchVector" = ${searchVectorExpression()} WHERE p."brandId" = ${brandId}`,
  );
  return Number(n ?? 0);
}
