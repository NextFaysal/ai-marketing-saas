# IN1 — Search + Saved Views — Acceptance

**তারিখ:** ২০২৬-১০-১২ · **প্যাকেজ:** IN প্যাকেজ Batch B1, প্রথম অংশ · **বেস:** `a8980d6` (branch `in-package`, clean worktree `~/workspace/ai-marketing-saas-in`) · **প্ল্যান:** `Inbox-Next-Update-Plan-2026-10-12.md` §৩ IN1

## যা বানানো হয়েছে

### IN1a — মেসেজের ভেতরে search
- নতুন endpoint `GET /organizations/:id/inbox/messages/search?q=&limit=` → `InboxService.searchMessages()`।
- `ChannelMessage.content` + `transcription`-এ case-insensitive `contains` অনুসন্ধান; scope কথোপকথনের relation দিয়ে org-এ বাঁধা (`conversation: { organizationId, isPractice: false }`) — **অন্য org-এর মেসেজ ও practice conversation কখনো ফলে আসে না** (spec দিয়ে প্রমাণিত)।
- প্রতিটি ফলে: snippet (মিলের চারপাশে ±৬০ অক্ষর, `buildSearchSnippet` — pure + tested), snippet-এর ভেতরে match-এর offset/length (UI `<mark>` highlight-এর জন্য), কোন field-এ মিলেছে (content/transcription), conversation-এর channel/নাম/ফোন/status।
- Query ২ অক্ষরের কম হলে বাংলা BadRequest। Limit 1–50 (default 30)।
- Web: list pane-এ আলাদা "মেসেজে খুঁজুন" ঘর + ফলাফলের প্যানেল (নাম, channel, সময়, highlighted snippet; voice থেকে মিললে "(ভয়েসের লেখা থেকে)" লেবেল)। ফলে ক্লিক করলে conversation খুলে সেই মেসেজে scroll + amber ring highlight।

### IN1b — Advanced filter (বিদ্যমান list-এর ওপর additive)
`GET /inbox/conversations`-এ নতুন query param (সব AND-compose করে, কোনো বিদ্যমান আচরণ বদলায়নি):
- `dateFrom` / `dateTo` — `lastMessageAt` range-এ (কথোপকথন শেষ কবে সক্রিয় ছিল)। Web-এ date-only মানের জন্য দিনের শুরু/শেষ (23:59:59.999) ধরা হয়।
- `amountMin` / `amountMax` (minor unit) — কথোপকথনের **সর্বশেষ** লিংকড অর্ডারের মোট (VIP folder-এর latest-order scan ধাঁচে, take 3000)। অর্ডার নেই এমন কথোপকথন amount filter-এ কখনো মেলে না (অজানা ≠ ০)। Web-এ এজেন্ট টাকায় লেখে, helper টাকা→পয়সা রূপান্তর করে (tested)।
- `intent` — সংরক্ষিত inbound classification (`ChannelMessage.intent`) আছে এমন কথোপকথন; অজানা intent মান উপেক্ষিত।
- `sentiment` — read-time mood (শেষ ৫ inbound লেখায় P3 classifier) দিয়ে মিল; candidate fetch 500 পর্যন্ত বাড়ে, ফল 100-তে cap। Mood নেই (inbound লেখা নেই) এমন কথোপকথন sentiment filter-এ মেলে না।
- Web: "⚙️ বিস্তারিত ফিল্টার" panel (তারিখ, অর্ডার ৳ range, বিষয়, মনোভাব) + এক click-এ মোছা।

### IN1c — Saved custom views
- নতুন model `InboxSavedView` (org, userId, name, filters Json, shared) + হাতে-লেখা additive migration `20261012200000_in1_saved_views` (শুধু নতুন table + 2 index; বিদ্যমান table-এ কোনো বদল নেই)। Prisma schema validate পাস (DATABASE_URL dummy দিয়ে — env ছাড়া validate main repo-তেও একই P1012 দেয়, pre-existing)।
- CRUD: `GET/POST /inbox/saved-views`, `PATCH/DELETE /inbox/saved-views/:viewId`।
- নিরাপত্তা: (১) filters সার্ভারে whitelist-sanitize হয় (`sanitizeSavedViewFilters` — শুধু ১৫টি list-filter key, per-key type/range/vocabulary যাচাই; hostile payload spec-এ প্রমাণিতভাবে ঝরে যায়), (২) shared view সবাই *দেখতে* পারে কিন্তু **শুধু মালিকই edit/delete** করতে পারে (অন্যের চেষ্টা → 403 বাংলা বার্তা), (৩) জনপ্রতি ৫০টি view cap, (৪) create/update/delete-এ audit log।
- Web: view chips (নিজেরটায় ✕ delete; shared-এ "· টিম" লেবেল), "বর্তমান ফিল্টার ভিউ হিসেবে সেভ" form (নাম + টিমে share checkbox)। View প্রয়োগে filter + smart folder দুটোই বদলায় (round-trip helper tested)।

## যাচাই
- API spec নতুন: `apps/api/src/inbox/in1-search-views.spec.ts` — **13/13 pass** (search isolation/snippet/transcription/short-query/limit; date/amount-latest/intent/sentiment/q-regression; sanitizer/buildSearchSnippet pure; saved-view visibility + creator-only + empty-name)।
- Web vitest নতুন: `apps/web/src/lib/inbox-in1.test.ts` — **9/9 pass** (params রূপান্তর, টাকা→minor, day-end, garbage উপেক্ষা, saved round-trip, hostile restore, snippet split)।
- API `tsc --noEmit` clean (এই commit-এর ধাপে যাচাই)। পূর্ণ gate (সব jest/vitest/build) B1-এর শেষে `docs/in-b1-acceptance.md`-তে।

## সৎ সীমা
- **Search কোনো index/full-text engine নয়** — plain `contains` scan; বড় org-এ ধীর হলে trigram/FTS index পরের ধাপ (প্ল্যানেই বলা ছিল)। Sandbox-এ আসল বড় ডেটা দিয়ে গতি মাপা হয়নি।
- **Thread jump সীমা:** conversation খুললে সাম্প্রতিক ১০০ মেসেজ আসে (বিদ্যমান আচরণ); খোঁজা মেসেজ তার চেয়ে পুরোনো হলে UI সরাসরি না গিয়ে সৎভাবে জানায় — চুপচাপ "গেছে" বলে না।
- **Live যাচাই হয়নি:** আসল Meta/WhatsApp ডেটা sandbox-এ নেই; search/filter/view-এর আচরণ service-layer spec + build দিয়ে প্রমাণিত, production ডেটায় নয়। Migration কোনো আসল DB-তে চালানো হয়নি (dev DB-তে deploy মালিকের redeploy-এর সময় হবে)।
- Sentiment filter read-time হিসাব — mood classifier keyword-ভিত্তিক আনুমানিক সংকেত, UI-তে সেই লেবেলই আছে।
