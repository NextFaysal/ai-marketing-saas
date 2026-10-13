"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";

interface PublicOrderItem { id: string; name: string; quantity: number }
interface SubmittedItem { orderItemId: string; quantity: number }
interface ReturnView {
  status: string;
  submitted: boolean;
  reason: string | null;
  resolution: string | null;
  order: { number: string | null; placedAt: string | null; items: PublicOrderItem[] };
  items: SubmittedItem[] | null;
}

/**
 * EC9 — public customer return page. The unguessable token in the
 * URL is the only credential (same pattern as the public review
 * page): plain fetch against ${API_URL}/returns/<token>, no auth.
 * Once submitted, the page renders the application read-only and
 * the API refuses a second submit.
 */
export default function PublicReturnPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [data, setData] = useState<ReturnView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function load() {
    try {
      const res = await fetch(`${API_URL}/returns/${token}`);
      if (res.status === 404) { setNotFound(true); return; }
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? "রিটার্নের তথ্য লোড করা যায়নি");
      const view = j as ReturnView;
      setData(view);
      setQuantities((prev) => {
        const next = { ...prev };
        for (const item of view.order?.items ?? []) {
          if (next[item.id] == null) next[item.id] = item.quantity;
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "রিটার্নের তথ্য লোড করা যায়নি");
    }
  }

  useEffect(() => { void load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!data) return;
    const chosen = (data.order.items ?? []).filter((item) => included[item.id]);
    if (chosen.length === 0) { setError("কমপক্ষে একটি আইটেম বেছে দিন"); return; }
    for (const item of chosen) {
      const qty = quantities[item.id] ?? 0;
      if (!(qty >= 1) || qty > item.quantity) {
        setError(`"${item.name}"-এর পরিমাণ ১ থেকে ${item.quantity}-এর মধ্যে হতে হবে`);
        return;
      }
    }
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/returns/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason.trim() || undefined,
          items: chosen.map((item) => ({ orderItemId: item.id, quantity: quantities[item.id] })),
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? "আবেদন জমা দেওয়া যায়নি");
      setDone(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "আবেদন জমা দেওয়া যায়নি");
    } finally { setBusy(false); }
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-xl space-y-5 p-6">
        <h1 className="text-2xl font-bold">রিটার্নের আবেদন</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          এই রিটার্ন লিংকটি পাওয়া যায়নি। লিংকটি সঠিক কিনা যাচাই করুন, অথবা দোকানে মেসেজ করে নতুন লিংক নিন।
        </div>
      </main>
    );
  }

  const submittedItems = data?.items ?? [];

  return (
    <main className="mx-auto max-w-xl space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-bold">পণ্য রিটার্নের আবেদন</h1>
        {data?.order?.number ? <p className="mt-1 text-sm text-slate-500">অর্ডার: {data.order.number}</p> : null}
        {data?.order?.placedAt ? (
          <p className="text-sm text-slate-500">অর্ডারের তারিখ: {new Date(data.order.placedAt).toLocaleString("bn-BD")}</p>
        ) : null}
      </header>

      {!data && !error ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}

      {done ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-sm font-semibold text-emerald-800">✅ আবেদন জমা হয়েছে</p>
          <p className="mt-1 text-sm text-emerald-700">আপনার রিটার্নের আবেদন আমরা পেয়েছি। যাচাই শেষে আপডেট জানানো হবে।</p>
          {data ? <p className="mt-1 text-sm text-emerald-700">বর্তমান অবস্থা: {data.status}</p> : null}
        </section>
      ) : null}

      {data && data.submitted && !done ? (
        <section className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold">আপনার আবেদন ইতিমধ্যে জমা হয়েছে</p>
          <p className="text-sm">বর্তমান অবস্থা: <span className="font-semibold">{data.status}</span></p>
          {data.resolution ? <p className="text-sm">সিদ্ধান্তের ধরন: {data.resolution}</p> : null}
          <div>
            <div className="text-sm font-medium">কারণ</div>
            <p className="mt-1 text-sm text-slate-700">{data.reason ?? "—"}</p>
          </div>
          {submittedItems.length > 0 ? (
            <div>
              <div className="text-sm font-medium">ফেরতের আইটেম</div>
              <ul className="mt-1 space-y-1 text-sm text-slate-700">
                {submittedItems.map((line) => {
                  const name = data.order.items.find((i) => i.id === line.orderItemId)?.name ?? line.orderItemId;
                  return <li key={line.orderItemId}>{name} × {line.quantity}</li>;
                })}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {data && !data.submitted && !done ? (
        <section className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div>
            <div className="mb-2 text-sm font-medium">কোন আইটেম ফেরত দিতে চান?</div>
            <ul className="space-y-2">
              {(data.order.items ?? []).map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex min-w-52 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(included[item.id])}
                      onChange={(e) => setIncluded((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                    />
                    <span>{item.name} <span className="text-slate-400">(অর্ডার করা: {item.quantity})</span></span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-600">পরিমাণ
                    <input
                      type="number"
                      className="input w-20"
                      min={1}
                      max={item.quantity}
                      value={quantities[item.id] ?? item.quantity}
                      disabled={!included[item.id]}
                      onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <label className="block text-sm font-medium">রিটার্নের কারণ
            <textarea
              className="input mt-1"
              rows={4}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="কেন পণ্যটি ফেরত দিতে চান, লিখুন…"
            />
          </label>
          <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
            {busy ? "জমা দেওয়া হচ্ছে…" : "আবেদন জমা দিন"}
          </button>
        </section>
      ) : null}
    </main>
  );
}
