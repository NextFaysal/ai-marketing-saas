/**
 * MX7 — block-based email builder: the pure block engine.
 *
 * Audit note (see docs/messaging-mx7-acceptance.md): the pre-MX7
 * `composer-blocks.ts` is NOT a block engine — it only formats
 * product/coupon snippets that are inserted as plain text into
 * body/htmlBody. MX7 adds a real block model here, with one hard
 * rule: a block template's rendered output is written into the
 * SAME MessageTemplate.body / htmlBody fields the existing send
 * path already renders (renderTemplate + stored broadcast copy).
 * There is no second send path and no block rendering at send
 * time for broadcasts — rendering happens when a template is
 * saved and again when a broadcast is created FROM a block
 * template (use time), so an already-created broadcast (and every
 * already-sent message) keeps the exact bytes it was created
 * with, whatever the brand kit or catalog does afterwards.
 *
 * Honesty rules carried over from MS5:
 *  - a product block renders ONLY from a real Product row handed
 *    in by the caller (name + priceMinor/currency + slug URL
 *    rule identical to composer-blocks.ts); a missing/deleted
 *    product or an unfilled slot renders NOTHING (empty slot),
 *    never a sample product or an invented price;
 *  - a coupon block renders ONLY from a real StoreDiscount row
 *    handed in by the caller, or from an org-authored free-text
 *    code (the MS5 snippet semantics — text only, the system
 *    does not validate/redeem it); an unfilled slot or a missing
 *    discount renders NOTHING;
 *  - every interpolated value is HTML-escaped in the HTML part.
 */
import { escapeHtml, formatPriceMinor } from "./composer-blocks";

export const EMAIL_BLOCK_TYPES = ["text", "image", "button", "product", "coupon", "divider"] as const;
export type EmailBlockType = (typeof EMAIL_BLOCK_TYPES)[number];

export interface EmailBlock {
  type: EmailBlockType;
  /** text */
  text?: string;
  align?: "left" | "center" | "right";
  /** image / button link target */
  url?: string;
  alt?: string;
  linkUrl?: string;
  /** button label / coupon label */
  label?: string | null;
  /** product slot: a real Product id, or null = unfilled slot */
  productId?: string | null;
  /** coupon slot: a real StoreDiscount id, or null = unfilled slot */
  discountId?: string | null;
  /** coupon free-text code (MS5 semantics — org-authored text) */
  code?: string | null;
}

/** MX7 brand kit — sourced from the Organization row's Org
 * Settings branding (M59 logo/primaryColor + MX7 font/secondary
 * color). This interface is the render-time snapshot shape; the
 * service builds it from the org row, never from a second store. */
export interface BrandKit {
  brandName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  font?: string | null;
}

/** Font allowlist for the brand kit (keys stored on the org row;
 * values are CSS font-family stacks). Free-text fonts are refused
 * so a kit value can never inject arbitrary CSS into email HTML. */
export const BRAND_FONT_STACKS: Record<string, string> = {
  "hind-siliguri": "'Hind Siliguri','Noto Sans Bengali',Arial,sans-serif",
  "noto-sans-bengali": "'Noto Sans Bengali',Arial,sans-serif",
  arial: "Arial,Helvetica,sans-serif",
  georgia: "Georgia,'Times New Roman',serif",
  verdana: "Verdana,Geneva,sans-serif",
};
export const BRAND_FONT_KEYS = Object.keys(BRAND_FONT_STACKS);

const HEX = /^#[0-9a-fA-F]{6}$/;
export function brandColor(value: string | null | undefined, fallback: string): string {
  return value && HEX.test(value) ? value : fallback;
}
export function brandFontStack(font: string | null | undefined): string | null {
  return font && BRAND_FONT_STACKS[font] ? BRAND_FONT_STACKS[font] : null;
}

function isHttpUrl(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\/\S+$/i.test(v.trim());
}

/** Strict block validation. Returns the normalized blocks or
 * throws Error(message) — the service wraps it in a 400. Unknown
 * types, bad URLs and oversized text are refused, never silently
 * dropped: a builder save must either store what the author saw
 * or fail honestly. */
export function validateEmailBlocks(input: unknown): EmailBlock[] {
  if (!Array.isArray(input)) throw new Error("blocks must be an array");
  if (input.length === 0) throw new Error("blocks must not be empty — add at least one block");
  if (input.length > 50) throw new Error("blocks: at most 50 blocks per template");
  return input.map((raw, i) => {
    const at = `blocks[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${at}: must be an object`);
    const b = raw as Record<string, unknown>;
    if (!(EMAIL_BLOCK_TYPES as readonly string[]).includes(String(b.type))) {
      throw new Error(`${at}: unknown block type "${String(b.type)}" (allowed: ${EMAIL_BLOCK_TYPES.join(", ")})`);
    }
    const type = b.type as EmailBlockType;
    const out: EmailBlock = { type };
    if (b.align !== undefined) {
      if (!["left", "center", "right"].includes(String(b.align))) throw new Error(`${at}: align must be left, center or right`);
      out.align = b.align as EmailBlock["align"];
    }
    switch (type) {
      case "text": {
        if (typeof b.text !== "string" || !b.text.trim()) throw new Error(`${at}: text block needs non-empty text`);
        if (b.text.length > 5000) throw new Error(`${at}: text is too long (max 5000 characters)`);
        out.text = b.text;
        break;
      }
      case "image": {
        if (!isHttpUrl(b.url)) throw new Error(`${at}: image block needs an http(s) image URL — no URL is invented for you`);
        out.url = (b.url as string).trim();
        if (b.alt !== undefined && b.alt !== null) { if (typeof b.alt !== "string" || b.alt.length > 300) throw new Error(`${at}: alt must be a string of at most 300 characters`); out.alt = b.alt; }
        if (b.linkUrl !== undefined && b.linkUrl !== null && b.linkUrl !== "") {
          if (!isHttpUrl(b.linkUrl)) throw new Error(`${at}: image linkUrl must be an http(s) URL`);
          out.linkUrl = (b.linkUrl as string).trim();
        }
        break;
      }
      case "button": {
        if (typeof b.label !== "string" || !b.label.trim()) throw new Error(`${at}: button block needs a label`);
        if (b.label.length > 120) throw new Error(`${at}: button label is too long (max 120 characters)`);
        if (!isHttpUrl(b.url)) throw new Error(`${at}: button block needs an http(s) URL — no link is invented for you`);
        out.label = b.label; out.url = (b.url as string).trim();
        break;
      }
      case "product": {
        if (b.productId !== undefined && b.productId !== null && (typeof b.productId !== "string" || !b.productId)) {
          throw new Error(`${at}: productId must be a product id string or null (unfilled slot)`);
        }
        out.productId = (b.productId as string | null | undefined) ?? null;
        break;
      }
      case "coupon": {
        if (b.discountId !== undefined && b.discountId !== null && (typeof b.discountId !== "string" || !b.discountId)) {
          throw new Error(`${at}: discountId must be a discount id string or null (unfilled slot)`);
        }
        if (b.code !== undefined && b.code !== null && (typeof b.code !== "string" || b.code.length > 60)) {
          throw new Error(`${at}: coupon code must be a string of at most 60 characters`);
        }
        if (b.label !== undefined && b.label !== null && (typeof b.label !== "string" || b.label.length > 200)) {
          throw new Error(`${at}: coupon label must be a string of at most 200 characters`);
        }
        out.discountId = (b.discountId as string | null | undefined) ?? null;
        out.code = (b.code as string | null | undefined) ?? null;
        out.label = (b.label as string | null | undefined) ?? null;
        break;
      }
      case "divider": break;
    }
    return out;
  });
}

export interface BlockProduct { name: string; priceMinor: bigint | number | string; currency: string; url?: string | null; imageUrl?: string | null }
export interface BlockDiscount { code: string; kind: string; value: number }

export interface RenderBlocksResult {
  htmlBody: string;
  body: string;
  /** Slots that rendered empty, with the honest reason — the
   * caller surfaces these; nothing was substituted for them. */
  emptySlots: { index: number; type: string; reason: string }[];
}

export function discountLabel(d: BlockDiscount): string {
  if (d.kind === "percent") return `${d.value}% ছাড়`;
  if (d.kind === "fixed") return `${formatPriceMinor(d.value * 100, "BDT")} ছাড়`;
  if (d.kind === "free_shipping") return "ফ্রি ডেলিভারি";
  return "";
}

/** Render validated blocks to the EXISTING template output format
 * (plain-text body + HTML body), with the brand kit applied as a
 * wrapper. Deterministic: same blocks + same kit + same catalog
 * rows ⇒ byte-identical output. */
export function renderEmailBlocks(
  blocks: EmailBlock[],
  ctx: { brand?: BrandKit | null; products?: Map<string, BlockProduct>; discounts?: Map<string, BlockDiscount> },
): RenderBlocksResult {
  const brand = ctx.brand ?? {};
  const primary = brandColor(brand.primaryColor, "#2563eb");
  const secondary = brandColor(brand.secondaryColor, primary);
  const font = brandFontStack(brand.font);
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  const emptySlots: RenderBlocksResult["emptySlots"] = [];

  blocks.forEach((b, index) => {
    const align = b.align ?? "left";
    switch (b.type) {
      case "text": {
        const paras = String(b.text).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
        for (const p of paras) htmlParts.push(`<p style="text-align:${align};margin:0 0 12px;line-height:1.6">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`);
        textParts.push(String(b.text).trim());
        break;
      }
      case "image": {
        const img = `<img src="${escapeHtml(b.url!)}" alt="${escapeHtml(b.alt ?? "")}" style="max-width:100%;height:auto;display:block;margin:0 auto 12px">`;
        htmlParts.push(b.linkUrl ? `<a href="${escapeHtml(b.linkUrl)}">${img}</a>` : img);
        textParts.push(b.alt ? `[ছবি: ${b.alt}]` : "[ছবি]");
        break;
      }
      case "button": {
        htmlParts.push(`<p style="text-align:center;margin:16px 0"><a href="${escapeHtml(b.url!)}" style="background:${primary};color:#ffffff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(b.label!)}</a></p>`);
        textParts.push(`${b.label}: ${b.url}`);
        break;
      }
      case "product": {
        const p = b.productId ? ctx.products?.get(b.productId) : undefined;
        if (!p) {
          emptySlots.push({ index, type: "product", reason: b.productId ? "product not found in this organization's catalog (deleted or inactive) — slot rendered empty" : "unfilled product slot — no product chosen yet" });
          break;
        }
        const price = formatPriceMinor(p.priceMinor, p.currency);
        const img = p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}" style="max-width:100%;height:auto;display:block;margin:0 auto 8px">` : "";
        const nameHtml = p.url ? `<a href="${escapeHtml(p.url)}" style="color:${secondary}">${escapeHtml(p.name)}</a>` : escapeHtml(p.name);
        htmlParts.push(`<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:0 0 12px;text-align:center">${img}<p style="margin:0 0 4px"><strong>${nameHtml}</strong></p><p style="margin:0;color:${primary};font-weight:600">${price}</p></div>`);
        textParts.push(`${p.name} — ${price}` + (p.url ? `\n${p.url}` : ""));
        break;
      }
      case "coupon": {
        const d = b.discountId ? ctx.discounts?.get(b.discountId) : undefined;
        if (b.discountId && !d) {
          emptySlots.push({ index, type: "coupon", reason: "discount not found in this organization (deleted or inactive) — slot rendered empty" });
          break;
        }
        const code = d ? d.code : (b.code ?? null);
        if (!code) {
          emptySlots.push({ index, type: "coupon", reason: "unfilled coupon slot — no discount or code chosen yet" });
          break;
        }
        const label = d ? (discountLabel(d) || (b.label ?? "")) : (b.label ?? "");
        htmlParts.push(`<div style="border:2px dashed ${secondary};border-radius:10px;padding:12px;margin:0 0 12px;text-align:center"><p style="margin:0">কুপন কোড: <strong>${escapeHtml(code)}</strong>${label ? ` — ${escapeHtml(label)}` : ""}</p></div>`);
        textParts.push(`কুপন কোড: ${code}` + (label ? ` — ${label}` : ""));
        break;
      }
      case "divider": {
        htmlParts.push(`<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">`);
        textParts.push("— — —");
        break;
      }
    }
  });

  const brandName = (brand.brandName ?? "").trim();
  const headerHtml = brand.logoUrl || brandName
    ? `<div style="text-align:center;margin:0 0 16px">${brand.logoUrl ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brandName)}" style="max-height:56px;max-width:220px">` : ""}${brandName ? `<p style="margin:6px 0 0;font-weight:700;color:${primary}">${escapeHtml(brandName)}</p>` : ""}</div>`
    : "";
  const footerHtml = brandName ? `<p style="text-align:center;color:#6b7280;font-size:12px;margin:16px 0 0">${escapeHtml(brandName)}</p>` : "";
  const htmlBody = `<div style="${font ? `font-family:${font};` : ""}max-width:600px;margin:0 auto;color:#111827">${headerHtml}${htmlParts.join("\n")}${footerHtml}</div>`;
  const body = [...(brandName ? [brandName] : []), ...textParts].join("\n\n");
  return { htmlBody, body, emptySlots };
}
