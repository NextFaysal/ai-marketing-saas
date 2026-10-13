import { decryptJson, encryptJson } from "../crypto";
import { ShopifyGraphQLClient } from "../shopify/shopify-graphql.client";
import { exchangeShopifyClientCredentials, normalizeShopifyHost } from "../shopify/shopify-auth";
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

/**
 * EC3: Shopify catalog write-back via the GraphQL Admin API
 * (2025-10). Writes go through `productSet`; success is only
 * recorded after a read-back query matches title / status /
 * variant count / price. userErrors from any mutation are joined
 * and surfaced verbatim (and stored verbatim on the listing).
 *
 * Token handling mirrors ShopifyService.refreshTokenIfNeeded for
 * Dev Dashboard client-credentials integrations: when the stored
 * token is missing its expiry or inside the 5-minute window, a
 * fresh token is exchanged and persisted (credential row via
 * integrationCredential upsert keyed by integrationId, expiry on
 * the integration row) before the token is used.
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

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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

function userErrorsOf(payload: any): string | null {
  const errs = payload?.userErrors;
  if (Array.isArray(errs) && errs.length > 0) {
    return errs.map((e: any) => e?.message ?? String(e)).join("; ");
  }
  return null;
}

function gidFor(kind: string, id: string): string {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/${kind}/${s}`;
}

/* ------------------------------------------------------------------ */
/* Token / client                                                      */
/* ------------------------------------------------------------------ */

export async function resolveShopifyClient(
  args: CatalogArgs,
): Promise<{ client: ShopifyGraphQLClient } | { error: string }> {
  const integration = args.integration;
  const encrypted = getEncrypted(integration);
  if (!encrypted) return { error: "access_token_missing" };
  let secrets: any;
  try {
    secrets = decryptJson<any>(encrypted);
  } catch (e) {
    return { error: errMsg(e) };
  }
  const authType = integration?.authType ?? secrets?.authType;
  let accessToken: string | undefined = secrets?.accessToken;
  if (authType === "client_credentials") {
    const expiresAtMs = integration?.tokenExpiresAt ? new Date(integration.tokenExpiresAt).getTime() : NaN;
    const needsExchange =
      !accessToken || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + 5 * 60 * 1000;
    if (needsExchange) {
      if (!secrets?.clientId || !secrets?.clientSecret) {
        return { error: "shopify_client_credentials_missing" };
      }
      const shopHost = normalizeShopifyHost(args.store?.url ?? integration?.store?.url ?? "");
      let exchanged: { accessToken: string; expiresIn: number | null };
      try {
        exchanged = await exchangeShopifyClientCredentials(
          shopHost,
          String(secrets.clientId),
          String(secrets.clientSecret),
          args.fetchFn,
        );
      } catch (e) {
        return { error: errMsg(e) };
      }
      accessToken = exchanged.accessToken;
      const next = { ...secrets, accessToken };
      const tokenExpiresAt = exchanged.expiresIn ? new Date(Date.now() + exchanged.expiresIn * 1000) : null;
      // Persist exactly like ShopifyService.refreshTokenIfNeeded.
      try {
        if (args.prisma?.integrationCredential?.upsert && integration?.id) {
          await args.prisma.integrationCredential.upsert({
            where: { integrationId: integration.id },
            update: { encryptedData: encryptJson(next) },
            create: { integrationId: integration.id, encryptedData: encryptJson(next) },
          });
        }
        if (args.prisma?.integration?.update && integration?.id) {
          await args.prisma.integration.update({
            where: { id: integration.id },
            data: { tokenExpiresAt },
          });
        }
        if (integration) {
          integration.tokenExpiresAt = tokenExpiresAt;
          if (integration.credential) integration.credential.encryptedData = encryptJson(next);
        }
      } catch {
        /* the exchanged token is still usable for this call */
      }
    }
  }
  if (!accessToken) return { error: "access_token_missing" };
  const client = new ShopifyGraphQLClient(args.store.url, accessToken, args.fetchFn);
  return { client };
}

/* ------------------------------------------------------------------ */
/* Taxonomy (collections)                                              */
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
    /* best-effort */
  }
}

const COLLECTION_CREATE = `mutation ecCollectionCreate($input: CollectionInput!) {
  collectionCreate(input: $input) {
    collection { id title }
    userErrors { field message }
  }
}`;

const COLLECTION_UPDATE = `mutation ecCollectionUpdate($input: CollectionInput!) {
  collectionUpdate(input: $input) {
    collection { id title }
    userErrors { field message }
  }
}`;

const COLLECTION_ADD_PRODUCTS = `mutation ecCollectionAddProducts($id: ID!, $productIds: [ID!]!) {
  collectionAddProducts(id: $id, productIds: $productIds) {
    collection { id }
    userErrors { field message }
  }
}`;

/** Ensure a local Category exists as a Shopify collection; returns the collection gid. Throws verbatim on userErrors. */
export async function ensureShopifyCollection(
  client: ShopifyGraphQLClient,
  prisma: any,
  organizationId: string,
  storeId: string,
  category: any,
): Promise<string> {
  const hit = await findTaxonomyMap(prisma, storeId, "category", String(category.id));
  if (hit?.externalId) return String(hit.externalId);
  const data = await client.request<any>(COLLECTION_CREATE, {
    input: { title: String(category.name), descriptionHtml: category.description ?? "" },
  });
  const payload = data?.collectionCreate;
  const ue = userErrorsOf(payload);
  if (ue) throw new Error(ue);
  const gid = payload?.collection?.id;
  if (!gid) throw new Error("shopify_collection_create_missing_id");
  await saveTaxonomyMap(prisma, organizationId, storeId, "category", String(category.id), String(gid));
  return String(gid);
}

/* ------------------------------------------------------------------ */
/* Locations                                                           */
/* ------------------------------------------------------------------ */

async function defaultLocation(prisma: any, storeId: string): Promise<{ locationId: string } | null> {
  try {
    const table = prisma.storeLocation;
    if (!table || typeof table.findFirst !== "function") return null;
    const loc = await table.findFirst({ where: { storeId, isDefault: true } });
    const external = loc?.externalLocationId ?? loc?.externalId ?? null;
    if (!loc || !external) return null;
    return { locationId: gidFor("Location", String(external)) };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* productSet                                                          */
/* ------------------------------------------------------------------ */

const PRODUCT_SET = `mutation ecProductSet($input: ProductSetInput!) {
  productSet(input: $input) {
    product {
      id title status
      variants(first: 100) { edges { node { id sku price compareAtPrice inventoryItem { id } } } }
    }
    userErrors { field message }
  }
}`;

const PRODUCT_READBACK = `query ecProductReadBack($id: ID!) {
  product(id: $id) {
    id title status tags
    variants(first: 100) { edges { node { id price sku } } }
  }
}`;

const INVENTORY_SET = `mutation ecInventorySet($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup { id }
    userErrors { field message }
  }
}`;

function shopifyStatus(publishState: string): string {
  if (publishState === "published") return "ACTIVE";
  if (publishState === "archived") return "ARCHIVED";
  return "DRAFT";
}

export async function pushProduct(args: CatalogArgs): Promise<AdapterExecuteResult> {
  const resolved = await resolveShopifyClient(args);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const client = resolved.client;
  const loaded = await loadListingForPush(args.prisma, args.organizationId, args.store?.id, args.payload?.listingId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const listing = loaded.listing;
  try {
    const { content, hash } = await loadPushContent(args.prisma, args.organizationId, listing);
    const product = await args.prisma.product.findFirst({
      where: { id: listing.productId, organizationId: args.organizationId },
    });

    const effectiveDec = minorToDecimal(BigInt(content.priceMinor));
    const compareDec = content.saleOn && content.compareAtMinor ? minorToDecimal(BigInt(content.compareAtMinor)) : undefined;

    const input: Record<string, any> = {
      title: content.name,
      descriptionHtml: content.description ?? "",
      status: shopifyStatus(content.publishState),
    };
    if (listing.externalId) input.id = gidFor("Product", String(listing.externalId));
    if (content.tagNames.length > 0) input.tags = content.tagNames;
    const metafields: any[] = [];
    if (content.seoTitle) {
      metafields.push({ namespace: "global", key: "title_tag", type: "single_line_text_field", value: content.seoTitle });
    }
    if (content.seoDescription) {
      metafields.push({ namespace: "global", key: "description_tag", type: "single_line_text_field", value: content.seoDescription });
    }
    if (metafields.length > 0) input.metafields = metafields;
    if (content.images.length > 0) {
      input.files = content.images.map((url) => ({ originalSource: url, contentType: "IMAGE" }));
    }
    if (content.variants.length > 0) {
      input.productOptions = [{ name: "Variant", values: content.variants.map((v) => ({ name: v.name })) }];
      input.variants = content.variants.map((v) => ({
        optionValues: [{ optionName: "Variant", name: v.name }],
        price: minorToDecimal(BigInt(v.priceMinor ?? content.priceMinor)),
        ...(compareDec ? { compareAtPrice: compareDec } : {}),
        ...(v.sku ? { sku: v.sku } : {}),
        ...(content.barcode ? { barcode: content.barcode } : {}),
      }));
    } else {
      input.variants = [
        {
          price: effectiveDec,
          ...(compareDec ? { compareAtPrice: compareDec } : {}),
          ...(content.sku ? { sku: content.sku } : {}),
          ...(content.barcode ? { barcode: content.barcode } : {}),
        },
      ];
    }

    const data = await client.request<any>(PRODUCT_SET, { input });
    const payload = data?.productSet;
    const ue = userErrorsOf(payload);
    if (ue) return failWith(args.prisma, listing, ue);
    const remoteProduct = payload?.product;
    if (!remoteProduct?.id) return failWith(args.prisma, listing, "shopify_product_set_missing_product");
    const remoteId = String(remoteProduct.id);

    // externalVariantMap from the productSet response (sku match, order fallback).
    const nodes: any[] = (remoteProduct.variants?.edges ?? []).map((e: any) => e?.node).filter(Boolean);
    const variantMap = readExternalVariantMap(listing.externalVariantMap);
    {
      const used = new Set<number>();
      for (const v of content.variants) {
        let idx = -1;
        if (v.sku) idx = nodes.findIndex((n: any, i: number) => !used.has(i) && n?.sku === v.sku);
        if (idx < 0) idx = nodes.findIndex((_: any, i: number) => !used.has(i));
        if (idx >= 0) {
          used.add(idx);
          const node = nodes[idx];
          const entry: { id: string; inventoryItemId?: string } = { id: String(node.id) };
          if (node.inventoryItem?.id) entry.inventoryItemId = String(node.inventoryItem.id);
          variantMap[v.id] = entry;
        }
      }
    }
    const defaultNode = nodes[0] ?? null;

    // Collections: a taxonomy failure fails the whole push, verbatim.
    if (product?.categoryId) {
      let category: any = null;
      try {
        category = await args.prisma.category.findFirst({
          where: { id: product.categoryId, organizationId: args.organizationId },
        });
      } catch {
        category = null;
      }
      if (category) {
        const collectionGid = await ensureShopifyCollection(
          client,
          args.prisma,
          args.organizationId,
          String(args.store.id),
          category,
        );
        const addData = await client.request<any>(COLLECTION_ADD_PRODUCTS, {
          id: collectionGid,
          productIds: [remoteId],
        });
        const addUe = userErrorsOf(addData?.collectionAddProducts);
        if (addUe) return failWith(args.prisma, listing, addUe, { remoteId });
      }
    }

    // Inline inventory: tracked quantities + a mapped default location.
    const summary: Record<string, any> = { remoteId };
    {
      const quantities: { inventoryItemId: string; quantity: number }[] = [];
      if (content.variants.length > 0) {
        for (const v of content.variants) {
          const invId = variantMap[v.id]?.inventoryItemId;
          if (invId && v.stockQuantity !== null && v.stockQuantity !== undefined) {
            quantities.push({ inventoryItemId: invId, quantity: v.stockQuantity });
          }
        }
      } else if (defaultNode?.inventoryItem?.id && content.stockQuantity !== null) {
        quantities.push({ inventoryItemId: String(defaultNode.inventoryItem.id), quantity: content.stockQuantity });
      }
      if (quantities.length > 0) {
        const loc = await defaultLocation(args.prisma, String(args.store.id));
        if (!loc) {
          summary.inventorySkipped = "shopify_location_not_mapped";
        } else {
          const invData = await client.request<any>(INVENTORY_SET, {
            input: {
              name: "available",
              reason: "correction",
              ignoreCompareQuantity: true,
              quantities: quantities.map((q) => ({ ...q, locationId: loc.locationId })),
            },
          });
          const invUe = userErrorsOf(invData?.inventorySetQuantities);
          if (invUe) return failWith(args.prisma, listing, invUe, { remoteId });
        }
      }
    }

    // Read-back (required).
    const rb = await client.request<any>(PRODUCT_READBACK, { id: remoteId });
    const rp = rb?.product;
    if (!rp) return failWith(args.prisma, listing, "readback_mismatch: product expected present got missing", { remoteId });
    if (String(rp.title ?? "") !== content.name) {
      return failWith(args.prisma, listing, `readback_mismatch: title expected ${content.name} got ${rp.title ?? ""}`, { remoteId });
    }
    const expectedStatus = shopifyStatus(content.publishState);
    if (String(rp.status ?? "") !== expectedStatus) {
      return failWith(args.prisma, listing, `readback_mismatch: status expected ${expectedStatus} got ${rp.status ?? ""}`, { remoteId });
    }
    const rbNodes: any[] = (rp.variants?.edges ?? []).map((e: any) => e?.node).filter(Boolean);
    const expectedVariantCount = Math.max(content.variants.length, 1);
    if (rbNodes.length !== expectedVariantCount) {
      return failWith(
        args.prisma,
        listing,
        `readback_mismatch: variant_count expected ${expectedVariantCount} got ${rbNodes.length}`,
        { remoteId },
      );
    }
    let priceNode: any = rbNodes[0] ?? null;
    if (content.variants.length > 0) {
      const first = content.variants[0];
      priceNode =
        rbNodes.find((n: any) => first.sku && n?.sku === first.sku) ?? rbNodes[0] ?? null;
      var expectedPrice = minorToDecimal(BigInt(first.priceMinor ?? content.priceMinor));
      if (priceNode && String(priceNode.price ?? "") !== expectedPrice) {
        return failWith(
          args.prisma,
          listing,
          `readback_mismatch: price expected ${expectedPrice} got ${priceNode.price ?? ""}`,
          { remoteId },
        );
      }
    } else if (priceNode && String(priceNode.price ?? "") !== effectiveDec) {
      return failWith(
        args.prisma,
        listing,
        `readback_mismatch: price expected ${effectiveDec} got ${priceNode.price ?? ""}`,
        { remoteId },
      );
    }

    await markListingSynced(args.prisma, listing, {
      lastPushedHash: hash,
      lastPushedAt: new Date(),
      externalId: remoteId,
      externalVariantMap: variantMap,
      channelStock: content.stockQuantity,
    });
    return { ok: true, responseSummary: summary };
  } catch (e) {
    return failWith(args.prisma, listing, errMsg(e));
  }
}

const PRODUCT_UPDATE = `mutation ecProductUpdate($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id status }
    userErrors { field message }
  }
}`;

export async function archiveProduct(args: CatalogArgs): Promise<AdapterExecuteResult> {
  const resolved = await resolveShopifyClient(args);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const client = resolved.client;
  const loaded = await loadListingForPush(args.prisma, args.organizationId, args.store?.id, args.payload?.listingId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const listing = loaded.listing;
  if (!listing.externalId) return failWith(args.prisma, listing, "listing_external_id_missing");
  const remoteId = gidFor("Product", String(listing.externalId));
  try {
    const data = await client.request<any>(PRODUCT_UPDATE, {
      input: { id: remoteId, status: "ARCHIVED" },
    });
    const ue = userErrorsOf(data?.productUpdate);
    if (ue) return failWith(args.prisma, listing, ue, { remoteId });
    const rb = await client.request<any>(PRODUCT_READBACK, { id: remoteId });
    const status = rb?.product?.status;
    if (String(status ?? "") !== "ARCHIVED") {
      return failWith(
        args.prisma,
        listing,
        `readback_mismatch: status expected ARCHIVED got ${status ?? ""}`,
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

const PRODUCT_DELETE = `mutation ecProductDelete($input: ProductDeleteInput!) {
  productDelete(input: $input) {
    deletedProductId
    userErrors { field message }
  }
}`;

export async function deleteProductRemote(args: CatalogArgs): Promise<AdapterExecuteResult> {
  const resolved = await resolveShopifyClient(args);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const client = resolved.client;
  const loaded = await loadListingForPush(args.prisma, args.organizationId, args.store?.id, args.payload?.listingId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const listing = loaded.listing;
  if (!listing.externalId) return failWith(args.prisma, listing, "listing_external_id_missing");
  const remoteId = gidFor("Product", String(listing.externalId));
  try {
    const data = await client.request<any>(PRODUCT_DELETE, { input: { id: remoteId } });
    const ue = userErrorsOf(data?.productDelete);
    if (ue) return failWith(args.prisma, listing, ue, { remoteId });
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

const INVENTORY_ITEM_READBACK = `query ecInventoryItemReadBack($id: ID!, $locationId: ID!) {
  inventoryItem(id: $id) {
    inventoryLevel(locationId: $locationId) {
      quantities(names: ["available"]) { name quantity }
    }
  }
}`;

export async function pushInventory(args: CatalogArgs): Promise<AdapterExecuteResult> {
  const resolved = await resolveShopifyClient(args);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const client = resolved.client;
  const loaded = await loadListingForPush(args.prisma, args.organizationId, args.store?.id, args.payload?.listingId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const listing = loaded.listing;
  const quantity = Number(args.payload?.quantity);
  if (!Number.isFinite(quantity)) return failWith(args.prisma, listing, "quantity_missing");
  const variantId = (args.payload?.variantId as string | null) ?? null;
  try {
    const map = readExternalVariantMap(listing.externalVariantMap);
    let entry: { id: string; inventoryItemId?: string } | undefined;
    if (variantId) {
      entry = map[String(variantId)];
    } else {
      const entries = Object.values(map);
      if (entries.length === 1) {
        entry = entries[0];
      } else if (entries.length === 0) {
        entry = undefined;
      } else {
        // Multiple mapped variants and no variant chosen: only the
        // product-level case (no local variants) may fall back.
        let localVariantCount = -1;
        try {
          const rows = await args.prisma.productVariant.findMany({
            where: { productId: listing.productId },
          });
          localVariantCount = (rows ?? []).length;
        } catch {
          localVariantCount = -1;
        }
        entry = localVariantCount === 0 ? entries[0] : undefined;
      }
    }
    if (!entry?.inventoryItemId) return failWith(args.prisma, listing, "shopify_variant_not_mapped");
    const inventoryItemId = entry.inventoryItemId;

    const loc = await defaultLocation(args.prisma, String(args.store.id));
    if (!loc) return failWith(args.prisma, listing, "shopify_location_not_mapped");

    const invData = await client.request<any>(INVENTORY_SET, {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: true,
        quantities: [{ inventoryItemId, locationId: loc.locationId, quantity }],
      },
    });
    const ue = userErrorsOf(invData?.inventorySetQuantities);
    if (ue) return failWith(args.prisma, listing, ue);

    const rb = await client.request<any>(INVENTORY_ITEM_READBACK, {
      id: inventoryItemId,
      locationId: loc.locationId,
    });
    const quantities: any[] = rb?.inventoryItem?.inventoryLevel?.quantities ?? [];
    const available = quantities.find((q: any) => q?.name === "available") ?? quantities[0];
    if (!available || Number(available.quantity) !== quantity) {
      return failWith(
        args.prisma,
        listing,
        `readback_mismatch: quantity expected ${quantity} got ${available?.quantity ?? ""}`,
      );
    }
    await markListingSynced(args.prisma, listing, {
      channelStock: quantity,
      lastPushedAt: new Date(),
      ...(listing.externalId ? { externalId: String(listing.externalId) } : {}),
    });
    return { ok: true, responseSummary: { remoteId: listing.externalId ? String(listing.externalId) : undefined } };
  } catch (e) {
    return failWith(args.prisma, listing, errMsg(e));
  }
}

export async function pushCategory(args: CatalogArgs): Promise<AdapterExecuteResult> {
  const resolved = await resolveShopifyClient(args);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const client = resolved.client;
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
      const data = await client.request<any>(COLLECTION_UPDATE, {
        input: {
          id: remoteId,
          title: String(category.name),
          descriptionHtml: category.description ?? "",
        },
      });
      const ue = userErrorsOf(data?.collectionUpdate);
      if (ue) return { ok: false, error: ue };
      return { ok: true, responseSummary: { remoteId } };
    }
    const remoteId = await ensureShopifyCollection(client, args.prisma, args.organizationId, storeId, category);
    return { ok: true, responseSummary: { remoteId } };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export type { PushContent };
