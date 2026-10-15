# R2 RB1 (RM1 প্রস্তুতি) — Acceptance

**তারিখ:** 2026-10-15 · **Worktree:** `~/workspace/ai-marketing-saas-r2`, branch `r2-media`, base = GitHub main `49dac3e`
**প্যাকেজ:** Cloudflare R2 Media Program RM1–RM12 (plan: `Cloudflare-R2-Media-Plan-2026-10-15.md`) — মালিকের পূর্ণ অনুমোদন 2026-10-15 19:18 +06।
**RB1-এর সংজ্ঞা:** কোনো অ্যাপ-কোড বদল ছাড়া env দিয়েই R2 চালু করা + আসল round-trip প্রমাণ। এই ডকুমেন্ট Muse-এর দিকের প্রস্তুতি পর্যন্ত; **লাইভ প্রমাণ মালিকের Cloudflare সেটআপের পর** (নিচে "এখনো বাকি" দেখুন)।

---

## যা করা হয়েছে

### 1. গুরুত্বপূর্ণ আবিষ্কার: env শুধু বসালেই হতো না
`docker-compose.dokploy.yml`-এর api সার্ভিসে `MEDIA_S3_*`-এর কোনো উল্লেখই ছিল না, কোনো `env_file`-ও নেই। Dokploy Environment ট্যাবের মান compose-এ শুধু substitution-এর জন্য পাওয়া যায় — সার্ভিসের `environment:`-এ নাম না থাকলে মান **কন্টেইনারের ভেতরে পৌঁছায় না**। অর্থাৎ আগের অবস্থায় মালিক env বসালেও API আগের মতোই local মোডে চলত, এবং তা নীরবে। RB1-এর মূল কোড-পরিবর্তন এটাই ঠিক করে:

- `docker-compose.dokploy.yml` (api): `MEDIA_S3_BUCKET / ENDPOINT / REGION (default auto) / ACCESS_KEY_ID / SECRET_ACCESS_KEY` — সব `${VAR:-}` আকারে, ফলে মান না বসালে বর্তমান আচরণই থাকে, deploy ভাঙে না।
- YAML parse যাচাই: ঠিক আছে, api environment-এ এখন 13টি key।

### 2. Env ডকুমেন্টেশন
- `.env.example`: অব্যবহৃত পুরনো `S3_*` (কোডে কোথাও পড়া হয় না — grep দিয়ে যাচাই করা) সরিয়ে আসল `MEDIA_S3_*` + R2 নির্দেশনা (endpoint আকার, region `auto`, local fallback-এর সতর্কতা)।
- `.env.dokploy.example`: R2 অংশ যোগ — bucket/token কোথায় তৈরি হবে, কোন ঘরে কী বসবে। কোনো আসল মান নেই।

### 3. Round-trip যাচাই স্ক্রিপ্ট — `apps/api/scripts/verify-media-store.mjs`
- অ্যাপের **নিজের compiled MediaStore** ব্যবহার করে (আলাদা সাইনিং কোড নয়) `MEDIA_S3_*` env থেকে আসল bucket-এ পরীক্ষা চালায়: put → get+sha256 মিল → size (HEAD) → putStream → ranged getStream → **credential ছাড়া presigned GET fetch** → delete + gone-যাচাই। Probe ফাইল `_probe/` prefix-এ, শেষে নিজেই মুছে দেয়।
- আউটপুটে কোনো credential বা presigned URL ছাপা হয় না (শুধু host)।
- নিজের পরীক্ষায় আচরণ প্রমাণিত:
  - env ছাড়া চালালে: local-mode guard, **কিছুই লেখে না**, exit 2।
  - ভুয়া endpoint/credentials দিলে: প্রতিটি ধাপ আলাদা FAIL + কারণ, crash নয়, exit 1।
- লাইভে চালানোর উপায়: Redeploy-এর পর api কন্টেইনারের Terminal থেকে `node apps/api/scripts/verify-media-store.mjs` (dist কন্টেইনারেই থাকে)।

### 4. সিদ্ধান্ত সংশোধন (প্ল্যান খসড়া থেকে)
RB1-এর এক-bucket ধাপে default bucket হবে **`qosprey-media-private`** (খসড়ায় public লেখা ছিল)। যুক্তি: এই ধাপে ইনবক্সসহ সব মিডিয়া এক bucket-এ যায়; private bucket-এ কখনো পাবলিক অ্যাক্সেস চালু হবে না, আর RB2-তে শুধু পাবলিক-উদ্দেশ্যের key কপি হবে public bucket-এ — ফলে ইনবক্সের বাইট কোনোদিন public bucket ছোঁবে না। প্ল্যান ডক ও মালিকের চেকলিস্ট দুটোতেই সংশোধন লেখা আছে।

### 5. Migration ledger
RB1-এ **কোনো migration নেই**। RB2-এর (RM3) জন্য প্রস্তাবিত range `20261016000000+` আজ আবার যাচাই করা হয়েছে: জ্ঞাত সর্বোচ্চ হলো SN-এর `20261015100000`, main-এ `20261015030000`, GC-তে `20261013970000` — range-টি ফাঁকা আছে। RB2 শুরুর আগে আবার ledger-check হবে।

## যাচাই (গেট)

| পরীক্ষা | ফল |
|---------|-----|
| `pnpm install --frozen-lockfile` (নতুন worktree) | ✅ exit 0 |
| `prisma generate` + `pnpm --filter @repo/api... build` | ✅ সবুজ, `dist/inbox/media-store.js` তৈরি |
| Compose YAML parse + MEDIA key উপস্থিতি | ✅ |
| Verify script — env ছাড়া (guard) | ✅ exit 2, কোনো write নয় |
| Verify script — ভুয়া R2 env (graceful fail) | ✅ 6 ধাপ FAIL রিপোর্ট, exit 1, crash নয় |
| Media-সংশ্লিষ্ট jest বেসলাইন: `u6-scale`, `nextgen-media`, `social-pp2` | ✅ 3 suite / 31 test pass |

## এখনো বাকি (মালিকের হাতে — RB1-এর লাইভ অংশ)

চেকলিস্ট: `R2-RB1-Owner-Setup-One-Sitting-2026-10-15.md` (goals files)।

1. **D1 উত্তর:** qosprey.com-এর DNS Cloudflare-এ আছে কি না (custom domain-এর জন্য শর্ত; RB1-এর durability অংশে বাধা নয়)।
2. Cloudflare-এ 3 bucket + 2 bucket-scoped token তৈরি।
3. RB1 কমিটের জন্য **push নির্দেশ** → তারপর Dokploy-তে env বসানো + **Redeploy** (মালিক নিজে)।
4. কন্টেইনারে verify script চালিয়ে আউটপুট পাঠানো — **সেই মুহূর্তেই RB1 "live-proven" হবে; তার আগে নয়।**

## সৎ সীমাবদ্ধতা

- আসল R2 bucket-এ round-trip এখনো **হয়নি** — sandbox-এ কোনো bucket/credential নেই, এবং Muse মালিকের credential নেয় না। Script-এর সাইনিং পথটি MediaStore-এর বিদ্যমান unit-প্রমাণিত কোডই, কিন্তু R2-র আসল আচরণ (বিশেষত presigned ও streamed PUT) প্রথম প্রমাণ হবে ধাপ ৪-এ।
- RB1 চালু হলেও মিডিয়া তখনো API-proxy দিয়েই পরিবেশিত হবে; CDN গতি ও দুই-bucket বিভাজন RB2/RB4/RB5-এর কাজ।
