import { BadRequestException, NotFoundException } from "@nestjs/common";
import { validate } from "class-validator";
import { SocialProofService } from "./social-proof.service";
import { UpdateSocialProofSettingDto } from "./social-proof.dto";

/* Fake prisma (neighbouring EC/GB spec style, self-contained):
 * equality + `in` matching, { increment } update support. */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) {
        if (!cond.in.includes(row[k])) return false;
        continue;
      }
      if (!matchWhere(row, cond)) return false;
    } else if (row[k] !== v) {
      return false;
    }
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
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      for (const [k, v] of Object.entries(data)) {
        if (v !== null && typeof v === "object" && "increment" in (v as any)) {
          row[k] = Number(row[k] ?? 0) + Number((v as any).increment);
        } else {
          row[k] = v;
        }
      }
      return row;
    },
  };
}

function makePrisma() {
  return {
    organization: makeTable(),
    socialProofSetting: makeTable(),
    order: makeTable(),
    orderItem: makeTable(),
    courierShipment: makeTable(),
    customer: makeTable(),
  };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000);

function seed() {
  const prisma: any = makePrisma();
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new SocialProofService(prisma, audit as any);
  prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One" });
  return { prisma, audit, svc };
}

function addSetting(prisma: any, over: any = {}) {
  const row = {
    id: "sps-1", organizationId: "org-1", enabled: true,
    lookbackHours: 24, intervalSec: 25, displaySec: 6, maxPerSession: 5,
    minTotalMinor: null, impressions: 0, ...over,
  };
  prisma.socialProofSetting.rows.push(row);
  return row;
}

let orderSeq = 0;
function addOrder(prisma: any, over: any = {}) {
  const n = ++orderSeq;
  const customer = {
    id: `cust-${n}`, organizationId: "org-1",
    firstName: "Abdul Karim", lastName: "Rahman",
    phone: "01712345678", email: "abdul@example.com",
    address: { district: "Khulna", address_1: "House 1, Sonadanga" },
    ...(over.customer ?? {}),
  };
  prisma.customer.rows.push(customer);
  const order = {
    id: `order-${n}`, organizationId: "org-1", customerId: customer.id,
    externalId: `ext-${9000 + n}`, externalNumber: `WC-${9000 + n}`,
    status: "completed", isPractice: false,
    totalMinor: 250000n, placedAt: hoursAgo(2), createdAt: hoursAgo(2),
    address: null,
    ...(over.order ?? {}),
  };
  if (over.customerRelation) order.customer = customer;
  prisma.order.rows.push(order);
  const itemNames: string[] = over.items ?? ["পাঞ্জাবি প্রিমিয়াম"];
  itemNames.forEach((name, i) => {
    prisma.orderItem.rows.push({ id: `item-${n}-${i}`, orderId: order.id, name, quantity: 1 });
  });
  for (const s of over.shipments ?? []) {
    prisma.courierShipment.rows.push({ id: `ship-${n}-${s}`, orderId: order.id, status: s });
  }
  return { order, customer };
}

describe("AB7 (AX17) social-proof — public feed", () => {
  it("no setting row → exactly { enabled: false }", async () => {
    const { svc } = seed();
    expect(await svc.getPublicFeed("shop-one")).toEqual({ enabled: false });
  });

  it("setting row with enabled=false → exactly { enabled: false }", async () => {
    const { prisma, svc } = seed();
    addSetting(prisma, { enabled: false });
    expect(await svc.getPublicFeed("shop-one")).toEqual({ enabled: false });
  });

  it("unknown slug → 404", async () => {
    const { svc } = seed();
    const err = await svc.getPublicFeed("no-such-shop").catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getStatus()).toBe(404);
  });

  it("enabled with no orders → enabled + config + empty items", async () => {
    const { prisma, svc } = seed();
    addSetting(prisma, { intervalSec: 40, displaySec: 9, maxPerSession: 3 });
    expect(await svc.getPublicFeed("shop-one")).toEqual({
      enabled: true,
      config: { intervalSec: 40, displaySec: 9, maxPerSession: 3 },
      items: [],
    });
  });

  it("items carry EXACTLY the four keys, anonymized", async () => {
    const { prisma, svc } = seed();
    addSetting(prisma);
    const { order, customer } = addOrder(prisma, { order: { placedAt: hoursAgo(3.5), createdAt: hoursAgo(3.5) } });
    const feed: any = await svc.getPublicFeed("shop-one");
    expect(feed.enabled).toBe(true);
    expect(feed.items).toHaveLength(1);
    const item = feed.items[0];
    expect(Object.keys(item).sort()).toEqual(["buyerFirstName", "district", "hoursAgo", "productName"]);
    expect(item).toEqual({
      buyerFirstName: "Abdul", // "Abdul Karim" → first token ONLY
      district: "Khulna",
      productName: "পাঞ্জাবি প্রিমিয়াম",
      hoursAgo: 3,
    });
    const raw = JSON.stringify(feed);
    expect(raw).not.toContain("Karim"); // full name never leaks
    expect(raw).not.toContain("Rahman");
    expect(raw).not.toContain("01712345678"); // phone
    expect(raw).not.toContain(order.externalNumber); // order number
    expect(raw).not.toContain(order.externalId);
    expect(raw).not.toContain(order.id);
    expect(raw).not.toContain(customer.id);
    expect(raw).not.toContain("250000"); // amount
    expect(raw).not.toContain("abdul@example.com");
  });

  it("productName is the FIRST order item's snapshot name", async () => {
    const { prisma, svc } = seed();
    addSetting(prisma);
    addOrder(prisma, { items: ["প্রথম পণ্য", "দ্বিতীয় পণ্য"] });
    const feed: any = await svc.getPublicFeed("shop-one");
    expect(feed.items[0].productName).toBe("প্রথম পণ্য");
  });

  it("sold set is the canonical EC33 definition", async () => {
    const { prisma, svc } = seed();
    addSetting(prisma);
    addOrder(prisma, { order: { status: "completed" } }); // sold by status
    addOrder(prisma, { order: { status: "processing" }, shipments: ["delivered"] }); // sold by shipment
    addOrder(prisma, { order: { status: "processing" } }); // NOT sold
    addOrder(prisma, { order: { status: "cancelled" }, shipments: ["delivered"] }); // dead — never sold
    addOrder(prisma, { order: { status: "refunded" } }); // dead
    addOrder(prisma, { order: { status: "completed", isPractice: true } }); // practice — excluded
    const feed: any = await svc.getPublicFeed("shop-one");
    expect(feed.items).toHaveLength(2);
  });

  it("lookback window excludes older orders", async () => {
    const { prisma, svc } = seed();
    addSetting(prisma, { lookbackHours: 24 });
    addOrder(prisma, { order: { placedAt: hoursAgo(30), createdAt: hoursAgo(30) } });
    addOrder(prisma, { order: { placedAt: hoursAgo(1), createdAt: hoursAgo(1) } });
    const feed: any = await svc.getPublicFeed("shop-one");
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].hoursAgo).toBe(1);
  });

  it("minTotalMinor filters below-threshold orders", async () => {
    const { prisma, svc } = seed();
    addSetting(prisma, { minTotalMinor: 200000n });
    addOrder(prisma, { order: { totalMinor: 150000n } });
    addOrder(prisma, { order: { totalMinor: 200000n } }); // boundary: >= counts
    addOrder(prisma, { order: { totalMinor: 999999n } });
    const feed: any = await svc.getPublicFeed("shop-one");
    expect(feed.items).toHaveLength(2);
  });

  it("caps at 10, newest first", async () => {
    const { prisma, svc } = seed();
    addSetting(prisma, { lookbackHours: 168 });
    for (let h = 12; h >= 1; h--) {
      addOrder(prisma, { order: { placedAt: hoursAgo(h), createdAt: hoursAgo(h) } });
    }
    const feed: any = await svc.getPublicFeed("shop-one");
    expect(feed.items).toHaveLength(10);
    expect(feed.items.map((i: any) => i.hoursAgo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("district: free-text order address parses via parseBdAddress; unknown → null", async () => {
    const { prisma, svc } = seed();
    addSetting(prisma);
    addOrder(prisma, {
      customer: { address: null },
      order: { address: "House 5, Sylhet district, Bangladesh" },
    });
    addOrder(prisma, {
      customer: { address: null },
      order: { address: "House 12, Road 3, Block B" },
    });
    const feed: any = await svc.getPublicFeed("shop-one");
    expect(feed.items).toHaveLength(2);
    expect(feed.items.find((i: any) => i.district === "Sylhet")).toBeTruthy();
    expect(feed.items.some((i: any) => i.district === null)).toBe(true);
  });

  it("failure isolation: a broken order read degrades to empty items, not a 500", async () => {
    const { prisma, svc } = seed();
    addSetting(prisma, { intervalSec: 30 });
    prisma.order.findMany = async () => { throw new Error("db down"); };
    expect(await svc.getPublicFeed("shop-one")).toEqual({
      enabled: true,
      config: { intervalSec: 30, displaySec: 6, maxPerSession: 5 },
      items: [],
    });
  });

  it("orders without a buyer name or a first item are skipped, never padded", async () => {
    const { prisma, svc } = seed();
    addSetting(prisma);
    addOrder(prisma, { customer: { firstName: null } });
    addOrder(prisma, { items: [] });
    addOrder(prisma, {});
    const feed: any = await svc.getPublicFeed("shop-one");
    expect(feed.items).toHaveLength(1);
  });
});

describe("AB7 (AX17) social-proof — impressions", () => {
  it("increments only when a setting row exists; always { ok: true }", async () => {
    const { prisma, svc } = seed();
    const row = addSetting(prisma, { impressions: 4 });
    expect(await svc.recordImpression("shop-one")).toEqual({ ok: true });
    expect(await svc.recordImpression("shop-one")).toEqual({ ok: true });
    expect(row.impressions).toBe(6);
  });

  it("no row → no-op, no row created; unknown slug → still ok", async () => {
    const { prisma, svc } = seed();
    expect(await svc.recordImpression("shop-one")).toEqual({ ok: true });
    expect(await svc.recordImpression("no-such-shop")).toEqual({ ok: true });
    expect(prisma.socialProofSetting.rows).toHaveLength(0);
  });
});

describe("AB7 (AX17) social-proof — staff setting", () => {
  it("GET with no row returns the schema defaults, minTotalMinor null", async () => {
    const { svc } = seed();
    expect(await svc.getSetting("org-1")).toEqual({
      setting: {
        organizationId: "org-1", enabled: false, lookbackHours: 24,
        intervalSec: 25, displaySec: 6, maxPerSession: 5,
        minTotalMinor: null, impressions: 0,
      },
    });
  });

  it("PUT upserts, audits, and BigInt minTotalMinor round-trips as a string", async () => {
    const { prisma, audit, svc } = seed();
    const out = await svc.updateSetting("org-1", "user-1", {
      enabled: true, lookbackHours: 48, minTotalMinor: "150000",
    });
    expect(out.setting).toMatchObject({ enabled: true, lookbackHours: 48, minTotalMinor: "150000" });
    expect(prisma.socialProofSetting.rows).toHaveLength(1);
    expect(prisma.socialProofSetting.rows[0].minTotalMinor).toBe(150000n);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "social_proof.setting_updated", entityType: "SocialProofSetting" }),
    );
    // Second PUT updates the same row; null clears the threshold.
    const out2 = await svc.updateSetting("org-1", "user-1", { minTotalMinor: null, intervalSec: 60 });
    expect(prisma.socialProofSetting.rows).toHaveLength(1);
    expect(out2.setting.minTotalMinor).toBeNull();
    expect(out2.setting.intervalSec).toBe(60);
    expect((await svc.getSetting("org-1")).setting.minTotalMinor).toBeNull();
  });

  it("PUT rejects out-of-range values and malformed minTotalMinor", async () => {
    const { svc } = seed();
    const bad: any[] = [
      { lookbackHours: 0 }, { lookbackHours: 169 }, { lookbackHours: 2.5 },
      { intervalSec: 4 }, { intervalSec: 301 },
      { displaySec: 1 }, { displaySec: 31 },
      { maxPerSession: 0 }, { maxPerSession: 21 },
      { minTotalMinor: "-5" }, { minTotalMinor: "abc" }, { minTotalMinor: "10.5" }, { minTotalMinor: "" },
      { enabled: "yes" },
    ];
    for (const dto of bad) {
      await expect(svc.updateSetting("org-1", "user-1", dto)).rejects.toBeInstanceOf(BadRequestException);
    }
    // Boundary values are accepted.
    await expect(svc.updateSetting("org-1", "user-1", {
      lookbackHours: 1, intervalSec: 5, displaySec: 2, maxPerSession: 1, minTotalMinor: "0",
    })).resolves.toBeTruthy();
    await expect(svc.updateSetting("org-1", "user-1", {
      lookbackHours: 168, intervalSec: 300, displaySec: 30, maxPerSession: 20,
    })).resolves.toBeTruthy();
  });

  it("DTO carries the same ranges for the ValidationPipe", async () => {
    const mk = (over: any) => Object.assign(new UpdateSocialProofSettingDto(), over);
    expect(await validate(mk({ lookbackHours: 0 }))).not.toHaveLength(0);
    expect(await validate(mk({ intervalSec: 301 }))).not.toHaveLength(0);
    expect(await validate(mk({ displaySec: 31 }))).not.toHaveLength(0);
    expect(await validate(mk({ maxPerSession: 21 }))).not.toHaveLength(0);
    expect(await validate(mk({ minTotalMinor: "12.5" }))).not.toHaveLength(0);
    expect(await validate(mk({ enabled: true, lookbackHours: 24, minTotalMinor: "150000" }))).toHaveLength(0);
    expect(await validate(mk({ minTotalMinor: null }))).toHaveLength(0);
  });
});
