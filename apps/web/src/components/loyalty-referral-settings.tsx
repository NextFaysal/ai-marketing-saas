"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { minorToTakaString, takaToMinorString } from "@/lib/storefront-money";
import type { ReferralRewardSetting } from "@/lib/loyalty";
import { useLocale } from "@/lib/i18n/provider";

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
  const { dict } = useLocale();
  const S = dict.shared;
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
      if (!Number.isInteger(n) || n < 1) { setError(S.zzLrsPointsError); return; }
      rewardPointsValue = n;
    }
    let couponPercentValue: number | null = null;
    if (couponPercent.trim()) {
      const n = Number(couponPercent);
      if (!Number.isInteger(n) || n < 1 || n > 90) { setError(S.zzLrsCouponError); return; }
      couponPercentValue = n;
    }
    let rewardMinOrderMinor: string | null = null;
    if (minOrderTaka.trim()) {
      rewardMinOrderMinor = takaToMinorString(minOrderTaka);
      if (rewardMinOrderMinor === null) { setError(S.zzLrsMinOrderError); return; }
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
      setNotice(S.zzLrsSaved);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : S.zzLrsSaveFailed); }
    finally { setBusy(false); }
  }

  return (
    <div className="card space-y-4 p-5">
      <div>
        <div className="font-semibold">{S.zzLrsTitle}</div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          {S.zzLrsIntro}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          {S.zzLrsNote}
        </p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {S.zzLrsEnable}
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm">{S.zzLrsRewardType}
          <select className="input mt-1" value={rewardType} onChange={(e) => setRewardType(e.target.value as "points" | "coupon")} disabled={!enabled}>
            <option value="points">{S.zzLrsTypePoints}</option>
            <option value="coupon">{S.zzLrsTypeCoupon}</option>
          </select>
        </label>
        <label className="block text-sm">{S.zzLrsFieldMinOrder}
          <input className="input mt-1" inputMode="decimal" value={minOrderTaka} onChange={(e) => setMinOrderTaka(e.target.value)} placeholder={S.zzLrsPlaceholder500} disabled={!enabled} />
        </label>
        <label className="block text-sm">{S.zzLrsFieldPoints}
          <input className="input mt-1" type="number" min="1" value={rewardPoints} onChange={(e) => setRewardPoints(e.target.value)} placeholder={S.zzLrsPlaceholder100} disabled={!enabled || rewardType !== "points"} />
        </label>
        <label className="block text-sm">{S.zzLrsFieldCoupon}
          <input className="input mt-1" type="number" min="1" max="90" value={couponPercent} onChange={(e) => setCouponPercent(e.target.value)} placeholder={S.zzLrsPlaceholder10} disabled={!enabled || rewardType !== "coupon"} />
        </label>
      </div>
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
        {busy ? S.zzLrsSaving : S.zzLrsSaveBtn}
      </button>
    </div>
  );
}
