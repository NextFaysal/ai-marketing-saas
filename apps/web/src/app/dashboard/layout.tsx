"use client";
import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";
import { apiFetch, getToken, API_URL } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

const GROUPS: { title: string; hrefs: string[] }[] = [
  { title: "সারসংক্ষেপ", hrefs: ["/dashboard", "/dashboard/ai", "/dashboard/reports"] },
  { title: "বিক্রি ও ডেটা", hrefs: ["/dashboard/products", "/dashboard/integrations", "/dashboard/orders", "/dashboard/attribution", "/dashboard/knowledge"] },
  { title: "বিজ্ঞাপন", hrefs: ["/dashboard/ad-accounts", "/dashboard/campaigns", "/dashboard/campaign-builder", "/dashboard/analytics", "/dashboard/profit", "/dashboard/competitors"] },
  { title: "গ্রাহক ও অটোমেশন", hrefs: ["/dashboard/inbox", "/dashboard/leads", "/dashboard/customers", "/dashboard/messaging", "/dashboard/workflows", "/dashboard/automations"] },
  { title: "সেটিংস", hrefs: ["/dashboard/billing", "/dashboard/support", "/dashboard/team", "/dashboard/settings"] },
];

function userEmailFromToken(): string {
  try {
    const token = getToken();
    if (!token) return "";
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return String(payload.email ?? "");
  } catch { return ""; }
}

function NavContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const byHref = useMemo(() => new Map<string, (typeof NAV_ITEMS)[number]>(NAV_ITEMS.map((i) => [i.href as string, i])), []);
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
      {GROUPS.map((group) => (
        <div key={group.title}>
          <div className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{group.title}</div>
          <div className="space-y-0.5">
            {group.hrefs.map((href) => {
              const item = byHref.get(href);
              if (!item) return null;
              const active = href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
              if (!item.ready) {
                const phase = (item as { phase?: string }).phase ?? "শীঘ্রই";
                return (
                  <div key={href} className="flex items-center justify-between rounded-xl px-3 py-2 text-[13.5px] font-medium text-slate-500/80" title={`আসছে: ${phase}`}>
                    <span>{item.label}</span>
                    <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">{phase}</span>
                  </div>
                );
              }
              return (
                <a key={href} href={href} onClick={onNavigate} className={`nav-link ${active ? "nav-link-active" : ""}`} aria-current={active ? "page" : undefined}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-white" : "bg-slate-500/70"}`} />
                  <span className="truncate">{item.label}</span>
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 pb-5 pt-6">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-[17px] font-black text-white shadow-glow">Q</div>
      <div className="min-w-0">
        <div className="truncate text-[15px] font-bold leading-tight tracking-tight text-white">AI Marketing OS</div>
        <div className="text-[11px] text-slate-400">by Qosprey</div>
      </div>
      <span className="ml-auto rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300 ring-1 ring-inset ring-emerald-300/30">Live</span>
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

interface PlatformStatus {
  maintenanceMode: boolean; signupOpen: boolean; supportContact: string;
  announcement: { title: string; body: string } | null;
  maintenanceWindow?: { startsAt: string; endsAt: string; message: string; hardLockout: boolean; active: boolean; upcoming: boolean } | null;
}

function PlatformBanner() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  useEffect(() => {
    fetch(`${API_URL}/public/system-status`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setStatus(j); }).catch(() => undefined);
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

  useEffect(() => {
    if (!getToken()) { router.push("/login"); return; }
    setEmail(userEmailFromToken());
    // Returning users may not have an organization selected in this
    // browser yet (login alone never set one). Resolve it from the API:
    // first membership wins; no organizations -> onboarding.
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

  useEffect(() => { setDrawer(false); }, [pathname]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" /> লোড হচ্ছে...
        </div>
      </div>
    );
  }

  const current = NAV_ITEMS.find((i) => i.href === pathname) ?? (pathname === "/dashboard" ? NAV_ITEMS[0] : undefined);
  const initials = (email || "U").slice(0, 1).toUpperCase();

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-950 bg-gradient-to-b from-ink-950 via-[#0c1327] to-ink-950">
      <Brand />
      <NavContent pathname={pathname} />
      <div className="border-t border-white/[0.07] p-3">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-xs font-bold text-white">{initials}</span>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-300">{email || "ব্যবহারকারী"}</span>
          <button className="rounded-lg px-2 py-1 text-[12.5px] font-medium text-slate-400 transition hover:bg-white/[0.07] hover:text-red-300"
            onClick={() => { localStorage.clear(); router.push("/login"); }}>লগআউট</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[268px] shrink-0 lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-950/60 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] animate-slide-in shadow-drawer">{sidebar}</aside>
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        {/* Topbar */}
        <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/75 backdrop-blur-xl">
          <div className="mx-auto flex h-[60px] max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 shadow-sm lg:hidden" onClick={() => setDrawer(true)} aria-label="মেনু খুলুন">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <div className="flex items-center gap-2.5 lg:hidden">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-black text-white">Q</span>
            </div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold tracking-tight text-slate-900">{current?.label ?? "Dashboard"}</div>
              <div className="hidden text-[11.5px] text-slate-400 sm:block">AI Marketing Operating System</div>
            </div>
            <div className="ml-auto flex items-center gap-2.5">
              <NotificationBell />
              <span className="badge-brand hidden sm:inline-flex">Demo Workspace</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-[13px] font-bold text-white ring-2 ring-white shadow" title={email}>{initials}</span>
            </div>
          </div>
        </header>

        <ViewAsBanner />
        <PlatformBanner />
        <SubscriptionBanner />
        <main className="mx-auto w-full max-w-[1440px] animate-rise px-4 py-5 sm:px-6 sm:py-7 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
