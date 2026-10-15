# SU8 Spike — Facebook Page ও Instagram Stories Publishing (Graph API)

**তারিখ:** ২০২৬-১০-১৩ · **প্রসঙ্গ:** SU8-এর spike-first শর্ত — documented ও
boundary-testable পথ নিশ্চিত না হলে implementation নয়।
**উৎস:** Meta-র অফিসিয়াল developer documentation (Facebook Stories API /
Page Stories, Instagram Content Publishing), ২০২৬-১০-১৩-তে যাচাই করা।

## Verdict (সংক্ষেপে)

| পথ | Documented? | এই batch-এ |
|---|---|---|
| **FB Page photo story** | হ্যাঁ — অফিসিয়াল Page Stories docs | **Implementation হয়েছে** (নিচের flow) |
| FB Page video story | হ্যাঁ — `/{page-id}/video_stories` (upload_phase start/transfer/finish) | বসেনি — multi-step resumable flow আলাদা কাজ; photo story-ই scoped ছিল |
| IG story | হ্যাঁ — container flow, `media_type=STORIES` | বসেনি — scoped-এর বাইরে; পরের batch-এর প্রার্থী (নিচে flow দেওয়া) |

## FB Page photo story — documented flow

1. ছবি Page-এ unpublished আপলোড: `POST /{page-id}/photos` (`url`, `published=false`)
   → `id` (photo_id)।
2. Story প্রকাশ: `POST /{page-id}/photo_stories` (`photo_id`) → সফল উত্তরে
   `{ success: true, post_id }`।
3. Story-র URL ধাঁচ (একই docs-এর `GET /{page-id}/stories` উত্তরে):
   `https://facebook.com/stories/<post_id>`।

শর্ত ও সীমা:
- Page access token লাগে — আমাদের ক্ষেত্রে SP1-এর sealed Page token-ই
  (posting permissionসহ); নতুন কোনো credential পথ নয়।
- Story ২৪ ঘণ্টা থাকে (platform-এর নিয়ম) — আমাদের post row তাতে বদলায় না;
  `platformPostId`-তে story-র post_id থাকে।
- Caption story-তে যায় না (photo story-তে caption প্যারামিটার নেই) — post row-র
  caption আমাদের রেকর্ডেই থাকে, platform-এ যায় না। UI/acceptance-এ এটা বলা আছে।

**Implementation সীমা (এই batch):** `SocialPost.isStory = true` + platform
`meta_page` + ঠিক একটি image হলেই publish পথ story flow নেয়; অন্য platform
বা অন্য media আকারে pre-flight বাংলা 400 দেয়। Spec: stubbed-fetch boundary-তে
পুরো call sequence প্রমাণিত (social-su8.spec.ts)। Live প্রমাণ SU0/SU12-র
(আসল Page token ছাড়া sandbox-এ সম্ভব নয়) — আগের সব Meta পথের মতোই।

## IG story — documented, কিন্তু এই batch-এ বসেনি

Instagram Content Publishing-এর container flow-তেই story যায়:
`POST /{ig-user-id}/media` (`media_type=STORIES`, `image_url` বা `video_url`)
→ status poll (FINISHED) → `POST /{ig-user-id}/media_publish`। আমাদের
বিদ্যমান IG publisher-এর container যন্ত্রই এটা বহন করতে পারত, কিন্তু
SU8-এর scope ছিল "FB Page photo story পর্যন্ত সীমিত" — IG story তাই
ইচ্ছাকৃতভাবে বাইরে রাখা হলো, যাতে এক batch-এ দুটো নতুন surface না খোলে।
পরের ধাপে চাইলে একই spike-এর ভিত্তিতে ছোট কাজ।

## FB Page video story — documented, বসেনি

`POST /{page-id}/video_stories`-এ `upload_phase` ধারায় (start → transfer →
finish, শেষ ধাপে `video_id`)। আমাদের Page video পথ `file_url` এক ধাপের —
video story-র resumable session flow আলাদা যন্ত্র চায়। Photo story দিয়ে
surface প্রমাণিত হলে এটা পরের প্রার্থী।

## যা এই spike-তে নিশ্চিত হওয়া যায়নি

- **FB video thumbnail (`thumb`):** Graph reference-এ Page videos edge-এ
  `thumb` (raw image data) প্যারামিটার তালিকাভুক্ত আছে, কিন্তু আমাদের
  `file_url`-ভিত্তিক publish call-এ raw thumb data পাঠানোর documented
  সংযোগ, কিংবা প্রকাশের পরে `/{video-id}/thumbnails`-এ POST করে cover
  বসানোর অফিসিয়াল পথ — কোনোটাই এই spike-তে নিশ্চিত করা যায়নি। তাই
  SU8-তে FB video cover **বাস্তবায়ন করা হয়নি** (SU3-র cover asset
  YouTube-তে ব্যবহৃত হয় — নিচে acceptance)।
