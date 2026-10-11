# Social Posts Completion Package (PP1–PP4) — Plan

**প্রসঙ্গ:** Social Posts প্যাকেজ (SP1–SP9) সম্পূর্ণ হওয়ার পর মালিক "Next" বলায় (২০২৬-১০-১১ ২০:৫৫ +06) ধারাবাহিকতা অনুযায়ী পরের ধাপ = ওই feature-এর নিজের নথিভুক্ত সীমাগুলো দূর করা। প্রতিটি item কোনো না কোনো acceptance doc-এ আগেই সৎভাবে লেখা ছিল।

## PP1 — SVG → PNG Rasterizer (Template Poster যাতে সত্যিই publish হয়)
- **সমস্যা:** Template Poster SVG-তে তৈরি হয়; Facebook/Instagram raster (PNG/JPEG) ছাড়া নেয় না — SP6 তাই SVG publish আটকে দেয়। Poster feature-এর publish পথটাই বন্ধ।
- **কাজ:** repo-তে raster library নেই — audit করে একটি যোগ করা (sharp প্রার্থী; install/lockfile ঝুঁকি যাচাই করে)। Publish path-এ SVG asset থাকলে আগে PNG-তে রূপান্তর (রূপান্তরিত PNG MediaAsset হিসেবে সংরক্ষিত, মূল SVG থাকে); চাইলে poster তৈরির সময়ই "PNG সংস্করণ" রাখা। Rasterizer কোনো কারণে অসম্ভব হলে gate যেমন আছে থাকবে + কারণ নথিতে।
- **সাফল্য:** SVG poster দিয়ে বানানো post publish path-এ platform call পর্যন্ত যায় (boundary specs); gate শুধু সত্যিকারের অসম্ভব ক্ষেত্রে।

## PP2 — বড় ভিডিও (TikTok/YouTube ব্যবহারযোগ্য করা)
- **সমস্যা:** MediaStore upload cap 2.1 MB (`SOCIAL_MEDIA_MAX_BYTES`) — বাস্তব ভিডিওর জন্য অকেজো।
- **কাজ:** upload পথ streaming/chunked করা (পুরো ফাইল memory-তে না তুলে storage-এ লেখা), cap config-যোগ্য করে বাড়ানো (default যুক্তিসংগত, যেমন 200 MB); YouTube resumable upload storage থেকে stream করে (আগেই server-side) — বড় ফাইলেও memory-safe। TikTok PULL_FROM_URL পথে public link একই থাকে।
- **সাফল্য:** cap-এর চেয়ে বড় ভিডিও (যেমন 20 MB) upload + asset হয়; memory-তে পুরো buffer ওঠে না (code audit + spec)।

## PP3 — Product ছবি Import (Composer/Template-এ product-এর আসল ছবি)
- **সমস্যা:** SP2-তে সৎভাবে বাদ ছিল — Products API শুধু বাইরের `imageUrl` দেয়, ভেতরে আনার পথ ছিল না; তাই product ছবি দিয়ে poster/post বানানো যায় না।
- **কাজ:** `POST social/media/import { productId }` (বা URL) — server product-এর imageUrl থেকে ছবি আনে: https-only, private IP/SSRF আটকানো, magic-byte যাচাই, size cap; MediaAsset হিসেবে (origin `imported`), একই URL দ্বিতীয়বার import হলে আগেরটাই ফেরত (dedupe)। Composer picker ও Template Poster দুটোতেই product ছবি বাছাইযোগ্য।
- **সাফল্য:** product বাছলেই তার আসল ছবি library-তে এসে post/poster-এ ব্যবহার হয়; ভুয়া/অবৈধ URL হুবহু error।

## PP4 — Instagram Carousel
- **সমস্যা:** SP6-তে IG-তে একাধিক ছবি PermanentPublishError — carousel নেই।
- **কাজ:** IG container flow-তে child containers (ছবি/ভিডিও — IG-র নিয়ম অনুযায়ী সর্বোচ্চ ১০) → CAROUSEL container → publish। Page পথ অপরিবর্তিত।
- **সাফল্য:** ২–১০ ছবির IG post boundary specs-এ পুরো flow প্রমাণিত; ১০-এর বেশি হলে সৎ Bengali error।

## Batch
- **Batch 1:** PP1 + PP3 (ছবির দিক)
- **Batch 2:** PP2 + PP4 (ভিডিও/carousel)

নিয়ম আগের মতোই: audit-first, local commit only, কোনো push মালিকের স্পষ্ট নির্দেশ ছাড়া নয়; যা প্রমাণ হয়নি তা সেভাবেই লেখা থাকবে।
