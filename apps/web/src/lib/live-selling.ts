/**
 * Social Live Selling & Comment-to-Order Engine
 * Specially designed for Bangladeshi Facebook, TikTok, and Instagram Live sellers.
 * Parses comments like "101 2 ta nibo 01712345678", matches product keywords,
 * reserves stock, and generates instant WhatsApp / Messenger checkout links.
 */

export interface LiveKeywordRule {
  id: string;
  keyword: string; // e.g. "101", "ORDER-101", "PANJABI", "SAREE-RED"
  productName: string;
  variantName?: string;
  priceMinor: string; // minor units e.g. "145000" for ৳1,450
  stockQuantity: number;
  sku?: string;
  imageUrl?: string;
  isActive: boolean;
}

export interface ParsedLiveOrder {
  id: string;
  keywordMatched: string;
  rule: LiveKeywordRule;
  quantity: number;
  customerPhone: string | null;
  extractedSize: string | null;
  extractedColor: string | null;
  rawComment: string;
  totalPriceMinor: string;
  checkoutUrl: string;
  whatsappReplyMessage: string;
  messengerReplyMessage: string;
  createdAt: string;
}

export interface LiveSellingSession {
  id: string;
  title: string;
  platform: "facebook" | "tiktok" | "instagram";
  status: "live" | "ended" | "scheduled";
  startedAt: string;
  totalComments: number;
  ordersCaptured: number;
  totalGmvMinor: string;
  rules: LiveKeywordRule[];
  capturedOrders: ParsedLiveOrder[];
}

const BN_TO_EN_DIGITS: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

export function convertBnDigitsToEn(text: string): string {
  return text.replace(/[০-৯]/g, (d) => BN_TO_EN_DIGITS[d] || d);
}

/**
 * Extracts quantity from comment (e.g. "2 ta", "৩ পিস", "qty: 2", "2 pcs", "2টি")
 */
export function extractQuantityFromComment(text: string): number {
  const normalized = convertBnDigitsToEn(text.toLowerCase());

  // Patterns like "2 ta", "2 pcs", "2টি", "qty 2", "quantity: 2"
  const qtyPatterns = [
    /(?:qty|quantity|পরিমাণ|পিস|pcs|ta|ti|টি)\s*[:=]?\s*(\d{1,2})/i,
    /(\d{1,2})\s*(?:ta|ti|pcs|পিস|টি|টা|জোড়া|pair)/i,
    /(?:need|nibo|নেব|নিবো|চাই|অর্ডার)\s*(\d{1,2})/i,
  ];

  for (const pat of qtyPatterns) {
    const match = normalized.match(pat);
    if (match && match[1]) {
      const q = parseInt(match[1], 10);
      if (q > 0 && q <= 50) return q;
    }
  }

  return 1; // default to 1 piece
}

/**
 * Extracts Bangladeshi phone number from comment text
 */
export function extractBdPhoneFromComment(text: string): string | null {
  const normalized = convertBnDigitsToEn(text);
  // Match 013-019 11-digit numbers, optional +88 or 88 prefix
  const phoneRegex = /(?:\+?88)?01[3-9]\d{8}\b/;
  const match = normalized.match(phoneRegex);
  if (!match) return null;

  let clean = match[0].replace(/[^0-9]/g, "");
  if (clean.startsWith("0") && clean.length === 11) {
    clean = "88" + clean;
  }
  return clean;
}

/**
 * Extracts apparel size from comment (S, M, L, XL, XXL, 38, 40, 42, 44)
 */
export function extractSizeVariant(text: string): string | null {
  const upper = text.toUpperCase();
  const apparelSizes = ["XXL", "XL", "XXXL", "XS", "S", "M", "L"];
  for (const s of apparelSizes) {
    // word boundary or spaced
    const regex = new RegExp(`(?:SIZE|সাইজ|সাইজ:)?\\s*\\b${s}\\b`, "i");
    if (regex.test(upper)) return s;
  }

  // Numerical sizes (Panjabi/Shirt 38, 40, 42, 44, 46)
  const numSizeMatch = upper.match(/(?:SIZE|সাইজ|সাইজ:)?\s*\b(36|38|40|42|44|46)\b/);
  if (numSizeMatch && numSizeMatch[1]) {
    return numSizeMatch[1];
  }

  return null;
}

/**
 * Generates an instant checkout URL with prefilled item and live discount token
 */
export function generateLiveCheckoutLink(
  ruleId: string,
  quantity = 1,
  phone?: string | null,
  baseUrl = "https://shop.amarbrand.com"
): string {
  const token = `live-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
  const params = new URLSearchParams({
    rule: ruleId,
    qty: String(quantity),
    live_token: token,
  });
  if (phone) params.set("phone", phone);
  return `${baseUrl}/checkout?${params.toString()}`;
}

/**
 * Builds personalized WhatsApp order confirmation message with checkout link
 */
export function buildLiveWhatsAppOrderMessage(
  params: {
    rule: LiveKeywordRule;
    quantity: number;
    checkoutUrl: string;
    customerPhone?: string | null;
  },
  storeName = "আমাদের শপ"
): string {
  const unitPrice = (Number(params.rule.priceMinor) / 100).toFixed(0);
  const total = ((Number(params.rule.priceMinor) * params.quantity) / 100).toFixed(0);

  return `আসসালামু আলাইকুম! ${storeName}-এর লাইভে কমেন্ট করার জন্য ধন্যবাদ 🎉
আপনার কাঙ্ক্ষিত পণ্য: *${params.rule.productName}*
- পরিমাণ: ${params.quantity} টি
- মোট মূল্য: ৳${total} (${params.quantity} × ৳${unitPrice})

লাইভ স্টকটি আপনার জন্য ১৫ মিনিটের জন্য রিজার্ভ করা হয়েছে। ক্যাশ অন ডেলিভারিতে অর্ডার নিশ্চিত করতে নিচের লিংকে ক্লিক করে নাম ও ঠিকানা দিন:
👉 ${params.checkoutUrl}

কোন প্রশ্ন থাকলে এই নম্বরেই রিপ্লাই দিন। ধন্যবাদ! 🙏`;
}

/**
 * Parses a social live comment against registered keyword rules
 */
export function parseLiveComment(
  commentText: string,
  rules: LiveKeywordRule[],
  storeName = "আমাদের শপ",
  checkoutBaseUrl = "https://shop.amarbrand.com"
): ParsedLiveOrder | null {
  if (!commentText || !commentText.trim()) return null;
  const raw = commentText.trim();
  const normalized = convertBnDigitsToEn(raw.toLowerCase());

  // Sort rules by keyword length descending so specific rules (e.g. "ORDER-101") take precedence over "101"
  const activeRules = rules
    .filter((r) => r.isActive && r.stockQuantity > 0)
    .sort((a, b) => b.keyword.length - a.keyword.length);

  let matchedRule: LiveKeywordRule | null = null;
  let matchedKeyword = "";

  for (const rule of activeRules) {
    const kw = convertBnDigitsToEn(rule.keyword.toLowerCase().trim());
    // Match whole word or exact token
    const wordRegex = new RegExp(`(?:^|\\s|#)${kw}(?:\\s|$|[.,!?])`, "i");
    if (wordRegex.test(normalized)) {
      matchedRule = rule;
      matchedKeyword = rule.keyword;
      break;
    }
  }

  if (!matchedRule) return null;

  const quantity = extractQuantityFromComment(raw);
  const customerPhone = extractBdPhoneFromComment(raw);
  const extractedSize = extractSizeVariant(raw);

  const unitMinor = BigInt(matchedRule.priceMinor || 0);
  const totalPriceMinor = String(unitMinor * BigInt(quantity));

  const checkoutUrl = generateLiveCheckoutLink(matchedRule.id, quantity, customerPhone, checkoutBaseUrl);

  const whatsappReplyMessage = buildLiveWhatsAppOrderMessage(
    {
      rule: matchedRule,
      quantity,
      checkoutUrl,
      customerPhone,
    },
    storeName
  );

  const messengerReplyMessage = `ধন্যবাদ! আপনার অর্ডারকৃত ${matchedRule.productName} (${quantity}টি - ৳${(Number(totalPriceMinor) / 100).toFixed(0)}) এর লিংক: ${checkoutUrl}`;

  return {
    id: `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    keywordMatched: matchedKeyword,
    rule: matchedRule,
    quantity,
    customerPhone,
    extractedSize,
    extractedColor: null,
    rawComment: raw,
    totalPriceMinor,
    checkoutUrl,
    whatsappReplyMessage,
    messengerReplyMessage,
    createdAt: new Date().toISOString(),
  };
}

export const DEFAULT_SAMPLE_RULES: LiveKeywordRule[] = [
  {
    id: "rule-101",
    keyword: "101",
    productName: "প্রিমিয়াম প্রিমিয়াম সেমি-লং পাঞ্জাবি (কালো)",
    priceMinor: "145000",
    stockQuantity: 25,
    sku: "PANJ-BLK-101",
    isActive: true,
  },
  {
    id: "rule-102",
    keyword: "102",
    productName: "ঢাকাই ট্র্যাডিশনাল জামদানি শাড়ি (লাল)",
    priceMinor: "380000",
    stockQuantity: 12,
    sku: "SAREE-JAM-102",
    isActive: true,
  },
  {
    id: "rule-103",
    keyword: "103",
    productName: "ক্যাজুয়াল অক্সফোর্ড কটন শার্ট (নেভি ব্লু)",
    priceMinor: "125000",
    stockQuantity: 40,
    sku: "SHIRT-NVY-103",
    isActive: true,
  },
  {
    id: "rule-polo",
    keyword: "POLO",
    productName: "কমফোর্ট ফিট পোলো টি-শার্ট (মেরুন)",
    priceMinor: "75000",
    stockQuantity: 50,
    sku: "POLO-MRN-01",
    isActive: true,
  },
];
