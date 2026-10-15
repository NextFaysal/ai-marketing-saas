"use client";
// ADX3: Ctrl+K / Cmd+K command palette. Two result sources, both
// real: (1) the nav pages from ./nav.tsx (the same single source
// the sidebar renders), filtered locally; (2) live entities from
// the EXISTING GET /admin/search endpoint — users, organizations,
// orders exactly as it returns them. Orders have no admin detail
// page, so an order result opens the Search page for that query
// (same behaviour as the topbar search form). Recent searches are
// kept in localStorage. ESC closes; ↑/↓ + Enter navigate.
import React from "react";
import { useRouter } from "next/navigation";
import { apiFetch, formatMinorStr } from "@/lib/api";
import { ALL_NAV_ITEMS, LS_KEYS, NavIcon, lsGetArray, lsSet } from "./nav";

interface SearchResults {
  users: { id: string; email: string; name: string; status: string }[];
  organizations: { id: string; name: string; slug: string; status: string }[];
  orders: { id: string; externalNumber?: string | null; status: string; totalMinor: string; organizationId: string }[];
}

interface PaletteItem {
  key: string; label: string; sub?: string; href: string; kind: "page" | "user" | "org" | "order" | "search-all";
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [entities, setEntities] = React.useState<SearchResults | null>(null);
  const [recentSearches, setRecentSearches] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) {
      setQ(""); setEntities(null); setSelected(0);
      setRecentSearches(lsGetArray(LS_KEYS.recentSearches).slice(0, 5));
      // Autofocus after the panel mounts.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open ]);

  // Debounced live entity search against the existing endpoint.
  React.useEffect(() => {
    if (!open) return;
    const needle = q.trim();
    if (needle.length < 2) { setEntities(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      apiFetch<SearchResults>(`/admin/search?q=${encodeURIComponent(needle)}`)
        .then((v) => { if (alive) setEntities(v); })
        .catch(() => { if (alive) setEntities(null); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open]);

  const items = React.useMemo<PaletteItem[]>(() => {
    const needle = q.trim().toLowerCase();
    const out: PaletteItem[] = [];
    if (needle) {
      for (const p of ALL_NAV_ITEMS) {
        if (p.label.toLowerCase().includes(needle) || p.href.toLowerCase().includes(needle)) {
          out.push({ key: `page-${p.href}`, label: p.label, sub: "পেজ", href: p.href, kind: "page" });
        }
      }
    } else {
      for (const p of ALL_NAV_ITEMS) out.push({ key: `page-${p.href}`, label: p.label, sub: "পেজ", href: p.href, kind: "page" });
    }
    if (entities) {
      for (const u of entities.users) out.push({ key: `user-${u.id}`, label: u.name || u.email, sub: `User · ${u.email} · ${u.status}`, href: `/users/${u.id}`, kind: "user" });
      for (const o of entities.organizations) out.push({ key: `org-${o.id}`, label: o.name, sub: `Organization · ${o.slug} · ${o.status}`, href: `/orgs/${o.id}`, kind: "org" });
      for (const o of entities.orders) out.push({ key: `order-${o.id}`, label: `#${o.externalNumber ?? o.id.slice(0, 8)}`, sub: `Order · ${o.status} · ${formatMinorStr(o.totalMinor)}`, href: `/search?q=${encodeURIComponent(q.trim())}`, kind: "order" });
    }
    if (needle.length >= 2) out.push({ key: "search-all", label: `সব ফলাফল দেখুন: “${q.trim()}”`, sub: "Search", href: `/search?q=${encodeURIComponent(q.trim())}`, kind: "search-all" });
    return out;
  }, [q, entities]);

  React.useEffect(() => { setSelected(0); }, [items.length]);

  if (!open) return null;

  function rememberSearch(term: string) {
    const t = term.trim();
    if (t.length < 2) return;
    const next = [t, ...lsGetArray(LS_KEYS.recentSearches).filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 5);
    lsSet(LS_KEYS.recentSearches, next);
  }

  function choose(item: PaletteItem) {
    if (q.trim().length >= 2) rememberSearch(q);
    onClose();
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => (items.length ? (s + 1) % items.length : 0)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => (items.length ? (s - 1 + items.length) % items.length : 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = items[selected];
      if (item) choose(item);
    }
  }

  const kindIcon = (kind: PaletteItem["kind"]) =>
    kind === "user" ? "users" : kind === "org" ? "building" : kind === "order" ? "card" : "search";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-2 pt-[6vh] sm:px-4 sm:pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="aoverlay absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="apalette-panel relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" onKeyDown={onKeyDown}>
        <div className="flex items-center gap-2.5 border-b border-slate-800 px-4">
          <span className="text-slate-400"><NavIcon name="search" size={18} /></span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="পেজ, User, Organization, Order খুঁজুন…"
            className="w-full bg-transparent py-3.5 text-[15px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
            aria-label="Command palette অনুসন্ধান"
          />
          <kbd className="hidden shrink-0 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 sm:block">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-2">
          {items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">{q.trim().length >= 2 ? "কিছু পাওয়া যায়নি।" : "লিখতে শুরু করুন — পেজ ও আসল ডেটা থেকে ফলাফল আসবে।"}</p>
          ) : items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              onMouseEnter={() => setSelected(i)}
              onClick={() => choose(item)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition ${i === selected ? "bg-indigo-600/25 text-white" : "text-slate-300"}`}
            >
              <span className={i === selected ? "text-indigo-300" : "text-slate-500"}><NavIcon name={item.kind === "page" ? (ALL_NAV_ITEMS.find((p) => p.href === item.href)?.icon ?? "search") : kindIcon(item.kind)} size={16} /></span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.label}</span>
                {item.sub ? <span className="block truncate text-xs text-slate-500">{item.sub}</span> : null}
              </span>
              {i === selected ? <span className="ml-auto shrink-0 text-xs text-indigo-300">Enter ↵</span> : null}
            </button>
          ))}
        </div>
        {q.trim() === "" && recentSearches.length > 0 ? (
          <div className="border-t border-slate-800 px-4 py-2.5">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">সাম্প্রতিক অনুসন্ধান</div>
            <div className="flex flex-wrap gap-1.5">
              {recentSearches.map((s) => (
                <button key={s} type="button" onClick={() => setQ(s)} className="rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500">{s}</button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
