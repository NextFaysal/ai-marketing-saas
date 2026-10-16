/**
 * AB4 (AX5) — merchant-defined checkout fields (pure helpers).
 *
 * The org's field defs ride the public payloads as `checkoutFields`;
 * the buyer's answers travel on placement DTOs as `fieldAnswers`.
 * These helpers hold the shared validation/label logic so the shop,
 * single-product, landing and express surfaces behave identically.
 */

export interface CheckoutFieldDef {
  key: string;
  label: string;
  type: string; // "text" | "textarea" | "select" | "checkbox" (unknown → text)
  options: string[];
  required: boolean;
}

export type FieldAnswers = Record<string, string | boolean>;

/** Normalize a raw payload entry into a CheckoutFieldDef, or null
 * when it carries no usable key/label. */
export function normalizeCheckoutField(raw: unknown): CheckoutFieldDef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const key = typeof r.key === "string" ? r.key : "";
  const label = typeof r.label === "string" ? r.label : "";
  if (!key || !label) return null;
  return {
    key,
    label,
    type: typeof r.type === "string" ? r.type : "text",
    options: Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === "string") : [],
    required: r.required === true,
  };
}

export function normalizeCheckoutFields(raw: unknown): CheckoutFieldDef[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeCheckoutField).filter((f): f is CheckoutFieldDef => f !== null);
}

/** Is one field answered? Checkbox counts only when true; text-like
 * fields need a non-empty string. */
export function isFieldAnswered(def: CheckoutFieldDef, answers: FieldAnswers): boolean {
  const v = answers[def.key];
  if (def.type === "checkbox") return v === true;
  return typeof v === "string" && v.trim() !== "";
}

/** Labels of required fields with no answer (Bengali error upstream). */
export function missingRequiredFields(defs: CheckoutFieldDef[], answers: FieldAnswers): string[] {
  return defs.filter((d) => d.required && !isFieldAnswered(d, answers)).map((d) => d.label);
}

/**
 * The answers object to send on placement: only fields that are
 * actually answered, keyed by def key. Returns undefined when
 * nothing was answered so legacy payloads stay byte-identical.
 */
export function buildFieldAnswers(
  defs: CheckoutFieldDef[],
  answers: FieldAnswers,
): FieldAnswers | undefined {
  const out: FieldAnswers = {};
  for (const def of defs) {
    if (!isFieldAnswered(def, answers)) continue;
    const v = answers[def.key];
    out[def.key] = def.type === "checkbox" ? true : String(v).trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Human display of one stored answer on the order detail. */
export function formatFieldAnswer(value: string | boolean | null | undefined): string {
  if (value === true) return "হ্যাঁ";
  if (value === false) return "না";
  if (value == null || value === "") return "—";
  return String(value);
}
