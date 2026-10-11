# Admin Advanced AA2 — Worker + BullMQ Live View: Acceptance

**Status:** Delivered (local commit; not pushed). Plan: `docs/admin-advanced-plan.md` (audit ref C2).

## The problem

Until AA2 the console showed only **downstream symptoms** of a dead worker (due jobs accumulating, webhooks silently falling back to inline processing). The worker process itself — alive? hung? Redis down? job secret set? how deep are the queues? — was invisible.

## Data-source decision (where the numbers truly come from)

Two real sources, no fabrication:

1. **Liveness = the worker's own `/health` payload (WK2), passed through verbatim.** The worker already exposes `{ status, service, queues, redis, secretConfigured, uptimeSec }` on `WORKER_HEALTH_PORT` (4100), wired into the compose healthcheck — but no admin code had ever called it. `GET /admin/system/queues` now includes `worker: { reachable, healthUrl, checkedAt, health? | error? }`. A live-but-degraded worker answers HTTP 503 **with** its payload; that counts as reachable, and the payload itself says `degraded`.
2. **Queue depths = BullMQ `getJobCounts` read by the API directly from Redis.** The worker health payload carries **no counts**, so depths could not come from the worker without inventing them. The API already depends on `bullmq` + `ioredis` and holds Queue handles for exactly the two queues that exist — `scheduled-jobs` (AutomationService producer) and `webhook` (WebhookDispatcher producer) — so the API reads `waiting/active/delayed/failed/completed/paused` from the same Redis data BullMQ maintains. Queues are limited to these two by the WK1 rule (a queue ships only with producer + processor). **No worker-side change was needed.**

Probe configuration: `WORKER_HEALTH_URL` env on the API, default `http://worker:4100/health` (the compose service name + WK2 port); `docker-compose.dokploy.yml` now sets it explicitly on the api service.

## Transport note (a real environment lesson)

The probe deliberately uses **node:http(s), not fetch**: the target is an internal service address and must never be routed through `HTTP(S)_PROXY` variables a host may export. During development, a proxied `fetch` toward the unresolvable sandbox name aborted on timeout but left the underlying socket hanging (the process would not exit); `node:http` with `agent: false` and a hard 2s timeout + `destroy()` fails in ~60ms and tears the socket fully down. Timeout discipline overall: worker probe ~2s, Redis counts raced against 3s; **neither probe can fail or hang the endpoint** — `systemQueues` still returns all its DB-table counts with the worker/bullmq sections reporting their own failure.

## UI

Admin → System → Queue Monitor card gains a "🛠 Worker Process (AA2)" section: reachable/degraded badge, uptime, Redis state, job-secret-configured state (the INTERNAL_JOB_SECRET blind spot from AA1, visible from the worker's side too), the worker's queue list, probe time; below it the BullMQ depth table per queue (failed counts highlighted). Unreachable renders a red panel with the sanitized reason plus the probe URL and the operator hint (check the worker service in Dokploy). When Redis is unset, the panel says plainly that dispatch is off and jobs run inline.

## Evidence

- New spec `apps/api/src/admin/aa2-worker.spec.ts` — 7 tests, all passing: payload pass-through verbatim, `WORKER_HEALTH_URL` override, degraded-503-with-body reachable, unreachable → reason surfaced + `systemQueues` DB counts intact, non-JSON answer never fabricated into "ok", no-REDIS_URL honest `available:false`, `getJobCounts` mapping for both queues, Redis failure → `available:false` with verbatim error.
- Regression: `m42.spec.ts` (which calls `systemQueues()` unstubbed) passes and now completes in seconds instead of hanging on the probe.
- **Ceiling, stated plainly:** the sandbox has no Redis, no running worker, and no Postgres — depths are proven against fake Queue handles returning fixture counts, the health pass-through against a stubbed transport, and the real transport only against the sandbox's failing name resolution (fast failure verified). No live worker's real counts were observed here; the first live observation happens on the owner's Dokploy stack after redeploy.

## Not in AA2

- No queue management actions (pause/drain/retry) — read-only visibility only; DLQ replay already existed (M57) and is unchanged.
- The worker `/health` payload was not extended; if per-queue counts are ever wanted from the worker itself, that is a worker change for another package.
