/**
 * MB4 (ML12) — documents catalog namespace (W-3 owned).
 *
 * Pure data: labels that appear in GENERATED documents —
 * finance report files (CSV/XLSX sections, headers, summaries,
 * coverage notes), the scheduled profit / messaging-summary
 * files, the reports-module export (CSV headers, print-HTML and
 * email parts) and the print-center job messages.
 *
 * Document locale (D-MB4-6): the org's dashboardLocale;
 * shopper-facing documents use the storefront locale. Courier
 * PDFs stay EN/ASCII (WinAnsi writer) — see courier/pdf.ts; no
 * BN PDF strings live here because none can render there.
 *
 * bn text is faithful to the pre-MB4 originals (the finance
 * reports were BN-only); en text is the translation. Where the
 * original was already English (report-export metric labels),
 * the en text is the original and bn is the translation,
 * exposed as `*Bn` companions next to the existing EN map.
 */
export const DOCUMENTS_CATALOG = {
  // ---- finance report type labels (REPORT_LABELS_BN companions) ----
  "finance.reportLabel.discounts": { bn: "ছাড়ের রিপোর্ট", en: "Discount Report" },
  "finance.reportLabel.refunds": { bn: "রিফান্ডের রিপোর্ট", en: "Refund Report" },
  "finance.reportLabel.payment_sales": { bn: "পেমেন্ট অনুযায়ী বিক্রি", en: "Sales by Payment Method" },
  "finance.reportLabel.category_sales": { bn: "শ্রেণি অনুযায়ী বিক্রি", en: "Sales by Category" },
  "finance.reportLabel.shipping_cost": { bn: "ডেলিভারি খরচের রিপোর্ট", en: "Delivery Cost Report" },
  "finance.reportLabel.profit": { bn: "লাভের রিপোর্ট", en: "Profit Report" },
  "finance.reportLabel.messaging_summary": { bn: "মেসেজিং সারসংক্ষেপ", en: "Messaging Summary" },
  "finance.reportFileNote": {
    bn: "{{label}} · সময়সীমা: {{from}} থেকে {{to}} (ঢাকা)",
    en: "{{label}} · Period: {{from}} to {{to}} (Dhaka)",
  },
  "finance.profitFileNote": {
    bn: "লাভের রিপোর্ট · সময়সীমা: {{from}} থেকে {{to}} (ঢাকা) · ভিত্তি: পণ্যের লাইন-মোট (ছাড়ের আগে)",
    en: "Profit Report · Period: {{from}} to {{to}} (Dhaka) · Basis: product line totals (before discount)",
  },
  "finance.messagingFileNote": {
    bn: "মেসেজিং সারসংক্ষেপ · সময়সীমা: {{from}} থেকে {{to}} (ঢাকা) · ভিত্তি: Broadcast-এর sentAt + MessageDelivery/MessageLinkClick রেকর্ড",
    en: "Messaging Summary · Period: {{from}} to {{to}} (Dhaka) · Basis: Broadcast sentAt + MessageDelivery/MessageLinkClick records",
  },
  "finance.messagingNullStageNote": {
    bn: "যে ধাপ কোনো Channel রিপোর্ট করতে পারে না, সেই ঘর খালি (null) — কখনো বানানো ০ নয়।",
    en: "A stage a channel cannot report stays empty (null) — never an invented 0.",
  },
  // ---- shared section titles / headers ----
  "finance.section.summary": { bn: "সারসংক্ষেপ", en: "Summary" },
  "finance.section.coverage": { bn: "কভারেজ", en: "Coverage" },
  "finance.headers.descriptionAmount": { bn: "বিবরণ|পরিমাণ", en: "Description|Amount" },
  "finance.total": { bn: "মোট", en: "Total" },
  // ---- discounts report ----
  "finance.section.dailyDiscounts": { bn: "দৈনিক ছাড়", en: "Daily Discounts" },
  "finance.section.discountsBySource": { bn: "উৎস অনুযায়ী ছাড়", en: "Discounts by Source" },
  "finance.headers.dateOrderDiscounts": { bn: "তারিখ|অর্ডার|অর্ডার-স্তরের ছাড় (টাকা)|স্ট্যাম্প-ভিত্তিক ছাড় (টাকা)", en: "Date|Orders|Order-level Discount (BDT)|Stamp-based Discount (BDT)" },
  "finance.headers.discountSource": { bn: "ধরন|কোড/নাম|প্রয়োগ|ছাড় (টাকা)", en: "Type|Code/Name|Applications|Discount (BDT)" },
  "finance.row.totalCountableOrders": { bn: "মোট গণনাযোগ্য অর্ডার", en: "Total countable orders" },
  "finance.row.orderLevelDiscountTotal": { bn: "অর্ডার-স্তরের মোট ছাড় (টাকা)", en: "Order-level total discount (BDT)" },
  "finance.row.stampDiscountTotal": { bn: "স্ট্যাম্প-ভিত্তিক মোট ছাড় (টাকা)", en: "Stamp-based total discount (BDT)" },
  "finance.row.stampedOrders": { bn: "স্ট্যাম্পযুক্ত অর্ডার", en: "Stamped orders" },
  "finance.summary.discounts": {
    bn: "অর্ডার: {{orders}}টি · অর্ডার-স্তরের ছাড়: {{orderDiscount}} · স্ট্যাম্প-ভিত্তিক ছাড়: {{stampedDiscount}} ({{stampedOrders}}টি অর্ডারে স্ট্যাম্প আছে)",
    en: "Orders: {{orders}} · Order-level discount: {{orderDiscount}} · Stamp-based discount: {{stampedDiscount}} (stamps on {{stampedOrders}} orders)",
  },
  "finance.note.discountsCoverage": {
    bn: "স্ট্যাম্প-ভিত্তিক উৎস বিশ্লেষণ কেবল সেই অর্ডারগুলোতে আছে যেগুলো ছাড়-স্ট্যাম্প (GB7) চালু হওয়ার পর দেওয়া হয়েছে; অর্ডার-স্তরের মোট ছাড় সময়সীমার সব গণনাযোগ্য অর্ডার কভার করে। দুটি স্তর আলাদা রাখা হয়েছে — একীভূত ভুয়া ইতিহাস বানানো হয়নি।",
    en: "Stamp-based source analysis exists only for orders placed after the discount stamp (GB7) was enabled; the order-level discount total covers every countable order in the period. The two levels are kept separate — no merged, invented history.",
  },
  // ---- refunds report ----
  "finance.section.returnsByStatus": { bn: "স্ট্যাটাস অনুযায়ী রিটার্ন", en: "Returns by Status" },
  "finance.section.byResolution": { bn: "সমাধান অনুযায়ী (সম্পন্ন)", en: "By Resolution (Completed)" },
  "finance.headers.statusCount": { bn: "স্ট্যাটাস|সংখ্যা", en: "Status|Count" },
  "finance.headers.resolution": { bn: "সমাধান|সংখ্যা|পরিমাণ (টাকা)|পরিমাণ-জানা সংখ্যা", en: "Resolution|Count|Amount (BDT)|Count with Known Amount" },
  "finance.row.totalReturnRequests": { bn: "মোট রিটার্ন অনুরোধ", en: "Total return requests" },
  "finance.row.fullRefundsCompleted": { bn: "পূর্ণ রিফান্ড (সম্পন্ন)", en: "Full refunds (completed)" },
  "finance.row.partialRefundsCompleted": { bn: "আংশিক রিফান্ড (সম্পন্ন)", en: "Partial refunds (completed)" },
  "finance.row.amountUnknownRefunds": { bn: "পরিমাণ অজানা (সম্পন্ন রিফান্ড)", en: "Amount unknown (completed refunds)" },
  "finance.row.ordersWithRefunds": { bn: "রিফান্ডযুক্ত অর্ডার (অর্ডার-স্তর)", en: "Orders with refunds (order level)" },
  "finance.row.recordedRefundTotal": { bn: "অর্ডারে রেকর্ডকৃত সঞ্চিত রিফান্ড (টাকা)", en: "Accumulated refund recorded on orders (BDT)" },
  "finance.summary.refunds": {
    bn: "রিটার্ন অনুরোধ: {{total}}টি · পূর্ণ রিফান্ড: {{full}}টি · আংশিক: {{partial}}টি",
    en: "Return requests: {{total}} · Full refunds: {{full}} · Partial: {{partial}}",
  },
  "finance.note.refundsCoverage": {
    bn: "রিটার্ন-ভিত্তিক হিসাব ReturnRequest রেকর্ড থেকে (তৈরির তারিখ অনুযায়ী)। অর্ডার-স্তরের হিসাবটি একই সময়ে হালনাগাদ হওয়া অর্ডারের সঞ্চিত refundedMinor — রিটার্নে রেকর্ড করা রিফান্ডের সঙ্গে এটি আংশিকভাবে মিলে যায় (overlap), দুটি যোগ করবেন না। স্টোরে রিফান্ড push সফল হয়েছে কিনা ReturnRequest-এ আলাদা করে রেকর্ড থাকে না — এখানে দাবি করা হয়নি।",
    en: "The return-based figures come from ReturnRequest records (by creation date). The order-level figure is the accumulated refundedMinor of orders updated in the same period — it partially overlaps the refunds recorded on returns, so do not add the two. Whether a refund push to the store succeeded is not recorded separately on ReturnRequest — it is not claimed here.",
  },
  // ---- payment sales report ----
  "finance.section.ordersByPaymentMethod": { bn: "পেমেন্ট পদ্ধতি অনুযায়ী অর্ডার", en: "Orders by Payment Method" },
  "finance.section.verifiedOnlinePayments": { bn: "যাচাইকৃত অনলাইন পেমেন্ট (verified_paid)", en: "Verified Online Payments (verified_paid)" },
  "finance.headers.methodOrdersTotal": { bn: "পদ্ধতি|অর্ডার|মোট (টাকা)", en: "Method|Orders|Total (BDT)" },
  "finance.headers.providerSourceCountTotal": { bn: "প্রোভাইডার|উৎস|সংখ্যা|মোট (টাকা)", en: "Provider|Source|Count|Total (BDT)" },
  "finance.summary.paymentSales": {
    bn: "অর্ডার: {{orders}}টি · মোট: {{total}} · যাচাইকৃত অনলাইন: {{verifiedCount}}টি · {{verifiedTotal}}",
    en: "Orders: {{orders}} · Total: {{total}} · Verified online: {{verifiedCount}} · {{verifiedTotal}}",
  },
  "finance.note.paymentSalesCoverage": {
    bn: "অর্ডার-ভিত্তিক অংশটি Order.paymentMethod অনুযায়ী — পদ্ধতি ফাঁকা থাকলে COD অর্ডার 'cod' আর বাকিগুলো 'unknown' (অন্যান্য/অজানা) বাকেটে যায়, অনুমান করা হয় না। যাচাইকৃত অংশটি শুধু গেটওয়ে-নিশ্চিত verified_paid লেনদেন থেকে (updatedAt অনুযায়ী) — দুটি অংশের যোগফল মেলানোর চেষ্টা করবেন না, প্রশ্নই আলাদা।",
    en: "The order-based part follows Order.paymentMethod — when the method is empty, COD orders fall into the 'cod' bucket and the rest into 'unknown' (other/unknown); nothing is guessed. The verified part comes only from gateway-confirmed verified_paid transactions (by updatedAt) — do not try to reconcile the two parts; they answer different questions.",
  },
  // ---- category sales report ----
  "finance.section.salesByCategory": { bn: "শ্রেণি অনুযায়ী বিক্রি", en: "Sales by Category" },
  "finance.headers.categorySales": { bn: "শ্রেণি|অর্ডার|পরিমাণ|আয় (টাকা)", en: "Category|Orders|Quantity|Revenue (BDT)" },
  "finance.uncategorized": { bn: "শ্রেণিবিহীন", en: "Uncategorized" },
  "finance.summary.categorySales": {
    bn: "বিক্রীত অর্ডার: {{orders}}টি · মোট আয়: {{revenue}} · শ্রেণি: {{categories}}টি",
    en: "Orders sold: {{orders}} · Total revenue: {{revenue}} · Categories: {{categories}}",
  },
  "finance.note.categorySalesCoverage": {
    bn: "শ্রেণি = পণ্যের বর্তমান শ্রেণি (categoryId → Category, না থাকলে পণ্যের পুরনো ফ্রি-টেক্সট category)। সতর্কতা: কোনো পণ্যের শ্রেণি বদলালে তার পুরনো বিক্রির ইতিহাসও নতুন শ্রেণিতে চলে যায় — অর্ডারের সময়ের শ্রেণির snapshot সংরক্ষিত থাকে না। আয় = আইটেমের লাইন-মোট (OrderItem.totalMinor) যা অর্ডার দেওয়ার সময় stamp হয়েছিল।",
    en: "Category = the product's current category (categoryId → Category, otherwise the product's legacy free-text category). Warning: changing a product's category moves its past sales history into the new category too — no order-time category snapshot is kept. Revenue = the item line total (OrderItem.totalMinor) stamped when the order was placed.",
  },
  // ---- shipping cost report ----
  "finance.section.deliveryCostByCourier": { bn: "কুরিয়ার অনুযায়ী ডেলিভারি খরচ", en: "Delivery Cost by Courier" },
  "finance.headers.shippingCost": { bn: "কুরিয়ার|শিপমেন্ট|অর্ডার|আদায়কৃত চার্জ (টাকা)|প্রকৃত খরচ (টাকা)|প্রকৃত-খরচযুক্ত শিপমেন্ট", en: "Courier|Shipments|Orders|Charged (BDT)|Actual Cost (BDT)|Shipments with Actual Cost" },
  "finance.row.ordersWithShipments": { bn: "শিপমেন্টযুক্ত অর্ডার", en: "Orders with shipments" },
  "finance.row.ordersWithActual": { bn: "প্রকৃত খরচ পাওয়া অর্ডার", en: "Orders with an actual cost" },
  "finance.row.actualCoveragePct": { bn: "প্রকৃত খরচের কভারেজ (%)", en: "Actual cost coverage (%)" },
  "finance.summary.shippingCost": {
    bn: "শিপমেন্ট: {{shipments}}টি · আদায়কৃত চার্জ: {{charged}} · প্রকৃত খরচ: {{actual}} (কভারেজ {{coverage}}%)",
    en: "Shipments: {{shipments}} · Charged: {{charged}} · Actual cost: {{actual}} (coverage {{coverage}}%)",
  },
  "finance.noRecord": { bn: "রেকর্ড নেই", en: "No record" },
  "finance.notCalculatedCostUnknown": { bn: "হিসাব হয়নি (খরচ অজানা)", en: "Not calculated (cost unknown)" },
  "finance.note.shippingCoverage": {
    bn: "আদায়কৃত চার্জ = Order.shippingMinor, অর্ডারটি তার প্রথম (সবচেয়ে পুরনো) শিপমেন্টের কুরিয়ারে attributed। প্রকৃত খরচ = ON7/GB5 precedence: প্রথমে reconciliation sheet-এর sheetChargeMinor, না থাকলে বুকিংয়ের সময় কুরিয়ারের ফেরত দেওয়া chargeMinor। কোনো শিপমেন্টেই প্রকৃত খরচ না থাকলে actualMinor null (শূন্য বানানো হয়নি)।",
    en: "Charged = Order.shippingMinor, attributed to the courier of the order's first (oldest) shipment. Actual cost = ON7/GB5 precedence: first the reconciliation sheet's sheetChargeMinor, otherwise the chargeMinor the courier returned at booking. When no shipment has an actual cost, actualMinor is null (zero is never invented).",
  },
  // ---- scheduled profit file (scheduled-reports.buildProfitFile) ----
  "finance.profit.totalOrders": { bn: "মোট অর্ডার", en: "Total orders" },
  "finance.profit.totalSales": { bn: "মোট বিক্রি (টাকা)", en: "Total sales (BDT)" },
  "finance.profit.productCost": { bn: "পণ্যের খরচ (টাকা)", en: "Product cost (BDT)" },
  "finance.profit.costCoverage": { bn: "খরচ-কভারেজ (%)", en: "Cost coverage (%)" },
  "finance.profit.grossMargin": { bn: "মোট মার্জিন (টাকা)", en: "Gross margin (BDT)" },
  "finance.profit.periodExpenses": { bn: "সময়সীমার খরচ (টাকা)", en: "Period expenses (BDT)" },
  "finance.profit.gatewayFees": { bn: "গেটওয়ে ফি (টাকা)", en: "Gateway fees (BDT)" },
  "finance.profit.estimatedNet": { bn: "আনুমানিক নিট লাভ (টাকা)", en: "Estimated net profit (BDT)" },
  "finance.section.byProduct": { bn: "পণ্য অনুযায়ী", en: "By Product" },
  "finance.headers.productProfit": { bn: "পণ্য|বিক্রীত পরিমাণ|আয় (টাকা)|খরচ (টাকা)|মার্জিন (টাকা)", en: "Product|Quantity Sold|Revenue (BDT)|Cost (BDT)|Margin (BDT)" },
  "finance.summary.profitHead": { bn: "লাভের রিপোর্ট · {{from}} — {{to}}", en: "Profit Report · {{from}} — {{to}}" },
  "finance.summary.profitLine": {
    bn: "অর্ডার: {{orders}}টি · বিক্রি: {{revenue}} · মোট মার্জিন: {{margin}} (কভারেজ {{coverage}}%)",
    en: "Orders: {{orders}} · Sales: {{revenue}} · Gross margin: {{margin}} (coverage {{coverage}}%)",
  },
  "finance.summary.profitNetLine": { bn: "আনুমানিক নিট লাভ: {{net}}", en: "Estimated net profit: {{net}}" },
  // ---- scheduled messaging-summary file (scheduled-reports.buildMessagingFile) ----
  "finance.messaging.broadcastsSentInPeriod": { bn: "এই সময়ে পাঠানো Broadcast", en: "Broadcasts sent in this period" },
  "finance.messaging.totalSent": { bn: "মোট Sent (Delivery রেকর্ড থেকে)", en: "Total Sent (from Delivery records)" },
  "finance.messaging.totalFailed": { bn: "মোট Failed", en: "Total Failed" },
  "finance.messaging.totalSkipped": { bn: "মোট Skipped", en: "Total Skipped" },
  "finance.messaging.associatedOrders": { bn: "সম্পর্কিত অর্ডার (Association — কারণের প্রমাণ নয়)", en: "Associated orders (Association — not proof of causation)" },
  "finance.messaging.associatedOrderTotal": { bn: "সম্পর্কিত অর্ডারের মোট (টাকা)", en: "Associated order total (BDT)" },
  "finance.section.funnelByChannel": { bn: "Channel অনুযায়ী Funnel", en: "Funnel by Channel" },
  "finance.headers.funnelByChannel": { bn: "Channel|Broadcast|Sent|Failed|Skipped|Delivered|Read|Opened|Clicked (প্রাপক)|মোট Click", en: "Channel|Broadcasts|Sent|Failed|Skipped|Delivered|Read|Opened|Clicked (recipients)|Total Clicks" },
  "finance.section.byBroadcast": { bn: "Broadcast অনুযায়ী", en: "By Broadcast" },
  "finance.headers.byBroadcast": { bn: "Broadcast|Channel|Status|Sent|Failed|Skipped|Delivered|Read|Opened|Clicked (প্রাপক)|সম্পর্কিত অর্ডার|সম্পর্কিত মোট (টাকা)", en: "Broadcast|Channel|Status|Sent|Failed|Skipped|Delivered|Read|Opened|Clicked (recipients)|Associated Orders|Associated Total (BDT)" },
  "finance.summary.messagingHead": { bn: "মেসেজিং সারসংক্ষেপ · {{from}} — {{to}}", en: "Messaging Summary · {{from}} — {{to}}" },
  "finance.summary.messagingLine": {
    bn: "Broadcast: {{broadcasts}}টি · Sent: {{sent}} · Failed: {{failed}} · Skipped: {{skipped}}",
    en: "Broadcasts: {{broadcasts}} · Sent: {{sent}} · Failed: {{failed}} · Skipped: {{skipped}}",
  },
  "finance.summary.messagingAssocLine": {
    bn: "সম্পর্কিত অর্ডার (Association): {{orders}}টি · {{total}}",
    en: "Associated orders (Association): {{orders}} · {{total}}",
  },
  "finance.associationLabel": {
    bn: "সম্পর্ক (association) — প্রাপক কাস্টমারদের পাঠানোর পর ৭ দিনের অর্ডার; Broadcast-টি যে এই অর্ডারের কারণ, তার প্রমাণ নয়। Touchpoint/AttributionCredit-এর সঙ্গে Messaging Delivery-র কোনো সৎ join নেই, তাই Attribution দাবি করা হয় না।",
    en: "Association — orders by recipient customers in the 7 days after the send; not proof that the broadcast caused those orders. There is no honest join between Messaging Delivery and Touchpoint/AttributionCredit, so no attribution is claimed.",
  },
  "finance.associationNote": {
    bn: "অর্ডারের সংখ্যা: {{label}}",
    en: "Order count: {{label}}",
  },
  "finance.associationMethod": {
    bn: "প্রাপক কাস্টমারদের পাঠানোর পর ৭ দিনের অর্ডার (সম্পর্ক, কারণের প্রমাণ নয়)",
    en: "Orders by recipient customers in the 7 days after the send (association, not proof of causation)",
  },
  // ---- GL double-entry export (finance.service glExportFile / glRows) ----
  "finance.gl.sectionTitle": { bn: "ডাবল-এন্ট্রি সারি", en: "Double-Entry Rows" },
  "finance.gl.noteGeneric": {
    bn: "সাধারণ ডাবল-এন্ট্রি CSV — Tally/QuickBooks-এ import-এর আগে আপনার হিসাবরক্ষকের সঙ্গে মিলিয়ে নিন",
    en: "Generic double-entry CSV — reconcile with your accountant before importing into Tally/QuickBooks",
  },
  "finance.gl.noteMinorUnits": {
    bn: "পরিমাণ পয়সায় (minor units)। এটি কোনো নির্দিষ্ট accounting software-এর native ফাইল নয় — একটি সাধারণ double-entry সারণি।",
    en: "Amounts are in paisa (minor units). This is not any specific accounting software's native file — it is a generic double-entry table.",
  },
  "finance.gl.balanceLine": {
    bn: "মোট ডেবিট: {{debit}} · মোট ক্রেডিট: {{credit}} · ব্যালান্স: {{balanced}}",
    en: "Total debit: {{debit}} · Total credit: {{credit}} · Balance: {{balanced}}",
  },
  "finance.gl.balanced": { bn: "মিলেছে", en: "Balanced" },
  "finance.gl.notBalanced": { bn: "মেলেনি", en: "Not balanced" },
  "finance.gl.skippedRefundsNote": {
    bn: "পরিমাণ রেকর্ড না থাকায় {{count}}টি রিফান্ড এই এক্সপোর্টে আসেনি।",
    en: "{{count}} refunds are not in this export because no amount was recorded for them.",
  },
  "finance.gl.summary": { bn: "ডাবল-এন্ট্রি সারি: {{count}}টি", en: "Double-entry rows: {{count}}" },
  "finance.gl.memoOrder": { bn: "অর্ডার {{ref}}", en: "Order {{ref}}" },
  "finance.gl.memoGatewayFee": { bn: "গেটওয়ে ফি · {{provider}} {{ref}}", en: "Gateway fee · {{provider}} {{ref}}" },
  "finance.gl.memoExpense": { bn: "খরচ · {{category}}", en: "Expense · {{category}}" },
  "finance.gl.memoRefund": { bn: "রিফান্ড · অর্ডার {{ref}}", en: "Refund · Order {{ref}}" },
  // ---- reports module export (report-export.service) ----
  "reports.dimension.date": { bn: "তারিখ", en: "Date" },
  "reports.dimension.platform": { bn: "প্ল্যাটফর্ম", en: "Platform" },
  "reports.dimension.campaign": { bn: "ক্যাম্পেইন", en: "Campaign" },
  "reports.total": { bn: "মোট", en: "TOTAL" },
  "reports.allAmountsBdt": { bn: "সব টাকার অঙ্ক BDT", en: "All amounts in BDT" },
  "reports.subjectPrefix": { bn: "রিপোর্ট", en: "Report" },
  "reports.printButton": { bn: "প্রিন্ট / PDF", en: "Print / PDF" },
  "reports.generatedAt": { bn: "তৈরি", en: "Generated" },
  "reports.dimensionLabel": { bn: "Dimension", en: "Dimension" },
  // ---- print center (orders/print-center.service) ----
  "print.templateMustBeString": { bn: "{{field}} লেখা (string) হতে হবে", en: "{{field}} must be a string" },
  "print.templateTooLong": { bn: "{{field}} সর্বোচ্চ {{max}} অক্ষর হতে পারবে", en: "{{field}} can be at most {{max}} characters" },
  "print.templateSettingsRequired": { bn: "টেমপ্লেট সেটিংস দরকার", en: "Template settings are required" },
  "print.logoUrlMustBeHttp": { bn: "লোগোর URL অবশ্যই http:// বা https:// দিয়ে শুরু হতে হবে", en: "The logo URL must start with http:// or https://" },
  "print.unknownType": { bn: "অজানা প্রিন্ট ধরন \"{{type}}\" — সঠিক ধরন: {{types}}", en: "Unknown print type \"{{type}}\" — valid types: {{types}}" },
  "print.pickOrders": { bn: "১–১০০টি অর্ডার বেছে নিন", en: "Select between 1 and 100 orders" },
  "print.ordersNotFoundInOrg": { bn: "এই অর্ডারগুলো এই সংস্থায় পাওয়া যায়নি: {{ids}}", en: "These orders were not found in this organization: {{ids}}" },
  "print.noCourierBooking": { bn: "কুরিয়ার বুকিং নেই", en: "No courier booking" },
  "print.noTrackingCodeYet": { bn: "শিপমেন্টে এখনো ট্র্যাকিং কোড আসেনি", en: "The shipment has no tracking code yet" },
  "print.noLabelPrintable": { bn: "কোনো অর্ডারেরই লেবেল ছাপানো যায়নি — কোনোটিরই ব্যবহারযোগ্য কুরিয়ার শিপমেন্ট নেই", en: "No order's label could be printed — none has a usable courier shipment" },
  "print.jobNotFound": { bn: "প্রিন্ট জব পাওয়া যায়নি", en: "Print job not found" },
} as const;

export type DocumentsCatalogKey = keyof typeof DOCUMENTS_CATALOG;

/**
 * report-export metric labels — the existing EN map stays the
 * en source; these are the bn companions (D-MB4-8 *En-companion
 * pattern, mirrored). Keys must match METRIC_LABELS in
 * reports/report-export.service.ts.
 */
export const REPORT_METRIC_LABELS_BN: Record<string, string> = {
  orders: "অর্ডার", revenue: "আয়", refunds: "রিফান্ড", cogs: "পণ্যের খরচ (COGS)", adSpend: "বিজ্ঞাপনের খরচ", profit: "লাভ", aov: "গড় অর্ডার মূল্য (AOV)",
  spend: "খরচ", impressions: "ইমপ্রেশন", clicks: "ক্লিক", conversions: "প্ল্যাটফর্ম কনভার্সন",
  conversionValue: "কনভার্সন মূল্য (প্ল্যাটফর্ম)", ctr: "CTR %", cpm: "CPM", cpa: "CPA",
};

/** Coordinator wiring alias (catalog/index.ts convention). */
export const documentsCatalog = DOCUMENTS_CATALOG;
