# Next-Level Feature Plan — মালিকের তালিকা যাচাই করে সাজানো
**সূত্র:** Alex Amin-এর প্রস্তাবিত তালিকা (১১ অক্টোবর ২০২৬, রাত ১২:০১)  
**যাচাই পদ্ধতি:** প্রতিটি আইটেম আসল কোড + git log + চলমান কাজের সাথে মিলিয়ে দেখা হয়েছে — স্মৃতি থেকে নয়  
**সারসংক্ষেপ:** তালিকার ১৫টি আইটেমের মধ্যে **২টি ইতিমধ্যে হয়ে গেছে, ২টি এই মুহূর্তে চলমান কাজে আছে, ৩টি আংশিক আছে, ৮টি নতুন/বাকি** — বাকিগুলো প্রায় হুবহু আমাদের Post-launch Plan N2–N5-এই ছিল, অর্থাৎ দিক ঠিক আছে; নতুন সংযোজন মূলত একটি: **COD Fraud/Risk Score**।

---

## ক. AI ও Unified Inbox

| আইটেম | অবস্থা | প্রমাণ / মন্তব্য |
|---|---|---|
| AI Autopilot v2 (Strict Grounding) | ✅ **হয়ে গেছে** | Milestone 45 / Inbox U3 (commit `26ecece`): per-channel mode, verified fact pack ছাড়া LLM লিখতে পারে না, **Number Guard** — fact pack-এ নেই এমন সংখ্যা উত্তরে থাকলেই reject + audit, escalation gate (complaint/negative/human চাওয়া/high-value order/পরপর ২ বার না-বোঝা) → autopilot pause + agent-কে notify। Confidence কমের বাস্তব রূপটাই এই gate |
| COD Fraud / Return Risk Score | 🆕 **নতুন — হয়নি** | কোডে `riskScore` জাতীয় কিছুই নেই (grep-এ ০)। এই প্ল্যানের **এক নম্বর নতুন কাজ (M50)** |
| Kanban Pipeline View | 🟡 **আংশিক** | Leads পেজে stage অনুযায়ী column board আছে (6 CRM stage, stage বদলানো যায়)। বাকি: **drag-and-drop**, আর তাঁর বর্ণনার **Inbox/Order pipeline** (New Lead → Talking → Order Placed → Shipped → Completed) — সেটা conversation + order state মিলিয়ে বানাতে হবে (**M51**) |
| Telegram + Support Email channel | ✅ **হয়ে গেছে** | Milestone 46 / Inbox U4 (commit `1fe6f32`): Telegram bot + email lane দুটোই Unified Inbox-এ; TikTok partner pack-ও সাথে |

## খ. Marketing Automation

| আইটেম | অবস্থা | প্রমাণ / মন্তব্য |
|---|---|---|
| Visual Flow Builder (React Flow) | ⏳ **বাকি — engine তৈরি** | Workflow Engine v2 (wait/branch/run) চলছে, কিন্তু canvas নেই; React Flow install-ও হয়নি। Post-launch N2-তেই ছিল (**M54**) |
| AI Ad Creative Studio | ⏳ **বাকি** | Post-launch N4-তে লেখা। সুখবর: আসল LLM এখন live প্রমাণিত (Gemini, M46 যাচাই), তাই Studio এখন সত্যিকারের LLM দিয়ে বানানো যাবে (**M55**) |
| Cohort / LTV / Churn | ⏳ **বাকি** | Cohort table কোডে নেই। সতর্কতা: “Prediction” শুরুতে হবে **heuristic + labelled estimate** — আসল order history থেকে cohort + historical LTV আগে, churn risk হবে নিয়ম-ভিত্তিক score, ML মডেল বলে দাবি করা হবে না (**M56**) |

## গ. E-commerce ও Delivery Ops

| আইটেম | অবস্থা | প্রমাণ / মন্তব্য |
|---|---|---|
| Bulk Courier Booking + Label/Invoice PDF | ⏳ **বাকি** | Post-launch N2। একসাথে (**M53**): order বেছে bulk booking (প্রতিটির ফলাফল আলাদা করে — একটা fail হলে বাকিগুলো থামবে না), barcode-সহ shipping label PDF + invoice PDF |
| Courier Live Quotation | ⏳ **বাকি** | (**M52**) Pathao price plan + RedX charge calculator দিয়ে booking-এর আগেই চার্জ। **Steadfast-এর কোনো quote API নেই** — সেখানে সততার সাথে “booking-এর পরে জানা যাবে” দেখাবে, আন্দাজি সংখ্যা নয় |

## ঘ. High-Scale Architecture

| আইটেম | অবস্থা | প্রমাণ / মন্তব্য |
|---|---|---|
| BullMQ Dedicated Worker + DLQ | 🟡 **কাঠামো আছে, migration বাকি** | `apps/worker`-এ queue contract + Worker/QueueEvents কোড আছে, কিন্তু আসল job-গুলো এখনো API process-এর scheduler-এই চলে — তাই API এখনো ১ replica-তেই আটকে। Processors + DLQ + job স্থানান্তরই আসল কাজ (**M57**) |
| Redis Pub/Sub Realtime Scaling | 🔄 **এই মুহূর্তে চলছে** | Inbox U6 track-এর কাজ গাছে আছে (realtime service-এ Redis fan-out-এর পরিবর্তন + scale spec)। **আলাদা করে শুরু করা যাবে না — দ্বিগুণ কাজ হবে** |
| S3 / R2 Media Storage | 🔄 **এই মুহূর্তে চলছে** | একই U6 track-এ `media-store` abstraction তৈরি হচ্ছে। শেষ হলে provider হিসেবে S3/R2 বসবে সেখানেই |

## ঙ. Commercial ও Growth

| আইটেম | অবস্থা | প্রমাণ / মন্তব্য |
|---|---|---|
| Public Landing + Self-serve Pricing | 🟡 **আংশিক** | Public pricing page (`/pricing`, operator setting থেকে দাম) + SSLCommerz/bKash দিয়ে self-serve subscription কেনা — দুটোই আছে (M41/M36/M39)। বাকি: মূল domain-এ পূর্ণাঙ্গ marketing landing — feature showcase, ROI calculator (**M58**) |
| Agency White-Label | ⏳ **বাকি** | Post-launch N5। Custom domain + logo/branding, shareable report (M20) প্রথম surface (**M59**) |
| PWA Mobile Experience | ⏳ **বাকি** | Manifest-ই নেই। Installable inbox-first PWA + notification (**M60**) |

---

## প্রস্তাবিত ক্রম (M50 থেকে — 49 পর্যন্ত নম্বর inbox track ব্যবহার করছে)

- **Batch 1 — দৈনন্দিন মার্চেন্ট মূল্য:** M50 COD Fraud/Return Risk Score → M51 Kanban Pipeline (drag-and-drop + inbox/order stage view)
- **Batch 2 — Delivery Ops:** M52 Courier Live Quotation → M53 Bulk Booking + Label/Invoice PDF
- **Batch 3 — Automation রূপ:** M54 Visual Flow Builder (React Flow, engine v2-র ওপরে — engine বদলাবে না)
- **Batch 4 — AI ও Retention:** M55 AI Creative Studio → M56 Cohort + LTV/Churn (labelled heuristic)
- **Batch 5 — Scale:** M57 BullMQ Dedicated Worker + DLQ *(শর্ত: U6-এর Redis কাজ শেষ হওয়ার পর — না হলে একই জায়গায় সংঘর্ষ)*
- **Batch 6 — Growth:** M58 Public Landing → M59 Agency White-Label → M60 PWA

**নিয়ম (আগের মতোই):** প্রতিটি milestone-এ build + full test + live check + acceptance doc + **শুধু local commit**। GitHub push শুধু মালিক বললে। কোনো সংখ্যা/সফলতা প্ল্যাটফর্মের confirmation ছাড়া দাবি নয়।

## M50 — COD Fraud/Return Risk Score-এর নকশা (সংক্ষেপে)
- **কীসের ওপর score:** শুধু ওই org-এর নিজের আসল ডেটা — একই ফোন নম্বরের আগের order-গুলোর delivered / returned / cancelled অনুপাত, মোট order সংখ্যা, COD ইতিহাস; location signal শুধু order-এ থাকা আসল ঠিকানা/এলাকা থেকে
- **আকার:** Low / Medium / High + **কারণগুলো verbatim দেখাবে** (Admin health score-এর মতো — “শেষ ৫টি order-এর ৩টি returned” জাতীয়), যাতে মার্চেন্ট নিজে বিচার করতে পারে; score কখনো order আটকাবে না, শুধু সতর্ক করবে + অগ্রিম ডেলিভারি চার্জ চাওয়ার suggestion দেবে
- **কোথায় দেখাবে:** Order তালিকা + Order detail, chat থেকে order নেওয়ার সময় (bot/agent দুজনকেই warning), Customer 360
- **সততা:** নতুন customer (কোনো ইতিহাস নেই) = “তথ্য নেই”, Low নয়; cross-tenant ডেটা কখনোই মেশানো হবে না (tenant isolation)

---

## অগ্রগতি নোট — Batch 6 (Growth)

- **M58 Public Landing ✅ (2026-10-11):** `/` এখন পূর্ণাঙ্গ বাংলা marketing landing (hero, problem/solution, real-feature grid, how-it-works, CSS showcase frame — screenshot নয় বলে caption-সহ, ROI calculator সূত্র-সহ ও "আনুমানিক হিসাব" লেবেলে, FAQ)। দাম `/pricing`-এর একই operator-settings source (`GET /public/pricing`) থেকে; signup-closed/maintenance/announcement system-status সম্মান করা হয়; logged-in ব্যবহারকারীর জন্য আগের `/` → `/dashboard` আচরণ অক্ষুণ্ণ। বিস্তারিত: `docs/milestone-58-acceptance.md`।
- **M59 Agency White-Label ✅ (2026-10-11):** অডিটে পাওয়া গেছে M20-র tokenized shareable report আগেই ছিল — তার ওপরই branding। Organization-এ additive branding fields (migration `20261010590000`): brandName/logo (U6 MediaStore-এ bytes, magic-byte যাচাই)/primaryColor/customDomain (unique, hostname-validated)। Shell sidebar+topbar-এ org logo/নাম, primary colour design-system-এর `--brand-*` variable-এ; M53 label/invoice PDF-তে brand নাম + রঙের accent bar; public report payload-এ branding + আসল CourierShipment থেকে delivery summary, `/r/[token]` পেজে ব্র্যান্ডেড header। Custom domain = settings + DNS/Dokploy guidance মাত্র — UI-তেই সৎ নোট যে routing হোস্টিং প্যানেলের কাজ (codebase-এ hostname→org resolution নেই)। Live প্রমাণ: valid/revoked/expired/wrong-token সব অবস্থা। বিস্তারিত: `docs/milestone-59-acceptance.md`।
- **M60 PWA ✅ (2026-10-11):** Installable PWA — Next manifest route (start_url /dashboard, standalone, bn), dependency-free script দিয়ে তৈরি আসল PNG icon (192/512/maskable/apple — repo-তে source logo ছিল না), hand-rolled service worker (নতুন dependency নেওয়া হয়নি — Next 15-এ next-pwa ঝুঁকি এড়ানো হয়েছে): API কখনো cache নয়, static cache-first, page network-first + /offline fallback, auth page cache-এর বাইরে। Install button শুধু browser offer করলেই আসে, একবার dismiss করলে আর কখনো নয়। Dashboard-এ mobile bottom nav (ইনবক্স/অর্ডার/AI/আরও, শুধু ছোট স্ক্রিনে)। Live: manifest/sw/offline/icons সব সঠিক content-type-এ served। সৎ সীমা: real-device install pass sandbox থেকে সম্ভব নয় — কোনো Lighthouse স্কোর দাবি করা হয়নি। বিস্তারিত: `docs/milestone-60-acceptance.md`।

**🎉 Next-Level প্রোগ্রাম M50–M60 সম্পূর্ণ** (সব local commit; GitHub push মালিকের নির্দেশ ছাড়া হয়নি)।
