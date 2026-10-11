/**
 * Deterministic follow-up suggestions for the AI Assistant (M45).
 *
 * Derived ONLY from which tools actually ran for the last answer plus a
 * fixed generic set — never from invented context. If a real LLM is
 * configured it MAY refine suggestions in a future step, but this
 * deterministic path is the shipped, tested behaviour: it works with
 * the dev-template provider and never fabricates a question about data
 * the assistant cannot actually fetch (every suggestion maps back to a
 * read-only tool through the keyword planner).
 */
const BY_TOOL: Record<string, { bn: string[]; en: string[] }> = {
  get_analytics_overview: {
    bn: ["গত মাসের সাথে তুলনা করে দেখাও", "কোন ক্যাম্পেইনগুলো সবচেয়ে ভালো করছে?", "কোনো অস্বাভাবিক কিছু ঘটেছে কি?"],
    en: ["Compare this with the previous period", "Which campaigns are performing best?", "Has anything unusual happened?"],
  },
  get_campaign_performance: {
    bn: ["বিক্রি ও লাভের সারসংক্ষেপ দেখাও", "কোনো অস্বাভাবিক কিছু ঘটেছে কি?", "কোন চ্যানেল থেকে বিক্রি আসছে?"],
    en: ["Show the sales and profit overview", "Has anything unusual happened?", "Which channels are driving sales?"],
  },
  get_attribution_report: {
    bn: ["ক্যাম্পেইনগুলোর পারফরম্যান্স দেখাও", "বিক্রি ও লাভের সারসংক্ষেপ দেখাও"],
    en: ["Show campaign performance", "Show the sales and profit overview"],
  },
  list_products: {
    bn: ["কোন পণ্যে সবচেয়ে বেশি লাভ হয়?", "স্টকের অবস্থা কেমন? কোন প্রোডাক্টের স্টক কম?", "বিক্রি ও লাভের সারসংক্ষেপ দেখাও"],
    en: ["Which products have the best profit?", "How is the stock looking?", "Show the sales and profit overview"],
  },
  get_orders_attention: {
    bn: ["বিক্রি ও লাভের সারসংক্ষেপ দেখাও", "কুরিয়ারদের পারফরম্যান্স কেমন?", "কোনো অস্বাভাবিক কিছু ঘটেছে কি?"],
    en: ["Show the sales and profit overview", "How are the couriers performing?", "Has anything unusual happened?"],
  },
  get_anomalies: {
    bn: ["বিক্রি ও লাভের সারসংক্ষেপ দেখাও", "ক্যাম্পেইনগুলোর পারফরম্যান্স দেখাও", "গত মাসের সাথে তুলনা করে দেখাও"],
    en: ["Show the sales and profit overview", "Show campaign performance", "Compare this with the previous period"],
  },
  get_business_knowledge: {
    bn: ["বিক্রি ও লাভের সারসংক্ষেপ দেখাও", "কোন অর্ডারগুলোর ফলো-আপ দরকার?"],
    en: ["Show the sales and profit overview", "Which orders need follow-up?"],
  },
  get_customer_segments: {
    bn: ["কোন পণ্যে সবচেয়ে বেশি লাভ হয়?", "বিক্রি ও লাভের সারসংক্ষেপ দেখাও"],
    en: ["Which products have the best profit?", "Show the sales and profit overview"],
  },
  get_inventory_health: {
    bn: ["কোন পণ্যে সবচেয়ে বেশি লাভ হয়?", "প্রোডাক্টগুলোর দাম ও মার্জিন দেখাও"],
    en: ["Which products have the best profit?", "Show products with prices and margins"],
  },
  get_courier_performance: {
    bn: ["কোন অর্ডারগুলোর ফলো-আপ দরকার?", "বিক্রি ও লাভের সারসংক্ষেপ দেখাও"],
    en: ["Which orders need follow-up?", "Show the sales and profit overview"],
  },
  get_product_profit: {
    bn: ["স্টকের অবস্থা কেমন?", "ক্যাম্পেইনগুলোর পারফরম্যান্স দেখাও", "কাস্টমার সেগমেন্টগুলো দেখাও"],
    en: ["How is the stock looking?", "Show campaign performance", "Show the customer segments"],
  },
  compare_periods: {
    bn: ["কোন ক্যাম্পেইনগুলো সবচেয়ে ভালো করছে?", "কোনো অস্বাভাবিক কিছু ঘটেছে কি?"],
    en: ["Which campaigns are performing best?", "Has anything unusual happened?"],
  },
};

const GENERIC = {
  bn: ["গত ৭ দিনে বিক্রি কেমন ছিল?", "আমার সবচেয়ে ভালো ক্যাম্পেইন কোনগুলো?", "কোন অর্ডারগুলোর ফলো-আপ দরকার?"],
  en: ["How were sales in the last 7 days?", "Which are my best campaigns?", "Which orders need follow-up?"],
};

/**
 * Up to 3 follow-ups. Tools that ran (in execution order) contribute
 * first; the generic set tops up. Duplicates are dropped. When no tool
 * ran, only the generic set is offered.
 */
export function followUpSuggestions(toolsUsed: string[], language: "bn" | "en"): string[] {
  const out: string[] = [];
  const push = (s: string) => { if (!out.includes(s) && out.length < 3) out.push(s); };
  for (const tool of toolsUsed) {
    for (const s of BY_TOOL[tool]?.[language] ?? []) push(s);
    if (out.length >= 3) break;
  }
  if (out.length < 3) for (const s of GENERIC[language]) push(s);
  return out;
}
