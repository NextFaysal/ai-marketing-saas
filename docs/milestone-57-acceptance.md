# Milestone 57 — BullMQ Dedicated Worker + DLQ (Acceptance)

Built 2026-10-11 from `docs/next-level-feature-plan.md` Batch 5
(precondition — Inbox U6's Redis work — completed in Milestone 48).
Schema **104 models** (migration `20261010570000_m57_dlq`:
DeadLetterJob).

## Architecture
The DB `ScheduledJob` system stays the scheduler of record
(tenant UI, run history, nextRunAt). What changes is the
EXECUTION plane:

- **API = dispatcher.** With `REDIS_URL` set, the 60s tick and
  "run now" ENQUEUE due jobs to the BullMQ `scheduled-jobs`
  queue instead of executing inline. The BullMQ jobId is
  deterministic per scheduled run (`sched-<jobId>-<nextRunAt>`),
  so multiple API replicas dispatching the same run collapse
  into one job — the API is no longer pinned to one replica for
  correctness of scheduling. The schedule advances at dispatch;
  outcomes are recorded by the execution callback. If Redis is
  unreachable, dispatch falls back to inline execution — a run
  is never lost to a queue outage. Without `REDIS_URL`,
  behaviour is byte-for-byte the pre-M57 inline mode.
- **Worker = executor.** `apps/worker` (previously placeholder
  processors) now runs a real processor for `scheduled-jobs`
  (concurrency 5): it calls `POST /internal/jobs/execute` on the
  API, which runs the existing `AutomationService.executeJob`
  path and records the run. A failure returns 500 so BullMQ's
  retry policy applies (3 attempts, exponential backoff,
  `JOB_BACKOFF_MS` configurable). The other queues keep their
  placeholders — they have no producers yet.
- **Internal surface.** `POST /internal/jobs/execute` and
  `/internal/jobs/dlq`, guarded by a shared secret header
  (`INTERNAL_JOB_SECRET`, timing-safe compare). Unconfigured
  secret → the surface refuses everything (503). It is `@Public`
  for JWT purposes only; the secret IS the credential.
- **DLQ.** On the final failed attempt the worker reports to
  `/internal/jobs/dlq`; the API parks a `DeadLetterJob` row
  (org, job, type, real error, attempts) + an audit entry.
  Admin Console → System gains a Dead-Letter card: list +
  **Replay** (SUPER/SUPPORT; re-queues in queue mode, runs
  inline otherwise; double-replay refused). The TOTP mutation
  gate applies to replay like any admin change.
- **Deployment.** `docker-compose.dokploy.yml` gains a `worker`
  service (same image) and `REDIS_URL` + `INTERNAL_JOB_SECRET`
  on the api service. The secret joins the Dokploy Environment
  tab list (5 values now).

## Verification
- **API tests: 519 pass (75 suites)** incl. 8 new M57 tests:
  inline mode unchanged without REDIS_URL; queue mode enqueues
  with deterministic jobId + attempts; due-job dispatch advances
  the schedule with the run key; the worker callback records
  success and RE-THROWS failures; DLQ record + replay +
  double-replay refusal; internal surface (unconfigured → 503,
  wrong secret → 403, failure → 500).
- **Worker tests: 5 pass (vitest)** incl. the processor contract
  (success returns the API result; non-final failure throws
  without a DLQ report; final failure reports to the DLQ
  endpoint first; missing payload/secret refuse clearly).
- **LIVE END-TO-END on the sandbox** (real Redis, real worker
  process, real API in queue mode): run-now returned
  `{queued: true, bullJobId}`; the worker executed a
  subscription_sweep job to `lastStatus: success`; an
  email_sync job (no mailbox connected) failed through the real
  execute path ("No connected email integration…"), retried 3×
  and landed in the DLQ with attempts=3; the admin DLQ endpoint
  listed it; replay (after TOTP enrolment — the mutation gate
  correctly refused the unenrolled SUPER first) re-queued it,
  marked the entry replayed, and its second failure created a
  fresh DLQ entry.

## Notes
- Two test ScheduledJobs ("M57 ok/fail test") remain in the
  sandbox org as residue of the live proof.
- Sandbox process lesson re-learned: an earlier API process can
  hold port 4000 invisibly (EADDRINUSE for the new instance);
  verify the listener's PID after every restart.
- Committed locally only; GitHub push waits for the owner's
  explicit instruction (rule of 2026-10-10 22:49 +06).
