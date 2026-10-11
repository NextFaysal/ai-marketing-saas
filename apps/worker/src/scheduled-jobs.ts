/**
 * Milestone 57 — the scheduled-jobs processor.
 *
 * The API dispatches due ScheduledJob rows to the "scheduled-jobs"
 * BullMQ queue; this worker executes them by calling back into
 * the API's internal surface (POST /internal/jobs/execute) with
 * the shared secret. The API runs the real service logic and
 * records the run; a non-2xx reply fails the BullMQ job so its
 * retry policy applies. When the LAST attempt fails, the job is
 * reported to the API's dead-letter endpoint before throwing.
 */
export interface ScheduledJobLike {
  data?: { scheduledJobId?: string };
  attemptsMade: number;
  opts?: { attempts?: number };
}

export interface ProcessorDeps {
  apiBase: string;
  secret: string;
  fetchFn?: typeof fetch;
  log?: (message: string) => void;
}

export function createScheduledJobsProcessor(deps: ProcessorDeps) {
  const fetchFn = deps.fetchFn ?? fetch;
  const log = deps.log ?? ((m: string) => console.log(m));
  const headers = () => ({
    "content-type": "application/json",
    "x-internal-secret": deps.secret,
  });

  return async (job: ScheduledJobLike) => {
    const scheduledJobId = job.data?.scheduledJobId;
    if (!scheduledJobId) throw new Error("scheduled-jobs payload is missing scheduledJobId");
    if (!deps.secret) throw new Error("INTERNAL_JOB_SECRET is not configured on the worker");

    const res = await fetchFn(`${deps.apiBase}/internal/jobs/execute`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ scheduledJobId }),
    });
    if (res.ok) {
      const out = await res.json().catch(() => ({ ok: true }));
      log(`[scheduled-jobs] ${scheduledJobId} executed: ${(out as any)?.summary ?? "ok"}`);
      return out;
    }
    const bodyText = await res.text().catch(() => "");
    const error = `API execute failed (${res.status}): ${bodyText.slice(0, 300)}`;
    const attemptsAllowed = job.opts?.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade + 1 >= attemptsAllowed;
    if (isFinalAttempt) {
      await fetchFn(`${deps.apiBase}/internal/jobs/dlq`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ scheduledJobId, error, attempts: job.attemptsMade + 1 }),
      }).catch((e) => log(`[scheduled-jobs] DLQ report failed for ${scheduledJobId}: ${e instanceof Error ? e.message : e}`));
      log(`[scheduled-jobs] ${scheduledJobId} dead-lettered after ${job.attemptsMade + 1} attempts`);
    }
    throw new Error(error);
  };
}
