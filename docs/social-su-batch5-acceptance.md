# SU Batch 5 Acceptance — SU9 Collaboration + SU10 Health/Failure + SU11 Redesign

**Package:** Social Posts Update (SU1–SU12), Batch 5 of 6 — plan:
`docs/social-posts-update-plan.md` (Batch 5: SU9 + SU10 + SU11).
**Branch/worktree:** `su-package` in `~/workspace/ai-marketing-saas-su`
(base Batch 4 HEAD `cd83d8d`). **LOCAL COMMITS ONLY — nothing pushed.**
**Migration (one, shared by the batch):**
`20261013440000_su9_su11_collab_health` — hand-written, fully
additive (`SocialPostNote`, `SocialPostVersion` tables;
`SocialPost.assignedUserId`; `Organization.socialApprovalTwoStep`
default false; `SocialAccount.healthCheckedAt`). Verified free in
every parallel worktree before use; SU range cap 20261013499999
respected.

## Commits (9)

| Commit | Scope |
|---|---|
| `275a97a` | SU9 schema + the batch migration |
| `8747021` | SU9 API: notes, versions, timeline, assign, two-step |
| `e8597cc` | SU9 specs (24) + SP7 settings expectation gains the new field |
| `915d3cb` | SU10 prep: Meta identity call + token-resolver flag |
| `5ab3940` | SU10 API: `SocialHealthService` (health, failures, retry) |
| `94c3c9d` | SU10 specs (18) |
| `1630e7f` | SU11 API: cursor pagination, bulk, CSV import + specs (19) |
| `503c873` | SU11 web: component split + 5-tab workspace (pure move) |
| `32e09c3` | SU11 web: SU9/SU10 surfaces, pagination/bulk/CSV UI + vitest (7) |

## SU9 — Collaboration v2

- **Internal notes** (`SocialPostNote`): GET/POST
  `posts/:id/notes`, DELETE `posts/:id/notes/:noteId`. Empty body →
  Bengali 400. Delete: the author (any write role) or OWNER/ADMIN;
  another writer gets 403. Notes live in their own service path —
  spec-proven separate from every publish/platform path; a note can
  never reach a platform.
- **Version history** (`SocialPostVersion`, unique
  `[socialPostId, versionNo]`, snapshot
  `{caption, linkUrl, mediaRefs, firstCommentText}`): a snapshot is
  written on post creation (kind `create`, via the shared
  `createPostRow`, so group variants and SU4 plan materialization get
  one too), on content edits only (kind `edit` — a no-change or
  non-content edit writes nothing, spec-pinned), and on restore
  (kind `restore`). Recording is failure-isolated/model-optional so
  older fake-Prisma specs never break on it.
  **Coverage limit:** `clonePost`, SU8 `derivePost`, commerce
  auto-drafts, the recurrence next-occurrence copy and the evergreen
  recycle copy create `SocialPost` rows directly and get **no**
  version-1 snapshot (clone's no-version behaviour is spec-pinned).
- **Restore** (`POST posts/:id/versions/:versionId/restore`):
  editable statuses only (draft — published/scheduled/publishing
  refuse with Conflict, the updatePost convention). Applying a
  snapshot writes a `restore` version and resets approval exactly
  like a content edit (SP7 rule, audit carries
  `approvalReset: true`).
- **Timeline** (`GET posts/:id/timeline`) — sources, stated plainly:
  versions and notes come from their own tables; **approval events
  come from real AuditLog rows** (the social module writes approval
  audits consistently with `entityType: "SocialPost"` +
  `entityId = post.id` — submitted / approved / manager_approved /
  rejected). Only when a post has **no** approval audit rows at all
  does the timeline fall back to **one derived entry** from the post
  row's current approval fields, marked `meta.derived: true` — it
  shows the current state, never an invented history. Publish events
  come from `publishedAt`/`platformPostId`; a post that was never
  published but has attempts shows the last attempt (attempts count +
  verbatim error) timestamped with `updatedAt`, because attempts
  carry no timestamp of their own (noted in code).
- **Assign**: `SocialPost.assignedUserId` + `POST posts/:id/assign`
  (write roles). A non-null assignee must be an **ACTIVE member of
  the org** (the existing membership lookup discipline), else
  Bengali 400; `null` unassigns; audited. `GET posts` gains an
  `assignedUserId` filter (only when supplied) and the serializer
  returns the field.
- **Two-step approval** (`Organization.socialApprovalTwoStep`,
  default FALSE): OFF reproduces the SP7 one-step behaviour exactly
  (regression-pinned). ON: `pending → manager_approved` (audit
  `social.post_manager_approved`, step-1 actor in `reviewedById`,
  author **not** notified as approved yet) `→ approved` (normal
  path, author notified). Reject works from either step (note
  required, as before); submit from `manager_approved` refuses with
  Conflict. **Every gate — schedule, publishNow and the worker —
  still accepts only `"approved"`**; `manager_approved` is blocked
  in all three, spec-pinned. Decision (documented in code): an
  OWNER/ADMIN-authored post still auto-approves fully even with
  two-step ON — the author is already in the approver class.

## SU10 — Account Health + Failure Center

- **Health check** (`POST accounts/:id/check-health`, OWNER/ADMIN;
  new `SocialHealthService`):
  - *Meta:* the existing `SocialPublishService.resolveAccountToken`
    seam, then `MetaSocialPublisher.getAccountIdentity()` —
    `GET /{externalId}?fields=id,name`, verbatim Graph errors.
    Because the seam only serves `connected` accounts, it gained an
    optional `allowErrorStatus` flag used **only** here — without it
    an `error` account could never be re-validated back to health;
    the default path is byte-identical.
  - *TikTok/YouTube:* `SocialOAuthService.ensureAccessToken` is the
    check; the resolver's thrown error is the result.
  - `healthCheckedAt` stamps on **every** attempt, success or
    failure (it records when checking happened). Success: an
    `error` account recovers to `connected` with `lastError`
    cleared; a connected account is unchanged. Failure returns
    `{ ok: false, …, error: "…: <verbatim>" }` (no throw):
    token-death marks the account exactly as the existing publish
    path does (Meta `isTokenDeadError` → status `error`,
    `lastError` verbatim; OAuth refresh-death is already marked by
    the resolver itself — the service re-reads the row instead of
    double-marking). A non-token failure changes neither status nor
    `lastError`. Disconnected accounts are refused by the seam
    before any platform call.
  - Scope limit: the check proves **identity/token validity only**.
    The plan's Graph permissions inventory and token-expiry
    forecasting were not built in this batch.
- **Health list** (`GET accounts/health`): per account
  `{ id, platform, name, status, lastError, healthCheckedAt,
  health }` with an explicit serializer (no credential, integration
  or external-id material — spec-checked). Label
  (`deriveSocialAccountHealth`, SP/AD3 style):
  `healthCheckedAt` null → `never_checked` (takes precedence);
  status `error` → `error`; otherwise `ok`.
- **Failure center** (`GET posts/failures`): failed posts grouped
  by **normalized signature** = the error's first line, trimmed,
  whitespace collapsed; group =
  `{ signature, count, latestAt, postIds, accountIds }`, sorted
  count desc then latestAt desc. A failed post with no recorded
  error lands in an honest `"(no error recorded)"` bucket.
  **Limit:** no pagination and no cap — every failed post of the
  org is returned (assumes the failed count stays small; noted in
  code).
- **Retry** (`POST posts/:id/retry`, write roles): non-failed →
  Bengali 400. If `attempts >= MAX_PUBLISH_ATTEMPTS (3)`, the human
  retry resets attempts to 0 with audit
  `social.post_retry_attempts_reset` (previous count in metadata);
  attempts remaining → no reset. Because `publishNow` accepts only
  draft/scheduled, the failed post is first returned to `draft`
  (the worker's blocked→draft precedent — an approval-gate refusal
  therefore leaves the post as a draft, never half-published), then
  the call **delegates to `SocialPublishService.publishNow`**: the
  approval gate and SU1 pre-flight apply there and their errors
  propagate verbatim (spec-proven). No second publish logic exists.
- **Alerts:** no new channel was built. Verified in code: SP5's
  `SocialPublishService.notifyFailed` already sends an
  `AgentNotification` (`social_post_failed`) to ACTIVE OWNER/ADMIN
  members on terminal failure, failure-isolated. The plan's
  additional "repeated same-cause failure → Telegram/email (org
  setting)" escalation was **not** built in this batch.
- **Connect Center discipline kept:** health lives only on the
  `SocialAccount` side; no connection rows were read or written and
  no separate connect UI was added.

## SU11 — Page Redesign + Pagination + Bulk/CSV

- **API pagination** (`GET posts`, IN9 discipline): supplying
  `limit` or `cursor` switches to `{ items, nextCursor }`; without
  them the response is the previous bare array, byte-identical
  (regression-pinned). Canonical order is the existing
  `createdAt desc` + `id desc` tiebreak; the cursor is base64url
  JSON `{ createdAt, id }`; a **malformed cursor yields the first
  page, not a 400** (the IN9 rule, spec-pinned). All existing
  filters (status/accountId/assignedUserId, plus a new `q` caption
  search) compose in cursor mode too.
- **Bulk** (`POST posts/bulk`, write roles, declared before
  `posts/:id`): `delete_drafts` deletes drafts only, `reschedule`
  moves draft/scheduled posts — each item passes the approval gate
  (same message as `schedulePost`) and the SU1
  `validateForPlatform` pre-flight, failures are per-item Bengali
  errors. Empty ids / >100 ids / unknown action / missing, invalid
  or past `scheduledAt` for reschedule → whole-request Bengali 400.
  Ids are deduped; exactly **one** audit row (`social.posts_bulk`)
  carries the counts.
- **CSV import** (`POST posts/import-csv`, write roles): raw stream
  body (the upload-file discipline, 5 MB cap) parsed by a pure
  parser (`social-csv.ts`: quoted commas/newlines, `""` escapes,
  CRLF, BOM, blank-line skip). The `caption` column is required;
  row cap 200. Per-row outcomes `{ row, ok | error }`: empty
  caption → error; **accountId missing, unknown or disconnected →
  error — no default account is ever substituted**; `linkUrl` is
  taken verbatim. Successful rows are created through `createPost`
  (so they receive the SU9 version snapshot, spec-proven) and are
  **always drafts in v1: a valid `scheduledAt` column is validated
  for format but never schedules the row** (stated in the UI too).
- **Web redesign:** the 3,306-line page is now a **5-tab
  workspace** — Composer / Posts & Calendar / Library / Analytics /
  Settings & Accounts — with **every panel kept mounted** (CSS
  hidden, never unmounted), so switching tabs cannot lose composer
  state (the Messaging-redesign condition). `page.tsx` (~1,900
  lines) keeps all state/handlers and passes a typed
  `SocialPageCtx` to panels under
  `dashboard/social-posts/components/` (Composer, Library,
  Analytics, Posts, Settings + shared types/MediaThumb). The
  Library panel renders both in the Library tab and in the
  composer's media picker, as before.
- **SU9 web:** post detail gains notes (add; delete shown only on
  one's own notes — the API also allows OWNER/ADMIN deletes, the UI
  simply doesn't surface that path), the version list with
  restore-on-draft, the timeline, and **assign via a real member
  select** (`GET /organizations/:id/members`, the inbox/team
  pattern — no id typing needed) with unassign. The
  `manager_approved` state has its own badge ("Manager ধাপে
  অনুমোদিত — চূড়ান্ত অনুমোদনের অপেক্ষায়") and appears in the
  approval queue; Settings gains the two-step toggle.
- **SU10 web:** a Health & Failures panel in Settings & Accounts —
  health pills (`never_checked/ok/error`), a per-account
  check-health button, failure groups (signature, count, latest)
  and a per-post retry button with the outcome surfaced as a
  notice.
- **Pagination/bulk/CSV UI:** the list loads in cursor mode
  (limit 50) with a load-more button; changing the status/account
  filters reloads from page 1 (those filters are now server-side;
  caption text search stays client-side, as before). **Trade-off,
  stated plainly:** Calendar/Queue now render the loaded (filtered,
  paged) set instead of the previous all-posts-up-to-200 set;
  load-more reaches the rest. Bulk selection with a delete-drafts /
  reschedule bar reports a per-item summary (up to two verbatim
  reasons) in the notice. CSV import sits in the Composer tab and
  lists per-row results.
- **Zero feature loss (counted, MS-redesign method):** every API
  endpoint string of the old page — **67/67** — is present in the
  new tree (82 total with the SU9/SU10/SU11 additions), and every
  UI label fragment — **504/504** — is present (585 total with
  additions). Nothing was removed; only moved or added.

## Specs

- API new: `social-su9.spec.ts` **24** (notes matrix, version
  hooks/restore, timeline sources & order, assign, two-step matrix
  + OFF regression), `social-su10.spec.ts` **18** (Meta/OAuth
  health paths, labels, failure grouping, retry matrix),
  `social-su11.spec.ts` **19** (cursor walk/regression, bulk
  matrix, CSV parser + import matrix). One existing spec changed:
  `social-sp7.spec.ts`'s settings expectation gains
  `socialApprovalTwoStep: false` (the response genuinely grew; all
  behavioural assertions unchanged).
- Web new: **7 vitest** (`social-posts-su11` helpers — bulk summary
  and friends). Totals below.

## Gates (coordinator-run on the final tree, 2026-10-13)

- **API jest FULL** (`NODE_OPTIONS=--max-old-space-size=4096`,
  `--runInBand`): **320 suites / 3206 tests** — base was 317/3145;
  the +3 suites / +61 tests are exactly SU9 (24) + SU10 (18) +
  SU11 (19). **One failure: the known `cx3-debounce` flake**
  (expected "কটন শাড়ি" in a batched inbox auto-reply; the spec is
  timing/product-match sensitive and untouched by this batch) —
  standalone re-run **18/18 PASS**. This flake predates the SU
  package; its root cause remains an open item from the CX package.
- **Web vitest FULL:** **41 files / 315 tests, ALL PASS** (308 base
  + 7 new).
- **tsc:** API 0, web 0, admin 0. **Prisma:** validate 🚀 valid.
- **Monorepo build:** `pnpm -r build` green, exit 0 (7/7
  packages).
- **Fresh-Postgres migration sequence:** throwaway PostgreSQL 16
  cluster, `prisma migrate deploy` from this tree —
  **150/150 applied (149 through Batch 4 + 1 new), 0 unfinished /
  rolled back, 199 public tables** (verified in
  `_prisma_migrations`, not just the CLI tail; +2 tables =
  `SocialPostNote`, `SocialPostVersion`).

## Honest limits

- **No live platform call of any kind** was made: health checks are
  proven at the stubbed-fetch / stubbed-resolver boundary, Meta
  publish paths at the stubbed Graph boundary, exactly like every
  earlier batch. SU0/SU12 live verification (a real Meta health
  check, a real failed-post retry, real accounts) is still owed.
- The batch migration has **not run on any real database**; it
  applies via `prisma migrate deploy` at deploy time.
- Health proves token/identity validity only — no Graph
  permissions inventory, no token-expiry forecast (see SU10).
- The repeated-failure Telegram/email escalation from the plan was
  not built; the SP5 `AgentNotification` remains the only failure
  alert.
- Timeline approval history depends on AuditLog rows: posts whose
  approvals predate consistent audit writing show the single
  derived current-state entry instead of a history.
- Failure-center list is unbounded (no pagination/cap) by design
  for now; CSV import never schedules in v1; version snapshots do
  not cover clone/derive/auto-draft/recurrence/evergreen copies.
- **No screenshot QA** of the redesigned page (no live app in the
  sandbox) — that is SU12's work, with the rest of live
  verification. Nothing in this batch is pushed; push stays
  owner-gated as always.
