# Milestone 69 — Acceptance (Team W1: Activity & Idle Tracking)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11).
The owner's ask #1: see who is working and who is sitting idle.
Schema 105 models (one column added); migration
`20261010690000_m69_agent_activity`.

## What was built
- **Presence heartbeat**: `AgentState.lastActiveAt` +
  `POST organizations/:id/inbox/presence/heartbeat`. The
  tenant dashboard layout stamps it on mount and every ~60s
  while open (failures silent; presence never breaks the
  shell). Heartbeats are NOT audited (too frequent).
- **Live Team Board** — `GET inbox/team-activity?tz=` computes,
  per agent-role member, from real rows only:
  - today's **replies sent** (ChannelMessage: direction "out",
    sentByUserId = the agent, autoReply excluded, failed
    excluded — scoped via the message's conversation),
  - today's **conversations closed** (assignee at close,
    resolvedAt in the local day),
  - today's **audit actions**, **open conversations now**,
  - last action time, heartbeat time, and the M68 shift flag.
  - **Derived activity state** (rule shown in the UI):
    manual away → **away**; a real action ≤15 min ago →
    **active**; app heartbeat fresh (≤3 min) but no action
    for 15+ min → **idle**; otherwise → **offline**. Actions
    are the work signal — the heartbeat is presence only, so
    an open-but-unused dashboard reads idle, not active.
  - The local day is computed in the requested timezone
    (default Asia/Dhaka) with a two-pass Intl offset solver.
- **Member activity feed** — `GET members/activity-feed`:
  the org's real AuditLog rows, newest first, with actor
  names. Managers see everyone; a non-manager only ever sees
  their own rows (a userId parameter from them is ignored).
- **Team page**: a "লাইভ টিম বোর্ড" card (state chips incl.
  অফ-শিফট, last-active relative time, today's counts,
  auto-refresh 30s, the derivation rule printed on the card)
  and a "সাম্প্রতিক কার্যকলাপ" feed card with Bengali labels
  for the common actions.

## Verification
- API jest: **624 pass / 91 suites** (3 new M69: the
  active/idle/offline/away ladder with a pinned clock,
  heartbeat stamping, feed scoping incl. the peek attempt).
- Full monorepo build green; web serves.
- **Live proof** (T1 Shop org): the agent heartbeated and
  did nothing → board showed **idle** with replies 0; the
  owner showed **active** from 14 real audit actions; after
  the agent sent one real reply the board flipped the agent
  to **active, replies 1**, with the correct last-action
  time. Day start resolved to Dhaka midnight exactly.
- **A real bug was caught by the live test, not the unit
  tests**: the first implementation counted messages by a
  nonexistent `senderUserId` field and direction "outbound"
  (real values: `sentByUserId`, "out"; messages carry no
  organizationId). The fake-Prisma spec had happily matched
  the wrong shape and reported zeros only in production.
  Fixed in the service and the spec now models the real row
  shape (incl. autoReply/failed exclusions).

## Not built / limits
- Idle is a signal, not surveillance proof — the UI says so.
  An agent working in another tool (phone, courier app)
  reads idle/offline here; only in-app work counts.
- Closed-conversation attribution is "assignee at close"
  (closes are not individually audited today).
- The board is per-day (Asia/Dhaka default); historical
  per-day rollups are not stored (compute-on-read only).
