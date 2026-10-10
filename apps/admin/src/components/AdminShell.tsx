"use client";
import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch, getAdminToken, setAdminToken } from "@/lib/api";

const NAV_GROUPS: { title: string; items: { label: string; icon: string; href: string }[] }[] = [
  {
    title: "প্রধান",
    items: [
      { label: "Command Center", icon: "📊", href: "/" },
      { label: "Analytics", icon: "💹", href: "/analytics" },
    ],
  },
  {
    title: "ব্যবস্থাপনা",
    items: [
      { label: "Users", icon: "👤", href: "/users" },
      { label: "Organizations", icon: "🏢", href: "/orgs" },
      { label: "SaaS Billing", icon: "💳", href: "/billing" },
      { label: "Support Tickets", icon: "🎫", href: "/tickets" },
      { label: "Audit Trail", icon: "🧾", href: "/audit" },
    ],
  },
  {
    title: "প্ল্যাটফর্ম",
    items: [
      { label: "Settings & Config", icon: "⚙️", href: "/settings" },
      { label: "Platform Health", icon: "💚", href: "/health" },
      { label: "Proactive Alerts", icon: "🚨", href: "/alerts" },
      { label: "System & Reliability", icon: "🖥", href: "/system" },
      { label: "Usage & Cost", icon: "📈", href: "/usage" },
      { label: "Security", icon: "🔐", href: "/security" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.title}>
          {collapsed
            ? <div className="mx-2 border-t border-slate-800 pb-1 pt-4 first:border-0" />
            : <div className="anav-group">{group.title}</div>}
          {group.items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
              className={`anav ${isActive(pathname, item.href) ? "anav-active" : ""} ${collapsed ? "justify-center px-2" : ""}`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {!collapsed ? <span className="truncate">{item.label}</span> : null}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-5 pb-2 pt-5 ${collapsed ? "justify-center px-2" : ""}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-lg shadow-[0_10px_24px_-8px_rgb(99_102_241/0.9)]">🛡</span>
      {!collapsed ? (
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold tracking-tight">Qosprey Admin</div>
          <div className="text-[11px] text-slate-500">SaaS Operator Console</div>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminShell({ children, title }: { children: React.ReactNode; title: string }) {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);
  const [adminEmail, setAdminEmail] = React.useState("");
  const [q, setQ] = React.useState("");
  const [drawer, setDrawer] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      if (!getAdminToken()) { router.replace("/login"); return; }
      try {
        await apiFetch("/admin/health");
        const me = JSON.parse(localStorage.getItem("admin_user") ?? "{}");
        setAdminEmail(me.email ?? "");
        setCollapsed(localStorage.getItem("admin_nav_collapsed") === "1");
        setReady(true);
      } catch {
        setAdminToken(null);
        router.replace("/login");
      }
    })();
  }, [router]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem("admin_nav_collapsed", c ? "0" : "1"); } catch { /* ignore */ }
      return !c;
    });
  }

  function logout() {
    setAdminToken(null);
    try { localStorage.removeItem("admin_user"); } catch { /* ignore */ }
    router.replace("/login");
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-lg">🛡</span>
          যাচাই হচ্ছে…
        </div>
      </div>
    );
  }

  const initials = (adminEmail || "A").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen">
      {/* Mobile top bar */}
      <div className="aglass fixed inset-x-0 top-0 z-40 flex items-center gap-3 border-b border-slate-800 px-4 py-3 lg:hidden">
        <button aria-label="মেনু খুলুন" className="abtn-secondary !px-2.5" onClick={() => setDrawer(true)}>☰</button>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500">🛡</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">Qosprey Admin</div>
          <div className="truncate text-[11px] text-slate-500">{adminEmail}</div>
        </div>
        <button className="abtn-secondary ml-auto !px-2.5" aria-label="লগ আউট" onClick={logout}>🚪</button>
      </div>

      {/* Mobile drawer */}
      {drawer ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="aoverlay absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} />
          <aside className="adrawer absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-slate-800 bg-slate-950 shadow-2xl">
            <div className="flex items-start justify-between pr-3">
              <Brand collapsed={false} />
              <button aria-label="মেনু বন্ধ করুন" className="abtn-secondary mt-4 !px-2.5" onClick={() => setDrawer(false)}>✕</button>
            </div>
            <NavContent collapsed={false} onNavigate={() => setDrawer(false)} />
            <div className="border-t border-slate-800 p-3 text-xs text-slate-500">
              <div className="truncate px-2 pb-1">{adminEmail}</div>
              <button className="anav w-full" onClick={logout}>🚪 লগ আউট</button>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="lg:flex">
        {/* Desktop sidebar */}
        <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-800 bg-slate-900/50 lg:flex ${collapsed ? "w-[84px]" : "w-64"}`}>
          <Brand collapsed={collapsed} />
          <NavContent collapsed={collapsed} />
          <div className="border-t border-slate-800 p-3">
            {!collapsed ? <div className="truncate px-2 pb-1.5 text-xs text-slate-500">{adminEmail}</div> : null}
            <div className={`flex ${collapsed ? "flex-col gap-1" : "items-center gap-1"}`}>
              <button className={`anav flex-1 ${collapsed ? "justify-center" : ""}`} title="Sidebar ছোট/বড় করুন" onClick={toggleCollapsed}>{collapsed ? "»" : "«"} {!collapsed ? <span>ছোট করুন</span> : null}</button>
              <button className={`anav flex-1 ${collapsed ? "justify-center" : ""}`} title="লগ আউট" onClick={logout}>🚪 {!collapsed ? <span>লগ আউট</span> : null}</button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 pb-10 pt-[76px] sm:px-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1440px]">
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <h1 className="text-[22px] font-bold tracking-tight sm:text-2xl">{title}</h1>
              <div className="ml-auto flex flex-wrap items-center gap-2.5">
                <form
                  onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}
                  className="flex gap-2"
                >
                  <input className="ainput w-44 sm:w-64" placeholder="🔍 User, Org, Order খুঁজুন…" value={q} onChange={(e) => setQ(e.target.value)} />
                  <button className="abtn-secondary">খুঁজুন</button>
                </form>
                <div className="hidden items-center gap-2.5 rounded-full border border-slate-800 bg-slate-900/70 py-1 pl-1 pr-3 md:flex" title={adminEmail}>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-[11px] font-bold">{initials}</span>
                  <span className="max-w-[180px] truncate text-xs text-slate-300">{adminEmail}</span>
                </div>
              </div>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function reasonPrompt(action: string): string | null {
  const reason = window.prompt(`"${action}" — এই কাজের কারণ লিখুন (Audit এ থাকবে):`);
  if (!reason || reason.trim().length < 3) { window.alert("কারণ ছাড়া এই কাজ করা যাবে না।"); return null; }
  return reason.trim();
}
