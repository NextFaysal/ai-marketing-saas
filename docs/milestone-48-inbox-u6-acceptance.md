# Milestone 48 (Unified Inbox U6) — Scale, Media & Reliability (Acceptance)

Built 2026-10-10 from `docs/unified-inbox-plan.md` Phase U6 —
the final phase of the Unified Inbox program.
Schema **103 models** (migration `20261010490000_m49_inbox_u6`:
ChannelMessage media pipeline fields, InboxSetting.retentionDays).

## What was built

- **Media pipeline** (`inbox/media-store.ts`): inbound platform
  media is persisted at capture time because Meta media ids/urls
  expire. Two modes from env:
  - **S3 mode** (`MEDIA_S3_BUCKET` + keys, any S3-compatible
    endpoint): SigV4 signing hand-rolled on node:crypto (header
    auth for PUT/GET, query-auth presigned GET urls up to 1h).
  - **Local mode** (default): files under `MEDIA_LOCAL_DIR`,
    served through the existing authenticated proxy.
  `getMessageMedia` is storage-first and opportunistically
  persists on a live fetch; `GET .../messages/:id/media-url`
  returns a signed URL in S3 mode or an honest `{url: null,
  stored}` in local mode. **Media search** (`GET /inbox/media`)
  lists the org's stored/linked media (type filter, contact
  search) with a media-library view in the inbox.
- **Cross-instance realtime (Redis bus)**: `RealtimeService`
  attaches a Redis pub/sub bus when `REDIS_URL` is set (two
  ioredis clients; delivery happens through the subscription so
  every replica renders exactly one copy). Without Redis — or
  if Redis fails — it degrades to the U1 in-process fan-out;
  messaging never depends on realtime. Presence stays
  instance-ephemeral by design.
- **Exports**: per-thread export as JSON or CSV (download with
  the real conversation rows) and an org-wide period export
  (30-day default) that is capped at 500 conversations and
  carries a `truncated` flag so a partial export is never
  mistaken for a complete one.
- **Retention policies**: `InboxSetting.retentionDays` (7–3650,
  null = keep forever) + the `inbox_retention` scheduler job.
  It deletes only CLOSED conversations resolved longer ago than
  the policy (with their messages, notes, drafts and bot
  sessions), never open threads, and writes a summary audit row.
- **Inbox health on the Admin A6 board**: `GET
  /admin/system/inbox-health` + a card on /system — failed
  sends (24h, with the latest error texts), webhook errors
  (24h), per-channel connection states, the unassigned open
  backlog with its oldest age, the stored-media count, and the
  active realtime mode label.

## Verification
- **API tests: 493 pass (72 suites)** incl. 8 new U6 tests:
  local store round-trip + key shape, S3 presigned-URL structure
  (algorithm, expiry, 64-hex signature), S3 PUT request shape
  with a stubbed fetch, cross-instance bus delivery through a
  fake bus pair + local exactly-once delivery, JSON/CSV export
  from real rows, retention deleting only stale closed threads
  (and nothing without a policy), media search org isolation.
- **Live on the sandbox**: the CSV export returned the real
  thread rows correctly quoted; the org export reported
  `truncated: false` with the real conversation; retentionDays
  round-tripped through settings (90); the admin inbox-health
  endpoint returned honest zeros + the local realtime label.
- **Live two-instance Redis proof**: redis-server installed in
  the sandbox; two API instances (ports 4000/4001) both logged
  "Realtime fan-out: Redis bus attached"; a webchat message
  posted to instance A arrived as `message.created` on instance
  B's SSE stream, content included.

## Notes / remaining reality
- No real S3 bucket exists in the sandbox: S3 mode is proven by
  unit tests on the signing construction (canonical request,
  headers, presign structure); a bucket round-trip is an owner
  deployment check (set the MEDIA_S3_* envs).
- The Dokploy compose file still runs one API replica; the bus
  makes >1 replica SAFE for realtime, and REDIS_URL simply
  needs to be set when the deployment scales out. Redis itself
  is already part of the compose stack.
- This completes the Unified Inbox program (U1–U6).
- Committed locally only; GitHub push waits for the owner's
  explicit instruction (rule of 2026-10-10 22:49 +06).
