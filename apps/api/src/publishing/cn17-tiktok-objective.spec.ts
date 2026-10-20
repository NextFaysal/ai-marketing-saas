process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { PublishingService } from "./publishing.service";
import { encryptJson } from "../integrations/crypto";

/**
 * Frontier NB8 / CN17 — TikTok objective choice in the
 * PLAN/DRAFT path only. The optional objectiveType is the
 * whole contract: absent = the pre-NB8 TRAFFIC payloads,
 * byte for byte (the direct publishing page never sends
 * it). WEB_CONVERSIONS follows the TikTok v1.3 spike:
 * pixel_id + optimization_event on the AD GROUP,
 * CONVERT goal, OCPM billing. LEAD_GENERATION refuses —
 * a lead ad needs an Instant Form bound at the ad level
 * and this flow cannot supply one; a create call that is
 * known to fail is never made.
 */

const audit = { log: async () => undefined } as any;

function table(name: string, rows: any[] = []) {
  let seq = 0;
  const match = (r: any, where: any) => Object.entries(where ?? {}).every(([k, v]) => (v && typeof v === "object" ? true : r[k] === v));
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => match(r, where)) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => match(r, where)),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}

function prismaTikTok() {
  const t: any = {
    adAccount: table("account"), integration: table("integration"),
    integrationCredential: table("cred"), platformPublication: table("pub"),
  };
  t.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform: "tiktok", externalId: "adv-1", integrationId: "int-1" });
  const credRow = { id: "cred-1", integrationId: "int-1", encryptedData: encryptJson({ accessToken: "tt-token" }) };
  t.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "tiktok_ads", status: "CONNECTED", credential: credRow });
  return t;
}

const baseDto = {
  adAccountId: "acc-1", name: "Objective Ad", dailyBudget: "10", countryCodes: ["BD"],
  adText: "See this", landingUrl: "https://shop.example/p", imageUrl: "https://cdn.example/i.jpg",
};

describe("CN17 — publishTikTok objective (draft path only)", () => {
  const calls: { url: string; body: any }[] = [];
  beforeEach(() => {
    calls.length = 0;
    (global as any).fetch = jest.fn(async (url: string, init: any = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, body });
      const ok = (data: any) => ({ ok: true, status: 200, json: async () => ({ code: 0, data }) });
      if (url.includes("/identity/get/")) return ok({ identity_list: [{ identity_type: "CUSTOMIZED_USER", identity_id: "idn-1" }] });
      if (url.includes("/tool/location/")) return ok({ list: [{ code: "BD", location_id: 42 }] });
      if (url.includes("/campaign/create/")) return ok({ campaign_id: 100 });
      if (url.includes("/adgroup/create/")) return ok({ adgroup_id: 200 });
      if (url.includes("/file/image/ad/upload/")) return ok([{ image_id: "img-1" }]);
      if (url.includes("/ad/create/")) return ok({ ad_ids: [300] });
      throw new Error(`unexpected fetch ${url}`);
    });
  });

  it("no objectiveType → the legacy TRAFFIC payloads, byte for byte (campaign CPC/CLICK, no pixel fields)", async () => {
    const svc = new PublishingService(prismaTikTok(), audit);
    const out: any = await svc.publishTikTok("org-1", "u-1", { ...baseDto });
    expect(out.status).toBe("created_paused");
    const campaign = calls.find((c) => c.url.includes("/campaign/create/"))!.body;
    expect(campaign).toEqual({ advertiser_id: "adv-1", campaign_name: "Objective Ad", objective_type: "TRAFFIC", operation_status: "DISABLE" });
    const adgroup = calls.find((c) => c.url.includes("/adgroup/create/"))!.body;
    expect(adgroup.objective_type).toBe("TRAFFIC");
    expect(adgroup.billing_event).toBe("CPC");
    expect(adgroup.optimization_goal).toBe("CLICK");
    expect(adgroup.pixel_id).toBeUndefined();
    expect(adgroup.optimization_event).toBeUndefined();
    expect(adgroup.promotion_type).toBeUndefined();
  });

  it("WEB_CONVERSIONS → pixel + event on the ad group, CONVERT/OCPM/no-bid, campaign objective follows", async () => {
    const svc = new PublishingService(prismaTikTok(), audit);
    const out: any = await svc.publishTikTok("org-1", "u-1", { ...baseDto, objectiveType: "WEB_CONVERSIONS", pixelId: "px-77", optimizationEvent: "COMPLETE_PAYMENT" });
    expect(out.status).toBe("created_paused");
    expect(out.detail.objectiveType).toBe("WEB_CONVERSIONS");
    const campaign = calls.find((c) => c.url.includes("/campaign/create/"))!.body;
    expect(campaign.objective_type).toBe("WEB_CONVERSIONS");
    const adgroup = calls.find((c) => c.url.includes("/adgroup/create/"))!.body;
    expect(adgroup).toMatchObject({
      objective_type: "WEB_CONVERSIONS", promotion_type: "WEBSITE",
      pixel_id: "px-77", optimization_event: "COMPLETE_PAYMENT",
      billing_event: "OCPM", optimization_goal: "CONVERT", bid_type: "BID_TYPE_NO_BID",
      operation_status: "DISABLE",
    });
  });

  it("WEB_CONVERSIONS without pixel/event refuses BEFORE any platform call", async () => {
    const svc = new PublishingService(prismaTikTok(), audit);
    await expect(svc.publishTikTok("org-1", "u-1", { ...baseDto, objectiveType: "WEB_CONVERSIONS" })).rejects.toMatchObject({ code: "publishing.tiktokWebConversionsNeedsAPixelid" });
    expect(calls.length).toBe(0);
  });

  it("LEAD_GENERATION refuses with the Instant Form reason — the choice is storable in a draft, never sent to fail", async () => {
    const svc = new PublishingService(prismaTikTok(), audit);
    await expect(svc.publishTikTok("org-1", "u-1", { ...baseDto, objectiveType: "LEAD_GENERATION" })).rejects.toThrow(/Instant Form/);
    expect(calls.length).toBe(0);
  });

  it("an unknown objective refuses", async () => {
    const svc = new PublishingService(prismaTikTok(), audit);
    await expect(svc.publishTikTok("org-1", "u-1", { ...baseDto, objectiveType: "APP_PROMOTION" })).rejects.toMatchObject({ code: "publishing.unsupportedTiktokObjectiveForThisFlow" });
    expect(calls.length).toBe(0);
  });
});
