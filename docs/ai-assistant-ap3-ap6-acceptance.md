# AP3–AP6 (Tool Universe · Estimates · Actions++ · Proactive++) — Acceptance

Owner: "Hmm bake kaj golo o kora dao" (2026-10-12 23:36 +06) —
build the remaining AI Assistant plan phases. AP7 frontier items
(specialist personas, autonomy level 2, assistant API, per-tenant
white-label depth) remain **owner-decision** and were not started.

## Commits (local only, not pushed)

1. **AP3+AP4 `feb85c2`** — registry + 10 new read tools + RBAC + forecasting.
2. **AP5 `707eb86`** + panel fix **`c69135e`** — new proposal types, dry-run diffs, bulk approve.
3. **AP6 `088e2c6`** — radar, pacing, Telegram brief, task inbox.

## AP3 — Tool universe

- `TOOL_CATALOG` is now a typed **registry** (`ToolDef`: name,
  module, description, optional roles). The LLM planner prompt,
  `sanitizePlan` allow-list, `keywordPlan` and the new
  `TOOL_ROLES` map all derive from it — one source, no drift.
- **Per-tool RBAC**, enforced at execution in `ChatService`:
  `get_usage_summary` (OWNER/ADMIN), `get_team_performance` and
  `get_ad_account_health` (≥ MARKETING_MANAGER). The org role comes
  from the request membership (TenantGuard). A restricted tool
  planned for a lower role **never executes** — the result is a
  visible Bengali restriction note and the attempt is audited
  (`AIAction` status error, `role_restricted`). Spec-proven for
  ANALYST (blocked) vs OWNER (passes).
- **10 new read tools**, all org-scoped, compact, real rows only:
  `get_order_detail` (items + shipments), `get_customer_360`
  (orders, lifetime value, lead stage), `get_crm_pipeline` (stage
  counts/values + overdue follow-ups), `get_inbox_performance`
  (status/channel mix, unassigned, top unanswered themes from
  `AiUnansweredQuestion`), `get_social_performance` (status mix +
  latest failure verbatim), `get_ad_account_health` (platform
  status buckets + non-active list), `get_usage_summary` (calls +
  tokens by feature/provider), `get_team_performance` (presence,
  per-assignee open load, closed 30d), `get_automation_health`
  (runs by status/kind + latest errors verbatim), `get_courier_rollup`
  (per-provider delivery rate, COD collected, >72h stuck).
  BN+EN keyword rules route to each; sanitizePlan bounds their args.

## AP4 — Estimates, deterministic and labelled

- `forecast.ts` is a pure module: trailing-14-day mean blended
  50/50 with a least-squares trend over ≤28 days (trend clamped to
  ±5%/day), fixed **±15% band**, every result carries the method
  string, the assumption list and the day count. **Thin data
  refuses** (<14 days, or <7 selling days) with an honest Bengali
  reason — no invented projection.
- `get_sales_forecast {days 7–30, scenarioGrowthPct −50..100}`:
  a scenario scales the projection and **restates the assumption**
  in the output; the baseline stays beside it. Specs pin the math
  (flat series → flat forecast with exact band totals; scenario
  = baseline × factor; rising series trends up, never negative).

## AP5 — Actions++

- New proposal types through the same propose → exact preview →
  atomic-claim approve → confirmed-execute discipline:
  `resume_campaign` (requires local metaStatus PAUSED, else an
  honest 400 with the current status), `resume_ad_set`,
  `create_followup_task` (CRM next-follow-up + a LeadActivity note;
  nothing is written before approval — spec-proven),
  `create_quick_reply` (save-only; the identical write
  `InboxService.createQuickReply` performs — the inbox module is
  deliberately not imported into the AI module).
  Chat detection now also recognises resume phrasing ("চালু করে
  দাও" + a real plan name). Deliberately **not** built: coupon
  proposals — the only Coupon model is the SaaS-plan coupon, there
  is no tenant discount store to write to (the EC plan flags the
  same gap); campaign-draft/social-draft proposals remain future
  work.
- **Dry-run diffs**: campaign/ad-set executions re-read the current
  state at approval time and record `before → after` in the stored
  result (ad-set "before" is honestly null — that status lives
  only on Meta).
- **Bulk approve**: `POST proposals/bulk-approve` (≤20 ids,
  de-duplicated) runs the *same* `approve()` per item; one failure
  never stops the rest, and every item's outcome (status + verbatim
  error) is returned. UI: "সব অনুমোদন করুন (N)" on the AI page and
  "সব অনুমোদন" in the panel's pending strip, both behind one
  confirm that states the count. (The panel half initially missed
  its JSX anchor and silently didn't write; caught on review and
  shipped as `c69135e` — recorded here rather than hidden.)

## AP6 — Proactive++

- **Opportunity radar** (`computeOpportunityRadar`, also
  `GET ai/opportunities`): deterministic lines from real signals
  only — low-stock products that sold in the last 14 days, a
  courier whose delivered-rate fell ≥10 points week over week
  (≥5 terminal shipments per window), and an open unanswered
  backlog of 5+ with the top theme. Plus a **month pacing** line
  (MTD revenue vs the previous month's same elapsed span).
  Radar + pacing lines ride inside the existing daily briefing.
- **Telegram brief copy**: opt-in setting + owner chat id
  (migration `20261012240000_proactive_telegram_brief`), sent
  through the org's **CONNECTED Telegram integration's own bot**
  (credentials decrypted via the platform crypto helper; the
  `TelegramClient` is reused directly). The run result reports
  `telegramSent` / `telegramSkipped` with the honest reason
  (`no_new_briefing` / `no_chat_id` / `no_telegram_integration` /
  the send error verbatim). Spec-proven for both the skip and the
  send (fetch stubbed).
- **Assistant Task Inbox**: `GET ai/task-inbox` aggregates pending
  proposals, open unanswered count, radar lines and today's
  briefing state; the AI page renders it as a compact card that
  hides itself when there is genuinely nothing to show.
- **Not built**: scheduled *custom* reports — that needs a new
  scheduler surface; the existing Automations "Daily AI Briefing"
  job already schedules the briefing itself. Recorded as the one
  deferred AP6 sub-item rather than faked.

## Gates

- API `jest src/ai/`: **155/155** (18 suites: +tools-ap3 9,
  +forecast 5, planner 15, proposals 15, proactive 10, RBAC in
  chat-stream). API tsc clean in `src/ai/`. Prisma valid.
- Web vitest **124/124**; `next build` green (AG temporary-restore
  procedure, `git status` verified **identical** afterwards; AG
  tree and the IN worktree untouched).

## Honest limits

- No live visual QA (no running app in the sandbox).
- Migrations `20261012220000`, `20261012230000`, `20261012240000`
  have not run on any real database — deploy must run migrations.
- The forecast is a labelled deterministic projection, not ML —
  seasonality and campaign effects are explicitly not modelled.
- Radar thresholds (stock ≤ threshold, ≥10-point drop, ≥5 open
  questions) are fixed heuristics over real data.
- Telegram delivery needs the owner's connected bot + chat id;
  nothing sends without both.
- NOT pushed (owner push gate unchanged). AP7 stays owner-decision.
