# Team Section — MASTER PLAN (M67–M74)

Consolidated 2026-10-11. Combines the Team Advanced plan
(T1–T5) with the owner's three additions of 2026-10-11:
**(1) track who is working vs sitting idle, (2) see who
performs well vs poorly, (3) give custom access per user.**
Foundation audit: docs/team-advanced-plan.md.

## Done
- **M67 (T1) Member Lifecycle & Seats** — role change,
  suspend/reactivate with conversation handover, removal
  with roster cleanup, seat picture. (63b5203)

## Sequence
### M68 (T2) Working Hours & Availability — IN PROGRESS
Per-agent weekly schedule + timezone; the assignment
engine skips off-shift agents (no schedule = always
available); the board shows off-shift. Schedule editor UI.

### M69 (W1) Activity & Idle Tracking — owner's ask #1
Reality check: today's AgentPresence is per-conversation
(typing/last-seen in a thread) — there is NO org-level
"who is at work" signal. Build it honestly:
- `AgentState.lastActiveAt` + a lightweight heartbeat:
  the tenant web app pings `POST /organizations/:id/presence/heartbeat`
  every ~60s while open (any page). AgentState already
  holds online/busy/away.
- **Live Team Board** (Team page): per member — status
  (online / busy / away / idle / offline / off-shift from
  M68), last-active minutes ago, open conversations now.
  Idle = status online/busy but no heartbeat AND no
  recorded action for 15+ minutes (threshold labelled
  in the UI; it is a signal, not surveillance proof).
- **Today's activity** per member, compute-on-read from
  real rows: replies sent (ChannelMessage by sender),
  conversations closed, orders created, audit actions
  count, first/last activity times. Nothing fabricated;
  members with no rows show zeros.
- Member activity feed (org AuditLog filtered + paginated)
  ships here too (was T4's second half).

### M70 (W2) Performance Scorecard — owner's ask #2
On top of the existing per-agent report (assigned/closed/
open, first-response, resolution, CSAT):
- Period-over-period: current period vs the previous
  equal-length period, with deltas per metric.
- A transparent indicator per agent: the UI shows its
  components (closed volume, first-response vs the org
  median, CSAT, SLA breaches) — a labelled সূচক with the
  formula on screen, never an opaque black-box score.
- Flags derived from org medians ("প্রথম জবাব ধীর",
  "CSAT কম", "অনেকক্ষণ idle" from M69) so the owner sees
  who is doing well and who needs attention, with the
  evidence next to every flag.
- Ranking table (sortable) on a new Team → Performance
  view; CSV export of the scorecard.

### M71 (T3) Team Leads & Scoped Analytics
InboxTeam.leadUserId; leads manage their own team's
roster/capacity and see their team's slice of the
scorecard/report; per-team breakdown + daily trend.

### M72 (W3) Custom Access — owner's ask #3
Reality check: roles are a fixed hierarchy enforced by
RolesGuard (`hasRoleAtLeast`). Custom access layers ON TOP
without breaking it:
- A documented permission catalog (areas: inbox,
  campaigns, ads, analytics, billing, team, settings,
  courier, ai, customers, automations, integrations).
- `Membership.permissionOverrides` (JSON: grants[], denies[]).
  Enforcement in RolesGuard for endpoints tagged
  `@PermissionArea(...)`: a DENY blocks even when the role
  passes; a GRANT admits even when the role is below the
  requirement — EXCEPT hard OWNER-only gates (member
  removal, TOTP reset, ownership-level actions), which
  are never grantable and are labelled as such.
- Rollout: tag the major tenant controllers area by area
  in this milestone (untagged endpoints keep pure role
  behavior — stated honestly in the UI).
- Team page: per-member **Access editor** — a matrix of
  areas × (role baseline / custom grant / custom deny),
  OWNER/ADMIN only, every change audited
  (org.member_access_updated with the diff).
- Effective-access preview: "এই সদস্য আসলে যা যা করতে
  পারবেন" computed from role + overrides.

### M73 (T4) Agent Self-Service & Signature
"My performance" card for the signed-in agent (own
scorecard row + my queue), per-agent chat signature
appended to inbox sends when enabled.

### M74 (T5) Workload Rebalance & Fairness
One-click rebalance across eligible teammates (capacity +
schedule + status aware, audited); fairness distribution
in the scorecard.

## Rules (unchanged)
One milestone at a time; build + full tests + live proof +
acceptance doc + LOCAL commit each; no GitHub push
without the owner's explicit word (22:49 rule); check
`git status` before editing shared files (parallel track).
