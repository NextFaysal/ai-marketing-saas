# TD3 — Wildcard DNS / SSL / Traefik Routing Runbook

তারিখ: 2026-10-15 · প্যাকেজ: Tenant Domain, Batch TB2 · সূত্র: `Tenant-Domain-Plan-2026-10-15.md` §TD3।
সঙ্গী নথি: `docs/deployment-dokploy.md` (এই repo-র বিদ্যমান Dokploy গাইড — Domains ধাপে এখন প্রতি সার্ভিসে একটা করে নির্দিষ্ট domain: app→web:3000, admin→admin:3001, api→api:4000, প্রতিটায় Let's Encrypt)।

**এই নথি শুধু ops ধাপের তালিকা।** কোড (TD4 শ্রেণিবিভাগ + TD5 redirect) তৈরি ও committed; কিন্তু এই রানবুকের কোনো ধাপ এখনো চালানো হয়নি — কোনো DNS রেকর্ড বসেনি, কোনো সার্টিফিকেট ইস্যু হয়নি, `{slug}.qosprey.com` এখনো লাইভে resolve হয় না। আসল লাইভ প্রমাণ TD12-তে। প্যানেলের ধাপগুলো মালিকের অ্যাক্সেসে হবে; Muse শুধু মান/ধাপ প্রস্তুত করে দেবে আর শেষে যাচাই probe চালাবে — কোনো মান বানিয়ে দেওয়া হবে না।

শব্দচিহ্ন: **[মালিক]** = মালিক প্যানেলে/সার্ভারে করবেন · **[Muse যাচাই]** = ধাপ শেষে Muse বাইরে থেকে probe করে প্রমাণ দেবে।

---

## ধাপ ০ — পূর্বশর্ত

- [ ] TD কোড (TB1+TB2) deploy হয়েছে (মালিকের push নির্দেশ + Dokploy Redeploy — এই রানবুকের বাইরের ধাপ)। দোকানের subdomain আচরণ দেখতে এই deploy লাগবেই; শুধু DNS পৌঁছানো (ধাপ ৪-এর probe ১-এর প্রথম অংশ) deploy ছাড়াও যাচাই করা যায়।
- [ ] বর্তমান DNS অবস্থা প্যানেলে একবার চোখ বুলিয়ে নেওয়া **[মালিক]**: qosprey.com zone Cloudflare-এ আছে (2026-10-15-এর DNS স্থানান্তরে যাচাই করা); বিদ্যমান রেকর্ড — `@`, `www`, `app`, `admin`, `api` (A রেকর্ড, সার্ভারের দিকে, proxied) আর `media` (R2 custom domain)। এই রেকর্ডগুলোর কোনোটাই এই রানবুকে বদলানো হবে না।

## ধাপ ১ — Cloudflare wildcard DNS রেকর্ড **[মালিক]**

Cloudflare → qosprey.com → DNS → Records → Add record:

| ঘর | মান |
|---|---|
| Type | `A` |
| Name | `*` |
| IPv4 address | **বিদ্যমান `app` রেকর্ডের হুবহু একই মান** (প্যানেলে app রেকর্ড খুলে কপি করুন — Muse এই মান অনুমান করে দেবে না) |
| Proxy status | **Proxied** (orange cloud) — বিদ্যমান রেকর্ডগুলোর সাথে মিলিয়ে |
| TTL | Auto |

নোট ও যুক্তি:
- DNS নিয়মে **নির্দিষ্ট রেকর্ড সবসময় wildcard-এর ওপরে**: `app`, `admin`, `api`, `media`, `www`, `@`-এর নিজের রেকর্ড থাকায় সেগুলো আগের মতোই চলবে; wildcard শুধু সেই নামগুলো ধরবে যাদের আলাদা রেকর্ড নেই — অর্থাৎ tenant subdomain-গুলো।
- ফলে নতুন Organization তৈরি হলেই তার `{slug}.qosprey.com` সঙ্গে সঙ্গে DNS-এ ধরা পড়বে — প্রতি org-এ আলাদা রেকর্ড কখনো লাগবে না।

## ধাপ ২ — SSL

### ২ক. Edge (Cloudflare) **[মালিক প্যানেলে দেখবেন]**
- [ ] SSL/TLS → Overview: মোড **Full (Strict)** আছে কিনা। (2026-10-15-এর DNS স্থানান্তরের নথিতে এই যাচাইটা তখন বাকি ছিল বলে লেখা আছে — এই ধাপে সেরে ফেলতে হবে। Full (Strict) না থাকলে origin সার্টিফিকেট যাচাই হবে না — ধাপ ২খ-এর মানে থাকে না।)
- [ ] SSL/TLS → Edge Certificates: Universal SSL সক্রিয় এবং `*.qosprey.com` আওতাভুক্ত কিনা। tenant ঠিকানা ঠিক **এক স্তরের** (`{slug}.qosprey.com`) — Universal SSL-এর wildcard আওতা এক স্তর পর্যন্তই, তাই বাড়তি সার্টিফিকেট কেনা লাগে না। বহু-স্তরের নাম (a.b.qosprey.com) এই আওতায় পড়ে না — কোডেও সেগুলো shop নয় (TD4-এ unknown), মিলে যায়।

### ২খ. Origin (সার্ভারে Traefik) **[মালিক / মালিকের নির্দেশে সার্ভারে]**
Full (Strict) মোডে Cloudflare origin-এর কাছ থেকেও `{slug}.qosprey.com`-এর জন্য বৈধ সার্টিফিকেট চাইবে। দুটো পথের যেকোনো একটা — **কোনটা শেষ পর্যন্ত নেওয়া হলো, বাস্তবায়নের সময় এই নথিতেই টীকা দিয়ে রাখতে হবে:**

- **পথ A — Cloudflare Origin CA wildcard:** SSL/TLS → Origin Server → Create Certificate → hostnames-এ `*.qosprey.com` ও `qosprey.com` রেখে সার্টিফিকেট তৈরি; সার্টিফিকেট + private key সার্ভারে Traefik-এর TLS certificate store-এ (dynamic config-এর `tls.certificates`) বসানো।
- **পথ B — Traefik ACME (Let's Encrypt) DNS-01 challenge:** Cloudflare API token (শুধু DNS edit অধিকার, শুধু এই zone) দিয়ে Traefik `*.qosprey.com`-এর wildcard সার্টিফিকেট নিজে ইস্যু/নবায়ন করবে।

সতর্কতা:
- **Private key কখনো চ্যাটে, repo-তে বা git-এ নয়** — সার্টিফিকেটের ধাপ পুরোটাই প্যানেল/সার্ভারের ভেতরে হবে (R2 টোকেনের ঘটনা থেকে শেখা স্থায়ী নিয়ম)।
- ⚠️ **যাচাই সাপেক্ষে:** Dokploy-এর পরিচালিত Traefik কোন পথে বাইরের সার্টিফিকেট/dynamic TLS config নেয়, তা Dokploy-এর সংস্করণ ও সার্ভারের বর্তমান Traefik সেটআপ দেখে চূড়ান্ত করতে হবে। বিদ্যমান গাইডে Dokploy প্রতি নির্দিষ্ট domain-এ নিজে Let's Encrypt দেয় — wildcard domain-এ সেই স্বয়ংক্রিয় পথ কাজ করে কিনা সার্ভারে পরীক্ষা না করে ধরে নেওয়া যাবে না।

## ধাপ ৩ — Wildcard routing: web সার্ভিসে সব subdomain পৌঁছানো

লক্ষ্য: `{যেকোনো-slug}.qosprey.com`-এর HTTP(S) অনুরোধ Dokploy stack-এর **web** সার্ভিসে (port 3000) পৌঁছাবে। `app`/`admin`/`api`-র বিদ্যমান domain এন্ট্রি অপরিবর্তিত থাকবে — Traefik-এ নির্দিষ্ট Host নিয়ম দীর্ঘ/সুনির্দিষ্ট বলে wildcard নিয়মের ওপরে প্রাধান্য পায়।

- **পথ A — Dokploy Domains tab [মালিক]:** stack → Domains → web সার্ভিসে নতুন domain হিসেবে `*.qosprey.com` যোগ করা।
  ⚠️ **যাচাই সাপেক্ষে:** Dokploy-এর domain ফর্ম wildcard গ্রহণ করে কিনা সংস্করণভেদে বদলায় — প্যানেলে চেষ্টা করে দেখতে হবে; HTTPS অংশে ধাপ ২খ-এর সার্টিফিকেট পথের সাথে মিলিয়ে নিতে হবে (Dokploy-এর নিজের Let's Encrypt wildcard-এ HTTP challenge-এ চলবে না, DNS challenge লাগে)।
- **পথ B — Traefik dynamic config (A না হলে) [মালিকের নির্দেশে সার্ভারে]:** file provider-এর dynamic config-এ HostRegexp রাউটার যোগ:
  ```yaml
  http:
    routers:
      tenant-shop-wildcard:
        rule: "HostRegexp(`{slug:[a-z0-9-]+}.qosprey.com`)"
        entryPoints: ["websecure"]
        service: "<web সার্ভিসের Traefik নাম — সার্ভারে যাচাই সাপেক্ষে>"
        tls: {}
  ```
  ⚠️ **যাচাই সাপেক্ষে:** dynamic config ফাইলের অবস্থান ও web সার্ভিসের Traefik-নাম Dokploy-এর ইনস্টল অনুযায়ী বদলায় — সার্ভারে বিদ্যমান Traefik config দেখে তবেই এই ধাপ চালানো যাবে; অনুমানের পথে ফাইল বসানো যাবে না। Dokploy Redeploy-এ এই হাতে-যোগ করা config টিকে থাকে কিনা তাও একবার Redeploy দিয়ে যাচাই করতে হবে (না টিকলে Dokploy-এর নিজের custom Traefik config ব্যবস্থা খুঁজতে হবে — সেটাও এই ধাপের অংশ)।
- **Forwarded host বিশ্বাস (TD11-এর সাথে সংযোগ):** middleware Host হেডার থেকে সিদ্ধান্ত নেয় — Cloudflare→Traefik→web পথে আসল host যেন `X-Forwarded-Host`/Host হিসেবে অক্ষত পৌঁছায়, সার্ভারের proxy সেটিংয়ে এই ধাপে একবার যাচাই করে নিতে হবে।

## ধাপ ৪ — যাচাই probes **[Muse যাচাই]**

ধাপ ১–৩ শেষ হলে (ও ধাপ ০-এর deploy হয়ে থাকলে) নিচের প্রতিটা probe-এর আসল ফলাফল acceptance-এ লিখতে হবে — প্রত্যাশা লিখে প্রমাণ ধরা যাবে না:

1. **এলোমেলো subdomain পৌঁছায়:** `probe-<এলোমেলো>.qosprey.com` — DNS resolve হয়, Cloudflare হয়ে সার্ভারে পৌঁছায়, web অ্যাপ উত্তর দেয় (ওই নামে org নেই বলে দোকানের 404 আচরণই প্রত্যাশিত — TD4/TB2 acceptance-এর নোট অনুযায়ী এই tree-তে `/shop/<slug>` পেজ নিজে `notFound()` দেয়)।
2. **বিদ্যমান সেবা অক্ষত:** `qosprey.com`, `app.qosprey.com`, `admin.qosprey.com` আগের মতো পেজ দেয়; `api.qosprey.com/health` 200 JSON; `media.qosprey.com` আগের আচরণে।
3. **আসল org-এর দোকান:** একজন বিদ্যমান org মালিকের slug দিয়ে `{slug}.qosprey.com` খুললে দোকানের হোম পেজ (পণ্যসহ), পণ্যের পেজ ও কার্ট পথ চলে।
4. **TD5 জীবন্ত প্রমাণ (TD12-এর অংশ, এখানে প্রাথমিক):** একই subdomain-এ `/dashboard` খুললে **308** হয়ে `https://app.qosprey.com/dashboard`-এ যায়; `/accept-invite?token=…` লিংকেও token-সহ redirect হয়।
5. **SSL:** `{slug}.qosprey.com`-এ ব্রাউজারে সার্টিফিকেট সতর্কতা নেই (edge + origin দুই দিকেই শৃঙ্খল ঠিক)।

## ধাপ ৫ — Rollback

কিছু ভাঙলে ফেরার পথ সহজ, কারণ বদল শুধু routing স্তরে:

1. Cloudflare থেকে wildcard `*` A রেকর্ড **মুছে দেওয়া** (বা proxy বন্ধ) — propagation-এর মধ্যে সব tenant subdomain বন্ধ হয়ে যাবে; `@/www/app/admin/api/media` নিজের রেকর্ডে চলায় **অক্ষত** থাকবে।
2. ধাপ ৩-এ Traefik-এ কিছু যোগ হয়ে থাকলে (Dokploy domain এন্ট্রি বা dynamic config রাউটার) সেটা সরিয়ে Traefik/Dokploy reload।
3. ধাপ ২খ-এর সার্টিফিকেট সরানোর দরকার নেই (অব্যবহৃত সার্টিফিকেট ক্ষতিকর নয়) — তবে কোন পথ নেওয়া হয়েছিল তার টীকা এই নথিতে রেখে যেতে হবে।
4. **কোড/DB rollback লাগে না:** কোড fail-open আচরণের — subdomain host-এ অনুরোধ না এলে middleware-এর TD4/TD5 শাখা কখনো চলেই না; বাকি সব পথ (app প্যানেল, custom domain) আগের মতোই।
