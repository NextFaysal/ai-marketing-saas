"use client";
// ADX2 (Admin UX DB1): single source of truth for admin navigation.
// Consumed by AdminShell (sidebar / mobile drawer) and by the ADX3
// command palette — there is no second nav list anywhere.
import React from "react";

export interface NavItemDef { id: string; labelKey: string; href: string; icon: IconName; countKey?: NavCountKey }
export interface NavGroupDef { id: string; titleKey: string; icon: IconName; items: NavItemDef[] }

export type NavCountKey = "pendingPayouts" | "openTickets" | "failedJobs24h" | "activeAlerts" | "overdueSubscriptions";
/** ADX3: shape of GET /admin/nav-counts. Every field is optional —
 *  the API omits any count it cannot source honestly, and the UI
 *  renders nothing for an absent field (never a fabricated 0). */
export interface NavCounts {
  pendingPayouts?: number;
  openTickets?: number;
  failedJobs24h?: number;
  activeAlerts?: number;
  overdueSubscriptions?: number;
}

export const NAV_GROUPS: NavGroupDef[] = [
  {
    id: "home", titleKey: "nav.groups.home", icon: "home",
    items: [{ id: "commandCenter", labelKey: "nav.items.commandCenter", href: "/", icon: "home" }],
  },
  {
    id: "customers", titleKey: "nav.groups.customers", icon: "users",
    items: [
      { id: "organizations", labelKey: "nav.items.organizations", href: "/orgs", icon: "building" },
      { id: "users", labelKey: "nav.items.users", href: "/users", icon: "users" },
      { id: "search", labelKey: "nav.items.search", href: "/search", icon: "search" },
    ],
  },
  {
    id: "money", titleKey: "nav.groups.money", icon: "wallet",
    items: [
      { id: "billing", labelKey: "nav.items.billing", href: "/billing", icon: "card", countKey: "overdueSubscriptions" },
      { id: "payouts", labelKey: "nav.items.payouts", href: "/payouts", icon: "wallet", countKey: "pendingPayouts" },
      { id: "usage", labelKey: "nav.items.usage", href: "/usage", icon: "gauge" },
    ],
  },
  {
    id: "support", titleKey: "nav.groups.support", icon: "ticket",
    items: [
      { id: "tickets", labelKey: "nav.items.tickets", href: "/tickets", icon: "ticket", countKey: "openTickets" },
      { id: "audit", labelKey: "nav.items.audit", href: "/audit", icon: "list" },
      { id: "security", labelKey: "nav.items.security", href: "/security", icon: "shield" },
    ],
  },
  {
    id: "operations", titleKey: "nav.groups.operations", icon: "activity",
    items: [
      { id: "health", labelKey: "nav.items.health", href: "/health", icon: "activity", countKey: "failedJobs24h" },
      { id: "system", labelKey: "nav.items.system", href: "/system", icon: "server" },
      { id: "alerts", labelKey: "nav.items.alerts", href: "/alerts", icon: "bell", countKey: "activeAlerts" },
      { id: "socialOps", labelKey: "nav.items.socialOps", href: "/social-ops", icon: "share" },
    ],
  },
  {
    id: "growth", titleKey: "nav.groups.growth", icon: "trending",
    items: [
      { id: "analytics", labelKey: "nav.items.analytics", href: "/analytics", icon: "chart" },
      { id: "growth", labelKey: "nav.items.growth", href: "/growth", icon: "trending" },
    ],
  },
  {
    id: "settings", titleKey: "nav.groups.settings", icon: "sliders",
    items: [
      { id: "settings", labelKey: "nav.items.settings", href: "/settings", icon: "sliders" },
      { id: "admins", labelKey: "nav.items.admins", href: "/admins", icon: "user-check" },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItemDef[] = NAV_GROUPS.flatMap((g) => g.items);

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The nav item a pathname belongs to (detail pages map to their list). */
export function navItemForPath(pathname: string): NavItemDef | null {
  return ALL_NAV_ITEMS.find((i) => isActivePath(pathname, i.href)) ?? null;
}

/** The nav group a pathname belongs to (its stable id keys the
 *  sidebar's open-state; its titleKey localizes the heading). */
export function groupForPath(pathname: string): NavGroupDef | null {
  for (const g of NAV_GROUPS) if (g.items.some((i) => isActivePath(pathname, i.href))) return g;
  return null;
}

// ---------------------------------------------------------------------------
// Hand-written inline SVG icon set (Lucide-style, stroke icons).
// No new dependency, no emoji. One distinct icon per nav item.
// ---------------------------------------------------------------------------
export type IconName =
  | "home" | "building" | "users" | "search" | "card" | "wallet" | "gauge"
  | "ticket" | "list" | "shield" | "activity" | "server" | "bell" | "share"
  | "chart" | "trending" | "sliders" | "user-check" | "star" | "clock"
  | "chevron" | "logout" | "command";

const PATHS: Record<IconName, React.ReactNode> = {
  home: (<><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 9.8V20h13V9.8" /><path d="M9.8 20v-5.5h4.4V20" /></>),
  building: (<><path d="M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" /><path d="M15 10h4a1 1 0 0 1 1 1v10" /><path d="M3 21h18" /><path d="M8 8h2M8 12h2M8 16h2" /></>),
  users: (<><circle cx="9" cy="8" r="3.4" /><path d="M3.6 20c.5-3.4 2.7-5.2 5.4-5.2s4.9 1.8 5.4 5.2" /><path d="M15.8 4.9a3.4 3.4 0 0 1 0 6.3" /><path d="M17.6 15.2c1.6.7 2.6 2.2 2.9 4.8" /></>),
  search: (<><circle cx="11" cy="11" r="7" /><path d="m20.5 20.5-4.6-4.6" /></>),
  card: (<><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M7 15h4" /></>),
  wallet: (<><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v1.5" /><path d="M3 7.5V18a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5.5A2.5 2.5 0 0 1 3 7.5Z" /><circle cx="16.8" cy="14.5" r="0.6" fill="currentColor" /></>),
  gauge: (<><path d="M4 15.5a8 8 0 1 1 16 0" /><path d="m12 14.5 4-4.5" /><path d="M2.8 19h18.4" /></>),
  ticket: (<><path d="M3 9V7a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 7v2a2.6 2.6 0 0 0 0 5.2V17a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17v-2.8A2.6 2.6 0 0 0 3 9Z" /><path d="M13.5 7v2M13.5 11v2M13.5 15v2" /></>),
  list: (<><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 .9.9L6.5 4.7" /><path d="m3.5 12 .9.9 2.1-2.2" /><path d="m3.5 18 .9.9 2.1-2.2" /></>),
  shield: (<><path d="M12 3l7 2.4v5.3c0 4.6-2.9 7.9-7 9.8-4.1-1.9-7-5.2-7-9.8V5.4Z" /><path d="m9 11.6 2.1 2.1 3.9-4" /></>),
  activity: (<><path d="M3 12h4l2.5-6.5 4 12L16 12h5" /></>),
  server: (<><rect x="4" y="3.5" width="16" height="7" rx="1.5" /><rect x="4" y="13.5" width="16" height="7" rx="1.5" /><path d="M7.5 7h.8M7.5 17h.8" /></>),
  bell: (<><path d="M6 16v-4.8a6 6 0 1 1 12 0V16l1.4 3H4.6Z" /><path d="M10.2 21a2 2 0 0 0 3.6 0" /></>),
  share: (<><circle cx="6" cy="12" r="2.6" /><circle cx="17.5" cy="5.8" r="2.6" /><circle cx="17.5" cy="18.2" r="2.6" /><path d="m8.3 10.7 6.8-3.7M8.3 13.3l6.8 3.7" /></>),
  chart: (<><path d="M3.5 20.5h17" /><path d="M6.5 20v-5.5M11 20V6.5M15.5 20v-8.5M20 20V9" /></>),
  trending: (<><path d="m3 17 5.8-5.8 3.7 3.7L20.5 7" /><path d="M14.8 7h5.7v5.7" /></>),
  sliders: (<><path d="M4 8h9.5M18.5 8H20M4 16h3.5M12.5 16H20" /><circle cx="16" cy="8" r="2.2" /><circle cx="10" cy="16" r="2.2" /></>),
  "user-check": (<><circle cx="10" cy="8" r="3.4" /><path d="M4.2 20c.5-3.4 2.8-5.2 5.8-5.2 1.1 0 2.1.2 3 .7" /><path d="m15.3 18.8 1.9 1.9 3.6-3.9" /></>),
  star: (<><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.6 9.7l5.8-.8Z" /></>),
  clock: (<><circle cx="12" cy="12" r="8.8" /><path d="M12 7.2V12l3.4 2" /></>),
  chevron: (<><path d="m9 5.5 6.5 6.5L9 18.5" /></>),
  logout: (<><path d="M9 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3H9" /><path d="m16 16.5 5-4.5-5-4.5" /><path d="M21 12H9.5" /></>),
  command: (<><path d="M8.5 8.5a2.3 2.3 0 1 0-2.3 2.3H18.5a2.3 2.3 0 1 0-2.3-2.3v7a2.3 2.3 0 1 0 2.3 2.3H5.7a2.3 2.3 0 1 0 2.3-2.3Z" /><path d="M8.5 5.7v12.6M15.5 5.7v12.6" /></>),
};

export function NavIcon({ name, size = 18, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"}
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" className="shrink-0"
    >
      {PATHS[name]}
    </svg>
  );
}

// ---------------- localStorage persistence helpers ----------------
export const LS_KEYS = {
  collapsed: "admin_nav_collapsed",
  favorites: "admin_nav_favorites",
  recent: "admin_nav_recent",
  groups: "admin_nav_open_groups",
  density: "admin_density",
  recentSearches: "admin_recent_searches",
} as const;

export function lsGetArray(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}
export function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
}
