process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { CampaignsService } from "./campaigns.service";
import { CatalogsService, buildMetaProductSetFilter } from "../catalogs/catalogs.service";
import { encryptJson } from "../integrations/crypto";

const audit = { log: async () => undefined } as any;

function table(name: string, rows: any[] = []) {
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => Object.entries(where ?? {}).every(([k, v]) => (v && typeof v === "object" ? true : r[k] === v))) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === "object" && "in" in (v as any)) return (v as any).in.includes(r[k]);
      return v && typeof v === "object" ? true : r[k] === v;
    })),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

describe("Milestone 32 — Advantage+ Sales", () => {
  function setup() {
    const t: any = {
      campaignPlan: table("plan"), campaignAdSet: table("adset"), campaignAd: table("ad"),
      campaignPublishLog: table("log"), adAccount: table("account"), product: table("product"),
      creativeAsset: table("asset"),
    };
    t.campaignPlan.rows.push({
      id: "plan-adv", organizationId: "org-1", name: "Adv Plan", objective: "OUTCOME_SALES",
      status: "approved", adAccountId: "acc-1", advantagePlus: true, externalCampaignId: null,
    });
    t.campaignAdSet.rows.push({
      id: "set-1", planId: "plan-adv", name: "Broad", dailyBudgetMinor: "50000", optimizationGoal: "OFFSITE_CONVERSIONS",
      pixelId: "px-1", pageId: "pg-1", targeting: { countries: ["BD"], ageMin: 18, ageMax: 65 }, externalAdSetId: null,
    });
    t.campaignAd.rows.push({
      id: "ad-1", adSetId: "set-1", name: "Ad", primaryText: "Buy now", linkUrl: "https://shop.example/p",
      callToAction: "SHOP_NOW", format: "link", externalAdId: null,
    });
    return t;
  }

  it("publish moves the budget to the campaign and enables Advantage audience on ad sets", async () => {
    const t = setup();
    const svc = new CampaignsService(t, audit, {} as any);
    const captured: any = {};
    (svc as any).publishClient = async () => ({
      account: { externalId: "123456" },
      client: {
        createCampaign: async (_acc: string, input: any) => { captured.campaign = input; return { id: "camp-1" }; },
        createAdSet: async (_acc: string, input: any) => { captured.adSet = input; return { id: "set-ext-1" }; },
        createAd: async () => ({ id: "ad-ext-1" }),
      },
    });
    const out: any = await svc.publish("org-1", "u-1", "plan-adv");
    expect(out.status).toBe("published");
    expect(captured.campaign.dailyBudgetMinor).toBe("50000");
    expect(captured.adSet.dailyBudgetMinor).toBeUndefined();
    expect(captured.adSet.lifetimeBudgetMinor).toBeUndefined();
    expect(captured.adSet.targeting.targeting_automation).toEqual({ advantage_audience: 1 });
    expect(t.campaignPublishLog.rows.some((r: any) => r.step === "advantage_plus")).toBe(true);
  });

  it("validation and the toggle refuse non-SALES objectives and published plans", async () => {
    const t = setup();
    const svc = new CampaignsService(t, audit, {} as any);
    const full = { advantagePlus: true, objective: "OUTCOME_ENGAGEMENT", adSets: [{ name: "S", dailyBudgetMinor: "100", targeting: { countries: ["BD"] }, pageId: "p", ads: [{ name: "A", primaryText: "x", linkUrl: "https://x.co" }] }] };
    expect(svc.validatePlan(full).errors.some((e) => e.includes("OUTCOME_SALES"))).toBe(true);
    await expect(svc.setAdvantagePlus("org-1", "u-1", "plan-adv", true)).resolves.toBeTruthy(); // SALES plan: fine
    t.campaignPlan.rows[0].objective = "OUTCOME_ENGAGEMENT";
    await expect(svc.setAdvantagePlus("org-1", "u-1", "plan-adv", true)).rejects.toThrow(/OUTCOME_SALES/);
    t.campaignPlan.rows[0].objective = "OUTCOME_SALES";
    t.campaignPlan.rows[0].externalCampaignId = "camp-x";
    await expect(svc.setAdvantagePlus("org-1", "u-1", "plan-adv", false)).rejects.toMatchObject({ code: "campaigns.advantageCanOnlyBeChangedBefore" });
  });
});

describe("Milestone 32 — Meta-side product sets", () => {
  it("filter construction: single criterion bare, multiple combined with AND, none = null", () => {
    expect(buildMetaProductSetFilter({ category: "Shoes", inStockOnly: false })).toEqual({ category: { i_contains: "Shoes" } });
    expect(buildMetaProductSetFilter({ maxPriceMinor: 50000n, inStockOnly: true })).toEqual({
      and: [{ price: { lte: 50000 } }, { availability: { eq: "in stock" } }],
    });
    expect(buildMetaProductSetFilter({ inStockOnly: false })).toBeNull();
  });

  function catalogPrisma() {
    const t: any = {
      catalogRecord: table("cat"), productSet: table("set"), product: table("product"),
      integration: table("int"), integrationCredential: table("cred"),
    };
    t.catalogRecord.rows.push({ id: "cat-1", organizationId: "org-1", name: "Main", externalCatalogId: "998877" });
    t.productSet.rows.push({ id: "set-1", organizationId: "org-1", catalogRecordId: "cat-1", name: "Shoes under 500", category: "Shoes", maxPriceMinor: 50000n, inStockOnly: true, status: "local", externalSetId: null });
    const credRow = { id: "cred-1", integrationId: "int-1", encryptedData: encryptJson({ accessToken: "meta-token" }) };
    t.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "meta", status: "CONNECTED", credential: credRow, createdAt: new Date() });
    return t;
  }

  it("publish creates the set on Meta and stores the returned id; a second publish is a no-op", async () => {
    const t = catalogPrisma();
    const bodies: any[] = [];
    (global as any).fetch = jest.fn(async (url: string, init: any = {}) => {
      bodies.push({ url, body: init.body ? String(init.body) : "" });
      return { ok: true, status: 200, json: async () => ({ id: "ps-555" }) };
    });
    const svc = new CatalogsService(t, audit);
    const out: any = await svc.publishProductSet("org-1", "u-1", "cat-1", "set-1");
    expect(out.status).toBe("created");
    expect(out.externalSetId).toBe("ps-555");
    expect(bodies[0].url).toContain("/998877/product_sets");
    expect(bodies[0].body).toContain("access_token=meta-token");
    const again: any = await svc.publishProductSet("org-1", "u-1", "cat-1", "set-1");
    expect(again.alreadyCreated).toBe(true);
    expect(bodies).toHaveLength(1); // no second Meta call
  });

  it("a Meta rejection is stored on the set with Meta's error and surfaced", async () => {
    const t = catalogPrisma();
    (global as any).fetch = jest.fn(async () => ({
      ok: false, status: 400, json: async () => ({ error: { message: "Invalid filter parameter" } }),
    }));
    const svc = new CatalogsService(t, audit);
    await expect(svc.publishProductSet("org-1", "u-1", "cat-1", "set-1")).rejects.toThrow(/Invalid filter parameter/);
    const row = t.productSet.rows.find((r: any) => r.id === "set-1");
    expect(row.status).toBe("failed");
    expect(row.error).toContain("Invalid filter parameter");
    expect(row.externalSetId).toBeNull();
  });
});
