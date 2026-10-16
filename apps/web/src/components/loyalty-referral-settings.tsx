"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { minorToTakaString, takaToMinorString } from "@/lib/storefront-money";
import type { ReferralRewardSetting } from "@/lib/loyalty";

// AB1 (AX2) — referral REWARD settings card, shared by the
// loyalty page (dashboard/commerce/loyalty) and the storefront
// settings page (beside the buyer-side referral % discount, which
// is a different setting: that one discounts the referred buyer's
// first order; this one rewards the REFERRER after that order).
// Own GET/PUT endpoints:
//   organizations/:id/commerce/loyalty/referral-settings
// rewardMinOrderMinor travels as a paisa string; the form edits
// taka and converts with the storefront-money helpers (×100).

export function ReferralRewardSettingsCard() {
  const [enabled, setEnabled] = useState(false);
  const [rewardType, setRewardType] = useState<"points" | "coupon">("points");
  const [rewardPoints, setRewardPoints] = useState("");
  const [couponPercent, setCouponPercent] = useState("");
  const [minOrderTaka, setMinOrderTaka] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const out = await apiFetch<{ setting: ReferralRewardSetting }>(
        `/organizations/${orgId}/commerce/loyalty/referral-settings`,
      );
      const s = out.setting;
      setEnabled(!!s.enabled);
      setRewardType(s.rewardType === "coupon" ? "coupon" : "points");
      setRewardPoints(s.rewardPoints != null ? String(s.rewardPoints) : "");
      setCouponPercent(s.couponPercent != null ? String(s.couponPercent) : "");
      setMinOrderTaka(minorToTakaString(s.rewardMinOrderMinor));
    } catch { /* card keeps defaults until the endpoint answers */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    // Client-side shape checks; enabling rules (chosen type must
    // carry an amount) are enforced by the server and its reply
    // is shown verbatim.
    let rewardPointsValue: number | null = null;
    if (rewardPoints.trim()) {
      const n = Number(rewardPoints);
      if (!Number.isInteger(n) || n < 1) { setError("পুরস্কারের পয়েন্ট পূর্ণ সংখ্যায় দিন (কমপক্ষে ১), অথবা খালি রাখুন।"); return; }
      rewardPointsValue = n;
    }
    let couponPercentValue: number | null = null;
    if (couponPercent.trim()) {
      const n = Number(couponPercent);
      if (!Number.isInteger(n) || n < 1 || n > 90) { setError("কুপনের ছাড় ১–৯০% এর মধ্যে পূর্ণ সংখ্যায় দিন, অথবা খালি রাখুন।"); return; }
      couponPercentValue = n;
    }
    let rewardMinOrderMinor: string | null = null;
    if (minOrderTaka.trim()) {
      rewardMinOrderMinor = takaToMinorString(minOrderTaka);
      if (rewardMinOrderMinor === null) { setError("সর্বনিম্ন অর্ডার মূল্য টাকায় সঠিক সংখ্যা দিন (যেমন: ৫০০), অথবা খালি রাখুন।"); return; }
    }
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch<{ setting: ReferralRewardSetting }>(
        `/organizations/${orgId}/commerce/loyalty/referral-settings`,
        {
          method: "PUT",
          body: JSON.stringify({
            enabled,
            rewardType,
            rewardPoints: rewardPointsValue,
            couponPercent: couponPercentValue,
            rewardMinOrderMinor,
          }),
        },
      );
      setNotice("রেফারেল পুরস্কারের সেটিংস সংরক্ষণ হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(false); }
  }

  return (
    <div className="card space-y-4 p-5">
      <div>
        <div className="font-semibold">🎁 রেফারেল পুরস্কার</div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          রেফারেল কোডে আসা বন্ধুর অর্ডার সম্পন্ন হলে যিনি রেফার করেছেন তিনি এই পুরস্কার পাবেন —
          পয়েন্ট অথবা একটি কুপন। এটি ক্রেতার রেফারেল ছাড়ের থেকে আলাদা সেটিং।
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          পয়েন্ট পুরস্কারের জন্য লয়্যালটি প্রোগ্রাম চালু থাকা জরুরি; কুপন পুরস্কার লয়্যালটি
          ছাড়াই স্বাধীনভাবে কাজ করে। রেফার করা অর্ডারটি কুপন ব্যবহারের আগেই সম্পূর্ণ রিফান্ড
          হয়ে গেলে পুরস্কার কুপনটি বাতিল হয়ে যাবে।
        </p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        রেফারেল পুরস্কার চালু করুন
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm">পুরস্কারের ধরন
          <select className="input mt-1" value={rewardType} onChange={(e) => setRewardType(e.target.value as "points" | "coupon")} disabled={!enabled}>
            <option value="points">লয়্যালটি পয়েন্ট</option>
            <option value="coupon">কুপন</option>
          </select>
        </label>
        <label className="block text-sm">সর্বনিম্ন অর্ডার মূল্য (টাকা, খালি = নেই)
          <input className="input mt-1" inputMode="decimal" value={minOrderTaka} onChange={(e) => setMinOrderTaka(e.target.value)} placeholder="যেমন: ৫০০" disabled={!enabled} />
        </label>
        <label className="block text-sm">পুরস্কারের পয়েন্ট (পয়েন্ট ধরনে)
          <input className="input mt-1" type="number" min="1" value={rewardPoints} onChange={(e) => setRewardPoints(e.target.value)} placeholder="যেমন: ১০০" disabled={!enabled || rewardType !== "points"} />
        </label>
        <label className="block text-sm">কুপনের ছাড় (%) — ১–৯০ (কুপন ধরনে)
          <input className="input mt-1" type="number" min="1" max="90" value={couponPercent} onChange={(e) => setCouponPercent(e.target.value)} placeholder="যেমন: ১০" disabled={!enabled || rewardType !== "coupon"} />
        </label>
      </div>
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
        {busy ? "সেভ হচ্ছে…" : "রেফারেল পুরস্কার সেভ করুন"}
      </button>
    </div>
  );
}
