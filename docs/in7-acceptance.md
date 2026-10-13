# IN7 — AI Next Steps (Handover Summary · Next Action · Auto-tag/stage Proposal · Language Match · Unanswered Learning) Acceptance

Worktree `~/workspace/ai-marketing-saas-in`, branch `in-package`,
IN6 HEAD `ef816bf` থেকে। মালিকের অনুমোদন: পুরো IN1–IN10 প্যাকেজ
(2026-10-12 22:16 +06), B3 = IN6 + IN7। Main repo ছোঁয়া হয়নি;
push/fetch হয়নি। **Schema বদল লাগেনি** — কোনো migration নেই।

## কী তৈরি হলো

### IN7a — Handover summary (সিস্টেম নোট)
- `InboxService.writeHandoverSummaryNote` (failure-isolated private):
  take-over (`takeOverConversation`) ও assignee-বদল
  (`updateConversation`-এ `assignedUserId` আগের থেকে আলাদা হলেই)
  — এই দুই handover মুহূর্তে AI এক-অনুচ্ছেদ (২–৪ বাক্য) সারসংক্ষেপ
  `createNoteInternal` পথে ConversationNote হিসেবে timeline-এ বসে,
  শুরুতে সিস্টেম লেবেল `🤖 AI হ্যান্ডওভার সারসংক্ষেপ (সিস্টেম নোট)`
  — মানুষের নোট থেকে স্পষ্ট আলাদা।
- **Number-guard (ghost-এর একই শৃঙ্খলা):** summary-র প্রতিটি সংখ্যা
  thread অথবা published instructions-এ থাকতে হবে
  (`InboxService.extractNumbers`)। বানানো সংখ্যা এলে summary বাতিল,
  audit `inbox.handover_summary.guard_rejected`, আর নোটে সৎ বার্তা:
  "সারসংক্ষেপ তৈরি হয়নি — সংখ্যা যাচাই হয়নি…"।
- **Handover কখনো ব্যর্থ হয় না:** kill switch/cap (403/429 ধরা পড়ে,
  `attempted:false`), dev provider / খালি thread / provider ত্রুটি —
  সব ক্ষেত্রেই take-over/assign সম্পন্ন হয়; ফলাফল আলাদা
  `handoverSummary: {attempted, created, reason?}` আকারে response-এ
  ফেরত যায়, UI সেটা notice আকারে দেখায় (তৈরি হলে timeline refresh
  হয়ে নোটটি দেখা যায়)।
- Dev provider-এ কোনো ভুয়া summary নয় — নোটে "সারসংক্ষেপ তৈরি
  হয়নি — আসল AI provider যুক্ত নেই", usage row-ও পড়ে না।

### IN7b — Suggested next action
- `POST organizations/:orgId/inbox/conversations/:id/next-action`
  (roles: OWNER/ADMIN/MARKETING_MANAGER/SUPPORT_AGENT) →
  `{ proposal: {action, label, reason, tags, pipelineStage} | null, provider, reason? }`।
- action একটি **বন্ধ allowlist** থেকে (`in7-ai.ts`): `share_tracking`,
  `cod_confirm`, `create_order`, `wait_customer`, `reply_manually`,
  `resolve` — প্রতিটি বিদ্যমান UI পথে ম্যাপ করে। মডেলের JSON strict
  parse হয়; allowlist-এর বাইরের action পুরো প্রস্তাব বাতিল করে।
- Grounding: thread (শেষ ২০ মেসেজ) + linked customer-এর আসল সর্বশেষ
  অর্ডারের status/COD অবস্থা। **এই endpoint কিছু পাঠায় না, কিছু
  লেখে না** (spec-এ প্রমাণিত: message/note/conversation অপরিবর্তিত)।
- UI: context প্যানেলে "🤖 AI-এর পরের পদক্ষেপ" কার্ড — প্রস্তাব +
  কারণ, এক click-এ বিদ্যমান পথ চালু (share-tracking বোতাম-পথ /
  `requestCod` / order প্যানেল খোলা / composer focus / status close);
  `wait_customer` তথ্যমূলক। প্রত্যাখ্যানে কিছু বদলায় না।

### IN7c — Auto-tag/stage প্রস্তাব
- একই response-এ `tags` (সর্বোচ্চ ৩, বর্তমান tag বাদে) ও
  `pipelineStage` (বর্তমান stage হলে null) প্রস্তাব + কারণ।
- প্রস্তাব **কোথাও persist হয় না**। Agent "Tag/Stage গ্রহণ করুন"
  ক্লিক করলেই UI বিদ্যমান `updateConversation` (PATCH) পথে বসায়
  (tag merge, replace নয় — `proposalAcceptPatch`, web test-এ প্রমাণিত)।

### IN7d — ভাষা মিলিয়ে উত্তর
- Pure deterministic detector `detectReplyLanguage` (`in7-ai.ts`):
  বাংলা হরফ (U+0980–U+09FF, সংখ্যা বাদে) বনাম Latin হরফের অনুপাত —
  ≥৬০% bn / ≥৬০% en / নইলে mixed; হরফ না থাকলে null (কোনো নির্দেশ নয়)।
- `composeLlmGroundedReply`-র prompt-এ: **override থাকলে সেটাই জেতে**
  (আগের আচরণ অপরিবর্তিত — `replyLanguage` bn/en হলে detected লাইন
  যোগই হয় না); override না থাকলে detected ভাষার নির্দেশ যোগ হয়।

### IN7e — Unanswered → শেখা
- `POST organizations/:orgId/ai-instructions/unanswered/:id/draft-proposal`
  (OWNER/ADMIN/MARKETING_MANAGER) → `{ proposal: {kind, title, content, reason} | null, provider, reason?, question }`।
  kind = `knowledge` (জ্ঞানভান্ডার chunk খসড়া) অথবা `instruction`
  (এক লাইনের instruction খসড়া) — আসল প্রশ্ন + keyword-matched
  বিদ্যমান knowledge + published instructions প্রসঙ্গে grounded।
- **Endpoint কিছুই লেখে না** — knowledge row তৈরি হয় না, Desk draft
  বদলায় না, publish হয় না (spec-এ তিনটিই প্রমাণিত)। UI-তে মানুষ
  চাইলে: knowledge kind → বিদ্যমান `knowledge-documents` POST পথে;
  instruction kind → Desk-এর draft editor-এ বসে (save/publish আগের
  মতোই আলাদা ধাপ)।

## AI শৃঙ্খলা (সব item-এ parity)
- নতুন feature নাম: `handover_summary`, `next_action`,
  `unanswered_draft` — প্রতিটি `checkAiAllowed`-ধাঁচের kill switch
  (403) + per-feature daily cap (429)-এর আওতায়, enforcement LLM
  call-এর **আগে**। Desk পাশে একই প্যাটার্ন `checkFeatureLimit`
  (CX2-র `checkTestLimit` সেখান থেকে generalize করা)।
- প্রতিটি LLM call-এ `AIUsageRecord` (feature + provider + tokens) —
  guard-এ বাতিল হলেও (call হয়ে গেছে), dev provider-এ কোনো call
  হয় না বলে কোনো row-ও নয়।
- কোনো mock নয়: real provider ছাড়া সব পথ সৎ null/খালি ফল দেয়।

## যাচাই (targeted; full gate coordinator চালাবে)
- নতুন spec `apps/api/src/inbox/in7-ai.spec.ts`: **15/15 pass** —
  detector (bn/en/mixed/null + বাংলা সংখ্যা বাদ), compose-এ detected
  লাইন যোগ + override জয়, take-over summary নোট + usage, guard
  বাতিলে সৎ নোট + takeover সফল, reassign-এ trigger / non-assign-এ
  নয়, dev provider সৎ ফল, kill switch-এ takeover অক্ষত,
  next-action কোনো send/write করে না + allowlist বাতিল + 403/429,
  unanswered draft knowledge/draft/version অপরিবর্তিত রাখে + cross-org
  404 + 403/429।
- পাশের spec: cx2 + cx4 + cx5 + in3 + in4 + in6 + nextgen-p3 +
  u3-autopilot + inbox.service = **145/145 pass** (IN6-এর ফাইল ও
  CX2/CX5-এর আচরণ অপরিবর্তিত)।
- Web: `inbox-in7.test.ts` **7/7 pass**; পুরো web vitest **149/149**।
- API tsc clean, Web tsc clean। Prisma validate অপ্রয়োজনীয় —
  schema ছোঁয়া হয়নি।

## সৎ সীমা
1. **Live প্রমাণ নেই (M30 pending):** সব LLM পথ stub provider-এ
   fixture-প্রমাণিত; আসল key দিয়ে handover summary / next-action /
   draft proposal একবারও চলেনি।
2. Next-action-এর order প্রসঙ্গ শুধু **linked customer**-এর সর্বশেষ
   অর্ডার; conversation-এ সরাসরি যুক্ত (customer-less) অর্ডার এই
   প্রসঙ্গে আসে না।
3. Detector script-ratio ভিত্তিক: Roman হরফে লেখা Banglish
   (যেমন "dam koto?") `en` হিসেবে গণনা হয় — সেক্ষেত্রে নির্দেশ
   "English" হয়, যদিও base prompt-এর "customer-এর ভাষা ও style"
   লাইনটি মডেলকে মিশ্র উত্তরেই রাখে। Owner override থাকলে এই
   সীমা প্রযোজ্য নয়।
4. Handover summary প্রতিটি take-over/reassign-এ একটি note যোগ
   করে — ঘন ঘন reassign হলে timeline-এ সিস্টেম নোট জমতে পারে;
   cap-এর আওতায় থাকায় দৈনিক সীমার বাইরে যাবে না।
5. IN7e-র প্রস্তাবের মান মডেল-নির্ভর; সংখ্যা-guard এই খসড়ায়
   প্রয়োগ হয়নি — কারণ এটি display-only এবং publish/knowledge-তে
   যাওয়ার পথে মানুষের যাচাই বাধ্যতামূলক ধাপ হিসেবে আছে। Prompt-এ
   বানানো সংখ্যা/নীতি নিষেধ করা আছে।
