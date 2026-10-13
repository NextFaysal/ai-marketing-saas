import { decryptJson } from "../crypto";
import { WooClient } from "../woocommerce/woo.client";
import { minorToDecimal } from "./catalog-content";
import { errMsg, loadDiscount, loadDiscountSync, markDiscountSync } from "./discount-content";
import type { AdapterExecuteResult } from "./adapter";

/**
 * EC7 — WooCommerce coupon write-back (POST/PUT /coupons) with
 * read-back verification. Scope ids are LOCAL ids; they are
 * resolved to Woo ids through StoreListing (products) and
 * StoreTaxonomyMap (categories). Unmapped ids are reported, never
 * silently dropped; a non-"all" scope that resolves to nothing is
 * an honest failure (discount_scope_unmapped).
 */
export interface DiscountArgs {
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

function buildClient(args: DiscountArgs): { client: WooClient } | { error: string } {
  const encrypted = getEncrypted(args.integration);
  if (!encrypted) return { error: "woo_credentials_missing" };
  let secrets: any;
  try {
    secrets = decryptJson<any>(encrypted);
  } catch {
    return { error: "woo_credentials_missing" };
  }
  if (!secrets?.consumerKey || !secrets?.consumerSecret) return { error: "woo_credentials_missing" };
  return {
    client: new WooClient(
      args.store.url,
      { consumerKey: secrets.consumerKey, consumerSecret: secrets.consumerSecret },
      args.fetchFn,
    ),
  };
}

function expectedWooType(discount: any): string {
  if (discount.kind === "percent" || discount.kind === "free_shipping") return "percent";
  return "fixed_cart";
}

export async function pushDiscount(args: DiscountArgs): Promise<AdapterExecuteResult> {
  const prisma = args.prisma;
  const storeId = String(args.store?.id ?? "");
  const discountId = args.payload?.discountId as string | undefined;

  const built = buildClient(args);
  if ("error" in built) {
    if (discountId) {
      await markDiscountSync(prisma, {
        organizationId: args.organizationId, discountId, storeId, syncStatus: "failed", lastError: built.error,
      });
    }
    return { ok: false, error: built.error };
  }
  const client = built.client;

  if (!discountId) return { ok: false, error: "discount_not_found" };
  const discount = await loadDiscount(prisma, args.organizationId, discountId);
  if (!discount) return { ok: false, error: "discount_not_found" };

  const fail = async (error: string, responseSummary?: any): Promise<AdapterExecuteResult> => {
    await markDiscountSync(prisma, {
      organizationId: args.organizationId, discountId: discount.id, storeId, syncStatus: "failed", lastError: error,
    });
    return { ok: false, error, ...(responseSummary !== undefined ? { responseSummary } : {}) };
  };

  try {
    // ---- scope resolution (local id -> Woo numeric id) ----
    const scopeIds: string[] = Array.isArray(discount.scopeIds) ? discount.scopeIds.map((x: any) => String(x)) : [];
    const unmapped: string[] = [];
    const resolvedProducts: number[] = [];
    const resolvedCategories: number[] = [];
    if (discount.scopeType === "products") {
      for (const localId of scopeIds) {
        let listing: any = null;
        try {
          listing = await prisma.storeListing.findFirst({ where: { storeId, productId: localId } });
        } catch { listing = null; }
        const ext = listing?.externalId;
        if (ext === undefined || ext === null || ext === "") unmapped.push(localId);
        else resolvedProducts.push(Number(ext));
      }
    } else if (discount.scopeType === "categories") {
      for (const localId of scopeIds) {
        let map: any = null;
        try {
          map = await prisma.storeTaxonomyMap.findFirst({ where: { storeId, kind: "category", localId } });
        } catch { map = null; }
        const ext = map?.externalId;
        if (ext === undefined || ext === null || ext === "") unmapped.push(localId);
        else resolvedCategories.push(Number(ext));
      }
    }
    if (discount.scopeType !== "all" && resolvedProducts.length === 0 && resolvedCategories.length === 0) {
      return await fail("discount_scope_unmapped", { unmappedScope: unmapped });
    }

    const sync = await loadDiscountSync(prisma, discount.id, storeId);
    const body: Record<string, any> = {
      code: discount.code,
      discount_type: expectedWooType(discount),
      amount:
        discount.kind === "percent" ? String(discount.value)
        : discount.kind === "fixed" ? minorToDecimal(String(discount.value))
        : "0",
      free_shipping: discount.kind === "free_shipping",
      minimum_amount: discount.minOrderMinor != null ? minorToDecimal(String(discount.minOrderMinor)) : undefined,
      date_expires: discount.endsAt ? new Date(discount.endsAt).toISOString() : undefined,
      usage_limit: discount.usageLimit ?? undefined,
      product_ids: resolvedProducts,
      product_categories: resolvedCategories,
    };

    const saved = sync?.externalId
      ? (await client.put<any>(`/coupons/${sync.externalId}`, body)).data
      : (await client.post<any>("/coupons", body)).data;
    const externalId = saved?.id === undefined || saved?.id === null ? "" : String(saved.id);
    if (!externalId) return await fail("woo_coupon_save_missing_id");

    // ---- read-back verification ----
    const remote = (await client.get<any>(`/coupons/${externalId}`)).data;
    if (String(remote?.code ?? "").toUpperCase() !== String(discount.code ?? "").toUpperCase()) {
      return await fail(`readback_mismatch: code expected ${discount.code} got ${remote?.code ?? ""}`);
    }
    const expectedType = expectedWooType(discount);
    if (String(remote?.discount_type ?? "") !== expectedType) {
      return await fail(`readback_mismatch: discount_type expected ${expectedType} got ${remote?.discount_type ?? ""}`);
    }

    await markDiscountSync(prisma, {
      organizationId: args.organizationId, discountId: discount.id, storeId,
      externalId, syncStatus: "synced", lastError: null,
    });
    return { ok: true, responseSummary: { platform: "woocommerce", externalId, unmappedScope: unmapped } };
  } catch (e) {
    return await fail(errMsg(e));
  }
}
