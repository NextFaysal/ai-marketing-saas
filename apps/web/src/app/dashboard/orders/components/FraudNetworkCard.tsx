"use client";
import React from "react";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  FRAUD_NETWORK_PAST_BN,
  FRAUD_NETWORK_SHARED_BN,
  FRAUD_NETWORK_UNAVAILABLE_BN,
  fraudNetworkToggleDisabled,
  type FraudNetworkSettingsView,
} from "@/lib/fraud-network-nf13";

/**
 * NF13 (FB5) — Fraud Network card inside the Fraud Shield
 * settings panel. Self-contained (loads + saves its own
 * settings) so the panel needs no new prop plumbing.
 *
 * The explainer renders BEFORE the toggle can be used, in
 * plain Bengali: what is shared (counts only, phone as hash,
 * nothing else), that enabling is per-org and OWNER-only,
 * that disabling stops future contributions immediately, and
 * — honestly — that past contributions already merged into
 * the aggregates cannot be removed. When the API says
 * available:false the card says the feature is not live on
 * the server and the toggle is disabled. The toggle PATCH is
 * OWNER-only on the server; a non-owner attempt surfaces the
 * API's refusal verbatim.
 */
export function FraudNetworkCard() {
  const { dict, t, locale } = useLocale();
  const [settings, setSettings] = React.useState<FraudNetworkSettingsView | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  const load = React.useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const s = await apiFetch<FraudNetworkSettingsView>(
        `/organizations/${orgId}/fraud-network`,
      );
      setSettings(s);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function toggle(enabled: boolean) {
    const orgId = getOrganizationId();
    if (!orgId || !settings) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await apiFetch<FraudNetworkSettingsView>(
        `/organizations/${orgId}/fraud-network`,
        { method: "PATCH", body: JSON.stringify({ enabled }) },
      );
      setSettings(updated);
      setNotice(
        enabled
          ? dict.orders.fraudNetworkIsOnFrom
          : dict.orders.fraudNetworkIsOffNo,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.orders.changeFailed);
    } finally {
      setBusy(false);
    }
  }

  const unavailable = settings !== null && settings.available !== true;

  return (
    <div className="mt-6 space-y-3 border-t pt-4">
      <h3 className="font-semibold">{dict.orders.fraudNetworkCombinedDataFrom}</h3>
      <div className="space-y-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-700">
        <p>{FRAUD_NETWORK_SHARED_BN}</p>
        <p>{dict.orders.turningItOnIsEach}</p>
        <p>{dict.orders.turningItOffStopsFuture}</p>
        <p className="font-medium text-amber-800">{FRAUD_NETWORK_PAST_BN}</p>
      </div>
      {loadFailed ? (
        <p className="text-sm text-slate-400">{dict.orders.networkSettingsDidNotLoad}</p>
      ) : !settings ? (
        <p className="text-sm text-slate-400">{dict.common.loading}</p>
      ) : unavailable ? (
        <>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{FRAUD_NETWORK_UNAVAILABLE_BN}</p>
          <label className="flex items-center gap-2 text-sm font-medium opacity-50">
            <input type="checkbox" checked={false} disabled readOnly />
            {dict.orders.joinTheFraudNetwork}</label>
        </>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={busy || fraudNetworkToggleDisabled(settings)}
              onChange={(e) => void toggle(e.target.checked)}
            />
            {dict.orders.joinTheFraudNetworkOWNER}</label>
          {settings.enabled && settings.enabledAt ? (
            <p className="text-xs text-slate-500">
              {dict.orders.onTurnedOn}{fmtDateTime(locale, new Date(settings.enabledAt))}{dict.orders.onlyOutcomesOfOrdersCreated}</p>
          ) : (
            <p className="text-xs text-slate-500">{dict.orders.offNothingGoesToThe}</p>
          )}
        </>
      )}
      {notice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
