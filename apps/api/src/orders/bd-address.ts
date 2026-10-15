import { BD_DISTRICT_ENTRIES, BD_THANA_ENTRIES } from "./bd-address-data";

/**
 * ON11 — parse a free-text Bangladeshi address into a district
 * (+ thana when one is recognised), with an honest confidence.
 *
 * Rules (see the package plan):
 * - text is normalized (lowercase, whitespace collapsed) before
 *   matching; Bengali terms match as substrings; English terms
 *   of length <= 4 need a word boundary so "Gaz" style fragments
 *   and substrings of longer words never fire.
 * - a district term immediately followed/preceded (within ~12
 *   chars) by "জেলা" / "district" / "zila" is EXPLICIT.
 * - a matched thana pins its district (people write their thana
 *   more reliably than a stray district word) unless the district
 *   match is explicit, in which case the district wins.
 * - confidence: high = explicit marker, or district + a thana
 *   of that same district; medium = plain district, or thana-
 *   inferred district; low = nothing, or an unresolved conflict
 *   (district is null then).
 * The canonical district returned is the English canonical name
 * (listV2's district filter compares case-insensitively against
 * Customer.address.district).
 */

export interface BdAddressParse {
  district: string | null;
  thana: string | null;
  confidence: "high" | "medium" | "low";
  matchedTerms: string[];
}

interface Hit {
  term: string; // the alias exactly as written in the data
  idx: number;
}

interface DistrictHit extends Hit {
  district: string;
  explicit: boolean;
}

interface ThanaHit extends Hit {
  thana: string;
  district: string;
}

const MARKERS = ["জেলা", "district", "zila"];

function isAsciiTerm(term: string): boolean {
  return /^[\x00-\x7F]*$/.test(term);
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[a-z0-9]/.test(ch);
}

/** First index of `term` in `text` honouring the short-term
 * word-boundary rule, or -1. */
function findTerm(text: string, term: string): number {
  if (!term) return -1;
  const shortAscii = isAsciiTerm(term) && term.length <= 4;
  let from = 0;
  for (;;) {
    const idx = text.indexOf(term, from);
    if (idx < 0) return -1;
    if (!shortAscii) return idx;
    const before = idx > 0 ? text[idx - 1] : undefined;
    const after = text[idx + term.length];
    if (!isWordChar(before) && !isWordChar(after)) return idx;
    from = idx + 1;
  }
}

function isExplicit(text: string, idx: number, termLength: number): boolean {
  const before = text.slice(Math.max(0, idx - 12), idx);
  const after = text.slice(idx + termLength, idx + termLength + 12);
  return MARKERS.some((m) => before.includes(m) || after.includes(m));
}

export function parseBdAddress(input: unknown): BdAddressParse {
  const text = String(input ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return { district: null, thana: null, confidence: "low", matchedTerms: [] };

  const districtHits: DistrictHit[] = [];
  for (const entry of BD_DISTRICT_ENTRIES) {
    const terms = [entry.canonical, ...entry.variants, ...entry.bn];
    const seen = new Set<string>();
    for (const rawTerm of terms) {
      const term = rawTerm.toLowerCase().replace(/\s+/g, " ").trim();
      if (!term || seen.has(term)) continue;
      seen.add(term);
      const idx = findTerm(text, term);
      if (idx >= 0) {
        districtHits.push({
          term: rawTerm, idx, district: entry.canonical,
          explicit: isExplicit(text, idx, term.length),
        });
      }
    }
  }

  const thanaHits: ThanaHit[] = [];
  for (const entry of BD_THANA_ENTRIES) {
    const terms = entry.bn ? [entry.name, entry.bn] : [entry.name];
    for (const rawTerm of terms) {
      const term = rawTerm.toLowerCase().replace(/\s+/g, " ").trim();
      if (!term) continue;
      const idx = findTerm(text, term);
      if (idx >= 0) thanaHits.push({ term: rawTerm, idx, thana: entry.name, district: entry.district });
    }
  }

  const matchedTerms: string[] = [];
  const allHits = [...districtHits, ...thanaHits].sort((a, b) => a.idx - b.idx);
  for (const h of allHits) if (!matchedTerms.includes(h.term)) matchedTerms.push(h.term);

  const districtSet = [...new Set(districtHits.map((h) => h.district))];
  const explicitSet = [...new Set(districtHits.filter((h) => h.explicit).map((h) => h.district))];
  const thanaDistricts = [...new Set(thanaHits.map((h) => h.district))];
  const earliestThanaOf = (district: string): string | null =>
    [...thanaHits].filter((h) => h.district === district).sort((a, b) => a.idx - b.idx)[0]?.thana ?? null;

  const done = (district: string | null, thana: string | null, confidence: BdAddressParse["confidence"]): BdAddressParse =>
    ({ district, thana, confidence, matchedTerms });

  // --- Explicit district marker: the strongest signal. ---
  if (explicitSet.length === 1) {
    const district = explicitSet[0];
    // Thana survives only when it belongs to the explicit district.
    return done(district, earliestThanaOf(district), "high");
  }
  if (explicitSet.length > 1) return done(null, null, "low");

  // --- Thana-led resolution. ---
  if (thanaHits.length > 0) {
    // Thanas consistent with a matched district disambiguate
    // shared thana names (e.g. Kotwali exists in many districts).
    const consistent = thanaHits.filter((h) => districtSet.includes(h.district));
    if (consistent.length > 0) {
      const consistentDistricts = [...new Set(consistent.map((h) => h.district))];
      if (consistentDistricts.length === 1) {
        const district = consistentDistricts[0];
        return done(district, earliestThanaOf(district), "high");
      }
      return done(null, null, "low");
    }
    if (thanaDistricts.length === 1) {
      const district = thanaDistricts[0];
      // A plain district match that AGREES was handled above
      // (consistent); a plain district match that DISAGREES is
      // stray — the thana's district wins (medium: inferred).
      return done(district, earliestThanaOf(district), "medium");
    }
    // Ambiguous thanas (different districts, none consistent):
    // a single plain district match still stands on its own.
    if (districtSet.length === 1) return done(districtSet[0], null, "medium");
    return done(null, null, "low");
  }

  // --- District only. ---
  if (districtSet.length === 1) return done(districtSet[0], null, "medium");
  if (districtSet.length > 1) return done(null, null, "low");
  return done(null, null, "low");
}
