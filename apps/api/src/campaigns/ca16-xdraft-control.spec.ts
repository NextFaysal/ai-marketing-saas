import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA16 (CB4): post-publish
 * management of created cross-platform drafts — the
 * status sync becomes a REAL platform read, and status /
 * budget changes follow the Meta control treatment
 * (activation gated, platform must confirm, failure
 * leaves local records untouched, audit + publish log).
 * PublishingService is stubbed at the service boundary
 * (its own payloads are pinned by
 * publishing/ca16-platform-control.spec.ts).
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
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
    findUnique: async ({ where }: any = {}) => rows.find((r) => r.id === where.id || r.organizationId === where.organizationId) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "businessProfile", "organization", "crossPlatformDraft", "platformPublication"]) tables[n] = makeTable(n);
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", adAccountId: "acc-1", name: "Eid Campaign", objective: "OUTCOME_SALES", status: "published", budgetMode: "abo", createdById: "u1" });
  tables.crossPlatformDraft.rows.push(
    { id: "xd-g", organizationId: "org", planId: "plan-1", platform: "google", kind: "search", targetAdAccountId: "acc-g", fields: { name: "Eid Campaign", dailyBudget: "800.00" }, status: "created", externalCampaignId: "555", publicationId: "pub-g", createdById: "u1" },
    { id: "xd-t", organizationId: "org", planId: "plan-1", platform: "tiktok", kind: null, targetAdAccountId: "acc-t", fields: { name: "Eid Campaign", dailyBudget: "800.00" }, status: "created", externalCampaignId: "100", publicationId: "pub-t", createdById: "u1" },
    { id: "xd-b", organizationId: "org", planId: "plan-1", platform: "google", kind: "search", targetAdAccountId: "acc-g", fields: { name: "Blocked" }, status: "blocked", externalCampaignId: null, publicationId: null, createdById: "u1" },
  );
  tables.platformPublication.rows.push(
    { id: "pub-g", organizationId: "org", platform: "google", adAccountId: "acc-g", name: "Eid Campaign", status: "created_paused", externalCampaignId: "555", detail: { steps: [{ step: "budget", resourceName: "customers/123/campaignBudgets/777" }, { step: "campaign", resourceName: "customers/123/campaigns/555" }] }, createdById: "u1" },
    { id: "pub-t", organizationId: "org", platform: "tiktok", adAccountId: "acc-t", name: "Eid Campaign", status: "created_paused", externalCampaignId: "100", detail: { steps: [], campaignId: "100", adgroupId: "200" }, createdById: "u1" },
  );
  const calls: any[] = [];
  let failWith: string | null = null;
  const publishing = {
    getGoogleCampaignStatus: async () => { calls.push({ m: "gStatus" }); if (failWith) throw new Error(failWith); return { status: "ENABLED" }; },
    getTikTokCampaignStatus: async () => { calls.push({ m: "tStatus" }); if (failWith) throw new Error(failWith); return { operationStatus: "DISABLE", secondaryStatus: "CAMPAIGN_STATUS_DISABLE" }; },
    setGoogleCampaignStatus: async (o: string, a: string, ext: string, target: string) => { calls.push({ m: "gSet", ext, target }); if (failWith) throw new Error(failWith); return { status: target }; },
    setTikTokCampaignStatus: async (o: string, a: string, ext: string, target: string) => { calls.push({ m: "tSet", ext, target }); if (failWith) throw new Error(failWith); return { status: target }; },
    updateGoogleCampaignBudget: async (o: string, a: string, resource: string, amount: number) => { calls.push({ m: "gBudget", resource, amount }); if (failWith) throw new Error(failWith); },
    updateTikTokAdGroupBudget: async (o: string, a: string, adgroupId: string, amount: number) => { calls.push({ m: "tBudget", adgroupId, amount }); if (failWith) throw new Error(failWith); },
  };
  const auditRows: any[] = [];
  const audit = { log: async (row: any) => { auditRows.push(row); } } as any;
  const svc = new CampaignsService(tables as any, audit, { getProvider: () => new DevTemplateProvider() } as any, publishing as any);
  return { tables, svc, calls, auditRows, setFail: (m: string | null) => { failWith = m; } };
}

describe("CA16 status sync — a real platform read now", () => {
  it("google: returns the platform's verbatim status, available:true", async () => {
    const { svc } = setup();
    const out: any = await svc.syncCrossPlatformDraftStatus("org", "plan-1", "xd-g");
    expect(out.available).toBe(true);
    expect(out.statusLabel).toBe("platform");
    expect(out.platformStatus).toBe("ENABLED");
  });

  it("tiktok: operation + secondary status, verbatim", async () => {
    const { svc } = setup();
    const out: any = await svc.syncCrossPlatformDraftStatus("org", "plan-1", "xd-t");
    expect(out.available).toBe(true);
    expect(out.operationStatus).toBe("DISABLE");
    expect(out.secondaryStatus).toBe("CAMPAIGN_STATUS_DISABLE");
  });

  it("a never-created draft stays honestly unavailable, no platform call", async () => {
    const { svc, calls } = setup();
    const out: any = await svc.syncCrossPlatformDraftStatus("org", "plan-1", "xd-b");
    expect(out.available).toBe(false);
    expect(out.reason).toContain("তৈরি হয়নি");
    expect(calls).toHaveLength(0);
  });

  it("a failed read reports the platform error and falls back, labelled", async () => {
    const { svc, setFail } = setup();
    setFail("Google Ads query failed (503): backend error");
    const out: any = await svc.syncCrossPlatformDraftStatus("org", "plan-1", "xd-g");
    expect(out.available).toBe(false);
    expect(out.statusLabel).toBe("as_created");
    expect(out.reason).toContain("backend error");
  });
});

describe("CA16 status change — Meta-parity treatment", () => {
  it("pause maps per platform (google PAUSED, tiktok DISABLE) and logs + audits", async () => {
    const { svc, tables, calls, auditRows } = setup();
    const g: any = await svc.setCrossPlatformDraftStatus("org", "u1", "plan-1", "xd-g", "PAUSED");
    expect(g.platformStatus).toBe("PAUSED");
    const t: any = await svc.setCrossPlatformDraftStatus("org", "u1", "plan-1", "xd-t", "PAUSED");
    expect(t.platformStatus).toBe("DISABLE");
    expect(calls.filter((c: any) => c.m === "gSet" || c.m === "tSet")).toHaveLength(2);
    expect(tables.campaignPublishLog.rows.filter((r: any) => r.status === "success")).toHaveLength(2);
    expect(auditRows.some((r: any) => r.action === "campaign.xdraft_status")).toBe(true);
  });

  it("a platform refusal propagates verbatim and changes nothing locally", async () => {
    const { svc, setFail } = setup();
    setFail("campaign status: Campaign not found");
    await expect(svc.setCrossPlatformDraftStatus("org", "u1", "plan-1", "xd-g", "PAUSED")).rejects.toThrow(/Campaign not found/);
  });

  it("non-created drafts and invalid targets are refused before any call", async () => {
    const { svc, calls } = setup();
    await expect(svc.setCrossPlatformDraftStatus("org", "u1", "plan-1", "xd-b", "PAUSED")).rejects.toThrow(/তৈরি হয়নি/);
    await expect(svc.setCrossPlatformDraftStatus("org", "u1", "plan-1", "xd-g", "STOPPED" as any)).rejects.toThrow(/ACTIVE বা PAUSED/);
    expect(calls).toHaveLength(0);
  });
});

describe("CA16 budget change — platform confirms first", () => {
  it("google: resolves the budget resource from the creation record, then updates local fields", async () => {
    const { svc, tables, calls, auditRows } = setup();
    const out: any = await svc.updateCrossPlatformDraftBudget("org", "u1", "plan-1", "xd-g", "250");
    expect(calls).toEqual([{ m: "gBudget", resource: "customers/123/campaignBudgets/777", amount: 250 }]);
    expect(out.before).toBe("800.00");
    expect(out.after).toBe("250.00");
    const draft = tables.crossPlatformDraft.rows.find((d: any) => d.id === "xd-g");
    expect(draft.fields.dailyBudget).toBe("250.00");
    expect(auditRows.some((r: any) => r.action === "campaign.xdraft_budget" && r.metadata.before === "800.00")).toBe(true);
  });

  it("tiktok: budget goes to the AD GROUP from the creation record", async () => {
    const { svc, calls } = setup();
    await svc.updateCrossPlatformDraftBudget("org", "u1", "plan-1", "xd-t", "300");
    expect(calls).toEqual([{ m: "tBudget", adgroupId: "200", amount: 300 }]);
  });

  it("a missing budget address in the creation record is an honest refusal — no call, no local change", async () => {
    const { svc, tables, calls } = setup();
    tables.platformPublication.rows.find((r: any) => r.id === "pub-g").detail = { steps: [] };
    await expect(svc.updateCrossPlatformDraftBudget("org", "u1", "plan-1", "xd-g", "250")).rejects.toThrow(/Budget Resource নেই/);
    expect(calls).toHaveLength(0);
    expect(tables.crossPlatformDraft.rows.find((d: any) => d.id === "xd-g").fields.dailyBudget).toBe("800.00");
  });

  it("a platform failure leaves the local budget untouched; invalid values refused", async () => {
    const { svc, tables, setFail } = setup();
    setFail("budget: amount too low");
    await expect(svc.updateCrossPlatformDraftBudget("org", "u1", "plan-1", "xd-g", "250")).rejects.toThrow(/amount too low/);
    expect(tables.crossPlatformDraft.rows.find((d: any) => d.id === "xd-g").fields.dailyBudget).toBe("800.00");
    await expect(svc.updateCrossPlatformDraftBudget("org", "u1", "plan-1", "xd-g", "-5")).rejects.toThrow(/ধনাত্মক/);
    await expect(svc.updateCrossPlatformDraftBudget("org", "u1", "plan-1", "xd-g", "abc")).rejects.toThrow(/ধনাত্মক/);
  });

  it("cross-org: another org's draft is not found", async () => {
    const { svc } = setup();
    await expect(svc.setCrossPlatformDraftStatus("other-org", "u1", "plan-1", "xd-g", "PAUSED")).rejects.toThrow();
    await expect(svc.updateCrossPlatformDraftBudget("other-org", "u1", "plan-1", "xd-g", "250")).rejects.toThrow();
  });
});
