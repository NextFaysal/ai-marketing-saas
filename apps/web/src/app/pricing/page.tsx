"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  X,
  Sparkles,
  HelpCircle,
  Zap,
  ShieldCheck,
  ChevronDown,
  ArrowRight,
  Menu,
} from "lucide-react";
import { publicApiBase, API_URL } from "@/lib/api";
import { fmtMoney, fmtNumber } from "@repo/contracts";
import { pubT, pubLocaleOf } from "@/lib/i18n/public";

const LOCALE = pubLocaleOf();
const t = pubT(LOCALE);

interface Plan {
  tier: string;
  priceMinor: number;
  limits: { aiDaily: number; broadcastCap: number; seats: number };
}
interface Pricing {
  currency: string;
  trialDays: number;
  plans: Plan[];
}
interface SysStatus {
  signupOpen: boolean;
  maintenanceMode: boolean;
  announcement: { title: string; body: string } | null;
}

const TIER_BN: Record<string, string> = {
  FREE: t.pricing.tierFREE,
  STARTER: t.pricing.tierSTARTER,
  GROWTH: t.pricing.tierGROWTH,
  AGENCY: t.pricing.tierAGENCY,
};

const FEATURE_MATRIX: { name: string; free: boolean | string; starter: boolean | string; growth: boolean | string; agency: boolean | string }[] = [
  { name: t.pricing.featureSeats, free: t.pricing.matrixOnePerson, starter: t.pricing.matrixThreePeople, growth: t.pricing.matrixTenPeople, agency: t.pricing.matrixUnlimited },
  { name: t.pricing.featureAiMessages, free: t.pricing.matrixFifty, starter: t.pricing.matrixThreeHundred, growth: t.pricing.matrixFifteenHundred, agency: t.pricing.matrixTenThousand },
  { name: t.pricing.featureBroadcast, free: t.pricing.matrixHundredPeople, starter: t.pricing.matrixThousandPeople, growth: t.pricing.matrixTenThousandPeople, agency: t.pricing.matrixFiftyThousandPlusPeople },
  { name: t.pricing.featureUnifiedInbox, free: true, starter: true, growth: true, agency: true },
  { name: t.pricing.featureGrounding, free: true, starter: true, growth: true, agency: true },
  { name: t.pricing.featureCourierBulk, free: true, starter: true, growth: true, agency: true },
  { name: t.pricing.featureBarcodeInvoice, free: true, starter: true, growth: true, agency: true },
  { name: t.pricing.featureFraudShield, free: false, starter: true, growth: true, agency: true },
  { name: t.pricing.featureDeliveryCharge, free: false, starter: true, growth: true, agency: true },
  { name: t.pricing.featureCompetitorSpy, free: false, starter: t.pricing.matrixBasicMeta, growth: t.pricing.matrixFullMetaGoogleTiktok, agency: t.pricing.matrixFullUnlimitedTracking },
  { name: t.pricing.featureWorkflowCanvas, free: false, starter: t.pricing.matrixThreeFlows, growth: t.pricing.matrixUnlimitedFlows, agency: t.pricing.matrixUnlimitedFlows },
  { name: t.pricing.featureWhatsappCatalog, free: false, starter: false, growth: true, agency: true },
  { name: t.pricing.featureNetProfit, free: false, starter: false, growth: true, agency: true },
  { name: t.pricing.featureWhiteLabel, free: false, starter: false, growth: false, agency: true },
  { name: t.pricing.featureAccountManager, free: false, starter: false, growth: true, agency: true },
];

const DEFAULT_PRICING: Pricing = {
  currency: "BDT",
  trialDays: 14,
  plans: [
    { tier: "FREE", priceMinor: 0, limits: { aiDaily: 50, broadcastCap: 100, seats: 1 } },
    { tier: "STARTER", priceMinor: 150000, limits: { aiDaily: 300, broadcastCap: 1000, seats: 3 } },
    { tier: "GROWTH", priceMinor: 350000, limits: { aiDaily: 1500, broadcastCap: 10000, seats: 10 } },
    { tier: "AGENCY", priceMinor: 950000, limits: { aiDaily: 10000, broadcastCap: 50000, seats: 999 } },
  ],
};

export default function PricingPage() {
  const [pricing, setPricing] = useState<Pricing | null>(DEFAULT_PRICING);
  const [status, setStatus] = useState<SysStatus | null>(null);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${publicApiBase()}/public/pricing`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.plans) setPricing(j); })
      .catch(() => undefined);
    fetch(`${API_URL}/public/system-status`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const signupClosed = status?.signupOpen === false;
  const RegisterCta = ({
    className,
    label = t.pricing.startButton,
  }: {
    className: string;
    label?: string;
  }) =>
    signupClosed ? (
      <span className={`${className} cursor-not-allowed opacity-60`} title={t.landing.signupClosedTitle}>
        {t.landing.signupClosedCta}
      </span>
    ) : (
      <a href="/register" className={className}>
        {label}
      </a>
    );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500 selection:text-white">
      {/* Background glow effects - GPU accelerated */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden transform-gpu">
        <div className="absolute -top-40 left-1/2 h-[550px] w-[950px] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-[140px] will-change-transform" />
        <div className="absolute top-[45%] right-[-120px] h-[450px] w-[450px] rounded-full bg-violet-600/10 blur-[130px] will-change-transform" />
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-25" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3 group">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 via-violet-500 to-fuchsia-500 text-lg font-black text-white shadow-lg shadow-indigo-500/25 transition group-hover:scale-105">
              Q
            </span>
            <div>
              <div className="text-base font-bold leading-tight text-white flex items-center gap-1.5">
                AI Marketing OS
                <span className="rounded-full bg-indigo-500/20 border border-indigo-500/30 px-1.5 py-0.2 text-[9px] font-semibold text-indigo-300">
                  {t.pricing.headerPricingBadge}
                </span>
              </div>
              <div className="text-xs text-slate-400">by Qosprey</div>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-300 md:flex">
            <Link href="/" className="transition hover:text-white">{t.pricing.navHome}</Link>
            <Link href="/features" className="transition hover:text-white">{t.pricing.navFeaturesFull}</Link>
            <Link href="/#calculator" className="transition hover:text-white">{t.pricing.navCalculator}</Link>
            <Link href="/pricing" className="text-indigo-400 font-bold">{t.landing.navPricing}</Link>
            <Link href="/#faq" className="transition hover:text-white">{t.landing.navFaq}</Link>
          </nav>

          <div className="hidden sm:flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white"
            >
              {t.landing.login}
            </Link>
            <RegisterCta className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:brightness-110 active:scale-[0.98]" />
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden rounded-xl border border-slate-800 p-2 text-slate-400 hover:bg-slate-900 hover:text-white"
            aria-label={t.pricing.navToggleLabel}
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-b border-slate-800 bg-slate-950 px-6 py-4 space-y-3 text-sm">
            <Link href="/" className="block py-1 text-slate-300 hover:text-white">{t.pricing.navHome}</Link>
            <Link href="/features" className="block py-1 text-slate-300 hover:text-white">{t.pricing.navFeaturesFull}</Link>
            <Link href="/#calculator" className="block py-1 text-slate-300 hover:text-white">{t.pricing.navCalculator}</Link>
            <Link href="/pricing" className="block py-1 text-indigo-400 font-bold">{t.landing.navPricing}</Link>
            <Link href="/#faq" className="block py-1 text-slate-300 hover:text-white">{t.landing.navFaq}</Link>
            <div className="pt-2 flex gap-2">
              <Link href="/login" className="flex-1 text-center py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-semibold">{t.landing.login}</Link>
              <RegisterCta className="flex-1 text-center py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold" />
            </div>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pt-16 pb-12 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1.5 text-xs font-semibold text-indigo-300 shadow-inner">
          <Sparkles className="h-3.5 w-3.5 text-indigo-400 animate-pulse" />
          <span>{t.pricing.heroBadge}</span>
        </div>

        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl">
          {t.pricing.heroTitlePrefix}
          <span className="bg-gradient-to-r from-indigo-400 via-violet-300 to-fuchsia-400 bg-clip-text text-transparent">
            {t.pricing.heroTitleAccent}
          </span>
        </h1>

        <p className="mx-auto mt-4 max-w-2xl text-base text-slate-400">
          {t.pricing.heroTrialPrefix}{fmtNumber(LOCALE, pricing?.trialDays ?? 14)}{t.pricing.heroTrialSuffix}
        </p>

        {/* Billing cycle toggle */}
        <div className="mt-8 inline-flex items-center rounded-2xl border border-slate-800 bg-slate-900/80 p-1.5">
          <button
            type="button"
            onClick={() => setBillingCycle("monthly")}
            className={`rounded-xl px-5 py-2 text-xs font-bold transition ${
              billingCycle === "monthly" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30" : "text-slate-400 hover:text-white"
            }`}
          >
            {t.pricing.billingMonthly}
          </button>
          <button
            type="button"
            onClick={() => setBillingCycle("annual")}
            className={`flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-bold transition ${
              billingCycle === "annual" ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30" : "text-slate-400 hover:text-white"
            }`}
          >
            <span>{t.pricing.billingAnnual}</span>
            <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold">
              {t.pricing.billingAnnualFree}
            </span>
          </button>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-20">
        {!pricing ? (
          <p className="text-center text-slate-500 text-sm">{t.pricing.loadingPriceList}</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4 text-left">
            {pricing.plans.map((p) => {
              const isGrowth = p.tier === "GROWTH";
              const isAgency = p.tier === "AGENCY";
              const monthlyAmount = p.priceMinor / 100;
              // If annual is selected, compute 10 months price for 12 months (2 months free)
              const displayAmount =
                billingCycle === "annual" && monthlyAmount > 0
                  ? Math.round((monthlyAmount * 10) / 12)
                  : monthlyAmount;

              return (
                <div
                  key={p.tier}
                  className={`relative flex flex-col justify-between rounded-3xl border p-7 transition ${
                    isGrowth
                      ? "border-indigo-500 bg-indigo-950/20 shadow-2xl shadow-indigo-500/15"
                      : "border-slate-800 bg-slate-900/60"
                  }`}
                >
                  {isGrowth ? (
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-1 text-[10px] font-bold text-white shadow-md">
                      {t.pricing.popularBadge}
                    </span>
                  ) : null}

                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                      {TIER_BN[p.tier] ?? p.tier}
                    </div>

                    <div className="mt-3 text-3xl sm:text-4xl font-black text-white">
                      {fmtMoney(LOCALE, displayAmount)}
                      <span className="text-xs font-normal text-slate-400">{t.pricing.perMonth}</span>
                    </div>

                    {billingCycle === "annual" && monthlyAmount > 0 ? (
                      <div className="text-[10px] text-emerald-400 font-semibold mt-1">
                        {t.pricing.annualSavingPrefix}{fmtMoney(LOCALE, monthlyAmount * 2)}{t.pricing.annualSavingSuffix}
                      </div>
                    ) : null}

                    <div className="my-6 border-t border-slate-800/80" />

                    <ul className="space-y-3 text-xs text-slate-300">
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span>{fmtNumber(LOCALE, p.limits.seats)}{t.pricing.cardSeatsSuffix}</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span>{t.pricing.cardAiDailyPrefix}{fmtNumber(LOCALE, p.limits.aiDaily)}{t.pricing.cardAiDailySuffix}</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span>{t.pricing.cardBroadcastPrefix}{fmtNumber(LOCALE, p.limits.broadcastCap)}{t.pricing.cardBroadcastSuffix}</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span>{t.pricing.cardInboxCourier}</span>
                      </li>
                      {isGrowth || isAgency ? (
                        <>
                          <li className="flex items-center gap-2 text-indigo-300 font-medium">
                            <Check className="h-4 w-4 text-indigo-400 shrink-0" />
                            <span>{t.pricing.cardFraudShield}</span>
                          </li>
                          <li className="flex items-center gap-2 text-indigo-300 font-medium">
                            <Check className="h-4 w-4 text-indigo-400 shrink-0" />
                            <span>{t.pricing.featureCompetitorSpy}</span>
                          </li>
                          <li className="flex items-center gap-2 text-indigo-300 font-medium">
                            <Check className="h-4 w-4 text-indigo-400 shrink-0" />
                            <span>{t.pricing.cardNetProfit}</span>
                          </li>
                        </>
                      ) : null}
                    </ul>
                  </div>

                  <RegisterCta
                    label={isGrowth ? t.pricing.growthStartButton : t.pricing.startButton}
                    className={`mt-8 block rounded-xl py-3 text-center text-xs font-bold transition ${
                      isGrowth
                        ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-600/30 hover:brightness-110 active:scale-[0.98]"
                        : "border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white"
                    }`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* COMPREHENSIVE FEATURE COMPARISON MATRIX TABLE */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-black text-white">{t.pricing.compareTitle}</h2>
          <p className="mt-2 text-xs sm:text-sm text-slate-400">{t.pricing.compareSubtitle}</p>
        </div>

        <div className="overflow-x-auto rounded-3xl border border-slate-800 bg-slate-900/60 backdrop-blur-md">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-300">
                <th className="p-4 font-bold sm:w-1/3">{t.pricing.compareFeatureHeader}</th>
                <th className="p-4 font-bold text-center">{t.pricing.compareFreeHeader}</th>
                <th className="p-4 font-bold text-center">{t.pricing.tierSTARTER}</th>
                <th className="p-4 font-bold text-center text-indigo-400">{t.pricing.compareGrowthHeader}</th>
                <th className="p-4 font-bold text-center">{t.pricing.tierAGENCY}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {FEATURE_MATRIX.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-800/30 transition">
                  <td className="p-4 font-medium text-white">{row.name}</td>
                  <td className="p-4 text-center">
                    {typeof row.free === "boolean" ? (
                      row.free ? <Check className="h-4 w-4 text-emerald-400 mx-auto" /> : <X className="h-4 w-4 text-slate-600 mx-auto" />
                    ) : (
                      <span className="text-slate-400">{row.free}</span>
                    )}
                  </td>
                  <td className="p-4 text-center">
                    {typeof row.starter === "boolean" ? (
                      row.starter ? <Check className="h-4 w-4 text-emerald-400 mx-auto" /> : <X className="h-4 w-4 text-slate-600 mx-auto" />
                    ) : (
                      <span className="text-slate-300">{row.starter}</span>
                    )}
                  </td>
                  <td className="p-4 text-center bg-indigo-950/20 font-semibold text-white">
                    {typeof row.growth === "boolean" ? (
                      row.growth ? <Check className="h-4 w-4 text-emerald-400 mx-auto" /> : <X className="h-4 w-4 text-slate-600 mx-auto" />
                    ) : (
                      <span className="text-indigo-300">{row.growth}</span>
                    )}
                  </td>
                  <td className="p-4 text-center">
                    {typeof row.agency === "boolean" ? (
                      row.agency ? <Check className="h-4 w-4 text-emerald-400 mx-auto" /> : <X className="h-4 w-4 text-slate-600 mx-auto" />
                    ) : (
                      <span className="text-slate-300">{row.agency}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

            <p className="relative z-10 pb-10 text-center text-sm text-slate-400">
        {t.pricing.haveAccount}
        <a className="text-indigo-400 underline" href="/login">{t.pricing.loginLink}</a>
      </p>

      {/* FOOTER */}
      <footer className="border-t border-slate-800 bg-slate-950 py-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 text-xs text-slate-500">
          <div>© {new Date().getFullYear()}{t.pricing.footerCopyrightSuffix}</div>
          <div className="flex flex-wrap gap-5 sm:gap-6">
            <Link href="/" className="hover:text-slate-300">{t.pricing.navHome}</Link>
            <Link href="/features" className="hover:text-slate-300">{t.pricing.navFeaturesFull}</Link>
            <Link href="/pricing" className="hover:text-slate-300">{t.landing.footerPricing}</Link>
            <Link href="/privacy" className="hover:text-slate-300">{t.pricing.footerPrivacy}</Link>
            <Link href="/terms" className="hover:text-slate-300">{t.pricing.footerTerms}</Link>
            <Link href="/login" className="hover:text-slate-300">{t.landing.footerLogin}</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
