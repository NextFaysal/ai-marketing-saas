# SN Batch 2 (SN3 + SN4) — Acceptance

**সুযোগ:** SN3 (Pipeline board + calendar drag) ও SN4 (AI variant/translation + repurpose)।
**ভিত্তি:** Batch N1 HEAD `f51d2b6`। **Migration: এই batch-এ কোনো migration নেওয়া হয়নি** — SN3 সম্পূর্ণ বিদ্যমান transition endpoint-এর ওপর দাঁড়িয়ে, SN4 সম্পূর্ণ RETURN ONLY; নতুন কোনো persisted state লাগেনি, তাই `20261015110000` range-এর fallback-ও ব্যবহার হয়নি।
**Commits:** `dd2882e` (SN4 API) · `3ec9ef9` (SN3 web helpers) · `89295a2` (SN3+SN4 web UI) · এই docs commit।

> Commit ভাগ সম্পর্কে সৎ নোট: বিশুদ্ধ SN3 অংশ (board/calendar decision helpers + test) আলাদা commit-এ গেছে, SN4 API-ও আলাদা। কিন্তু `page.tsx` / `PostsPanel.tsx` / `shared.tsx`-এ SN3 (board/calendar handler ও view) আর SN4 (repurpose/variant handler ও state) একই ফাইলে পাশাপাশি বসে — hunk-ভাগ করে আলাদা SN3-web / SN4-web commit বানানো বাস্তবে ভঙ্গুর হতো বলে UI অংশটা এক combined commit-এ গেছে, commit message-এ দুটোই নামসহ লেখা আছে।

---

## SN3 — Pipeline board + calendar drag

### Board view
- Posts tab-এ List / Calendar / Queue-এর পাশে চতুর্থ view **"বোর্ড (Board)"**। Column পাঁচটা: **খসড়া (Draft) → অনুমোদনের অপেক্ষায় (Pending,** `manager_approved`-সহ**) → অনুমোদিত (Approved) → শিডিউল করা (Scheduled) → প্রকাশিত / ব্যর্থ (Published/Failed মিলিত,** card-এর status pill দিয়ে আলাদা; `sent_to_creator` ও `cancelled`-ও এই শেষ column-এ**)**।
- Mapping-এর পুরো সিদ্ধান্ত `apps/web/src/lib/social-board.ts`-এর pure helper-এ (`boardColumnForPost`) — 21টি vitest case-এ পিন করা।
- Card: account avatar + নাম, platform chip, media thumbnail, caption ঝলক, সময় (scheduled/published), status ও approval pill, failed হলে error লেখা।
- **সৎ সীমার নোট UI-তেই আছে:** "বোর্ডে বর্তমানে লোড করা Nটি পোস্টই দেখা যাচ্ছে" + "আরও লোড করুন" বোতাম — SU11-এর paged-set trade-off-এর ধারাবাহিকতা, board/calendar দুটোই শুধু লোড হওয়া set নিয়ে কাজ করে।

### Drag transition matrix (যা বসল)
সব drop ও move-menu একই pure helper (`boardDropAction`) দিয়ে **একটিমাত্র বিদ্যমান action**-এ ম্যাপ হয়; কোনো নতুন transition API বানানো হয়নি:

| From → To | Action (বিদ্যমান endpoint) | শর্ত |
|---|---|---|
| Draft → Pending | `submit-approval` | approval চালু + `approvalStatus` null/rejected হলেই; নইলে অবৈধ + কারণ |
| যেকোনো → Pending | — | উপরের একমাত্র পথ ছাড়া সব অবৈধ |
| Pending → Approved | `approve` | শুধু Pending column থেকে |
| Draft/Pending/Approved → Scheduled | schedule **modal** খোলে | সরাসরি drop-এ publish হয় না — সময় বাছাই বাধ্যতামূলক; modal-এ posting-slot quick pick (account-এর enabled slot, org timezone-এ পরের occurrence) |
| Failed → Scheduled | schedule modal | retry-র পথ |
| Draft/Pending/Approved/Scheduled → Published | `publish-now` (confirm-সহ, আগের handler-ই) | |
| Scheduled → Draft | `cancel-schedule` | একমাত্র "পেছনের" পথ |
| Failed → Published/Failed | **noop** | একই column — কিন্তু card-এর move-menu-তে "এখনই Publish করুন" retry entry আলাদাভাবে থাকে (`boardMenuActions`) |
| Publishing (যেকোনো) | অবৈধ | "Post-টি এখন publish হচ্ছে — এই অবস্থায় সরানো যাবে না।" |
| বাকি সব (Draft→Approved সরাসরি, Published→অন্য কিছু, ইত্যাদি) | অবৈধ | helper-এর বাংলা কারণ banner-এ দেখায়, card আগের column-এই থাকে (state বদলায় না) |

- Gate সম্মান: two-step approval (SU9) ও client-approval gate (SN2) **সার্ভারেই** আছে — UI নিজে বিচার করে না; drag শুধু আগের বোতামগুলোর একই handler ডাকে। সার্ভার refuse করলে তার verbatim কারণই banner-এ আসে এবং সেটাই চূড়ান্ত (যেমন client gate-এর "ক্লায়েন্ট অনুমোদন বাকি")।
- Touch/mobile: প্রতিটি card-এ move-menu (▲/▼ বোতামে সম্ভাব্য action গুলো) — drag একমাত্র পথ নয়।

### Calendar drag-reschedule
- মাস view-তে **শুধু `scheduled` post-এর chip draggable** (`isCalendarDraggable`)। অন্য দিনে drop → বিদ্যমান `schedule` endpoint-এই নতুন তারিখ, **org timezone-এ wall-clock সময় অপরিবর্তিত** (`rescheduledIsoKeepingTime` — `utcToLocalInput`/`localInputToUtcIso` পুনঃব্যবহার; test-এ Asia/Dhaka কেস পিন করা)।
- একই দিনে drop = no-op। ব্যর্থ হলে posts state বদলায় না — chip আগের দিনেই থাকে + সার্ভারের কারণ banner-এ।

## SN4 — AI variant/translation + repurpose

### API (নতুন ৩ route, সব `WRITE_ROLES`, সব RETURN ONLY)
| Route | Body | Response |
|---|---|---|
| `POST posts/ai-variants` | `{caption ≤2200, platforms[] ≤5, tone?}` | `{variants: [{platform, caption, policy:{status, findings}}], droppedCount, provider, isRealLlm: true}` |
| `POST posts/ai-translate` | `{text ≤2200, targetLang: "bn" \| "en"}` | `{text, provider, isRealLlm: true}` |
| `POST posts/ai-carousel-outline` | `{caption ≤2200}` | `{slides[4–8], droppedCount, provider, isRealLlm: true}` |

শৃঙ্খলা (SU4-এর হুবহু ধাঁচ, `SocialAiService`-এ):
- সবার আগে per-feature daily cap/kill switch: `social_variants` / `social_translate` / `social_carousel_outline`।
- **Real-LLM-only:** provider real না হলে বাংলা BadRequest, **কোনো usage row নয়** (content-plan-এর refuse ধাঁচ)। Usage row provider success-এর পর, parse-এর আগে।
- **Number guard পুনঃব্যবহার** (`extractSocialNumbers`/`ungroundedNumbers`, বাংলা সংখ্যা normalize-সহ): variant ও carousel slide-এ মূল লেখায় নেই এমন সংখ্যা এলে সেই item **বাদ + `droppedCount`**; variant সব বাদ গেলে / outline-এ ২-এর কম slide থাকলে 400। **Translate-এ guard লঙ্ঘন হলে ফলাফল না দিয়ে throw** — আংশিক/ভুল অনুবাদ field-এ বসার ঝুঁকি নেওয়া হয়নি।
- Variants-এ platform whitelist (meta_page/instagram/tiktok/youtube/linkedin) filter+dedupe, platform-ভিত্তিক prompt guidance (Meta লম্বা/link-friendly, IG সংক্ষিপ্ত+hashtag, TikTok hook-first, YouTube title-ধাঁচের প্রথম লাইন, LinkedIn professional); translate prompt-এ hashtag/URL/@mention/emoji/সংখ্যা হুবহু রাখার নির্দেশ।
- **Zero rows:** তিনটি method-ই `AIUsageRecord` ছাড়া কোনো table-এ লেখে না — spec-এ `SocialPost`/`SocialContentPlan` row = 0 assert করা (`social-sn4.spec.ts`, 14 case)।

### Web
- **Composer:** AI panel-এ "📱 Platform Variant বানান" — বেছে-নেওয়া account গুলোর distinct platform ধরে call; ফলাফল platform-কার্ডে policy chip-সহ দেখায়; **"বসান"** চাপলে ওই platform-এর **সব** target account-এর SU1 variant override-এ caption বসে (notice-এ account-এর নামসহ)। Single-target ক্ষেত্রে variant panel আগে লুকানো থাকত — এখন override থাকলেই panel খোলে, নইলে বসানো variant অদৃশ্য/সম্পাদনা-অযোগ্য হয়ে যেত।
- **অনুবাদ:** মূল caption ও প্রতিটি variant textarea-র পাশে EN/বাংলা অনুবাদ বোতাম — ফলাফল **আগে preview-তে দেখায়**, "বসান" চাপলেই কেবল field বদলায়। Variant-এর ক্ষেত্রে অনুবাদের উৎস = ওই account-এর কার্যকর caption (override থাকলে সেটা, নইলে মূল caption)।
- **Repurpose menu** (post detail expander-এ): (ক) **Reel Script** — SU4-এর বিদ্যমান `ai-script` endpoint-ই call হয় (topic = caption-এর প্রথম লাইন), ফলাফল সেখানেই দেখায়; (খ) **Carousel Outline** — নতুন endpoint, slide তালিকা + dropped নোট; (গ) **Messaging হ্যান্ডঅফ** — নিচে।
- সব AI ফলাফল RETURN ONLY / মানুষের হাতে field-এ বসে — কোনো auto-save বা auto-publish নেই।

### Messaging হ্যান্ডঅফ — যা আসলে হলো
- **Deep-link prefill-ই বসল:** `GET /dashboard/messaging?prefill=<caption>` — Messaging পেজে mount-only effect param-টি পড়ে broadcast composer-এর `bcForm.body`-তে **খসড়া হিসেবে** বসায় (body আগে থেকেই ভরা থাকলে ছোঁয় না), তারপর `history.replaceState` দিয়ে param মুছে দেয় (refresh-এ পুনঃপ্রয়োগ হয় না) + সবুজ notice দেখায়। **কোনো broadcast তৈরি/send হয় না।**
- সীমা: URL-এ নিরাপদ দৈর্ঘ্যের জন্য encoded caption **≤ 1800 অক্ষর** হলেই লিংক বোতাম দেখায়; বড় caption-এ লিংকের বদলে note + "📋 ক্যাপশন কপি করুন" বোতাম (clipboard)। কপি বোতাম দুই ক্ষেত্রেই আছে।

---

## Gates (final tree)

- **API jest FULL:** একক run-এর বদলে test-list ৭ chunk-এ `--runInBand`: 62/575 + 56/476 + 56/571 + 60/640 + 55/642 + 57/590 + 58/749 = **404 suites / 4243 tests, সব PASS** (N1: 403/4229; +১ suite = `social-sn4`, +১৪ test)।
- **Web vitest FULL:** 55 files / **462/462 PASS** (N1: 441; +21 board/calendar helper test)।
- **tsc:** API 0 · web 0 · admin 0।
- **Build:** `pnpm -r build` exit 0।
- **Fresh Postgres 16.15:** পুরো sequence **193/193 applied**, 0 unfinished/rolled back, 257 tables (এই batch-এ migration নেই — সংখ্যা N1-এর সমানই প্রত্যাশিত ছিল)।

## সৎ সীমা

- **কোনো live LLM বা live platform call হয়নি** — সব প্রমাণ stubbed-boundary/spec ও helper-test স্তরে। SN4-এর তিনটি endpoint-ই real LLM configure করা org ছাড়া refuse করবে; live আচরণ SU0/SN0 live verification-এর অংশ, এখনো বাকি।
- Board ও calendar **শুধু লোড হওয়া paged post set** নিয়ে কাজ করে (UI-তে নোটসহ) — server-side board query বানানো হয়নি।
- Drag HTML5 (desktop); touch-এ move-menu-ই পথ — touch-drag library যোগ করা হয়নি।
- Composer-এ translate/variant ফলাফল component state-এ থাকে — composer বন্ধ করলে হারিয়ে যায় (কোনো save নেই, ইচ্ছাকৃত)।
- Editing mode-এ platform-variant section দেখায় না (variant শুধু group তৈরির সময়ের কাঠামো)।
