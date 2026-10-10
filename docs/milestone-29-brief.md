# Milestone 29 — Production Deployment Pack: Execution Brief

Prepared 2026-10-10 (after M32 delivery, commit 0a662bf), from a fresh
repo audit. This is the groundwork for the main build session; nothing
here is built yet. Owner authorization: standing autonomy grant
(2026-10-10) — no per-milestone approval needed. The final cutover
still needs the owner's VPS + domain, which only he can provide.

## Why now

- The roadmap (docs/next-roadmap-plan.md, Part 2.1) recommends M29
  FIRST, before M30/M31. The owner picked M32 first; M32 is now
  delivered, so M29 is the highest-ranked remaining buildable work.
- The sandbox VM has been replaced TWICE (during M18 and again during
  M32), each time wiping PostgreSQL data, pnpm and /tmp helpers. The
  only running copy of the product is still ephemeral.

## Verified current state (2026-10-10, this audit)

1. `docker-compose.yml` is DEV-ONLY infrastructure: postgres:16-alpine,
   redis:7-alpine, mailpit. The Postgres password is the hardcoded dev
   value in the file. There are NO services for api/web/admin/worker.
2. There are NO Dockerfiles anywhere in the repo (checked apps/ and
   packages/). The runbook's production model is: infra in Docker +
   apps as bare Node processes under pm2.
3. App start commands / ports (from each app's package.json):
   - api: `node dist/main.js`, port 4000 (`API_PORT`), health
     `GET /health`. Scheduler runs INSIDE the API process — exactly
     one API instance, or set `DISABLE_SCHEDULER="true"` on extras.
   - web: `next start -p 3000`. Proxies API calls same-origin via the
     `/backend` rewrite, so ONE domain suffices for web+api.
   - admin: `next start -p 3001`. Must be a SEPARATE subdomain, never
     linked from the tenant app; `ADMIN_IP_ALLOWLIST` enforced by
     SuperAdminGuard on /admin/*.
   - worker: `node dist/index.js` (BullMQ).
4. Worker processors are still PLACEHOLDERS: `apps/worker/src/index.ts`
   registers a processor per queue that only logs "processor not
   implemented yet" and returns `{skipped: true}`. Queue names live in
   `apps/worker/src/queues.ts` (with queues.test.ts). All real
   automation today runs on the in-API scheduler + workflow scans.
5. No backup automation exists: no .sh scripts in the repo, no pg_dump
   usage outside the runbook's prose. The runbook (Step 7) asks for a
   nightly pg_dump + a separately-secured copy of `.env`
   (ENCRYPTION_KEY loss = all stored integration credentials
   unreadable).
6. `.env.example` exists and is the env checklist base; it does NOT
   yet cover the admin-era variables (ADMIN_IP_ALLOWLIST, plan-price
   operator settings defaults, support contact) added in M25–M28.
7. Docker is NOT available in this sandbox (`docker: command not
   found`) — a production compose file can be written and YAML/
   statically validated here, but `docker compose up` validation
   cannot happen until a Docker host (the owner's VPS) exists. Do
   not claim compose is "run-verified" from sandbox work.

## Build list (in order)

1. **docker-compose.prod.yml** (new, separate from the dev compose):
   postgres + redis + api + web + admin + worker; no mailpit; no
   hardcoded passwords — every secret from a server-side `.env.prod`
   (gitignored); postgres/redis not published to host ports except
   through the app network; healthchecks + restart policies;
   `DISABLE_SCHEDULER` left unset on the single api service.
2. **Dockerfiles** (multi-stage, Node 20 + pnpm 9.15.0, frozen
   lockfile): one per app (api, web, admin, worker) or a shared base
   with per-app targets — builder's choice, document it. Must handle
   the monorepo layout (pnpm workspace, packages/db prisma generate
   before api/worker build) and run `prisma migrate deploy` as a
   one-shot init step, NOT on every app boot.
3. **Reverse-proxy templates**: Caddyfile + nginx equivalent for
   `app.<domain>` -> web:3000 and `admin.<domain>` -> admin:3001,
   with an optional IP-restriction block on the admin vhost matching
   the runbook's recommendation.
4. **Backup script + restore drill doc**: `scripts/backup.sh`
   (pg_dump -Fc, timestamped, retention rotation, .env.prod reminder)
   and `scripts/restore.md` (restore into a scratch DB, verify row
   counts on Organization/User, then swap). A sandbox snapshot taken
   2026-10-10 proves the format: pg_dump -Fc, 390 KB, 471 TOC entries,
   1 organization — see the interim backup note below.
5. **.env.prod.example**: production checklist derived from
   .env.example PLUS the M25–M28 admin variables, strong-secret
   generation commands inline, and the seed warning (never leave
   owner@demo.local / ChangeMe123! live on a public server).
6. **BullMQ processors (C1 from the roadmap)**: move the heavy jobs
   (sync / report / broadcast) behind real processors in
   apps/worker, idempotent, with the in-API scheduler kept as
   fallback. This is the largest item — split it out as M29B if it
   threatens the deployment items above; deployment durability is
   the point of M29, worker scale is secondary.
7. **Update the runbook** (docs/deployment-vps-runbook.md) to point
   at the new compose/Dockerfiles as the primary path, keeping the
   pm2 bare-process path as the documented fallback.

## Acceptance criteria

- `docker compose -f docker-compose.prod.yml config` parses clean
  (run wherever Docker exists; in-sandbox, at minimum a YAML parse +
  a manual env-var cross-check against .env.prod.example).
- Every secret referenced by the prod compose appears in
  .env.prod.example; no dev password ("marketing") appears anywhere
  in prod files.
- Backup script runs against the sandbox Postgres and produces a
  dump that `pg_restore --list` reads; restore drill doc followed
  once against a scratch database here.
- Full monorepo build + API tests stay green (332 passing at M32).
- Honesty rule: report compose as "written and statically
  validated; first real `up` happens on the owner's VPS" — never as
  run-verified.

## What the owner still has to provide (cutover only)

- VPS (Ubuntu 22.04/24.04, 2 GB+ RAM) + SSH access, and a domain /
  two subdomains (app + admin) with A records. Nothing else blocks
  the build above.

## Interim protection already taken (2026-10-10)

A pg_dump -Fc snapshot of the current sandbox database is stored
outside the database at:
`~/workspace/backups/ai-marketing-saas/marketing_saas-20261010T115142Z.dump`
(390 KB, SHA-256 be06ac1449011015022d5687b34ef25a434b86ce7848b5d1f09091d44fb684e4,
471 TOC entries, 1 organization). If the sandbox VM is replaced a
third time, restore from this dump instead of re-seeding from
scratch (note: this DB incarnation has NO admin TOTP enrolment).
