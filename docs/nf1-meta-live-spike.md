# NF1 Spike — Facebook Live Commerce (Meta Live Video API)

**তারিখ:** ২০২৬-১০-১৭ · **প্যাকেজ:** New Features Frontier, Batch FB1 (NF1) · **ধাপ:** Step-0 design notes
**উৎস:** Meta-র অফিসিয়াল developer documentation — coordinator এই batch শুরুর আগে
fetch করে যাচাই করেছে; এই নথি শুধু সেই যাচাইকৃত তথ্যের সারসংক্ষেপ। কোনো live
Meta call এই spike-এ করা হয়নি।

সূত্রসমূহ:

- Streaming guide — https://developers.facebook.com/docs/live-video-api/guides/streaming/?locale=en_US
- Interact with viewers — https://developers.facebook.com/documentation/live-video-api/interact-with-viewers
- Live Video comments edge reference — https://developers.facebook.com/docs/graph-api/reference/live-video/comments/
- Getting started — https://developers.facebook.com/docs/live-video-api/getting-started/?locale=en_US

---

## ১. যা evidencable (অফিসিয়াল ডক থেকে নিশ্চিত)

### ১.১ Page broadcast তৈরি

- `POST /{page-id}/live_videos?status=LIVE_NOW` — Page broadcast তৈরি করে।
- Page access token লাগে।
- Permissions: `pages_read_engagement` + `pages_manage_posts`।
- Response shape: `{ id, stream_url, secure_stream_url }` — `id`-টাই
  পরবর্তী comments polling-এর `live-video-id`।

### ১.২ Comments polling

- `GET /{live-video-id}/comments` — polling পদ্ধতি; ডক অনুযায়ী প্রতি
  কয়েক সেকেন্ডে poll করতে হয়।
- Response shape:

  ```
  { data: [ { id, created_time, from: { id, name }, message } ],
    paging: { cursors } }
  ```

- SSE বিকল্প (v1-এ ব্যবহার করা হচ্ছে না — §৩ দেখুন):
  `GET https://streaming-graph.facebook.com/{live-video-id}/live_comments`
  — একই comment shape, সঙ্গে `view_id`।

### ১.৩ Comments edge-এর প্যারামিটার ও এরর

- Params: `filter` (`stream` | `toplevel`), `live_filter`,
  `order` (`chronological` | `reverse_chronological`), `since`।
- `summary.total_count` পাওয়া যায়।
- Error codes: `100` (invalid parameter), `190` (access token),
  `200` (permissions) — এই তিনটিই comments edge reference-এ তালিকাভুক্ত।

### ১.৪ App Review ও অতিরিক্ত permissions

- Getting-started অনুযায়ী `publish_video` permission লাগে এবং Live
  Video API-র ফিচারগুলোর জন্য **App Review আবশ্যক**।
- Targeting ডকে আরও তালিকাভুক্ত: `pages_read_user_content`,
  `pages_manage_engagement`, `pages_show_list`।

## ২. যা প্রমাণিত নয় (NOT proven)

- **কোনো live call কখনো করা হয়নি।** উপরের সবই ডক-ভিত্তিক shape —
  আসল Page + App Review পাস করা app ছাড়া end-to-end যাচাই সম্ভব নয়।
  এটা M30-ধাঁচের owner-gated live verification: মালিকের আসল Facebook
  Page, Meta app (Live Video API-র App Review-সহ) এবং Page token লাগবে।
- **Reactions shape v1-এর জন্য দরকার নেই** — এই spike-এ reactions
  edge যাচাই করা হয়নি, v1 reactions পড়ে না।
- SSE (`live_comments` stream) v1-এ ব্যবহার হচ্ছে না — §৩।

## ৩. Design consequence (NF1 backend এই সিদ্ধান্তে তৈরি)

1. **LiveCommentsProvider PORT.** Comments পড়ার কাজ একটা port-এর
   পেছনে থাকে (`live-commerce/live-comments.provider.ts`)। Meta
   implementation শুধুমাত্র উপরে evidencable `GET
   /{live-video-id}/comments` shape ব্যবহার করে — fields:
   `id, created_time, from{id,name}, message` (+ paging cursors)।
   Graph version/base URL-এর জন্য codebase-এর বিদ্যমান
   `common/meta-graph.ts` (`graphGet` / `graphBase`) reuse হয় —
   নতুন Graph client তৈরি হয়নি।
2. **Token পথ = বিদ্যমান machinery.** Page token আসে
   `SocialPublishService.resolveAccountToken(organizationId,
   socialAccountId)` দিয়ে — SocialAccount → Integration →
   sealed credential decrypt-এর একমাত্র বিদ্যমান পথ। NF1 নতুন
   কোনো token storage বানায়নি।
3. **Provider unavailable → MANUAL mode (honest fallback).**
   Session-এর `source = meta` হলেও — connected Meta account নেই,
   token নেই, account disconnected, কিংবা Graph call ব্যর্থ হলে —
   provider একটা typed unavailable ফলাফল দেয়
   (`{ status: "unavailable", reason }`)। তখন:
   - `GET live-sessions/:id/comments` সংরক্ষিত (stored) comments-ই
     ফেরত দেয়, সঙ্গে `mode: "manual"` +
     `providerStatus: "unavailable"` + `reason`।
   - Session MANUAL পদ্ধতিতে চলতে পারে: staff
     `POST live-sessions/:id/comments` দিয়ে comments হাতে import
     করে (source `manual`)।
   - **কখনো Meta data বানানো (fabricate) হয় না** — provider
     unavailable হলে কোনো comment তৈরি হয় না, শুধু যা DB-তে
     সত্যিকারে আছে তাই ফেরত যায়।
4. **প্রতিটি API response-এ mode লেবেল থাকে।** Comments response
   সবসময় `mode` (`meta` | `manual`) ও `providerStatus`
   (`ok` | `unavailable` | `not_applicable`) বহন করে, যাতে UI
   কখনো manual ডেটাকে live Meta ডেটা বলে ভুল না করে।
5. **Polling only (v1).** SSE বাদ — polling-ই evidenced পথ এবং
   আমাদের বাকি social sync প্যাটার্নের সঙ্গে মেলে। SSE পরে
   দরকার হলে একই port-এর পেছনে যোগ হবে।
6. **Idempotent upsert.** Meta comments `externalCommentId` দিয়ে
   session-এর ভিতরে upsert হয় — একই poll আবার চালালে duplicate
   তৈরি হয় না (schema-তে composite unique, §ITEM 2 নোট দেখুন)।
7. Broadcast তৈরি (`POST /{page-id}/live_videos`) v1 backend-এ
   **ডাকা হয় না** — session তৈরি হয় staff-এর দেওয়া
   `externalLiveVideoId` দিয়ে (Page-এ live শুরু merchant নিজে
   করে)। কারণ: broadcast তৈরির পথ evidencable হলেও App Review
   ছাড়া live-এ চলবে কিনা অপ্রমাণিত; অপ্রমাণিত write পথ v1-এ
   বসানো হয়নি।

## ৪. Live verification owed (owner-gated)

- [ ] আসল Facebook Page + Page access token দিয়ে comments polling
      end-to-end (নতুন comment আসলে তা LiveComment হিসেবে জমা হয় কিনা)।
- [ ] Meta app-এর Live Video API App Review অবস্থা নিশ্চিত করা
      (`publish_video` + উপরের page permissions)।
- [ ] Token মেয়াদ শেষ / permission প্রত্যাহারের ক্ষেত্রে error
      code 190/200-র আচরণ আসল উত্তরে যাচাই।

উপরের কোনোটাই এই batch-এ করা হয়নি — সবই ডক-ভিত্তিক design,
live প্রমাণ শূন্য।
