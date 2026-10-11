import { Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { QUEUES } from "./queues";
import { createScheduledJobsProcessor } from "./scheduled-jobs";
import { createWebhookProcessor } from "./webhook";

// The worker connects to Redis and executes queued work. Since
// Milestone 57 the "scheduled-jobs" queue has a REAL processor:
// it executes the API's ScheduledJob rows via the internal
// callback surface (retries + dead-lettering included). The
// remaining queues still have placeholder processors — they have
// no producers yet, and each lands with its own phase. Processors
// must be idempotent (jobs can be retried).
const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });

const apiBase = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
const internalSecret = process.env.INTERNAL_JOB_SECRET ?? "";

for (const name of Object.values(QUEUES)) {
  if (name === QUEUES.SCHEDULED_JOBS_DLQ) continue; // record-only channel (rows live in the API's DeadLetterJob table)
  const processor = name === QUEUES.SCHEDULED_JOBS
    ? createScheduledJobsProcessor({ apiBase, secret: internalSecret })
    : name === QUEUES.WEBHOOK
      ? createWebhookProcessor({ apiBase, secret: internalSecret })
      : async (job: { name: string; id?: string }) => {
        console.log(`[${name}] received job ${job.name} (${job.id}) - processor not implemented yet`);
        return { skipped: true, reason: "processor arrives in its phase" };
      };
  const worker = new Worker(name, processor as any, { connection, concurrency: name === QUEUES.SCHEDULED_JOBS || name === QUEUES.WEBHOOK ? 5 : 1 });
  worker.on("failed", (job, err) => console.error(`[${name}] job ${job?.id} failed`, err));
  new QueueEvents(name, { connection });
}
console.log(`Worker ready. Listening on queues: ${Object.values(QUEUES).join(", ")}`);
if (!internalSecret) {
  console.warn("INTERNAL_JOB_SECRET is not set — scheduled-jobs executions will be refused by the API until it is configured on both sides.");
}
