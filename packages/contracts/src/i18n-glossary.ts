// ML3 — fixed glossary v1 (Multi-Language program, MB1).
//
// The house term table: for each core concept there is exactly ONE
// approved English term and ONE approved Bangla term, so translators
// (human or AI) and dictionary authors stop inventing variants per
// screen. Bangla terms use Bengali script; action labels use the
// polite আপনি tone (সংরক্ষণ করুন, যোগ করুন, খুঁজুন …).
//
// Term choices follow the existing UI's dominant usage (grep of
// apps/web/src at plan time): গ্রাহক for customer (379 hits vs
// কাস্টমার 182), বিশ্লেষণ for analytics (36 vs অ্যানালিটিক্স 10),
// ইনভেন্টরি for inventory (24 vs মজুদ 5). Module names that the UI
// itself treats as loanwords stay loanwords (ড্যাশবোর্ড, ক্যাম্পেইন,
// ব্রডকাস্ট, অডিয়েন্স …). Plural/list concepts use the
// "X তালিকা" pattern instead of awkward pluralised loanwords.

import { normalizeUiLocale, type UiLocale } from "./i18n";

export interface GlossaryEntry {
  key: string;
  en: string;
  bn: string;
}

export const GLOSSARY: ReadonlyArray<GlossaryEntry> = [
  { key: "dashboard", en: "Dashboard", bn: "ড্যাশবোর্ড" },
  { key: "overview", en: "Overview", bn: "সারসংক্ষেপ" },
  { key: "home", en: "Home", bn: "হোম" },
  { key: "settings", en: "Settings", bn: "সেটিংস" },
  { key: "profile", en: "Profile", bn: "প্রোফাইল" },
  { key: "account", en: "Account", bn: "অ্যাকাউন্ট" },
  { key: "organization", en: "Organization", bn: "প্রতিষ্ঠান" },
  { key: "team", en: "Team", bn: "টিম" },
  { key: "member", en: "Member", bn: "সদস্য" },
  { key: "role", en: "Role", bn: "ভূমিকা" },
  { key: "language", en: "Language", bn: "ভাষা" },
  { key: "notifications", en: "Notifications", bn: "নোটিফিকেশন" },
  { key: "support", en: "Support", bn: "সাপোর্ট" },
  { key: "help", en: "Help", bn: "সাহায্য" },
  { key: "login", en: "Log in", bn: "লগইন" },
  { key: "logout", en: "Log out", bn: "লগ আউট" },
  { key: "store", en: "Store", bn: "দোকান" },
  { key: "order", en: "Order", bn: "অর্ডার" },
  { key: "orders", en: "Orders", bn: "অর্ডার তালিকা" },
  { key: "product", en: "Product", bn: "পণ্য" },
  { key: "products", en: "Products", bn: "পণ্য তালিকা" },
  { key: "inventory", en: "Inventory", bn: "ইনভেন্টরি" },
  { key: "stock", en: "Stock", bn: "স্টক" },
  { key: "customer", en: "Customer", bn: "গ্রাহক" },
  { key: "customers", en: "Customers", bn: "গ্রাহক তালিকা" },
  { key: "cart", en: "Cart", bn: "কার্ট" },
  { key: "checkout", en: "Checkout", bn: "চেকআউট" },
  { key: "price", en: "Price", bn: "মূল্য" },
  { key: "total", en: "Total", bn: "মোট" },
  { key: "discount", en: "Discount", bn: "ছাড়" },
  { key: "coupon", en: "Coupon", bn: "কুপন" },
  { key: "review", en: "Review", bn: "রিভিউ" },
  { key: "campaign", en: "Campaign", bn: "ক্যাম্পেইন" },
  { key: "ad", en: "Ad", bn: "বিজ্ঞাপন" },
  { key: "ads", en: "Ads", bn: "বিজ্ঞাপন তালিকা" },
  { key: "audience", en: "Audience", bn: "অডিয়েন্স" },
  { key: "inbox", en: "Inbox", bn: "ইনবক্স" },
  { key: "message", en: "Message", bn: "বার্তা" },
  { key: "broadcast", en: "Broadcast", bn: "ব্রডকাস্ট" },
  { key: "analytics", en: "Analytics", bn: "বিশ্লেষণ" },
  { key: "report", en: "Report", bn: "রিপোর্ট" },
  { key: "revenue", en: "Revenue", bn: "আয়" },
  { key: "sales", en: "Sales", bn: "বিক্রি" },
  { key: "payment", en: "Payment", bn: "পেমেন্ট" },
  { key: "billing", en: "Billing", bn: "বিলিং" },
  { key: "subscription", en: "Subscription", bn: "সাবস্ক্রিপশন" },
  { key: "wallet", en: "Wallet", bn: "ওয়ালেট" },
  { key: "delivery", en: "Delivery", bn: "ডেলিভারি" },
  { key: "courier", en: "Courier", bn: "কুরিয়ার" },
  { key: "save", en: "Save", bn: "সংরক্ষণ করুন" },
  { key: "cancel", en: "Cancel", bn: "বাতিল" },
  { key: "delete", en: "Delete", bn: "মুছুন" },
  { key: "edit", en: "Edit", bn: "সম্পাদনা" },
  { key: "add", en: "Add", bn: "যোগ করুন" },
  { key: "search", en: "Search", bn: "খুঁজুন" },
  { key: "filter", en: "Filter", bn: "ফিল্টার" },
  { key: "export", en: "Export", bn: "এক্সপোর্ট" },
  { key: "import", en: "Import", bn: "ইমপোর্ট" },
];

const GLOSSARY_BY_KEY: ReadonlyMap<string, GlossaryEntry> = new Map(
  GLOSSARY.map((entry) => [entry.key, entry]),
);

/** Look up the approved term for `key` in `locale`.
 * Returns undefined for an unknown key — callers decide the fallback. */
export function glossaryTerm(
  key: string,
  locale: UiLocale,
): string | undefined {
  const entry = GLOSSARY_BY_KEY.get(key);
  if (!entry) return undefined;
  return normalizeUiLocale(locale) === "bn" ? entry.bn : entry.en;
}
