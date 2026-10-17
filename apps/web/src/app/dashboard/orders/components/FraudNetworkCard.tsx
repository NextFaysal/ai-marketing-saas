"use client";
import React from "react";
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
          ? "ফ্রড নেটওয়ার্ক চালু হয়েছে — এখন থেকে চূড়ান্ত অর্ডারের ফলাফল সম্মিলিত হিসাবে যোগ হবে।"
          : "ফ্রড নেটওয়ার্ক বন্ধ হয়েছে — এখন থেকে আর কোনো নতুন অবদান যাবে না।",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "পরিবর্তন ব্যর্থ হয়েছে");
    } finally {
      setBusy(false);
    }
  }

  const unavailable = settings !== null && settings.available !== true;

  return (
    <div className="mt-6 space-y-3 border-t pt-4">
      <h3 className="font-semibold">🌐 ফ্রড নেটওয়ার্ক (সব দোকানের সম্মিলিত তথ্য)</h3>
      <div className="space-y-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-700">
        <p>{FRAUD_NETWORK_SHARED_BN}</p>
        <p>চালু করা প্রতিটি দোকানের নিজের সিদ্ধান্ত — শুধুমাত্র দোকানের মালিক (OWNER) চালু বা বন্ধ করতে পারেন।</p>
        <p>বন্ধ করলে ভবিষ্যতের অবদান সঙ্গে সঙ্গে থেমে যাবে।</p>
        <p className="font-medium text-amber-800">{FRAUD_NETWORK_PAST_BN}</p>
      </div>
      {loadFailed ? (
        <p className="text-sm text-slate-400">নেটওয়ার্ক সেটিংস লোড হয়নি — আবার খুলে চেষ্টা করুন।</p>
      ) : !settings ? (
        <p className="text-sm text-slate-400">লোড হচ্ছে…</p>
      ) : unavailable ? (
        <>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{FRAUD_NETWORK_UNAVAILABLE_BN}</p>
          <label className="flex items-center gap-2 text-sm font-medium opacity-50">
            <input type="checkbox" checked={false} disabled readOnly />
            ফ্রড নেটওয়ার্কে যোগ দিন
          </label>
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
            ফ্রড নেটওয়ার্কে যোগ দিন (শুধু OWNER)
          </label>
          {settings.enabled && settings.enabledAt ? (
            <p className="text-xs text-slate-500">
              চালু আছে — চালু হয়েছে: {new Date(settings.enabledAt).toLocaleString("bn-BD")}। শুধু এর পরের তৈরি অর্ডারের ফলাফলই যোগ হয় — আগের অর্ডার কখনো যোগ হয় না।
            </p>
          ) : (
            <p className="text-xs text-slate-500">বন্ধ আছে — এই দোকান থেকে নেটওয়ার্কে কিছুই যাচ্ছে না, নেটওয়ার্কের তথ্যও দেখা যাচ্ছে না।</p>
          )}
        </>
      )}
      {notice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
