"use client";

import React, { useEffect, useState } from "react";
import { publicApiBase } from "@/lib/api";

interface Plan { tier: string; priceMinor: number; limits: { aiDaily: number; broadcastCap: number; seats: number } }
interface Pricing { currency: string; trialDays: number; plans: Plan[] }

const TIER_BN: Record<string, string> = { FREE: "ফ্রি", STARTER: "স্টার্টার", GROWTH: "গ্রোথ", AGENCY: "এজেন্সি" };

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
        <h1 className="text-3xl font-bold">সহজ ও স্বচ্ছ মূল্য</h1>
        <p className="mt-2 text-slate-500">সব প্ল্যানে {pricing?.trialDays ?? 14} দিনের ট্রায়াল। লুকানো কোনো চার্জ নেই — মূল্য নির্ধারণ করেন প্ল্যাটফর্ম অপারেটর, এই পেজে সরাসরি সেটাই দেখানো হচ্ছে।</p>
      </div>
      {!pricing ? <p className="mt-10 text-center text-slate-400">মূল্য লোড হচ্ছে…</p> : (
        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {pricing.plans.map((p) => (
            <div key={p.tier} className="rounded-3xl border bg-white p-6 shadow-sm">
              <div className="text-sm font-semibold uppercase tracking-wide text-indigo-600">{TIER_BN[p.tier] ?? p.tier}</div>
              <div className="mt-3 text-3xl font-bold">
                {p.priceMinor === 0 ? "৳০" : `৳${(p.priceMinor / 100).toLocaleString("bn-BD")}`}
                <span className="text-sm font-normal text-slate-400"> /মাস</span>
              </div>
              <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
                <li>👥 {p.limits.seats} জন টিম মেম্বার</li>
                <li>🤖 প্রতিদিন {p.limits.aiDaily} টি AI মেসেজ</li>
                <li>📣 ব্রডকাস্ট সীমা {p.limits.broadcastCap.toLocaleString()} জন</li>
              </ul>
              <a href="/register" className="mt-5 block rounded-xl bg-indigo-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-indigo-500">শুরু করুন</a>
            </div>
          ))}
        </div>
      )}
      <p className="mt-8 text-center text-sm text-slate-400">ইতিমধ্যে অ্যাকাউন্ট আছে? <a className="text-indigo-600 underline" href="/login">লগইন করুন</a></p>
    </main>
  );
}
