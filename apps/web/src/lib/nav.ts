import type { NavIconName } from "./icons";
import { shellBn } from "./i18n/shell";

export interface NavItem {
  /**
   * bn display label, derived from the shell dictionary
   * (lib/i18n/shell.ts) via `labelKey` — kept for non-locale-aware
   * consumers (breadcrumb, tests). Locale-aware surfaces (the
   * dashboard layout) resolve `labelKey` against the ACTIVE
   * locale's shell namespace instead.
   */
  label: string;
  /** Key into the i18n `shell` namespace (MB2 ML4). */
  labelKey: string;
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
  { label: shellBn.navOverview, labelKey: "navOverview", href: "/dashboard", icon: "overview", ready: true },
  { label: shellBn.navPortfolio, labelKey: "navPortfolio", href: "/dashboard/portfolio", icon: "portfolio", ready: true },
  { label: shellBn.navAgency, labelKey: "navAgency", href: "/dashboard/agency", icon: "portfolio", ready: true },
  { label: shellBn.navAi, labelKey: "navAi", href: "/dashboard/ai", icon: "aiAssistant", ready: true },
  { label: shellBn.navKnowledge, labelKey: "navKnowledge", href: "/dashboard/knowledge", icon: "knowledge", ready: true },
  { label: shellBn.navProducts, labelKey: "navProducts", href: "/dashboard/products", icon: "products", ready: true },
  { label: shellBn.navInventory, labelKey: "navInventory", href: "/dashboard/inventory", icon: "inventoryForecast", ready: true },
  { label: shellBn.navIntegrations, labelKey: "navIntegrations", href: "/dashboard/integrations", icon: "integrations", ready: true },
  { label: shellBn.navConnections, labelKey: "navConnections", href: "/dashboard/connections", icon: "connectCenter", ready: true },
  { label: shellBn.navOrders, labelKey: "navOrders", href: "/dashboard/orders", icon: "orders", ready: true },
  { label: shellBn.navPos, labelKey: "navPos", href: "/dashboard/pos", icon: "pos", ready: true },
  { label: shellBn.navLiveCommerce, labelKey: "navLiveCommerce", href: "/dashboard/live-commerce", icon: "socialPosts", ready: true },
  { label: shellBn.navServices, labelKey: "navServices", href: "/dashboard/services", icon: "storefront", ready: true },
  { label: shellBn.navBookings, labelKey: "navBookings", href: "/dashboard/bookings", icon: "orders", ready: true },
  { label: shellBn.navPromotions, labelKey: "navPromotions", href: "/dashboard/promotions", icon: "campaigns", ready: true },
  { label: shellBn.navDelivery, labelKey: "navDelivery", href: "/dashboard/delivery", icon: "dispatch", ready: true },
  { label: shellBn.navAdAccounts, labelKey: "navAdAccounts", href: "/dashboard/ad-accounts", icon: "adAccounts", ready: true },
  { label: shellBn.navCampaigns, labelKey: "navCampaigns", href: "/dashboard/campaigns", icon: "campaigns", ready: true },
  { label: shellBn.navInfluencers, labelKey: "navInfluencers", href: "/dashboard/influencers", icon: "influencers", ready: true },
  { label: shellBn.navSocialPosts, labelKey: "navSocialPosts", href: "/dashboard/social-posts", icon: "socialPosts", ready: true },
  { label: shellBn.navCreatives, labelKey: "navCreatives", href: "/dashboard/creatives", icon: "creatives", ready: true },
  { label: shellBn.navMediaLibrary, labelKey: "navMediaLibrary", href: "/dashboard/media-library", icon: "mediaLibrary", ready: true },
  { label: shellBn.navAudiences, labelKey: "navAudiences", href: "/dashboard/audiences", icon: "audiences", ready: true },
  { label: shellBn.navCampaignBuilder, labelKey: "navCampaignBuilder", href: "/dashboard/campaign-builder", icon: "campaignBuilder", ready: true },
  { label: shellBn.navCreativeStudio, labelKey: "navCreativeStudio", href: "/dashboard/creative-studio", icon: "creativeStudio", ready: true },
  { label: shellBn.navVideoStudio, labelKey: "navVideoStudio", href: "/dashboard/video-studio", icon: "creativeStudio", ready: true },
  { label: shellBn.navFunnels, labelKey: "navFunnels", href: "/dashboard/funnels", icon: "funnels", ready: true },
  { label: shellBn.navAnalytics, labelKey: "navAnalytics", href: "/dashboard/analytics", icon: "analytics", ready: true },
  { label: shellBn.navAttribution, labelKey: "navAttribution", href: "/dashboard/attribution", icon: "attribution", ready: true },
  { label: shellBn.navProfit, labelKey: "navProfit", href: "/dashboard/profit", icon: "profit", ready: true },
  { label: shellBn.navCompetitors, labelKey: "navCompetitors", href: "/dashboard/competitors", icon: "competitors", ready: true },
  { label: shellBn.navInbox, labelKey: "navInbox", href: "/dashboard/inbox", icon: "inbox", ready: true },
  { label: shellBn.navAiInstructions, labelKey: "navAiInstructions", href: "/dashboard/ai-instructions", icon: "aiInstructions", ready: true },
  { label: shellBn.navComments, labelKey: "navComments", href: "/dashboard/comments", icon: "comments", ready: true },
  { label: shellBn.navSocialSelling, labelKey: "navSocialSelling", href: "/dashboard/social-selling", icon: "socialPosts", ready: true },
  { label: shellBn.navWhatsappBot, labelKey: "navWhatsappBot", href: "/dashboard/whatsapp-bot", icon: "whatsappBot", ready: true },
  { label: shellBn.navLeads, labelKey: "navLeads", href: "/dashboard/leads", icon: "leads", ready: true },
  { label: shellBn.navCustomers, labelKey: "navCustomers", href: "/dashboard/customers", icon: "customers", ready: true },
  { label: shellBn.navAutomations, labelKey: "navAutomations", href: "/dashboard/automations", icon: "automations", ready: true },
  { label: shellBn.navMessaging, labelKey: "navMessaging", href: "/dashboard/messaging", icon: "messaging", ready: true },
  { label: shellBn.navWorkflows, labelKey: "navWorkflows", href: "/dashboard/workflows", icon: "workflows", ready: true },
  { label: shellBn.navReports, labelKey: "navReports", href: "/dashboard/reports", icon: "reports", ready: true },
  { label: shellBn.navBilling, labelKey: "navBilling", href: "/dashboard/billing", icon: "billing", ready: true },
  { label: shellBn.navReferral, labelKey: "navReferral", href: "/dashboard/referral", icon: "referral", ready: true },
  { label: shellBn.navSupport, labelKey: "navSupport", href: "/dashboard/support", icon: "support", ready: true },
  { label: shellBn.navChangelog, labelKey: "navChangelog", href: "/dashboard/changelog", icon: "changelog", ready: true },
  { label: shellBn.navSetup, labelKey: "navSetup", href: "/dashboard/setup", icon: "setup", ready: true },
  { label: shellBn.navTeam, labelKey: "navTeam", href: "/dashboard/team", icon: "team", ready: true },
  { label: shellBn.navHr, labelKey: "navHr", href: "/dashboard/hr", icon: "team", ready: true },
  { label: shellBn.navSettings, labelKey: "navSettings", href: "/dashboard/settings", icon: "orgSettings", ready: true },
  { label: shellBn.navSettingsWebhooks, labelKey: "navSettingsWebhooks", href: "/dashboard/settings/webhooks", icon: "webhooks", ready: true },
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
  { label: shellBn.navCommerceHub, labelKey: "navCommerceHub", href: "/dashboard/commerce", icon: "groupCommerce", ready: true },
  { label: shellBn.navCommerceQuotes, labelKey: "navCommerceQuotes", href: "/dashboard/commerce/quotes", icon: "quotes", ready: true },
  { label: shellBn.navCommerceBundles, labelKey: "navCommerceBundles", href: "/dashboard/commerce/bundles", icon: "bundles", ready: true },
  { label: shellBn.navCommerceLoyalty, labelKey: "navCommerceLoyalty", href: "/dashboard/commerce/loyalty", icon: "loyalty", ready: true },
  { label: shellBn.navCommerceGiftCards, labelKey: "navCommerceGiftCards", href: "/dashboard/commerce/gift-cards", icon: "giftCards", ready: true },
  { label: shellBn.navCommerceDispatch, labelKey: "navCommerceDispatch", href: "/dashboard/commerce/dispatch", icon: "dispatch", ready: true },
  { label: shellBn.navCommercePrint, labelKey: "navCommercePrint", href: "/dashboard/commerce/print", icon: "storefront", ready: true },
  { label: shellBn.navCommerceWarehouse, labelKey: "navCommerceWarehouse", href: "/dashboard/commerce/warehouse", icon: "warehouse", ready: true },
  { label: shellBn.navCommerceReturns, labelKey: "navCommerceReturns", href: "/dashboard/commerce/returns", icon: "returns", ready: true },
  { label: shellBn.navCommerceReconciliation, labelKey: "navCommerceReconciliation", href: "/dashboard/commerce/reconciliation", icon: "reconciliation", ready: true },
  { label: shellBn.navCommercePromotions, labelKey: "navCommercePromotions", href: "/dashboard/commerce/promotions", icon: "promotionsNav", ready: true },
  { label: shellBn.navCommerceDiscounts, labelKey: "navCommerceDiscounts", href: "/dashboard/commerce/discounts", icon: "discounts", ready: true },
  { label: shellBn.navCommerceLandings, labelKey: "navCommerceLandings", href: "/dashboard/commerce/landings", icon: "landings", ready: true },
  { label: shellBn.navCommerceAbandoned, labelKey: "navCommerceAbandoned", href: "/dashboard/commerce/abandoned", icon: "abandoned", ready: true },
  { label: shellBn.navCommerceFinance, labelKey: "navCommerceFinance", href: "/dashboard/commerce/finance", icon: "finance", ready: true },
  { label: shellBn.navCommerceReports, labelKey: "navCommerceReports", href: "/dashboard/commerce/reports", icon: "commerceReports", ready: true },
  { label: shellBn.navCommerceStorefront, labelKey: "navCommerceStorefront", href: "/dashboard/commerce/storefront", icon: "storefront", ready: true },
  { label: shellBn.navCommerceInstallments, labelKey: "navCommerceInstallments", href: "/dashboard/commerce/installments", icon: "installments", ready: true },
  { label: shellBn.navCommerceSubscriptions, labelKey: "navCommerceSubscriptions", href: "/dashboard/commerce/subscriptions", icon: "subscriptions", ready: true },
  { label: shellBn.navCommercePurchasing, labelKey: "navCommercePurchasing", href: "/dashboard/commerce/purchasing", icon: "purchasing", ready: true },
  { label: shellBn.navCommerceDropship, labelKey: "navCommerceDropship", href: "/dashboard/commerce/dropship", icon: "affiliates", ready: true },
  { label: shellBn.navCommerceAccounting, labelKey: "navCommerceAccounting", href: "/dashboard/commerce/accounting", icon: "accounting", ready: true },
  { label: shellBn.navCommerceAffiliates, labelKey: "navCommerceAffiliates", href: "/dashboard/commerce/affiliates", icon: "affiliates", ready: true },
  { label: shellBn.navCommerceReviews, labelKey: "navCommerceReviews", href: "/dashboard/commerce/reviews", icon: "reviews", ready: true },
  { label: shellBn.navCommerceQuestions, labelKey: "navCommerceQuestions", href: "/dashboard/commerce/questions", icon: "questions", ready: true },
  { label: shellBn.navCommerceFeeds, labelKey: "navCommerceFeeds", href: "/dashboard/commerce/feeds", icon: "feeds", ready: true },
  { label: shellBn.navCommerceSync, labelKey: "navCommerceSync", href: "/dashboard/commerce/sync", icon: "sync", ready: true },
  { label: shellBn.navCommerceInventoryIntelligence, labelKey: "navCommerceInventoryIntelligence", href: "/dashboard/commerce/inventory-intelligence", icon: "inventoryIntelligence", ready: true },
] as const;

/** Task-grouped commerce sections (ED12). `hrefs` order = render order.
 *  `title` is the bn section title derived from the shell dictionary
 *  via `titleKey` (pinned verbatim by nav-commerce.test.ts); the
 *  layout resolves `titleKey` for the active locale. */
export const COMMERCE_NAV_SECTIONS: readonly { id: string; title: string; titleKey: string; hrefs: readonly string[] }[] = [
  { id: "commerce-sell", title: shellBn.sectionCommerceSell, titleKey: "sectionCommerceSell", hrefs: ["/dashboard/orders", "/dashboard/pos", "/dashboard/live-commerce", "/dashboard/services", "/dashboard/bookings", "/dashboard/commerce/quotes"] },
  { id: "commerce-catalog", title: shellBn.sectionCommerceCatalog, titleKey: "sectionCommerceCatalog", hrefs: ["/dashboard/products", "/dashboard/commerce/bundles", "/dashboard/commerce/feeds", "/dashboard/commerce/reviews", "/dashboard/commerce/questions"] },
  { id: "commerce-customers", title: shellBn.sectionCommerceCustomers, titleKey: "sectionCommerceCustomers", hrefs: ["/dashboard/customers", "/dashboard/commerce/loyalty", "/dashboard/commerce/gift-cards"] },
  { id: "commerce-ops", title: shellBn.sectionCommerceOps, titleKey: "sectionCommerceOps", hrefs: ["/dashboard/commerce/dispatch", "/dashboard/delivery", "/dashboard/commerce/warehouse", "/dashboard/commerce/returns", "/dashboard/commerce/reconciliation", "/dashboard/commerce/inventory-intelligence", "/dashboard/commerce/sync", "/dashboard/commerce/print", "/dashboard/commerce/dropship"] },
  { id: "commerce-growth", title: shellBn.sectionCommerceGrowth, titleKey: "sectionCommerceGrowth", hrefs: ["/dashboard/commerce/promotions", "/dashboard/commerce/discounts", "/dashboard/commerce/landings", "/dashboard/commerce/abandoned"] },
  { id: "commerce-money", title: shellBn.sectionCommerceMoney, titleKey: "sectionCommerceMoney", hrefs: ["/dashboard/commerce/finance", "/dashboard/commerce/reports", "/dashboard/commerce/installments", "/dashboard/commerce/subscriptions", "/dashboard/commerce/purchasing", "/dashboard/commerce/accounting", "/dashboard/commerce/affiliates"] },
  { id: "commerce-shop", title: shellBn.sectionCommerceShop, titleKey: "sectionCommerceShop", hrefs: ["/dashboard/commerce", "/dashboard/commerce/storefront"] },
] as const;
