# Milestone 63 — Webhook Async Processing (Acceptance)

Built 2026-10-11 from `docs/platform-hardening-plan.md`.
**No schema change.** The BullMQ `webhook` queue (an M1-era
contract name) gains a real producer + processor.

## Design
- **Edge (API):** each webhook controller (Meta, Shopify,
  Telegram, WooCommerce) first tries
  `webhookDispatcher.enqueue(...)`. With REDIS_URL set the
  provider is answered immediately (`{queued: true}`); the
  raw request — exact body bytes + signature headers — is the
  job payload. Without Redis, or if enqueueing fails, or the
  body exceeds 1MB, processing falls back to the existing
  inline path. A webhook is never dropped because Redis
  hiccuped.
- **WooCommerce keeps its synchronous half**: HMAC
  verification, delivery-id dedupe and the WebhookEvent row
  stay at the edge (cheap, and they shape the response);
  only the upsert half moves — relocated into
  `IntegrationsService.processWooWebhookEvent`, shared by
  both paths.
- **Worker:** a real `webhook` processor calls back into
  `POST /internal/webhooks/process` (M57 secret surface),
  which runs the EXISTING handler for the source —
  verification included, byte-identical semantics.
- **Failure classification:** permanent failures (signature /
  secret / unknown integration / any handler 4xx) return
  **422** → the worker throws BullMQ's `UnrecoverableError`
  (no retries, no DLQ noise). Transient failures return 500
  → 3 attempts with backoff → the M57 DLQ (parked under the
  label `webhook:<source>:<integrationId>`, jobType
  `webhook_<source>`).

## Bug found by the live test (fixed + regression spec)
The first live forged-secret test retried 3 times: Telegram's
handler raises Nest's `BadRequestException` (400), which the
classifier initially let pass through unclassified.
Classification now treats any handler 4xx as permanent.

## Verification
- **API tests: 598 pass (86 suites)** incl. 8 new M63 tests
  (dispatcher inline fallback / enqueue shape / oversized
  body; re-entry delegation for meta + woocommerce +
  telegram; 422 vs 500 classification incl. the 4xx case).
  **Worker vitest: 9 pass** (4 new webhook tests).
- **Live end-to-end** (queue mode, real worker + Redis): a
  Telegram update was acked in **0.13s** with
  `{queued: true}`; the worker processed it and the message
  landed in the unified inbox (conversation "M63 Tester",
  channel telegram) via the unchanged handler. A forged
  secret then failed **exactly once** as a permanent error
  (after the fix) and created no conversation.

## Notes
- In queue mode, signature verification happens in the
  worker-path handler (seconds later) rather than at the
  edge — forged traffic costs a bounded queue slot (M61's
  callback rate class still applies at the edge) and dies
  permanently on first processing. This trade is deliberate
  and matches how the handlers were already written (they
  verify internally).
- The Telegram secret header travels inside the job payload
  (Redis is inside the deployment's private network, the
  same trust domain as the database) because the handler's
  timing-safe check needs it.
- Committed locally only; GitHub push waits for the owner's
  explicit instruction (rule of 2026-10-10 22:49 +06).
