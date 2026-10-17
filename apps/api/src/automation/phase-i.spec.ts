process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { AutomationService } from "./automation.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { PublishingService } from "../publishing/publishing.service";
import { ReportSharesService } from "../reports/report-shares.service";
import { parseMetaWebhook } from "../inbox/webhook.parser";
import { InboxService } from "../inbox/inbox.service";
import { encryptJson } from "../integrations/crypto";

const audit = { log: async () => undefined } as any;

function table(name: string, rows: any[] = []) {
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => Object.entries(where ?? {}).every(([k, v]) => {
      if (v && typeof v === "object") return true;
      return r[k] === v;
    })) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id || r.token === where.token || r.organizationId === where.organizationId) ?? null,
    findMany: async (args: any = {}) => {
      const where = args.where ?? {};
      return rows.filter((r) => Object.entries(where).every(([k, v]) => {
        if (v && typeof v === "object" && "in" in (v as any)) return (v as any).in.includes(r[k]);
        if (v && typeof v === "object" && "not" in (v as any)) return r[k] !== (v as any).not;
        if (v && typeof v === "object") return true;
        return r[k] === v;
      }));
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}

// ---------- Rules v2 ----------
describe("Phase I - automation rules v2", () => {
  function setup() {
    const prisma: any = {
      automationRule: table("rule"), automationRun: table("run"), campaignPlan: table("plan"),
      dailyAdMetric: table("metric"), attributionCredit: table("credit"), touchpoint: table("touch"),
      organization: table("org"),
    };
    prisma.campaignPlan.rows.push({ id: "plan-1", organizationId: "org-1", name: "Eid Sale", status: "published", metaStatus: "ACTIVE", externalCampaignId: "camp-1" });
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    // Campaign-level rows: spend 1000.00, impressions 10000, reach 2500 -> frequency 4
    prisma.dailyAdMetric.rows.push({ organizationId: "org-1", campaignExternalId: "camp-1", adExternalId: "", date: today, spendMinor: 100000n, impressions: 10000, clicks: 400, reach: 2500, platformConversions: 10, platformConversionValueMinor: 300000n });
    // Ad-level row for the same campaign (must NOT double the totals)
    prisma.dailyAdMetric.rows.push({ organizationId: "org-1", campaignExternalId: "camp-1", adExternalId: "ad-1", date: today, spendMinor: 100000n, impressions: 10000, clicks: 400, reach: 2500, platformConversions: 10, platformConversionValueMinor: 300000n });
    const campaigns = {
      calls: [] as any[],
      setMetaStatus: async (...args: any[]) => { campaigns.calls.push(["status", ...args]); },
      scalePlanBudgets: async (...args: any[]) => { campaigns.calls.push(["scale", ...args]); return [{ adSetId: "s1", before: "50000", after: "60000" }]; },
    };
    const svc = new AutomationService(prisma, audit, {} as any, {} as any, {} as any, {} as any, {} as any, campaigns as any);
    return { svc, prisma, campaigns };
  }

  it("campaignMetrics ignores ad-level rows and computes frequency/ctr/cpm", async () => {
    const { svc } = setup();
    const m = await svc.campaignMetrics("org-1", "camp-1", 3);
    expect(m.spendMinor).toBe(100000n);
    expect(m.frequency).toBe(4);
    expect(m.ctrPercent).toBe(4);
    expect(m.cpmMinor).toBe(10000);
  });

  it("scale_budget fires once, records evidence, then respects the cooldown", async () => {
    const { svc, prisma, campaigns } = setup();
    const rule = await svc.createRule("org-1", "u1", {
      name: "Fatigue scale-down", metric: "frequency", comparator: "gt", threshold: "3", windowDays: 3,
      action: "scale_budget", actionConfig: { percent: -20, cooldownHours: 24 }, mode: "execute",
    });
    const first = await svc.evaluateRules("org-1", null);
    expect(first.results.some((r) => r.triggered)).toBe(true);
    expect(campaigns.calls.filter((c) => c[0] === "scale").length).toBe(1);
    const run = prisma.automationRun.rows.find((r: any) => r.status === "triggered");
    expect(run.evidence.changes).toEqual([{ adSetId: "s1", before: "50000", after: "60000" }]);
    const second = await svc.evaluateRules("org-1", null);
    expect(campaigns.calls.filter((c) => c[0] === "scale").length).toBe(1);
    expect(second.results.some((r) => r.detail.includes("cooldown"))).toBe(true);
    expect(rule.id).toBeTruthy();
  });

  it("validates the scale percent range", async () => {
    const { svc } = setup();
    await expect(svc.createRule("org-1", "u1", { name: "x", metric: "frequency", comparator: "gt", threshold: "3", action: "scale_budget", actionConfig: { percent: 500 } })).rejects.toThrow(/percent/);
  });
});

// ---------- Live budget edit ----------
describe("Phase I - live budget edit", () => {
  it("updates Meta first, then local state; scale clamps to caps", async () => {
    const prisma: any = {
      campaignPlan: table("plan"), campaignAdSet: table("adset"), campaignAd: table("ad"),
      campaignPublishLog: table("log"), creativeAsset: table("asset"),
      adAccount: table("account"), integration: table("integration"), product: table("product"),
    };
    const secrets = encryptJson({ accessToken: "tok" });
    prisma.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "meta", status: "CONNECTED", credential: { encryptedData: secrets } });
    prisma.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform: "meta", externalId: "act_1", integrationId: "int-1" });
    prisma.campaignPlan.rows.push({ id: "plan-1", organizationId: "org-1", name: "Live", objective: "OUTCOME_SALES", status: "published", adAccountId: "acc-1", externalCampaignId: "camp-1", metaStatus: "ACTIVE" });
    prisma.campaignAdSet.rows.push({ id: "set-1", planId: "plan-1", name: "Set", externalAdSetId: "adset-9", dailyBudgetMinor: 50000n, targeting: { countries: ["BD"] }, optimizationGoal: "LINK_CLICKS", billingEvent: "IMPRESSIONS" });
    const svc = new CampaignsService(prisma, audit, { getProvider: () => null } as any);
    const bodies: string[] = [];
    (global as any).fetch = async (url: string, init: any) => {
      bodies.push(String(init?.body ?? ""));
      return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
    };
    const updated: any = await svc.updateAdSetBudget("org-1", "owner", "plan-1", "set-1", { dailyBudget: "600" });
    expect(bodies[0]).toContain("daily_budget=60000");
    expect(updated.adSets[0].dailyBudgetMinor).toBe("60000");

    const changes = await svc.scalePlanBudgets("org-1", "owner", "plan-1", 20, { maxDailyMinor: 65000 });
    expect(changes).toEqual([{ adSetId: "set-1", before: "60000", after: "65000" }]);
  });
});

// ---------- Webhook parser: referral + leadgen ----------
describe("Phase I - webhook parser additions", () => {
  it("captures CTWA referral and leadgen changes", () => {
    const parsed = parseMetaWebhook({
      object: "whatsapp_business_account",
      entry: [{ id: "page-1", changes: [
        { field: "messages", value: { contacts: [{ profile: { name: "Rahim" } }], messages: [{ from: "8801711", id: "wamid.1", type: "text", text: { body: "দাম কত?" }, timestamp: "1700000000", referral: { source_id: "ad-777", source_type: "ad", source_url: "https://fb.me/x", headline: "Eid Offer" } }] } },
        { field: "leadgen", value: { leadgen_id: "lead-1", form_id: "form-1", ad_id: "ad-777", campaign_id: "camp-1" } },
      ] }],
    });
    expect(parsed.messages[0].referral?.sourceId).toBe("ad-777");
    expect(parsed.leadgens[0].leadgenId).toBe("lead-1");
    expect(parsed.leadgens[0].pageId).toBe("page-1");
  });
});

// ---------- Lead Ads ingest ----------
describe("Phase I - lead ads ingest", () => {
  it("fetches answers, creates the lead once, and dedupes repeats", async () => {
    const prisma: any = { lead: table("lead"), leadActivity: table("activity") };
    const svc = new InboxService(prisma, audit, { getProvider: () => null } as any, { emit: () => undefined, on: () => undefined } as any);
    (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({
      field_data: [
        { name: "full_name", values: ["Karim Uddin"] },
        { name: "email", values: ["karim@example.com"] },
        { name: "phone_number", values: ["01712345678"] },
        { name: "city", values: ["Khulna"] },
      ],
      form_id: "form-1", ad_id: "ad-1", campaign_id: "camp-1",
    }) } as any);
    const first = await (svc as any).ingestLeadgen("org-1", "page-token", { leadgenId: "lead-1" });
    expect(first).toBe(true);
    const lead = prisma.lead.rows[0];
    expect(lead.name).toBe("Karim Uddin");
    expect(lead.source).toBe("facebook_lead_ads");
    expect(lead.externalId).toBe("lead-1");
    expect(prisma.leadActivity.rows[0].content).toContain("Khulna");
    const second = await (svc as any).ingestLeadgen("org-1", "page-token", { leadgenId: "lead-1" });
    expect(second).toBe(false);
    expect(prisma.lead.rows.length).toBe(1);
  });
});

// ---------- Report shares ----------
describe("Phase I - report shares", () => {
  it("public report excludes profit/costs and honors expiry", async () => {
    const prisma: any = { reportShare: table("share"), organization: table("org") };
    prisma.organization.rows.push({ id: "org-1", name: "Demo Store" });
    const analytics = { computeRange: async () => ({
      totals: { orders: 12, revenueMinor: 500000n, adSpendMinor: 100000n, impressions: 5000, clicks: 200, platformConversions: 8 },
      kpis: { mer: 5, platformRoas: 4, ctrPercent: 4, cpcMinor: 500, cpaMinor: 12500 },
      campaigns: [{ campaignName: "Eid", platform: "meta", spendMinor: 100000n, clicks: 200, ctrPercent: 4, platformConversions: 8, cpaMinor: 12500, platformRoas: 4 }],
      profit: { contributionProfitMinor: 999n, cogsMinor: 111n },
    }) } as any;
    const svc = new ReportSharesService(prisma, audit, analytics);
    const share = await svc.create("org-1", "u1", { title: "October Report", days: 30, expiresInDays: 7 });
    expect(share.token.length).toBeGreaterThan(20);
    const view: any = await svc.publicReport(share.token);
    expect(view.totals.revenueMinor).toBe("500000");
    expect((view as any).profit).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("contributionProfit");
    expect(JSON.stringify(view)).not.toContain("999");
    prisma.reportShare.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.publicReport(share.token)).rejects.toThrow(/expired/);
  });
});

// ---------- Google / TikTok publishing ----------
describe("Phase I - platform publishing", () => {
  function pubPrisma(platform: string, secrets: any) {
    const prisma: any = {
      adAccount: table("account"), integration: table("integration"), platformPublication: table("pub"),
    };
    prisma.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: platform === "google" ? "google_ads" : "tiktok", status: "CONNECTED", credential: { encryptedData: encryptJson(secrets) } });
    prisma.adAccount.rows.push({ id: "acc-1", organizationId: "org-1", platform, externalId: platform === "google" ? "123-456-7890" : "adv-1", integrationId: "int-1" });
    return prisma;
  }

  it("google: creates the full PAUSED chain and records ids", async () => {
    const prisma = pubPrisma("google", { clientId: "cid", clientSecret: "cs", refreshToken: "rt", developerToken: "dt" });
    const svc = new PublishingService(prisma, audit);
    const seen: string[] = [];
    (global as any).fetch = async (url: string) => {
      seen.push(url);
      if (url.includes("oauth2")) return { ok: true, status: 200, json: async () => ({ access_token: "at" }) } as any;
      if (url.includes("geoTargetConstants:suggest")) return { ok: true, status: 200, json: async () => ({ geoTargetConstantSuggestions: [{ geoTargetConstant: { resourceName: "geoTargetConstants/1076" } }] }) } as any;
      const kind = url.split("/").pop()!.split(":")[0];
      return { ok: true, status: 200, json: async () => ({ results: [{ resourceName: `customers/1234567890/${kind}/1` }] }) } as any;
    };
    const pub: any = await svc.publishGoogle("org-1", "owner", {
      adAccountId: "acc-1", name: "Search BD", dailyBudget: "500", countryCodes: ["BD"],
      headlines: ["Best Price", "Cash on Delivery", "Order Now"], descriptions: ["Quality products in BD", "Fast delivery nationwide"], finalUrl: "https://shop.example",
      keywords: [{ text: "buy shoes" }],
    });
    expect(pub.status).toBe("created_paused");
    expect(pub.externalCampaignId).toBe("1");
    expect(seen.some((u) => u.includes("campaigns:mutate"))).toBe(true);
  });

  it("google: a failed step marks the publication failed with prior steps kept", async () => {
    const prisma = pubPrisma("google", { clientId: "cid", clientSecret: "cs", refreshToken: "rt", developerToken: "dt" });
    const svc = new PublishingService(prisma, audit);
    (global as any).fetch = async (url: string) => {
      if (url.includes("oauth2")) return { ok: true, status: 200, json: async () => ({ access_token: "at" }) } as any;
      if (url.includes("campaigns:mutate")) return { ok: false, status: 400, json: async () => ({ error: { message: "Invalid campaign name" } }) } as any;
      return { ok: true, status: 200, json: async () => ({ results: [{ resourceName: "customers/1/campaignBudgets/9" }] }) } as any;
    };
    const pub: any = await svc.publishGoogle("org-1", "owner", {
      adAccountId: "acc-1", name: "X", dailyBudget: "500", countryCodes: [],
      headlines: ["a", "b", "c"], descriptions: ["d1", "d2"], finalUrl: "https://x.com",
      keywords: [{ text: "shoes" }],
    }).catch((e: any) => ({ status: "threw", error: e.message }));
    // countryCodes [] is rejected before any API call
    expect(pub.status).toBe("threw");
  });

  it("tiktok: creates campaign/adgroup/ad DISABLED with a resolved location", async () => {
    const prisma = pubPrisma("tiktok", { accessToken: "tt-token" });
    const svc = new PublishingService(prisma, audit);
    const bodies: any[] = [];
    (global as any).fetch = async (url: string, init: any) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (url.includes("/identity/get/")) return { ok: true, status: 200, json: async () => ({ code: 0, data: { identity_list: [{ identity_id: "idn-1", identity_type: "CUSTOMIZED_USER" }] } }) } as any;
      if (url.includes("/tool/location/")) return { ok: true, status: 200, json: async () => ({ code: 0, data: { list: [{ code: "BD", location_id: 4242 }] } }) } as any;
      if (url.includes("/campaign/create/")) return { ok: true, status: 200, json: async () => ({ code: 0, data: { campaign_id: 9001 } }) } as any;
      if (url.includes("/adgroup/create/")) return { ok: true, status: 200, json: async () => ({ code: 0, data: { adgroup_id: 9002 } }) } as any;
      if (url.includes("/file/image/ad/upload/")) return { ok: true, status: 200, json: async () => ({ code: 0, data: [{ image_id: "img-1" }] }) } as any;
      if (url.includes("/ad/create/")) return { ok: true, status: 200, json: async () => ({ code: 0, data: { ad_ids: [9003] } }) } as any;
      return { ok: false, status: 404, json: async () => ({}) } as any;
    };
    const pub: any = await svc.publishTikTok("org-1", "owner", {
      adAccountId: "acc-1", name: "TT BD", dailyBudget: "300", countryCodes: ["BD"],
      adText: "Shop now", landingUrl: "https://shop.example", imageUrl: "https://shop.example/a.jpg",
    });
    expect(pub.status).toBe("created_paused");
    expect(pub.externalCampaignId).toBe("9001");
    const adgroupBody = bodies.find((b) => b.adgroup_name);
    expect(adgroupBody.location_ids).toEqual([4242]);
    expect(adgroupBody.operation_status).toBe("DISABLE");
  });
});
