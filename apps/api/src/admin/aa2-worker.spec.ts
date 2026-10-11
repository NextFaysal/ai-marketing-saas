process.env.ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64");
import { AdminService } from "./admin.service";

/**
 * Admin Advanced AA2 — Worker + BullMQ live view.
 *
 * Data-source contract under test:
 *  - worker liveness = the worker's OWN /health payload, passed
 *    through verbatim (a degraded worker answers 503 WITH the
 *    payload and still counts as reachable);
 *  - queue depths = BullMQ getJobCounts read from Redis by the
 *    API (the worker health payload carries no counts).
 * Both probes are failure-isolated: neither may ever take the
 * systemQueues response (DB counts) down with it.
 *
 * The transport (probeWorkerHealth, node:http with a hard 2s
 * teardown) is stubbed on the instance — specs never touch a
 * real network.
 */

const audit = { log: async () => undefined } as any;

function prismaFake(): any {
  return {
    scheduledJob: { findMany: async () => [] },
    syncJob: { count: async () => 0, findMany: async () => [] },
    messageDelivery: { findMany: async () => [] },
    workflowRun: { count: async () => 0, findMany: async () => [] },
    systemSetting: { findUnique: async () => null },
  };
}

function svcWithProbe(probe: (url: string) => Promise<{ status: number; body: unknown }>): AdminService {
  const svc = new AdminService(prismaFake(), audit);
  (svc as any).probeWorkerHealth = probe;
  return svc;
}

let savedRedis: string | undefined;
let savedHealthUrl: string | undefined;
beforeEach(() => {
  savedRedis = process.env.REDIS_URL;
  savedHealthUrl = process.env.WORKER_HEALTH_URL;
  delete process.env.REDIS_URL;
  delete process.env.WORKER_HEALTH_URL;
});
afterEach(() => {
  if (savedRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = savedRedis;
  if (savedHealthUrl === undefined) delete process.env.WORKER_HEALTH_URL; else process.env.WORKER_HEALTH_URL = savedHealthUrl;
});

const HEALTH_FIXTURE = {
  status: "ok", service: "worker", queues: ["scheduled-jobs", "webhook"],
  redis: "ok", secretConfigured: true, uptimeSec: 3723,
};

describe("AA2 — workerHealth", () => {
  it("passes the worker's own health payload through verbatim", async () => {
    const svc = svcWithProbe(async () => ({ status: 200, body: HEALTH_FIXTURE }));
    const out: any = await svc.workerHealth();
    expect(out.reachable).toBe(true);
    expect(out.health).toEqual(HEALTH_FIXTURE);
    expect(out.healthUrl).toBe("http://worker:4100/health"); // documented default (compose service name)
    expect(typeof out.checkedAt).toBe("string");
  });

  it("honours WORKER_HEALTH_URL and treats a degraded 503-with-body as reachable", async () => {
    process.env.WORKER_HEALTH_URL = "http://localhost:4100/health";
    const degraded = { ...HEALTH_FIXTURE, status: "degraded", redis: "error" };
    const seen: string[] = [];
    const svc = svcWithProbe(async (url: string) => { seen.push(url); return { status: 503, body: degraded }; });
    const out: any = await svc.workerHealth();
    expect(seen).toEqual(["http://localhost:4100/health"]);
    expect(out.reachable).toBe(true);
    expect(out.health.status).toBe("degraded");
  });

  it("reports unreachable with the underlying reason — and systemQueues still returns the DB counts", async () => {
    const err = new Error("getaddrinfo ENOTFOUND worker") as any;
    err.code = "ENOTFOUND";
    const svc = svcWithProbe(async () => { throw err; });
    const w: any = await svc.workerHealth();
    expect(w.reachable).toBe(false);
    expect(w.error).toContain("ENOTFOUND");
    const q: any = await svc.systemQueues();
    expect(q.scheduledJobs.total).toBe(0);
    expect(q.worker.reachable).toBe(false);
    expect(q.bullmq.available).toBe(false);
  });

  it("a non-JSON health answer is unreachable, never a fabricated ok", async () => {
    const svc = svcWithProbe(async () => ({ status: 502, body: null }));
    const out: any = await svc.workerHealth();
    expect(out.reachable).toBe(false);
    expect(out.error).toContain("502");
  });
});

describe("AA2 — bullmqCounts", () => {
  it("says so honestly when REDIS_URL is not set (inline mode)", async () => {
    const out: any = await new AdminService(prismaFake(), audit).bullmqCounts();
    expect(out.available).toBe(false);
    expect(out.reason).toContain("REDIS_URL");
    expect(out.queues).toEqual([]);
  });

  it("maps getJobCounts for both real queues", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const svc = new AdminService(prismaFake(), audit);
    const seen: string[][] = [];
    const fakeQueue = {
      getJobCounts: async (...states: string[]) => {
        seen.push(states);
        return { waiting: 3, active: 1, delayed: 2, failed: 4, completed: 9, paused: 0 };
      },
    };
    (svc as any)._bullQueues.set("scheduled-jobs", fakeQueue);
    (svc as any)._bullQueues.set("webhook", fakeQueue);
    const out: any = await svc.bullmqCounts();
    expect(out.available).toBe(true);
    expect(out.queues.map((q: any) => q.name)).toEqual(["scheduled-jobs", "webhook"]);
    expect(out.queues[0]).toEqual({ name: "scheduled-jobs", waiting: 3, active: 1, delayed: 2, failed: 4, completed: 9, paused: 0 });
    expect(seen[0]).toEqual(expect.arrayContaining(["waiting", "active", "delayed", "failed", "completed"]));
  });

  it("surfaces a Redis failure as available:false with the verbatim error — never throws", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const svc = new AdminService(prismaFake(), audit);
    const badQueue = { getJobCounts: async () => { throw new Error("Connection is closed."); } };
    (svc as any)._bullQueues.set("scheduled-jobs", badQueue);
    (svc as any)._bullQueues.set("webhook", badQueue);
    const out: any = await svc.bullmqCounts();
    expect(out.available).toBe(false);
    expect(out.error).toContain("Connection is closed.");
    expect(out.queues).toEqual([]);
  });
});
