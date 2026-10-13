# IN9 — গতি ও কাঠামো: Cursor Pagination, Composer Draft, আংশিক Refactor — Acceptance

**তারিখ:** ২০২৬-১০-১৩ · **Worktree:** `ai-marketing-saas-in`, branch `in-package` (base HEAD `f647211`, IN8 শেষ) · **Migration:** নেই (লাগেনি) · **Push:** হয়নি (মালিকের নির্দেশ ছাড়া নয়)

> **কোনো performance সংখ্যা দাবি করা হচ্ছে না।** Sandbox-এ আসল DB নেই, তাই প্ল্যানের "১,০০০ seeded conversation-এ আগে/পরে গতি মাপা" ধাপটি করা হয়নি এবং কোনো invented সংখ্যাও দেওয়া হয়নি। Cursor pagination যে 100-র সীমা পেরিয়ে পুরনো conversation-এ পৌঁছায়, তা fake-prisma spec দিয়ে প্রমাণিত (নিচে)।

## IN9a — Cursor pagination ✅ (সম্পূর্ণ)

**API** (`apps/api/src/inbox/conversation-cursor.ts` + `inbox.service.ts` + `inbox.controller.ts`):
- নতুন pure helper module: `encodeConversationCursor` / `decodeConversationCursor` (base64url JSON `{t, id}`; malformed/tampered/ভুল-shape → null), `conversationCursorWhere` (Prisma AND-fragment), `oldestCursorRow` (canonical order-এ page-এর boundary row), `clampConversationPageLimit` ([1,100], default 100)।
- `listConversations`-এ additive, **opt-in** cursor সমর্থন: `filters.cursor === undefined` হলে আগের আচরণ হুবহু (bare array, `take: 100`, একই orderBy)। `cursor: null` = প্রথম page, string = সেই boundary-র পরের page; cursor mode-এ ফেরত `{ items, nextCursor }`, শেষ page-এ `nextCursor: null`।
- Canonical order `(lastMessageAt DESC, id DESC)` — একই `lastMessageAt`-এর tie **id দিয়ে ভাঙা হয়**, তাই page boundary tie-র মাঝখানে পড়লেও কোনো row বাদ/দ্বিগুণ হয় না। `lastMessageAt` nullable: Postgres DESC-তে nulls first — cursor math সেটাই mirror করে (null → newest key), null-row-র পরের page-ও ঠিকমতো এগোয়।
- Cursor clause সব বিদ্যমান filter/folder/spam/q/amount/intent-এর সাথে AND-compose করে। Sentiment (read-time mood) path-এও cursor কাজ করে: candidate window (500) থেকে filter + page slice; boundary page-র canonical-oldest row — filtered-out row শুধু re-scan হয়, result কখনো repeat হয় না, পরের match হারায় না।
- In-memory display sort (unread / handover / snoozed / sla_risk) থাকলেও boundary সবসময় **canonical-oldest** row থেকে নেওয়া হয় (display-last নয়) — spec দিয়ে প্রমাণিত যে display sort page continuity ভাঙে না।
- Controller: `?cursor=` (present হলেই cursor mode; `""` = প্রথম page) + `?limit=` query param। Counts endpoint অপরিবর্তিত (আলাদা server aggregate — বদলানোর দরকার ছিল না)।
- Malformed cursor → throw নয়, প্রথম page (সৎ fallback, doc-এ ও code comment-এ লেখা)।

**Web** (`page.tsx` + `lib/inbox-in9.ts`):
- `loadConversations` প্রথম page cursor mode-এ আনে (`cursor=""`), envelope ও legacy bare-array দুটোই গ্রহণ করে; filter set `listParamsRef`-এ রাখা হয় যাতে load-more কখনো visible list-এর filter থেকে সরে না যায়।
- `loadMoreConversations`: live cursor + সংরক্ষিত params দিয়ে পরের page এনে tested `appendConversationPage` helper দিয়ে append (id দিয়ে dedupe, আগে-load-হওয়া fresher row জেতে)। Refresh/filter বদলে গেলে in-flight stale response cursor-check দিয়ে বাদ পড়ে; fetch ব্যর্থ হলে cursor থেকে যায় — পরের চেষ্টায় একই page আবার আসবে, কিছুই "loaded" সাজে না।
- Sentinel এখন dual: loaded list-এর বাকিটা আগে `visibleCount` দিয়ে reveal, তারপর `nextCursor` থাকলে পরের API page টানে; footer-এ স্পষ্ট **"আরও কথোপকথন লোড করুন"** button-ও আছে (loading stateসহ)।

**প্রমাণ** (`apps/api/src/inbox/in9-cursor.spec.ts`, 11 test): codec round-trip (dated + null), garbage rejection, limit clamp, legacy bare-array অপরিবর্তিত, **12-conversation পূর্ণ walk — 4 page-এ প্রতিটি ঠিক একবার, canonical order-এ**, tie-group page boundary-তে split (page 1 শেষ `a2`, page 2 শুরু `a1`), null-timestamp row-র পর continuation, malformed cursor → first page, channel filter-সহ walk, `sort=unread` display sort-সহ সম্পূর্ণ walk, default limit-এ এক page + `nextCursor: null`।

## IN9d — Offline-সহনশীল composer draft ✅ (ছোট, নিরাপদ অংশ)

- `lib/inbox-in9.ts`: `loadComposerDraft` / `saveComposerDraft` / `clearComposerDraft` — conversation-প্রতি `inbox.draft.<id>` key-তে localStorage (UX1 persist ধাঁচে), সব storage op best-effort try/catch (private mode/quota → নীরবে "draft নেই")।
- Page wiring: conversation খুললে সেই conversation-এর draft composer-এ ফিরে আসে; লিখলেই save (খালি লেখা = draft মোছা); conversation বদলালে `replyOwnerRef` guard নিশ্চিত করে এক conversation-এর লেখা অন্যের key-তে কখনো লেখা হবে না; reload-এর পর conversation খুললেই draft ফেরে।
- **Send সফল/চেষ্টা হলে** composer খালি হয় → draft নিজে থেকে মোছে; পাঠানো ব্যর্থ হলে লেখা UX1 pending bubble-এ থাকে (retry সেখান থেকে) — draft আর bubble পরস্পরের সাথে সংঘর্ষ করে না। Pending bubble কখনো "sent" সাজে না — এই batch-এ সে আচরণে হাত পড়েনি।
- সীমা (সৎ): শুধু text draft সংরক্ষিত হয় — attachment/quote target/mode সংরক্ষিত নয়; offline queue থেকে auto-resend করা হয় না (প্ল্যানের IN9d-র ভাষাতেও প্রস্তাব ছিল, auto নয়)।
- Test: `lib/inbox-in9.test.ts` (7 test) — save/load/clear, per-conversation isolation, empty-save = clear, ভাঙা storage-তে no-throw, `appendConversationPage`-র dedupe/order।

## IN9b — Windowing: যাচাই করে সিদ্ধান্ত ⚠️ (আংশিক — সচেতনভাবে)

- বর্তমান list ইতিমধ্যে **progressive render cap** ব্যবহার করে (`visibleCount` 40 করে বাড়ে + sentinel) — অর্থাৎ প্রথম paint-এ শুধু 40টি card DOM-এ থাকে। IN9a-র পর এই cap + sentinel-ই এখন server page-ও টানে, ফলে DOM-এ card-সংখ্যা সবসময় agent যতটা scroll করেছে ততটাই।
- **সত্যিকারের virtualization (শুধু viewport-এর card DOM-এ রাখা) করা হয়নি।** কারণ: (১) নতুন dependency নিষেধ ছিল (react-window জাতীয়); (২) হাতে-লেখা windowing-এর জন্য card-গুলোর height variable (tags/SLA chips/handover label অনুযায়ী বদলায়), আর list-এ keyboard navigation (`j/k` + `scrollIntoView`), focused ring, select-mode checkbox-এর মতো আচরণ এই DOM কাঠামোর ওপর দাঁড়িয়ে — ঝুঁকি/লাভ অনুপাত solo-maintenance-এ খারাপ। জোর করে ভাঙা refactor না করে cap+sentinel পথটাই রাখা হলো; ভবিষ্যতে লাগলে fixed-height card redesign-সহ আলাদা package-এ করা উচিত।

## IN9c — Page refactor ⚠️ (আংশিক — নিরাপদ অংশটুকুই)

`page.tsx`: **3,919 → 3,852 লাইন** (net −67; একই commit-এ IN9a/IN9d wiring ~+110 লাইন যোগ হয়েছে, তাই মোট সরানো অংশ net-এর চেয়ে বড়)।

সরানো হয়েছে (verbatim, আচরণ অপরিবর্তিত — প্রতিটি ধাপের পর web vitest + tsc সবুজ দেখে পরের ধাপ):
- **ধাপ ১:** pure format helper — `money`, `clampPane`, `dayLabel`, `relTime`, `initialsOf`, `renderQuick`, `CHANNEL_META`, `CHANNEL_DOT`, `HANDOVER_REASON_LABELS`, `COURIER_RISK_BAND_BN`, `MOOD_TITLE` → নতুন `apps/web/src/lib/inbox-format.ts` (81 লাইন)।
- **ধাপ ২:** props-only component — `ChannelChip`, `ConvAvatar`, `MediaView`, `ShipmentWidget` → `apps/web/src/components/inbox-extras.tsx` (+100 লাইন; আগে থেকেই inbox-এর sub-component-এর ঘর)। `MediaView` নিজের fetch/state নিজের ভেতরেই রাখে, page state ভাগ করে না।

**সৎভাবে বাকি রইল:** মূল `InboxPage` component (~3,700 লাইন) — composer/thread/context/manage-এর stateful অংশ। এগুলো পরস্পর-জড়ানো state (ghost, quote, drafts, stream handler) ভাগ করে; task-এর নির্দেশমতো ঝুঁকির জায়গায় থামা হলো। পরের নিরাপদ ধাপ হতে পারে context-panel ও manage view-কে আলাদা component-এ নেওয়া, তবে তার আগে props boundary-র design দরকার — এই batch-এ করা হয়নি।

## যা ছোঁয়া হয়নি

- IN8-এর ফাইল (`social-comments*`, `meta-messaging.client`) — একদমই নয়।
- কোনো migration নেই; schema অপরিবর্তিত। Main repo ছোঁয়া হয়নি; push/fetch হয়নি।

## Gate (এই worker-এর targeted + web পূর্ণ)

- API targeted: `in9-cursor.spec.ts` **11/11**; পাশের list-নির্ভর suite (in1, in4, in10, cx4, cx5, cx12d, inbox-power, inbox.service, nextgen-p2, nextgen-p3, ux1-counts) **167/167** — zero regression।
- API tsc: clean। Web vitest: **156/156** (baseline 149 + IN9-র 7)। Web tsc: clean। Web `next build`: সবুজ।
- পূর্ণ API gate এই worker চালায়নি — সেটি B5 final-gate coordinator-এর কাজ।
