import { Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { QUEUES } from "./queues";
import { createScheduledJobsProcessor } from "./scheduled-jobs";
import { createWebhookProcessor } from "./webhook";
import { startHealthServer } from "./health";

// The worker connects to Redis and executes queued work.
// Every queue listed in QUEUES has a REAL producer and a
// REAL processor (WK1 retired the five producer-less
// queues whose processors only logged "not implemented"):
//   scheduled-jobs (M57) — DB ScheduledJobs, executed via
//     the API's internal callback, retries + DLQ included.
//   webhook (M63) — inbound provider webhooks, same path.
// Processors must be idempotent (jobs can be retried).
const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
connection.on("error", (err) => console.error("[redis] connection error:", err instanceof Error ? err.message : err));

const apiBase = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
const internalSecret = process.env.INTERNAL_JOB_SECRET ?? "";

const processors: Record<string, (job: any) => Promise<unknown>> = {
  [QUEUES.SCHEDULED_JOBS]: createScheduledJobsProcessor({ apiBase, secret: internalSecret }) as any,
  [QUEUES.WEBHOOK]: createWebhookProcessor({ apiBase, secret: internalSecret }) as any,
};

export const workers: Worker[] = [];
export const queueEvents: QueueEvents[] = [];
for (const name of Object.values(QUEUES)) {
  if (name === QUEUES.SCHEDULED_JOBS_DLQ) continue; // record-only channel (rows live in the API's DeadLetterJob table)
  const processor = processors[name];
  if (!processor) throw new Error(`No processor registered for queue ${name} — a queue ships only with its processor (WK1 rule)`);
  const worker = new Worker(name, processor as any, { connection, concurrency: 5 });
  worker.on("failed", (job, err) => console.error(`[${name}] job ${job?.id} failed`, err));
  workers.push(worker);
  queueEvents.push(new QueueEvents(name, { connection }));
}
console.log(`Worker ready. Listening on queues: ${Object.keys(processors).join(", ")}`);
if (!internalSecret) {
  console.warn("INTERNAL_JOB_SECRET is not set — scheduled-jobs executions will be refused by the API until it is configured on both sides.");
}

// WK2: health endpoint (default :4100) so the orchestrator
// can tell a live worker from a hung one.
const startedAt = Date.now();
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 4100);
const healthServer = startHealthServer(healthPort, {
  ping: () => connection.ping(),
  queues: Object.keys(processors),
  secretConfigured: Boolean(internalSecret),
  startedAt,
});

// WK2: graceful shutdown. BullMQ Worker.close() waits for
// in-flight jobs to finish, so a redeploy no longer burns a
// job's attempts to a mid-flight SIGKILL. The compose file
// grants stop_grace_period 60s; the watchdog below forces
// an exit at 55s so the container never hangs past it.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received — draining in-flight jobs…`);
  const watchdog = setTimeout(() => { console.error("[worker] drain exceeded 55s — forcing exit"); process.exit(1); }, 55000);
  watchdog.unref();
  try {
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(queueEvents.map((q) => q.close()));
    healthServer.close();
    await connection.quit();
    clearTimeout(watchdog);
    console.log("[worker] shutdown complete");
    process.exit(0);
  } catch (err) {
    console.error("[worker] shutdown failed", err);
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
