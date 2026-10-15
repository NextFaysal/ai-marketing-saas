# SN7 — Threads Publishing Spike

**প্রশ্ন:** Threads-এ আমাদের বিদ্যমান SocialAccount / OAuth / publish
কাঠামোর ভিতরে থেকে আসল publishing বসানো যায় কিনা — Meta-র
documented Threads API ধরে, অনুমান ছাড়া।

**পদ্ধতি:** Threads API-র প্রকাশিত ডকুমেন্টেশনের ধারাবাহিক বিবরণ
(Meta-র নিজের `fbsamples/threads_api` নমুনা অ্যাপসহ একাধিক
স্বাধীন উৎসে হুবহু একই flow) যাচাই করা হয়েছে। নোট:
developers.facebook.com সরাসরি এই sandbox-এর fetcher-কে 403
দেয় (SN1-এর FB-cover spike-এও একই ঘটনা ঘটেছিল) — তাই endpoint
আকৃতিগুলো অফিসিয়াল নমুনা কোড ও ডক-ভিত্তিক একাধিক উৎসের
মিলিয়ে নিশ্চিত করা। কোনো live Threads call এই sandbox-এ হয়নি;
সব প্রমাণ stubbed-boundary spec-এ (social-sn7.spec.ts)।

## ১. Documented — যা পাওয়া গেছে

### ১.১ App ও OAuth
- Threads API একটি Meta app-এর ভিতরে আলাদা **Threads app**
  (আলাদা App ID ও App Secret — Facebook app-এর credential দিয়ে
  চলবে না)। অর্থাৎ platform-config-এ নিজের `threadsApp` এলাকা
  লাগবে (TikTok/Google/LinkedIn ধাঁচে)।
- Authorize: `https://www.threads.net/oauth/authorize`
  (`client_id` = Threads App ID, `redirect_uri`, `scope`,
  `response_type=code`)।
- Scope: `threads_basic` (profile) + `threads_content_publish`
  (publish)। Insights-এর জন্য আলাদা `threads_manage_insights`।
- Token exchange: `POST https://graph.threads.net/oauth/access_token`
  (form: client_id, client_secret, grant_type=authorization_code,
  redirect_uri, code) → **short-lived token (১ ঘণ্টা)** + `user_id`।
- Long-lived: `GET https://graph.threads.net/access_token
  ?grant_type=th_exchange_token&client_secret=…&access_token=…`
  → **৬০ দিনের token**।
- Refresh: `GET https://graph.threads.net/refresh_access_token
  ?grant_type=th_refresh_token&access_token=…` — client secret
  লাগে না; token অন্তত ২৪ ঘণ্টা পুরনো ও মেয়াদোত্তীর্ণ না হতে
  হবে। আমাদের ensureAccessToken-এর skew-window (মেয়াদ শেষের
  ৬০ সেকেন্ড আগে) এই শর্তে পড়ে না — ৬০ দিনের token-এর শেষ
  মুহূর্তে refresh সবসময়ই ২৪ ঘণ্টার বেশি পুরনো।
- Profile: `GET https://graph.threads.net/v1.0/me
  ?fields=id,username,name,threads_profile_picture_url`।
  **Profile-এ follower count field নেই** — followers শুধু
  insights দিয়ে আসে (§১.৪)।
- Production ব্যবহারে `threads_content_publish`-এর জন্য Meta
  App Review (Advanced Access) লাগে; review ছাড়া শুধু app-role
  থাকা Threads অ্যাকাউন্ট connect করা যায়। এটি Meta-র gate —
  config দিয়ে ঘোষণা করা যায় না (LinkedIn Community Management
  approval-এর মতোই); প্রত্যাখ্যান এলে Meta-র আসল বার্তাই tenant
  দেখবে।

### ১.২ Publish — container flow (দুই ধাপ)
- ধাপ ১: `POST /v1.0/{threads-user-id}/threads` — একটি
  **container** তৈরি হয়, `id` (creation_id) ফেরত আসে।
  - Text: `media_type=TEXT`, `text`।
  - Image: `media_type=IMAGE`, `image_url` (public URL — Meta
    নিজে fetch করে), `text`।
  - Video: `media_type=VIDEO`, `video_url`, `text`।
  - Carousel: প্রতিটি item-এর container
    (`media_type=IMAGE|VIDEO`, `is_carousel_item=true`, text
    ছাড়া), তারপর parent container `media_type=CAROUSEL`,
    `children=<container id গুলো>` (২–২০টি), `text` parent-এ।
- Status: `GET /v1.0/{container-id}?fields=status,error_message`
  → `IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED`।
  Media container প্রসেস হতে সময় নেয় (video-র ক্ষেত্রে
  ডক নির্দেশনা অনুযায়ী অপেক্ষা করে status যাচাই করতে হয়) —
  তাই publish-এর আগে **সীমিত poll**: FINISHED হলেই ধাপ ২;
  ERROR হলে container-এর `error_message` verbatim ব্যর্থতা;
  সীমা পেরিয়ে গেলে সৎ timeout ব্যর্থতা (অনির্দিষ্ট অপেক্ষা নয়)।
- ধাপ ২: `POST /v1.0/{threads-user-id}/threads_publish`
  (`creation_id`) → published media-এর `id`।
- Post-এর URL: `GET /v1.0/{media-id}?fields=permalink`।
- Text সীমা: **৫০০ অক্ষর**। Publishing quota: ব্যবহারকারীপ্রতি
  ২৪ ঘণ্টায় ২৫০ পোস্ট (`GET /me/threads_publishing_limit` দিয়ে
  দেখা যায় — এই batch-এ quota-check বসানো হয়নি, সীমা নিচে)।

### ১.৩ আমাদের media মডেলের সঙ্গে মিল
Media সবসময় **public URL** দিয়ে — SP1-এর public media link
পথ হুবহু reuse করা যায় (Meta/Instagram flow যেভাবে করে)।
Bytes upload-এর কোনো ধাপ নেই (YouTube-এর মতো push নয়)।

### ১.৪ Insights (threads_manage_insights থাকলে)
- Post: `GET /v1.0/{media-id}/insights
  ?metric=views,likes,replies,reposts,quotes,shares` — মান আসে
  `data[].values[0].value` আকৃতিতে। Metric অনুপস্থিত থাকলে
  সেই metric-এর entry-ই থাকে না (আমাদের "absent, never 0"
  নিয়মের সঙ্গে মেলে)।
- Account: `GET /v1.0/{threads-user-id}/threads_insights
  ?metric=followers_count` — মান `total_value.value`; SU7
  follower snapshot-এ এটাই ব্যবহার করা যায়।
- Scope connect-এর সময়ই চাওয়া হয়; পুরনো connect-এ scope না
  থাকলে insights call Meta-র permission error verbatim ফেরত
  দেবে — সেটাই সৎ আচরণ (reconnect-এ ঠিক হবে)।

## ২. Verdict — যা বসছে

| অংশ | সিদ্ধান্ত |
|---|---|
| Connect (platform app) | ✅ OAuth — TikTok/YouTube ধাঁচে state + callback + pick ছাড়া সরাসরি account (Threads authorization একটি মাত্র profile দেয়, picker লাগে না) |
| Connect (নিজের app) | ✅ CC28 ধাঁচে — TenantAppConfig-এ `threads` platform যোগ; non-Meta app-এর মতো "configured, verified at first connect" সৎ semantics; redirect URI = derived callback |
| Token refresh | ✅ ensureAccessToken-এ threads branch — th_refresh_token (secret লাগে না) |
| Publish text/image/video | ✅ container → সীমিত poll → publish |
| Publish carousel (২–২০) | ✅ child containers + parent CAROUSEL |
| Insights (post) | ✅ documented metric গুলোই, absent = absent |
| Follower snapshot | ✅ followers_count (user insights) — না এলে skipped (SU7 নিয়ম) |
| Health check | ✅ profile GET (identity ধাঁচ) |
| First comment / reply | ⛔ এই batch-এ নয় — reply flow (`reply_to_id`) documented হলেও SN7-এর scope-এ ছিল না; চুপচাপ বসানো হয়নি, tryPostFirstComment threads-এ no-op থাকে |
| Quota check/display | ⛔ বসানো হয়নি — `/threads_publishing_limit` documented, কিন্তু এই batch-এর scope-এর বাইরে; quota শেষ হলে publish error verbatim আসবে |

## ৩. Telegram (SN6) — spike নোট

Bot API (`https://api.telegram.org/bot<token>/<method>`,
`{ ok, result }` / `{ ok:false, error_code, description }` —
description-ই verbatim error):

- `getMe` → bot-এর পরিচয় (token যাচাই)।
- `getChat` (chat_id = numeric id অথবা `@username`) → channel
  তথ্য; `type` অবশ্যই `channel` হতে হবে।
- `getChatMember` → bot channel-এ `administrator` (বা `creator`)
  কিনা ও `can_post_messages` — admin না হলে পোস্ট যাবে না,
  তাই connect-এর সময়ই যাচাই (verify-before-save)।
- পাঠানো: `sendMessage` (text, ৪০৯৬ অক্ষর/খণ্ড),
  `sendPhoto` / `sendVideo` (public URL দিলে Telegram নিজে
  fetch করে; caption সর্বোচ্চ ১০২৪ অক্ষর), `sendMediaGroup`
  (২–১০টি photo/video, caption প্রথম item-এ)। প্রতিটি সফল
  call Message ফেরত দেয় — `message_id` + `chat.id` মিলে
  platform post id (`chatId:messageId`); public channel হলে
  URL `https://t.me/<username>/<message_id>`।
- **Insights নেই**: Bot API channel পোস্টের views/engagement
  কোনো bot-কে দেয় না — তাই Telegram পোস্টের insights
  "পাওয়া যায় না" হিসেবেই থাকবে (invented ০ নয়)।
- Discussion-group comment (first comment) Bot API-তে আলাদা
  জটিল পথ (linked discussion group + forward detection) —
  এই batch-এ নয়।
