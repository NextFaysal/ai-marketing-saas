# Milestone 74 — Acceptance (Team T5: Workload Rebalance & Fairness)

Status: **DELIVERED & LIVE-PROVEN in the sandbox** (2026-10-11).
No schema change. **This completes the Team Master Plan
(M67–M74).**

## What was built
- **`POST inbox/rebalance`** (OWNER/ADMIN/MARKETING_MANAGER,
  `{dryRun}`):
  - Donors = agents whose open conversations exceed their
    capacity (max team capacity, default 20 — the same
    numbers the agent board shows).
  - Each donor sheds exactly the excess, **newest
    conversations first** (least history lost), to eligible
    receivers: ACTIVE membership, not away, on shift
    (Milestone 68 schedules), under capacity; a
    team-stamped conversation prefers a receiver on that
    team, then the least-busy wins.
  - Away / off-shift / suspended / full agents are never
    chosen; when nobody can take a conversation it is
    counted in `skippedNoReceiver`, never forced.
  - dryRun returns the plan and changes nothing; a real
    run applies the moves, stamps receivers'
    lastAssignedAt, and writes ONE audit row
    (`inbox.workload_rebalanced` with the full move list).
- **Fairness in the scorecard**: `buildFairness` (pure) —
  each agent's share of the period's assignments vs the
  equal share (100/headcount), with per-agent deviation
  and the max–min spread; zero-assignment periods report
  honest zeros.
- **Web**: Team page (managers) gains a **⚖️ কাজের ভারসাম্য
  করুন** button on the live board — dry-run plan first
  (named from → to list in a confirm dialog), then apply;
  the performance page gains a fairness strip (share chips
  coloured by deviation, with the equal share and spread,
  and a pointer to the rebalance action).

## Verification
- API jest: **683 pass / 97 suites** overall (3 new M74:
  dry-run plans exactly the excess to the only eligible
  receiver — away and off-shift agents excluded — and
  mutates/audits nothing; a real run applies + audits
  once; fairness math exact incl. the zero case).
- Full monorepo build green.
- **Live proof** (T1 Shop): agent (capacity 1) holding 3
  open conversations → dry run planned 2 moves → real run
  moved 2 to the owner → board showed agent 1/cap 1,
  owner 2/cap 20. Scorecard fairness: totalAssigned 3,
  equal share 50%, spread 33.4%.

## Not built / limits
- Rebalance moves only the over-capacity excess; it does
  not equalize loads proactively (no churn of healthy
  assignments) and never touches closed conversations.
- Conversations keep their team stamp when moved; a
  cross-team receiver is used only when no same-team
  eligible receiver exists.
