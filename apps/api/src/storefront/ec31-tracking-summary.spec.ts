import { StorefrontService } from "./storefront.service";

/* EC31: trackOrder gains installmentSummary for orders carrying
 * an ACTIVE installment plan. Fake prisma in the EC spec style
 * (self-contained copy, same as ec18-tracking.spec.ts). */
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
      if (!matchWhere(row, cond)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))[0] ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)),
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
  };
}
function makePrisma() {
  return {
    organization: makeTable(), storefrontSetting: makeTable(), businessProfile: makeTable(),
    category: makeTable(), product: makeTable(), productVariant: makeTable(), productImage: makeTable(),
    shippingZone: makeTable(), storeCart: makeTable(), storeCartItem: makeTable(),
    order: makeTable(), orderItem: makeTable(), fulfillment: makeTable(), courierShipment: makeTable(),
    paymentVerification: makeTable(), customer: makeTable(), deliverySlot: makeTable(), integration: makeTable(),
    returnRequest: makeTable(), pickupPoint: makeTable(),
    installmentPlan: makeTable(), installmentItem: makeTable(),
  } as any;
}

const PLACED = new Date("2026-10-12T08:00:00Z");

function seedWorld(prisma: any) {
  prisma.organization.rows.push({
    id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne",
    logoUrl: null, primaryColor: null, customDomain: null,
  });
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: null,
    trackingPageEnabled: true, supportPhone: null, returnPolicyText: null, deliveryPromiseText: null,
  });
  prisma.customer.rows.push({
    id: "c1", organizationId: "org-1", firstName: "রহিম", phone: "01711111111", email: null, address: null,
  });
  prisma.order.rows.push({
    id: "o1", organizationId: "org-1", customerId: "c1",
    externalId: "native-xyz", externalNumber: "ORD-1234-AB",
    source: "native_storefront", status: "processing", currency: "BDT",
    totalMinor: 100000n, placedAt: PLACED, createdAt: PLACED,
    deliverySlotId: null, deliveryDate: null, deliveryMethod: "home", pickupPointId: null,
  });
  prisma.orderItem.rows.push(
    { id: "it-1", orderId: "o1", productId: "p-a", name: "ফ্রিজ", quantity: 1, priceMinor: 100000n, totalMinor: 100000n },
  );
  return prisma;
}

function makeService(prisma: any) {
  return new StorefrontService(prisma, undefined, undefined, undefined, undefined, undefined);
}

const LOOKUP = { phone: "01711111111", orderNumber: "ORD-1234-AB" };

function seedPlan(prisma: any, status: string, items: Array<[number, string, bigint, bigint]>) {
  prisma.installmentPlan.rows.push({
    id: "plan-1", organizationId: "org-1", orderId: "o1",
    totalMinor: 100000n, installmentCount: items.length, intervalDays: 30,
    startDate: new Date(Date.UTC(2026, 9, 6)), status, createdById: "staff-1", note: null,
    createdAt: PLACED, updatedAt: PLACED,
  });
  for (const [seq, dueDay, amount, paid] of items) {
    const [y, m, d] = dueDay.split("-").map(Number);
    prisma.installmentItem.rows.push({
      id: `item-${seq}`, planId: "plan-1", seq,
      dueDate: new Date(Date.UTC(y, m - 1, d)),
      amountMinor: amount, paidMinor: paid, paidAt: paid >= amount ? PLACED : null,
      createdAt: PLACED, updatedAt: PLACED,
    });
  }
}

describe("EC31 StorefrontService.trackOrder installmentSummary", () => {
  it("summarizes an active plan: paid count, next due (Dhaka day + remaining), total remaining", async () => {
    const prisma = seedWorld(makePrisma());
    seedPlan(prisma, "active", [
      [1, "2026-10-06", 33334n, 33334n], // fully paid
      [2, "2026-11-05", 33333n, 10000n], // partial — the next due
      [3, "2026-12-05", 33333n, 0n],     // untouched
    ]);
    const svc = makeService(prisma);
    const out: any = await svc.trackOrder("shop-one", LOOKUP);
    expect(out.installmentSummary).toEqual({
      totalInstallments: 3,
      paidInstallments: 1,
      nextDueDate: "2026-11-05",
      nextDueAmountMinor: "23333",
      remainingMinor: "56666",
    });
  });

  it("is null when there is no plan at all", async () => {
    const prisma = seedWorld(makePrisma());
    const svc = makeService(prisma);
    const out: any = await svc.trackOrder("shop-one", LOOKUP);
    expect(out.installmentSummary).toBeNull();
  });

  it.each(["cancelled", "completed"])("is null for a %s plan (active plans only)", async (status) => {
    const prisma = seedWorld(makePrisma());
    seedPlan(prisma, status, [
      [1, "2026-10-06", 50000n, 50000n],
      [2, "2026-11-05", 50000n, 0n],
    ]);
    const svc = makeService(prisma);
    const out: any = await svc.trackOrder("shop-one", LOOKUP);
    expect(out.installmentSummary).toBeNull();
  });

  it("an active plan with everything paid reports zero remaining and no next due", async () => {
    const prisma = seedWorld(makePrisma());
    seedPlan(prisma, "active", [
      [1, "2026-10-06", 50000n, 50000n],
      [2, "2026-11-05", 50000n, 50000n],
    ]);
    const svc = makeService(prisma);
    const out: any = await svc.trackOrder("shop-one", LOOKUP);
    expect(out.installmentSummary).toEqual({
      totalInstallments: 2,
      paidInstallments: 2,
      nextDueDate: null,
      nextDueAmountMinor: null,
      remainingMinor: "0",
    });
  });

  it("never leaks another order's plan into the summary", async () => {
    const prisma = seedWorld(makePrisma());
    seedPlan(prisma, "active", [
      [1, "2026-10-06", 50000n, 0n],
      [2, "2026-11-05", 50000n, 0n],
    ]);
    // Move the plan to a different order — the summary must vanish.
    prisma.installmentPlan.rows[0].orderId = "someone-elses-order";
    const svc = makeService(prisma);
    const out: any = await svc.trackOrder("shop-one", LOOKUP);
    expect(out.installmentSummary).toBeNull();
  });
});
