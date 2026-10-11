# Milestone 67 — Team T1: Member Lifecycle & Seats (Acceptance)

Built 2026-10-11 from `docs/team-advanced-plan.md`.
**No schema change** (MembershipStatus.SUSPENDED already
existed — nothing set it until now).

## The gaps closed
Before: a member's role was frozen at invite time; there
was NO way to suspend or remove a member at all; and nobody
could see seat usage on the Team page.

## What was built
API (`OrganizationsService` + controller):
- `PATCH /organizations/:id/members/:userId/role`
  (OWNER/ADMIN) — role changes among the invitable set;
  OWNER is never assignable and the owner's own role can
  never be changed here. Audited with from → to.
- `PATCH /organizations/:id/members/:userId/status`
  (OWNER/ADMIN) — SUSPENDED / ACTIVE. Suspending hands the
  member's OPEN conversations back to the pool
  (`assignedUserId → null`, counted and returned) so the
  existing assignment sweep redistributes them, and marks
  their agent state away. The owner cannot be suspended;
  nobody can suspend themselves. Because TenantGuard
  requires an ACTIVE membership on every request,
  suspension cuts access immediately — no token surgery.
- `DELETE /organizations/:id/members/:userId` (OWNER only)
  — same handover, plus roster cleanup (InboxTeamMember
  rows across the org's teams + AgentState), then the
  membership is deleted. Owner/self removal refused.
- `GET /organizations/:id/members/usage` — seat picture:
  plan limit (admin override → plan default → unlimited),
  active + suspended members, live pending invitations,
  available seats (same resolution as the seat guard).

Web (Team page):
- Seat meter card (used / limit / pending / available,
  with a plain-language "no seats left" state).
- Per-member role dropdown (OWNER row locked), Suspend /
  Reactivate and Remove (OWNER only, with confirm) —
  controls gated by the viewer's own role (from
  GET /organizations myRole); handover counts shown in the
  success notice.

## Verification
- **API tests: 614 pass (89 suites)** incl. 5 new M67 tests
  (role change + audit + OWNER protections, suspend
  handover counts incl. closed-history untouched + agent
  marked away + reactivation, owner/self guards, removal
  roster cleanup, seat usage from real rows).
- **Live end-to-end** on the sandbox stack: seat usage
  showed the FREE plan's real limit (2 used / 2, 0
  available); role change SUPPORT_AGENT → ADMIN; suspend
  returned handedOver=1 and the conversation was verified
  unassigned; the suspended agent's org access returned
  **403**; reactivation and removal succeeded; removing
  the OWNER returned **400**.

## Notes
- Ownership transfer is deliberately out of scope (it is a
  distinct, higher-risk flow).
- Committed locally only; GitHub push waits for the owner's
  explicit instruction (rule of 2026-10-10 22:49 +06).
