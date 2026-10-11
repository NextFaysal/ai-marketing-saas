# Milestone 70 — Acceptance (Team W2: Performance Scorecard)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11).
The owner's ask #2: see who performs well and who poorly.
No schema change.

## What was built
- **GET `inbox/team-scorecard?days=`** — per agent-role member,
  for the current period and the previous equal-length period
  (windows returned in the payload): assigned / closed /
  human replies / avg first response / avg resolution / CSAT
  — the same semantics as the existing team report
  (createdAt / resolvedAt / csatRatedAt attribution by
  assignee; replies = outbound human messages, M69 rules) —
  plus signed deltas for every metric.
- **A transparent indicator (0–100)** whose four components
  are returned per agent and printed on the page:
  volume = min(30, closed); speed = first response ≤5m → 25,
  −1 per extra 3m; resolution = ≤60m → 20, −1 per extra 30m;
  csat = CSAT/5 × 25. A metric with no data contributes 0
  AND is named in `missingComponents`; an agent with no
  closes, no responses and no CSAT is flagged
  `insufficientData` and left unranked — never presented as
  a zero-history failure.
- **Flags with evidence** (org medians computed from the
  same payload): slow first response (>1.5× median, ≥3
  assigned), low CSAT (<3.5 with ≥2 ratings), low closures
  (<0.5× median with ≥5 assigned), idle-now (merged from
  the M69 board), customers-happy (CSAT ≥4.5, ≥2 ratings).
  Every flag carries its numbers in `detail`.
- **Ranking** by indicator (insufficient-data agents
  unranked at the bottom).
- **CSV export** — `GET inbox/team-scorecard.csv` with the
  same numbers (one row per agent, deltas via prev columns,
  flag codes, insufficient-data marker).
- **Web**: `/dashboard/team/performance` — days selector
  (7/14/30), the formula printed at the top, a ranking
  table with component breakdowns, delta arrows colored by
  polarity (slower minutes = red), flag chips with their
  evidence, idle badge, and a CSV download button. Linked
  from the Team page.

## Verification
- API jest: **638 pass / 93 suites** (2 new M70: exact
  component math — a crafted star scores 75 and ranks #1,
  a slow agent scores 42 with both negative flags, a
  no-data agent is insufficient + unranked + missing
  components named; CSV carries the same numbers).
- Full monorepo build green.
- **Live proof** (T1 Shop org): the agent's row showed
  assigned 1, replies 1, avg first response 8 minutes,
  indicator 24 (speed 24/25; volume/resolution/CSAT 0 with
  no data — exactly the honest shape), correct current and
  previous windows; the CSV endpoint returned 200 with the
  attachment headers.

## Not built / limits
- The indicator weights are a documented heuristic (like
  the admin health score), shown on the page — they are
  not a machine-learned model and are not presented as one.
- Medians include the OWNER when the owner works chats;
  on tiny teams the median is coarse (flags require
  minimum volumes to fire).
- Per-team scorecard slicing arrives with M71 (Team Leads).
