import { Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { QUEUES } from "./queues";

// Milestone 1: worker boots, connects to Redis and registers placeholder
// processors that only log. Real processors land with their phases and must
// be idempotent (jobs can be retried).
const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });

for (const name of Object.values(QUEUES)) {
  const worker = new Worker(name, async (job) => {
    console.log(`[${name}] received job ${job.name} (${job.id}) - processor not implemented yet`);
    return { skipped: true, reason: "processor arrives in its phase" };
  }, { connection });
  worker.on("failed", (job, err) => console.error(`[${name}] job ${job?.id} failed`, err));
  new QueueEvents(name, { connection });
}
console.log(`Worker ready. Listening on queues: ${Object.values(QUEUES).join(", ")}`);
