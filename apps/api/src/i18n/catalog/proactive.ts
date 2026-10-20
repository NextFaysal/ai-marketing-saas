/**
 * MB6 (ML16) — proactive catalog namespace.
 *
 * Pure data: the ProactiveService (apps/api/src/ai/proactive.service.ts)
 * daily-briefing / opportunity-radar strings, moved here from the
 * MB5 call-site bn/en pairs (MB5 exception 1 follow-up). Every entry
 * is byte-identical to the pre-MB6 call-site text in both locales —
 * Bengali digits and typographic quotes that were baked into the
 * static text stay baked in; only the interpolated values became
 * `{{param}}` (D-MB4-10). The anomaly *body* is detector data
 * (a.message) and is deliberately NOT catalogued — only its title.
 *
 * monthPacing is two keys (Ahead/Behind) because the original line
 * switched both the sign prefix and the direction word on the
 * delta's sign; each key is the complete line for that case, so the
 * rendered output is unchanged.
 */
import type { CatalogNamespace } from "./types";

export const proactiveCatalog: CatalogNamespace = {
  // ---- AP6 opportunity radar (computeOpportunityRadar) ----
  "proactive.radarLowStock": {
    bn: "“{{name}}” স্টক মাত্র {{stockQuantity}}টি, অথচ গত ১৪ দিনে {{qty}}টি বিক্রি হয়েছে — রিস্টকের কথা ভাবুন।",
    en: "\"{{name}}\" has only {{stockQuantity}} left in stock, yet {{qty}} were sold in the last 14 days — consider restocking.",
  },
  "proactive.radarCourierRateDropped": {
    bn: "{{provider}} কুরিয়ারের ডেলিভারি রেট কমেছে: আগের সপ্তাহে {{prior}}% → এই সপ্তাহে {{recent}}%।",
    en: "{{provider}} courier delivery rate dropped: {{prior}}% the week before → {{recent}}% this week.",
  },
  "proactive.radarUnansweredBacklog": {
    bn: "ইনবক্সে {{openCount}}টি প্রশ্নের উত্তর এখনো বাকি — সবচেয়ে বেশি আসা প্রশ্ন: “{{question}}” ({{questionCount}}বার)।",
    en: "{{openCount}} inbox questions are still unanswered — the most frequent: \"{{question}}\" ({{questionCount}} times).",
  },
  // ---- Month pacing (monthPacingLine) ----
  "proactive.monthPacingAhead": {
    bn: "মাসের গতি: এই মাসে এখন পর্যন্ত আয় আগের মাসের একই সময়ের তুলনায় +{{delta}}% (এগিয়ে)।",
    en: "Month pacing: revenue so far this month is +{{delta}}% compared with the same span last month (ahead).",
  },
  "proactive.monthPacingBehind": {
    bn: "মাসের গতি: এই মাসে এখন পর্যন্ত আয় আগের মাসের একই সময়ের তুলনায় {{delta}}% (পিছিয়ে)।",
    en: "Month pacing: revenue so far this month is {{delta}}% compared with the same span last month (behind).",
  },
  // ---- EC11 commerce line (commerceBriefingLine) ----
  "proactive.commerceStatus": {
    bn: "কমার্স অবস্থা: গত ২৪ ঘণ্টায় ব্যর্থ সিঙ্ক {{failedSyncs24h}}টি, খোলা কনফ্লিক্ট {{openConflicts}}টি, স্টক-বিচ্যুত লিস্টিং {{stockDivergedCount}}টি, ৪৮ ঘণ্টার বেশি পুরনো অপূর্ণ অর্ডার {{unfulfilledOlderThan48h}}টি। বিস্তারিত: Commerce Hub / Sync Center।",
    en: "Commerce status: in the last 24 hours {{failedSyncs24h}} failed syncs, {{openConflicts}} open conflicts, {{stockDivergedCount}} stock-diverged listings, {{unfulfilledOlderThan48h}} unfulfilled orders older than 48 hours. Details: Commerce Hub / Sync Center.",
  },
  // ---- Daily briefing body lines (runDailyBriefing) ----
  "proactive.briefingSummary": {
    bn: "গতকালের সারসংক্ষেপ ({{date}}): অর্ডার {{orders}}টি, Revenue {{revenue}}, Ad Spend {{adSpend}}, Contribution Profit {{contributionProfit}} (Margin {{marginPercent}}%)।",
    en: "Yesterday's summary ({{date}}): {{orders}} orders, Revenue {{revenue}}, Ad Spend {{adSpend}}, Contribution Profit {{contributionProfit}} (Margin {{marginPercent}}%).",
  },
  "proactive.briefingNoData": {
    bn: "গতকাল ({{date}}) কোনো অর্ডার রেকর্ড হয়নি। এটি একটি সৎ “তথ্য নেই” ব্রিফিং — কোনো সংখ্যা বানানো হয়নি। অর্ডার/সিঙ্ক ঠিকমতো হচ্ছে কিনা দেখে নিন।",
    en: "No orders were recorded yesterday ({{date}}). This is an honest \"no data\" briefing — no numbers were invented. Please check that orders/sync are working properly.",
  },
  "proactive.briefingAnomalies": {
    bn: "অস্বাভাবিকতা ধরা পড়েছে {{count}}টি: {{messages}}",
    en: "Anomalies detected: {{count}}: {{messages}}",
  },
  "proactive.briefingCogsNote": {
    bn: "দ্রষ্টব্য: COGS coverage {{cogsCoveragePercent}}% — কিছু পণ্যের কস্ট বাকি, তাই লাভের হিসাব আংশিক।",
    en: "Note: COGS coverage {{cogsCoveragePercent}}% — some products are missing costs, so the profit figures are partial.",
  },
  "proactive.opportunitiesHeader": {
    bn: "সুযোগ ও ঝুঁকি:",
    en: "Opportunities & risks:",
  },
  // ---- Notification titles (runDailyBriefing) ----
  "proactive.briefingTitle": {
    bn: "দৈনিক ব্রিফিং — {{date}}",
    en: "Daily briefing — {{date}}",
  },
  "proactive.anomalyTitle": {
    bn: "অস্বাভাবিকতা সতর্কতা — {{type}}",
    en: "Anomaly Alert — {{type}}",
  },
};
