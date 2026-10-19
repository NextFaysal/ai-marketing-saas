"use client";

import React, { useEffect, useState } from "react";
import { publicApiBase } from "@/lib/api";
import { fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { pubT, publicDicts, pubLocaleOf } from "@/lib/i18n/public";
import { tr } from "@/lib/i18n/lookup";

const LOCALE = pubLocaleOf();
const t = pubT(LOCALE);

interface Plan { tier: string; priceMinor: number; limits: { aiDaily: number; broadcastCap: number; seats: number } }
interface Pricing { currency: string; trialDays: number; plans: Plan[] }

const TIER_LABEL: Record<string, string> = { FREE: t.pricing.tierFREE, STARTER: t.pricing.tierSTARTER, GROWTH: t.pricing.tierGROWTH, AGENCY: t.pricing.tierAGENCY };

/** Public pricing — rendered from the operator's live settings. */
export default function PricingPage() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  useEffect(() => {
    fetch(`${publicApiBase()}/public/pricing`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setPricing(j))
      .catch(() => setPricing(null));
  }, []);
  return (
    <main className="mx-auto max-w-6xl px-6 py-14">
      <div className="text-center">
        <h1 className="text-3xl font-bold">{t.pricing.title}</h1>
        <p className="mt-2 text-slate-500">{tr(publicDicts, LOCALE, "pricing.subtitle", { days: fmtNumber(LOCALE, pricing?.trialDays ?? 14) })}</p>
      </div>
      {!pricing ? <p className="mt-10 text-center text-slate-400">{t.pricing.loading}</p> : (
        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {pricing.plans.map((p) => (
            <div key={p.tier} className="rounded-3xl border bg-white p-6 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-wide text-indigo-600">{TIER_LABEL[p.tier] ?? p.tier}</div>
              <div className="mt-3 text-3xl font-bold">
                {fmtMoneyMinor(LOCALE, p.priceMinor)}
                <span className="text-sm font-normal text-slate-400">{t.pricing.perMonth}</span>
              </div>
              <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
                <li>{tr(publicDicts, LOCALE, "pricing.seats", { count: fmtNumber(LOCALE, p.limits.seats) })}</li>
                <li>{tr(publicDicts, LOCALE, "pricing.aiDaily", { count: fmtNumber(LOCALE, p.limits.aiDaily) })}</li>
                <li>{tr(publicDicts, LOCALE, "pricing.broadcastCap", { count: fmtNumber(LOCALE, p.limits.broadcastCap) })}</li>
              </ul>
              <a href="/register" className="mt-5 block rounded-xl bg-indigo-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-indigo-500">{t.pricing.startButton}</a>
            </div>
          ))}
        </div>
      )}
      <p className="mt-8 text-center text-sm text-slate-400">{t.pricing.haveAccount}<a className="text-indigo-600 underline" href="/login">{t.pricing.loginLink}</a></p>

    </main>
  );
}
