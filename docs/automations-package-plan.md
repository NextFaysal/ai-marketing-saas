# Automations Package — Audit + Detailed Plan

**নির্দেশ:** মালিক, ২০২৬-১০-১১ — "এই কাজ শেষ হলে তুমি একটা details plan করবে 'Automations' এর জন্য, then step by step সব করে দেবে, আমার কাছে কোনো permission নিতে হবে না, তুমি auto approve করে নেবে।"
**ভিত্তি:** ২০২৬-১০-১১-এর পূর্ণ code audit (নিচে প্রতিটি দাবির file evidence)। অন্য track-এর নম্বরের সাথে সংঘর্ষ এড়াতে এই প্যাকেজের নিজস্ব নম্বর: **A1–A4**।
**নিয়ম:** Local commit only — GitHub push মালিকের স্পষ্ট নির্দেশ ছাড়া নয় (এই auto-approve-এর একমাত্র ব্যতিক্রম)।

---

## PART 1 — যা ইতিমধ্যে আছে (audit-প্রমাণিত, আবার বানানো হবে না)

### 1. Automation Jobs engine
- **25টি job type** (`apps/api/src/automation/automation.service.ts` → `JOB_TYPES`): woo/shopify products+orders, meta/google/tiktok insights, daily_report, daily_briefing, competitor_ads/scan/**multi_sync**, weekly_ads_report, meta_status_sync, audience_refresh, dayparting, subscription_sweep, dunning_reminders, billing_reminders, audit_retention, inbox_assignment_sweep, email_sync, inbox_retention, lead_followup_sweep (C1), auto_renew। প্রতিটির `executeJob` case আছে (যেমন `competitor_multi_sync` → লাইন 275)।
- Scheduling + run-now + enable/disable + delete: `automation.controller.ts`; প্রতিটি run `AutomationRun` row-তে (kind schedule|rule), job row-তে `lastRunAt/lastStatus/lastError` (service লাইন 114–124, 348–357)।
- **M57 worker path:** BullMQ dedicated worker (`apps/worker`), exhausted job → `POST /internal/jobs/dlq` → `DeadLetterJob` table (schema লাইন 1323)।
- **Ads AutomationRule engine:** 8+ metric (`RULE_METRICS`), 5 action (`RULE_ACTIONS`: pause_campaign, alert, activate_campaign, scale_budget, pause_ad), CRUD + evaluate endpoint — Automations পেজে পূর্ণ UI (সব action-ই form-এ আছে, লাইন 186–189)।

### 2. Workflow Engine v2 (W1–W6 সম্পূর্ণ)
- **10টি trigger** (`workflows.service.ts` → `WORKFLOW_TRIGGERS`): order_created, lead_created, lead_stage_changed, inbox_message_received, inbox_unanswered (scan), order_delivered, order_cod_confirmed, conversation_assigned, conversation_closed, schedule (W2)।
- **14টি step type** (`STEP_TYPES`): send_email, send_sms, add_lead_activity, add_conversation_note, wait, condition, send_inbox_message + W3-এর assign_conversation, change_lead_stage, add_tag, notify_team, create_follow_up, http_webhook (https-only, private-IP refuse, HMAC) + W4 **branch** (then/else, এক স্তর)।
- W1 পূর্ণ edit + clone + stepsSnapshot; W5 dry-run simulator, manual run, runs explorer + filter, failed-run retry, per-workflow 30d stats (successRate null হলে সৎ), failure notification (১/workflow/ঘণ্টা throttle); W6 per-entity cooldown + daily run cap (Dhaka day), skipped run-এ কারণ, `@PermissionArea("automations")`।
- **6টি server preset** (`WORKFLOW_PRESETS`) + one-click install endpoint (`workflows.controller.ts` → `presets/:key/install`)।

### 3. M54 Visual Canvas
- `apps/web/src/lib/workflow-graph.ts` — W3/W4-এর **সব** step type graph mapping-এ আছে (লাইন 58–65, 76–82; branch composite node)। `workflow-graph.test.ts` প্রমাণ করে: প্রতিটি step type-এর definition→graph→definition identity, branch-এর দুই arm, unknown step = locked node raw JSON ধরে রাখে, non-single-path graph Bengali error-এ reject। **কোনো rebuild লাগবে না।**

### 4. Event catalogue (EventsService — `@Global` module, `common/events.service.ts`)
Codebase জুড়ে emit হওয়া domain event ঠিক **11টি** (grep-প্রমাণিত):

| Event | Producer | Workflow trigger? |
|---|---|---|
| order.created | integrations (sync/webhook), inbox (chat order) | ✅ order_created |
| order.delivered | integrations, orders (S2 PATCH) | ✅ order_delivered |
| order.cod_confirmed | inbox COD flow | ✅ order_cod_confirmed |
| **order.status_changed** | **orders.service.ts:227 (S2)** | ❌ **নেই** |
| **order.refunded** | **orders.service.ts:230 (S2)** | ❌ **নেই** |
| lead.created | leads.service, inbox leadgen | ✅ lead_created |
| lead.stage_changed | leads.service:553 | ✅ lead_stage_changed |
| conversation.message_received | inbox:1205 | ✅ inbox_message_received |
| conversation.assigned | inbox:3362 | ✅ conversation_assigned |
| conversation.closed | inbox:3365 | ✅ conversation_closed |
| *(shipment.\* — কোনো event-ই নেই)* | courier কখনো emit করে না | ❌ **producer-ই নেই** |

### 5. Inbox Autopilot (U3) — automation surface হিসেবে সম্পূর্ণ
- Per-intent + per-channel auto-reply mode (off/draft/auto), confidence threshold, escalation gate (complaint/negative sentiment/human-word/high-value open order/repeated-ununderstood), 5টি grounded intent (price/stock/delivery/order_status/payment), FAQ/knowledge + Business Brain fact pack-এর ওপর LLM tier, order-taking bot, smart assignment। Keyword-ভিত্তিক automation workflow দিয়েও সম্ভব (message context-এ `content` থাকে, condition op `contains` আছে — `messaging/render.ts` লাইন 25)। **আলাদা build gap নেই।**

### 6. Analytics / visibility যা আছে
- Workflows: per-workflow stats API + পেজে প্রদর্শন (W5)।
- Jobs: পেজে প্রতিটি job-এর last run/status/error + সর্বশেষ 30টি run-এর flat তালিকা (`automations/page.tsx` লাইন 114, 209–211)।
- New org-এর day-one: workflows-এ 6-preset gallery; jobs-এ EmptyState + উদাহরণসহ guidance (লাইন 110, 151)। কোনো job auto-seed হয় না (ইচ্ছাকৃত — সব job opt-in)।

---

## PART 2 — GAPS (A1–A4, impact অনুযায়ী batch)

### Batch 1

**A1 — Workflow triggers: order_status_changed + order_refunded**
S2 এই দুটো event বসিয়েছে, কিন্তু `EVENT_TO_TRIGGER`-এ নেই, `WORKFLOW_TRIGGERS`-এও নেই — অর্থাৎ tenant "refund হলে টিমকে জানাও" বা "order cancel হলে follow-up করো" জাতীয় workflow বানাতেই পারে না; event দুটো শূন্যে emit হয়।
Scope: (ক) `WORKFLOW_TRIGGERS`-এ `order_status_changed`, `order_refunded` + `EVENT_TO_TRIGGER` mapping; (খ) context সম্পদ: status_changed-এ `fromStatus`/`toStatus` (আসল emit context-এ `from`/`to` আছে — builder-friendly নামে normalize), refunded-এ `refundAmount` ও `cumulativeRefunded` (টাকায়, সংখ্যা — যাতে condition `gte` কাজ করে; emit context-এর `amountMinor` string থেকে derive); enrichContext-এর order enrichment (orderNumber/total/customerId) আগের মতোই চলবে কারণ context-এ orderId আছে; (গ) web builder-এ দুটো trigger option + condition field hint; (ঘ) একটি preset: "Refund হলে টিম অ্যালার্ট" (order_refunded → notify_team); (ঙ) governance entity key orderId দিয়ে আগেই কাজ করে (workflows.service.ts:697) — যাচাই।
Acceptance: API spec — PATCH দিয়ে status change/refund করলে সংশ্লিষ্ট workflow run তৈরি হয় (service-level + live); condition (toStatus eq cancelled / refundAmount gte X) সঠিকভাবে filter করে; আগের 10 trigger অপরিবর্তিত; web tests + build green; docs/automations-a1-acceptance.md।

**A2 — Shipment events → workflow triggers (shipment_delivered / shipment_returned / shipment_status_changed)**
COD ব্যবসায় পার্সেলের অবস্থাই আসল সত্য, অথচ CourierService EventsService inject-ই করে না — কোনো shipment event নেই। Order ডেলিভারি store-sync পথে order.delivered দিয়ে আসে, কিন্তু courier-confirmed **return** কোনো workflow দিয়ে ধরা যায় না (S1 শুধু stock ফেরত দিয়েছে)।
Scope: (ক) `CourierService.syncShipment` — একমাত্র status-লেখা choke point (S1-এর audit-প্রমাণিত; syncAll এখান দিয়েই যায়) — status বদলালে `shipment.status_changed` emit: context { shipmentId, orderId, provider, trackingCode, shipmentStatus (নতুন), previousStatus }; failure-isolated (S1 hook-এর পাশে, একই ধাঁচে); EventsService REAL import (@Global module — module wiring লাগবে না, তবু DI spec/live দিয়ে প্রমাণ); (খ) workflows: একটি event থেকে তিনটি trigger — `shipment_status_changed` (সব বদল), `shipment_delivered` (status ∈ delivered সেট: delivered/partial_delivered — S5-এর classifier-এর সাথে মিলিয়ে), `shipment_returned` (status = returned); onModuleInit-এ dispatcher subscription; WORKFLOW_TRIGGERS-এ তিনটিই; (গ) context-এ `shipmentStatus` condition field হিসেবে ব্যবহারযোগ্য; enrichContext orderId দিয়ে order/customer তথ্য টানবে; (ঘ) web builder-এ তিনটি trigger option; (ঙ) একটি preset: "পার্সেল রিটার্ন হলে টিম অ্যালার্ট + লিড নোট" জাতীয় বাস্তবসম্মত preset (shipment_returned → notify_team)।
Acceptance: spec — syncShipment-এ status বদলালে event fire হয়, না বদলালে হয় না; returned transition-এ shipment_returned workflow run; delivered-তে shipment_delivered; tenant isolation; live check সম্ভব হলে (sandbox-এ shipment status বদল mock provider দিয়ে নয় — service-level spec + DI proof-ই মূল প্রমাণ, live হলে বাড়তি); docs/automations-a2-acceptance.md।

### Batch 2

**A3 — Tenant automation health: dead-letter visibility + per-job health + failure notification**
`DeadLetterJob` row তৈরি হয়, কিন্তু tenant তা দেখতে পায় না — কোনো tenant endpoint নেই (শুধু internal/admin পথ)। Job বারবার fail করলেও org-কে কেউ জানায় না; job row-র lastError-ই একমাত্র চিহ্ন। আর per-job health aggregate (শেষ 7 দিনে কত run, success rate, পরপর কত fail) নেই — workflows-এর stats আছে, jobs-এর নেই।
Scope: (ক) `GET organizations/:id/automation/health` — job-প্রতি { runs7d, successRate (decided না থাকলে null), consecutiveFailures, lastStatus, lastError } AutomationRun থেকে + org-এর dead letters (সর্বশেষ 20, replayedAt সহ); (খ) internal DLQ record পথে org-এর ACTIVE OWNER/ADMIN-দের AgentNotification (`job_dead_letter` type) — DLQ row তৈরি হলেই, dedupe job-প্রতি দিনে একবার; (গ) Automations পেজে health অংশ: job কার্ডে success-rate/consecutive-failure badge + dead-letter তালিকা (error + attempts + সময়); (ঘ) cosmetic fix: rule তালিকায় action label — pause_campaign ছাড়া বাকি action-গুলোও তাদের আসল নামে দেখাবে (এখন scale_budget/activate-ও "শুধু Alert" ছাপে — page.tsx:155)।
Acceptance: spec + live — fail হওয়া job health-এ ধরা পড়ে, DLQ notification ঠিক একবার, tenant isolation; docs/automations-a3-acceptance.md।

**A4 — Jobs day-one completeness: competitor_multi_sync UI + job template gallery**
25টি type-এর মধ্যে **24টি** UI থেকে বানানো যায় — `competitor_multi_sync` (মালিকের নিজের merge করা feature) form-এ নেই, অথচ executeJob case আছে। আর workflows-এর preset gallery থাকলেও jobs-এর কোনো template নেই — নতুন org ফাঁকা form দেখে।
Scope: (ক) competitor target group-এ `competitor_multi_sync` option; (খ) job template gallery: 5–6টি বাস্তব template (Woo Orders প্রতি 30 মিনিটে sync, Daily AI Briefing সকালে, Billing Reminders প্রতিদিন, Lead Follow-up Sweep, Inbox Assignment Sweep, Competitor Multi-Platform Sync) — one-click-এ form prefill (সরাসরি তৈরি নয়; target বেছে নেওয়া tenant-এর হাতে), বিদ্যমান create endpoint-ই ব্যবহার; server-side catalogue (workflow presets-এর ধাঁচে) যাতে API/web একই তালিকা পায়; (গ) gallery Automations পেজের ওপরে, EmptyState-এর পাশাপাশি।
Acceptance: UI থেকে multi_sync job তৈরি হয় ও run-now সফল (service spec); template prefill ঠিকমতো type/target/interval বসায়; docs/automations-a4-acceptance.md।

### যা ইচ্ছাকৃতভাবে বানানো হচ্ছে না (audit-এ প্রমাণিত অপ্রয়োজনীয়/আচ্ছাদিত)
- Canvas rebuild — W3/W4 step graph-covered, round-trip test আছে।
- আলাদা inbox keyword-rule engine — workflows (content + contains) + autopilot FAQ দিয়ে আচ্ছাদিত।
- Workflow stats/runs/retry — W5-এ সম্পূর্ণ।
- customer.* event — কোনো একক choke point নেই; ভুয়া coverage বানানো হবে না (ভবিষ্যতে customer তৈরির পথ একীভূত হলে তখন)।
