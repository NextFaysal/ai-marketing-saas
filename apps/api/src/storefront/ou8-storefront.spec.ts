import { StorefrontService } from "./storefront.service";
import { sanitizeSectionOrder, isValidSectionOrder } from "./shop-sections";

/* OU8 — section customizer settings + lead-capture popup.
 * Minimal fake prisma (equality where, increment-aware update). */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (row[k] !== v) return false;
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
      for (const [k, v] of Object.entries(data as any)) {
        if (v && typeof v === "object" && "increment" in (v as any)) row[k] = (row[k] ?? 0) + (v as any).increment;
        else row[k] = v;
      }
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (row) { Object.assign(row, update); return row; }
      const made = { id: `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(made);
      return made;
    },
  };
}
function makeWorld() {
  const prisma: any = {
    organization: makeTable(),
    storefrontSetting: makeTable(),
    businessProfile: makeTable(),
    storePopup: makeTable(),
    lead: makeTable(),
    leadActivity: makeTable(),
    product: makeTable(),
  };
  prisma.organization.rows.push({ id: "org-1", slug: "shop-one", name: "Shop One", brandName: "ShopOne", logoUrl: null, primaryColor: null, customDomain: null });
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true, shopName: "Shop One",
    showFeatured: true, showCategories: true, showSearch: true,
    showHero: true, showBrands: true, showBundles: true, showFlashSale: true, showRecentlyViewed: true,
    sectionOrder: null, themeId: "classic", featuredProductIds: null,
  });
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new StorefrontService(prisma, undefined, undefined, audit as any, undefined, undefined);
  return { prisma, svc };
}

describe("OU8 shop-sections helpers", () => {
  it("sanitizes unknown/duplicate keys and validates strictly", () => {
    expect(sanitizeSectionOrder(["featured", "hero", "featured", "nope"])).toEqual(["featured", "hero"]);
    expect(sanitizeSectionOrder("nope")).toEqual([]);
    expect(isValidSectionOrder(["hero", "flash"])).toBe(true);
    expect(isValidSectionOrder(["hero", "products"])).toBe(false);
    expect(isValidSectionOrder("hero")).toBe(false);
  });
});

describe("OU8 section settings round-trip", () => {
  it("updateSettings stores toggles + sanitized order; staff read returns them", async () => {
    const { svc } = makeWorld();
    const out: any = await svc.updateSettings("org-1", "user-1", { showFeatured: false, showHero: false, sectionOrder: ["featured", "hero", "hero"] } as any);
    const setting = out.setting;
    expect(setting.showFeatured).toBe(false);
    expect(setting.showHero).toBe(false);
    expect(setting.showCategories).toBe(true);
    expect(setting.sectionOrder).toEqual(["featured", "hero"]);
  });

  it("updateSettings refuses an unknown section key", async () => {
    const { svc } = makeWorld();
    await expect(svc.updateSettings("org-1", "user-1", { sectionOrder: ["products"] } as any)).rejects.toThrow();
  });

  it("new themes are accepted by settings (warm/ocean/v2)", async () => {
    const { svc } = makeWorld();
    await svc.updateSettings("org-1", "user-1", { themeId: "warm" } as any);
    const setting = (svc as any).serializeSetting(await (svc as any).getSetting("org-1"));
    expect(setting.themeId).toBe("warm");
  });
});

describe("OU8 lead-capture popup", () => {
  function seedPopup(prisma: any, over: any = {}) {
    prisma.storePopup.rows.push({
      id: "pop-1", organizationId: "org-1", enabled: true, title: "অফার পেতে তথ্য দিন", body: "…",
      imageUrl: null, ctaText: "জমা দিন", ctaUrl: null, trigger: "delay_seconds", delaySeconds: 3,
      scrollPercent: 50, frequencyDays: 7, startsAt: null, endsAt: null, showOn: "all",
      impressions: 0, clicks: 0, mode: "lead", captureName: true, capturePhone: true, captureEmail: false,
      successMessage: "ধন্যবাদ!", captures: 0, ...over,
    });
  }

  it("public payload exposes lead mode + capture flags", async () => {
    const { prisma, svc } = makeWorld();
    seedPopup(prisma);
    const out: any = await svc.getPublicPopup("shop-one");
    expect(out.popup.mode).toBe("lead");
    expect(out.popup.capturePhone).toBe(true);
    expect(out.popup.captureEmail).toBe(false);
  });

  it("submission creates a REAL Lead (source website, stage new) + activity and bumps captures only", async () => {
    const { prisma, svc } = makeWorld();
    seedPopup(prisma);
    const out: any = await svc.submitPopupLead("shop-one", { name: "রহিম", phone: "01711111111" });
    expect(out.ok).toBe(true);
    expect(prisma.lead.rows).toHaveLength(1);
    expect(prisma.lead.rows[0]).toMatchObject({ organizationId: "org-1", name: "রহিম", phone: "01711111111", source: "website", stage: "new" });
    expect(prisma.leadActivity.rows.some((a: any) => a.leadId === prisma.lead.rows[0].id && a.type === "created")).toBe(true);
    expect(prisma.storePopup.rows[0].captures).toBe(1);
    expect(prisma.storePopup.rows[0].impressions).toBe(0);
  });

  it("required fields follow the capture flags (phone required, email not asked)", async () => {
    const { prisma, svc } = makeWorld();
    seedPopup(prisma);
    await expect(svc.submitPopupLead("shop-one", { name: "রহিম" })).rejects.toThrow();
    expect(prisma.lead.rows).toHaveLength(0);
  });

  it("promo-mode popup refuses lead submissions; disabled popup refuses too", async () => {
    const { prisma, svc } = makeWorld();
    seedPopup(prisma, { mode: "promo" });
    await expect(svc.submitPopupLead("shop-one", { name: "রহিম", phone: "01711111111" })).rejects.toThrow();
    prisma.storePopup.rows[0].mode = "lead";
    prisma.storePopup.rows[0].enabled = false;
    await expect(svc.submitPopupLead("shop-one", { name: "রহিম", phone: "01711111111" })).rejects.toThrow();
    expect(prisma.lead.rows).toHaveLength(0);
  });

  it("upsert refuses a lead popup that captures nothing", async () => {
    const { svc } = makeWorld();
    await expect(
      svc.upsertPopup("org-1", "user-1", { mode: "lead", captureName: false, capturePhone: false, captureEmail: false } as any),
    ).rejects.toThrow();
  });
});
