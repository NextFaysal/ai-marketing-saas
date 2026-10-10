"use client";
import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { apiFetch, formatMinorStr } from "@/lib/api";

interface Results { users: { id: string; email: string; name: string; status: string }[]; organizations: { id: string; name: string; slug: string; status: string }[]; orders: { id: string; externalNumber?: string | null; status: string; totalMinor: string; organizationId: string }[] }

function SearchContent() {
  const sp = useSearchParams();
  const q = sp.get("q") ?? "";
  const [data, setData] = React.useState<Results | null>(null);
  React.useEffect(() => {
    if (q.length >= 2) apiFetch<Results>(`/admin/search?q=${encodeURIComponent(q)}`).then(setData).catch(() => setData(null));
  }, [q]);
  return (
    <AdminShell title={`🔍 অনুসন্ধান: ${q}`}>
      {!data ? <p className="text-slate-400">খোঁজা হচ্ছে…</p> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="acard"><div className="mb-2 font-semibold">Users ({data.users.length})</div>{data.users.map((u) => <a key={u.id} className="block rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700" href={`/users/${u.id}`}>{u.name}<div className="text-xs text-slate-500">{u.email} · {u.status}</div></a>)}</div>
          <div className="acard"><div className="mb-2 font-semibold">Organizations ({data.organizations.length})</div>{data.organizations.map((o) => <a key={o.id} className="block rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700" href={`/orgs/${o.id}`}>{o.name}<div className="text-xs text-slate-500">{o.slug} · {o.status}</div></a>)}</div>
          <div className="acard"><div className="mb-2 font-semibold">Orders ({data.orders.length})</div>{data.orders.map((o) => <div key={o.id} className="rounded-lg bg-slate-800 px-3 py-2 text-sm">#{o.externalNumber ?? o.id.slice(0, 8)}<div className="text-xs text-slate-500">{o.status} · {formatMinorStr(o.totalMinor)}</div></div>)}</div>
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
