process.env.ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64");
import { Reflector } from "@nestjs/core";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { ADMIN_TIER_KEY } from "../common/super-admin.guard";
import { DEFAULT_PLAN_LIMITS, planLimits } from "../common/platform-settings";

/**
 * Admin Next AB3 — Operator Actions (AN12–AN14a).
 *
 * AN12: queue pause/resume/retry-failed ride the SAME BullMQ
 * Queue handles as AA2's read-only counts (specs seed the
 * _bullQueues cache with fakes, the aa2-worker.spec pattern —
 * no real Redis is ever touched). Unavailable (no REDIS_URL /
 * Redis error) must return the honest unavailable result and
 * call NOTHING on the queue.
 *
 * AN13: the service methods must delegate to the tenant side's
 * own services (SocialHealthService.retryPost /
 * checkAccountHealth, SocialPublishService.runDuePublishes,
 * AdsService.sync*Insights) with the board row's org + the
 * admin as actor; a delegate's error propagates verbatim.
 *
 * AN14(a): clearPlanLimits removes ONE tier's stored entry —
 * that tier resolves to DEFAULT_PLAN_LIMITS again, other
 * tiers' entries are byte-identical, and the clear is audited
 * with before/after.
 */

const SUPER: any = { id: "admin-1", email: "root@x.com", isSuperAdmin: true, adminTier: "SUPER" };
const REASON = "worker আটকে ছিল, operator পদক্ষেপ";

const mkAudit = (logs: any[] = []) => ({ logs, log: async (input: any) => { logs.push(input); } }) as any;

let savedRedis: string | undefined;
beforeEach(() => { savedRedis = process.env.REDIS_URL; delete process.env.REDIS_URL; });
afterEach(() => { if (savedRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = savedRedis; });

// ---------------- AN12: queues ----------------

function fakeQueue(overrides: Record<string, any> = {}) {
  const calls: string[] = [];
  const state = { paused: false, failed: 2 };
  const q: any = {
    calls,
    isPaused: async () => { calls.push("isPaused"); return state.paused; },
    pause: async () => { calls.push("pause"); state.paused = true; },
    resume: async () => { calls.push("resume"); state.paused = false; },
    getJobCounts: async () => { calls.push("getJobCounts"); return { failed: state.failed }; },
    getFailed: async () => [],
    getJob: async () => null,
    ...overrides,
  };
  return q;
}

function svcWithQueue(q: any, logs: any[] = []) {
  const svc = new AdminService({} as any, mkAudit(logs));
  (svc as any)._bullQueues.set("scheduled-jobs", q);
  (svc as any)._bullQueues.set("webhook", q);
  return svc;
}

describe("AB3 AN12 — queue operator actions", () => {
  it("pause calls queue.pause() and audits before/after", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const logs: any[] = [];
    const q = fakeQueue();
    const svc = svcWithQueue(q, logs);
    const out: any = await svc.queuePause(SUPER, "scheduled-jobs", REASON);
    expect(out).toEqual({ available: true, queue: "scheduled-jobs", action: "pause", paused: true });
    expect(q.calls).toContain("pause");
    const audit = logs.find((l) => l.action === "admin.queue_paused");
    expect(audit).toBeTruthy();
    expect(audit.metadata.before).toEqual({ paused: false });
    expect(audit.metadata.after).toEqual({ paused: true });
    expect(audit.metadata.reason).toBe(REASON);
  });

  it("resume calls queue.resume() and audits before/after", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const logs: any[] = [];
    const q = fakeQueue();
    q.pause(); q.calls.length = 0;
    const svc = svcWithQueue(q, logs);
    const out: any = await svc.queueResume(SUPER, "webhook", REASON);
    expect(out.paused).toBe(false);
    expect(q.calls).toContain("resume");
    const audit = logs.find((l) => l.action === "admin.queue_resumed");
    expect(audit.metadata.before).toEqual({ paused: true });
    expect(audit.metadata.after).toEqual({ paused: false });
  });

  it("retry-failed retries only failed jobs, reports per-job outcomes verbatim", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const logs: any[] = [];
    const retried: string[] = [];
    const job = (id: string, fail = false) => ({
      id,
      getState: async () => "failed",
      retry: async () => { if (fail) throw new Error("job already promoted"); retried.push(id); },
    });
    const q = fakeQueue({ getFailed: async (from: number, to: number) => [job("j1"), job("j2", true)].slice(from, to + 1) });
    const svc = svcWithQueue(q, logs);
    const out: any = await svc.queueRetryFailed(SUPER, "scheduled-jobs", { reason: REASON });
    expect(out.available).toBe(true);
    expect(out.retried).toBe(1);
    expect(out.results).toEqual([
      { id: "j1", retried: true },
      { id: "j2", retried: false, error: "job already promoted" },
    ]);
    expect(retried).toEqual(["j1"]);
    const audit = logs.find((l) => l.action === "admin.queue_retry_failed");
    expect(audit.metadata.retried).toBe(1);
    expect(audit.metadata.before).toEqual({ failed: 2 });
  });

  it("retry-failed honours the limit cap and the explicit jobIds path", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const jobs = ["a", "b", "c"].map((id) => ({
      id, getState: async () => "failed", retry: async () => undefined,
    }));
    const q = fakeQueue({
      getFailed: async (from: number, to: number) => jobs.slice(from, to + 1),
      getJob: async (id: string) => jobs.find((j) => j.id === id) ?? null,
    });
    const svc = svcWithQueue(q);
    const capped: any = await svc.queueRetryFailed(SUPER, "webhook", { reason: REASON, limit: 2 });
    expect(capped.requested).toBe(2);
    expect(capped.retried).toBe(2);
    const byIds: any = await svc.queueRetryFailed(SUPER, "webhook", { reason: REASON, jobIds: ["c", "missing"] });
    expect(byIds.results).toEqual([
      { id: "c", retried: true },
      { id: "missing", retried: false, error: "এই ID-র কোনো job পাওয়া যায়নি" },
    ]);
  });

  it("no REDIS_URL → honest unavailable, queue never called, attempt audited", async () => {
    const logs: any[] = [];
    const q = fakeQueue();
    const svc = svcWithQueue(q, logs);
    const out: any = await svc.queuePause(SUPER, "scheduled-jobs", REASON);
    expect(out.available).toBe(false);
    expect(out.reason).toContain("REDIS_URL");
    expect(q.calls).toEqual([]);
    expect(logs.some((l) => l.action === "admin.queue_pause_unavailable")).toBe(true);
  });

  it("a Redis failure surfaces verbatim as unavailable — never a success", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const q = fakeQueue({ isPaused: async () => { throw new Error("Connection is closed."); } });
    const svc = svcWithQueue(q);
    const out: any = await svc.queueResume(SUPER, "scheduled-jobs", REASON);
    expect(out.available).toBe(false);
    expect(out.error).toContain("Connection is closed.");
  });

  it("missing reason and unknown queue are refused before anything is called", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const q = fakeQueue();
    const svc = svcWithQueue(q);
    await expect(svc.queuePause(SUPER, "scheduled-jobs", "")).rejects.toThrow(/reason is required/i);
    await expect(svc.queuePause(SUPER, "no-such-queue", REASON)).rejects.toThrow(/Unknown queue/);
    await expect(svc.queueRetryFailed(SUPER, "webhook", {})).rejects.toThrow(/reason is required/i);
    expect(q.calls).toEqual([]);
  });

  it("there is no drain/obliterate surface on the service", () => {
    const svc = new AdminService({} as any, mkAudit());
    expect((svc as any).queueDrain).toBeUndefined();
    expect((svc as any).queueObliterate).toBeUndefined();
  });
});

// ---------------- AN13: social/ads operator retry ----------------

function opsPrisma() {
  const post: any = { id: "post-1", organizationId: "org-1", status: "failed" };
  const stuck: any = { id: "post-2", organizationId: "org-1", status: "publishing" };
  const account: any = { id: "sacc-1", organizationId: "org-1", status: "error" };
  const adAccount: any = { id: "ad-1", organizationId: "org-1", platform: "meta", updatedAt: new Date() };
  return {
    _post: post, _stuck: stuck,
    socialPost: { findUnique: async ({ where }: any) => (where.id === "post-1" ? post : where.id === "post-2" ? stuck : null) },
    socialAccount: { findUnique: async ({ where }: any) => (where.id === "sacc-1" ? account : null) },
    adAccount: { findUnique: async ({ where }: any) => (where.id === "ad-1" ? adAccount : where.id === "ad-2" ? { id: "ad-2", organizationId: "org-1", platform: "snapchat", updatedAt: new Date() } : null) },
  } as any;
}

describe("AB3 AN13 — operator retry delegation", () => {
  it("failed post delegates to SocialHealthService.retryPost with the post's org + admin actor", async () => {
    const logs: any[] = [];
    const prisma = opsPrisma();
    const health = { retryPost: async (org: string, actor: string, id: string) => { prisma._post.status = "published"; return { org, actor, id, status: "published" }; } };
    const svc = new AdminService(prisma, mkAudit(logs), undefined, health as any, undefined, undefined);
    const out: any = await svc.socialOpsRetryPost(SUPER, "post-1", REASON);
    expect(out.retried).toBe(true);
    expect(out.result).toEqual({ org: "org-1", actor: "admin-1", id: "post-1", status: "published" });
    const audit = logs.find((l) => l.action === "admin.social_ops_retry_post");
    expect(audit.metadata.before).toEqual({ status: "failed" });
    expect(audit.metadata.after).toEqual({ status: "published" });
    expect(audit.metadata.outcome).toBe("delegated");
  });

  it("a delegate's error propagates verbatim and the failed attempt is audited", async () => {
    const logs: any[] = [];
    const health = { retryPost: async () => { throw new Error("Meta verbatim: session expired"); } };
    const svc = new AdminService(opsPrisma(), mkAudit(logs), undefined, health as any, undefined, undefined);
    await expect(svc.socialOpsRetryPost(SUPER, "post-1", REASON)).rejects.toThrow("Meta verbatim: session expired");
    const audit = logs.find((l) => l.action === "admin.social_ops_retry_post");
    expect(audit.metadata.outcome).toBe("failed");
    expect(audit.metadata.error).toContain("Meta verbatim");
  });

  it("stuck post rides runDuePublishes for its org; a non-publishing post is refused without calling it", async () => {
    const logs: any[] = [];
    const prisma = opsPrisma();
    const sweeps: string[] = [];
    const publish = { runDuePublishes: async (org: string) => { sweeps.push(org); prisma._stuck.status = "published"; return { recovered: 1, due: 1, published: 1, rescheduled: 0, failed: 0, blocked: 0 }; } };
    const svc = new AdminService(prisma, mkAudit(logs), undefined, undefined, publish as any, undefined);
    const out: any = await svc.socialOpsRecoverStuck(SUPER, "post-2", REASON);
    expect(sweeps).toEqual(["org-1"]);
    expect(out.sweep.recovered).toBe(1);
    expect(out.postStatusAfter).toBe("published");
    await expect(svc.socialOpsRecoverStuck(SUPER, "post-1", REASON)).rejects.toThrow(/Publishing অবস্থায় নেই/);
    expect(sweeps).toEqual(["org-1"]); // the refused call never reached the sweep
  });

  it("error account delegates to checkAccountHealth; ad account delegates by platform", async () => {
    const logs: any[] = [];
    const health = { checkAccountHealth: async (org: string, actor: string, id: string) => ({ ok: true, status: "connected", org, actor, id }) };
    const adsCalls: any[] = [];
    const ads = {
      syncMetaInsights: async (...a: any[]) => { adsCalls.push(["meta", ...a]); return { synced: 3 }; },
      syncGoogleInsights: async (...a: any[]) => { adsCalls.push(["google", ...a]); return { synced: 1 }; },
      syncTikTokInsights: async (...a: any[]) => { adsCalls.push(["tiktok", ...a]); return { synced: 1 }; },
    };
    const svc = new AdminService(opsPrisma(), mkAudit(logs), undefined, health as any, undefined, ads as any);
    const recheck: any = await svc.socialOpsRecheckAccount(SUPER, "sacc-1", REASON);
    expect(recheck.result).toEqual({ ok: true, status: "connected", org: "org-1", actor: "admin-1", id: "sacc-1" });
    const sync: any = await svc.socialOpsRetryAdSync(SUPER, "ad-1", REASON);
    expect(sync.platform).toBe("meta");
    expect(adsCalls).toEqual([["meta", "org-1", "admin-1", "ad-1", {}]]);
    await expect(svc.socialOpsRetryAdSync(SUPER, "ad-2", REASON)).rejects.toThrow(/কোনো insights sync পথ নেই/);
  });

  it("missing reason refuses before delegation; unwired service refuses honestly", async () => {
    let called = false;
    const health = { retryPost: async () => { called = true; } };
    const svc = new AdminService(opsPrisma(), mkAudit(), undefined, health as any, undefined, undefined);
    await expect(svc.socialOpsRetryPost(SUPER, "post-1", "")).rejects.toThrow(/reason is required/i);
    expect(called).toBe(false);
    const bare = new AdminService(opsPrisma(), mkAudit());
    await expect(bare.socialOpsRetryPost(SUPER, "post-1", REASON)).rejects.toThrow(/উপলব্ধ নয়/);
    await expect(bare.socialOpsRetryPost(SUPER, "nope", REASON)).rejects.toThrow(/উপলব্ধ নয়/);
  });
});

// ---------------- AN14(a): plan limits clear-to-default ----------------

function settingsPrisma(initial: Record<string, unknown>) {
  const settings = new Map<string, unknown>(Object.entries(initial));
  return {
    _settings: settings,
    systemSetting: {
      findUnique: async ({ where }: any) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: async ({ where, create, update }: any) => { const value = update?.value ?? create?.value; settings.set(where.key, value); return { key: where.key, value }; },
    },
  } as any;
}

describe("AB3 AN14(a) — clearPlanLimits", () => {
  it("removes only that tier's entry — it resolves to code defaults again, others untouched, audited", async () => {
    const logs: any[] = [];
    const prisma = settingsPrisma({ planLimits: { GROWTH: { aiDaily: 999 }, FREE: { seats: 9 } } });
    const svc = new AdminService(prisma, mkAudit(logs));
    const out: any = await svc.clearPlanLimits(SUPER, "GROWTH", REASON);
    expect(out.cleared).toBe(true);
    expect(prisma._settings.get("planLimits")).toEqual({ FREE: { seats: 9 } });
    const resolved = await planLimits(prisma);
    expect(resolved.GROWTH).toEqual(DEFAULT_PLAN_LIMITS.GROWTH);
    expect(resolved.FREE.seats).toBe(9);
    const audit = logs.find((l) => l.action === "admin.plan_limits_cleared");
    expect(audit.metadata.before).toEqual({ aiDaily: 999 });
    expect(audit.metadata.after).toBeNull();
    expect(audit.metadata.tier).toBe("GROWTH");
  });

  it("a tier with no stored entry is a reported no-op — nothing is mutated", async () => {
    const logs: any[] = [];
    const prisma = settingsPrisma({ planLimits: { FREE: { seats: 9 } } });
    const svc = new AdminService(prisma, mkAudit(logs));
    const out: any = await svc.clearPlanLimits(SUPER, "AGENCY", REASON);
    expect(out.cleared).toBe(false);
    expect(out.note).toContain("Code Default");
    expect(prisma._settings.get("planLimits")).toEqual({ FREE: { seats: 9 } });
    expect(logs.some((l) => l.action === "admin.plan_limits_clear_noop")).toBe(true);
  });

  it("unknown tier and missing reason are refused, store unchanged", async () => {
    const prisma = settingsPrisma({ planLimits: { GROWTH: { aiDaily: 1 } } });
    const svc = new AdminService(prisma, mkAudit());
    await expect(svc.clearPlanLimits(SUPER, "PRO", REASON)).rejects.toThrow(/Unknown plan tier/);
    await expect(svc.clearPlanLimits(SUPER, "GROWTH", "")).rejects.toThrow(/reason is required/i);
    expect(prisma._settings.get("planLimits")).toEqual({ GROWTH: { aiDaily: 1 } });
  });
});

// ---------------- Tiers ----------------

describe("AB3 — route tiers", () => {
  const reflector = new Reflector();
  it("queue actions and plan-limits clear are SUPER-only", () => {
    for (const h of ["queuePause", "queueResume", "queueRetryFailed", "clearPlanLimits"] as const) {
      expect(reflector.get(ADMIN_TIER_KEY, (AdminController.prototype as any)[h])).toEqual(["SUPER"]);
    }
  });
  it("social/ads operator retries match health/retry's SUPER+SUPPORT tier", () => {
    for (const h of ["socialOpsRetryPost", "socialOpsRecoverStuck", "socialOpsRecheckAccount", "socialOpsRetryAdSync"] as const) {
      expect(reflector.get(ADMIN_TIER_KEY, (AdminController.prototype as any)[h])).toEqual(["SUPER", "SUPPORT"]);
    }
  });
});
