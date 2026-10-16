import { normalizeDistrictName } from "./fraud-rules.service";

/**
 * GB3 (GC8): COD trust rules — pure evaluation over the org's
 * BusinessProfile COD fields, exported for the parity spec
 * (all three checkout surfaces must judge COD identically).
 *
 * Rules:
 *  - refused "max": codMaxOrderMinor set and total > max.
 *  - District candidate: the structured district when present,
 *    else the parsed district ONLY at high|medium confidence
 *    (a low-confidence parse never blocks a shopper).
 *    refused "district": the candidate, normalized
 *    (lowercase/trim/collapse spaces), matches a blocked entry
 *    normalized the same way.
 *  - advanceRequired: threshold set and total > threshold.
 * No rules set → { refused: null, advanceRequired: false }.
 */

export interface CodRuleProfile {
  codMaxOrderMinor?: bigint | string | number | null;
  codAdvanceRequiredAboveMinor?: bigint | string | number | null;
  codBlockedDistricts?: unknown;
}

export interface CodRuleInput {
  totalMinor: bigint;
  district: string | null;
  parsedDistrict: string | null;
  parsedConfidence: string | null;
}

function toBigIntOrNull(value: unknown): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

export function evaluateCodRules(
  profile: CodRuleProfile | null | undefined,
  input: CodRuleInput,
): { refused: "max" | "district" | null; advanceRequired: boolean; districtUsed: string | null } {
  const p = profile ?? {};
  let total: bigint | null = null;
  try { total = BigInt(input.totalMinor as any); } catch { total = null; }

  const structured = String(input.district ?? "").trim() ? String(input.district).trim() : null;
  const confidence = String(input.parsedConfidence ?? "");
  const parsed = ["high", "medium"].includes(confidence) && String(input.parsedDistrict ?? "").trim()
    ? String(input.parsedDistrict).trim()
    : null;
  const districtUsed = structured ?? parsed;

  let refused: "max" | "district" | null = null;
  const max = toBigIntOrNull(p.codMaxOrderMinor);
  if (max !== null && total !== null && total > max) refused = "max";

  if (refused === null && districtUsed && Array.isArray(p.codBlockedDistricts)) {
    const candidate = normalizeDistrictName(districtUsed);
    const blocked = (p.codBlockedDistricts as unknown[])
      .map((d) => normalizeDistrictName(d))
      .filter(Boolean);
    if (candidate && blocked.includes(candidate)) refused = "district";
  }

  const threshold = toBigIntOrNull(p.codAdvanceRequiredAboveMinor);
  const advanceRequired = threshold !== null && total !== null && total > threshold;

  return { refused, advanceRequired, districtUsed };
}
