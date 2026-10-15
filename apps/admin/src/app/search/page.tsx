"use client";
import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { EmptyState, ErrorState, PageHead } from "@/components/ui";
import { LS_KEYS, lsGetArray, lsSet } from "@/components/nav";
import { apiFetch, formatMinorStr } from "@/lib/api";

interface Results { users: { id: string; email: string; name: string; status: string }[]; organizations: { id: string; name: string; slug: string; status: string }[]; orders: { id: string; externalNumber?: string | null; status: string; totalMinor: string; organizationId: string }[] }

function SearchContent() {
  const sp = useSearchParams();
  const q = sp.get("q") ?? "";
  const [data, setData] = React.useState<Results | null>(null);
  // ADX12: before, a failed search and a short query both sat on
  // "খোঁজা হচ্ছে…" forever. Failure now has an error state + retry,
  // a short query explains itself, and a successful-but-empty
  // result gets a real empty state.
  const [failed, setFailed] = React.useState(false);
  const run = React.useCallback(async () => {
    if (q.length < 2) { setData(null); setFailed(false); return; }
    setFailed(false); setData(null);
    try { setData(await apiFetch<Results>(`/admin/search?q=${encodeURIComponent(q)}`)); }
    catch { setFailed(true); }
  }, [q]);
  React.useEffect(() => { run(); }, [run]);
  // ADNX14: recent searches — the SAME store the Command Palette
  // keeps (LS_KEYS.recentSearches). This page is the mobile search
  // surface, so the recents render here too (chips under the
  // PageHead), and a search run from this page is remembered with
  // the palette's own dedupe/cap rule.
  const [recents, setRecents] = React.useState<string[]>([]);
  React.useEffect(() => { setRecents(lsGetArray(LS_KEYS.recentSearches).slice(0, 5)); }, []);
  React.useEffect(() => {
    const t = q.trim();
    if (t.length < 2) return;
    const next = [t, ...lsGetArray(LS_KEYS.recentSearches).filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 5);
    lsSet(LS_KEYS.recentSearches, next);
    setRecents(next);
  }, [q]);
  const total = data ? data.users.length + data.organizations.length + data.orders.length : 0;
  return (
    <AdminShell title={`🔍 অনুসন্ধান: ${q}`}>
      <PageHead sub="User, Organization ও Order — সব এক জায়গায় খুঁজুন।" />
      {recents.filter((r) => r !== q.trim()).length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">সাম্প্রতিক অনুসন্ধান</span>
          {recents.filter((r) => r !== q.trim()).map((r) => (
            <a key={r} href={`/search?q=${encodeURIComponent(r)}`} className="rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500">{r}</a>
          ))}
        </div>
      ) : null}
      {q.length < 2 ? (
        <div className="acard"><EmptyState title="কমপক্ষে ২ অক্ষর লিখে খুঁজুন।" sub="ওপরের খোঁজার ঘরে User-এর ইমেইল/নাম, Organization-এর নাম বা Order নম্বর লিখুন — অথবা Ctrl+K চাপুন।" /></div>
      ) : failed ? (
        <ErrorState message="খোঁজ সম্পন্ন হয়নি — সংযোগ বা সার্ভারে সমস্যা হতে পারে।" onRetry={run} />
      ) : !data ? <div className="askel-table" /> : total === 0 ? (
        <div className="acard"><EmptyState title={`"${q}" দিয়ে কিছু পাওয়া যায়নি।`} sub="বানান বদলে, ছোট শব্দে, অথবা ইমেইল/নামের অংশবিশেষ দিয়ে আবার খুঁজুন।" /></div>
      ) : (
        /* ADNX14: single-column grouped on mobile (the grid's
           default), three columns from lg — and each result row
           now matches the Command Palette's row pattern (medium
           label line + small sub line, same paddings). */
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="acard"><div className="mb-2 font-semibold">Users ({data.users.length})</div>{data.users.length === 0 ? <p className="text-sm text-slate-400">কোনো User মেলেনি।</p> : null}<div className="space-y-1.5">{data.users.map((u) => <a key={u.id} className="block rounded-lg bg-slate-800 px-3 py-2.5 text-sm hover:bg-slate-700" href={`/users/${u.id}`}><span className="block truncate font-medium">{u.name}</span><span className="block truncate text-xs text-slate-400">{u.email} · {u.status}</span></a>)}</div></div>
          <div className="acard"><div className="mb-2 font-semibold">Organizations ({data.organizations.length})</div>{data.organizations.length === 0 ? <p className="text-sm text-slate-400">কোনো Organization মেলেনি।</p> : null}<div className="space-y-1.5">{data.organizations.map((o) => <a key={o.id} className="block rounded-lg bg-slate-800 px-3 py-2.5 text-sm hover:bg-slate-700" href={`/orgs/${o.id}`}><span className="block truncate font-medium">{o.name}</span><span className="block truncate text-xs text-slate-400">{o.slug} · {o.status}</span></a>)}</div></div>
          <div className="acard"><div className="mb-2 font-semibold">Orders ({data.orders.length})</div>{data.orders.length === 0 ? <p className="text-sm text-slate-400">কোনো Order মেলেনি।</p> : null}<div className="space-y-1.5">{data.orders.map((o) => <div key={o.id} className="rounded-lg bg-slate-800 px-3 py-2.5 text-sm"><span className="block truncate font-medium">#{o.externalNumber ?? o.id.slice(0, 8)}</span><span className="block truncate text-xs text-slate-400">{o.status} · {formatMinorStr(o.totalMinor)}</span></div>)}</div></div>
        </div>
      )}
    </AdminShell>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">লোড হচ্ছে…</div>}>
      <SearchContent />
    </Suspense>
  );
}
