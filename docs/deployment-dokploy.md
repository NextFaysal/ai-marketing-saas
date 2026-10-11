# Deployment Guide — Dokploy (owner's server)

Deploy the whole SaaS (tenant app + admin console + API +
PostgreSQL + Redis) on a Dokploy-managed server with the files in
this repo: `Dockerfile`, `docker-compose.dokploy.yml`,
`.env.dokploy.example`. Estimated time: 20–40 minutes, most of it
the first image build.

> Honest status: the development sandbox has no Docker, so the
> image itself has not been run under Docker yet. The build
> sequence HAS now been rehearsed locally with the exact file set
> the Dockerfile copies — and that rehearsal caught two real
> first-build failures, both fixed (see "Pre-flight fixes"
> below): the lockfile had no `apps/admin` importer (frozen
> install failed) and `tsconfig.base.json` was never copied into
> the image (every package build failed). With the fixes,
> `pnpm install --frozen-lockfile`, `pnpm db:generate` and the
> full `pnpm -r build` all pass in the simulated context. The
> Dockerfile also installs `openssl`/`ca-certificates` in both
> stages, which Prisma requires on slim images. The first real
> Dokploy build is still a test — if it fails, send the log and
> the fix lands in the repo the same day.

## 0. Prerequisites
- Dokploy installed on the server (its standard installer).
- Three DNS A records pointing at the server:
  `app.<domain>` (tenant app), `admin.<domain>` (operator
  console), `api.<domain>` (API + webhooks). Dokploy issues
  Let's Encrypt certificates automatically.
- This repo pushed to a Git host Dokploy can read (GitHub etc.).

## 1. Create the Compose service
1. Dokploy → your Project → **Add Service → Compose**.
2. Source: **Git** → your repository → Branch `main` (or your
   deploy branch) → **Compose path: `./docker-compose.dokploy.yml`**
   → Compose type: `docker-compose`.

## 2. Environment variables
Open the stack's **Environment** tab and paste the contents of
`.env.dokploy.example`, replacing every value:
- `POSTGRES_PASSWORD` — a long random password.
- `JWT_SECRET` — generate: `openssl rand -hex 32`
- `ENCRYPTION_KEY` — generate: `openssl rand -base64 32`
  (must decode to exactly 32 bytes; **never change it later** —
  every stored credential in the system is encrypted with it)
- `APP_DOMAIN` — the tenant app domain from step 0, no scheme.
- `INTERNAL_JOB_SECRET` — generate: `openssl rand -hex 32`
  (Milestone 57: shared secret between the API and the worker
  service; the api dispatches scheduled jobs over BullMQ/Redis
  and the worker executes them via this secret. The stack
  includes the worker service — with this set, job execution
  moves out of the API process and exhausted jobs land in the
  Admin Console's Dead-Letter Queue.)

Nothing else is required to boot. LLM keys, the Meta app, SMTP
and SMS are configured AFTER deploy from the Admin Console
(Milestone 33, Dynamic Platform Config) — no env, no redeploy.

## 3. Domains (Dokploy → the stack → Domains tab)
Attach one domain per service:
| Domain | Service | Port |
|---|---|---|
| `app.<domain>` | web | 3000 |
| `admin.<domain>` | admin | 3001 |
| `api.<domain>` | api | 4000 |
Enable HTTPS (Let's Encrypt) on each. The api service runs all
database migrations automatically on every start (idempotent),
then boots.

## 4. Deploy
Click **Deploy** and watch the build log. First build compiles
the whole monorepo (several minutes). Success looks like: all six
services running; `https://api.<domain>/health` returns
`{"status":"ok",...}`; the app + admin login pages load.

## 5. First run (Dokploy → api service → Terminal)
Run inside the **api** container. Dokploy's terminal opens at
`/` — the project lives in `/app`, so `cd` first (otherwise pnpm
answers `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`):
```bash
cd /app
# Optional: demo data (owner@demo.local / ChangeMe123!)
pnpm db:seed

# Make YOUR account the platform super admin:
cd packages/db && node scripts/grant-admin.mjs you@yourmail.com
```
Notes:
- Register your account in the tenant app first (the grant needs
  an existing user). If you seeded, you can grant the demo owner
  instead for a first look.
- The CLI grant is the ONLY way to create the first admin, by
  design. Afterwards: log into `admin.<domain>`, enrol TOTP on
  the Security page (SUPER accounts must have 2FA before they can
  change anything), then set the platform LLM, Meta app and SMTP
  under Settings → Dynamic Platform Config — each has a real test
  button.
- Keep the admin domain unlinked from the tenant app and,
  ideally, set `ADMIN_IP_ALLOWLIST` later via a Dokploy env
  addition on the api service if you have a fixed IP.

## 6. Wire up the platform (the M30 sprint, now on your server)
Follow `docs/m30-live-verification-sprint.md`. Practical points:
- Webhook URLs shown in the app belong on the **api domain**
  (e.g. `https://api.<domain>/...`).
- SMTP test: point the Admin Console SMTP at the bundled Mailpit
  first (host `mailpit`, port `1025`, any From) and watch
  `mailpit` — then switch to your real SMTP.
- Tenant-level accounts (WooCommerce, couriers, ad accounts) are
  connected by each tenant in their own dashboard, as designed.

## 7. Updates & operations
- **Update:** push to the deploy branch → Dokploy → Redeploy
  (enable Auto Deploy if you want push-to-deploy). Migrations
  run automatically on api start; the web/admin images rebuild
  from the same Dockerfile.
- **Backups:** the database lives in the `postgres_data` volume.
  Use Dokploy's backup feature or a scheduled
  `pg_dump` from the postgres container; test a restore once
  before you need it.
- **Post-deploy smoke (Milestone 64):** after EVERY redeploy,
  run `node scripts/deploy-smoke.mjs` with the SMOKE_*_URL env
  vars pointing at the live domains (see the script header).
  It checks the API health, public status/pricing, that the
  internal job/webhook surfaces exist and are guarded, both
  apps, and a full throwaway register → login → create-org
  flow. With SMOKE_ADMIN_TOKEN set (a super-admin JWT) it also
  compares current table counts against the backup manifest
  recorded in the Admin Console (System page) and fails on a
  shortfall. Exit code 1 means the deploy is NOT healthy —
  do not announce the update yet.
- **Restore drill:** restore a dump into a scratch database,
  run `ANALYZE;` in it, start a throwaway api pointed at it,
  and run the smoke script against that instance with
  SMOKE_ADMIN_TOKEN: the backup check must PASS (the restored
  counts cover the manifest). Do this once before you need a
  real restore.
- **The worker service IS in this stack** (Milestone 57): the
  API dispatches scheduled jobs over BullMQ/Redis and the
  worker executes them (retries + Dead-Letter Queue in the
  Admin Console). It needs `INTERNAL_JOB_SECRET` set (above).
- **Scaling note (updated Milestone 62):** with `REDIS_URL`
  set on the api service (the compose file does this), the API
  can run more than one replica: realtime fan-out (U6), job
  dispatch dedupe (M57), rate-limit counters (M61) and the
  periodic rule-evaluation / workflow-scan leader claims
  (M62) are all cross-instance safe. The one documented
  exception is realtime *presence*, which stays per-instance
  (the DB AgentPresence heartbeat remains the shared record).
  Without `REDIS_URL`, keep api replicas at 1.
