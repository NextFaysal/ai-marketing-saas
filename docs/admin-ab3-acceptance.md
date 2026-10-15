# Admin Next AB3 Acceptance — AN12–AN14 (2026-10-15)

Base: integration-5 `f239e03` (AB2-র শেষ)। Local commits only —
**NOT pushed, NOT deployed।**

Commits:
- `32a6de8` — AB3 API (service + controller + module wiring + spec)
- `812f959` — AB3 UI (system / social-ops / settings / growth)
- এই doc-এর commit — acceptance

## AN12 — Queue Operator Actions ✅

API (সব `@AdminTier("SUPER")`, body-তে reason বাধ্যতামূলক):

| Route | কাজ |
|---|---|
| `POST /admin/system/queues/:queue/pause` | আসল BullMQ `queue.pause()` |
| `POST /admin/system/queues/:queue/resume` | আসল BullMQ `queue.resume()` |
| `POST /admin/system/queues/:queue/retry-failed` | failed job retry — `jobIds[]` নির্দিষ্ট করে অথবা সর্বশেষ failed থেকে, cap সর্বোচ্চ **50** (default 20), প্রতিটি job-র ফলাফল আলাদা করে |

- Queue শুধু দুটোই বৈধ: `scheduled-jobs`, `webhook` (WK1 rule) —
  অন্য নামে 400।
- AA2-র একই Queue handle (`bullQueue()` cache) পুনঃব্যবহার —
  নতুন কোনো dependency নেই। Pause/resume-এ before/after
  `isPaused()` অবস্থা AuditLog-এ (`admin.queue_paused` /
  `admin.queue_resumed`, metadata-তে reason + before/after)।
  Retry-তে failed count-এর before/after + per-job ফলাফল audit-এ।
- **Drain / obliterate / job delete নেই** — spec দিয়ে পিন করা
  (service-এ ওই method-গুলোই নেই)।
- সৎ unavailable: `REDIS_URL` না থাকলে অথবা Redis error হলে
  ফলাফল `{available:false, reason|error}` — AA2 board-এর একই
  ভাষা; queue-তে কোনো call-ই যায় না (spec-প্রমাণিত), তবু
  প্রচেষ্টাটা audit হয় (`admin.queue_*_unavailable`)।
  Redis interaction-এ 5s hard timeout (bullmqCounts-এর ধাঁচ)।
- UI: System page-এর BullMQ table-এ প্রতি queue-তে Pause /
  Resume / "ব্যর্থ আবার চেষ্টা" (Failed 0 হলে disabled) বোতাম —
  reason prompt (billing/orgs page-এর বিদ্যমান pattern), ফলাফল
  API-র সংখ্যা/ভুল হুবহু message-এ, তারপর board reload। Table-এর
  নিচে drain/delete না-থাকার নোট।

## AN13 — Social/Ads Operator Retry ✅ (একটি category view-only)

Audit করে পাওয়া আসল পথ — প্রতিটি action Tenant পাশের নিজের
service method-এ delegate করে; Admin-এর জন্য আলাদা কোনো logic
বা provider call বানানো হয়নি। সব route `@AdminTier("SUPER",
"SUPPORT")` (health/retry-র tier-ই), reason বাধ্যতামূলক,
প্রতিটি প্রচেষ্টা (সফল/ব্যর্থ) audit হয় before/after সহ;
delegate-এর error verbatim propagate হয়, rethrow-এর আগে
failed attempt audit হয়।

| Board category | Route | আসল পথ (delegate) |
|---|---|---|
| ব্যর্থ Post | `POST /admin/system/social-board/posts/:postId/retry` | `SocialHealthService.retryPost(orgId, adminId, postId)` — Tenant-এর নিজের retry route যেটা চালায়; তার failed-only gate ও ONE publish path হুবহু প্রযোজ্য |
| Publishing-এ আটকে থাকা Post | `POST /admin/system/social-board/posts/:postId/recover-stuck` | `SocialPublishService.runDuePublishes(orgId)` — social_publish_due job (৫ মিনিটের sweep) যেটা চালায়; stale-claim recovery এই sweep-এর ভেতরেই আছে। **পরিধি সৎভাবে:** পুরো Org-এর sweep চলে — stale claim recovery-সহ Org-এর সব due post প্রসেস হয়, শুধু এই postটি নয়; UI ও API response দুই জায়গাতেই তা লেখা আছে। Postটি publishing না হলে sweep না চালিয়ে 400 refusal |
| Error Social Account | `POST /admin/system/social-board/accounts/:accountId/recheck` | `SocialHealthService.checkAccountHealth(orgId, adminId, accountId)` — Tenant-এর health re-check; আসল provider probe, ফলাফল {ok, status, error} verbatim |
| ভাঙা Ad Account | `POST /admin/system/ads-board/accounts/:accountId/retry-sync` | Platform অনুযায়ী `AdsService.syncMetaInsights / syncGoogleInsights / syncTikTokInsights(orgId, adminId, accountId, {})` — Tenant card-এর per-account Sync বোতাম হুবহু। CC27 deny gate non-member actor-কে deny করে না (helper-এর নিজের নিয়ম); syncDisabled refusal verbatim আসে |
| Creator-এর কাছে অপেক্ষমাণ Post (sent_to_creator >48h) | — | **VIEW-ONLY (ইচ্ছা করে):** Postটি মানুষ Creator-এর সাড়ার অপেক্ষায় — retry করার কোনো আসল পথ নেই, বানানোও হয়নি। UI-তে নোট আছে |

- **Disconnect/Reconnect Admin থেকে নেই** — Tenant-এর নিজের
  OAuth লাগে; Social-Ops page-এর শীর্ষে সীমাটা লেখা আছে।
- Module wiring: `AdminModule` এখন `SocialModule` + `AdsModule`
  import করে; `SocialHealthService` SocialModule-এর exports-এ
  যোগ হয়েছে (এক লাইন)। AdminService-এ তিনটি service-ই
  `@Optional()` — পুরনো spec construction (prisma, audit)
  অপরিবর্তিত চলে; service wired না থাকলে action সৎভাবে
  refuse করে ("এই deployment-এ উপলব্ধ নয় — কোনো retry
  করা হয়নি")।
- UI: Error account table-এ "স্বাস্থ্য আবার যাচাই", ব্যর্থ
  Post-এ "আবার Publish চেষ্টা", আটকে থাকা Post-এ "Publish
  sweep চালান" (+ sweep-পরিধির নোট), Ad account table-এ
  "Sync আবার চেষ্টা" (platform meta/google/tiktok ছাড়া হলে
  বোতামের বদলে "sync পথ নেই" লেখা)। সব বোতামে reason prompt,
  ফলাফল verbatim message-এ।

## AN14(a) — Plan Limits Clear-to-Default ✅

- `POST /admin/settings/plan-limits/:tier/clear`
  (`@AdminTier("SUPER")`, reason বাধ্যতামূলক) →
  `AdminService.clearPlanLimits`: stored `planLimits`
  SystemSetting থেকে **শুধু ওই tier-এর entry** মোছে।
- Spec-প্রমাণিত: clear-এর পর ওই tier `planLimits()`-এ
  হুবহু `DEFAULT_PLAN_LIMITS` দেয়; অন্য tier-এর entry
  byte-identical থাকে। Audit-এ before (মোছা entry) / after
  (null)।
- Entry না থাকলে সৎ no-op: `{cleared:false, note}` — কিছুই
  mutate হয় না, তবু audit হয় (`plan_limits_clear_noop`)।
  অজানা tier ও reason ছাড়া — দুটোই 400, store অপরিবর্তিত।
- UI: Settings-এর Plan Limits editor-এ Setting-badge-ওয়ালা
  প্রতিটি tier-এ "Code Default-এ ফেরান" বোতাম — confirm +
  reason prompt, সফল হলে settings reload; নিচের ব্যাখ্যা-
  লাইনেও আচরণটা লেখা আছে।

## AN14(b) — Growth Campaign Edit/Delete ⛔ STOPPED (নথিভুক্ত কারণে)

**বানানো হয়নি — endpoints-ও নয়, ভুয়া বোতামও নয়।** কারণ
মডেল-যাচাইয়ে প্রমাণিত:

- `PlatformCampaign` মডেলে **কোনো status field নেই**
  (শুধু subject/body/audience/recipients/sent/failed/
  createdById/createdAt)।
- পুরো codebase-এ `platformCampaign.create`-এর একটাই call
  site: `AdminService.sendCampaign` — সেটা email **পাঠানো
  শেষ হওয়ার পরে** send-record হিসেবে row তৈরি করে। অর্থাৎ
  বিদ্যমান প্রতিটি campaign-ই by construction পাঠানো হয়ে
  গেছে; Draft/Scheduled campaign বলে কিছু এই সিস্টেমে
  কোথাও নেই (POST /admin/campaigns চাপলেই সরাসরি পাঠায়)।
- ফলে "পাঠানো হয়নি এমন campaign edit/delete" বাস্তবায়ন
  করতে হলে লাগবে: status column (migration) + draft-create
  flow + send-flow বদল — AN14-এর "ছোট completion" পরিধির
  বাইরে, এবং এই package-এ নতুন migration না-আনার নিয়মের
  সঙ্গে সরাসরি সাংঘর্ষিক। নির্দেশনা অনুযায়ী item-টি এখানেই
  থামানো হলো; ভবিষ্যতে চাইলে আলাদা "Campaign Draft" item
  হিসেবে migration-সহ প্রস্তাব আসতে পারে।
- যা করা হয়েছে: Growth page-এর campaign তালিকার নিচে সৎ
  নোট — পাঠানো campaign সম্পাদনা/মোছা যায় না, প্রতিটি-ই
  পাঠানোর ইতিহাস হিসেবে সংরক্ষিত থাকে, draft বলে কিছু নেই।
  পাঠানো campaign-এর ইতিহাস কোথাও বদলানো হয়নি।

## Spec

`apps/api/src/admin/ab3-operator-actions.spec.ts` — **18/18
PASS**: AN12 (pause/resume call + audit before/after,
retry per-job outcomes + cap + jobIds পথ, unavailable-তে
শূন্য call, Redis error verbatim, reason/unknown-queue
refusal, drain surface অনুপস্থিতি), AN13 (চারটি delegation-ই
সঠিক org/actor/id দিয়ে, error verbatim + failed-attempt
audit, non-publishing refusal-এ sweep না-চলা, unwired service
refusal), AN14(a) (clear → default resolution + অন্য tier
অপরিবর্তিত + audit, no-op, refusal), route tier metadata
(AN12/AN14a = SUPER; AN13 = SUPER+SUPPORT)।

## Gates

| Gate | ফলাফল |
|---|---|
| Scoped spec (ab3) | 18/18 PASS |
| API full jest (--maxWorkers=2) | 354/355 suite, **3707/3707 test PASS** — একমাত্র failed suite `automation/m57-worker` worker SIGKILL (sandbox OOM), শূন্য failing test; solo re-run **8/8 PASS** → কার্যকর 355/355 suite, 3715 test |
| Web vitest | 345/345 (web ছোঁয়া হয়নি) |
| tsc | api 0 / web 0 / admin 0 |
| Admin build | green (22 route) |
| Monorepo build (`pnpm -r build`) | 7/7 Done, 0 Failed |
| Prisma validate | valid — **schema diff শূন্য, কোনো নতুন migration নেই** |

## সৎ সীমা

- কিছুই live নয়: কোনো আসল Redis queue, আসল Meta/Google/
  TikTok sync বা আসল publish এই build দিয়ে যাচাই হয়নি
  (M30 বাকি) — সব delegation spec-এ fake service দিয়ে
  প্রমাণিত, পথগুলো Tenant পাশে আগে থেকেই ব্যবহৃত।
- AN13-এর stuck recovery Org-পরিধির sweep — per-post
  recovery পথ সিস্টেমে নেই বলেই; UI/response-এ পরিধি লেখা।
- AN14(b) উপরে নথিভুক্ত কারণে stopped — draft campaign
  চাইলে migration-সহ আলাদা item লাগবে।
- Push/deploy মালিকের নির্দেশ ছাড়া নয়।
