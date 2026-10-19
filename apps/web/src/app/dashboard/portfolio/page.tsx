"use client";
import React from "react";
import { fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n/provider";

interface OrgRow { organizationId: string; name: string; role: string; currency: string; monthSpendMinor: string; monthRevenueMinor: string; monthOrders: number; platformConversions: number; roas: number | null; publishedPlans: number }
interface CurrencyTotal { currency: string; monthSpendMinor: string; monthRevenueMinor: string; roas: number | null }
interface Portfolio { organizations: OrgRow[]; totalsByCurrency: CurrencyTotal[]; totals: { monthOrders: number; platformConversions: number } }

export default function PortfolioPage() {
  const { dict, t: tr, locale } = useLocale();
  const D = dict.agency;
  const [data, setData] = React.useState<Portfolio | null>(null);
  const [msg, setMsg] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setData(await apiFetch<Portfolio>(`/portfolio`).catch(() => null));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{D.poTitle}</h1>
          <p className="text-sm text-slate-500">{D.poSubtitle}</p>
        </div>
        <button className="btn-primary" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const out = await apiFetch<{ sent: boolean }>("/portfolio/digest", { method: "POST" });
            setMsg(out.sent ? D.poDigestSent : D.poDigestNotSent);
          } catch (e) { setMsg(e instanceof Error ? e.message : D.poDigestFailed); }
          setBusy(false);
        }}>{D.poDigestBtn}</button>
      </div>
      {msg ? <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{msg}</p> : null}
      {!data ? <div className="card p-5 text-sm text-slate-500">{dict.common.loading}</div> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="card p-4"><div className="text-xs text-slate-500">{D.poTotalOrders}</div><div className="text-xl font-bold">{fmtNumber(locale, data.totals.monthOrders)}</div></div>
            <div className="card p-4"><div className="text-xs text-slate-500">{D.poTotalConversions}</div><div className="text-xl font-bold">{fmtNumber(locale, data.totals.platformConversions)}</div></div>
            {data.totalsByCurrency.map((t) => (
              <React.Fragment key={t.currency}>
                <div className="card p-4"><div className="text-xs text-slate-500">{tr("agency.poTotalSpend", { currency: t.currency })}</div><div className="text-xl font-bold">{fmtMoneyMinor(locale, BigInt(t.monthSpendMinor), { currency: t.currency })}</div></div>
                <div className="card p-4"><div className="text-xs text-slate-500">{tr("agency.poTotalRevenue", { currency: t.currency })}</div><div className="text-xl font-bold">{fmtMoneyMinor(locale, BigInt(t.monthRevenueMinor), { currency: t.currency })}</div></div>
                <div className="card p-4"><div className="text-xs text-slate-500">{tr("agency.poRoas", { currency: t.currency })}</div><div className="text-xl font-bold">{t.roas === null || t.roas === undefined ? "—" : fmtNumber(locale, t.roas)}</div></div>
              </React.Fragment>
            ))}
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">{D.poColClient}</th><th className="px-4 py-3">{D.poColRole}</th><th className="px-4 py-3">{D.poColSpend}</th><th className="px-4 py-3">{D.poColRevenue}</th><th className="px-4 py-3">{D.poColOrders}</th><th className="px-4 py-3">{D.poColConversions}</th><th className="px-4 py-3">{D.poColRoas}</th><th className="px-4 py-3">{D.poColPlans}</th></tr></thead>
              <tbody>{data.organizations.map((o) => (
                <tr key={o.organizationId} className="border-t">
                  <td className="px-4 py-3 font-medium">{o.name}</td>
                  <td className="px-4 py-3">{o.role}</td>
                  <td className="px-4 py-3">{fmtMoneyMinor(locale, BigInt(o.monthSpendMinor), { currency: o.currency })}</td>
                  <td className="px-4 py-3">{fmtMoneyMinor(locale, BigInt(o.monthRevenueMinor), { currency: o.currency })}</td>
                  <td className="px-4 py-3">{fmtNumber(locale, o.monthOrders)}</td>
                  <td className="px-4 py-3">{fmtNumber(locale, o.platformConversions)}</td>
                  <td className="px-4 py-3">{o.roas === null || o.roas === undefined ? "—" : fmtNumber(locale, o.roas)}</td>
                  <td className="px-4 py-3">{fmtNumber(locale, o.publishedPlans)}</td>
                </tr>
              ))}</tbody>
            </table>
            {data.organizations.length <= 1 && <p className="px-4 py-3 text-xs text-slate-400">{D.poMultiNote}</p>}
          </div>
        </>
      )}
    </div>
  );
}
