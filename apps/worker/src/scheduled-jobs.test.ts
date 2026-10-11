import { describe, expect, it, vi } from "vitest";
import { createScheduledJobsProcessor } from "./scheduled-jobs";

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

describe("scheduled-jobs processor (M57)", () => {
  it("executes through the API callback and returns its result", async () => {
    const { fetchFn, calls } = fakeFetch([{ ok: true, json: { ok: true, summary: "done" } }]);
    const processor = createScheduledJobsProcessor({ apiBase: "http://api:4000", secret: "s3cret", fetchFn, log: () => undefined });
    const out = await processor({ data: { scheduledJobId: "job-1" }, attemptsMade: 0, opts: { attempts: 3 } });
    expect(out).toMatchObject({ ok: true });
    expect(calls[0].url).toBe("http://api:4000/internal/jobs/execute");
    expect(calls[0].body).toEqual({ scheduledJobId: "job-1" });
    expect(calls).toHaveLength(1); // no DLQ report on success
  });

  it("a non-final failure throws WITHOUT dead-lettering", async () => {
    const { fetchFn, calls } = fakeFetch([{ ok: false, status: 500, text: "boom" }]);
    const processor = createScheduledJobsProcessor({ apiBase: "http://api:4000", secret: "s3cret", fetchFn, log: () => undefined });
    await expect(processor({ data: { scheduledJobId: "job-1" }, attemptsMade: 0, opts: { attempts: 3 } })).rejects.toThrow(/500/);
    expect(calls).toHaveLength(1);
  });

  it("the final failure reports to the DLQ endpoint before throwing", async () => {
    const { fetchFn, calls } = fakeFetch([
      { ok: false, status: 500, text: "boom" },
      { ok: true, json: { ok: true, id: "dlq-1" } },
    ]);
    const processor = createScheduledJobsProcessor({ apiBase: "http://api:4000", secret: "s3cret", fetchFn, log: () => undefined });
    await expect(processor({ data: { scheduledJobId: "job-9" }, attemptsMade: 2, opts: { attempts: 3 } })).rejects.toThrow(/500/);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe("http://api:4000/internal/jobs/dlq");
    expect(calls[1].body).toMatchObject({ scheduledJobId: "job-9", attempts: 3 });
  });

  it("refuses clearly when the payload or secret is missing", async () => {
    const { fetchFn } = fakeFetch([{ ok: true, json: {} }]);
    const processor = createScheduledJobsProcessor({ apiBase: "http://api:4000", secret: "s3cret", fetchFn, log: () => undefined });
    await expect(processor({ data: {}, attemptsMade: 0 })).rejects.toThrow(/scheduledJobId/);
    const noSecret = createScheduledJobsProcessor({ apiBase: "http://api:4000", secret: "", fetchFn, log: () => undefined });
    await expect(noSecret({ data: { scheduledJobId: "j" }, attemptsMade: 0 })).rejects.toThrow(/INTERNAL_JOB_SECRET/);
  });
});
