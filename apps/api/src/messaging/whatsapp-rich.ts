import { catalogText, type ApiLocale } from "../i18n/catalog/send-locale";
/**
 * MX9 — WhatsApp Rich v2 pure helpers (no I/O, no prisma).
 *
 * Everything here works ONLY on data Meta actually returned and
 * the MS6 sync already stored on WhatsAppTemplate rows:
 *  - `category`    — Meta's category as returned by the
 *    message_templates list (MARKETING | UTILITY | AUTHENTICATION).
 *  - `qualityRating` — Meta's quality_score.score as returned
 *    (GREEN | YELLOW | RED | UNKNOWN), plus `status` (APPROVED |
 *    PENDING | REJECTED | …) and `lastSyncedAt`.
 *  - `components`  — Meta's components array, stored verbatim.
 *
 * Costs come ONLY from org-entered rates on MessagingSenderConfig.
 * Nothing in this module derives a price, a category, a rating or
 * a template kind from anything else.
 */

export const WA_TEMPLATE_CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
export type WaTemplateCategory = (typeof WA_TEMPLATE_CATEGORIES)[number];

export type WaTemplateKind = "carousel" | "catalog" | "flow" | "standard";

/**
 * Classify a template from its STORED components (either Meta's
 * sync format — lowercase `type` values as returned — or the
 * UPPERCASE create format authored at submit; both are matched
 * case-insensitively):
 *  - a CAROUSEL component                       → "carousel"
 *  - a CATALOG button (or CATALOG component)    → "catalog"
 *  - a FLOW button (type FLOW, or a button that
 *    carries flow_id / flow_name)               → "flow"
 *  - anything else (incl. no components at all) → "standard"
 * This is a display classification of real stored data only — it
 * never claims Meta approved or supports anything.
 */
export function templateKindFromComponents(components: unknown): WaTemplateKind {
  if (!Array.isArray(components)) return "standard";
  let hasCatalog = false;
  let hasFlow = false;
  const scanButtons = (buttons: unknown) => {
    if (!Array.isArray(buttons)) return;
    for (const b of buttons as any[]) {
      const t = String(b?.type ?? "").toUpperCase();
      if (t === "CATALOG") hasCatalog = true;
      if (t === "FLOW" || b?.flow_id != null || b?.flow_name != null) hasFlow = true;
    }
  };
  for (const c of components as any[]) {
    const t = String(c?.type ?? "").toUpperCase();
    if (t === "CAROUSEL") return "carousel";
    if (t === "CATALOG") hasCatalog = true;
    if (t === "BUTTONS") scanButtons(c?.buttons);
    if (t === "CAROUSEL" && Array.isArray(c?.cards)) {
      for (const card of c.cards) scanButtons((card?.components ?? []).find((x: any) => String(x?.type ?? "").toUpperCase() === "BUTTONS")?.buttons);
    }
  }
  if (hasCatalog) return "catalog";
  if (hasFlow) return "flow";
  return "standard";
}

/** The org-entered WhatsApp rates on a sender-config row. */
export interface WhatsAppRates {
  whatsappCostPerMessageMinor?: number | null;
  whatsappMarketingCostPerMessageMinor?: number | null;
  whatsappUtilityCostPerMessageMinor?: number | null;
  whatsappAuthenticationCostPerMessageMinor?: number | null;
}

const CATEGORY_RATE_FIELD: Record<WaTemplateCategory, keyof WhatsAppRates> = {
  MARKETING: "whatsappMarketingCostPerMessageMinor",
  UTILITY: "whatsappUtilityCostPerMessageMinor",
  AUTHENTICATION: "whatsappAuthenticationCostPerMessageMinor",
};

/**
 * Resolve the per-message rate for one template from ORG-ENTERED
 * rates only: the category rate when the template's real Meta
 * category is known AND that rate is set; otherwise the org's
 * flat WhatsApp rate; otherwise null (NO figure — never a guess).
 */
export function resolveWhatsAppRateMinor(
  rates: WhatsAppRates | null | undefined,
  category: string | null | undefined,
): { rateMinor: number | null; basis: "category" | "flat" | null; category: WaTemplateCategory | null } {
  const cat = (WA_TEMPLATE_CATEGORIES as readonly string[]).includes(String(category ?? ""))
    ? (category as WaTemplateCategory)
    : null;
  if (rates && cat) {
    const v = rates[CATEGORY_RATE_FIELD[cat]];
    if (Number.isInteger(v) && (v as number) >= 0) return { rateMinor: v as number, basis: "category", category: cat };
  }
  const flat = rates?.whatsappCostPerMessageMinor;
  if (Number.isInteger(flat) && (flat as number) >= 0) return { rateMinor: flat as number, basis: "flat", category: cat };
  return { rateMinor: null, basis: null, category: cat };
}

/**
 * MX9 quality guard decision. Blocks ONLY on real synced data:
 * Meta's own quality_score.score === "RED", or Meta's template
 * status === "REJECTED". A null rating (never synced / Meta did
 * not return one) NEVER blocks — the guard is inert without data,
 * exactly as the UI states.
 */
export function qualityGuardDecision(
  guardEnabled: boolean,
  template: { name?: string | null; qualityRating?: string | null; status?: string | null } | null | undefined,
  locale: ApiLocale = "bn",
): { blocked: boolean; reason: string | null } {
  if (!guardEnabled || !template) return { blocked: false, reason: null };
  const name = template.name ?? catalogText("messaging.unnamedTemplate", locale);
  if (String(template.status ?? "").toUpperCase() === "REJECTED") {
    return {
      blocked: true,
      reason: catalogText("messaging.qualityGuardRejected", locale, { name }),
    };
  }
  if (String(template.qualityRating ?? "").toUpperCase() === "RED") {
    return {
      blocked: true,
      reason: catalogText("messaging.qualityGuardRedRating", locale, { name }),
    };
  }
  return { blocked: false, reason: null };
}

export class CarouselValidationError extends Error {}

export interface CarouselCardInput {
  headerFormat: "image" | "video";
  /** Resumable Upload handle for the card's example media — the
   * same externally-obtained handle the MS6 image header needs. */
  headerHandle: string;
  bodyText: string;
  exampleValues?: string[];
  buttons?: { type: "url" | "quick_reply"; text: string; url?: string }[];
}

function cardBodyExamples(bodyText: string, exampleValues: string[] | undefined, cardNo: number, locale: ApiLocale = "bn"): string[][] | undefined {
  const idx = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const maxParam = idx.length ? Math.max(...idx) : 0;
  const values = Array.isArray(exampleValues) ? exampleValues.map((v) => String(v)) : [];
  if (maxParam > 0 && values.length !== maxParam) {
    throw new CarouselValidationError(catalogText("messaging.carouselParamExamples", locale, { card: cardNo, max: maxParam }));
  }
  return maxParam > 0 ? [values] : undefined;
}

/**
 * Build the CAROUSEL component in Meta's UPPERCASE create format
 * (template components docs: a carousel template carries a BODY
 * component plus { type: "CAROUSEL", cards: [{ components:
 * [HEADER(format IMAGE|VIDEO, example header_handle), BODY,
 * BUTTONS?] }] }, 2–10 cards, at most 2 buttons per card).
 * Validation mirrors the MS6 submit rules (Bengali errors, BEFORE
 * any Meta call): every card header is media, so every card needs
 * its Resumable Upload example handle — without one the card
 * cannot be authored honestly, exactly like the MS6 image header.
 */
export function buildCarouselComponent(cards: CarouselCardInput[], locale: ApiLocale = "bn"): Record<string, unknown> {
  if (!Array.isArray(cards) || cards.length < 2 || cards.length > 10) {
    throw new CarouselValidationError(catalogText("messaging.carouselCardsCount", locale));
  }
  const builtCards = cards.map((card, i) => {
    const cardNo = i + 1;
    if (card?.headerFormat !== "image" && card?.headerFormat !== "video") {
      throw new CarouselValidationError(catalogText("messaging.carouselHeaderFormat", locale, { card: cardNo }));
    }
    if (!card.headerHandle?.trim()) {
      throw new CarouselValidationError(catalogText("messaging.carouselHeaderHandle", locale, { card: cardNo }));
    }
    const bodyText = String(card.bodyText ?? "").trim();
    if (!bodyText) throw new CarouselValidationError(catalogText("messaging.carouselBodyRequired", locale, { card: cardNo }));
    const buttons = Array.isArray(card.buttons) ? card.buttons : [];
    if (buttons.length > 2) throw new CarouselValidationError(catalogText("messaging.carouselMaxButtons", locale, { card: cardNo }));
    for (const b of buttons) {
      if (!b?.text || String(b.text).length > 25) throw new CarouselValidationError(catalogText("messaging.carouselButtonText", locale, { card: cardNo }));
      if (b.type === "url" && !/^https?:\/\//i.test(String(b.url ?? ""))) {
        throw new CarouselValidationError(catalogText("messaging.carouselButtonUrl", locale, { card: cardNo }));
      }
      if (b.type !== "url" && b.type !== "quick_reply") throw new CarouselValidationError(catalogText("messaging.carouselButtonType", locale, { card: cardNo }));
    }
    const components: Record<string, unknown>[] = [
      {
        type: "HEADER",
        format: card.headerFormat.toUpperCase(),
        example: { header_handle: [String(card.headerHandle).trim()] },
      },
      {
        type: "BODY",
        text: bodyText,
        ...(cardBodyExamples(bodyText, card.exampleValues, cardNo, locale)
          ? { example: { body_text: cardBodyExamples(bodyText, card.exampleValues, cardNo, locale) } }
          : {}),
      },
    ];
    if (buttons.length) {
      components.push({
        type: "BUTTONS",
        buttons: buttons.map((b) => b.type === "url"
          ? { type: "URL", text: b.text, url: b.url }
          : { type: "QUICK_REPLY", text: b.text }),
      });
    }
    return { components };
  });
  return { type: "CAROUSEL", cards: builtCards };
}
