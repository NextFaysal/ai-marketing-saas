# Social Posts Next — Batch N5 Acceptance (SN8 Syndication + SN10 Caption Test) + Package Closing

Batch: N5 (শেষ) · Worktree `~/workspace/ai-marketing-saas-sn`, branch
`social-next` · Base (batch শুরুতে) `5bb4b2f` · Push হয়নি — local
commit only। এই doc-এর সঙ্গে SN1–SN10 পুরো প্যাকেজটি
CODE-COMPLETE হলো; closing summary:
`docs/social-next-package-summary.md`।

## Commit তালিকা (base `5bb4b2f`-এর পর)

| Commit | বিষয় |
|---|---|
| `ba186ac` | SN8+SN10 schema+migration `20261015130000`: SocialAutoDraftConfig rss/youtube toggles + rssFeedUrl, SocialSyndicationSeen, SocialPost.captionTestId |
| `4060ea1` | SN8 settings + feed parser + guarded text fetch |
| `076871b` | SN8 syndication service + YouTube uploads + module/automation wiring |
| `87d8e01` | SN8 specs (27 test); SU5 settings expectation-এ SN8 defaults যোগ |
| `41fd8b3` | SN10 caption test API (pair creation + listCaptionTests) |
| `b37668d` | SN10 specs (11 test) |
| `84c968e` | SN8 web settings (lib su5 + SettingsPanel feed URL) |
| `19db1b0` | SN10 web (PostsPanel বাটন/badge, AnalyticsPanel তুলনা section) |
| (এই doc-সহ closing commit) | batch5 acceptance + package summary + live checklist S11–S15 |

## SN8 — Syndication auto-draft (যা বসেছে)

- **Config**: আলাদা table নয় — `SocialAutoDraftConfig`-এই
  `rssEnabled` / `youtubeEnabled` (default FALSE) + `rssFeedUrl`
  যোগ হয়েছে। Settings GET/PATCH আগের endpoint-ই; rssFeedUrl
  PATCH-এ http/https যাচাই হয় (অবৈধ হলে সৎ বাংলা 400),
  ফাঁকা পাঠালে null (URL মোছা)।
- **Job**: নতুন per-org template `social_syndication_sweep`
  (org, 60 মিনিট, default OFF — অন্য social template-গুলোর
  মতোই per-org চালু করতে হয়)। Dispatch AutomationService-এর
  বিদ্যমান switch-এ।
- **Source**: (ক) RSS/Atom — org-এর feed URL একমাত্র বিদ্যমান
  SSRF-guarded fetch পথে (`SocialImportService.fetchGuardedText`
  → private `fetchGuardedBytes`; নতুন fetch পথ তৈরি হয়নি),
  dependency-free ছোট parser (`social-feed.ts`: RSS item/guid,
  Atom entry/link-href/id, CDATA + entity decode)। (খ) YouTube —
  connected YouTube account থাকলে `ensureAccessToken` +
  `YouTubeClient.listRecentUploads` (channels.list
  contentDetails → uploads playlist → playlistItems এক পেজ);
  account না থাকলে চুপচাপ skip।
- **Draft**: প্রতিটা নতুন item SU5 engine-এর semantics-এ —
  একই target account নিয়ম (config পিন করা connected account,
  নাহলে প্রথম connected meta_page), caption = item/video-র
  আসল title, linkUrl = আসল item URL / আসল watch URL
  (`https://www.youtube.com/watch?v=<id>`)। কোনো invented লেখা
  নয়। `autoDraftKind` = `rss_feed` / `youtube_new`,
  `autoDraftRef` = `rss:<externalId>` / `yt:<videoId>`।
- **Dedupe দুই স্তরে**: (1) `SocialSyndicationSeen`
  (org+source+externalId unique) — seen row লেখা হয় draft
  তৈরির **পরেই**; seen থাকলে item কখনো আবার draft হয় না,
  draft পোস্ট মুছে গেলেও না। (2) `autoDraftRef` — একই ref-এর
  পোস্ট আগে থাকলে draft না বানিয়ে seen লিখে skip (seen row
  হারালেও দ্বিতীয় draft হবে না)।
- **Cap সম্মিলিত**: SU5-এর দৈনিক cap-এর হুবহু হিসাব — Dhaka
  day-তে `autoDraftKind != null` সব পোস্ট (commerce +
  syndication মিলিয়ে) গোনা হয়। Cap পূর্ণ হলে sweep থামে
  এবং **cap-এ বাদ পড়া item seen-এ ঢোকে না** — পরের run/দিনে
  আবার চেষ্টা হবে, item হারায় না।
- **কখনো publish নয়**: service-তে publish/schedule পথের কোনো
  reference নেই (spec-এ তৈরি পোস্টের status সব draft assert
  করা হয়েছে)। Feed fetch/parse ব্যর্থতা বা এক YouTube
  account-এর ব্যর্থতা job result-এর `errors`-এ verbatim
  থাকে, অন্য source/account চলতে থাকে — sweep throw করে না।
- **Web**: Settings-এর Auto-Draft section-এ দুই toggle + RSS
  Feed URL field; helper লেখায় স্পষ্ট যে
  `social_syndication_sweep` job চালু থাকতে হবে, cap মিলিয়ে
  হিসাব হয়, কখনো নিজে থেকে Publish হয় না।

## SN10 — Caption Test (যা বসেছে)

- **জোড়া তৈরি**: `SocialPost.captionTestId` (nullable; দুই
  পোস্ট একই মান)। `POST posts/:id/caption-test` (WRITE_ROLES)
  — source অবশ্যই Draft (নাহলে সৎ বাংলা 400); partner
  বিদ্যমান `clonePost` পথে (একই account/media), তারপর
  captionTestId stamp; API-তে optional caption override আছে
  (spec-প্রমাণিত)। Source আগেই একটি test-এ থাকলে সেই id-ই
  reuse হয়; জোড়া পূর্ণ (2) হলে তৃতীয় পোস্টে refusal।
  Audit: `social.caption_test_created`। দুটোর schedule
  বিদ্যমান schedule পথেই আলাদাভাবে হয়।
- **তুলনা**: `GET insights/caption-tests` → Analytics-এ
  section, নাম হুবহু **"Caption Test (জোড়া পোস্ট তুলনা)"**।
  প্রতি পোস্টে: caption, account/platform, published সময়,
  engagement (`engagementScore` — শুধু stored insights-এ
  থাকা metric থেকে; `metricsPresent` কোন কোন metric সত্যিই
  ছিল তা দেখায়), tracked link click থাকলে তার আসল count
  (SocialLinkClick)।
- **সৎ সীমানা**: একটা published না হলে section-এ
  "দুটো পোস্টই প্রকাশিত হলে এখানে তুলনা দেখা যাবে।"
  **কোনো winner ঘোষণা কোথাও নেই** — response-এ winner field
  নেই (spec-এ JSON-এ "winner" শব্দের অনুপস্থিতি assert করা),
  UI-তেও নেই। দুটোর engagement কাছাকাছি হলে (<10% আপেক্ষিক
  পার্থক্য) শুধু নোট: ফল কাছাকাছি, পার্থক্য সামান্য —
  সংখ্যা দুটোই পাশাপাশি দেখানো থাকে।
- **Web v1 সীমা**: UI থেকে caption override পাঠানো হয় না —
  জোড়ার দ্বিতীয় Draft প্রথমে হুবহু কপি হয়, ব্যবহারকারী
  নিজে caption বদলে আলাদা সময়ে শিডিউল করেন (সফল হলে
  notice-এ সেই নির্দেশনাই থাকে)।

## Gates (coordinator নিজে final tree-তে চালানো, হুবহু ফল)

- **API jest FULL** (6 chunk-এ --runInBand; single-process
  full run sandbox heap-এ ধরে না বলে আগের batch-গুলোর মতোই
  chunked): chunk ফল — social+automation 726, inbox+campaigns
  783, ai+orders+connections 787,
  admin+commerce+storefront+workflows+messaging+courier 962,
  crm+common+ads+organizations+payments+integrations+অন্যান্য
  449, বাকি সব module 651 → **মোট 410 suites / 4358 tests,
  ALL PASS** (N4-এর 408/4320 + SN8 27 + SN10 11 = 4358 ✓)।
- **Web vitest FULL**: 56 files, **466/466 PASS** (465 +
  su5 settings-এর হালনাগাদ test)।
- **tsc**: API 0, web 0, admin 0 · **Prisma validate**: valid।
- **Build**: `pnpm -r build` প্রথম চেষ্টায় পূর্ণ parallel-এ
  exit 1 (সব package-এর build আলাদাভাবে চালিয়ে api/web/
  admin প্রতিটা exit 0 পাওয়া গেছে — sandbox resource
  চাপের পরিচিত ধরন); `--workspace-concurrency=2` দিয়ে
  পুনঃচালনায় **7/7 Done, exit 0**।
- **Fresh Postgres 16** (নতুন throwaway DB, পরে drop):
  **195/195 migrations applied, 0 unfinished/rolled back,
  260 tables** (194 + এই batch-এর migration-এ
  SocialSyndicationSeen; SocialPost.captionTestId column ও
  SocialAutoDraftConfig-এর নতুন column হাতে যাচাই করা)।

## Spot-check (coordinator, চোখে দেখা)

- Automation-এ `social_syndication_sweep` তিন জায়গায়
  (allowlist + template + dispatch)।
- Syndication service-তে publish/schedule-এর একমাত্র উল্লেখ
  docstring-এ "কখনো করে না" অর্থে; service publish পথের কোনো
  reference ধরে না।
- Caption test: API response ও Analytics UI — কোথাও winner
  field/ঘোষণা নেই (শুধু comment-এ "NO winner" সতর্কতা);
  section-এর নাম হুবহু নির্দেশিত।
- Token/key: এই batch-এ কোনো credential পথ নেই; feed URL
  settings row-তে থাকে, log/AI কোথাও পাঠানো হয় না।

## সৎ সীমা

- **কোনো live যাচাই হয়নি**: আসল RSS feed, আসল YouTube
  channel, আসল sweep run — সবই stubbed/fake seam-এর spec
  স্তরে প্রমাণিত। Live প্রমাণ checklist-এর S15 (নতুন) —
  সব box UNCHECKED।
- YouTube uploads এক পেজ (সর্বশেষ 10টি) — channel-এ এক
  run-এর ব্যবধানে 10-এর বেশি নতুন ভিডিও এলে পুরনোগুলো
  পরের run-এও আসবে না (uploads playlist সবসময় newest-first;
  seen-এ না থাকা পুরনো item পরের run-এর প্রথম পেজের বাইরে
  চলে গেলে ধরা পড়ে না)। v1-এ এই সীমা মেনে নেওয়া হয়েছে।
- RSS parser ছোট ও উদ্দেশ্য-নির্দিষ্ট: অস্বাভাবিক/
  বিকৃত feed-এ item বাদ যেতে পারে; parse ব্যর্থতা job
  result-এ verbatim থাকে, চুপচাপ সফল দেখানো হয় না।
- Caption test-এর তুলনা stored insights নির্ভর — insights
  refresh না করলে তুলনায় পুরনো সংখ্যা দেখাবে
  (insightsFetchedAt UI-তে দেখানো হয়)।
