import { formatMinor } from "@repo/contracts";

/**
 * Inbox Next-Gen P2: the product showcase card.
 *
 * ONE composer + ONE parser. `composeProductCardText` builds the
 * exact text the customer receives — as the image caption on
 * channels whose media path carries captions (WhatsApp, Telegram,
 * Email, Webchat), as a follow-up text on Messenger/Instagram
 * (their attachment upload carries no caption), or as the whole
 * message on the honest text fallback. `parseProductCard` re-reads
 * the name + price from those same composed lines so the webchat
 * visitor projection can mark the message as a product card
 * WITHOUT any new schema field: the marker is the first line
 * ("🛍️ <name>") plus a "দাম: <price>" line. If the format ever
 * changes, change both functions together.
 */
const CARD_NAME_LINE = /^🛍️\s+(.+)$/u;
const CARD_PRICE_PREFIX = "দাম: ";

export interface ProductCardProduct {
  name: string;
  priceMinor: bigint | number | string;
  currency?: string | null;
  stockQuantity?: number | null;
}

export function composeProductCardText(product: ProductCardProduct, caption?: string): string {
  const lines = [
    `🛍️ ${product.name}`,
    `${CARD_PRICE_PREFIX}${formatMinor(BigInt(product.priceMinor), product.currency ?? "BDT")}`,
  ];
  if (product.stockQuantity != null) {
    lines.push(product.stockQuantity > 0 ? `স্টক: ${product.stockQuantity}টি আছে` : "স্টক: আপাতত শেষ");
  }
  const extra = caption?.trim();
  if (extra) lines.push(extra.slice(0, 500));
  lines.push("অর্ডার করতে চাইলে আপনার নাম, ঠিকানা ও ফোন নম্বর এই চ্যাটেই পাঠান।");
  return lines.join("\n");
}

/** The plain-text snippet the composer picker has always inserted
 * ("টেক্সট বসান") — kept as the fallback wording reference. The
 * card text above is a superset of it (name + price + stock). */
export function parseProductCard(message: {
  type?: string;
  direction?: string;
  content?: string | null;
}): { name: string; priceText: string } | null {
  if (message.type !== "image" || message.direction !== "out" || !message.content) return null;
  const lines = message.content.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const nameMatch = lines[0].match(CARD_NAME_LINE);
  if (!nameMatch) return null;
  const priceLine = lines.find((l) => l.startsWith(CARD_PRICE_PREFIX));
  if (!priceLine) return null;
  return { name: nameMatch[1].trim(), priceText: priceLine.slice(CARD_PRICE_PREFIX.length).trim() };
}
