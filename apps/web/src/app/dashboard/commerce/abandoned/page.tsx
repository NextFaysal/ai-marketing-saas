"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

// EC10 — unified abandoned view: S4 tracker carts (source "tracker")
// + Shopify store checkouts (source "shopify") in one value-sorted
// list. Recovery email works once per cart/checkout (server-side
// audit marker); the buttons shown are only the ones that truly
// apply (no email → no email button, no conversation → no link).
interface AbandonedItem {
  source: "tracker" | "shopify";
  id: string;
  storeId?: string | null;
  storeName?: string | null;
  email?: string | null;
  phone?: string | null;
  items?: { name?: string; quantity?: number }[] | null;
  totalMinor?: string | null;
  currency?: string;
  checkoutUrl?: string | null;
  abandonedAt?: string | null;
  recovered?: boolean;
  recoveredOrderId?: string | null;
  recoverySentAt?: string | null;
  conversationId?: string | null;
}

const money = (minor?: string | null, currency = "BDT") =>
  minor == null ? "—" : `${currency === "BDT" ? "৳" : currency + " "}${(Number(minor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function ageText(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "এখনই";
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))} মিনিট আগে`;
  if (h < 24) return `${h} ঘণ্টা আগে`;
  return `${Math.floor(h / 24)} দিন আগে`;
}

export default function AbandonedPage() {
  const [items, setItems] = useState<AbandonedItem[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const out = await apiFetch<{ items: AbandonedItem[] }>(`/organizations/${orgId}/commerce/abandoned`);
      setItems(out.items ?? []);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "লোড ব্যর্থ"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function recover(item: AbandonedItem) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`recover-${item.id}`); setError(""); setNotice("");
    try {
      if (item.source === "tracker") {
        await apiFetch(`/organizations/${orgId}/tracking/abandoned-carts/${item.id}/recover`, { method: "POST" });
      } else {
        await apiFetch(`/organizations/${orgId}/commerce/abandoned/${item.id}/recover`, { method: "POST" });
      }
      setNotice("Recovery ইমেইল পাঠানো হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Recovery ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function backfill(storeId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`backfill-${storeId}`); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ fetched: number; created: number; updated: number }>(
        `/organizations/${orgId}/commerce/abandoned/backfill/${storeId}`, { method: "POST" });
      setNotice(`Shopify থেকে abandoned checkout টানা হয়েছে: মোট ${out.fetched}, নতুন ${out.created}, আপডেট ${out.updated}।`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Backfill ব্যর্থ"); }
    finally { setBusy(""); }
  }

  const shopifyStoreIds = [...new Set(items.filter((i) => i.source === "shopify" && i.storeId).map((i) => i.storeId as string))];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Abandoned Carts — ফেলে যাওয়া কার্ট</h1>
          <p className="text-sm text-slate-500">
            দুই উৎসের abandoned কার্ট এক তালিকায়: আপনার সাইটের tracker থেকে ধরা কার্ট (Tracker) এবং Shopify স্টোরের
            আসল abandoned checkout (Shopify)। মূল্য অনুযায়ী বড় থেকে ছোট সাজানো। Recovery ইমেইল প্রতি কার্টে একবারই যায় —
            ব্যর্থ হলে পাঠানো হয়েছে বলে দেখানো হয় না।
          </p>
        </div>
        <Link href="/dashboard/commerce/sync" className="btn-primary">Sync Center →</Link>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {shopifyStoreIds.length > 0 ? (
        <div className="card p-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Shopify থেকে পুরনো abandoned checkout টানুন:</span>
          {shopifyStoreIds.map((sid) => (
            <button key={sid} className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => backfill(sid)}>
              {busy === `backfill-${sid}` ? "টানা হচ্ছে…" : "Backfill করুন"}
            </button>
          ))}
          <span className="text-xs text-slate-400">Backfill REST পথে হয় — কোনো স্টোরে সেই পথ না চললে এরর এখানেই দেখা যাবে; নতুন checkout webhook দিয়েই আসে।</span>
        </div>
      ) : null}

      <div className="card p-5">
        {loading ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : items.length === 0 ? (
          <p className="text-sm text-slate-500">কোনো abandoned কার্ট/checkout পাওয়া যায়নি। WooCommerce স্টোরের জন্য tracker বসানো আছে কিনা Integrations পেজের Health যাচাইয়ে দেখুন।</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-400">
                  <th className="py-2 font-medium">উৎস</th><th className="py-2 font-medium">কাস্টমার</th>
                  <th className="py-2 font-medium">কার্টে যা আছে</th><th className="py-2 font-medium">মূল্য</th>
                  <th className="py-2 font-medium">সময়</th><th className="py-2 font-medium">অবস্থা</th><th className="py-2 font-medium">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.source}-${item.id}`} className="border-b last:border-0 align-top">
                    <td className="py-2">
                      <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${item.source === "shopify" ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700"}`}>
                        {item.source === "shopify" ? "Shopify" : "Tracker"}
                      </span>
                      {item.storeName ? <div className="mt-1 text-xs text-slate-400">{item.storeName}</div> : null}
                    </td>
                    <td className="py-2 text-xs">{item.email ?? "—"}{item.phone ? <div className="text-slate-400">{item.phone}</div> : null}</td>
                    <td className="py-2 text-xs text-slate-600">
                      {(item.items ?? []).length === 0 ? "—" : (item.items ?? []).map((li, i) => (
                        <div key={i}>{li.name ?? "পণ্য"}{li.quantity ? ` ×${li.quantity}` : ""}</div>
                      ))}
                    </td>
                    <td className="py-2 font-semibold">{money(item.totalMinor, item.currency ?? "BDT")}</td>
                    <td className="py-2 text-xs text-slate-500">{ageText(item.abandonedAt)}</td>
                    <td className="py-2">
                      {item.recovered ? <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">Recovered ✓ অর্ডার হয়ে গেছে</span>
                        : item.recoverySentAt ? <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Recovery পাঠানো হয়েছে</span>
                        : <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Open</span>}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        {!item.recovered && !item.recoverySentAt && item.email ? (
                          <button className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => recover(item)}>
                            {busy === `recover-${item.id}` ? "পাঠানো হচ্ছে…" : "✉️ Recovery ইমেইল"}
                          </button>
                        ) : null}
                        {!item.recovered && !item.email ? <span className="text-[11px] text-slate-400">ইমেইল নেই — পাঠানো যাবে না</span> : null}
                        {item.conversationId ? (
                          <Link href="/dashboard/inbox" className="rounded-lg border px-2 py-1 text-xs font-semibold">💬 কথোপকথন খুলুন</Link>
                        ) : null}
                        {item.checkoutUrl ? (
                          <a href={item.checkoutUrl} target="_blank" rel="noreferrer" className="rounded-lg border px-2 py-1 text-xs font-semibold">Checkout লিংক ↗</a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
