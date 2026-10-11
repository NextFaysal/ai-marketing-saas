# Worker Completion Package — Plan (WK1–WK3)

Written 2026-10-11 after a code audit. The GitHub
push rule is unchanged (local commits only).

## Audit findings (verified in code)
- `apps/worker` listens on 8 queues. TWO have real
  producer+processor pairs: `scheduled-jobs` (M57 —
  API dispatches, worker executes via the internal
  callback, retries + DLQ) and `webhook` (M63 —
  same pattern). `scheduled-jobs-dlq` is a
  record-only channel whose rows live in the API's
  DeadLetterJob table.
- FIVE queues are dead: `sync-store`, `sync-ads`,
  `aggregate-daily`, `ai-report`, `competitor-scan`.
  A repo-wide search confirms NO producer exists
  for any of them (the only `new Queue(` calls in
  the API are webhook + scheduled-jobs). All of that
  work actually runs as ScheduledJob types through
  the M57 path. Their worker processors log
  "processor not implemented yet" and return
  {skipped} — a lie of omission if a job ever did
  land there, and noise forever.
- The worker has NO graceful shutdown (a Dokploy
  restart SIGKILLs it mid-job; BullMQ would recover
  the job as stalled, but attempts burn), NO health
  endpoint (Dokploy cannot tell a live worker from
  a hung one), and no Redis error surfacing.

## WK1 — Retire the dead queues
- Remove the five names from QUEUES and the
  placeholder branch from the worker loop. The
  header contract becomes: a queue is added ONLY
  together with its producer and processor in the
  same change.
- Historical milestone docs keep their mentions
  (they are history, not configuration).

## WK2 — Worker hardening
- Graceful shutdown: SIGTERM/SIGINT closes every
  BullMQ Worker (in-flight jobs drain), then
  QueueEvents and the Redis connection, exit 0.
  Compose gains `stop_grace_period: 60s` on the
  worker service so the orchestrator waits.
- Health endpoint: node:http on
  WORKER_HEALTH_PORT (default 4100), GET /health →
  {status, queues, redis: ok|error,
  secretConfigured, uptimeSec}. A Redis ping
  failure reports status "degraded" with 503.
  Compose gains a worker healthcheck against it.
- Redis connection errors are logged as they
  happen (connection.on("error")) instead of
  surfacing as opaque crashes.

## WK3 — Live proof
- Worker vitest green (queues/scheduled-jobs/
  webhook suites + new health/shutdown units).
- End-to-end in the sandbox: API + Redis + worker
  up → a due ScheduledJob executes through the
  worker; the worker banner lists ONLY the real
  queues; /health answers ok; SIGTERM during idle
  exits 0 with the drain log line.

## Exclusions
No new queues, no producer rewrites, no change to
the M57/M63 execution or DLQ semantics. The
ScheduledJob system stays the single path for
periodic work.
