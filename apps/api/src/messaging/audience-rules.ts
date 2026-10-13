import { RFM_SEGMENTS } from "./rfm";

/**
 * MS3 — the ONE audience-definition vocabulary for the Messaging
 * audience builder. A definition is plain Json (stored on
 * Broadcast.audienceDefinition or MessagingSavedAudience.definition):
 *
 *   { entity: "customers" | "leads", match: "all" | "any",
 *     conditions: [{ field, op, value?, key? }] }
 *
 * validateAudienceDefinition is STRICT at write time: an unknown
 * field, an op the field does not support, a mistyped value or
 * more than 20 conditions is a 400 — never silently ignored, so a
 * saved definition can never mean something other than what the
 * builder showed. matchesAudienceDefinition is the pure evaluator
 * the resolver runs per row against pre-computed "facts" (order
 * aggregates and RFM segments are computed by the resolver from
 * the DATABASE — this module never touches Prisma).
 *
 * Null semantics (documented, spec-pinned): a fact that does not
 * exist (a customer with no orders has lastOrderDaysAgo = null; a
 * lead with no value has valueMinor = null; a missing custom-field
 * or address key) makes the condition FALSE — except the order
 * aggregates themselves, which are real zeroes (orders_count = 0,
 * total_spent_minor = 0), so "orders_count eq 0" matches a
 * customer who never ordered. Nothing is ever invented to make a
 * comparison pass.
 */

export class AudienceDefinitionError extends Error {}

export type AudienceEntity = "customers" | "leads";
export type AudienceMatch = "all" | "any";

export interface AudienceCondition {
  field: string;
  op: string;
  value?: unknown;
  /** custom_field / address_key only: which Json key to read. */
  key?: string;
}

export interface AudienceDefinition {
  entity: AudienceEntity;
  match: AudienceMatch;
  conditions: AudienceCondition[];
}

export const MAX_AUDIENCE_CONDITIONS = 20;

export const AUDIENCE_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains"] as const;

interface FieldSpec {
  /** ops this field accepts (a subset of AUDIENCE_OPS) */
  ops: readonly string[];
  /** what `value` must look like */
  kind: "string" | "number" | "boolean" | "keyed-string";
}

const COMMON_FIELDS: Record<string, FieldSpec> = {
  source: { ops: ["eq", "neq"], kind: "string" },
  created_days_ago: { ops: ["gte", "lte", "gt", "lt"], kind: "number" },
  has_email: { ops: ["eq"], kind: "boolean" },
  has_phone: { ops: ["eq"], kind: "boolean" },
  custom_field: { ops: ["eq", "contains"], kind: "keyed-string" },
};

export const CUSTOMER_FIELDS: Record<string, FieldSpec> = {
  ...COMMON_FIELDS,
  orders_count: { ops: ["eq", "gte", "lte", "gt", "lt"], kind: "number" },
  total_spent_minor: { ops: ["gte", "lte", "gt", "lt"], kind: "number" },
  last_order_days_ago: { ops: ["gte", "lte", "gt", "lt"], kind: "number" },
  rfm_segment: { ops: ["eq"], kind: "string" },
  address_key: { ops: ["eq", "contains"], kind: "keyed-string" },
};

export const LEAD_FIELDS: Record<string, FieldSpec> = {
  ...COMMON_FIELDS,
  stage: { ops: ["eq", "neq"], kind: "string" },
  tag: { ops: ["contains"], kind: "string" },
  value_minor: { ops: ["gte", "lte", "gt", "lt"], kind: "number" },
};

export function fieldsForEntity(entity: AudienceEntity): Record<string, FieldSpec> {
  return entity === "customers" ? CUSTOMER_FIELDS : LEAD_FIELDS;
}

function fail(message: string): never {
  throw new AudienceDefinitionError(message);
}

/** Strictly validate + normalize an untrusted definition. Throws
 * AudienceDefinitionError with a verbatim, field-level message. */
export function validateAudienceDefinition(raw: unknown): AudienceDefinition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("audienceDefinition must be an object { entity, match, conditions }");
  const def = raw as Record<string, unknown>;
  const entity = def.entity;
  if (entity !== "customers" && entity !== "leads") fail(`audienceDefinition.entity must be "customers" or "leads" (got ${JSON.stringify(entity)})`);
  const match = def.match ?? "all";
  if (match !== "all" && match !== "any") fail(`audienceDefinition.match must be "all" or "any" (got ${JSON.stringify(def.match)})`);
  const rawConditions = def.conditions ?? [];
  if (!Array.isArray(rawConditions)) fail("audienceDefinition.conditions must be an array");
  if (rawConditions.length > MAX_AUDIENCE_CONDITIONS) fail(`audienceDefinition allows at most ${MAX_AUDIENCE_CONDITIONS} conditions (got ${rawConditions.length})`);
  const fields = fieldsForEntity(entity as AudienceEntity);
  const conditions: AudienceCondition[] = rawConditions.map((rc, i) => {
    const at = `conditions[${i}]`;
    if (!rc || typeof rc !== "object" || Array.isArray(rc)) fail(`${at} must be an object { field, op, value }`);
    const c = rc as Record<string, unknown>;
    const field = c.field;
    if (typeof field !== "string" || !(field in fields)) {
      fail(`${at}.field ${JSON.stringify(field)} is not a valid ${entity} field (valid: ${Object.keys(fields).join(", ")})`);
    }
    const spec = fields[field as string];
    const op = c.op;
    if (typeof op !== "string" || !(AUDIENCE_OPS as readonly string[]).includes(op)) {
      fail(`${at}.op ${JSON.stringify(op)} is not a valid operator (valid: ${AUDIENCE_OPS.join(", ")})`);
    }
    if (!spec.ops.includes(op)) {
      fail(`${at}: field "${field}" does not support op "${op}" (supported: ${spec.ops.join(", ")})`);
    }
    const out: AudienceCondition = { field: field as string, op };
    if (spec.kind === "keyed-string") {
      if (typeof c.key !== "string" || !c.key.trim()) fail(`${at}: field "${field}" needs a non-empty "key" (the Json key to read)`);
      out.key = c.key.trim();
    }
    const value = c.value;
    if (spec.kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) fail(`${at}: field "${field}" needs a numeric value (got ${JSON.stringify(value)})`);
      out.value = value;
    } else if (spec.kind === "boolean") {
      if (typeof value !== "boolean") fail(`${at}: field "${field}" needs a boolean value (got ${JSON.stringify(value)})`);
      out.value = value;
    } else {
      if (typeof value !== "string") fail(`${at}: field "${field}" needs a string value (got ${JSON.stringify(value)})`);
      out.value = value;
    }
    if (field === "rfm_segment" && !(RFM_SEGMENTS as readonly string[]).includes(String(out.value))) {
      fail(`${at}: rfm_segment must be one of ${RFM_SEGMENTS.join(", ")} (got ${JSON.stringify(out.value)})`);
    }
    return out;
  });
  return { entity: entity as AudienceEntity, match: match as AudienceMatch, conditions };
}

/** The per-row facts the evaluator reads. The resolver builds
 * these from the row + DB aggregates; any field may be null,
 * which makes conditions on it FALSE (see the module comment). */
export interface AudienceFacts {
  source: string | null;
  createdDaysAgo: number;
  hasEmail: boolean;
  hasPhone: boolean;
  customFields: Record<string, unknown> | null;
  // customers
  ordersCount?: number;
  totalSpentMinor?: number;
  lastOrderDaysAgo?: number | null;
  rfmSegment?: string | null;
  address?: Record<string, unknown> | null;
  // leads
  stage?: string | null;
  tags?: string[];
  valueMinor?: number | null;
}

function daysCompare(actual: number | null | undefined, op: string, expected: number): boolean {
  if (actual === null || actual === undefined || !Number.isFinite(actual)) return false;
  switch (op) {
    case "eq": return actual === expected;
    case "gt": return actual > expected;
    case "gte": return actual >= expected;
    case "lt": return actual < expected;
    case "lte": return actual <= expected;
    default: return false;
  }
}

function evaluateCondition(facts: AudienceFacts, c: AudienceCondition): boolean {
  switch (c.field) {
    case "source": {
      const actual = facts.source ?? "";
      return c.op === "eq" ? actual === String(c.value) : actual !== String(c.value);
    }
    case "created_days_ago":
      return daysCompare(facts.createdDaysAgo, c.op, Number(c.value));
    case "has_email":
      return facts.hasEmail === c.value;
    case "has_phone":
      return facts.hasPhone === c.value;
    case "custom_field": {
      const stored = facts.customFields?.[c.key as string];
      if (stored === undefined || stored === null) return false;
      const s = String(stored);
      return c.op === "eq" ? s === String(c.value) : s.includes(String(c.value));
    }
    case "address_key": {
      const addr = facts.address;
      if (!addr || typeof addr !== "object") return false;
      const stored = addr[c.key as string];
      if (stored === undefined || stored === null) return false;
      const s = String(stored);
      return c.op === "eq" ? s === String(c.value) : s.includes(String(c.value));
    }
    case "orders_count":
      return daysCompare(facts.ordersCount ?? 0, c.op, Number(c.value));
    case "total_spent_minor":
      return daysCompare(facts.totalSpentMinor ?? 0, c.op, Number(c.value));
    case "last_order_days_ago":
      return daysCompare(facts.lastOrderDaysAgo, c.op, Number(c.value));
    case "rfm_segment":
      return facts.rfmSegment != null && facts.rfmSegment === String(c.value);
    case "stage": {
      const actual = facts.stage ?? "";
      return c.op === "eq" ? actual === String(c.value) : actual !== String(c.value);
    }
    case "tag":
      return Array.isArray(facts.tags) && facts.tags.some((t) => String(t) === String(c.value));
    case "value_minor":
      return daysCompare(facts.valueMinor, c.op, Number(c.value));
    default:
      return false; // unreachable for a validated definition
  }
}

/** Pure evaluation: "all" = every condition, "any" = at least one.
 * An empty condition list matches the whole entity (the builder
 * saved no filters). */
export function matchesAudienceDefinition(def: AudienceDefinition, facts: AudienceFacts): boolean {
  if (!def.conditions.length) return true;
  return def.match === "any"
    ? def.conditions.some((c) => evaluateCondition(facts, c))
    : def.conditions.every((c) => evaluateCondition(facts, c));
}

/**
 * MS3 — parse a pasted CSV/plain address list for a csv audience.
 * Accepts one address per line or comma/semicolon-separated
 * values (a pasted spreadsheet column also works: tabs count as
 * separators), strips surrounding quotes, and de-duplicates
 * case-insensitively for email / by digits for phones. The
 * entries are returned RAW (trimmed); channel validation happens
 * at resolve time so invalid entries are counted (invalidCount),
 * never silently dropped here.
 */
export function parseAddressList(raw: unknown): string[] {
  let parts: string[] = [];
  if (Array.isArray(raw)) {
    parts = raw.flatMap((v) => String(v ?? "").split(/[\n,;\t]+/));
  } else if (typeof raw === "string") {
    parts = raw.split(/[\n,;\t]+/);
  } else if (raw !== null && raw !== undefined) {
    parts = [String(raw)];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const v = p.trim().replace(/^"+|"+$/g, "").trim();
    if (!v) continue;
    const key = v.includes("@") ? v.toLowerCase() : v.replace(/\D/g, "");
    const dedupeKey = key || v;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(v);
  }
  return out;
}
