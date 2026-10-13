# IN4 — স্তরভিত্তিক SLA + সক্রিয় Escalation Chain: Acceptance

Batch B2, item 2 of 2 (IN3 macros-এর পর)। Plan: `Inbox-Next-Update-Plan-2026-10-12.md` §৩ (IN4a–d)।
আগের অবস্থা: SLA ছিল শুধু গণনা — একটি org-ব্যাপী `slaFirstResponseMinutes`,
একটি breach ফোল্ডার ও team report-এর count; কোনো সতর্কতা, escalation বা
পদক্ষেপ ছিল না।

## কী তৈরি হলো

### IN4a — স্তরভিত্তিক policy (backward-compatible)
- `InboxSetting`-এ additive ক্ষেত্র: `slaByChannel Json?` (channel → মিনিট),
  `slaVipMinutes Int?`, `slaEscalateAfterMinutes Int @default(30)`,
  `slaLeadAlertEnabled Boolean @default(true)`,
  `slaAutoReassignEnabled Boolean @default(false)`। Migration
  `20261012220000_in4_sla_chain` — শুধু additive ALTER + তিনটি nullable
  marker কলাম (`ChannelConversation.slaWarnedAt/slaLeadAlertedAt/
  slaAutoReassignedAt`)।
- কার্যকর সীমার স্তর: **VIP → channel → org default** (pure helper
  `effectiveSlaMinutes`)। VIP = বিদ্যমান সংজ্ঞা (সর্বশেষ linked order ≥
  `escalationThresholdMinor`) — নতুন কোনো VIP ধারণা বানানো হয়নি।
- `buildSlaBreachWhere` একটাই breach সংজ্ঞা এখন list filter, folder
  counts ও sweep-এর জন্য; **কিছুই layered সেট না থাকলে where-clause
  byte-identical পুরনো আকারের** (spec-এ প্রমাণিত) — পুরনো আচরণ হুবহু।
- Read path defensive (`parseSlaByChannel`: corrupt stored মান → {}),
  write path strict (অজানা channel / সীমার বাইরের মান → 400)।

### IN4b — Breach-এর আগাম সতর্কতা
- Sweep কার্যকর সীমার **৭৫%** পেরোলে দায়িত্বপ্রাপ্ত এজেন্টকে বিদ্যমান
  `AgentNotification` (নতুন type `sla_warning`) পাঠায় — কথোপকথনপ্রতি
  একবার (`slaWarnedAt` marker)। Unassigned কথোপকথনে marker বসে না, যাতে
  পরে assign হলে সতর্কতা তখনও যেতে পারে।
- List row-তে server-গণিত `slaState` (`warning`/`breached`) + `slaDueAt`;
  কার্ডে হলুদ ⏰ countdown চিপ (warning) / লাল breach চিপ — web শুধু
  server-এর রায় format করে, নিজে deadline আবার গণনা করে না।

### IN4c — Escalation chain (sweep job)
- নতুন automation job **`inbox_sla_sweep`** (template, ৫ মিনিট) →
  `InboxService.runSlaSweeps(orgId)` — handover/assignment sweep-এর ধাঁচে,
  per-row try/catch, injectable clock।
- Breach + `slaEscalateAfterMinutes` পরেও প্রথম উত্তর না গেলে:
  1. **Team lead alert** (default চালু, setting-এ বন্ধ যায়): Escalation
     টিমের lead → কথোপকথনের টিমের lead → OWNER/ADMIN fallback; `urgent`
     notification; একবার (`slaLeadAlertedAt`); কাউকে পাওয়া না গেলে
     marker বসে না।
  2. **Auto-reassign** (default **বন্ধ**, opt-in): smart-assign pool-এর
     একই যোগ্যতা-শৃঙ্খলা — team pool, support roles, away বাদ, SUSPENDED
     বাদ, **working-hours-এর বাইরের এজেন্ট কখনো নয়**, capacity বাদ —
     তার মধ্যে সবচেয়ে কম ব্যস্তজন; বর্তমান assignee নিজে কখনো নয়।
     প্রার্থী না থাকলে marker বসে না (পরের sweep আবার চেষ্টা করবে)।
- প্রতিটি ধাপ audit-এ: `inbox.sla.warning` / `inbox.sla.lead_alerted` /
  `inbox.sla.auto_reassigned` (from/to সহ)।

### IN4d — Handover queue-তে SLA-risk sort
- `sort: "sla_risk"` — কার্যকর deadline অনুযায়ী (সবচেয়ে overdue আগে);
  scope-এর বাইরের row শেষে। Handover ফোল্ডারে UI toggle pill
  ("বেশি অপেক্ষা আগে" / "⏰ SLA ঝুঁকি আগে"); ফোল্ডার ছাড়লে sort
  নিজে থেকে default-এ ফেরে (persisted filter-এ আটকে থাকে না)।

## যাচাই
- API spec `apps/api/src/inbox/in4-sla.spec.ts` — **19/19 pass**:
  pure layering (parse/effective/state/where-এর legacy-সমান আকৃতি),
  settings round-trip + validation, layered folder + counts (whatsapp
  30m স্তর; VIP 15m স্তর), warning একবার + unassigned-এর দেরি-সতর্কতা,
  lead alert (team lead / disabled / OWNER fallback / সময়ের আগে নয়),
  auto-reassign (least-busy; away/off-shift/same-person বাদ; default
  বন্ধ; প্রার্থী না থাকলে marker-হীন retry), scope (responded/closed/
  practice কখনো scan নয়), handover sla_risk order বনাম waiting order।
- Regression sweep: in3 + nextgen-p2 + cx4 + cx5 + u2 + ux1-counts +
  in1 + m71 + m74 + cx3-jobs + automation — সব pass। Counts-এর একটি
  আসল বাগ ধরা পড়ে ও ঠিক হয়: layered where-এর `OR` আর notSnoozed-এর
  `OR` flat spread-এ সংঘর্ষ করত — এখন AND-compose।
- API tsc clean; web tsc clean; web `inbox-in4.test.ts` 4/4
  (chip format + input parse); prisma validate সবুজ।
- Full gate সংখ্যা: `docs/in-b2-acceptance.md`-তে।

## সৎ সীমা
- **Live প্রমাণ নেই:** chain fake-prisma + fake clock-এ প্রমাণিত;
  আসল DB-র বিরুদ্ধে sweep চালানো হয়নি, live সাইটে AgentNotification
  পৌঁছানো দেখা হয়নি (M30-র অপেক্ষায়)। Job template শুধু তখনই চলে
  যখন org Automations-এ "Inbox SLA Sweep" job তৈরি/চালু করে।
- **Migration deploy-নোট:** `20261012220000_in4_sla_chain` কোনো আসল
  DB-তে চালানো হয়নি। Deploy-এ না চালালে settings read/write ও sweep
  নতুন কলামে ব্যর্থ হবে। Deploy-এ `prisma generate`-ও লাগবে।
- VIP স্তর নির্ভর করে `escalationThresholdMinor` সেট থাকার ওপর —
  থ্রেশহোল্ড না থাকলে VIP সনাক্তকরণই নেই, স্তরটি নীরবে অকার্যকর
  (UI-তে থ্রেশহোল্ডের পাশাপাশি ব্যাখ্যা দেওয়া আছে)।
- Warning সবসময় চালু (আলাদা off-switch নেই) — এটি শুধু দায়িত্বপ্রাপ্ত
  এজেন্টকেই জানায়; lead alert ও auto-reassign-এর নিজস্ব switch আছে।
- `sla_risk` sort saved view-তে persist হয় না (saved-view sanitizer
  sort whitelist-এ নেই) — handover queue-র session-ভিত্তিক toggle।
- Team report-এর পুরনো `currentBreaches` count (status "open" মাত্র,
  default সীমা) অপরিবর্তিত রাখা হয়েছে — layered folder count-এর সঙ্গে
  তা হুবহু মিলবে না; report-কে layered করাটা এই item-এর scope-এর বাইরে।
