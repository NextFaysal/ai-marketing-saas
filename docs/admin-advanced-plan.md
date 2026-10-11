# Admin Dashboard — বাকি কাজ ও Advanced Plan (AA1–AA7)

**প্রসঙ্গ:** মালিকের জিজ্ঞাসা (২০২৬-১০-১১): admin dashboard-এ কী কী কাজ বাকি, আর কোন advanced option যোগ করলে আরও powerful হবে। নিচের সবকিছু একই দিনের **read-only code audit** থেকে (apps/admin-এর ১৮টি page, /admin API-র পুরো surface, platform-config — ফাইল ধরে যাচাই)।

## Audit সারসংক্ষেপ — ভিত্তি শক্ত

Admin Console (M25–M28) + Admin Polish (AP1–AP4) সম্পূর্ণ: tenants/users/plans/billing/dunning/coupons, support tickets, growth (email campaigns, changelog, referral console), health/alerts, system (queues, DLQ replay, errors, DB growth, backup), security (TOTP+QR, view-as sessions+revoke, scoped API keys, login anomalies), usage + AI cost board, audit trail, global search, org 360/export/delete। **TODO/FIXME শূন্য; কোনো মৃত বোতাম নেই** — প্রতিটা page-এর call আসল endpoint-এ যায়।

**বাকি যা পাওয়া গেছে:** ৫টি config block-এ verify/test নেই (blind save), worker process-এর অবস্থা admin-এ অদৃশ্য, deploy-readiness (env আছে কিনা) দেখার জায়গা নেই, plan-এর limit কোডে hardcoded, নতুন Social feature-এর কোনো operator পর্দা নেই, আর কয়েকটা half-wired জিনিস (announcement scheduling API আছে UI নেই; org notes backend আছে UI নেই; audit search অগভীর)।

## প্যাকেজ (৩ batch)

### Batch 1 — যন্ত্রণার জায়গা ও অন্ধকার দিক
- **AA1 Deploy Readiness Checklist:** `/system`-এ বাধ্যতামূলক env উপস্থিতির checklist (শুধু আছে/নেই — মান কখনো নয়): APP_DOMAIN, ENCRYPTION_KEY, INTERNAL_JOB_SECRET, JWT_SECRET, POSTGRES_PASSWORD + ঐচ্ছিক-কিন্তু-গুরুত্বপূর্ণ (REDIS_URL, API_PUBLIC_URL, WORKER_HEALTH_PORT)। মালিক যে সমস্যায় সত্যিই পড়েছিলেন (INTERNAL_JOB_SECRET ছাড়া redeploy ব্যর্থ) — এরপর থেকে deploy-এর আগেই admin-এ লাল দেখা যাবে। [Audit C1, size S]
- **AA2 Worker ও Queue Live অবস্থা:** worker-এর `/health` (4100) + BullMQ queue গভীরতা (waiting/active/failed) `/system`-এর queues board-এ — worker মরে গেলে এখন admin শুধু উপসর্গ দেখে; এরপর সরাসরি দেখা যাবে কোন process/queue আটকে আছে। [C2, M]
- **AA3 বাকি Config Verify:** Meta app, SSLCommerz, bKash, TikTok, Google — পাঁচটি block-এ test বোতাম (+ যেখানে সস্তা, verify-before-save)। ভুল secret আর tenant-এর ব্যর্থ payment/OAuth দিয়ে আবিষ্কার করতে হবে না। [C3, M]

### Batch 2 — নিয়ন্ত্রণ ও দৃশ্যমানতা
- **AA4 Per-Plan Limit Editor:** plan-এর limit (aiDaily/broadcast/seats per tier) code constant থেকে admin setting-এ — দাম যেমন admin-এ বদলানো যায়, limit-ও তেমনি, deploy ছাড়াই। Resolution order অপরিবর্তিত (override → plan setting → পূর্বের default)। [C4, S–M]
- **AA5 Social + Ads Operator Boards:** cross-tenant — token-মরা/error social account, failed/stuck social post; আর ad account-এর stale/error/platform-disabled অবস্থা **error-এর লেখাসহ** (health-এর broken list এখন কারণটাই দেখায় না — D5 fix-সহ)। [C5+C10+D5, M]
- **AA6 Console Completion Pack:** announcement scheduling UI (D1), org notes UI (D3), audit search গভীর করা — org/date/entity filter + export (C8/D4), dunning তালিকায় কোন org-এ reminder job-ই নেই তা দেখানো (C9), tenant-প্রতি storage (MB/GB) usage column (C6), webhook event explorer — provider/org ধরে failed delivery খোঁজা ও দেখা (C7)।

### Batch 3 — Advanced (ঐচ্ছিক স্তর)
- **AA7:** plan-ভিত্তিক feature-flag default (C11 — FREE tier-এ কোনো feature বন্ধ করতে প্রতিটা org ছুঁতে হবে না), AI usage drill-down — org × feature breakdown + export (C12), আলাদা Admins roster page (tier/TOTP/last-login এক জায়গায়, C13)।

## নিয়ম
আগের প্যাকেজগুলোর মতোই: item ধরে build + tests + acceptance doc, local commit only, GitHub push মালিকের স্পষ্ট নির্দেশ ছাড়া নয়। কোনো secret-এর মান admin-এ কখনো দেখানো হবে না — শুধু উপস্থিতি/যাচাইয়ের ফল।
