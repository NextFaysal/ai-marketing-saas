import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { MemoryWindowStore, ThrottlerGuard, rateLimitStats } from "./throttler.guard";

/**
 * Milestone 61: fixed-window limiting per route class, skip
 * rules, and env overrides. Redis is not configured in tests,
 * so the in-memory path is what runs.
 */
function ctx(path: string, method = "POST", ip = "1.2.3.4") {
  const headers: Record<string, string> = {};
  const req: any = { path, url: path, method, headers: {}, ip, socket: { remoteAddress: ip } };
  const res: any = { setHeader: (k: string, v: string) => { headers[k] = v; } };
  return {
    context: {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext,
    headers,
  };
}
const guard = () => new ThrottlerGuard(new Reflector());

describe("M61 throttler", () => {
  it("memory store counts within a window and resets after it", () => {
    const store = new MemoryWindowStore();
    expect(store.hit("k", 60).count).toBe(1);
    expect(store.hit("k", 60).count).toBe(2);
    expect(store.hit("other", 60).count).toBe(1);
  });

  it("auth class blocks after 10 hits per minute per IP", async () => {
    const g = guard();
    for (let i = 0; i < 10; i++) {
      await expect(g.canActivate(ctx("/auth/login").context)).resolves.toBe(true);
    }
    await expect(g.canActivate(ctx("/auth/login").context)).rejects.toMatchObject({ status: 429 });
    // A different IP is unaffected.
    await expect(g.canActivate(ctx("/auth/login", "POST", "9.9.9.9").context)).resolves.toBe(true);
    expect(rateLimitStats.snapshot().blockedTotal).toBeGreaterThanOrEqual(1);
  });

  it("health, admin, internal and SSE paths are never throttled", async () => {
    const g = guard();
    for (const p of ["/health", "/admin/system/version", "/internal/jobs/execute"]) {
      await expect(g.canActivate(ctx(p).context)).resolves.toBe(true);
    }
    await expect(g.canActivate(ctx("/organizations/o/inbox/conversations/stream", "GET").context)).resolves.toBe(true);
  });

  it("public chat writes have their own (larger) class budget", async () => {
    const g = guard();
    // 30 allowed for public-write; the 31st blocks. Distinct IP to isolate.
    for (let i = 0; i < 30; i++) {
      await expect(g.canActivate(ctx("/public/chat/abc/messages", "POST", "5.5.5.5").context)).resolves.toBe(true);
    }
    await expect(g.canActivate(ctx("/public/chat/abc/messages", "POST", "5.5.5.5").context)).rejects.toMatchObject({ status: 429 });
  });

  it("an env override tightens a class (RATE_LIMIT_AUTH)", async () => {
    process.env.RATE_LIMIT_AUTH = "2/60";
    try {
      const g = guard();
      await expect(g.canActivate(ctx("/auth/register", "POST", "7.7.7.7").context)).resolves.toBe(true);
      await expect(g.canActivate(ctx("/auth/register", "POST", "7.7.7.7").context)).resolves.toBe(true);
      await expect(g.canActivate(ctx("/auth/register", "POST", "7.7.7.7").context)).rejects.toMatchObject({ status: 429 });
    } finally {
      delete process.env.RATE_LIMIT_AUTH;
    }
  });

  it("RATE_LIMIT_DISABLED turns the shield off", async () => {
    process.env.RATE_LIMIT_DISABLED = "true";
    try {
      const g = guard();
      for (let i = 0; i < 15; i++) {
        await expect(g.canActivate(ctx("/auth/login", "POST", "8.8.8.8").context)).resolves.toBe(true);
      }
    } finally {
      delete process.env.RATE_LIMIT_DISABLED;
    }
  });
});
