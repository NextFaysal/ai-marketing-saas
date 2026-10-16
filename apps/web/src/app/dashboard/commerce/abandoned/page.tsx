"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { sequenceStatusLabel, type CheckoutSequence } from "@/lib/ab7";
import { ResponsiveTable } from "@repo/ui";

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

// GB7 (GC17): recovery-coupon setting payload.
interface CouponSetting {
  enabled: boolean;
  kind: "percent" | "fixed";
  value: number;
  expiryHours: number;
  minOrderMinor: string | null;
}

export default function AbandonedPage() {
  const [items, setItems] = useState<AbandonedItem[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  // GB7 (GC17): recovery coupon setting form
  const [couponEnabled, setCouponEnabled] = useState(false);
  const [couponKind, setCouponKind] = useState<"percent" | "fixed">("percent");
  const [couponValue, setCouponValue] = useState("10");
  const [couponExpiryHours, setCouponExpiryHours] = useState("72");
  const [couponMinOrder, setCouponMinOrder] = useState("");
  const [couponError, setCouponError] = useState("");
  const [couponNotice, setCouponNotice] = useState("");

  // AB7 (AX18): per-checkout automation sequence state (expandable row)
  const [expandedId, setExpandedId] = useState("");
  const [seqById, setSeqById] = useState<Record<string, CheckoutSequence>>({});
  const [seqBusyId, setSeqBusyId] = useState("");
  const [seqErrorById, setSeqErrorById] = useState<Record<string, string>>({});

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

  const loadCouponSetting = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const s = await apiFetch<CouponSetting>(`/organizations/${orgId}/commerce/abandoned/coupon-setting`);
      setCouponEnabled(!!s.enabled);
      setCouponKind(s.kind === "fixed" ? "fixed" : "percent");
      setCouponValue(String(s.value ?? 10));
      setCouponExpiryHours(String(s.expiryHours ?? 72));
      setCouponMinOrder(s.minOrderMinor ? String(Number(s.minOrderMinor) / 100) : "");
    } catch { /* card keeps defaults until the endpoint answers */ }
  }, []);
  useEffect(() => { void loadCouponSetting(); }, [loadCouponSetting]);

  async function saveCouponSetting() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("coupon-setting"); setCouponError(""); setCouponNotice("");
    try {
      await apiFetch<CouponSetting>(`/organizations/${orgId}/commerce/abandoned/coupon-setting`, {
        method: "PUT",
        body: JSON.stringify({
          enabled: couponEnabled,
          kind: couponKind,
          value: Math.max(0, parseInt(couponValue || "0", 10) || 0),
          expiryHours: Math.max(1, parseInt(couponExpiryHours || "72", 10) || 72),
          minOrderMinor: couponMinOrder ? String(Math.round(parseFloat(couponMinOrder) * 100)) : null,
        }),
      });
      setCouponNotice("পুনরুদ্ধার কুপনের সেটিংস সংরক্ষণ হয়েছে।");
      await loadCouponSetting();
    } catch (e) { setCouponError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  // AB7 (AX18): fetch the sequence state for one checkout on first expand.
  async function toggleSequence(item: AbandonedItem) {
    if (expandedId === item.id) { setExpandedId(""); return; }
    setExpandedId(item.id);
    if (seqById[item.id]) return;
    const orgId = getOrganizationId(); if (!orgId) return;
    setSeqBusyId(item.id);
    setSeqErrorById((m) => ({ ...m, [item.id]: "" }));
    try {
      const out = await apiFetch<CheckoutSequence>(
        `/organizations/${orgId}/abandoned-checkouts/${encodeURIComponent(item.id)}/sequence`,
      );
      setSeqById((m) => ({ ...m, [item.id]: out }));
    } catch (e) {
      setSeqErrorById((m) => ({ ...m, [item.id]: e instanceof Error ? e.message : "সিকোয়েন্স লোড ব্যর্থ" }));
    } finally { setSeqBusyId(""); }
  }

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

  async function recoverWhatsApp(item: AbandonedItem) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`wa-${item.id}`); setError(""); setNotice("");
    try {
      const res = await apiFetch<{ waLink: string; messageText: string }>(
        `/organizations/${orgId}/commerce/abandoned/${item.id}/whatsapp?discountCode=SAVE10`
      );
      if (res.waLink) {
        window.open(res.waLink, "_blank");
        setNotice("WhatsApp রিকভারি বার্তা প্রস্তুত হয়েছে এবং নতুন উইন্ডোতে খোলা হয়েছে!");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "WhatsApp লিঙ্ক তৈরি করা যায়নি");
    } finally {
      setBusy("");
    }
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

  // ED15/ED16 (EB6): row actions + the expandable sequence panel are
  // shared verbatim by the desktop table and the ResponsiveTable
  // mobile card — same handlers, same order.
  const renderAbandonedActions = (item: AbandonedItem) => (
    <div className="flex flex-wrap items-center gap-2">
      {item.phone && !item.recovered ? (
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-800 px-2.5 py-1 text-xs font-bold hover:bg-emerald-100 shadow-xs transition disabled:opacity-50"
          disabled={busy !== ""}
          onClick={() => recoverWhatsApp(item)}
        >
          <span>💬</span>
          <span>{busy === `wa-${item.id}` ? "প্রস্তুত হচ্ছে…" : "WhatsApp রিকভারি"}</span>
        </button>
      ) : null}
      {!item.recovered && !item.recoverySentAt && item.email ? (
        <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => recover(item)}>
          {busy === `recover-${item.id}` ? "পাঠানো হচ্ছে…" : "✉️ Recovery ইমেইল"}
        </button>
      ) : null}
      {!item.recovered && !item.email && !item.phone ? <span className="text-[11px] text-slate-500">যোগাযোগ মাধ্যম নেই</span> : null}
      {item.conversationId ? (
        <Link href="/dashboard/inbox" className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold">💬 কথোপকথন খুলুন</Link>
      ) : null}
      {item.checkoutUrl ? (
        <a href={item.checkoutUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold">Checkout লিংক ↗</a>
      ) : null}
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={seqBusyId === item.id} onClick={() => void toggleSequence(item)}>
        {seqBusyId === item.id ? "লোড হচ্ছে…" : expandedId === item.id ? "🔁 সিকোয়েন্স লুকান" : "🔁 সিকোয়েন্স"}
      </button>
    </div>
  );

  const renderSequencePanel = (item: AbandonedItem) => (
    seqBusyId === item.id ? (
      <p className="text-xs text-slate-500">সিকোয়েন্স লোড হচ্ছে…</p>
    ) : seqErrorById[item.id] ? (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{seqErrorById[item.id]}</p>
    ) : !seqById[item.id] ? (
      <p className="text-xs text-slate-500">সিকোয়েন্সের তথ্য পাওয়া যায়নি।</p>
    ) : !seqById[item.id].enrolled ? (
      <p className="text-xs font-semibold text-slate-600">কোনো অটোমেশন সিকোয়েন্সে নেই</p>
    ) : (
      <div className="space-y-2 text-xs">
        <p className="text-slate-700">
          ওয়ার্কফ্লো: <b>{seqById[item.id].workflowName ?? "—"}</b>
          {" "}· রানের অবস্থা: <b>{sequenceStatusLabel(seqById[item.id].runStatus)}</b>
          {seqById[item.id].currentStepIndex != null ? <> · বর্তমান ধাপ: <b>{seqById[item.id].currentStepIndex! + 1}</b></> : null}
          {seqById[item.id].lastActivityAt ? <> · সর্বশেষ কার্যকলাপ: {new Date(seqById[item.id].lastActivityAt!).toLocaleString("bn-BD")}</> : null}
        </p>
        {(seqById[item.id].steps ?? []).length > 0 ? (
          <ul className="space-y-1">
            {(seqById[item.id].steps ?? []).map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2.5 py-1.5">
                <span className="font-semibold text-slate-700">{i + 1}. {s.step}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{sequenceStatusLabel(s.status)}</span>
                {s.detail ? <span className="text-slate-500">{s.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500">ধাপের লগ এখনো নেই।</p>
        )}
      </div>
    )
  );

  const shopifyStoreIds = [...new Set(items.filter((i) => i.source === "shopify" && i.storeId).map((i) => i.storeId as string))];

  const totalAbandonedRevenue = items.reduce((sum, item) => sum + (Number(item.totalMinor) || 0), 0);
  const totalWithPhone = items.filter((i) => Boolean(i.phone)).length;
  const totalRecovered = items.filter((i) => i.recovered).length;

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

      {/* Top Recovery KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase">মোট ড্রপ-অফ কার্ট</p>
          <div className="mt-1 text-2xl font-black text-slate-900">{items.length}</div>
          <p className="mt-1 text-[11px] text-slate-400">সর্বমোট ফেলে যাওয়া চেকআউট</p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase">সম্ভাব্য ড্রপ-অফ রাজস্ব</p>
          <div className="mt-1 text-2xl font-black text-rose-600">
            ৳{(totalAbandonedRevenue / 100).toLocaleString("bn-BD", { maximumFractionDigits: 0 })}
          </div>
          <p className="mt-1 text-[11px] text-rose-700">রিকভারি করার সুযোগ</p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase">WhatsApp রিকভারযোগ্য</p>
          <div className="mt-1 text-2xl font-black text-emerald-600">{totalWithPhone}</div>
          <p className="mt-1 text-[11px] text-emerald-700 font-medium">মোবাইল নম্বর সহ সরাসরি যোগাযোগের যোগ্য</p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase">সফলভাবে রিকভার্ড</p>
          <div className="mt-1 text-2xl font-black text-indigo-600">{totalRecovered}</div>
          <p className="mt-1 text-[11px] text-indigo-700 font-medium">অর্ডারে রূপান্তরিত হয়েছে</p>
        </div>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="card p-5 space-y-4">
        <div>
          <div className="font-semibold">🎟️ পুনরুদ্ধার কুপন</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            এই সেটিং on থাকলে, recovery পাঠানোর সময় একটি আসল কুপন তৈরি হয়ে মেসেজে সেই কোডটি যাবে —
            কাস্টমার কোডটি চেকআউটে ব্যবহার করতে পারবেন। Off থাকলে আগের মতোই কুপন ছাড়া recovery পাঠানো হবে।
          </p>
        </div>
        {couponError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{couponError}</p> : null}
        {couponNotice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{couponNotice}</p> : null}
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={couponEnabled} onChange={(e) => setCouponEnabled(e.target.checked)} />
          পুনরুদ্ধার কুপন চালু করুন
        </label>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="block text-sm">ছাড়ের ধরন
            <select className="input mt-1" value={couponKind} onChange={(e) => setCouponKind(e.target.value as "percent" | "fixed")} disabled={!couponEnabled}>
              <option value="percent">শতাংশ (%)</option>
              <option value="fixed">নির্দিষ্ট টাকা</option>
            </select>
          </label>
          <label className="block text-sm">{couponKind === "percent" ? "শতাংশ (%)" : "টাকার পরিমাণ"}
            <input className="input mt-1" type="number" min="0" value={couponValue} onChange={(e) => setCouponValue(e.target.value)} disabled={!couponEnabled} />
          </label>
          <label className="block text-sm">কুপনের মেয়াদ (ঘণ্টা)
            <input className="input mt-1" type="number" min="1" value={couponExpiryHours} onChange={(e) => setCouponExpiryHours(e.target.value)} disabled={!couponEnabled} />
          </label>
          <label className="block text-sm">সর্বনিম্ন অর্ডার (টাকা, খালি = নেই)
            <input className="input mt-1" type="number" value={couponMinOrder} onChange={(e) => setCouponMinOrder(e.target.value)} disabled={!couponEnabled} />
          </label>
        </div>
        <button className="btn-primary" disabled={busy !== ""} onClick={saveCouponSetting}>
          {busy === "coupon-setting" ? "সেভ হচ্ছে…" : "সেটিংস সেভ করুন"}
        </button>
      </div>

      {shopifyStoreIds.length > 0 ? (
        <div className="card p-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Shopify থেকে পুরনো abandoned checkout টানুন:</span>
          {shopifyStoreIds.map((sid) => (
            <button key={sid} className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => backfill(sid)}>
              {busy === `backfill-${sid}` ? "টানা হচ্ছে…" : "Backfill করুন"}
            </button>
          ))}
          <span className="text-xs text-slate-500">Backfill REST পথে হয় — কোনো স্টোরে সেই পথ না চললে এরর এখানেই দেখা যাবে; নতুন checkout webhook দিয়েই আসে।</span>
        </div>
      ) : null}

      <div className="card p-5">
        {loading ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : items.length === 0 ? (
          <p className="text-sm text-slate-500">কোনো abandoned কার্ট/checkout পাওয়া যায়নি। WooCommerce স্টোরের জন্য tracker বসানো আছে কিনা Integrations পেজের Health যাচাইয়ে দেখুন।</p>
        ) : (
          <ResponsiveTable
            table={
              <div>
                <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 font-medium">উৎস</th><th className="py-2 font-medium">কাস্টমার</th>
                  <th className="py-2 font-medium">কার্টে যা আছে</th><th className="py-2 font-medium">মূল্য</th>
                  <th className="py-2 font-medium">সময়</th><th className="py-2 font-medium">অবস্থা</th><th className="py-2 font-medium">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <React.Fragment key={`${item.source}-${item.id}`}>
                  <tr className="border-b last:border-0 align-top">
                    <td className="py-2">
                      <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${item.source === "shopify" ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700"}`}>
                        {item.source === "shopify" ? "Shopify" : "Tracker"}
                      </span>
                      {item.storeName ? <div className="mt-1 text-xs text-slate-500">{item.storeName}</div> : null}
                    </td>
                    <td className="py-2 text-xs">{item.email ?? "—"}{item.phone ? <div className="text-slate-500">{item.phone}</div> : null}</td>
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
                      {renderAbandonedActions(item)}
                    </td>
                  </tr>
                  {expandedId === item.id ? (
                    <tr className="border-b bg-slate-50/60">
                      <td colSpan={7} className="px-3 py-3">
                        {renderSequencePanel(item)}
                      </td>
                    </tr>
                  ) : null}
                  </React.Fragment>
                ))}
                </tbody>
                </table>
              </div>
            }
            cards={items.map((item) => (
              <div key={`${item.source}-${item.id}`} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${item.source === "shopify" ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700"}`}>
                    {item.source === "shopify" ? "Shopify" : "Tracker"}
                  </span>
                  <span className="font-semibold">{money(item.totalMinor, item.currency ?? "BDT")}</span>
                </div>
                {item.storeName ? <div className="mt-1 text-xs text-slate-500">{item.storeName}</div> : null}
                <dl className="mt-2 space-y-1.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 font-semibold text-slate-500">কাস্টমার</dt>
                    <dd>{item.email ?? "—"}{item.phone ? <div className="text-slate-500">{item.phone}</div> : null}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 font-semibold text-slate-500">কার্টে যা আছে</dt>
                    <dd className="text-slate-600">
                      {(item.items ?? []).length === 0 ? "—" : (item.items ?? []).map((li, i) => (
                        <div key={i}>{li.name ?? "পণ্য"}{li.quantity ? ` ×${li.quantity}` : ""}</div>
                      ))}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 font-semibold text-slate-500">সময়</dt>
                    <dd className="text-slate-500">{ageText(item.abandonedAt)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 font-semibold text-slate-500">অবস্থা</dt>
                    <dd>
                      {item.recovered ? <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">Recovered ✓ অর্ডার হয়ে গেছে</span>
                        : item.recoverySentAt ? <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Recovery পাঠানো হয়েছে</span>
                        : <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Open</span>}
                    </dd>
                  </div>
                </dl>
                <div className="mt-2">{renderAbandonedActions(item)}</div>
                {expandedId === item.id ? (
                  <div className="mt-2 rounded-lg bg-slate-50/60 px-3 py-3">{renderSequencePanel(item)}</div>
                ) : null}
              </div>
            ))}
          />
        )}
      </div>
    </div>
  );
}
