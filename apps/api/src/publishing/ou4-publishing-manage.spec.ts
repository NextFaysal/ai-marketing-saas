process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { PublishingService } from "./publishing.service";
import { encryptJson } from "../integrations/crypto";

/**
 * OU4 (part 1): PublishingService cross-platform status read +
 * lifecycle, proven against a prisma mock for accountSecrets
 * (real encryptJson credentials) and a global fetch stub.
 * Pins the status mapping (Google ENABLED/PAUSED/REMOVED,
 * TikTok ENABLE/DISABLE), the dash-stripped Google customer
 * id, the TikTok advertiserId fallback to the account's
 * externalId, and honest throws (missing account, provider
 * "no such campaign", TikTok envelope errors).
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

function prismaMock() {
  const t: any = { adAccount: table("account"), integration: table("integration"), platformPublication: table("pub") };
  t.adAccount.rows.push(
    { id: "acc-g", organizationId: "org", platform: "google", externalId: "123-456-7890", integrationId: "int-g" },
    { id: "acc-t", organizationId: "org", platform: "tiktok", externalId: "adv-999", integrationId: "int-t" },
  );
  t.integration.rows.push(
    { id: "int-g", organizationId: "org", provider: "google_ads", status: "CONNECTED", credential: { encryptedData: encryptJson({ clientId: "cid", clientSecret: "sec", refreshToken: "rt", developerToken: "dev" }) } },
    // No advertiserId in the TikTok secrets — the account externalId is the fallback.
    { id: "int-t", organizationId: "org", provider: "tiktok_ads", status: "CONNECTED", credential: { encryptedData: encryptJson({ accessToken: "tt-token" }) } },
  );
  return t;
}

const state: { googleStatus: string; googleResults: any[] | null; tiktokOp: string; tiktokCode: number } = {
  googleStatus: "ENABLED", googleResults: null, tiktokOp: "DISABLE", tiktokCode: 0,
};
const calls: { url: string; body: any }[] = [];

beforeEach(() => {
  calls.length = 0;
  state.googleStatus = "ENABLED"; state.googleResults = null; state.tiktokOp = "DISABLE"; state.tiktokCode = 0;
  (global as any).fetch = jest.fn(async (url: string, init: any = {}) => {
    const body = init.body ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : undefined;
    calls.push({ url: String(url), body });
    const okJson = (b: any) => ({ ok: true, status: 200, json: async () => b });
    if (String(url).includes("oauth2.googleapis.com")) return okJson({ access_token: "tok" });
    if (String(url).includes("googleAds:search")) {
      return okJson(state.googleResults !== null ? { results: state.googleResults } : { results: [{ campaign: { id: 555, name: "Sale", status: state.googleStatus } }] });
    }
    if (String(url).includes("/campaigns:mutate")) return okJson({ results: [{ resourceName: "customers/1234567890/campaigns/555" }] });
    if (String(url).includes("/campaign/get/")) {
      if (state.tiktokCode !== 0) return okJson({ code: state.tiktokCode, message: "Advertiser not authorized", data: null });
      return okJson({ code: 0, message: "OK", data: { list: [{ campaign_id: 777, campaign_name: "Spark", operation_status: state.tiktokOp }] } });
    }
    if (String(url).includes("/campaign/status/update/")) {
      if (state.tiktokCode !== 0) return okJson({ code: state.tiktokCode, message: "Advertiser not authorized", data: null });
      return okJson({ code: 0, message: "OK", data: {} });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

describe("OU4 PublishingService — Google status mapping", () => {
  it("ENABLED → active, PAUSED → paused, REMOVED → removed, raw kept verbatim", async () => {
    const svc = new PublishingService(prismaMock(), audit);
    await expect(svc.crossPlatformCampaignStatus("org", "acc-g", "google", "555")).resolves.toEqual({
      platform: "google", externalCampaignId: "555", name: "Sale", providerStatus: "active", providerStatusRaw: "ENABLED",
    });
    state.googleStatus = "PAUSED";
    await expect(svc.crossPlatformCampaignStatus("org", "acc-g", "google", "555")).resolves.toMatchObject({ providerStatus: "paused", providerStatusRaw: "PAUSED" });
    state.googleStatus = "REMOVED";
    await expect(svc.crossPlatformCampaignStatus("org", "acc-g", "google", "555")).resolves.toMatchObject({ providerStatus: "removed", providerStatusRaw: "REMOVED" });
    // customer id reaches Google dash-stripped
    expect(calls.some((c) => c.url.includes("/customers/1234567890/"))).toBe(true);
  });

  it("set PAUSED → campaigns:mutate with PAUSED and returns the confirmed mapping", async () => {
    const svc = new PublishingService(prismaMock(), audit);
    const out: any = await svc.crossPlatformSetCampaignStatus("org", "u1", "acc-g", "google", "555", "PAUSED");
    expect(out).toEqual({ platform: "google", externalCampaignId: "555", providerStatus: "paused", providerStatusRaw: "PAUSED" });
    const mutate = calls.find((c) => c.url.includes("/campaigns:mutate"))!;
    expect(mutate.url).toContain("/customers/1234567890/campaigns:mutate");
    expect(mutate.body.operations[0].update.status).toBe("PAUSED");
    const out2: any = await svc.crossPlatformSetCampaignStatus("org", "u1", "acc-g", "google", "555", "ACTIVE");
    expect(out2.providerStatusRaw).toBe("ENABLED");
  });

  it("Google returning no campaign is a throw, never a fabricated status", async () => {
    state.googleResults = [];
    const svc = new PublishingService(prismaMock(), audit);
    await expect(svc.crossPlatformCampaignStatus("org", "acc-g", "google", "555")).rejects.toThrow(/NOT confirmed/);
  });
});

describe("OU4 PublishingService — TikTok status mapping", () => {
  it("DISABLE → paused, ENABLE → active; advertiserId falls back to the account externalId", async () => {
    const svc = new PublishingService(prismaMock(), audit);
    await expect(svc.crossPlatformCampaignStatus("org", "acc-t", "tiktok", "777")).resolves.toEqual({
      platform: "tiktok", externalCampaignId: "777", name: "Spark", providerStatus: "paused", providerStatusRaw: "DISABLE",
    });
    expect(calls[0].url).toContain("advertiser_id=adv-999");
    state.tiktokOp = "ENABLE";
    await expect(svc.crossPlatformCampaignStatus("org", "acc-t", "tiktok", "777")).resolves.toMatchObject({ providerStatus: "active", providerStatusRaw: "ENABLE" });
  });

  it("set ACTIVE → campaign/status/update with ENABLE", async () => {
    const svc = new PublishingService(prismaMock(), audit);
    const out: any = await svc.crossPlatformSetCampaignStatus("org", "u1", "acc-t", "tiktok", "777", "ACTIVE");
    expect(out).toEqual({ platform: "tiktok", externalCampaignId: "777", providerStatus: "active", providerStatusRaw: "ENABLE" });
    const upd = calls.find((c) => c.url.includes("/campaign/status/update/"))!;
    expect(upd.body).toEqual({ advertiser_id: "adv-999", campaign_ids: ["777"], operation_status: "ENABLE" });
  });

  it("TikTok envelope errors surface verbatim", async () => {
    state.tiktokCode = 40002;
    const svc = new PublishingService(prismaMock(), audit);
    await expect(svc.crossPlatformCampaignStatus("org", "acc-t", "tiktok", "777")).rejects.toThrow(/not authorized/);
  });
});

describe("OU4 PublishingService — honest config failures", () => {
  it("a missing ad account throws the accountSecrets error", async () => {
    const svc = new PublishingService(prismaMock(), audit);
    await expect(svc.crossPlatformCampaignStatus("org", "acc-nope", "google", "555")).rejects.toThrow(/Ad account not found/);
    await expect(svc.crossPlatformSetCampaignStatus("org", "u1", "acc-nope", "tiktok", "777", "PAUSED")).rejects.toThrow(/Ad account not found/);
  });

  it("an unsupported platform is refused", async () => {
    const svc = new PublishingService(prismaMock(), audit);
    await expect(svc.crossPlatformCampaignStatus("org", "acc-g", "meta", "555")).rejects.toThrow(/Unsupported/);
  });
});
