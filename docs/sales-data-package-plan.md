# বিক্রি ও ডেটা (Sales & Data) — বাকি কাজের প্যাকেজ পরিকল্পনা

**অনুমোদন:** মালিক, ২০২৬-১০-১১ ("বিক্রি ও ডেটার বাকি পুরো প্যাকেজটাই পরিকল্পনা করে শুরু করো")
**ভিত্তি:** ২০২৬-১০-১১-এর code audit (orders/products/analytics/courier module, schema নিজে ঘেঁটে যাচাই)।
অন্য track-গুলোর নম্বরের সাথে সংঘর্ষ এড়াতে এই প্যাকেজের নিজস্ব নম্বর: **S1–S6**।

## ইতিমধ্যে যা আছে (audit-প্রমাণিত — আবার বানানো হবে না)
- Products CRUD + variant (API) + তারিখভিত্তিক cost history + CSV import + Woo/Shopify sync
- Orders: Woo/Shopify sync+webhook, manual form, CSV import, chat-order — সব `upsertOrder` পথে; list/stats/detail, COD risk
- Courier: Pathao/RedX/Steadfast booking + bulk + label/invoice PDF + live quote (M52/M53), status sync, tracking widget
- Tracking/Attribution (tracker.js, 4 model), Analytics overview + Profit (COGS coverage সতর্কতাসহ), Cohort/LTV/Churn (M56)
- AI daily report, ReportShare branded links (M59), org data export/retention

## প্যাকেজ (৩ batch)

### Batch 1
- **S1 — Inventory Movement:** সবচেয়ে বড় ফাঁক — order হলে stock কমে না। নতুন `StockMovement` ledger (product/variant, delta, reason: order_placed / order_cancelled / order_returned / manual_adjustment / sync_correction, order ref, actor, balanceAfter)। নিয়ম: stockQuantity null = untracked (কোনো movement নয়); order প্রথম তৈরি হলে item-এর product মিললে decrement — re-sync/update-এ দ্বিতীয়বার নয় (movement-এর অস্তিত্বই idempotency প্রমাণ); cancel/return transition-এ restore; variant থাকলে variant-এর stock। Manual adjustment endpoint + Products পেজে movement ইতিহাস। Low-stock: product-ভিত্তিক threshold (না থাকলে org default) পেরিয়ে নিচে নামলে AgentNotification — C1-এর মতো dedupe (দিনে একবার/product)। Woo/Shopify sync-এর stock overwrite-এর সাথে সম্পর্ক নথিভুক্ত সিদ্ধান্তে (sync আসা মানই কর্তৃত্ব, movement-এ sync_correction)।
- **S2 — Order Actions:** orders API-তে PATCH-ই নেই। `PATCH orders/:id`: status transition (বৈধ তালিকা + অগ্রগতি নিয়ম ডকুমেন্টে), refund রেকর্ড (refundedMinor বাড়ে, মোটের বেশি নয়; পুরো refund হলে status refunded), internal note। প্রতিটি action audit + আসল order.* event (EventsService REAL import — M65-এর শিক্ষা)। Status বদল S1-এর restore নিয়ম ডাকে। Web: order detail-এ action প্যানেল।

### Batch 2
- **S3 — Orders CSV Export:** C3-এর export প্যাটার্নে; বর্তমান filter (status/cod/date) সম্মান করে; টাকায় money; merged/অন্য org অসম্ভব।
- **S4 — Abandoned Cart (tenant store):** প্রথমে audit — tracker আসলে কোন event ধরে (add_to_cart / checkout_started / purchase)। শুধু আসল data-র ওপর: checkout শুরু করে নির্দিষ্ট সময়ে (default 24h) purchase না করা session-এর তালিকা (product/value/email-phone যদি event-এ ধরা থাকে)। যোগাযোগের তথ্য থাকলে বিদ্যমান messaging দিয়ে recovery message পাঠানোর সুযোগ (opt-in, audit-সহ); না থাকলে শুধু তালিকা — অনুমান করে কিছু বানানো নয়।

### Batch 3
- **S5 — Courier Performance Report:** CourierShipment row থেকেই: provider অনুযায়ী মোট shipment, delivered %, returned %, গড় delivery দিন (booking→delivered), সময়কাল বেছে নেওয়া; decided না হলে rate null (বানানো 0 নয়)। Analytics/Orders পেজে panel।
- **S6 — Product Sales Report + Variant UI:** OrderItem থেকে product/category অনুযায়ী quantity, revenue, return প্রভাবিত বিক্রি (সময়কালসহ); Products পেজে variant manager (তৈরি/সম্পাদনা: নাম, SKU, দাম, stock) — বিদ্যমান variant API-র ওপর।

## নিয়ম (সব batch-এ)
- Local commit only — GitHub push মালিকের স্পষ্ট নির্দেশ ছাড়া নয়। Push-এর আগে remote fetch করে দেখা বাধ্যতামূলক (মালিক নিজেও সরাসরি push করেন)।
- Surgical staging; প্রতিটি item: build + full tests + acceptance doc (docs/sales-s<N>-acceptance.md) + সম্ভব হলে live check।
- টাকার হিসাব BigInt minor-এই; কোনো ভুয়া metric নয় (denominator 0 হলে null)।
