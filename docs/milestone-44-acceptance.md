# Milestone 44 — Unified Inbox U2: Agent System Pro (Acceptance)

Built 2026-10-10 from `docs/unified-inbox-plan.md` Phase U2.
Schema **102 models** (migration `20261010440000_m44_agents`:
InboxTeam, InboxTeamMember, AgentState; ChannelConversation.teamId;
InboxSetting.reassignAfterMinutes/escalationTeamId).

## What was built

- **Teams & queues**: teams with channel scope (empty = all
  channels), members with per-member **capacity** (max open
  assigned conversations). CRUD under
  `/organizations/:id/inbox/teams` (OWNER/ADMIN), membership
  validated against real org membership, everything audited.
- **Agent states**: online / busy / away per agent
  (`POST /inbox/agent-state`, self-service), a live agent board
  (`GET /inbox/agent-states`) with state, open load vs capacity
  and team names.
- **Assignment engine v2** (`maybeSmartAssign` rewritten):
  team routing by channel match; **escalation team** for
  high-priority / negative-sentiment conversations when
  configured; away agents skipped; capacity-capped; round-robin
  (existing cursor) or least-busy **within the pool**. Without
  teams it keeps the original org-wide behavior, now also
  state/capacity aware. Assignees get an in-app notification; a
  realtime `conversation.updated` event fires.
- **Assignment gap found & fixed**: smart assignment previously
  only ran on the Meta webhook path — website live chat (and any
  future channel) NEVER auto-assigned. The engine now also runs
  inside the inbound-intelligence pipeline for unassigned
  conversations, after classification, so escalation routing can
  use the fresh priority of the very message that arrived.
- **Assignment sweep** (scheduler job `inbox_assignment_sweep`):
  assigns the unassigned backlog (>5 min) and reassigns stale
  open conversations away from agents marked away
  (configurable `reassignAfterMinutes`, default 30).
- **Agent analytics v2**: the team report's per-agent rows now
  carry name, open-now load, average resolution minutes and
  per-agent CSAT alongside the existing first-response stats.
- **Web UI**: a "টিম ও এজেন্ট" card in the inbox — my-status
  toggle (Online/Busy/Away), live agent board, team creator with
  channel chips, per-team member+capacity editor; settings gained
  reassign minutes + escalation team; per-agent report rows show
  resolution + CSAT; note composer gained @mention chips
  (server-side mention notifications existed since M12).

## Verification
- **API tests: 423 pass (64 suites)** incl. 6 new U2 tests:
  team CRUD validation (unknown channels filtered, non-member
  rejected), agent-state validation/upsert, channel-team routing
  with in-pool round-robin, capacity skip, away skip, escalation
  routing, sweep backlog assignment + away reassign, policy-off
  no-op.
- **Live on the sandbox**: team "ওয়েব টিম" (webchat) created,
  member set with capacity 3, agent board reflects it; a real
  website-chat conversation was **automatically routed to that
  team and assigned** (verified assignedUserId + teamId on the
  conversation row via the API); agent-state busy persisted.

## Not claimed / still open
- Escalation routing applies when assignment happens after the
  flag exists (new/unassigned conversations + sweep) — an
  already-assigned conversation that turns hostile keeps its
  agent (it does raise the urgent notification, as before).
- Business-hours-aware routing is not included; away/busy is
  the manual availability signal for now.
- Per the owner's rule (2026-10-10 22:49 +06) this milestone is
  committed locally only; the GitHub push waits for his explicit
  instruction.
