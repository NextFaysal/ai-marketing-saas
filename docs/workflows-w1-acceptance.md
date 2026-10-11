# Workflows W1 — Acceptance (Editable + Clone + Run Snapshot)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/workflows-package-plan.md`.
Schema **114** (migration
`20261010840000_w1_workflow_snapshot`).

## What was built
- **Full-definition update**: PATCH now accepts trigger,
  conditions and steps, validated by the SAME validator
  as create (extracted `validateDefinition`; the resulting
  definition is validated, not just the delta). Update,
  delete and clone are audit-logged.
- **Clone**: copies the definition under a new identity,
  always **disabled** — a clone can never double-send
  before a human reviews and enables it.
- **Run step snapshot**: every run stores the steps as
  they were at ITS start (`WorkflowRun.stepsSnapshot`)
  and executes those — editing a workflow mid-wait no
  longer rewrites runs already in flight. Resume reads
  the snapshot first, the live definition only for
  legacy runs.
- **Builder**: the form gained an edit mode (with a
  guard — workflows carrying more than one condition
  are directed to the canvas, since the form edits one
  rule), a ক্লোন button per workflow, and the canvas
  now PATCHES the opened workflow in place (its old
  "save creates a new workflow" note is gone, replaced
  with the snapshot explanation).

## Verification
- API jest: 3 new W1 (update validation parity, clone
  semantics, and a waiting run resuming on its SNAPSHOT
  steps after the live definition was edited) + the
  existing engine suites green.
- Web build green.
- **Live proof** (fresh sandbox after a VM replacement
  and full stack recovery): create → PATCH replaced the
  steps and name in place → clone returned the copy
  disabled with the "(কপি)" name.

## Known limit carried forward
Waiting runs of a workflow that gets DISABLED still fail
at resume ("Workflow disabled or deleted before
resume") — pre-existing engine behaviour, unchanged.

## Coordination note
The schema.prisma hunk (stepsSnapshot) was deliberately
NOT in this commit: the parallel track had its own
schema hunks staged in the same file at commit time.
The hunk lives in the working tree + this migration is
committed; the schema line lands with the next commit
that stages schema.prisma. Working-tree content (what
builds and runs) is complete and verified.
