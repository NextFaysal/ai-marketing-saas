/**
 * ON8 (Orders Next): Orders Automation Studio — pure helpers
 * for the rule list, the constrained builder form, the preset
 * gallery and the per-rule log viewer. Side-effect free,
 * unit-testable. The payload shaping here mirrors the API
 * vocabulary in apps/api/src/order-automation/order-automation.ts
 * EXACTLY (same trigger / condition / action keys): unknown
 * keys are never produced, empty optional fields are OMITTED
 * (absent condition = pass on the server), and money is a
 * minor-unit STRING (taka input converted via takaToMinor).
 */
import { minorToTaka, takaToMinor } from "./orders-on1";

export interface AutomationRule {
  id: string;
  organizationId: string;
  name: string;
  enabled: boolean;
  trigger: string;
  triggerConfig: Record<string, unknown> | null;
  conditions: Record<string, unknown> | null;
  actions: AutomationAction[];
  presetKey: string | null;
  createdById?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  runCount: number;
  lastRunAt?: string | null;
}

export type AutomationAction =
  | { type: "add_tag"; tag: string }
  | { type: "assign"; userId: string }
  | { type: "hold"; reason: string }
  | { type: "notify_staff"; message: string }
  | { type: "notify_customer"; message: string };

export interface AutomationPreset {
  key: string;
  name: string;
  descriptionBn: string;
  trigger: string;
  triggerConfig: Record<string, unknown> | null;
  conditions: Record<string, unknown> | null;
  actions: AutomationAction[];
  installed: boolean;
}

export interface AutomationLogRow {
  id: string;
  ruleId: string;
  orderId: string;
  triggerKey: string;
  actionsResult: { type: string; ok: boolean; detail?: string }[];
  createdAt: string;
}

export const TRIGGER_OPTIONS: { value: string; label: string }[] = [
  { value: "order_created", label: "অর্ডার তৈরি হলে" },
  { value: "status_changed", label: "অর্ডারের স্ট্যাটাস বদলালে" },
  { value: "parcel_stuck_hours", label: "পার্সেল আটকে থাকলে (ঘণ্টা)" },
  { value: "due_overdue_days", label: "বকেয়া পুরনো হলে (দিন)" },
];

export const ACTION_TYPE_OPTIONS: { value: AutomationAction["type"]; label: string }[] = [
  { value: "add_tag", label: "ট্যাগ যোগ করুন" },
  { value: "assign", label: "দায়িত্ব দিন" },
  { value: "hold", label: "পর্যালোচনার জন্য আটকান" },
  { value: "notify_staff", label: "স্টাফকে জানান" },
  { value: "notify_customer", label: "গ্রাহককে জানান" },
];

export function triggerLabel(trigger: string): string {
  return TRIGGER_OPTIONS.find((t) => t.value === trigger)?.label ?? trigger;
}

export function actionLabel(type: string): string {
  return ACTION_TYPE_OPTIONS.find((a) => a.value === type)?.label ?? type;
}

/** One-line summary of a rule's actions for the list view. */
export function actionSummary(actions: AutomationAction[] | undefined): string {
  if (!actions || actions.length === 0) return "—";
  return actions.map((a) => actionLabel(a.type)).join(" · ");
}

/** Builder form state (all strings — converted at build time). */
export interface RuleDraft {
  name: string;
  trigger: string;
  toStatus: string;
  hours: string;
  days: string;
  minTotalTaka: string;
  sources: string;
  isCod: "" | "true" | "false";
  customerIsNew: "" | "true" | "false";
  district: string;
  riskBandAtLeast: "" | "medium" | "high";
  actions: ActionDraft[];
}

export interface ActionDraft {
  type: AutomationAction["type"];
  tag: string;
  userId: string;
  reason: string;
  message: string;
}

export function emptyActionDraft(type: AutomationAction["type"] = "add_tag"): ActionDraft {
  return { type, tag: "", userId: "", reason: "", message: "" };
}

export function emptyRuleDraft(): RuleDraft {
  return {
    name: "", trigger: "order_created", toStatus: "", hours: "72", days: "3",
    minTotalTaka: "", sources: "", isCod: "", customerIsNew: "", district: "",
    riskBandAtLeast: "", actions: [emptyActionDraft()],
  };
}

/** Prefill the builder from a stored rule (edit mode). */
export function draftFromRule(rule: AutomationRule): RuleDraft {
  const cfg = (rule.triggerConfig ?? {}) as Record<string, unknown>;
  const cond = (rule.conditions ?? {}) as Record<string, unknown>;
  return {
    name: rule.name,
    trigger: rule.trigger,
    toStatus: typeof cfg.toStatus === "string" ? cfg.toStatus : "",
    hours: cfg.hours != null ? String(cfg.hours) : "72",
    days: cfg.days != null ? String(cfg.days) : "3",
    minTotalTaka: cond.minTotalMinor != null ? minorToTaka(String(cond.minTotalMinor)) : "",
    sources: Array.isArray(cond.sources) ? cond.sources.map(String).join(", ") : "",
    isCod: cond.isCod === true ? "true" : cond.isCod === false ? "false" : "",
    customerIsNew: cond.customerIsNew === true ? "true" : cond.customerIsNew === false ? "false" : "",
    district: typeof cond.district === "string" ? cond.district : "",
    riskBandAtLeast: cond.riskBandAtLeast === "medium" || cond.riskBandAtLeast === "high" ? cond.riskBandAtLeast : "",
    actions: (rule.actions ?? []).map((a) => {
      const d = emptyActionDraft(a.type);
      if (a.type === "add_tag") d.tag = a.tag;
      if (a.type === "assign") d.userId = a.userId;
      if (a.type === "hold") d.reason = a.reason;
      if (a.type === "notify_staff" || a.type === "notify_customer") d.message = a.message;
      return d;
    }),
  };
}

export interface BuildResult {
  payload: Record<string, unknown> | null;
  error: string | null;
}

/**
 * Shape the builder draft into the API payload. Returns a
 * Bengali error instead of a payload when a required field is
 * missing/invalid — the server validates again regardless
 * (this only keeps the round-trip honest and fast).
 */
export function buildRulePayload(draft: RuleDraft): BuildResult {
  const name = draft.name.trim();
  if (name.length < 1 || name.length > 120) return { payload: null, error: "নিয়মের নাম ১–১২০ অক্ষরের হতে হবে" };

  let triggerConfig: Record<string, unknown> | null = null;
  if (draft.trigger === "status_changed") {
    const to = draft.toStatus.trim();
    if (!to) return { payload: null, error: "কোন স্ট্যাটাসে বদলালে চলবে তা বেছে দিন" };
    triggerConfig = { toStatus: to };
  } else if (draft.trigger === "parcel_stuck_hours") {
    const hours = Number(draft.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 8760) return { payload: null, error: "আটকে থাকার ঘণ্টা ১–৮৭৬০ এর মধ্যে হতে হবে" };
    triggerConfig = { hours };
  } else if (draft.trigger === "due_overdue_days") {
    const days = Number(draft.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) return { payload: null, error: "বকেয়ার দিন ১–৩৬৫ এর মধ্যে হতে হবে" };
    triggerConfig = { days };
  } else if (draft.trigger !== "order_created") {
    return { payload: null, error: "অজানা ট্রিগার" };
  }

  const conditions: Record<string, unknown> = {};
  if (draft.minTotalTaka.trim()) {
    const minor = takaToMinor(draft.minTotalTaka);
    if (minor === null) return { payload: null, error: "কমপক্ষে মোট টাকার পরিমাণ সঠিক সংখ্যায় লিখুন" };
    conditions.minTotalMinor = minor;
  }
  const sources = draft.sources.split(",").map((s) => s.trim()).filter(Boolean);
  if (sources.length > 0) conditions.sources = sources;
  if (draft.isCod !== "") conditions.isCod = draft.isCod === "true";
  if (draft.customerIsNew !== "") conditions.customerIsNew = draft.customerIsNew === "true";
  if (draft.district.trim()) conditions.district = draft.district.trim();
  if (draft.riskBandAtLeast !== "") conditions.riskBandAtLeast = draft.riskBandAtLeast;

  if (draft.actions.length === 0) return { payload: null, error: "অন্তত একটি কাজ যোগ করুন" };
  const actions: AutomationAction[] = [];
  for (const a of draft.actions) {
    if (a.type === "add_tag") {
      const tag = a.tag.trim();
      if (!tag) return { payload: null, error: "ট্যাগের কাজে ট্যাগ লিখুন" };
      actions.push({ type: "add_tag", tag });
    } else if (a.type === "assign") {
      if (!a.userId) return { payload: null, error: "দায়িত্বের কাজে টিম সদস্য বেছে দিন" };
      actions.push({ type: "assign", userId: a.userId });
    } else if (a.type === "hold") {
      const reason = a.reason.trim();
      if (!reason) return { payload: null, error: "আটকানোর কাজে কারণ লিখুন" };
      actions.push({ type: "hold", reason });
    } else {
      const message = a.message.trim();
      if (!message) return { payload: null, error: "বার্তার কাজে বার্তা লিখুন" };
      actions.push({ type: a.type, message });
    }
  }

  return {
    payload: {
      name,
      trigger: draft.trigger,
      triggerConfig,
      conditions: Object.keys(conditions).length > 0 ? conditions : null,
      actions,
    },
    error: null,
  };
}

/** Log-row action summary for the viewer ("add_tag ✓ · hold ✗ …"). */
export function logActionSummary(row: AutomationLogRow): string {
  const results = Array.isArray(row.actionsResult) ? row.actionsResult : [];
  if (results.length === 0) return "—";
  return results.map((r) => `${actionLabel(String(r.type))} ${r.ok ? "✓" : "✗"}`).join(" · ");
}
