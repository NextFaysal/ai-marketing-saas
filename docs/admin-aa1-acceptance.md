# Admin Advanced AA1 — Deploy Readiness Checklist: Acceptance

**Status:** Delivered (local commit; not pushed). Plan: `docs/admin-advanced-plan.md` (audit ref C1).

## What shipped

- **API:** `GET /admin/system/env-check` (SuperAdminGuard, no `@AdminTier` — same read posture as the neighbouring `system/version` and `system/queues` GET routes) → `AdminService.systemEnvCheck()`.
- **UI:** "🚀 Deploy প্রস্তুতি" card at the **top** of Admin → System (`apps/admin/src/app/system/page.tsx`), including a red summary banner when any required item is missing: "⚠️ Nটি বাধ্যতামূলক জিনিস বাকি — deploy/redeploy-এর আগে বসান".

## Env list as implemented

Presence = the variable exists in the API process env as a non-empty string. **Values are never returned, logged, or compared** — a canary spec seeds secret-looking values and scans the serialized response for them.

**API-attestable, required** (a missing one blocks real behaviour):

| Var | Why required |
|---|---|
| `DATABASE_URL` | The API cannot run without it. |
| `JWT_SECRET` | Session signing; missing/changed = everyone logged out. |
| `ENCRYPTION_KEY` | Decrypts every stored credential; must never change after first set. |
| `INTERNAL_JOB_SECRET` | API↔worker job-execution secret — the exact variable whose absence failed the owner's 2026-10-11 Dokploy redeploy. |

**API-attestable, optional-but-consequential:** `REDIS_URL` (without it jobs run inline and the worker idles), `API_PUBLIC_URL` (OAuth callbacks/public links), `PUBLIC_API_URL` (Telegram webhook auto-registration), `WEB_URL` (tenant-app links; compose derives it from APP_DOMAIN), `WORKER_HEALTH_URL` (AA2 probe target override), `ADMIN_IP_ALLOWLIST` (network gate for admin; a console-managed list also exists). Each carries a one-line Bengali consequence hint in the response and UI.

**Compose group — unverifiable by design:** `POSTGRES_PASSWORD` and `APP_DOMAIN` exist only at the Dokploy/compose layer (compose interpolates the password into `DATABASE_URL`, and the domain into `WEB_URL` + domain routing). The API **cannot see either**, so the endpoint reports them with `verifiable: false` and a Bengali note telling the operator to check the Dokploy Environment/Domains tabs. Presence is never guessed from derivatives (a working `DATABASE_URL` does not "prove" `POSTGRES_PASSWORD` — compose ships a fallback default in-repo, which is exactly the kind of silent misconfiguration this checklist exists to surface at the layer where it can be seen).

## DB-side readiness folded in

- **Migrations:** applied count + latest from the DB's own `_prisma_migrations` ledger (same source as `system/version`). Pending = repo migration directories (timestamp-prefixed dirs under `packages/db/prisma/migrations`, located via `PRISMA_MIGRATIONS_DIR` → `@repo/db` package resolution → cwd-relative candidates) minus applied names. If the directory cannot be read, `repoTotal`/`pending` are **null** (unknown) — never invented. An explicit `PRISMA_MIGRATIONS_DIR` is authoritative: set-but-wrong yields null, not a silent fallback.
- **Platform-config summary:** all 9 config blocks with their `source` (admin/env/none) + `secretConfigured`, reusing the existing `getPlatformConfig()` safe view (which never exposes a secret) rather than re-deriving anything.

## Evidence

- New spec `apps/api/src/admin/aa1-env-check.spec.ts` — 8 tests, all passing: presence matrix, canary no-leak scan, missing-required summary math, compose-group semantics (no `present` key ever), pending computation against a fixture migrations dir, unknown-when-unreadable, 9-block config summary, tier-metadata posture (matches system neighbours), controller delegation.
- **Ceiling, stated plainly:** sandbox has no Postgres and no live Dokploy deployment — the `_prisma_migrations` read is proven against a fake prisma returning fixture rows, not a real database; the migrations-dir read is proven against a real temp directory on disk. No live HTTP call against a running deployment was made. Admin + API production builds are green (see batch report).

## Not in AA1

- No values, hashes, or prefixes of any secret are exposed anywhere ("first 4 chars" style hints were deliberately rejected).
- Boot-secret rotation guidance stays in `.env.dokploy.example`; this checklist only observes.
