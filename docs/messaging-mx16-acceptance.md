# MX16 · Analytics & AI v2 — Acceptance (MB6, final Messaging Advanced item)

Branch `messaging-advanced`, worktree `~/workspace/ai-marketing-saas-mx`. Built on the MB6 Step-0 audit at the top of `docs/messaging-mx15-acceptance.md` (lifted, not redone). Local commits only — nothing pushed.

Commits (on top of `6afed3af`):
- `48efd275` — API: comparative analytics + CSV, A/B auto-winner, scheduled `messaging_summary` report type, AI v2 + migration `20261019070100_mx16_analytics_ai`
- `b42eb09c` — specs 23/23
- `78baf13b` — web UI
- cleanup commit — removes jest cache files accidentally committed via a literal-tilde `--cacheDirectory` path (see Process note)

## Shipped audit per sub-item

### 1. Comparative analytics (API + page section + CSV)
- `GET /organizations/:orgId/messaging/analytics?from&to` — cross-broadcast comparison + per-channel funnel comparison computed ONLY from real `Broadcast` / `MessageDelivery` / `MessageLinkClick` / `BroadcastRecipient` rows, reusing the existing `broadcastFunnel` / `broadcastRevenue` code paths (no second funnel implementation). Range via the finance module's `parseFinanceRange` (Dhaka, default last 30 days); a broadcast belongs to the range by `sentAt ?? createdAt`.
- Null-stage rule preserved end-to-end: a funnel stage a channel cannot report stays `null` in the API, renders as "—" in the UI, and is an EMPTY cell in the CSV — never 0. Spec-proven on fixtures (email `read: null`, WhatsApp `clickedRecipients: null`, etc.).
- `GET .../analytics/export.csv` (OWNER/ADMIN) — the CSV is built by a pure function (`buildAnalyticsCsv` in `apps/api/src/messaging/analytics.ts`) from the SAME aggregate objects the screen renders; spec asserts CSV lines against the fixture aggregates. The export is audit-logged (`messaging.analytics_export`).
- Web: "📊 MX16 · তুলনামূলক Analytics" card on the Messaging page with date-range filter, per-channel table, per-broadcast comparison list, CSV button.

### 2. Attribution honesty
- Every revenue/order figure in the new analytics is labelled **association** — in the payload (`ASSOCIATION_LABEL_BN`, method text), in the CSV, in the scheduled report, and in the UI copy. The payload carries `attribution: null` plus an `attributionNote` stating that no honest Touchpoint/AttributionCredit join to messaging deliveries exists (per the Step-0 audit; no such join was found while building either). No figure anywhere presents association as attribution.

### 3. A/B auto-winner (owner decision D3 — default OFF)
- **Rule (named in code and UI):** two-proportion z-test (pooled, two-sided), `AUTO_WINNER_ALPHA = 0.05`, `AUTO_WINNER_Z_CRITICAL = 1.96`, `AUTO_WINNER_MIN_SAMPLE = 100` SENT per variant. Min-sample rationale: at n=100/variant the normal approximation for a proportion is sound and a ~15-point rate gap is detectable; smaller samples produce noise-driven "winners", which is exactly what the guardrail exists to prevent. Constants + `AUTO_WINNER_RULE_TEXT_BN` live in `analytics.ts`; the decision function `decideAutoWinner` is pure and unit-tested against hand-computed values (40/100 vs 20/100 → z ≈ 3.086, p < 0.01).
- **Metric:** one the channel honestly reports — read rate for WhatsApp/on-site, click rate for email/SMS (email falls back to opens when no clicks exist). Push/Telegram report no honest engagement metric → the evaluator refuses with reason `metric_unavailable` and the UI/report say why.
- **Opt-in resolution:** explicit `false` on EITHER variant disables the pair; else explicit `true` on either; else the org switch (`MessagingSetting.abAutoWinnerEnabled`, default `false`). Per-broadcast value is nullable (`Broadcast.abAutoWinnerEnabled`, null = inherit org).
- **Effect point:** evaluated at each chunk boundary inside `processBroadcastTable` (the MX1 recipient-table path), which re-reads broadcast state per chunk — a mid-flight disable via `POST broadcasts/:id/ab-auto-winner` therefore takes effect at the next chunk. Once decided, the losing variant's remaining `pending` recipients are sent the WINNING variant's content; the WhatsApp sender is rebuilt when the winning row is the other template row.
- **Recorded on the Broadcast (BOTH rows):** `abWinnerVariant`, `abWinnerAt`, `abWinnerDetail` (winner, metric, test name, alpha, z-critical, min sample, per-variant sent/success/rate, z, p-value, timestamp, rule text) + audit event `broadcast.ab_winner`. The broadcast report surfaces all of it plus the rule and the scope note.
- **Guardrails (all spec-proven):** never fires before min sample; never on tie/within-threshold; never twice (re-evaluation returns `already_decided` and sends nothing extra); cascade pairs refused (`cascade_not_supported` — per-channel metrics would be dishonest for a cascade pair); decision path exercised end-to-end on the REAL `processBroadcast` flow: the loser's 10 pending recipients all received the winner's subject/body.
- **Boundary:** legacy snapshot-path broadcasts are NOT covered (no per-chunk recipient table to redirect honestly) — stated in the report's `scopeNote` and in NOT BUILT below.

### 4. Scheduled messaging report (GB8 plug-in)
- Registered through the EXISTING ScheduledReport system exactly as the audit prescribed: `"messaging_summary"` added to `SCHEDULED_REPORT_TYPES` in `finance/scheduled-reports.service.ts`, label added to `REPORT_LABELS_BN`, and a `buildMessagingFile` branch in `buildFile` — no second scheduler, no finance→messaging service import (aggregates computed from the same Prisma tables via the shared pure `aggregateFunnels`). The attachment contains per-broadcast + per-channel funnels (null stages blank) and association-labelled orders. Delivery uses the system's existing email mechanism unchanged.
- Web finance lib (`finance-gb8.ts`) gained the type for the schedule form; the pinning vitest in `finance-gb8.test.ts` was updated deliberately to the new inventory (same precedent as MX14/GB9). Finance specs re-run green (below).

### 5. AI v2 — all through the MS9 guard path verbatim, returned-only
All three AI endpoints call `checkMessagingAiLimit` with `MESSAGING_AI_FEATURE = "messaging_copy"` before any provider call, record usage exactly like `draftMessagingCopy`, and create/send NOTHING (spec-proven zero writes + exactly one usage record).
- **(a) Campaign planner** `POST ai/planner` — goal (+ optional channel/audience hints) → proposal: audience definition (validated with the real `validateAudienceDefinition`; returned as-is with errors when invalid — never corrected or applied), content draft, channel recommendation, timing suggestion. Unlike copy drafting, a dev-template output cannot honestly plan, so with no real LLM the endpoint returns an honest **502** (MX11/MX6 precedent) rather than a fake plan. UI: planner panel in the composer; each piece has its own explicit "use" action (audience → fills the NL draft box for the existing human-confirmed saved-audience path; content → fills the form via the existing apply-variant click; channel → selects the channel; timing → display only). No one-click create-and-send exists.
- **(b) Per-recipient send-time suggestion** `GET ai/send-time-recipient` — DETERMINISTIC statistic (labelled as such in UI and payload `method`): modal Dhaka hour over that recipient's real `MessageLinkClick` timestamps + delivery opened/read timestamps, minimum evidence `RECIPIENT_SEND_TIME_MIN_EVENTS = 5`; below that it returns `available: false` with the real event count — never a fabricated time. Surfaced as a composer hint.
- **(c) Translation draft** `POST ai/translate` — Bangla↔English subject/body via the guard path, returned as a draft; the human inserts it with an explicit click. Never auto-applied to any saved template. No real LLM → honest 502 (a template cannot translate).
- **(d) Subject-line quality** `POST ai/subject-score` — HEURISTIC, labelled "heuristic" in the payload (`method: "heuristic"`), the code, and the UI ("Open-rate-এর মাপা ভবিষ্যদ্বাণী নয়"). Factors shown individually: length (30), personalization token (20), spam-word overlap against the SAME org-visible MX15 spam lists (25), ALL-CAPS shouting ratio (15), excessive punctuation (10). Chosen over an AI call because it is deterministic, explainable, and works with no LLM configured — and it never pretends to be a measured prediction.

### Migration
`20261019070100_mx16_analytics_ai` (additive only): `MessagingSetting.abAutoWinnerEnabled Boolean @default(false)`; `Broadcast.abAutoWinnerEnabled Boolean?`, `abWinnerVariant String?`, `abWinnerAt DateTime?`, `abWinnerDetail Json?`. Not run on any real DB (M30-style live proof still owed, as with all MX migrations).

## Scoped gates (exact numbers, this worker)
- MX16 spec `mx16-analytics-ai.spec.ts`: **23/23 pass**.
- Messaging jest group + GB8 finance specs (`src/messaging` + `gb8-finance.spec.ts` + `gb8-email-attachment.spec.ts`): **32 suites / 535 tests, all pass** (fresh cache; see process note).
- API tsc (`apps/api`): **clean**.
- Web tsc (`apps/web`): **clean** (exit 0).
- Web vitest `finance-gb8.test.ts`: **12/12 pass**.
- Prisma validate: **valid** 🚀.
- Not run (per task scope): full API suite, fresh-PG migration run — the coordinator's batch gates cover these.

## NOT BUILT (with evidence)
1. **Auto-winner on the legacy snapshot send path** — the snapshot path materializes recipients up-front with no per-chunk recipient table to redirect; the honest seam (Step-0 audit point 3) exists only on the MX1 chunked path. Boundary stated in the report `scopeNote` + UI copy.
2. **True attribution (Touchpoint/AttributionCredit) for messaging revenue** — no honest join from messaging deliveries to AttributionCredit exists (Step-0 audit point 2, re-confirmed while building: `broadcastRevenue`'s customer/order association is the only defensible link). All figures stay "association"-labelled.
3. **Planner/translation with no real LLM** — deliberately returns honest 502 instead of a templated fake (dev provider cannot plan or translate); with a real LLM configured both work through the same code path.
4. **Auto-winner for cascade A/B pairs** — refused (`cascade_not_supported`): per-variant metrics across cascade channels are not a single honest metric.

## Deviations
- None against the plan. One design choice recorded: subject quality uses the heuristic option the plan explicitly offered (labelled), not an AI call.

## Process note (transparency)
The first scoped jest run used `--cacheDirectory=~/workspace/...`; bash does not expand `~` after `=`, so jest created a literal `~` directory inside `apps/api/src` and a later `git add -A` committed ~112 cache files. They were removed in a dedicated cleanup commit (amended to touch ONLY this batch's `.tmp-mx16` files after noticing a pre-existing `.tmp-int7` cache dir from an earlier line was also matched — those pre-existing files were restored untouched). The stale cache also caused one false failure (`mx11-intelligence` engagement-score test) in the first group run; with a fresh absolute cache path the full group is 32/535 green, including mx11 26/26 standalone — the failure was a cache artifact, not a code regression.
