# Team Section — Advanced System Plan (T1–T5, Milestones 67–71)

Written 2026-10-11 at the owner's request ("Team section এ
full advance system চাই") after a full audit of the code.

## Already complete (verified in code, not assumed)
- Members list with role + status; email invitations
  (create/list/revoke/resend, 7-day, seat-checked); direct
  add for registered users; OWNER-only per-member TOTP reset.
- Inbox teams: CRUD, channel scoping, per-member capacity.
- Agent states online/busy/away + live board; assignment
  engine v2 (channel teams, escalation team, capacity,
  round-robin/least-busy, away skipped) + assignment sweep.
- Team report per agent: assigned/closed/open-now, avg
  first-response, avg resolution, CSAT. @mentions, SLA
  clocks, agent notifications + presence.

## Gaps (the advanced layer)
1. No role change after invite. No suspend/remove at all
   (MembershipStatus.SUSPENDED exists; nothing sets it).
2. Removing a person strands their open conversations.
3. No working hours / shifts — assignment ignores schedules
   (noted as unbuilt since U2).
4. No team leads; reports are org-wide, manager-only.
5. No agent self-view ("my performance / my queue").
6. No member activity feed on the tenant side.
7. Seat usage invisible on the Team page.
8. No workload rebalance tool for managers.

## Batches
- **T1 (M67) Member Lifecycle & Seats** — PATCH member role;
  suspend/reactivate; remove member. Last-OWNER protection
  on every path. Suspend/remove hands open conversations
  back to the pool (unassign + audit) so the sweep
  redistributes them. Team endpoint gains seat usage
  (limit from effective plan limits, used, pending invites);
  Team page: role dropdown, suspend/remove/reactivate
  actions, seat meter.
- **T2 (M68) Working Hours & Availability** — AgentSchedule
  (per org+user: timezone + weekly windows). Assignment
  engine skips off-shift agents (no schedule = always
  available — current behavior preserved). Board shows
  off-shift state. Schedule editor on the Team page /
  inbox team card.
- **T3 (M69) Team Leads & Scoped Analytics** —
  InboxTeam.leadUserId; leads can manage their team's
  roster/capacity and see their team's report; team report
  gains per-team breakdown, daily trend series, CSV export.
- **T4 (M70) Agent Self-Service & Activity** — "My
  performance" (own row of the team report + my queue
  counts) in the inbox; member activity feed on the Team
  page (org audit trail, paginated); per-agent chat
  signature (stored on the user-in-org profile, appended
  to inbox sends when enabled).
- **T5 (M71) Workload & Fairness** — one-click rebalance:
  move open conversations from over-capacity agents to the
  least-busy eligible teammates (capacity + schedule
  aware, fully audited); fairness distribution in the
  team report.

Rules (unchanged): one batch at a time; build + full tests +
live proof + acceptance doc + LOCAL commit per batch; no
GitHub push without the owner's explicit word; never touch
the parallel track's in-flight files (check git status
before each batch).
