import { AutomationService } from "./automation.service";

process.env.DISABLE_SCHEDULER = "true";

/**
 * Campaign Builder Advanced CA10 (CB3): rules SUGGEST mode +
 * approval queue. A suggest-mode trigger stores the action
 * it WOULD take (with the rule's evidence) and executes
 * NOTHING; a human approve executes it exactly once through
 * the same CampaignsService paths execute mode uses; a
 * reject never executes. Execute mode is byte-for-byte the
 * pre-CA10 behaviour (covered by automation.service.spec.ts
 * + phase-i.spec.ts, which now pin mode: "execute").
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      if ("lte" in v) return new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
      if ("lt" in v) return new Date(row[k]).getTime() < new Date((v as any).lt).getTime();
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
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (matches(r, where ?? {})) { Object.assign(r, data); count++; }
      return { count };
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}

function buildSvc() {
  const tables: any = {
    scheduledJob: makeTable("job"), automationRule: makeTable("rule"), automationRun: makeTable("run"),
    ruleSuggestion: makeTable("suggestion"),
    dailyAdMetric: makeTable("metric"), campaignPlan: makeTable("plan"),
    campaignAdSet: makeTable("adset"), campaignAd: makeTable("ad"),
    organization: { findMany: async () => [{ id: "org-1" }] },
  };
  const campaignsStub = {
    statusCalls: [] as any[], scaleCalls: [] as any[], adStatusCalls: [] as any[],
    async setMetaStatus(_o: string, _a: string, planId: string, status: string) { this.statusCalls.push({ planId, status }); return { metaStatus: status }; },
    async scalePlanBudgets(_o: string, _a: string, planId: string, percent: number, caps: any) { this.scaleCalls.push({ planId, percent, caps }); return [{ adSetId: "set-1", before: "50000", after: "60000" }]; },
    async setAdStatus(_o: string, _a: string, planId: string, adId: string, status: string) { this.adStatusCalls.push({ planId, adId, status }); return {}; },
  };
  const svc = new AutomationService(
    tables as any, { log: async () => undefined } as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, campaignsStub as any,
  );
  return { svc, tables, campaignsStub };
}

function seedHighCpa(tables: any) {
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org-1", name: "Eid Sale", status: "published", metaStatus: "ACTIVE", externalCampaignId: "camp-9" });
  tables.dailyAdMetric.rows.push({ organizationId: "org-1", campaignExternalId: "camp-9", adExternalId: "", date: new Date(), spendMinor: 90000n, platformConversions: 2, platformConversionValueMinor: 100000n });
}

describe("CA10 suggest mode", () => {
  it("createRule defaults NEW rules to suggest; explicit execute is honoured; bad mode refuses", async () => {
    const { svc, tables } = buildSvc();
    const r1 = await svc.createRule("org-1", "owner", { name: "A", metric: "platform_cpa", comparator: "gt", threshold: "300", action: "pause_campaign" });
    expect(r1.mode).toBe("suggest");
    const r2 = await svc.createRule("org-1", "owner", { name: "B", metric: "platform_cpa", comparator: "gt", threshold: "300", action: "pause_campaign", mode: "execute" });
    expect(r2.mode).toBe("execute");
    await expect(svc.createRule("org-1", "owner", { name: "C", metric: "platform_cpa", comparator: "gt", threshold: "300", action: "pause_campaign", mode: "yolo" })).rejects.toThrow(/mode/);
    expect(tables.automationRule.rows).toHaveLength(2);
  });

  it("a suggest trigger queues a suggestion with evidence and executes NOTHING", async () => {
    const { svc, tables, campaignsStub } = buildSvc();
    seedHighCpa(tables);
    await svc.createRule("org-1", "owner", { name: "CPA guard", metric: "platform_cpa", comparator: "gt", threshold: "300", action: "pause_campaign" });
    const result = await svc.evaluateRules("org-1", "owner");
    expect(result.results[0].triggered).toBe(true);
    expect(result.results[0].detail).toContain("Suggestion pending approval");
    expect(campaignsStub.statusCalls).toHaveLength(0);
    expect(tables.ruleSuggestion.rows).toHaveLength(1);
    const s = tables.ruleSuggestion.rows[0];
    expect(s.status).toBe("pending");
    expect(s.action).toBe("pause_campaign");
    expect(s.campaignPlanId).toBe("plan-1");
    expect(s.facts.metric).toBe("platform_cpa");
    expect(s.facts.value).toBeCloseTo(450);
    expect(s.reason).toContain("Platform CPA");
    const run = tables.automationRun.rows.find((r: any) => r.evidence?.suggestionId === s.id);
    expect(run.status).toBe("triggered");
    expect(run.evidence.mode).toBe("suggest");
  });

  it("dedupe: a second trigger while one is pending creates no twin", async () => {
    const { svc, tables } = buildSvc();
    seedHighCpa(tables);
    await svc.createRule("org-1", "owner", { name: "CPA guard", metric: "platform_cpa", comparator: "gt", threshold: "300", action: "pause_campaign" });
    await svc.evaluateRules("org-1", "owner");
    const second = await svc.evaluateRules("org-1", "owner");
    expect(tables.ruleSuggestion.rows).toHaveLength(1);
    expect(second.results[0].triggered).toBe(false);
    expect(second.results[0].detail).toContain("already pending");
  });

  it("approve executes exactly once through setMetaStatus; a double approve is refused and does not re-execute", async () => {
    const { svc, tables, campaignsStub } = buildSvc();
    seedHighCpa(tables);
    await svc.createRule("org-1", "owner", { name: "CPA guard", metric: "platform_cpa", comparator: "gt", threshold: "300", action: "pause_campaign" });
    await svc.evaluateRules("org-1", "owner");
    const s = tables.ruleSuggestion.rows[0];
    const approved = await svc.approveSuggestion("org-1", "admin-2", s.id);
    expect(approved.status).toBe("approved");
    expect(approved.decidedById).toBe("admin-2");
    expect(approved.executedAt).toBeTruthy();
    expect(approved.executionResult).toEqual({ ok: true, executed: "pause_campaign" });
    expect(campaignsStub.statusCalls).toEqual([{ planId: "plan-1", status: "PAUSED" }]);
    await expect(svc.approveSuggestion("org-1", "admin-2", s.id)).rejects.toThrow(/ইতিমধ্যে/);
    expect(campaignsStub.statusCalls).toHaveLength(1);
    const run = tables.automationRun.rows.find((r: any) => r.kind === "suggestion" && r.refId === s.id);
    expect(run.status).toBe("triggered");
    expect(run.evidence.approvedBy).toBe("admin-2");
  });

  it("reject closes the suggestion and NEVER executes", async () => {
    const { svc, tables, campaignsStub } = buildSvc();
    seedHighCpa(tables);
    await svc.createRule("org-1", "owner", { name: "CPA guard", metric: "platform_cpa", comparator: "gt", threshold: "300", action: "pause_campaign" });
    await svc.evaluateRules("org-1", "owner");
    const s = tables.ruleSuggestion.rows[0];
    const rejected = await svc.rejectSuggestion("org-1", "admin-2", s.id, "এখন নয়");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectReason).toBe("এখন নয়");
    expect(rejected.executedAt).toBeFalsy();
    expect(campaignsStub.statusCalls).toHaveLength(0);
    await expect(svc.approveSuggestion("org-1", "admin-2", s.id)).rejects.toThrow(/ইতিমধ্যে/);
    expect(campaignsStub.statusCalls).toHaveLength(0);
  });

  it("approve of a scale_budget suggestion passes the stored payload to scalePlanBudgets", async () => {
    const { svc, tables, campaignsStub } = buildSvc();
    seedHighCpa(tables);
    await svc.createRule("org-1", "owner", {
      name: "Scaler", metric: "platform_cpa", comparator: "gt", threshold: "300", action: "scale_budget",
      actionConfig: { percent: 20, maxDailyMinor: 90000, cooldownHours: 1 },
    });
    await svc.evaluateRules("org-1", "owner");
    const s = tables.ruleSuggestion.rows[0];
    expect(s.actionPayload).toEqual({ percent: 20, maxDailyMinor: 90000 });
    const approved = await svc.approveSuggestion("org-1", "admin-2", s.id);
    expect(campaignsStub.scaleCalls).toEqual([{ planId: "plan-1", percent: 20, caps: { minDailyMinor: undefined, maxDailyMinor: 90000 } }]);
    expect(approved.executionResult.changes).toEqual([{ adSetId: "set-1", before: "50000", after: "60000" }]);
  });

  it("approve re-checks state: a campaign no longer ACTIVE is a recorded skip, not an error", async () => {
    const { svc, tables, campaignsStub } = buildSvc();
    seedHighCpa(tables);
    await svc.createRule("org-1", "owner", { name: "CPA guard", metric: "platform_cpa", comparator: "gt", threshold: "300", action: "pause_campaign" });
    await svc.evaluateRules("org-1", "owner");
    // The owner paused it by hand in the meantime.
    tables.campaignPlan.rows[0].metaStatus = "PAUSED";
    const s = tables.ruleSuggestion.rows[0];
    const approved = await svc.approveSuggestion("org-1", "admin-2", s.id);
    expect(approved.executionResult).toEqual({ ok: true, executed: null, skipped: "campaign_not_active" });
    expect(campaignsStub.statusCalls).toHaveLength(0);
  });

  it("a pending suggestion older than the TTL is listed as expired and can no longer be approved", async () => {
    const { svc, tables } = buildSvc();
    seedHighCpa(tables);
    await svc.createRule("org-1", "owner", { name: "CPA guard", metric: "platform_cpa", comparator: "gt", threshold: "300", action: "pause_campaign" });
    await svc.evaluateRules("org-1", "owner");
    const s = tables.ruleSuggestion.rows[0];
    s.createdAt = new Date(Date.now() - 8 * 86400000);
    const listed = await svc.listSuggestions("org-1");
    expect(listed.ttlDays).toBe(7);
    expect(listed.suggestions[0].status).toBe("expired");
    expect(listed.suggestions[0].ruleName).toBe("CPA guard");
    expect(listed.suggestions[0].planName).toBe("Eid Sale");
    await expect(svc.approveSuggestion("org-1", "admin-2", s.id)).rejects.toThrow(/ইতিমধ্যে/);
  });

  it("cross-org isolation: another org's suggestion is invisible and undecidable", async () => {
    const { svc, tables } = buildSvc();
    seedHighCpa(tables);
    await svc.createRule("org-1", "owner", { name: "CPA guard", metric: "platform_cpa", comparator: "gt", threshold: "300", action: "pause_campaign" });
    await svc.evaluateRules("org-1", "owner");
    const s = tables.ruleSuggestion.rows[0];
    await expect(svc.approveSuggestion("org-2", "admin-9", s.id)).rejects.toThrow(/not found/i);
    const listed = await svc.listSuggestions("org-2");
    expect(listed.suggestions).toHaveLength(0);
    expect(tables.ruleSuggestion.rows[0].status).toBe("pending");
  });

  it("a rule row WITHOUT a mode (pre-CA10 shape) still executes — the migration default in service form", async () => {
    const { svc, tables, campaignsStub } = buildSvc();
    seedHighCpa(tables);
    tables.automationRule.rows.push({ id: "rule-legacy", organizationId: "org-1", name: "Legacy", metric: "platform_cpa", comparator: "gt", threshold: "300", windowDays: 3, action: "pause_campaign", enabled: true, createdById: "owner" });
    const result = await svc.evaluateRules("org-1", "owner");
    expect(result.results[0].triggered).toBe(true);
    expect(campaignsStub.statusCalls).toEqual([{ planId: "plan-1", status: "PAUSED" }]);
    expect(tables.ruleSuggestion.rows).toHaveLength(0);
  });
});
