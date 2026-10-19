/**
 * MX7 — web helpers for the block email builder. Mirror of the
 * API's messaging/email-blocks.ts block SHAPE only: the web never
 * renders final email HTML itself — it edits the block list
 * (add / reorder / remove), asks the API's blocks/preview
 * endpoint for the rendered preview (brand kit + real catalog
 * rows applied server-side), and saves the blocks on the
 * template. Keeping rendering on the API guarantees the preview
 * is byte-identical to what a send will use.
 */
import type { UiLocale } from "./i18n/dict";
import { sharedBn, sharedEn } from "./i18n/shared";

/** MB2 F2: block labels resolve through the `shared` namespace;
 * the BN record below stays the pinned bn source. */
const SD = (locale: UiLocale = "bn"): typeof sharedBn =>
  locale === "en" ? sharedEn : sharedBn;

export type EmailBlockType = "text" | "image" | "button" | "product" | "coupon" | "divider";

export interface EmailBlock {
  type: EmailBlockType;
  text?: string;
  align?: "left" | "center" | "right";
  url?: string;
  alt?: string;
  linkUrl?: string;
  label?: string | null;
  productId?: string | null;
  discountId?: string | null;
  code?: string | null;
}

/** Block type labels per locale. */
export function blockLabelsFor(locale: UiLocale = "bn"): Record<EmailBlockType, string> {
  const d = SD(locale);
  return {
    text: d.ebText,
    image: d.ebImage,
    button: d.ebButton,
    product: d.ebProduct,
    coupon: d.ebCoupon,
    divider: d.ebDivider,
  };
}

export const BLOCK_LABELS_BN: Record<EmailBlockType, string> = blockLabelsFor("bn");

export function newEmailBlock(type: EmailBlockType): EmailBlock {
  switch (type) {
    case "text": return { type, text: "" };
    case "image": return { type, url: "", alt: "" };
    case "button": return { type, label: "", url: "" };
    case "product": return { type, productId: null };
    case "coupon": return { type, discountId: null, code: null, label: null };
    case "divider": return { type };
  }
}

/** Drag/reorder primitive (also driven by the ↑/↓ buttons for
 * keyboard/touch users — HTML5 drag alone is not accessible). */
export function moveBlock(blocks: EmailBlock[], from: number, to: number): EmailBlock[] {
  if (from === to || from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return blocks;
  const next = [...blocks];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Strip empty optional fields before save so the stored block
 * matches the API's normalized shape. */
export function cleanBlock(b: EmailBlock): EmailBlock {
  const out: EmailBlock = { type: b.type };
  if (b.type === "text") { out.text = b.text ?? ""; if (b.align) out.align = b.align; }
  if (b.type === "image") { out.url = b.url ?? ""; if (b.alt) out.alt = b.alt; if (b.linkUrl) out.linkUrl = b.linkUrl; }
  if (b.type === "button") { out.label = b.label ?? ""; out.url = b.url ?? ""; }
  if (b.type === "product") out.productId = b.productId ?? null;
  if (b.type === "coupon") { out.discountId = b.discountId ?? null; out.code = b.code || null; out.label = b.label || null; }
  return out;
}

export const BRAND_FONT_OPTIONS: { key: string; labelBn: string; labelEn: string }[] = [
  { key: "hind-siliguri", labelBn: "Hind Siliguri (বাংলা)", labelEn: "Hind Siliguri (Bengali)" },
  { key: "noto-sans-bengali", labelBn: "Noto Sans Bengali (বাংলা)", labelEn: "Noto Sans Bengali (Bengali)" },
  { key: "arial", labelBn: "Arial", labelEn: "Arial" },
  { key: "georgia", labelBn: "Georgia", labelEn: "Georgia" },
  { key: "verdana", labelBn: "Verdana", labelEn: "Verdana" },
];

/** Font options with a single resolved `label` for the locale. */
export function brandFontOptionsFor(locale: UiLocale = "bn"): { key: string; label: string }[] {
  return BRAND_FONT_OPTIONS.map((f) => ({
    key: f.key,
    label: locale === "en" ? f.labelEn : f.labelBn,
  }));
}
