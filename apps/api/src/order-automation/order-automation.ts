/**
 * ON8 — Orders Automation Studio: pure vocabulary + validation
 * + condition evaluation + presets (no Nest / Prisma imports,
 * so the web builder payload helper mirrors these shapes and
 * specs can exercise them directly).
 *
 * ENGINE VERDICT (audited 2026-10-14 against
 * apps/api/src/workflows/workflows.service.ts): the existing
 * WorkflowsService CANNOT express the ON8 vocabulary —
 *  - its add_tag step validates target ∈ {lead, conversation}
 *    ONLY; there is no order-tag step;
 *  - its assign step is assign_conversation and needs a
 *    conversation context; there is no order-assign step;
 *  - there is NO order-hold step at all;
 *  - its only timer-ish triggers are schedule /
 *    inbox_unanswered / cart_abandoned sweeps with
 *    workflow-run dedupe semantics — there are no
 *    parcel-stuck-hours or due-overdue-days triggers.
 * Building the studio INTO WorkflowsService would mean
 * forking shared step semantics that inbox/lead automations
 * depend on. So ON8 is a DEDICATED engine that owns
 * ORDER-operation rules only; it does not re-implement
 * generic workflow notifications beyond the vocabulary
 * below, and WorkflowsService keeps owning lead/conversation
 * automations. Never two engines doing the same job.
 *
 * Trigger config lives in its OWN column (triggerConfig),
 * NOT inside conditions: conditions are the merchant's
 * if-filters (all must pass), triggerConfig parameterises
 * WHEN the trigger itself fires (which status, how many
 * hours/days). Mixing them would make "edit the filter"
 * silently change the trigger's meaning.
 *
 * HARD BOUNDARY: no action in this vocabulary may alter
 * order totals, payment state, or status. hold / assign /
 * add_tag are operational fields only.
 */

export const AUTOMATION_TRIGGERS = [
  "order_created",
  "status_changed",
  "parcel_stuck_hours",
  "due_overdue_days",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const CONDITION_KEYS = [
  "minTotalMinor",
  "sources",
  "isCod",
  "customerIsNew",
  "district",
  "riskBandAtLeast",
] as const;

export const ACTION_TYPES = [
  "add_tag",
  "assign",
  "hold",
  "notify_staff",
  "notify_customer",
] as const;
export type AutomationActionType = (typeof ACTION_TYPES)[number];

/** Fields each action type may carry (besides `type`). */
const ACTION_FIELDS: Record<string, string[]> = {
  add_tag: ["tag"],
  assign: ["userId"],
  hold: ["reason"],
  notify_staff: ["message"],
  notify_customer: ["message"],
};

const TRIGGER_CONFIG_KEYS: Record<string, string[]> = {
  order_created: [],
  status_changed: ["toStatus"],
  parcel_stuck_hours: ["hours"],
  due_overdue_days: ["days"],
};

export const RISK_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function positiveInt(v: unknown): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Validate a rule payload (create or the merged update).
 * Returns a Bengali error string naming the bad key, or null
 * when valid. Unknown trigger / condition / action /
 * triggerConfig keys are all refused here — a typo'd key must
 * never become a rule that silently never fires.
 */
export function validateRuleInput(input: any): string | null {
  if (!isPlainObject(input)) return "নিয়মের তথ্য একটি object হতে হবে";
  const name = String(input.name ?? "").trim();
  if (name.length < 1 || name.length > 120) return "নিয়মের নাম (name) ১–১২০ অক্ষরের হতে হবে";
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(String(input.trigger))) {
    return `অজানা trigger: "${String(input.trigger)}" — সঠিক trigger: ${AUTOMATION_TRIGGERS.join(", ")}`;
  }
  const trigger = String(input.trigger);

  // ---- triggerConfig ----
  const cfg = input.triggerConfig ?? null;
  if (cfg !== null) {
    if (!isPlainObject(cfg)) return "triggerConfig একটি object হতে হবে";
    const allowed = TRIGGER_CONFIG_KEYS[trigger];
    for (const key of Object.keys(cfg)) {
      if (!allowed.includes(key)) {
        return `"${trigger}" trigger-এ অজানা triggerConfig key: "${key}" — সঠিক key: ${allowed.join(", ") || "(কোনোটিই নয়)"}`;
      }
    }
  }
  if (trigger === "status_changed") {
    const to = cfg?.toStatus;
    if (typeof to !== "string" || !to.trim()) {
      return `status_changed trigger-এর জন্য triggerConfig.toStatus আবশ্যক`;
    }
  }
  if (trigger === "parcel_stuck_hours") {
    const h = positiveInt(cfg?.hours);
    if (h === null || h > 8760) return "triggerConfig.hours ১–৮৭৬০ এর মধ্যে পূর্ণসংখ্যা হতে হবে";
  }
  if (trigger === "due_overdue_days") {
    const d = positiveInt(cfg?.days);
    if (d === null || d > 365) return "triggerConfig.days ১–৩৬৫ এর মধ্যে পূর্ণসংখ্যা হতে হবে";
  }
  if (trigger === "order_created" && cfg !== null && Object.keys(cfg).length > 0) {
    return "order_created trigger-এ triggerConfig লাগে না";
  }

  // ---- conditions ----
  const cond = input.conditions ?? null;
  if (cond !== null) {
    if (!isPlainObject(cond)) return "conditions একটি object হতে হবে";
    for (const key of Object.keys(cond)) {
      if (!(CONDITION_KEYS as readonly string[]).includes(key)) {
        return `অজানা condition: "${key}" — সঠিক condition: ${CONDITION_KEYS.join(", ")}`;
      }
    }
    if (cond.minTotalMinor !== undefined) {
      if (!/^\d+$/.test(String(cond.minTotalMinor))) {
        return "conditions.minTotalMinor সঠিক সংখ্যায় পাঠান (পয়সায়, string)";
      }
    }
    if (cond.sources !== undefined) {
      if (!Array.isArray(cond.sources) || cond.sources.length === 0
        || cond.sources.some((s: any) => typeof s !== "string" || !s.trim())) {
        return "conditions.sources অ-শূন্য string-এর তালিকা হতে হবে";
      }
    }
    if (cond.isCod !== undefined && typeof cond.isCod !== "boolean") {
      return "conditions.isCod boolean হতে হবে";
    }
    if (cond.customerIsNew !== undefined && typeof cond.customerIsNew !== "boolean") {
      return "conditions.customerIsNew boolean হতে হবে";
    }
    if (cond.district !== undefined) {
      if (typeof cond.district !== "string" || !cond.district.trim()) {
        return "conditions.district অ-শূন্য string হতে হবে";
      }
    }
    if (cond.riskBandAtLeast !== undefined && !["medium", "high"].includes(String(cond.riskBandAtLeast))) {
      return `conditions.riskBandAtLeast হতে হবে "medium" অথবা "high"`;
    }
  }

  // ---- actions ----
  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    return "actions-এ অন্তত একটি action থাকতে হবে";
  }
  if (input.actions.length > 10) return "একটি নিয়মে সর্বোচ্চ ১০টি action থাকতে পারে";
  for (const raw of input.actions) {
    if (!isPlainObject(raw)) return "প্রতিটি action একটি object হতে হবে";
    const type = String(raw.type ?? "");
    if (!(ACTION_TYPES as readonly string[]).includes(type)) {
      return `অজানা action: "${type}" — সঠিক action: ${ACTION_TYPES.join(", ")}`;
    }
    for (const key of Object.keys(raw)) {
      if (key !== "type" && !ACTION_FIELDS[type].includes(key)) {
        return `"${type}" action-এ অজানা key: "${key}" — সঠিক key: ${ACTION_FIELDS[type].join(", ")}`;
      }
    }
    if (type === "add_tag") {
      const tag = String(raw.tag ?? "").trim();
      if (tag.length < 1 || tag.length > 30) return "add_tag action-এর tag ১–৩০ অক্ষরের হতে হবে";
    }
    if (type === "assign") {
      if (typeof raw.userId !== "string" || !raw.userId.trim()) {
        return "assign action-এর userId আবশ্যক";
      }
    }
    if (type === "hold") {
      const reason = String(raw.reason ?? "").trim();
      if (reason.length < 1 || reason.length > 300) return "hold action-এর reason ১–৩০০ অক্ষরের হতে হবে";
    }
    if (type === "notify_staff" || type === "notify_customer") {
      const msg = String(raw.message ?? "").trim();
      if (msg.length < 1 || msg.length > 1000) return `${type} action-এর message ১–১০০০ অক্ষরের হতে হবে`;
    }
  }
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    return "enabled boolean হতে হবে";
  }
  return null;
}

/** Normalize a validated payload into the stored shape. */
export function normalizeRuleInput(input: any) {
  return {
    name: String(input.name).trim(),
    trigger: String(input.trigger),
    triggerConfig: input.triggerConfig ?? null,
    conditions: input.conditions ?? null,
    actions: input.actions,
    enabled: input.enabled === true,
  };
}

/** Facts the condition evaluator reads (all from the REAL
 * order, loaded fresh at evaluation time). */
export interface ConditionFacts {
  totalMinor: bigint;
  source: string;
  isCod: boolean;
  /** true when the customer has ≤1 prior non-practice order
   * (excluding this one); null customer = 0 priors = new. */
  customerIsNew: boolean;
  /** Resolved district (structured customer address district,
   * else a high/medium-confidence parseBdAddress result);
   * null = unknown — a district condition then never matches. */
  district: string | null;
  riskBand: string | null;
}

/** ALL present conditions must pass; absent = pass. */
export function evaluateConditions(conditions: any, facts: ConditionFacts): boolean {
  if (!conditions || typeof conditions !== "object") return true;
  const c = conditions as Record<string, any>;
  if (c.minTotalMinor !== undefined) {
    let min: bigint;
    try { min = BigInt(String(c.minTotalMinor)); } catch { return false; }
    if (facts.totalMinor < min) return false;
  }
  if (Array.isArray(c.sources) && c.sources.length > 0) {
    if (!c.sources.map(String).includes(facts.source)) return false;
  }
  if (c.isCod !== undefined && facts.isCod !== c.isCod) return false;
  if (c.customerIsNew !== undefined && facts.customerIsNew !== c.customerIsNew) return false;
  if (c.district !== undefined) {
    if (!facts.district) return false;
    if (facts.district.toLowerCase() !== String(c.district).trim().toLowerCase()) return false;
  }
  if (c.riskBandAtLeast !== undefined) {
    // A null band means "not assessed" — never a match.
    if (!facts.riskBand) return false;
    const have = RISK_RANK[facts.riskBand];
    const need = RISK_RANK[String(c.riskBandAtLeast)];
    if (have === undefined || need === undefined || have < need) return false;
  }
  return true;
}

/**
 * The 5 installable presets (exact programme definitions).
 * Installing creates the rule DISABLED — the merchant turns
 * it on themselves. Messages use only the supported
 * placeholders {{orderNumber}} {{total}} {{customerName}}.
 */
export const AUTOMATION_PRESETS: {
  key: string; name: string; descriptionBn: string;
  trigger: string; triggerConfig: any; conditions: any; actions: any[];
}[] = [
  {
    key: "big_cod_verify",
    name: "বড় COD অর্ডার — আগে যাচাই",
    descriptionBn: "৩,০০০ টাকা বা তার বেশি COD অর্ডার এলে অর্ডারটি আটকে স্টাফকে জানানো হবে — আগে ফোনে যাচাই করুন।",
    trigger: "order_created",
    triggerConfig: null,
    conditions: { isCod: true, minTotalMinor: "300000" },
    actions: [
      { type: "hold", reason: "বড় COD অর্ডার — আগে ফোনে যাচাই করুন" },
      { type: "notify_staff", message: "বড় COD অর্ডার এসেছে: {{orderNumber}} (মোট {{total}}) — আগে ফোনে যাচাই করুন।" },
    ],
  },
  {
    key: "parcel_stuck",
    name: "পার্সেল আটকে আছে",
    descriptionBn: "পার্সেল ৭২ ঘণ্টা ধরে একই কুরিয়ার স্ট্যাটাসে থাকলে স্টাফ ও গ্রাহক দুজনকেই জানানো হবে।",
    trigger: "parcel_stuck_hours",
    triggerConfig: { hours: 72 },
    conditions: null,
    actions: [
      { type: "notify_staff", message: "পার্সেল আটকে আছে: অর্ডার {{orderNumber}} — কুরিয়ারের সঙ্গে খোঁজ নিন।" },
      { type: "notify_customer", message: "আসসালামু আলাইকুম {{customerName}}, আপনার অর্ডার {{orderNumber}}-এর পার্সেলটি পৌঁছাতে দেরি হচ্ছে — আমরা খোঁজ নিচ্ছি।" },
    ],
  },
  {
    key: "due_aging",
    name: "বকেয়া পুরনো হচ্ছে",
    descriptionBn: "ডেলিভারি হওয়া অর্ডারের বকেয়া ৩ দিনের বেশি পুরনো হলে 'বকেয়া' ট্যাগ দিয়ে স্টাফকে জানানো হবে।",
    trigger: "due_overdue_days",
    triggerConfig: { days: 3 },
    conditions: null,
    actions: [
      { type: "add_tag", tag: "বকেয়া" },
      { type: "notify_staff", message: "বকেয়া পুরনো হচ্ছে: অর্ডার {{orderNumber}} (মোট {{total}}) — আদায়ের ব্যবস্থা নিন।" },
    ],
  },
  {
    key: "vip_customer",
    name: "VIP গ্রাহক",
    descriptionBn: "পুরনো গ্রাহকের ১০,০০০ টাকা বা তার বেশি অর্ডারে 'VIP' ট্যাগ দিয়ে স্টাফকে জানানো হবে।",
    trigger: "order_created",
    triggerConfig: null,
    conditions: { customerIsNew: false, minTotalMinor: "1000000" },
    actions: [
      { type: "add_tag", tag: "VIP" },
      { type: "notify_staff", message: "VIP গ্রাহকের অর্ডার এসেছে: {{orderNumber}} (মোট {{total}}) — অগ্রাধিকার দিয়ে সামলান।" },
    ],
  },
  {
    key: "risky_order",
    name: "ঝুঁকিপূর্ণ অর্ডার",
    descriptionBn: "Fraud Shield-এ উচ্চ ঝুঁকি (high) পাওয়া অর্ডার স্বয়ংক্রিয়ভাবে পর্যালোচনার জন্য আটকানো হবে।",
    trigger: "order_created",
    triggerConfig: null,
    conditions: { riskBandAtLeast: "high" },
    actions: [
      { type: "hold", reason: "উচ্চ ঝুঁকি (Fraud Shield)" },
    ],
  },
];
