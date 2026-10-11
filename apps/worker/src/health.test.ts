import { describe, it, expect } from "vitest";
import { healthSnapshot } from "./health";

/** WK2: the health snapshot tells the truth about Redis. */
describe("worker health snapshot", () => {
  const base = { queues: ["scheduled-jobs", "webhook"], secretConfigured: true, startedAt: Date.now() - 65000 };

  it("reports ok when Redis answers PONG", async () => {
    const snap = await healthSnapshot({ ...base, ping: async () => "PONG" });
    expect(snap.status).toBe("ok");
    expect(snap.httpCode).toBe(200);
    expect(snap.body).toMatchObject({ status: "ok", service: "worker", redis: "ok", secretConfigured: true });
    expect((snap.body as any).queues).toEqual(["scheduled-jobs", "webhook"]);
    expect((snap.body as any).uptimeSec).toBeGreaterThanOrEqual(65);
  });

  it("reports degraded (503) when Redis errors or answers wrong", async () => {
    const err = await healthSnapshot({ ...base, ping: async () => { throw new Error("ECONNREFUSED"); } });
    expect(err.status).toBe("degraded");
    expect(err.httpCode).toBe(503);
    expect((err.body as any).redis).toBe("error");
    const wrong = await healthSnapshot({ ...base, ping: async () => "HELLO" });
    expect(wrong.status).toBe("degraded");
  });

  it("surfaces a missing internal secret", async () => {
    const snap = await healthSnapshot({ ...base, secretConfigured: false, ping: async () => "PONG" });
    expect((snap.body as any).secretConfigured).toBe(false);
  });
});
