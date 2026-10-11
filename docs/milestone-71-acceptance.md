# Milestone 71 — Acceptance (Team T3: Team Leads & Scoped Analytics)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11).
Schema 106 models; migration `20261010710000_m71_team_lead`.

## What was built
- **InboxTeam.leadUserId** — set/cleared via the existing team
  PATCH (OWNER/ADMIN); the lead must be an org member
  (validated); `listTeams` returns the lead's name.
- **Lead rights** (service-enforced via one `teamScope`
  helper): a team's lead may
  - set their own team's roster/capacities — the members
    endpoint's guard now admits agents so a lead can reach
    it, and the service throws 403 for anyone who is neither
    a manager (OWNER/ADMIN/MARKETING_MANAGER) nor that
    team's lead;
  - view their team's scoped analytics (below).
- **Team report v3** (`GET inbox/team-report`):
  - `perTeam` — per-team assigned/closed/openNow, average
    first response / resolution / CSAT aggregated from the
    members' raw rows (an agent on two teams counts toward
    both; the UI says so), with member counts and lead ids;
  - `dailyTrend` — created/closed per Asia/Dhaka calendar
    day across the window (zero days are real zeros);
  - `?teamId=` scoping — every figure (totals, per-agent,
    trend, CSAT, autopilot draft/escalation counts,
    chat-linked orders) is computed from the team's slice
    only: conversations whose assignee is on the roster or
    which are stamped with the team. Non-lead/non-manager
    viewers get 403.
- **Scorecard scoping** (`?teamId=` on the scorecard + CSV):
  the roster becomes the population — medians, flags and
  ranking describe that team alone; same 403 rule.
- **Web**: inbox team cards gain a lead selector (managers)
  or the lead's name (everyone else) with a note of what a
  lead can do; the inbox report gains a scope selector,
  per-team rows and the daily-trend strip; the performance
  page gains a team filter (CSV follows it) and a scoped
  banner.

## Verification
- API jest: **643 pass / 93 suites** (5 new M71: roster
  rights for lead vs non-lead, lead validation/clearing,
  perTeam + trend on the full report, scoped counting +
  403s, scoped scorecard population).
- Full monorepo build green.
- **Live proof** (T1 Shop org): team "Sales" created, the
  agent set as lead; the agent (a SUPPORT_AGENT) then
  successfully saved the roster (201) through the lead
  right; their scoped report showed only the team's data
  (opened 1, perAgent = the agent alone), perTeam and a
  7-day trend; scoping a team they do not lead returned
  **403** on both the report and the scorecard.

## Not built / limits
- Leads cannot rename/re-channel/delete their team or set
  leads — those stay OWNER/ADMIN (structural changes).
- Team attribution in perTeam double-counts multi-team
  agents by design and is labelled as such.
