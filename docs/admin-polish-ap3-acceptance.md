# Admin Polish AP3 — Acceptance (Scoped Admin API Keys)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/admin-polish-plan.md`.

## What was built
- `AdminApiKey.scopes String[]` (migration
  `20261010980000_ap3_api_key_scopes`) + a scope
  module (common/api-key-scopes.ts): areas
  tenants / billing / growth / admins / system,
  mapped from the admin route prefixes; grants
  `area:read`, `area:write`, `area:*`, `*`.
- JwtAuthGuard's api-key branch enforces the grant
  for the actual route (reads need :read, mutations
  :write) and refuses with a 403 naming the missing
  grant. The interactive-session path is untouched,
  and API keys remain exempt from the TOTP gate.
- Creation validates grants against the catalog
  (unknown area/grant → 400); the console's create
  form has per-area read/write checkboxes (default
  system:read) and each key row shows its scopes.
- **Legacy rule (documented):** keys created before
  AP3 have an empty scope list and keep full
  access — the console labels them "legacy — পূর্ণ
  ক্ষমতা" so the operator can re-issue them scoped.

## Verification
- 12 new specs: route→grant mapping, hasScope
  semantics (exact / area:* / * / legacy), catalog
  validation, and guard-level pass/refuse cases.
- **Live proof** (real key created via the console
  API with scopes ["tenants:read"]): GET
  /admin/orgs → 200; GET /admin/billing/summary →
  403 "lacks the required scope: billing:read";
  POST org status → 403 tenants:write; a directly
  inserted legacy key (scopes []) → 200 on billing.
- API + admin builds green.
