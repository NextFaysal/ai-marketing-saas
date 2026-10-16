import { BadRequestException, NotFoundException } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";
import { validateShopPageBlocks, slugifyShopPageTitle, SYSTEM_PAGES } from "./shop-pages";
import { normalizeProductVideo } from "../products/product-video";
import { normalizeEc24Fields } from "../products/products.service";

/* Fake prisma (EC spec style, self-contained copy — extended
 * with prisma { increment } update support for GB1 counters). */
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
      for (const [k, v] of Object.entries(data)) {
        if (v !== null && typeof v === "object" && "increment" in (v as any)) {
          row[k] = Number(row[k] ?? 0) + Number((v as any).increment);
        } else {
          row[k] = v;
        }
      }
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
    shippingZone: makeTable(),
    order: makeTable(),
    orderItem: makeTable(),
    fulfillment: makeTable(),
    shopPage: makeTable(),
    storePopup: makeTable(),
    shopContactMessage: makeTable(),
    membership: makeTable(),
    agentNotification: makeTable(),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");

function seedShop(prisma: any) {
  prisma.organization.rows.push(
    { id: "org-1", slug: "shop-one", name: "Shop One Ltd", brandName: "ShopOne", logoUrl: null, primaryColor: null, customDomain: null },
    { id: "org-2", slug: "shop-two", name: "Shop Two", brandName: null, logoUrl: null, primaryColor: null, customDomain: null },
  );
  prisma.storefrontSetting.rows.push(
    { id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: null, announcementText: null, showFeatured: true, showCategories: true, showSearch: true, metaDescription: null, featuredProductIds: null, supportPhone: "01900000000", domainVerifyToken: null, domainVerifiedAt: null, createdAt: T0, updatedAt: T0 },
  );
}

function makeService(prisma: any, email?: any) {
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new StorefrontService(
    prisma,
    undefined, undefined, audit as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    email,
  );
  return { svc, audit };
}

describe("GB1 validateShopPageBlocks", () => {
  it("normalizes every block type (contract shape { type, data })", () => {
    const out = validateShopPageBlocks([
      { type: "heading", data: { text: "শিরোনাম" } },
      { type: "heading", data: { text: "উপ-শিরোনাম", level: 3 } },
      { type: "paragraph", data: { text: "কিছু লেখা" } },
      { type: "list", data: { items: ["এক", "দুই"] } },
      { type: "faq", data: { items: [{ q: "প্রশ্ন?", a: "উত্তর" }] } },
      { type: "image", data: { url: "https://example.com/a.jpg", alt: "ছবি" } },
      { type: "contact_info", data: {} },
    ]);
    expect(out).toHaveLength(7);
    expect(out[0]).toEqual({ type: "heading", data: { text: "শিরোনাম", level: 2 } });
    expect(out[1]).toEqual({ type: "heading", data: { text: "উপ-শিরোনাম", level: 3 } });
    expect(out[2]).toEqual({ type: "paragraph", data: { text: "কিছু লেখা" } });
    expect(out[3]).toEqual({ type: "list", data: { items: ["এক", "দুই"] } });
    expect(out[4]).toEqual({ type: "faq", data: { items: [{ q: "প্রশ্ন?", a: "উত্তর" }] } });
    expect(out[5]).toEqual({ type: "image", data: { url: "https://example.com/a.jpg", alt: "ছবি" } });
    expect(out[6]).toEqual({ type: "contact_info", data: {} });
  });

  it("rejects unknown types, flat (non-contract) blocks, raw oversize and per-field oversize in Bengali", () => {
    expect(() => validateShopPageBlocks([{ type: "html", data: { html: "<b>x</b>" } }])).toThrow(BadRequestException);
    expect(() => validateShopPageBlocks([{ type: "html", data: { html: "<b>x</b>" } }])).toThrow(/অজানা ব্লক ধরন/);
    // The FLAT shape is not the contract — fields must live in data.
    expect(() => validateShopPageBlocks([{ type: "paragraph", text: "flat" }])).toThrow(BadRequestException);
    expect(() => validateShopPageBlocks([{ type: "paragraph" }])).toThrow(BadRequestException);
    const fortyOne = Array.from({ length: 41 }, () => ({ type: "paragraph", data: { text: "x" } }));
    expect(() => validateShopPageBlocks(fortyOne)).toThrow(/সর্বোচ্চ 40টি/);
    const huge = Array.from({ length: 7 }, () => ({ type: "paragraph", data: { text: "অ".repeat(5000) } }));
    expect(() => validateShopPageBlocks(huge)).toThrow(/মোট আকার/);
    expect(() => validateShopPageBlocks([{ type: "heading", data: { text: "অ".repeat(201) } }])).toThrow(BadRequestException);
    expect(() => validateShopPageBlocks([{ type: "heading", data: { text: "ok", level: 5 } }])).toThrow(BadRequestException);
    expect(() => validateShopPageBlocks([{ type: "list", data: { items: [] } }])).toThrow(BadRequestException);
    expect(() => validateShopPageBlocks([{ type: "image", data: { url: "ftp://x/y.jpg" } }])).toThrow(BadRequestException);
    expect(() => validateShopPageBlocks("nope")).toThrow(BadRequestException);
    expect(validateShopPageBlocks(undefined)).toEqual([]);
    expect(validateShopPageBlocks([])).toEqual([]);
  });
});

describe("GB1 shop pages (service)", () => {
  it("slugify + createPage conflict + system slug immutability + delete guard", async () => {
    expect(slugifyShopPageTitle("Hello World! 2026")).toBe("hello-world-2026");
    expect(slugifyShopPageTitle("শুধু বাংলা")).toBe("");
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc, audit } = makeService(prisma);

    const made = await svc.createPage("org-1", "user-1", { title: "My Page", blocks: [{ type: "paragraph", data: { text: "হ্যালো" } }] } as any);
    expect(made.page.slug).toBe("my-page");
    expect(made.page.blocks).toEqual([{ type: "paragraph", data: { text: "হ্যালো" } }]);
    expect(made.page.isSystem).toBe(false);
    await expect(svc.createPage("org-1", "user-1", { title: "My Page" } as any)).rejects.toThrow(/এই slug-এ ইতিমধ্যে একটি পেজ আছে/);
    await expect(svc.createPage("org-1", "user-1", { title: "শুধু বাংলা" } as any)).rejects.toThrow(BadRequestException);
    // "about" was seeded as a system page by createPage's ensure step.
    await expect(svc.createPage("org-1", "user-1", { title: "About Clone", slug: "about" } as any)).rejects.toThrow(/ইতিমধ্যে/);

    const { pages } = await svc.listPages("org-1");
    const about = pages.find((p: any) => p.slug === "about")!;
    await expect(svc.updatePage("org-1", "user-1", about.id, { slug: "about-us" } as any)).rejects.toThrow(/slug বদলানো যায় না/);
    await expect(svc.deletePage("org-1", "user-1", about.id)).rejects.toThrow(/মুছে ফেলা যায় না/);
    // Foreign-org page id is a 404, never a leak.
    await expect(svc.updatePage("org-2", "user-1", about.id, { title: "X" } as any)).rejects.toBeInstanceOf(NotFoundException);

    const removed = await svc.deletePage("org-1", "user-1", made.page.id);
    expect(removed.deleted).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "storefront.page_created" }));
  });

  it("ensureSystemPages is idempotent via listPages", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    const first = await svc.listPages("org-1");
    const second = await svc.listPages("org-1");
    expect(first.pages).toHaveLength(SYSTEM_PAGES.length);
    expect(second.pages).toHaveLength(SYSTEM_PAGES.length);
    expect(first.pages.map((p: any) => p.slug)).toEqual(SYSTEM_PAGES.map((d) => d.slug));
    expect(first.pages.every((p: any) => p.isSystem && p.published === false)).toBe(true);
    expect(prisma.shopPage.rows).toHaveLength(SYSTEM_PAGES.length);
    // Contract shape: every seeded block is { type, data: {...} }.
    for (const row of prisma.shopPage.rows) {
      for (const b of row.blocks as any[]) {
        expect(b.type).toBeDefined();
        expect(b.data).toBeDefined();
        expect(typeof b.data).toBe("object");
        expect(b.text).toBeUndefined();
        expect(b.items).toBeUndefined();
      }
    }
  });

  it("getPublicPage: unpublished 404; published resolves contact_info from the business profile", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    prisma.businessProfile.rows.push({
      id: "bp-1", organizationId: "org-1", contactPhone: "01711111111", contactEmail: "hello@shop.example", address: "খুলনা, বাংলাদেশ",
    });
    const { svc } = makeService(prisma);
    await svc.listPages("org-1");
    await expect(svc.getPublicPage("shop-one", "contact")).rejects.toBeInstanceOf(NotFoundException);
    const { pages } = await svc.listPages("org-1");
    const contact = pages.find((p: any) => p.slug === "contact")!;
    await svc.updatePage("org-1", "user-1", contact.id, { published: true } as any);
    const pub = await svc.getPublicPage("shop-one", "contact");
    expect(pub.page.slug).toBe("contact");
    // All public blocks ship in the contract shape { type, data }.
    for (const b of pub.page.blocks as any[]) {
      expect(typeof b.data).toBe("object");
      expect(b.text).toBeUndefined();
    }
    const ci = pub.page.blocks.find((b: any) => b.type === "contact_info");
    expect(ci.data).toEqual({ phone: "01711111111", email: "hello@shop.example", address: "খুলনা, বাংলাদেশ" });
    expect(pub.settings.locale).toBe("bn");
  });

  it("getPublicPage contact_info falls back to the setting supportPhone when no business profile", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    const { pages } = await svc.listPages("org-1");
    const contact = pages.find((p: any) => p.slug === "contact")!;
    await svc.updatePage("org-1", "user-1", contact.id, { published: true } as any);
    const pub = await svc.getPublicPage("shop-one", "contact");
    const ci = pub.page.blocks.find((b: any) => b.type === "contact_info");
    expect(ci.data).toEqual({ phone: "01900000000", email: null, address: null });
  });

  it("staffState carries page counts and a popup summary", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    await svc.listPages("org-1");
    const state = await svc.staffState("org-1");
    expect(state.pages).toEqual({ total: SYSTEM_PAGES.length, published: 0 });
    expect(state.popup).toMatchObject({ enabled: false, trigger: "delay_seconds", impressions: 0 });
  });
});

describe("GB1 popup", () => {
  it("public gating: disabled / out-of-schedule / in-window; upsert validation", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    expect((await svc.getPublicPopup("shop-one")).popup).toBeNull();

    await svc.upsertPopup("org-1", "user-1", { enabled: false, title: "অফার" } as any);
    expect((await svc.getPublicPopup("shop-one")).popup).toBeNull();

    const future = new Date(Date.now() + 3600_000).toISOString();
    await svc.upsertPopup("org-1", "user-1", { enabled: true, startsAt: future } as any);
    expect((await svc.getPublicPopup("shop-one")).popup).toBeNull();

    const past = new Date(Date.now() - 3600_000).toISOString();
    await svc.upsertPopup("org-1", "user-1", { startsAt: past, endsAt: future } as any);
    // endsAt <= startsAt on the merged state is refused.
    await expect(
      svc.upsertPopup("org-1", "user-1", { startsAt: future, endsAt: past } as any),
    ).rejects.toThrow(BadRequestException);
    await svc.upsertPopup("org-1", "user-1", { startsAt: past, endsAt: null } as any);
    await expect(
      svc.upsertPopup("org-1", "user-1", { ctaUrl: "notaurl" } as any),
    ).rejects.toThrow(BadRequestException);

    const pub = await svc.getPublicPopup("shop-one");
    expect(pub.popup).toMatchObject({ title: "অফার", trigger: "delay_seconds", delaySeconds: 5, showOn: "home" });

    const cfg = await svc.getPopupConfig("org-1");
    expect(cfg.popup).toMatchObject({ enabled: true, title: "অফার", impressions: 0, clicks: 0 });
  });

  it("recordPopupEvent increments counters and always returns ok", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    await svc.upsertPopup("org-1", "user-1", { enabled: true, title: "অফার" } as any);
    expect(await svc.recordPopupEvent("shop-one", "impression")).toEqual({ ok: true });
    expect(await svc.recordPopupEvent("shop-one", "impression")).toEqual({ ok: true });
    expect(await svc.recordPopupEvent("shop-one", "click")).toEqual({ ok: true });
    const row = prisma.storePopup.rows[0];
    expect(row.impressions).toBe(2);
    expect(row.clicks).toBe(1);
    // Unknown shop: swallowed, still ok.
    expect(await svc.recordPopupEvent("no-such-shop", "impression")).toEqual({ ok: true });
  });
});

describe("GB1 contact form deliveredVia", () => {
  function contactWorld(withMembers: boolean, withEmailAddress: boolean) {
    const prisma = makePrisma();
    seedShop(prisma);
    if (withMembers) {
      prisma.membership.rows.push(
        { id: "m-1", organizationId: "org-1", userId: "u-owner", role: "OWNER", status: "ACTIVE" },
        { id: "m-2", organizationId: "org-1", userId: "u-admin", role: "ADMIN", status: "ACTIVE" },
        { id: "m-3", organizationId: "org-1", userId: "u-support", role: "SUPPORT_AGENT", status: "ACTIVE" },
      );
    }
    if (withEmailAddress) {
      prisma.businessProfile.rows.push({ id: "bp-1", organizationId: "org-1", contactEmail: "hello@shop.example", contactPhone: null, address: null });
    }
    return prisma;
  }
  const dto = { name: "রহিম", phone: "01711111111", message: "ডেলিভারি সম্পর্কে জানতে চাই" };

  it("notifications only", async () => {
    const prisma = contactWorld(true, false);
    const email = { send: jest.fn(async () => ({ providerMessageId: "m1" })) };
    const { svc } = makeService(prisma, email as any);
    const res = await svc.submitContactMessage("shop-one", dto as any);
    expect(res).toEqual({ ok: true, deliveredVia: "agent_notification" });
    expect(prisma.agentNotification.rows).toHaveLength(2); // OWNER + ADMIN only
    expect(prisma.agentNotification.rows[0].title).toContain("রহিম");
    expect(prisma.shopContactMessage.rows[0].deliveredVia).toBe("agent_notification");
    expect(email.send).not.toHaveBeenCalled();
  });

  it("email only", async () => {
    const prisma = contactWorld(false, true);
    const email = { send: jest.fn(async () => ({ providerMessageId: "m1" })) };
    const { svc } = makeService(prisma, email as any);
    const res = await svc.submitContactMessage("shop-one", dto as any);
    expect(res.deliveredVia).toBe("email");
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: "hello@shop.example" }));
    expect(prisma.shopContactMessage.rows[0].deliveredVia).toBe("email");
  });

  it("both channels join with +; neither ⇒ stored_only; a failed email is not counted", async () => {
    const bothPrisma = contactWorld(true, true);
    const okEmail = { send: jest.fn(async () => ({ providerMessageId: "m1" })) };
    const both = await makeService(bothPrisma, okEmail as any).svc.submitContactMessage("shop-one", dto as any);
    expect(both.deliveredVia).toBe("agent_notification+email");

    const nonePrisma = contactWorld(false, false);
    const none = await makeService(nonePrisma, okEmail as any).svc.submitContactMessage("shop-one", dto as any);
    expect(none.deliveredVia).toBe("stored_only");
    expect(nonePrisma.shopContactMessage.rows[0].deliveredVia).toBe("stored_only");

    const failPrisma = contactWorld(true, true);
    const badEmail = { send: jest.fn(async () => { throw new Error("SMTP down"); }) };
    const failed = await makeService(failPrisma, badEmail as any).svc.submitContactMessage("shop-one", dto as any);
    expect(failed.deliveredVia).toBe("agent_notification");
  });
});

describe("GB1 settings validation + serialization", () => {
  it("rejects bad favicon/Messenger URLs and bad WhatsApp numbers; accepts and serializes good values", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    await expect(svc.updateSettings("org-1", "user-1", { faviconUrl: "notaurl" } as any)).rejects.toThrow(/ফেভিকন URL সঠিক নয়/);
    await expect(svc.updateSettings("org-1", "user-1", { messengerUrl: "ftp://m.me/x" } as any)).rejects.toThrow(/Messenger URL সঠিক নয়/);
    await expect(svc.updateSettings("org-1", "user-1", { whatsappNumber: "abc!!" } as any)).rejects.toThrow(/WhatsApp নম্বর সঠিক নয়/);

    const saved = await svc.updateSettings("org-1", "user-1", {
      themeId: "bold",
      faviconUrl: "https://cdn.example.com/favicon.ico",
      whatsappNumber: "+880 1711-111111",
      messengerUrl: "https://m.me/shopone",
    } as any);
    expect(saved.setting).toMatchObject({
      themeId: "bold",
      faviconUrl: "https://cdn.example.com/favicon.ico",
      whatsappNumber: "+880 1711-111111",
      messengerUrl: "https://m.me/shopone",
    });
    const home = await svc.shopHome("shop-one", {});
    expect(home.settings).toMatchObject({ themeId: "bold", whatsappNumber: "+880 1711-111111" });
  });

  it("a fresh org serializes theme defaults (classic / nulls)", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    const { svc } = makeService(prisma);
    const saved = await svc.updateSettings("org-2", "user-1", {} as any);
    expect(saved.setting).toMatchObject({ themeId: "classic", faviconUrl: null, whatsappNumber: null, messengerUrl: null });
  });
});

describe("GB1 shopHome sorting", () => {
  function product(id: string, name: string, price: bigint, createdAt: string, sku: string) {
    return {
      id, organizationId: "org-1", name, slug: id, description: null, category: null, categoryId: null,
      sku, status: "ACTIVE", priceMinor: price, compareAtMinor: null, currency: "BDT",
      stockQuantity: null, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null,
      bumpImageUrl: null, videoUrl: null, videoPosterUrl: null,
      createdAt: new Date(createdAt), updatedAt: new Date(createdAt),
    };
  }
  function sortWorld() {
    const prisma = makePrisma();
    seedShop(prisma);
    prisma.product.rows.push(
      product("p1", "Banana", 30000n, "2026-09-01T00:00:00Z", "SKU-P1"),
      product("p2", "apple", 10000n, "2026-09-03T00:00:00Z", "SKU-P2"),
      product("p3", "Cherry", 20000n, "2026-09-02T00:00:00Z", "SKU-P3"),
      product("p4", "Dates", 20000n, "2026-09-04T00:00:00Z", "SKU-P4"),
    );
    return prisma;
  }
  const ids = (res: any) => res.products.map((p: any) => p.id);

  it("featured (default + unknown) keeps scan order; newest/price/name sort as specified", async () => {
    const prisma = sortWorld();
    const { svc } = makeService(prisma);
    expect(ids(await svc.shopHome("shop-one", {}))).toEqual(["p4", "p2", "p3", "p1"]);
    expect(ids(await svc.shopHome("shop-one", { sort: "nonsense" }))).toEqual(["p4", "p2", "p3", "p1"]);
    expect(ids(await svc.shopHome("shop-one", { sort: "newest" }))).toEqual(["p4", "p2", "p3", "p1"]);
    // price_asc: the 20000 tie breaks by createdAt desc (p4 before p3).
    expect(ids(await svc.shopHome("shop-one", { sort: "price_asc" }))).toEqual(["p2", "p4", "p3", "p1"]);
    expect(ids(await svc.shopHome("shop-one", { sort: "price_desc" }))).toEqual(["p1", "p4", "p3", "p2"]);
    expect(ids(await svc.shopHome("shop-one", { sort: "name_asc" }))).toEqual(["p2", "p1", "p3", "p4"]);
  });

  it("best_selling ranks by real qualified sales, then the rest newest-first", async () => {
    const prisma = sortWorld();
    const { svc } = makeService(prisma);
    const now = Date.now();
    prisma.order.rows.push(
      { id: "o1", organizationId: "org-1", isPractice: false, status: "completed", placedAt: new Date(now - 86400_000) },
      { id: "o2", organizationId: "org-1", isPractice: false, status: "processing", placedAt: new Date(now - 2 * 86400_000) },
      { id: "o3", organizationId: "org-1", isPractice: false, status: "cancelled", placedAt: new Date(now - 86400_000) },
      { id: "o4", organizationId: "org-1", isPractice: false, status: "completed", placedAt: new Date(now - 40 * 86400_000) },
      { id: "o5", organizationId: "org-1", isPractice: true, status: "completed", placedAt: new Date(now - 86400_000) },
    );
    prisma.fulfillment.rows.push({ id: "f2", orderId: "o2", status: "delivered" });
    prisma.orderItem.rows.push(
      { id: "i1", orderId: "o1", productId: "p1", sku: "SKU-P1", quantity: 2, totalMinor: 60000n },
      { id: "i2", orderId: "o1", productId: "p2", sku: "SKU-P2", quantity: 5, totalMinor: 50000n },
      { id: "i3", orderId: "o2", productId: "p1", sku: "SKU-P1", quantity: 3, totalMinor: 90000n },
      { id: "i4", orderId: "o2", productId: null, sku: "SKU-P3", quantity: 4, totalMinor: 80000n },
      { id: "i5", orderId: "o2", productId: null, sku: "ADD-ON-BUMP", quantity: 99, totalMinor: 99000n },
      { id: "i6", orderId: "o3", productId: "p4", sku: "SKU-P4", quantity: 100, totalMinor: 100000n },
      { id: "i7", orderId: "o4", productId: "p4", sku: "SKU-P4", quantity: 50, totalMinor: 50000n },
      { id: "i8", orderId: "o5", productId: "p4", sku: "SKU-P4", quantity: 70, totalMinor: 70000n },
    );
    // p1: qty 5 rev 150000; p2: qty 5 rev 50000; p3: qty 4 rev 80000; p4: no qualified sales.
    expect(ids(await svc.shopHome("shop-one", { sort: "best_selling" }))).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("best_selling with no sales falls back to the featured order", async () => {
    const prisma = sortWorld();
    const { svc } = makeService(prisma);
    expect(ids(await svc.shopHome("shop-one", { sort: "best_selling" }))).toEqual(["p4", "p2", "p3", "p1"]);
  });

  it("shopHome carries published page links", async () => {
    const prisma = sortWorld();
    const { svc } = makeService(prisma);
    const { pages } = await svc.listPages("org-1");
    const about = pages.find((p: any) => p.slug === "about")!;
    await svc.updatePage("org-1", "user-1", about.id, { published: true } as any);
    const home = await svc.shopHome("shop-one", {});
    expect(home.pages.menu).toEqual([{ slug: "about", title: "আমাদের সম্পর্কে" }]);
    expect(home.pages.footer).toEqual([{ slug: "about", title: "আমাদের সম্পর্কে" }]);
  });
});

describe("GB1 normalizeProductVideo", () => {
  it("YouTube variants normalize to the embed URL", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=abc123_-X",
      "https://youtu.be/abc123_-X",
      "https://www.youtube.com/shorts/abc123_-X",
      "https://www.youtube.com/embed/abc123_-X",
    ]) {
      expect(normalizeProductVideo({ videoUrl: url })).toEqual({
        kind: "youtube", embedUrl: "https://www.youtube.com/embed/abc123_-X", posterUrl: null,
      });
    }
  });

  it("Vimeo and direct files normalize; the poster passes through", () => {
    expect(normalizeProductVideo({ videoUrl: "https://vimeo.com/123456", videoPosterUrl: "https://x/p.jpg" })).toEqual({
      kind: "vimeo", embedUrl: "https://player.vimeo.com/video/123456", posterUrl: "https://x/p.jpg",
    });
    expect(normalizeProductVideo({ videoUrl: "https://cdn.example.com/v/clip.webm?dl=1" })).toEqual({
      kind: "file", url: "https://cdn.example.com/v/clip.webm?dl=1", posterUrl: null,
    });
    expect(normalizeProductVideo({ videoUrl: "https://cdn.example.com/v/clip.mp4" })?.kind).toBe("file");
  });

  it("anything else is null; the products write path rejects it in Bengali", () => {
    expect(normalizeProductVideo({ videoUrl: null })).toBeNull();
    expect(normalizeProductVideo({ videoUrl: "https://example.com/watch" })).toBeNull();
    expect(normalizeProductVideo({ videoUrl: "ftp://cdn.example.com/clip.mp4" })).toBeNull();
    expect(normalizeProductVideo({ videoUrl: "not a url" })).toBeNull();
    expect(() => normalizeEc24Fields({ videoUrl: "https://example.com/watch" }, true)).toThrow(/ভিডিও URL সঠিক নয়/);
    const ok = normalizeEc24Fields({ videoUrl: " https://youtu.be/abc123 ", videoPosterUrl: " https://x/p.jpg " }, true);
    expect(ok.videoUrl).toBe("https://youtu.be/abc123");
    expect(ok.videoPosterUrl).toBe("https://x/p.jpg");
    const cleared = normalizeEc24Fields({ videoUrl: null }, true);
    expect(cleared.videoUrl).toBeNull();
  });

  it("serializeProduct exposes the normalized video on shop reads", async () => {
    const prisma = makePrisma();
    seedShop(prisma);
    prisma.product.rows.push({
      id: "pv", organizationId: "org-1", name: "ভিডিও পণ্য", slug: "video-product", description: null,
      category: null, categoryId: null, sku: "V-1", status: "ACTIVE", priceMinor: 1000n, compareAtMinor: null,
      currency: "BDT", stockQuantity: null, lowStockThreshold: null, imageUrl: null, bumpTitle: null,
      bumpPriceMinor: null, bumpImageUrl: null,
      videoUrl: "https://www.youtube.com/watch?v=abc123_-X", videoPosterUrl: null,
      createdAt: T0, updatedAt: T0,
    });
    const { svc } = makeService(prisma);
    const detail = await svc.productDetail("shop-one", "video-product");
    expect(detail.product.video).toEqual({
      kind: "youtube", embedUrl: "https://www.youtube.com/embed/abc123_-X", posterUrl: null,
    });
  });
});
