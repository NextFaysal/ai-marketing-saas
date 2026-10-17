# Deploy গাইড — GitHub Actions দিয়ে Build, Dokploy দিয়ে শুধু Run

## কেন এই পদ্ধতি

আগে Dokploy সার্ভারেই পুরো প্রজেক্ট build করত। প্রজেক্ট বড় হওয়ায় build চলতে
চলতে সার্ভারের RAM শেষ হয়ে build **cancelled** হয়ে যাচ্ছিল, সাইট 502 থাকছিল।

এখন থেকে:

- **Build হবে GitHub-এর মেশিনে** (GitHub Actions) — সার্ভারের RAM/disk-এ চাপ নেই।
  Repo public, তাই এটা সম্পূর্ণ ফ্রি।
- তৈরি **Docker image** GitHub-এর registry-তে (GHCR) থাকবে:
  `ghcr.io/nextfaysal/ai-marketing-saas:latest`
- **Dokploy শুধু image টেনে চালাবে** — Redeploy মানে কয়েক মিনিটের pull + start,
  build-ই নেই, তাই cancelled হওয়ার সুযোগ নেই।

## একবারের সেটআপ (শুধু প্রথমবার)

### ধাপ ০ — Environment যাচাই (Dokploy → তোমার Compose app → Environment)

আগের মানগুলো থাকার কথা: `APP_DOMAIN`, `ENCRYPTION_KEY` (একদম বদলাবে না),
`JWT_SECRET`, `POSTGRES_PASSWORD`। আরেকটা অবশ্যই থাকতে হবে:

- `INTERNAL_JOB_SECRET` — না থাকলে compose চালুই হবে না (আগেও একবার এটায়
  deploy আটকেছিল)। নিজে একটা লম্বা random মান বানিয়ে বসাও
  (যেমন `openssl rand -hex 32` দিয়ে) — মানটা কারো সঙ্গে শেয়ার করো না।

### ধাপ ১ — এই branch-এর কোড GitHub main-এ push

Push হলেই Actions নিজে থেকে build শুরু করবে। (নিয়ম আগের মতোই — push শুধু
মালিকের নির্দেশে।)

### ধাপ ২ — Build দেখা

GitHub repo → **Actions** ট্যাব → "Build & Publish Image" run।
সবুজ ✓ হতে প্রথমবার ১৫–৩০ মিনিট লাগতে পারে (এরপর cache-এর কারণে দ্রুত হবে)।
লাল ✗ হলে log-এর শেষ অংশ Muse-কে পাঠাও।

### ধাপ ৩ — Image public করা

GitHub → তোমার প্রোফাইল → **Packages** → `ai-marketing-saas` →
**Package settings** → **Change visibility** → **Public**।
(Repo এমনিতেই public, তাই image public রাখলে Dokploy কোনো login ছাড়াই
টানতে পারবে। Private রাখতে চাইলে Dokploy-তে registry credential লাগবে —
সে ক্ষেত্রে Muse-কে বলো, আলাদা ধাপ লাগবে।)

### ধাপ ৪ — Dokploy-তে compose path বদল

Dokploy → তোমার Compose app → **General / Compose Path**:
`./docker-compose.dokploy.yml` বদলে **`./docker-compose.image.yml`** করো → Save।

### ধাপ ৫ — Redeploy

**Redeploy** চাপো। এবার সার্ভারে কোনো build হবে না — image pull হবে,
তারপর api চালু হওয়ার সময় `prisma migrate deploy` নিজে থেকে চলবে
(এখন মোট ২৮০ migration; শেষটা `20261104000000_sai_learned_review_via`)।

### ধাপ ৬ — যাচাই

Deploy শেষ হলে Muse-কে বলো — বাইরে থেকে যাচাই হবে:
`https://api.qosprey.com/health` → 200 `{"status":"ok"}`,
app/admin → 200।

## এরপর থেকে প্রতিবারের deploy

১. GitHub main-এ push (মালিকের নির্দেশে)।
২. Actions-এ build সবুজ হওয়া পর্যন্ত অপেক্ষা।
৩. Dokploy-তে Redeploy (শুধু pull + start)।

## সমস্যা হলে

- **Actions build লাল:** Actions log-এর শেষ ~৩০ লাইন পাঠাও।
- **Dokploy pull-এ error (denied/not found):** ধাপ ৩-এর visibility public
  হয়েছে কিনা দেখো; আর Actions build সবুজ কিনা যাচাই করো।
- **Container চালু হয়ে আবার বন্ধ:** Dokploy-তে api service-এর log দেখো —
  বেশিরভাগ ক্ষেত্রে migration বা env সমস্যা, log-এর শেষ অংশ পাঠাও।
- **আগের পদ্ধতিতে ফিরতে চাইলে:** Compose Path আবার
  `./docker-compose.dokploy.yml` করে Redeploy — পুরনো পথ অপরিবর্তিত রাখা আছে।

## নোট

- প্রতিটা build-এর জন্য `sha-<commit>` tag-এও image থাকে — কোনো deploy
  খারাপ হলে আগের ভালো tag-এ ফিরে যাওয়া যাবে।
- Production image-এ এখন repo-র একই Dockerfile ব্যবহৃত হচ্ছে; image হালকা
  করার কাজ (runtime prune) আলাদা ধাপে পরে করা যাবে।
