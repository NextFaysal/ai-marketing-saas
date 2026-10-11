import { describe, expect, it, vi } from "vitest";
import { UnrecoverableError } from "bullmq";
import { createWebhookProcessor } from "./webhook";

function fakeFetch(responses: { ok: boolean; status?: number; json?: any; text?: string }[]) {
  const calls: { url: string; body: any }[] = [];
  let i = 0;
  const fetchFn = vi.fn(async (url: string, init: any) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.json ?? {},
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
    };
  });
  return { fetchFn: fetchFn as any, calls };
}
const job = (over: Record<string, unknown> = {}) => ({
  data: { source: "meta", integrationId: "int-1", rawBody: "{}", headers: { signature: "sha256=x" } },
  attemptsMade: 0, opts: { attempts: 3 }, ...over,
});

describe("webhook processor (M63)", () => {
  it("posts the raw job to the internal process endpoint", async () => {
    const { fetchFn, calls } = fakeFetch([{ ok: true, json: { ok: true, stored: 2 } }]);
    const processor = createWebhookProcessor({ apiBase: "http://api:4000", secret: "s", fetchFn, log: () => undefined });
    await expect(processor(job())).resolves.toMatchObject({ ok: true });
    expect(calls[0].url).toBe("http://api:4000/internal/webhooks/process");
    expect(calls[0].body).toMatchObject({ source: "meta", integrationId: "int-1" });
  });

  it("a 422 is permanent: UnrecoverableError, no retries, no DLQ", async () => {
    const { fetchFn, calls } = fakeFetch([{ ok: false, status: 422, text: "bad signature" }]);
    const processor = createWebhookProcessor({ apiBase: "http://api:4000", secret: "s", fetchFn, log: () => undefined });
    await expect(processor(job())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(calls).toHaveLength(1);
  });

  it("a transient failure throws; the final attempt dead-letters with a webhook label", async () => {
    const { fetchFn, calls } = fakeFetch([
      { ok: false, status: 500, text: "db down" },
      { ok: true, json: { ok: true, id: "dlq-9" } },
    ]);
    const processor = createWebhookProcessor({ apiBase: "http://api:4000", secret: "s", fetchFn, log: () => undefined });
    await expect(processor(job({ attemptsMade: 2 }))).rejects.toThrow(/500/);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe("http://api:4000/internal/jobs/dlq");
    expect(calls[1].body).toMatchObject({ scheduledJobId: "webhook:meta:int-1", jobType: "webhook_meta", attempts: 3 });
  });

  it("a missing integrationId is unrecoverable, never retried", async () => {
    const { fetchFn } = fakeFetch([{ ok: true, json: {} }]);
    const processor = createWebhookProcessor({ apiBase: "http://api:4000", secret: "s", fetchFn, log: () => undefined });
    await expect(processor({ data: { source: "meta" }, attemptsMade: 0 })).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
