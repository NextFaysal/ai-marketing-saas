"use client";
import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { EmptyState, ErrorState } from "@/components/ui";
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
  const total = data ? data.users.length + data.organizations.length + data.orders.length : 0;
  return (
    <AdminShell title={`🔍 অনুসন্ধান: ${q}`}>
      {q.length < 2 ? (
        <div className="acard"><EmptyState title="কমপক্ষে ২ অক্ষর লিখে খুঁজুন।" sub="ওপরের খোঁজার ঘরে User-এর ইমেইল/নাম, Organization-এর নাম বা Order নম্বর লিখুন — অথবা Ctrl+K চাপুন।" /></div>
      ) : failed ? (
        <ErrorState message="খোঁজ সম্পন্ন হয়নি — সংযোগ বা সার্ভারে সমস্যা হতে পারে।" onRetry={run} />
      ) : !data ? <p className="text-slate-400">খোঁজা হচ্ছে…</p> : total === 0 ? (
        <div className="acard"><EmptyState title={`"${q}" দিয়ে কিছু পাওয়া যায়নি।`} sub="বানান বদলে, ছোট শব্দে, অথবা ইমেইল/নামের অংশবিশেষ দিয়ে আবার খুঁজুন।" /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="acard"><div className="mb-2 font-semibold">Users ({data.users.length})</div>{data.users.length === 0 ? <p className="text-sm text-slate-500">কোনো User মেলেনি।</p> : null}{data.users.map((u) => <a key={u.id} className="block rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700" href={`/users/${u.id}`}>{u.name}<div className="text-xs text-slate-500">{u.email} · {u.status}</div></a>)}</div>
          <div className="acard"><div className="mb-2 font-semibold">Organizations ({data.organizations.length})</div>{data.organizations.length === 0 ? <p className="text-sm text-slate-500">কোনো Organization মেলেনি।</p> : null}{data.organizations.map((o) => <a key={o.id} className="block rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700" href={`/orgs/${o.id}`}>{o.name}<div className="text-xs text-slate-500">{o.slug} · {o.status}</div></a>)}</div>
          <div className="acard"><div className="mb-2 font-semibold">Orders ({data.orders.length})</div>{data.orders.length === 0 ? <p className="text-sm text-slate-500">কোনো Order মেলেনি।</p> : null}{data.orders.map((o) => <div key={o.id} className="rounded-lg bg-slate-800 px-3 py-2 text-sm">#{o.externalNumber ?? o.id.slice(0, 8)}<div className="text-xs text-slate-500">{o.status} · {formatMinorStr(o.totalMinor)}</div></div>)}</div>
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
