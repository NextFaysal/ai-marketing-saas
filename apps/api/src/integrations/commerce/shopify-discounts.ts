import { minorToDecimal } from "./catalog-content";
import { resolveShopifyClient } from "./shopify-catalog";
import { errMsg, loadDiscount, loadDiscountSync, markDiscountSync } from "./discount-content";
import type { AdapterExecuteResult } from "./adapter";
import type { CatalogArgs } from "./shopify-catalog";

export type DiscountArgs = CatalogArgs;

/**
 * EC7 — Shopify discount write-back via discountCodeBasicCreate /
 * discountCodeBasicUpdate (GraphQL Admin API), verified by a
 * discountNode read-back. Basic code discounts cannot express
 * free shipping — that kind fails honestly instead of being
 * pushed as something it is not.
 */

const DISCOUNT_CREATE = `mutation ecDiscountCreate($codeDiscount: DiscountCodeBasicInput!) { discountCodeBasicCreate(codeDiscount: $codeDiscount) { codeDiscountNode { id } userErrors { field message } } }`;
const DISCOUNT_UPDATE = `mutation ecDiscountUpdate($id: ID!, $codeDiscount: DiscountCodeBasicInput!) { discountCodeBasicUpdate(id: $id, codeDiscount: $codeDiscount) { codeDiscountNode { id } userErrors { field message } } }`;
const DISCOUNT_READ = `query ecDiscountRead($id: ID!) { discountNode(id: $id) { id discount { __typename ... on DiscountCodeBasic { title codes(first: 1) { edges { node { code } } } } } } }`;

function gidFor(kind: string, id: string): string {
  const s = String(id);
  return s.startsWith("gid://") ? s : `gid://shopify/${kind}/${s}`;
}

function userErrorsOf(payload: any): string | null {
  const errs = payload?.userErrors;
  if (Array.isArray(errs) && errs.length > 0) {
    return errs.map((e: any) => e?.message ?? String(e)).join("; ");
  }
  return null;
}

export async function pushDiscount(args: DiscountArgs): Promise<AdapterExecuteResult> {
  const prisma = args.prisma;
  const storeId = String(args.store?.id ?? "");
  const discountId = args.payload?.discountId as string | undefined;

  const resolved = await resolveShopifyClient(args);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const client = resolved.client;

  if (!discountId) return { ok: false, error: "discount_not_found" };
  const discount = await loadDiscount(prisma, args.organizationId, discountId);
  if (!discount) return { ok: false, error: "discount_not_found" };

  const fail = async (error: string, responseSummary?: any): Promise<AdapterExecuteResult> => {
    await markDiscountSync(prisma, {
      organizationId: args.organizationId, discountId: discount.id, storeId, syncStatus: "failed", lastError: error,
    });
    return { ok: false, error, ...(responseSummary !== undefined ? { responseSummary } : {}) };
  };

  if (discount.kind === "free_shipping") {
    return await fail("shopify_free_shipping_basic_unsupported");
  }
  if (discount.kind !== "percent" && discount.kind !== "fixed") {
    return await fail(`invalid_kind: ${discount.kind}`);
  }

  try {
    const sync = await loadDiscountSync(prisma, discount.id, storeId);

    // ---- scope resolution (local id -> platform gid) ----
    const scopeIds: string[] = Array.isArray(discount.scopeIds) ? discount.scopeIds.map((x: any) => String(x)) : [];
    const unmapped: string[] = [];
    const productGids: string[] = [];
    const collectionGids: string[] = [];
    if (discount.scopeType === "products") {
      for (const localId of scopeIds) {
        let listing: any = null;
        try {
          listing = await prisma.storeListing.findFirst({ where: { storeId, productId: localId } });
        } catch { listing = null; }
        const ext = listing?.externalId;
        if (ext === undefined || ext === null || ext === "") unmapped.push(localId);
        else productGids.push(gidFor("Product", String(ext)));
      }
    } else if (discount.scopeType === "categories") {
      for (const localId of scopeIds) {
        let map: any = null;
        try {
          map = await prisma.storeTaxonomyMap.findFirst({ where: { storeId, kind: "category", localId } });
        } catch { map = null; }
        const ext = map?.externalId;
        if (ext === undefined || ext === null || ext === "") unmapped.push(localId);
        else collectionGids.push(gidFor("Collection", String(ext)));
      }
    }
    if (
      discount.scopeType !== "all" &&
      productGids.length === 0 &&
      collectionGids.length === 0
    ) {
      return await fail("discount_scope_unmapped", { unmappedScope: unmapped });
    }

    const items =
      discount.scopeType === "all"
        ? { all: true }
        : discount.scopeType === "products"
          ? { products: { productsToAdd: productGids } }
          : { collections: { collectionsToAdd: collectionGids } };

    const input: Record<string, any> = {
      title: discount.code,
      code: discount.code,
      startsAt: discount.startsAt ? new Date(discount.startsAt).toISOString() : undefined,
      endsAt: discount.endsAt ? new Date(discount.endsAt).toISOString() : undefined,
      customerSelection: { all: true },
      customerGets: {
        value:
          discount.kind === "percent"
            ? { percentage: Number(discount.value) / 100 }
            : { discountAmount: { amount: minorToDecimal(String(discount.value)), appliesOnEachItem: false } },
        items,
      },
      usageLimit: discount.usageLimit ?? undefined,
      appliesOncePerCustomer: false,
      minimumRequirement:
        discount.minOrderMinor != null
          ? { subtotal: { greaterThanOrEqualToSubtotal: minorToDecimal(String(discount.minOrderMinor)) } }
          : undefined,
    };

    let externalId: string;
    if (sync?.externalId) {
      externalId = String(sync.externalId);
      const data = await client.request<any>(DISCOUNT_UPDATE, { id: externalId, codeDiscount: input });
      const ue = userErrorsOf(data?.discountCodeBasicUpdate);
      if (ue) return await fail(ue);
    } else {
      const data = await client.request<any>(DISCOUNT_CREATE, { codeDiscount: input });
      const payload = data?.discountCodeBasicCreate;
      const ue = userErrorsOf(payload);
      if (ue) return await fail(ue);
      const id = payload?.codeDiscountNode?.id;
      if (!id) return await fail("shopify_discount_create_missing_id");
      externalId = String(id);
    }

    // ---- read-back verification ----
    const rb = await client.request<any>(DISCOUNT_READ, { id: externalId });
    const remoteCode = rb?.discountNode?.discount?.codes?.edges?.[0]?.node?.code;
    if (String(remoteCode ?? "").toUpperCase() !== String(discount.code ?? "").toUpperCase()) {
      return await fail(`readback_mismatch: code expected ${discount.code} got ${remoteCode ?? ""}`);
    }

    await markDiscountSync(prisma, {
      organizationId: args.organizationId, discountId: discount.id, storeId,
      externalId, syncStatus: "synced", lastError: null,
    });
    return { ok: true, responseSummary: { platform: "shopify", externalId, unmappedScope: unmapped } };
  } catch (e) {
    return await fail(errMsg(e));
  }
}
