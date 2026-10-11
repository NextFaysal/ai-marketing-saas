import { UnrecoverableError } from "bullmq";

/**
 * Milestone 63 — the webhook processor.
 *
 * The API enqueues raw webhook requests (exact body bytes +
 * signature headers); this worker calls back into
 * POST /internal/webhooks/process, which verifies and runs
 * the existing handler. Response mapping:
 *   200        -> done (the body says what the handler did)
 *   422        -> PERMANENT failure (bad signature, unknown
 *                 integration): UnrecoverableError, no retries
 *   anything else / network -> throw, BullMQ retries apply;
 *                 the final attempt reports to the DLQ endpoint
 *                 (parked under the label webhook:<source>)
 */
export interface WebhookJobLike {
  data?: {
    source?: string; integrationId?: string;
    [key: string]: unknown;
  };
  attemptsMade: number;
  opts?: { attempts?: number };
}

export interface WebhookProcessorDeps {
  apiBase: string;
  secret: string;
  fetchFn?: typeof fetch;
  log?: (message: string) => void;
}

export function createWebhookProcessor(deps: WebhookProcessorDeps) {
  const fetchFn = deps.fetchFn ?? fetch;
  const log = deps.log ?? ((m: string) => console.log(m));
  const headers = () => ({
    "content-type": "application/json",
    "x-internal-secret": deps.secret,
  });

  return async (job: WebhookJobLike) => {
    const data = job.data ?? {};
    const source = data.source ?? "unknown";
    if (!data.integrationId) throw new UnrecoverableError("webhook payload is missing integrationId");
    if (!deps.secret) throw new Error("INTERNAL_JOB_SECRET is not configured on the worker");

    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetchFn(`${deps.apiBase}/internal/webhooks/process`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(data),
      });
    } catch (e) {
      throw new Error(`API webhook callback unreachable: ${e instanceof Error ? e.message : e}`);
    }
    if (res.ok) {
      const out = await res.json().catch(() => ({ ok: true }));
      log(`[webhook] ${source}/${data.integrationId} processed`);
      return out;
    }
    const bodyText = await res.text().catch(() => "");
    if (res.status === 422) {
      throw new UnrecoverableError(`Permanent webhook failure (${source}): ${bodyText.slice(0, 300)}`);
    }
    const error = `API webhook process failed (${res.status}): ${bodyText.slice(0, 300)}`;
    const attemptsAllowed = job.opts?.attempts ?? 1;
    if (job.attemptsMade + 1 >= attemptsAllowed) {
      await fetchFn(`${deps.apiBase}/internal/jobs/dlq`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          scheduledJobId: `webhook:${source}:${data.integrationId}`,
          jobType: `webhook_${source}`,
          error,
          attempts: job.attemptsMade + 1,
        }),
      }).catch((e) => log(`[webhook] DLQ report failed: ${e instanceof Error ? e.message : e}`));
      log(`[webhook] ${source}/${data.integrationId} dead-lettered after ${job.attemptsMade + 1} attempts`);
    }
    throw new Error(error);
  };
}
