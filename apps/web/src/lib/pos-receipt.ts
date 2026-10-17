/**
 * POS 80mm & 58mm Thermal Receipt Customizer and Barcode Generator
 * Tailored for Bangladeshi retail outlets, fashion shops, and grocery counters.
 */
import { code128SvgString } from "./code128";

export interface ReceiptCustomizationSettings {
  storeName: string;
  tagline: string;
  phone: string;
  address: string;
  returnPolicy: string;
  footerGreeting: string;
  showBarcode: boolean;
  paperWidth: "80mm" | "58mm";
}

export const DEFAULT_RECEIPT_SETTINGS: ReceiptCustomizationSettings = {
  storeName: "আমাদের শপ",
  tagline: "প্রিমিয়াম কোয়ালিটি ও নির্ভরযোগ্য সেবা",
  phone: "017XXXXXXXX",
  address: "মিরপুর-১০, ঢাকা-১২১৬",
  returnPolicy: "পণ্য ক্রয়ের ৭ দিনের মধ্যে অক্ষত অবস্থায় ক্যাশ মেমোসহ পরিবর্তনযোগ্য (ছেঁড়া/ব্যবহৃত পণ্য ফেরতযোগ্য নয়)।",
  footerGreeting: "আমাদের সাথে থাকার জন্য আন্তরিক ধন্যবাদ! আবার আসবেন 🙏",
  showBarcode: true,
  paperWidth: "80mm",
};

const STORAGE_KEY_PREFIX = "pos_receipt_settings_";

export function getStoredReceiptSettings(orgId: string): ReceiptCustomizationSettings {
  if (typeof window === "undefined") return DEFAULT_RECEIPT_SETTINGS;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${orgId}`);
    if (!raw) return DEFAULT_RECEIPT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_RECEIPT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_RECEIPT_SETTINGS;
  }
}

export function saveStoredReceiptSettings(
  orgId: string,
  settings: Partial<ReceiptCustomizationSettings>
): ReceiptCustomizationSettings {
  const merged: ReceiptCustomizationSettings = {
    ...DEFAULT_RECEIPT_SETTINGS,
    ...settings,
  };
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${orgId}`, JSON.stringify(merged));
    } catch {
      // storage unavailable
    }
  }
  return merged;
}

export interface BarcodeLabelData {
  productName: string;
  skuOrBarcode: string;
  priceFormatted: string;
  category?: string;
}

/**
 * Generates ready-to-render SVG barcode for product label or receipt footer
 */
export function generateBarcodeSvg(value: string, height = 40): string {
  try {
    const clean = value.trim();
    if (!clean) return "";
    return code128SvgString(clean, height);
  } catch {
    return "";
  }
}

export interface BarcodePrintSheetConfig {
  labelsCount: number;
  layout: "single_sticker" | "a4_sheet_24";
  product: BarcodeLabelData;
}

export function calculateLabelGrid(labelsCount: number): { totalPages: number; labelsPerPage: number } {
  const count = Math.max(1, labelsCount || 1);
  const labelsPerPage = 24; // 3 columns x 8 rows standard A4
  const totalPages = Math.ceil(count / labelsPerPage);
  return { totalPages, labelsPerPage };
}
