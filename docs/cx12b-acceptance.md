# CX12b — Auto Review Request (+ owner report email copy) — Acceptance

**Status: DELIVERED (local commit only — NOT pushed).**
Migration: `20261012140000_cx12b_reviews` — creates `OrderReview`, adds `InboxSetting.reviewRequestEnabled` (default **false**) + `reviewRequestDelayHours` (default 24), adds `AIProactiveSetting.dailyReportEmailEnabled` (default **false**). Written but not applied locally (sandbox has no Postgres); applies via `prisma migrate deploy` on the owner's server.

## Trigger — both delivery paths, zero producer edits

`ReviewsService` (orders/) subscribes in its constructor to the existing event bus (the ConversionsService pattern):

- `order.delivered` — the order-status path (manual status PATCH and every store/chat order upsert pass it), and
- `shipment.status_changed` with `shipmentStatus === "delivered"` — the courier-sync path (a shipment delivery does **not** change the order's status, so this is the only signal there). `partial_delivered` deliberately does not trigger a review ask.

Guards: the org must have opted in (`reviewRequestEnabled`), the order is re-read org-scoped, and `OrderReview.orderId` is UNIQUE — a double delivery event (both hooks can fire for one delivery) creates exactly **one** row.

## The pending_send rule (the honest rule, as implemented)

A row is created at delivery with status **`pending_send`**. The sweep marks it `requested` **only after a confirmed send** on a real channel. Orders with no reachable channel stay `pending_send` **forever** — visible as "এখনো পাঠানো হয়নি" in the org's review list — never marked sent, never dropped, retried by every sweep run. No phantom "requested" state exists anywhere.

## Sweep + channels

New job type **`review_request_sweep`** (JOB_TYPES + template, org, 60-minute default interval). Both new Automations form entries (`courier_auto_sync` from CX6 and `review_request_sweep`) are included in THIS commit, ported onto the merged owner page structure (HEAD's `JOB_TYPES_BY_TARGET` org list, +2 lines exactly) — the earlier working-tree versions sat on the pre-merge page base and were deliberately not wholesale-staged. `runReviewSweep(orgId, sender)` sends rows whose `deliveredAt` + the org's delay (0–168h, default 24) has passed, bounded at 100/run, per-row failures isolated and counted (`{ checked, sent, stillPending, failed }`; disabled org → `{ skipped: "review_requests_disabled", ... }`).

Channel precedence is CX6's: **conversation → SMS → email**. Chat asks via `sendAutomatedMessage` (tag `review_request`) and explain the digit reply; SMS/email carry the public review link (`/review/<reviewToken>`, token on the row, CX6 credential pattern). Unconfigured SMS/SMTP is skipped silently (one log line). ReviewsService takes the inbox as a structural sender interface — OrdersModule never imports InboxModule, so there is no module cycle.

## Capture semantics (chat)

Placed in the ingest chain immediately after the CSAT capture, with the same consume semantics (a captured reply does not flow to the order bot / autopilot):

- **Rating:** the customer's reply is EXACTLY one digit — Latin `1-5` or Bengali `১-৫`, nothing else — within **7 days** of the ask, while no rating exists yet. "5 star", "৫/৫", "ভালো 5" are **not** ratings; they flow on as normal messages. The parser (`parseReviewRating`) is deliberately tiny, with a full matrix spec.
- **Comment:** ONE free-text reply within **24 hours after the rating** is stored as the comment (and consumed). The window is short on purpose — the customer was just asked for feedback; a later message is a new enquiry and flows normally. A second digit after a rating never overwrites it and is never stored as a comment.
- After rating + comment (or the comment window passing), all messages flow normally again.

## Public review page

`GET/POST public/review/:token` + web page `apps/web/src/app/review/[token]` (5-star form + optional comment, white-label branding). One rating per link: the page renders an existing review read-only and the API refuses a second submit with an honest message — the first answer stands. Invalid rating (not an integer 1–5) → 400; unknown token → 404.

## Surfaces

- **Orders page:** a "⭐ গ্রাহক রিভিউ" section with a rating filter (৫★…১★, plus "এখনো পাঠানো হয়নি" / "রিভিউ চাওয়া হয়েছে" status filters), and the order action panel shows that order's review (stars, comment, dates, honest pending state, source মাধ্যম: চ্যাট/লিংক).
- **Customer 360:** the customer's received reviews (stars + order + comment + date) in the detail view.
- **Settings:** Inbox settings gains the opt-in toggle + delay hours (validated 0–168 at the DTO and service boundaries). Reviews list API: `GET organizations/:id/reviews?rating=&customerId=`, org-scoped, with order number + customer name resolved.

## 12e completion — daily report email copy

`ProactiveService.runDailyBriefing` gains an optional **email copy**: when the new org setting `dailyReportEmailEnabled` is ON (default OFF; toggle on the AI page's Proactive card + DTO field), each OWNER/ADMIN recipient ALSO gets the same briefing by email via `EmailProvider`. The in-app notification remains the **primary** path. The copy is sent only when SMTP is actually configured and only in a run that really created in-app briefings (so the per-day dedupe governs the copy too); recipients without an email are skipped; a rejected send is counted as not sent (`emailsSent` in the result + audit metadata) — delivery is claimed only when SMTP accepted the message (provider returned).

## Tests

`apps/api/src/orders/cx12b-reviews.spec.ts` (16 tests): parser matrix; disabled-by-default (no rows); one-row guarantee under double events (both hooks); shipment-path trigger + in_transit silence + cross-org silence; sweep gating (disabled / not-yet-due / dedupe), chat ask content + link, SMS link (source "link"), channel-less → stays pending_send; capture matrix (Bengali digit, comment window, second digit, 7-day expiry, 25h comment expiry); public page data + submit + double-submit refusal + 400/404; list org-isolation + filters + label resolution; job registration; proactive email gating (opt-in+SMTP → 1 copy, in-app still created; unconfigured → 0 copies, in-app still created; default-off → 0).

## Evidence ceiling (stated plainly)

Sandbox has no Postgres and no live chat/SMS/SMTP: every send is proven ONLY via fake providers at the send seams; no real customer message or owner email was sent or is claimed. The ingest hook is covered by the capture specs at the service seam + the full suite; it was not exercised against a live Meta webhook in the sandbox.
