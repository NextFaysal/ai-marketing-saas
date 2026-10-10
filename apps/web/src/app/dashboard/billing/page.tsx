"use client";
import React, { useCallback, useEffect, useState } from "react";
import { API_URL, apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";

interface Billing {
  subscription: { plan: string; status: string; currentPeriodEnd: string | null; priceMinor: string; currency: string } | null;
  creditMinor: string;
  gateways: { sslcommerz: boolean; bkash: boolean };
  limits: { aiDaily: number; broadcastCap: number; seats: number | null; plan: string };
  usage: { seatsUsed: number; aiCallsToday: number; broadcasts30d: number };
  plans: { tier: string; priceMinor: string; currency: string; limits: { aiDaily: number; broadcastCap: number; seats: number } }[];
  payments: { id: string; amountMinor: string; refundedMinor: string; currency: string; method: string; reference: string | null; periodEnd: string | null; note: string | null; createdAt: string }[];
}

function taka(minor: string): string {
  const v = Number(minor) / 100;
  return `৳${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default function BillingPage() {
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [gatewayReturn, setGatewayReturn] = useState("");

  useEffect(() => {
    try { setGatewayReturn(new URLSearchParams(window.location.search).get("payment") ?? ""); } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      setData(await apiFetch<Billing>(`/organizations/${orgId}/billing`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "লোড করা যায়নি");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function requestPlan(tier: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const noteEl = document.getElementById("plan-note") as HTMLInputElement | null;
    setBusy(tier); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/billing/plan-request`, {
        method: "POST",
        body: JSON.stringify({ requestedPlan: tier, note: noteEl?.value || undefined }),
      });
      setNotice(`${tier} প্ল্যানের অনুরোধ পাঠানো হয়েছে। প্ল্যাটফর্ম টিম যাচাই করে Admin Console থেকে পরিবর্তন করে দেবে।`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "অনুরোধ পাঠানো যায়নি");
    } finally { setBusy(""); }
  }

  async function buyOnline(tier: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const phone = (document.getElementById("pay-phone") as HTMLInputElement | null)?.value.trim() ?? "";
    const couponCode = (document.getElementById("pay-coupon") as HTMLInputElement | null)?.value.trim() ?? "";
    const gateway = (document.getElementById("pay-gateway") as HTMLSelectElement | null)?.value ?? "sslcommerz";
    setBusy(`buy-${tier}`); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ gatewayUrl?: string; sandbox?: boolean; viaCredit?: boolean }>(`/organizations/${orgId}/billing/checkout`, {
        method: "POST",
        body: JSON.stringify({ plan: tier, phone, couponCode: couponCode || undefined, gateway }),
      });
      if (out.viaCredit) {
        setNotice("🎉 কুপন/ক্রেডিট দিয়েই পুরো মূল্য পরিশোধ হয়েছে — প্ল্যান সক্রিয় করা হয়েছে।");
        setBusy("");
        await load();
        return;
      }
      if (!out.gatewayUrl) throw new Error("Gateway URL পাওয়া যায়নি");
      setNotice(out.sandbox ? "Sandbox Gateway এ পাঠানো হচ্ছে…" : "Payment Gateway এ পাঠানো হচ্ছে…");
      window.location.href = out.gatewayUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout শুরু করা যায়নি");
      setBusy("");
    }
  }

  async function previewCoupon() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const code = (document.getElementById("pay-coupon") as HTMLInputElement | null)?.value.trim() ?? "";
    const tier = (document.getElementById("pay-coupon-plan") as HTMLSelectElement | null)?.value ?? "";
    if (!code || !tier) { setError("কুপন কোড ও প্ল্যান বেছে নিন।"); return; }
    setError(""); setNotice("");
    try {
      const out = await apiFetch<{ discountMinor: string; creditAppliedMinor: string; dueMinor: string }>(`/organizations/${orgId}/billing/coupon-preview`, {
        method: "POST",
        body: JSON.stringify({ code, plan: tier }),
      });
      setNotice(`কুপন প্রযোজ্য: ছাড় ${taka(out.discountMinor)} · ক্রেডিট ${taka(out.creditAppliedMinor)} · দিতে হবে ${taka(out.dueMinor)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "কুপন যাচাই করা যায়নি");
    }
  }

  async function openInvoice(paymentId: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const token = localStorage.getItem("accessToken");
    const res = await fetch(`${API_URL}/organizations/${orgId}/billing/payments/${paymentId}/invoice`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { setError("Invoice খোলা যায়নি"); return; }
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  }

  if (error && !data) return <EmptyState title="বিলিং লোড করা যায়নি" description={error} />;
  if (!data) return <div className="p-6 text-sm text-slate-500">লোড হচ্ছে…</div>;

  const sub = data.subscription;
  return (
    <div className="space-y-4">
      <h1 className="page-title">সাবস্ক্রিপশন ও বিলিং</h1>
      {error ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div> : null}
      {gatewayReturn === "received" ? (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          💳 পেমেন্ট Gateway গ্রহণ করেছে। চূড়ান্ত যাচাই সম্পন্ন হলেই প্ল্যান সক্রিয় হবে — সাধারণত কয়েক সেকেন্ড লাগে। একটু পরে পেজটি রিফ্রেশ করে দেখুন; নিচের পেমেন্ট ইতিহাসে নতুন এন্ট্রি এলেই নিশ্চিত।
        </div>
      ) : null}
      {gatewayReturn === "failed" ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">❌ পেমেন্ট ব্যর্থ হয়েছে — কোনো টাকা কাটা হলে Gateway ফেরত প্রক্রিয়া করবে। আবার চেষ্টা করুন বা অনুরোধ পাঠান।</div> : null}
      {gatewayReturn === "cancelled" ? <div className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">পেমেন্ট বাতিল করা হয়েছে — প্ল্যান বদলায়নি।</div> : null}

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-slate-500">বর্তমান প্ল্যান</div>
            <div className="text-2xl font-bold">
              {sub ? sub.plan : "—"}{" "}
              {sub ? <span className={sub.status === "ACTIVE" ? "badge-green" : "badge-amber"}>{sub.status}</span> : null}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {sub ? <>মূল্য: {taka(sub.priceMinor)}/মাস</> : "কোনো সাবস্ক্রিপশন পাওয়া যায়নি"}
              {sub?.currentPeriodEnd ? <> · মেয়াদ শেষ: {new Date(sub.currentPeriodEnd).toLocaleDateString("bn-BD")}</> : null}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-lg font-semibold">{data.usage.seatsUsed}{data.limits.seats != null ? ` / ${data.limits.seats}` : ""}</div>
              <div className="text-xs text-slate-500">টিম সদস্য (সিট)</div>
            </div>
            <div>
              <div className="text-lg font-semibold">{data.usage.aiCallsToday} / {data.limits.aiDaily}</div>
              <div className="text-xs text-slate-500">আজকের AI ব্যবহার</div>
            </div>
            <div>
              <div className="text-lg font-semibold">{data.usage.broadcasts30d}</div>
              <div className="text-xs text-slate-500">ব্রডকাস্ট (৩০ দিন) · প্রতি পাঠানোতে সর্বোচ্চ {data.limits.broadcastCap}</div>
            </div>
          </div>
        </div>
      </div>

      {data.creditMinor && data.creditMinor !== "0" ? (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          💰 আপনার অ্যাকাউন্টে <strong>{taka(data.creditMinor)}</strong> ক্রেডিট জমা আছে — পরের অনলাইন পেমেন্টে স্বয়ংক্রিয়ভাবে বাদ যাবে।
        </div>
      ) : null}

      <div className="card p-5">
        <h2 className="mb-1 font-semibold">প্ল্যান কিনুন / বদলান</h2>
        <p className="mb-3 text-sm text-slate-500">অনলাইন পেমেন্টে প্ল্যান সঙ্গে সঙ্গে সক্রিয় হয় — যাচাইকৃত পেমেন্ট ছাড়া কখনোই নয়। অথবা অনুরোধ পাঠালে প্ল্যাটফর্ম টিম ম্যানুয়ালি পেমেন্ট নিশ্চিত করে বদলে দেয়।</p>
        <label className="mb-3 block text-sm text-slate-600">পেমেন্ট রসিদের মোবাইল নম্বর (অনলাইন পেমেন্টের জন্য)
          <input id="pay-phone" className="input mt-1 max-w-xs" placeholder="01XXXXXXXXX" defaultValue="" />
        </label>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          {data.gateways.bkash ? (
            <label className="block text-sm text-slate-600">Gateway
              <select id="pay-gateway" className="input mt-1">
                <option value="sslcommerz">SSLCommerz (কার্ড/ব্যাংক)</option>
                <option value="bkash">bKash</option>
              </select>
            </label>
          ) : null}
          <label className="block text-sm text-slate-600">কুপন কোড (যদি থাকে)
            <input id="pay-coupon" className="input mt-1 max-w-[180px]" placeholder="যেমন: LAUNCH20" />
          </label>
          <label className="block text-sm text-slate-600">কুপন যাচাইয়ের প্ল্যান
            <select id="pay-coupon-plan" className="input mt-1">
              {data.plans.filter((p) => Number(p.priceMinor) > 0).map((p) => <option key={p.tier} value={p.tier}>{p.tier}</option>)}
            </select>
          </label>
          <button className="btn-secondary" onClick={previewCoupon}>কুপন যাচাই</button>
        </div>
        {!data.gateways.sslcommerz && !data.gateways.bkash ? (
          <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">অনলাইন পেমেন্ট এখনো চালু হয়নি — "অনুরোধ পাঠান" ব্যবহার করুন, প্ল্যাটফর্ম টিম ম্যানুয়ালি নিশ্চিত করবে।</p>
        ) : null}
        <input id="plan-note" className="input mb-3" placeholder="অনুরোধের নোট (ঐচ্ছিক) — যেমন: bKash এ পেমেন্ট করেছি, TrxID …" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.plans.map((p) => (
            <div key={p.tier} className={`rounded-xl border p-4 ${sub?.plan === p.tier ? "border-indigo-400 bg-indigo-50" : "border-slate-200"}`}>
              <div className="font-semibold">{p.tier}</div>
              <div className="text-xl font-bold">{taka(p.priceMinor)}<span className="text-sm font-normal text-slate-500">/মাস</span></div>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                <li>AI প্রতিদিন: {p.limits.aiDaily}</li>
                <li>ব্রডকাস্ট ক্যাপ: {p.limits.broadcastCap}</li>
                <li>টিম সিট: {p.limits.seats}</li>
              </ul>
              {sub?.plan === p.tier ? (
                <div className="mt-3 text-xs font-medium text-indigo-600">বর্তমান প্ল্যান</div>
              ) : (
                <div className="mt-3 space-y-2">
                  {Number(p.priceMinor) > 0 && (data.gateways.sslcommerz || data.gateways.bkash) ? (
                    <button className="btn-primary w-full" disabled={busy === `buy-${p.tier}`} onClick={() => buyOnline(p.tier)}>
                      {busy === `buy-${p.tier}` ? "Gateway এ যাচ্ছে…" : "💳 অনলাইনে কিনুন"}
                    </button>
                  ) : null}
                  <button className="btn-secondary w-full" disabled={busy === p.tier} onClick={() => requestPlan(p.tier)}>
                    {busy === p.tier ? "পাঠানো হচ্ছে…" : "অনুরোধ পাঠান"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold">পেমেন্ট ইতিহাস</h2>
        {data.payments.length === 0 ? (
          <p className="text-sm text-slate-500">এখনো কোনো পেমেন্ট রেকর্ড নেই। পেমেন্ট করলে প্ল্যাটফর্ম টিম এখানে এন্ট্রি করে দেয়।</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2">তারিখ</th><th>পরিমাণ</th><th>মাধ্যম</th><th>রেফারেন্স</th><th>মেয়াদ শেষ</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-2">{new Date(p.createdAt).toLocaleDateString("bn-BD")}</td>
                  <td>{taka(p.amountMinor)}
                    {p.refundedMinor && p.refundedMinor !== "0" ? <div className="text-xs text-amber-600">ফেরত {taka(p.refundedMinor)}</div> : null}
                  </td>
                  <td>{p.method}</td>
                  <td>{p.reference ?? "—"}</td>
                  <td>{p.periodEnd ? new Date(p.periodEnd).toLocaleDateString("bn-BD") : "—"}</td>
                  <td><button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => openInvoice(p.id)}>🧾 Invoice</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
