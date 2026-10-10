import { AdminService } from "./admin.service";

/** Milestone 42 (Admin Phase A6): self-contained fakes (m37 pattern). */
function match(row: any, where: any = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gte" in (v as any)) { if (!(new Date(row[k]).getTime() >= new Date((v as any).gte).getTime())) return false; }
      else if ("in" in (v as any)) { if (!(v as any).in.includes(row[k])) return false; }
      else if ("contains" in (v as any)) { if (!String(row[k] ?? "").includes((v as any).contains)) return false; }
      else return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}
let seq = 0;
function table(seed: any[] = []) {
  const rows = [...seed];
  const sortBy = (out: any[], orderBy: any) => {
    if (!orderBy) return out;
    const [key, dir] = Object.entries(orderBy)[0] as [string, string];
    return [...out].sort((a, b) => {
      const d = new Date(a[key]).getTime() - new Date(b[key]).getTime();
      return dir === "desc" ? -d : d;
    });
  };
  return {
    rows,
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => match(r, args.where ?? {}));
      out = sortBy(out, args.orderBy);
      // Prisma treats take on an unordered query as a cap too.
      if (args.take) out = out.slice(0, args.take);
      return out;
    },
    findUnique: async ({ where }: any) => rows.find((r) => (where.key !== undefined && r.key === where.key) || (where.id !== undefined && r.id === where.id)) ?? null,
    count: async (args: any = {}) => rows.filter((r) => match(r, args.where ?? {})).length,
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => r.key === where.key);
      if (row) { Object.assign(row, update); return row; }
      const created = { id: `row-${++seq}`, createdAt: new Date(), ...create };
      rows.push(created);
      return created;
    },
  };
}

const ADMIN: any = { id: "admin-1", email: "root@platform.local", isSuperAdmin: true, adminTier: "SUPER" };
const AUDIT: any = { log: jest.fn(async () => undefined) };
const NOW = new Date();
const HOUR_AGO = new Date(Date.now() - 3600000);

function makePrisma() {
  return {
    organization: table([{ id: "org-1", name: "Acme" }]),
    user: table([{ id: "u-1" }, { id: "u-2" }]),
    membership: table([{ id: "m-1" }]),
    product: table([]), order: table([{ id: "o-1" }, { id: "o-2" }, { id: "o-3" }]),
    customer: table([]), lead: table([]),
    channelConversation: table([]), channelMessage: table([{ id: "cm-1" }]),
    campaignPlan: table([]), auditLog: table([
      { id: "a-1", action: "admin.payment_recorded", organizationId: null, createdAt: NOW },
      { id: "a-2", action: "order.created", organizationId: "org-1", createdAt: HOUR_AGO },
      { id: "a-3", action: "auth.login", organizationId: null, createdAt: HOUR_AGO },
    ]),
    saasPayment: table([{ id: "p-1" }]), subscription: table([{ id: "s-1" }]),
    supportTicket: table([]), aIUsageRecord: table([]),
    systemSetting: table([]),
    scheduledJob: table([
      { id: "j-1", name: "Daily", type: "daily_report", enabled: true, nextRunAt: new Date(Date.now() - 60000), lastRunAt: HOUR_AGO, lastError: "SMTP down" },
      { id: "j-2", name: "Weekly", type: "weekly_ads_report", enabled: false, nextRunAt: new Date(Date.now() + 86400000), lastRunAt: null, lastError: null },
    ]),
    syncJob: table([
      { id: "sj-1", kind: "orders", status: "FAILED", error: "store 401", startedAt: HOUR_AGO },
      { id: "sj-2", kind: "products", status: "RUNNING", startedAt: NOW },
    ]),
    messageDelivery: table([
      { id: "d-1", channel: "email", address: "a@x.test", status: "failed", error: "bounce", createdAt: HOUR_AGO },
      { id: "d-2", channel: "sms", address: "+8801", status: "queued", createdAt: NOW },
    ]),
    workflowRun: table([{ id: "w-1", status: "running", createdAt: NOW }]),
    automationRun: table([{ id: "r-1", kind: "rule", status: "error", detail: "meta timeout", createdAt: HOUR_AGO }]),
    webhookEvent: table([{ id: "wh-1", provider: "woocommerce", topic: "order.created", error: "bad signature", receivedAt: HOUR_AGO }]),
    dailyAdMetric: table([]),
  } as any;
}

describe("Milestone 42 — reliability panel", () => {
  it("version reports boot facts and an honest null for migrations without raw SQL", async () => {
    const svc = new AdminService(makePrisma(), AUDIT);
    const v: any = await svc.systemVersion();
    expect(v.database.reachable).toBe(true);
    expect(v.migrations).toBeNull();
    expect(v.nodeVersion).toMatch(/^v\d+/);
    expect(v.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("queues aggregate scheduled jobs, syncs, deliveries and workflow runs", async () => {
    const svc = new AdminService(makePrisma(), AUDIT);
    const q: any = await svc.systemQueues();
    expect(q.scheduledJobs.total).toBe(2);
    expect(q.scheduledJobs.enabled).toBe(1);
    expect(q.scheduledJobs.dueNow).toBe(1);
    expect(q.scheduledJobs.recentlyFailed[0].lastError).toBe("SMTP down");
    expect(q.syncJobs.running).toBe(1);
    expect(q.syncJobs.failedLast24h).toBe(1);
    expect(q.deliveries.failedLast24h).toBe(1);
    expect(q.deliveries.pending).toBe(1);
    expect(q.workflowRuns.running).toBe(1);
  });

  it("error summary counts every source including webhook errors", async () => {
    const svc = new AdminService(makePrisma(), AUDIT);
    const e: any = await svc.systemErrors(24);
    expect(e.totalErrors).toBe(4); // automation 1 + sync 1 + webhook 1 + delivery 1
    expect(e.sources.find((s: any) => s.source === "webhooks").count).toBe(1);
    expect(e.sources.find((s: any) => s.source === "automation_runs").latest[0].detail).toBe("meta timeout");
  });

  it("activity log lists audit rows newest-first and filters by action text", async () => {
    const svc = new AdminService(makePrisma(), AUDIT);
    const all: any[] = await svc.systemLogs(10);
    expect(all[0].action).toBe("admin.payment_recorded");
    const filtered: any[] = await svc.systemLogs(10, "payment");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].action).toBe("admin.payment_recorded");
  });

  it("db growth falls back to honest row counts without the Postgres catalog", async () => {
    const svc = new AdminService(makePrisma(), AUDIT);
    const g: any = await svc.systemDbGrowth();
    expect(g.source).toContain("row counts");
    expect(g.tables.find((t: any) => t.table === "Order").approxRows).toBe(3);
    expect(g.totalBytes).toBeNull();
  });

  it("backup manifest counts live rows, stores itself, and the panel reads it back", async () => {
    const p = makePrisma();
    const svc = new AdminService(p, AUDIT);
    const manifest: any = await svc.verifyBackupManifest(ADMIN);
    expect(manifest.totalRows).toBeGreaterThan(0);
    expect(manifest.tables.Order).toBe(3);
    expect(manifest.tables.Organization).toBe(1);
    const panel: any = await svc.getBackupPanel();
    expect(panel.manifest.totalRows).toBe(manifest.totalRows);
    const info: any = await svc.setBackupInfo(ADMIN, { lastBackupAt: "2026-10-10T00:00:00.000Z", location: "Dokploy S3", note: "weekly" });
    expect(info.location).toBe("Dokploy S3");
    const panel2: any = await svc.getBackupPanel();
    expect(panel2.info.location).toBe("Dokploy S3");
  });
});
