# Architecture — AI Marketing SaaS (Qosprey)

One central place with one subscription where a merchant runs everything — store,
messaging, ads, CRM, courier, analytics. TypeScript-first modular monolith.
This page is the orientation map; the per-module map is [CODEMAP.md](CODEMAP.md),
the document map is [INDEX.md](INDEX.md).

## Repo layout (pnpm monorepo)

| Path | What it is |
|---|---|
| `apps/api` | NestJS API — 78 feature modules under `src/` (see CODEMAP). Owns all business rules; no integration is ever claimed successful without the real operation confirming it. |
| `apps/web` | Next.js — tenant dashboard + storefront (incl. tenant subdomains / merchant domains). |
| `apps/admin` | Next.js — platform (SUPER admin) console. |
| `apps/worker` | Background jobs / sweeps. Per-org job enables default OFF; enabling is an explicit per-org decision. |
| `packages/db` | Prisma schema (401 models, single `schema.prisma`) + 281 migrations. DB image must be `pgvector/pgvector:pg16` (Smart AI vector search). |
| `packages/contracts` | Shared types/contracts between apps. |
| `packages/ui` | Shared UI components. |
| `docs/` | 560+ plan / acceptance / summary documents — start from INDEX.md. |
| `docker-compose.dokploy.yml` | Production deploy (Dokploy). Redeploy is a manual owner step; a git push triggers a rebuild. |

## Scale at the 2026-10-17 final union release (`5a7a42fd`)

2,933 tracked files · 2,039 TS/TSX · fresh-PG 280/280 migrations green ·
web vitest 1128/1128 · API boot smoke PASS. Nothing in the union release is
live-verified yet — M30 live verification with real accounts is still owed
(see INDEX.md → m30-live-verification-sprint.md).

## Working discipline (from the 2026-10-17 organization pass)

- **One canonical dev tree:** `~/workspace/ai-marketing-saas-clean` (this tree).
  The deploy clone is `~/workspace/github-ai-marketing-saas`.
- New programs get ONE short-lived worktree + branch, removed with
  `git worktree remove` when the program closes — branches and bundles keep
  the history, checkout folders do not need to.
- Full-history safety net: `~/workspace/backups/code-organization-2026-10-17/`
  (git bundles of both repos, verified complete).
- Never commit build junk: `*.tsbuildinfo`, `node_modules`, jest-cache
  (`apps/api/src/~/` incident of 2026-10-17 — see `.gitignore` guards).
- GitHub pushes happen ONLY on the owner's explicit instruction in the moment;
  before any push: `ls-remote` + fetch first, merge the owner's own commits,
  never force-push. Deploy = owner's manual Dokploy Redeploy after a push.
- Every batch closes with gates: tsc 0, unit tests green, fresh-PG migration
  union clean, real Nest boot smoke — and an item-by-item audit that names
  partial / not-built work explicitly.
