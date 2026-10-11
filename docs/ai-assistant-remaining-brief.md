# AI Assistant — Remaining Work Brief (owner-directed 2026-10-10 22:58 +06)

Source list: AI-Assistant-Work-List-2026-10-10 (sections গ + ঘ).
Owner instruction: "বাকি কাজগুলো start করো" — start the remaining work.
Execution order below is Muse's sequencing under the autonomy grant.

## Hard rules (apply to every milestone here)
- LOCAL COMMITS ONLY. NO GitHub push — push only when the owner
  explicitly says "GitHub push করো" (strengthened rule, 2026-10-10 22:49).
- No mock integrations; nothing counts as sent/paid/published/paused
  without the platform's own confirmation.
- AI stays grounded: answers only from real tool results; missing
  data is stated, never invented.
- Bengali + English support; user-facing strings in Bengali script
  where the existing UI is Bengali.
- Each milestone: full monorepo build + full API test suite + live
  sandbox check where infrastructure allows + acceptance doc
  (docs/milestone-<n>-acceptance.md) + roadmap note + local commit.

## Out of scope for THIS program (already on their own tracks)
- Real-LLM live verification — needs the owner's LLM key (M30 S5),
  not code. The pipeline must stay ready for it.
- AI Creative Studio — Post-launch Plan N4, separate milestone set.
- Inbox Autopilot v2 — Unified Inbox Plan U3, next inbox phase.
- Native provider token streaming protocols — deferred; M45 may add
  SSE delivery of progress/final answer only if honestly labelled.

## M45 — AI Assistant Core v2 (UX completeness)
- Conversation management: pin/unpin, rename, delete, search
  (title + message content), export one conversation (JSON + Markdown).
- Follow-up suggestions after each assistant answer: deterministic,
  derived from the tools actually used + conversation context;
  if a real LLM is configured it MAY refine them, but the
  deterministic path must work and be tested on its own.
- Web UI for all of the above in apps/web/src/app/dashboard/ai.
- Schema only if pinning needs it (AIConversation.pinnedAt) —
  one migration, prisma generate before rebuild/restart.

## M46 — Deep Analysis Tools (read-only, same planner/sanitizePlan path)
New tools, each with unit tests and dev-template rendering:
- get_customer_segments (RFM segments + counts + revenue share)
- get_inventory_health (low stock / out of stock / overstock from
  real stock fields; say plainly when stock data is absent)
- get_courier_performance (per-provider delivery/return rates from
  real shipments/orders)
- get_product_profit (per-product contribution after COGS + ad
  allocation where honestly computable; label any allocation)
- compare_periods (two periods side by side for overview metrics)
Planner keywords in BN + EN for each; sanitizePlan whitelist updated;
max tool calls stays 3.

## M47 — Write Actions with Approval (the big step, do AFTER M45+M46)
- Assistant may PROPOSE an action; nothing executes on proposal.
- Proposal model + lifecycle: proposed → approved/rejected → executed
  (result from the real service) / failed (platform error verbatim).
- First action types only, reusing existing confirmed paths:
  (1) pause a published campaign/ad set via CampaignsService's
  Meta-confirmed path, (2) create a broadcast DRAFT (never send),
  (3) apply a recommendation's linked action where one exists.
- Every step audit-logged (AIAction + audit). Approval is an explicit
  authenticated user action in the web UI with a preview of exactly
  what will happen. If the underlying platform call fails, the
  proposal records failure — never success.

## M48 — Proactive Assistant
- Daily Briefing: scheduled job (reuse automation scheduler +
  ReportsService data) delivered as an in-app notification using
  the existing notification system; content from real rows only.
- Anomaly alerts: when getAnomalies finds high/critical anomalies
  on the daily run, create a notification (dedupe per day + type).
- Settings: per-org on/off for briefing/alerts in the AI page or
  Settings, default on for briefing, honest "no data" briefings.

## Sequence
M45 → M46 (can be prepared in parallel, integrated sequentially —
they share chat.service/tools/planner) → M47 → M48.
