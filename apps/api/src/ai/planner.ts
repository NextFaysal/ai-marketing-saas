export interface PlannedToolCall { tool: string; args: Record<string, unknown> }

export const TOOL_CATALOG = [
  { name: "get_analytics_overview", description: "Revenue, orders, ad spend, ROAS/MER/CPA and profit for a date range. Args: from, to (YYYY-MM-DD)." },
  { name: "get_campaign_performance", description: "Campaign table with spend, clicks, conversions, CPA, ROAS. Args: from, to, limit." },
  { name: "get_attribution_report", description: "Revenue by channel/campaign under an attribution model. Args: model (LAST_TOUCH|FIRST_TOUCH|LAST_NON_DIRECT|LINEAR)." },
  { name: "list_products", description: "Products with price, cost and margin. Args: search, limit." },
  { name: "get_orders_attention", description: "Orders needing follow-up: old pending/on-hold and failed orders. No args." },
  { name: "get_anomalies", description: "Detected anomalies in recent daily metrics. Args: days." },
  { name: "get_business_knowledge", description: "The business profile, policies and FAQ knowledge. No args." },
] as const;

export const ALLOWED_TOOLS = TOOL_CATALOG.map((t) => t.name) as readonly string[];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Sanitize planner output: unknown tools are dropped, args are whitelisted
 *  per tool, dates validated, limits capped. This is the prompt-injection
 *  boundary: even if a model (or injected content) asks for something else,
 *  only these read-only calls with these args can ever run. */
export function sanitizePlan(raw: unknown): PlannedToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: PlannedToolCall[] = [];
  for (const item of raw.slice(0, 3)) {
    const tool = (item as any)?.tool;
    if (typeof tool !== "string" || !ALLOWED_TOOLS.includes(tool)) continue;
    const argsIn = ((item as any)?.args ?? {}) as Record<string, unknown>;
    const args: Record<string, unknown> = {};
    const dateArg = (k: string) => {
      const v = argsIn[k];
      if (typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v))) args[k] = v;
    };
    switch (tool) {
      case "get_analytics_overview":
      case "get_campaign_performance":
        dateArg("from"); dateArg("to");
        if (tool === "get_campaign_performance") {
          const limit = Number(argsIn.limit ?? 10);
          args.limit = Number.isFinite(limit) ? Math.min(25, Math.max(1, Math.floor(limit))) : 10;
        }
        break;
      case "get_attribution_report": {
        const m = String(argsIn.model ?? "LAST_TOUCH");
        args.model = ["LAST_TOUCH", "FIRST_TOUCH", "LAST_NON_DIRECT", "LINEAR"].includes(m) ? m : "LAST_TOUCH";
        break;
      }
      case "list_products": {
        if (typeof argsIn.search === "string") args.search = argsIn.search.slice(0, 100);
        const limit = Number(argsIn.limit ?? 10);
        args.limit = Number.isFinite(limit) ? Math.min(25, Math.max(1, Math.floor(limit))) : 10;
        break;
      }
      case "get_anomalies": {
        const days = Number(argsIn.days ?? 14);
        args.days = Number.isFinite(days) ? Math.min(60, Math.max(3, Math.floor(days))) : 14;
        break;
      }
      default:
        break; // tools with no args
    }
    out.push({ tool, args });
  }
  return out;
}

function has(text: string, words: string[]): boolean {
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w));
}

/**
 * Deterministic keyword planner used by the dev-template provider, and as
 * a fallback when a real LLM's plan cannot be parsed. Bengali + English.
 * It can only ever select read-only tools from the catalog.
 */
export function keywordPlan(message: string): PlannedToolCall[] {
  const calls: PlannedToolCall[] = [];
  if (has(message, ["ক্যাম্পেইন", "campaign", "বিজ্ঞাপন", "ad performance", "কোন বিজ্ঞাপন"])) {
    calls.push({ tool: "get_campaign_performance", args: { limit: 10 } });
  }
  if (has(message, ["লাভ", "profit", "মার্জিন", "margin", "contribution"])) {
    calls.push({ tool: "get_analytics_overview", args: {} });
  }
  if (has(message, ["বিক্রি", "sales", "revenue", "আয়", "পারফরম্যান্স", "performance", "গতকাল", "yesterday", "আজ", "today", "সপ্তাহ", "week", "মাস", "month", "কেমন চলছে", "overview", "সারসংক্ষেপ", "summary", "রিপোর্ট", "report"])) {
    if (!calls.some((c) => c.tool === "get_analytics_overview")) calls.push({ tool: "get_analytics_overview", args: {} });
  }
  if (has(message, ["প্রোডাক্ট", "product", "পণ্য", "বেস্ট সেলার", "best seller", "সবচেয়ে বেশি বিক্রি"])) {
    calls.push({ tool: "list_products", args: { limit: 10 } });
  }
  if (has(message, ["ফলো-আপ", "follow-up", "follow up", "পেন্ডিং অর্ডার", "অর্ডার বাকি", "attention", "খেয়াল"])) {
    calls.push({ tool: "get_orders_attention", args: {} });
  }
  if (has(message, ["সমস্যা", "anomal", "অস্বাভাবিক", "কমে গেছে", "drop", "spike", "হঠাৎ"])) {
    calls.push({ tool: "get_anomalies", args: { days: 14 } });
  }
  if (has(message, ["attribution", "অ্যাট্রিবিউশন", "কোন চ্যানেল", "channel", "চ্যানেল"])) {
    calls.push({ tool: "get_attribution_report", args: { model: "LAST_TOUCH" } });
  }
  if (has(message, ["পলিসি", "policy", "শিপিং", "shipping", "রিফান্ড", "refund", "ব্যবসার তথ্য", "business info", "faq"])) {
    calls.push({ tool: "get_business_knowledge", args: {} });
  }
  return sanitizePlan(calls);
}

/** Detect Bengali script so answers follow the user's language. */
export function detectLanguage(text: string): "bn" | "en" {
  return /[\u0980-\u09FF]/.test(text) ? "bn" : "en";
}
