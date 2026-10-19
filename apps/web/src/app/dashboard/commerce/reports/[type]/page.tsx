"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { ResponsiveTable } from "@repo/ui";
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
  const { dict, t, locale } = useLocale();
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
    if (!from || !to) { setError(dict.commerce.giveBothTheStartAnd); return; }
    setBusy(true); setError("");
    try {
      const r = await apiFetch<unknown>(`/organizations/${orgId}/finance/reports/${type}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      setData(r);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.reportLoadingFailed); }
    finally { setBusy(false); }
  }, [valid, type, from, to]);
  useEffect(() => { void load(); }, [load]);

  async function download(fmt: "csv" | "xlsx") {
    const orgId = getOrganizationId(); if (!orgId) return;
    setDlMsg(""); setDlError("");
    if (!from || !to) { setDlError(dict.commerce.giveBothTheStartAnd); return; }
    setDlBusy(true);
    try {
      const res = await fetch(
        `${API_URL}/organizations/${orgId}/finance/reports/${type}/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=${fmt}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? t("commerce.downloadFailedHTTP", { status: res.status }));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${type}-${from}-${to}.${fmt}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setDlMsg(t("commerce.reportDownloaded", { fmt: fmt.toUpperCase() }));
    } catch (err) { setDlError(err instanceof Error ? err.message : dict.commerce.downloadFailed); }
    finally { setDlBusy(false); }
  }

  if (!valid) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-4">
        <h1 className="page-title">{dict.commerce.reportNotFound}</h1>
        <p className="text-sm text-slate-500">{dict.commerce.noReportWithThisName}</p>
        <Link href="/dashboard/commerce/reports" className="text-sm font-semibold text-indigo-600 hover:underline">{dict.commerce.backToAllReports}</Link>
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
        <Link href="/dashboard/commerce/reports" className="text-sm font-semibold text-indigo-600 hover:underline">{dict.commerce.allReports2}</Link>
        <h1 className="page-title mt-2">{meta?.label}</h1>
        <p className="text-sm text-slate-500">{meta?.description}</p>
      </div>

      <div className="card space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className={labelCls}>{dict.commerce.startDate}</label>
            <input className={inputCls} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>{dict.commerce.endDate}</label>
            <input className={inputCls} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 md:col-span-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void load()}>{busy ? dict.common.loading : dict.commerce.view}</button>
            <button type="button" className="btn-secondary" disabled={dlBusy} onClick={() => void download("csv")}>{dict.commerce.cSVExport}</button>
            <button type="button" className="btn-secondary" disabled={dlBusy} onClick={() => void download("xlsx")}>{dict.commerce.xLSXExport}</button>
          </div>
        </div>
        {dlMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{dlMsg}</p> : null}
        {dlError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{dlError}</p> : null}
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {busy && !data ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : null}

        {data && type === "discounts" ? (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold">{dict.commerce.orderLevelTotalDiscountAll}</h3>
              <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.totalDiscount}</div><div className="text-lg font-bold">{fmtM(d.totals.orderDiscountMinor)}</div></div>
                <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.orderCount}</div><div className="text-lg font-bold">{d.totals.ordersInPeriod}{dict.commerce.text1ou8}</div></div>
              </div>
              {d.daily.length > 0 ? (
                <ResponsiveTable table={<div className="mt-3 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.date}</th><th className={thCls}>{dict.commerce.order}</th><th className={thCls}>{dict.commerce.orderLevelDiscount}</th><th className={thCls}>{dict.commerce.stampBasedDiscount}</th></tr></thead><tbody>
                  {d.daily.map((r) => (<tr key={r.date} className="border-b last:border-0"><td className={tdCls}>{r.date}</td><td className={tdCls}>{r.orders}{dict.commerce.text1ou8}</td><td className={tdCls}>{fmtM(r.orderDiscountMinor)}</td><td className={tdCls}>{fmtM(r.stampedDiscountMinor)}</td></tr>))}
                </tbody></table></div>} cards={<>{d.daily.map((r) => (<div key={r.date} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.date}</dt><dd className="text-right">{r.date}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.order}</dt><dd className="text-right">{r.orders}{dict.commerce.text1ou8}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.orderLevelDiscount}</dt><dd className="text-right">{fmtM(r.orderDiscountMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.stampBasedDiscount}</dt><dd className="text-right">{fmtM(r.stampedDiscountMinor)}</dd></div></dl></div>))}</>} />
              ) : null}
            </div>
            <div>
              <h3 className="font-semibold">{dict.commerce.stampBasedSourceAnalysisSince}</h3>
              <p className="mt-1 text-xs text-slate-500">{d.coverage.note}</p>
              <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.stampBasedTotalDiscount}</div><div className="text-lg font-bold">{fmtM(d.totals.stampedDiscountMinor)}</div></div>
                <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.ordersWithStamps}</div><div className="text-lg font-bold">{d.totals.stampedOrders}{dict.commerce.text1943kf}{d.coverage.ordersInPeriod}{dict.commerce.text1ou8}</div></div>
              </div>
              {d.bySource.length === 0 ? <p className="mt-2 text-sm text-slate-400">{dict.commerce.noStampBasedDiscountsIn}</p> : (
                <ResponsiveTable table={<div className="mt-3 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.type}</th><th className={thCls}>{dict.commerce.name}</th><th className={thCls}>{dict.commerce.apply}</th><th className={thCls}>{dict.commerce.discount}</th></tr></thead><tbody>
                  {d.bySource.map((r, i) => (<tr key={`${r.kind}-${r.key}-${i}`} className="border-b last:border-0"><td className={tdCls}>{discountKindLabel(r.kind)}</td><td className={tdCls}>{r.name}</td><td className={tdCls}>{r.applications}{dict.commerce.times}</td><td className={tdCls}>{fmtM(r.discountMinor)}</td></tr>))}
                </tbody></table></div>} cards={d.bySource.map((r, i) => (<div key={`${r.kind}-${r.key}-${i}`} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.type}</dt><dd className="text-right">{discountKindLabel(r.kind)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.name}</dt><dd className="text-right">{r.name}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.apply}</dt><dd className="text-right">{r.applications}{dict.commerce.times}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.discount}</dt><dd className="text-right">{fmtM(r.discountMinor)}</dd></div></dl></div>))} />
              )}
            </div>
          </div>
        ) : null}

        {data && type === "refunds" ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.totalRequests}</div><div className="text-lg font-bold">{d.requests.total}{dict.commerce.text1ou8}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.fullPartial2}</div><div className="text-lg font-bold">{d.requests.fullCount}{dict.commerce.text1943kf}{d.requests.partialCount}{dict.commerce.text1ou8}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.quantityUnknown}</div><div className="text-lg font-bold">{d.requests.amountUnknownCount}{dict.commerce.text1ou8}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.returnsRecordedOnOrders}</div><div className="text-lg font-bold">{fmtM(d.orderLevel.recordedRefundMinor)}</div></div>
            </div>
            <p className="text-xs text-slate-500">{d.coverage.note}</p>
            <div>
              <h3 className="font-semibold">{dict.commerce.byStatus}</h3>
              {d.requests.byStatus.length === 0 ? <p className="mt-2 text-sm text-slate-400">{dict.commerce.noRequests}</p> : (
                <ul className="mt-2 space-y-1 text-sm">{d.requests.byStatus.map((r) => (<li key={r.status} className="flex justify-between rounded bg-slate-50 px-3 py-2"><span>{r.status}</span><span className="font-semibold">{r.count}{dict.commerce.text1ou8}</span></li>))}</ul>
              )}
            </div>
            <div>
              <h3 className="font-semibold">{dict.commerce.byResolutionType}</h3>
              {d.requests.byResolution.length === 0 ? <p className="mt-2 text-sm text-slate-400">{dict.commerce.noResolutions}</p> : (
                <ResponsiveTable table={<div className="mt-2 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.resolution}</th><th className={thCls}>{dict.commerce.count}</th><th className={thCls}>{dict.commerce.quantity}</th><th className={thCls}>{dict.commerce.quantityKnown}</th></tr></thead><tbody>
                  {d.requests.byResolution.map((r) => (<tr key={r.resolution} className="border-b last:border-0"><td className={tdCls}>{refundResolutionLabel(r.resolution)}</td><td className={tdCls}>{r.count}{dict.commerce.text1ou8}</td><td className={tdCls}>{fmtM(r.amountMinor)}</td><td className={tdCls}>{r.amountsKnown}{dict.commerce.text1ou8}</td></tr>))}
                </tbody></table></div>} cards={d.requests.byResolution.map((r) => (<div key={r.resolution} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.resolution}</dt><dd className="text-right">{refundResolutionLabel(r.resolution)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.count}</dt><dd className="text-right">{r.count}{dict.commerce.text1ou8}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.quantity}</dt><dd className="text-right">{fmtM(r.amountMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.quantityKnown}</dt><dd className="text-right">{r.amountsKnown}{dict.commerce.text1ou8}</dd></div></dl></div>))} />
              )}
              <p className="mt-2 text-xs text-slate-500">{dict.commerce.ordersWithRefunds}{d.orderLevel.ordersWithRefunds}{dict.commerce.text1ou8}</p>
            </div>
          </div>
        ) : null}

        {data && type === "payment_sales" ? (
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold">{dict.commerce.byTheOrderSPayment}</h3>
              {d.byMethod.length === 0 ? <p className="mt-2 text-sm text-slate-400">{dict.commerce.noSalesInThisPeriod}</p> : (
                <ResponsiveTable table={<div className="mt-2 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.method}</th><th className={thCls}>{dict.commerce.order}</th><th className={thCls}>{dict.commerce.total}</th></tr></thead><tbody>
                  {d.byMethod.map((r) => (<tr key={r.method || "unknown"} className="border-b last:border-0"><td className={tdCls}>{paymentMethodLabel(r.method)}</td><td className={tdCls}>{r.orders}{dict.commerce.text1ou8}</td><td className={tdCls}>{fmtM(r.totalMinor)}</td></tr>))}
                  <tr className="bg-slate-50 font-semibold"><td className={tdCls}>{dict.commerce.total}</td><td className={tdCls}>{d.totals.orders}{dict.commerce.text1ou8}</td><td className={tdCls}>{fmtM(d.totals.totalMinor)}</td></tr>
                </tbody></table></div>} cards={<>{d.byMethod.map((r) => (<div key={r.method || "unknown"} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.method}</dt><dd className="text-right">{paymentMethodLabel(r.method)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.order}</dt><dd className="text-right">{r.orders}{dict.commerce.text1ou8}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.total}</dt><dd className="text-right">{fmtM(r.totalMinor)}</dd></div></dl></div>))}<div className="rounded-xl border bg-slate-50 p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.total}</dt><dd className="text-right">{d.totals.orders}{dict.commerce.orders}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.totalAmount}</dt><dd className="text-right">{fmtM(d.totals.totalMinor)}</dd></div></dl></div></>} />
              )}
            </div>
            <div>
              <h3 className="font-semibold">{dict.commerce.gatewayVerifiedPaymentsVerifiedPaid}</h3>
              <p className="mt-1 text-xs text-slate-500">{d.coverage.note}</p>
              {d.onlineVerified.length === 0 ? <p className="mt-2 text-sm text-slate-400">{dict.commerce.noVerifiedOnlinePaymentsIn}</p> : (
                <ResponsiveTable table={<div className="mt-2 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.provider}</th><th className={thCls}>{dict.commerce.source}</th><th className={thCls}>{dict.commerce.count}</th><th className={thCls}>{dict.commerce.totalGross}</th></tr></thead><tbody>
                  {d.onlineVerified.map((r, i) => (<tr key={`${r.provider}-${r.source}-${i}`} className="border-b last:border-0"><td className={tdCls}>{r.provider}</td><td className={tdCls}>{r.source === "platform" ? dict.commerce.platform : dict.commerce.own}</td><td className={tdCls}>{r.count}{dict.commerce.text1ou8}</td><td className={tdCls}>{fmtM(r.grossMinor)}</td></tr>))}
                  <tr className="bg-slate-50 font-semibold"><td className={tdCls}>{dict.commerce.total}</td><td className={tdCls}>—</td><td className={tdCls}>{d.onlineVerifiedTotals.count}{dict.commerce.text1ou8}</td><td className={tdCls}>{fmtM(d.onlineVerifiedTotals.grossMinor)}</td></tr>
                </tbody></table></div>} cards={<>{d.onlineVerified.map((r, i) => (<div key={`${r.provider}-${r.source}-${i}`} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.provider}</dt><dd className="text-right">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.source}</dt><dd className="text-right">{r.source === "platform" ? dict.commerce.platform : dict.commerce.own}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.count}</dt><dd className="text-right">{r.count}{dict.commerce.text1ou8}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.totalGross}</dt><dd className="text-right">{fmtM(r.grossMinor)}</dd></div></dl></div>))}<div className="rounded-xl border bg-slate-50 p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.total}</dt><dd className="text-right">{d.onlineVerifiedTotals.count}{dict.commerce.text1ou8}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.totalGross}</dt><dd className="text-right">{fmtM(d.onlineVerifiedTotals.grossMinor)}</dd></div></dl></div></>} />
              )}
            </div>
          </div>
        ) : null}

        {data && type === "category_sales" ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{d.coverage.note}</p>
            <p className="text-xs text-slate-500">{dict.commerce.soldOrders}{d.coverage.soldOrders}{dict.commerce.text1ou8}</p>
            {d.rows.length === 0 ? <p className="text-sm text-slate-400">{dict.commerce.noSalesInThisPeriod}</p> : (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.category}</th><th className={thCls}>{dict.commerce.order}</th><th className={thCls}>{dict.commerce.quantity}</th><th className={thCls}>{dict.commerce.revenue}</th></tr></thead><tbody>
                {d.rows.map((r) => (<tr key={r.category} className="border-b last:border-0"><td className={tdCls}>{r.category}</td><td className={tdCls}>{r.orders}{dict.commerce.text1ou8}</td><td className={tdCls}>{r.quantity}</td><td className={tdCls}>{fmtM(r.revenueMinor)}</td></tr>))}
                <tr className="bg-slate-50 font-semibold"><td className={tdCls}>{dict.commerce.total}</td><td className={tdCls}>{d.totals.orders}{dict.commerce.text1ou8}</td><td className={tdCls}>{d.totals.quantity}</td><td className={tdCls}>{fmtM(d.totals.revenueMinor)}</td></tr>
              </tbody></table></div>} cards={<>{d.rows.map((r) => (<div key={r.category} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.category}</dt><dd className="text-right">{r.category}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.order}</dt><dd className="text-right">{r.orders}{dict.commerce.text1ou8}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.quantity}</dt><dd className="text-right">{r.quantity}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.revenue}</dt><dd className="text-right">{fmtM(r.revenueMinor)}</dd></div></dl></div>))}<div className="rounded-xl border bg-slate-50 p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.total}</dt><dd className="text-right">{d.totals.orders}{dict.commerce.orders}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.quantity}</dt><dd className="text-right">{d.totals.quantity}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.revenue}</dt><dd className="text-right">{fmtM(d.totals.revenueMinor)}</dd></div></dl></div></>} />
            )}
          </div>
        ) : null}

        {data && type === "shipping_cost" ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold">
              {dict.commerce.actualCostFound}{ship.coverage.actualCoveragePct != null ? `${ship.coverage.actualCoveragePct}%` : "—"} {dict.commerce.inTheOrder}<span className="block text-xs font-normal text-slate-500">{dict.commerce.ordersWithShipments}{ship.coverage.ordersWithShipments}{dict.commerce.ordersWithActualCost}{ship.coverage.ordersWithAnyActual}{dict.commerce.text1ou8}</span>
            </p>
            <p className="text-xs text-slate-500">{ship.coverage.note}</p>
            {ship.rows.length === 0 ? <p className="text-sm text-slate-400">{dict.commerce.noShipmentsInThisPeriod}</p> : (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.courier}</th><th className={thCls}>{dict.commerce.shipment}</th><th className={thCls}>{dict.commerce.order}</th><th className={thCls}>{dict.commerce.chargedFee}</th><th className={thCls}>{dict.commerce.actualCost}</th><th className={thCls}>{dict.commerce.shipmentsWithActualCost}</th></tr></thead><tbody>
                {ship.rows.map((r) => (<tr key={r.provider} className="border-b last:border-0"><td className={tdCls}>{r.provider}</td><td className={tdCls}>{r.shipments}{dict.commerce.text1ou8}</td><td className={tdCls}>{r.orders}{dict.commerce.text1ou8}</td><td className={tdCls}>{fmtM(r.chargedMinor)}</td><td className={tdCls}>{r.actualMinor != null ? fmtM(r.actualMinor) : "—"}</td><td className={tdCls}>{r.shipmentsWithActual}{dict.commerce.text1ou8}</td></tr>))}
                <tr className="bg-slate-50 font-semibold"><td className={tdCls}>{dict.commerce.total}</td><td className={tdCls}>{ship.totals.shipments}{dict.commerce.text1ou8}</td><td className={tdCls}>{ship.totals.orders}{dict.commerce.text1ou8}</td><td className={tdCls}>{fmtM(ship.totals.chargedMinor)}</td><td className={tdCls}>{ship.totals.actualMinor != null ? fmtM(ship.totals.actualMinor) : "—"}</td><td className={tdCls}>{ship.totals.shipmentsWithActual}{dict.commerce.text1ou8}</td></tr>
              </tbody></table></div>} cards={<>{ship.rows.map((r) => (<div key={r.provider} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.courier}</dt><dd className="text-right">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.shipment}</dt><dd className="text-right">{r.shipments}{dict.commerce.text1ou8}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.order}</dt><dd className="text-right">{r.orders}{dict.commerce.text1ou8}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.chargedFee}</dt><dd className="text-right">{fmtM(r.chargedMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.actualCost}</dt><dd className="text-right">{r.actualMinor != null ? fmtM(r.actualMinor) : "—"}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.shipmentsWithActualCost}</dt><dd className="text-right">{r.shipmentsWithActual}{dict.commerce.text1ou8}</dd></div></dl></div>))}<div className="rounded-xl border bg-slate-50 p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.total}</dt><dd className="text-right">{ship.totals.shipments}{dict.commerce.shipments}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.order}</dt><dd className="text-right">{ship.totals.orders}{dict.commerce.text1ou8}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.chargedFee}</dt><dd className="text-right">{fmtM(ship.totals.chargedMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.actualCost}</dt><dd className="text-right">{ship.totals.actualMinor != null ? fmtM(ship.totals.actualMinor) : "—"}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.shipmentsWithActualCost}</dt><dd className="text-right">{ship.totals.shipmentsWithActual}{dict.commerce.text1ou8}</dd></div></dl></div></>} />
            )}
            <p className="text-xs text-slate-500">{dict.commerce.meansNoActualCostHas}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
