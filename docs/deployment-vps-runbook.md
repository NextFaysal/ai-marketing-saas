# VPS Production Deployment Runbook

Prepared 2026-10-10. Goal: replace the ephemeral Pinggy demo tunnel with a
permanent deployment on the user's own server/VPS.

## Reality check (verified against this repo)

- `docker-compose.yml` provides ONLY infrastructure: Postgres 16, Redis 7,
  Mailpit. There are **no Dockerfiles for `apps/web` or `apps/api`** — the
  apps run as Node processes. Production = infra in Docker + apps under a
  process manager + a reverse proxy in front.
- Since commit `86cc5d8` the web app proxies API calls through the same
  origin (`/backend` rewrite, relative API base since `364f3fa`), so a
  **single domain** is enough — no separate API subdomain, no CORS setup.
- API listens on port 4000 (`API_PORT`), web on 3000. Health check:
  `GET http://localhost:4000/health`.

## Prerequisites

- Ubuntu 22.04/24.04 VPS, 2 GB+ RAM (build step is the peak), a domain or
  subdomain whose A record points at the VPS.
- Decisions needed from the owner before starting: server IP/hostname +
  SSH access, and the domain name. Nothing else blocks preparation.

## Steps

1. **Base install**
   ```bash
   # Docker (for postgres/redis), Node 20, pnpm 9
   curl -fsSL https://get.docker.com | sh
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   npm i -g pnpm@9.15.0 pm2
   ```

2. **Code + production `.env`**
   ```bash
   git clone <repo> ai-marketing-saas && cd ai-marketing-saas
   cp .env.example .env
   ```
   Set at minimum (never reuse the dev values):
   - `POSTGRES_PASSWORD` in `docker-compose.yml` AND the password inside
     `DATABASE_URL` — strong, matching.
   - `JWT_SECRET` — random 32+ chars.
   - `ENCRYPTION_KEY` — `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
     (losing this key makes all stored integration credentials unreadable).
   - `WEB_URL="https://<your-domain>"`.
   - Leave integration keys (Meta/Google/LLM/SMTP/SSL Wireless) empty until
     the live-verification checklist reaches those steps.

3. **Infra + build + database**
   ```bash
   docker compose up -d postgres redis   # skip mailpit in production
   pnpm install --frozen-lockfile
   pnpm build
   pnpm db:generate
   pnpm --filter @repo/db exec prisma migrate deploy
   ```
   **Seed warning:** `pnpm db:seed` creates `owner@demo.local` /
   `ChangeMe123!`. On a public server either skip the seed and register a
   fresh owner, or seed and change that password immediately after first
   login. Never leave the demo credentials live.

4. **Run the apps (pm2, auto-restart + boot persistence)**
   ```bash
   pm2 start "pnpm --filter @repo/api start" --name marketing-api
   pm2 start "pnpm --filter @repo/web start" --name marketing-web
   pm2 save && pm2 startup
   ```
   Note: the scheduler runs inside the API process (Milestone 10) — keep
   exactly **one** API instance, or set `DISABLE_SCHEDULER="true"` on extras.

5. **Reverse proxy + HTTPS (Caddy, automatic certificates)**
   ```
   <your-domain> {
       reverse_proxy localhost:3000
   }
   ```
   The `/backend` API proxy is handled inside the web app, so the proxy
   needs no path rules. (nginx equivalent: one `proxy_pass` to :3000.)

6. **Verify (only claim success from these checks)**
   - `curl https://<your-domain>/login` → HTTP 200
   - `curl http://localhost:4000/health` on the server → OK
   - Browser login with the real owner account → Dashboard (Overview) loads
   - `pm2 logs` shows no boot errors; scheduler tick appears in
     Automation Runs after a minute

7. **Backups (minimum)**
   - Nightly `pg_dump` of `marketing_saas`, or snapshot the
     `postgres_data` Docker volume. Back up `.env` separately and securely —
     the database is useless for integrations without `ENCRYPTION_KEY`.

## What this does NOT include

- Real integration credentials (Woo/Meta/Google/Shopify/LLM/SMS/SMTP) —
  those follow `docs/live-verification-checklist.md` steps 1–13 after the
  app is reachable on its permanent domain (webhook URLs need the final
  domain anyway, so deployment should come first).

## Admin Console (added M25–M28)

- Third app: `apps/admin` (Next.js) on port **3001**. Serve it on a
  SEPARATE subdomain (e.g. admin.qosprey.com) with the same
  /backend -> API rewrite; never link it from the tenant app.
- Recommended extra safety at the proxy: restrict the admin
  subdomain by IP where practical, and/or set the API env
  `ADMIN_IP_ALLOWLIST` (comma-separated exact IPs) — the
  SuperAdminGuard enforces it for every /admin/* call.
- First admin: from the server shell run
  `cd packages/db && DATABASE_URL=... node scripts/grant-admin.mjs <owner-email>`
  (also the documented break-glass: it resets TOTP). Then enrol
  TOTP from the admin Security page — SUPER mutations are refused
  until TOTP is on.
