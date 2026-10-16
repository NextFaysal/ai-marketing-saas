"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import {
  defaultRange,
  discountKindLabel,
  isReportType,
  paymentMethodLabel,
  refundResolutionLabel,
  reportTypeMeta,
  type CategorySalesReport,
  type DiscountsReport,
  type PaymentSalesReport,
  type RefundsReport,
  type ShippingCostReport,
} from "@/lib/finance-gb8";

const fmtM = (minor?: string | null): string => {
  if (minor == null) return "—";
  try { return formatMinor(BigInt(minor)); } catch { return minor; }
};

const inputCls = "w-full rounded-lg border px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-semibold text-slate-700";
const thCls = "py-2 pr-2 font-semibold";
const tdCls = "py-2 pr-2";

export default function ReportDetailPage() {
  const params = useParams();
  const type = typeof params?.type === "string" ? params.type : "";
  const valid = isReportType(type);
  const meta = reportTypeMeta(type);

  const [range, setRange] = useState(() => defaultRange());
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [data, setData] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dlBusy, setDlBusy] = useState(false);
  const [dlMsg, setDlMsg] = useState("");
  const [dlError, setDlError] = useState("");

  const load = useCallback(async () => {
    if (!valid) return;
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!from || !to) { setError("শুরু ও শেষের তারিখ দুটোই দিন"); return; }
    setBusy(true); setError("");
    try {
      const r = await apiFetch<unknown>(`/organizations/${orgId}/finance/reports/${type}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      setData(r);
    } catch (e) { setError(e instanceof Error ? e.message : "রিপোর্ট লোড ব্যর্থ"); }
    finally { setBusy(false); }
  }, [valid, type, from, to]);
  useEffect(() => { void load(); }, [load]);

  async function download(fmt: "csv" | "xlsx") {
    const orgId = getOrganizationId(); if (!orgId) return;
    setDlMsg(""); setDlError("");
    if (!from || !to) { setDlError("শুরু ও শেষের তারিখ দুটোই দিন"); return; }
    setDlBusy(true);
    try {
      const res = await fetch(
        `${API_URL}/organizations/${orgId}/finance/reports/${type}/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=${fmt}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `ডাউনলোড ব্যর্থ (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${type}-${from}-${to}.${fmt}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setDlMsg(`✅ রিপোর্ট (${fmt.toUpperCase()}) ডাউনলোড হয়েছে`);
    } catch (err) { setDlError(err instanceof Error ? err.message : "ডাউনলোড ব্যর্থ হয়েছে"); }
    finally { setDlBusy(false); }
  }

  if (!valid) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-4">
        <h1 className="page-title">রিপোর্ট পাওয়া যায়নি</h1>
        <p className="text-sm text-slate-500">এই নামে কোনো রিপোর্ট নেই।</p>
        <Link href="/dashboard/commerce/reports" className="text-sm font-semibold text-indigo-600 hover:underline">← সব রিপোর্টে ফিরুন</Link>
      </div>
    );
  }

  const d = data as DiscountsReport & RefundsReport & PaymentSalesReport & CategorySalesReport & ShippingCostReport;
  // Shipping rows/totals clash with category rows under the
  // intersection cast above, so shipping renders via its own cast.
  const ship = (data ?? {}) as ShippingCostReport;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <Link href="/dashboard/commerce/reports" className="text-sm font-semibold text-indigo-600 hover:underline">← সব রিপোর্ট</Link>
        <h1 className="page-title mt-2">{meta?.label}</h1>
        <p className="text-sm text-slate-500">{meta?.description}</p>
      </div>

      <div className="card space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className={labelCls}>শুরুর তারিখ</label>
            <input className={inputCls} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>শেষের তারিখ</label>
            <input className={inputCls} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 md:col-span-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void load()}>{busy ? "লোড হচ্ছে…" : "দেখুন"}</button>
            <button type="button" className="btn-secondary" disabled={dlBusy} onClick={() => void download("csv")}>CSV এক্সপোর্ট</button>
            <button type="button" className="btn-secondary" disabled={dlBusy} onClick={() => void download("xlsx")}>XLSX এক্সপোর্ট</button>
          </div>
        </div>
        {dlMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{dlMsg}</p> : null}
        {dlError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{dlError}</p> : null}
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {busy && !data ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : null}

        {data && type === "discounts" ? (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold">অর্ডার-স্তরের মোট ছাড় (সব অর্ডার)</h3>
              <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">মোট ছাড়</div><div className="text-lg font-bold">{fmtM(d.totals.orderDiscountMinor)}</div></div>
                <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">অর্ডার সংখ্যা</div><div className="text-lg font-bold">{d.totals.ordersInPeriod}টি</div></div>
              </div>
              {d.daily.length > 0 ? (
                <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>তারিখ</th><th className={thCls}>অর্ডার</th><th className={thCls}>অর্ডার-স্তরের ছাড়</th><th className={thCls}>স্ট্যাম্প-ভিত্তিক ছাড়</th></tr></thead><tbody>
                  {d.daily.map((r) => (<tr key={r.date} className="border-b last:border-0"><td className={tdCls}>{r.date}</td><td className={tdCls}>{r.orders}টি</td><td className={tdCls}>{fmtM(r.orderDiscountMinor)}</td><td className={tdCls}>{fmtM(r.stampedDiscountMinor)}</td></tr>))}
                </tbody></table></div>
              ) : null}
            </div>
            <div>
              <h3 className="font-semibold">স্ট্যাম্প-ভিত্তিক উৎস বিশ্লেষণ (GB7-এর পর থেকে)</h3>
              <p className="mt-1 text-xs text-slate-500">{d.coverage.note}</p>
              <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">স্ট্যাম্প-ভিত্তিক মোট ছাড়</div><div className="text-lg font-bold">{fmtM(d.totals.stampedDiscountMinor)}</div></div>
                <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">স্ট্যাম্পযুক্ত অর্ডার</div><div className="text-lg font-bold">{d.totals.stampedOrders}টি / {d.coverage.ordersInPeriod}টি</div></div>
              </div>
              {d.bySource.length === 0 ? <p className="mt-2 text-sm text-slate-400">এই সময়ে কোনো স্ট্যাম্প-ভিত্তিক ছাড় নেই।</p> : (
                <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>ধরন</th><th className={thCls}>নাম</th><th className={thCls}>প্রয়োগ</th><th className={thCls}>ছাড়</th></tr></thead><tbody>
                  {d.bySource.map((r, i) => (<tr key={`${r.kind}-${r.key}-${i}`} className="border-b last:border-0"><td className={tdCls}>{discountKindLabel(r.kind)}</td><td className={tdCls}>{r.name}</td><td className={tdCls}>{r.applications}বার</td><td className={tdCls}>{fmtM(r.discountMinor)}</td></tr>))}
                </tbody></table></div>
              )}
            </div>
          </div>
        ) : null}

        {data && type === "refunds" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">মোট অনুরোধ</div><div className="text-lg font-bold">{d.requests.total}টি</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">পূর্ণ / আংশিক</div><div className="text-lg font-bold">{d.requests.fullCount}টি / {d.requests.partialCount}টি</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">পরিমাণ অজানা</div><div className="text-lg font-bold">{d.requests.amountUnknownCount}টি</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">অর্ডারে রেকর্ড করা ফেরত</div><div className="text-lg font-bold">{fmtM(d.orderLevel.recordedRefundMinor)}</div></div>
            </div>
            <p className="text-xs text-slate-500">{d.coverage.note}</p>
            <div>
              <h3 className="font-semibold">অবস্থা অনুযায়ী</h3>
              {d.requests.byStatus.length === 0 ? <p className="mt-2 text-sm text-slate-400">কোনো অনুরোধ নেই।</p> : (
                <ul className="mt-2 space-y-1 text-sm">{d.requests.byStatus.map((r) => (<li key={r.status} className="flex justify-between rounded bg-slate-50 px-3 py-2"><span>{r.status}</span><span className="font-semibold">{r.count}টি</span></li>))}</ul>
              )}
            </div>
            <div>
              <h3 className="font-semibold">সমাধানের ধরন অনুযায়ী</h3>
              {d.requests.byResolution.length === 0 ? <p className="mt-2 text-sm text-slate-400">কোনো সমাধান নেই।</p> : (
                <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>সমাধান</th><th className={thCls}>সংখ্যা</th><th className={thCls}>পরিমাণ</th><th className={thCls}>পরিমাণ জানা আছে</th></tr></thead><tbody>
                  {d.requests.byResolution.map((r) => (<tr key={r.resolution} className="border-b last:border-0"><td className={tdCls}>{refundResolutionLabel(r.resolution)}</td><td className={tdCls}>{r.count}টি</td><td className={tdCls}>{fmtM(r.amountMinor)}</td><td className={tdCls}>{r.amountsKnown}টি</td></tr>))}
                </tbody></table></div>
              )}
              <p className="mt-2 text-xs text-slate-500">রিফান্ডযুক্ত অর্ডার: {d.orderLevel.ordersWithRefunds}টি</p>
            </div>
          </div>
        ) : null}

        {data && type === "payment_sales" ? (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold">অর্ডারের পেমেন্ট পদ্ধতি অনুযায়ী</h3>
              {d.byMethod.length === 0 ? <p className="mt-2 text-sm text-slate-400">এই সময়ে কোনো বিক্রি নেই।</p> : (
                <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>পদ্ধতি</th><th className={thCls}>অর্ডার</th><th className={thCls}>মোট</th></tr></thead><tbody>
                  {d.byMethod.map((r) => (<tr key={r.method || "unknown"} className="border-b last:border-0"><td className={tdCls}>{paymentMethodLabel(r.method)}</td><td className={tdCls}>{r.orders}টি</td><td className={tdCls}>{fmtM(r.totalMinor)}</td></tr>))}
                  <tr className="bg-slate-50 font-semibold"><td className={tdCls}>মোট</td><td className={tdCls}>{d.totals.orders}টি</td><td className={tdCls}>{fmtM(d.totals.totalMinor)}</td></tr>
                </tbody></table></div>
              )}
            </div>
            <div>
              <h3 className="font-semibold">গেটওয়ে যাচাইকৃত পেমেন্ট (verified_paid)</h3>
              <p className="mt-1 text-xs text-slate-500">{d.coverage.note}</p>
              {d.onlineVerified.length === 0 ? <p className="mt-2 text-sm text-slate-400">এই সময়ে কোনো যাচাইকৃত অনলাইন পেমেন্ট নেই।</p> : (
                <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>প্রোভাইডার</th><th className={thCls}>উৎস</th><th className={thCls}>সংখ্যা</th><th className={thCls}>মোট (গ্রস)</th></tr></thead><tbody>
                  {d.onlineVerified.map((r, i) => (<tr key={`${r.provider}-${r.source}-${i}`} className="border-b last:border-0"><td className={tdCls}>{r.provider}</td><td className={tdCls}>{r.source === "platform" ? "প্ল্যাটফর্ম" : "নিজের"}</td><td className={tdCls}>{r.count}টি</td><td className={tdCls}>{fmtM(r.grossMinor)}</td></tr>))}
                  <tr className="bg-slate-50 font-semibold"><td className={tdCls}>মোট</td><td className={tdCls}>—</td><td className={tdCls}>{d.onlineVerifiedTotals.count}টি</td><td className={tdCls}>{fmtM(d.onlineVerifiedTotals.grossMinor)}</td></tr>
                </tbody></table></div>
              )}
            </div>
          </div>
        ) : null}

        {data && type === "category_sales" ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{d.coverage.note}</p>
            <p className="text-xs text-slate-500">বিক্রীত অর্ডার: {d.coverage.soldOrders}টি</p>
            {d.rows.length === 0 ? <p className="text-sm text-slate-400">এই সময়ে কোনো বিক্রি নেই।</p> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>ক্যাটাগরি</th><th className={thCls}>অর্ডার</th><th className={thCls}>পরিমাণ</th><th className={thCls}>আয়</th></tr></thead><tbody>
                {d.rows.map((r) => (<tr key={r.category} className="border-b last:border-0"><td className={tdCls}>{r.category}</td><td className={tdCls}>{r.orders}টি</td><td className={tdCls}>{r.quantity}</td><td className={tdCls}>{fmtM(r.revenueMinor)}</td></tr>))}
                <tr className="bg-slate-50 font-semibold"><td className={tdCls}>মোট</td><td className={tdCls}>{d.totals.orders}টি</td><td className={tdCls}>{d.totals.quantity}</td><td className={tdCls}>{fmtM(d.totals.revenueMinor)}</td></tr>
              </tbody></table></div>
            )}
          </div>
        ) : null}

        {data && type === "shipping_cost" ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold">
              প্রকৃত খরচ পাওয়া গেছে: {ship.coverage.actualCoveragePct != null ? `${ship.coverage.actualCoveragePct}%` : "—"} অর্ডারে
              <span className="block text-xs font-normal text-slate-500">শিপমেন্টযুক্ত অর্ডার: {ship.coverage.ordersWithShipments}টি · প্রকৃত খরচসহ অর্ডার: {ship.coverage.ordersWithAnyActual}টি</span>
            </p>
            <p className="text-xs text-slate-500">{ship.coverage.note}</p>
            {ship.rows.length === 0 ? <p className="text-sm text-slate-400">এই সময়ে কোনো শিপমেন্ট নেই।</p> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>কুরিয়ার</th><th className={thCls}>শিপমেন্ট</th><th className={thCls}>অর্ডার</th><th className={thCls}>ধার্য চার্জ</th><th className={thCls}>প্রকৃত খরচ</th><th className={thCls}>প্রকৃত খরচসহ শিপমেন্ট</th></tr></thead><tbody>
                {ship.rows.map((r) => (<tr key={r.provider} className="border-b last:border-0"><td className={tdCls}>{r.provider}</td><td className={tdCls}>{r.shipments}টি</td><td className={tdCls}>{r.orders}টি</td><td className={tdCls}>{fmtM(r.chargedMinor)}</td><td className={tdCls}>{r.actualMinor != null ? fmtM(r.actualMinor) : "—"}</td><td className={tdCls}>{r.shipmentsWithActual}টি</td></tr>))}
                <tr className="bg-slate-50 font-semibold"><td className={tdCls}>মোট</td><td className={tdCls}>{ship.totals.shipments}টি</td><td className={tdCls}>{ship.totals.orders}টি</td><td className={tdCls}>{fmtM(ship.totals.chargedMinor)}</td><td className={tdCls}>{ship.totals.actualMinor != null ? fmtM(ship.totals.actualMinor) : "—"}</td><td className={tdCls}>{ship.totals.shipmentsWithActual}টি</td></tr>
              </tbody></table></div>
            )}
            <p className="text-xs text-slate-400">“—” মানে ওই কুরিয়ারের কোনো শিপমেন্টে প্রকৃত খরচ রেকর্ড করা হয়নি — ০ ধরে নেওয়া হয়নি।</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
