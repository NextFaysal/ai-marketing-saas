/**
 * CX8 (ক) Label scan — pure extraction parsing + validation.
 *
 * The vision model is asked for JSON of ONLY visibly printed values.
 * Whatever it returns is UNTRUSTED text: parsing is defensive
 * (fences stripped, first {...} span taken, JSON.parse in a
 * try/catch) and every field is shape-validated before it may drive
 * a lookup. Anything invalid is DROPPED, never repaired into a
 * plausible-looking value — a dropped field just means the human
 * searches manually with what remains.
 */

export interface LabelIdentifiers {
  trackingCode?: string;
  orderNumber?: string;
  phoneLast4?: string;
}

export const LABEL_SCAN_PROMPT = `You are reading a photo of a courier / parcel packing label. Extract ONLY the values that are visibly printed on the label — never guess, complete or invent a value that is not clearly readable.
Respond with strict JSON only:
{"trackingCode": string|null, "orderNumber": string|null, "phoneLast4": string|null}
- trackingCode: the courier tracking / consignment code printed on the label, exactly as printed.
- orderNumber: the shop's order number / invoice number printed on the label, exactly as printed.
- phoneLast4: ONLY the last 4 digits of the recipient phone number, if a phone number is printed. Never output more than these 4 digits.
Use null for anything not clearly visible.`;

/** Tracking / order identifiers: trimmed, alphanumeric-ish (letters,
 *  digits, dash, underscore, slash), 4–40 chars. Anything else —
 *  spaces inside, punctuation soup, oversized strings — is dropped. */
export function cleanIdentifier(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  if (v.length < 4 || v.length > 40) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_/]*$/.test(v)) return undefined;
  return v;
}

/** Exactly 4 ASCII digits — a 5-digit (or Bengali-digit) value is
 *  dropped, not truncated: truncating would silently invent a
 *  different customer's last-4. */
export function cleanPhoneLast4(raw: unknown): string | undefined {
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;
  const v = String(raw).trim();
  return /^\d{4}$/.test(v) ? v : undefined;
}

export function validateIdentifiers(raw: any): LabelIdentifiers {
  const out: LabelIdentifiers = {};
  if (!raw || typeof raw !== "object") return out;
  const trackingCode = cleanIdentifier(raw.trackingCode);
  if (trackingCode) out.trackingCode = trackingCode;
  const orderNumber = cleanIdentifier(raw.orderNumber);
  if (orderNumber) out.orderNumber = orderNumber;
  const phoneLast4 = cleanPhoneLast4(raw.phoneLast4);
  if (phoneLast4) out.phoneLast4 = phoneLast4;
  return out;
}

/** Loose JSON extraction (the media-intelligence parseJsonLoose
 *  pattern): strip code fences, take the outermost {...} span.
 *  Unparseable model output → {} — never a throw, never a guess. */
export function parseLabelExtraction(text: string): LabelIdentifiers {
  try {
    const cleaned = String(text ?? "").replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return {};
    return validateIdentifiers(JSON.parse(cleaned.slice(start, end + 1)));
  } catch {
    return {};
  }
}
