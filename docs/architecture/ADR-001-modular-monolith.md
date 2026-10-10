# ADR-001: Modular monolith, TypeScript, pnpm monorepo

Date: 2026-10-10 · Status: Accepted

## Context
Solo developer (JavaScript/TypeScript) building a multi-tenant SaaS.
Microservices, Kafka and Kubernetes would slow delivery and add
operational burden without a demonstrated scaling need.

## Decision
- One monorepo (pnpm workspaces): apps/web (Next.js), apps/api (NestJS),
  apps/worker (BullMQ), packages/db (Prisma), packages/contracts (Zod),
  packages/ui.
- Backend modules communicate in-process but keep clean boundaries so a
  module (e.g. worker jobs, sync) can be split out later.
- PostgreSQL for transactional data and MVP analytics. ClickHouse only
  when event volume justifies it.

## Consequences
- Fast local development, single deploy story, shared types via contracts.
- Module boundaries must be respected in code review; no cross-module
  direct table writes outside the owning module service.
