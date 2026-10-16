"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { ReferralRewardSettingsCard } from "@/components/loyalty-referral-settings";
import type { LoyaltySetting } from "@/lib/loyalty";

// AB1 (AX1) — loyalty points program settings. The earn basis and
// reversal rules written under the form are the API's real rules
// (loyalty.service.ts), stated plainly so staff are never
// surprised: earn on (order total − shipping − gift wrap),
// redemption is a checkout discount (never cash), refunds claw
// points back proportionally and the balance may go negative
// (which blocks redemption until earned back), and expiry is per
// earn batch. Money fields: earnPointsPer1000Minor is points per
// ৳10 of the basis (1000 paisa); redeemValueMinorPerPoint is
// PAISA per point.

export default function LoyaltyPage() {
  const [enabled, setEnabled] = useState(false);
  const [earnPoints, setEarnPoints] = useState("1");
  const [redeemPaisa, setRedeemPaisa] = useState("100");
  const [minRedeemPoints, setMinRedeemPoints] = useState("0");
  const [maxRedeemSharePct, setMaxRedeemSharePct] = useState("");
  const [pointsExpiryDays, setPointsExpiryDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const out = await apiFetch<{ setting: LoyaltySetting }>(
        `/organizations/${orgId}/commerce/loyalty/settings`,
      );
      const s = out.setting;
      setEnabled(!!s.enabled);
      setEarnPoints(String(s.earnPointsPer1000Minor ?? 1));
      setRedeemPaisa(String(s.redeemValueMinorPerPoint ?? 100));
      setMinRedeemPoints(String(s.minRedeemPoints ?? 0));
      setMaxRedeemSharePct(s.maxRedeemSharePct != null ? String(s.maxRedeemSharePct) : "");
      setPointsExpiryDays(s.pointsExpiryDays != null ? String(s.pointsExpiryDays) : "");
    } catch (e) { setError(e instanceof Error ? e.message : "লোড ব্যর্থ"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const parseRequiredInt = (raw: string, label: string, min: number): number | null => {
      const n = Number(raw);
      if (!raw.trim() || !Number.isInteger(n) || n < min) { setError(`${label} পূর্ণ সংখ্যায় দিন (কমপক্ষে ${min})।`); return null; }
      return n;
    };
    const earn = parseRequiredInt(earnPoints, "প্রতি ৳১০-এ পয়েন্ট", 0); if (earn === null) return;
    const redeem = parseRequiredInt(redeemPaisa, "প্রতি পয়েন্টের মূল্য (পয়সা)", 1); if (redeem === null) return;
    const minRedeem = parseRequiredInt(minRedeemPoints, "সর্বনিম্ন রিডিম পয়েন্ট", 0); if (minRedeem === null) return;
    let maxShare: number | null = null;
    if (maxRedeemSharePct.trim()) {
      const n = Number(maxRedeemSharePct);
      if (!Number.isInteger(n) || n < 1 || n > 100) { setError("সর্বোচ্চ রিডিম শেয়ার ১–১০০% এর মধ্যে দিন, অথবা খালি রাখুন (কোনো সীমা নেই)।"); return; }
      maxShare = n;
    }
    let expiry: number | null = null;
    if (pointsExpiryDays.trim()) {
      const n = Number(pointsExpiryDays);
      if (!Number.isInteger(n) || n < 1) { setError("পয়েন্টের মেয়াদ দিনে পূর্ণ সংখ্যায় দিন (কমপক্ষে ১), অথবা খালি রাখুন (মেয়াদ নেই)।"); return; }
      expiry = n;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch<{ setting: LoyaltySetting }>(
        `/organizations/${orgId}/commerce/loyalty/settings`,
        {
          method: "PUT",
          body: JSON.stringify({
            enabled,
            earnPointsPer1000Minor: earn,
            redeemValueMinorPerPoint: redeem,
            minRedeemPoints: minRedeem,
            maxRedeemSharePct: maxShare,
            pointsExpiryDays: expiry,
          }),
        },
      );
      setNotice("লয়্যালটি সেটিংস সংরক্ষণ হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(false); }
  }

  // Helper line under the paisa field: what the current rate
  // means in taka, so staff never have to do paisa maths.
  const redeemPaisaNum = Number(redeemPaisa);
  const redeemHelper = Number.isInteger(redeemPaisaNum) && redeemPaisaNum > 0
    ? `বর্তমান হার: ১ পয়েন্ট = ৳${(redeemPaisaNum / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} ছাড়`
    : "পয়সায় লিখুন — যেমন: ১০০ পয়সা = ৳১ ছাড় প্রতি পয়েন্ট";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Loyalty — লয়্যালটি পয়েন্ট ও রেফারেল পুরস্কার</h1>
          <p className="text-sm text-slate-500">
            কেনাকাটায় পয়েন্ট জমা ও চেকআউটে ছাড় হিসেবে পয়েন্ট খরচের নিয়ম এখানে ঠিক করুন।
            প্রতি গ্রাহকের ব্যালেন্স ও লেজার Customers পেজের বিবরণে, আর প্রতি অর্ডারের পয়েন্টের
            হিসাব অর্ডারের বিবরণে দেখা যায়।
          </p>
        </div>
        <Link href="/dashboard/commerce/storefront" className="btn-primary">Storefront / দোকান →</Link>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <div className="font-semibold">⭐ লয়্যালটি পয়েন্ট</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            পয়েন্ট অর্জিত হয় অর্ডারের (মোট − শিপিং − গিফট র‍্যাপ) অংশের উপর। পয়েন্ট খরচ মানে
            চেকআউটে ছাড় — পয়েন্ট কখনো নগদ টাকা হিসেবে দেওয়া হয় না। রিফান্ড হলে অর্জিত পয়েন্ট
            আনুপাতিক হারে কেটে নেওয়া হয়; এতে ব্যালেন্স ঋণাত্মকও হতে পারে — ঋণাত্মক থাকা অবস্থায়
            নতুন করে পয়েন্ট অর্জন করে শোধ না করা পর্যন্ত পয়েন্ট খরচ করা যাবে না। মেয়াদ থাকলে তা
            প্রতিটি অর্জনের ব্যাচ অনুযায়ী আলাদাভাবে গণনা হয়।
          </p>
        </div>
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          লয়্যালটি প্রোগ্রাম চালু করুন
        </label>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">প্রতি ৳১০ কেনাকাটায় পয়েন্ট
            <input className="input mt-1" type="number" min="0" value={earnPoints} onChange={(e) => setEarnPoints(e.target.value)} disabled={!enabled} />
            <span className="mt-1 block text-xs font-normal text-slate-400">অর্জনের ভিত্তি: অর্ডারের মোট − শিপিং − গিফট র‍্যাপ।</span>
          </label>
          <label className="block text-sm">প্রতি পয়েন্টের মূল্য (পয়সা)
            <input className="input mt-1" type="number" min="1" value={redeemPaisa} onChange={(e) => setRedeemPaisa(e.target.value)} disabled={!enabled} />
            <span className="mt-1 block text-xs font-normal text-slate-400">{redeemHelper}</span>
          </label>
          <label className="block text-sm">সর্বনিম্ন রিডিম পয়েন্ট
            <input className="input mt-1" type="number" min="0" value={minRedeemPoints} onChange={(e) => setMinRedeemPoints(e.target.value)} disabled={!enabled} />
            <span className="mt-1 block text-xs font-normal text-slate-400">এর কম ব্যালেন্সে পয়েন্ট খরচ শুরু করা যাবে না।</span>
          </label>
          <label className="block text-sm">সর্বোচ্চ রিডিম শেয়ার (%) — খালি = কোনো সীমা নেই
            <input className="input mt-1" type="number" min="1" max="100" value={maxRedeemSharePct} onChange={(e) => setMaxRedeemSharePct(e.target.value)} placeholder="খালি = সীমা নেই" disabled={!enabled} />
            <span className="mt-1 block text-xs font-normal text-slate-400">এক অর্ডারে মোটের সর্বোচ্চ কত শতাংশ পয়েন্ট দিয়ে দেওয়া যাবে।</span>
          </label>
          <label className="block text-sm">পয়েন্টের মেয়াদ (দিন) — খালি = মেয়াদ নেই
            <input className="input mt-1" type="number" min="1" value={pointsExpiryDays} onChange={(e) => setPointsExpiryDays(e.target.value)} placeholder="খালি = কখনো মেয়াদ শেষ নয়" disabled={!enabled} />
            <span className="mt-1 block text-xs font-normal text-slate-400">মেয়াদ প্রতিটি অর্জন ব্যাচের জন্য আলাদাভাবে প্রযোজ্য।</span>
          </label>
        </div>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? "সেভ হচ্ছে…" : "লয়্যালটি সেটিংস সেভ করুন"}
        </button>
      </div>

      {/* AB1 (AX2): referral reward — the SAME shared card the
          storefront settings page renders. */}
      <ReferralRewardSettingsCard />
    </div>
  );
}
