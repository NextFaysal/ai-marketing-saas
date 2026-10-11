# Milestone 61 — Public-Surface Rate Limiting & Abuse Shield (Acceptance)

Built 2026-10-11 from `docs/platform-hardening-plan.md` (this
track's M61–M66 program, written at the owner's direction to
keep non-colliding work moving while the Next-Level sequence
runs on the other track). **No schema change.**

## What was built
- `ThrottlerGuard` (hand-rolled fixed-window limiter, in the
  codebase's hand-rolled style) registered as an APP_GUARD
  **before** JwtAuthGuard in AppModule, so brute force is
  rejected before any password verification happens.
- Route classes (per IP, per path): `auth` 10/min (login,
  register, reset, TOTP), `public-write` 30/min (public chat),
  `ingest` 300/min (tracking), `callback` 900/min (webhooks +
  payment callbacks — deliberately generous so provider
  retries are never throttled into data loss), `default`
  900/min (authenticated ceiling). Every class is tunable via
  `RATE_LIMIT_<CLASS>=<count>/<windowSeconds>`; a per-route
  `@RateLimit(count, windowSeconds)` decorator overrides the
  class. `RATE_LIMIT_DISABLED=true` turns the shield off.
- Store: Redis INCR+EXPIRE when `REDIS_URL` is set (one shared
  count across API replicas); in-memory otherwise; any store
  failure degrades to memory with a warning — the limiter can
  never take the API down.
- Skipped by design: `/health`, `/internal/*` (shared-secret
  surface), `/admin/*` (SuperAdminGuard + IP allowlist), SSE
  streams (long-lived).
- 429 responses carry `Retry-After` + `X-RateLimit-*` headers.
  Blocked hits are counted in-process and surfaced on the
  Admin A6 version payload (`rateLimits: {blockedTotal,
  topIps}`).

## Verification
- **API tests: 586 pass (83 suites)** incl. 6 new throttler
  tests (window counting/reset, auth-class blocking at 11,
  per-IP isolation, skip rules, env override, kill switch).
  Zero regressions with the guard active globally.
- **Live on the sandbox**: 11 login attempts from one
  (forwarded) IP → ten 401s, then **429 with Retry-After: 59**;
  a different IP immediately after still received a normal
  401. API listener PID verified after restart.

## Notes
- Client IP comes from `X-Forwarded-For` first (the Dokploy/
  proxy deployment terminates client connections upstream),
  falling back to the socket address. If the API is ever
  exposed without a trusted proxy, XFF spoofing could rotate
  identities — the per-class limits still cap any single
  socket's default class by path+IP keying as deployed.
- Committed locally only; GitHub push waits for the owner's
  explicit instruction (rule of 2026-10-10 22:49 +06).
