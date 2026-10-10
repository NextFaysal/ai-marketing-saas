# AI Marketing SaaS (Marketing OS)

All-in-One AI Marketing, Advertising Automation & Business Intelligence SaaS
for ecommerce businesses, Facebook sellers and Shopify/WooCommerce merchants.

## Status: Milestone 11 - Email/SMS & Workflows (complete, pending live check)

Milestone 1 (foundation) and Milestone 2 (products, costs, CSV import,
policies, onboarding v2) are implemented. See
`docs/milestone-1-acceptance.md` and `docs/milestone-2-acceptance.md`.

Implemented: monorepo, auth (register/login/JWT), organizations,
memberships with RBAC, tenant-isolation guard, business profile,
audit logging, dashboard shell with honest empty states, background
worker skeleton, Docker Compose for Postgres/Redis/Mailpit, CI.

Not yet implemented (by design, phased): store sync, tracking,
ad analytics, AI reports, campaign publishing, inbox, wallet.
See `docs/roadmap.md`.

## Quick start (local, target: under 15 minutes)

Prerequisites: Node 20+, pnpm 9, Docker.

```bash
cp .env.example .env
docker compose up -d postgres redis mailpit
pnpm install
pnpm db:generate
pnpm --filter @repo/db exec prisma migrate deploy
pnpm db:seed          # dev only: owner@demo.local / ChangeMe123!
pnpm --filter @repo/api dev     # http://localhost:4000/health
pnpm --filter @repo/web dev     # http://localhost:3000
```

## Scripts

- `pnpm build` - build all packages and apps
- `pnpm test` - run all tests
- `pnpm db:migrate` - create a new migration in development

## Architecture rules

1. Modular monolith first. No microservices without a demonstrated need.
2. Every tenant-owned query is scoped by `organizationId`. Tenant
   isolation is enforced by `TenantGuard` and covered by tests.
3. Money is integer minor units or Decimal, never Float.
4. No fake metrics. Unconnected data sources show empty states.
5. Platform integrations live behind adapters (from Milestone 3).
6. AI features never get direct DB or ad-account credential access;
   they call permission-checked backend tools (from Milestone 6).
