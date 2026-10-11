// Queue names are contracts between API (producer) and worker
// (consumer). Do not rename without a migration plan.
//
// Worker Completion WK1 (2026-10-11): five queues that never
// had a producer (sync-store, sync-ads, aggregate-daily,
// ai-report, competitor-scan) were retired. All of that work
// runs as ScheduledJob types through the scheduled-jobs
// queue (M57). RULE: a queue is added ONLY together with its
// producer and its processor, in the same change — never
// ahead of them.
export const QUEUES = {
  WEBHOOK: "webhook",                 // M63: inbound webhooks (API enqueues, worker executes via internal callback)
  SCHEDULED_JOBS: "scheduled-jobs",   // M57: DB ScheduledJob execution (API dispatches, worker executes via internal callback)
  SCHEDULED_JOBS_DLQ: "scheduled-jobs-dlq", // M57: record-only channel (rows live in the API's DeadLetterJob table)
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
