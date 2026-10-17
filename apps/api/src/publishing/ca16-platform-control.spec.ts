process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { PublishingService } from "./publishing.service";
import { encryptJson } from "../integrations/crypto";

/**
 * Campaign Builder Advanced CA16 (CB4): post-publish
 * control — the platform payloads, verified against a
 * stubbed fetch (LABELLED: stub evidence, not a live
 * platform call). Spike basis (official docs, verified
 * 2026-10-17): Google MutateCampaigns update +
 * updateMask for status, CampaignBudget mutate for
 * amount_micros, GAQL campaign.status read — all under
 * the single adwords OAuth scope the stored credentials
 * already exercise for CREATE mutates. TikTok:
 * /campaign/status/update/, /adgroup/update/ (budget at
 * the level this flow budgets), /campaign/get/.
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

function prismaWith(platform: "tiktok" | "google") {
  const secrets = platform === "tiktok"
    ? encryptJson({ accessToken: "tt-token" })
    : encryptJson({ clientId: "cid", clientSecret: "cs", refreshToken: "rt", developerToken: "dev" });
  const t: any = {
    adAccount: table("account"), integration: table("integration"),
    integrationCredential: table("cred"), platformPublication: table("pub"),
  };
  t.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform, externalId: platform === "tiktok" ? "adv-1" : "1234567890", integrationId: "int-1" });
  const credRow = { id: "cred-1", integrationId: "int-1", encryptedData: secrets };
  t.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: platform === "tiktok" ? "tiktok_ads" : "google_ads", status: "CONNECTED", credential: credRow });
  return t;
}

describe("CA16 — Google control payloads", () => {
  const calls: { url: string; body: any }[] = [];
  beforeEach(() => {
    calls.length = 0;
    (global as any).fetch = jest.fn(async (url: string, init: any = {}) => {
      let body: any;
      try { body = init.body ? JSON.parse(String(init.body)) : undefined; } catch { body = String(init?.body ?? ""); }
      calls.push({ url, body });
      const okJson = (json: any) => ({ ok: true, status: 200, json: async () => json });
      if (url.includes("oauth2.googleapis.com/token")) return okJson({ access_token: "at-1" });
      if (url.includes("/googleAds:search")) return okJson({ results: [{ campaign: { id: "555", status: "ENABLED" } }] });
      if (url.includes("/campaigns:mutate")) return okJson({ results: [{ resourceName: "customers/1234567890/campaigns/555" }] });
      if (url.includes("/campaignBudgets:mutate")) return okJson({ results: [{ resourceName: "customers/1234567890/campaignBudgets/777" }] });
      throw new Error(`unexpected fetch ${url}`);
    });
  });

  it("status read is a GAQL campaign.status search, verbatim out", async () => {
    const svc = new PublishingService(prismaWith("google"), audit);
    const out = await svc.getGoogleCampaignStatus("org-1", "acc-1", "555");
    expect(out).toEqual({ status: "ENABLED" });
    const search = calls.find((c) => c.url.includes("/googleAds:search"))!;
    expect(search.body.query).toContain("campaign.status");
    expect(search.body.query).toContain("campaign.id = 555");
  });

  it("status change is a campaigns:mutate UPDATE with updateMask=status", async () => {
    const svc = new PublishingService(prismaWith("google"), audit);
    const out = await svc.setGoogleCampaignStatus("org-1", "acc-1", "555", "PAUSED");
    expect(out).toEqual({ status: "PAUSED" });
    const call = calls.find((c) => c.url.includes("/campaigns:mutate"))!;
    expect(call.body.operations).toEqual([{
      update: { resourceName: "customers/1234567890/campaigns/555", status: "PAUSED" },
      updateMask: "status",
    }]);
  });

  it("budget change is a campaignBudgets:mutate UPDATE with amount_micros + its mask", async () => {
    const svc = new PublishingService(prismaWith("google"), audit);
    await svc.updateGoogleCampaignBudget("org-1", "acc-1", "customers/1234567890/campaignBudgets/777", 250);
    const call = calls.find((c) => c.url.includes("/campaignBudgets:mutate"))!;
    expect(call.body.operations).toEqual([{
      update: { resourceName: "customers/1234567890/campaignBudgets/777", amountMicros: 250_000_000 },
      updateMask: "amount_micros",
    }]);
  });

  it("a Google error is a thrown failure — never a silent success", async () => {
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.includes("oauth2.googleapis.com/token")) return { ok: true, status: 200, json: async () => ({ access_token: "at-1" }) };
      return { ok: false, status: 400, json: async () => ({ error: { message: "Campaign not found" } }) };
    });
    const svc = new PublishingService(prismaWith("google"), audit);
    await expect(svc.setGoogleCampaignStatus("org-1", "acc-1", "555", "PAUSED")).rejects.toThrow(/Campaign not found/);
  });
});

describe("CA16 — TikTok control payloads", () => {
  const calls: { url: string; body: any }[] = [];
  let failStatus = false;
  beforeEach(() => {
    calls.length = 0; failStatus = false;
    (global as any).fetch = jest.fn(async (url: string, init: any = {}) => {
      let body: any;
      try { body = init.body ? JSON.parse(String(init.body)) : undefined; } catch { body = undefined; }
      calls.push({ url, body });
      const ok = (data: any) => ({ ok: true, status: 200, json: async () => ({ code: 0, data }) });
      if (url.includes("/campaign/get/")) return ok({ list: [{ campaign_id: 100, operation_status: "DISABLE", secondary_status: "CAMPAIGN_STATUS_DISABLE" }] });
      if (url.includes("/campaign/status/update/")) {
        if (failStatus) return { ok: true, status: 200, json: async () => ({ code: 40100, message: "No permission to operate this campaign" }) };
        return ok({});
      }
      if (url.includes("/adgroup/update/")) return ok({});
      throw new Error(`unexpected fetch ${url}`);
    });
  });

  it("status read uses /campaign/get/ with the campaign filter; fields verbatim", async () => {
    const svc = new PublishingService(prismaWith("tiktok"), audit);
    const out = await svc.getTikTokCampaignStatus("org-1", "acc-1", "100");
    expect(out).toEqual({ operationStatus: "DISABLE", secondaryStatus: "CAMPAIGN_STATUS_DISABLE" });
    const call = calls.find((c) => c.url.includes("/campaign/get/"))!;
    expect(call.url).toContain("advertiser_id=adv-1");
    expect(decodeURIComponent(call.url)).toContain('"campaign_ids":[100]');
  });

  it("status change posts /campaign/status/update/ with ENABLE/DISABLE", async () => {
    const svc = new PublishingService(prismaWith("tiktok"), audit);
    const out = await svc.setTikTokCampaignStatus("org-1", "acc-1", "100", "DISABLE");
    expect(out).toEqual({ status: "DISABLE" });
    const call = calls.find((c) => c.url.includes("/campaign/status/update/"))!;
    expect(call.body).toEqual({ advertiser_id: "adv-1", campaign_ids: [100], operation_status: "DISABLE" });
  });

  it("budget change posts /adgroup/update/ — the level this flow budgets at", async () => {
    const svc = new PublishingService(prismaWith("tiktok"), audit);
    await svc.updateTikTokAdGroupBudget("org-1", "acc-1", "200", 300);
    const call = calls.find((c) => c.url.includes("/adgroup/update/"))!;
    expect(call.body).toEqual({ advertiser_id: "adv-1", adgroup_id: 200, budget: 300 });
  });

  it("a TikTok envelope error (code !== 0) throws with TikTok's own message", async () => {
    failStatus = true;
    const svc = new PublishingService(prismaWith("tiktok"), audit);
    await expect(svc.setTikTokCampaignStatus("org-1", "acc-1", "100", "ENABLE")).rejects.toThrow(/No permission to operate this campaign/);
  });
});
