import { encryptJson } from "../crypto";
import * as wooOrders from "./woo-orders";
import * as shopifyOrders from "./shopify-orders";

/* Fake prisma (B1/B2 in-memory style) */
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
    create: async ({ data }: any) => { const row = { id: data.id ?? `row-${++seq}`, ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
  };
}
function fakePrisma() {
  return { order: makeTable(), orderItem: makeTable(), customer: makeTable(), storeLocation: makeTable() } as any;
}

const WOO_STORE = { id: "st-woo", organizationId: "org-1", platform: "WOOCOMMERCE", url: "https://shop.example.com", syncMode: "co-manage", courierTrackingMetaKey: null as string | null };
const WOO_INTEGRATION = { id: "int-woo", credential: { encryptedData: encryptJson({ consumerKey: "ck", consumerSecret: "cs" }) } };

function wooArgs(prisma: any, payload: any, fetchFn: any, store: any = WOO_STORE) {
  return { prisma, organizationId: "org-1", store, integration: WOO_INTEGRATION, payload, fetchFn };
}

/** Stubbed Woo REST server for orders. */
function stubWoo() {
  const calls: { method: string; path: string; body: any }[] = [];
  const order: any = {
    id: 77, status: "processing", number: "77",
    shipping: { address_1: "Old address" }, billing: {},
    line_items: [{ id: 5, product_id: 11, quantity: 2, total: "200.00" }],
    meta_data: [] as any[],
  };
  const notes: any[] = [];
  const refunds: any[] = [];
  const state = { lieAboutStatus: false };
  const respond = (data: any) => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(data), json: async () => data });
  const fn = async (url: string, init: any = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const path = new URL(url).pathname.replace(/^.*\/wp-json\/wc\/v3/, "");
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    if (path === "/orders" && method === "POST") {
      const created = { id: 88, number: "88", status: body.status, line_items: body.line_items };
      (stubWoo as any).createdDraft = created;
      return respond(created);
    }
    if (path === "/orders/88" && method === "GET") return respond({ id: 88, status: "pending" });
    if (path === "/orders/77" && method === "PUT") {
      if (body.status) order.status = state.lieAboutStatus ? "processing" : body.status;
      if (body.meta_data) order.meta_data = body.meta_data;
      if (body.shipping) order.shipping = { ...order.shipping, ...body.shipping };
      return respond(order);
    }
    if (path === "/orders/77" && method === "GET") return respond(order);
    if (path === "/orders/77/notes" && method === "POST") { notes.push({ id: notes.length + 1, note: body.note }); return respond(notes[notes.length - 1]); }
    if (path === "/orders/77/notes" && method === "GET") return respond(notes);
    if (path === "/orders/77/refunds" && method === "POST") { const r = { id: 900, amount: body.amount, line_items: body.line_items ?? [] }; refunds.push(r); return respond(r); }
    if (path === "/orders/77/refunds" && method === "GET") return respond(refunds);
    throw new Error(`stub woo: unhandled ${method} ${path}`);
  };
  return { fn, calls, order, notes, refunds, state };
}

function seedWooOrder(prisma: any) {
  prisma.order.rows.push({ id: "o1", organizationId: "org-1", storeId: "st-woo", source: "woocommerce", externalId: "77", status: "processing", totalMinor: 20000n, refundedMinor: 0n });
  prisma.orderItem.rows.push({ id: "oi1", orderId: "o1", productId: "p1", externalProductId: "11", quantity: 2, priceMinor: 10000n, totalMinor: 20000n, name: "Shirt" });
}

describe("EC5 Woo order adapter", () => {
  it("pushes status and verifies by read-back", async () => {
    const prisma = fakePrisma(); seedWooOrder(prisma);
    const stub = stubWoo();
    const res = await wooOrders.pushOrderStatus(wooArgs(prisma, { orderId: "o1", status: "completed" }, stub.fn));
    expect(res.ok).toBe(true);
    expect(stub.calls.some((c) => c.method === "PUT" && c.body.status === "completed")).toBe(true);
    expect(prisma.order.rows[0].storeSyncStatus).toBe("synced");
  });

  it("records a read-back mismatch as a verbatim failure", async () => {
    const prisma = fakePrisma(); seedWooOrder(prisma);
    const stub = stubWoo(); stub.state.lieAboutStatus = true;
    const res = await wooOrders.pushOrderStatus(wooArgs(prisma, { orderId: "o1", status: "completed" }, stub.fn));
    expect(res.ok).toBe(false);
    expect(res.error).toContain("readback_mismatch: status expected completed got processing");
    expect(prisma.order.rows[0].storeSyncStatus).toBe("failed");
    expect(prisma.order.rows[0].storeSyncError).toContain("readback_mismatch");
  });

  it("fulfilment = customer note + tracking meta (+ configured plugin key), verified by note read-back", async () => {
    const prisma = fakePrisma(); seedWooOrder(prisma);
    const stub = stubWoo();
    const store = { ...WOO_STORE, courierTrackingMetaKey: "ast_tracking_number" };
    const res = await wooOrders.createFulfillment(wooArgs(prisma, { orderId: "o1", trackingCode: "SF123", courierProvider: "steadfast" }, stub.fn, store));
    expect(res.ok).toBe(true);
    expect(stub.notes[0].note).toContain("SF123");
    const metaPut = stub.calls.find((c) => c.method === "PUT" && c.body.meta_data);
    const keys = metaPut!.body.meta_data.map((m: any) => m.key);
    expect(keys).toEqual(expect.arrayContaining(["tracking_provider", "tracking_number", "ast_tracking_number"]));
  });

  it("refund with restock uses Woo line_items shape when the amount matches the lines", async () => {
    const prisma = fakePrisma(); seedWooOrder(prisma);
    const stub = stubWoo();
    const res = await wooOrders.pushRefund(wooArgs(prisma, { orderId: "o1", amountMinor: "20000", reason: "damaged", restock: true }, stub.fn));
    expect(res.ok).toBe(true);
    expect((res as any).responseSummary.restockApplied).toBe(true);
    const post = stub.calls.find((c) => c.path === "/orders/77/refunds" && c.method === "POST");
    expect(post!.body.line_items[0]).toMatchObject({ id: 5, quantity: 2, restock: true });
    expect(post!.body.amount).toBe("200.00");
  });

  it("creates a draft (pending) order and links the local order to it", async () => {
    const prisma = fakePrisma();
    prisma.order.rows.push({ id: "o2", organizationId: "org-1", storeId: null, source: "manual", externalId: "manual-1", status: "processing", currency: "BDT", address: "House 1, Dhaka" });
    prisma.orderItem.rows.push({ id: "oi9", orderId: "o2", externalProductId: "11", quantity: 1, priceMinor: 5000n, totalMinor: 5000n, name: "Shirt" });
    const stub = stubWoo();
    const res = await wooOrders.createDraftOrder(wooArgs(prisma, { orderId: "o2" }, stub.fn));
    expect(res.ok).toBe(true);
    const row = prisma.order.rows[0];
    expect(row.externalId).toBe("88");
    expect(row.source).toBe("woocommerce");
    expect(row.storeId).toBe("st-woo");
  });

  it("refuses a draft when an item is not in the store", async () => {
    const prisma = fakePrisma();
    prisma.order.rows.push({ id: "o3", organizationId: "org-1", storeId: null, source: "chat", externalId: "chat-1", status: "processing", currency: "BDT" });
    prisma.orderItem.rows.push({ id: "oi10", orderId: "o3", externalProductId: null, quantity: 1, priceMinor: 100n, totalMinor: 100n, name: "Mystery" });
    const stub = stubWoo();
    const res = await wooOrders.createDraftOrder(wooArgs(prisma, { orderId: "o3" }, stub.fn));
    expect(res.ok).toBe(false);
    expect(res.error).toContain("woo_draft_item_not_in_store: Mystery");
  });

  it("pushes the free-string address as shipping.address_1 and verifies", async () => {
    const prisma = fakePrisma(); seedWooOrder(prisma);
    const stub = stubWoo();
    const res = await wooOrders.pushOrderAddress(wooArgs(prisma, { orderId: "o1", address: "New Road, Khulna" }, stub.fn));
    expect(res.ok).toBe(true);
    expect(stub.order.shipping.address_1).toBe("New Road, Khulna");
  });
});

/* ---------------- Shopify ---------------- */

const SHOP_STORE = { id: "st-shop", organizationId: "org-1", platform: "SHOPIFY", url: "https://demo.myshopify.com", syncMode: "full-manage" };
const SHOP_INTEGRATION = { id: "int-shop", credential: { encryptedData: encryptJson({ accessToken: "shpat_test", apiSecret: "sec" }) } };

function shopArgs(prisma: any, payload: any, fetchFn: any) {
  return { prisma, organizationId: "org-1", store: SHOP_STORE, integration: SHOP_INTEGRATION, payload, fetchFn };
}

function stubShopify() {
  const calls: { query: string; variables: any }[] = [];
  const state: any = {
    order: {
      id: "gid://shopify/Order/555", closed: false, cancelledAt: null,
      displayFulfillmentStatus: "UNFULFILLED", displayFinancialStatus: "PENDING", note: "",
      fulfillments: [] as any[],
      fulfillmentOrders: { edges: [{ node: { id: "gid://shopify/FulfillmentOrder/9", status: "OPEN" } }] },
      transactions: [{ id: "gid://shopify/OrderTransaction/3", status: "SUCCESS", kind: "SALE", gateway: "Cash on Delivery" }],
      lineItems: { edges: [{ node: { id: "gid://shopify/LineItem/7", quantity: 2 } }] },
    },
    draft: null as any,
  };
  const respond = (data: any) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ data }),
    json: async () => ({ data }),
  });
  const fn = async (_url: string, init: any = {}) => {
    const parsed = JSON.parse(init.body);
    const q: string = parsed.query;
    calls.push({ query: q, variables: parsed.variables });
    if (q.includes("EcDraftRead")) return respond({ draftOrder: state.draft });
    if (q.includes("draftOrderCreate")) {
      state.draft = { id: "gid://shopify/DraftOrder/42", invoiceUrl: "https://demo.myshopify.com/invoices/42" };
      return respond({ draftOrderCreate: { draftOrder: state.draft, userErrors: [] } });
    }
    if (q.includes("orderCancel")) {
      state.order.cancelledAt = "2026-10-13T00:00:00Z";
      return respond({ orderCancel: { job: { id: "job-1" }, userErrors: [] } });
    }
    if (q.includes("fulfillmentCreateV2")) {
      const num = parsed.variables.fulfillment.trackingInfo.number;
      const f = { id: "gid://shopify/Fulfillment/8", status: "SUCCESS", trackingInfo: { number: num, company: parsed.variables.fulfillment.trackingInfo.company } };
      state.order.fulfillments.push(f);
      return respond({ fulfillmentCreateV2: { fulfillment: f, userErrors: [] } });
    }
    if (q.includes("refundCreate")) return respond({ refundCreate: { refund: { id: "gid://shopify/Refund/6" }, userErrors: [] } });
    if (q.includes("orderUpdate")) {
      if (parsed.variables.input.note !== undefined) state.order.note = parsed.variables.input.note;
      return respond({ orderUpdate: { order: { id: state.order.id, note: state.order.note }, userErrors: [] } });
    }
    if (q.includes("EcOrderState")) return respond({ order: state.order });
    throw new Error(`stub shopify: unhandled query ${q.slice(0, 60)}`);
  };
  return { fn, calls, state };
}

function seedShopOrder(prisma: any) {
  prisma.order.rows.push({ id: "s1", organizationId: "org-1", storeId: "st-shop", source: "shopify", externalId: "555", status: "processing", currency: "BDT", totalMinor: 20000n, refundedMinor: 0n });
  prisma.orderItem.rows.push({ id: "si1", orderId: "s1", externalVariationId: "777", quantity: 2, priceMinor: 10000n, totalMinor: 20000n, name: "Shirt" });
}

describe("EC5 Shopify order adapter", () => {
  it("refuses a status with no Shopify equivalent — verbatim, no fake", async () => {
    const prisma = fakePrisma(); seedShopOrder(prisma);
    const stub = stubShopify();
    const res = await shopifyOrders.pushOrderStatus(shopArgs(prisma, { orderId: "s1", status: "refunded" }, stub.fn));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("no_shopify_equivalent");
    expect(prisma.order.rows[0].storeSyncError).toBe("no_shopify_equivalent");
  });

  it("completed is ok only when the remote order is fulfilled", async () => {
    const prisma = fakePrisma(); seedShopOrder(prisma);
    const stub = stubShopify();
    const res = await shopifyOrders.pushOrderStatus(shopArgs(prisma, { orderId: "s1", status: "completed" }, stub.fn));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("no_shopify_equivalent");
    stub.state.order.displayFulfillmentStatus = "FULFILLED";
    const res2 = await shopifyOrders.pushOrderStatus(shopArgs(prisma, { orderId: "s1", status: "completed" }, stub.fn));
    expect(res2.ok).toBe(true);
  });

  it("cancels via orderCancel and verifies on read-back", async () => {
    const prisma = fakePrisma(); seedShopOrder(prisma);
    const stub = stubShopify();
    const res = await shopifyOrders.cancelOrder(shopArgs(prisma, { orderId: "s1" }, stub.fn));
    expect(res.ok).toBe(true);
    expect(stub.state.order.cancelledAt).toBeTruthy();
  });

  it("creates a fulfilment with tracking and verifies the tracking number on read-back", async () => {
    const prisma = fakePrisma(); seedShopOrder(prisma);
    const stub = stubShopify();
    const res = await shopifyOrders.createFulfillment(shopArgs(prisma, { orderId: "s1", trackingCode: "PX999", courierProvider: "pathao" }, stub.fn));
    expect(res.ok).toBe(true);
    expect(stub.state.order.fulfillments[0].trackingInfo.number).toBe("PX999");
    // trackingInfo.url is omitted — no courier URL pattern exists in the codebase
    const mut = stub.calls.find((c) => c.query.includes("fulfillmentCreateV2"));
    expect(mut!.variables.fulfillment.trackingInfo.url).toBeUndefined();
  });

  it("refund goes through refundCreate with the parent transaction", async () => {
    const prisma = fakePrisma(); seedShopOrder(prisma);
    const stub = stubShopify();
    const res = await shopifyOrders.pushRefund(shopArgs(prisma, { orderId: "s1", amountMinor: "20000", reason: "damaged" }, stub.fn));
    expect(res.ok).toBe(true);
    const mut = stub.calls.find((c) => c.query.includes("refundCreate"));
    expect(mut!.variables.input.transactions[0].amount).toBe("200.00");
    expect(mut!.variables.input.transactions[0].parentId).toBe("gid://shopify/OrderTransaction/3");
  });

  it("creates a draft order, stores invoiceUrl + draft id, and refuses a duplicate", async () => {
    const prisma = fakePrisma();
    prisma.order.rows.push({ id: "s2", organizationId: "org-1", storeId: null, source: "chat", externalId: "chat-9", status: "processing", currency: "BDT" });
    prisma.orderItem.rows.push({ id: "si2", orderId: "s2", externalVariationId: "777", quantity: 1, priceMinor: 5000n, totalMinor: 5000n, name: "Shirt" });
    const stub = stubShopify();
    const res = await shopifyOrders.createDraftOrder(shopArgs(prisma, { orderId: "s2" }, stub.fn));
    expect(res.ok).toBe(true);
    const row = prisma.order.rows[0];
    expect(row.storeInvoiceUrl).toBe("https://demo.myshopify.com/invoices/42");
    expect(row.storeDraftId).toBe("42");
    const dup = await shopifyOrders.createDraftOrder(shopArgs(prisma, { orderId: "s2" }, stub.fn));
    expect(dup.ok).toBe(false);
    expect(dup.error).toBe("order_already_in_store");
  });

  it("address without structured parts fails honestly and calls nothing", async () => {
    const prisma = fakePrisma(); seedShopOrder(prisma);
    const stub = stubShopify();
    const res = await shopifyOrders.pushOrderAddress(shopArgs(prisma, { orderId: "s1", address: "House 1, Dhaka" }, stub.fn));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("shopify_address_needs_structured_fields");
    expect(stub.calls.length).toBe(0);
  });

  it("sets the order note via orderUpdate and verifies", async () => {
    const prisma = fakePrisma(); seedShopOrder(prisma);
    const stub = stubShopify();
    const res = await shopifyOrders.pushOrderNote(shopArgs(prisma, { orderId: "s1", note: "কাস্টমারকে কল করে পাঠাবেন" }, stub.fn));
    expect(res.ok).toBe(true);
    expect(stub.state.order.note).toBe("কাস্টমারকে কল করে পাঠাবেন");
  });
});
