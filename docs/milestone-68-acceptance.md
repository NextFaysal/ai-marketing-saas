# Milestone 68 — Acceptance (Team T2: Working Hours & Availability)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11).
Team Master Plan batch T2. Schema 105 models; migration
`20261010680000_m68_agent_schedule`.

## What was built
- **AgentSchedule model**: one row per (organization, user) —
  IANA timezone (default Asia/Dhaka) + weekly windows JSON
  keyed by weekday ("mon".."sun"), each a list of
  ["HH:MM","HH:MM"] windows. A window whose end <= start
  spans midnight and belongs to the day it STARTS on. No
  row = no schedule = always available (pre-M68 behavior
  preserved exactly).
- **Pure evaluator** (`apps/api/src/inbox/working-hours.ts`):
  `isWithinSchedule` converts "now" into the schedule's
  timezone with Intl and checks today's windows plus
  yesterday's overnight windows. `isValidWindows` rejects
  bad day keys, malformed times and zero-length windows.
- **Assignment engine**: `maybeSmartAssign` now also skips
  off-shift agents (one extra query, only when schedules
  exist) — so direct assignment, the sweep and escalation
  routing all inherit it, since they share this method.
  Suspended members (M67) are excluded from candidacy too.
- **API**: GET `inbox/agent-schedules` (every agent-role
  member with timezone/windows/hasSchedule/onShift computed
  for now), PUT `inbox/agent-schedules/:userId`,
  DELETE `inbox/agent-schedules/:userId`. Managers
  (OWNER/ADMIN/MARKETING_MANAGER) edit anyone; an agent
  edits only their own (service-enforced). Schedule writes
  are audited (inbox.agent_schedule_updated / _cleared).
- **Board**: `listAgentStates` rows gain `hasSchedule` +
  `onShift`; the inbox agent board shows an "অফ-শিফট" chip.
- **Team page editor**: per-member কর্মঘণ্টা editor — seven
  weekday rows (Bangladeshi week order, Saturday first) with
  on/off + start/end time inputs, a timezone field, save /
  clear actions, and an "এখন শিফটে / অফ-শিফট" chip on the
  member row. Visible to managers for everyone and to an
  agent for themselves only.

## Verification
- API jest: **621 pass / 90 suites** (7 new: window math
  incl. overnight + boundaries [start, end), validation,
  off-shift skip with a pinned fake clock, both-off-shift →
  unassigned, CRUD permission rules).
- Full monorepo build green (web included).
- **Live proof** (real API + Postgres, T1 Shop org): with
  smart assignment ON — both members on a Sunday
  00:00–01:00 schedule (off-shift at ~11:00) → a new webchat
  conversation stayed **UNASSIGNED**; after widening the
  agent's window to 00:00–23:59 → the next conversation was
  assigned to **exactly that agent** (the owner stayed
  off-shift and was skipped). agent-states showed
  hasSchedule/onShift correctly for both.
- Honest note: the first live attempt was inconclusive
  because this fresh org had smartAssign = "off" (engine
  never ran); the checks were re-run with the engine ON and
  only those count as proof. In M67's session the handover
  evidence implies that org had the engine on.

## Not built / limits
- One window per day in the editor UI (the model and engine
  support several; the editor edits the first).
- Schedule changes apply to NEW assignments; already-open
  conversations are not pulled back when a shift ends (the
  sweep only moves conversations away from AWAY agents).
