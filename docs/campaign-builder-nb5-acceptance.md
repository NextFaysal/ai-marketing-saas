# Campaign Builder Next — NB5 Acceptance (CN10 + CN11 + CN12 local)

Worktree `~/workspace/ai-marketing-saas-cn`, branch
`campaign-next`. Local commits only — NO push.

Process note: NB5's feature commits all landed on 2026-10-14,
but the batch stalled before its closing gate: the full API
jest attempt of 2026-10-15 00:26–00:35 (+06) ran with
`--maxWorkers=2`, two suites died by jest-worker SIGKILL
(sandbox OOM — `ec29-gift`, `cb6-cross-platform`) and the log
was lost, so NO gate result was on record. The owner ordered
the restart 2026-10-15 01:41 +06 ("NB5 ar kaj aber star
koro"). This acceptance is from the restart run, executed
directly in-session on 2026-10-15, serially, with the exact
numbers below. NB5 is complete only as of this document.

## Delivered

- **NB5 mini-fix** (`28269c3`) — the NB4 carry-over closed:
  full-field copy parity via shared `adSetCopyData` /
  `adCopyData` helpers. `duplicatePlan` gains
  `dailyBudgetCapMinor` + the CN3/CN4/schedule/daypart ad-set
  fields, `duplicateAdSet` ads gain the CN5 fields,
  `clonePlanToAccount` rides the helpers with its mapped
  values as overrides. Spec `nb5-minifix` 2/2.
- **CN11 governance** (`d304dad`) — @mentions in comments
  (ACTIVE-member longest-first resolution, `campaign_mention`
  notifications, author excluded), plan versions (submit-kind
  row on submit + manual snapshots + name-matched structural
  diff + restore into a NEW sibling draft, source never
  touched), two-step approval chain (`CampaignApprovalSetting`;
  step 1 stays pending + `campaign.approved_step1` audit,
  same-approver step 2 refused, submit/reject clear step
  state, OFF = legacy path), last-activity from the newest
  audit row (labelled not-presence), hub `listPlans` paged
  envelope with batched ad-set counts + status/q/objective
  filters + `includePerformance` aggregation (legacy bare
  array when no opts), saved views CRUD scoped to owner.
  Migration `20261013850000_cn11_governance` (additive).
  cn11 spec 18/18, campaigns-scoped 169/169 at commit time.
- **CN10 design v2** (`e31ad0e`, `1ea8dc3`, `c6d428b`) —
  `.cbx-*` campaign design primitives (additive, brand-token
  only); builder guided steps + sticky readiness/preview
  rail + CN11 governance UI; hub v2: server pagination via
  the CN11 paged envelope, performance columns from
  `includePerformance` (null = honest no-data marker,
  platform-labelled), bulk bar (duplicate + status-sync only
  — no archive endpoint exists, none invented), saved-views
  rail, PLAN-LEVEL launch calendar from loaded rows (honest
  labelling that ad-set dates are not in the list payload),
  cbx-pill status mapping. Zero-loss vs the `8961667` hub
  baseline, coordinator-verified set-diff: endpoints 23→31
  lost 0, labels lost 0.
- **CN12 local deliverables (this restart)** —
  `docs/campaign-live-verification-checklist.md` committed
  (`95f8a9f`): 129 lines, sessions S1–S10 + deploy-time
  screenshot QA, **27 items, ALL unchecked**, owner-gated
  wording verified line-by-line before commit (no live
  claims anywhere in the document). Plus
  `docs/campaign-builder-next-summary.md` committed
  (`12cf874`): the item-by-item CN1–CN12 audit table with
  honest limits and the deploy checklist.

## Closing gates (THIS run, 2026-10-15, final tree)

| Gate | Result |
|---|---|
| API jest, SERIALLY (`--runInBand`, `NODE_OPTIONS=--max-old-space-size=4096`) | **336/336 suites, 3351/3351 tests — ALL PASS** (179.7 s) |
| Web vitest | **39 files, 260/260 PASS** |
| API tsc `--noEmit` | **0 errors** (exit 0) |
| Web tsc `--noEmit` | **0 errors** |
| Prisma validate | **valid** |
| Fresh Postgres 16, full sequence (`prisma migrate deploy` on throwaway DB `nb5_fresh`) | **160/160 migrations applied clean**, last = `20261013850000_cn11_governance`; 214 public tables; throwaway DB + role dropped after the run |
| Monorepo build (`pnpm -r build`, scope 7 of 8 projects) | **green, exit 0** (7/7 Done, incl. web + admin) |

Failure decomposition: **none required.** The serial run had
zero failed suites and zero failed tests — the known
cx3-debounce flake did not appear, and no worker was
SIGKILLed. The two suites that died by OOM in the lost
parallel attempt (`ec29-gift`, `cb6-cross-platform`) both
PASSED inside this serial full run, consistent with the
earlier diagnosis that the parallel-worker OOM — not the
code — killed them. Resource discipline was observed
throughout the restart: heavy steps (jest, migrate deploy,
build) were never run concurrently with heavy jobs in other
worktrees (the B10/B11 gates in `ai-marketing-saas-next`
were checked via `ps` before each heavy step).

## Honest limits

- **NOTHING is live-proven.** No CN1–CN11 surface has
  touched a real Meta / Google / TikTok account; all
  evidence is spec/fixture in the sandbox.
- **CN12 is NOT done** — only its local checklist shipped.
  All 27 items remain unchecked and owner-gated: they need
  the campaign-next build integrated + deployed (owner's
  push instruction + Dokploy Redeploy), the CN migrations
  run on the real DB, and the owner's real Meta / Google /
  TikTok accounts. This is the campaign track of the M30
  sprint.
- **Migration `20261013850000_cn11_governance` has NOT run
  on any real DB** — fresh-Postgres proof only (as with all
  CN migrations `20261013810000`–`20261013850000`).
- **No screenshot QA** — CN10's design surfaces are
  unverified visually; the QA items sit in the CN12
  checklist and require the deployed build.
- **Push is owner-gated.** This batch, like the whole
  CN1–CN12 package, sits in local commits only; integration
  with the other pending lines (union fresh-PG check
  mandatory) and any GitHub push wait for the owner's
  explicit instruction.

## Commits (NB5, this worktree)

| Commit | Subject |
|---|---|
| `28269c3` | NB5 mini-fix: full-field copy parity via shared copy helpers |
| `d304dad` | CN11 governance (migration `20261013850000`) |
| `e31ad0e` | CN10 `.cbx-*` campaign design primitives |
| `1ea8dc3` | CN10 builder guided steps + sticky rail + CN11 governance UI |
| `c6d428b` | CN10 hub v2 |
| `95f8a9f` | CN12 live verification checklist (27 items, all unchecked) |
| `12cf874` | docs: Campaign Builder Next program summary (CN1–CN12 audit) |
| (this doc) | NB5 acceptance |
