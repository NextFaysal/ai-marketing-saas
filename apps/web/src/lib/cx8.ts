import { inboxBn, inboxEn } from "./i18n/inbox";
/**
 * CX8 (Packing Label Scan + Image Product Recognition) — web-side
 * pure helpers. Everything here is display/draft logic only: the
 * label scan NEVER auto-opens an order from a phone-last4 narrowing
 * (candidates are a human pick-list), and the product-match insert
 * only PREFILLS the composer — it never sends.
 */

export interface LabelMatchView {
  orderId: string;
  orderNumber: string | null;
  orderStatus: string | null;
  shipmentId: string | null;
  trackingCode: string | null;
  provider: string | null;
  shipmentStatus: string | null;
}

export interface LabelCandidateView extends LabelMatchView {
  phoneLast4: string;
}

export interface LabelScanResultView {
  available: boolean;
  reason?: string;
  message?: string;
  extracted: { trackingCode?: string; orderNumber?: string; phoneLast4?: string };
  matched: LabelMatchView | null;
  candidates: LabelCandidateView[];
}

/** The honesty wording that must ship verbatim in the recognition
 *  panel: this is description-text matching, NOT image similarity. */
export const PRODUCT_MATCH_HONESTY = inboxBn.productMatchHonesty;
export const productMatchHonesty = (locale?: string): string => (locale === "en" ? inboxEn : inboxBn).productMatchHonesty;

/** Vision-unavailable line for both CX8 surfaces. */
export const VISION_UNAVAILABLE_TEXT = inboxBn.visionUnavailable;
export const visionUnavailableText = (locale?: string): string => (locale === "en" ? inboxEn : inboxBn).visionUnavailable;

/** Human summary of what the scan extracted — shown especially in
 *  the no-match state so the human can search manually with the
 *  very values the AI read (never hidden, never embellished). */
export function extractedSummary(result: LabelScanResultView, locale: "bn" | "en" = "bn"): string {
  const dd = locale === "en" ? inboxEn : inboxBn;
  const parts: string[] = [];
  if (result.extracted.trackingCode) parts.push(`Tracking: ${result.extracted.trackingCode}`);
  if (result.extracted.orderNumber) parts.push(`${dd.extractedOrderNumber}: ${result.extracted.orderNumber}`);
  if (result.extracted.phoneLast4) parts.push(`${dd.extractedPhoneLast4}: ${result.extracted.phoneLast4}`);
  return parts.join(" · ");
}

/** Only an exact single match may be "opened" directly; a
 *  candidate list (phone narrowing) always needs a human pick. */
export function canAutoOpen(result: LabelScanResultView): boolean {
  return Boolean(result.matched) && result.candidates.length === 0;
}

export interface ProductCandidateView {
  productId: string;
  name: string;
  priceMinor: string;
  priceText: string;
  currency: string;
  imageUrl: string | null;
  score: number;
  reasons: string[];
}

/**
 * The composer draft inserted by the agent's ONE click on a
 * candidate. Built only from the REAL product row the API returned
 * (name + the server-formatted price text) — and it is a draft:
 * the agent reviews and presses send themselves. This flow never
 * auto-sends and never messages the customer on its own.
 */
export function productMatchDraftText(candidate: ProductCandidateView, locale: "bn" | "en" = "bn"): string {
  const dd = locale === "en" ? inboxEn : inboxBn;
  return locale === "en" ? `"${candidate.name}" — ${dd.draftPriceWord} ${candidate.priceText}.` : `"${candidate.name}" — ${dd.draftPriceWord} ${candidate.priceText}।`;
}
