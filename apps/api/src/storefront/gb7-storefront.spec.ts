import { BadRequestException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { StorefrontService } from "./storefront.service";
import { TRACKING_FIELDS, validateTrackingValue } from "./tracking";

/* Fake prisma in the storefront.spec.ts harness style: equality,
 * { in }, { not }, { gte/lte }, { contains, mode }, OR/AND,
 * orderBy (single or array), skip/take. */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (k === "AND") {
      if (!(v as any[]).every((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) {
        if (!cond.in.includes(row[k])) return false;
        continue;
      }
      if ("not" in cond) {
        if (row[k] === cond.not) return false;
        continue;
      }
      if ("gte" in cond || "lte" in cond) {
        if (row[k] === null || row[k] === undefined) return false;
        const t = new Date(row[k]).getTime();
        if ("gte" in cond && t < new Date(cond.gte).getTime()) return false;
        if ("lte" in cond && t > new Date(cond.lte).getTime()) return false;
        continue;
      }
      if ("contains" in cond) {
        const hay = String(row[k] ?? "");
        const needle = String(cond.contains);
        const hit =
          cond.mode === "insensitive"
            ? hay.toLowerCase().includes(needle.toLowerCase())
            : hay.includes(needle);
        if (!hit) return false;
        continue;
      }
      if (!matchWhere(row, cond)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) {
      return false;
    }
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
        const av = a[field];
        const bv = b[field];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp =
          av instanceof Date || bv instanceof Date
            ? new Date(av).getTime() - new Date(bv).getTime()
            : av < bv
              ? -1
              : 1;
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
    organization: makeTable(),
    storefrontSetting: makeTable(),
    businessProfile: makeTable(),
    category: makeTable(),
    product: makeTable(),
    productVariant: makeTable(),
    productImage: makeTable(),
    promotion: makeTable(),
  } as any;
}

const HOUR = 3600 * 1000;
const T0 = new Date("2026-10-01T00:00:00Z");

function seedWorld(prisma: any) {
  prisma.organization.rows.push(
    {
      id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne",
      logoUrl: null, primaryColor: "#111111", customDomain: null,
    },
    // org-3: a real org with NO StorefrontSetting row.
    { id: "org-3", slug: "shop-off", name: "Closed Shop", brandName: null, logoUrl: null, primaryColor: null, customDomain: null },
  );
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: null,
    announcementText: null, showFeatured: true, showCategories: true, showSearch: true,
    metaDescription: null, featuredProductIds: null, domainVerifyToken: null,
    domainVerifiedAt: null, createdAt: T0, updatedAt: T0,
  });
  prisma.businessProfile.rows.push({
    id: "bp-1", organizationId: "org-1", codAvailable: true, bkashNumber: null,
    nagadNumber: null, paymentNote: null,
  });
  prisma.category.rows.push({
    id: "cat-1", organizationId: "org-1", name: "Wallets", slug: "wallets", createdAt: T0, updatedAt: T0,
  });
  const base = {
    description: null, category: null, sku: null, status: "ACTIVE", currency: "BDT",
    stockQuantity: null, lowStockThreshold: null, imageUrl: null, bumpTitle: null,
    bumpPriceMinor: null, bumpImageUrl: null, seoTitle: null, seoDescription: null, updatedAt: T0,
  };
  prisma.product.rows.push(
    { ...base, id: "p-a", organizationId: "org-1", name: "লেদার ওয়ালেট", slug: "leather-wallet", categoryId: "cat-1", priceMinor: 50000n, compareAtMinor: null, createdAt: new Date("2026-10-02") },
    { ...base, id: "p-b", organizationId: "org-1", name: "ক্যানভাস ব্যাগ", slug: "canvas-bag", categoryId: null, priceMinor: 120000n, compareAtMinor: null, createdAt: new Date("2026-10-03") },
    { ...base, id: "p-c", organizationId: "org-1", name: "কার্ড হোল্ডার", slug: "card-holder", categoryId: "cat-1", priceMinor: 30000n, compareAtMinor: null, createdAt: new Date("2026-10-04") },
    { ...base, id: "p-draft", organizationId: "org-1", name: "খসড়া পণ্য", slug: "draft-item", categoryId: "cat-1", status: "DRAFT", priceMinor: 1000n, compareAtMinor: null, createdAt: new Date("2026-10-05") },
  );
  return prisma;
}

function seedFlashSales(prisma: any) {
  const now = Date.now();
  const past = new Date(now - HOUR);
  const future = new Date(now + 2 * HOUR);
  prisma.promotion.rows.push(
    { id: "flash-1", organizationId: "org-1", name: "ঈদ ফ্ল্যাশ সেল", type: "flash", active: true, priority: 10, config: { percentOff: 20, productIds: ["p-a"] }, startsAt: past, endsAt: future, createdAt: T0, updatedAt: T0 },
    { id: "flash-cat", organizationId: "org-1", name: "ওয়ালেট সেল", type: "flash", active: true, priority: 5, config: { percentOff: 10, categoryIds: ["cat-1"] }, startsAt: null, endsAt: future, createdAt: T0, updatedAt: T0 },
    { id: "flash-expired", organizationId: "org-1", name: "মেয়াদ শেষ", type: "flash", active: true, priority: 9, config: { percentOff: 50, productIds: ["p-b"] }, startsAt: new Date(now - 3 * HOUR), endsAt: new Date(now - HOUR), createdAt: T0, updatedAt: T0 },
    { id: "flash-future", organizationId: "org-1", name: "আসছে", type: "flash", active: true, priority: 9, config: { percentOff: 50, productIds: ["p-b"] }, startsAt: future, endsAt: new Date(now + 5 * HOUR), createdAt: T0, updatedAt: T0 },
    { id: "flash-inactive", organizationId: "org-1", name: "বন্ধ", type: "flash", active: false, priority: 9, config: { percentOff: 50, productIds: ["p-b"] }, startsAt: past, endsAt: future, createdAt: T0, updatedAt: T0 },
    { id: "flash-no-end", organizationId: "org-1", name: "শেষ নেই", type: "flash", active: true, priority: 9, config: { percentOff: 50, productIds: ["p-b"] }, startsAt: past, endsAt: null, createdAt: T0, updatedAt: T0 },
    { id: "flash-bad-pct", organizationId: "org-1", name: "ভুল শতাংশ", type: "flash", active: true, priority: 9, config: { percentOff: 150, productIds: ["p-b"] }, startsAt: past, endsAt: future, createdAt: T0, updatedAt: T0 },
    { id: "not-flash", organizationId: "org-1", name: "BOGO", type: "bogo", active: true, priority: 9, config: { percentOff: 50, productIds: ["p-b"] }, startsAt: past, endsAt: future, createdAt: T0, updatedAt: T0 },
    { id: "flash-other-org", organizationId: "org-2", name: "অন্য দোকান", type: "flash", active: true, priority: 9, config: { percentOff: 50, productIds: ["p-a"] }, startsAt: past, endsAt: future, createdAt: T0, updatedAt: T0 },
  );
  return { futureEndsAt: future.toISOString() };
}

function makeService(prisma: any) {
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new StorefrontService(prisma, undefined, undefined, audit as any, undefined, undefined);
  return { svc, audit };
}

// ---------- (a) validateTrackingValue matrix ----------

describe("GB7 validateTrackingValue", () => {
  it("exposes exactly the 8 tracking fields", () => {
    // UNION regeneration (2026-10-17): three fields were added on
    // GitHub main itself by the owner's storefront marketing-pixels
    // work (migration 20261017090000_storefront_marketing_pixels) —
    // metaPixelId, tikTokPixelId, clarityId. This pin was stale on
    // main (spec and tracking.ts both byte-identical there); the
    // expectation is regenerated to the shipped field list.
    expect([...TRACKING_FIELDS]).toEqual([
      "ga4MeasurementId",
      "gtmContainerId",
      "googleAdsId",
      "googleAdsConversionLabel",
      "searchConsoleVerification",
      "metaPixelId",
      "tikTokPixelId",
      "clarityId",
    ]);
  });

  it.each([
    ["ga4MeasurementId", "G-ABC123XYZ"],
    ["ga4MeasurementId", "  G-abc1234  "],
    ["gtmContainerId", "GTM-ABC123"],
    ["googleAdsId", "AW-123456789"],
    ["googleAdsConversionLabel", "AbC_123-xyz9"],
    ["searchConsoleVerification", "a".repeat(43)],
  ] as const)("accepts %s = %s (trimmed)", (field, raw) => {
    expect(validateTrackingValue(field, raw)).toEqual({ ok: true, value: raw.trim() });
  });

  it.each([
    ["ga4MeasurementId", "UA-1234567"],
    ["ga4MeasurementId", "G-12"],
    ["gtmContainerId", "GTM-12"],
    ["gtmContainerId", "G-ABC12345"],
    ["googleAdsId", "AW-ABC12345"],
    ["googleAdsId", "123456789"],
    ["googleAdsConversionLabel", "short"],
    ["googleAdsConversionLabel", "bad label!"],
    ["searchConsoleVerification", "short-token"],
    ["searchConsoleVerification", `${"a".repeat(19)}.`],
  ] as const)("rejects %s = %s with a Bengali message", (field, raw) => {
    const v = validateTrackingValue(field, raw);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).toMatch(/ফরম্যাট ঠিক নয়/);
  });

  it("GA4 rejection carries the spec'd message", () => {
    expect(validateTrackingValue("ga4MeasurementId", "nope")).toEqual({
      ok: false,
      message: "GA4 Measurement ID-এর ফরম্যাট ঠিক নয় (G- দিয়ে শুরু হতে হবে)",
      code: "storefront.trackingGa4Format",
    });
  });

  it.each([null, undefined, "", "   "] as const)("empty %j clears to null for every field", (raw) => {
    for (const field of TRACKING_FIELDS) {
      expect(validateTrackingValue(field, raw)).toEqual({ ok: true, value: null });
    }
  });
});

// ---------- (b) updateSettings tracking plumbing ----------

describe("GB7 updateSettings — tracking fields", () => {
  it("rejects a malformed GA4 id with the Bengali message and stores nothing", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc } = makeService(prisma);
    await expect(
      svc.updateSettings("org-1", "user-1", { ga4MeasurementId: "BAD-123" } as any),
    ).rejects.toBeInstanceOf(ApiException);
    await expect(
      svc.updateSettings("org-1", "user-1", { ga4MeasurementId: "BAD-123" } as any),
    ).rejects.toThrow("GA4 Measurement ID-এর ফরম্যাট ঠিক নয় (G- দিয়ে শুরু হতে হবে)");
    expect(prisma.storefrontSetting.rows[0].ga4MeasurementId).toBeUndefined();
  });

  it("stores a valid GTM id (normalized) on the setting row", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc } = makeService(prisma);
    const ok = await svc.updateSettings("org-1", "user-1", { gtmContainerId: " GTM-XYZ789 " } as any);
    expect(ok.setting.gtmContainerId).toBe("GTM-XYZ789");
    expect(prisma.storefrontSetting.rows[0].gtmContainerId).toBe("GTM-XYZ789");
  });

  it("clears a tracking field on empty string", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc } = makeService(prisma);
    const set = await svc.updateSettings("org-1", "user-1", { ga4MeasurementId: "G-ABC12345" } as any);
    expect(set.setting.ga4MeasurementId).toBe("G-ABC12345");
    const cleared = await svc.updateSettings("org-1", "user-1", { ga4MeasurementId: "" } as any);
    expect(cleared.setting.ga4MeasurementId).toBeNull();
    expect(prisma.storefrontSetting.rows[0].ga4MeasurementId).toBeNull();
  });

  it("serializeSetting reports nulls for unset tracking fields (no-row + row)", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc } = makeService(prisma);
    const withRow = await svc.staffState("org-1");
    expect(withRow.setting.ga4MeasurementId).toBeNull();
    expect(withRow.setting.searchConsoleVerification).toBeNull();
    const noRow = await svc.staffState("org-3");
    expect(noRow.setting.exists).toBe(false);
    expect(noRow.setting.ga4MeasurementId).toBeNull();
    expect(noRow.setting.gtmContainerId).toBeNull();
    expect(noRow.setting.googleAdsId).toBeNull();
    expect(noRow.setting.googleAdsConversionLabel).toBeNull();
    expect(noRow.setting.searchConsoleVerification).toBeNull();
  });
});

// ---------- (c) publicFlashSales ----------

describe("GB7 publicFlashSales", () => {
  it("returns only in-window active flash sales, with serverNow, endsAt and salePriceMinor math; categoryIds resolved", async () => {
    const prisma = seedWorld(makePrisma());
    const { futureEndsAt } = seedFlashSales(prisma);
    const { svc } = makeService(prisma);
    const out = await svc.publicFlashSales("shop-one");
    expect(typeof out.serverNow).toBe("string");
    expect(Number.isNaN(new Date(out.serverNow).getTime())).toBe(false);
    expect(out.sales.map((s: any) => s.promotionId)).toEqual(["flash-1", "flash-cat"]);

    const first = out.sales[0];
    expect(first.name).toBe("ঈদ ফ্ল্যাশ সেল");
    expect(first.percentOff).toBe(20);
    expect(first.endsAt).toBe(futureEndsAt);
    expect(first.products.map((p: any) => p.id)).toEqual(["p-a"]);
    // 50000 − floor(50000 × 20 / 100) = 40000
    expect(first.products[0].salePriceMinor).toBe("40000");
    expect(first.products[0].priceMinor).toBe("50000");

    const cat = out.sales[1];
    expect(cat.startsAt).toBeNull();
    // categoryIds cat-1 ⇒ ACTIVE p-a + p-c (draft p-draft excluded)
    expect(cat.products.map((p: any) => p.id).sort()).toEqual(["p-a", "p-c"]);
    const pc = cat.products.find((p: any) => p.id === "p-c");
    // 30000 − floor(30000 × 10 / 100) = 27000
    expect(pc.salePriceMinor).toBe("27000");
  });

  it("answers an empty list (not an error) when there are no flash sales", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc } = makeService(prisma);
    const out = await svc.publicFlashSales("shop-one");
    expect(out.sales).toEqual([]);
    expect(typeof out.serverNow).toBe("string");
  });
});

// ---------- (d) shopHome settings.tracking + product flashSale ----------

describe("GB7 shopHome — settings.tracking + flash decoration", () => {
  it("carries the 8 tracking fields as nulls when unset, and values when set", async () => {
    const prisma = seedWorld(makePrisma());
    const { svc } = makeService(prisma);
    const unset = await svc.shopHome("shop-one", {});
    expect(unset.settings.tracking).toEqual({
      ga4MeasurementId: null,
      gtmContainerId: null,
      googleAdsId: null,
      googleAdsConversionLabel: null,
      searchConsoleVerification: null,
      metaPixelId: null,
      tikTokPixelId: null,
      clarityId: null,
    });
    Object.assign(prisma.storefrontSetting.rows[0], {
      ga4MeasurementId: "G-ABC12345",
      gtmContainerId: "GTM-ABC123",
      googleAdsId: "AW-123456789",
      googleAdsConversionLabel: "label_123-abc",
      searchConsoleVerification: "v".repeat(40),
    });
    const set = await svc.shopHome("shop-one", {});
    expect(set.settings.tracking).toEqual({
      ga4MeasurementId: "G-ABC12345",
      gtmContainerId: "GTM-ABC123",
      googleAdsId: "AW-123456789",
      googleAdsConversionLabel: "label_123-abc",
      searchConsoleVerification: "v".repeat(40),
      metaPixelId: null,
      tikTokPixelId: null,
      clarityId: null,
    });
  });

  it("decorates covered products with flashSale (highest priority wins) and leaves others without the key", async () => {
    const prisma = seedWorld(makePrisma());
    const { futureEndsAt } = seedFlashSales(prisma);
    const { svc } = makeService(prisma);
    const home = await svc.shopHome("shop-one", {});
    const byId = Object.fromEntries(home.products.map((p: any) => [p.id, p]));
    expect(byId["p-a"].flashSale).toEqual({
      promotionId: "flash-1",
      name: "ঈদ ফ্ল্যাশ সেল",
      percentOff: 20,
      endsAt: futureEndsAt,
    });
    // p-c is covered only via the category sale.
    expect(byId["p-c"].flashSale.promotionId).toBe("flash-cat");
    expect("flashSale" in byId["p-b"]).toBe(false);

    const detail = await svc.productDetail("shop-one", "leather-wallet");
    expect(detail.product.flashSale?.promotionId).toBe("flash-1");
  });
});
