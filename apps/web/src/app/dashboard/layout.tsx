"use client";
import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";
import { InstallButton } from "@/components/pwa";
import { GlobalAssistant } from "@/components/global-assistant";
import { apiFetch, getToken, API_URL } from "@/lib/api";
import { mediaSrc } from "@/lib/media-src";
import { getOrganizationId } from "@/lib/org";

interface NavGroup {
  id: string;
  title: string;
  icon: string;
  hrefs: string[];
}

const GROUPS: NavGroup[] = [
  {
    id: "core",
    title: "সারসংক্ষেপ ও AI",
    icon: "⚡",
    hrefs: ["/dashboard", "/dashboard/ai", "/dashboard/reports", "/dashboard/portfolio", "/dashboard/knowledge"],
  },
  {
    id: "commerce",
    title: "কমার্স ও সেলস",
    icon: "🛍️",
    hrefs: ["/dashboard/products", "/dashboard/orders", "/dashboard/order-notifications", "/dashboard/fraud", "/dashboard/integrations", "/dashboard/attribution", "/dashboard/profit"],
  },
  {
    id: "marketing",
    title: "বিজ্ঞাপন ও ক্যাম্পেইন",
    icon: "🎯",
    hrefs: ["/dashboard/campaigns", "/dashboard/campaign-builder", "/dashboard/ad-accounts", "/dashboard/social-posts", "/dashboard/creatives", "/dashboard/creative-studio", "/dashboard/audiences", "/dashboard/analytics", "/dashboard/competitors"],
  },
  {
    id: "crm",
    title: "গ্রাহক ও অটোমেশন",
    icon: "💬",
    hrefs: ["/dashboard/inbox", "/dashboard/leads", "/dashboard/customers", "/dashboard/comments", "/dashboard/messaging", "/dashboard/automations", "/dashboard/workflows", "/dashboard/ai-instructions"],
  },
  {
    id: "settings",
    title: "টিম ও সেটিংস",
    icon: "⚙️",
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
  const byHref = useMemo(() => new Map<string, (typeof NAV_ITEMS)[number]>(NAV_ITEMS.map((i) => [i.href as string, i])), []);

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
        // Filter items in this group
        const items = group.hrefs
          .map((href) => byHref.get(href))
          .filter(Boolean) as (typeof NAV_ITEMS)[number][];

        const filtered = isSearching
          ? items.filter((i) => i.label.toLowerCase().includes(q) || i.href.toLowerCase().includes(q))
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
                <span className="text-xs opacity-75">{group.icon}</span>
                <span>{group.title}</span>
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
                  const active = href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
                  if (!item.ready) {
                    const phase = (item as { phase?: string }).phase ?? "শীঘ্রই";
                    return (
                      <div
                        key={href}
                        className="flex items-center justify-between rounded-xl px-2.5 py-2 text-[13px] font-medium text-slate-500/80"
                        title={`আসছে: ${phase}`}
                      >
                        <span className="flex items-center gap-2.5 truncate">
                          <span className="text-sm opacity-50">{item.icon}</span>
                          <span className="truncate">{item.label}</span>
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
                        <span className={`text-[15px] transition-transform group-hover:scale-110 ${active ? "opacity-100" : "opacity-75"}`}>
                          {item.icon}
                        </span>
                        <span className="truncate">{item.label}</span>
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
      <button onClick={toggle} className="relative rounded-full border border-slate-200 bg-white p-2 text-slate-600 shadow-sm" aria-label="নোটিফিকেশন">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg>
        {count > 0 ? <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{count}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border bg-white p-2 shadow-xl">
          <div className="px-2 py-1 text-xs font-bold text-slate-500">নোটিফিকেশন</div>
          {items.length === 0 ? <p className="px-2 py-3 text-sm text-slate-400">কোনো নোটিফিকেশন নেই</p> : items.map((n) => (
            <button key={n.id} onClick={() => readOne(n.id)} className={`block w-full rounded-xl px-2 py-2 text-left hover:bg-slate-50 ${n.readAt ? "opacity-60" : ""}`}>
              <div className="text-[13px] font-medium text-slate-800">{n.type === "urgent" ? "🔴 " : n.type === "mention" ? "@ " : "👤 "}{n.title}</div>
              {n.body ? <div className="truncate text-xs text-slate-500">{n.body}</div> : null}
              <div className="text-[10px] text-slate-400">{new Date(n.createdAt).toLocaleString()}</div>
            </button>
          ))}
          <a href="/dashboard/inbox" className="block px-2 py-1.5 text-center text-xs font-semibold text-brand-600 hover:underline">ইনবক্সে যান</a>
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
        <span>👁 <b>Admin View-As সেশন চলছে</b> — {info.adminEmail} এই ওয়ার্কস্পেসটি {info.mode === "write" ? "Write" : "Read-only"} মোডে দেখছেন। {info.mode !== "write" ? "কোনো পরিবর্তন করা যাবে না।" : "পরিবর্তনগুলো Audit Log এ রেকর্ড হয়।"}</span>
        <button onClick={end} className="ml-auto rounded-lg bg-amber-900 px-3 py-1.5 font-semibold text-white">সেশন শেষ করুন</button>
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
        <span>🧪 <b>Practice Mode চালু আছে</b> — কোনো কিছুই আসল customer-এর কাছে যাবে না। প্র্যাক্টিস বার্তা ও অর্ডার শুধু অনুশীলনের জন্য।</span>
        <a href="/dashboard/setup" className="ml-auto rounded-lg bg-amber-900 px-3 py-1.5 font-semibold text-white">Setup Guide-এ যান</a>
      </div>
    </div>
  );
}

/**
 * Milestone 60: inbox-first mobile bottom navigation. Small
 * screens only (lg:hidden) — the desktop sidebar layout is
 * untouched. "আরও" reuses the existing drawer (full nav), so this
 * bar stays at four thumb-reachable targets. The bar is fixed, so
 * the layout adds a matching spacer under <main> on mobile.
 */
function MobileBottomNav({ pathname, onMore }: { pathname: string; onMore: () => void }) {
  // If user is inside an active chat thread or conversation detail, keep bar tidy
  const items = [
    { label: "হোম", href: "/dashboard", icon: "📊" },
    { label: "ইনবক্স", href: "/dashboard/inbox", icon: "💬" },
    { label: "অর্ডার", href: "/dashboard/orders", icon: "📦" },
    { label: "ক্যাম্পেইন", href: "/dashboard/campaigns", icon: "🚀" },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 backdrop-blur-lg lg:hidden shadow-[0_-4px_20px_rgba(0,0,0,0.05)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="মোবাইল নেভিগেশন"
    >
      <div className="grid grid-cols-5 h-[58px]">
        {items.map((item) => {
          const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
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
              <span className={`text-[17px] leading-none transition-transform ${active ? "scale-110" : ""}`}>{item.icon}</span>
              <span>{item.label}</span>
            </a>
          );
        })}
        <button
          onClick={onMore}
          className="relative flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold text-slate-500 hover:text-slate-800 transition active:scale-95"
          aria-label="সকল মেনু"
        >
          <span className="text-[17px] leading-none">☰</span>
          <span>মেনু</span>
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
          🔧 <b>নির্ধারিত রক্ষণাবেক্ষণ চলছে</b> ({new Date(w.endsAt).toLocaleString("bn-BD")} পর্যন্ত)। {w.message || "কিছু ফিচার সাময়িকভাবে ধীর বা অনুপলব্ধ থাকতে পারে।"}{w.hardLockout ? " এই সময়ে নতুন পরিবর্তন সংরক্ষণ করা যাবে না।" : ""}{status.supportContact ? ` যোগাযোগ: ${status.supportContact}` : ""}
        </div>
      ) : status.maintenanceMode ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          🔧 <b>রক্ষণাবেক্ষণ চলছে:</b> প্ল্যাটফর্ম টিম একটি নির্ধারিত রক্ষণাবেক্ষণ চালাচ্ছে। কিছু ফিচার সাময়িকভাবে ধীর বা অনুপলব্ধ থাকতে পারে।{status.supportContact ? ` যোগাযোগ: ${status.supportContact}` : ""}
        </div>
      ) : null}
      {w?.upcoming ? (
        <div className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          📅 <b>আসন্ন রক্ষণাবেক্ষণ:</b> {new Date(w.startsAt).toLocaleString("bn-BD")} থেকে {new Date(w.endsAt).toLocaleString("bn-BD")} পর্যন্ত। {w.message}
        </div>
      ) : null}
      {status.announcement ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
          📣 <b>{status.announcement.title}</b> — {status.announcement.body}
        </div>
      ) : null}
    </div>
  );
}

interface BillingLite { subscription: { plan: string; status: string; currentPeriodEnd: string | null } | null }

function SubscriptionBanner() {
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
          ⛔ <b>সাবস্ক্রিপশনের মেয়াদ পেরিয়ে গেছে (Past Due):</b> ওয়ার্কস্পেস এখন <b>শুধু দেখার</b> মোডে আছে — নতুন কিছু তৈরি/বদল করা যাবে না। পেমেন্ট বা প্ল্যানের জন্য <a className="font-semibold underline" href="/dashboard/billing">বিলিং পেজে</a> যান।
        </div>
      </div>
    );
  }
  if (sub.status === "TRIALING" && daysLeft !== null && daysLeft <= 7) {
    return (
      <div className="px-4 pt-4 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          ⏳ <b>ট্রায়াল শেষ হতে {daysLeft > 0 ? `${daysLeft} দিন` : "আজই"} বাকি</b> ({sub.plan} প্ল্যান)। চালিয়ে যেতে <a className="font-semibold underline" href="/dashboard/billing">বিলিং পেজ</a> থেকে প্ল্যান বেছে নিন।
        </div>
      </div>
    );
  }
  return null;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
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
        ? "✅ যাচাইকরণ লিংক আবার পাঠানো হয়েছে — ইমেইল (ও Spam ফোল্ডার) চেক করুন।"
        : "ইমেইল পাঠানো যায়নি — কিছুক্ষণ পরে আবার চেষ্টা করুন।");
    } catch { setVerifMsg("ইমেইল পাঠানো যায়নি — কিছুক্ষণ পরে আবার চেষ্টা করুন।"); }
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

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-sm text-slate-500">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
          <span className="font-medium">ড্যাশবোর্ড প্রস্তুত করা হচ্ছে...</span>
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
          <div className="text-4xl">✉️</div>
          <h1 className="text-lg font-bold">আগে ইমেইল যাচাই করুন</h1>
          <p className="text-sm leading-relaxed text-slate-500">
            ড্যাশবোর্ড ব্যবহারের আগে আপনার ইমেইল যাচাই করা আবশ্যক। রেজিস্ট্রেশনের সময়
            <b> {email || "আপনার ইমেইলে"} </b>
            একটি যাচাইকরণ লিংক পাঠানো হয়েছে — লিংকে ক্লিক করলেই যাচাই সম্পন্ন হবে।
          </p>
          {verifMsg ? <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-900">{verifMsg}</p> : null}
          <div className="flex flex-col gap-2">
            <button className="btn-primary min-h-[44px]" disabled={verifBusy} onClick={resendVerification}>
              {verifBusy ? "অপেক্ষা করুন…" : "যাচাইকরণ লিংক আবার পাঠান"}
            </button>
            <button className="btn-secondary min-h-[44px]" disabled={verifBusy} onClick={async () => {
              setVerifBusy(true);
              const still = await checkVerification();
              setVerifMsg(still ? "এখনো যাচাই হয়নি — ইমেইলের লিংকে ক্লিক করে আবার চেষ্টা করুন।" : "");
              setVerifBusy(false);
            }}>আমি যাচাই করেছি, আবার চেক করুন</button>
            <button className="text-sm text-slate-400 underline" onClick={() => { localStorage.clear(); router.push("/login"); }}>লগআউট</button>
          </div>
        </div>
      </div>
    );
  }

  const current = NAV_ITEMS.find((i) => (i.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(i.href))) ?? NAV_ITEMS[0];
  const initials = (email || "U").slice(0, 1).toUpperCase();

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
            placeholder="ফিচার বা মেনু খুঁজুন..."
            className="w-full rounded-xl border border-white/10 bg-white/[0.06] pl-8 pr-7 py-1.5 text-[12.5px] text-white placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white/10 focus:outline-none transition"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">🔍</span>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
            >
              ✕
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
            <div className="truncate text-[12px] font-semibold text-slate-200">{email || "ব্যবহারকারী"}</div>
            <div className="text-[10px] text-slate-400">প্রোফাইল অ্যাক্টিভ</div>
          </div>
          <button
            title="লগআউট"
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
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 lg:flex" style={brandVars}>
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
              aria-label="মেনু খুলুন"
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
                <span className="text-[15px]">{current?.icon}</span>
                <span className="truncate text-[15px] font-bold tracking-tight text-slate-900">{current?.label ?? "Dashboard"}</span>
              </div>
              <div className="hidden text-[11px] text-slate-500 font-medium sm:block">AI Marketing Operating System</div>
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
                💬 ইনবক্স
              </a>
              <a
                href="/dashboard/orders"
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  pathname.startsWith("/dashboard/orders")
                    ? "bg-indigo-50 text-indigo-700 font-bold"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                📦 অর্ডার
              </a>
              <a
                href="/dashboard/campaign-builder"
                className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
              >
                🎯 ক্যাম্পেইন
              </a>
            </div>

            {/* Topbar Right Utilities */}
            <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
              <InstallButton />
              <NotificationBell />

              {/* Workspace Badge */}
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Workspace
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
                        <div className="text-xs font-semibold text-slate-800 truncate">{email || "অ্যাকাউন্ট"}</div>
                        <div className="text-[10px] text-slate-500">অর্গানাইজেশন মেম্বার</div>
                      </div>
                      <div className="py-1 space-y-0.5">
                        <a
                          href="/dashboard/settings"
                          className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          ⚙️ সেটিংস
                        </a>
                        <a
                          href="/dashboard/team"
                          className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          👥 টিম মেম্বার
                        </a>
                        <a
                          href="/dashboard/billing"
                          className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          💳 বিলিং ও প্ল্যান
                        </a>
                        <a
                          href="/dashboard/support"
                          className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          🎫 সাপোর্ট হাব
                        </a>
                      </div>
                      <div className="pt-1 border-t border-slate-100">
                        <button
                          onClick={() => { localStorage.clear(); router.push("/login"); }}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50"
                        >
                          🚪 লগআউট
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

        {/* Main Content Area */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-3.5 py-4 sm:px-6 sm:py-6 lg:px-8 animate-rise">
          {children}
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
  );
}

