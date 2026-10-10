import { AdminService } from "./admin.service";

/** Milestone 37 (Admin Phase A1): analytics from real rows only. */
function match(row: any, where: any = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gte" in (v as any)) { if (!(new Date(row[k]).getTime() >= new Date((v as any).gte).getTime())) return false; }
      else if ("in" in (v as any)) { if (!(v as any).in.includes(row[k])) return false; }
      else if (k === "OR") { if (!(v as any[]).some((w: any) => match(row, w))) return false; }
      else return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
function table(seed: any[] = []) {
  const rows = [...seed];
  return {
    rows,
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => match(r, args.where ?? {}));
      if (args.orderBy?.createdAt === "desc") out = [...out].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (args.take) out = out.slice(0, args.take);
      return out;
    },
    findFirst: async (args: any = {}) => {
      const out = rows.filter((r) => match(r, args.where ?? {}));
      out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return out[0] ?? null;
    },
    findUnique: async ({ where }: any) => rows.find((r) =>
      (where.id !== undefined && r.id === where.id) ||
      (where.key !== undefined && r.key === where.key) ||
      (where.email !== undefined && r.email === where.email)) ?? null,
    count: async (args: any = {}) => rows.filter((r) => match(r, args.where ?? {})).length,
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => r.key === where.key);
      if (row) { Object.assign(row, update); return row; }
      const created = { id: `set-${rows.length + 1}`, ...create };
      rows.push(created);
      return created;
    },
  };
}

const NOW = new Date();
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);

function makeService() {
  const p: any = {
    organization: table([
      { id: "org-1", name: "Alpha", status: "ACTIVE", createdAt: daysAgo(40), updatedAt: daysAgo(1) },
      { id: "org-2", name: "Beta", status: "ACTIVE", createdAt: daysAgo(10), updatedAt: daysAgo(20) },
    ]),
    user: table([
      { id: "u-1", createdAt: daysAgo(40) }, { id: "u-2", createdAt: daysAgo(10) }, { id: "u-3", createdAt: daysAgo(2) },
    ]),
    subscription: table([
      { id: "s-1", organizationId: "org-1", plan: "GROWTH", status: "ACTIVE", createdAt: daysAgo(40), updatedAt: daysAgo(1), currentPeriodEnd: daysAgo(-20) },
      { id: "s-2", organizationId: "org-2", plan: "FREE", status: "PAST_DUE", createdAt: daysAgo(10), updatedAt: daysAgo(3), currentPeriodEnd: daysAgo(3) },
    ]),
    saasPayment: table([
      { id: "p-1", organizationId: "org-1", amountMinor: 300000n, method: "bkash", createdAt: daysAgo(5) },
      { id: "p-2", organizationId: "org-1", amountMinor: 300000n, method: "sslcommerz", createdAt: daysAgo(35) },
    ]),
    order: table([
      { id: "o-1", organizationId: "org-1", status: "processing", totalMinor: 50000n, createdAt: daysAgo(2) },
      { id: "o-2", organizationId: "org-1", status: "cancelled", totalMinor: 99000n, createdAt: daysAgo(2) },
      { id: "o-3", organizationId: "org-2", status: "completed", totalMinor: 20000n, createdAt: daysAgo(9) },
    ]),
    aIUsageRecord: table([
      { id: "ai-1", organizationId: "org-1", provider: "openai", inputTokens: 600000, outputTokens: 400000, estimated: false, createdAt: daysAgo(3) },
      { id: "ai-2", organizationId: "org-1", provider: "dev-template", inputTokens: 5000, outputTokens: 5000, estimated: true, createdAt: daysAgo(3) },
    ]),
    automationRun: table([
      { id: "r-1", organizationId: "org-2", status: "error", createdAt: daysAgo(0) },
      { id: "r-2", organizationId: "org-2", status: "error", createdAt: daysAgo(0) },
    ]),
    integration: table([{ id: "i-1", organizationId: "org-1" }]),
    membership: table([{ id: "m-1", organizationId: "org-1", status: "ACTIVE" }]),
    auditLog: table([
      { id: "a-1", organizationId: "org-1", action: "admin.subscription_updated", entityType: "Organization", entityId: "org-1", createdAt: daysAgo(4) },
    ]),
    systemSetting: table([]),
  };
  const logs: any[] = [];
  const audit: any = { log: async (e: any) => { logs.push(e); } };
  return { svc: new AdminService(p, audit), p, logs };
}

describe("M37 analytics series", () => {
  it("buckets collections, signups and orders by month and computes the current snapshot from latest subs", async () => {
    const { svc } = makeService();
    const out = await svc.analyticsSeries(3);
    expect(out.months.length).toBe(3);
    const totalCollected = out.months.reduce((a, m) => a + BigInt(m.collectedMinor), 0n);
    expect(totalCollected).toBe(600000n);
    const totalOrders = out.months.reduce((a, m) => a + m.orders, 0);
    expect(totalOrders).toBe(2); // cancelled order excluded
    const totalRevenue = out.months.reduce((a, m) => a + BigInt(m.orderRevenueMinor), 0n);
    expect(totalRevenue).toBe(70000n);
    expect(out.current.mrrMinor).toBe("300000"); // one ACTIVE GROWTH sub
    expect(out.current.activeSubscriptions).toBe(1);
    expect(out.current.pastDue).toBe(1);
    expect(out.current.paidSharePercent).toBe(50);
  });
});

describe("M37 top tenants + health scores", () => {
  it("ranks tenants by real 30d revenue and exposes score deductions verbatim", async () => {
    const { svc } = makeService();
    const top = await svc.analyticsTopTenants(10);
    expect(top[0].organizationId).toBe("org-1");
    expect(top[0].orderRevenue30dMinor).toBe("50000");
    expect(top[0].aiTokens30d).toBe(1010000);

    const health = await svc.analyticsHealthScores();
    expect(health.heuristic).toBe(true);
    const beta = health.scores.find((s: any) => s.organizationId === "org-2");
    // PAST_DUE 40 + 2 automation errors 16 + idle 9d (last order) 8 + no integration 10 = 74 deducted
    expect(beta.score).toBe(26);
    expect(beta.band).toBe("risk");
    expect(beta.deductions.length).toBe(4);
    const alpha = health.scores.find((s: any) => s.organizationId === "org-1");
    expect(alpha.score).toBe(100);
    expect(alpha.band).toBe("good");
    expect(health.scores[0].organizationId).toBe("org-2"); // worst first
  });
});

describe("M37 AI cost + org history", () => {
  it("shows no money until a rate is set; then estimates from non-estimated tokens only", async () => {
    const { svc } = makeService();
    const before = await svc.analyticsAiCost();
    const openaiRow = before.rows.find((r: any) => r.provider === "openai");
    expect(openaiRow.tokens).toBe(1000000);
    expect(openaiRow.estimatedCostMinor).toBeNull();

    await svc.updateAiCostRates({ id: "admin-1" }, { openai: 750000 });
    const after = await svc.analyticsAiCost();
    const row = after.rows.find((r: any) => r.provider === "openai");
    expect(row.estimatedCostMinor).toBe(750000); // 1M tokens at 750000 minor / 1M
    const devRow = after.rows.find((r: any) => r.provider === "dev-template");
    expect(devRow.tokens).toBe(0); // estimated tokens excluded from cost base
    expect(devRow.estimatedTokens).toBe(10000);
  });

  it("merges audit + payments + subscription into one org timeline", async () => {
    const { svc } = makeService();
    const history = await svc.orgHistory("org-1");
    const kinds = history.events.map((e: any) => e.kind);
    expect(kinds).toContain("audit");
    expect(kinds).toContain("payment");
    expect(kinds).toContain("subscription");
    expect(history.events[0].at >= history.events[1].at).toBe(true);
    await expect(svc.orgHistory("org-nope")).rejects.toThrow();
  });
});
