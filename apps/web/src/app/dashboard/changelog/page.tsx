"use client";

import { useEffect, useState } from "react";
import { API_URL } from "../../../lib/api";

interface Entry { id: string; version: string | null; title: string; body: string; publishedAt: string | null }

/** Platform changelog — operator-published product updates. */
export default function ChangelogPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch(`${API_URL}/public/changelog`)
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => { setEntries(Array.isArray(j) ? j : []); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-bold">📣 আপডেটসমূহ</h1>
      <p className="text-sm text-slate-500">প্ল্যাটফর্মে নতুন যা যা এসেছে — পণ্য দলের অফিসিয়াল তালিকা।</p>
      {loaded && entries.length === 0 ? <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500">এখনো কোনো আপডেট প্রকাশ হয়নি।</div> : null}
      {entries.map((e) => (
        <article key={e.id} className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{e.title}</h2>
            {e.version ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">{e.version}</span> : null}
            {e.publishedAt ? <span className="text-xs text-slate-400">{new Date(e.publishedAt).toLocaleDateString("bn-BD")}</span> : null}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{e.body}</p>
        </article>
      ))}
    </div>
  );
}
