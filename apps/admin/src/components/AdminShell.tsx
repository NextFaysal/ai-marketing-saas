"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getAdminToken, setAdminToken } from "@/lib/api";

const NAV = [
  { label: "📊 Command Center", href: "/" },
  { label: "👤 Users", href: "/users" },
  { label: "🏢 Organizations", href: "/orgs" },
  { label: "🧾 Audit Trail", href: "/audit" },
  { label: "⚙️ Settings & Flags", href: "/settings", phase: "Phase B" },
  { label: "💚 Platform Health", href: "/health", phase: "Phase B" },
  { label: "📈 Usage & Cost", href: "/usage", phase: "Phase B" },
  { label: "💳 SaaS Billing", href: "/billing", phase: "Phase C" },
  { label: "🔐 Security", href: "/security", phase: "Phase D" },
];

export default function AdminShell({ children, title }: { children: React.ReactNode; title: string }) {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);
  const [adminEmail, setAdminEmail] = React.useState("");
  const [q, setQ] = React.useState("");

  React.useEffect(() => {
    (async () => {
      if (!getAdminToken()) { router.replace("/login"); return; }
      try {
        await apiFetch("/admin/health");
        const me = JSON.parse(localStorage.getItem("admin_user") ?? "{}");
        setAdminEmail(me.email ?? "");
        setReady(true);
      } catch {
        setAdminToken(null);
        router.replace("/login");
      }
    })();
  }, [router]);

  if (!ready) return <div className="flex min-h-screen items-center justify-center text-slate-400">যাচাই হচ্ছে…</div>;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60 p-4 md:flex">
        <div className="mb-1 px-2 text-lg font-bold">🛡 Qosprey Admin</div>
        <div className="mb-5 px-2 text-xs text-slate-500">SaaS Operator Console</div>
        <nav className="flex-1 space-y-1">
          {NAV.map((item) => item.phase && !["/settings", "/health", "/usage", "/billing", "/security"].includes(item.href) ? (
            <span key={item.href} className="anav-off">{item.label}<span className="ml-auto text-[10px]">{item.phase}</span></span>
          ) : (
            <a key={item.href} href={item.href} className="anav">{item.label}{item.phase ? <span className="ml-auto text-[10px] text-slate-500">{item.phase}</span> : null}</a>
          ))}
        </nav>
        <div className="border-t border-slate-800 pt-3 text-xs text-slate-500">
          <div className="px-2">{adminEmail}</div>
          <button className="anav mt-1 w-full" onClick={() => { setAdminToken(null); localStorage.removeItem("admin_user"); router.replace("/login"); }}>🚪 লগ আউট</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-5 md:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{title}</h1>
          <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }} className="flex gap-2">
            <input className="ainput w-64" placeholder="🔍 User, Org, Order খুঁজুন…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="abtn-secondary">খুঁজুন</button>
          </form>
        </div>
        {children}
      </main>
    </div>
  );
}

export function reasonPrompt(action: string): string | null {
  const reason = window.prompt(`"${action}" — এই কাজের কারণ লিখুন (Audit এ থাকবে):`);
  if (!reason || reason.trim().length < 3) { window.alert("কারণ ছাড়া এই কাজ করা যাবে না।"); return null; }
  return reason.trim();
}
