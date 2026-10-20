"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtNumber, fmtMoney } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
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
  const { dict, t, locale } = useLocale();
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
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.loadingFailed); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const parseRequiredInt = (raw: string, label: string, min: number): number | null => {
      const n = Number(raw);
      if (!raw.trim() || !Number.isInteger(n) || n < min) { setError(t("commerce.giveAsAWholeNumber", { label: label, min: min })); return null; }
      return n;
    };
    const earn = parseRequiredInt(earnPoints, dict.commerce.pointsPer10, 0); if (earn === null) return;
    const redeem = parseRequiredInt(redeemPaisa, dict.commerce.valuePerPointPoisha, 1); if (redeem === null) return;
    const minRedeem = parseRequiredInt(minRedeemPoints, dict.commerce.minimumRedeemPoints, 0); if (minRedeem === null) return;
    let maxShare: number | null = null;
    if (maxRedeemSharePct.trim()) {
      const n = Number(maxRedeemSharePct);
      if (!Number.isInteger(n) || n < 1 || n > 100) { setError(dict.commerce.giveTheMaximumRedeemShare); return; }
      maxShare = n;
    }
    let expiry: number | null = null;
    if (pointsExpiryDays.trim()) {
      const n = Number(pointsExpiryDays);
      if (!Number.isInteger(n) || n < 1) { setError(dict.commerce.givePointValidityAsA); return; }
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
      setNotice(dict.commerce.loyaltySettingsSaved);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.saveFailed); }
    finally { setBusy(false); }
  }

  // Helper line under the paisa field: what the current rate
  // means in taka, so staff never have to do paisa maths.
  const redeemPaisaNum = Number(redeemPaisa);
  const redeemHelper = Number.isInteger(redeemPaisaNum) && redeemPaisaNum > 0
    ? t("commerce.currentRate1PointDiscount", { p0: fmtMoney(locale, (redeemPaisaNum / 100), { maximumFractionDigits: 2 }) })
    : dict.commerce.writeInPoishaEG;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{dict.commerce.loyaltyLoyaltyPointsReferralRewards}</h1>
          <p className="text-sm text-slate-500">
            {dict.commerce.setTheRulesForEarning}</p>
        </div>
        <Link href="/dashboard/commerce/storefront" className="btn-primary">{dict.commerce.storefrontShop}</Link>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <div className="font-semibold">{dict.commerce.loyaltyPoints}</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {dict.commerce.pointsAreEarnedOnThe}</p>
        </div>
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {dict.commerce.enableTheLoyaltyProgram}</label>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">{dict.commerce.pointsPer10OfShopping}<input className="input mt-1" type="number" min="0" value={earnPoints} onChange={(e) => setEarnPoints(e.target.value)} disabled={!enabled} />
            <span className="mt-1 block text-xs font-normal text-slate-400">{dict.commerce.earningBasisOrderTotalShipping}</span>
          </label>
          <label className="block text-sm">{dict.commerce.valuePerPointPoisha}<input className="input mt-1" type="number" min="1" value={redeemPaisa} onChange={(e) => setRedeemPaisa(e.target.value)} disabled={!enabled} />
            <span className="mt-1 block text-xs font-normal text-slate-400">{redeemHelper}</span>
          </label>
          <label className="block text-sm">{dict.commerce.minimumRedeemPoints}<input className="input mt-1" type="number" min="0" value={minRedeemPoints} onChange={(e) => setMinRedeemPoints(e.target.value)} disabled={!enabled} />
            <span className="mt-1 block text-xs font-normal text-slate-400">{dict.commerce.pointsCannotBeSpentBelow}</span>
          </label>
          <label className="block text-sm">{dict.commerce.maximumRedeemShareEmptyNo}<input className="input mt-1" type="number" min="1" max="100" value={maxRedeemSharePct} onChange={(e) => setMaxRedeemSharePct(e.target.value)} placeholder={dict.commerce.emptyNoLimit} disabled={!enabled} />
            <span className="mt-1 block text-xs font-normal text-slate-400">{dict.commerce.whatPercentageOfOneOrder}</span>
          </label>
          <label className="block text-sm">{dict.commerce.pointValidityDaysEmptyNo}<input className="input mt-1" type="number" min="1" value={pointsExpiryDays} onChange={(e) => setPointsExpiryDays(e.target.value)} placeholder={dict.commerce.emptyNeverExpires} disabled={!enabled} />
            <span className="mt-1 block text-xs font-normal text-slate-400">{dict.commerce.validityAppliesSeparatelyToEach}</span>
          </label>
        </div>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? dict.commerce.saving2 : dict.commerce.saveLoyaltySettings}
        </button>
      </div>

      {/* AB1 (AX2): referral reward — the SAME shared card the
          storefront settings page renders. */}
      <ReferralRewardSettingsCard />
    </div>
  );
}
