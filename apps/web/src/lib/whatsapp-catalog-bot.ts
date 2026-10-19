import { fmtMoney } from "@repo/contracts";
import { messagingBn, messagingEn } from "./i18n/messaging";

type Loc = "bn" | "en";
const M = (locale?: string) => (locale === "en" ? messagingEn : messagingBn);
/**
 * WhatsApp Conversational Catalog & 1-Click Order Bot Engine
 * Tailored for Bangladeshi e-commerce merchants and marketers running WhatsApp/CTWA campaigns.
 */

export interface WhatsAppBotMenuItem {
  key: string;
  label: string;
  action: "catalog" | "deals" | "track" | "human";
}

export interface WhatsAppBotConfig {
  businessPhone: string;
  botName: string;
  welcomeMessage: string;
  menuOptions: WhatsAppBotMenuItem[];
  orderPromptMessage: string;
  deliveryNotice: string;
  codEnabled: boolean;
}

export interface WhatsAppProductItem {
  id: string;
  name: string;
  priceMinor: string | number;
  compareAtMinor?: string | number | null;
  imageUrl?: string | null;
  description?: string | null;
  slug?: string | null;
}

export interface ParsedCustomerOrder {
  customerName?: string;
  phone?: string;
  address?: string;
  notes?: string;
  confidence: "high" | "partial" | "low";
}

export const DEFAULT_BOT_CONFIG: WhatsAppBotConfig = {
  businessPhone: "8801700000000",
  botName: messagingBn.botName,
  welcomeMessage: messagingBn.botWelcome,
  menuOptions: [
    { key: "1", label: messagingBn.botMenuCatalog, action: "catalog" },
    { key: "2", label: messagingBn.botMenuDeals, action: "deals" },
    { key: "3", label: messagingBn.botMenuTrack, action: "track" },
    { key: "4", label: messagingBn.botMenuHuman, action: "human" },
  ],
  orderPromptMessage: messagingBn.botOrderPrompt,
  deliveryNotice: messagingBn.botDeliveryNotice,
  codEnabled: true,
};

/** Default bot config in the requested locale (bn = DEFAULT_BOT_CONFIG). */
export function botConfigFor(locale: Loc = "bn"): WhatsAppBotConfig {
  if (locale === "bn") return DEFAULT_BOT_CONFIG;
  const m = messagingEn;
  return {
    businessPhone: DEFAULT_BOT_CONFIG.businessPhone,
    botName: m.botName,
    welcomeMessage: m.botWelcome,
    menuOptions: [
      { key: "1", label: m.botMenuCatalog, action: "catalog" },
      { key: "2", label: m.botMenuDeals, action: "deals" },
      { key: "3", label: m.botMenuTrack, action: "track" },
      { key: "4", label: m.botMenuHuman, action: "human" },
    ],
    orderPromptMessage: m.botOrderPrompt,
    deliveryNotice: m.botDeliveryNotice,
    codEnabled: true,
  };
}

/** Normalize Bangladeshi phone number to international format without + or dashes */
export function normalizeBdPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("880")) {
    return digits;
  }
  if (digits.startsWith("01")) {
    return `88${digits}`;
  }
  if (digits.startsWith("1") && digits.length === 10) {
    return `880${digits}`;
  }
  return digits;
}

/** Generate a direct wa.me link with pre-filled message */
export function generateWhatsAppClickToChatUrl(phone: string, prefilledText?: string): string {
  const cleanPhone = normalizeBdPhoneNumber(phone);
  if (!prefilledText) {
    return `https://wa.me/${cleanPhone}`;
  }
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(prefilledText)}`;
}

/** Format a single product into high-converting WhatsApp message snippet */
export function formatWhatsAppProductSnippet(
  product: WhatsAppProductItem,
  storeName?: string,
  landingSlug?: string,
  locale: Loc = "bn"
): string {
  const m = M(locale);
  const price = (Number(product.priceMinor) || 0) / 100;
  const compareAt = product.compareAtMinor ? Number(product.compareAtMinor) / 100 : null;
  const priceFmt = fmtMoney(locale, price);

  let discountLine = "";
  if (compareAt && compareAt > price) {
    const savings = Math.round(((compareAt - price) / compareAt) * 100);
    const regularFmt = fmtMoney(locale, compareAt);
    discountLine = `\n~${regularFmt}~ *${savings}${m.botDiscountSuffix}`;
  }

  const lines = [
    `*🛍️ ${product.name}*`,
    storeName ? `_${m.botOriginalCollection} by ${storeName}_` : "",
    "",
    `💰 ${m.botSpecialPrice}: *${priceFmt}*${discountLine}`,
    m.botCodAvailable,
    "",
    product.description ? `📝 ${m.botDescription}: ${product.description.slice(0, 140)}...` : "",
    "",
    landingSlug
      ? `${m.botOrderCtaLink}\nhttps://myshop.com/l/${landingSlug}`
      : m.botOrderCtaPlain,
  ];

  return lines.filter(Boolean).join("\n");
}

/** Extract customer details (Name, BD Mobile Number, Address) from chat message */
export function parseCustomerOrderDetails(messageText: string): ParsedCustomerOrder {
  const text = messageText.trim();
  const res: ParsedCustomerOrder = {
    confidence: "low",
  };

  // 1. Match Bangladeshi mobile phone (01[3-9]\d{8})
  const phoneMatch = text.match(/(?:(?:\+|00)?88)?(01[3-9]\d{8})\b/);
  if (phoneMatch) {
    res.phone = phoneMatch[1];
  }

  // 2. Check for labelled format: নাম / Name: ...
  const nameLabelMatch = text.match(/(?:নাম|Name)[\s:=]+([^\n,।]+)/i);
  if (nameLabelMatch) {
    res.customerName = nameLabelMatch[1].trim();
  }

  // 3. Check for labelled format: ঠিকানা / Address: ...
  const addressLabelMatch = text.match(/(?:ঠিকানা|Address)[\s:=]+([^\n।]+)/i);
  if (addressLabelMatch) {
    res.address = addressLabelMatch[1].trim();
  }

  // 4. Fallback heuristics if labels are absent but multi-line text is provided
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!res.customerName && lines.length >= 2) {
    // If the first line doesn't have digits, likely customer name
    if (!/\d/.test(lines[0]) && lines[0].length < 50) {
      res.customerName = lines[0].replace(/^(?:১|1)[\.\-\)]\s*/, "").trim();
    }
  }

  if (!res.address) {
    // Find line containing known BD cities/areas or longest line without phone
    const addressCandidate = lines.find((l) =>
      /(?:ঢাকা|চট্টগ্রাম|সিলেট|রাজশাহী|খুলনা|বরিশাল|রংপুর|মিরপুর|ধানমন্ডি|উত্তরা|গুলশান|রোড|বাড়ি|বাসা|থানা|জেলা)/i.test(l)
    );
    if (addressCandidate) {
      res.address = addressCandidate.replace(/^(?:৩|3)[\.\-\)]\s*/, "").trim();
    } else if (lines.length >= 3 && !res.address) {
      // Pick last line as address
      res.address = lines[lines.length - 1];
    }
  }

  // Determine confidence
  if (res.phone && res.customerName && res.address) {
    res.confidence = "high";
  } else if (res.phone || res.address) {
    res.confidence = "partial";
  }

  return res;
}

/** Generate formal WhatsApp Order Summary Receipt */
export function generateWhatsAppOrderSummaryReceipt(order: {
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  productName: string;
  quantity: number;
  totalMinor: number | string;
  deliveryChargeMinor?: number | string;
}, locale: Loc = "bn"): string {
  const m = M(locale);
  const total = (Number(order.totalMinor) || 0) / 100;
  const delivery = (Number(order.deliveryChargeMinor) || 0) / 100;
  const due = total;

  return [
    m.receiptTitle,
    `${m.receiptOrderId}: *#${order.orderNumber}*`,
    "--------------------------------",
    `👤 ${m.receiptCustomer}: *${order.customerName}*`,
    `📞 ${m.receiptMobile}: *${order.phone}*`,
    `📍 ${m.receiptAddress}: ${order.address}`,
    "",
    m.receiptItems,
    `• ${order.productName} (${m.receiptQuantity}: ${order.quantity}${m.receiptQtySuffix})`,
    "",
    `💵 ${m.receiptProductPrice}: ${fmtMoney(locale, total - delivery)}`,
    `🚚 ${m.receiptDeliveryCharge}: ${fmtMoney(locale, delivery)}`,
    `💳 *${m.receiptCodTotal}: ${fmtMoney(locale, due)}*`,
    "--------------------------------",
    m.receiptPackingNote,
    m.receiptCheckNote,
    "",
    m.receiptThanks,
  ].join("\n");
}

/** Generate a 1-click WhatsApp order URL for a specific product */
export function generateWhatsAppProductOrderUrl(opts: {
  phone: string;
  productName: string;
  priceMinor: number | string;
  variantName?: string | null;
  productUrl?: string | null;
}, locale: Loc = "bn"): string {
  const m = M(locale);
  const price = Math.round((Number(opts.priceMinor) || 0) / 100);
  const priceFmt = fmtMoney(locale, price);
  const lines = [
    m.orderGreeting,
    m.orderWantCod,
    "",
    `🛍️ ${m.orderProduct}: ${opts.productName}`,
    opts.variantName ? `🏷️ ${m.orderVariant}: ${opts.variantName}` : "",
    `💰 ${m.orderPrice}: ${priceFmt}`,
    opts.productUrl ? `🔗 ${m.orderLink}: ${opts.productUrl}` : "",
    "",
    m.orderMyInfo,
    m.orderInfoName,
    m.orderInfoMobile,
    m.orderInfoAddress,
  ];
  const text = lines.filter(Boolean).join("\n");
  return generateWhatsAppClickToChatUrl(opts.phone, text);
}
