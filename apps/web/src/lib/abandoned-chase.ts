/**
 * Abandoned Cart & Checkout Chase Automation helpers
 * Pure functions for clean phone formatting, Bengali recovery message composition,
 * WhatsApp wa.me link generation, quiet hours evaluation, and stop word detection.
 */

export const CHASE_STOP_WORDS = [
  "থামুন",
  "থামান",
  "stop",
  "লাগবে না",
  "চাই না",
  "দরকার নেই",
  "লাস্ট কত",
] as const;

/**
 * Normalizes Bangladeshi phone numbers into international 880 format for wa.me links.
 */
export function formatCleanPhone(phone?: string | null): string {
  if (!phone) return "";
  let clean = phone.replace(/\D/g, "");
  if (!clean) return "";
  if (clean.startsWith("0")) {
    clean = `88${clean}`;
  } else if (!clean.startsWith("880") && clean.length === 10) {
    clean = `880${clean}`;
  }
  return clean;
}

/**
 * Generates high-converting Bengali WhatsApp recovery message with custom discount coupon.
 */
export function buildWhatsAppRecoveryMessage(params: {
  productName?: string | null;
  couponCode?: string | null;
  discountText?: string | null;
  checkoutUrl?: string | null;
}): string {
  const itemNames = params.productName?.trim() || "পণ্যসমূহ";
  const discount = (params.couponCode || "VIP50").trim().toUpperCase();
  const discountPhrase = params.discountText ? ` (${params.discountText.trim()})` : "";
  const link = params.checkoutUrl?.trim() || "আমাদের শপে ভিজিট করুন";

  return `আসসালামু আলাইকুম! আপনার কার্টে থাকা (${itemNames}) অর্ডার করার জন্য সংরক্ষিত আছে।\n\nএখনই অর্ডার নিশ্চিত করলে পাচ্ছেন বিশেষ ছাড়! চেকআউটে কুপন কোড ব্যবহার করুন: *${discount}*${discountPhrase}\n\n🛒 অর্ডার সম্পন্ন করার লিংক:\n${link}`;
}

/**
 * Constructs direct WhatsApp web/app link.
 */
export function buildWhatsAppLink(phone: string, message: string): string {
  const clean = formatCleanPhone(phone);
  if (!clean) return "";
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

/**
 * Checks whether the current moment in Asia/Dhaka time falls into Quiet Hours (default 22:00 to 08:00).
 */
export function isDhakaQuietHour(date: Date, startHour = 22, endHour = 8): boolean {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", hour: "2-digit", hourCycle: "h23" });
    const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
    const hour = Number(parts.hour ?? 0) % 24;

    if (startHour === endHour) return false;
    if (startHour < endHour) {
      return hour >= startHour && hour < endHour;
    }
    // Overnight window (e.g. 22:00 -> 08:00)
    return hour >= startHour || hour < endHour;
  } catch {
    const hour = date.getUTCHours();
    return hour >= 16 || hour < 2; // Approximate UTC offset (+6h)
  }
}

/**
 * Returns true if customer replied with a stop phrase.
 */
export function isChaseStopWord(text?: string | null): boolean {
  const t = String(text ?? "").trim().toLowerCase().replace(/[।.!?]+$/, "").trim();
  if (!t) return false;
  return CHASE_STOP_WORDS.some((word) => {
    const p = word.toLowerCase();
    return t === p || t.startsWith(`${p} `) || t.endsWith(` ${p}`) || t.includes(p);
  });
}
