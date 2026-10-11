# Worker Completion — Acceptance (WK1–WK3)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/worker-completion-plan.md`.

## WK1 — Dead queues retired (dd61e45)
sync-store, sync-ads, aggregate-daily, ai-report and
competitor-scan are gone from QUEUES and the worker
loop. A repo-wide audit had confirmed no producer
existed for any of them — all that work runs as
ScheduledJob types through the M57 path. The loop
now THROWS if a queue lacks a registered processor:
a queue ships only with its producer + processor,
in the same change.

## WK2 — Hardening (8bfcb61)
- Graceful shutdown on SIGTERM/SIGINT: BullMQ
  workers close (in-flight jobs drain), then
  QueueEvents, the health server and Redis; a 55s
  watchdog forces exit, and compose grants
  stop_grace_period 60s to match.
- Health endpoint on WORKER_HEALTH_PORT (4100):
  GET /health → {status, queues, redis,
  secretConfigured, uptimeSec}; Redis failure →
  503 degraded. Compose healthcheck wired to it.
- Redis connection errors are logged as they
  happen.

## WK3 — Live proof
- Worker vitest 13/13 (4 files) incl. the new
  health-snapshot and queue-retirement suites.
- Real run in the sandbox (API + Redis + worker):
  the banner lists ONLY scheduled-jobs + webhook;
  /health answered ok with the true queue list;
  a lead_followup_sweep job created via the API
  returned {queued:true} and the worker executed
  it end-to-end (result {candidates:0, notified:0}
  — the fixture org has no leads); SIGTERM then
  produced "draining in-flight jobs…" →
  "shutdown complete" and a clean exit.

## Note
The worker's two live queues were already real
(M57/M63). This package removed the fiction around
them and made the process observable and drainable;
no execution semantics changed.
