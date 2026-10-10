process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { CampaignsService } from "./campaigns.service";
import { AudiencesService } from "../audiences/audiences.service";
import { PublishingService } from "../publishing/publishing.service";
import { JOB_TYPES } from "../automation/automation.service";
import { encryptJson } from "../integrations/crypto";

const audit = { log: async () => undefined } as any;
const llm = { getProvider: () => null } as any;

function table(name: string, rows: any[] = []) {
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => Object.entries(where ?? {}).every(([k, v]) => r[k] === v)) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id || r.organizationId === where.organizationId) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === "object" && "in" in (v as any)) return (v as any).in.includes(r[k]);
      if (v && typeof v === "object") return true;
      return r[k] === v;
    })),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}

function basePrisma() {
  const secrets = encryptJson({ accessToken: "tok-123" });
  const t: any = {
    campaignPlan: table("plan"), campaignAdSet: table("adset"), campaignAd: table("ad"),
    campaignPublishLog: table("log"), adAccount: table("account"), integration: table("integration"),
    integrationCredential: table("cred"), product: table("product"), creativeAsset: table("asset"),
    customer: table("customer"), lead: table("lead"), audienceRecord: table("audience"),
    order: table("order"), orderItem: table("orderItem"), platformPublication: table("pub"),
  };
  t.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "meta", status: "CONNECTED" });
  t.integrationCredential.rows.push({ id: "cred-1", integrationId: "int-1", encryptedData: secrets });
  // some resolvers attach credential via include; emulate
  const origFindFirst = t.integration.findFirst;
  t.integration.findFirst = async (args: any) => {
    const row = await origFindFirst(args);
    if (row && args?.include?.credential) return { ...row, credential: t.integrationCredential.rows.find((c: any) => c.integrationId === row.id) ?? null };
    return row;
  };
  const origFindUnique = t.integration.findUnique;
  t.integration.findUnique = async (args: any) => {
    const row = await origFindUnique(args);
    if (row && args?.include?.credential) return { ...row, credential: t.integrationCredential.rows.find((c: any) => c.integrationId === row.id) ?? null };
    return row;
  };
  t.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform: "meta", sourceType: "api", externalId: "act_777", integrationId: "int-1", name: "Main", currency: "BDT" });
  return t;
}

function fetchStub(handler: (url: string, init: any) => any) {
  const calls: { url: string; init: any }[] = [];
  (global as any).fetch = async (url: string, init: any) => {
    calls.push({ url: String(url), init });
    const out = handler(String(url), init);
    return { ok: true, status: 200, json: async () => out } as any;
  };
  return calls;
}

function publishedPlan(prisma: any) {
  prisma.campaignPlan.rows.push({ id: "plan-1", organizationId: "org-1", name: "Eid Sale 2026!", objective: "OUTCOME_SALES", status: "published", adAccountId: "acc-1", externalCampaignId: "camp-1", metaStatus: "ACTIVE" });
  prisma.campaignAdSet.rows.push({ id: "adset-1", planId: "plan-1", organizationId: "org-1", name: "Set A", dailyBudgetMinor: 50000n, optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "page-1", externalAdSetId: "adset-x", targeting: { countries: ["BD"] } });
  prisma.campaignAd.rows.push({ id: "ad-1", adSetId: "adset-1", organizationId: "org-1", name: "Ad A", primaryText: "x", linkUrl: "https://shop.example/p", externalAdId: "ad-x", format: "link" });
}

describe("Phase J - status sync surfaces disapprovals", () => {
  it("stores effective statuses and reports the DISAPPROVED ad as a health issue", async () => {
    const prisma = basePrisma();
    publishedPlan(prisma);
    fetchStub((url) => {
      if (url.includes("/camp-1")) return { status: "ACTIVE", effective_status: "ACTIVE" };
      if (url.includes("/adset-x")) return { status: "ACTIVE", effective_status: "ACTIVE" };
      if (url.includes("/ad-x")) return { status: "PAUSED", effective_status: "DISAPPROVED", issues_info: [{ error_summary: "Policy violation" }] };
      return {};
    });
    const svc = new CampaignsService(prisma as any, audit, llm);
    const out: any = await svc.syncObjectStatuses("org-1", "user-1", "plan-1");
    expect(out.metaEffectiveStatus).toBe("ACTIVE");
    expect(out.healthIssues).toHaveLength(1);
    expect(out.healthIssues[0]).toMatchObject({ level: "ad", status: "DISAPPROVED" });
    const ad = prisma.campaignAd.rows[0];
    expect(ad.effectiveStatus).toBe("DISAPPROVED");
    expect(ad.issuesInfo).toEqual([{ error_summary: "Policy violation" }]);
    expect(prisma.campaignPlan.rows[0].lastStatusSyncAt).toBeTruthy();
  });

  it("refuses status sync for an unpublished plan", async () => {
    const prisma = basePrisma();
    prisma.campaignPlan.rows.push({ id: "plan-2", organizationId: "org-1", name: "Draft", status: "draft", adAccountId: "acc-1" });
    const svc = new CampaignsService(prisma as any, audit, llm);
    await expect(svc.syncObjectStatuses("org-1", "user-1", "plan-2")).rejects.toThrow(/no Meta campaign/);
  });
});

describe("Phase J - UTM governance + live schedule", () => {
  it("tags links and never overwrites owner UTMs", () => {
    const svc = new CampaignsService(basePrisma() as any, audit, llm);
    const tagged = svc.tagUtm("https://shop.example/p?color=red", "Eid Sale 2026!");
    expect(tagged.changed).toBe(true);
    expect(tagged.url).toContain("utm_source=facebook");
    expect(tagged.url).toContain("utm_campaign=eid-sale-2026");
    expect(tagged.url).toContain("color=red");
    const own = svc.tagUtm("https://shop.example/p?utm_campaign=my-own", "Eid Sale");
    expect(own.url).toContain("utm_campaign=my-own");
    expect(svc.tagUtm("not a url", "X")).toEqual({ url: "not a url", changed: false });
  });

  it("updates a live ad set schedule on Meta first, then locally", async () => {
    const prisma = basePrisma();
    publishedPlan(prisma);
    const calls = fetchStub(() => ({}));
    const svc = new CampaignsService(prisma as any, audit, llm);
    await svc.updateAdSetSchedule("org-1", "user-1", "plan-1", "adset-1", { startTime: "2026-11-01T03:00:00.000Z" });
    const post = calls.find((c) => c.init?.method === "POST" && c.url.includes("/adset-x"));
    expect(post).toBeTruthy();
    expect(String(post!.init.body)).toContain("start_time");
    expect(prisma.campaignAdSet.rows[0].startTime).toEqual(new Date("2026-11-01T03:00:00.000Z"));
  });
});

describe("Phase J - audience membership refresh", () => {
  it("appends hashed contacts to the existing audience and records the sync", async () => {
    const prisma = basePrisma();
    prisma.audienceRecord.rows.push({ id: "aud-1", organizationId: "org-1", adAccountId: "acc-1", name: "Buyers", kind: "custom", source: "customers", status: "ready", externalAudienceId: "238501" });
    prisma.customer.rows.push({ id: "c-1", organizationId: "org-1", email: "a@example.com", phone: "01712345678", mergedIntoId: null });
    const calls = fetchStub((url) => {
      if (url.includes("/238501/users")) return { num_received: 1 };
      return {};
    });
    const svc = new AudiencesService(prisma as any, audit);
    const out: any = await svc.refreshMembership("org-1", "user-1", "aud-1");
    expect(out.uploaded).toBe(1);
    expect(out.receivedByMeta).toBe(1);
    const upload = calls.find((c) => c.url.includes("/238501/users"))!;
    const payload = JSON.parse(new URLSearchParams(String(upload.init.body)).get("payload") ?? "{}");
    expect(JSON.stringify(payload)).not.toContain("a@example.com");
    expect(JSON.stringify(payload)).not.toContain("01712345678");
    expect(prisma.audienceRecord.rows[0].lastMembershipCount).toBe(1);
    expect(prisma.audienceRecord.rows[0].lastMembershipSyncAt).toBeTruthy();
  });

  it("refuses refresh for a lookalike record", async () => {
    const prisma = basePrisma();
    prisma.audienceRecord.rows.push({ id: "aud-2", organizationId: "org-1", adAccountId: "acc-1", name: "LAL", kind: "lookalike", source: "audience", status: "ready", externalAudienceId: "238502" });
    const svc = new AudiencesService(prisma as any, audit);
    await expect(svc.refreshMembership("org-1", "user-1", "aud-2")).rejects.toThrow(/custom audience/);
  });
});

describe("Phase J - Google keywords and assets", () => {
  function googlePrisma() {
    const prisma = basePrisma();
    const gSecrets = encryptJson({ clientId: "cid", clientSecret: "cs", refreshToken: "rt", developerToken: "dev", loginCustomerId: "1234567890" });
    prisma.integration.rows.push({ id: "int-g", organizationId: "org-1", provider: "google_ads", status: "CONNECTED" });
    prisma.integrationCredential.rows.push({ id: "cred-g", integrationId: "int-g", encryptedData: gSecrets });
    prisma.adAccount.rows.push({ id: "gacc-1", organizationId: "org-1", platform: "google", sourceType: "api", externalId: "1234567890", integrationId: "int-g", name: "G", currency: "BDT" });
    return prisma;
  }
  it("creates keywords, a negative and sitelink/callout assets — campaign still PAUSED", async () => {
    const prisma = googlePrisma();
    const creates: { resource: string; create: any }[] = [];
    fetchStub(async (url) => {
      if (url.includes("oauth2.googleapis.com")) return { access_token: "at" };
      if (url.includes("geoTargetConstants:suggest")) return { geoTargetConstantSuggestions: [{ geoTargetConstant: { resourceName: "geoTargetConstants/2076" } }] };
      const resource = url.split("/").pop()!.split(":")[0];
      return { results: [{ resourceName: `customers/1234567890/${resource}/1` }] };
    });
    const realFetch = (global as any).fetch;
    // capture mutate bodies
    (global as any).fetch = async (url: string, init: any) => {
      const out = await realFetch(url, init);
      try {
        const body = JSON.parse(String(init?.body ?? "{}"));
        for (const op of body.operations ?? []) if (op.create) creates.push({ resource: String(url).split("/").pop()!.split(":")[0], create: op.create });
      } catch { /* token call */ }
      return out;
    };
    const svc = new PublishingService(prisma as any, audit);
    const pub: any = await svc.publishGoogle("org-1", "user-1", {
      adAccountId: "gacc-1", name: "Search BD", dailyBudget: "500", countryCodes: ["BD"],
      headlines: ["Buy Shoes", "Best Shoes", "Shoes BD"], descriptions: ["Quality shoes.", "Cash on delivery."],
      finalUrl: "https://shop.example",
      keywords: [{ text: "buy shoes" }, { text: "shoes bd", matchType: "PHRASE" }],
      negativeKeywords: ["free"],
      sitelinks: [{ text: "Offers", url: "https://shop.example/offers" }],
      callouts: ["COD Available"],
    });
        expect(pub.status).toBe("created_paused");
    const kws = creates.filter((c) => c.resource === "adGroupCriteria");
    expect(kws.map((k) => k.create.keyword.text)).toEqual(["buy shoes", "shoes bd", "free"]);
    expect(kws[0].create.keyword.matchType).toBe("EXACT");
    expect(kws[1].create.keyword.matchType).toBe("PHRASE");
    expect(kws[2].create.negative).toBe(true);
    const assets = creates.filter((c) => c.resource === "assets");
    expect(assets.some((a) => a.create.sitelinkAsset?.linkText === "Offers")).toBe(true);
    expect(assets.some((a) => a.create.calloutAsset?.calloutText === "COD Available")).toBe(true);
    const links = creates.filter((c) => c.resource === "campaignAssets");
    expect(links.map((l) => l.create.fieldType).sort()).toEqual(["CALLOUT", "SITELINK"]);
  });

  it("refuses a Search campaign with no keywords before any API call", async () => {
    const prisma = googlePrisma();
    const svc = new PublishingService(prisma as any, audit);
    await expect(svc.publishGoogle("org-1", "user-1", {
      adAccountId: "gacc-1", name: "X", dailyBudget: "500", countryCodes: ["BD"],
      headlines: ["Aaa", "Bbb", "Ccc"], descriptions: ["One.", "Two."], finalUrl: "https://x.example",
      keywords: [],
    })).rejects.toThrow(/at least 1 keyword/);
  });
});

describe("Phase J - scheduler registry", () => {
  it("includes meta_status_sync and audience_refresh job types", () => {
    expect(JOB_TYPES).toContain("meta_status_sync");
    expect(JOB_TYPES).toContain("audience_refresh");
  });
});
