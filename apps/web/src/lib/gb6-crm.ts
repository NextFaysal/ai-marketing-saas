/**
 * GB6 (GC15): pure helpers for the CRM depth on the Customers
 * page — customer tags, segment criteria, list filters.
 * Side-effect free so they are unit-testable like orders-on*.
 * The server stays the authority; these helpers mirror the
 * API validation in apps/api/src/customers/customers.service.ts
 * (tag discipline) and crm-segments.service.ts
 * (validateSegmentCriteria) so the form can refuse BEFORE
 * sending, with the same limits and Bengali messages.
 */
import type { UiLocale } from "@repo/contracts";
import { crmBn, crmEn } from "./i18n/crm";
import { interpolate } from "./i18n/lookup";
import { minorToTaka, takaToMinor } from "./orders-on1";

/** crm dictionary for the given UI locale (bn is the default). */
const D = (locale?: string) => (locale === "en" ? crmEn : crmBn);

// --- Customer tags ------------------------------------------------

export const MAX_CUSTOMER_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

/** Trim + dedupe (server discipline: stored tags are trimmed,
 * deduped strings). Order is preserved. */
export function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = String(raw ?? "").trim();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** Mirror of the server tag rules: at most 10 tags, each
 * 1–30 chars after trimming. Returns a Bengali error or null. */
export function validateTags(tags: readonly string[], locale: UiLocale = "bn"): string | null {
  const d = D(locale);
  if (tags.length > MAX_CUSTOMER_TAGS) return d.zzGb6TagMax;
  for (const raw of tags) {
    const tag = String(raw ?? "").trim();
    if (tag.length < 1 || tag.length > MAX_TAG_LENGTH) return d.zzGb6TagLength;
  }
  return null;
}

/** Validate ONE candidate tag against the current list (the
 * tags editor adds one chip at a time). Checks the candidate's
 * own length, the 10-tag ceiling and duplicates. */
export function validateNewTag(existing: readonly string[], candidate: string, locale: UiLocale = "bn"): string | null {
  const d = D(locale);
  const tag = candidate.trim();
  if (!tag) return d.zzGb6TagEmpty;
  if (tag.length > MAX_TAG_LENGTH) return d.zzGb6TagLength;
  const current = normalizeTags(existing);
  if (current.includes(tag)) return d.zzGb6TagDuplicate;
  if (current.length >= MAX_CUSTOMER_TAGS) return d.zzGb6TagMax;
  return null;
}

// --- Customer list filters ----------------------------------------

export type CustomerTypeFilter = "all" | "first" | "repeat" | "vip" | "blocked";

/** Customer-type filter options for the given UI locale (bn default). */
export function customerTypeOptions(locale: UiLocale = "bn"): { value: CustomerTypeFilter; label: string }[] {
  const d = D(locale);
  return [
    { value: "all", label: d.zzGb6TypeAll },
    { value: "first", label: d.zzGb6TypeFirst },
    { value: "repeat", label: d.zzGb6TypeRepeat },
    { value: "vip", label: d.zzGb6TypeVip },
    { value: "blocked", label: d.zzGb6TypeBlocked },
  ];
}

export const CUSTOMER_TYPE_OPTIONS: { value: CustomerTypeFilter; label: string }[] = customerTypeOptions("bn");

export interface CustomerListFilters {
  q: string;
  hasDue: boolean;
  customerType: string;
  tag: string;
  segmentId: string;
}

/** Build the GET /customers query string from filter state.
 * Empty values are omitted entirely (the server treats a
 * missing customerType as "all" and ignores empty tag /
 * segmentId by not receiving them). */
export function buildCustomerListParams(f: CustomerListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.q.trim()) params.set("q", f.q.trim());
  if (f.hasDue) params.set("hasDue", "true");
  if (f.customerType && f.customerType !== "all") params.set("customerType", f.customerType);
  if (f.tag.trim()) params.set("tag", f.tag.trim());
  if (f.segmentId) params.set("segmentId", f.segmentId);
  return params;
}

// --- Segments ------------------------------------------------------

export interface SegmentCriteria {
  tagsAny?: string[];
  isVip?: boolean;
  isRepeat?: boolean;
  minSpentMinor?: string;
  district?: string;
}

export interface CrmSegment {
  id: string;
  name: string;
  criteria: SegmentCriteria;
  memberCount: number;
  createdAt?: string;
  updatedAt?: string;
}

/** The segment form state: checkbox = "criterion present",
 * unchecked = criterion omitted (NOT sent as false — the
 * server evaluator only matches criteria that are present). */
export interface SegmentCriteriaDraft {
  tagsAny: string[];
  vipOnly: boolean;
  repeatOnly: boolean;
  minSpentTaka: string;
  district: string;
}

export const EMPTY_SEGMENT_DRAFT: SegmentCriteriaDraft = {
  tagsAny: [], vipOnly: false, repeatOnly: false, minSpentTaka: "", district: "",
};

/**
 * Shape a segment draft into the API criteria object.
 * - every field is optional; an untouched form yields {} —
 *   a valid segment that matches every customer in the window;
 * - minSpentTaka converts to a minor-unit string via the
 *   shared orders-on1 converter (unparseable = error, never
 *   a silent 0);
 * - tagsAny mirrors the customer-tag discipline (≤10 × 1–30);
 * - district is trimmed, 1–100 chars when present.
 */
export function buildSegmentCriteria(
  draft: SegmentCriteriaDraft,
  locale: UiLocale = "bn",
): { criteria: SegmentCriteria | null; errors: string[] } {
  const d = D(locale);
  const errors: string[] = [];
  const criteria: SegmentCriteria = {};

  const tags = normalizeTags(draft.tagsAny);
  if (tags.length > 0 || draft.tagsAny.length > 0) {
    const tagError = validateTags(draft.tagsAny.map((t) => t.trim()).filter(Boolean), locale);
    if (tagError) errors.push(tagError);
    else if (tags.length) criteria.tagsAny = tags;
  }
  if (draft.vipOnly) criteria.isVip = true;
  if (draft.repeatOnly) criteria.isRepeat = true;
  if (draft.minSpentTaka.trim()) {
    const minor = takaToMinor(draft.minSpentTaka);
    if (minor === null) errors.push(d.zzGb6MinSpentInvalid);
    else criteria.minSpentMinor = minor;
  }
  const district = draft.district.trim();
  if (district) {
    if (district.length > 100) errors.push(d.zzGb6DistrictLength);
    else criteria.district = district;
  }

  if (errors.length) return { criteria: null, errors };
  return { criteria, errors: [] };
}

/** Prefill the segment form from a stored criteria object
 * (edit path). Only `true` booleans tick the checkboxes —
 * a stored explicit false (possible via API) reads as
 * "criterion on false"; the form has no false-state, so it
 * is surfaced as unchecked. minSpent converts minor -> taka. */
export function segmentCriteriaToDraft(criteria: SegmentCriteria | null | undefined): SegmentCriteriaDraft {
  const c = criteria ?? {};
  return {
    tagsAny: Array.isArray(c.tagsAny) ? [...c.tagsAny] : [],
    vipOnly: c.isVip === true,
    repeatOnly: c.isRepeat === true,
    minSpentTaka: c.minSpentMinor ? minorToTaka(c.minSpentMinor) : "",
    district: c.district ?? "",
  };
}

/** Full segment payload (POST / PATCH share the {name, criteria}
 * shape). Segment name: 1–120 chars (server rule). */
export function buildSegmentPayload(
  name: string,
  draft: SegmentCriteriaDraft,
  locale: UiLocale = "bn",
): { payload: { name: string; criteria: SegmentCriteria } | null; errors: string[] } {
  const errors: string[] = [];
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) errors.push(D(locale).zzGb6SegmentNameLength);
  const { criteria, errors: criteriaErrors } = buildSegmentCriteria(draft, locale);
  errors.push(...criteriaErrors);
  if (errors.length || !criteria) return { payload: null, errors };
  return { payload: { name: trimmed, criteria }, errors: [] };
}

/** Short summary of a segment's criteria for list rows (bn default). */
export function segmentCriteriaSummary(criteria: SegmentCriteria | null | undefined, locale: UiLocale = "bn"): string {
  const d = D(locale);
  const c = criteria ?? {};
  const parts: string[] = [];
  if (c.tagsAny?.length) parts.push(interpolate(d.zzGb6SummaryTags, { tags: c.tagsAny.join(", ") }));
  if (c.isVip === true) parts.push(d.zzGb6SummaryVip);
  if (c.isVip === false) parts.push(d.zzGb6SummaryNotVip);
  if (c.isRepeat === true) parts.push(d.zzGb6SummaryRepeat);
  if (c.isRepeat === false) parts.push(d.zzGb6SummaryFirst);
  if (c.minSpentMinor) parts.push(interpolate(d.zzGb6SummaryMinSpent, { amount: minorToTaka(c.minSpentMinor) }));
  if (c.district) parts.push(interpolate(d.zzGb6SummaryDistrict, { district: c.district }));
  return parts.length ? parts.join(" · ") : d.zzGb6SummaryNone;
}
