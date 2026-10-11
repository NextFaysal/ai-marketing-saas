import { AutomationService } from "./automation.service";
import { InternalJobsController } from "./internal-jobs.controller";

/**
 * Milestone 57: BullMQ dispatch mode (API enqueues, worker
 * executes), the internal execute/DLQ callback surface, and
 * dead-letter recording + replay. Without REDIS_URL everything
 * stays inline — the pre-M57 behaviour.
 */
const ORG = "org-1";
type Row = Record<string, any>;
function table(store: Row[]) {
  return {
    findMany: jest.fn(async ({ where }: any = {}) => store.filter((r) =>
      Object.entries(where ?? {}).every(([k, v]) => {
        if (v && typeof v === "object" && !(v instanceof Date)) {
          if ("lte" in v) return r[k] <= (v as any).lte;
          return true;
        }
        return r[k] === v;
      }))),
    findFirst: jest.fn(async ({ where }: any = {}) => store.find((r) => r.id === where.id) ?? null),
    create: jest.fn(async ({ data }: any) => { const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), ...data }; store.push(row); return row; }),
    update: jest.fn(async ({ where, data }: any) => { const row = store.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; }),
  };
}
function fakeDb() {
  const db: any = { jobs: [] as Row[], runs: [] as Row[], dlq: [] as Row[] };
  db.scheduledJob = table(db.jobs);
  db.automationRun = table(db.runs);
  db.deadLetterJob = table(db.dlq);
  db.organization = { findMany: jest.fn(async () => []) };
  return db;
}
const auditStub = () => ({ log: jest.fn(async () => undefined) });
function service(db: any, emailChannel?: any) {
  return new AutomationService(
    db as any, auditStub() as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    undefined, undefined, undefined, emailChannel, undefined,
  );
}
const jobRow = (over: Row = {}): Row => ({
  id: "job-1", organizationId: ORG, name: "Email sync", type: "email_sync", targetId: "org",
  intervalMinutes: 60, enabled: true, nextRunAt: new Date(Date.now() - 1000), createdById: "owner", ...over,
});

describe("M57 dispatch mode", () => {
  afterEach(() => { delete process.env.REDIS_URL; });

  it("without REDIS_URL runJobNow executes inline as before", async () => {
    const db = fakeDb(); db.jobs.push(jobRow());
    const emailChannel = { syncOrganization: jest.fn(async () => ({ stored: 2 })) };
    const out: any = await service(db, emailChannel).runJobNow(ORG, "owner", "job-1");
    expect(emailChannel.syncOrganization).toHaveBeenCalled();
    expect(out.lastStatus).toBe("success");
    expect(db.runs).toHaveLength(1);
  });

  it("with REDIS_URL runJobNow enqueues instead of executing", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const db = fakeDb(); db.jobs.push(jobRow());
    const emailChannel = { syncOrganization: jest.fn(async () => ({})) };
    const svc = service(db, emailChannel);
    const add = jest.fn(async (..._args: any[]) => ({ id: "bull-42" }));
    (svc as any)._queue = { add };
    const out: any = await svc.runJobNow(ORG, "owner", "job-1");
    expect(out).toMatchObject({ queued: true, bullJobId: "bull-42" });
    expect(emailChannel.syncOrganization).not.toHaveBeenCalled();
    expect(add.mock.calls[0][1]).toEqual({ scheduledJobId: "job-1" });
    expect(add.mock.calls[0][2].jobId).toContain("sched-job-1-manual-");
    expect(add.mock.calls[0][2].attempts).toBe(3);
  });

  it("runDueJobs in queue mode advances the schedule at dispatch and dedupes by run key", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const db = fakeDb(); const job = jobRow(); db.jobs.push(job);
    const svc = service(db, { syncOrganization: jest.fn(async () => ({})) });
    const add = jest.fn(async (..._args: any[]) => ({ id: "b1" }));
    (svc as any)._queue = { add };
    const originalNextRunAt = job.nextRunAt.getTime();
    await svc.runDueJobs();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][2].jobId).toBe(`sched-job-1-${originalNextRunAt}`);
    expect(new Date(db.jobs[0].nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("executeScheduledJobById records success, and rethrows failures for BullMQ", async () => {
    const db = fakeDb(); db.jobs.push(jobRow());
    const ok = service(db, { syncOrganization: jest.fn(async () => ({ stored: 1 })) });
    await expect(ok.executeScheduledJobById("job-1")).resolves.toMatchObject({ ok: true });
    expect(db.jobs[0].lastStatus).toBe("success");
    const failing = service(db, { syncOrganization: jest.fn(async () => { throw new Error("IMAP down"); }) });
    await expect(failing.executeScheduledJobById("job-1")).rejects.toThrow(/IMAP down/);
    expect(db.jobs[0].lastStatus).toBe("error");
    expect(db.runs.filter((r: Row) => r.status === "error")).toHaveLength(1);
  });

  it("recordDlq parks the job with its org/type; replay marks + refuses doubles", async () => {
    const db = fakeDb(); db.jobs.push(jobRow());
    const svc = service(db, { syncOrganization: jest.fn(async () => ({})) });
    const row = await svc.recordDlq({ scheduledJobId: "job-1", error: "IMAP down", attempts: 3 });
    expect(row).toMatchObject({ organizationId: ORG, jobType: "email_sync", attempts: 3 });
    const out: any = await svc.replayDlq(row.id, "admin-1");
    expect(out).toMatchObject({ replayed: true, mode: "inline" });
    expect(db.dlq[0].replayedAt).toBeTruthy();
    await expect(svc.replayDlq(row.id, "admin-1")).rejects.toThrow(/already replayed/);
  });
});

describe("M57 internal surface", () => {
  const OLD = process.env.INTERNAL_JOB_SECRET;
  afterAll(() => { if (OLD === undefined) delete process.env.INTERNAL_JOB_SECRET; else process.env.INTERNAL_JOB_SECRET = OLD; });

  it("refuses everything when the secret is not configured", async () => {
    delete process.env.INTERNAL_JOB_SECRET;
    const ctrl = new InternalJobsController({} as any);
    await expect(ctrl.execute("anything", { scheduledJobId: "j" })).rejects.toThrow(/not configured/);
  });

  it("rejects a wrong secret and accepts the right one", async () => {
    process.env.INTERNAL_JOB_SECRET = "topsecret";
    const automation = { executeScheduledJobById: jest.fn(async () => ({ ok: true, summary: "s" })) };
    const ctrl = new InternalJobsController(automation as any);
    await expect(ctrl.execute("wrong", { scheduledJobId: "j" })).rejects.toThrow(/Invalid internal secret/);
    await expect(ctrl.execute("topsecret", { scheduledJobId: "j" })).resolves.toMatchObject({ ok: true });
    expect(automation.executeScheduledJobById).toHaveBeenCalledWith("j");
  });

  it("a failing job surfaces as a 500 so BullMQ retries", async () => {
    process.env.INTERNAL_JOB_SECRET = "topsecret";
    const automation = { executeScheduledJobById: jest.fn(async () => { throw new Error("kaput"); }) };
    const ctrl = new InternalJobsController(automation as any);
    await expect(ctrl.execute("topsecret", { scheduledJobId: "j" })).rejects.toMatchObject({ status: 500 });
  });
});
