export interface BackfillStore { id: string; organizationId: string; platform: string }
export interface BackfillProduct { id: string; organizationId: string; source?: string | null; externalId?: string | null }

export type BackfillDecision =
  | { action: "create"; storeId: string; productId: string; externalId: string }
  | { action: "skip"; reason: "no_store" | "ambiguous_stores" | "not_synced"; productId: string };

export function planBackfill(stores: BackfillStore[], products: BackfillProduct[]): {
  creates: Extract<BackfillDecision, { action: "create" }>[];
  skips: { no_store: number; ambiguous_stores: number; not_synced: number };
  decisions: BackfillDecision[];
} {
  const creates: Extract<BackfillDecision, { action: "create" }>[] = [];
  const skips = { no_store: 0, ambiguous_stores: 0, not_synced: 0 };
  const decisions: BackfillDecision[] = [];

  for (const product of products) {
    const source = product.source ?? null;
    if ((source !== "woocommerce" && source !== "shopify") || !product.externalId) {
      skips.not_synced++;
      decisions.push({ action: "skip", reason: "not_synced", productId: product.id });
      continue;
    }
    const platform = source === "woocommerce" ? "WOOCOMMERCE" : "SHOPIFY";
    const candidates = stores.filter((s) => s.organizationId === product.organizationId && s.platform === platform);
    if (candidates.length === 1) {
      const d: Extract<BackfillDecision, { action: "create" }> = { action: "create", storeId: candidates[0].id, productId: product.id, externalId: product.externalId };
      creates.push(d);
      decisions.push(d);
    } else if (candidates.length === 0) {
      skips.no_store++;
      decisions.push({ action: "skip", reason: "no_store", productId: product.id });
    } else {
      skips.ambiguous_stores++;
      decisions.push({ action: "skip", reason: "ambiguous_stores", productId: product.id });
    }
  }
  return { creates, skips, decisions };
}
