# TD10 — Custom-Domain SSL Automation Spike

তারিখ: 2026-10-16 · প্যাকেজ: Tenant Domain, Batch TB4 · সূত্র: `Tenant-Domain-Plan-2026-10-15.md` §TD10।
সঙ্গী নথি: `docs/td-tb2-wildcard-runbook.md` (প্ল্যাটফর্মের **নিজের** `*.qosprey.com` wildcard — এই নথির সমস্যা সেটা নয়), `docs/deployment-dokploy.md` (Dokploy deploy গাইড)।

**এই নথি শুধু গবেষণা ও রায়।** কোনো কোড লেখা হয়নি, কোনো প্যানেলে কিছু বদলানো হয়নি, কোনো সার্টিফিকেট ইস্যু হয়নি, লাইভে কিছুই পরীক্ষা হয়নি। প্রতিটা কারিগরি দাবির পাশে সূত্রের URL দেওয়া আছে; যেটা যাচাই করা যায়নি সেটা **যাচাই সাপেক্ষে** বলে চিহ্নিত।

---

## ১. সমস্যাটা ঠিক কী

Merchant তার নিজের ডোমেইন (যেমন `dhaka-fashion.com` বা `shop.dhaka-fashion.com`) দোকানের ঠিকানা হিসেবে যোগ করে। কোডের দিক থেকে বাকি সব তৈরি:

- **মালিকানা যাচাই (EC8):** API আসল DNS TXT lookup দিয়ে টোকেন মিলিয়ে তবেই ডোমেইনকে verified ধরে (`StorefrontSetting.domainVerifiedAt`); middleware শুধু VERIFIED ডোমেইনের জন্যই shop rewrite করে, fail-open, 60 সেকেন্ড cache।
- **Routing নির্দেশনা (TD9 পর্যন্ত):** dashboard UI merchant-কে বলে — subdomain-ধাঁচের ডোমেইনে `CNAME → app.qosprey.com`, apex-এ ALIAS/ANAME flattening থাকলে সেটা, নইলে সার্ভারের IP-তে A রেকর্ড, আর `www`-এর জন্য CNAME।

যেটা **নেই**: প্রতি নতুন merchant ডোমেইনের জন্য HTTPS সার্টিফিকেট স্বয়ংক্রিয়ভাবে ইস্যু/নবায়ন হওয়ার ব্যবস্থা। ডোমেইন verified হলেও ব্রাউজারে সার্টিফিকেট মিলবে না — কারণ সার্টিফিকেট কারো ইস্যু করার কথা কোথাও বলা নেই।

### দুই পায়ে (leg) সার্টিফিকেট লাগে — এই পার্থক্যটাই পুরো spike-এর কেন্দ্র

আমাদের ট্রাফিক Cloudflare proxy হয়ে আসে, তাই TLS একবার নয়, দুইবার terminate হয়:

| Leg | কে–কার মধ্যে | কোন সার্টিফিকেট | ভাঙলে কী দেখা যাবে |
|---|---|---|---|
| Leg 1 — Edge | দর্শনার্থীর ব্রাউজার ↔ Cloudflare edge | ওই hostname-এর নামে ইস্যু করা সার্টিফিকেট, Cloudflare-এর কাছে | ব্রাউজারে সার্টিফিকেট সতর্কতা |
| Leg 2 — Origin | Cloudflare edge ↔ আমাদের সার্ভার (Traefik) | Traefik যেই সার্টিফিকেট SNI অনুযায়ী দেখায়; SSL মোড **Full (Strict)** প্রত্যাশিত হলে Cloudflare সেটা যাচাই করে — সার্টিফিকেট expired/revoked/self-signed হলে বা CN/SAN-এ requested/target hostname না থাকলে **Error 526** দেয়। সূত্র: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-526/ | Cloudflare 526 পেজ |

`*.qosprey.com` wildcard (TB2 রানবুক) শুধু Leg 2-তে আমাদের নিজের subdomain-গুলো সামলায়। Merchant-এর ডোমেইন সেই wildcard-এর আওতায় পড়ে না — দুই leg-এই আলাদা ব্যবস্থা লাগে। **কোনো পথ বেছে নেওয়ার আগে দেখতে হবে পথটা কোন leg সামলায়, আর বাকি leg-এর কী হবে।**

---

## ২. পথ (ক) — Traefik ACME: "on-demand TLS" আছে কি?

### ২.১ সরাসরি উত্তর: Caddy-ধাঁচের on-demand/ask Traefik-এ নেই

- **Caddy-র ব্যবস্থা (তুলনার জন্য):** Caddy-তে On-Demand TLS সত্যিই আছে — config-এ আগে থেকে নাম না জানলেও প্রথম TLS handshake-এর সময় সার্টিফিকেট এনে দেওয়া হয়, handshake থামিয়ে রেখে। অপব্যবহার রোধে বাধ্যতামূলকভাবে একটা **"ask" endpoint** বসাতে হয়: Caddy ওই endpoint-এ `?domain=<নাম>` পাঠিয়ে জিজ্ঞেস করে, 200 না পেলে সার্টিফিকেট নেয় না। সূত্র: https://caddyserver.com/docs/automatic-https (On-Demand TLS অংশ)
- **Traefik-এর বর্তমান ACME resolver-এ এমন কিছু নেই।** অফিসিয়াল ACME resolver ডকুমেন্টেশনের সম্পূর্ণ অপশন তালিকায় (email, caServer, storage, `httpChallenge`, `tlsChallenge`, `dnsChallenge`, certificatesDuration ইত্যাদি) কোনো `onDemand` বা `ask`-ধাঁচের অপশন নেই। সূত্র: https://doc.traefik.io/traefik/master/reference/install-configuration/tls/certificate-resolvers/acme/
  - ঐতিহাসিক টীকা: Traefik v1-এ `acme.onDemand`/`onHostRule` নামে অপশন ছিল (deprecated চিহ্নিত) — সেটা v1-এর কথা; Dokploy-এর বর্তমান ইনস্টল Traefik v3 সিরিজের (নিচে দেখুন), তাই ওই অপশনের ওপর ভরসা করা যাবে না।
- **Traefik আসলে কীভাবে সিদ্ধান্ত নেয় কোন নামের সার্টিফিকেট লাগবে:** ওই একই ডকের "Domain Definition" অংশ অনুযায়ী, certificate resolver নামগুলো **router থেকে** সংগ্রহ করে — router-এর `tls.domains`-এর `main` থাকলে সেটা থেকে, নইলে router rule-এর `Host()`/`HostSNI()` matcher থেকে। অর্থাৎ **যে hostname-এর কোনো router-ই নেই, তার জন্য Traefik নিজে থেকে কখনো সার্টিফিকেট চাইবেই না।** অচেনা SNI এলে Traefik TLS store-এর default certificate দেখায় (সেটা না বসানো থাকলে নিজের তৈরি করা self-signed), সার্টিফিকেট ইস্যুর কোনো চেষ্টা হয় না। Default certificate ও store-এর নিয়ম: https://doc.traefik.io/traefik/reference/routing-configuration/http/tls/tls-certificates/
  - একই ডক আরেকটা গুরুত্বপূর্ণ কথা বলে: সার্টিফিকেট বাছাই হয় **SNI দিয়ে, TLS handshake-এর সময়** — HTTP router rule (`Host()`) তার পরে মূল্যায়িত হয়, তাই routing ঠিক থাকলেই সার্টিফিকেট মিলবে এমন নয়।
  - TLS store বাস্তবে একটাই (`default`) — অন্য নামের store সংজ্ঞা দিলেও Traefik সেটা উপেক্ষা করে। `tls.certificates` (certFile/keyFile জোড়া) শুধু **file provider**-এর dynamic config দিয়েই দেওয়া যায়।

**সিদ্ধান্ত (ক-প্রশ্নের):** "Traefik-এ on-demand চালু করে দিলেই যেকোনো verified ডোমেইনের সার্টিফিকেট এসে যাবে" — এমন পথ **নেই**। Traefik দিয়ে স্বয়ংক্রিয় করতে হলে সার্টিফিকেট ইস্যুটাকে handshake-এর সময় নয়, **ডোমেইন verified হওয়ার মুহূর্তে, config তৈরি করে** ট্রিগার করতে হবে (২.২)।

### ২.২ যেটা সম্ভব: verified-হওয়ার মুহূর্তে router তৈরি করে দেওয়া (config-driven ACME)

ধারণা: EC8 যাচাই সফল হলেই (এবং ডোমেইন সরালে/যাচাই বাতিল হলে তার উল্টোটা) সিস্টেম Traefik-এর জন্য ওই ডোমেইনের একটা router এন্ট্রি তৈরি/মুছে দেয়:

- Router: `Host(<merchant-domain>)`, entryPoint `websecure`, service = web সার্ভিস, `tls.certResolver = letsencrypt` (Dokploy-এর বিদ্যমান resolver)।
- Traefik router দেখলেই ACME দিয়ে সার্টিফিকেট চায় (HTTP-01 / TLS-ALPN-01 / DNS-01-এর যেকোনো এক challenge-এ), `acme.json`-এ রাখে, আর মেয়াদ শেষের **30 দিন আগ থেকে নবায়ন** শুরু করে (ডিফল্ট 90-দিনের সার্টিফিকেট)। সূত্র: https://doc.traefik.io/traefik/master/reference/install-configuration/tls/certificate-resolvers/acme/ (Automatic Certificate Renewal অংশ — একই ডক সতর্ক করে: ব্যবহৃত হচ্ছে না এমন সার্টিফিকেটও Traefik নবায়ন করে যেতে পারে, ব্যবহার যাচাই করে না।)

এই router এন্ট্রি পৌঁছে দেওয়ার দুটো উপায়:

| উপায় | কীভাবে | সমস্যা |
|---|---|---|
| (ক-১) **File provider dynamic config** | Dokploy-এর Traefik `/etc/dokploy/traefik/dynamic` ডিরেক্টরি mount করে চলে (Dokploy-এর অফিসিয়াল manual installation ডকে এই mount দেখা যায়: https://docs.dokploy.com/docs/core/manual-installation)। ওই ডিরেক্টরিতে YAML ফাইল বসালে/বদলালে Traefik তা পড়ে — TB2 রানবুকের পথ B-তে এই কৌশলটাই wildcard routing-এর জন্য রাখা আছে। | **কে লিখবে?** আমাদের API কন্টেইনারের হোস্টের `/etc/dokploy`-তে অ্যাক্সেস নেই। লাগবে হয় (i) API কন্টেইনারে ওই ডিরেক্টরির সীমিত mount (নিরাপত্তা বিবেচনা: কন্টেইনার থেকে হোস্টের proxy config লেখার ক্ষমতা), অথবা (ii) হোস্টে চলা ছোট sync-agent যেটা DB/API থেকে verified ডোমেইনের তালিকা টেনে ফাইল তৈরি করে। দুটোই নতুন চলমান অংশ। আর ডিরেক্টরির সঠিক পথ/watch চালু আছে কিনা/Dokploy আপগ্রেডে টেকে কিনা — **সার্ভারে যাচাই সাপেক্ষে** (TB2 রানবুকেও একই সতর্কতা আছে)। |
| (ক-২) **বাইরের ACME client** (যেমন lego/certbot-ধাঁচের টুল) | আলাদা প্রসেস সার্টিফিকেট এনে cert/key ফাইল বসায় + `tls.certificates` dynamic এন্ট্রি লেখে। | চলমান অংশ আরও বেশি; private key হোস্টে ফাইল হিসেবে ঘোরে (নিরাপত্তা ও permission-এর বাড়তি দায়); Traefik-এর নিজের ACME থাকতে দ্বিতীয় ACME ব্যবস্থা রক্ষণাবেক্ষণ দ্বিগুণ। (ক-১)-এর চেয়ে পরিষ্কার সুবিধা দেখা যায়নি। |

### ২.৩ Challenge কোনটা চলবে — এটাই (ক) পথের সবচেয়ে বড় অজানা

- **HTTP-01:** Let's Encrypt port 80-তে ওই hostname-এ challenge resource চায়; Traefik-এর `httpChallenge.entryPoint` (Dokploy-তে `web`) সেই পথে উত্তর দেয়। সূত্র: ACME ডক (উপরে)।
- **TLS-ALPN-01:** port 443-এ বিশেষ TLS handshake লাগে। আমাদের ক্ষেত্রে 443-এ প্রথমে **Cloudflare edge** বসে — edge-এর কাছে ওই merchant ডোমেইনের সার্টিফিকেটই নেই, তাই এই challenge Cloudflare পেরিয়ে origin পর্যন্ত পৌঁছাবে কিনা সন্দেহজনক। **যাচাই সাপেক্ষে — ধরে নেওয়া যাবে না।**
- **DNS-01:** Traefik-এর resolver-এ একটা DNS provider-এর credential থাকে, সেই provider-এর zone-এ TXT বসে। Merchant-এর ডোমেইনের DNS আমাদের হাতে নেই — প্রতিটা merchant-এর আলাদা registrar/provider। একমাত্র সাধারণ পথ: merchant তার DNS-এ `_acme-challenge` নামটা আমাদের zone-এর দিকে **CNAME দিয়ে delegate** করলে (ACME ডক CNAME delegation সমর্থনের কথা বলে), তখন আমাদের Cloudflare zone-এর credential দিয়ে TXT বসানো যায়। এতে merchant-এর DNS কাজ বাড়ে (TXT যাচাই + CNAME routing + এই delegation CNAME) এবং পদ্ধতিটা Dokploy-এর বিদ্যমান HTTP-challenge resolver থেকে আলাদা দ্বিতীয় resolver দাবি করে। **যাচাই সাপেক্ষে — এই spike-এ প্রমাণ হয়নি।**
- **HTTP-01 Cloudflare proxy পেরিয়ে:** Merchant-এর CNAME যদি proxied ঠিকানার দিকে থাকে, Let's Encrypt-এর অনুরোধ Cloudflare edge হয়ে origin-এ আসবে। Cloudflare সেই অচেনা hostname-এর অনুরোধ origin পর্যন্ত পাঠায় কিনা, আর পাঠালেও challenge path অক্ষত থাকে কিনা — **স্পেয়ার ডোমেইন দিয়ে লাইভ টেস্ট ছাড়া বলা যাবে না।** (এই একই প্রশ্ন (খ) পথের Leg 2-তেও ফিরে আসে, §৩.৪।)

### ২.৪ অপব্যবহার ও rate limit — (ক) পথে সুবিধা একটা, ঝুঁকি আরেকটা

**সুবিধা:** যেহেতু Traefik handshake দেখে ইস্যু করে না, শুধু config-এ থাকা নামের জন্যই চায় — ইন্টারনেট থেকে এলোমেলো SNI পাঠিয়ে কেউ আমাদের দিয়ে সার্টিফিকেট ইস্যু করাতে **পারবে না**। Caddy-র `ask` endpoint-এর সমতুল্য দরজা এখানে লাগে না; দরজাটা হলো **config তৈরির ট্রিগারটা**: সেটা শুধু EC8 TXT যাচাই পাস করা, সক্রিয় org-এর ডোমেইনের জন্যই চলতে হবে। ডোমেইন সরালে/unverify হলে router এন্ট্রিও সরাতে হবে, নইলে অপ্রয়োজনীয় নবায়ন চলতে থাকবে (উপরের ACME ডকের সতর্কতা অনুযায়ী)।

**ঝুঁকি — Let's Encrypt-এর সীমা** (সূত্র: https://letsencrypt.org/docs/rate-limits/):

| সীমা | মান | আমাদের জন্য অর্থ |
|---|---|---|
| Registered domain প্রতি নতুন সার্টিফিকেট | 50 / 7 দিন (ওই ডোমেইনের সব অ্যাকাউন্ট মিলিয়ে global) | প্রতিটা merchant ডোমেইন নিজে একটা registered domain — তাই merchant বাড়লে এই সীমা সাধারণত বাঁধবে না। ব্যতিক্রম: একই merchant ডোমেইনের অনেক subdomain আলাদা সার্টিফিকেট নিলে সেই ডোমেইনের bucket থেকেই যাবে। |
| একই identifier সেটের duplicate সার্টিফিকেট | 5 / 7 দিন | Debug/retry-তে একই নামে বারবার ইস্যু করালে আটকাবে — পরীক্ষা staging ACME দিয়ে করতে হবে। |
| অ্যাকাউন্ট প্রতি নতুন order | 300 / 3 ঘণ্টা | **এটা সবার মিলিত bucket** — আমাদের একটাই Traefik ACME অ্যাকাউন্ট সব merchant-এর জন্য। বড় onboard ঢেউ বা গণ-নবায়ন ব্যর্থতার retry-ঝড়ে এই সীমা সত্যিকারের বাধা হতে পারে। |
| Identifier প্রতি ব্যর্থ validation | 5 / ঘণ্টা (প্রতি অ্যাকাউন্ট) | ভুল DNS-ওয়ালা ডোমেইনে অন্ধ retry করলে ওই নাম ঘণ্টাখানেক আটকে থাকবে — retry-তে backoff ও সীমা রাখতে হবে। |

### ২.৫ (ক) পথের হিসাব

- **কী লাগে:** (১) হোস্টে dynamic config লেখার নিরাপদ পথ (sync-agent বা সীমিত mount) — সার্ভার-অ্যাডমিনের কাজ, সার্ভারে বর্তমান Traefik সেটআপ দেখে; (২) অ্যাপ কোডে verified-ডোমেইনের তালিকা থেকে config তৈরি/মোছার অংশ + ব্যর্থ ইস্যুর status দেখানো; (৩) challenge পদ্ধতির লাইভ টেস্ট (স্পেয়ার ডোমেইন)।
- **কে করবে:** সার্ভার ধাপ মালিক/সার্ভার-অ্যাডমিন; কোডের অংশ অ্যাপে; প্যানেলে (Dokploy) সম্ভবত Traefik config দেখা/Reload — **যাচাই সাপেক্ষে**।
- **খরচ:** টাকার খরচ $0 (Traefik ও Let's Encrypt ফ্রি)। আসল খরচ প্রকৌশল + চিরকালীন ops: `acme.json` একটাই ফাইলে সব সার্টিফিকেট — ফাইল নষ্ট/হারানো মানে সব ডোমেইনের একসাথে পুনঃইস্যু (rate limit-সহ); Traefik একটাই instance ধরে নেওয়া হয়েছে — **সার্ভারে যাচাই সাপেক্ষে**।
- **Dokploy সংস্করণের কথা:** Dokploy-এর অফিসিয়াল manual installation ডকে Traefik কন্টেইনার `traefik:v3.6.7` image-এ দেখানো হয়েছে এবং config `/etc/dokploy/traefik/traefik.yml` + dynamic ডিরেক্টরি `/etc/dokploy/traefik/dynamic` mount করা। সূত্র: https://docs.dokploy.com/docs/core/manual-installation — তবে **আমাদের সার্ভারে আসলে কোন সংস্করণ/কনফিগ চলছে তা এই spike-এ দেখা হয়নি — যাচাই সাপেক্ষে।** বিদ্যমান resolver-এর নাম `letsencrypt` ও challenge HTTP — এটা repo-র deployment গাইড ও TB2 রানবুকের বর্ণনা থেকে জানা, সার্ভারে নিশ্চিত করা বাকি।

---

## ৩. পথ (খ) — Cloudflare for SaaS (Custom Hostnames)

### ৩.১ কীভাবে কাজ করে

Cloudflare for SaaS ঠিক এই কাজের জন্যই তৈরি: SaaS provider তার zone-এ customer-এর নিজের ডোমেইনকে **custom hostname** হিসেবে যোগ করে, Cloudflare সেই নামের জন্য edge-এ সার্টিফিকেট ইস্যু করে ও ট্র্যাফিক provider-এর origin-এ পাঠায়। স্ট্যান্ডার্ড configuration সব প্ল্যানে আছে। সূত্র: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/

একবারের সেটআপ (zone প্রতি):

1. Zone-এ Cloudflare for SaaS **enable** করা (dashboard: SSL/TLS → Custom Hostnames)।
2. **Fallback origin** বসানো: একটা **proxied** A/AAAA/CNAME রেকর্ড যেটা আমাদের সার্ভারের দিকে যায়, সেটাকে fallback origin হিসেবে মনোনীত করা; status `Active` হওয়া পর্যন্ত অপেক্ষা। Custom hostname-এর ট্র্যাফিক ডিফল্টে এখানেই যাবে।
3. (ঐচ্ছিক কিন্তু প্রস্তাবিত) **CNAME target** — যেমন `customers.qosprey.com` — proxied CNAME হিসেবে fallback origin-এর দিকে; merchant-রা তাদের রেকর্ড এই পরিচিত নামে দেবে, ফলে পরে fallback বদলালেও merchant-দের রেকর্ড বদলাতে হবে না।

সূত্র (ধাপগুলোসহ): https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/

প্রতি merchant ডোমেইনে:

1. অ্যাপ (API দিয়ে) বা dashboard থেকে **custom hostname তৈরি** — hostname, minimum TLS version, validation method বেছে। API endpoint আছে, অর্থাৎ EC8 যাচাই সফল হওয়ার মুহূর্তে অ্যাপ নিজেই এটা ডাকতে পারে।
2. **দুটো আলাদা যাচাই** শেষ হতে হয়: hostname validation (মালিকানা — `status` ফিল্ড) আর certificate validation/DCV (সার্টিফিকেট ইস্যু — `ssl.status` ফিল্ড)। দুটোই `active` + DNS SaaS target-এর দিকে থাকলে তবেই hostname production-এর জন্য তৈরি ধরা হয়। সূত্র: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/ এবং getting-started ডকের "Check when a custom hostname is ready" অংশ।
3. Merchant তার DNS-এ **CNAME** বসায়: `<তার-নাম> CNAME customers.qosprey.com` (আমাদের বেছে দেওয়া target)।

### ৩.২ DCV (সার্টিফিকেট যাচাই) পদ্ধতি — merchant-এর DNS-এ ঠিক কী লাগবে

Custom hostname তৈরির সময় `ssl.method` একটা বেছে নিতে হয়: `http`, `txt` বা `email`। সূত্র: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/security/certificate-management/issue-and-validate/validate-certificates/http/

- **HTTP DCV:** hostname SaaS target-এর দিকে point করার পর Cloudflare HTTP দিয়ে যাচাইয়ের চেষ্টা করে (non-wildcard নামে TXT বেছে রাখলেও এই চেষ্টা হয়)। CAA রেকর্ডে বেছে নেওয়া CA আটকানো না থাকলে বাড়তি DNS রেকর্ড ছাড়াই চলতে পারে।
- **TXT DCV:** Cloudflare-এর দেওয়া টোকেন merchant-কে তার `_acme-challenge` TXT-তে বসাতে হয়। আমাদের EC8-এর নিজের TXT টোকেনের সঙ্গে এটা **আলাদা টোকেন, আলাদা উদ্দেশ্য** — দুটোই রাখতে হলে merchant-কে দুই সেট নির্দেশ বোঝাতে হবে।
- **Delegated DCV (প্রস্তাবিত ধাঁচ):** merchant **একবার** একটা CNAME বসায়: `_acme-challenge.<তার-ডোমেইন> CNAME <ডোমেইন>.<Cloudflare-এর দেওয়া DCV hostname>`। এরপর থেকে সব ইস্যু **ও নবায়নের** DCV Cloudflare নিজে সামলায় — নবায়নের সময় merchant-কে আর কিছু ছুঁতে হয় না; CNAME-টা থেকে যেতেই হবে। সূত্র: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/security/certificate-management/issue-and-validate/validate-certificates/delegated-dcv/

অর্থাৎ merchant-এর মোট DNS কাজ (এই পথে, প্রস্তাবিত ধাঁচে):

| রেকর্ড | কেন | কতবার |
|---|---|---|
| TXT টোকেন (আমাদের EC8) | আমাদের কাছে মালিকানা প্রমাণ | একবার (ডোমেইন বদলালে আবার) |
| `CNAME <নাম> → customers.qosprey.com` | ট্র্যাফিক আমাদের zone-এ আনা | একবার |
| `CNAME _acme-challenge.<নাম> → <DCV target>` | Delegated DCV — সার্টিফিকেট ইস্যু/নবায়ন স্বয়ংক্রিয় রাখা | একবার (যদি HTTP DCV-তে ভরসা না রাখা হয়) |

লক্ষণীয় পরিবর্তন: বর্তমান TD9 UI merchant-কে CNAME target হিসেবে `app.qosprey.com` দেখায় — এই পথ নিলে target বদলে CNAME target (`customers.qosprey.com`-ধাঁচের নাম) দেখাতে হবে, আর apex-এর নির্দেশনাও বদলাবে (§৩.৩)।

### ৩.৩ খরচ ও সীমা (অফিসিয়াল Plans পেজ অনুযায়ী)

সূত্র: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/ (পেজটির Updated তারিখ 2026-08-14 বলে দেখানো হয়েছে)

| বিষয় | Free | Pro | Business | Enterprise |
|---|---|---|---|---|
| পাওয়া যায় | হ্যাঁ | হ্যাঁ | হ্যাঁ | Account team-এর মাধ্যমে |
| অন্তর্ভুক্ত hostname | 100 | 100 | 100 | Custom |
| সর্বোচ্চ hostname | 50,000 | 50,000 | 50,000 | Unlimited (50,000-এর বেশি হলে sales-এর সঙ্গে কথা) |
| অতিরিক্ত প্রতি hostname-এর দাম | **$0.10 / মাস** | $0.10 / মাস | $0.10 / মাস | Custom pricing |
| Wildcard custom hostname | না | না | না | হ্যাঁ |
| Custom certificate আপলোড / নিজে CA বাছাই | না | না | না | হ্যাঁ |
| **Apex proxying / BYOIP** | **না** | **না** | **না** | **Paid add-on** |

- পুরোনো ব্লগ/কমিউনিটি পোস্টে "$2/hostname" দামের উল্লেখ পাওয়া যায় — Plans পেজের বর্তমান তালিকার সঙ্গে তা মেলে না; **এই নথির হিসাব Plans পেজের $0.10 সংখ্যাটাই ধরেছে**, চূড়ান্ত বিলিং dashboard-এ enable করার সময় মালিক একবার দেখে নেবেন (**যাচাই সাপেক্ষে** — enable করার পর্দায় আলাদা বেস ফি দেখানো হয় কিনা এই spike-এ dashboard খুলে দেখা হয়নি)।
- হিসাবের ধারণা: 100-এর পর প্রতি merchant ডোমেইনে মাসে $0.10 — 500 ডোমেইনে মাসে $40, 5,000 ডোমেইনে মাসে $490। Zone-এর নিজের প্ল্যান খরচ (যদি থাকে) এর বাইরে, এই spike-এ আমাদের zone কোন প্ল্যানে আছে তা **যাচাই করা হয়নি** — তবে তালিকা বলছে Free প্ল্যানেও সুবিধাটা আছে।
- **Apex সমস্যা (সবচেয়ে বড় সীমা):** apex ডোমেইনে (`dhaka-fashion.com`, কোনো subdomain ছাড়া) DNS নিয়মে CNAME বসানো যায় না। Cloudflare-এর নিজের সমাধান **Apex Proxying** — শুধু Enterprise paid add-on (উপরের তালিকা)। Apex proxying-এর সেটআপে merchant A রেকর্ডে Cloudflare-এর দেওয়া IP prefix দেবে বা CNAME দেবে — সেটাও Enterprise পথের নথি। সূত্র: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/apex-proxying/setup/
  - বাস্তবসম্মত v1 বিকল্প (Enterprise ছাড়া): merchant-এর registrar **CNAME flattening/ALIAS/ANAME** দিলে apex-ও SaaS target-এর দিকে আনা যায় — বর্তমান UI-ও apex-এর জন্য এই পরামর্শই দেয়। Flattening-ওয়ালা apex Cloudflare for SaaS-এ ঠিকমতো validate/active হয় কিনা **স্পেয়ার ডোমেইন দিয়ে যাচাই সাপেক্ষে**। যাদের registrar-এ flattening নেই, তাদের জন্য v1-এ `www.`-কে মূল ঠিকানা ধরে apex থেকে redirect-এর পরামর্শই বাস্তব পথ — এটা পণ্যের সিদ্ধান্ত, মালিকের।
  - বর্তমান UI-এর apex-এর "(খ) A রেকর্ডে সার্ভারের IP" পরামর্শটা এই পথের সঙ্গে **মেলে না**: সরাসরি origin IP-তে A রেকর্ড দিলে ট্র্যাফিক Cloudflare for SaaS-এর মধ্য দিয়েই আসবে না, ফলে edge সার্টিফিকেটও মিলবে না (আর origin IP প্রকাশ্যে চলে আসে)। এই পথ নিলে ওই নির্দেশনা তুলে দিতে হবে।

### ৩.৪ Leg 2 (origin) নিয়ে খোলা প্রশ্ন — এই পথের নির্ণায়ক অজানা

Edge সার্টিফিকেট (Leg 1) Cloudflare পুরোপুরি সামলায় — ইস্যু, deploy, নবায়ন, কোনোটাতেই আমাদের সার্ভার জড়িত নয়। কিন্তু Leg 2-তে Cloudflare যখন origin-এর সঙ্গে কথা বলে:

- **Default (fallback) origin-এর ক্ষেত্রে** Cloudflare origin-এর কাছে **Host header আর SNI দুটোই original custom hostname** পাঠায়। সূত্র: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/custom-origin/
  - এর মানে: Traefik SNI হিসেবে merchant-এর ডোমেইনটাই দেখবে, এবং Full (Strict) যাচাইয়ে সেই নামের সঙ্গে মেলা সার্টিফিকেটই প্রত্যাশিত (Error 526 ডকের "requested or target hostname" শর্ত)। আমাদের Traefik-এর কাছে সেই সার্টিফিকেট **নেই** — default certificate (`*.qosprey.com` wildcard বা self-signed) ওই নামের সঙ্গে মিলবে না।
- **Custom origin server বসালে** (প্রতি hostname-এ `custom_origin_server` দেওয়া যায়) SNI হয়ে যায় ওই custom origin-এর নাম, Host থাকে original hostname। কিন্তু একই ডক স্পষ্ট সতর্ক করে: SNI আর Host না মিললে origin-এ **Full (strict) ব্যবহার করা যাবে না**; সমাধান হিসেবে **SNI rewrites** entitlement লাগে, যেটা account team-এর কাছ থেকে নিতে হয় (Plans তালিকায় SNI Rewrite শুধু Enterprise-এ "contact your account team")।

তাই সত্যি কথাটা হলো: **"Cloudflare for SaaS চালু করলেই origin-এ আর কোনো সার্টিফিকেট লাগবে না" — এই দাবি ডক দিয়ে প্রমাণ করা যায়নি।** সম্ভাব্য বিন্যাসগুলোর মধ্যে কোনটা আমাদের সেটআপে আসলে চলে, তা স্পেয়ার ডোমেইন দিয়ে লাইভ টেস্টেই জানা যাবে (TD পরিকল্পনায় মালিকের D3 সিদ্ধান্ত — spare live domain — এখানেই লাগবে):

| পরীক্ষার বিন্যাস | কী প্রমাণ হবে |
|---|---|
| (i) Fallback origin + zone মোড Full (Strict) যেমন আছে | Traefik default/wildcard সার্টিফিকেট দিয়ে CF origin যাচাই পাস করে কিনা, নাকি 526 আসে |
| (ii) Fallback origin + শুধু custom hostname ট্র্যাফিকের জন্য মোডের ব্যতিক্রম (যদি Cloudflare-এ hostname-ভিত্তিক configuration rule দিয়ে তা আলাদা করা যায় — **যাচাই সাপেক্ষে**) | Platform-এর নিজের হোস্টগুলোর Full (Strict) অক্ষত রেখে merchant ট্র্যাফিকে ছাড় দেওয়া যায় কিনা; ছাড় মানেই Leg 2-এর যাচাই দুর্বল — নিরাপত্তা সিদ্ধান্ত মালিকের |
| (iii) প্রতি hostname-এ custom origin (`*.qosprey.com`-এর আওতায় থাকা proxied নাম) | SNI সেই নামে গেলে Traefik-এর wildcard সার্টিফিকেটে handshake চলে কিনা, আর Full (Strict) ছাড়া/সহ আচরণ |

এই টেস্টের ফল (খ) পথের চূড়ান্ত আকার ঠিক করবে: টেস্টে (i)/(iii)-এর কোনো একটা Full (Strict) রেখে চললে (খ) একাই যথেষ্ট; কোনোটাই না চললে (খ)-এর সঙ্গে Leg 2-এর জন্য (ক)-এর config-driven ACME (শুধু origin-মুখী সার্টিফিকেট হিসেবে) জুড়তে হতে পারে — সেক্ষেত্রে (খ) আর (ক) প্রতিদ্বন্দ্বী নয়, পরিপূরক।

### ৩.৫ আমাদের zone ইতিমধ্যে Cloudflare-এ থাকার সুবিধা ও বাধা

সুবিধা:

- DNS স্থানান্তর বা নতুন vendor লাগে না; fallback origin হবে বিদ্যমান সার্ভারগামী proxied রেকর্ডেরই একটা রূপ।
- Merchant-এর ট্র্যাফিক এমনিতেই Cloudflare পেরিয়ে আসার কথা (বর্তমান CNAME নির্দেশনা proxied `app.qosprey.com`-এর দিকে) — মানসিক মডেল বদলায় না, শুধু target আর যাচাইয়ের মালিক বদলায়।
- সার্টিফিকেটের lifecycle (ইস্যু/নবায়ন/মেয়াদ) পুরোপুরি Cloudflare-এর দায় — `acme.json`, ACME অ্যাকাউন্টের rate limit, নবায়ন পর্যবেক্ষণ — এই ops বোঝা আমাদের ঘাড়ে পড়ে না (edge-এর জন্য)।

বাধা/খেয়াল:

- Zone-এর SSL মোড, WAF ইত্যাদি সেটিং platform-এর নিজের হোস্ট আর merchant হোস্ট **একই zone** ভাগ করে — §৩.৪-এর ছাড় জাতীয় কিছু লাগলে তা যেন `app`/`api`/`admin`-এর সুরক্ষা না কমায়, সেটা আলাদা করে যাচাই করতে হবে।
- Merchant নিজেও Cloudflare ব্যবহার করলে বা অন্য CDN-এ থাকলে কিছু সীমা আছে: অন্য CDN ব্যবহার করা hostname Cloudflare for SaaS-এর সঙ্গে compatible নয় বলে ডকে বলা আছে (hostname validation ব্যর্থ হতে পারে)। সূত্র: hostname validation ডক (উপরে)।
- API token-এর দায়: অ্যাপকে custom hostname তৈরি/মোছার জন্য Cloudflare API token লাগবে (zone-সীমিত, শুধু SSL/certificates অধিকার — token-এর সঠিক permission নাম dashboard/token তৈরির সময় **যাচাই সাপেক্ষে**)। Token কখনো repo/চ্যাটে নয় — M33 verify-before-save ধাঁচে platform setting হিসেবে মালিক নিজে বসাবেন।

### ৩.৬ (খ) পথের হিসাব

- **কী লাগে:** (১) মালিক Cloudflare dashboard-এ SaaS enable + fallback origin মনোনয়ন + API token তৈরি; (২) সার্ভার দিকে নতুন প্রায় কিছুই না — fallback origin-এর রেকর্ড বিদ্যমান সার্ভারেই যাবে; (৩) অ্যাপ কোডে Cloudflare API integration (EC8 verified হলে create, status/ssl.status poll করে UI-তে অবস্থা দেখানো, ডোমেইন সরালে delete) + TD9 UI-এর CNAME target ও apex নির্দেশনা হালনাগাদ; (৪) §৩.৪-এর লাইভ টেস্ট।
- **কে করবে:** প্যানেলের ধাপ মালিক; কোড অ্যাপে; সার্ভার-অ্যাডমিনের কাজ প্রায় শূন্য (টেস্টের সময় Traefik দিকে চোখ রাখা ছাড়া)।
- **খরচ:** প্রথম 100 hostname ফ্রি (অন্তর্ভুক্ত), তারপর $0.10/hostname/মাস (Plans পেজ অনুযায়ী; §৩.৩-এর সতর্কতা প্রযোজ্য)। Apex proxying লাগলে Enterprise — এই spike সেই খরচের কোনো সংখ্যা **যাচাই করতে পারেনি**, আর v1-এ তা কেনার প্রস্তাবও দিচ্ছে না।
- **ঝুঁকি/সীমা:** vendor lock-in (সার্টিফিকেট ও edge যাচাই Cloudflare-এর হাতে); §৩.৪-এর অমীমাংসিত origin প্রশ্ন; apex-এর Enterprise দেয়াল; 50,000 hostname-এর ceiling (non-Enterprise) — আমাদের প্রত্যাশিত স্কেলে এটা বাধা নয়।

---

## ৪. পথ (গ) — Dokploy-তে হাতে প্রতি ডোমেইন যোগ করা (শুধু জরুরি বিকল্প)

পদ্ধতি: Dokploy-এর অফিসিয়াল ডক অনুযায়ী প্রতিটা ডোমেইনের জন্য — DNS-এ সার্ভারের দিকে A রেকর্ড, তারপর Dokploy প্যানেলে Domains → Create Domain: Host, Path, Container Port, **HTTPS ON, Certificate: Let's Encrypt**। সূত্র: https://docs.dokploy.com/docs/core/domains/others — আমাদের stack Compose-ভিত্তিক; Compose সার্ভিসে Dokploy domain থেকে Traefik label তৈরি করে deploy-এর সময় বসায়। সূত্র: https://docs.dokploy.com/docs/core/docker-compose/domains

**কেন স্কেল করে না (বাতিলের কারণ):**

1. **প্রতি merchant-এ মানুষের হাত:** প্রতিটা onboard, ডোমেইন বদল আর বাতিলে মালিক/অ্যাডমিনকে প্যানেলে ঢুকে হাতে কাজ করতে হবে। Merchant self-serve অসম্ভব — পণ্যের মূল প্রতিশ্রুতি (নিজে ডোমেইন যোগ করে নিজে যাচাই) এখানে ভেঙে যায়।
2. **Deploy চক্রে হস্তক্ষেপ:** Compose পথে domain বদল deploy-এর সঙ্গে জড়িত (Dokploy-এর troubleshooting ডকও বলে Compose/Template সার্ভিসে domain বদলের পর redeploy লাগে: https://docs.dokploy.com/docs/core/troubleshooting/domains)। প্রতি merchant onboard-এ পুরো stack redeploy মানে বাকি সবার জন্য ঝুঁকি ও বিঘ্ন।
3. **তালিকা ব্যবস্থাপনার অনুপস্থিতি:** Dokploy-এর domain তালিকা tenant registry নয় — কোন ডোমেইন কোন org-এর, যাচাই হয়েছে কিনা, মেয়াদ/অবস্থা কী — এই হিসাব অ্যাপের DB-তেই রাখতে হবে, অথচ কাজ হবে প্যানেলে; দুই জায়গার অসামঞ্জস্য নিশ্চিত।
4. **ভুলের খরচ:** Host/port/certificate ঘরে একটা ভুল টাইপ পুরো web সার্ভিসের routing-এ গিয়ে লাগতে পারে; সংখ্যা বাড়লে এই ঝুঁকি রৈখিকভাবে বাড়ে।

**রেখে দেওয়ার একটাই যুক্তি:** জরুরি অবস্থায় হাতে-কলমে এক-দুটো VIP merchant-কে চালু করা — সেটাও লিখিত সিদ্ধান্তে, সাময়িক ব্যবস্থা হিসেবে, পরে আসল পথে সরিয়ে নেওয়ার পরিকল্পনাসহ।

---

## ৫. তুলনা এক নজরে

| মানদণ্ড | (ক) Traefik config-driven ACME | (খ) Cloudflare for SaaS | (গ) Dokploy হাতে |
|---|---|---|---|
| Leg 1 (edge) সার্টিফিকেট | Traefik-ই দেয় (origin-ই edge-এর ভূমিকায়; Cloudflare পেরিয়ে আসা ট্র্যাফিকে প্রযোজ্য কিনা §২.৩) | Cloudflare ইস্যু/নবায়ন করে | Traefik (Dokploy Let's Encrypt) |
| Leg 2 (origin) সার্টিফিকেট | একই সার্টিফিকেটেই মেটে (যদি ইস্যু হয়) | **অমীমাংসিত — §৩.৪ টেস্ট লাগবে** | একই সার্টিফিকেটেই মেটে |
| স্বয়ংক্রিয়? | হ্যাঁ, তবে নিজেদের বানানো config-sync দিয়ে | হ্যাঁ, API দিয়ে, vendor-এর তৈরি ব্যবস্থা | না |
| Merchant-এর DNS কাজ | TXT (EC8) + CNAME + সম্ভবত `_acme-challenge` delegation | TXT (EC8) + CNAME + সম্ভবত `_acme-challenge` CNAME (delegated DCV) | TXT (EC8) + CNAME/A |
| টাকার খরচ | $0 | 100 ফ্রি, তারপর $0.10/নাম/মাস | $0 |
| Ops বোঝা | বেশি (acme.json, rate limit, config sync, নবায়ন পর্যবেক্ষণ) | কম (শুধু API অবস্থা পর্যবেক্ষণ) | প্রতি ডোমেইনে মানুষ |
| Apex ডোমেইন | A রেকর্ড origin-এ এলে HTTP-01 সম্ভব (যাচাই সাপেক্ষে) | Enterprise add-on ছাড়া আনুষ্ঠানিক পথ নেই; flattening যাচাই সাপেক্ষে | A রেকর্ডে চলে (হাতে) |
| সবচেয়ে বড় অজানা | HTTP-01 Cloudflare পেরিয়ে পৌঁছায় কিনা; dynamic config লেখার পথ ও Dokploy আপগ্রেডে টিকে থাকা | Full (Strict) রেখে Leg 2 চলে কিন
...[truncated 1206 chars]