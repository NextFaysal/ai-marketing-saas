# Workflows W4 — Acceptance (Real Branching)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/workflows-package-plan.md`.
No schema change.

## What was built
- **branch step** `{field, op, value, then[], else[]}`:
  the engine evaluates the condition once, runs exactly
  one arm inline, and logs the decision plus every
  sub-step with its arm (`branch: "then" | "else"` in
  the run's stepsLog). Steps after the branch continue
  normally; a failing sub-step fails the run honestly.
- **Validation** (recursive, shared by create + update):
  arms hold ONE level of sub-steps; a nested branch is
  refused, a **wait inside an arm is refused** (a branch
  never pauses in v1 — resuming mid-arm would need
  two-dimensional position state), and a branch with
  two empty arms is refused. Template existence inside
  arms is checked by the same recursion.
- The old **condition step is unchanged** (stop-on-fail)
  — branch is the two-armed form beside it. The M54
  canvas's synthetic "stop node" workaround is no
  longer the only way to express a fork.

## Builder
- Graph lib: branch is a known step type; its arms are
  draft keys (`then`/`else`) carried through
  buildPayloadStep / stepToDraft / PANEL_KEYS
  recursively, so the canvas round-trips a branch
  **losslessly** (new identity test: definition →
  graph → definition, both arms verbatim).
- StepFields: a purple branch editor with the condition
  fields and BOTH arm lists, each arm recursively
  rendering the same step editor (branch + wait are
  not offered inside arms, mirroring the engine). The
  canvas side panel gets the same editor; the node
  summary shows the condition and both arm sizes.
- Form edit mode loads arms through the lib converter
  (single source of truth).

## Verification
- API jest: 4 new W4 specs — then-arm, else-arm,
  failing sub-step, and the three validation refusals.
- Web: graph suite 21/21 incl. the new branch identity
  test.
- **Live proof**: two real manual orders through the
  API — ৳1,800 fired the THEN arm ("বড় অর্ডার"
  notification with the real order number), ৳300
  fired the ELSE arm ("ছোট অর্ডার").
