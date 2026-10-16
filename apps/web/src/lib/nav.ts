import type { NavIconName } from "./icons";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconName;
  badge?: string;
  ready: boolean;
  phase?: string;
}

// Main navigation from the product spec. `ready` items exist in this milestone;
// the rest are visibly planned and disabled, never fake-functional.
// `icon` is a semantic key into NAV_ICONS (lib/icons.ts) — ED3.
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Overview", href: "/dashboard", icon: "overview", ready: true },
  { label: "এজেন্সি পোর্টফোলিও", href: "/dashboard/portfolio", icon: "portfolio", ready: true },
  { label: "AI Assistant", href: "/dashboard/ai", icon: "aiAssistant", ready: true },
  { label: "Business Knowledge", href: "/dashboard/knowledge", icon: "knowledge", ready: true },
  { label: "Products", href: "/dashboard/products", icon: "products", ready: true },
  { label: "ইনভেন্টরি ফোরকাস্টিং", href: "/dashboard/inventory", icon: "inventoryForecast", ready: true },
  { label: "Stores & Integrations", href: "/dashboard/integrations", icon: "integrations", ready: true },
  { label: "কানেক্ট সেন্টার", href: "/dashboard/connections", icon: "connectCenter", ready: true },
  { label: "Orders", href: "/dashboard/orders", icon: "orders", ready: true },
  { label: "POS / কাউন্টার বিক্রি", href: "/dashboard/pos", icon: "pos", ready: true },
  { label: "Advertising Accounts", href: "/dashboard/ad-accounts", icon: "adAccounts", ready: true },
  { label: "Campaigns", href: "/dashboard/campaigns", icon: "campaigns", ready: true },
  { label: "ইনফ্লুয়েন্সার ও পার্টনার", href: "/dashboard/influencers", icon: "influencers", ready: true },
  { label: "Social Posts", href: "/dashboard/social-posts", icon: "socialPosts", ready: true },
  { label: "Creatives", href: "/dashboard/creatives", icon: "creatives", ready: true },
  { label: "Media Library", href: "/dashboard/media-library", icon: "mediaLibrary", ready: true },
  { label: "Audiences", href: "/dashboard/audiences", icon: "audiences", ready: true },
  { label: "Campaign Builder", href: "/dashboard/campaign-builder", icon: "campaignBuilder", ready: true },
  { label: "AI Creative Studio", href: "/dashboard/creative-studio", icon: "creativeStudio", ready: true },
  { label: "AI সেলস ফানেল", href: "/dashboard/funnels", icon: "funnels", ready: true },
  { label: "Analytics", href: "/dashboard/analytics", icon: "analytics", ready: true },
  { label: "Attribution", href: "/dashboard/attribution", icon: "attribution", ready: true },
  { label: "Profit Intelligence", href: "/dashboard/profit", icon: "profit", ready: true },
  { label: "Competitor Analysis", href: "/dashboard/competitors", icon: "competitors", ready: true },
  { label: "Inbox", href: "/dashboard/inbox", icon: "inbox", ready: true },
  { label: "AI Instructions", href: "/dashboard/ai-instructions", icon: "aiInstructions", ready: true },
  { label: "Social Comments AI", href: "/dashboard/comments", icon: "comments", ready: true },
  { label: "WhatsApp ক্যাটালগ ও বট", href: "/dashboard/whatsapp-bot", icon: "whatsappBot", ready: true },
  { label: "Leads & CRM", href: "/dashboard/leads", icon: "leads", ready: true },
  { label: "Customers 360", href: "/dashboard/customers", icon: "customers", ready: true },
  { label: "Automations", href: "/dashboard/automations", icon: "automations", ready: true },
  { label: "Messaging", href: "/dashboard/messaging", icon: "messaging", ready: true },
  { label: "Workflows", href: "/dashboard/workflows", icon: "workflows", ready: true },
  { label: "Reports", href: "/dashboard/reports", icon: "reports", ready: true },
  { label: "সাবস্ক্রিপশন ও বিলিং", href: "/dashboard/billing", icon: "billing", ready: true },
  { label: "রেফারেল প্রোগ্রাম", href: "/dashboard/referral", icon: "referral", ready: true },
  { label: "Support", href: "/dashboard/support", icon: "support", ready: true },
  { label: "আপডেটসমূহ", href: "/dashboard/changelog", icon: "changelog", ready: true },
  { label: "Setup Guide", href: "/dashboard/setup", icon: "setup", ready: true },
  { label: "Team Settings", href: "/dashboard/team", icon: "team", ready: true },
  { label: "Organization Settings", href: "/dashboard/settings", icon: "orgSettings", ready: true },
  { label: "Webhooks", href: "/dashboard/settings/webhooks", icon: "webhooks", ready: true },
] as const;

// ── EB5/ED12 — Commerce navigation ──────────────────────────────────
// The commerce sub-pages used to be reachable only via the hub page
// (/dashboard/commerce), which itself was not in the sidebar. These
// items + task-grouped sections put every hub destination into the
// shell nav. The layout renders each section as its own collapsible
// group (same GROUPS mechanism as its siblings). Items that already
// exist above (Orders, POS, Products, Customers 360) are referenced
// by href — never duplicated, since the shell indexes items by href.
export const COMMERCE_NAV_ITEMS: readonly NavItem[] = [
  { label: "কমার্স হাব", href: "/dashboard/commerce", icon: "groupCommerce", ready: true },
  { label: "কোটেশন", href: "/dashboard/commerce/quotes", icon: "quotes", ready: true },
  { label: "বান্ডল", href: "/dashboard/commerce/bundles", icon: "bundles", ready: true },
  { label: "লয়ালটি পয়েন্ট", href: "/dashboard/commerce/loyalty", icon: "loyalty", ready: true },
  { label: "গিফট কার্ড", href: "/dashboard/commerce/gift-cards", icon: "giftCards", ready: true },
  { label: "কুরিয়ার হাব", href: "/dashboard/commerce/dispatch", icon: "dispatch", ready: true },
  { label: "প্রিন্ট সেন্টার", href: "/dashboard/commerce/print", icon: "storefront", ready: true },
  { label: "গুদাম / ওয়্যারহাউস", href: "/dashboard/commerce/warehouse", icon: "warehouse", ready: true },
  { label: "রিটার্ন", href: "/dashboard/commerce/returns", icon: "returns", ready: true },
  { label: "পেমেন্ট মিলানো", href: "/dashboard/commerce/reconciliation", icon: "reconciliation", ready: true },
  { label: "প্রমোশন", href: "/dashboard/commerce/promotions", icon: "promotionsNav", ready: true },
  { label: "ডিসকাউন্ট / কুপন", href: "/dashboard/commerce/discounts", icon: "discounts", ready: true },
  { label: "ল্যান্ডিং পেজ", href: "/dashboard/commerce/landings", icon: "landings", ready: true },
  { label: "Abandoned Carts", href: "/dashboard/commerce/abandoned", icon: "abandoned", ready: true },
  { label: "কমার্স ফাইন্যান্স", href: "/dashboard/commerce/finance", icon: "finance", ready: true },
  { label: "কমার্স রিপোর্ট", href: "/dashboard/commerce/reports", icon: "commerceReports", ready: true },
  { label: "Storefront / দোকান", href: "/dashboard/commerce/storefront", icon: "storefront", ready: true },
  { label: "কিস্তি (Installments)", href: "/dashboard/commerce/installments", icon: "installments", ready: true },
  { label: "সাবস্ক্রিপশন", href: "/dashboard/commerce/subscriptions", icon: "subscriptions", ready: true },
  { label: "ক্রয় (Purchasing)", href: "/dashboard/commerce/purchasing", icon: "purchasing", ready: true },
  { label: "হিসাব (Accounting)", href: "/dashboard/commerce/accounting", icon: "accounting", ready: true },
  { label: "অ্যাফিলিয়েট", href: "/dashboard/commerce/affiliates", icon: "affiliates", ready: true },
  { label: "রিভিউ", href: "/dashboard/commerce/reviews", icon: "reviews", ready: true },
  { label: "প্রশ্নোত্তর", href: "/dashboard/commerce/questions", icon: "questions", ready: true },
  { label: "প্রোডাক্ট ফিড", href: "/dashboard/commerce/feeds", icon: "feeds", ready: true },
  { label: "Sync Center", href: "/dashboard/commerce/sync", icon: "sync", ready: true },
  { label: "ইনভেন্টরি ইন্টেলিজেন্স", href: "/dashboard/commerce/inventory-intelligence", icon: "inventoryIntelligence", ready: true },
] as const;

/** Task-grouped commerce sections (ED12). `hrefs` order = render order. */
export const COMMERCE_NAV_SECTIONS: readonly { id: string; title: string; hrefs: readonly string[] }[] = [
  { id: "commerce-sell", title: "কমার্স — বিক্রি", hrefs: ["/dashboard/orders", "/dashboard/pos", "/dashboard/commerce/quotes"] },
  { id: "commerce-catalog", title: "কমার্স — ক্যাটালগ", hrefs: ["/dashboard/products", "/dashboard/commerce/bundles", "/dashboard/commerce/feeds", "/dashboard/commerce/reviews", "/dashboard/commerce/questions"] },
  { id: "commerce-customers", title: "কমার্স — গ্রাহক", hrefs: ["/dashboard/customers", "/dashboard/commerce/loyalty", "/dashboard/commerce/gift-cards"] },
  { id: "commerce-ops", title: "কমার্স — অপারেশন", hrefs: ["/dashboard/commerce/dispatch", "/dashboard/commerce/warehouse", "/dashboard/commerce/returns", "/dashboard/commerce/reconciliation", "/dashboard/commerce/inventory-intelligence", "/dashboard/commerce/sync", "/dashboard/commerce/print"] },
  { id: "commerce-growth", title: "কমার্স — বৃদ্ধি", hrefs: ["/dashboard/commerce/promotions", "/dashboard/commerce/discounts", "/dashboard/commerce/landings", "/dashboard/commerce/abandoned"] },
  { id: "commerce-money", title: "কমার্স — টাকা", hrefs: ["/dashboard/commerce/finance", "/dashboard/commerce/reports", "/dashboard/commerce/installments", "/dashboard/commerce/subscriptions", "/dashboard/commerce/purchasing", "/dashboard/commerce/accounting", "/dashboard/commerce/affiliates"] },
  { id: "commerce-shop", title: "কমার্স — দোকান", hrefs: ["/dashboard/commerce", "/dashboard/commerce/storefront"] },
] as const;
