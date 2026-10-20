"use client";

import { useEffect, useState } from "react";
import { fmtDate, fmtMoney } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
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

const taka = (minor: number | string, locale: "bn" | "en" = "bn") => fmtMoney(locale, Number(minor) / 100, { minimumFractionDigits: 2 });
const REASON_BN: Record<string, string> = {
  referral_reward: "referralReward2", referral_welcome: "welcomeCredit",
  milestone_bonus: "milestoneBonus", checkout_credit_spend: "creditUsedOnABill",
  referral_clawback: "rewardReturnedOnRefund", credit_expired: "removedOnExpiry",
  admin_adjustment: "adminAdjustment",
};

export default function ReferralPage() {
  const { dict, t, locale } = useLocale();
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
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.didNotLoad); }
  }
  useEffect(() => { void load(); }, []);

  if (error) return <div className="alert alert-red">{error}</div>;
  if (!data) return <div className="skeleton h-64 w-full" />;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = `${origin}/register?ref=${data.code}`;
  const shareText = encodeURIComponent(t("commerce.iAmUsingQospreyAI", { link: link }));
  const copy = async (text: string, which: string) => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(which); setTimeout(() => setCopied(""), 1500);
  };
  const cfg = data.config;
  const rewardExplain = cfg.mode === "percent"
    ? t("commerce.creditOfTheFriendS", { percentOfFirstPayment: cfg.percentOfFirstPayment })
    : cfg.mode === "per_plan"
      ? t("commerce.creditPerPlanEG", { taka: taka(cfg.perPlanMinor.GROWTH ?? data.rewardMinor, locale) })
      : t("commerce.creditForEveryPaidReferral", { taka: taka(data.rewardMinor, locale) });
  const nextMilestone = cfg.milestones.find((m) => data.stats.rewarded < m.count);

  return (
    <div className="space-y-5">
      <section className="hero-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white sm:text-2xl">{dict.commerce.referralProgram}</h1>
            <p className="mt-1 max-w-xl text-sm text-white/80">
              {dict.commerce.inviteAFriendWhenThey}{rewardExplain}
              {cfg.refereeBonusMinor > 0 ? <>{dict.commerce.andTheyWillAlsoGet}{taka(cfg.refereeBonusMinor, locale)} {dict.commerce.welcomeCredit2}</> : null}{dict.commerce.creditCanOnlyBeUsed}{cfg.creditExpiryDays > 0 ? <> {dict.commerce.creditValidity}{cfg.creditExpiryDays} {dict.commerce.days6}</> : null}
            </p>
          </div>
          <span className={`hero-chip ${data.programEnabled ? "" : "opacity-70"}`}>{data.programEnabled ? dict.commerce.programOn : dict.commerce.programOff}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="rounded-xl bg-white/15 px-3 py-2 text-sm font-bold tracking-wide text-white">{data.code}</code>
          <button type="button" className="btn-secondary !bg-white/15 !text-white hover:!bg-white/25" onClick={() => void copy(data.code, "code")}>{copied === "code" ? dict.commerce.copied : dict.commerce.copyCode}</button>
          <code className="max-w-full truncate rounded-xl bg-white/10 px-3 py-2 text-xs text-white/90">{link}</code>
          <button type="button" className="btn-secondary !bg-white/15 !text-white hover:!bg-white/25" onClick={() => void copy(link, "link")}>{copied === "link" ? dict.commerce.copied : dict.commerce.copyLink3}</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="btn-primary !bg-[#25D366]" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${shareText}`}>{dict.commerce.shareOnWhatsApp}</a>
          <a className="btn-primary !bg-[#1877F2]" target="_blank" rel="noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`}>{dict.commerce.shareOnFacebook}</a>
          <a className="btn-primary !bg-[#229ED9]" target="_blank" rel="noreferrer" href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${shareText}`}>{dict.commerce.shareOnTelegram}</a>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: dict.commerce.totalSignUps, value: String(data.stats.signups), icon: "👥" },
          { label: dict.commerce.havePaid, value: String(data.stats.rewarded), icon: "💳" },
          { label: dict.commerce.pending, value: String(data.stats.pending), icon: "⏳" },
          { label: dict.commerce.conversion, value: data.stats.conversionPercent != null ? `${data.stats.conversionPercent}%` : "—", icon: "📈" },
          { label: dict.commerce.totalCreditEarned, value: taka(data.stats.earnedMinor, locale), icon: "🎁" },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-icon stat-icon-brand">{s.icon}</div>
            <div><div className="stat-value">{s.value}</div><div className="stat-label">{s.label}</div></div>
          </div>
        ))}
      </section>

      {cfg.milestones.length ? (
        <section className="card p-5">
          <h2 className="section-title">{dict.commerce.milestoneBonus}</h2>
          <div className="mt-3 space-y-3">
            {cfg.milestones.map((m) => {
              const done = data.stats.rewarded >= m.count;
              const pct = Math.min(100, Math.round((data.stats.rewarded / m.count) * 100));
              return (
                <div key={m.count}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{m.count}{dict.commerce.paidReferralsBonus}{taka(m.bonusMinor, locale)}</span>
                    <span className={done ? "font-bold text-emerald-600" : "text-slate-500"}>{done ? dict.commerce.received3 : `${data.stats.rewarded}/${m.count}`}</span>
                  </div>
                  <div className="meter mt-1"><div className={`meter-fill ${done ? "meter-fill-ok" : ""}`} style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
          {nextMilestone ? <p className="mt-2 text-xs text-slate-400">{dict.commerce.and}{nextMilestone.count - data.stats.rewarded}{dict.commerce.morePaidReferralsForThe}</p> : null}
        </section>
      ) : null}

      <section className="card p-5">
        <h2 className="section-title">{dict.commerce.myReferrals}</h2>
        {data.referrals.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{dict.commerce.nobodyHasSignedUpWith}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-slate-400"><th className="py-2">{dict.commerce.businessPerson}</th><th>{dict.commerce.plan}</th><th>{dict.commerce.status}</th><th>{dict.commerce.signUp}</th><th>{dict.commerce.reward2}</th></tr></thead>
              <tbody>
                {data.referrals.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-2.5">
                      <div className="font-medium text-slate-700">{r.referredOrgName ?? r.referredName ?? "—"}</div>
                      <div className="text-xs text-slate-400">{r.referredEmail ?? ""}{r.sourceKind === "campaign" ? dict.commerce.campaign : ""}</div>
                    </td>
                    <td>{r.referredPlan ?? "—"}</td>
                    <td>{r.status === "rewarded" ? <span className="font-semibold text-emerald-600">{dict.commerce.paid2}</span> : r.status === "clawed_back" ? <span className="text-red-500">{dict.commerce.returned}</span> : <span className="text-amber-600">{dict.commerce.pending2}</span>}</td>
                    <td className="text-slate-500">{fmtDate(locale, new Date(r.createdAt))}</td>
                    <td className="font-semibold">{r.rewardMinor != null ? taka(r.rewardMinor, locale) : "—"}</td>
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
            <h2 className="section-title">{dict.commerce.thisWorkspaceSCreditHistory}</h2>
            <span className="text-sm font-bold text-slate-800">{dict.commerce.balance3}{taka(ledger.balanceMinor, locale)}</span>
          </div>
          {ledger.entries.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">{dict.commerce.noCreditTransactionsRecordedYet}</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {ledger.entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2">
                  <span>{REASON_BN[e.reason] ? dict.commerce[REASON_BN[e.reason] as keyof typeof dict.commerce] : e.reason} <span className="text-xs text-slate-400">· {fmtDate(locale, new Date(e.createdAt))}{e.expiresAt ? t("commerce.expiry3", { p0: fmtDate(locale, new Date(e.expiresAt)) }) : ""}</span></span>
                  <span className={`font-bold ${Number(e.deltaMinor) >= 0 ? "text-emerald-600" : "text-red-500"}`}>{Number(e.deltaMinor) >= 0 ? "+" : ""}{taka(e.deltaMinor, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
