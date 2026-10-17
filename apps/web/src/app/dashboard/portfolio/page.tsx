"use client";
import React from "react";
import { formatMinor } from "@repo/contracts";
import { apiFetch } from "@/lib/api";

interface OrgRow { organizationId: string; name: string; role: string; currency: string; monthSpendMinor: string; monthRevenueMinor: string; monthOrders: number; platformConversions: number; roas: number | null; publishedPlans: number }
interface CurrencyTotal { currency: string; monthSpendMinor: string; monthRevenueMinor: string; roas: number | null }
interface Portfolio { organizations: OrgRow[]; totalsByCurrency: CurrencyTotal[]; totals: { monthOrders: number; platformConversions: number } }

export default function PortfolioPage() {
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
          <h1 className="page-title">🏢 এজেন্সি পোর্টফোলিও</h1>
          <p className="text-sm text-slate-500">আপনার সব ক্লায়েন্ট Organization এর এই মাসের অবস্থা এক জায়গায় — খরচ Campaign-level Ad ডেটা থেকে, আয় বাতিল/ফেরত বাদে আসল অর্ডার থেকে। মোট হিসাব প্রতিটি Organization-এর নিজের মুদ্রায় আলাদা করে দেখানো হয় — আলাদা মুদ্রার টাকা কখনো একসাথে যোগ করা হয় না। শুধু সক্রিয় (Active) সদস্যপদের Organization-ই এখানে আসে।</p>
        </div>
        <button className="btn-primary" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const out = await apiFetch<{ sent: boolean }>("/portfolio/digest", { method: "POST" });
            setMsg(out.sent ? "সাপ্তাহিক ডাইজেস্ট ইমেইলে পাঠানো হয়েছে।" : "পাঠানো যায়নি।");
          } catch (e) { setMsg(e instanceof Error ? e.message : "ডাইজেস্ট পাঠানো যায়নি (SMTP সেট করা আছে তো?)"); }
          setBusy(false);
        }}>📧 সাপ্তাহিক ডাইজেস্ট ইমেইল করুন</button>
      </div>
      {msg ? <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{msg}</p> : null}
      {!data ? <div className="card p-5 text-sm text-slate-500">লোড হচ্ছে…</div> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="card p-4"><div className="text-xs text-slate-500">মোট অর্ডার (এই মাস)</div><div className="text-xl font-bold">{data.totals.monthOrders}</div></div>
            <div className="card p-4"><div className="text-xs text-slate-500">মোট প্ল্যাটফর্ম কনভার্সন</div><div className="text-xl font-bold">{data.totals.platformConversions}</div></div>
            {data.totalsByCurrency.map((t) => (
              <React.Fragment key={t.currency}>
                <div className="card p-4"><div className="text-xs text-slate-500">মোট খরচ · {t.currency}</div><div className="text-xl font-bold">{formatMinor(BigInt(t.monthSpendMinor), t.currency)}</div></div>
                <div className="card p-4"><div className="text-xs text-slate-500">মোট আয় · {t.currency}</div><div className="text-xl font-bold">{formatMinor(BigInt(t.monthRevenueMinor), t.currency)}</div></div>
                <div className="card p-4"><div className="text-xs text-slate-500">ROAS · {t.currency}</div><div className="text-xl font-bold">{t.roas ?? "—"}</div></div>
              </React.Fragment>
            ))}
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">ক্লায়েন্ট / Organization</th><th className="px-4 py-3">আপনার ভূমিকা</th><th className="px-4 py-3">খরচ</th><th className="px-4 py-3">আয়</th><th className="px-4 py-3">অর্ডার</th><th className="px-4 py-3">কনভার্সন</th><th className="px-4 py-3">ROAS</th><th className="px-4 py-3">Published Plan</th></tr></thead>
              <tbody>{data.organizations.map((o) => (
                <tr key={o.organizationId} className="border-t">
                  <td className="px-4 py-3 font-medium">{o.name}</td>
                  <td className="px-4 py-3">{o.role}</td>
                  <td className="px-4 py-3">{formatMinor(BigInt(o.monthSpendMinor), o.currency)}</td>
                  <td className="px-4 py-3">{formatMinor(BigInt(o.monthRevenueMinor), o.currency)}</td>
                  <td className="px-4 py-3">{o.monthOrders}</td>
                  <td className="px-4 py-3">{o.platformConversions}</td>
                  <td className="px-4 py-3">{o.roas ?? "—"}</td>
                  <td className="px-4 py-3">{o.publishedPlans}</td>
                </tr>
              ))}</tbody>
            </table>
            {data.organizations.length <= 1 && <p className="px-4 py-3 text-xs text-slate-400">একাধিক ক্লায়েন্ট Organization এ সদস্য হলে এখানে সবার সারসংক্ষেপ আসবে।</p>}
          </div>
        </>
      )}
    </div>
  );
}
