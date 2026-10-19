"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { publicApiBase, API_URL, getToken } from "@/lib/api";
import { fmtMoney, fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { pubT, publicDicts } from "@/lib/i18n/public";
import { tr } from "@/lib/i18n/lookup";

const t = pubT();

/**
 * Milestone 58 — public marketing landing (the app's root "/").
 *
 * Honesty rules baked in:
 *  - Only capabilities that exist in the product TODAY are named.
 *  - No testimonials, no customer logos, no invented statistics.
 *    The showcase frames below are simplified CSS presentations in
 *    the style of the real screens, captioned as such — they are
 *    not screenshots and claim nothing a screenshot would.
 *  - Prices come from the SAME operator-settings source as /pricing
 *    (GET /public/pricing); nothing is hardcoded here.
 *  - The ROI calculator computes only from the visitor's own inputs
 *    and shows its formula on the page, labelled an estimate.
 *  - Signup state honours /public/system-status exactly like the
 *    register page does.
 */

interface Plan { tier: string; priceMinor: number; limits: { aiDaily: number; broadcastCap: number; seats: number } }
interface Pricing { currency: string; trialDays: number; plans: Plan[] }
interface SysStatus { signupOpen: boolean; maintenanceMode: boolean; announcement: { title: string; body: string } | null }

const TIER_BN: Record<string, string> = { FREE: t.landing.tierFREE, STARTER: t.landing.tierSTARTER, GROWTH: t.landing.tierGROWTH, AGENCY: t.landing.tierAGENCY };

const FEATURES: { icon: string; title: string; body: string }[] = [
  { icon: "🕵️", title: "Omnichannel Competitor Spy", body: t.landing.f1Body },
  { icon: "💬", title: "Unified Inbox", body: t.landing.f2Body },
  { icon: "🤖", title: t.landing.f3Title, body: t.landing.f3Body },
  { icon: "📣", title: t.landing.f4Title, body: t.landing.f4Body },
  { icon: "🎨", title: "AI Creative Studio", body: t.landing.f5Body },
  { icon: "🚚", title: t.landing.f6Title, body: t.landing.f6Body },
  { icon: "🛡️", title: "COD Return Risk Score", body: t.landing.f7Body },
  { icon: "🔀", title: t.landing.f8Title, body: t.landing.f8Body },
  { icon: "📊", title: t.landing.f9Title, body: t.landing.f9Body },
  { icon: "👥", title: "Leads, CRM & Customer 360", body: t.landing.f10Body },
];


const FAQS: { q: string; a: string }[] = [
  { q: t.landing.q1, a: t.landing.a1 },
  { q: t.landing.q2, a: t.landing.a2 },
  { q: t.landing.q3, a: t.landing.a3 },
  { q: t.landing.q4, a: t.landing.a4 },
  { q: t.landing.q5, a: t.landing.a5 },
  { q: t.landing.q6, a: t.landing.a6 },
  { q: t.landing.q7, a: t.landing.a7 },
];

/** Simplified CSS presentation in the style of the real inbox screen. */
function InboxFrame() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center gap-1.5 border-b bg-slate-50 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="ml-2 text-[11px] font-medium text-slate-500">Unified Inbox</span>
      </div>
      <div className="grid grid-cols-[1fr_1.4fr] text-left text-[11px] sm:grid-cols-[1fr_1.6fr_1fr]">
        <div className="space-y-1 border-r p-2">
          {[["🟦", "Rahim Uddin", "দাম কত?"], ["🟩", "Fatima Begum", "অর্ডার করেছি"], ["🟪", "Tanvir Hasan", "ডেলিভারি কবে?"]].map(([i, n, m]) => (
            <div key={n} className="rounded-lg bg-slate-50 p-2">
              <div className="font-semibold text-slate-700">{i} {n}</div>
              <div className="truncate text-slate-400">{m}</div>
            </div>
          ))}
        </div>
        <div className="space-y-2 p-3">
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-slate-700">আসসালামু আলাইকুম, এই শাড়িটার দাম কত?</div>
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-white">ওয়ালাইকুমুস সালাম! এই শাড়িটির দাম ৳১,২৫০। সারাদেশে ক্যাশ অন ডেলিভারি আছে।</div>
          <div className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">{t.landing.inboxAiBadge}</div>
        </div>
        <div className="hidden space-y-1 border-l p-2 sm:block">
          <div className="font-semibold text-slate-600">Customer 360</div>
          <div className="text-slate-500">{tr(publicDicts, "bn", "landing.prevOrders", { count: fmtNumber("bn", 3) })}</div>
          <div className="text-slate-500">{tr(publicDicts, "bn", "landing.deliveredOk", { count: fmtNumber("bn", 3) })}</div>
          <div className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">{t.landing.returnRiskLow}</div>
        </div>
      </div>
    </div>
  );
}

/** Simplified CSS presentation of Omnichannel Competitor Spy screen. */
function CompetitorSpyFrame() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl text-left">
      <div className="flex items-center justify-between border-b bg-slate-900 px-4 py-2.5 text-white">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-xs font-bold">Omnichannel Competitor Spy & Intelligence</span>
        </div>
        <div className="flex gap-1.5 text-[10px] font-semibold">
          <span className="rounded bg-indigo-500/30 px-2 py-0.5">Meta Ads</span>
          <span className="rounded bg-blue-500/30 px-2 py-0.5">Google Ads</span>
          <span className="rounded bg-pink-500/30 px-2 py-0.5">TikTok</span>
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        {/* Card 1: Winning ad */}
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
              {tr(publicDicts, "bn", "landing.winningAdBadge", { days: fmtNumber("bn", 28) })}
            </span>
            <span className="text-[10px] text-slate-500">Facebook • Instagram</span>
          </div>
          <p className="text-xs text-slate-800 line-clamp-2">
            "প্রিমিয়াম পাঞ্জাবি কালেকশন — সীমিত সময়ের জন্য বিশেষ ছাড়! ক্যাশ অন ডেলিভারি সুবিধা।"
          </p>
          <div className="rounded bg-white p-2 border border-amber-200/80 text-[11px] text-slate-700">
            <span className="font-bold text-indigo-700">{t.landing.aiCounterLabel}</span> প্রতিযোগীর অফারে ফ্রি ডেলিভারি নেই। আমাদের ক্যাম্পেইনে ফ্রি হোম ডেলিভারি ও দ্রুত শিপিং অফার দিন।
          </div>
        </div>

        {/* Card 2: Stock-out Opportunity */}
        <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
              🚨 STOCK-OUT OPPORTUNITY
            </span>
            <span className="text-[10px] text-slate-500">{t.landing.liveStockScan}</span>
          </div>
          <p className="text-xs font-semibold text-slate-900">
            প্রতিযোগী "Rival Shop" এর ওয়্যারলেস হেডফোন বর্তমানে <span className="text-rose-600 font-bold">আউট-অব-স্টক!</span>
          </p>
          <div className="rounded bg-white p-2 border border-rose-200/80 text-[11px] text-slate-700">
            {t.landing.aiAdviceLabel}আপনার ইনভেন্টরির হেডফোনে বিজ্ঞাপন বাজেট বাড়িয়ে প্রতিদ্বন্দীর ক্রেতাদের নিজের স্টোরে আনুন।
          </div>
        </div>
      </div>
    </div>
  );
}


function RoiCalculator() {
  const [orders, setOrders] = useState(1000);
  const [returnCost, setReturnCost] = useState(120);
  const [currentPct, setCurrentPct] = useState(20);
  const [targetPct, setTargetPct] = useState(12);
  const result = useMemo(() => {
    const savedReturns = Math.max(0, orders * (currentPct - targetPct) / 100);
    return { savedReturns, saving: savedReturns * returnCost };
  }, [orders, returnCost, currentPct, targetPct]);
  const num = (v: number) => fmtNumber("bn", v);
  const field = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
  return (
    <div className="card mx-auto max-w-3xl p-6 text-left">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">{t.landing.roiOrdersLabel}
          <input type="number" min={0} className={field + " mt-1"} value={orders} onChange={(e) => setOrders(Number(e.target.value) || 0)} /></label>
        <label className="block text-sm font-medium text-slate-700">{t.landing.roiReturnCostLabel}
          <input type="number" min={0} className={field + " mt-1"} value={returnCost} onChange={(e) => setReturnCost(Number(e.target.value) || 0)} /></label>
        <label className="block text-sm font-medium text-slate-700">{t.landing.roiCurrentLabel}
          <input type="number" min={0} max={100} className={field + " mt-1"} value={currentPct} onChange={(e) => setCurrentPct(Number(e.target.value) || 0)} /></label>
        <label className="block text-sm font-medium text-slate-700">{t.landing.roiTargetLabel}
          <input type="number" min={0} max={100} className={field + " mt-1"} value={targetPct} onChange={(e) => setTargetPct(Number(e.target.value) || 0)} /></label>
      </div>
      <div className="mt-5 rounded-2xl bg-indigo-50 p-5">
        <div className="text-sm text-indigo-900">{t.landing.roiSavingTitle}</div>
        <div className="mt-1 text-3xl font-black text-indigo-700">{fmtMoney("bn", Math.round(result.saving))}</div>
        <div className="mt-1 text-sm text-indigo-900">{tr(publicDicts, "bn", "landing.roiSavingLine", { count: num(Math.round(result.savedReturns)) })}</div>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        <b>{t.landing.roiFormulaPrefix}</b>{t.landing.roiFormulaBody}<b>{t.landing.roiEstimateBold}</b>{t.landing.roiFormulaSuffix}
      </p>
    </div>
  );
}

export default function Landing() {
  const router = useRouter();
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [status, setStatus] = useState<SysStatus | null>(null);

  useEffect(() => {
    // Preserve the pre-M58 behaviour for signed-in users: "/" used to
    // redirect straight to /dashboard, and it still does for them.
    if (getToken()) { router.replace("/dashboard"); return; }
    fetch(`${publicApiBase()}/public/pricing`).then((r) => (r.ok ? r.json() : null)).then(setPricing).catch(() => undefined);
    fetch(`${API_URL}/public/system-status`).then((r) => (r.ok ? r.json() : null)).then(setStatus).catch(() => undefined);
  }, [router]);

  const signupClosed = status?.signupOpen === false;
  const RegisterCta = ({ className }: { className: string }) => signupClosed
    ? <span className={className + " cursor-not-allowed opacity-60"} title={t.landing.signupClosedTitle}>{t.landing.signupClosedCta}</span>
    : <a href="/register" className={className}>{t.landing.startFree}</a>;

  return (
    <main className="min-h-screen">
      {status?.maintenanceMode ? (
        <div className="bg-amber-400 px-4 py-2 text-center text-sm font-medium text-amber-950">{t.landing.maintenanceBanner}</div>
      ) : null}
      {status?.announcement ? (
        <div className="bg-indigo-600 px-4 py-2 text-center text-sm text-white">📣 <b>{status.announcement.title}</b> — {status.announcement.body}</div>
      ) : null}

      <header className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-[17px] font-black text-white">Q</span>
        <div>
          <div className="text-[15px] font-bold leading-tight">AI Marketing OS</div>
          <div className="text-[11px] text-slate-500">by Qosprey</div>
        </div>
        <nav className="ml-auto hidden items-center gap-5 text-sm font-medium text-slate-600 md:flex">
          <a href="#features" className="hover:text-indigo-600">{t.landing.navFeatures}</a>
          <a href="#how" className="hover:text-indigo-600">{t.landing.navHow}</a>
          <a href="#pricing" className="hover:text-indigo-600">{t.landing.navPricing}</a>
          <a href="#faq" className="hover:text-indigo-600">{t.landing.navFaq}</a>
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-6">
          <a href="/login" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{t.landing.login}</a>
          <RegisterCta className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500" />
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-8 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-black leading-tight tracking-tight text-slate-900 sm:text-5xl">
          {t.landing.heroTitlePrefix}<span className="bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text text-transparent">{t.landing.heroTitleAccent}</span>{t.landing.heroTitleSuffix}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
          {t.landing.heroBody}
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <RegisterCta className="rounded-2xl bg-indigo-600 px-7 py-3.5 text-base font-bold text-white shadow-lg hover:bg-indigo-500" />
          <a href="#pricing" className="rounded-2xl border border-slate-300 bg-white px-7 py-3.5 text-base font-bold text-slate-700 hover:bg-slate-50">{t.landing.seePricing}</a>
        </div>
        <p className="mt-3 text-xs text-slate-400">{tr(publicDicts, "bn", "landing.trialNote", { days: fmtNumber("bn", pricing?.trialDays ?? 14) })}</p>
        <div className="mx-auto mt-10 max-w-4xl">
          <InboxFrame />
          <p className="mt-2 text-[11px] text-slate-400">{t.landing.inboxCaption}</p>
        </div>
      </section>

      {/* Problem / solution */}
      <section className="border-y bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-14 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{t.landing.problemsTitle}</h2>
            <ul className="mt-4 space-y-3 text-[15px] leading-relaxed text-slate-600">
              <li>{t.landing.problem1}</li>
              <li>{t.landing.problem2}</li>
              <li>{t.landing.problem3}</li>
              <li>{t.landing.problem4}</li>
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{t.landing.solutionTitle}</h2>
            <ul className="mt-4 space-y-3 text-[15px] leading-relaxed text-slate-600">
              <li>{t.landing.solution1}</li>
              <li>{t.landing.solution2}</li>
              <li>{t.landing.solution3}</li>
              <li>{t.landing.solution4}</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Competitor Spy Showcase Section */}
      <section className="bg-slate-50 border-b py-16">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">
            {t.landing.spyBadge}
          </span>
          <h2 className="mt-3 text-3xl font-black text-slate-900 sm:text-4xl">
            {t.landing.spyTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-base text-slate-600">
            {t.landing.spyBody}
          </p>
          <div className="mx-auto mt-8 max-w-4xl">
            <CompetitorSpyFrame />
            <p className="mt-2 text-[11px] text-slate-400">{t.landing.spyCaption}</p>
          </div>
        </div>
      </section>

      {/* Features */}

      <section id="features" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-3xl font-bold text-slate-900">{t.landing.featuresTitle}</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-slate-500">{t.landing.featuresSubtitle}</p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card card-hover p-6">
              <div className="text-3xl">{f.icon}</div>
              <h3 className="mt-3 font-bold text-slate-900">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-center text-3xl font-bold text-slate-900">{t.landing.howTitle}</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              [fmtNumber("bn", 1), t.landing.step1Title, t.landing.step1Body],
              [fmtNumber("bn", 2), t.landing.step2Title, t.landing.step2Body],
              [fmtNumber("bn", 3), t.landing.step3Title, t.landing.step3Body],
            ].map(([n, tt, b]) => (
              <div key={n} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-xl font-black text-white">{n}</div>
                <h3 className="mt-3 font-bold text-slate-900">{tt}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ROI calculator */}
      <section className="mx-auto max-w-6xl px-6 py-16 text-center">
        <h2 className="text-3xl font-bold text-slate-900">{t.landing.roiTitle}</h2>
        <p className="mx-auto mt-2 max-w-xl text-slate-500">{t.landing.roiSubtitle}</p>
        <div className="mt-8"><RoiCalculator /></div>
      </section>

      {/* Pricing — same source as /pricing */}
      <section id="pricing" className="border-y bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-center text-3xl font-bold text-slate-900">{t.landing.pricingTitle}</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-slate-500">{tr(publicDicts, "bn", "landing.pricingSubtitlePrefix", { days: fmtNumber("bn", pricing?.trialDays ?? 14) })}<a className="text-indigo-600 underline" href="/pricing">{t.landing.pricingPageLink}</a>{t.landing.pricingSubtitleSuffix}</p>
          {!pricing ? <p className="mt-10 text-center text-slate-400">{t.landing.pricingLoading}</p> : (
            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {pricing.plans.map((p) => (
                <div key={p.tier} className="rounded-3xl border bg-white p-6 shadow-sm">
                  <div className="text-sm font-semibold uppercase tracking-wide text-indigo-600">{TIER_BN[p.tier] ?? p.tier}</div>
                  <div className="mt-3 text-3xl font-bold">
                    {fmtMoneyMinor("bn", p.priceMinor)}
                    <span className="text-sm font-normal text-slate-400">{t.landing.perMonth}</span>
                  </div>
                  <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
                    <li>{tr(publicDicts, "bn", "landing.seats", { count: fmtNumber("bn", p.limits.seats) })}</li>
                    <li>{tr(publicDicts, "bn", "landing.aiDaily", { count: fmtNumber("bn", p.limits.aiDaily) })}</li>
                    <li>{tr(publicDicts, "bn", "landing.broadcastCap", { count: fmtNumber("bn", p.limits.broadcastCap) })}</li>
                  </ul>
                  <RegisterCta className="mt-5 block rounded-xl bg-indigo-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-indigo-500" />
                </div>
              ))}
            </div>
          )}
          {signupClosed ? <p className="mt-6 text-center text-sm font-medium text-amber-700">{t.landing.signupClosedNote}</p> : null}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-6 py-16">
        <h2 className="text-center text-3xl font-bold text-slate-900">{t.landing.faqTitle}</h2>
        <div className="mt-8 space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="card group p-5">
              <summary className="cursor-pointer font-semibold text-slate-900">{f.q}</summary>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center text-white">
          <h2 className="text-3xl font-black">{t.landing.ctaTitle}</h2>
          <p className="mx-auto mt-3 max-w-xl text-indigo-100">{tr(publicDicts, "bn", "landing.ctaBody", { days: fmtNumber("bn", pricing?.trialDays ?? 14) })}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <RegisterCta className="rounded-2xl bg-white px-7 py-3.5 text-base font-bold text-indigo-700 shadow-lg hover:bg-indigo-50" />
            <a href="/login" className="rounded-2xl border border-white/50 px-7 py-3.5 text-base font-bold text-white hover:bg-white/10">{t.landing.ctaLogin}</a>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-8 text-sm text-slate-400">
        <span>© {fmtNumber("bn", new Date().getFullYear())} Qosprey — AI Marketing OS</span>
        <span className="ml-auto flex gap-4">
          <a className="hover:text-indigo-600" href="/pricing">{t.landing.footerPricing}</a>
          <a className="hover:text-indigo-600" href="/login">{t.landing.footerLogin}</a>
          <a className="hover:text-indigo-600" href="/register">{t.landing.footerRegister}</a>
        </span>

      </footer>
    </main>
  );
}
