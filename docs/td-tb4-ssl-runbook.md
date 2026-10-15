# TD10 — Custom-Domain SSL Runbook (Cloudflare for SaaS পথ)

তারিখ: 2026-10-16 · প্যাকেজ: Tenant Domain, Batch TB4 · সূত্র: `docs/td-tb4-ssl-spike.md`-এর রায় (প্রথম পছন্দ: Cloudflare for SaaS)।
সঙ্গী নথি: `docs/td-tb2-wildcard-runbook.md` (প্ল্যাটফর্মের নিজের `*.qosprey.com` — আলাদা বিষয়), `docs/td-tb4-ssl-spike.md` (তিন পথের পূর্ণ গবেষণা ও সূত্র)।

**এই নথি শুধু ops ধাপের তালিকা।** কোনো ধাপ এখনো চালানো হয়নি — Cloudflare-এ SaaS enable হয়নি, কোনো custom hostname তৈরি হয়নি, কোনো লাইভ টেস্ট হয়নি। স্পাইকের সবচেয়ে বড় খোলা প্রশ্ন (সূত্রসহ spike §৩.৪): Cloudflare default অবস্থায় origin-এর দিকে SNI হিসেবে custom hostname-টাই পাঠায়, তাই Full (Strict) রেখে origin leg চলবে কিনা **স্পেয়ার ডোমেইনের লাইভ টেস্ট ছাড়া জানা যাবে না** — এই রানবুকের ধাপ ৩ সেই টেস্টই। সফল লাইভ প্রমাণ TD12-র বিষয়।

শব্দচিহ্ন: **[মালিক]** = মালিক প্যানেলে করবেন · **[Muse যাচাই]** = ধাপ শেষে Muse বাইরে থেকে probe করে প্রমাণ দেবে · **[অ্যাপ follow-up]** = টেস্ট পাসের পর কোডে ছোট বদল লাগবে (এই batch-এ করা হয়নি)।

---

## ধাপ ০ — পূর্বশর্ত

- [ ] TB2 রানবুকের wildcard ধাপগুলো হয়ে থাকা (বা অন্তত zone-এর SSL মোড Full (Strict) যাচাই করা — spike §৩.৪ টেস্ট (i) এই মোডেই হবে) **[মালিক প্যানেলে দেখবেন]**
- [ ] লাইভ টেস্টের জন্য মালিকের একটা **স্পেয়ার আসল ডোমেইন** (প্ল্যানের D3 সিদ্ধান্ত) — টেস্টের org-এ ওই ডোমেইনটা TD9 ধাপে সেট + TXT যাচাই করা থাকবে **[মালিক]**
- [ ] Zone কোন প্ল্যানে আছে প্যানেলে দেখে নেওয়া (spike-এ যাচাই হয়নি; for SaaS Free প্ল্যানেও আছে, প্রথম 100 hostname অন্তর্ভুক্ত, তারপর Plans পেজ অনুযায়ী $0.10/নাম/মাস — enable পর্দায় কোনো আলাদা বেস ফি দেখালে এখানে টীকা দিতে হবে) **[মালিক]**

## ধাপ ১ — Cloudflare for SaaS enable + fallback origin **[মালিক]**

Cloudflare → qosprey.com → SSL/TLS → Custom Hostnames:

1. Cloudflare for SaaS **enable** করা।
2. **Fallback origin** মনোনীত করা: সার্ভারের দিকে যাওয়া বিদ্যমান **proxied** রেকর্ডটাই (spike §৩.১ অনুযায়ী fallback origin হতে হয় proxied A/AAAA/CNAME) — কোন রেকর্ড বেছে নেওয়া হলো এখানে টীকা দিয়ে রাখতে হবে: `________________`
3. Fallback origin-এর status **Active** না হওয়া পর্যন্ত অপেক্ষা।
4. (প্রস্তাবিত) **CNAME target** তৈরি: যেমন `customers.qosprey.com` — proxied CNAME, fallback origin-এর দিকে। Merchant-রা ভবিষ্যতে এই নামেই CNAME বসাবে; target-এর আসল নাম এখানে টীকা: `________________`

⚠️ এই ধাপে platform-এর নিজের হোস্টগুলোর (app/admin/api/media) কোনো সেটিং বদলানো হবে না — Custom Hostnames শুধু বাইরের নামের জন্য।

## ধাপ ২ — API token (ভবিষ্যৎ অ্যাপ-integration-এর জন্য) **[মালিক]**

1. Cloudflare → My Profile → API Tokens → Create Token: **শুধু এই zone**-এর জন্য, শুধু SSL/Custom Hostnames-সংক্রান্ত permission (সঠিক permission নাম টোকেন তৈরির পর্দায় যাচাই সাপেক্ষে — spike-এ নিশ্চিত করা যায়নি)।
2. Token **কখনো চ্যাটে/repo-তে নয়** — মালিক নিজে পাসওয়ার্ড ম্যানেজারে রাখবেন। অ্যাপ থেকে custom hostname তৈরি করার integration (EC8 verified হলে স্বয়ংক্রিয় create/status/delete) **এই batch-এ বানানো হয়নি** — token আগে অ্যাপে বসানোর জায়গাও এখন নেই; এই ধাপ শুধু ভবিষ্যৎ integration-এর প্রস্তুতি, টোকেন তৈরি এখনই জরুরি নয়।

## ধাপ ৩ — Origin-leg লাইভ টেস্ট (স্পেয়ার ডোমেইন) — নির্ণায়ক ধাপ

স্পেয়ার ডোমেইনটা একটা টেস্ট org-এ TD9 ধাপে সেট করে TXT যাচাই শেষ করা অবস্থায়, dashboard থেকে সেই ডোমেইনের জন্য **custom hostname তৈরি** (spike §৩.১: hostname + validation method; DCV-র জন্য প্রস্তাবিত delegated পদ্ধতি — merchant-পক্ষের `_acme-challenge` CNAME-সহ ধাপগুলো spike §৩.২)। তারপর একে একে:

| # | বিন্যাস | যা দেখতে হবে | ফল |
|---|---|---|---|
| (i) | Fallback origin, zone মোড **Full (Strict)** যেমন আছে | ডোমেইন ব্রাউজারে খোলে কিনা; Cloudflare **526** আসে কিনা; `ssl.status` ও hostname `status` দুটোই active কিনা | ☐ |
| (ii) | (i) ব্যর্থ হলে — প্রতি hostname-এ `custom_origin_server` = wildcard-আওতার proxied নাম (spike §৩.৪ (iii)) | SNI ওই নামে গেলে handshake চলে কিনা; Full (Strict) আচরণ | ☐ |
| (iii) | (i)/(ii) কোনোটাই Full (Strict)-এ না চললে — hostname-ভিত্তিক configuration rule দিয়ে শুধু custom hostname ট্র্যাফিকে মোড ছাড় দেওয়া যায় কিনা | platform হোস্টগুলোর Full (Strict) অক্ষত থাকে কিনা — **ছাড় মানে Leg 2 যাচাই দুর্বল হওয়া; এই সিদ্ধান্ত নিরাপত্তা বিবেচনায় মালিকের, Muse একা নেবে না** | ☐ |

- [ ] কোন বিন্যাস শেষ পর্যন্ত চলল, তার টীকা এখানে: `________________`
- [ ] টেস্টের সময় merchant-পক্ষের DNS কাজের তালিকা চূড়ান্ত করা (spike §৩.২-এর সারণি: EC8 TXT + CNAME → SaaS target + সম্ভবত `_acme-challenge` CNAME) **[Muse যাচাই — টেস্টের আসল অভিজ্ঞতা থেকে]**
- [ ] Apex পরীক্ষা: স্পেয়ার ডোমেইনটা apex হলে — registrar-এর CNAME flattening দিয়ে SaaS target-এর দিকে এনে validate/active হয় কিনা (spike §৩.৩ — Enterprise apex-proxying v1-এ কেনা হচ্ছে না) **[Muse যাচাই]**

**কোনো বিন্যাসই না চললে:** রায় বদলাবে — তখন (ক) Traefik config-driven ACME (spike §২.২) origin-মুখী সার্টিফিকেটের জন্য জোড়া লাগবে, কিংবা (খ)-এর সঙ্গে জোড়া হিসেবে। সেই ক্ষেত্রে এই রানবুকে নতুন ধাপ যোগ হবে; এখন অনুমান করে লেখা হলো না।

## ধাপ ৪ — টেস্ট পাসের পরের অ্যাপ follow-up **[অ্যাপ follow-up — এই batch-এ করা হয়নি]**

টেস্ট পাস করলে TD9 UI-এর routing নির্দেশনা CfS-এর বাস্তবতার সাথে মেলাতে হবে (এখনকার UI বর্তমান manual/Traefik জগতের নির্দেশ দেয় — CfS চালুর আগে বদলালে চালু পথের নির্দেশ ভাঙত, তাই এই batch-এ সচেতনভাবে বদলানো হয়নি):

1. CNAME target `app.qosprey.com` বদলে ধাপ ১-এর SaaS CNAME target (যেমন `customers.qosprey.com`)।
2. Apex-এর "(খ) A রেকর্ডে সার্ভারের IP" পরামর্শ **তুলে দেওয়া** (spike §৩.৩: সরাসরি origin IP-তে A দিলে ট্র্যাফিক CfS দিয়ে আসে না, edge সার্টও মেলে না, origin IP-ও প্রকাশ পায়) — জায়গায় flattening পরামর্শ + www-কে মূল ঠিকানা ধরার পরামর্শ (মালিকের পণ্য-সিদ্ধান্তের টীকাসহ)।
3. `_acme-challenge` CNAME (delegated DCV) ধাপটা নির্দেশনায় যোগ — যদি টেস্টে সেই পদ্ধতিই নেওয়া হয়।
4. TD9 অবস্থা তালিকার SSL সারি: প্যানেল ধাপ শেষ হলে "ব্যবস্থা চালু — custom hostname-এর অবস্থা dashboard-এ" ধরনের সৎ অবস্থায় হালনাগাদ; অ্যাপ-integration এলে তখন ssl.status-ভিত্তিক আসল অবস্থা।

## ধাপ ৫ — যাচাই probes **[Muse যাচাই]** (TD12-র অংশ)

1. নতুন verified ডোমেইন: কোনো সার্ভার-হাত ছাড়াই HTTPS-এ দোকান খোলে, সার্টিফিকেট সতর্কতা নেই (TD10-এর সাফল্যের মাপকাঠি)।
2. Platform হোস্টগুলো (app/admin/api/media + tenant subdomain) টেস্টের আগের আচরণেই আছে — বিশেষ করে SSL মোডের কোনো ছাড় platform হোস্টে গিয়ে লাগেনি।
3. ডোমেইন সরিয়ে ফেললে (TD9 ধাপ ৫) hostname-এর ট্র্যাফিক আর দোকানে আসে না (অ্যাপ-integration না থাকা পর্যন্ত hostname মোছা **মালিকের হাতে dashboard থেকে** — টীকা এখানে থাকবে)।

## Rollback

1. Custom Hostnames পর্দা থেকে টেস্ট hostname মোছা; দরকার হলে for SaaS **disable** — platform-এর নিজের হোস্টগুলো এতে ছোঁয়া লাগে না (তারা zone-এর সাধারণ রেকর্ডেই চলে)।
2. Fallback origin মনোনয়ন তুলে দেওয়া।
3. কোড/DB rollback লাগে না — অ্যাপের দিক থেকে এই batch-এ শুধু `GET /public/shop/domain-allowed` ask endpoint যোগ হয়েছে, যা বর্তমান রায়ের পথে ব্যবহৃত হয় না (spike সারাংশ acceptance-এ) এবং কোনো routing বদলায় না।
