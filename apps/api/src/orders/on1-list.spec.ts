import "reflect-metadata";
import { OrdersService } from "./orders.service";

/** ON1 — list v2 filters + paymentState + batch due fields. */

function matchWhere(row: any, where: any): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    const val = (row as any)[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c: any = cond;
      if ("in" in c && !c.in.map(String).includes(String(val))) return false;
      if ("notIn" in c && c.notIn.map(String).includes(String(val))) return false;
      continue;
    }
    if (String(val) !== String(cond)) return false;
  }
  return true;
}

function setup() {
  const base = { organizationId: "org-1", isPractice: false, isCod: false, codConfirmationStatus: null, customer: null, items: [], subtotalMinor: 0n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, refundedMinor: 0n, tags: null as any, assigneeId: null as any, address: null as any };
  const orders: any[] = [
    { ...base, id: "a", status: "processing", source: "woocommerce", externalNumber: "1001", externalId: "w1", totalMinor: 1000n, placedAt: new Date("2026-10-01T10:00:00Z"), createdAt: new Date("2026-10-01T10:00:00Z"), tags: ["vip"], assigneeId: "u-9", customer: { firstName: "Rahim", lastName: "Uddin", phone: "01711000001", address: { address_1: "Road 1", district: "Dhaka" } } },
    { ...base, id: "b", status: "completed", source: "manual", externalNumber: "1002", externalId: "m2", totalMinor: 2000n, placedAt: new Date("2026-10-03T10:00:00Z"), createdAt: new Date("2026-10-03T10:00:00Z"), customer: { firstName: "Karim", lastName: "Islam", phone: "01711000002", address: { address_1: "Road 2", district: "Khulna" } } },
    { ...base, id: "c", status: "pending", source: "woocommerce", externalNumber: "1003", externalId: "w3", totalMinor: 1500n, placedAt: null, createdAt: new Date("2026-10-02T10:00:00Z"), customer: { firstName: "Selina", lastName: "Akter", phone: "01711000003", address: { address_1: "Road 3", district: "Dhaka" } } },
    { ...base, id: "d", status: "pending", source: "landing", externalNumber: "1004", externalId: "l4", totalMinor: 0n, placedAt: new Date("2026-10-04T10:00:00Z"), createdAt: new Date("2026-10-04T10:00:00Z"), customer: { firstName: "Tanvir", lastName: "Hasan", phone: "01711000004", address: null } },
    { ...base, id: "e", status: "pending", source: "woocommerce", externalNumber: "1005", externalId: "w5", totalMinor: 800n, placedAt: new Date("2026-10-05T10:00:00Z"), createdAt: new Date("2026-10-05T10:00:00Z"), address: "Sonadanga, Khulna", customer: { firstName: "Mim", lastName: "Chowdhury", phone: "01711000005", address: { address_1: "Road 5", district: "Barisal" } } },
  ];
  const verifications: any[] = [
    { organizationId: "org-1", orderId: "a", status: "approved", amountMinor: 1000n },
    { organizationId: "org-1", orderId: "b", status: "approved", amountMinor: 2000n },
    { organizationId: "org-1", orderId: "c", status: "approved", amountMinor: 500n },
    { organizationId: "org-1", orderId: "c", status: "pending", amountMinor: 900n },
  ];
  const shipments: any[] = [
    { id: "s1", organizationId: "org-1", orderId: "c", provider: "steadfast", status: "in_transit" },
    { id: "s2", organizationId: "org-1", orderId: "a", provider: "pathao", status: "delivered" },
  ];
  const prisma: any = {
    order: {
      findMany: jest.fn(async (args: any = {}) => {
        let rows = orders.filter((r) => matchWhere(r, args.where));
        if (args.orderBy?.placedAt === "desc") rows = [...rows].sort((x, y) => new Date(y.placedAt ?? y.createdAt ?? 0).getTime() - new Date(x.placedAt ?? x.createdAt ?? 0).getTime());
        if (args.skip) rows = rows.slice(args.skip);
        if (args.take) rows = rows.slice(0, args.take);
        return rows;
      }),
      count: jest.fn(async ({ where }: any = {}) => orders.filter((r) => matchWhere(r, where)).length),
      findFirst: jest.fn(async ({ where }: any = {}) => orders.find((r) => matchWhere(r, where)) ?? null),
    },
    courierShipment: { findMany: jest.fn(async ({ where }: any = {}) => shipments.filter((r) => matchWhere(r, where))) },
    paymentVerification: {
      groupBy: jest.fn(async ({ where }: any) => {
        const sums = new Map<string, bigint>();
        for (const v of verifications.filter((r) => r.organizationId === where.organizationId && r.status === where.status && (where.orderId?.in ?? []).map(String).includes(String(r.orderId)))) {
          sums.set(String(v.orderId), (sums.get(String(v.orderId)) ?? 0n) + BigInt(v.amountMinor ?? 0));
        }
        return [...sums.entries()].map(([orderId, s]) => ({ orderId, _sum: { amountMinor: s } }));
      }),
      findMany: jest.fn(async () => []),
    },
  };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new OrdersService(prisma, undefined, undefined, audit as any);
  return { svc, prisma };
}

const ids = (out: any) => out.items.map((i: any) => i.id);

describe("ON1 list v2", () => {
  it("legacy call keeps the {total,page,pageSize,items} shape and totals", async () => {
    const { svc } = setup();
    const out = await svc.list("org-1", {});
    expect(out.total).toBe(5);
    expect(out.page).toBe(1);
    expect(typeof out.items[0].totalMinor).toBe("string");
  });

  it("paymentState: paid (incl. zero-total), partial, due — one groupBy, no N+1", async () => {
    const { svc, prisma } = setup();
    expect(ids(await svc.list("org-1", { paymentState: "paid", pageSize: 100 })).sort()).toEqual(["a", "b", "d"]);
    expect(ids(await svc.list("org-1", { paymentState: "partial", pageSize: 100 }))).toEqual(["c"]);
    expect(ids(await svc.list("org-1", { paymentState: "due", pageSize: 100 }))).toEqual(["e"]);
    // groupBy is called once per list call (page enrichment + filter), never per row count beyond that.
    expect((prisma.paymentVerification.groupBy as jest.Mock).mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("rows carry batch advance/due + tags + assignee", async () => {
    const { svc } = setup();
    const out = await svc.list("org-1", { search: "1003" });
    const row = out.items[0];
    expect(row.advancePaidMinor).toBe("500");
    expect(row.amountDueMinor).toBe("1000");
    const a = (await svc.list("org-1", { tag: "vip" })).items[0];
    expect(a.tags).toEqual(["vip"]);
    expect(a.assigneeId).toBe("u-9");
  });

  it("district matches customer.address.district OR the order address string", async () => {
    const { svc } = setup();
    expect(ids(await svc.list("org-1", { district: "dhaka", pageSize: 100 })).sort()).toEqual(["a", "c"]);
    expect(ids(await svc.list("org-1", { district: "Khulna", pageSize: 100 })).sort()).toEqual(["b", "e"]);
  });

  it("provider, source, assignee, tag filters", async () => {
    const { svc } = setup();
    expect(ids(await svc.list("org-1", { provider: "steadfast" }))).toEqual(["c"]);
    expect(ids(await svc.list("org-1", { source: "manual" }))).toEqual(["b"]);
    expect(ids(await svc.list("org-1", { assigneeId: "u-9" }))).toEqual(["a"]);
    expect(ids(await svc.list("org-1", { tag: "vip" }))).toEqual(["a"]);
  });

  it("search covers number, external id, name and phone, AND-composed", async () => {
    const { svc } = setup();
    expect(ids(await svc.list("org-1", { search: "rahim" }))).toEqual(["a"]);
    expect(ids(await svc.list("org-1", { search: "01711000003" }))).toEqual(["c"]);
    expect(ids(await svc.list("org-1", { search: "1005" }))).toEqual(["e"]);
    expect(ids(await svc.list("org-1", { search: "rahim", source: "manual" }))).toEqual([]);
  });

  it("date range uses placedAt ?? createdAt in Dhaka days", async () => {
    const { svc } = setup();
    expect(ids(await svc.list("org-1", { dateFrom: "2026-10-02", dateTo: "2026-10-02" }))).toEqual(["c"]);
    expect(ids(await svc.list("org-1", { dateFrom: "2026-10-02", dateTo: "2026-10-03", pageSize: 100 })).sort()).toEqual(["b", "c"]);
    await expect(svc.list("org-1", { dateFrom: "2026-10-03", dateTo: "2026-10-02" })).rejects.toThrow(/dateFrom/);
  });

  it("min/max total + sorts", async () => {
    const { svc } = setup();
    expect(ids(await svc.list("org-1", { minTotal: "1000", maxTotal: "1500", pageSize: 100 })).sort()).toEqual(["a", "c"]);
    expect(ids(await svc.list("org-1", { sort: "total_desc", pageSize: 100 }))).toEqual(["b", "c", "a", "e", "d"]);
    expect(ids(await svc.list("org-1", { sort: "total_asc", pageSize: 100 }))).toEqual(["d", "e", "a", "c", "b"]);
    expect(ids(await svc.list("org-1", { sort: "placedAt_asc", pageSize: 100 }))).toEqual(["a", "c", "b", "d", "e"]);
    await expect(svc.list("org-1", { sort: "bogus" })).rejects.toThrow(/sort/);
    await expect(svc.list("org-1", { paymentState: "bogus" })).rejects.toThrow(/paymentState/);
  });

  it("tags: replace semantics, validation, audit; assign: ACTIVE membership gate", async () => {
    const { svc, prisma } = setup();
    (prisma as any).order.update = jest.fn(async ({ where, data }: any) => {
      const row = (await prisma.order.findFirst({ where: { id: where.id } })); Object.assign(row, data); return row;
    });
    (prisma as any).membership = { findFirst: jest.fn(async ({ where }: any) => (where.userId === "u-9" ? { userId: "u-9", role: "SUPPORT_AGENT", status: "ACTIVE" } : null)) };
    const out = await svc.setTags("org-1", "actor", "a", [" vip ", "vip", "urgent"]);
    expect(out.tags).toEqual(["vip", "urgent"]);
    await expect(svc.setTags("org-1", "actor", "a", Array.from({ length: 11 }, (_, i) => `t${i}`))).rejects.toThrow(/১০টি/);
    await expect(svc.setTags("org-1", "actor", "missing", ["x"])).rejects.toThrow("Order not found in this organization");
    await expect(svc.assignOrder("org-1", "actor", "a", "ghost")).rejects.toThrow(/সক্রিয় সদস্য নন/);
    const assigned = await svc.assignOrder("org-1", "actor", "a", "u-9");
    expect(assigned.assigneeId).toBe("u-9");
    const cleared = await svc.assignOrder("org-1", "actor", "a", null);
    expect(cleared.assigneeId).toBeNull();
  });

  it("saved views: own-only, whitelist validation, queue validation", async () => {
    const { svc, prisma } = setup();
    const store: any[] = [];
    (prisma as any).orderSavedView = {
      findMany: jest.fn(async ({ where }: any) => store.filter((r) => r.organizationId === where.organizationId && r.userId === where.userId)),
      create: jest.fn(async ({ data }: any) => { const row = { id: `v${store.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data }; store.push(row); return row; }),
      findFirst: jest.fn(async ({ where }: any) => store.find((r) => r.id === where.id && r.organizationId === where.organizationId && r.userId === where.userId) ?? null),
      delete: jest.fn(async ({ where }: any) => { const i = store.findIndex((r) => r.id === where.id); store.splice(i, 1); return {}; }),
    };
    const view = await svc.createSavedView("org-1", "u-1", { name: "আমার ভিউ", queue: "all_open", filters: { status: "processing", sort: "total_desc" } });
    expect(view.name).toBe("আমার ভিউ");
    await expect(svc.createSavedView("org-1", "u-1", { name: "x", filters: { evil: 1 } })).rejects.toThrow(/অজানা filter/);
    await expect(svc.createSavedView("org-1", "u-1", { name: "x", queue: "bogus" })).rejects.toThrow(/অজানা কিউ/);
    await expect(svc.createSavedView("org-1", "u-1", { name: " " })).rejects.toThrow(/নাম/);
    expect(await svc.listSavedViews("org-1", "u-2")).toEqual([]);
    await expect(svc.deleteSavedView("org-1", "u-2", view.id)).rejects.toThrow("Saved view not found");
    expect((await svc.deleteSavedView("org-1", "u-1", view.id)).deleted).toBe(true);
  });

  it("feed: since validation, created vs updated kinds, practice excluded, cap shape", async () => {
    const { svc } = setup();
    await expect(svc.feed("org-1")).rejects.toThrow(/since/);
    await expect(svc.feed("org-1", "not-a-date")).rejects.toThrow(/since/);
    const feed = await svc.feed("org-1", "2026-10-03T00:00:00.000Z");
    // c created 10-02 (no), b/d/e created after -> created kind
    expect(feed.map((f: any) => f.id).sort()).toEqual(["b", "d", "e"]);
    expect(feed.every((f: any) => f.changeKind === "created")).toBe(true);
    expect(typeof feed[0].totalMinor).toBe("string");
  });
});
