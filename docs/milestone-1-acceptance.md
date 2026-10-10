# Milestone 1 Acceptance Checklist

- [x] Monorepo structure (apps/web, apps/api, apps/worker, packages/*)
- [x] Docker Compose: Postgres, Redis, Mailpit with healthcheck
- [x] Register / Login / JWT (bcryptjs password hashing)
- [x] Create Organization (transaction: org + OWNER membership +
      BusinessProfile + FREE subscription)
- [x] Invite member with role (OWNER/ADMIN only, invitable roles limited)
- [x] TenantGuard: non-member and suspended member get 403 (unit tests)
- [x] RBAC permission ranks and tests
- [x] Audit log for register, login, org create, invite, profile update
- [x] Dashboard shell: full spec navigation, planned items marked with
      their phase, KPI cards show honest empty states (no fake metrics)
- [x] Prisma schema + initial migration + dev seed
- [x] .env.example documents every variable, no real secrets committed
- [x] CI workflow: install, generate, build, test
- [ ] Verified against a live Postgres (requires Docker on the dev
      machine; run the README quick start and tick this off)
