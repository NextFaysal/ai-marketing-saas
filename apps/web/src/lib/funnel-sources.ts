import { fmtNumBn } from "./money-bn";

/**
 * DX3 🚩 mini-fix: the CN16 funnel wizard's layer source
 * counts, from GET campaign-plans/audience-sources — the
 * org-level exposure of the SAME CN6 sourceCatalog the
 * plan-scoped Audience Studio embeds. This helper only
 * SHAPES the payload for display: which catalog entries a
 * funnel layer reads, and the honest state of each count
 * (real zero is a stated empty state; a null count means
 * the source could not be gathered and is shown as
 * unavailable — never dressed up as ০).
 */
export interface AudienceSourceEntry {
  key: string;
  source: string;
  segment?: string;
  label: string;
  available: boolean;
  reason?: string;
  contactCount: number | null;
}

export interface SourceCountView {
  key: string;
  /** Short display name used in the wizard (the API label is a full sentence). */
  shortLabel: string;
  count: number | null;
  /** ok = a real count > 0 · empty = real zero · unknown = not gatherable / absent */
  state: "ok" | "empty" | "unknown";
  /** One-line Bengali display text (count in bn-BD via money-bn). */
  text: string;
}

const SHORT_LABELS: Record<string, string> = {
  product_viewers: "Product Viewers",
  cart_abandoners: "Cart Abandoners",
  buyers: "আগের Buyers",
};

/** The catalog keys each funnel layer is built from
 *  (frontier.service resolveLayerAudiences). Prospecting
 *  reads no CN6 source — it is the owner's own targeting. */
export const FUNNEL_LAYER_SOURCE_KEYS: Record<"retargeting" | "retention", string[]> = {
  retargeting: ["product_viewers", "cart_abandoners"],
  retention: ["buyers"],
};

export function sourceCountView(sources: AudienceSourceEntry[] | null | undefined, key: string): SourceCountView {
  const shortLabel = SHORT_LABELS[key] ?? key;
  const entry = (sources ?? []).find((s) => s.key === key);
  if (!entry || entry.contactCount === null || entry.contactCount === undefined) {
    return { key, shortLabel, count: null, state: "unknown", text: `${shortLabel}: সংখ্যা পাওয়া যায়নি` };
  }
  if (entry.contactCount === 0) {
    return { key, shortLabel, count: 0, state: "empty", text: `${shortLabel}: ০ জন — এই Source-এ এখনো কেউ নেই` };
  }
  return { key, shortLabel, count: entry.contactCount, state: "ok", text: `${shortLabel}: ${fmtNumBn(entry.contactCount)} জন` };
}

export function layerSourceViews(
  sources: AudienceSourceEntry[] | null | undefined,
  layer: "retargeting" | "retention",
): SourceCountView[] {
  return FUNNEL_LAYER_SOURCE_KEYS[layer].map((key) => sourceCountView(sources, key));
}
