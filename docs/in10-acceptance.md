# IN10 — আস্থা ও Analytics v2 (Acceptance)

Batch B4, branch `in-package`. সব কাজ local commit, **push হয়নি**।

## IN10a — Block/report (আমাদের সিস্টেমের ব্লক)
- `ChannelConversation`-এ `blockedAt / blockedByUserId / blockReason` (migration `20261012250000_in10_conversation_block`, additive, nullable)।
- `POST conversations/:id/block` — block করলে `spamFlag=true` বসে (কারণে "ব্লক করা হয়েছে" prefix; unblock শুধু block-এর তৈরি spam mark-ই তোলে, আগের আলাদা spam সন্দেহ ছোঁয় না)। দুটোই audit হয় (`inbox.conversation.blocked/unblocked`)।
- **Ingest gate:** `processInboundIntelligence`-এর একদম গোড়ায় — blocked conversation-এর নতুন মেসেজে transcription, intent/sentiment, COD, CSAT, spam-detect, bot, autopilot **কিছুই চলে না** (AI খরচ শূন্য)। CX3 deferred-reply sweep-ও blocked batch না পাঠিয়ে clear করে। Manual agent reply সবসময় চলবে।
- **Spam queue:** web অনেক আগে থেকেই `spam=1` পাঠাত কিন্তু service কখনো পড়ত না (dead toggle) — এখন `listConversations`-এ `spamOnly` wired; blocked + spam-flagged দুটোই এই কিউতে। UI লেবেল এখন "🚫 Spam/ব্লক কিউ"।
- UI-তে সর্বত্র স্পষ্ট লেবেল: **"শুধু আমাদের সিস্টেমে"** — প্ল্যাটফর্মে (Messenger/WhatsApp) কোনো block হয় না, গ্রাহক মেসেজ পাঠাতেই পারবেন; মেসেজ আমাদের spam কিউতে আসবে।

## IN10b — সংবেদনশীল তথ্য ও audit
- **View audit:** `getConversation` actor পেলে `inbox.conversation.viewed` লেখে — একই viewer+conversation-এ **30 মিনিটে একবার** (audit table থেকে শেষ view পড়ে dedupe; audit check ব্যর্থ হলে কিছুই লেখা হয় না — flood-এর পথ নেই)।
- **Export audit:** single-conversation ও পুরো inbox export এখন actor-সহ audited (`inbox.conversation.exported`, `inbox.exported`)।
- **Audit তালিকা:** `GET conversations/:id/audit` (OWNER/ADMIN/MARKETING_MANAGER) — conversation + তার customer + তার message-গুলোর ওপরের সব AuditLog row, নতুন আগে, cap 50। নতুন কোনো substrate নয় — বিদ্যমান `AuditService`/`AuditLog`-ই।
- **Note masking (opt-in):** note composer-এ "🔒 সংবেদনশীল তথ্য মাস্ক করুন" checkbox; `pii-mask.ts`-এর `maskSensitiveText` **store হওয়ার আগেই** BD ফোন, 13–19 digit card-like run, letter+digit 10–24 char TrxID-জাতীয় token মাস্ক করে। টাকার অঙ্ক ও অর্ডার নম্বর মাস্ক হয় না। Masking one-way — আসল লেখা কোথাও সংরক্ষিত হয় না। Default OFF, agent-এর সচেতন পছন্দ।

## IN10c — Analytics v2 (Manage view)
Pure builder `in10-analytics.ts` + `GET inbox/analytics?days=` (1–90 clamp)। **প্রতিটি সংখ্যা raw query দিয়ে পুনঃderived করা যায়** — সংজ্ঞা fixed:
- **Range:** rolling `days`×24h (calendar day নয়), org timezone-এ bucketing।
- **Heatmap:** range-এর ভেতরের inbound মেসেজ, org timezone-এর weekday×hour matrix + hour totals + peak hour।
- **Channel conversion:** channel অনুযায়ী active conversation (lastMessageAt range-এ) ÷ তার মধ্যে যেগুলোর chat-linked (Order.conversationId) **non-cancelled** order range-এ তৈরি হয়েছে। Cancelled কখনো conversion নয়।
- **Trend:** প্রতিদিন নতুন conversation, inbound মেসেজ, গড় first-response (শুধু যাদের firstResponseAt আছে), resolved সংখ্যা ও গড় resolution — **নমুনা না থাকলে null ("—" দেখায়), কখনো 0 নয়**।
- **Intent ভাঙন:** classified inbound মেসেজের মধ্যে intent অনুযায়ী count + %।
- Scan caps: conversation 2000, message 10000, order 5000; practice conversation বাদ। কোনো vanity metric নেই।
- **হিসাব যাচাই:** spec-এ হাতে-হিসাব করা fixture (Dhaka timezone-এ ঘণ্টা বদলসহ) — heatmap bucket, peak hour, channel conversion (100%/0%), trend average (30 ও 60 মিনিটের গড় 45), intent % হুবহু assert করা। পাশাপাশি service-level test org-scope ও window যাচাই করে।
- ⚠️ **Spec একটি আসল bug ধরেছে:** builder direction `"in"` আশা করে, DB-তে `"inbound"` — service normalize না করলে production-এ সব count শূন্য হতো। একই commit-এ fix + regression assertion।

## IN10d — CSAT পলিশ
- Rating ≤3 capture হলেই `slaLeadUserIds` (IN4-এর lead resolution: escalation team → conversation team → OWNER/ADMIN) দিয়ে lead-দের **urgent** AgentNotification। Rating একবারই capture হয় বলে notification-ও একবারই। Rating 5-এ কিছু যায় না (spec)। Notification ব্যর্থ হলেও rating capture ভাঙে না।

## Spec (IN10: 13)
`apps/api/src/inbox/in10.spec.ts` — pure builder arithmetic (5), pii-mask (1), block+spam queue+ingest gate+control twin+sweep (3), CSAT (1), audit dedupe/export/list (1) + note masking (1), analytics service org-scope (1)।

## Migration deploy-নোট
- `20261012250000_in10_conversation_block` **কোনো আসল DB-তে চলেনি** — deploy-এ migration চালাতে হবে; তার আগে block endpoint column-error দেবে (বাকি inbox অক্ষত — column-গুলো শুধু block path-এই পড়া হয়)।
