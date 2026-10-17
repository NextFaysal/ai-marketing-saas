import "reflect-metadata";
import { DiscountsService } from "./discounts.service";
import { StorefrontService } from "../storefront/storefront.service";

/**
 * NF14 (FB5) — app-only offers. Fake-prisma harness in the
 * nf12/ec7 pattern (in-memory tables, org-scoped `matches`).
 *
 * The pinned honesty rule: `appOnly` is a DISPLAY flag. It
 * persists through the staff DTO/service, rides the staff and
 * public payloads, and is NEVER consulted by checkout discount
 * evaluation — validateForCheckout must answer identically for
 * appOnly true vs false.
 */

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.map(String).includes(String(row[k]));
      if ("notIn" in v) return !(v as any).notIn.map(String).includes(String(row[k]));
      if ("not" in v) return String(row[k]) !== String((v as any).not);
      return true;
    }
    return String(row[k]) === String(v);
  });
}

let seq = 0;
function makeTable(rows: Row[] = []) {
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
  const prisma: any = {
    storeDiscount: makeTable(),
    storeDiscountSync: makeTable(),
    store: makeTable(),
    product: makeTable(),
    category: makeTable(),
    order: makeTable(),
    organization: makeTable([
      { id: "org-1", name: "Org One", slug: "shop-one" },
      { id: "org-2", name: "Org Two", slug: "shop-two" },
    ]),
    storefrontSetting: makeTable([
      { id: "set-1", organizationId: "org-1", shopEnabled: true },
      { id: "set-2", organizationId: "org-2", shopEnabled: false },
    ]),
  };
  const outbox: any = { enqueue: async () => ({ id: "out-1" }) };
  const audit: any = { log: async () => undefined };
  const discounts = new DiscountsService(prisma, outbox, audit);
  const storefront = new StorefrontService(prisma);
  return { prisma, discounts, storefront };
}

function seedDiscount(prisma: any, over: Row = {}): Row {
  const row: Row = {
    id: over.id ?? `d-${++seq}`,
    organizationId: "org-1",
    code: "OFFER10",
    kind: "percent",
    value: 10,
    minOrderMinor: null,
    scopeType: "all",
    scopeIds: null,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    usedCount: 0,
    active: true,
    origin: "manual",
    appOnly: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
  prisma.storeDiscount.rows.push(row);
  return row;
}

describe("NF14 appOnly — staff persistence (DiscountsService)", () => {
  it("create persists appOnly=true and the staff payload includes it", async () => {
    const { discounts } = makeWorld();
    const out = await discounts.create("org-1", "user-1", {
      code: "APPONLY20", kind: "percent", value: 20, appOnly: true,
    });
    expect(out.discount.appOnly).toBe(true);
    const listed = await discounts.list("org-1");
    expect(listed.items.find((d: any) => d.code === "APPONLY20")?.appOnly).toBe(true);
    const one = await discounts.getOne("org-1", out.discount.id);
    expect(one.appOnly).toBe(true);
  });

  it("create defaults appOnly to false when the DTO omits it", async () => {
    const { prisma, discounts } = makeWorld();
    const out = await discounts.create("org-1", "user-1", {
      code: "PLAIN10", kind: "percent", value: 10,
    });
    expect(out.discount.appOnly).toBe(false);
    expect(prisma.storeDiscount.rows.find((r: any) => r.code === "PLAIN10").appOnly).toBe(false);
  });

  it("update flips appOnly both ways and persists it", async () => {
    const { prisma, discounts } = makeWorld();
    const created = await discounts.create("org-1", "user-1", {
      code: "FLIP10", kind: "percent", value: 10,
    });
    const on = await discounts.update("org-1", "user-1", created.discount.id, { appOnly: true });
    expect(on.discount.appOnly).toBe(true);
    const off = await discounts.update("org-1", "user-1", created.discount.id, { appOnly: false });
    expect(off.discount.appOnly).toBe(false);
    expect(prisma.storeDiscount.rows.find((r: any) => r.id === created.discount.id).appOnly).toBe(false);
  });

  it("update without appOnly leaves the stored flag untouched", async () => {
    const { discounts } = makeWorld();
    const created = await discounts.create("org-1", "user-1", {
      code: "KEEP10", kind: "percent", value: 10, appOnly: true,
    });
    const renamed = await discounts.update("org-1", "user-1", created.discount.id, { value: 15 });
    expect(renamed.discount.appOnly).toBe(true);
    expect(renamed.discount.value).toBe(15);
  });

  it("legacy rows (no appOnly field at all) serialize as appOnly=false", async () => {
    const { prisma, discounts } = makeWorld();
    const legacy = seedDiscount(prisma, { code: "LEGACY10" });
    delete legacy.appOnly; // a pre-NF14 row: the field simply isn't there
    const one = await discounts.getOne("org-1", legacy.id);
    expect(one.appOnly).toBe(false);
    const listed = await discounts.list("org-1");
    expect(listed.items.find((d: any) => d.id === legacy.id)?.appOnly).toBe(false);
  });
});

describe("NF14 appOnly — public offers payload (StorefrontService.publicOffers)", () => {
  it("includes appOnly per offer and only public-safe fields", async () => {
    const { prisma, storefront } = makeWorld();
    seedDiscount(prisma, { code: "WEB10", appOnly: false });
    seedDiscount(prisma, { code: "APP20", appOnly: true, value: 20 });
    const out = await storefront.publicOffers("shop-one");
    const byCode = new Map<string, any>(out.offers.map((o: any) => [o.code, o]));
    expect(byCode.get("WEB10")?.appOnly).toBe(false);
    expect(byCode.get("APP20")?.appOnly).toBe(true);
    expect(byCode.get("APP20")?.value).toBe(20);
    // No staff internals leak into the public payload.
    expect(byCode.get("APP20")).not.toHaveProperty("usedCount");
    expect(byCode.get("APP20")).not.toHaveProperty("scopeIds");
    expect(byCode.get("APP20")).not.toHaveProperty("organizationId");
  });

  it("excludes inactive, not-yet-started, expired and exhausted offers; other orgs never leak", async () => {
    const { prisma, storefront } = makeWorld();
    seedDiscount(prisma, { code: "LIVE10", appOnly: true });
    seedDiscount(prisma, { code: "OFF10", active: false });
    seedDiscount(prisma, { code: "FUTURE10", startsAt: new Date(Date.now() + 86400000) });
    seedDiscount(prisma, { code: "GONE10", endsAt: new Date(Date.now() - 86400000) });
    seedDiscount(prisma, { code: "FULL10", usageLimit: 3, usedCount: 3 });
    seedDiscount(prisma, { code: "OTHER10", organizationId: "org-2" });
    const out = await storefront.publicOffers("shop-one");
    expect(out.offers.map((o: any) => o.code)).toEqual(["LIVE10"]);
  });

  it("legacy rows in the public payload read appOnly=false", async () => {
    const { prisma, storefront } = makeWorld();
    const legacy = seedDiscount(prisma, { code: "OLD10" });
    delete legacy.appOnly;
    const out = await storefront.publicOffers("shop-one");
    expect(out.offers.find((o: any) => o.code === "OLD10")?.appOnly).toBe(false);
  });

  it("a shop that is not enabled answers 404, offers included", async () => {
    const { storefront } = makeWorld();
    await expect(storefront.publicOffers("shop-two")).rejects.toMatchObject({ status: 404 });
    await expect(storefront.publicOffers("no-such-shop")).rejects.toMatchObject({ status: 404 });
  });
});

describe("NF14 appOnly — checkout evaluation is UNAFFECTED (display-only flag)", () => {
  const ctx = {
    subtotalMinor: 10000n,
    items: [{ productId: "p1", categoryId: "c1", totalMinor: 10000n }],
  };

  it("validateForCheckout answers identically for appOnly true vs false", async () => {
    const { prisma, discounts } = makeWorld();
    seedDiscount(prisma, { code: "SAME10", appOnly: false });
    const webResult = await discounts.validateForCheckout("org-1", "SAME10", ctx);
    const row = prisma.storeDiscount.rows.find((r: any) => r.code === "SAME10");
    row.appOnly = true;
    const appResult = await discounts.validateForCheckout("org-1", "SAME10", ctx);
    // The EVALUATION (valid / reason / amounts) must be identical.
    // The result also echoes the discount row itself, whose
    // appOnly field of course differs — that echo is metadata,
    // not evaluation, so it is compared field-wise here.
    const outcome = (v: any) => ({
      valid: v.valid, reason: v.reason ?? null,
      discountMinor: v.discountMinor, freeShipping: v.freeShipping,
    });
    expect(outcome(appResult)).toEqual(outcome(webResult));
    expect(appResult.valid).toBe(true);
    expect(appResult.discountMinor).toBe(1000n);
  });

  it("an appOnly code still redeems normally (the shared-code honesty rule)", async () => {
    const { prisma, discounts } = makeWorld();
    seedDiscount(prisma, { code: "SHARED25", kind: "percent", value: 25, appOnly: true });
    const v = await discounts.validateForCheckout("org-1", "SHARED25", ctx);
    expect(v.valid).toBe(true);
    expect(v.discountMinor).toBe(2500n);
  });
});
