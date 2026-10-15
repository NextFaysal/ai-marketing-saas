# Social Posts Next — Batch N4 Acceptance (SN6 Telegram + SN7 Threads)

**তারিখ:** 2026-10-15 · **Worktree:** `~/workspace/ai-marketing-saas-sn`, branch `social-next` · **Base:** `8fd9807` (Batch N3) · **Push:** হয়নি (local commits only)।

> **Finisher নোট:** এই batch-এর মূল coordinator কাজের সব content commit বসিয়ে দেওয়ার পর daemon restart-এ মারা যায়। এই acceptance একজন finisher-এর লেখা — সে কোনো নতুন feature/design বদলায়নি; spike doc ও commit দাবি যাচাই করেছে, spec এককভাবে ও পূর্ণ gate final tree-তে নিজে চালিয়েছে, leak/সামঞ্জস্য স্পট-চেক করেছে। **কোনো fix commit লাগেনি** — gate-এ এই batch-এর কোনো ভাঙন পাওয়া যায়নি।

## Commit তালিকা (base `8fd9807`-এর পর)

| Commit | বিষয় |
|---|---|
| `ce8dfe6` | SN7 spike: Threads API + SN6 Telegram Bot API নোট — documented vs not-built verdict (`docs/social-sn7-threads-spike.md`) |
| `8c862a7` | SN6 API: Telegram channel publishing — verify-before-save connect, publish dispatch, preflight, health, insights honestly unavailable; 24 spec |
| `5cf75ec` | SN6 web: Telegram connect form, platform identity (Telegram/Threads/LinkedIn label ও dot), composer hint |
| `df747e2` | SN7 API: Threads publishing — threadsApp config + own-app path, client + container publisher, OAuth + refresh, preflight, health, documented insights + follower snapshot; 27 spec |
| `45eaf89` | SN7 web: Threads connect/modes, Admin Platform Config Threads App card, Connect Center own-app card, metric labels |

## Spike verdict-এর সারসংক্ষেপ (spike doc বনাম commit — finisher যাচাই করেছে)

### Telegram (SN6) — যা বসেছে
- **Connect = verify-before-save:** `getMe` (token যাচাই) → `getChat` (type অবশ্যই `channel`) → `getChatMember` (bot `administrator`/`creator` ও `can_post_messages` না হলে connect-ই হয় না)। Token sealed IntegrationCredential-এ থাকে।
- **Publish:** text `sendMessage` (৪০৯৬ অক্ষরে chunking), একক photo/video (`sendPhoto`/`sendVideo`, caption ১০২৪-এ spill হলে বাকিটা follow-up message), ২–১০ media হলে `sendMediaGroup`। Platform post id = `chatId:messageId`; public channel হলে `https://t.me/<username>/<message_id>`।
- **Preflight:** ১০-media cap। **Health:** `getMe`।
- **Insights: পাওয়া যায় না** — Bot API কোনো bot-কে channel post-এর views/engagement দেয় না; কোড সেটা "unavailable" হিসেবেই রাখে, invented ০ নয় (spike §৩ ও insights service-এর telegram branch — দুটোতেই finisher চোখে দেখেছে)।
- **বসেনি:** first comment (discussion-group পথ আলাদা জটিল — spike-এ not-built হিসেবে আগেই ঘোষিত)।

### Threads (SN7) — যা বসেছে
- **App model:** Meta app-এর ভিতরে আলাদা Threads app লাগে — platform config-এ নিজের `threadsApp` এলাকা (TikTok/LinkedIn ধাঁচে) + CC28 ধাঁচে tenant-এর নিজের app পথ ("configured, verified at first connect" সৎ semantics)।
- **OAuth:** threads.net authorize → short-lived token → `th_exchange_token`-এ ৬০ দিনের long-lived; refresh `th_refresh_token` (secret লাগে না) ensureAccessToken-এর threads branch-এ।
- **Publish = container flow:** container তৈরি → **সীমিত poll** (FINISHED হলেই publish; ERROR হলে container-এর `error_message` verbatim; সীমা পেরোলে সৎ timeout) → `threads_publish` → permalink। Text/image/video + carousel (child containers + parent, ২–২০)।
- **Preflight:** text ৫০০ অক্ষর, carousel সর্বোচ্চ ২০ — documented সীমা থেকেই।
- **Insights:** documented metric গুলোই (views/likes/replies/reposts/quotes/shares; absent = absent, কখনো ০ নয়) + `followers_count` দিয়ে SU7 follower snapshot। **Health:** profile GET।
- **বসেনি (spike-এ আগেই ঘোষিত):** first comment/reply (`tryPostFirstComment` threads-এ no-op), quota check/display (`/threads_publishing_limit` documented কিন্তু scope-এর বাইরে — quota শেষ হলে Meta-র publish error verbatim আসবে)। Production publish-এ `threads_content_publish`-এর Meta App Review লাগে — সেটা Meta-র gate, কোড দিয়ে ঘোষণা করা যায় না।

## Leak / সামঞ্জস্য স্পট-চেক (finisher, চোখে দেখা)

- **Serializer:** `SocialService.serializeAccount` ও `SocialOAuthService.serializeAccount` — দুটোই explicit field তালিকা (id/platform/externalId/name/username/pictureUrl/status/lastError…); credential/token কোনো field-এই নেই। Telegram bot token শুধু sealed credential row-তে।
- **Admin config:** Threads card-এ `secretConfigured: Boolean(...)` শুধু — secret-এর মান response-এ ফেরত যায় না (TikTok/Google/LinkedIn-এর একই ধাঁচ)।
- **Error পথ:** `TelegramClient` transport failure-এ ইচ্ছাকৃতভাবে মূল error ফেলে দেয় (Node fetch error-এ token-সহ URL থাকতে পারে) — শুধু Telegram-এর `description` verbatim ওঠে; client নিজে কিছুই log করে না। Token-সহ log line পুরো social tree-তে নেই (grep)।
- **Platform সামঞ্জস্য:** preflight (threads সীমা + telegram cap), health (telegram `getMe`, threads profile), insights (telegram unavailable / threads metric + follower), web identity (label "Telegram Channel"/"Threads", brand dot, account type union) — চার জায়গাতেই দুই platform উপস্থিত ও spec-pinned আচরণের সঙ্গে মিলে।

## Gates (finisher final tree-তে নিজে চালানো, হুবহু ফল)

- **API jest FULL:** test-list ৬ chunk-এ `--runInBand`: 71/624 + 67/630 + 68/699 + 67/667 + 67/803 + 68/897 = **408 suites / 4320 tests — ALL PASS** (N3: 406/4269; +২ suite = social-sn6 + social-sn7, +৫১ test = ২৪ + ২৭)। পরিচিত cx3 flake এই রানে আসেনি। SN6/SN7 spec finisher আলাদাভাবেও চালিয়েছে: **51/51 PASS**।
- **Web vitest FULL:** 56 files / **465/465 PASS** (N3-এর সমান — এই batch-এর web commit কোনো নতুন web test file যোগ করেনি)।
- **tsc:** API 0 · web 0 · admin 0।
- **Prisma validate:** valid।
- **Build:** `pnpm -r build` — **7/7 Done** (ui, contracts, db, worker, api, admin, web)।
- **Fresh Postgres 16:** এই batch-এ **কোনো migration আসেনি** (`git diff 8fd9807..HEAD -- packages/db` খালি — দুই platform-ই বিদ্যমান SocialAccount/Integration কাঠামোতে বসেছে)। Finisher নিজে নতুন throwaway DB-তে পুরো sequence চালিয়েছে: **194/194 applied, 0 unfinished/rolled back, 259 tables** (N3-এর হুবহু সমান)। Coordinator-এর রেখে যাওয়া fresh DB-তেও একই 194/259 ছিল; দুটো throwaway DB-ই যাচাই শেষে drop করা হয়েছে।

## সৎ সীমা

- **কোনো live Telegram বা Threads call এই sandbox-এ হয়নি** — সব প্রমাণ stubbed-boundary spec স্তরে। আসল bot token দিয়ে channel-এ পোস্ট ও আসল Threads app দিয়ে publish — দুটোই মালিকের অ্যাকাউন্টে live verification-এর বিষয় (SN0/SN-এর live checklist)।
- Threads production publishing Meta App Review (Advanced Access) ছাড়া app-role অ্যাকাউন্টের বাইরে চলবে না — এটি platform gate, ব্যর্থ হলে Meta-র আসল বার্তাই tenant দেখবে।
- Telegram-এ post insights স্থায়ীভাবেই unavailable (Bot API দেয় না) — ভবিষ্যতে MTProto-ভিত্তিক পথ ছাড়া এর কোনো সৎ সমাধান নেই, এই package-এ তা scope-এর বাইরে।
- পরিবেশের ঘটনা: finisher শুরুর সময় sandbox-এর `/tmp` (512 MB tmpfs) আগের run-গুলোর jest cache-এ ভরা ছিল — পরিষ্কার করে TMPDIR ও jest cache disk-এ (`~/tmp-gate`) সরিয়ে gate চালানো হয়েছে; code-এর সঙ্গে সম্পর্ক নেই। Gate চলাকালে তৈরি একটি ভুল `~` নামের cache directory ও tsconfig.tsbuildinfo churn পরিষ্কার করে tree clean রাখা হয়েছে।
