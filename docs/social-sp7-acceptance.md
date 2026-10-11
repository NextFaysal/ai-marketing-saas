# SP7 Acceptance — Post Insights + Approval Flow

**Status:** Delivered (local commit only — nothing pushed). Batch 4 of the Social Posts package; SP7 completes the package (SP1–SP7).

## Migration

`20261010950000_sp7_insights_approval` — hand-written additive SQL (repo convention):

- `SocialPost` + `insights JSONB` (nullable), `insightsFetchedAt TIMESTAMP(3)` (nullable), `approvalStatus TEXT`, `submittedById TEXT`, `reviewedById TEXT`, `reviewNote TEXT` (all nullable; null approval = no approval state).
- `Organization` + `socialRequireApproval BOOLEAN NOT NULL DEFAULT false`.

Written but **not applied in the sandbox** (no Postgres exists here — see the evidence ceiling); it applies via `prisma migrate deploy` on the owner's server.

## Part A — Published-post insights

Model: `SocialPost.insights` stores the platform's numbers **exactly as returned**, tagged with the producing platform/shape. A metric the platform does not return stays **ABSENT** from the stored object — never 0, never estimated (spec-proven: a Page response without `shares` stores an object with no `shares` key).

Field sets as implemented:

| Platform | Source call(s) | Stored keys (only when returned) |
|---|---|---|
| Meta Page post | `GET /{postId}?fields=reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares` | `platform:"meta_page"`, `reactions`, `comments`, `shares` |
| Instagram media | `GET /{mediaId}?fields=like_count,comments_count` + `GET /{mediaId}/insights?metric=…` | `platform:"instagram"`, `likeCount`, `commentsCount`, + `impressions`/`reach`/`saved` (image) or `reach`/`plays`/`saved` (video/Reels) |

Implementation notes:

- Fetch methods live on `MetaSocialPublisher` (`getPagePostInsights`, `getInstagramMediaInsights`) — the SP6 publisher home — and the sealed Page token comes from `SocialPublishService.resolveAccountToken`, extracted from the SP6 publish path so there is exactly ONE decrypt plumbing (SP5/SP6 suites prove the refactor is behaviour-identical).
- The IG `/insights` edge refuses metrics it does not support for a media type; that refusal does **not** discard the media-object counts that were returned (those metrics simply stay absent). A dead token still propagates from that edge so the account gets marked.
- `POST social/posts/:id/refresh-insights` (WRITE_ROLES): only for `status=published` with a `platformPostId`, else an honest Bengali 400. Platform errors surface **verbatim** as 400s; token-death (SP6's `isTokenDeadError`) additionally marks the account `status="error"` with Meta's verbatim message. A permission error is NOT token death — spec-proven the account stays `connected`.
- `POST social/posts/refresh-insights` (bulk): the org's published posts of the **last 30 days**, newest first, bounded at 100, **sequential**. Posts published **< 1 hour ago are skipped** (`skipped_too_new`) — Graph numbers for a brand-new post are still settling and would mislead; this is a deliberate, documented choice. Per-post results (`refreshed` / `failed` + verbatim error / `skipped_too_new`); one failure never fails the batch; exactly one audit row (`social.insights_bulk_refreshed`) carries the counts.
- `GET social/insights/summary`: per-metric totals computed **only over posts that HAVE that metric**, each total carrying its own basis count (`{ total, posts }`) — no averages over missing data. UI shows "যেসব post-এর data এসেছে তার ভিত্তিতে"; a post with no insights shows "এখনো data আসেনি", never zeros.
- **Best-time rule as shipped** (pure function `computeBestTime`, unit-tested): engagement per post = Page `reactions+comments+shares` / IG `likeCount+commentsCount`, **using only fields present** (a post with none of its platform's engagement fields does not count at all). Posts are bucketed by weekday+hour of `publishedAt` **in the organization's timezone** (Intl), bucket score = summed engagement. The top bucket is returned **only when ≥ 10 published posts have insights** (`postsConsidered >= 10`); below that the API returns `bestTime: null` and the UI shows "পর্যাপ্ত data নেই — অন্তত ১০টি post-এর data লাগবে". The UI labels it verbatim: "আপনার নিজের post-এর data থেকে আনুমানিক পরামর্শ — নিশ্চয়তা নয়". Ties resolve deterministically (earliest weekday, then hour).

## Part B — Approval flow

Setting: `Organization.socialRequireApproval` (default **false**), read via `GET social/settings`, written via `PATCH social/settings` (**OWNER/ADMIN** only, audited `social.settings_updated`). While the setting is **OFF**, behaviour is exactly pre-SP7: `approvalStatus` stays null everywhere (spec-proven regression: MM post schedules fine with null approval state).

Rule set as implemented (v1, also stated in plain language in the UI):

- **Approvers = OWNER/ADMIN only.** Decided via the M72 model: the `social` area's `minRole` (MARKETING_MANAGER) governs who can *write* posts, not who may *approve* them — a MARKETING_MANAGER cannot approve, not even their own posts (service-level 403, spec-proven; approve/reject sit behind WRITE_ROLES at the controller and the approver check in the service).
- **OWNER/ADMIN-authored posts are auto-approved** — at creation, and an approver's submit approves immediately (`social.post_approved` audit with `autoApproved: true`). Everyone else's post starts with no approval state.
- **Submit** (`POST social/posts/:id/submit-approval`): draft-only; sets `approvalStatus=pending`, `submittedById`, clears reviewer fields; notifies all ACTIVE OWNER/ADMIN (`social_post_pending_approval`, per post, failure-isolated). Submitting while the setting is off is an honest Bengali 400.
- **Approve** (`POST .../approve`): pending-only (else 409); sets `approved` + `reviewedById`; notifies the author (`social_post_approved`).
- **Reject** (`POST .../reject`): pending-only; a **note is required** (blank → Bengali 400); stores `reviewNote`; notifies the author **with the note** (`social_post_rejected`). Submit/approve/reject/setting-change are all audit-logged.
- **Blocks**: a post that is not `approved` while the setting is on cannot be scheduled (`schedulePost` → 409 Bengali) and cannot be published by hand (`publishNow` → 409 before any claim). **The publish worker re-checks at claim time** against a fresh row: a due post whose approval was revoked (or never existed) is returned to **draft** with the reason written onto the post ("অনুমোদন না থাকায় পোস্টটি প্রকাশ হয়নি…"), counted as `blocked` in the run result — never a silent skip, never published. (SP7 extended the `runDuePublishes` result with `blocked`; the two SP5 exact-shape assertions were updated with a comment, per the package's established practice for intended contract changes.)
- **Content edits void approval**: editing caption/link/media of a post carrying `pending`/`approved`/`rejected` (setting on) resets its approval state to null — the approval was for the reviewed text. Audited with `approvalReset: true`.
- Turning the setting ON therefore also gates previously-scheduled unapproved posts at their claim time (they return to draft with the note above) — the honest consequence, stated here rather than discovered in production.

UI (Social Posts page): insight chips on published posts with "সর্বশেষ হালনাগাদ" + per-post refresh; performance strip with basis-labelled totals + bulk refresh with a result summary; best-time card with the verbatim heuristic label or the not-enough-data line; settings toggle with the rule explained in plain Bengali; approval badges (pending/approved/rejected + the rejection note); "অনুমোদনের জন্য পাঠান" on eligible drafts; an approval queue with approve / reject-with-note (client-side note validation mirrors the server rule). Controls render for all write roles and the API enforces (403 surfaces as the page's error) — the page has no client-side role source, matching its existing convention.

## Evidence — ceiling stated plainly

**No live HTTP and no live Graph call**: the sandbox has no Postgres binary at all, so the migration is written but unapplied locally (it applies via `prisma migrate deploy` on the owner's server), and no real Meta app/Page token exists here — a real insights response has never been seen by this code. Evidence is the boundary the package has used throughout: stub-fetch Graph fixtures at the publisher boundary + service-level fake-Prisma specs + full suites + build.

- New spec file `social-sp7.spec.ts`: **27 tests** (insights stored-exactly / absent-stays-absent, per-type IG metric selection, insights-edge refusal, verbatim errors, token-death marking, bulk window/skip/isolation/order, summary basis counts, best-time threshold + tz bucketing, the full approval matrix incl. worker re-check and the setting-off null regression).
- API: **1277/1277 pass, 160 suites** (SP5/SP6 suites green after the token-plumbing extraction).
- Web: **72/72 pass, 8 files** (60 pre-existing + 12 new pure-helper tests in `lib/social-post-insights.test.ts`).
- Monorepo build: **green** (all packages).
- Nothing was pushed; no git operation touched the GitHub remote.
