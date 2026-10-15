import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Next CN11: governance — @mentions,
 * plan versions (submit/manual snapshots, diff, restore),
 * the two-step approval chain, last recorded activity,
 * hub saved views, and the paged hub listPlans contract.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if (Array.isArray(v)) return false;
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String((v as any).contains).toLowerCase());
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
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, skip }: any = {}) => {
      const f = rows.filter((r) => matches(r, where ?? {}));
      const s = skip ? f.slice(skip) : f;
      return take ? s.slice(0, take) : s;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "membership", "agentNotification", "campaignPlanComment", "auditLog", "user", "campaignPlanVersion", "campaignApprovalSetting", "campaignSavedView", "dailyAdMetric"]) tables[n] = makeTable(n);
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", externalId: "act_1", name: "Main", currency: "BDT", integrationId: "int-1" });
  tables.membership.rows.push(
    { id: "m1", organizationId: "org", userId: "owner-1", role: "OWNER", status: "ACTIVE" },
    { id: "m2", organizationId: "org", userId: "admin-1", role: "ADMIN", status: "ACTIVE" },
    { id: "m3", organizationId: "org", userId: "creator-1", role: "MARKETING_MANAGER", status: "ACTIVE" },
    { id: "m4", organizationId: "org", userId: "alex-2", role: "MARKETING_MANAGER", status: "ACTIVE" },
    { id: "m5", organizationId: "org", userId: "ghost-1", role: "MARKETING_MANAGER", status: "INACTIVE" },
  );
  tables.user.rows.push(
    { id: "owner-1", name: "Rahim Owner" },
    { id: "admin-1", name: "Karim Admin" },
    { id: "creator-1", name: "Alex Amin" },
    { id: "alex-2", name: "Alex" },
    { id: "ghost-1", name: "Ghost User" },
  );
  let tick = 0;
  const audit = {
    log: async (e: any) => {
      tables.auditLog.rows.push({ id: `a-${++tick}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, tick)), ...e });
    },
  };
  const svc = new CampaignsService(tables as any, audit as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}
async function draft(svc: CampaignsService) {
  const plan: any = await svc.createPlan("org", "creator-1", { name: "Eid", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  const adSet: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"] });
  await svc.addAd("org", plan.id, adSet.id, { name: "A", primaryText: "কিনুন এখনই দারুণ প্রোডাক্ট", linkUrl: "https://shop.example/x" });
  return { plan, adSet };
}

describe("CN11 mentions", () => {
  it("resolves @Name longest-first against ACTIVE members, notifies, returns mentions; unknown tokens stay text", async () => {
    const { tables, svc } = setup();
    const { plan } = await draft(svc);
    const row: any = await svc.addComment("org", plan.id, "owner-1", "@Alex Amin আর @Nobody Here দেখুন প্লিজ");
    // "Alex Amin" (creator-1) wins over the shorter "Alex".
    expect(row.mentions).toEqual([{ userId: "creator-1", name: "Alex Amin" }]);
    const notes = tables.agentNotification.rows.filter((n: any) => n.type === "campaign_mention");
    expect(notes.map((n: any) => n.userId)).toEqual(["creator-1"]);
  });

  it("excludes the author and INACTIVE members", async () => {
    const { tables, svc } = setup();
    const { plan } = await draft(svc);
    const row: any = await svc.addComment("org", plan.id, "creator-1", "@Alex Amin নিজের নাম, @Ghost User নিষ্ক্রিয়");
    expect(row.mentions).toEqual([]);
    expect(tables.agentNotification.rows.filter((n: any) => n.type === "campaign_mention")).toHaveLength(0);
    // The shorter name still resolves when it is the one written.
    const row2: any = await svc.addComment("org", plan.id, "owner-1", "@Alex একটু দেখো");
    expect(row2.mentions).toEqual([{ userId: "alex-2", name: "Alex" }]);
  });

  it("listComments rows carry the same resolved mentions", async () => {
    const { svc } = setup();
    const { plan } = await draft(svc);
    await svc.addComment("org", plan.id, "owner-1", "@Karim Admin রিভিউ করো");
    const comments = await svc.listComments("org", plan.id);
    expect(comments).toHaveLength(1);
    expect(comments[0].mentions).toEqual([{ userId: "admin-1", name: "Karim Admin" }]);
  });
});

describe("CN11 versions", () => {
  it("submit writes a submit-kind version holding the frozen definition", async () => {
    const { tables, svc } = setup();
    const { plan } = await draft(svc);
    await svc.submitForApproval("org", "creator-1", plan.id);
    const versions = tables.campaignPlanVersion.rows.filter((v: any) => v.planId === plan.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].kind).toBe("submit");
    expect(versions[0].definition.adSets).toHaveLength(1);
    expect(versions[0].definition.adSets[0].ads[0].primaryText).toContain("কিনুন");
    expect(versions[0].createdById).toBe("creator-1");
  });

  it("manual snapshot + list returns both kinds with definitions", async () => {
    const { svc } = setup();
    const { plan } = await draft(svc);
    await svc.submitForApproval("org", "creator-1", plan.id);
    const manual: any = await svc.createVersionSnapshot("org", "owner-1", plan.id);
    expect(manual.kind).toBe("manual");
    const list = await svc.listVersions("org", plan.id);
    expect(list.map((v: any) => v.kind).sort()).toEqual(["manual", "submit"]);
    expect(list.every((v: any) => v.definition?.adSets?.length === 1)).toBe(true);
  });

  it("diff reports top-level, ad-set and ad changes by name matching", async () => {
    const { tables, svc } = setup();
    const { plan } = await draft(svc);
    const manual: any = await svc.createVersionSnapshot("org", "owner-1", plan.id);
    // Tamper the live definition directly: rename the
    // plan, change the ad's text, add a second ad set.
    tables.campaignPlan.rows.find((p: any) => p.id === plan.id).name = "Eid Renamed";
    tables.campaignAd.rows[0].primaryText = "বদলে দেওয়া টেক্সট";
    tables.campaignAdSet.rows.push({ id: "set-x", planId: plan.id, name: "S2", billingEvent: "IMPRESSIONS", optimizationGoal: "LINK_CLICKS", targeting: {} });
    tables.campaignAd.rows.push({ id: "ad-x", adSetId: "set-x", name: "B", primaryText: "নতুন", linkUrl: "https://shop.example/y", callToAction: "SHOP_NOW", format: "link" });
    const diff = await svc.diffVersion("org", plan.id, manual.id);
    expect(diff.differs).toBe(true);
    expect(diff.summary.topLevelChanged).toContain("name");
    expect(diff.summary.adSetsAdded).toBe(1);
    expect(diff.summary.adSetsRemoved).toBe(0);
    expect(diff.summary.adSetsChanged).toBe(1); // S changed via its ad
    expect(diff.summary.adsAdded).toBe(1); // ad B of the added set
    expect(diff.summary.adsChanged).toBe(1);
    expect(diff.summary.adsRemoved).toBe(0);
  });

  it("restore creates a NEW sibling draft and never touches the source plan", async () => {
    const { tables, svc } = setup();
    const { plan } = await draft(svc);
    const manual: any = await svc.createVersionSnapshot("org", "owner-1", plan.id);
    await svc.submitForApproval("org", "creator-1", plan.id);
    await svc.approve("org", "owner-1", plan.id); // source is now APPROVED
    tables.campaignAd.rows[0].primaryText = "বদলে দেওয়া টেক্সট";
    const restored: any = await svc.restoreVersion("org", "creator-1", plan.id, manual.id);
    expect(restored.id).not.toBe(plan.id);
    expect(restored.status).toBe("draft");
    expect(restored.name).toBe("Eid (সংস্করণ থেকে পুনরুদ্ধার)");
    expect(restored.adSets[0].ads[0].primaryText).toContain("কিনুন"); // the frozen text, not the tampered one
    // Source untouched: still approved, still tampered.
    const source: any = await svc.getPlan("org", plan.id);
    expect(source.status).toBe("approved");
    expect(source.adSets[0].ads[0].primaryText).toBe("বদলে দেওয়া টেক্সট");
    expect(tables.campaignPlan.rows).toHaveLength(2);
  });
});

describe("CN11 two-step approval chain", () => {
  it("setting defaults to OFF and PATCH persists ON", async () => {
    const { svc } = setup();
    expect(await svc.getApprovalChainSetting("org")).toEqual({ twoStepApproval: false });
    expect(await svc.setApprovalChainSetting("org", "owner-1", { twoStepApproval: true })).toEqual({ twoStepApproval: true });
    expect(await svc.getApprovalChainSetting("org")).toEqual({ twoStepApproval: true });
    expect(await svc.setApprovalChainSetting("org", "owner-1", { twoStepApproval: false })).toEqual({ twoStepApproval: false });
  });

  it("OFF: single approve completes exactly as before", async () => {
    const { svc } = setup();
    const { plan } = await draft(svc);
    await svc.submitForApproval("org", "creator-1", plan.id);
    const approved: any = await svc.approve("org", "owner-1", plan.id);
    expect(approved.status).toBe("approved");
    expect(approved.approvedById).toBe("owner-1");
    expect(approved.approvalState).toBeUndefined();
    expect(approved.firstApproverId ?? null).toBeNull();
  });

  it("ON: step 1 stays pending, same approver is refused, a different approver completes", async () => {
    const { tables, svc } = setup();
    const { plan } = await draft(svc);
    await svc.setApprovalChainSetting("org", "owner-1", { twoStepApproval: true });
    await svc.submitForApproval("org", "creator-1", plan.id);
    const step1: any = await svc.approve("org", "owner-1", plan.id);
    expect(step1.status).toBe("pending_approval");
    expect(step1.firstApproverId).toBe("owner-1");
    expect(step1.approvalState).toEqual({ twoStep: true, step: 1, awaitingSecond: true });
    expect(tables.auditLog.rows.some((a: any) => a.action === "campaign.approved_step1")).toBe(true);
    // Creator + other approvers heard about step 1.
    const stepNotes = tables.agentNotification.rows.filter((n: any) => n.type === "campaign_approval" && String(n.title).includes("ধাপ"));
    expect(stepNotes.map((n: any) => n.userId).sort()).toEqual(["admin-1", "creator-1"]);
    // The SAME approver cannot do step 2.
    await expect(svc.approve("org", "owner-1", plan.id)).rejects.toThrow(/DIFFERENT|অন্য/);
    // A different approver completes it.
    const done: any = await svc.approve("org", "admin-1", plan.id);
    expect(done.status).toBe("approved");
    expect(done.approvedById).toBe("admin-1");
    const auditRow = tables.auditLog.rows.find((a: any) => a.action === "campaign.approved");
    expect(auditRow.metadata).toEqual({ twoStep: true, firstApproverId: "owner-1" });
    expect(tables.agentNotification.rows.some((n: any) => n.type === "campaign_approved" && n.userId === "creator-1")).toBe(true);
  });

  it("reject and re-submit clear the step-1 state", async () => {
    const { tables, svc } = setup();
    const { plan } = await draft(svc);
    await svc.setApprovalChainSetting("org", "owner-1", { twoStepApproval: true });
    await svc.submitForApproval("org", "creator-1", plan.id);
    await svc.approve("org", "owner-1", plan.id);
    const row = () => tables.campaignPlan.rows.find((p: any) => p.id === plan.id);
    expect(row().firstApproverId).toBe("owner-1");
    await svc.reject("org", "admin-1", plan.id, "আবার দেখুন");
    expect(row().firstApproverId ?? null).toBeNull();
    expect(row().firstApprovedAt ?? null).toBeNull();
    await svc.submitForApproval("org", "creator-1", plan.id);
    expect(row().firstApproverId ?? null).toBeNull();
    expect(row().status).toBe("pending_approval");
  });
});

describe("CN11 last activity", () => {
  it("no audit rows = { available: false }", async () => {
    const { tables, svc } = setup();
    tables.campaignPlan.rows.push({ id: "plan-x", organizationId: "org", adAccountId: "acc-1", name: "Bare", objective: "OUTCOME_SALES", status: "draft", createdById: "creator-1" });
    expect(await svc.planLastActivity("org", "plan-x")).toEqual({ available: false });
  });

  it("returns the newest audit row with the actor's name resolved", async () => {
    const { svc } = setup();
    const { plan } = await draft(svc);
    await svc.submitForApproval("org", "creator-1", plan.id);
    const out: any = await svc.planLastActivity("org", plan.id);
    expect(out.available).toBe(true);
    expect(out.action).toBe("campaign.submitted");
    expect(out.actorId).toBe("creator-1");
    expect(out.actorName).toBe("Alex Amin");
    expect(out.at).toBeInstanceOf(Date);
  });
});

describe("CN11 saved views", () => {
  it("CRUD is personal: another user cannot see or delete the view", async () => {
    const { svc } = setup();
    const view: any = await svc.createSavedView("org", "creator-1", { name: "ঈদের খসড়া", filters: { status: "draft", q: "eid" } });
    expect(view.filters).toEqual({ status: "draft", q: "eid" });
    expect(await svc.listSavedViews("org", "creator-1")).toHaveLength(1);
    expect(await svc.listSavedViews("org", "owner-1")).toHaveLength(0);
    await expect(svc.deleteSavedView("org", "owner-1", view.id)).rejects.toThrow(/not found/i);
    expect(await svc.listSavedViews("org", "creator-1")).toHaveLength(1); // still there
    expect(await svc.deleteSavedView("org", "creator-1", view.id)).toEqual({ deleted: true });
    expect(await svc.listSavedViews("org", "creator-1")).toHaveLength(0);
  });

  it("an empty name is refused", async () => {
    const { svc } = setup();
    await expect(svc.createSavedView("org", "creator-1", { name: "  ", filters: {} })).rejects.toThrow(/name/i);
  });
});

describe("CN11 hub listPlans", () => {
  function seedHub(tables: any) {
    const mk = (id: string, name: string, status: string, objective: string, ext?: string) =>
      tables.campaignPlan.rows.push({ id, organizationId: "org", adAccountId: "acc-1", name, objective, status, createdById: "creator-1", externalCampaignId: ext ?? null, updatedAt: new Date() });
    mk("p-a", "Alpha Sale", "draft", "OUTCOME_SALES", "camp-1");
    mk("p-b", "Beta Leads", "approved", "OUTCOME_LEADS", "camp-2");
    mk("p-c", "Gamma Sale", "draft", "OUTCOME_SALES", undefined);
    tables.campaignAdSet.rows.push(
      { id: "s-a1", planId: "p-a", name: "A1" }, { id: "s-a2", planId: "p-a", name: "A2" }, { id: "s-c1", planId: "p-c", name: "C1" },
    );
    tables.dailyAdMetric.rows.push(
      { organizationId: "org", campaignExternalId: "camp-1", adSetExternalId: "", adExternalId: "", spendMinor: 1000n, impressions: 100, clicks: 10, platformConversions: 2, date: new Date() },
      { organizationId: "org", campaignExternalId: "camp-1", adSetExternalId: "se1", adExternalId: "", spendMinor: 500n, impressions: 50, clicks: 5, platformConversions: 1, date: new Date() },
      { organizationId: "org", campaignExternalId: "camp-1", adSetExternalId: "se1", adExternalId: "ad1", spendMinor: 9999n, impressions: 999, clicks: 99, platformConversions: 99, date: new Date() },
    );
  }

  it("legacy call keeps the bare-array shape", async () => {
    const { tables, svc } = setup();
    seedHub(tables);
    const out: any = await svc.listPlans("org");
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(3);
    expect(out.find((p: any) => p.id === "p-a").adSetCount).toBe(2);
  });

  it("paged envelope, batched counts (zero per-plan count calls), server-side filters", async () => {
    const { tables, svc } = setup();
    seedHub(tables);
    let countCalls = 0;
    const origCount = tables.campaignAdSet.count;
    tables.campaignAdSet.count = async (...a: any[]) => { countCalls++; return origCount(...a); };
    const page1: any = await svc.listPlans("org", { page: 1, pageSize: 2 });
    expect(page1.total).toBe(3);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(2);
    expect(page1.items).toHaveLength(2);
    expect(countCalls).toBe(0); // batched, not N+1
    const all: any = await svc.listPlans("org", { page: 1, pageSize: 100 });
    expect(all.items.find((p: any) => p.id === "p-a").adSetCount).toBe(2);
    expect(all.items.find((p: any) => p.id === "p-b").adSetCount).toBe(0);
    const page2: any = await svc.listPlans("org", { page: 2, pageSize: 2 });
    expect(page2.items).toHaveLength(1);
    expect(((await svc.listPlans("org", { page: 1, status: "draft" })) as any).total).toBe(2);
    expect(((await svc.listPlans("org", { page: 1, objective: "OUTCOME_LEADS" })) as any).total).toBe(1);
    expect(((await svc.listPlans("org", { page: 1, q: "alph" })) as any).total).toBe(1);
  });

  it("includePerformance aggregates campaign/ad-set-level rows; null without external id; zeroed when published without rows", async () => {
    const { tables, svc } = setup();
    seedHub(tables);
    const out: any = await svc.listPlans("org", { page: 1, pageSize: 100, includePerformance: true });
    const a = out.items.find((p: any) => p.id === "p-a");
    expect(a.performance).toEqual({ spendMinor: "1500", impressions: 150, clicks: 15, conversions: 3, ctrPercent: 10, cpaMinor: "500" });
    const b = out.items.find((p: any) => p.id === "p-b");
    expect(b.performance).toEqual({ spendMinor: "0", impressions: 0, clicks: 0, conversions: 0, ctrPercent: null, cpaMinor: null });
    const c = out.items.find((p: any) => p.id === "p-c");
    expect(c.performance).toBeNull();
    // Without the flag, no performance key is attached.
    const plain: any = await svc.listPlans("org", { page: 1 });
    expect(plain.items[0].performance).toBeUndefined();
  });
});
