export interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: string;
  ready: boolean;
  phase?: string;
}

// Main navigation from the product spec. `ready` items exist in this milestone;
// the rest are visibly planned and disabled, never fake-functional.
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Overview", href: "/dashboard", icon: "📊", ready: true },
  { label: "এজেন্সি পোর্টফোলিও", href: "/dashboard/portfolio", icon: "🏢", ready: true },
  { label: "AI Assistant", href: "/dashboard/ai", icon: "🤖", ready: true },
  { label: "Business Knowledge", href: "/dashboard/knowledge", icon: "🧠", ready: true },
  { label: "Products", href: "/dashboard/products", icon: "🛍️", ready: true },
  { label: "Stores & Integrations", href: "/dashboard/integrations", icon: "🔌", ready: true },
  { label: "Orders", href: "/dashboard/orders", icon: "📦", ready: true },
  { label: "Advertising Accounts", href: "/dashboard/ad-accounts", icon: "🎯", ready: true },
  { label: "Campaigns", href: "/dashboard/campaigns", icon: "🚀", ready: true },
  { label: "Social Posts", href: "/dashboard/social-posts", icon: "📣", ready: true },
  { label: "Creatives", href: "/dashboard/creatives", icon: "🎨", ready: true },
  { label: "Audiences", href: "/dashboard/audiences", icon: "👥", ready: true },
  { label: "Campaign Builder", href: "/dashboard/campaign-builder", icon: "⚡", ready: true },
  { label: "AI Creative Studio", href: "/dashboard/creative-studio", icon: "🪄", ready: true },
  { label: "Analytics", href: "/dashboard/analytics", icon: "📈", ready: true },
  { label: "Attribution", href: "/dashboard/attribution", icon: "🔍", ready: true },
  { label: "Profit Intelligence", href: "/dashboard/profit", icon: "💎", ready: true },
  { label: "Competitor Analysis", href: "/dashboard/competitors", icon: "🔭", ready: true },
  { label: "Inbox", href: "/dashboard/inbox", icon: "💬", ready: true },
  { label: "AI Instructions", href: "/dashboard/ai-instructions", icon: "⚙️", ready: true },
  { label: "Social Comments AI", href: "/dashboard/comments", icon: "💬", ready: true },
  { label: "Leads & CRM", href: "/dashboard/leads", icon: "🧲", ready: true },
  { label: "Customers 360", href: "/dashboard/customers", icon: "👤", ready: true },
  { label: "Automations", href: "/dashboard/automations", icon: "⚡", ready: true },
  { label: "Messaging", href: "/dashboard/messaging", icon: "📨", ready: true },
  { label: "Workflows", href: "/dashboard/workflows", icon: "🔀", ready: true },
  { label: "Reports", href: "/dashboard/reports", icon: "📄", ready: true },
  { label: "সাবস্ক্রিপশন ও বিলিং", href: "/dashboard/billing", icon: "💳", ready: true },
  { label: "রেফারেল প্রোগ্রাম", href: "/dashboard/referral", icon: "🎁", ready: true },
  { label: "Support", href: "/dashboard/support", icon: "🎫", ready: true },
  { label: "আপডেটসমূহ", href: "/dashboard/changelog", icon: "✨", ready: true },
  { label: "Team Settings", href: "/dashboard/team", icon: "👥", ready: true },
  { label: "Organization Settings", href: "/dashboard/settings", icon: "⚙️", ready: true },
] as const;
