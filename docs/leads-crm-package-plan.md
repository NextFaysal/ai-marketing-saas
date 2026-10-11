# Leads & CRM — বাকি কাজের প্যাকেজ পরিকল্পনা

**অনুমোদন:** মালিক, ২০২৬-১০-১১ ("Leads & CRM-এর বাকি পুরো প্যাকেজটাই পরিকল্পনা করে শুরু করো")
**ভিত্তি:** ২০২৬-১০-১১-এর code audit (crm/customers module, Lead schema, endpoint তালিকা নিজে ঘেঁটে যাচাই করা)।
অন্য track-গুলোর milestone নম্বরের সাথে সংঘর্ষ এড়াতে এই প্যাকেজের নিজস্ব নম্বর: **C1–C6**।

## ইতিমধ্যে যা আছে (audit-প্রমাণিত — আবার বানানো হবে না)
- Lead CRUD, stage pipeline (new → contacted → qualified → proposal → won/lost), Kanban drag-and-drop (M51)
- Source: manual / whatsapp / messenger / woocommerce / website / facebook_lead_ads; Meta Lead Ads webhook ingestion (externalId দিয়ে idempotent)
- Duplicate detection + merge (ফোনের শেষ ১০ ডিজিট; activities/conversations/tags সরে যায়; source লুকানো, delete নয়)
- Lead → Customer convert, owner assign, tags, valueMinor, notes + LeadActivity timeline, nextFollowUpAt field
- Customer 360 + customer merge (audited), RFM segments, COD risk (M50), Cohort/LTV/Churn (M56), inbox Command Profile

## প্যাকেজ (৩ batch)

### Batch 1
- **C1 — Follow-up Reminder System:** nextFollowUpAt আছে কিন্তু কেউ জানায় না। Automation job `lead_followup_sweep`: due (আজ) ও overdue lead খুঁজে lead owner-কে AgentNotification (unassigned হলে OWNER/ADMIN), প্রতিদিন lead-প্রতি সর্বোচ্চ একবার (dedupe — audit/স্মরণ রাখা চিহ্ন দিয়ে); Leads পেজে "আজকের ফলোআপ" বোর্ড (আজ due + overdue আলাদা), সেখান থেকে সরাসরি নতুন তারিখ বসানো/সম্পন্ন করা (বিদ্যমান PATCH দিয়েই)। Job-টি M57 worker/DLQ পথেই চলবে।
- **C2 — Lead Scoring:** M50-র ধাঁচে deterministic compute-on-read pure function: signals = stage অগ্রগতি, valueMinor band, activity সংখ্যা ও সাম্প্রতিকতা, lastContactedAt recency, linked customer/order থাকা, follow-up overdue (ঋণাত্মক)। Output: score 0–100 + band (hot/warm/cold) + হুবহু কারণের তালিকা; data কম হলে সেটা কারণেই বলা থাকবে। Surfaces: leads list badge, board card, lead detail; score দিয়ে sort করার option। কোনো schema change নয়।

### Batch 2
- **C3 — CSV Import/Export:** orders CSV import (M65)-এর প্যাটার্নে leads import: header mapping (name/phone/email/source/stage/tags/value), সারি-প্রতি error রিপোর্ট, ফোন দিয়ে নিজের org-এর মধ্যে dedupe (skip/update নীতি নথিভুক্ত), cap। Leads + customers CSV export (নিজের org-এর data-ই শুধু; custom fields থাকলে সেগুলোসহ)।
- **C4 — Custom Fields:** প্রতি org-তে lead/customer-এর জন্য field সংজ্ঞা (label, type: text/number/date/select, options), মান Lead/Customer-এর JSON column-এ (একটাই migration); server-side type validation; lead/customer detail-এ সম্পাদনা, list-এ select-field দিয়ে filter (যতটা যুক্তিসংগত), export-এ অন্তর্ভুক্ত।

### Batch 3
- **C5 — Lead Auto-Assignment:** org-level নিয়ম (একটা CRM setting): off | round_robin | least_open_leads; যোগ্য = সক্রিয় member যার leads access আছে (M72 permission catalog-এর সাথে সামঞ্জস্য); M68 working-hours/on-shift থাকলে তাকে অগ্রাধিকার/বাদ — inbox smart-assign-এর আচরণের সাথে মিলিয়ে নথিভুক্ত সিদ্ধান্ত। সব lead তৈরির পথে প্রযোজ্য (manual, webhook, import); manual owner বসালে সেটাই জেতে; প্রতিটি auto-assign audit-এ। Round-robin cursor setting-এই সংরক্ষিত।
- **C6 — Lead Funnel Report:** Analytics-এ CRM funnel: source অনুযায়ী — তৈরি lead, stage বণ্টন, won হার, মোট won value, lead→customer conversion; সময়কাল বেছে নেওয়া; সংজ্ঞাগুলো পেজে ও acceptance-এ স্পষ্ট (won = stage "won"; conversion = customerId যুক্ত lead)। শুধু আসল Lead row থেকে; কোনো অনুমান নয়।

## নিয়ম (সব batch-এ)
- Local commit only — GitHub push মালিকের স্পষ্ট নির্দেশ ছাড়া নয়।
- Surgical staging (সমান্তরাল track-এর কাজ ছোঁয়া যাবে না)।
- প্রতিটি item: build + full tests + acceptance doc (docs/crm-c<N>-acceptance.md) + live check যেখানে সম্ভব।
