# CRM C5 — Lead Auto-Assignment · Acceptance

Package: Leads & CRM Remaining Package, Batch 3 (plan: `docs/leads-crm-package-plan.md`).
Engine: `apps/api/src/crm/lead-assignment.service.ts` (`LeadAssignmentService`).
Tests: `apps/api/src/crm/lead-assignment.spec.ts` (strategy matrix, below).

## Setting & storage (the choice, verbatim)

- Stored in a NEW small model **`CrmSetting`** (migration `20261010820000_c5_crm_setting`),
  InboxSetting-style: one row per org (`organizationId` unique), no relation field.
  Columns: `leadAssignStrategy` (default `"off"`), `rrCursorUserId` (nullable).
- Why not an existing home: BusinessProfile is the M75/M77 layer of *business facts the AI
  quotes* (and was being edited by a parallel track) — an operational routing rule does not
  belong there; InboxSetting governs *conversation* assignment, a different engine with its
  own cursor. A dedicated row keeps the CRM rule and its cursor together, default-off.
- No row = strategy `"off"`. API: `GET organizations/:id/leads/assignment-setting` (any member
  who can read leads), `PATCH organizations/:id/leads/assignment-setting` (**OWNER/ADMIN**)
  with `{ "strategy": "off" | "round_robin" | "least_open_leads" }`; unknown values get
  `400 leadAssignStrategy must be off | round_robin | least_open_leads`.
- Web: a compact "🤖 স্বয়ংক্রিয় অ্যাসাইন" control on the Leads page with Bengali helper
  text per strategy.

## Eligibility rule (verbatim)

A member is eligible iff BOTH hold:

1. their membership in the org has `status = "ACTIVE"` (INVITED and SUSPENDED never), and
2. their **effective access for the `customers` permission area** is allowed, computed by
   `effectiveAccess(role, permissionOverrides)` from `common/permission-catalog.ts` — the
   exact helper RolesGuard enforces (LeadsController is `@PermissionArea("customers")`,
   the "গ্রাহক ও লিড" area, baseline role SUPPORT_AGENT): role baseline first, a per-member
   **deny blocks even a passing role**, a **grant admits a below-baseline role**, and the
   OWNER is always allowed.

The eligible set is ordered **stably**: membership `createdAt` ascending, ties by `userId`.
If the eligible set is **empty, no assignment happens** — the lead stays unassigned; nobody
ineligible or suspended is ever chosen.

## Working-hours rule (M68) & fallback (verbatim)

Using `AgentSchedule` + `isWithinSchedule` (the inbox engine's own helpers):

- a member with **no schedule row counts as always on-shift**;
- members whose schedule says off-shift are **skipped while at least one eligible member
  is on-shift**;
- if **nobody is on-shift**, the **full eligible set** is used — a lead must not get stuck
  unassigned at night. (Deliberate difference from the inbox conversation engine, which
  leaves the conversation for its reassignment sweep; leads have no such sweep.)

## Strategies (verbatim)

- `off` — zero behaviour change for existing orgs: through `LeadsService.create` the
  creator owns the lead; the actor-less ingestion paths leave it unassigned.
- `round_robin` — rotate through the (shift-preferred) eligible pool in the stable order:
  the pick is the member **after** the cursor in the current pool (pool start when the
  cursor is absent from the pool). The cursor — `rrCursorUserId`, the member who received
  the most recent auto-assignment — is persisted on the CrmSetting row and **advances only
  on an actual auto-assignment**.
- `least_open_leads` — fewest leads in **open stages** right now: `stage NOT IN (won, lost)`
  and `mergedIntoId IS NULL`, owned by the member, in this org. Ties break by the stable
  order (earliest member wins).

## Trigger points (verified callers)

- `LeadsService.create(...)` — manual create (LeadsController POST) **and** the C3 CSV
  importer (which funnels through `create`). Runs only when the caller supplied **no
  explicit owner**.
- The ingestion paths create leads directly via Prisma (verified — they never passed
  through `LeadsService.create`), so they call `LeadAssignmentService.assignNewLead`
  right after creating the row: Meta Lead Ads ingestion (`InboxService.ingestLeadgen`),
  first-message auto-lead (`InboxService.findOrCreateConversation`), and website chat
  (`WebchatService`). All calls are failure-isolated (`.catch(() => undefined)`): an
  assignment failure can never break message/lead ingestion.

An **explicit owner always wins**: `create`'s service-level `ownerUserId` (a user id, or
`null` for deliberately unassigned) is stored verbatim, auto-assignment is skipped, and
the cursor does not move.

## Record of an auto-assignment

A `LeadActivity` of type **`assigned`** (system actor, `userId = null`) on the lead:
`সিস্টেম: Lead-টি স্বয়ংক্রিয়ভাবে <নাম>-কে অ্যাসাইন করা হয়েছে (নিয়ম: <strategy label>)।`
(The lead timeline previously had no assignment type; `assigned` extends the existing
vocabulary — `created | note | stage_change | converted | merged | followup_reminded |
lead_ads_form` — and renders in the Leads page activity list like the others.)

## Test evidence

`lead-assignment.spec.ts` — 10 tests: setting default/validation; the eligibility set
(suspended excluded, plain VIEWER excluded, deny-override excluded, grant-override
included, stable order); off = legacy behaviour; round-robin full rotation + cursor
persistence; explicit owner wins + cursor unmoved + rotation resumes; least-open counts
(won/merged don't count, ties by stable order); empty eligible set → lead unassigned via
both `create` and `assignNewLead`; off-shift skip with an on-shift pool; all-off-shift
fallback to the full set; `assignNewLead` writes owner + `assigned` activity.

## Live evidence (sandbox, 2026-10-11)

The built API (with migration `20261010820000_c5_crm_setting` applied via
`prisma migrate deploy`) ran on a spare port against the real sandbox Postgres;
`/tmp/c5c6-live-check.mjs` scored **21/21** scripted HTTP checks (C5 + C6 combined).
The C5 checks: setting defaults to off with a null cursor; strategy off → creator owns
the lead; bogus strategy → 400; OWNER PATCH to round_robin → 200; with a second real
member (SUPPORT_AGENT fixture row) three consecutive leads rotated **owner → agent →
owner**; the persisted cursor equalled the last assignee; the rotated lead's detail
carried the `assigned` system activity; the agent's own PATCH attempt → **403**; after
suspending the agent, the next lead went to the owner (suspended skipped). The
shift-preference and least-open paths are covered by the deterministic unit tests
(fixed-clock schedules), not by live HTTP.
