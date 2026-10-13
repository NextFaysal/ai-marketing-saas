import { stableContentHash } from "./content-hash";

/**
 * EC3: the canonical "what would we push for this listing" content
 * projection. Pure builders + one loader. The hash of this exact
 * projection is what listings.lastPushedHash records after a
 * verified write-back, so conflict detection can compare like for
 * like. All money is integer minor units rendered as strings so a
 * BigInt never leaks into JSON payloads or hashes unstably.
 */
export interface PushContentVariant {
  id: string;
  name: string;
  sku: string | null;
  priceMinor: string | null;
  stockQuantity: number | null;
  attributes: any;
}

export interface PushContent {
  name: string;
  sku: string | null;
  description: string | null;
  publishState: string;
  /** Effective selling price: listing.channelPriceMinor ?? product.priceMinor. */
  priceMinor: string;
  compareAtMinor: string | null;
  saleOn: boolean;
  stockQuantity: number | null;
  currency: string;
  barcode: string | null;
  weightGrams: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  seoTitle: string | null;
  seoDescription: string | null;
  images: string[];
  categoryName: string | null;
  tagNames: string[];
  variants: PushContentVariant[];
}

export function pushContentHash(content: PushContent): string {
  return stableContentHash(content);
}

/** Minor units (bigint/string/number) -> decimal string with exactly 2 fraction digits. */
export function minorToDecimal(m: bigint | string | number): string {
  const v = typeof m === "bigint" ? m : BigInt(typeof m === "number" ? Math.trunc(m) : String(m).trim());
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${neg ? "-" : ""}${whole.toString()}.${frac.toString().padStart(2, "0")}`;
}

function minorString(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return String(Math.trunc(v));
  return String(v);
}

export function buildPushContent(
  product: any,
  variants: any[],
  images: string[],
  categoryName: string | null,
  tagNames: string[],
  listing: any,
): PushContent {
  const effective = minorString(listing?.channelPriceMinor ?? product?.priceMinor) ?? "0";
  const compareAt = minorString(product?.compareAtMinor);
  const hasWindow = listing?.saleStartsAt != null || listing?.saleEndsAt != null;
  const saleOn =
    compareAt !== null &&
    BigInt(compareAt) > BigInt(effective) &&
    (!hasWindow || listing?.saleActive === true);
  return {
    name: String(product?.name ?? ""),
    sku: product?.sku ?? null,
    description: product?.description ?? null,
    publishState: listing?.publishState ?? "published",
    priceMinor: effective,
    compareAtMinor: compareAt,
    saleOn,
    stockQuantity: product?.stockQuantity ?? null,
    currency: product?.currency ?? listing?.currency ?? "BDT",
    barcode: product?.barcode ?? null,
    weightGrams: product?.weightGrams ?? null,
    lengthCm: product?.lengthCm ?? null,
    widthCm: product?.widthCm ?? null,
    heightCm: product?.heightCm ?? null,
    seoTitle: product?.seoTitle ?? null,
    seoDescription: product?.seoDescription ?? null,
    images: [...(images ?? [])],
    categoryName: categoryName ?? null,
    tagNames: [...(tagNames ?? [])],
    variants: (variants ?? []).map((v: any) => ({
      id: String(v.id),
      name: String(v.name ?? ""),
      sku: v.sku ?? null,
      priceMinor: minorString(v.priceMinor),
      stockQuantity: v.stockQuantity ?? null,
      attributes: v.attributes ?? null,
    })),
  };
}

export async function loadPushContent(
  prisma: any,
  organizationId: string,
  listing: any,
): Promise<{ content: PushContent; hash: string }> {
  if (!prisma) throw new Error("adapter_prisma_unavailable");
  const product = await prisma.product.findFirst({
    where: { id: listing.productId, organizationId },
  });
  if (!product) throw new Error("product_not_found");

  let variants: any[] = [];
  try {
    variants =
      (await prisma.productVariant.findMany({
        where: { productId: product.id },
        orderBy: { createdAt: "asc" },
      })) ?? [];
  } catch {
    variants = [];
  }

  // Gallery rows win; the legacy single imageUrl is the fallback.
  let images: string[] = [];
  try {
    const table = prisma.productImage;
    if (table && typeof table.findMany === "function") {
      const rows = await table.findMany({
        where: { productId: product.id },
        orderBy: { position: "asc" },
      });
      images = (rows ?? [])
        .map((r: any) => r?.url ?? r?.imageUrl ?? r?.src ?? null)
        .filter((u: any): u is string => typeof u === "string" && u.length > 0);
    }
  } catch {
    images = [];
  }
  if (images.length === 0 && product.imageUrl) images = [String(product.imageUrl)];

  let categoryName: string | null = null;
  if (product.categoryId) {
    try {
      const cat = await prisma.category.findFirst({
        where: { id: product.categoryId, organizationId },
      });
      categoryName = cat?.name ?? null;
    } catch {
      categoryName = null;
    }
  }
  if (categoryName === null && !product.categoryId) {
    categoryName = product.category ?? null;
  }

  const tagNames: string[] = [];
  try {
    const assignments = await prisma.productTagAssignment.findMany({
      where: { productId: product.id },
    });
    for (const a of assignments ?? []) {
      if (a?.tag?.name) {
        tagNames.push(String(a.tag.name));
        continue;
      }
      const tagId = a?.tagId ?? a?.productTagId;
      if (!tagId) continue;
      try {
        const tag = await prisma.productTag.findFirst({
          where: { id: tagId, organizationId },
        });
        if (tag?.name) tagNames.push(String(tag.name));
      } catch {
        /* one bad tag lookup must not sink the whole push */
      }
    }
  } catch {
    /* tags are enrichment; absence is honest */
  }

  const content = buildPushContent(product, variants, images, categoryName, tagNames, listing);
  return { content, hash: pushContentHash(content) };
}

/**
 * Tolerant reader for StoreListing.externalVariantMap. Values are
 * `{ id, inventoryItemId? }` objects; legacy rows stored plain
 * strings — those read back as `{ id }`.
 */
export function readExternalVariantMap(
  raw: any,
): Record<string, { id: string; inventoryItemId?: string }> {
  const out: Record<string, { id: string; inventoryItemId?: string }> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && v) {
      out[k] = { id: v };
    } else if (v && typeof v === "object") {
      const id = (v as any).id ?? (v as any).externalId;
      if (id === undefined || id === null || id === "") continue;
      const entry: { id: string; inventoryItemId?: string } = { id: String(id) };
      const inv = (v as any).inventoryItemId;
      if (inv !== undefined && inv !== null && inv !== "") entry.inventoryItemId = String(inv);
      out[k] = entry;
    } else if (typeof v === "number") {
      out[k] = { id: String(v) };
    }
  }
  return out;
}

/** Shared listing bookkeeping for catalog write-back (both platforms). */
export async function loadListingForPush(
  prisma: any,
  organizationId: string,
  storeId: string | null | undefined,
  listingId: string | undefined,
): Promise<{ listing: any } | { error: string }> {
  if (!listingId) return { error: "listing_id_missing" };
  const where: Record<string, any> = { id: listingId, organizationId };
  if (storeId) where.storeId = storeId;
  const listing = await prisma.storeListing.findFirst({ where });
  if (!listing) return { error: "listing_not_found" };
  if (listing.syncStatus === "conflict") return { error: "listing_conflict_open" };
  return { listing };
}

export async function markListingFailed(prisma: any, listing: any, error: string): Promise<void> {
  try {
    await prisma.storeListing.update({
      where: { id: listing.id },
      data: { syncStatus: "failed", lastSyncError: error },
    });
  } catch {
    /* best-effort bookkeeping; the verbatim error still returns */
  }
  listing.syncStatus = "failed";
  listing.lastSyncError = error;
}

export async function markListingSynced(prisma: any, listing: any, data: Record<string, any>): Promise<void> {
  const update = { syncStatus: "synced", lastSyncError: null, ...data };
  try {
    await prisma.storeListing.update({ where: { id: listing.id }, data: update });
  } catch {
    /* best-effort bookkeeping */
  }
  Object.assign(listing, update);
}
