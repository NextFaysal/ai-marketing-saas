import "reflect-metadata";
import { SupplierPortalService, hashSupplierPortalToken } from "./supplier-portal.service";
import { DropshipService, computePartnerStock, PARTNER_STOCK_LABEL } from "./dropship.service";

/**
 * NF12 (FB4) — Supplier portal + Dropship specs. Fake-prisma
 * harness in the nf11 pattern (in-memory tables, org-scoped
 * `matches`, unique enforcement on the keys the design rides).
 * OrdersService is a recording fake reproducing the REAL
 * createManual contract that matters here: the upsert dedupe
 * on (org, source "manual", externalId = externalRef) — a
 * resubmission UPDATES/returns the same order instead of
 * duplicating — and updateOrder's transition table for the
 * statuses NF12 exercises (completed is terminal for cancel).
 */

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => matches(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.map(String).includes(String(row[k]));
      if ("notIn" in v) return !(v as any).notIn.map(String).includes(String(row[k]));
      return true;
    }
    return String(row[k]) === String(v);
  });
}

let seq = 0;
function makeTable(rows: Row[], uniqueKeys: string[][] = []) {
  return {
    rows,
    async findFirst({ where }: any = {}) {
      return rows.find((r) => matches(r, where)) ?? null;
    },
    async findMany({ where, orderBy }: any = {}) {
      let out = rows.filter((r) => matches(r, where));
      const spec = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      if (spec) {
        const [key, dir] = Object.entries(spec)[0] as [string, string];
        out = [...out].sort((a, b) => {
          const c = String(a[key] ?? "") < String(b[key] ?? "") ? -1 : String(a[key] ?? "") > String(b[key] ?? "") ? 1 : 0;
          return dir === "desc" ? -c : c;
        });
      }
      return out;
    },
    async create({ data }: any) {
      for (const keys of uniqueKeys) {
        if (keys.some((k) => data[k] === null || data[k] === undefined)) continue;
        if (rows.some((r) => keys.every((k) => String(r[k]) === String(data[k])))) {
          throw new Error("Unique constraint failed P2002");
        }
      }
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    async update({ where, data }: any) {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error("Record not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async count({ where }: any = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
  };
}

function makeWorld() {
  const db: Record<string, Row[]> = {
    organization: [
      { id: "org-sup", name: "Supplier Co", slug: "supplier-co" },
      { id: "org-sell", name: "Seller Shop", slug: "seller-shop" },
      { id: "org-other", name: "Other Org", slug: "other-org" },
    ],
    supplier: [
      { id: "sup-a", organizationId: "org-1", name: "Supplier A", active: true, leadTimeDays: null, leadTimeNote: null },
      { id: "sup-b", organizationId: "org-1", name: "Supplier B", active: true, leadTimeDays: null, leadTimeNote: null },
    ],
    supplierPortalLink: [],
    purchaseOrder: [
      { id: "po-a1", organizationId: "org-1", supplierId: "sup-a", status: "draft", note: null, expectedDate: null, supplierConfirmedAt: null, supplierShippedAt: null, createdAt: new Date(), updatedAt: new Date() },
      { id: "po-b1", organizationId: "org-1", supplierId: "sup-b", status: "draft", note: null, expectedDate: null, supplierConfirmedAt: null, supplierShippedAt: null, createdAt: new Date(), updatedAt: new Date() },
    ],
    purchaseOrderItem: [
      { id: "poi-a1", purchaseOrderId: "po-a1", productId: "prod-1", sku: "SKU-1", qtyOrdered: 10, qtyReceived: 0, unitCostMinor: 5000n },
      { id: "poi-b1", purchaseOrderId: "po-b1", productId: "prod-1", sku: "SKU-1", qtyOrdered: 4, qtyReceived: 0, unitCostMinor: 5000n },
    ],
    product: [
      { id: "prod-1", organizationId: "org-sup", name: "চামড়ার বেল্ট", sku: "BELT-1", priceMinor: 90000n, currency: "BDT", stockQuantity: 37, status: "ACTIVE", source: "manual", description: null, imageUrl: null },
      { id: "prod-2", organizationId: "org-sup", name: "ওয়ালেট", sku: "WAL-1", priceMinor: 60000n, currency: "BDT", stockQuantity: 5, status: "ACTIVE", source: "manual", description: null, imageUrl: null },
      { id: "prod-sell-own", organizationId: "org-sell", name: "নিজের পণ্য", sku: "OWN-1", priceMinor: 10000n, currency: "BDT", stockQuantity: 9, status: "ACTIVE", source: "manual", description: null, imageUrl: null },
    ],
    stockBalance: [],
    dropshipAgreement: [],
    dropshipOffer: [],
    dropshipListing: [],
    dropshipOrderLink: [],
    dropshipLedgerEntry: [],
    order: [],
    orderItem: [],
    customer: [
      { id: "cust-1", organizationId: "org-sell", firstName: "Rahim", lastName: "Uddin", phone: "01700000000", address: { address_1: "House 1, Dhaka" } },
    ],
  };
  const prisma: any = {
    organization: makeTable(db.organization),
    supplier: makeTable(db.supplier),
    supplierPortalLink: makeTable(db.supplierPortalLink, [["supplierId"], ["tokenHash"]]),
    purchaseOrder: makeTable(db.purchaseOrder),
    purchaseOrderItem: makeTable(db.purchaseOrderItem),
    product: makeTable(db.product),
    stockBalance: makeTable(db.stockBalance),
    dropshipAgreement: makeTable(db.dropshipAgreement, [["supplierOrgId", "sellerOrgId"]]),
    dropshipOffer: makeTable(db.dropshipOffer, [["agreementId", "productId"]]),
    dropshipListing: makeTable(db.dropshipListing, [["sellerProductId"], ["agreementId", "sourceProductId"]]),
    dropshipOrderLink: makeTable(db.dropshipOrderLink, [["sellerOrderId", "agreementId"]]),
    dropshipLedgerEntry: makeTable(db.dropshipLedgerEntry, [["dropshipOrderLinkId"]]),
    order: makeTable(db.order),
    orderItem: makeTable(db.orderItem),
    customer: makeTable(db.customer),
  };
  const ordersCalls: any[] = [];
  const ordersFake: any = {
    calls: ordersCalls,
    async createManual(orgId: string, actorId: string, dto: any) {
      ordersCalls.push({ orgId, actorId, dto: JSON.parse(JSON.stringify(dto, (_k, v) => (typeof v === "bigint" ? String(v) : v))) });
      const existing = db.order.find((o) => o.organizationId === orgId && o.source === "manual" && o.externalId === dto.externalRef);
      if (existing) return { ...existing, upsertResult: "updated" };
      const subtotal = dto.items.reduce((s: bigint, i: any) => s + BigInt(i.unitPriceMinor) * BigInt(i.quantity), 0n);
      const cust = db.customer.find((c) => c.organizationId === orgId && c.phone === dto.customerPhone)
        ?? { id: `cust-${++seq}`, organizationId: orgId, firstName: dto.customerName, phone: dto.customerPhone, address: { address_1: dto.address } };
      if (!db.customer.includes(cust as any)) db.customer.push(cust as any);
      const order: Row = {
        id: `order-${++seq}`, organizationId: orgId, source: "manual", externalId: dto.externalRef,
        status: dto.status ?? "processing", isCod: dto.isCod !== false, customerId: (cust as any).id,
        address: dto.address ?? null, subtotalMinor: subtotal, totalMinor: subtotal,
        createdAt: new Date(), updatedAt: new Date(),
      };
      db.order.push(order);
      for (const i of dto.items) {
        db.orderItem.push({ id: `oi-${++seq}`, orderId: order.id, productId: null, name: i.name, sku: i.sku ?? null, quantity: i.quantity, priceMinor: BigInt(i.unitPriceMinor), totalMinor: BigInt(i.unitPriceMinor) * BigInt(i.quantity) });
      }
      return { ...order, totalMinor: subtotal.toString() };
    },
    async updateOrder(orgId: string, _actorId: string, orderId: string, dto: any) {
      const order = db.order.find((o) => o.id === orderId && o.organizationId === orgId);
      if (!order) throw new Error("Order not found in this organization");
      if (dto.status && ["completed", "delivered"].includes(order.status) && dto.status === "cancelled") {
        throw new Error("transition not allowed");
      }
      if (dto.status) order.status = dto.status;
      return order;
    },
  };
  const audit: any = { log: async () => undefined };
  const portal = new SupplierPortalService(prisma, audit);
  const dropship = new DropshipService(prisma, audit, ordersFake);
  return { db, prisma, portal, dropship, ordersFake };
}

/** Drive an agreement org-sell (seller) ↔ org-sup (supplier) to accepted. */
async function acceptedAgreement(w: ReturnType<typeof makeWorld>) {
  const inv: any = await w.dropship.invite("org-sell", "owner-sell", { slug: "supplier-co", role: "supplier" });
  const done: any = await w.dropship.respond("org-sup", "owner-sup", inv.id, true);
  return done;
}

describe("NF12 supplier portal", () => {
  it("hash-at-rest: stored value is sha256(raw); raw token never stored", async () => {
    const w = makeWorld();
    const issued: any = await w.portal.issueLink("org-1", "staff-1", "sup-a");
    const row = w.db.supplierPortalLink[0];
    expect(row.tokenHash).toBe(hashSupplierPortalToken(issued.token));
    expect(JSON.stringify(row)).not.toContain(issued.token);
    const status: any = await w.portal.linkStatus("org-1", "sup-a");
    expect(JSON.stringify(status)).not.toContain(row.tokenHash);
  });

  it("wrong token 404s; revoked token 403s; rotation kills the old token", async () => {
    const w = makeWorld();
    const first: any = await w.portal.issueLink("org-1", "staff-1", "sup-a");
    await expect(w.portal.publicResolve("not-a-token")).rejects.toThrow(/পাওয়া যায়নি/);
    const second: any = await w.portal.issueLink("org-1", "staff-1", "sup-a");
    expect(second.rotated).toBe(true);
    await expect(w.portal.publicResolve(first.token)).rejects.toThrow(/পাওয়া যায়নি/);
    await w.portal.revokeLink("org-1", "staff-1", "sup-a");
    await expect(w.portal.publicResolve(second.token)).rejects.toThrow(/বাতিল/);
  });

  it("two-supplier isolation: A's token sees ONLY A's POs and cannot act on B's", async () => {
    const w = makeWorld();
    const a: any = await w.portal.issueLink("org-1", "staff-1", "sup-a");
    const home: any = await w.portal.publicResolve(a.token);
    expect(home.purchaseOrders.map((p: any) => p.id)).toEqual(["po-a1"]);
    expect(home.organizationName).toBeNull(); // org-1 is not seeded as an Organization row — name only, never more
    await expect(w.portal.confirmPo(a.token, "po-b1")).rejects.toThrow(/পাওয়া যায়নি/);
    await expect(w.portal.shipPo(a.token, "po-b1")).rejects.toThrow(/পাওয়া যায়নি/);
    const bPo = w.db.purchaseOrder.find((p) => p.id === "po-b1")!;
    expect(bPo.status).toBe("draft");
    expect(bPo.supplierConfirmedAt).toBeNull;
  });

  it("confirm maps onto the existing draft→ordered transition + stamp; ship stamps without inventing a status", async () => {
    const w = makeWorld();
    const a: any = await w.portal.issueLink("org-1", "staff-1", "sup-a");
    await expect(w.portal.shipPo(a.token, "po-a1")).rejects.toThrow(/নিশ্চিত/);
    const confirmed: any = await w.portal.confirmPo(a.token, "po-a1");
    expect(confirmed.status).toBe("ordered");
    expect(confirmed.supplierConfirmedAt).toBeTruthy();
    const shipped: any = await w.portal.shipPo(a.token, "po-a1", { note: "কুরিয়ারে দেওয়া হয়েছে" });
    expect(shipped.status).toBe("ordered"); // NOT a new status, NOT received
    expect(shipped.supplierShippedAt).toBeTruthy();
    expect(shipped.supplierShipNote).toBe("কুরিয়ারে দেওয়া হয়েছে");
    await expect(w.portal.shipPo(a.token, "po-a1")).rejects.toThrow(/ইতিমধ্যে/);
  });

  it("lead time updates only the token's own supplier record", async () => {
    const w = makeWorld();
    const a: any = await w.portal.issueLink("org-1", "staff-1", "sup-a");
    const out: any = await w.portal.updateLeadTime(a.token, { leadTimeDays: 3, leadTimeNote: "ঢাকায় ৩ দিন" });
    expect(out.supplier.leadTimeDays).toBe(3);
    expect(w.db.supplier.find((s) => s.id === "sup-b")!.leadTimeDays).toBeNull();
    await expect(w.portal.updateLeadTime(a.token, { leadTimeDays: 999 })).rejects.toThrow(/০–৩৬৫/);
  });
});

describe("NF12 dropship agreements + offers + listings", () => {
  it("invite by slug: unknown slug 404s; invite reveals name + slug only", async () => {
    const w = makeWorld();
    await expect(w.dropship.invite("org-sell", "u1", { slug: "no-such-org", role: "supplier" })).rejects.toThrow(/পাওয়া যায়নি/);
    const inv: any = await w.dropship.invite("org-sell", "u1", { slug: "supplier-co", role: "supplier" });
    expect(inv.status).toBe("pending");
    expect(inv.counterpartyName).toBe("Supplier Co");
    expect(Object.keys(inv.supplierOrg).sort()).toEqual(["id", "name", "slug"]);
  });

  it("pre-acceptance NOTHING is shared: offers, listings and offer reads all refuse while pending", async () => {
    const w = makeWorld();
    const inv: any = await w.dropship.invite("org-sell", "u1", { slug: "supplier-co", role: "supplier" });
    await expect(w.dropship.setOffer("org-sup", "u2", inv.id, { productId: "prod-1", floorPriceMinor: "50000" })).rejects.toThrow(/সক্রিয় নয়/);
    await expect(w.dropship.listOffers("org-sell", inv.id)).rejects.toThrow(/সক্রিয় নয়/);
    await expect(w.dropship.createListing("org-sell", "u1", { agreementId: inv.id, offerId: "x", priceMinor: "80000" })).rejects.toThrow(/সক্রিয় নয়/);
    expect(w.db.dropshipOffer).toHaveLength(0);
    expect(w.db.dropshipListing).toHaveLength(0);
  });

  it("inviter cannot respond to their own invite; decline keeps everything closed", async () => {
    const w = makeWorld();
    const inv: any = await w.dropship.invite("org-sell", "u1", { slug: "supplier-co", role: "supplier" });
    await expect(w.dropship.respond("org-sell", "u1", inv.id, true)).rejects.toThrow(/নিজের পাঠানো/);
    const declined: any = await w.dropship.respond("org-sup", "owner-sup", inv.id, false);
    expect(declined.status).toBe("declined");
    await expect(w.dropship.setOffer("org-sup", "u2", inv.id, { productId: "prod-1", floorPriceMinor: "50000" })).rejects.toThrow(/সক্রিয় নয়/);
  });

  it("unrelated org cannot see or answer the agreement (org isolation)", async () => {
    const w = makeWorld();
    const inv: any = await w.dropship.invite("org-sell", "u1", { slug: "supplier-co", role: "supplier" });
    const list: any = await w.dropship.listAgreements("org-other");
    expect(list.items).toHaveLength(0);
    await expect(w.dropship.respond("org-other", "u9", inv.id, true)).rejects.toThrow(/পাওয়া যায়নি/);
  });

  it("offers are source-side only; seller reads the minimised offer view with labelled partner stock", async () => {
    const w = makeWorld();
    const ag = await acceptedAgreement(w);
    await expect(w.dropship.setOffer("org-sell", "u1", ag.id, { productId: "prod-1", floorPriceMinor: "50000" })).rejects.toThrow(/source/);
    const offer: any = await w.dropship.setOffer("org-sup", "u2", ag.id, { productId: "prod-1", floorPriceMinor: "50000" });
    expect(offer.floorPriceMinor).toBe("50000");
    const seen: any = await w.dropship.listOffers("org-sell", ag.id);
    expect(seen.items).toHaveLength(1);
    expect(seen.items[0].partnerStock).toBe(37);
    expect(seen.items[0].partnerStockLabel).toBe(PARTNER_STOCK_LABEL);
    expect(JSON.stringify(seen)).not.toContain("ওয়ালেট"); // prod-2 was never offered
  });

  it("partner stock prefers AX4 bin balances (Σ onHand − reserved) over the product counter", () => {
    expect(computePartnerStock({ stockQuantity: 37 }, [{ onHand: 10, reserved: 2 }, { onHand: 5, reserved: 0 }])).toBe(13);
    expect(computePartnerStock({ stockQuantity: 37 }, [])).toBe(37);
    expect(computePartnerStock({ stockQuantity: null }, [])).toBeNull();
  });

  it("listing: price below floor refused; at/above floor creates a seller product whose stock stays null (never merged)", async () => {
    const w = makeWorld();
    const ag = await acceptedAgreement(w);
    const offer: any = await w.dropship.setOffer("org-sup", "u2", ag.id, { productId: "prod-1", floorPriceMinor: "50000" });
    await expect(w.dropship.createListing("org-sell", "u1", { agreementId: ag.id, offerId: offer.id, priceMinor: "49999" })).rejects.toThrow(/ফ্লোর/);
    const listing: any = await w.dropship.createListing("org-sell", "u1", { agreementId: ag.id, offerId: offer.id, priceMinor: "80000" });
    expect(listing.partnerStock).toBe(37);
    expect(listing.suppliedBy).toBe("Supplier Co");
    const sellerProduct = w.db.product.find((p) => p.id === listing.sellerProductId)!;
    expect(sellerProduct.organizationId).toBe("org-sell");
    expect(sellerProduct.stockQuantity).toBeNull(); // partner stock NEVER merged
    expect(sellerProduct.source).toBe("dropship");
    expect(sellerProduct.priceMinor).toBe(80000n);
  });
});

describe("NF12 dropship order flow", () => {
  async function setupListing(w: ReturnType<typeof makeWorld>) {
    const ag = await acceptedAgreement(w);
    const offer: any = await w.dropship.setOffer("org-sup", "u2", ag.id, { productId: "prod-1", floorPriceMinor: "50000" });
    const listing: any = await w.dropship.createListing("org-sell", "u1", { agreementId: ag.id, offerId: offer.id, priceMinor: "80000" });
    return { ag, offer, listing };
  }

  function sellerOrderWith(w: ReturnType<typeof makeWorld>, listing: any, qty = 2) {
    const order: Row = {
      id: "seller-order-1", organizationId: "org-sell", source: "shop", externalId: "shop-1",
      status: "processing", isCod: true, customerId: "cust-1", address: "House 1, Dhaka",
      totalMinor: 160000n, createdAt: new Date(), updatedAt: new Date(),
    };
    w.db.order.push(order);
    w.db.orderItem.push({ id: "soi-1", orderId: order.id, productId: listing.sellerProductId, name: "চামড়ার বেল্ট", quantity: qty, priceMinor: 80000n, totalMinor: 80000n * BigInt(qty) });
    w.db.orderItem.push({ id: "soi-2", orderId: order.id, productId: "prod-sell-own", name: "নিজের পণ্য", quantity: 1, priceMinor: 10000n, totalMinor: 10000n });
    return order;
  }

  it("creates the supplier order at WHOLESALE only — retail price and margin never cross", async () => {
    const w = makeWorld();
    const { listing } = await setupListing(w);
    sellerOrderWith(w, listing, 2);
    const out: any = await w.dropship.processSellerOrder("org-sell", "u1", "seller-order-1");
    expect(out.results).toHaveLength(1);
    expect(out.results[0].reused).toBe(false);
    const call = w.ordersFake.calls[0];
    expect(call.orgId).toBe("org-sup");
    // fulfilment-necessary data only: name/phone/address + items at floor
    expect(call.dto.customerPhone).toBe("01700000000");
    expect(call.dto.address).toBe("House 1, Dhaka");
    expect(call.dto.items).toEqual([{ name: "চামড়ার বেল্ট", sku: "BELT-1", quantity: 2, unitPriceMinor: "50000" }]);
    expect(JSON.stringify(call.dto)).not.toContain("80000"); // retail NEVER in the payload
    const supplierOrder = w.db.order.find((o) => o.organizationId === "org-sup")!;
    expect(supplierOrder.totalMinor).toBe(100000n); // 2 × floor 50000, not 2 × retail 80000
    expect(supplierOrder.externalId).toBe(`dropship:seller-order-1:${out.results[0].agreementId}`);
  });

  it("exactly-once: double placement / replay creates ONE supplier order and ONE link", async () => {
    const w = makeWorld();
    const { listing } = await setupListing(w);
    sellerOrderWith(w, listing, 1);
    const first: any = await w.dropship.processSellerOrder("org-sell", "u1", "seller-order-1");
    const second: any = await w.dropship.processSellerOrder("org-sell", "u1", "seller-order-1");
    expect(second.results[0].reused).toBe(true);
    expect(second.results[0].supplierOrderId).toBe(first.results[0].supplierOrderId);
    expect(w.db.order.filter((o) => o.organizationId === "org-sup")).toHaveLength(1);
    expect(w.db.dropshipOrderLink).toHaveLength(1);
  });

  it("seller order without dropship items creates nothing", async () => {
    const w = makeWorld();
    await setupListing(w);
    w.db.order.push({ id: "plain-1", organizationId: "org-sell", source: "shop", externalId: "p1", status: "processing", isCod: true, customerId: "cust-1", totalMinor: 10000n, createdAt: new Date(), updatedAt: new Date() });
    w.db.orderItem.push({ id: "poi-9", orderId: "plain-1", productId: "prod-sell-own", name: "নিজের পণ্য", quantity: 1, priceMinor: 10000n, totalMinor: 10000n });
    const out: any = await w.dropship.processSellerOrder("org-sell", "u1", "plain-1");
    expect(out.results).toHaveLength(0);
    expect(w.db.order.filter((o) => o.organizationId === "org-sup")).toHaveLength(0);
  });

  it("status mirror + ledger: completion writes ONE ledger entry from REAL totals; replay writes none", async () => {
    const w = makeWorld();
    const { listing } = await setupListing(w);
    sellerOrderWith(w, listing, 2);
    await w.dropship.processSellerOrder("org-sell", "u1", "seller-order-1");
    const supplierOrder = w.db.order.find((o) => o.organizationId === "org-sup")!;
    supplierOrder.status = "completed";
    const view1: any = await w.dropship.listDropshipOrders("org-sell");
    expect(view1.items[0].supplierStatus).toBe("completed");
    expect(view1.items[0].ledger).toBeTruthy();
    expect(view1.items[0].ledger.retailTotalMinor).toBe("160000"); // 2 × 80000 retail
    expect(view1.items[0].ledger.wholesaleTotalMinor).toBe("100000"); // 2 × 50000 floor
    expect(view1.items[0].ledger.marginMinor).toBe("60000");
    expect(view1.items[0].ledger.payoutNote).toContain("OU11");
    await w.dropship.listDropshipOrders("org-sell");
    expect(w.db.dropshipLedgerEntry).toHaveLength(1);
    const ledger: any = await w.dropship.listLedger("org-sell");
    expect(ledger.items).toHaveLength(1);
    expect(ledger.payoutNote).toContain("OU11");
  });

  it("supplier-side view of a link NEVER carries retail prices", async () => {
    const w = makeWorld();
    const { listing } = await setupListing(w);
    sellerOrderWith(w, listing, 1);
    await w.dropship.processSellerOrder("org-sell", "u1", "seller-order-1");
    const supplierView: any = await w.dropship.listDropshipOrders("org-sup");
    expect(supplierView.items).toHaveLength(1);
    expect(supplierView.items[0].myRole).toBe("supplier");
    expect(JSON.stringify(supplierView.items[0].items)).not.toContain("retailUnitMinor");
    expect(JSON.stringify(supplierView.items[0].items)).not.toContain("80000");
    expect(supplierView.items[0].items[0].wholesaleUnitMinor).toBe("50000");
  });

  it("cancellation propagation: seller cancel cancels the supplier order pre-fulfilment", async () => {
    const w = makeWorld();
    const { listing } = await setupListing(w);
    const so = sellerOrderWith(w, listing, 1);
    await w.dropship.processSellerOrder("org-sell", "u1", "seller-order-1");
    so.status = "cancelled";
    const view: any = await w.dropship.listDropshipOrders("org-sell");
    expect(view.items[0].supplierStatus).toBe("cancelled");
    const supplierOrder = w.db.order.find((o) => o.organizationId === "org-sup")!;
    expect(supplierOrder.status).toBe("cancelled");
  });

  it("cancellation refused after supplier completion — reason recorded, fulfilment cancel endpoint refuses too", async () => {
    const w = makeWorld();
    const { listing } = await setupListing(w);
    const so = sellerOrderWith(w, listing, 1);
    await w.dropship.processSellerOrder("org-sell", "u1", "seller-order-1");
    const supplierOrder = w.db.order.find((o) => o.organizationId === "org-sup")!;
    supplierOrder.status = "completed";
    const link = w.db.dropshipOrderLink[0];
    await expect(w.dropship.cancelFulfilment("org-sell", "u1", link.id)).rejects.toThrow(/সম্পন্ন/);
    so.status = "cancelled";
    const view: any = await w.dropship.listDropshipOrders("org-sell");
    expect(view.items[0].supplierStatus).toBe("completed");
    expect(view.items[0].cancelNote).toContain("refused");
    expect(supplierOrder.status).toBe("completed");
  });

  it("revocation stops NEW fulfilment orders but keeps the existing mirror readable", async () => {
    const w = makeWorld();
    const { ag, listing } = await setupListing(w);
    sellerOrderWith(w, listing, 1);
    await w.dropship.processSellerOrder("org-sell", "u1", "seller-order-1");
    await w.dropship.revoke("org-sell", "u1", ag.id);
    // a NEW seller order with the same listing now creates nothing
    w.db.order.push({ id: "seller-order-2", organizationId: "org-sell", source: "shop", externalId: "shop-2", status: "processing", isCod: true, customerId: "cust-1", address: "House 1, Dhaka", totalMinor: 80000n, createdAt: new Date(), updatedAt: new Date() });
    w.db.orderItem.push({ id: "soi-3", orderId: "seller-order-2", productId: listing.sellerProductId, name: "চামড়ার বেল্ট", quantity: 1, priceMinor: 80000n, totalMinor: 80000n });
    const out: any = await w.dropship.processSellerOrder("org-sell", "u1", "seller-order-2");
    expect(out.results[0].skipped).toBe("agreement_not_accepted");
    expect(w.db.order.filter((o) => o.organizationId === "org-sup")).toHaveLength(1);
    const view: any = await w.dropship.listDropshipOrders("org-sell");
    expect(view.items).toHaveLength(1); // existing link mirror survives revocation
  });
});
