import { planBackfill } from "./backfill-plan";

describe("planBackfill", () => {
  const stores = [
    { id: "s-woo-1", organizationId: "org-1", platform: "WOOCOMMERCE" },
    { id: "s-shop-1", organizationId: "org-1", platform: "SHOPIFY" },
    { id: "s-woo-2", organizationId: "org-2", platform: "WOOCOMMERCE" },
    { id: "s-woo-3", organizationId: "org-2", platform: "WOOCOMMERCE" },
  ];
  it("creates when exactly one matching store", () => {
    const plan = planBackfill(stores, [{ id: "p1", organizationId: "org-1", source: "woocommerce", externalId: "42" }]);
    expect(plan.creates).toEqual([{ action: "create", storeId: "s-woo-1", productId: "p1", externalId: "42" }]);
    expect(plan.skips).toEqual({ no_store: 0, ambiguous_stores: 0, not_synced: 0 });
  });
  it("skips no_store when no candidate", () => {
    const plan = planBackfill(stores, [{ id: "p1", organizationId: "org-9", source: "shopify", externalId: "42" }]);
    expect(plan.skips.no_store).toBe(1);
    expect(plan.decisions[0]).toMatchObject({ action: "skip", reason: "no_store" });
  });
  it("skips ambiguous_stores when >1 candidate", () => {
    const plan = planBackfill(stores, [{ id: "p1", organizationId: "org-2", source: "woocommerce", externalId: "42" }]);
    expect(plan.skips.ambiguous_stores).toBe(1);
  });
  it("skips not_synced without externalId/source", () => {
    const plan = planBackfill(stores, [
      { id: "p1", organizationId: "org-1", source: "manual", externalId: "42" },
      { id: "p2", organizationId: "org-1", source: "woocommerce", externalId: null },
      { id: "p3", organizationId: "org-1", source: null, externalId: null },
    ]);
    expect(plan.skips.not_synced).toBe(3);
    expect(plan.creates).toHaveLength(0);
  });
});
