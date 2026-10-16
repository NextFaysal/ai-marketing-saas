import { BadRequestException } from "@nestjs/common";
import { allocateBundle } from "./ec29-bundles";
import { BundlesService } from "./bundles.service";
import { StorefrontService } from "../storefront/storefront.service";
import { DiscountsService } from "./discounts.service";
import { PromotionsService } from "./promotions.service";

/** AB5 (AX8) — mix-and-match bundles: slot CRUD + validation,
 * pick validation, allocation identity with picks, and the
 * storefront cart/quote wiring (fake-prisma style of the
 * ec29-bundles / ec29-shop harnesses).
 *
 * PRICING RULE under test: the bundle price stays the
 * merchant-set bundlePriceMinor REGARDLESS of picks — each
 * pick contributes ONE component unit (qty 1) to the same
 * allocateBundle expansion, weighted by its regular price. */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
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
    for (const [key, dir] of Object.entries(spec)) {
      out.sort((a: any, b: any) => {
        const av = a[key];
        const bv = b[key];
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
    deleteMany: async ({ where }: any = {}) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matchWhere(rows[i], where)) { rows.splice(i, 1); count++; }
      }
      return { count };
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
  };
}

const T0 = new Date("2026-10-01T00:00:00Z");
const auditStub: any = { log: jest.fn(async () => undefined) };

function makePrisma() {
  return {
    bundle: makeTable(),
    bundleSlot: makeTable(),
    product: makeTable(),
    productVariant: makeTable(),
    category: makeTable(),
  } as any;
}

function seedCatalog(prisma: any) {
  prisma.category.rows.push(
    { id: "cat-1", organizationId: "org-1", name: "পোশাক", slug: "poshak", createdAt: T0, updatedAt: T0 },
    { id: "cat-2", organizationId: "org-1", name: "জুতা", slug: "juta", createdAt: T0, updatedAt: T0 },
    { id: "cat-foreign", organizationId: "org-2", name: "অন্যের", slug: "other", createdAt: T0, updatedAt: T0 },
  );
  prisma.product.rows.push(
    { id: "p-1", organizationId: "org-1", name: "পণ্য ১", status: "ACTIVE", priceMinor: 10000n, categoryId: "cat-1", imageUrl: "https://img/1.jpg", createdAt: T0, updatedAt: T0 },
    { id: "p-2", organizationId: "org-1", name: "পণ্য ২", status: "ACTIVE", priceMinor: 20000n, categoryId: "cat-1", imageUrl: null, createdAt: T0, updatedAt: T0 },
    { id: "p-3", organizationId: "org-1", name: "পণ্য ৩", status: "ACTIVE", priceMinor: 5000n, categoryId: "cat-2", imageUrl: null, createdAt: T0, updatedAt: T0 },
    { id: "p-4", organizationId: "org-1", name: "পণ্য ৪", status: "DRAFT", priceMinor: 7000n, categoryId: "cat-1", imageUrl: null, createdAt: T0, updatedAt: T0 },
    { id: "p-5", organizationId: "org-1", name: "পণ্য ৫", status: "ACTIVE", priceMinor: 3000n, categoryId: "cat-1", imageUrl: null, createdAt: T0, updatedAt: T0 },
    { id: "p-foreign", organizationId: "org-2", name: "অন্যের পণ্য", status: "ACTIVE", priceMinor: 1000n, categoryId: "cat-foreign", imageUrl: null, createdAt: T0, updatedAt: T0 },
  );
}

const FIXED_ITEMS = [
  { productId: "p-1", qty: 1 },
  { productId: "p-2", qty: 1 },
];

/** A slotted bundle row + its two slot rows, seeded directly. */
function seedSlottedBundle(prisma: any) {
  prisma.bundle.rows.push({
    id: "b-1", organizationId: "org-1", name: "মিক্স বান্ডল", description: null, imageUrl: null,
    items: [
      { productId: "p-1", variantSku: null, qty: 1 },
      { productId: "p-2", variantSku: null, qty: 1 },
    ],
    bundlePriceMinor: 25000n, active: true, sortOrder: 0, createdAt: T0, updatedAt: T0,
  });
  prisma.bundleSlot.rows.push(
    {
      id: "s-1", organizationId: "org-1", bundleId: "b-1", label: "রঙ বেছে নিন", chooseQty: 2,
      sourceType: "category", sourceRef: { categoryId: "cat-1" }, sortOrder: 0, createdAt: T0, updatedAt: T0,
    },
    {
      id: "s-2", organizationId: "org-1", bundleId: "b-1", label: "অতিরিক্ত একটি", chooseQty: 1,
      sourceType: "products", sourceRef: { productIds: ["p-3", "p-4"] }, sortOrder: 1, createdAt: T0, updatedAt: T0,
    },
  );
  return prisma.bundle.rows[0];
}

describe("AB5 BundlesService.validateSlots", () => {
  it("bad category (foreign / missing) → 400", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new BundlesService(prisma, auditStub);
    await expect(
      svc.validateSlots("org-1", null, [
        { label: "স্লট", chooseQty: 1, sourceType: "category", sourceRef: { categoryId: "cat-foreign" } },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.validateSlots("org-1", null, [
        { label: "স্লট", chooseQty: 1, sourceType: "category", sourceRef: {} },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("foreign product in a products pool → 400 naming the product", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new BundlesService(prisma, auditStub);
    await expect(
      svc.validateSlots("org-1", null, [
        { label: "স্লট", chooseQty: 1, sourceType: "products", sourceRef: { productIds: ["p-1", "p-foreign"] } },
      ]),
    ).rejects.toThrow(/p-foreign/);
    await expect(
      svc.validateSlots("org-1", null, [
        { label: "স্লট", chooseQty: 1, sourceType: "products", sourceRef: { productIds: [] } },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("chooseQty bounds: 0 and 21 → 400; label missing → 400", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new BundlesService(prisma, auditStub);
    const base = { label: "স্লট", sourceType: "products", sourceRef: { productIds: ["p-1"] } };
    await expect(svc.validateSlots("org-1", null, [{ ...base, chooseQty: 0 }])).rejects.toThrow(/১–২০/);
    await expect(svc.validateSlots("org-1", null, [{ ...base, chooseQty: 21 }])).rejects.toThrow(/১–২০/);
    await expect(svc.validateSlots("org-1", null, [{ ...base, chooseQty: 1.5 }])).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.validateSlots("org-1", null, [{ chooseQty: 1, sourceType: "products", sourceRef: { productIds: ["p-1"] } }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it(">6 slots refused before any per-slot work", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new BundlesService(prisma, auditStub);
    const seven = Array.from({ length: 7 }, (_, i) => ({
      label: `স্লট ${i}`, chooseQty: 1, sourceType: "products", sourceRef: { productIds: ["p-1"] },
    }));
    await expect(svc.validateSlots("org-1", null, seven)).rejects.toThrow(/সর্বোচ্চ ৬টি স্লট/);
  });

  it("happy path normalizes (trim, dedupe productIds, sortOrder)", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new BundlesService(prisma, auditStub);
    const out = await svc.validateSlots("org-1", null, [
      { label: "  রঙ  ", chooseQty: 2, sourceType: "category", sourceRef: { categoryId: "cat-1" } },
      { label: "অতিরিক্ত", chooseQty: 1, sourceType: "products", sourceRef: { productIds: ["p-3", "p-3", "p-1"] } },
    ]);
    expect(out).toEqual([
      { label: "রঙ", chooseQty: 2, sourceType: "category", sourceRef: { categoryId: "cat-1" }, sortOrder: 0 },
      { label: "অতিরিক্ত", chooseQty: 1, sourceType: "products", sourceRef: { productIds: ["p-3", "p-1"] }, sortOrder: 1 },
    ]);
  });
});

describe("AB5 BundlesService slot CRUD via create/update + serialize", () => {
  it("create with slots: serialize returns slots with CURRENT pools as options (ACTIVE only)", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new BundlesService(prisma, auditStub);
    const created: any = await svc.create("org-1", "u1", {
      name: "মিক্স", bundlePriceMinor: "25000", items: FIXED_ITEMS,
      slots: [
        { label: "রঙ বেছে নিন", chooseQty: 2, sourceType: "category", sourceRef: { categoryId: "cat-1" } },
        { label: "অতিরিক্ত একটি", chooseQty: 1, sourceType: "products", sourceRef: { productIds: ["p-3", "p-4"] } },
      ],
    } as any);
    expect(prisma.bundleSlot.rows).toHaveLength(2);
    const slots = created.bundle.slots;
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ label: "রঙ বেছে নিন", chooseQty: 2, sourceType: "category", sourceRef: { categoryId: "cat-1" } });
    // Category pool: ACTIVE cat-1 products only (p-4 is DRAFT, p-3 is cat-2).
    expect(slots[0].options.map((o: any) => o.productId)).toEqual(["p-1", "p-2", "p-5"]);
    expect(slots[0].options[0]).toEqual({
      productId: "p-1", name: "পণ্য ১", imageUrl: "https://img/1.jpg", variantSku: null, regularUnitMinor: "10000",
    });
    // Products pool: p-4 (DRAFT) drops out, p-3 stays.
    expect(slots[1].options.map((o: any) => o.productId)).toEqual(["p-3"]);
    // Existing serialize fields unchanged.
    expect(created.bundle.bundlePriceMinor).toBe("25000");
    expect(created.bundle.regularTotalMinor).toBe("30000");
  });

  it("update: slots present replace wholesale, slots [] clears, slots absent leaves untouched", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new BundlesService(prisma, auditStub);
    const created: any = await svc.create("org-1", "u1", {
      name: "মিক্স", bundlePriceMinor: "25000", items: FIXED_ITEMS,
      slots: [{ label: "প্রথম", chooseQty: 1, sourceType: "products", sourceRef: { productIds: ["p-1"] } }],
    } as any);
    const id = created.bundle.id;

    const untouched: any = await svc.update("org-1", "u1", id, { name: "মিক্স ২" } as any);
    expect(untouched.bundle.slots).toHaveLength(1);
    expect(untouched.bundle.slots[0].label).toBe("প্রথম");

    const replaced: any = await svc.update("org-1", "u1", id, {
      slots: [{ label: "দ্বিতীয়", chooseQty: 1, sourceType: "category", sourceRef: { categoryId: "cat-2" } }],
    } as any);
    expect(replaced.bundle.slots).toHaveLength(1);
    expect(replaced.bundle.slots[0].label).toBe("দ্বিতীয়");
    expect(prisma.bundleSlot.rows).toHaveLength(1);
    expect(prisma.bundleSlot.rows[0].label).toBe("দ্বিতীয়");

    const cleared: any = await svc.update("org-1", "u1", id, { slots: [] } as any);
    expect(cleared.bundle.slots).toEqual([]);
    expect(prisma.bundleSlot.rows).toHaveLength(0);
  });

  it("invalid slots on create → 400 and NO bundle row is written", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const svc = new BundlesService(prisma, auditStub);
    await expect(
      svc.create("org-1", "u1", {
        name: "খারাপ", bundlePriceMinor: "25000", items: FIXED_ITEMS,
        slots: [{ label: "স্লট", chooseQty: 1, sourceType: "category", sourceRef: { categoryId: "cat-foreign" } }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.bundle.rows).toHaveLength(0);
  });

  it("publicBundles includes the same slots shape", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    seedSlottedBundle(prisma);
    const svc = new BundlesService(prisma, auditStub);
    const pub = await svc.publicBundles("org-1");
    expect(pub).toHaveLength(1);
    expect(pub[0].slots).toHaveLength(2);
    expect(pub[0].slots[0].options.map((o: any) => o.productId)).toEqual(["p-1", "p-2", "p-5"]);
    expect(pub[0].slots[1].options.map((o: any) => o.productId)).toEqual(["p-3"]);
  });
});

describe("AB5 BundlesService.validatePicks", () => {
  const GOOD = [
    { slotId: "s-1", productId: "p-1" },
    { slotId: "s-1", productId: "p-2" },
    { slotId: "s-2", productId: "p-3" },
  ];

  it("happy path returns normalized picks in slot order", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const bundle = seedSlottedBundle(prisma);
    const svc = new BundlesService(prisma, auditStub);
    // Interleaved input (s-2 first) normalizes to slot order,
    // preserving input order within a slot.
    const out = await svc.validatePicks("org-1", bundle, [GOOD[2], GOOD[0], GOOD[1]]);
    expect(out).toEqual(GOOD);
  });

  it("exact count enforced per slot", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const bundle = seedSlottedBundle(prisma);
    const svc = new BundlesService(prisma, auditStub);
    await expect(
      svc.validatePicks("org-1", bundle, [
        { slotId: "s-1", productId: "p-1" },
        { slotId: "s-2", productId: "p-3" },
      ]),
    ).rejects.toThrow(/"রঙ বেছে নিন" স্লট থেকে ঠিক 2টি/);
    // A whole slot missing counts too.
    await expect(
      svc.validatePicks("org-1", bundle, [
        { slotId: "s-1", productId: "p-1" },
        { slotId: "s-1", productId: "p-2" },
      ]),
    ).rejects.toThrow(/"অতিরিক্ত একটি" স্লট থেকে ঠিক 1টি/);
  });

  it("duplicate product within one slot refused", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const bundle = seedSlottedBundle(prisma);
    const svc = new BundlesService(prisma, auditStub);
    await expect(
      svc.validatePicks("org-1", bundle, [
        { slotId: "s-1", productId: "p-1" },
        { slotId: "s-1", productId: "p-1" },
        { slotId: "s-2", productId: "p-3" },
      ]),
    ).rejects.toThrow(/একই পণ্য দুবার/);
  });

  it("out-of-pool product refused; inactive product refused", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const bundle = seedSlottedBundle(prisma);
    const svc = new BundlesService(prisma, auditStub);
    // p-3 is ACTIVE but in cat-2 — not in s-1's cat-1 pool.
    await expect(
      svc.validatePicks("org-1", bundle, [
        { slotId: "s-1", productId: "p-1" },
        { slotId: "s-1", productId: "p-3" },
        { slotId: "s-2", productId: "p-3" },
      ]),
    ).rejects.toThrow(/বেছে নেওয়া যাবে না/);
    // p-4 is listed in s-2's products pool but DRAFT (inactive).
    await expect(
      svc.validatePicks("org-1", bundle, [
        { slotId: "s-1", productId: "p-1" },
        { slotId: "s-1", productId: "p-2" },
        { slotId: "s-2", productId: "p-4" },
      ]),
    ).rejects.toThrow(/বেছে নেওয়া যাবে না/);
  });

  it("missing picks for a slotted bundle refused, naming the slot label", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const bundle = seedSlottedBundle(prisma);
    const svc = new BundlesService(prisma, auditStub);
    await expect(svc.validatePicks("org-1", bundle, undefined)).rejects.toThrow(/রঙ বেছে নিন/);
    await expect(svc.validatePicks("org-1", bundle, [])).rejects.toThrow(/রঙ বেছে নিন/);
    await expect(svc.validatePicks("org-1", bundle, null)).rejects.toThrow(/রঙ বেছে নিন/);
  });

  it("unknown slot refused", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const bundle = seedSlottedBundle(prisma);
    const svc = new BundlesService(prisma, auditStub);
    await expect(
      svc.validatePicks("org-1", bundle, [...GOOD, { slotId: "s-nope", productId: "p-1" }]),
    ).rejects.toThrow(/অজানা স্লট/);
  });

  it("slotless bundle: picks refused, no picks → []", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    prisma.bundle.rows.push({
      id: "b-fixed", organizationId: "org-1", name: "ফিক্সড", description: null, imageUrl: null,
      items: [{ productId: "p-1", variantSku: null, qty: 1 }, { productId: "p-2", variantSku: null, qty: 1 }],
      bundlePriceMinor: 25000n, active: true, sortOrder: 0, createdAt: T0, updatedAt: T0,
    });
    const svc = new BundlesService(prisma, auditStub);
    const bundle = prisma.bundle.rows[0];
    await expect(
      svc.validatePicks("org-1", bundle, [{ slotId: "s-1", productId: "p-1" }]),
    ).rejects.toThrow(/কোনো স্লট নেই/);
    await expect(svc.validatePicks("org-1", bundle, undefined)).resolves.toEqual([]);
    await expect(svc.validatePicks("org-1", bundle, [])).resolves.toEqual([]);
  });
});

describe("AB5 allocation identity with picks", () => {
  it("fixed + pick components allocate EXACTLY to bundlePriceMinor", async () => {
    const prisma = makePrisma();
    seedCatalog(prisma);
    const bundle = seedSlottedBundle(prisma);
    const svc = new BundlesService(prisma, auditStub);
    const picks = await svc.validatePicks("org-1", bundle, [
      { slotId: "s-1", productId: "p-1" },
      { slotId: "s-1", productId: "p-5" },
      { slotId: "s-2", productId: "p-3" },
    ]);
    const comps = await svc.resolveComponentsWithPicks("org-1", bundle, picks);
    // 2 fixed + 3 picks.
    expect(comps).toHaveLength(5);
    const pickComps = comps.filter((c: any) => c.slotId);
    expect(pickComps).toHaveLength(3);
    for (const c of pickComps) {
      expect(c.qty).toBe(1);
      expect(c.variant).toBeNull();
      expect(c.variantSku).toBeNull();
      expect(typeof c.slotLabel).toBe("string");
    }
    expect(pickComps.map((c: any) => c.slotLabel)).toEqual(["রঙ বেছে নিন", "রঙ বেছে নিন", "অতিরিক্ত একটি"]);
    // Fixed components carry no slot fields.
    expect(comps[0].slotId).toBeUndefined();

    const allocs = allocateBundle(
      BigInt(bundle.bundlePriceMinor),
      comps.map((c: any) => ({ qty: c.qty, regularUnitMinor: c.regularUnitMinor })),
    );
    const sum = allocs.reduce((s, x) => s + x.allocatedTotalMinor, 0n);
    expect(sum).toBe(25000n);
  });
});

// ---------- Storefront harness (ec29-shop style) ----------

function makeShopPrisma() {
  return {
    organization: makeTable(),
    storefrontSetting: makeTable(),
    businessProfile: makeTable(),
    category: makeTable(),
    product: makeTable(),
    productVariant: makeTable(),
    productImage: makeTable(),
    shippingZone: makeTable(),
    deliverySlot: makeTable(),
    storeCart: makeTable(),
    storeCartItem: makeTable(),
    storeCartBundle: makeTable(),
    bundle: makeTable(),
    bundleSlot: makeTable(),
    order: makeTable(),
    orderItem: makeTable(),
    storeDiscount: makeTable(),
    promotion: makeTable(),
    customer: makeTable(),
    auditLog: makeTable(),
  } as any;
}

function seedShop(prisma: any) {
  prisma.organization.rows.push({
    id: "org-1", slug: "shop-one", name: "Shop One", brandName: null, logoUrl: null,
    primaryColor: null, customDomain: null, createdAt: T0, updatedAt: T0,
  });
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "Shop One",
    showFeatured: true, showCategories: true, showSearch: true,
    featuredProductIds: null, domainVerifyToken: null, domainVerifiedAt: null,
    referralDiscountPercent: null, referralMinSubtotalMinor: null,
    giftWrapEnabled: false, giftWrapFeeMinor: null,
    createdAt: T0, updatedAt: T0,
  });
  prisma.category.rows.push(
    { id: "cat-1", organizationId: "org-1", name: "পোশাক", slug: "poshak", createdAt: T0, updatedAt: T0 },
    { id: "cat-2", organizationId: "org-1", name: "জুতা", slug: "juta", createdAt: T0, updatedAt: T0 },
  );
  const prod = (id: string, name: string, price: bigint, categoryId: string) => ({
    id, organizationId: "org-1", name, slug: id, category: null, categoryId, sku: id.toUpperCase(),
    status: "ACTIVE", priceMinor: price, compareAtMinor: null, currency: "BDT", stockQuantity: 10,
    lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null,
    preorderEnabled: false, digital: false, createdAt: T0, updatedAt: T0,
  });
  prisma.product.rows.push(
    prod("p-a", "ওয়ালেট", 50000n, "cat-1"),
    prod("p-b", "ব্যাগ", 30000n, "cat-1"),
    prod("p-c", "জুতা", 10000n, "cat-2"),
    prod("p-d", "বেল্ট", 15000n, "cat-1"),
  );
  prisma.shippingZone.rows.push({
    id: "z-in", organizationId: "org-1", name: "ঢাকার ভিতরে", kind: "inside_dhaka",
    districts: null, chargeMinor: 6000n, deliveryDays: 1, freeAboveMinor: null,
    active: true, position: 0, createdAt: T0, updatedAt: T0,
  });
  prisma.bundle.rows.push(
    {
      id: "b-1", organizationId: "org-1", name: "কম্বো সেট", description: null, imageUrl: null,
      bundlePriceMinor: 60000n, active: true, sortOrder: 0,
      items: [
        { productId: "p-a", variantSku: null, qty: 1 },
        { productId: "p-b", variantSku: null, qty: 1 },
      ],
      createdAt: T0, updatedAt: T0,
    },
    {
      id: "b-2", organizationId: "org-1", name: "ফিক্সড সেট", description: null, imageUrl: null,
      bundlePriceMinor: 60000n, active: true, sortOrder: 1,
      items: [
        { productId: "p-a", variantSku: null, qty: 1 },
        { productId: "p-b", variantSku: null, qty: 1 },
      ],
      createdAt: T0, updatedAt: T0,
    },
  );
  prisma.bundleSlot.rows.push({
    id: "slot-1", organizationId: "org-1", bundleId: "b-1", label: "একটি বেছে নিন", chooseQty: 1,
    sourceType: "category", sourceRef: { categoryId: "cat-1" }, sortOrder: 0, createdAt: T0, updatedAt: T0,
  });
}

function makeShop(prisma: any) {
  const discounts = new DiscountsService(prisma, {} as any, auditStub);
  const promotions = new PromotionsService(prisma, discounts, auditStub);
  const bundles = new BundlesService(prisma, auditStub);
  const integrations: any = { upsertOrder: jest.fn(async () => "created") };
  const svc = new StorefrontService(
    prisma, integrations, discounts as any, auditStub,
    undefined, undefined, promotions as any, bundles as any,
  );
  return { svc, bundles, integrations };
}

describe("AB5 storefront — patchCartBundle picks + serializeCart", () => {
  it("stores normalized picks; serializeCart labels pick components viaSlot and echoes picks", async () => {
    const prisma = makeShopPrisma();
    seedShop(prisma);
    const { svc } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    const added: any = await svc.patchCartBundle("shop-one", cartToken, {
      bundleId: "b-1", quantity: 1, picks: [{ slotId: "slot-1", productId: "p-d" }],
    } as any);
    const row = prisma.storeCartBundle.rows[0];
    expect(row.picks).toEqual([{ slotId: "slot-1", productId: "p-d" }]);
    const line = added.cart.bundleItems[0];
    expect(line.picks).toEqual([{ slotId: "slot-1", productId: "p-d" }]);
    expect(line.components).toHaveLength(3); // 2 fixed + 1 pick
    const pickComp = line.components.find((c: any) => c.viaSlot);
    expect(pickComp).toMatchObject({ productId: "p-d", name: "বেল্ট", qty: 1, viaSlot: "একটি বেছে নিন" });
    const fixed = line.components.filter((c: any) => !c.viaSlot);
    expect(fixed).toHaveLength(2);
    expect(fixed.every((c: any) => c.viaSlot === null)).toBe(true);
    // Price is the bundle price regardless of the pick.
    expect(line.bundlePriceMinor).toBe("60000");
    expect(line.lineTotalMinor).toBe("60000");
  });

  it("refuses invalid picks (out of pool) and missing picks for a slotted bundle; nothing is stored", async () => {
    const prisma = makeShopPrisma();
    seedShop(prisma);
    const { svc } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await expect(
      svc.patchCartBundle("shop-one", cartToken, {
        bundleId: "b-1", quantity: 1, picks: [{ slotId: "slot-1", productId: "p-c" }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.patchCartBundle("shop-one", cartToken, { bundleId: "b-1", quantity: 1 } as any),
    ).rejects.toThrow(/একটি বেছে নিন/);
    expect(prisma.storeCartBundle.rows).toHaveLength(0);
  });

  it("slotless bundle parity: no picks stored, picks null, components viaSlot null", async () => {
    const prisma = makeShopPrisma();
    seedShop(prisma);
    const { svc } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    const added: any = await svc.patchCartBundle("shop-one", cartToken, { bundleId: "b-2", quantity: 1 } as any);
    const row = prisma.storeCartBundle.rows[0];
    expect(row.picks ?? null).toBeNull();
    const line = added.cart.bundleItems[0];
    expect(line.picks).toBeNull();
    expect(line.components).toHaveLength(2);
    expect(line.components.every((c: any) => c.viaSlot === null)).toBe(true);
    // …and picks on a slotless bundle are refused.
    await expect(
      svc.patchCartBundle("shop-one", cartToken, {
        bundleId: "b-2", quantity: 1, picks: [{ slotId: "slot-1", productId: "p-a" }],
      } as any),
    ).rejects.toThrow(/কোনো স্লট নেই/);
  });

  it("serializeCart degrades to fixed-only when a stored pick went inactive (never throws)", async () => {
    const prisma = makeShopPrisma();
    seedShop(prisma);
    const { svc } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartBundle("shop-one", cartToken, {
      bundleId: "b-1", quantity: 1, picks: [{ slotId: "slot-1", productId: "p-d" }],
    } as any);
    prisma.product.rows.find((p: any) => p.id === "p-d").status = "DRAFT";
    const cart: any = await svc.getCart("shop-one", cartToken);
    const line = cart.cart.bundleItems[0];
    expect(line.components).toHaveLength(2);
    expect(line.components.every((c: any) => c.viaSlot === null)).toBe(true);
    // The stored picks are still echoed as stored.
    expect(line.picks).toEqual([{ slotId: "slot-1", productId: "p-d" }]);
  });
});

describe("AB5 storefront — computeQuote with picks (via quote)", () => {
  it("quote total is bundlePrice×qty EXACTLY with picks; bundle lines include the pick component", async () => {
    const prisma = makeShopPrisma();
    seedShop(prisma);
    const { svc } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartBundle("shop-one", cartToken, {
      bundleId: "b-1", quantity: 2, picks: [{ slotId: "slot-1", productId: "p-d" }],
    } as any);
    const q: any = await svc.quote("shop-one", { cartToken, district: "ঢাকা" } as any);
    expect(q.itemsSubtotalMinor).toBe("120000"); // 2 × 60000, picks change nothing
    expect(q.totalMinor).toBe("126000"); // + 6000 delivery
    const bundleLines = q.items.filter((i: any) => i.bundleId === "b-1");
    expect(bundleLines).toHaveLength(3); // 2 fixed + 1 pick, per bundle unit
    const sum = bundleLines.reduce((s: number, i: any) => s + Number(i.lineTotalMinor), 0);
    expect(sum).toBe(120000);
    expect(bundleLines.some((i: any) => i.productId === "p-d")).toBe(true);
  });

  it("quote STRICTLY refuses when a stored pick went inactive, naming the bundle + slot", async () => {
    const prisma = makeShopPrisma();
    seedShop(prisma);
    const { svc } = makeShop(prisma);
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartBundle("shop-one", cartToken, {
      bundleId: "b-1", quantity: 1, picks: [{ slotId: "slot-1", productId: "p-d" }],
    } as any);
    prisma.product.rows.find((p: any) => p.id === "p-d").status = "DRAFT";
    await expect(
      svc.quote("shop-one", { cartToken, district: "ঢাকা" } as any),
    ).rejects.toThrow(/বান্ডল "কম্বো সেট": "একটি বেছে নিন" স্লটে এই পণ্যটি বেছে নেওয়া যাবে না/);
  });
});
