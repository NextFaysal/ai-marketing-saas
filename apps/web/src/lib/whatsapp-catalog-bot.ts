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
  botName: "স্মার্ট শপ সহকারী",
  welcomeMessage:
    "আসসালামু আলাইকুম! আমাদের শপে আপনাকে স্বাগতম। আমি আপনার ভার্চুয়াল শপিং সহকারী। কীভাবে সাহায্য করতে পারি? নিচের যেকোনো অপশনে ক্লিক করুন বা রিপ্লাই দিন:",
  menuOptions: [
    { key: "1", label: "🛍️ সেরা প্রডাক্ট ক্যাটালগ দেখুন", action: "catalog" },
    { key: "2", label: "🔥 আজকের স্পেশাল ধামাকা অফার", action: "deals" },
    { key: "3", label: "📦 বর্তমান অর্ডারের অবস্থান জানুন", action: "track" },
    { key: "4", label: "💬 কাস্টমার কেয়ার প্রতিনিধির সাথে কথা", action: "human" },
  ],
  orderPromptMessage:
    "ক্যাশ অন ডেলিভারিতে অর্ডার নিশ্চিত করতে অনুগ্রহ করে নিচের তথ্যগুলো লিখে পাঠান:\n১. আপনার নাম\n২. ১১ ডিজিটের সচল মোবাইল নম্বর\n৩. সম্পূর্ণ ডেলিভারি ঠিকানা (জেলা, থানা ও এলাকা)",
  deliveryNotice: "ঢাকা সিটিতে ২৪-৪৮ ঘণ্টা, সারা বাংলাদেশে ২-৩ দিনে ক্যাশ অন ডেলিভারি।",
  codEnabled: true,
};

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
  landingSlug?: string
): string {
  const price = (Number(product.priceMinor) || 0) / 100;
  const compareAt = product.compareAtMinor ? Number(product.compareAtMinor) / 100 : null;
  const priceFmt = `৳${price.toLocaleString("en-IN")}`;

  let discountLine = "";
  if (compareAt && compareAt > price) {
    const savings = Math.round(((compareAt - price) / compareAt) * 100);
    const regularFmt = `৳${compareAt.toLocaleString("en-IN")}`;
    discountLine = `\n~${regularFmt}~ *${savings}% ছাড়!*`;
  }

  const lines = [
    `*🛍️ ${product.name}*`,
    storeName ? `_অরিজিনাল কালেকশন by ${storeName}_` : "",
    "",
    `💰 বিশেষ মূল্য: *${priceFmt}*${discountLine}`,
    "🚚 ক্যাশ অন ডেলিভারি সুবিধা (পণ্য দেখে পেমেন্ট)",
    "",
    product.description ? `📝 বিবরণ: ${product.description.slice(0, 140)}...` : "",
    "",
    landingSlug
      ? `👉 ১-ক্লিকে বিস্তারিত দেখুন ও সরাসরি অর্ডার করুন:\nhttps://myshop.com/l/${landingSlug}`
      : "👉 অর্ডার করতে সরাসরি 'অর্ডার' লিখে আপনার নাম, ঠিকানা ও ফোন নম্বর পাঠান।",
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
}): string {
  const total = (Number(order.totalMinor) || 0) / 100;
  const delivery = (Number(order.deliveryChargeMinor) || 0) / 100;
  const due = total;

  return [
    "🎉 *অর্ডার কনফার্মেশন স্লিপ (Order Confirmed)*",
    `অর্ডার আইডি: *#${order.orderNumber}*`,
    "--------------------------------",
    `👤 গ্রাহক: *${order.customerName}*`,
    `📞 মোবাইল: *${order.phone}*`,
    `📍 ঠিকানা: ${order.address}`,
    "",
    "📦 *অর্ডারকৃত পণ্য:*",
    `• ${order.productName} (পরিমাণ: ${order.quantity}টি)`,
    "",
    `💵 পণ্যের মূল্য: ৳${(total - delivery).toLocaleString("en-IN")}`,
    `🚚 ডেলিভারি চার্জ: ৳${delivery.toLocaleString("en-IN")}`,
    `💳 *ক্যাশ অন ডেলিভারি (মোট প্রদেয়): ৳${due.toLocaleString("en-IN")}*`,
    "--------------------------------",
    "✅ পার্সেলটি খুব শীঘ্রই প্যাকেজিং হয়ে কুরিয়ারে হস্তান্তর করা হবে।",
    "📦 পার্সেল হাতে পেয়ে খুলে চেক করে তবেই ডেলিভারি ম্যানকে টাকা পরিশোধ করবেন।",
    "",
    "আমাদের সাথে কেনাকাটা করার জন্য ধন্যবাদ! ❤️",
  ].join("\n");
}

/** Generate a 1-click WhatsApp order URL for a specific product */
export function generateWhatsAppProductOrderUrl(opts: {
  phone: string;
  productName: string;
  priceMinor: number | string;
  variantName?: string | null;
  productUrl?: string | null;
}): string {
  const price = Math.round((Number(opts.priceMinor) || 0) / 100);
  const priceFmt = `৳${price.toLocaleString("bn-BD")}`;
  const lines = [
    "আসসালামু আলাইকুম,",
    "আমি এই প্রোডাক্টটি ক্যাশ অন ডেলিভারিতে অর্ডার করতে চাই:",
    "",
    `🛍️ প্রোডাক্ট: ${opts.productName}`,
    opts.variantName ? `🏷️ ভ্যারিয়েন্ট/সাইজ: ${opts.variantName}` : "",
    `💰 মূল্য: ${priceFmt}`,
    opts.productUrl ? `🔗 লিঙ্ক: ${opts.productUrl}` : "",
    "",
    "ডেলিভারির জন্য আমার তথ্য:",
    "১. নাম:",
    "২. মোবাইল নম্বর:",
    "৩. সম্পূর্ণ ঠিকানা (জেলা, থানা ও এলাকা):",
  ];
  const text = lines.filter(Boolean).join("\n");
  return generateWhatsAppClickToChatUrl(opts.phone, text);
}
