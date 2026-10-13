import { NotFoundException } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";

/* Fake prisma in the EC spec style (self-contained copy). */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) { if (!cond.in.includes(row[k])) return false; continue; }
      if ("not" in cond) { if (row[k] === cond.not) return false; continue; }
      if ("gte" in cond || "lte" in cond) {
        if (row[k] === null || row[k] === undefined) return false;
        const t = new Date(row[k]).getTime();
        if ("gte" in cond && t < new Date(cond.gte).getTime()) return false;
        if ("lte" in cond && t > new Date(cond.lte).getTime()) return false;
        continue;
      }
      if ("contains" in cond) {
        const hay = String(row[k] ?? "");
        const hit = cond.mode === "insensitive"
          ? hay.toLowerCase().includes(String(cond.contains).toLowerCase())
          : hay.includes(String(cond.contains));
        if (!hit) return false;
        continue;
      }
      if (!matchWhere(row, cond)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
function applyOrderBy(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    for (const [field, dir] of Object.entries(spec)) {
      out.sort((a: any, b: any) => {
        const av = a[field]; const bv = b[field];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = av instanceof Date || bv instanceof Date
          ? new Date(av).getTime() - new Date(bv).getTime()
          : av < bv ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      });
    }
  }
  return out;
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) =>
      applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let found = applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy);
      if (skip) found = found.slice(skip);
      if (take !== undefined) found = found.slice(0, take);
      return found;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
  };
}
function makePrisma() {
  return {
    organization: makeTable(), storefrontSetting: makeTable(), businessProfile: makeTable(),
    category: makeTable(), product: makeTable(), productVariant: makeTable(), productImage: makeTable(),
    shippingZone: makeTable(), storeCart: makeTable(), storeCartItem: makeTable(),
    order: makeTable(), orderItem: makeTable(), fulfillment: makeTable(), courierShipment: makeTable(),
    paymentVerification: makeTable(), customer: makeTable(), deliverySlot: makeTable(), integration: makeTable(),
  } as any;
}

const NOT_FOUND_MSG = "অর্ডারটি পাওয়া যায়নি — অর্ডার নম্বর ও ফোন নম্বর যাচাই করে আবার চেষ্টা করুন";
const PLACED = new Date("2026-10-12T08:00:00Z");
const BOOKED = new Date("2026-10-12T12:00:00Z");

function seedWorld(prisma: any, settingOver: Record<string, any> = {}) {
  prisma.organization.rows.push({
    id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne",
    logoUrl: "logo.png", primaryColor: "#123456", customDomain: null,
  });
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: null,
    trackingPageEnabled: true, supportPhone: "01899999999",
    returnPolicyText: "৭ দিনের রিটার্ন", deliveryPromiseText: "২৪ ঘণ্টায় ডেলিভারি",
    ...settingOver,
  });
  prisma.customer.rows.push({
    id: "c1", organizationId: "org-1", firstName: "রহিম", phone: "01711111111",
    email: "rahim-secret@example.com", address: "গোপন ঠিকানা, ঢাকা",
  });
  prisma.order.rows.push({
    id: "o1", organizationId: "org-1", customerId: "c1",
    externalId: "native-xyz", externalNumber: "ORD-1234-AB",
    source: "native_storefront", status: "processing", currency: "BDT",
    totalMinor: 100000n, placedAt: PLACED, createdAt: PLACED,
    deliverySlotId: "slot-1", deliveryDate: "2026-10-14",
    address: "গোপন ঠিকানা, ঢাকা",
  });
  prisma.orderItem.rows.push(
    { id: "it-1", orderId: "o1", productId: "p-a", name: "ওয়ালেট", quantity: 2, priceMinor: 50000n, totalMinor: 100000n },
  );
  prisma.deliverySlot.rows.push({
    id: "slot-1", organizationId: "org-1", label: "সকাল ৯টা–১২টা", startTime: "09:00", endTime: "12:00",
    districtScope: null, capacityPerDay: null, active: true,
  });
  prisma.paymentVerification.rows.push(
    { id: "pv-1", organizationId: "org-1", orderId: "o1", status: "approved", source: "manual_advance", amountMinor: 30000n, expectedAmountMinor: 100000n, createdAt: PLACED },
    { id: "pv-2", organizationId: "org-1", orderId: "o1", status: "pending", source: null, amountMinor: 20000n, expectedAmountMinor: 100000n, createdAt: PLACED },
    { id: "pv-3", organizationId: "org-1", orderId: "other-order", status: "approved", source: "manual_advance", amountMinor: 99000n, expectedAmountMinor: null, createdAt: PLACED },
  );
  return prisma;
}

function makeService(prisma: any) {
  return new StorefrontService(prisma, undefined, undefined, undefined, undefined, undefined);
}

function deepKeys(value: any, acc = new Set<string>()): Set<string> {
  if (Array.isArray(value)) { for (const v of value) deepKeys(v, acc); return acc; }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { acc.add(k); deepKeys(v, acc); }
  }
  return acc;
}

describe("EC18 StorefrontService.trackOrder", () => {
  it("resolves by order number (case-insensitive) + loose phone, with slot/steps/shipment from real rows", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.fulfillment.rows.push({
      id: "f1", organizationId: "org-1", orderId: "o1", status: "in_transit",
      courierProvider: "steadfast", trackingCode: "TRK-9", createdAt: BOOKED,
    });
    const svc = makeService(prisma);
    const out: any = await svc.trackOrder("shop-one", { phone: "+880 1711-111111", orderNumber: "ord-1234-ab" });
    expect(out.orderNumber).toBe("ORD-1234-AB");
    expect(out.status).toBe("processing");
    expect(out.currency).toBe("BDT");
    // EC28: items now carry their id (the self-service RMA builds
    // against the order's own lines) and the payload lists the
    // order's own return requests (none in this fixture).
    expect(out.items).toEqual([{ id: "it-1", name: "ওয়ালেট", quantity: 2, totalMinor: "100000" }]);
    expect(out.returnRequests).toEqual([]);
    expect(out.totalMinor).toBe("100000");
    expect(out.deliverySlot).toEqual({ label: "সকাল ৯টা–১২টা", startTime: "09:00", endTime: "12:00", date: "2026-10-14" });
    expect(out.steps).toEqual([
      { key: "placed", reached: true },
      { key: "confirmed", reached: true },
      { key: "packed", reached: true },
      { key: "shipped", reached: true },
      { key: "delivered", reached: false },
    ]);
    expect(out.fulfillment).toEqual({ status: "in_transit" });
    // No CourierShipment row: synthesized from the fulfillment.
    // EC22: no tracking template on the account => trackingUrl null.
    expect(out.shipment).toEqual({
      provider: "steadfast", trackingCode: "TRK-9", trackingUrl: null, status: "in_transit",
      bookedAt: BOOKED.toISOString(),
    });
    expect(out.shop).toEqual({
      name: "ShopOne", logoUrl: "logo.png", primaryColor: "#123456",
      supportPhone: "01899999999", returnPolicyText: "৭ দিনের রিটার্ন", deliveryPromiseText: "২৪ ঘণ্টায় ডেলিভারি",
    });
  });

  it("codDue reflects an APPROVED advance only — a pending one and other orders' rows are ignored", async () => {
    const prisma = seedWorld(makePrisma());
    const svc = makeService(prisma);
    const out: any = await svc.trackOrder("shop-one", { phone: "01711111111", orderNumber: "ORD-1234-AB" });
    expect(out.advancePaidMinor).toBe("30000");
    expect(out.codDueMinor).toBe("70000");
    // Also resolvable by externalId.
    const byId: any = await svc.trackOrder("shop-one", { phone: "01711111111", orderNumber: "native-xyz" });
    expect(byId.orderNumber).toBe("ORD-1234-AB");
  });

  it("a real CourierShipment row wins over synthesis and drives the delivered step", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.fulfillment.rows.push({
      id: "f1", organizationId: "org-1", orderId: "o1", status: "packed",
      courierProvider: null, trackingCode: null, createdAt: BOOKED,
    });
    prisma.courierShipment.rows.push({
      id: "s1", organizationId: "org-1", orderId: "o1", provider: "pathao",
      trackingCode: "PTH-1", status: "delivered", createdAt: BOOKED,
    });
    const svc = makeService(prisma);
    const out: any = await svc.trackOrder("shop-one", { phone: "01711111111", orderNumber: "ORD-1234-AB" });
    expect(out.shipment).toEqual({
      provider: "pathao", trackingCode: "PTH-1", trackingUrl: null, status: "delivered", bookedAt: BOOKED.toISOString(),
    });
    const steps = Object.fromEntries(out.steps.map((s: any) => [s.key, s.reached]));
    expect(steps).toEqual({ placed: true, confirmed: true, packed: true, shipped: true, delivered: true });
  });

  it("EC22: a courier tracking URL template on the account yields a substituted public trackingUrl", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.courierShipment.rows.push({
      id: "s1", organizationId: "org-1", orderId: "o1", provider: "pathao",
      trackingCode: "PTH 1/2", status: "in_transit", createdAt: BOOKED,
    });
    prisma.integration.rows.push({
      id: "int-1", organizationId: "org-1", provider: "pathao",
      trackingUrlTemplate: "https://courier.example/track/{trackingId}",
    });
    const svc = makeService(prisma);
    const out: any = await svc.trackOrder("shop-one", { phone: "01711111111", orderNumber: "ORD-1234-AB" });
    expect(out.shipment.trackingUrl).toBe("https://courier.example/track/PTH%201%2F2");
  });

  it("wrong phone and wrong number produce the IDENTICAL constant 404 message", async () => {
    const prisma = seedWorld(makePrisma());
    const svc = makeService(prisma);
    let msgPhone = ""; let msgNumber = "";
    await svc.trackOrder("shop-one", { phone: "01999999999", orderNumber: "ORD-1234-AB" })
      .catch((e) => { msgPhone = e.message; });
    await svc.trackOrder("shop-one", { phone: "01711111111", orderNumber: "ORD-XXXX-99" })
      .catch((e) => { msgNumber = e.message; });
    expect(msgPhone).toBe(NOT_FOUND_MSG);
    expect(msgNumber).toBe(NOT_FOUND_MSG);
    expect(msgPhone).toBe(msgNumber);
    await expect(svc.trackOrder("shop-one", { phone: "01999999999", orderNumber: "ORD-1234-AB" }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("trackingPageEnabled=false answers the same constant 404", async () => {
    const prisma = seedWorld(makePrisma(), { trackingPageEnabled: false });
    const svc = makeService(prisma);
    await expect(svc.trackOrder("shop-one", { phone: "01711111111", orderNumber: "ORD-1234-AB" }))
      .rejects.toThrow(NOT_FOUND_MSG);
  });

  it("the payload contains no address / phone / email keys or customer values anywhere", async () => {
    const prisma = seedWorld(makePrisma());
    const svc = makeService(prisma);
    const out: any = await svc.trackOrder("shop-one", { phone: "01711111111", orderNumber: "ORD-1234-AB" });
    const keys = deepKeys(out);
    expect(keys.has("address")).toBe(false);
    expect(keys.has("phone")).toBe(false);
    expect(keys.has("email")).toBe(false);
    expect(keys.has("customer")).toBe(false);
    const json = JSON.stringify(out);
    expect(json).not.toContain("01711111111");
    expect(json).not.toContain("rahim-secret@example.com");
    expect(json).not.toContain("গোপন ঠিকানা");
  });

  it("an order with no fulfillment/shipment/verifications reports honest early steps and full COD due", async () => {
    const prisma = seedWorld(makePrisma());
    prisma.order.rows[0].status = "pending";
    prisma.order.rows[0].deliverySlotId = null;
    prisma.paymentVerification.rows.length = 0;
    const svc = makeService(prisma);
    const out: any = await svc.trackOrder("shop-one", { phone: "01711111111", orderNumber: "ORD-1234-AB" });
    expect(out.steps).toEqual([
      { key: "placed", reached: true },
      { key: "confirmed", reached: false },
      { key: "packed", reached: false },
      { key: "shipped", reached: false },
      { key: "delivered", reached: false },
    ]);
    expect(out.fulfillment).toBeNull();
    expect(out.shipment).toBeNull();
    expect(out.deliverySlot).toBeNull();
    expect(out.advancePaidMinor).toBe("0");
    expect(out.codDueMinor).toBe("100000");
  });
});
