/**
 * MB5 (ML14, CD-3) — MessageTemplate per-locale variants: the
 * ONE shared shape + validation + variant-if-exists application
 * used by template CRUD (messaging.service) and the workflow
 * engine send paths (workflows.service). Journey sends flow
 * through the same workflow steps, so they inherit the hook
 * with no preset-side code.
 *
 * Shape (stored on MessageTemplate.variants, Json):
 *   { bn?: { subject?: string|null, body?: string|null, htmlBody?: string|null },
 *     en?: { subject?: string|null, body?: string|null, htmlBody?: string|null } }
 *
 * Rules:
 * - Variants are the merchant's OWN texts in each locale —
 *   never machine-translated (D-MB4-5).
 * - Variant-if-exists: at send time a variant field replaces
 *   the authored field ONLY when it is present and non-empty
 *   for the recipient's locale; otherwise the authored text is
 *   used verbatim. A template with no variants (every pre-MB5
 *   row) therefore behaves byte-identically to before.
 * - Validation is strict at write time (unknown locale keys,
 *   unknown field keys, non-string values and empty strings are
 *   all rejected by the caller with a catalogued 400); stored
 *   data that fails validation at READ time is ignored by
 *   applyTemplateVariant rather than breaking a send.
 */

export type TemplateVariantLocale = "bn" | "en";

export interface TemplateVariantFields {
  subject?: string | null;
  body?: string | null;
  htmlBody?: string | null;
}

export type TemplateVariants = Partial<Record<TemplateVariantLocale, TemplateVariantFields>>;

export const TEMPLATE_VARIANT_LOCALES = ["bn", "en"] as const;
export const TEMPLATE_VARIANT_FIELDS = ["subject", "body", "htmlBody"] as const;

/**
 * Validate an untrusted `variants` value. Returns the value
 * normalised (only known locale/field keys kept) or null when
 * the input is null/undefined (meaning "no variants"). Throws
 * an Error with a plain message on any malformed shape — the
 * caller converts it to the catalogued badRequest.
 */
export function validateTemplateVariants(raw: unknown): TemplateVariants | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("variants must be an object keyed by locale (bn/en)");
  }
  const out: TemplateVariants = {};
  for (const [locale, fields] of Object.entries(raw as Record<string, unknown>)) {
    if (!(TEMPLATE_VARIANT_LOCALES as readonly string[]).includes(locale)) {
      throw new Error(`variants: unknown locale "${locale}" (only bn/en)`);
    }
    if (fields === null || fields === undefined) continue;
    if (typeof fields !== "object" || Array.isArray(fields)) {
      throw new Error(`variants.${locale} must be an object`);
    }
    const clean: TemplateVariantFields = {};
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
      if (!(TEMPLATE_VARIANT_FIELDS as readonly string[]).includes(field)) {
        throw new Error(`variants.${locale}: unknown field "${field}" (only subject/body/htmlBody)`);
      }
      if (value !== null && value !== undefined && (typeof value !== "string" || !value.trim())) {
        throw new Error(`variants.${locale}.${field} must be a non-empty string or null`);
      }
      clean[field as keyof TemplateVariantFields] = (value ?? null) as string | null;
    }
    out[locale as TemplateVariantLocale] = clean;
  }
  return out;
}

/** True for a stored value that still matches the shape —
 * read-side guard so legacy/garbage Json can never break a
 * send; invalid stored variants are simply not applied. */
function storedVariantFields(variants: unknown, locale: TemplateVariantLocale): TemplateVariantFields | null {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) return null;
  const per = (variants as Record<string, unknown>)[locale];
  if (!per || typeof per !== "object" || Array.isArray(per)) return null;
  return per as TemplateVariantFields;
}

const nonEmpty = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;

/**
 * Variant-if-exists (CD-3): for the recipient locale, each
 * variant field that is present and non-empty replaces the
 * authored field; every other field keeps the authored text
 * verbatim.
 */
export function applyTemplateVariant<T extends { subject?: string | null; body?: string | null; htmlBody?: string | null }>(
  template: T,
  locale: TemplateVariantLocale,
): { subject: T["subject"]; body: T["body"]; htmlBody: T["htmlBody"] } {
  const per = storedVariantFields((template as any)?.variants, locale);
  if (!per) return { subject: template.subject, body: template.body, htmlBody: template.htmlBody };
  return {
    subject: nonEmpty(per.subject) ?? template.subject,
    body: nonEmpty(per.body) ?? template.body,
    htmlBody: nonEmpty(per.htmlBody) ?? template.htmlBody,
  };
}
