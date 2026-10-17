/**
 * MX8 — per-recipient dynamic personalization: the PURE half.
 *
 * Audit summary (full evidence in docs/messaging-mx8-acceptance.md):
 *  - Broadcasts render per recipient in ONE place: sendToRecipient
 *    substitutes {{variables}} into the broadcast's stored
 *    body/htmlBody/subject from the recipient's prepare-time vars
 *    (MS5). MX8 therefore personalizes by (a) extending those vars
 *    at prepare time (loyalty / gift-card balances — service side)
 *    and (b) computing per-recipient CONTENT at send time in the
 *    two broadcast engines (this module's pure helpers + the
 *    service's data reads): a recommendation block, a unique
 *    coupon variable and segment-conditional blocks. Workflow
 *    sends never pass through the broadcast engines, so the MS5/
 *    MS7 pins ("workflow sends are NEVER rewritten") are
 *    structurally untouched.
 *  - The org coupon store is StoreDiscount (org-scoped, unique
 *    code per org, usageLimit/usedCount + perCustomerLimit
 *    enforced by the checkout evaluator — see the acceptance
 *    doc). The platform Coupon model is plan-billing only and is
 *    NOT used. A unique MX8 coupon is a StoreDiscount row with
 *    usageLimit 1 AND perCustomerLimit 1, origin
 *    "messaging_unique", sourceRef = the broadcast id (the GB7 /
 *    referral-reward provenance pattern).
 *
 * Everything here is deterministic and DB-free: the service
 * hands in real rows, this module decides and formats. Nothing
 * is invented — a recipient with no usable signal gets the
 * org-authored fallback text or nothing at all.
 */
import { validateAudienceDefinition, type AudienceDefinition } from "./audience-rules";
import { escapeHtml, formatPriceMinor } from "./composer-blocks";

export class PersonalizationConfigError extends Error {}

export interface UniqueCouponConfig {
  kind: "percent" | "fixed" | "free_shipping";
  /** percent 1..90 | fixed minor units >= 1 | 0 for free_shipping */
  value: number;
  expiryDays: number;
  /** code prefix, normalized [A-Z0-9-], max 12 chars */
  prefix: string;
}

export interface RecommendationConfig {
  enabled: boolean;
  /** max products in the block, 1..5 (default 3) */
  limit: number;
  heading?: string | null;
  /** org-authored text shown when a recipient has NO usable
   * signal (no purchase history, no identified browsing). Null =
   * the block renders empty for that recipient. Never a product. */
  fallbackText?: string | null;
}

export interface SegmentBlockConfig {
  /** a MessagingSavedAudience id of this org (checked at create) */
  savedAudienceId?: string | null;
  /** OR an inline MS3 audience definition (validated strictly) */
  definition?: AudienceDefinition | null;
  body: string;
  htmlBody?: string | null;
}

export interface PersonalizationConfig {
  uniqueCoupon?: UniqueCouponConfig | null;
  recommendations?: RecommendationConfig | null;
  segmentBlocks?: SegmentBlockConfig[];
}

/** The variable a unique-coupon broadcast's body references. */
export const UNIQUE_COUPON_VARIABLE = "uniqueCouponCode";
/** MX8 balance variables (prepare-time, from the real ledgers). */
export const LOYALTY_POINTS_VARIABLE = "loyaltyPoints";
export const GIFT_CARD_BALANCE_VARIABLE = "giftCardBalance";

const COUPON_KINDS = ["percent", "fixed", "free_shipping"] as const;

function fail(message: string): never {
  throw new PersonalizationConfigError(message);
}

/**
 * Strictly validate + normalize an untrusted personalization
 * config (the createBroadcast `personalization` input). Unknown
 * keys are ignored only at the top level of each section; every
 * VALUE is checked — a bad shape is a 400 at create, never a
 * silent reinterpretation at send time (the cascade/recurrence
 * precedent).
 */
export function parsePersonalizationConfig(raw: unknown): PersonalizationConfig | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) fail("personalization must be an object");
  const input = raw as Record<string, unknown>;
  const out: PersonalizationConfig = {};

  const uc = input.uniqueCoupon;
  if (uc !== null && uc !== undefined) {
    if (typeof uc !== "object" || Array.isArray(uc)) fail("personalization.uniqueCoupon must be an object");
    const u = uc as Record<string, unknown>;
    const kind = String(u.kind ?? "");
    if (!(COUPON_KINDS as readonly string[]).includes(kind)) {
      fail(`personalization.uniqueCoupon.kind must be percent, fixed or free_shipping (got ${JSON.stringify(u.kind)})`);
    }
    let value = 0;
    if (kind === "percent") {
      if (!Number.isInteger(u.value) || (u.value as number) < 1 || (u.value as number) > 90) {
        fail("personalization.uniqueCoupon.value for a percent coupon must be an integer 1..90");
      }
      value = u.value as number;
    } else if (kind === "fixed") {
      if (!Number.isInteger(u.value) || (u.value as number) < 1) {
        fail("personalization.uniqueCoupon.value for a fixed coupon must be a positive integer (minor units)");
      }
      value = u.value as number;
    }
    const expiryDays = u.expiryDays === undefined || u.expiryDays === null ? 30 : u.expiryDays;
    if (!Number.isInteger(expiryDays) || (expiryDays as number) < 1 || (expiryDays as number) > 365) {
      fail("personalization.uniqueCoupon.expiryDays must be an integer 1..365");
    }
    const prefixRaw = u.prefix === undefined || u.prefix === null ? "MX" : String(u.prefix);
    const prefix = prefixRaw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!prefix || prefix.length > 12) fail("personalization.uniqueCoupon.prefix must be 1..12 characters of A-Z, 0-9 or -");
    out.uniqueCoupon = { kind: kind as UniqueCouponConfig["kind"], value, expiryDays: expiryDays as number, prefix };
  }

  const rec = input.recommendations;
  if (rec !== null && rec !== undefined) {
    if (typeof rec !== "object" || Array.isArray(rec)) fail("personalization.recommendations must be an object");
    const r = rec as Record<string, unknown>;
    const limit = r.limit === undefined || r.limit === null ? 3 : r.limit;
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 5) {
      fail("personalization.recommendations.limit must be an integer 1..5");
    }
    const heading = r.heading === undefined || r.heading === null ? null : String(r.heading);
    if (heading !== null && heading.length > 200) fail("personalization.recommendations.heading is too long (max 200 characters)");
    const fallbackText = r.fallbackText === undefined || r.fallbackText === null ? null : String(r.fallbackText);
    if (fallbackText !== null && fallbackText.length > 2000) fail("personalization.recommendations.fallbackText is too long (max 2000 characters)");
    out.recommendations = { enabled: r.enabled !== false, limit: limit as number, heading, fallbackText };
  }

  const sb = input.segmentBlocks;
  if (sb !== null && sb !== undefined) {
    if (!Array.isArray(sb)) fail("personalization.segmentBlocks must be an array");
    if (sb.length > 10) fail("personalization.segmentBlocks allows at most 10 blocks");
    out.segmentBlocks = sb.map((rawBlock, i) => {
      const at = `personalization.segmentBlocks[${i}]`;
      if (!rawBlock || typeof rawBlock !== "object" || Array.isArray(rawBlock)) fail(`${at} must be an object`);
      const b = rawBlock as Record<string, unknown>;
      const hasSaved = typeof b.savedAudienceId === "string" && b.savedAudienceId.trim() !== "";
      const hasDef = b.definition !== null && b.definition !== undefined;
      if (hasSaved === hasDef) fail(`${at}: give exactly one of savedAudienceId or definition`);
      if (typeof b.body !== "string" || !b.body.trim()) fail(`${at}: body is required (the text shown to members of the segment)`);
      if (b.body.length > 5000) fail(`${at}: body is too long (max 5000 characters)`);
      if (b.htmlBody !== undefined && b.htmlBody !== null && typeof b.htmlBody !== "string") fail(`${at}: htmlBody must be a string`);
      if (typeof b.htmlBody === "string" && b.htmlBody.length > 20000) fail(`${at}: htmlBody is too long (max 20000 characters)`);
      let definition: AudienceDefinition | null = null;
      if (hasDef) {
        try { definition = validateAudienceDefinition(b.definition); }
        catch (e) { fail(`${at}.definition: ${e instanceof Error ? e.message : "invalid audience definition"}`); }
      }
      return {
        ...(hasSaved ? { savedAudienceId: String(b.savedAudienceId).trim() } : {}),
        ...(definition ? { definition } : {}),
        body: b.body,
        htmlBody: typeof b.htmlBody === "string" ? b.htmlBody : null,
      } as SegmentBlockConfig;
    });
  }

  if (!out.uniqueCoupon && !out.recommendations && !(out.segmentBlocks && out.segmentBlocks.length)) {
    fail("personalization configures nothing — set uniqueCoupon, recommendations and/or segmentBlocks, or omit it");
  }
  return out;
}

/** Read a stored config back (broadcast row Json). A stored value
 * that no longer parses reads as null — the send then behaves
 * exactly like a pre-MX8 broadcast instead of failing mid-send
 * (the readCascadeConfig precedent). */
export function readPersonalizationConfig(stored: unknown): PersonalizationConfig | null {
  if (stored === null || stored === undefined) return null;
  try { return parsePersonalizationConfig(stored); } catch { return null; }
}

/**
 * A unique coupon code: `<PREFIX>-<10 hex chars>` from random
 * bytes the SERVICE supplies (crypto randomness stays at the
 * service edge so this stays pure + spec-deterministic). The
 * StoreDiscount @@unique([organizationId, code]) constraint is
 * the collision backstop; the service retries with fresh bytes.
 */
export function buildUniqueCouponCode(prefix: string, randomHex: string): string {
  const suffix = String(randomHex ?? "").toUpperCase().replace(/[^0-9A-F]/g, "").slice(0, 10);
  return `${prefix}-${suffix}`;
}

export interface RecommendationProduct {
  id: string;
  name: string;
  priceMinor: bigint | number | string;
  currency: string;
  url?: string | null;
  category?: string | null;
}

export interface RecommendationResult {
  products: RecommendationProduct[];
  /** which real signal produced the list (for the per-recipient
   * record): the recipient's most recent purchased category, or
   * their identified browsing (viewed categories). */
  signal: "purchase_category" | "browsing_category" | "none";
  category: string | null;
}

/**
 * The deterministic recommendation rule (no ML, no invented
 * affinity):
 *  1. Purchase signal: the category of the recipient's MOST
 *     RECENT purchased product (the service hands purchases in
 *     recency order) → in-stock ACTIVE catalog products of that
 *     category, excluding products the recipient already bought,
 *     in the catalog order the service supplied.
 *  2. Browsing fallback: the recipient's most recently VIEWED
 *     category (identified-visitor events only — the service
 *     resolves the visitor by the recipient's own email/phone)
 *     → same catalog rule, excluding purchased products when
 *     the purchase history is known.
 *  3. No usable signal, or the signal category has no eligible
 *     product → signal "none", empty list. The caller renders
 *     the org's fallback text or nothing — NEVER a substitute
 *     product from another category.
 */
export function pickRecommendations(input: {
  /** the recipient's purchased catalog products, most recent first */
  purchased: { productId: string; category: string | null }[];
  /** categories the identified visitor viewed, most recent first */
  browsedCategories: (string | null)[];
  /** the org's in-stock ACTIVE catalog, in service-chosen order */
  catalog: RecommendationProduct[];
  limit: number;
}): RecommendationResult {
  const limit = Math.max(1, Math.min(5, Math.floor(input.limit) || 3));
  const purchasedIds = new Set(input.purchased.map((p) => p.productId));
  const byCategory = (category: string) =>
    input.catalog.filter((p) => p.category === category && !purchasedIds.has(p.id)).slice(0, limit);

  const purchaseCategory = input.purchased.find((p) => p.category)?.category ?? null;
  if (purchaseCategory) {
    const products = byCategory(purchaseCategory);
    if (products.length) return { products, signal: "purchase_category", category: purchaseCategory };
  }
  const browseCategory = input.browsedCategories.find((c) => c) ?? null;
  if (browseCategory) {
    const products = byCategory(browseCategory);
    if (products.length) return { products, signal: "browsing_category", category: browseCategory };
  }
  return { products: [], signal: "none", category: null };
}

/** Render the recommendation block into the EXISTING send
 * formats (plain text + HTML part), with the same price
 * formatting and escaping discipline as the MX7 blocks. An
 * empty product list renders the org's fallback text (or
 * nothing) — the caller decides via `fallbackText`. */
export function renderRecommendationBlock(
  result: RecommendationResult,
  cfg: RecommendationConfig,
): { text: string; html: string } {
  if (!result.products.length) {
    const fb = (cfg.fallbackText ?? "").trim();
    if (!fb) return { text: "", html: "" };
    return { text: fb, html: `<p>${escapeHtml(fb).replace(/\n/g, "<br>")}</p>` };
  }
  const heading = (cfg.heading ?? "").trim();
  const textLines: string[] = [];
  if (heading) textLines.push(heading);
  for (const p of result.products) {
    const line = `${p.name} — ${formatPriceMinor(p.priceMinor, p.currency)}`;
    textLines.push(p.url ? `${line}\n${p.url}` : line);
  }
  const htmlParts: string[] = [];
  if (heading) htmlParts.push(`<p><strong>${escapeHtml(heading)}</strong></p>`);
  for (const p of result.products) {
    const name = p.url ? `<a href="${escapeHtml(p.url)}">${escapeHtml(p.name)}</a>` : escapeHtml(p.name);
    htmlParts.push(`<p>${name} — ${formatPriceMinor(p.priceMinor, p.currency)}</p>`);
  }
  return { text: textLines.join("\n"), html: htmlParts.join("\n") };
}

/**
 * Apply segment-conditional blocks + the recommendation block to
 * a broadcast's stored content for ONE recipient. Segment blocks
 * (already filtered to the ones this recipient is a member of —
 * membership is the service's MS3 evaluation) and the
 * recommendation block APPEND to the body, in config order:
 * nothing the org authored for everyone is ever removed, and a
 * non-member's message is byte-identical to the stored content.
 * The personalized text still passes through the normal
 * {{variable}} substitution afterwards (sendToRecipient), so a
 * segment block may itself use recipient variables.
 */
export function applyDynamicBlocks(input: {
  body: string;
  htmlBody?: string | null;
  memberBlocks: SegmentBlockConfig[];
  recommendation?: { text: string; html: string } | null;
}): { body: string; htmlBody: string | null } {
  let body = input.body;
  let htmlBody = input.htmlBody ?? null;
  const append = (text: string, html: string) => {
    if (text) body = body ? `${body}\n\n${text}` : text;
    if (htmlBody !== null && html) htmlBody = `${htmlBody}\n${html}`;
  };
  for (const block of input.memberBlocks) {
    // A block without an authored HTML part still has to reach
    // HTML-part recipients: its text is escaped into a paragraph
    // (the MX7 text-block rule — org text can never inject HTML).
    append(block.body, block.htmlBody ?? `<p>${escapeHtml(block.body).replace(/\n/g, "<br>")}</p>`);
  }
  if (input.recommendation) append(input.recommendation.text, input.recommendation.html);
  return { body, htmlBody };
}
