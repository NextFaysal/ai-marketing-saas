import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";

/**
 * Milestone 63 — webhook dispatch to the BullMQ "webhook"
 * queue (the queue name is the M1-era contract in
 * apps/worker/src/queues.ts).
 *
 * Webhook controllers verify NOTHING twice: in queue mode the
 * raw request (exact body bytes + the signature headers) is
 * enqueued and the API answers the provider immediately; the
 * worker calls back into POST /internal/webhooks/process,
 * which runs the EXISTING handler — verification included —
 * unchanged. Handler-level dedupe (delivery ids, message
 * unique keys) makes BullMQ retries safe.
 *
 * Without REDIS_URL (or if enqueueing fails) `enqueue`
 * returns false and the caller processes inline exactly as
 * before — a webhook is never dropped because Redis hiccuped.
 */
export interface WebhookJob {
  source: "meta" | "shopify" | "telegram" | "woocommerce";
  integrationId: string;
  rawBody?: string;
  headers?: Record<string, string | undefined>;
  /** telegram: the parsed update + the echoed secret header. */
  update?: unknown;
  secret?: string;
  /** woocommerce: the WebhookEvent row created synchronously
   * (signature + delivery dedupe already done at the edge). */
  eventId?: string;
}

const MAX_QUEUED_BODY_BYTES = 1024 * 1024;

export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);
  private queue: any = null;
  private failed = false;

  constructor(private readonly queueFactory?: () => Promise<any>) {}

  enabled(): boolean {
    return (Boolean(process.env.REDIS_URL) || Boolean(this.queueFactory)) && !this.failed;
  }

  private async getQueue(): Promise<any> {
    if (this.queueFactory) return this.queueFactory();
    if (this.queue) return this.queue;
    const { Queue } = await import("bullmq");
    const { default: Redis } = await import("ioredis");
    const connection = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
    this.queue = new Queue("webhook", { connection });
    return this.queue;
  }

  /** True when the job was queued (caller answers immediately). */
  async enqueue(job: WebhookJob): Promise<boolean> {
    if (!this.enabled()) return false;
    if (job.rawBody && Buffer.byteLength(job.rawBody, "utf8") > MAX_QUEUED_BODY_BYTES) {
      this.logger.warn(`Webhook body too large to queue (${job.source}); processing inline`);
      return false;
    }
    try {
      const queue = await this.getQueue();
      const backoffMs = Number(process.env.JOB_BACKOFF_MS ?? 15000);
      await queue.add("process", job, {
        jobId: `wh-${randomUUID()}`,
        attempts: 3,
        backoff: { type: "exponential", delay: backoffMs },
        removeOnComplete: 500,
        removeOnFail: false,
      });
      return true;
    } catch (e) {
      this.failed = true;
      this.logger.warn(`Webhook enqueue failed, falling back to inline: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }
}

/** Shared dispatcher for the API process. */
export const webhookDispatcher = new WebhookDispatcher();
