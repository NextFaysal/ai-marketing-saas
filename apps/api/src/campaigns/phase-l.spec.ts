process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { policyFindingsForText } from "./policy-check";
import { CampaignsService } from "./campaigns.service";
import { OfflineConversionsService, googleDateTime } from "../offline-conversions/offline-conversions.service";
import { PortfolioService } from "../portfolio/portfolio.service";
import { encryptJson } from "../integrations/crypto";

const audit = { log: async () => undefined } as any;
const llm = { getProvider: () => null } as any;

function table(name: string, rows: any[] = []) {
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === "object") return true;
      return r[k] === v;
    })) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === "object" && "in" in (v as any)) return (v as any).in.includes(r[k]);
      if (v && typeof v === "object" && "gte" in (v as any)) return new Date(r[k]) >= new Date((v as any).gte);
      if (v && typeof v === "object") return true;
      return r[k] === v;
    })),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    count: async ({ where }: any = {}) => rows.filter((r) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v)).length,
  };
}

function basePrisma() {
  const gSecrets = encryptJson({ clientId: "cid", clientSecret: "cs", refreshToken: "rt", developerToken: "dev" });
  const tSecrets = encryptJson({ accessToken: "tt-token" });
  const t: any = {
    campaignPlan: table("plan"), campaignAdSet: table("adset"), campaignAd: table("ad"),
    campaignPublishLog: table("log"), adAccount: table("account"), integration: table("integration"),
    integrationCredential: table("cred"), order: table("order"), attributionCredit: table("credit"),
    touchpoint: table("tp"), offlineConversionSetting: table("ocset"), offlineConversionLog: table("oclog"),
    membership: table("member"), organization: table("org"), dailyAdMetric: table("metric"),
    user: table("user"), product: table("product"), creativeAsset: table("asset"),
  };
  t.integration.rows.push(
    { id: "int-g", organizationId: "org-1", provider: "google_ads", status: "CONNECTED" },
    { id: "int-t", organizationId: "org-1", provider: "tiktok_ads", status: "CONNECTED" },
  );
  t.integrationCredential.rows.push(
    { id: "cred-g", integrationId: "int-g", encryptedData: gSecrets },
    { id: "cred-t", integrationId: "int-t", encryptedData: tSecrets },
  );
  const attach = (orig: any) => async (args: any) => {
    const row = await orig(args);
    if (row && args?.include?.credential) return { ...row, credential: t.integrationCredential.rows.find((c: any) => c.integrationId === row.id) ?? null };
    return row;
  };
  t.integration.findFirst = attach(t.integration.findFirst);
  t.adAccount.rows.push(
    { id: "gacc-1", organizationId: "org-1", platform: "google", sourceType: "api", externalId: "1234567890", integrationId: "int-g", name: "G", currency: "BDT" },
    { id: "tacc-1", organizationId: "org-1", platform: "tiktok", sourceType: "api", externalId: "adv-1", integrationId: "int-t", name: "T", currency: "BDT" },
  );
  return t;
}

describe("Phase L - policy pre-flight", () => {
  it("catches BN personal attributes, before/after weight claims and hype; clean copy passes", () => {
    const bad = policyFindingsForText("আপনি কি মোটা হয়ে যাচ্ছেন? মাত্র ৭ দিনে ৫ কেজি কমবে গ্যারান্টি!!!");
    const rules = bad.map((f) => f.rule);
    expect(rules).toContain("personal_attributes");
    expect(rules).toContain("before_after_weight");
    expect(rules).toContain("guaranteed_results");
    expect(bad.find((f) => f.rule === "personal_attributes")!.severity).toBe("high");
    expect(policyFindingsForText("ভালো মানের কটন পাঞ্জাবি, সারা দেশে ক্যাশ অন ডেলিভারি।")).toEqual([]);
    expect(policyFindingsForText("BUY NOW BEST OFFER LIMITED TIME SALE").some((f) => f.rule === "excessive_caps")).toBe(true);
  });

  it("runs over a whole plan and counts severities", async () => {
    const prisma = basePrisma();
    prisma.campaignPlan.rows.push({ id: "plan-1", organizationId: "org-1", name: "P", status: "draft", adAccountId: "gacc-1" });
    prisma.campaignAdSet.rows.push({ id: "adset-1", planId: "plan-1", name: "S" });
    prisma.campaignAd.rows.push({ id: "ad-1", adSetId: "adset-1", name: "Ad", primaryText: "আপনার ওজন নিয়ে চিন্তিত? সমাধান এখানে", headline: "অর্ডার করুন", linkUrl: "https://x.example" });
    const svc = new CampaignsService(prisma as any, audit, llm);
    const out = await svc.preflight("org-1", "plan-1");
    expect(out.checkedAds).toBe(1);
    expect(out.summary.high).toBeGreaterThanOrEqual(1);
  });
});

describe("Phase L - google datetime", () => {
  it("formats Dhaka wall time with +06:00", () => {
    expect(googleDateTime(new Date("2026-10-10T08:30:05.000Z"))).toBe("2026-10-10 14:30:05+06:00");
  });
});

describe("Phase L - offline conversions", () => {
  function seedOrder(prisma: any, withClick: boolean) {
    prisma.order.rows.push({ id: "ord-1", organizationId: "org-1", externalNumber: "1001", status: "confirmed", totalMinor: 150000n, currency: "BDT", createdAt: new Date() });
    if (withClick) {
      prisma.attributionCredit.rows.push({ id: "cr-1", organizationId: "org-1", orderId: "ord-1", touchpointId: "tp-1", revenueMinor: 150000n });
      prisma.touchpoint.rows.push({ id: "tp-1", organizationId: "org-1", clickIdType: "gclid", clickId: "GCLID-9" });
      prisma.touchpoint.rows.push({ id: "tp-2", organizationId: "org-1", clickIdType: "ttclid", clickId: "TT-9" });
      prisma.attributionCredit.rows.push({ id: "cr-2", organizationId: "org-1", orderId: "ord-1", touchpointId: "tp-2", revenueMinor: 0n });
    }
  }
  it("google: sends only with a gclid, confirms via results, dedupes the second send", async () => {
    const prisma = basePrisma();
    seedOrder(prisma, true);
    await new OfflineConversionsService(prisma as any, audit).saveSetting("org-1", "u", "google", { adAccountId: "gacc-1", conversionAction: "998877", trigger: "cod_confirmed" });
    let uploads = 0;
    (global as any).fetch = async (url: string) => {
      if (url.includes("oauth2")) return { ok: true, status: 200, json: async () => ({ access_token: "at" }) } as any;
      uploads++;
      return { ok: true, status: 200, json: async () => ({ results: [{ gclid: "GCLID-9", conversionAction: "x" }] }) } as any;
    };
    const svc = new OfflineConversionsService(prisma as any, audit);
    const log: any = await svc.uploadForOrder("org-1", "ord-1", "google");
    expect(log.status).toBe("sent");
    const again: any = await svc.uploadForOrder("org-1", "ord-1", "google");
    expect(again.alreadySent).toBe(true);
    expect(uploads).toBe(1);
  });

  it("skips honestly when no click id exists, and records TikTok failure as failed", async () => {
    const prisma = basePrisma();
    seedOrder(prisma, false);
    const setup = new OfflineConversionsService(prisma as any, audit);
    await setup.saveSetting("org-1", "u", "google", { adAccountId: "gacc-1", conversionAction: "1" });
    const skipped: any = await setup.uploadForOrder("org-1", "ord-1", "google");
    expect(skipped.status).toBe("skipped");
    expect(skipped.detail).toContain("gclid");

    const prisma2 = basePrisma();
    seedOrder(prisma2, true);
    const svc2 = new OfflineConversionsService(prisma2 as any, audit);
    await svc2.saveSetting("org-1", "u", "tiktok", { adAccountId: "tacc-1", pixelCode: "PX1" });
    (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ code: 40001, message: "invalid ttclid" }) }) as any;
    await expect(svc2.uploadForOrder("org-1", "ord-1", "tiktok")).rejects.toMatchObject({ code: "offlineConversions.uploadDidNotConfirm" });
    expect(prisma2.offlineConversionLog.rows[0].status).toBe("failed");
    (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ code: 0, message: "OK" }) }) as any;
    const sent: any = await svc2.uploadForOrder("org-1", "ord-1", "tiktok");
    expect(sent.status).toBe("sent");
  });
});

describe("Phase L - agency portfolio", () => {
  it("rolls up the user's own orgs only, with honest ROAS", async () => {
    const prisma = basePrisma();
    prisma.user.rows.push({ id: "u-1", email: "owner@demo.local" });
    prisma.membership.rows.push(
      { id: "m1", userId: "u-1", organizationId: "org-1", role: "OWNER", status: "ACTIVE" },
      { id: "m2", userId: "u-1", organizationId: "org-2", role: "ADMIN", status: "ACTIVE" },
      { id: "m3", userId: "someone-else", organizationId: "org-3", role: "OWNER", status: "ACTIVE" },
    );
    prisma.organization.rows.push(
      { id: "org-1", name: "Client A" }, { id: "org-2", name: "Client B" }, { id: "org-3", name: "Not Mine" },
    );
    const now = new Date();
    prisma.dailyAdMetric.rows.push(
      { organizationId: "org-1", campaignExternalId: "c1", adExternalId: "", date: now, spendMinor: 10000n, conversions: 5n },
      { organizationId: "org-2", campaignExternalId: "c2", adExternalId: "", date: now, spendMinor: 5000n, conversions: 1n },
      { organizationId: "org-3", campaignExternalId: "c3", adExternalId: "", date: now, spendMinor: 999999n, conversions: 9n },
    );
    prisma.order.rows.push(
      { id: "o1", organizationId: "org-1", status: "confirmed", totalMinor: 30000n, createdAt: now },
      { id: "o2", organizationId: "org-1", status: "cancelled", totalMinor: 77777n, createdAt: now },
      { id: "o3", organizationId: "org-2", status: "completed", totalMinor: 5000n, createdAt: now },
    );
    const svc = new PortfolioService(prisma as any);
    const out = await svc.portfolioForUser("u-1");
    expect(out.organizations.map((o: any) => o.name)).toEqual(["Client A", "Client B"]);
    // OU1: both orgs default to BDT, so there is exactly one
    // currency group carrying the rolled-up money.
    expect(out.totalsByCurrency).toEqual([
      { currency: "BDT", monthSpendMinor: "15000", monthRevenueMinor: "35000", roas: 2.33 },
    ]);
    expect(out.totals.monthOrders).toBe(2);
    expect(out.totals.platformConversions).toBe(6);
    await expect(svc.sendWeeklyDigest("u-1")).rejects.toMatchObject({ code: "portfolio.emailIsNotConfiguredInThis" });
  });

  it("OU1: excludes non-ACTIVE memberships and never mixes currencies in totals", async () => {
    const prisma = basePrisma();
    prisma.user.rows.push({ id: "u-9", email: "agency@demo.local" });
    prisma.membership.rows.push(
      { id: "m1", userId: "u-9", organizationId: "org-usd", role: "OWNER", status: "ACTIVE" },
      { id: "m2", userId: "u-9", organizationId: "org-bdt", role: "ADMIN", status: "ACTIVE" },
      { id: "m3", userId: "u-9", organizationId: "org-susp", role: "ADMIN", status: "SUSPENDED" },
      { id: "m4", userId: "u-9", organizationId: "org-inv", role: "VIEWER", status: "INVITED" },
    );
    prisma.organization.rows.push(
      { id: "org-usd", name: "US Client", currency: "USD" },
      { id: "org-bdt", name: "BD Client", currency: "BDT" },
      { id: "org-susp", name: "Suspended Client", currency: "BDT" },
      { id: "org-inv", name: "Invited Client", currency: "BDT" },
    );
    const now = new Date();
    prisma.dailyAdMetric.rows.push(
      { organizationId: "org-usd", campaignExternalId: "c1", adExternalId: "", date: now, spendMinor: 10000n, conversions: 2n },
      { organizationId: "org-bdt", campaignExternalId: "c2", adExternalId: "", date: now, spendMinor: 7000n, conversions: 3n },
      { organizationId: "org-susp", campaignExternalId: "c3", adExternalId: "", date: now, spendMinor: 999000n, conversions: 9n },
      { organizationId: "org-inv", campaignExternalId: "c4", adExternalId: "", date: now, spendMinor: 888000n, conversions: 9n },
    );
    prisma.order.rows.push(
      { id: "o1", organizationId: "org-usd", status: "confirmed", totalMinor: 25000n, createdAt: now },
      { id: "o2", organizationId: "org-bdt", status: "confirmed", totalMinor: 14000n, createdAt: now },
      { id: "o3", organizationId: "org-susp", status: "confirmed", totalMinor: 999000n, createdAt: now },
    );
    const svc = new PortfolioService(prisma as any);
    const out = await svc.portfolioForUser("u-9");
    // Suspended + invited memberships are excluded entirely.
    expect(out.organizations.map((o: any) => o.name).sort()).toEqual(["BD Client", "US Client"]);
    // Each org row carries its own currency for honest formatting.
    expect(out.organizations.find((o: any) => o.name === "US Client")?.currency).toBe("USD");
    // Totals are per-currency groups — the USD 100.00 and the BDT
    // 70.00 are NEVER added into one mixed figure.
    expect(out.totalsByCurrency).toEqual([
      { currency: "USD", monthSpendMinor: "10000", monthRevenueMinor: "25000", roas: 2.5 },
      { currency: "BDT", monthSpendMinor: "7000", monthRevenueMinor: "14000", roas: 2 },
    ]);
    // Currency-neutral counts still total across orgs.
    expect(out.totals.monthOrders).toBe(2);
    expect(out.totals.platformConversions).toBe(5);
  });
});
