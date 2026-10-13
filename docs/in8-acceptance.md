# IN8 Acceptance — Comment + DM এক Queue-তে (Graph-verified)

**তারিখ:** ২০২৬-১০-১৩ · **Worktree:** `ai-marketing-saas-in`, branch `in-package`, base HEAD `ca7be22` (IN B4)
**Scope:** IN8a verify-first audit → IN8 Graph layer → IN8b unified queue (সৎ বিকল্প পথ) → IN8c comment→DM → IN8d AI polish/report

---

## ১. Audit রায় (কোড না লিখে আগে যাচাই)

পড়া হয়েছে: `social-comments.service.ts` (623 লাইন), controller, DTO, spec, `SocialComment` schema, `meta-messaging.client.ts`, `webhook.parser.ts`, `meta-webhook.controller.ts`, `InboxService.handleWebhook`-এর comment dispatch।

| Graph action | আগে কী ছিল | এখন কী | কীভাবে প্রমাণিত |
|---|---|---|---|
| **Hide** | ❌ Graph call ছিলই না — `updateCommentStatus`/bulk/ingest শুধু DB status `HIDDEN` বসাতো; প্ল্যাটফর্মে কমেন্ট visible-ই থাকত | ✅ `POST /{comment-id}` `{is_hidden:true}` (`MetaMessagingClient.setCommentHidden`); `{success:true}` এলেই local status বদলায়; unhide-ও একই পথে `{is_hidden:false}` | Real client over fake fetch: URL/method/body assert + success-body ছাড়া throw + Graph error verbatim (in8 spec, client 5 + service hide/unhide) |
| **Reply (public)** | ❌ Graph send পথ ছিল না — `sendReply`, bulk `AI_REPLY_ALL`, CX3 sweep, delay-0 ingest সবই replyText DB-তে রেখে "replied" সাজাতো | ✅ `POST /{comment-id}/comments` `{message}`; ফিরতি comment `id` এলেই status/replyText বসে — manual reply, bulk, CX3 sweep, delay-0 ingest চারটে পথই এই layer দিয়ে যায় | Fake-fetch HTTP স্তরে: সাফল্যে MANUALLY_REPLIED + graphReplyId; ব্যর্থতায় verbatim throw + row অপরিবর্তিত |
| **Delete** | ❌ কোনো পথই ছিল না (না service, না controller, না UI) | ✅ `DELETE /{comment-id}`; `{success:true}` হলেই নতুন local status `DELETED`; controller `DELETE :commentId` + comments page-এ ডিলিট বোতাম | Client spec (method assert + unconfirmed throw) + service spec (confirmed → DELETED, unconfirmed → unchanged) |
| **Private reply / DM** | ❌ কোনো পথ ছিল না — `isPrivateDmSent` AI plan-এর `shouldSendDm` থেকে সরাসরি বসত (কিছুই পাঠানো হতো না) | ✅ `POST /{comment-id}/private_replies` `{message}`; ফিরতি `id` এলেই DM-sent; standalone endpoint `POST :commentId/private-reply` + reply/bulk/sweep/ingest পথে ঐচ্ছিক DM | Window-expired Graph error verbatim throw হয়ে কোনো conversation/flag তৈরি হয় না — spec দিয়ে প্রমাণিত |
| **Webhook ingest** | ✅ আগেই ছিল: `webhook.parser` feed (`entry.changes`, `item==="comment"`/`verb==="add"`) + IG `comments` field parse করে; `InboxService.handleWebhook` → `ingestComment` dispatch করে। Field: post id, comment id, author id/name, message, timestamp (postTitle webhook থেকে আসে না — undefined-ই থাকে) | অপরিবর্তিত (শুধু ingest-এর reply/hide side-effect এখন Graph দিয়ে যায়) | বিদ্যমান parser spec (meta-messaging.spec) অপরিবর্তিত সবুজ |

**"Verified"-এর সৎ সংজ্ঞা (এই প্যাকেজে):** endpoint আকার Meta Graph docs-সম্মত + আমাদের client-এ সঠিকভাবে wired + fake/fixture HTTP স্তরে প্রমাণিত। Live Meta credential ছাড়া live প্রমাণ সম্ভব নয় — সেটা M30-এর কাজ (নিচে §৫)।

## ২. যা বানানো হলো

- **Graph layer** (`meta-messaging.client.ts`): `setCommentHidden`, `replyToComment`, `deleteComment`, `privateReplyToComment` — প্রতিটি শুধু documented confirmation body (hide/delete `{success:true}`, reply/private-reply ফিরতি `id`) এলেই সফল; নয়তো verbatim error সহ throw।
- **Service wiring** (`social-comments.service.ts`): org-এর connected Messenger/Instagram integration থেকে token নিয়ে client তৈরি (`graphClientFor`); platform অনুযায়ী provider পছন্দ; integration না থাকলে বা platform TikTok/YouTube হলে সৎ refusal — কিছুই বদলায় না।
  - Manual `sendReply`: Graph reply আগে; DM ব্যর্থ হলে public reply থাকে, কিন্তু `privateDmError` return-এ verbatim জানায় + `isPrivateDmSent` false থাকে।
  - `updateCommentStatus`: HIDDEN/unhide Graph-confirmed; ESCALATED local triage-ই থাকে (Meta-তে এমন ধারণা নেই — code comment-এ লেখা)।
  - Bulk `HIDE_ALL`/`AI_REPLY_ALL`: একই Graph layer; per-item failure `failed: [{id, error}]`-তে verbatim, ওই row অপরিবর্তিত, `affected`-এ গণনা হয় না।
  - CX3 sweep (`runDueCommentReplies`/`applyDueCommentReply`): Graph reply confirm হলেই AUTO_REPLIED; ব্যর্থ হলে error metadata-তে + 60s পরে re-due, 3 attempt-এর পর PENDING রেখে মানুষের জন্য ছাড়ে; sweep-এ `graphFailed` fired হিসেবে গণনা হয় না।
  - Delay-0 ingest reply: এখন Graph দিয়েই পোস্ট হয়; ব্যর্থ হলে replyText বসে না, error + re-due (sweep retry) — webhook redelivery-তে দ্বিতীয়বার send হয় না (replyText/status guard)।
- **IN8b Unified queue (সৎ বিকল্প):** comment-কে জোর করে `ChannelConversation` model-এ ঢোকানো হয়নি (comment-এর thread/message semantics আলাদা; জোর করলে ভুয়া conversation তৈরি হতো)। বদলে বিদ্যমান Comments page-ই queue surface: assign অবস্থা সহ তালিকা।
  - Schema (additive, migration `20261012260000_in8_comment_graph_queue`): `SocialComment.assignedUserId` (plain user id) + `dmConversationId`।
  - `PATCH :commentId/assign` + list filter `assignedUserId` / `unassigned=true`; comments page-তে assignee badge।
  - **SLA/snooze comment-এ প্রয়োগ করা হয়নি** — সেগুলো conversation clock + sweep-ভিত্তিক; comment-এর জন্য কোনো sweep/ক্ষেত্র ছিল না, ভুয়া SLA দেখানোর বদলে বাদ (schema comment-এ কারণ লেখা)।
- **IN8c Comment → DM:** private reply confirm হলেই commenter-এর `ChannelConversation` find/create (channel messenger/instagram, externalContactId = author PSID; না থাকলে `comment:{externalCommentId}` fallback) + একটি `ConversationNote`-এ পুরো প্রসঙ্গ (কোন post, কোন comment, মূল লেখা, Graph DM id)। **কোনো ChannelMessage বানানো হয়নি** — DM Meta-র কাছেই থাকে, note আমাদের internal context। ব্যর্থ/মেয়াদোত্তীর্ণ private reply-তে কোনো conversation-ও বানানো হয় না। এক comment-এ দ্বিতীয় private reply upfront refuse (Meta-র one-per-comment নিয়ম)। সফল DM-এর পর conversation link ব্যর্থ হলে DM-sent সত্যিটা থাকে, link error আলাদা করে report হয় (`dmLinkWarning`)।
- **IN8d AI/report:**
  - Comment AI reply (suggestion/sweep/ingest) আগের মতোই `CommentHumanizer` + product-name match grounding ব্যবহার করে — তবে এখন Graph দিয়ে সত্যিই পোস্ট হয়। **DM-এর `composeGroundedReply` (LLM/catalog-evidence পথ) comment-এ পুনঃব্যবহার করা হয়নি**: ওটা `ChannelConversation` + thread context-নির্ভর; comment-এর কাছে thread নেই। সীমাটা এখানে লেখা রইল — বানানো grounding দাবি করা হয়নি।
  - Auto-hide report: list stats-এ `hiddenCount` (সব HIDDEN row) + `hiddenSpamCount` (HIDDEN + SPAM — auto-hide population) আসল row count থেকে; comments page-র কার্ডে দেখায়। Per-comment Graph ফলাফল `metadata.graphHide {attempted, ok, error?}`-তে।
  - Hide-word/spam auto-hide এখন একই Graph layer দিয়ে যায়; local HIDDEN safety status আগের মতোই তাৎক্ষণিক, কিন্তু Graph ব্যর্থ হলে `graphHide.ok:false` + verbatim error record থাকে — "প্ল্যাটফর্মে hidden" বলে দাবি করা হয় না।
- **Web** (`dashboard/comments/page.tsx`): DM করুন বোতাম (planned DM text থাকলে), ডিলিট বোতাম, DM-হয়েছে/ইনবক্সে-যুক্ত badge, DELETED filter, hidden stats কার্ড; reply success notice এখন DM-এর ফল আলাদা করে বলে (আগে সবসময় "উত্তর ও DM পাঠানো হয়েছে" বলত — এখন Graph confirm ছাড়া বলে না)।

## ৩. Test gate (আসল সংখ্যা)

- **Targeted:** `in8-comments.spec` (নতুন, 19 test: client 5 + service hide/unhide/escalate/reply/delete/no-integration 6 + DM 4 + auto-hide/report 3 + bulk 1) + `social-comments`, `cx3-debounce`, `cx12d-ai-schedule`, `meta-messaging`, `inbox-intelligence`, `in6-lifecycle`, `in7-ai` — **135/135 pass**।
- **Full API jest: 2001/2001 (218 suites)** — baseline 1982/217 (IN B4) + IN8-এর 19 নতুন; zero regression, কোনো flake দেখা যায়নি।
- **API tsc:** clean। **Prisma validate:** valid (migration `20261012260000` শুধু দুটি additive nullable column)।
- **Web:** vitest **149/149** (অপরিবর্তিত baseline — নতুন web test নেই; UI typecheck + build দিয়ে যাচাই), **web tsc clean**, **next build green**।
- **আগের spec-এ ছোঁয়া:** `cx3-debounce.spec` ও `cx12d-ai-schedule.spec`-এর comments setup-এ IN8 seam: `graphClientFor`-কে confirming stub বসানো হয়েছে (তাদের fake DB-তে integration নেই; এখন reply Graph-confirm ছাড়া fixture-apply হয় না)। তাদের debounce/batch/schedule assertions একটিও বদলায়নি — শুধু send-এর ভিত্তি বদলেছে, যা এই প্যাকেজেরই বিষয়।

## ৪. সৎভাবে বাদ যাওয়া

| অংশ | কেন বাদ |
|---|---|
| Comment-কে inbox conversation list-এর তৃতীয় ধরন হিসেবে মেশানো | Comment model-এ thread/message নেই; জোর করে মেশালে ভুয়া conversation/message বানাতে হতো। Comments page = queue (assign সহ) — data যা সমর্থন করে তাই। |
| Comment-এ SLA/snooze | Conversation clock/sweep comment-এ নেই; ক্ষেত্র যোগ করে ভুয়া SLA দেখানো হতো। Assign যোগ করা নিরাপদ ছিল (plain field), তাই শুধু সেটাই। |
| Comment AI-তে DM-এর LLM grounded compose | Thread-context নির্ভর; comment-এ thread নেই। বিদ্যমান humanizer + product-match grounding-ই থাকে, এখন Graph-posted। |
| Comments page-এ assign করার member-picker UI | Page-এ org member list-এর কোনো wiring নেই; API + badge display আছে, picker পরের ছোট কাজ। |
| Bulk `MARK_RESOLVED`-এর status নাম | Pre-existing local triage mark (`AUTO_REPLIED` বসায়) — IN8-এর scope-এর বাইরে বলে ছোঁয়া হয়নি; এখানে নথিভুক্ত রইল। |

## ৫. সৎ সীমা

- **Live Meta প্রমাণ নেই (M30):** sandbox/live Page token দিয়ে আসল hide/reply/delete/private-reply একবারও চালানো হয়নি — endpoint আকার docs-সম্মত + fixture HTTP প্রমাণই এই প্যাকেজের দাবি, এর বেশি নয়।
- **Migration `20261012260000` কোনো real DB-তে run হয়নি** — deploy-এর সময় চালাতে হবে, নয়তো assign/dmConversationId write 500 দেবে।
- **Private reply-এর Meta window/one-per-comment নিয়ম** Graph-এর নিজের enforcement — আমরা error verbatim পৌঁছে দিই, bypass-এর চেষ্টা নেই।
- **TikTok/YouTube comment-এ Graph পথ নেই** — ওই platform-এর action এখন সৎভাবে refuse হয় (আগে DB-only "সফল" সাজত)। ওদের নিজস্ব API wiring আলাদা প্যাকেজের কাজ।
- **Ingest-এর instant reply এখন synchronous Graph call** — webhook handler-এ প্রতি comment-এ সর্বোচ্চ 2টি Graph call (reply + DM) যোগ হয়েছে; ব্যর্থতা ingest ভাঙে না (record + sweep retry)।
- **Auto-hide-র local HIDDEN তাৎক্ষণিকই থাকে** (safety) — Graph confirm না হলে তা শুধু আমাদের queue-র hidden, `metadata.graphHide`-তেই সেই পার্থক্য লেখা থাকে।
