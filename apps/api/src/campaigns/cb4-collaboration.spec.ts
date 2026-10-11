import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder CB4: submit freezes a snapshot +
 * notifies approvers; approve/reject notify the
 * creator; comments + a merged timeline live on the
 * plan; a tampered definition cannot publish.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if (Array.isArray(v)) return false;
      if ("in" in v) return (v.in as any[]).includes(row[k]);
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
    findMany: async ({ where, take }: any = {}) => { const out = rows.filter((r) => matches(r, where ?? {})); return take ? out.slice(0, take) : out; },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}
function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "aIUsageRecord", "membership", "agentNotification", "campaignPlanComment", "auditLog", "user"]) tables[n] = makeTable(n);
  const planFind = tables.campaignPlan.findFirst;
  tables.campaignPlan.findFirst = async (args: any) => {
    const row = await planFind(args);
    if (row && args?.include) {
      const adSets = tables.campaignAdSet.rows.filter((s: any) => s.planId === row.id)
        .map((s: any) => ({ ...s, ads: tables.campaignAd.rows.filter((a: any) => a.adSetId === s.id) }));
      return { ...row, adSets, publishLogs: [] };
    }
    return row;
  };
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_1", name: "Main", currency: "BDT" });
  tables.membership.rows.push(
    { id: "m1", organizationId: "org", userId: "owner-1", role: "OWNER", status: "ACTIVE" },
    { id: "m2", organizationId: "org", userId: "creator-1", role: "MARKETING_MANAGER", status: "ACTIVE" },
    { id: "m3", organizationId: "org", userId: "admin-1", role: "ADMIN", status: "ACTIVE" },
  );
  tables.user.rows.push({ id: "owner-1", name: "Owner" }, { id: "creator-1", name: "Creator" });
  const audit = { log: async (e: any) => { tables.auditLog.rows.push({ id: `a-${tables.auditLog.rows.length + 1}`, createdAt: new Date(), ...e }); } };
  const svc = new CampaignsService(tables as any, audit as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}
async function draft(svc: CampaignsService) {
  const plan: any = await svc.createPlan("org", "creator-1", { name: "Eid", objective: "OUTCOME_SALES", adAccountId: "acc-1" });
  const adSet: any = await svc.addAdSet("org", plan.id, { name: "S", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", pageId: "pg", pixelId: "px", countries: ["BD"] });
  await svc.addAd("org", plan.id, adSet.id, { name: "A", primaryText: "কিনুন এখনই দারুণ প্রোডাক্ট", linkUrl: "https://shop.example/x" });
  return { plan, adSet };
}

describe("CB4 collaboration", () => {
  it("submit freezes the snapshot and notifies OWNER+ADMIN (not the submitter)", async () => {
    const { svc, tables } = setup();
    const { plan } = await draft(svc);
    const submitted: any = await svc.submitForApproval("org", "creator-1", plan.id);
    expect(submitted.submissionSnapshot?.adSets).toHaveLength(1);
    expect(submitted.submissionSnapshot.adSets[0].ads[0].primaryText).toContain("কিনুন");
    const notes = tables.agentNotification.rows;
    expect(notes.map((n: any) => n.userId).sort()).toEqual(["admin-1", "owner-1"]);
    expect(notes[0].type).toBe("campaign_approval");
  });

  it("approve notifies the creator; reject notifies with the reason; diff is clean", async () => {
    const { svc, tables } = setup();
    const { plan } = await draft(svc);
    await svc.submitForApproval("org", "creator-1", plan.id);
    const diff = await svc.submissionDiff("org", plan.id);
    expect(diff.differs).toBe(false);
    await svc.reject("org", "owner-1", plan.id, "বাজেট বেশি");
    const rej = tables.agentNotification.rows.find((n: any) => n.type === "campaign_rejected");
    expect(rej.userId).toBe("creator-1");
    expect(rej.body).toContain("বাজেট বেশি");
    await svc.submitForApproval("org", "creator-1", plan.id);
    await svc.approve("org", "owner-1", plan.id);
    expect(tables.agentNotification.rows.some((n: any) => n.type === "campaign_approved" && n.userId === "creator-1")).toBe(true);
  });

  it("comments land on the plan and appear in the merged timeline", async () => {
    const { svc } = setup();
    const { plan } = await draft(svc);
    await svc.addComment("org", plan.id, "owner-1", "বাজেট ঠিক আছে তো?");
    await svc.submitForApproval("org", "creator-1", plan.id);
    const comments = await svc.listComments("org", plan.id);
    expect(comments).toHaveLength(1);
    expect(comments[0].authorName).toBe("Owner");
    const timeline = await svc.planTimeline("org", plan.id);
    expect(timeline.some((e: any) => e.kind === "comment")).toBe(true);
    expect(timeline.some((e: any) => e.kind === "audit" && e.title === "campaign.submitted")).toBe(true);
  });

  it("a definition changed after approval cannot publish (snapshot integrity)", async () => {
    const { svc, tables } = setup();
    const { plan } = await draft(svc);
    await svc.submitForApproval("org", "creator-1", plan.id);
    await svc.approve("org", "owner-1", plan.id);
    // Simulate a bypass: a row changed directly (the
    // state machine normally locks edits).
    tables.campaignAd.rows[0].primaryText = "বদলে দেওয়া টেক্সট";
    await expect(svc.publish("org", "owner-1", plan.id)).rejects.toThrow(/changed since approval/);
  });
});
