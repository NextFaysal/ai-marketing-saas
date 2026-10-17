import { CampaignsService } from "./campaigns.service";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA24 (CB6): pre-flight
 * completion — LIVE platform reads through the plan
 * account's existing Meta client: (1) ad account
 * account_status + disable_reason, (2) each plan Page
 * still fetchable, (3) each plan Pixel's last_fired_time.
 * Pinned honesty rules: a check that could not be
 * performed is "not_checked" WITH the reason — never ok;
 * a platform-confirmed DISABLED account is an "error";
 * everything else adverse is a "warn". All Meta traffic
 * is a stubbed fetch (labelled stub evidence, no live
 * call); the checks are read-only.
 */
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    findUnique: async ({ where }: any = {}) => rows.find((r) => r.id === where.id || r.organizationId === where.organizationId) ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}
function fakePrisma(withIntegration = true) {
  const tables: any = {
    campaignPlan: makeTable("plan"), campaignAdSet: makeTable("adset"), campaignAd: makeTable("ad"),
    campaignPublishLog: makeTable("log"), adAccount: makeTable("account"), integration: makeTable("integration"),
    product: makeTable("product"), aIUsageRecord: makeTable("usage"), campaignPlanVersion: makeTable("version"),
  };
  tables.businessProfile = { findUnique: async () => ({ organizationId: "org-1", industry: "fashion", websiteUrl: "https://shop.example", brandVoice: "friendly" }) };
  if (withIntegration) {
    const secrets = encryptJson({ accessToken: "tok-123" });
    tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "meta", status: "CONNECTED", credential: { encryptedData: secrets } });
  }
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform: "meta", sourceType: "api", externalId: "act_777", integrationId: withIntegration ? "int-1" : null, name: "Main", currency: "BDT" });
  return tables;
}
const auditStub = { log: async () => undefined } as any;
const devLlm = { getProvider: () => new DevTemplateProvider() } as any;

type Behavior = { account?: any; accountFail?: boolean; pageFail?: boolean; pixel?: any; pixelFail?: boolean };
function metaFetch(b: Behavior) {
  const fetchFn = async (url: string) => {
    if (url.includes("act_777")) {
      if (b.accountFail) return { ok: false, status: 400, json: async () => ({ error: { message: "Invalid OAuth access token" } }) };
      return { ok: true, status: 200, json: async () => b.account ?? { name: "Main", account_status: 1, disable_reason: null } };
    }
    if (url.includes("/page-1")) {
      if (b.pageFail) return { ok: false, status: 400, json: async () => ({ error: { message: "(#803) Some of the aliases you requested do not exist: page-1" } }) };
      return { ok: true, status: 200, json: async () => ({ id: "page-1", name: "Qosprey Shop" }) };
    }
    if (url.includes("/pixel-1")) {
      if (b.pixelFail) return { ok: false, status: 400, json: async () => ({ error: { message: "Pixel not accessible" } }) };
      return { ok: true, status: 200, json: async () => b.pixel ?? { id: "pixel-1", name: "Shop Pixel", last_fired_time: "2026-10-16T10:20:30+0000" } };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return fetchFn;
}

async function planWith(svc: any, opts: { page?: boolean; pixel?: boolean } = { page: true, pixel: true }) {
  const plan = await svc.createPlan("org-1", "u", { name: "P", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  await svc.addAdSet("org-1", plan.id, {
    name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS",
    pageId: opts.page ? "page-1" : undefined, pixelId: opts.pixel ? "pixel-1" : undefined, countries: ["BD"],
  });
  return plan.id;
}
const byKey = (out: any, key: string) => out.checks.filter((c: any) => c.key === key);

describe("CA24 live platform preflight", () => {
  it("healthy platform: account ok, page ok with Meta's name, pixel ok with last_fired_time", async () => {
    const svc: any = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const planId = await planWith(svc);
    (global as any).fetch = metaFetch({});
    const out = await svc.platformPreflight("org-1", planId);
    expect(byKey(out, "account_status")[0].status).toBe("ok");
    expect(byKey(out, "page_access")[0].status).toBe("ok");
    expect(byKey(out, "page_access")[0].detail).toContain("Qosprey Shop");
    expect(byKey(out, "pixel_health")[0].status).toBe("ok");
    expect(byKey(out, "pixel_health")[0].detail).toContain("2026-10-16");
  });

  it("a Meta-confirmed DISABLED account is an error and carries disable_reason verbatim", async () => {
    const svc: any = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const planId = await planWith(svc);
    (global as any).fetch = metaFetch({ account: { name: "Main", account_status: 2, disable_reason: "ADS_INTEGRITY_POLICY" } });
    const out = await svc.platformPreflight("org-1", planId);
    const acc = byKey(out, "account_status")[0];
    expect(acc.status).toBe("error");
    expect(acc.detail).toContain("account_status 2");
    expect(acc.detail).toContain("ADS_INTEGRITY_POLICY");
  });

  it("an unreadable account is not_checked with the reason — never ok; other checks still run", async () => {
    const svc: any = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const planId = await planWith(svc);
    (global as any).fetch = metaFetch({ accountFail: true });
    const out = await svc.platformPreflight("org-1", planId);
    const acc = byKey(out, "account_status")[0];
    expect(acc.status).toBe("not_checked");
    expect(acc.detail).toContain("Invalid OAuth access token");
    expect(byKey(out, "page_access")[0].status).toBe("ok");
  });

  it("an unfetchable Page is a warn carrying Meta's own error; a pixel read failure is not_checked", async () => {
    const svc: any = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const planId = await planWith(svc);
    (global as any).fetch = metaFetch({ pageFail: true, pixelFail: true });
    const out = await svc.platformPreflight("org-1", planId);
    expect(byKey(out, "page_access")[0].status).toBe("warn");
    expect(byKey(out, "page_access")[0].detail).toContain("#803");
    expect(byKey(out, "pixel_health")[0].status).toBe("not_checked");
  });

  it("a pixel with no last_fired_time is a warn stating Meta reports no fire time", async () => {
    const svc: any = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const planId = await planWith(svc);
    (global as any).fetch = metaFetch({ pixel: { id: "pixel-1", name: "Shop Pixel", last_fired_time: null } });
    const out = await svc.platformPreflight("org-1", planId);
    const px = byKey(out, "pixel_health")[0];
    expect(px.status).toBe("warn");
    expect(px.detail).toContain("last_fired_time");
  });

  it("no Page/Pixel on the plan: both checks are not_checked with the reason", async () => {
    const svc: any = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const planId = await planWith(svc, { page: false, pixel: false });
    (global as any).fetch = metaFetch({});
    const out = await svc.platformPreflight("org-1", planId);
    expect(byKey(out, "page_access")[0].status).toBe("not_checked");
    expect(byKey(out, "pixel_health")[0].status).toBe("not_checked");
  });

  it("an account with no Meta connection: every check is not_checked, nothing is ok", async () => {
    const svc: any = new CampaignsService(fakePrisma(false) as any, auditStub, devLlm);
    const planId = await planWith(svc);
    const out = await svc.platformPreflight("org-1", planId);
    expect(out.checks.length).toBeGreaterThanOrEqual(3);
    expect(out.checks.every((c: any) => c.status === "not_checked")).toBe(true);
  });

  it("preflight() merges platformChecks only when asked (readiness keeps its old cost profile)", async () => {
    const svc: any = new CampaignsService(fakePrisma() as any, auditStub, devLlm);
    const planId = await planWith(svc);
    (global as any).fetch = metaFetch({});
    const plain = await svc.preflight("org-1", planId);
    expect((plain as any).platformChecks).toBeUndefined();
    const withPlatform = await svc.preflight("org-1", planId, { includePlatform: true });
    expect(Array.isArray(withPlatform.platformChecks)).toBe(true);
    expect(withPlatform.platformChecks.some((c: any) => c.key === "account_status" && c.status === "ok")).toBe(true);
  });
});
