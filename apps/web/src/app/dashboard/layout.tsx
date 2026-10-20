"use client";
import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NAV_ITEMS, COMMERCE_NAV_ITEMS, COMMERCE_NAV_SECTIONS } from "@/lib/nav";
import { NAV_ICONS, type NavIconName } from "@/lib/icons";
import { SkipLink } from "@repo/ui";
import { ToastProvider, ConfirmProvider, PromptProvider } from "@repo/ui/client";
import {
  CalendarDays, Clock, Eye, FlaskConical, LogOut, Mail, Megaphone, Menu,
  OctagonX, Search, ShieldCheck, UserRound, Wrench, X,
} from "lucide-react";
import { InstallButton } from "@/components/pwa";
import { RouteProgress } from "@/components/route-progress";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  applyThemeClass,
  DASHBOARD_THEME_INIT_SCRIPT,
  dashboardRoot,
  readStoredThemePref,
} from "@/lib/theme";
import dynamic from "next/dynamic";
import { apiFetch, getToken, API_URL } from "@/lib/api";

const GlobalAssistant = dynamic(
  () => import("@/components/global-assistant").then((mod) => mod.GlobalAssistant),
  { ssr: false }
);
import { mediaSrc } from "@/lib/media-src";
import { getOrganizationId } from "@/lib/org";
import { orgArchived, orgSuspended, type SwitcherOrg } from "@/lib/org-switcher";
import OrgSwitcher from "./OrgSwitcher";
import { LanguageSwitcher, LocaleProvider, useLocale } from "@/lib/i18n/provider";
import { fmtDateTime, fmtNumber } from "@repo/contracts";

interface NavGroup {
  id: string;
  /** Key into the i18n `shell` namespace (MB2 ML4). */
  titleKey: string;
  icon: NavIconName;
  hrefs: string[];
}

const GROUPS: NavGroup[] = [
  {
    id: "core",
    titleKey: "groupCore",
    icon: "groupCore",
    hrefs: ["/dashboard", "/dashboard/ai", "/dashboard/reports", "/dashboard/portfolio", "/dashboard/agency"],
  },
  {
    id: "commerce",
    titleKey: "groupCommerce",
    icon: "groupCommerce",
    hrefs: ["/dashboard/integrations", "/dashboard/attribution", "/dashboard/profit", "/dashboard/funnels", "/dashboard/order-notifications", "/dashboard/fraud"],
  },
  // EB5/ED12: commerce task-grouped sections (বিক্রি/ক্যাটালগ/গ্রাহক/
  // অপারেশন/বৃদ্ধি/টাকা/দোকান) — collapsible like every sibling group.
  ...COMMERCE_NAV_SECTIONS.map((s) => ({
    id: s.id,
    titleKey: s.titleKey,
    icon: "groupCommerce" as NavIconName,
    hrefs: [...s.hrefs],
  })),
  {
    id: "marketing",
    titleKey: "groupMarketing",
    icon: "groupMarketing",
    hrefs: ["/dashboard/campaigns", "/dashboard/campaign-builder", "/dashboard/ad-accounts", "/dashboard/social-posts", "/dashboard/creatives", "/dashboard/creative-studio", "/dashboard/video-studio", "/dashboard/audiences", "/dashboard/analytics", "/dashboard/competitors"],
  },
  {
    id: "crm",
    titleKey: "groupCrm",
    icon: "groupCrm",
    hrefs: ["/dashboard/inbox", "/dashboard/leads", "/dashboard/comments", "/dashboard/messaging", "/dashboard/automations", "/dashboard/workflows", "/dashboard/ai-instructions"],
  },
  {
    id: "settings",
    titleKey: "groupSettings",
    icon: "groupSettings",
    hrefs: ["/dashboard/team", "/dashboard/settings", "/dashboard/settings/webhooks", "/dashboard/billing", "/dashboard/referral", "/dashboard/support", "/dashboard/changelog", "/dashboard/connections", "/dashboard/setup"],
  },
];

function userEmailFromToken(): string {
  try {
    const token = getToken();
    if (!token) return "";
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return String(payload.email ?? "");
  } catch { return ""; }
}

function NavContent({
  pathname,
  onNavigate,
  searchQuery,
}: {
  pathname: string;
  onNavigate?: () => void;
  searchQuery: string;
}) {
  const { dict, t } = useLocale();
  const labelOf = (i: { labelKey: string; label: string }) => t(`shell.${i.labelKey}`) || i.label;
  const byHref = useMemo(
    () => new Map<string, (typeof NAV_ITEMS)[number]>([...NAV_ITEMS, ...COMMERCE_NAV_ITEMS].map((i) => [i.href as string, i])),
    [],
  );

  // Track collapsed groups
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const isSearching = searchQuery.trim().length > 0;
  const q = searchQuery.toLowerCase().trim();

  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4 scrollbar-thin">
      {GROUPS.map((group) => {
        const GroupIcon = NAV_ICONS[group.icon];
        // Filter items in this group
        const items = group.hrefs
          .map((href) => byHref.get(href))
          .filter(Boolean) as (typeof NAV_ITEMS)[number][];

        const filtered = isSearching
          ? items.filter((i) => labelOf(i).toLowerCase().includes(q) || i.href.toLowerCase().includes(q))
          : items;

        if (filtered.length === 0) return null;

        // Auto-expand group if active item is inside or searching
        const hasActiveItem = items.some((i) => (i.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(i.href)));
        const isCollapsed = !isSearching && Boolean(collapsedGroups[group.id]) && !hasActiveItem;

        return (
          <div key={group.id} className="space-y-1">
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              className="flex w-full items-center justify-between px-2.5 py-1 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400/80 transition hover:text-slate-200"
            >
              <span className="flex items-center gap-1.5 truncate">
                <GroupIcon className="h-3.5 w-3.5 opacity-75" />
                <span>{t(`shell.${group.titleKey}`)}</span>
              </span>
              {!isSearching && (
                <span className="text-[10px] text-slate-500 transition-transform duration-200">
                  {isCollapsed ? "▸" : "▾"}
                </span>
              )}
            </button>

            {!isCollapsed && (
              <div className="space-y-0.5 pt-0.5">
                {filtered.map((item) => {
                  const href = item.href;
                  const ItemIcon = NAV_ICONS[item.icon];
                  const active = href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
                  if (!item.ready) {
                    const phase = (item as { phase?: string }).phase ?? dict.shell.comingSoon;
                    return (
                      <div
                        key={href}
                        className="flex items-center justify-between rounded-xl px-2.5 py-2 text-[13px] font-medium text-slate-500/80"
                        title={t("shell.comingTitle", { phase })}
                      >
                        <span className="flex items-center gap-2.5 truncate">
                          <ItemIcon className="h-4 w-4 opacity-50" />
                          <span className="truncate">{labelOf(item)}</span>
                        </span>
                        <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">
                          {phase}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <a
                      key={href}
                      href={href}
                      onClick={onNavigate}
                      className={`group flex items-center justify-between rounded-xl px-2.5 py-2 text-[13px] font-medium transition-all duration-150 ${
                        active
                          ? "bg-gradient-to-r from-indigo-500/90 to-violet-600/90 text-white font-semibold shadow-glow"
                          : "text-slate-300 hover:bg-white/[0.08] hover:text-white"
                      }`}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <ItemIcon className={`h-[18px] w-[18px] transition-transform group-hover:scale-110 ${active ? "opacity-100" : "opacity-75"}`} />
                        <span className="truncate">{labelOf(item)}</span>
                      </span>
                      {active && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white shadow-sm" />
                      )}
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export interface OrgBrandingLite {
  name?: string; brandName?: string | null; logoUrl?: string | null; primaryColor?: string | null;
}

function Brand({ branding }: { branding?: OrgBrandingLite | null }) {
  const branded = Boolean(branding?.brandName || branding?.logoUrl);
  const title = branding?.brandName ?? branding?.name ?? "AI Marketing OS";
  const initial = (branding?.brandName ?? branding?.name ?? "Q").slice(0, 1).toUpperCase();
  return (
    <div className="flex items-center gap-3 px-4 pb-4 pt-5 border-b border-white/[0.06]">
      {branding?.logoUrl ? (
        <img src={mediaSrc(API_URL, branding.logoUrl) ?? ""} alt="" className="h-10 w-10 shrink-0 rounded-2xl bg-white object-contain p-0.5 ring-1 ring-white/20 shadow-glow" />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-500 text-[18px] font-black text-white shadow-glow">
          {branded ? initial : "Q"}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-bold leading-tight tracking-tight text-white">{title}</div>
        <div className="text-[11px] font-medium text-slate-400/90">{branded ? "AI Marketing OS" : "by Qosprey"}</div>
      </div>
      <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-inset ring-emerald-300/30">
        Live
      </span>
    </div>
  );
}


function NotificationBell() {
  const { dict, locale } = useLocale();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ id: string; type: string; title: string; body?: string | null; conversationId?: string | null; readAt?: string | null; createdAt: string }[]>([]);
  const loadCount = React.useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const r = await apiFetch<{ count: number }>(`/organizations/${orgId}/inbox/notifications/unread-count`);
      setCount(r.count);
    } catch { /* notifications are best-effort UI */ }
  }, []);
  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 30000);
    return () => clearInterval(t);
  }, [loadCount]);
  async function toggle() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!open) {
      try { setItems(await apiFetch(`/organizations/${orgId}/inbox/notifications`)); } catch { /* ignore */ }
    }
    setOpen(!open);
  }
  async function readOne(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/inbox/notifications/${id}/read`, { method: "POST" }).catch(() => undefined);
    setItems(items.map((n) => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
    loadCount();
  }
  return (
    <div className="relative">
      <button onClick={toggle} className="relative rounded-full border border-slate-200 bg-white p-2 text-slate-600 shadow-sm" aria-label={dict.shell.notifications}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg>
        {count > 0 ? <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{count}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border bg-white p-2 shadow-xl">
          <div className="px-2 py-1 text-xs font-bold text-slate-500">{dict.shell.notifications}</div>
          {items.length === 0 ? <p className="px-2 py-3 text-sm text-slate-400">{dict.shell.notificationsEmpty}</p> : items.map((n) => (
            <button key={n.id} onClick={() => readOne(n.id)} className={`block w-full rounded-xl px-2 py-2 text-left hover:bg-slate-50 ${n.readAt ? "opacity-60" : ""}`}>
              <div className="text-[13px] font-medium text-slate-800">{n.type === "urgent" ? <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500 align-middle" /> : n.type === "mention" ? "@ " : <UserRound className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-slate-500" />}{n.title}</div>
              {n.body ? <div className="truncate text-xs text-slate-500">{n.body}</div> : null}
              <div className="text-[10px] text-slate-400">{fmtDateTime(locale, n.createdAt)}</div>
            </button>
          ))}
          <a href="/dashboard/inbox" className="block px-2 py-1.5 text-center text-xs font-semibold text-brand-600 hover:underline">{dict.shell.goToInbox}</a>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Milestone 38 (Admin Phase A2): view-as banner. The token's
 * payload is decoded client-side for display only (the API
 * enforces everything server-side). Ending the session just
 * discards the token — view-as tokens live 30 minutes max.
 */
function ViewAsBanner() {
  const { dict, t } = useLocale();
  const [info, setInfo] = useState<{ adminEmail: string; mode: string } | null>(null);
  useEffect(() => {
    try {
      const token = localStorage.getItem("accessToken");
      if (!token) return;
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload?.viewAs) setInfo({ adminEmail: payload.viewAs.adminEmail ?? "admin", mode: payload.viewAs.mode ?? "read" });
    } catch { /* not a view-as token */ }
  }, []);
  if (!info) return null;
  const end = () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("organizationId");
    window.location.href = "/login";
  };
  return (
    <div className="px-4 pt-4 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400 bg-amber-100 px-4 py-3 text-sm text-amber-950">
        <span><Eye className="mr-1 inline h-4 w-4 -translate-y-px" /><b>{dict.shell.viewAsTitle}</b> — {t("shell.viewAsBody", { email: info.adminEmail, mode: info.mode === "write" ? dict.shell.viewAsModeWrite : dict.shell.viewAsModeRead })} {info.mode !== "write" ? dict.shell.viewAsReadNote : dict.shell.viewAsWriteNote}</span>
        <button onClick={end} className="ml-auto rounded-lg bg-amber-900 px-3 py-1.5 font-semibold text-white">{dict.shell.viewAsEnd}</button>
      </div>
    </div>
  );
}

/**
 * CX12a: Practice Mode banner. While the org's practiceMode flag
 * is on, EVERY dashboard page carries this strip — the team must
 * never be able to mistake a practice surface for a live one.
 * State comes from GET /organizations/:id/practice (any member
 * may read it); failures render nothing (best-effort UI).
 */
function PracticeBanner() {
  const { dict } = useLocale();
  const [on, setOn] = useState(false);
  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await apiFetch<{ practiceMode: boolean }>(`/organizations/${orgId}/practice`);
        if (alive) setOn(Boolean(r.practiceMode));
      } catch { /* banner is best-effort UI */ }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!on) return null;
  return (
    <div className="px-4 pt-4 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400 bg-amber-100 px-4 py-3 text-sm text-amber-950">
        <span><FlaskConical className="mr-1 inline h-4 w-4 -translate-y-px" /><b>{dict.shell.practiceTitle}</b> — {dict.shell.practiceBody}</span>
        <a href="/dashboard/setup" className="ml-auto rounded-lg bg-amber-900 px-3 py-1.5 font-semibold text-white">{dict.shell.practiceLink}</a>
      </div>
    </div>
  );
}

/**
 * Milestone 60: inbox-first mobile bottom navigation. Small
 * screens only (lg:hidden) — the desktop sidebar layout is
 * untouched. "আরও" reuses the existing drawer (full nav), so this
 * bar stays at five thumb-reachable targets plus the menu button
 * (EB6: POS added after অর্ডার). The bar is fixed, so the layout
 * adds a matching spacer under <main> on mobile.
 */
function MobileBottomNav({ pathname, onMore }: { pathname: string; onMore: () => void }) {
  const { dict } = useLocale();
  // If user is inside an active chat thread or conversation detail, keep bar tidy
  const items: { label: string; href: string; icon: NavIconName }[] = [
    { label: dict.shell.mobileHome, href: "/dashboard", icon: "overview" },
    { label: dict.shell.mobileInbox, href: "/dashboard/inbox", icon: "inbox" },
    { label: dict.shell.mobileOrders, href: "/dashboard/orders", icon: "orders" },
    { label: dict.shell.mobilePos, href: "/dashboard/pos", icon: "pos" },
    { label: dict.shell.mobileCampaigns, href: "/dashboard/campaigns", icon: "campaigns" },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 backdrop-blur-lg lg:hidden shadow-[0_-4px_20px_rgba(0,0,0,0.05)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label={dict.shell.mobileNavLabel}
    >
      <div className="grid grid-cols-6 h-[58px]">
        {items.map((item) => {
          const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
          const ItemIcon = NAV_ICONS[item.icon];
          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold transition active:scale-95 ${
                active ? "text-indigo-600 font-bold" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {active && (
                <span className="absolute top-0 h-0.5 w-6 rounded-full bg-indigo-600 shadow-sm" />
              )}
              <ItemIcon className={`h-5 w-5 transition-transform ${active ? "scale-110" : ""}`} />
              <span>{item.label}</span>
            </a>
          );
        })}
        <button
          onClick={onMore}
          className="relative flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold text-slate-500 hover:text-slate-800 transition active:scale-95"
          aria-label={dict.shell.allMenus}
        >
          <Menu className="h-5 w-5" />
          <span>{dict.shell.mobileMenu}</span>
        </button>
      </div>
    </nav>
  );
}


interface PlatformStatus {
  maintenanceMode: boolean; signupOpen: boolean; supportContact: string;
  announcement: { title: string; body: string } | null;
  maintenanceWindow?: { startsAt: string; endsAt: string; message: string; hardLockout: boolean; active: boolean; upcoming: boolean } | null;
}

function PlatformBanner() {
  const { dict, t, locale } = useLocale();
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  useEffect(() => {
    const oid = getOrganizationId();
    fetch(`${API_URL}/public/system-status${oid ? `?organizationId=${encodeURIComponent(oid)}` : ""}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setStatus(j); }).catch(() => undefined);
  }, []);
  if (!status || (!status.maintenanceMode && !status.announcement && !status.maintenanceWindow?.upcoming)) return null;
  const w = status.maintenanceWindow;
  return (
    <div className="space-y-2 px-4 pt-4 sm:px-6 lg:px-8">
      {w?.active ? (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <Wrench className="mr-1 inline h-4 w-4 -translate-y-px" /><b>{dict.shell.maintActiveTitle}</b> ({fmtDateTime(locale, w.endsAt)} {dict.shell.maintUntilSuffix})। {w.message || dict.shell.maintFallback}{w.hardLockout ? ` ${dict.shell.maintHardLockout}` : ""}{status.supportContact ? ` ${dict.shell.contactPrefix} ${status.supportContact}` : ""}
        </div>
      ) : status.maintenanceMode ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Wrench className="mr-1 inline h-4 w-4 -translate-y-px" /><b>{dict.shell.maintTitle}</b> {dict.shell.maintBody}{status.supportContact ? ` ${dict.shell.contactPrefix} ${status.supportContact}` : ""}
        </div>
      ) : null}
      {w?.upcoming ? (
        <div className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <CalendarDays className="mr-1 inline h-4 w-4 -translate-y-px" /><b>{dict.shell.maintUpcomingTitle}</b> {t("shell.maintUpcomingRange", { starts: fmtDateTime(locale, w.startsAt), ends: fmtDateTime(locale, w.endsAt) })} {w.message}
        </div>
      ) : null}
      {status.announcement ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          <Megaphone className="mr-1 inline h-4 w-4 -translate-y-px" /><b>{status.announcement.title}</b> — {status.announcement.body}
        </div>
      ) : null}
    </div>
  );
}

interface BillingLite { subscription: { plan: string; status: string; currentPeriodEnd: string | null } | null }

function SubscriptionBanner() {
  const { dict, t, locale } = useLocale();
  const [sub, setSub] = useState<BillingLite["subscription"]>(null);
  useEffect(() => {
    let tries = 0;
    let cancelled = false;
    const attempt = () => {
      const orgId = getOrganizationId();
      if (!orgId) { if (++tries <= 3) setTimeout(attempt, 700); return; }
      // OWNER/ADMIN only endpoint — members get a refusal and simply
      // see no banner.
      apiFetch<BillingLite>(`/organizations/${orgId}/billing`)
        .then((b) => { if (!cancelled) setSub(b.subscription); })
        .catch(() => undefined);
    };
    attempt();
    return () => { cancelled = true; };
  }, []);
  if (!sub) return null;
  const daysLeft = sub.currentPeriodEnd ? Math.ceil((new Date(sub.currentPeriodEnd).getTime() - Date.now()) / 86400000) : null;
  if (sub.status === "PAST_DUE") {
    return (
      <div className="px-4 pt-4 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <OctagonX className="mr-1 inline h-4 w-4 -translate-y-px" /><b>{dict.shell.pastDueTitle}</b> {dict.shell.pastDueBodyBefore} <b>{dict.shell.pastDueReadOnly}</b> {dict.shell.pastDueBodyAfter} <a className="font-semibold underline" href="/dashboard/billing">{dict.shell.billingPageLink}</a> {dict.shell.pastDueGoSuffix}
        </div>
      </div>
    );
  }
  if (sub.status === "TRIALING" && daysLeft !== null && daysLeft <= 7) {
    return (
      <div className="px-4 pt-4 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Clock className="mr-1 inline h-4 w-4 -translate-y-px" /><b>{daysLeft > 0 ? t("shell.trialEndsIn", { days: `${fmtNumber(locale, daysLeft)} ${dict.shell.trialDaysUnit}` }) : dict.shell.trialEndsToday}</b> {t("shell.trialPlanSuffix", { plan: sub.plan })} <a className="font-semibold underline" href="/dashboard/billing">{dict.shell.billingPageLink}</a> {dict.shell.trialChooseSuffix}
        </div>
      </div>
    );
  }
  return null;
}

/**
 * ORG3/ORG4 (Organization Next OB1): when the CURRENT org is
 * platform-suspended or owner-archived, TenantGuard refuses its
 * org APIs — rendering the normal pages would only produce error
 * noise. This gate reads listMine (GET /organizations — NOT
 * org-scoped, so it answers in both states) and swaps the page
 * for a plain-language explanation instead. No internal platform
 * reason is ever exposed here (owner decision D5 default: a
 * tenant-safe summary only). Fail-open: any fetch trouble
 * renders the children untouched.
 */
function OrgStateGate({ children }: { children: React.ReactNode }) {
  const { dict, t, locale } = useLocale();
  const [gate, setGate] = useState<"loading" | "open" | "suspended" | "archived" | "mfa" | "session">("loading");
  const [org, setOrg] = useState<SwitcherOrg | null>(null);
  const [supportContact, setSupportContact] = useState("");
  const [busy, setBusy] = useState("");
  const [gateError, setGateError] = useState("");
  const [exportsList, setExportsList] = useState<{ id: string; status: string; createdAt: string }[]>([]);

  const pathname = usePathname() ?? "";
  const isOwner = org?.myRole === "OWNER";

  useEffect(() => {
    let alive = true;
    const id = getOrganizationId();
    if (!id) { setGate("open"); return; }
    apiFetch<SwitcherOrg[]>("/organizations")
      .then((rows) => {
        if (!alive) return;
        const mine = (Array.isArray(rows) ? rows : []).find((o) => o.id === id) ?? null;
        setOrg(mine);
        if (mine && orgSuspended(mine)) { setGate("suspended"); return; }
        if (mine && orgArchived(mine)) { setGate("archived"); return; }
        // ORG11 (OB4): an open org can still block THIS member —
        // its security policy (MFA requirement / session-age cap)
        // is enforced per request by TenantGuard. Probe the
        // policy read (deliberately allowlisted, so it answers
        // while blocked) and show the matching plain-language
        // screen instead of a page full of 403s. Fail-open: any
        // probe trouble renders the children untouched.
        apiFetch<{ myMfaBlocked?: boolean; mySessionBlocked?: boolean }>(`/organizations/${id}/security-policy`)
          .then((pol) => {
            if (!alive) return;
            if (pol?.myMfaBlocked) setGate("mfa");
            else if (pol?.mySessionBlocked) setGate("session");
            else setGate("open");
          })
          .catch(() => { if (alive) setGate("open"); });
      })
      .catch(() => { if (alive) setGate("open"); });
    fetch(`${API_URL}/public/system-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.supportContact) setSupportContact(String(j.supportContact)); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const loadExports = React.useCallback(async () => {
    const id = getOrganizationId(); if (!id) return;
    try {
      const j: any = await apiFetch<any>(`/organizations/${id}/data-exports`);
      const rows = (Array.isArray(j) ? j : j?.exports ?? j?.items ?? []) as { id: string; status: string; createdAt: string }[];
      setExportsList(rows);
    } catch { /* export list is a convenience here — the Settings data card is the full surface */ }
  }, []);

  useEffect(() => { if (gate === "archived" && isOwner) void loadExports(); }, [gate, isOwner, loadExports]);

  async function restore() {
    const id = getOrganizationId(); if (!id) return;
    setBusy("restore"); setGateError("");
    try {
      await apiFetch(`/organizations/${id}/restore`, { method: "POST" });
      window.location.reload();
    } catch (e) { setGateError(e instanceof Error ? e.message : dict.shell.restoreErrorFallback); setBusy(""); }
  }

  async function createExport() {
    const id = getOrganizationId(); if (!id) return;
    setBusy("export"); setGateError("");
    try {
      await apiFetch(`/organizations/${id}/data-exports`, { method: "POST" });
      await loadExports();
    } catch (e) { setGateError(e instanceof Error ? e.message : dict.shell.exportErrorFallback); }
    finally { setBusy(""); }
  }

  async function downloadExport(row: { id: string }) {
    const id = getOrganizationId(); if (!id) return;
    setBusy(`dl-${row.id}`); setGateError("");
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/organizations/${id}/data-exports/${row.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(dict.shell.downloadExpiredError);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `org-export-${row.id}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setGateError(e instanceof Error ? e.message : dict.shell.downloadErrorFallback); }
    finally { setBusy(""); }
  }

  // The cross-org portfolio summary is not org-scoped work —
  // it stays reachable so a user with one stopped org can still
  // see (and switch away from) their other organizations.
  if (pathname.startsWith("/dashboard/portfolio")) return <>{children}</>;
  if (gate === "loading") {
    return <p className="py-10 text-center text-sm text-slate-400">{dict.common.loading}</p>;
  }
  if (gate === "open" || !org) return <>{children}</>;

  if (gate === "suspended") {
    const deleted = org.status === "DELETED";
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="card space-y-4 p-6 text-center sm:p-8">
          <div className="flex justify-center"><OctagonX className="h-11 w-11 text-rose-500" /></div>
          <h1 className="text-lg font-bold text-slate-900">
            {deleted ? dict.shell.suspendedTitleDeleted : dict.shell.suspendedTitle}
          </h1>
          <p className="text-sm leading-relaxed text-slate-600">
            {t("shell.suspendedBody", { org: org.name })}
            {deleted ? ` ${dict.shell.suspendedDeletedSuffix}` : ` ${dict.shell.suspendedActiveSuffix}`}
          </p>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {dict.shell.supportNote}
            {supportContact ? <> — <b>{supportContact}</b></> : null}।
          </p>
          <p className="text-xs text-slate-400">{dict.shell.switchOrgHint}</p>
        </div>
      </div>
    );
  }

  if (gate === "mfa") {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="card space-y-4 p-6 text-center sm:p-8">
          <div className="flex justify-center"><ShieldCheck className="h-11 w-11 text-sky-500" /></div>
          <h1 className="text-lg font-bold text-slate-900">{dict.shell.mfaTitle}</h1>
          <p className="text-sm leading-relaxed text-slate-600">
            {t("shell.mfaBody", { org: org.name })}
          </p>
          <a className="btn-primary inline-block min-h-[44px] px-5 leading-[44px]" href="/dashboard/settings#hub-my-security">
            {dict.shell.mfaCta}
          </a>
          <p className="text-xs text-slate-400">{dict.shell.switchOrgHint} — {dict.shell.switchOrgHintRuleSuffix}</p>
        </div>
      </div>
    );
  }

  if (gate === "session") {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="card space-y-4 p-6 text-center sm:p-8">
          <div className="flex justify-center"><Clock className="h-11 w-11 text-sky-500" /></div>
          <h1 className="text-lg font-bold text-slate-900">{dict.shell.sessionTitle}</h1>
          <p className="text-sm leading-relaxed text-slate-600">
            {t("shell.sessionBody", { org: org.name })}
          </p>
          <button
            type="button"
            className="btn-primary min-h-[44px] px-5"
            onClick={() => { localStorage.clear(); window.location.href = "/login"; }}
          >
            {dict.shell.sessionCta}
          </button>
          <p className="text-xs text-slate-400">{dict.shell.switchOrgHint} — {dict.shell.switchOrgHintRuleSuffix}</p>
        </div>
      </div>
    );
  }

  // gate === "archived"
  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="card space-y-4 p-6 text-center sm:p-8">
        <div className="flex justify-center"><Clock className="h-11 w-11 text-amber-500" /></div>
        <h1 className="text-lg font-bold text-slate-900">{dict.shell.archivedTitle}</h1>
        <p className="text-sm leading-relaxed text-slate-600">
          {t("shell.archivedBodyPrefix", { org: org.name })}
          {isOwner
            ? ` ${dict.shell.archivedOwnerSuffix}`
            : ` ${dict.shell.archivedMemberSuffix}`}
        </p>
        {org.archivedAt ? (
          <p className="text-xs text-slate-400">{dict.shell.archivedAtLabel} {fmtDateTime(locale, org.archivedAt)}</p>
        ) : null}
        {gateError ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{gateError}</div> : null}
        {isOwner ? (
          <div className="space-y-4 text-left">
            <button className="btn-primary min-h-[44px] w-full" disabled={busy !== ""} onClick={restore}>
              {busy === "restore" ? dict.common.wait : dict.shell.restoreCta}
            </button>
            <div className="rounded-xl bg-slate-50 p-4">
              <h2 className="mb-1 text-sm font-semibold text-slate-800">{dict.shell.exportTitle}</h2>
              <p className="mb-3 text-xs leading-relaxed text-slate-500">{dict.shell.exportHelp}</p>
              <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={createExport}>
                {busy === "export" ? dict.shell.exportBusy : dict.shell.exportNow}
              </button>
              {exportsList.length ? (
                <ul className="mt-3 space-y-1.5">
                  {exportsList.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-100">
                      <span className="text-slate-600">
                        {fmtDateTime(locale, row.createdAt)}
                        <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${row.status === "ready" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{row.status}</span>
                      </span>
                      {row.status === "ready" ? (
                        <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => downloadExport(row)}>
                          {busy === `dl-${row.id}` ? dict.shell.downloadingBusy : dict.common.download}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
        <p className="text-xs text-slate-400">{dict.shell.switchOrgHint}</p>
      </div>
    </div>
  );
}

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const { dict, t, locale } = useLocale();
  const router = useRouter();
  const pathname = usePathname() ?? "/dashboard";
  const [ready, setReady] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [email, setEmail] = useState("");
  const [branding, setBranding] = useState<OrgBrandingLite | null>(null);
  // GC21 (GB9): the email-verification wall. me() reports
  // verificationRequired exactly when the API gate would 403
  // tenant routes (grandfathered users never see this).
  const [verifRequired, setVerifRequired] = useState(false);
  const [verifMsg, setVerifMsg] = useState("");
  const [verifBusy, setVerifBusy] = useState(false);

  const checkVerification = React.useCallback(async () => {
    try {
      const me = await apiFetch<{ verificationRequired?: boolean }>("/auth/me");
      setVerifRequired(me.verificationRequired === true);
      return me.verificationRequired === true;
    } catch { return false; }
  }, []);

  useEffect(() => { if (getToken()) void checkVerification(); }, [checkVerification]);

  async function resendVerification() {
    setVerifBusy(true); setVerifMsg("");
    try {
      const out = await apiFetch<{ sent: boolean; reason?: string }>("/auth/verification/email", { method: "POST" });
      setVerifMsg(out.sent
        ? dict.shell.verifSentMsg
        : dict.shell.verifSendFailMsg);
    } catch { setVerifMsg(dict.shell.verifSendFailMsg); }
    finally { setVerifBusy(false); }
  }

  const [searchQuery, setSearchQuery] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    let tries = 0;
    let cancelled = false;
    const attempt = () => {
      const orgId = getOrganizationId();
      if (!orgId) { if (++tries <= 4) setTimeout(attempt, 700); return; }
      apiFetch<OrgBrandingLite>(`/organizations/${orgId}`)
        .then((o) => { if (!cancelled) setBranding(o); })
        .catch(() => undefined);
    };
    attempt();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    let stopped = false;
    const beat = () => {
      const orgId = getOrganizationId();
      if (orgId && !stopped) {
        apiFetch(`/organizations/${orgId}/inbox/presence/heartbeat`, { method: "POST" }).catch(() => undefined);
      }
    };
    beat();
    const t = setInterval(beat, 60_000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    setEmail(userEmailFromToken());
    if (!getOrganizationId()) {
      apiFetch<{ id: string }[]>("/organizations")
        .then((orgs) => {
          if (orgs.length > 0) { localStorage.setItem("organizationId", orgs[0].id); setReady(true); }
          else router.push("/onboarding");
        })
        .catch(() => setReady(true));
      return;
    }
    setReady(true);
  }, [router]);

  useEffect(() => { setDrawer(false); setUserMenuOpen(false); }, [pathname]);

  // EB6/ED16: Escape closes the mobile drawer (only while open).
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  // ED17 (EB7): dark mode — re-assert the theme class after mount.
  // The pre-paint bootstrap script inside the root element applies
  // it during parse in the common case; this effect is the
  // guarantee (hydration or a hoisted script can never leave a
  // wrong final state). The ThemeToggle owns later changes.
  useEffect(() => {
    applyThemeClass(dashboardRoot(), readStoredThemePref());
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-sm text-slate-500">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
          <span className="font-medium">{dict.shell.preparingDashboard}</span>
        </div>
      </div>
    );
  }

  // GC21 (GB9): blocking verification wall — shown INSTEAD of
  // the dashboard while the account email is unverified and the
  // platform gate applies to this user.
  if (verifRequired) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="card w-full max-w-md space-y-4 p-6 text-center">
          <div className="flex justify-center"><Mail className="h-10 w-10 text-indigo-500" /></div>
          <h1 className="text-lg font-bold">{dict.shell.verifTitle}</h1>
          <p className="text-sm leading-relaxed text-slate-500">
            {dict.shell.verifBodyBefore}
            <b> {email || dict.shell.yourEmailFallback} </b>
            {dict.shell.verifBodyAfter}
          </p>
          {verifMsg ? <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">{verifMsg}</p> : null}
          <div className="flex flex-col gap-2">
            <button className="btn-primary min-h-[44px]" disabled={verifBusy} onClick={resendVerification}>
              {verifBusy ? dict.common.wait : dict.shell.verifResend}
            </button>
            <button className="btn-secondary min-h-[44px]" disabled={verifBusy} onClick={async () => {
              setVerifBusy(true);
              const still = await checkVerification();
              setVerifMsg(still ? dict.shell.verifStillMsg : "");
              setVerifBusy(false);
            }}>{dict.shell.verifRecheck}</button>
            <button className="text-sm text-slate-400 underline" onClick={() => { localStorage.clear(); router.push("/login"); }}>{dict.shell.logout}</button>
          </div>
        </div>
      </div>
    );
  }

  const current = NAV_ITEMS.find((i) => (i.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(i.href))) ?? NAV_ITEMS[0];
  const initials = (email || "U").slice(0, 1).toUpperCase();
  const CurrentIcon = NAV_ICONS[current.icon];

  const sidebar = (
    <div className="flex h-full flex-col bg-[#0b0f19] border-r border-white/[0.08] text-white">
      <Brand branding={branding} />

      {/* Sidebar Search Bar */}
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={dict.shell.searchPlaceholder}
            className="w-full rounded-xl border border-white/10 bg-white/[0.06] pl-8 pr-7 py-1.5 text-[12.5px] text-white placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white/10 focus:outline-none transition"
          />
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Navigation Groups */}
      <NavContent pathname={pathname} onNavigate={() => setDrawer(false)} searchQuery={searchQuery} />

      {/* Sidebar Footer User Section */}
      <div className="border-t border-white/[0.08] p-3 bg-white/[0.02]">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white shadow-sm ring-1 ring-white/20">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-slate-200">{email || dict.shell.userFallback}</div>
            <div className="text-[10px] text-slate-400">{dict.shell.profileActive}</div>
          </div>
          <button
            title={dict.shell.logout}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400"
            onClick={() => { localStorage.clear(); router.push("/login"); }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );

  const brandVars = branding?.primaryColor
    ? ({ "--brand-from": branding.primaryColor, "--brand-to": branding.primaryColor } as React.CSSProperties)
    : undefined;

  return (
    <ToastProvider>
      <ConfirmProvider>
        <PromptProvider>
    {/* EB6/ED16: lang="bn" on this subtree root — the dashboard UI is
        Bengali-first. The document <html> lang stays "en": a per-route
        html lang would need headers() in the root layout, forcing
        dynamic rendering app-wide and breaking the shop's ISR.
        Subtree lang attributes are what screen readers apply to
        content, so this div is the correct place to declare it. */}
    <div lang={locale} className="dashboard-root min-h-screen bg-[#f8fafc] text-slate-900 lg:flex" style={brandVars}>
      {/* ED17 (EB7): dark-mode bootstrap — applies the stored/system
          theme class to this root before the subtree paints (see
          lib/theme.ts for the placement contract + fallback). */}
      <script dangerouslySetInnerHTML={{ __html: DASHBOARD_THEME_INIT_SCRIPT }} />
      {/* EB6/ED16: skip link — first focusable element in the layout. */}
      <SkipLink href="#main-content">{dict.shell.skipToContent}</SkipLink>
      {/* ED11 (EB4): route progress bar (soft-nav feedback). */}
      <RouteProgress />
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[270px] shrink-0 lg:block shadow-xl z-30">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity"
            onClick={() => setDrawer(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[285px] max-w-[85vw] shadow-2xl animate-slide-in">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1 flex flex-col">
        {/* Modern Glassmorphic Topbar */}
        <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-md transition-all">
          <div className="mx-auto flex h-[62px] max-w-[1440px] items-center gap-3 px-3.5 sm:px-6 lg:px-8">
            <button
              className="rounded-xl border border-slate-200/90 bg-white p-2 text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 lg:hidden"
              onClick={() => setDrawer(true)}
              aria-label={dict.shell.openMenu}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <div className="flex items-center gap-2.5 lg:hidden">
              {branding?.logoUrl ? (
                <img src={mediaSrc(API_URL, branding.logoUrl) ?? ""} alt="" className="h-8 w-8 rounded-xl bg-white object-contain p-0.5 ring-1 ring-slate-200" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-black text-white shadow-sm">
                  Q
                </span>
              )}
            </div>

            {/* Breadcrumb / Page Title */}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <CurrentIcon className="h-[18px] w-[18px]" />
                <span className="truncate text-[15px] font-bold tracking-tight text-slate-900">{current ? t(`shell.${current.labelKey}`) : dict.shell.dashboard}</span>
              </div>
              <div className="hidden text-[11px] text-slate-500 font-medium sm:block">{dict.shell.subtitle}</div>
            </div>

            {/* Quick Link Pills on Tablet/Desktop */}
            <div className="hidden md:flex items-center gap-1.5 ml-6">
              <a
                href="/dashboard/inbox"
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  pathname.startsWith("/dashboard/inbox")
                    ? "bg-indigo-50 text-indigo-700 font-bold"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <NAV_ICONS.inbox className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />{dict.shell.quickInbox}
              </a>
              <a
                href="/dashboard/orders"
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  pathname.startsWith("/dashboard/orders")
                    ? "bg-indigo-50 text-indigo-700 font-bold"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <NAV_ICONS.orders className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />{dict.shell.quickOrders}
              </a>
              <a
                href="/dashboard/campaign-builder"
                className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
              >
                <NAV_ICONS.adAccounts className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />{dict.shell.quickCampaigns}
              </a>
            </div>

            {/* Topbar Right Utilities */}
            <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
              {/* OU1: Organization switcher — active memberships,
                  honest full-reload switching, create + portfolio. */}
              <OrgSwitcher />
              {/* ML3 (MB1): dashboard language switcher — sets the
                  user's personal locale preference via LocaleProvider. */}
              <LanguageSwitcher />
              <InstallButton />
              {/* ED17 (EB7): dark-mode toggle (সিস্টেম/লাইট/ডার্ক). */}
              <ThemeToggle />
              <NotificationBell />

              {/* Workspace Badge */}
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {dict.shell.liveWorkspace}
              </span>

              {/* User Avatar & Menu */}
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-[13px] font-bold text-white ring-2 ring-white shadow-sm transition hover:ring-indigo-200"
                  title={email}
                >
                  {initials}
                </button>

                {userMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                    <div className="absolute right-0 top-11 z-50 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl animate-fade-in">
                      <div className="px-3 py-2 border-b border-slate-100">
                        <div className="text-xs font-semibold text-slate-800 truncate">{email || dict.shell.accountFallback}</div>
                        <div className="text-[10px] text-slate-500">{dict.shell.orgMember}</div>
                      </div>
                      <div className="py-1 space-y-0.5">
                        <a
                          href="/dashboard/settings"
                          className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <NAV_ICONS.orgSettings className="h-4 w-4" /> {dict.shell.menuSettings}
                        </a>
                        <a
                          href="/dashboard/team"
                          className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <NAV_ICONS.team className="h-4 w-4" /> {dict.shell.menuTeam}
                        </a>
                        <a
                          href="/dashboard/billing"
                          className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <NAV_ICONS.billing className="h-4 w-4" /> {dict.shell.menuBilling}
                        </a>
                        <a
                          href="/dashboard/support"
                          className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {dict.shell.menuSupport}
                        </a>
                      </div>
                      <div className="pt-1 border-t border-slate-100">
                        <button
                          onClick={() => { localStorage.clear(); router.push("/login"); }}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50"
                        >
                          <LogOut className="h-4 w-4" /> {dict.shell.logout}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <ViewAsBanner />
        <PracticeBanner />
        <PlatformBanner />
        <SubscriptionBanner />

        {/* Main Content Area — ED11 (EB4): the entrance utility
            is now the token-timed .animate-rise-in (same 350ms /
            6px rise the tailwind animate-rise produced; one
            animation, not two). */}
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-1 px-3.5 py-4 sm:px-6 sm:py-6 lg:px-8 animate-rise-in">
          <OrgStateGate>{children}</OrgStateGate>
        </main>

        {/* Mobile bottom nav spacer */}
        <div className="h-16 lg:hidden" />
      </div>

      <MobileBottomNav pathname={pathname} onMore={() => setDrawer(true)} />
      {/* Global Assistant: AI help from every dashboard page
          (floating button + Ctrl/⌘+J). Renders nothing on the
          AI page itself, where the full workspace already lives. */}
      <GlobalAssistant />
    </div>
        </PromptProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <LocaleProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </LocaleProvider>
  );
}

