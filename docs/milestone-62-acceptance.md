# Milestone 62 — Multi-Replica Correctness Closeout (Acceptance)

Built 2026-10-11 from `docs/platform-hardening-plan.md`.
**No schema change.**

## The gaps found (audit)
Three periodic, side-effecting loops ran inside EVERY API
process, so N replicas meant N executions:
1. `AutomationService.tick` — the hourly automation-rule
   evaluation (rules can pause campaigns / send alerts).
2. `WorkflowsService` 5-minute scan — `scanUnanswered`
   fires inbox_unanswered workflows (duplicate sends).
3. `WorkflowsService.resumeRuns` — wait-step resumes were
   picked up by every scanner with no claim (duplicate
   step execution).
(Job dispatch was already deduped in M57 via deterministic
BullMQ job ids; realtime fan-out in U6; throttler counters
in M61.)

## What was built
- **`LeaderClaim`** (`common/leader-claim.ts`): Redis
  `SET leader:<key> <instanceId> NX EX <ttl>` — the atomic
  test-and-set is the claim. Semantics chosen deliberately:
  a configured-but-unreachable Redis yields NO claim (one
  skipped round beats double-fired side effects); without
  `REDIS_URL` the claim always succeeds (single-instance
  deployments, the documented posture).
- Rule evaluation is gated per round (key `rule-evaluation`,
  TTL = the evaluation interval, env-tunable via
  `RULE_EVAL_INTERVAL_MS`); the workflow scan cycle is gated
  (key `workflow-scan`, TTL 270s). Losers log one line and
  skip the round.
- `resumeRuns` additionally claims EACH run atomically
  (`updateMany` status waiting → resuming): only the winner
  executes steps. The listing now also returns `resuming`
  rows so a run orphaned by a crashed claimer (>15 min) is
  reclaimed instead of being stuck forever.
- Deployment doc's stale scaling notes corrected: worker
  service present since M57; replicas are safe WITH
  REDIS_URL; the one documented per-instance exception is
  realtime presence (DB AgentPresence remains the shared
  record).

## Verification
- **API tests: 591 pass (85 suites)** incl. 5 new M62 tests:
  two LeaderClaim instances over a fake Redis — exactly one
  wins; Redis failure → no claim; no-Redis → always claim;
  two WorkflowsService instances over one fake DB resume a
  run exactly once; stale resuming reclaimed, fresh resuming
  untouched. (The M15 engine spec's fake table gained a
  faithful `updateMany` + OR matching to model the client.)
- **Live two-instance proof**: two API processes with
  REDIS_URL + a 12s evaluation interval — instance A logged
  "Rule evaluation skipped: another instance holds the
  leader claim" (1×), instance B evaluated (0 skips), and
  `leader:rule-evaluation` was present in Redis with the
  winner's instance id.

## Notes
- Committed locally only; GitHub push waits for the owner's
  explicit instruction (rule of 2026-10-10 22:49 +06).
