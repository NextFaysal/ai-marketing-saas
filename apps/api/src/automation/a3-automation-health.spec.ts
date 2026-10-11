import { AutomationService } from "./automation.service";

/**
 * Automations A3 — tenant automation health:
 * - per-job health derived from AutomationRun rows (kind=schedule):
 *   runs7d/decided7d/successRate7d (null when undecided),
 *   consecutiveFailures, band (ok | failing | never_run);
 * - tenant dead-letter list (org-scoped, paginated, error excerpt
 *   truncated explicitly) + replay through the EXISTING
 *   replayDlq mechanism behind an org-ownership check;
 * - dead-letter notification on recordDlq: ACTIVE OWNER/ADMIN,
 *   type "job_dead_letter", deduped once per job per Dhaka day
 *   via the AuditLog marker, fully failure-isolated.
 */
const ORG = "org-1";
const ORG2 = "org-2";
type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      if ("lte" in v) return new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
      return true;
    }
    return row[k] === v;
  });
}
function table(store: Row[]) {
  return {
    findMany: jest.fn(async (args: any = {}) => {
      let rows = store.filter((r) => matches(r, args.where));
      if (args.orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (args.orderBy?.createdAt === "asc") rows = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take) rows = rows.slice(0, args.take);
      return rows;
    }),
    findFirst: jest.fn(async (args: any = {}) => store.find((r) => matches(r, args.where)) ?? null),
    count: jest.fn(async (args: any = {}) => store.filter((r) => matches(r, args.where)).length),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), ...data };
      store.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row;
    }),
  };
}
function fakeDb() {
  const db: any = {
    jobs: [] as Row[], runs: [] as Row[], dlq: [] as Row[],
    auditRows: [] as Row[], members: [] as Row[], notifications: [] as Row[],
  };
  db.scheduledJob = table(db.jobs);
  db.automationRun = table(db.runs);
  db.deadLetterJob = table(db.dlq);
  db.auditLog = table(db.auditRows);
  db.membership = table(db.members);
  db.agentNotification = table(db.notifications);
  db.organization = { findMany: jest.fn(async () => []) };
  return db;
}
/** Audit stub that actually persists rows — recordDlq's dedupe
 * marker is an AuditLog row, so the fake must behave like the
 * real AuditService (which writes AuditLog via Prisma). */
function auditFor(db: any) {
  return {
    log: jest.fn(async (input: any) => {
      db.auditRows.push({ id: `audit-${db.auditRows.length + 1}`, createdAt: new Date(), ...input });
    }),
  };
}
function service(db: any, emailChannel?: any) {
  return new AutomationService(
    db as any, auditFor(db) as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    undefined, undefined, undefined, emailChannel, undefined, undefined, undefined,
  );
}
const jobRow = (over: Row = {}): Row => ({
  id: "job-1", organizationId: ORG, name: "Email sync", type: "email_sync", targetId: "org",
  intervalMinutes: 60, enabled: true, lastRunAt: null, lastStatus: null, lastError: null,
  nextRunAt: new Date(), createdById: "owner", createdAt: new Date(), ...over,
});
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000);
const runRow = (over: Row = {}): Row => ({
  id: `run-${Math.random().toString(36).slice(2, 9)}`, organizationId: ORG, kind: "schedule",
  refId: "job-1", status: "success", detail: null, createdAt: hoursAgo(1), ...over,
});

describe("A3 health derivation", () => {
  it("derives runs7d, successRate, streak and band from real run rows", async () => {
    const db = fakeDb();
    db.jobs.push(jobRow());
    // newest -> oldest: error, error, success (in window), error (8 days ago, outside window)
    db.runs.push(
      runRow({ status: "error", createdAt: hoursAgo(1) }),
      runRow({ status: "error", createdAt: hoursAgo(2) }),
      runRow({ status: "success", createdAt: hoursAgo(3) }),
      runRow({ status: "error", createdAt: hoursAgo(24 * 8) }),
      runRow({ status: "triggered", createdAt: hoursAgo(1) }), // not decided, ignored everywhere
    );
    const health = await service(db).getAutomationHealth(ORG);
    const j = health.jobs.find((x: any) => x.jobId === "job-1");
    expect(j.runs7d).toBe(4); // includes the non-decided "triggered" row inside the window
    expect(j.decided7d).toBe(3);
    expect(j.successRate7d).toBeCloseTo(1 / 3, 4);
    expect(j.consecutiveFailures).toBe(2);
    expect(j.band).toBe("failing");
  });

  it("never-run job: band never_run and successRate null (never fabricated)", async () => {
    const db = fakeDb();
    db.jobs.push(jobRow());
    const health = await service(db).getAutomationHealth(ORG);
    const j = health.jobs[0];
    expect(j.band).toBe("never_run");
    expect(j.successRate7d).toBeNull();
    expect(j.decided7d).toBe(0);
    expect(j.consecutiveFailures).toBe(0);
  });

  it("latest success -> band ok, streak 0; other org's runs never leak in", async () => {
    const db = fakeDb();
    db.jobs.push(jobRow());
    db.jobs.push(jobRow({ id: "job-2", name: "Other org job", organizationId: ORG2 }));
    db.runs.push(runRow({ status: "error", createdAt: hoursAgo(5) }), runRow({ status: "success", createdAt: hoursAgo(1) }));
    db.runs.push(runRow({ organizationId: ORG2, refId: "job-2", status: "error", createdAt: hoursAgo(1) }));
    const health = await service(db).getAutomationHealth(ORG);
    expect(health.jobs).toHaveLength(1);
    expect(health.jobs[0].band).toBe("ok");
    expect(health.jobs[0].consecutiveFailures).toBe(0);
    expect(health.jobs[0].successRate7d).toBe(0.5);
  });
});

describe("A3 dead-letter list + replay", () => {
  function seedDlq(db: any) {
    db.dlq.push(
      { id: "dlq-1", organizationId: ORG, scheduledJobId: "job-1", jobType: "email_sync", error: "x".repeat(500), attempts: 3, createdAt: hoursAgo(2), replayedAt: null },
      { id: "dlq-2", organizationId: ORG, scheduledJobId: "job-1", jobType: "email_sync", error: "short", attempts: 3, createdAt: hoursAgo(1), replayedAt: hoursAgo(0.5) },
      { id: "dlq-3", organizationId: ORG2, scheduledJobId: "job-9", jobType: "email_sync", error: "other org", attempts: 1, createdAt: hoursAgo(1), replayedAt: null },
    );
  }

  it("lists only the caller's org, newest first, with honest excerpt truncation", async () => {
    const db = fakeDb(); db.jobs.push(jobRow()); seedDlq(db);
    const out = await service(db).listOrgDeadLetters(ORG, {});
    expect(out.total).toBe(2);
    expect(out.entries.map((e: any) => e.id)).toEqual(["dlq-2", "dlq-1"]);
    const long = out.entries.find((e: any) => e.id === "dlq-1")!;
    expect(long.error).toHaveLength(300);
    expect(long.errorTruncated).toBe(true);
    expect(long.errorLength).toBe(500);
    expect(long.jobName).toBe("Email sync");
    expect(long.open).toBe(true);
    const short = out.entries.find((e: any) => e.id === "dlq-2")!;
    expect(short.errorTruncated).toBe(false);
    expect(short.open).toBe(false);
  });

  it("paginates and filters open-only", async () => {
    const db = fakeDb(); seedDlq(db);
    const page = await service(db).listOrgDeadLetters(ORG, { take: 1, skip: 0 });
    expect(page.total).toBe(2);
    expect(page.entries).toHaveLength(1);
    const open = await service(db).listOrgDeadLetters(ORG, { openOnly: true });
    expect(open.total).toBe(1);
    expect(open.entries[0].id).toBe("dlq-1");
  });

  it("health response carries the open dead-letter count for the badge", async () => {
    const db = fakeDb(); db.jobs.push(jobRow()); seedDlq(db);
    const health = await service(db).getAutomationHealth(ORG);
    expect(health.deadLetters.openCount).toBe(1);
    expect(health.deadLetters.latest).toHaveLength(2);
  });

  it("replay: another org's entry is a 404; own entry replays via the existing mechanism exactly once", async () => {
    const db = fakeDb(); db.jobs.push(jobRow()); seedDlq(db);
    const svc = service(db, { syncOrganization: jest.fn(async () => ({})) });
    await expect(svc.replayOrgDeadLetter(ORG, "dlq-3", "owner")).rejects.toThrow(/not found/i);
    const out: any = await svc.replayOrgDeadLetter(ORG, "dlq-1", "owner");
    expect(out).toMatchObject({ replayed: true });
    expect(db.dlq.find((r: Row) => r.id === "dlq-1")!.replayedAt).toBeTruthy();
    await expect(svc.replayOrgDeadLetter(ORG, "dlq-1", "owner")).rejects.toThrow(/already replayed/);
  });
});

describe("A3 dead-letter notification", () => {
  function seedMembers(db: any) {
    db.members.push(
      { id: "m1", organizationId: ORG, userId: "owner-1", role: "OWNER", status: "ACTIVE", createdAt: new Date() },
      { id: "m2", organizationId: ORG, userId: "admin-1", role: "ADMIN", status: "ACTIVE", createdAt: new Date() },
      { id: "m3", organizationId: ORG, userId: "agent-1", role: "SUPPORT_AGENT", status: "ACTIVE", createdAt: new Date() },
      { id: "m4", organizationId: ORG, userId: "gone-1", role: "ADMIN", status: "SUSPENDED", createdAt: new Date() },
    );
  }

  it("notifies ACTIVE OWNER/ADMIN once per job per day; second dead letter same day is silent", async () => {
    const db = fakeDb(); db.jobs.push(jobRow()); seedMembers(db);
    const svc = service(db);
    await svc.recordDlq({ scheduledJobId: "job-1", error: "IMAP down", attempts: 3 });
    expect(db.notifications).toHaveLength(2);
    expect(db.notifications.map((n: Row) => n.userId).sort()).toEqual(["admin-1", "owner-1"]);
    expect(db.notifications[0].type).toBe("job_dead_letter");
    expect(db.notifications[0].title).toContain("Email sync");
    await svc.recordDlq({ scheduledJobId: "job-1", error: "IMAP still down", attempts: 3 });
    expect(db.notifications).toHaveLength(2); // dedupe marker held
    expect(db.dlq).toHaveLength(2); // both rows still recorded
  });

  it("webhook dead letters (no org) never notify", async () => {
    const db = fakeDb(); seedMembers(db);
    await service(db).recordDlq({ scheduledJobId: "webhook:meta:int-1", error: "bad signature", attempts: 5, jobType: "webhook" });
    expect(db.notifications).toHaveLength(0);
    expect(db.dlq[0].organizationId).toBeNull();
  });

  it("notification failure never breaks recordDlq", async () => {
    const db = fakeDb(); db.jobs.push(jobRow()); seedMembers(db);
    db.agentNotification.create = jest.fn(async () => { throw new Error("notification store down"); });
    const row = await service(db).recordDlq({ scheduledJobId: "job-1", error: "boom", attempts: 3 });
    expect(row).toMatchObject({ organizationId: ORG, jobType: "email_sync" });
    // membership lookup exploding is isolated too
    const db2 = fakeDb(); db2.jobs.push(jobRow());
    db2.membership.findMany = jest.fn(async () => { throw new Error("db down"); });
    const row2 = await service(db2).recordDlq({ scheduledJobId: "job-1", error: "boom", attempts: 3 });
    expect(row2).toMatchObject({ organizationId: ORG });
  });
});
