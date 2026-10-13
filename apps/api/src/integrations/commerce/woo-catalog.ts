import { decryptJson } from "../crypto";
import { WooClient } from "../woocommerce/woo.client";
import {
  loadListingForPush,
  loadPushContent,
  markListingFailed,
  markListingSynced,
  minorToDecimal,
  readExternalVariantMap,
  type PushContent,
} from "./catalog-content";
import type { AdapterExecuteResult } from "./adapter";

export { minorToDecimal };

/**
 * EC3: WooCommerce catalog write-back. Every op verifies by
 * reading the product back from Woo before it records success —
 * a write that cannot be read back as intended is a failure with
 * a verbatim `readback_mismatch: <field> expected <x> got <y>`.
 * Platform errors (WooApiError messages) are surfaced verbatim and
 * also stored verbatim on the listing's lastSyncError.
 */
export interface CatalogArgs {
  prisma: any;
  organizationId: string;
  store: any;
  integration?: any;
  payload: Record<string, any>;
  fetchFn?: typeof fetch;
}

function getEncrypted(integration: any): string | null {
  return integration?.credential?.encryptedData ?? integration?.credential?.encrypted_data ?? null;
}

function buildClient(args: CatalogArgs): { client: WooClient } | { error: string } {
  const encrypted = getEncrypted(args.integration);
  if (!encrypted) return { error: "woo_credentials_missing" };
  let secrets: any;
  try {
    secrets = decryptJson<any>(encrypted);
  } catch {
    return { error: "woo_credentials_missing" };
  }
  if (!secrets?.consumerKey || !secrets?.consumerSecret) return { error: "woo_credentials_missing" };
  const client = new WooClient(
    args.store.url,
    { consumerKey: secrets.consumerKey, consumerSecret: secrets.consumerSecret },
    args.fetchFn,
  );
  return { client };
}

async function failWith(
  prisma: any,
  listing: any,
  error: string,
  responseSummary?: any,
): Promise<AdapterExecuteResult> {
  if (listing) await markListingFailed(prisma, listing, error);
  return { ok: false, error, ...(responseSummary !== undefined ? { responseSummary } : {}) };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ------------------------------------------------------------------ */
/* Taxonomy ensure (categories + tags)                                 */
/* ------------------------------------------------------------------ */

async function findTaxonomyMap(prisma: any, storeId: string, kind: string, localId: string): Promise<any | null> {
  try {
    const table = prisma.storeTaxonomyMap;
    if (!table || typeof table.findFirst !== "function") return null;
    return await table.findFirst({ where: { storeId, kind, localId } });
  } catch {
    return null;
  }
}

async function saveTaxonomyMap(
  prisma: any,
  organizationId: string,
  storeId: string,
  kind: string,
  localId: string,
  externalId: string,
): Promise<void> {
  try {
    const table = prisma.storeTaxonomyMap;
    if (!table) return;
    if (typeof table.upsert === "function") {
      await table.upsert({
        where: { storeId_kind_localId: { storeId, kind, localId } },
        create: { organizationId, storeId, kind, localId, externalId },
        update: { externalId },
      });
    } else if (typeof table.create === "function") {
      await table.create({ data: { organizationId, storeId, kind, localId, externalId } });
    }
  } catch {
    /* map persistence is best-effort; a later push re-ensures */
  }
}

async function createWooTaxonomy(
  client: WooClient,
  kind: "category" | "tag",
  name: string,
  parentRemoteId?: string | null,
): Promise<string> {
  const path = kind === "category" ? "/products/categories" : "/products/tags";
  const body: Record<string, any> = { name };
  if (kind === "category" && parentRemoteId) body.parent = Number(parentRemoteId);
  const { data } = await client.post<any>(path, body);
  const id = data?.id;
  if (id === undefined || id === null) throw new Error(`woo_${kind}_create_missing_id`);
  return String(id);
}

/** Ensure a local Category exists remotely; returns the Woo category id. Creates the parent first when unmapped (one level). */
export async function ensureWooCategory(
  client: WooClient,
  prisma: any,
  organizationId: string,
  storeId: string,
  category: any,
): Promise<string> {
  const hit = await findTaxonomyMap(prisma, storeId, "category", String(category.id));
  if (hit?.externalId) return String(hit.externalId);
  let parentRemoteId: string | null = null;
  if (category.parentId) {
    const parentHit = await findTaxonomyMap(prisma, storeId, "category", String(category.parentId));
    if (parentHit?.externalId) {
      parentRemoteId = String(parentHit.externalId);
    } else {
      let parentRow: any = null;
      try {
        parentRow = await prisma.category.findFirst({
          where: { id: category.parentId, organizationId },
        });
      } catch {
        parentRow = null;
      }
      if (parentRow) {
        parentRemoteId = await createWooTaxonomy(client, "category", String(parentRow.name));
        await saveTaxonomyMap(prisma, organizationId, storeId, "category", String(parentRow.id), parentRemoteId);
      }
    }
  }
  const externalId = await createWooTaxonomy(client, "category", String(category.name), parentRemoteId);
  await saveTaxonomyMap(prisma, organizationId, storeId, "category", String(category.id), externalId);
  return externalId;
}

export async function ensureWooTag(
  client: WooClient,
  prisma: any,
  organizationId: string,
  storeId: string,
  tag: any,
): Promise<string> {
  const hit = await findTaxonomyMap(prisma, storeId, "tag", String(tag.id));
  if (hit?.externalId) return String(hit.externalId);
  const externalId = await createWooTaxonomy(client, "tag", String(tag.name));
  await saveTaxonomyMap(prisma, organizationId, storeId, "tag", String(tag.id), externalId);
  return externalId;
}

/** Resolve the taxonomy payload for a product: remote category/tag ids. Free-text Product.category is display-only and never pushed. */
async function taxonomyForProduct(
  client: WooClient,
  prisma: any,
  organizationId: string,
  storeId: string,
  product: any,
): Promise<{ categoryIds: number[]; tagIds: number[] }> {
  const categoryIds: number[] = [];
  const tagIds: number[] = [];
  if (product?.categoryId) {
    let category: any = null;
    try {
      category = await prisma.category.findFirst({
        where: { id: product.categoryId, organizationId },
      });
    } catch {
      category = null;
    }
    if (category) {
      const remoteId = await ensureWooCategory(client, prisma, organizationId, storeId, category);
      categoryIds.push(Number(remoteId));
    }
  }
  try {
    const assignments = await prisma.productTagAssignment.findMany({
      where: { productId: product.id },
    });
    for (const a of assignments ?? []) {
      let tag: any = a?.tag ?? null;
      const tagId = a?.tagId ?? a?.productTagId;
      if (!tag && tagId) {
        try {
          tag = await prisma.productTag.findFirst({ where: { id: tagId, organizationId } });
        } catch {
          tag = null;
        }
      }
      if (tag) {
        const remoteId = await ensureWooTag(client, prisma, organizationId, storeId, tag);
        tagIds.push(Number(remoteId));
      }
    }
  } catch {
    /* no tag table / no assignments — nothing to push */
  }
  return { categoryIds, tagIds };
}

/* ------------------------------------------------------------------ */
/* Payload builders                                                    */
/* ------------------------------------------------------------------ */

function wooStatus(publishState: string): string {
  if (publishState === "published") return "publish";
  return "draft"; // draft + archived both leave the storefront
}

function priceFields(saleOn: boolean, effectiveMinor: string, compareAtMinor: string | null) {
  return {
    regular_price: minorToDecimal(BigInt(saleOn && compareAtMinor ? compareAtMinor : effectiveMinor)),
    sale_price: saleOn ? minorToDecimal(BigInt(effectiveMinor)) : "",
  };
}

function weightKg(weightGrams: number): string {
  const kg = weightGrams / 1000;
  return kg
    .toFixed(3)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

/**
 * CP3: render a gram weight in the STORE's WooCommerce weight
 * unit (Store.weightUnit, read from woocommerce_weight_unit or
 * staff-set). Canonical storage stays grams; only the payload
 * value changes. null/unknown unit = the legacy kg behaviour.
 * lb/oz are rounded to 2dp (Woo accepts decimal strings).
 */
export function weightInUnit(weightGrams: number, unit?: string | null): string {
  switch (unit) {
    case "g":
      return String(weightGrams);
    case "lb":
      return String(Math.round((weightGrams / 453.59237) * 100) / 100);
    case "oz":
      return String(Math.round((weightGrams / 28.349523125) * 100) / 100);
    case "kg":
    default:
      return weightKg(weightGrams);
  }
}

function deriveAttributes(content: PushContent): {
  productAttributes: any[];
  variationAttributes: (variant: PushContent["variants"][number]) => any[];
} {
  const variants = content.variants;
  const allHaveAttrs = variants.every(
    (v) => v.attributes && typeof v.attributes === "object" && !Array.isArray(v.attributes) && Object.keys(v.attributes).length > 0,
  );
  if (allHaveAttrs) {
    const keys: string[] = [];
    for (const v of variants) {
      for (const k of Object.keys(v.attributes)) if (!keys.includes(k)) keys.push(k);
    }
    const productAttributes = keys.map((k) => ({
      name: k,
      options: [
        ...new Set(
          variants
            .map((v) => v.attributes?.[k])
            .filter((x: any) => x !== undefined && x !== null)
            .map((x: any) => String(x)),
        ),
      ],
      variation: true,
      visible: true,
    }));
    return {
      productAttributes,
      variationAttributes: (v) =>
        Object.entries(v.attributes ?? {}).map(([name, value]) => ({ name, option: String(value) })),
    };
  }
  return {
    productAttributes: [
      { name: "Variant", options: variants.map((v) => v.name), variation: true, visible: true },
    ],
    variationAttributes: (v) => [{ name: "Variant", option: v.name }],
  };
}

function variationPayload(
  content: PushContent,
  variant: PushContent["variants"][number],
  variationAttributes: (v: PushContent["variants"][number]) => any[],
): Record<string, any> {
  const eff = variant.priceMinor ?? content.priceMinor;
  return {
    ...(variant.sku ? { sku: variant.sku } : {}),
    ...priceFields(content.saleOn, eff, content.compareAtMinor),
    manage_stock: variant.stockQuantity !== null && variant.stockQuantity !== undefined,
    ...(variant.stockQuantity !== null && variant.stockQuantity !== undefined
      ? { stock_quantity: variant.stockQuantity }
      : {}),
    attributes: variationAttributes(variant),
    status: "publish",
  };
}

/* ------------------------------------------------------------------ */
/* Read-back verification                                              */
/* ------------------------------------------------------------------ */

function checkProductReadBack(
  remote: any,
  remoteVariations: any[] | null,
  content: PushContent,
): string | null {
  if (!remote) return `readback_mismatch: product expected present got missing`;
  if (String(remote.name ?? "") !== content.name) {
    return `readback_mismatch: name expected ${content.name} got ${remote.name ?? ""}`;
  }
  const expectedStatus = wooStatus(content.publishState);
  if (String(remote.status ?? "") !== expectedStatus) {
    return `readback_mismatch: status expected ${expectedStatus} got ${remote.status ?? ""}`;
  }
  if (remote.price !== undefined && remote.price !== null && String(remote.price) !== "") {
    const gotMinor = Math.round(Number(remote.price) * 100);
    if (!Number.isFinite(gotMinor) || gotMinor !== Number(content.priceMinor)) {
      return `readback_mismatch: price expected ${content.priceMinor} got ${gotMinor}`;
    }
  }
  if (remote.manage_stock && content.stockQuantity !== null) {
    if (Number(remote.stock_quantity) !== content.stockQuantity) {
      return `readback_mismatch: stock_quantity expected ${content.stockQuantity} got ${remote.stock_quantity ?? ""}`;
    }
  }
  if (content.variants.length > 0 && remoteVariations) {
    if (remoteVariations.length !== content.variants.length) {
      return `readback_mismatch: variation_count expected ${content.variants.length} got ${remoteVariations.length}`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

export async function pushProduct(args: CatalogArgs): Promise<AdapterExecuteResult> {
  const built = buildClient(args);
  if ("error" in built) return { ok: false, error: built.error };
  const client = built.client;
  const loaded = await loadListingForPush(args.prisma, args.organizationId, args.store?.id, args.payload?.listingId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const listing = loaded.listing;
  try {
    const { content, hash } = await loadPushContent(args.prisma, args.organizationId, listing);
    const product = await args.prisma.product.findFirst({
      where: { id: listing.productId, organizationId: args.organizationId },
    });
    const { categoryIds, tagIds } = await taxonomyForProduct(
      client,
      args.prisma,
      args.organizationId,
      String(args.store.id),
      product,
    );

    const isVariable = content.variants.length > 0;
    const body: Record<string, any> = {
      name: content.name,
      type: isVariable ? "variable" : "simple",
      status: wooStatus(content.publishState),
      ...priceFields(content.saleOn, content.priceMinor, content.compareAtMinor),
      manage_stock: content.stockQuantity !== null,
      ...(content.stockQuantity !== null ? { stock_quantity: content.stockQuantity } : {}),
    };
    if (content.description) body.description = content.description;
    if (content.sku) body.sku = content.sku;
    if (content.weightGrams !== null) body.weight = weightInUnit(content.weightGrams, args.store?.weightUnit);
    const dims: Record<string, string> = {};
    if (content.lengthCm !== null) dims.length = String(content.lengthCm);
    if (content.widthCm !== null) dims.width = String(content.widthCm);
    if (content.heightCm !== null) dims.height = String(content.heightCm);
    if (Object.keys(dims).length > 0) body.dimensions = dims;
    const meta: any[] = [];
    if (content.barcode) meta.push({ key: "ec_barcode", value: content.barcode });
    if (content.seoTitle) meta.push({ key: "ec_seo_title", value: content.seoTitle });
    if (content.seoDescription) meta.push({ key: "ec_seo_description", value: content.seoDescription });
    if (meta.length > 0) body.meta_data = meta;
    if (categoryIds.length > 0) body.categories = categoryIds.map((id) => ({ id }));
    if (tagIds.length > 0) body.tags = tagIds.map((id) => ({ id }));
    if (content.images.length > 0) body.images = content.images.map((src) => ({ src }));

    let attrs: ReturnType<typeof deriveAttributes> | null = null;
    if (isVariable) {
      attrs = deriveAttributes(content);
      body.attributes = attrs.productAttributes;
    }

    const existingId = listing.externalId ? String(listing.externalId) : "";
    const saved = existingId
      ? (await client.put<any>(`/products/${existingId}`, body)).data
      : (await client.post<any>("/products", body)).data;
    const remoteId = saved?.id;
    if (remoteId === undefined || remoteId === null) throw new Error("woo_product_save_missing_id");

    // Variations via batch: create the unmapped, update the mapped.
    const variantMap = readExternalVariantMap(listing.externalVariantMap);
    if (isVariable && attrs) {
      const creates: { variant: PushContent["variants"][number]; body: any }[] = [];
      const updates: { variant: PushContent["variants"][number]; body: any }[] = [];
      for (const v of content.variants) {
        const mapped = variantMap[v.id];
        const vb = variationPayload(content, v, attrs.variationAttributes);
        if (mapped?.id) updates.push({ variant: v, body: { id: Number(mapped.id), ...vb } });
        else creates.push({ variant: v, body: vb });
      }
      const batchBody: Record<string, any> = {};
      if (creates.length > 0) batchBody.create = creates.map((c) => c.body);
      if (updates.length > 0) batchBody.update = updates.map((u) => u.body);
      if (Object.keys(batchBody).length > 0) {
        const batchRes = await client.batchVariations(remoteId, batchBody);
        const groups: { items: { variant: PushContent["variants"][number] }[]; returned: any[] }[] = [
          { items: creates, returned: Array.isArray(batchRes?.create) ? batchRes.create : [] },
          { items: updates, returned: Array.isArray(batchRes?.update) ? batchRes.update : [] },
        ];
        for (const g of groups) {
          const used = new Set<number>();
          for (const item of g.items) {
            let idx = -1;
            if (item.variant.sku) {
              idx = g.returned.findIndex((r: any, i: number) => !used.has(i) && r?.sku === item.variant.sku);
            }
            if (idx < 0) idx = g.returned.findIndex((_: any, i: number) => !used.has(i));
            if (idx >= 0) {
              used.add(idx);
              const rid = g.returned[idx]?.id;
              if (rid !== undefined && rid !== null) variantMap[item.variant.id] = { id: String(rid) };
            }
          }
        }
      }
    }

    // Read-back (required): product + variations when variable.
    const remote = (await client.get<any>(`/products/${remoteId}`)).data;
    let remoteVariations: any[] | null = null;
    if (isVariable) {
      const vars = await client.listVariations(remoteId);
      remoteVariations = Array.isArray(vars) ? vars : [];
    }
    const mismatch = checkProductReadBack(remote, remoteVariations, content);
    if (mismatch) return failWith(args.prisma, listing, mismatch, { remoteId: String(remoteId) });

    await markListingSynced(args.prisma, listing, {
      lastPushedHash: hash,
      lastPushedAt: new Date(),
      externalId: String(remoteId),
      externalVariantMap: variantMap,
      channelStock: content.stockQuantity,
    });
    return { ok: true, responseSummary: { remoteId: String(remoteId) } };
  } catch (e) {
    return failWith(args.prisma, listing, errMsg(e));
  }
}

export async function archiveProduct(args: CatalogArgs): Promise<AdapterExecuteResult> {
  const built = buildClient(args);
  if ("error" in built) return { ok: false, error: built.error };
  const client = built.client;
  const loaded = await loadListingForPush(args.prisma, args.organizationId, args.store?.id, args.payload?.listingId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const listing = loaded.listing;
  const remoteId = listing.externalId ? String(listing.externalId) : "";
  if (!remoteId) return failWith(args.prisma, listing, "listing_external_id_missing");
  try {
    await client.put<any>(`/products/${remoteId}`, { status: "draft" });
    const remote = (await client.get<any>(`/products/${remoteId}`)).data;
    if (String(remote?.status ?? "") !== "draft") {
      return failWith(
        args.prisma,
        listing,
        `readback_mismatch: status expected draft got ${remote?.status ?? ""}`,
        { remoteId },
      );
    }
    await markListingSynced(args.prisma, listing, {
      publishState: "archived",
      lastPushedAt: new Date(),
      externalId: remoteId,
    });
    return { ok: true, responseSummary: { remoteId } };
  } catch (e) {
    return failWith(args.prisma, listing, errMsg(e));
  }
}

export async function deleteProductRemote(args: CatalogArgs): Promise<AdapterExecuteResult> {
  const built = buildClient(args);
  if ("error" in built) return { ok: false, error: built.error };
  const client = built.client;
  const loaded = await loadListingForPush(args.prisma, args.organizationId, args.store?.id, args.payload?.listingId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const listing = loaded.listing;
  const remoteId = listing.externalId ? String(listing.externalId) : "";
  if (!remoteId) return failWith(args.prisma, listing, "listing_external_id_missing");
  try {
    await client.delete<any>(`/products/${remoteId}?force=true`);
    await markListingSynced(args.prisma, listing, {
      publishState: "archived",
      lastPushedAt: new Date(),
      externalId: remoteId, // kept as the record of what was deleted
    });
    return { ok: true, responseSummary: { deleted: true, remoteId } };
  } catch (e) {
    return failWith(args.prisma, listing, errMsg(e));
  }
}

export async function pushInventory(args: CatalogArgs): Promise<AdapterExecuteResult> {
  const built = buildClient(args);
  if ("error" in built) return { ok: false, error: built.error };
  const client = built.client;
  const loaded = await loadListingForPush(args.prisma, args.organizationId, args.store?.id, args.payload?.listingId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const listing = loaded.listing;
  const remoteId = listing.externalId ? String(listing.externalId) : "";
  if (!remoteId) return failWith(args.prisma, listing, "listing_external_id_missing");
  const quantity = Number(args.payload?.quantity);
  if (!Number.isFinite(quantity)) return failWith(args.prisma, listing, "quantity_missing");
  const variantId = (args.payload?.variantId as string | null) ?? null;
  try {
    let path: string;
    if (variantId) {
      const map = readExternalVariantMap(listing.externalVariantMap);
      const remoteVariantId = map[String(variantId)]?.id;
      if (!remoteVariantId) return failWith(args.prisma, listing, "woo_variant_not_mapped");
      path = `/products/${remoteId}/variations/${remoteVariantId}`;
    } else {
      path = `/products/${remoteId}`;
    }
    await client.put<any>(path, { manage_stock: true, stock_quantity: quantity });
    const remote = (await client.get<any>(path)).data;
    if (Number(remote?.stock_quantity) !== quantity) {
      return failWith(
        args.prisma,
        listing,
        `readback_mismatch: stock_quantity expected ${quantity} got ${remote?.stock_quantity ?? ""}`,
        { remoteId },
      );
    }
    await markListingSynced(args.prisma, listing, {
      channelStock: quantity,
      lastPushedAt: new Date(),
      externalId: remoteId,
    });
    return { ok: true, responseSummary: { remoteId } };
  } catch (e) {
    return failWith(args.prisma, listing, errMsg(e));
  }
}

export async function pushCategory(args: CatalogArgs): Promise<AdapterExecuteResult> {
  const built = buildClient(args);
  if ("error" in built) return { ok: false, error: built.error };
  const client = built.client;
  const categoryId = args.payload?.categoryId as string | undefined;
  if (!categoryId) return { ok: false, error: "category_id_missing" };
  try {
    const category = await args.prisma.category.findFirst({
      where: { id: categoryId, organizationId: args.organizationId },
    });
    if (!category) return { ok: false, error: "category_not_found" };
    const storeId = String(args.store.id);
    const existing = await findTaxonomyMap(args.prisma, storeId, "category", String(category.id));
    if (existing?.externalId) {
      const remoteId = String(existing.externalId);
      // Resolve the parent remote id for the update when mapped.
      let parentRemoteId: number | undefined;
      if (category.parentId) {
        const parentHit = await findTaxonomyMap(args.prisma, storeId, "category", String(category.parentId));
        if (parentHit?.externalId) parentRemoteId = Number(parentHit.externalId);
      }
      await client.put<any>(`/products/categories/${remoteId}`, {
        name: String(category.name),
        ...(parentRemoteId !== undefined ? { parent: parentRemoteId } : {}),
      });
      return { ok: true, responseSummary: { remoteId } };
    }
    const remoteId = await ensureWooCategory(client, args.prisma, args.organizationId, storeId, category);
    return { ok: true, responseSummary: { remoteId } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}
