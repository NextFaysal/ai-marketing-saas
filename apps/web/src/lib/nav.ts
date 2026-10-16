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
  { label: "Stores & Integrations", href: "/dashboard/integrations", icon: "integrations", ready: true },
  { label: "কানেক্ট সেন্টার", href: "/dashboard/connections", icon: "connectCenter", ready: true },
  { label: "Orders", href: "/dashboard/orders", icon: "orders", ready: true },
  { label: "POS / কাউন্টার বিক্রি", href: "/dashboard/pos", icon: "pos", ready: true },
  { label: "Advertising Accounts", href: "/dashboard/ad-accounts", icon: "adAccounts", ready: true },
  { label: "Campaigns", href: "/dashboard/campaigns", icon: "campaigns", ready: true },
  { label: "Social Posts", href: "/dashboard/social-posts", icon: "socialPosts", ready: true },
  { label: "Creatives", href: "/dashboard/creatives", icon: "creatives", ready: true },
  { label: "Media Library", href: "/dashboard/media-library", icon: "mediaLibrary", ready: true },
  { label: "Audiences", href: "/dashboard/audiences", icon: "audiences", ready: true },
  { label: "Campaign Builder", href: "/dashboard/campaign-builder", icon: "campaignBuilder", ready: true },
  { label: "AI Creative Studio", href: "/dashboard/creative-studio", icon: "creativeStudio", ready: true },
  { label: "Analytics", href: "/dashboard/analytics", icon: "analytics", ready: true },
  { label: "Attribution", href: "/dashboard/attribution", icon: "attribution", ready: true },
  { label: "Profit Intelligence", href: "/dashboard/profit", icon: "profit", ready: true },
  { label: "Competitor Analysis", href: "/dashboard/competitors", icon: "competitors", ready: true },
  { label: "Inbox", href: "/dashboard/inbox", icon: "inbox", ready: true },
  { label: "AI Instructions", href: "/dashboard/ai-instructions", icon: "aiInstructions", ready: true },
  { label: "Social Comments AI", href: "/dashboard/comments", icon: "comments", ready: true },
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
