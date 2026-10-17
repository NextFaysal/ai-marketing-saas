# Messaging Advanced (MX1–MX16) — Package Summary

তারিখ: 2026-10-16 · Worktree `~/workspace/ai-marketing-saas-mx`,
branch `messaging-advanced`. Base `4ac7f23c` (tree byte-identical
to GitHub main `17a2c27`, the GC-stack release, 211 migrations).
Plan: `Messaging-Advanced-Plan-2026-10-16.md` (owner-approved in
full, 2026-10-16).

**Status: CODE-COMPLETE — local commits only, NOTHING has been
pushed.** No MX feature has any live provider proof; all 15 MX
migrations are proven only on fresh scratch Postgres clusters,
never on a real DB. Live proof is owner-owed (push instruction →
Dokploy Redeploy → per-org job enablement → M30-style sessions);
the concrete checklist is
[mx-live-verification-checklist.md](mx-live-verification-checklist.md),
ALL UNCHECKED.

## Totals

- **62 commits** from base `4ac7f23c` to the final HEAD: MB1 11 ·
  MB2 16 · MB3 12 · MB4 5 · MB5 7 · MB6 items 9 · MB6 batch doc 1 ·
  this close-out 1.
- **15 migrations** (range `20261019000000+`, after TD's
  `20261018000000+`), all additive; the union is **226**
  migrations, fresh-Postgres-proven end to end.
- **Final gates** (MB6 finisher run, serial): API jest **503
  suites / 5,694 tests — 5,692 passed**, the only failures being
  the two pre-existing, base-adjudicated ones (`cc26-payout-
  automation`, `adx3-nav-counts`); API tsc clean; web vitest
  83 files / 706 tests all pass; web tsc clean; Next build green
  (93/93 pages); prisma validate valid; fresh-PG migrate deploy
  **226/226**, 326 public tables.
- Gate progression across the package (API jest suites/tests ·
  fresh-PG): MB1 483/5,430 · 214 → MB2 489/5,498 · 216 → MB3
  493/5,543 · 219 → MB4 495/5,585 · 221 → MB5 501/5,649 · 224 →
  MB6 503/5,694 · 226. At every batch the sole failure was cc26
  (adx3 joined it at MB5, base-proven there), and every batch's
  delta was exactly its own items' new specs.

## Item-by-item audit (MX1–MX16)

| Item | Verdict | Batch doc | What landed — and the limit that matters most |
|---|---|---|---|
| MX1 Recipient table & scale engine v2 | **Shipped** | messaging-mb1-acceptance.md | `BroadcastRecipient` is the primary store; streaming resolver, chunked writes, dedupe, derived counters, resume sends only `pending` rows (never re-sends a confirmed delivery). Plan cap is a policy refusal, no longer a Json-size ceiling. Legacy snapshot broadcasts run the old engine unchanged. |
| MX2 Channel routing & fallback cascade | **Shipped** | messaging-mb1-acceptance.md | Org-ordered cascade over email/sms/whatsapp; every attempt a linked `MessageDelivery` row; honest SMS multi-gateway extension (new sealed config table — the old schema allowed ONE SMS config) + circuit breaker surfaced in the report; cheapest-first only from org-entered rates (missing rate ⇒ org order + a named note). Limit: cascade exists only on recipient-table broadcasts; resolution stays primary-channel. |
| MX3 Transactional/marketing separation | **Shipped** | messaging-mb1-acceptance.md | Per-org sweep caps + org-timezone quiet hours deferring marketing only (sweep/manual/resume/retry all pass the one gate); transactional exemption PROVEN (OrderNotification/Shop OTP never touch the broadcast engine; zero transactional lines changed); read-only transactional overview in Messaging. Limits: no priority queue (separation was already structural), no per-channel throttle, no recipient-local quiet hours (no such field exists). |
| MX4 Visual journey builder | **Partial** | messaging-mb2-acceptance.md | Journeys are ordinary Workflows (journey meta) — NO second engine; structured visual flow editor in the Messaging page; per-step stats from real run logs; exit-on-purchase at resume time. NOT BUILT: free-drag canvas; opened/clicked journey conditions — existing MS5/MS7 specs PIN workflow sends as never-rewritten, the pin was respected (the schema half landed, so a future pin-revisit needs no migration). |
| MX5 Drip & lifecycle presets v2 | **Partial** | messaging-mb2-acceptance.md | Welcome / post-purchase / replenishment (fixed 21-day default, copy says NOT consumption-derived) / win-back / anniversary / abandoned-browse as editable multi-step journeys; scan enrollment in the engine's existing 5-minute scan; MS8 presets byte-identical (spec-pinned parity). NOT BUILT: birthday preset — no date-of-birth field exists on Customer or Lead; shown as unavailable with its reason. |
| MX6 Two-way & interactive campaigns | **Partial** | messaging-mb2-acceptance.md | Keyword + poll campaigns on WhatsApp — the codebase's ONLY real inbound path (button/interactive replies arrive as parsed text, same matcher); STOP/START is exclusive (campaign matching never runs after it); auto-replies only with a real platform message id; AI classification is a stored SUGGESTION — confirming an opt-out suggestion never writes a suppression (spec-pinned); WhatsApp deliveries gained a real `conversationId` bridge to the Inbox. NOT BUILT: keyword campaigns on SMS/email/Messenger (no inbound path exists); Inbox conversation deep-link (the inbox page has no URL selection mechanism — plain link shipped). |
| MX7 Drag-drop email builder & content library | **Shipped** | messaging-mb3-acceptance.md | Real block model rendering into the SAME body/htmlBody the send path already uses (pre-MX7 templates byte-identical, spec-proven); product/coupon slots fill only from real `Product`/`StoreDiscount` rows; content library; template versioning with `Broadcast.templateVersion` stamped; brand kit extended on the Organization row (the existing central place — no second store); festival packs (Eid/Puja/Pohela Boishakh/winter) contain NO baked-in prices or codes (spec-asserted). |
| MX8 Per-recipient dynamic personalization | **Shipped** | messaging-mb3-acceptance.md | Unique per-recipient coupons as real single-use `StoreDiscount` rows (the platform `Coupon` model was rejected with evidence — global/plan-scoped, SaaS-checkout only); resume idempotency spec-proven two ways (no second coupon ever); deterministic recommendations (latest purchased category → in-stock catalog; identified browsing second; honest fallback/nothing); loyalty/gift-card variables READ-ONLY. Limit: API-only configuration — no web UI yet, and the new variables are not in the composer catalogue because an MS5 spec pins that list exactly (pin respected); both are recorded for the owner's queued post-MX Messaging design task. |
| MX9 WhatsApp commerce & rich v2 | **Partial** | messaging-mb3-acceptance.md | Per-category WhatsApp rates (missing rate ⇒ NO figure shown); category hub with kind badges from stored components; quality guard on REAL synced quality data (RED/REJECTED blockable, default off); carousel AUTHORING + Meta submit through the existing MS6 path (stored only on Meta success). NOT BUILT: carousel broadcast SEND (the send path cannot express per-card components); catalog template authoring (no catalog linkage exists); WhatsApp Flows (zero flow machinery in the codebase); rejection-reason storage (the MS6 sync field list is spec-pinned byte-exact). |
| MX10 Growth tools & preference center v2 | **Shipped** | messaging-mb4-acceptance.md | Public preference center on the MS2 signed-token discipline, resolver-enforced and spec-proven; double opt-in (pending contacts receive NO marketing sends); messaging-native opt-in forms + popup config + iframe embed + QR from the real join URL (LeadForm is Meta-Ads-only — signups land as shared Lead rows, nothing forked); CSV import wizard with a pre-commit hygiene report and a per-row reason for every exclusion; consent audit export — consent HISTORY did not exist before MX10, so it honestly begins at MX10 with no backfill. Limits: no JS popup loader script (no script-serving machinery); SMS double opt-in impossible (no inbound SMS) and such forms are refused at create rather than faked. |
| MX11 Predictive audiences & engagement score | **Shipped** | messaging-mb4-acceptance.md | Engagement score = a pure, documented formula COMPUTED ON READ (never stored, never stale), shown verbatim in the UI with per-contact evidence; churn-risk / likely-to-buy / high-LTV as rule-based segments labelled "rule-based estimate" everywhere (never ML); NL → AI rule DRAFT through the MS9 guard path verbatim (nothing is created until a human confirms); suppression suggestions read-only until a human applies them; holdout as a bucket of the existing A/B hash (A/B already existed — not rebuilt), frozen by MX1 recipient rows so resume never re-rolls. Limits: no stored score history/trends (deliberate); no per-channel scores (SMS data cannot support them); no workflow/journey holdout. |
| MX12 Web Push channel | **Shipped** | messaging-mb5-acceptance.md | Broadcast channel over the Advanced package's real subscriptions via a registered `PushSendPort` — Messaging does NOT fork AX16's WebPushCampaign system; sent = push-service acceptance; delivered/read stay `null` (no such signal exists); 404/410 marks the subscription gone. Limits: payload is title/body/url only (the shop service worker renders nothing more); not in the MX2 cascade (evidenced). |
| MX13 Telegram broadcast channel | **Shipped** | messaging-mb5-acceptance.md | Broadcasts to the org's own bot subscribers from telegram `ChannelConversation` rows (plan correction recorded: `BotSession` is the order bot's state machine, NOT a subscriber registry); registered send port; sent only with a real `message_id`, failures carry Telegram's real error text; inline URL buttons; STOP/START hooked end-to-end into the MS2 store (`/start` = START), spec-proven. Limits: one bot per org (earliest CONNECTED); plain text only; not in the cascade (evidenced). |
| MX14 On-site notification channel | **Partial** | messaging-mb5-acceptance.md | No notification center existed, so the smallest real one was built: `OnsiteNotification` store + authenticated shop APIs + account-area tab with unread badge; delivered/read are honestly REAL here (the record sits in the customer's own center; opening stamps read); `deliveryId @unique` anchors resume idempotency. NOT BUILT: use as an MX2 cascade step — the plan named cascade usability for this channel; the cascade model is spec-pinned to contact-address attempts and an on-site attempt is a DB write into the customer's own center, so cascade use is refused at create (evidence in the MX14 doc). |
| MX15 Deliverability & governance | **Partial** | messaging-mx15-acceptance.md (+ mb6) | Delivery-health dashboard from real rows (incapable stages `null` with reasons); WhatsApp hard-failure auto-suppression into the MS2 store (the only webhook path that exists); pre-send checklist v2 extending MS5 (each check states what it verified; image-size honestly not_run — no byte sizes are stored anywhere); seed/test list riding the existing test-send path; **approval workflow (org setting, default OFF, four-eyes, audit-logged)**; spend-based budget caps from org rates only, with the recorded cannot-estimate ⇒ allow-with-warning default. NOT BUILT: bounce/complaint RATES and email bounce suppression (no such signal or webhook exists in the system); per-sender health (no sender identity is recorded); low-balance governance (no messaging balance exists — inventing one was refused). |
| MX16 Analytics & AI v2 | **Partial** | messaging-mx16-acceptance.md (+ mb6) | Comparative analytics + CSV from real aggregates (null stages stay null/blank, never 0); scheduled `messaging_summary` report plugged into the EXISTING GB8 system (no second scheduler); **A/B auto-winner (default OFF)** under a named statistical rule (two-proportion z-test, α 0.05, min 100 sent/variant) acting at chunk boundaries on the recipient-table path, decision fully recorded; AI campaign planner + translation as returned-only proposals through the MS9 guard (honest 502 with no real LLM); per-recipient send-time as a labelled deterministic statistic; subject quality as a labelled heuristic. NOT BUILT: true Touchpoint/AttributionCredit attribution for messaging (no honest join exists — every figure stays "association"-labelled, as the plan's honesty rule required); auto-winner on the legacy snapshot path and for cascade pairs. |

## The 15 MX migrations

| # | Migration | Batch |
|---|---|---|
| 1 | `20261019000000_mx1_broadcast_recipients` | MB1 |
| 2 | `20261019010000_mx2_cascade` | MB1 |
| 3 | `20261019020000_mx3_quiet_hours` | MB1 |
| 4 | `20261019030000_mx4_journey` | MB2 |
| 5 | `20261019030200_mx6_keyword_campaigns` | MB2 |
| 6 | `20261019040000_mx7_email_builder` | MB3 |
| 7 | `20261019040100_mx8_personalization` | MB3 |
| 8 | `20261019040200_mx9_whatsapp_rich` | MB3 |
| 9 | `20261019050000_mx10_growth` | MB4 |
| 10 | `20261019050100_mx11_intelligence` | MB4 |
| 11 | `20261019060000_mx12_push_channel` | MB5 |
| 12 | `20261019060100_mx13_telegram_channel` | MB5 |
| 13 | `20261019060200_mx14_onsite_channel` | MB5 |
| 14 | `20261019070000_mx15_governance` | MB6 |
| 15 | `20261019070100_mx16_analytics_ai` | MB6 |

(MX5 and the MX16 scheduled-report plug-in needed no migration.
Union with the base: 211 + 15 = **226**, fresh-Postgres-proven
226/226 at MB6 close.)

## Standing NOT BUILT register (package-wide)

Consolidated from the six batch docs; per-item evidence lives in
the batch/per-item acceptance docs named above.

- **Cascade boundaries:** cascade on legacy snapshot broadcasts;
  push/telegram/onsite as cascade channels (refused at create);
  personalization on cascade/WhatsApp broadcasts; auto-winner
  for cascade pairs.
- **Journey limits:** opened/clicked conditions + workflow-send
  link/open tracking (existing MS5/MS7 spec pins, respected);
  free-drag canvas; real-time purchase exit (resume-time polling
  only); Inbox conversation deep-link (no URL mechanism exists);
  per-product replenishment intervals (no consumption data).
- **Preset/data gaps:** birthday preset (no date-of-birth field
  anywhere); recipient-local quiet hours (no recipient timezone
  field); per-channel throttle.
- **Two-way limits:** keyword campaigns on SMS/email/Messenger
  (no inbound path); SMS double opt-in (same reason); poll
  tags/auto-replies (v1 polls record votes only).
- **WhatsApp rich limits:** Flows (no machinery); carousel
  broadcast send (authoring/submit built); catalog template
  authoring (no linkage); template rejection-reason storage
  (spec-pinned sync field list).
- **MX8 surfaces:** personalization web UI; composer variable
  catalogue listing (spec pin) — both noted for the queued
  post-MX Messaging design task.
- **Growth limits:** JS popup loader script (no script-serving
  machinery — config + iframe shipped); per-row differing
  consent sources in one CSV; topic taxonomy CRUD.
- **Intelligence limits:** stored engagement-score history/
  trends (deliberate — computed on read); per-channel scores;
  workflow/journey holdout; suppression suggestions for
  csv/test recipients (no contact row).
- **Channel extras:** push image/icon/action buttons (the shop
  service worker renders title/body/url only); push templates;
  multiple Telegram bots per org; telegram templates/AI drafts;
  onsite in MX10/MX11 preference surfaces; onsite as a journey
  step channel; a shop header bell.
- **Governance/measurement limits:** email bounce/complaint
  auto-suppression + bounce/complaint rates (no webhook/signal
  exists); per-sender health rates (no sender identity
  recorded); balance-based budget warnings (no messaging
  balance exists); URL reachability checks (format only, by
  design); approval workflow for workflow/journey sends; true
  messaging attribution (no honest Touchpoint join — figures
  stay association-labelled); auto-winner on the legacy
  snapshot path.
- **Messenger broadcast** — excluded from the package by design
  (Meta policy evidence in the plan); never built, never faked.

## Owner-owed live list (nothing here is done)

1. **GitHub push** — happens only on the owner's explicit
   instruction in the moment (standing rule). This branch
   (62 commits, 15 migrations) is local only.
2. **Dokploy Redeploy** — the owner's manual step after any
   push; it is what runs the 15 MX migrations (and any other
   pending lines) on the real, data-bearing DB. All MX migration
   proof today is fresh-DB only.
3. **Per-org job enablement** — `broadcast_send_sweep` must be
   enabled per org for scheduled/due sends, resume recovery and
   the MX3 caps/quiet-hours sweep behaviour; `INTERNAL_JOB_SECRET`
   confirmation is still outstanding from earlier packages.
4. **M30 live verification for MS + MX** — real SMTP send and
   tenant-SMTP verify-before-save; real SMS gateway sends
   (incl. MX2 multi-gateway failover + breaker); real WABA
   template sync/submit and delivered/read webhooks (incl. MX9
   quality ratings/guard and MX15 hard-failure suppression);
   live unsubscribe / STOP / preference-center flows; AI copy,
   planner and translation with a real LLM key; a real Telegram
   bot broadcast + STOP; a real Web Push subscription broadcast;
   a live shop customer's on-site notification. The itemized
   list is `docs/mx-live-verification-checklist.md` — every box
   unchecked.
5. **Queued follow-on (owner instruction, 2026-10-16):** the
   full Messaging page design update (super modern, fully
   responsive, zero feature loss) is to be dispatched now that
   MX is complete; MX8's personalization UI belongs in that
   pass.

## Honesty statement

Everything above is code + spec + fresh-DB proof. Sent/delivered/
read are claimed only where a provider or a real record confirms
them; channel-incapable funnel stages are `null`, never 0; every
cost figure derives from org-entered rates only; AI output is
draft/proposal only and never auto-sent or auto-applied; revenue
is labelled association unless a real attribution join exists —
and for messaging, none does. Where a plan item met a spec pin,
a missing field, or a nonexistent provider path, the item (or
sub-item) is recorded NOT BUILT with its evidence rather than
faked.
