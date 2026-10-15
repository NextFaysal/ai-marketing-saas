export interface PlannedToolCall { tool: string; args: Record<string, unknown> }

/**
 * AP3 tool registry — the single source for the tool universe:
 * the LLM planner prompt, sanitizePlan's allow-list, keywordPlan
 * and the per-tool RBAC map all derive from this one table.
 * `roles` (when present) restricts a tool to those org roles;
 * ChatService enforces it at execution time — a restricted tool
 * planned for another role returns a visible "restricted" result,
 * never data.
 */
export interface ToolDef {
  name: string;
  module: string;
  description: string;
  roles?: readonly string[];
}

export const TOOL_CATALOG: readonly ToolDef[] = [
  { name: "get_analytics_overview", module: "analytics", description: "Revenue, orders, ad spend, ROAS/MER/CPA and profit for a date range. Args: from, to (YYYY-MM-DD)." },
  { name: "get_campaign_performance", module: "ads", description: "Campaign table with spend, clicks, conversions, CPA, ROAS. Args: from, to, limit." },
  { name: "get_attribution_report", module: "ads", description: "Revenue by channel/campaign under an attribution model. Args: model (LAST_TOUCH|FIRST_TOUCH|LAST_NON_DIRECT|LINEAR)." },
  { name: "list_products", module: "catalog", description: "Products with price, cost and margin. Args: search, limit." },
  { name: "get_orders_attention", module: "orders", description: "Orders needing follow-up: old pending/on-hold and failed orders. No args." },
  { name: "get_anomalies", module: "analytics", description: "Detected anomalies in recent daily metrics. Args: days." },
  { name: "get_business_knowledge", module: "knowledge", description: "The business profile, Command Center facts (delivery charges/times, payment numbers, contact, hours), policies and FAQ knowledge. Args: query (the user's question, used to rank the most relevant FAQ documents)." },
  { name: "get_customer_segments", module: "customers", description: "RFM customer segments with customer counts and revenue share. No args." },
  { name: "get_inventory_health", module: "catalog", description: "Stock health: out-of-stock, low-stock and high-stock products from real stock quantities. No args." },
  { name: "get_courier_performance", module: "courier", description: "Per-courier delivery and return rates from real shipments. No args." },
  { name: "get_product_profit", module: "analytics", description: "Per-product revenue, COGS, gross profit and contribution after revenue-share-allocated ad spend. Args: from, to, limit." },
  { name: "compare_periods", module: "analytics", description: "Overview metrics for a period side by side with the previous period of the same length, with percentage deltas. Args: from, to." },
  { name: "get_competitor_intelligence", module: "competitors", description: "Competitor ads, winning ad creatives, price differences, and live stock-out opportunity alerts. Args: competitorId (optional)." },
  { name: "get_order_detail", module: "orders", description: "One order in full: status, items, totals, payment, courier/shipment state. Args: query (order number or id)." },
  { name: "get_customer_360", module: "customers", description: "One customer in full: contact, order count, lifetime value, last order, linked lead stage. Args: query (phone, name or email)." },
  { name: "get_crm_pipeline", module: "crm", description: "Lead pipeline by stage with counts, total value per stage and overdue follow-ups. No args." },
  { name: "get_inbox_performance", module: "inbox", description: "Inbox last 30 days: conversations by status/channel, unassigned count, and the top unanswered customer questions (themes). No args." },
  { name: "get_social_performance", module: "social", description: "Social posts last 30 days by status, published/failed counts and the latest failure reason. No args." },
  { name: "get_ad_account_health", module: "ads", description: "Ad accounts with platform status buckets; lists accounts that are not active. No args.", roles: ["OWNER", "ADMIN", "MARKETING_MANAGER"] },
  { name: "get_usage_summary", module: "billing", description: "AI usage for the last 30 days: calls and tokens by feature and provider, plus today's count. No args.", roles: ["OWNER", "ADMIN"] },
  { name: "get_team_performance", module: "team", description: "Team now and last 30 days: agent presence (online/busy/away), open conversations per assignee, closed counts. No args.", roles: ["OWNER", "ADMIN", "MARKETING_MANAGER"] },
  { name: "get_automation_health", module: "automations", description: "Automation runs last 7 days by status and kind, with the latest error details. No args." },
  { name: "get_courier_rollup", module: "courier", description: "Courier rollup last 30 days per provider: shipments, delivered, returned, delivery rate, COD collected, and shipments stuck over 72 hours. No args." },
  { name: "get_sales_forecast", module: "analytics", description: "Deterministic sales forecast for the next N days from real daily order revenue: labelled method, confidence band, thin-data refusal. Args: days (7-30), scenarioGrowthPct (-50..100, optional what-if). " },
];

export const ALLOWED_TOOLS = TOOL_CATALOG.map((t) => t.name) as readonly string[];

/** AP3: tool → allowed roles (absent = every org role). */
export const TOOL_ROLES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  TOOL_CATALOG.filter((t) => t.roles).map((t) => [t.name, t.roles as readonly string[]]),
);

/**
 * EC11 proposal tools — WRITE proposal tools in the same registry
 * shape as TOOL_CATALOG. They are deliberately NOT in TOOL_CATALOG /
 * ALLOWED_TOOLS because the read-only planner must never execute
 * writes — proposal creation goes through ProposalsService and
 * execution only via human approval.
 */
export const PROPOSAL_TOOL_CATALOG: readonly ToolDef[] = [
  { name: "propose_price_change", module: "commerce", description: "Propose changing a product's price. Creates an AIActionProposal only; nothing changes until a human approves. Args: productId, newPrice (decimal string).", roles: ["OWNER", "ADMIN", "MARKETING_MANAGER"] },
  { name: "propose_stock_adjust", module: "commerce", description: "Propose adjusting a product's stock quantity. Creates an AIActionProposal only; nothing changes until a human approves. Args: productId, newQuantity OR delta.", roles: ["OWNER", "ADMIN", "MARKETING_MANAGER"] },
  { name: "propose_listing_publish", module: "commerce", description: "Propose publishing a store listing. Creates an AIActionProposal only; nothing changes until a human approves. Args: listingId.", roles: ["OWNER", "ADMIN", "MARKETING_MANAGER"] },
  { name: "propose_listing_unpublish", module: "commerce", description: "Propose unpublishing a store listing. Creates an AIActionProposal only; nothing changes until a human approves. Args: listingId.", roles: ["OWNER", "ADMIN", "MARKETING_MANAGER"] },
  { name: "propose_create_discount", module: "commerce", description: "Propose creating a discount. Creates an AIActionProposal only; nothing changes until a human approves. Creates a LOCAL discount on approval (no store push). Args: code, kind (percent|fixed|free_shipping), value.", roles: ["OWNER", "ADMIN", "MARKETING_MANAGER"] },
  { name: "propose_product_copy", module: "commerce", description: "Propose new product copy. Generate product description + SEO copy from the product's real data with the org LLM; stored on the proposal; approval applies it. Args: productId.", roles: ["OWNER", "ADMIN", "MARKETING_MANAGER"] },
];

export const PROPOSAL_TOOL_ROLES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  PROPOSAL_TOOL_CATALOG.filter((t) => t.roles).map((t) => [t.name, t.roles as readonly string[]]),
);


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
      case "compare_periods":
      case "get_product_profit":
        dateArg("from"); dateArg("to");
        if (tool === "get_campaign_performance" || tool === "get_product_profit") {
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
      case "get_order_detail":
      case "get_customer_360": {
        if (typeof argsIn.query === "string") args.query = argsIn.query.slice(0, 100);
        break;
      }
      case "get_sales_forecast": {
        const days = Number(argsIn.days ?? 14);
        args.days = Number.isFinite(days) ? Math.min(30, Math.max(7, Math.floor(days))) : 14;
        const pct = Number(argsIn.scenarioGrowthPct);
        if (Number.isFinite(pct)) args.scenarioGrowthPct = Math.min(100, Math.max(-50, Math.floor(pct)));
        break;
      }
      case "get_business_knowledge": {
        // Milestone 77: only a bounded query string survives.
        if (typeof argsIn.query === "string") args.query = argsIn.query.slice(0, 200);
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
  // Milestone 46 deep-analysis tools are matched FIRST: their phrases
  // are more specific than the generic sales/profit/product rules below
  // (e.g. "কোন পণ্যে লাভ" must reach product profit, not just overview).
  if (has(message, ["তুলনা", "compare", "গত মাসের সাথে", "আগের মাসের সাথে", "আগের সময়ের সাথে", "previous period", "vs previous"])) {
    calls.push({ tool: "compare_periods", args: {} });
  }
  // AP3 tool-universe rules (specific phrases first).
  if (has(message, ["অর্ডার #", "order #", "অর্ডারের বিবরণ", "order detail", "অর্ডার ডিটেইল", "এই অর্ডারটি", "এই অর্ডারটা"])) {
    const digits = message.match(/\d{3,}/)?.[0];
    calls.push({ tool: "get_order_detail", args: { query: digits ?? message.slice(0, 100) } });
  }
  if (has(message, ["কাস্টমার সম্পর্কে", "customer 360", "কাস্টমারের ইতিহাস", "customer history", "ক্রেতার বিবরণ", "কাস্টমারের সব তথ্য"])) {
    const phone = message.match(/\d{6,}/)?.[0];
    calls.push({ tool: "get_customer_360", args: { query: phone ?? message.slice(0, 100) } });
  }
  if (has(message, ["লিড পাইপলাইন", "lead pipeline", "crm", "পাইপলাইন", "লিডের অবস্থা", "কতগুলো লিড", "lead status"])) {
    calls.push({ tool: "get_crm_pipeline", args: {} });
  }
  if (has(message, ["ইনবক্সের পারফরম্যান্স", "inbox performance", "উত্তর হয়নি", "unanswered", "কোন প্রশ্নের উত্তর পাইনি", "ইনবক্সের অবস্থা"])) {
    calls.push({ tool: "get_inbox_performance", args: {} });
  }
  if (has(message, ["সোশ্যাল পোস্ট", "social post", "পোস্টের অবস্থা", "social performance", "কতগুলো পোস্ট"])) {
    calls.push({ tool: "get_social_performance", args: {} });
  }
  if (has(message, ["অ্যাকাউন্টের স্বাস্থ্য", "ad account health", "অ্যাকাউন্ট ঠিক আছে", "account health", "বিজ্ঞাপন অ্যাকাউন্টের অবস্থা"])) {
    calls.push({ tool: "get_ad_account_health", args: {} });
  }
  if (has(message, ["ai ব্যবহার", "ai usage", "টোকেন", "token usage", "ai খরচ", "কত ai"])) {
    calls.push({ tool: "get_usage_summary", args: {} });
  }
  if (has(message, ["টিমের পারফরম্যান্স", "team performance", "এজেন্টদের কাজ", "agent performance", "কে কত কাজ"])) {
    calls.push({ tool: "get_team_performance", args: {} });
  }
  if (has(message, ["অটোমেশনের অবস্থা", "automation health", "অটোমেশন চলছে", "automation status"])) {
    calls.push({ tool: "get_automation_health", args: {} });
  }
  if (has(message, ["আটকে থাকা পার্সেল", "stuck", "cod সংগ্রহ", "ক্যাশ অন ডেলিভারি সংগ্রহ", "কুরিয়ার রোলআপ", "courier rollup"])) {
    calls.push({ tool: "get_courier_rollup", args: {} });
  }
  if (has(message, ["পূর্বাভাস", "forecast", "আগামী", "ভবিষ্যৎ বিক্রি", "আনুমানিক বিক্রি", "projected", "projection", "কেমন হতে পারে"])) {
    calls.push({ tool: "get_sales_forecast", args: { days: 14 } });
  }
  if (has(message, ["সেগমেন্ট", "segment", "rfm", "কাস্টমার গ্রুপ", "customer group", "সেরা কাস্টমার", "best customers", "হারানো কাস্টমার", "lost customers", "loyal customer", "অনুগত কাস্টমার"])) {
    calls.push({ tool: "get_customer_segments", args: {} });
  }
  if (has(message, ["স্টক", "stock", "ইনভেন্টরি", "inventory", "মজুদ", "out of stock"])) {
    calls.push({ tool: "get_inventory_health", args: {} });
  }
  if (has(message, ["কুরিয়ার", "courier", "ডেলিভারি রেট", "delivery rate", "রিটার্ন রেট", "return rate", "পার্সেল ডেলিভারি"])) {
    calls.push({ tool: "get_courier_performance", args: {} });
  }
  if (has(message, ["পণ্যের লাভ", "product profit", "কোন পণ্যে লাভ", "কোন পণ্যে লোকসান", "per-product", "লাভজনক পণ্য", "profitable product", "কোন পণ্যে সবচেয়ে বেশি লাভ"])) {
    calls.push({ tool: "get_product_profit", args: { limit: 10 } });
  }
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
  if (has(message, ["পলিসি", "policy", "শিপিং", "shipping", "রিফান্ড", "refund", "ব্যবসার তথ্য", "business info", "faq", "ডেলিভারি", "delivery", "বিকাশ", "bkash", "ওয়ারেন্টি", "warranty", "রিটার্ন", "ঠিকানা", "address", "খোলা", "বন্ধ", "সময়", "hours"])) {
    // Milestone 77: the raw question ranks the FAQ matches.
    calls.push({ tool: "get_business_knowledge", args: { query: message.slice(0, 200) } });
  }
  if (has(message, ["প্রতিযোগী", "কম্পিটিটর", "competitor", "rival", "তাদের দাম", "প্রতিযোগীর বিজ্ঞাপন", "winning ad", "স্টক শেষ", "কাউন্টার", "spy", "ad library"])) {
    calls.push({ tool: "get_competitor_intelligence", args: {} });
  }
  return sanitizePlan(calls);
}


/** Detect Bengali script so answers follow the user's language. */
export function detectLanguage(text: string): "bn" | "en" {
  return /[\u0980-\u09FF]/.test(text) ? "bn" : "en";
}
