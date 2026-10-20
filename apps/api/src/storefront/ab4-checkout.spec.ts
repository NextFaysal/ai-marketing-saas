import { BadRequestException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { StorefrontService } from "./storefront.service";
import { hashShopSecret } from "./shop-auth.util";
import { DEFAULT_DEPOSIT_NOTE } from "../fraud/deposit";

/**
 * AB4 (AX5a/AX5b/AX5c) — shop surface wiring:
 * - computeQuote carries the deposit profile; serializeQuote
 *   prices per-kind deposit amounts for the quote total;
 * - checkout() validates custom field answers BEFORE any order
 *   write (unknown key / missing required → 400, no order),
 *   stamps depositDueMinor + checkoutFields post-placement,
 *   and returns the deposit block;
 * - shopHome carries the shop surface's public field defs;
 * - express checkout requires a session, resolves the saved
 *   address (explicit id must be the customer's; else default)
 *   and places through checkout().
 */

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
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) if (matchWhere(row, where)) { Object.assign(row, data); count++; }
      return { count };
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
    category: makeTable(), brand: makeTable(), product: makeTable(), productVariant: makeTable(),
    productImage: makeTable(), shippingZone: makeTable(), storeCart: makeTable(), storeCartItem: makeTable(),
    storeCartBundle: makeTable(), bundle: makeTable(), order: makeTable(), orderItem: makeTable(),
    fulfillment: makeTable(), deliverySlot: makeTable(), shopPage: makeTable(), customer: makeTable(),
    checkoutFieldDef: makeTable(), customerAddress: makeTable(), shopSession: makeTable(),
  } as any;
}

function seedShop(prisma: any, bpOver: Record<string, any> = {}) {
  prisma.organization.rows.push(
    { id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne", logoUrl: null, primaryColor: null, customDomain: null },
  );
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: null, announcementText: null,
    showFeatured: true, showCategories: true, showSearch: true, metaDescription: null,
    featuredProductIds: null, domainVerifyToken: null, domainVerifiedAt: null,
  });
  prisma.product.rows.push({
    id: "p-a", organizationId: "org-1", name: "ওয়ালেট", slug: "wallet", description: null, category: null,
    categoryId: null, sku: "WAL-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, currency: "BDT",
    stockQuantity: 10, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null,
    bumpImageUrl: null, seoTitle: null, seoDescription: null, createdAt: new Date(), updatedAt: new Date(),
  });
  prisma.shippingZone.rows.push({
    id: "z-all", organizationId: "org-1", name: "সব জায়গায়", kind: "all", districts: null,
    chargeMinor: 6000n, deliveryDays: 2, freeAboveMinor: null, active: true, position: 0,
    createdAt: new Date(), updatedAt: new Date(),
  });
  prisma.businessProfile.rows.push({
    id: "bp-1", organizationId: "org-1", codAvailable: true, bkashNumber: null, nagadNumber: null, paymentNote: null,
    depositMode: "percent", depositPercent: 20, depositFixedMinor: null,
    depositAppliesTo: "all", depositNote: null,
    ...bpOver,
  });
}

function makeStorefront(prisma: any) {
  const placed: any[] = [];
  const integrations = {
    upsertOrder: jest.fn(async (orgId: string, _s: any, o: any, source: string) => {
      placed.push(o);
      await prisma.order.create({
        data: {
          organizationId: orgId, source, externalId: o.externalId, externalNumber: o.externalNumber,
          status: o.status, paymentMethod: o.paymentMethod, isCod: o.isCod, totalMinor: o.totalMinor,
        },
      });
      return "created";
    }),
  };
  const svc = new StorefrontService(
    prisma, integrations as any, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
  );
  return { svc, integrations, placed };
}

async function cartReady(svc: StorefrontService) {
  const { cartToken } = await svc.createCart("shop-one");
  await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 1 });
  return cartToken;
}
const dto = (cartToken: string, over: Record<string, any> = {}) => ({
  cartToken, name: "রহিম", phone: "01711111111", address: "বাড়ি ১, রোড ২", district: "ঢাকা", ...over,
});

// Cart total in this world: 50000 product + 6000 zone delivery = 56000.
// 20% deposit = 11200; due after deposit = 44800.
describe("AB4 shop quote — deposit block", () => {
  it("serializeQuote prices per-kind amounts when covered, null where not covered", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma);
    const token = await cartReady(svc);
    const q: any = await svc.quote("shop-one", { cartToken: token, district: "ঢাকা" } as any);
    expect(q.totalMinor).toBe("56000");
    expect(q.deposit).toEqual({
      note: DEFAULT_DEPOSIT_NOTE,
      amounts: { cod: "11200", online: "11200", manual: "11200" },
    });
  });

  it("appliesTo cod-only → online/manual amounts null; deposit off → deposit null", async () => {
    const prisma = makePrisma(); seedShop(prisma, { depositAppliesTo: "cod" });
    const { svc } = makeStorefront(prisma);
    const token = await cartReady(svc);
    const q: any = await svc.quote("shop-one", { cartToken: token, district: "ঢাকা" } as any);
    expect(q.deposit.amounts).toEqual({ cod: "11200", online: null, manual: null });

    const prisma2 = makePrisma(); seedShop(prisma2, { depositMode: null });
    const w2 = makeStorefront(prisma2);
    const token2 = await cartReady(w2.svc);
    const q2: any = await w2.svc.quote("shop-one", { cartToken: token2, district: "ঢাকা" } as any);
    expect(q2.deposit).toBeNull();
  });
});

describe("AB4 shop checkout — stamps + field answers", () => {
  function seedDef(prisma: any, over: Record<string, any> = {}) {
    prisma.checkoutFieldDef.rows.push({
      id: "def-1", organizationId: "org-1", key: "gift_note", label: "গিফট নোট",
      type: "text", options: null, required: false, appliesTo: "shop", active: true, sortOrder: 0,
      createdAt: new Date(), updatedAt: new Date(), ...over,
    });
  }

  it("checkout stamps depositDueMinor + validated checkoutFields and returns the deposit block", async () => {
    const prisma = makePrisma(); seedShop(prisma); seedDef(prisma);
    const { svc } = makeStorefront(prisma);
    const token = await cartReady(svc);
    const out: any = await svc.checkout("shop-one", dto(token, {
      fieldAnswers: { gift_note: "  শুভ জন্মদিন  " },
    }) as any);
    expect(out.deposit).toEqual({
      amountMinor: "11200", kind: "cod", note: DEFAULT_DEPOSIT_NOTE, dueAfterMinor: "44800",
    });
    const order = prisma.order.rows[0];
    expect(order.depositDueMinor).toBe(11200n);
    expect(order.checkoutFields).toEqual({ gift_note: "শুভ জন্মদিন" });
  });

  it("unknown field key → 400 and NO order is written", async () => {
    const prisma = makePrisma(); seedShop(prisma); seedDef(prisma);
    const { svc, integrations } = makeStorefront(prisma);
    const token = await cartReady(svc);
    await expect(svc.checkout("shop-one", dto(token, {
      fieldAnswers: { nope: "x" },
    }) as any)).rejects.toBeInstanceOf(ApiException);
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
    expect(prisma.order.rows).toHaveLength(0);
  });

  it("missing required field → 400 and NO order is written", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    seedDef(prisma, { id: "def-2", key: "nid", label: "এনআইডি", required: true });
    const { svc, integrations } = makeStorefront(prisma);
    const token = await cartReady(svc);
    await expect(svc.checkout("shop-one", dto(token) as any)).rejects.toThrow(/আবশ্যক/);
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("shopHome carries the shop surface's public field defs", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    seedDef(prisma);
    seedDef(prisma, { id: "def-3", key: "landing_only", label: "শুধু ল্যান্ডিং", appliesTo: "landing" });
    const { svc } = makeStorefront(prisma);
    const home: any = await svc.shopHome("shop-one", {});
    expect(home.checkoutFields).toEqual([
      { key: "gift_note", label: "গিফট নোট", type: "text", options: [], required: false },
    ]);
  });
});

describe("AB4 express checkout (AX5c)", () => {
  function seedAccount(prisma: any) {
    prisma.customer.rows.push({
      id: "cust-1", organizationId: "org-1", phone: "01711111111", firstName: "রহিম",
      mergedIntoId: null, createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.shopSession.rows.push({
      id: "sess-1", organizationId: "org-1", customerId: "cust-1",
      tokenHash: hashShopSecret("tok-1"),
      expiresAt: new Date(Date.now() + 3600 * 1000), revokedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.customerAddress.rows.push({
      id: "addr-1", organizationId: "org-1", customerId: "cust-1",
      recipientName: "রহিম উদ্দিন", phone: "01711111111",
      addressLine: "বাড়ি ১, রোড ২", district: "ঢাকা", isDefault: true,
      createdAt: new Date(), updatedAt: new Date(),
    });
  }

  it("without a session → 400 login message, no order", async () => {
    const prisma = makePrisma(); seedShop(prisma); seedAccount(prisma);
    const { svc, integrations } = makeStorefront(prisma);
    const token = await cartReady(svc);
    await expect(svc.expressCheckout("shop-one", null, { cartToken: token } as any))
      .rejects.toThrow("এক্সপ্রেস অর্ডারের জন্য আগে লগইন করুন");
    await expect(svc.expressCheckout("shop-one", "bogus-token", { cartToken: token } as any))
      .rejects.toThrow("এক্সপ্রেস অর্ডারের জন্য আগে লগইন করুন");
    expect(integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("with a session + default address → places via checkout with the address fields", async () => {
    const prisma = makePrisma(); seedShop(prisma); seedAccount(prisma);
    const { svc, placed } = makeStorefront(prisma);
    const token = await cartReady(svc);
    const out: any = await svc.expressCheckout("shop-one", "tok-1", { cartToken: token } as any);
    expect(out.success).toBe(true);
    expect(placed).toHaveLength(1);
    expect(placed[0].customer.firstName).toBe("রহিম উদ্দিন");
    expect(placed[0].customer.phone).toBe("01711111111");
    expect(placed[0].customer.address.address_1).toBe("বাড়ি ১, রোড ২");
    expect(placed[0].customer.address.district).toBe("ঢাকা");
    expect(out.deposit.amountMinor).toBe("11200");
    expect(prisma.order.rows[0].depositDueMinor).toBe(11200n);
  });

  it("explicit addressId of another customer → 400; no saved address → 400", async () => {
    const prisma = makePrisma(); seedShop(prisma); seedAccount(prisma);
    prisma.customerAddress.rows.push({
      id: "addr-other", organizationId: "org-1", customerId: "cust-2",
      recipientName: "অন্য", phone: "01811111111", addressLine: "অন্য বাড়ি", district: "খুলনা",
      isDefault: false, createdAt: new Date(), updatedAt: new Date(),
    });
    const { svc } = makeStorefront(prisma);
    const token = await cartReady(svc);
    await expect(svc.expressCheckout("shop-one", "tok-1", { cartToken: token, addressId: "addr-other" } as any))
      .rejects.toThrow("ঠিকানাটি আপনার অ্যাকাউন্টে পাওয়া যায়নি");

    const prisma2 = makePrisma(); seedShop(prisma2);
    prisma2.customer.rows.push({
      id: "cust-9", organizationId: "org-1", phone: "01711111111", firstName: "নতুন",
      mergedIntoId: null, createdAt: new Date(), updatedAt: new Date(),
    });
    prisma2.shopSession.rows.push({
      id: "sess-9", organizationId: "org-1", customerId: "cust-9",
      tokenHash: hashShopSecret("tok-9"),
      expiresAt: new Date(Date.now() + 3600 * 1000), revokedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const w2 = makeStorefront(prisma2);
    const token2 = await cartReady(w2.svc);
    await expect(w2.svc.expressCheckout("shop-one", "tok-9", { cartToken: token2 } as any))
      .rejects.toThrow("কোনো সংরক্ষিত ঠিকানা নেই");
  });
});
