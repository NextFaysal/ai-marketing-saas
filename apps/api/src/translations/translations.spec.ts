import "reflect-metadata";
import { BadRequestException, HttpException, NotFoundException } from "@nestjs/common";
import { TranslationsService } from "./translations.service";
import { StorefrontService } from "../storefront/storefront.service";
import { displayPriceLabel, parseRatePerUnit, resolveShopLocale } from "./translations";
import { displayPricesFor, overlayProductTranslations } from "./public-translations";

/**
 * NF5 (FB3) — multi-language + multi-currency storefront.
 * Fake-prisma harness in the booking / gc10 pattern (in-memory
 * tables, org-scoped `matches`). The PUBLIC rules are exercised
 * through the REAL StorefrontService.shopHome / checkout — the
 * same code shoppers hit — not through a re-implementation:
 *  (a) an unapproved (draft) translation is NEVER served;
 *  (b) a missing translation falls back to the base text;
 *  (c) an approved translation IS served for its locale;
 *  (d) org A's translations are never served for org B;
 *  (e) a display-currency rate never leaks into an order total —
 *      checkout totals exactly the base-currency amount;
 *  (f) the AI draft path creates status=draft, source=ai only.
 */

type Row = Record<string, any>;

function cmp(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => matches(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      if ("contains" in v) return String(row[k] ?? "").includes(String((v as any).contains));
      if ("lt" in v) return cmp(row[k], (v as any).lt) < 0;
      if ("lte" in v) return cmp(row[k], (v as any).lte) <= 0;
      if ("gt" in v) return cmp(row[k], (v as any).gt) > 0;
      if ("gte" in v) return cmp(row[k], (v as any).gte) >= 0;
      // nested relation / compound key object — flatten one level
      return matches(row, v);
    }
    if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime();
    return row[k] === v;
  });
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean);
  if (!specs.length) return rows;
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const [key, dir] = Object.entries(spec)[0] as [string, string];
      const c = cmp(a[key], b[key]);
      if (c !== 0) return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

function makeTable() {
  const rows: Row[] = [];
  let seq = 0;
  const table: any = {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) =>
      sortRows(rows.filter((r) => matches(r, where)), orderBy)[0] ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let found = sortRows(rows.filter((r) => matches(r, where)), orderBy);
      if (skip) found = found.slice(skip);
      if (take !== undefined) found = found.slice(0, take);
      return found;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const flat = Object.values(where ?? {}).find(
        (v: any) => v && typeof v === "object" && !(v instanceof Date),
      ) as Row | undefined;
      const probe = flat ?? where;
      const existing = rows.find((r) => matches(r, probe));
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return existing;
      }
      return table.create({ data: create });
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matches(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
  };
  return table;
}

function makePrisma() {
  return {
    organization: makeTable(), storefrontSetting: makeTable(), businessProfile: makeTable(),
    category: makeTable(), brand: makeTable(), product: makeTable(), productVariant: makeTable(),
    productImage: makeTable(), shippingZone: makeTable(), storeCart: makeTable(), storeCartItem: makeTable(),
    storeCartBundle: makeTable(), bundle: makeTable(), order: makeTable(), orderItem: makeTable(),
    fulfillment: makeTable(), deliverySlot: makeTable(), shopPage: makeTable(), customer: makeTable(),
    contentTranslation: makeTable(), displayCurrencyRate: makeTable(), aIUsageRecord: makeTable(),
    auditLog: makeTable(),
  } as any;
}

function seedShop(prisma: any) {
  prisma.organization.rows.push(
    { id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne", logoUrl: null, primaryColor: null, customDomain: null, currency: "BDT", whiteLabel: false },
    { id: "org-2", slug: "shop-two", name: "Shop Two Ltd", brandName: "ShopTwo", logoUrl: null, primaryColor: null, customDomain: null, currency: "BDT", whiteLabel: false },
  );
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: null, announcementText: "ঈদ অফার চলছে",
    showFeatured: true, showCategories: true, showSearch: true, metaDescription: null, locale: "bn",
    featuredProductIds: null, domainVerifyToken: null, domainVerifiedAt: null,
    returnPolicyText: "৭ দিনের রিটার্ন", deliveryPromiseText: null, supportPhone: null,
  });
  prisma.product.rows.push({
    id: "p-a", organizationId: "org-1", name: "চামড়ার ওয়ালেট", slug: "wallet", description: "খাঁটি চামড়ার তৈরি", category: null,
    categoryId: null, sku: "WAL-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, currency: "BDT",
    stockQuantity: 10, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null,
    bumpImageUrl: null, seoTitle: null, seoDescription: null, nameEn: null, descriptionEn: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  prisma.shippingZone.rows.push({
    id: "z-all", organizationId: "org-1", name: "সব জায়গায়", kind: "all", districts: null,
    chargeMinor: 6000n, deliveryDays: 2, freeAboveMinor: null, active: true, position: 0,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

function translationRow(over: Row = {}): Row {
  return {
    id: `t-${Math.random().toString(36).slice(2, 9)}`,
    organizationId: "org-1", entityType: "product", entityId: "p-a", field: "name",
    locale: "hi", text: "चमड़े का वॉलेट", status: "approved", source: "human",
    createdById: "u1", updatedById: "u1", createdAt: new Date(), updatedAt: new Date(),
    ...over,
  };
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

// ---------- pure helpers ----------

describe("NF5 helpers", () => {
  it("resolveShopLocale: supported shopper choice wins; unknown falls back to the setting", () => {
    expect(resolveShopLocale("hi", "bn")).toBe("hi");
    expect(resolveShopLocale("fr", "en")).toBe("en");
    expect(resolveShopLocale(undefined, null)).toBe("bn");
  });

  it("parseRatePerUnit accepts plain positive decimals only", () => {
    expect(parseRatePerUnit("119.50")).toBe(119.5);
    expect(parseRatePerUnit("0")).toBeNull();
    expect(parseRatePerUnit("-5")).toBeNull();
    expect(parseRatePerUnit("abc")).toBeNull();
    expect(parseRatePerUnit("1,200")).toBeNull();
  });

  it("displayPriceLabel is honest in bn / en / hi and names the base currency", () => {
    expect(displayPriceLabel("bn", "BDT")).toContain("আনুমানিক");
    expect(displayPriceLabel("bn", "BDT")).toContain("BDT");
    expect(displayPriceLabel("en", "BDT")).toContain("Approximate");
    expect(displayPriceLabel("hi", "BDT")).toContain("अनुमानित");
  });

  it("displayPricesFor: no rate → nothing shown; base-currency rate → nothing shown", () => {
    expect(displayPricesFor(50000n, "BDT", [], "en")).toEqual([]);
    expect(displayPricesFor(50000n, "BDT", [{ currency: "BDT", ratePerUnit: "1", sourceNote: "x" }], "en")).toEqual([]);
    const out = displayPricesFor(50000n, "BDT", [{ currency: "USD", ratePerUnit: "100", sourceNote: "ব্যাংক রেট" }], "bn");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ currency: "USD", amount: "5.00", sourceNote: "ব্যাংক রেট" });
    expect(out[0].label).toContain("আনুমানিক");
  });
});

// ---------- public read path (real StorefrontService) ----------

describe("NF5 public storefront (StorefrontService.shopHome)", () => {
  it("(a) a DRAFT translation is never served publicly", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    prisma.contentTranslation.rows.push(translationRow({ status: "draft", text: "खसड़ा नाम" }));
    const { svc } = makeStorefront(prisma);
    const home: any = await svc.shopHome("shop-one", { locale: "hi" });
    expect(home.products[0].name).toBe("চামড়ার ওয়ালেট");
    expect(JSON.stringify(home)).not.toContain("खसड़ा नाम");
  });

  it("(b) missing translation falls back to the base-language original", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const { svc } = makeStorefront(prisma);
    const home: any = await svc.shopHome("shop-one", { locale: "hi" });
    expect(home.products[0].name).toBe("চামড়ার ওয়ালেট");
    expect(home.products[0].description).toBe("খাঁটি চামড়ার তৈরি");
    expect(home.settings.locale).toBe("hi");
  });

  it("(c) an APPROVED translation is served for its locale (name + description + storefront string)", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    prisma.contentTranslation.rows.push(
      translationRow({}),
      translationRow({ field: "description", text: "असली चमड़े से बना" }),
      translationRow({ entityType: "storefront_string", entityId: "shop", field: "announcementText", text: "ईद ऑफ़र चल रहा है" }),
    );
    const { svc } = makeStorefront(prisma);
    const home: any = await svc.shopHome("shop-one", { locale: "hi" });
    expect(home.products[0].name).toBe("चमड़े का वॉलेट");
    expect(home.products[0].description).toBe("असली चमड़े से बना");
    expect(home.settings.announcementText).toBe("ईद ऑफ़र चल रहा है");
    // …and a different locale does NOT get the Hindi text.
    const homeBn: any = await svc.shopHome("shop-one", {});
    expect(homeBn.products[0].name).toBe("চামড়ার ওয়ালেট");
    expect(homeBn.settings.announcementText).toBe("ঈদ অফার চলছে");
  });

  it("(d) org isolation: org B's approved translation is never served for org A", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    prisma.contentTranslation.rows.push(translationRow({ organizationId: "org-2", text: "दूसरी दुकान का नाम" }));
    const { svc } = makeStorefront(prisma);
    const home: any = await svc.shopHome("shop-one", { locale: "hi" });
    expect(home.products[0].name).toBe("চামড়ার ওয়ালেট");
    expect(JSON.stringify(home)).not.toContain("दूसरी दुकान");
  });

  it("productDetail serves the approved translation + display price for the requested locale", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    prisma.contentTranslation.rows.push(translationRow({}));
    prisma.displayCurrencyRate.rows.push({
      id: "r-1", organizationId: "org-1", currency: "USD", ratePerUnit: "100",
      sourceNote: "ব্যাংকের আজকের রেট", updatedById: "u1", createdAt: new Date(), updatedAt: new Date(),
    });
    const { svc } = makeStorefront(prisma);
    const detail: any = await svc.productDetail("shop-one", "wallet", "hi");
    expect(detail.product.name).toBe("चमड़े का वॉलेट");
    expect(detail.product.displayPrices).toHaveLength(1);
    expect(detail.product.displayPrices[0]).toMatchObject({ currency: "USD", amount: "5.00" });
    expect(detail.product.displayPrices[0].label).toContain("अनुमानित");
    // The base price itself is untouched.
    expect(detail.product.priceMinor).toBe("50000");
  });

  it("(e) an order placed while a display currency is active totals EXACTLY the base amount", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    prisma.displayCurrencyRate.rows.push({
      id: "r-1", organizationId: "org-1", currency: "USD", ratePerUnit: "100",
      sourceNote: "ব্যাংকের আজকের রেট", updatedById: "u1", createdAt: new Date(), updatedAt: new Date(),
    });
    const { svc, placed } = makeStorefront(prisma);
    // The shopper browses with the display currency visible…
    const home: any = await svc.shopHome("shop-one", {});
    expect(home.products[0].displayPrices[0]).toMatchObject({ currency: "USD", amount: "5.00" });
    expect(home.settings.displayCurrencies).toHaveLength(1);
    // …then checks out: 500.00 BDT product + 60.00 BDT delivery.
    const { cartToken } = await svc.createCart("shop-one");
    await svc.patchCartLine("shop-one", cartToken, { productId: "p-a", quantity: 1 });
    const out: any = await svc.checkout("shop-one", {
      cartToken, name: "রহিম", phone: "01711111111", address: "বাড়ি ১, রোড ২", district: "ঢাকা",
    } as any);
    expect(placed).toHaveLength(1);
    expect(BigInt(placed[0].totalMinor)).toBe(56000n);
    expect(BigInt(out.totalMinor ?? placed[0].totalMinor)).toBe(56000n);
    // No converted figure (5.00 USD = 500 minor) anywhere in the order.
    expect(BigInt(placed[0].totalMinor)).not.toBe(500n);
  });

  it("overlay helper: approved row for another org is ignored even when queried directly", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    prisma.contentTranslation.rows.push(translationRow({ organizationId: "org-2", text: "अन्य दुकान" }));
    const products = [{ id: "p-a", name: "চামড়ার ওয়ালেট", description: "খাঁটি চামড়ার তৈরি" }];
    await overlayProductTranslations(prisma, "org-1", products, "hi");
    expect(products[0].name).toBe("চামড়ার ওয়ালেট");
  });
});

// ---------- staff service: human CRUD + currency rates ----------

function fakeLlm(provider: any) {
  return { forOrg: async () => provider, getProvider: () => provider } as any;
}

const realProvider = {
  name: "openai", isRealLlm: true,
  complete: async () => ({
    text: JSON.stringify({ name: "चमड़े का वॉलेट", description: "असली चमड़े से बना" }),
    model: "gpt-test", inputTokens: 12, outputTokens: 8, tokensEstimated: false,
  }),
};
const devProvider = {
  name: "dev-template", isRealLlm: false,
  complete: async () => { throw new Error("dev adapter must never be called for translations"); },
};

describe("NF5 staff translations service", () => {
  function makeSvc(prisma: any, llm?: any) {
    return new TranslationsService(prisma, llm, undefined);
  }

  it("human upsert defaults to draft; explicit approve is required and honoured", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const svc = makeSvc(prisma);
    const created: any = await svc.upsertHuman("org-1", "u1", {
      entityType: "product", entityId: "p-a", field: "name", locale: "en", text: "Leather Wallet",
    });
    expect(created).toMatchObject({ status: "draft", source: "human", locale: "en" });
    const approved: any = await svc.updateTranslation("org-1", "u1", created.id, { status: "approved" });
    expect(approved.status).toBe("approved");
  });

  it("human upsert for another org's product 404s (org isolation on writes)", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    prisma.product.rows.push({ ...prisma.product.rows[0], id: "p-b", organizationId: "org-2" });
    const svc = makeSvc(prisma);
    await expect(svc.upsertHuman("org-1", "u1", {
      entityType: "product", entityId: "p-b", field: "name", locale: "en", text: "X",
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("validation: bad locale / bad field / empty text are Bengali 400s", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const svc = makeSvc(prisma);
    await expect(svc.upsertHuman("org-1", "u1", {
      entityType: "product", entityId: "p-a", field: "name", locale: "fr", text: "X",
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upsertHuman("org-1", "u1", {
      entityType: "product", entityId: "p-a", field: "price", locale: "en", text: "X",
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upsertHuman("org-1", "u1", {
      entityType: "product", entityId: "p-a", field: "name", locale: "en", text: "  ",
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("(f) AI draft path creates status=draft + source=ai — never auto-approved", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    // Even a previously APPROVED row is demoted back to draft by a
    // fresh AI generation (the new text is unverified).
    prisma.contentTranslation.rows.push(translationRow({ status: "approved", source: "human", text: "पुराना नाम" }));
    const svc = makeSvc(prisma, fakeLlm(realProvider));
    const out: any = await svc.generateProductDraft("org-1", "u1", "p-a", { locale: "hi" });
    expect(out.mode).toBe("ai_draft");
    expect(out.note).toContain("খসড়া");
    const nameRow = out.items.find((i: any) => i.field === "name");
    expect(nameRow).toMatchObject({ status: "draft", source: "ai", text: "चमड़े का वॉलेट" });
    expect(out.items.every((i: any) => i.status === "draft")).toBe(true);
    // And the fresh draft is NOT publicly served (rule (a) again,
    // straight after generation).
    const { svc: shop } = makeStorefront(prisma);
    const home: any = await shop.shopHome("shop-one", { locale: "hi" });
    expect(home.products[0].name).toBe("চামড়ার ওয়ালেট");
  });

  it("AI draft with NO real LLM configured fails honestly (Bengali) and writes nothing", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const svc = makeSvc(prisma, fakeLlm(devProvider));
    await expect(svc.generateProductDraft("org-1", "u1", "p-a", { locale: "hi" }))
      .rejects.toBeInstanceOf(BadRequestException);
    try {
      await svc.generateProductDraft("org-1", "u1", "p-a", { locale: "hi" });
    } catch (e: any) {
      expect(e.message).toContain("কোনো সক্রিয় AI মডেল কনফিগার করা নেই");
    }
    expect(prisma.contentTranslation.rows).toHaveLength(0);
  });

  it("AI draft respects the platform AI kill switch (403)", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    prisma.systemSetting = {
      findUnique: async ({ where }: any) =>
        where.key === "killSwitches" ? { key: "killSwitches", value: { aiDisabledOrgIds: ["org-1"], broadcastsPaused: false } } : null,
    };
    const svc = makeSvc(prisma, fakeLlm(realProvider));
    await expect(svc.generateProductDraft("org-1", "u1", "p-a", { locale: "hi" }))
      .rejects.toBeInstanceOf(HttpException);
    expect(prisma.contentTranslation.rows).toHaveLength(0);
  });

  it("AI strings draft: translates only strings that have base text, as drafts", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const stringsProvider = {
      name: "openai", isRealLlm: true,
      complete: async () => ({
        text: JSON.stringify({ announcementText: "ईद ऑफ़र चल रहा है", returnPolicyText: "७ दिन की वापसी" }),
        model: "gpt-test", inputTokens: 9, outputTokens: 7, tokensEstimated: false,
      }),
    };
    const svc = makeSvc(prisma, fakeLlm(stringsProvider));
    const out: any = await svc.generateStringsDraft("org-1", "u1", { locale: "hi" });
    expect(out.items).toHaveLength(2); // deliveryPromiseText has no base text → skipped, not invented
    expect(out.items.every((i: any) => i.status === "draft" && i.source === "ai" && i.entityType === "storefront_string")).toBe(true);
  });

  it("currency rates: human-entered only — source note required, base currency rejected, bad rate rejected", async () => {
    const prisma = makePrisma(); seedShop(prisma);
    const svc = makeSvc(prisma);
    await expect(svc.upsertCurrencyRate("org-1", "u1", { currency: "USD", ratePerUnit: "119.50", sourceNote: "" }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upsertCurrencyRate("org-1", "u1", { currency: "BDT", ratePerUnit: "1", sourceNote: "নিজে" }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.upsertCurrencyRate("org-1", "u1", { currency: "USD", ratePerUnit: "live?", sourceNote: "নিজে" }))
      .rejects.toBeInstanceOf(BadRequestException);
    const saved: any = await svc.upsertCurrencyRate("org-1", "u1", { currency: "usd", ratePerUnit: "119.50", sourceNote: "বাংলাদেশ ব্যাংকের ওয়েবসাইট, ১৭ অক্টোবর" });
    expect(saved).toMatchObject({ currency: "USD", ratePerUnit: "119.50", baseCurrency: "BDT" });
    const list: any = await svc.listCurrencyRates("org-1");
    expect(list.items).toHaveLength(1);
    const del: any = await svc.deleteCurrencyRate("org-1", "u1", "USD");
    expect(del.deleted).toBe(true);
    expect((await svc.listCurrencyRates("org-1")).items).toHaveLength(0);
  });
});
