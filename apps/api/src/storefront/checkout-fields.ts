/**
 * AB4 (AX5b): custom checkout fields — pure helpers shared by
 * the three placement surfaces (shop | single | landing).
 *
 * Discipline (deliberate, stricter than silent tolerance):
 *  - answers are validated against the org's ACTIVE defs for
 *    the placement surface ONLY (appliesTo = surface or "all");
 *  - an UNKNOWN key is rejected with a clear error — silently
 *    dropping keys would let a renamed required field vanish;
 *  - a missing/empty REQUIRED field is rejected;
 *  - select values must be one of the def's options;
 *  - checkbox answers coerce from boolean / "true" / "false"
 *    only — anything else is an error, and a required checkbox
 *    must end up true;
 *  - text answers are trimmed and length-capped.
 * The validated map (key → string | boolean) is what lands on
 * Order.checkoutFields — never the raw client payload.
 */

export type CheckoutSurface = "shop" | "single" | "landing";

export interface CheckoutFieldDefLike {
  key: string;
  label: string;
  type: string; // text | textarea | select | checkbox
  options?: unknown;
  required?: boolean | null;
  appliesTo?: string | null;
  active?: boolean | null;
  sortOrder?: number | null;
}

export const CHECKOUT_FIELD_TYPES = ["text", "textarea", "select", "checkbox"] as const;
export const CHECKOUT_FIELD_SURFACES = ["shop", "single", "landing", "all"] as const;

const MAX_TEXT_LEN = 1000;
const MAX_TEXTAREA_LEN = 4000;

export function defsForSurface<T extends CheckoutFieldDefLike>(defs: T[] | null | undefined, surface: CheckoutSurface): T[] {
  return (defs ?? [])
    .filter((d) => d && d.active !== false && (d.appliesTo === surface || d.appliesTo === "all" || d.appliesTo == null))
    .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || String(a.key).localeCompare(String(b.key)));
}

/** The public shape a checkout form renders from. */
export function publicFieldDef(d: CheckoutFieldDefLike) {
  return {
    key: d.key,
    label: d.label,
    type: d.type,
    options: Array.isArray(d.options) ? d.options.map((o) => String(o)) : [],
    required: d.required === true,
  };
}

export type FieldAnswerMap = Record<string, string | boolean>;

export type FieldValidation =
  | { ok: true; values: FieldAnswerMap }
  | { ok: false; error: string };

export function validateFieldAnswers(
  defs: CheckoutFieldDefLike[] | null | undefined,
  surface: CheckoutSurface,
  answers: unknown,
): FieldValidation {
  const active = defsForSurface(defs, surface);
  const byKey = new Map(active.map((d) => [String(d.key), d]));
  const raw: Record<string, unknown> =
    answers && typeof answers === "object" && !Array.isArray(answers) ? (answers as Record<string, unknown>) : {};

  for (const key of Object.keys(raw)) {
    if (!byKey.has(key)) {
      return { ok: false, error: `চেকআউট ফিল্ড "${key}" এই দোকানে চালু নেই` };
    }
  }

  const values: FieldAnswerMap = {};
  for (const def of active) {
    const key = String(def.key);
    const label = String(def.label ?? def.key);
    const v = raw[key];
    const missing = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    if (missing) {
      if (def.required === true) return { ok: false, error: `"${label}" ঘরটি আবশ্যক — পূরণ করুন` };
      continue;
    }
    if (def.type === "checkbox") {
      let b: boolean | null = null;
      if (typeof v === "boolean") b = v;
      else if (v === "true") b = true;
      else if (v === "false") b = false;
      if (b === null) return { ok: false, error: `"${label}" ঘরটিতে সঠিক মান দিন` };
      if (def.required === true && b !== true) return { ok: false, error: `"${label}" ঘরটি আবশ্যক — পূরণ করুন` };
      values[key] = b;
      continue;
    }
    if (typeof v !== "string") {
      return { ok: false, error: `"${label}" ঘরটিতে লেখা দিতে হবে` };
    }
    const text = v.trim();
    if (def.type === "select") {
      const options = Array.isArray(def.options) ? def.options.map((o) => String(o)) : [];
      if (!options.includes(text)) {
        return { ok: false, error: `"${label}" ঘরের মান তালিকার বাইরে — তালিকা থেকে বেছে নিন` };
      }
      values[key] = text;
      continue;
    }
    const cap = def.type === "textarea" ? MAX_TEXTAREA_LEN : MAX_TEXT_LEN;
    if (text.length > cap) {
      return { ok: false, error: `"${label}" ঘরের লেখা খুব বড় (সর্বোচ্চ ${cap} অক্ষর)` };
    }
    values[key] = text;
  }
  return { ok: true, values };
}
