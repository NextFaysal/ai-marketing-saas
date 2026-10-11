"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

// Referral Advanced R2: the tenant Referral Center — share
// kit, funnel, milestone progress, referral list with the
// referee's business + plan, and this org's credit history.
// Everything renders from GET /auth/referral and
// GET billing/credit-ledger; no invented numbers.

type RefRow = {
  id: string; status: string; createdAt: string; rewardedAt: string | null;
  rewardMinor: number | null; refereeBonusMinor: number | null; sourceKind: string;
  referredName: string | null; referredEmail: string | null;
  referredOrgName: string | null; referredPlan: string | null;
};
type RefData = {
  code: string; programEnabled: boolean; rewardMinor: number;
  config: {
    mode: string; percentOfFirstPayment: number; perPlanMinor: Record<string, number>;
    refereeBonusMinor: number; minFirstPaymentMinor: number; creditExpiryDays: number;
    milestones: { count: number; bonusMinor: number }[];
  };
  stats: { signups: number; rewarded: number; pending: number; earnedMinor: number; conversionPercent: number | null };
  referrals: RefRow[];
};
type Ledger = { balanceMinor: string; entries: { id: string; deltaMinor: string; reason: string; expiresAt: string | null; createdAt: string }[] };

const taka = (minor: number | string) => `৳${(Number(minor) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const REASON_BN: Record<string, string> = {
  referral_reward: "🎁 রেফারেল রিওয়ার্ড", referral_welcome: "👋 ওয়েলকাম ক্রেডিট",
  milestone_bonus: "🏆 মাইলস্টোন বোনাস", checkout_credit_spend: "💳 বিলে ক্রেডিট ব্যবহার",
  referral_clawback: "↩️ রিফান্ডে রিওয়ার্ড ফেরত", credit_expired: "⏰ মেয়াদ শেষে বাদ",
  admin_adjustment: "🛠️ Admin সমন্বয়",
};

export default function ReferralPage() {
  const [data, setData] = useState<RefData | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const d = await apiFetch<RefData>("/auth/referral");
      setData(d);
      const orgId = getOrganizationId();
      if (orgId) setLedger(await apiFetch<Ledger>(`/organizations/${orgId}/billing/credit-ledger`).catch(() => null));
    } catch (e) { setError(e instanceof Error ? e.message : "লোড হয়নি"); }
  }
  useEffect(() => { void load(); }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!data) return <div className="skeleton h-64 w-full" />;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = `${origin}/register?ref=${data.code}`;
  const shareText = encodeURIComponent(`আমি Qosprey AI Marketing ব্যবহার করছি — Facebook/WooCommerce বিক্রেতাদের জন্য AI মার্কেটিং প্ল্যাটফর্ম। আমার লিংক দিয়ে জয়েন করুন: ${link}`);
  const copy = async (text: string, which: string) => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(which); setTimeout(() => setCopied(""), 1500);
  };
  const cfg = data.config;
  const rewardExplain = cfg.mode === "percent"
    ? `বন্ধুর প্রথম পেমেন্টের ${cfg.percentOfFirstPayment}% ক্রেডিট`
    : cfg.mode === "per_plan"
      ? `প্ল্যান অনুযায়ী ক্রেডিট (যেমন GROWTH: ${taka(cfg.perPlanMinor.GROWTH ?? data.rewardMinor)})`
      : `প্রতিটি পেইড রেফারেলে ${taka(data.rewardMinor)} ক্রেডিট`;
  const nextMilestone = cfg.milestones.find((m) => data.stats.rewarded < m.count);

  return (
    <div className="space-y-5">
      <section className="hero-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white sm:text-2xl">🎁 রেফারেল প্রোগ্রাম</h1>
            <p className="mt-1 max-w-xl text-sm text-white/80">
              বন্ধুকে আমন্ত্রণ জানান — তিনি প্রথম পেমেন্ট করলেই আপনি পাবেন {rewardExplain}
              {cfg.refereeBonusMinor > 0 ? <>, আর তিনিও পাবেন {taka(cfg.refereeBonusMinor)} ওয়েলকাম ক্রেডিট</> : null}।
              ক্রেডিট শুধু বিলিংয়ে ব্যবহারযোগ্য — নগদ তোলা যায় না।
              {cfg.creditExpiryDays > 0 ? <> ক্রেডিটের মেয়াদ {cfg.creditExpiryDays} দিন।</> : null}
            </p>
          </div>
          <span className={`hero-chip ${data.programEnabled ? "" : "opacity-70"}`}>{data.programEnabled ? "✅ প্রোগ্রাম চালু" : "⏸️ প্রোগ্রাম বন্ধ"}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="rounded-xl bg-white/15 px-3 py-2 text-sm font-bold tracking-wide text-white">{data.code}</code>
          <button type="button" className="btn-secondary !bg-white/15 !text-white hover:!bg-white/25" onClick={() => void copy(data.code, "code")}>{copied === "code" ? "কপি হয়েছে ✓" : "কোড কপি"}</button>
          <code className="max-w-full truncate rounded-xl bg-white/10 px-3 py-2 text-xs text-white/90">{link}</code>
          <button type="button" className="btn-secondary !bg-white/15 !text-white hover:!bg-white/25" onClick={() => void copy(link, "link")}>{copied === "link" ? "কপি হয়েছে ✓" : "লিংক কপি"}</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="btn-primary !bg-[#25D366]" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${shareText}`}>WhatsApp এ শেয়ার</a>
          <a className="btn-primary !bg-[#1877F2]" target="_blank" rel="noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`}>Facebook এ শেয়ার</a>
          <a className="btn-primary !bg-[#229ED9]" target="_blank" rel="noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${shareText}`}>Telegram এ শেয়ার</a>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: "মোট সাইন আপ", value: String(data.stats.signups), icon: "👥" },
          { label: "পেমেন্ট করেছে", value: String(data.stats.rewarded), icon: "💳" },
          { label: "অপেক্ষমাণ", value: String(data.stats.pending), icon: "⏳" },
          { label: "কনভার্সন", value: data.stats.conversionPercent != null ? `${data.stats.conversionPercent}%` : "—", icon: "📈" },
          { label: "মোট অর্জিত ক্রেডিট", value: taka(data.stats.earnedMinor), icon: "🎁" },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-icon stat-icon-brand">{s.icon}</div>
            <div><div className="stat-value">{s.value}</div><div className="stat-label">{s.label}</div></div>
          </div>
        ))}
      </section>

      {cfg.milestones.length ? (
        <section className="card p-5">
          <h2 className="section-title">🏆 মাইলস্টোন বোনাস</h2>
          <div className="mt-3 space-y-3">
            {cfg.milestones.map((m) => {
              const done = data.stats.rewarded >= m.count;
              const pct = Math.min(100, Math.round((data.stats.rewarded / m.count) * 100));
              return (
                <div key={m.count}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{m.count}টি পেইড রেফারেল → বোনাস {taka(m.bonusMinor)}</span>
                    <span className={done ? "font-bold text-emerald-600" : "text-slate-500"}>{done ? "পেয়ে গেছেন ✓" : `${data.stats.rewarded}/${m.count}`}</span>
                  </div>
                  <div className="meter mt-1"><div className={`meter-fill ${done ? "meter-fill-ok" : ""}`} style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
          {nextMilestone ? <p className="mt-2 text-xs text-slate-400">আর {nextMilestone.count - data.stats.rewarded}টি পেইড রেফারেল হলেই পরের বোনাস।</p> : null}
        </section>
      ) : null}

      <section className="card p-5">
        <h2 className="section-title">👥 আমার রেফারেলসমূহ</h2>
        {data.referrals.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">এখনো কেউ আপনার লিংকে সাইন আপ করেননি — লিংকটি শেয়ার করুন!</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-slate-400"><th className="py-2">ব্যবসা / ব্যক্তি</th><th>প্ল্যান</th><th>অবস্থা</th><th>সাইন আপ</th><th>রিওয়ার্ড</th></tr></thead>
              <tbody>
                {data.referrals.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-2.5">
                      <div className="font-medium text-slate-700">{r.referredOrgName ?? r.referredName ?? "—"}</div>
                      <div className="text-xs text-slate-400">{r.referredEmail ?? ""}{r.sourceKind === "campaign" ? " · ক্যাম্পেইন" : ""}</div>
                    </td>
                    <td>{r.referredPlan ?? "—"}</td>
                    <td>{r.status === "rewarded" ? <span className="font-semibold text-emerald-600">✅ পেইড</span> : r.status === "clawed_back" ? <span className="text-red-500">↩️ ফেরত</span> : <span className="text-amber-600">⏳ অপেক্ষমাণ</span>}</td>
                    <td className="text-slate-500">{new Date(r.createdAt).toLocaleDateString("bn-BD")}</td>
                    <td className="font-semibold">{r.rewardMinor != null ? taka(r.rewardMinor) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {ledger ? (
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">💰 এই ওয়ার্কস্পেসের ক্রেডিট ইতিহাস</h2>
            <span className="text-sm font-bold text-slate-800">ব্যালান্স: {taka(ledger.balanceMinor)}</span>
          </div>
          {ledger.entries.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">এখনো কোনো ক্রেডিট লেনদেন রেকর্ড হয়নি। (R1 এর আগের ক্রেডিট লেজারে নেই — ব্যালান্সটাই চূড়ান্ত।)</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {ledger.entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2">
                  <span>{REASON_BN[e.reason] ?? e.reason} <span className="text-xs text-slate-400">· {new Date(e.createdAt).toLocaleDateString("bn-BD")}{e.expiresAt ? ` · মেয়াদ ${new Date(e.expiresAt).toLocaleDateString("bn-BD")}` : ""}</span></span>
                  <span className={`font-bold ${Number(e.deltaMinor) >= 0 ? "text-emerald-600" : "text-red-500"}`}>{Number(e.deltaMinor) >= 0 ? "+" : ""}{taka(e.deltaMinor)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
