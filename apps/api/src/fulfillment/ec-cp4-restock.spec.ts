import { ReturnsService } from "./returns.service";
import { encryptJson } from "../integrations/crypto";

/**
 * CP4: Shopify partial restock on return completion.
 * Fixture-proven only (stubbed GraphQL transport) — LIVE-PENDING.
 */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if (!matchWhere(row, v)) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)),
    create: async ({ data }: any) => { const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
  };
}

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function setup(opts: { platform?: string; adjustMode?: "ok" | "throw" | "userErrors" } = {}) {
  const platform = opts.platform ?? "SHOPIFY";
  const prisma: any = {
    order: makeTable(), customer: makeTable(), returnRequest: makeTable(),
    store: makeTable(), storeListing: makeTable(), storeLocation: makeTable(),
    integration: makeTable(), integrationCredential: makeTable(),
    businessProfile: makeTable(), organization: makeTable(),
  };
  const customer: any = { id: "c1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: "01700000000", email: "rahim@example.com" };
  prisma.customer.rows.push(customer);
  const items = [
    { id: "oi1", orderId: "o1", productId: "p1", externalVariationId: "gid://shopify/ProductVariant/8001", name: "Shirt", sku: "SH-1", quantity: 5, priceMinor: 10000n, totalMinor: 50000n },
    { id: "oi2", orderId: "o1", productId: "p2", externalVariationId: null, name: "Cap", sku: "CP-1", quantity: 2, priceMinor: 5000n, totalMinor: 10000n },
  ];
  prisma.order.rows.push({
    id: "o1", organizationId: "org-1", customerId: "c1", externalNumber: "1001",
    source: platform === "SHOPIFY" ? "shopify" : "woocommerce", storeId: "st1", status: "completed",
    isCod: true, isPractice: false, conversationId: null,
    address: "House 1, Dhaka", totalMinor: 60000n, refundedMinor: 0n, items, customer,
  });
  prisma.store.rows.push({ id: "st1", organizationId: "org-1", platform, url: "https://shop.myshopify.com", name: "Shop" });
  // Only p1 has a listing; p2 is the no_listing line.
  prisma.storeListing.rows.push({
    id: "l1", organizationId: "org-1", storeId: "st1", productId: "p1",
    externalId: "gid://shopify/Product/7001",
    externalVariantMap: { v1: { id: "gid://shopify/ProductVariant/8001", inventoryItemId: "gid://shopify/InventoryItem/9001" } },
  });
  prisma.storeLocation.rows.push({ id: "loc1", organizationId: "org-1", storeId: "st1", externalLocationId: "12345", isDefault: true });
  prisma.integration.rows.push({
    id: "int1", organizationId: "org-1", storeId: "st1", provider: "shopify",
    credential: { encryptedData: encryptJson({ accessToken: "shpat_test", apiSecret: "shpss_x" }) },
    store: { url: "https://shop.myshopify.com" },
  });

  const adjustCalls: any[] = [];
  globalThis.fetch = (async (_url: string, init: any = {}) => {
    const parsed = JSON.parse(init.body);
    if (String(parsed.query).includes("inventoryAdjustQuantities")) {
      adjustCalls.push(parsed.variables.input);
      if (opts.adjustMode === "throw") throw new Error("shopify transport boom");
      const payload = opts.adjustMode === "userErrors"
        ? { inventoryAdjustQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ field: ["input"], message: "Inventory level not found" }] } }
        : { inventoryAdjustQuantities: { inventoryAdjustmentGroup: { id: "gid://shopify/InventoryAdjustmentGroup/1" }, userErrors: [] } };
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: payload }), json: async () => ({ data: payload }) };
    }
    throw new Error(`unexpected graphql: ${String(parsed.query).slice(0, 60)}`);
  }) as any;

  const audit: any = { log: async () => undefined };
  const invCalls: any[] = [];
  const inventory: any = { adjust: async (...a: any[]) => { invCalls.push(a); return { stockQuantity: 10 }; } };
  const orders: any = { updateOrder: async () => ({}), createManual: async () => ({ id: "o-x" }) };
  const email: any = { send: async () => ({ providerMessageId: "e1" }) };
  const returns = new ReturnsService(prisma, audit, undefined, inventory, orders, undefined, email);
  return { prisma, returns, adjustCalls, invCalls };
}

async function completeRestockReturn(s: ReturnType<typeof setup>) {
  const link = await s.returns.createLink("org-1", "u1", "o1");
  await s.returns.publicSubmit(link.token, {
    reason: "সাইজ মিলছে না",
    items: [{ orderItemId: "oi1", quantity: 2 }, { orderItemId: "oi2", quantity: 1 }],
  });
  await s.returns.decide("org-1", "u1", link.id, { decision: "approve", resolution: "store_credit_note" });
  await s.returns.markReceived("org-1", "u1", link.id, {
    items: [
      { orderItemId: "oi1", condition: "ভালো", restock: true },
      { orderItemId: "oi2", condition: "ভালো", restock: true },
    ],
  });
  return s.returns.complete("org-1", "u1", link.id);
}

describe("CP4 Shopify partial restock", () => {
  it("adjusts ONLY the restocked qty per line; the no-listing line is skipped with reason", async () => {
    const s = setup();
    const done = await completeRestockReturn(s);
    expect(done.status).toBe("completed");
    // Local S1 restock still happened for both lines.
    expect(s.invCalls).toHaveLength(2);
    // Exactly one Shopify adjust: p1's partial qty (2 of 5 ordered).
    expect(s.adjustCalls).toHaveLength(1);
    expect(s.adjustCalls[0]).toEqual({
      name: "available",
      reason: "received",
      changes: [{
        inventoryItemId: "gid://shopify/InventoryItem/9001",
        locationId: "gid://shopify/Location/12345",
        delta: 2,
      }],
    });
    const rr = s.prisma.returnRequest.rows[0];
    expect(rr.shopifyRestock).toEqual({
      attempted: true,
      succeeded: false, // p2 could not be adjusted — not "all adjusted"
      qty: 2,
      lines: [
        { productId: "p1", qty: 2, ok: true },
        { productId: "p2", qty: 1, ok: false, reason: "no_listing" },
      ],
    });
  });

  it("a Shopify transport failure is recorded and the completion still succeeds", async () => {
    const s = setup({ adjustMode: "throw" });
    const done = await completeRestockReturn(s);
    expect(done.status).toBe("completed");
    const rr = s.prisma.returnRequest.rows[0];
    expect(rr.shopifyRestock.attempted).toBe(true);
    expect(rr.shopifyRestock.succeeded).toBe(false);
    expect(rr.shopifyRestock.qty).toBe(0);
    expect(rr.shopifyRestock.lines[0]).toMatchObject({ productId: "p1", ok: false });
    expect(rr.shopifyRestock.lines[0].reason).toContain("boom");
  });

  it("Shopify userErrors are recorded per line, not thrown", async () => {
    const s = setup({ adjustMode: "userErrors" });
    const done = await completeRestockReturn(s);
    expect(done.status).toBe("completed");
    const rr = s.prisma.returnRequest.rows[0];
    expect(rr.shopifyRestock.lines[0]).toEqual({
      productId: "p1", qty: 2, ok: false, reason: "Inventory level not found",
    });
  });

  it("a WooCommerce order leaves shopifyRestock null and makes no Shopify call", async () => {
    const s = setup({ platform: "WOOCOMMERCE" });
    const done = await completeRestockReturn(s);
    expect(done.status).toBe("completed");
    const rr = s.prisma.returnRequest.rows[0];
    expect(rr.shopifyRestock ?? null).toBeNull();
    expect(s.adjustCalls).toHaveLength(0);
  });
});
