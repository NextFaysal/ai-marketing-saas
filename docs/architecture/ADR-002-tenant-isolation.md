# ADR-002: Tenant isolation by organizationId + guard + tests

Date: 2026-10-10 · Status: Accepted

Every tenant-owned row carries `organizationId`. API routes scoped to an
organization run `TenantGuard`, which loads the membership for
(userId, organizationId) and rejects non-members and non-ACTIVE
memberships with 403. Role checks run after tenant checks (`RolesGuard`).

Tenant isolation has dedicated unit tests
(apps/api/src/common/tenant.guard.spec.ts) and must gain integration
tests against a real database before the closed beta.
