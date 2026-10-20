"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  formatTakaMinor, payoutStatusLabel,
  type PayoutDestinationView, type PayoutRequestView, type PayoutScheduleView,
} from "@/lib/connections";
import { useLocale } from "@/lib/i18n/provider";
import type { connectionsBn } from "@/lib/i18n/connections";

/**
 * CC26(a) — পেমেন্ট ডেস্টিনেশন ও স্বয়ংক্রিয় payout শিডিউল।
 *
 * ডেস্টিনেশনের নম্বর টেন্যান্টের নিজের business তথ্য — তালিকায়
 * শেষ ৪ অঙ্ক ছাড়া দেখানো হয় না (masking সার্ভারেই হয়)।
 * শিডিউল চালু থাকলে নির্দিষ্ট দিনে Wallet-এর উপলব্ধ ব্যালান্স
 * threshold ছাড়ালেই সিস্টেম একটি PENDING payout আবেদন তৈরি করে
 * — সিস্টেম নিজে কখনো অনুমোদন বা টাকা পাঠায় না; প্রতিটি আবেদন
 * আগের মতোই অ্যাডমিনের পর্যালোচনায় যায় (বড় অঙ্কে CC23
 * চার-চোখ নিয়মসহ)।
 */

type ConnDict = typeof connectionsBn;
const DAY_KEYS = ["poDay0", "poDay1", "poDay2", "poDay3", "poDay4", "poDay5", "poDay6"] as const;

function maskedDetails(dest: PayoutDestinationView): string {
  const parts = Object.entries(dest.details ?? {}).map(([k, v]) => `${k}: ${String(v)}`);
  return parts.join(" · ");
}

function scheduleSummary(s: PayoutScheduleView | null, D: ConnDict, locale: "bn" | "en"): string {
  if (!s) return D.poSchedNone;
  if (!s.enabled) return D.poSchedOff;
  const tpl = (template: string, params: Record<string, string>) =>
    Object.entries(params).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), template);
  const when = s.cadence === "weekly"
    ? tpl(D.poSchedWeekly, { day: D[DAY_KEYS[s.dayOfWeek ?? 0] ?? "poDay0"] })
    : tpl(D.poSchedMonthly, { day: String(s.dayOfMonth ?? 1) });
  return when + tpl(D.poSchedSuffix, { amount: formatTakaMinor(s.thresholdMinor, locale) });
}

export function PayoutAutomationPanel() {
  const { dict, locale } = useLocale();
  const D = dict.connections;
  const [destinations, setDestinations] = useState<PayoutDestinationView[]>([]);
  const [schedule, setSchedule] = useState<PayoutScheduleView | null>(null);
  const [requests, setRequests] = useState<PayoutRequestView[]>([]);
  const [label, setLabel] = useState("");
  const [method, setMethod] = useState("bkash");
  const [methodValue, setMethodValue] = useState("");
  const [cadence, setCadence] = useState("weekly");
  const [dayOfWeek, setDayOfWeek] = useState("5");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [thresholdTaka, setThresholdTaka] = useState("");
  const [scheduleDest, setScheduleDest] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const [destRes, schedRes, reqRes] = await Promise.all([
        apiFetch<{ destinations: PayoutDestinationView[] }>(`organizations/${orgId}/connections/payout-destinations`),
        apiFetch<{ schedule: PayoutScheduleView | null }>(`organizations/${orgId}/connections/payout-schedule`),
        apiFetch<{ requests: PayoutRequestView[] }>(`organizations/${orgId}/connections/wallet/payouts`),
      ]);
      setDestinations(destRes.destinations ?? []);
      setSchedule(schedRes.schedule ?? null);
      setRequests(reqRes.requests ?? []);
      if (schedRes.schedule) {
        setScheduleEnabled(schedRes.schedule.enabled);
        setCadence(schedRes.schedule.cadence);
        if (schedRes.schedule.dayOfWeek != null) setDayOfWeek(String(schedRes.schedule.dayOfWeek));
        if (schedRes.schedule.dayOfMonth != null) setDayOfMonth(String(schedRes.schedule.dayOfMonth));
        setThresholdTaka(String(Number(schedRes.schedule.thresholdMinor) / 100));
        setScheduleDest(schedRes.schedule.destinationId ?? "");
      }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : D.poLoadFailed);
    } finally { setLoaded(true); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function addDestination() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const trimmed = methodValue.trim();
    if (!label.trim() || !trimmed) { setError(D.poDestNameRequired); return; }
    setBusy("dest"); setError(""); setNotice("");
    try {
      const details = method === "bkash" ? { number: trimmed } : { accountNumber: trimmed };
      await apiFetch(`organizations/${orgId}/connections/payout-destinations`, {
        method: "POST", body: JSON.stringify({ label: label.trim(), method, details, makeDefault: destinations.length === 0 }),
      });
      setLabel(""); setMethodValue("");
      setNotice(D.poDestAdded);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.poDestAddFailed);
    } finally { setBusy(""); }
  }

  async function makeDefault(dest: PayoutDestinationView) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(dest.id); setError("");
    try {
      await apiFetch(`organizations/${orgId}/connections/payout-destinations/${dest.id}/default`, { method: "POST", body: "{}" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.poDefaultFailed);
    } finally { setBusy(""); }
  }

  async function removeDestination(dest: PayoutDestinationView) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(dest.id); setError("");
    try {
      await apiFetch(`organizations/${orgId}/connections/payout-destinations/${dest.id}`, { method: "DELETE" });
      setNotice(D.poDestRemoved);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.poDestRemoveFailed);
    } finally { setBusy(""); }
  }

  async function saveSchedule() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const taka = Number(thresholdTaka);
    if (!Number.isFinite(taka) || taka < 0) { setError(D.poThresholdInvalid); return; }
    setBusy("sched"); setError(""); setNotice("");
    try {
      const body: Record<string, unknown> = {
        enabled: scheduleEnabled,
        cadence,
        thresholdMinor: String(Math.round(taka * 100)),
        destinationId: scheduleDest || null,
      };
      if (cadence === "weekly") body.dayOfWeek = Number(dayOfWeek); else body.dayOfMonth = Number(dayOfMonth);
      await apiFetch(`organizations/${orgId}/connections/payout-schedule`, { method: "PUT", body: JSON.stringify(body) });
      setNotice(D.poScheduleSaved);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.poScheduleSaveFailed);
    } finally { setBusy(""); }
  }

  const systemRequests = requests.filter((r) => r.createdBySystem);

  return (
    <div className="card space-y-4 p-4">
      <div className="font-semibold text-slate-800">{D.poTitle}</div>
      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      {notice ? <div className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{notice}</div> : null}
      <p className="text-xs leading-relaxed text-slate-500">{D.poIntro}</p>

      <div className="space-y-2">
        <div className="text-sm font-semibold text-slate-700">{D.poDestsTitle}</div>
        {!loaded ? <p className="text-xs text-slate-400">{dict.common.loading}</p>
          : destinations.length === 0 ? <p className="text-xs text-slate-400">{D.poNoDest}</p>
          : (
            <ul className="space-y-1">
              {destinations.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <span className="font-semibold text-slate-700">{d.label}</span>
                  <span className="text-slate-500">{d.method === "bkash" ? D.payBkash : D.poMethodBank}</span>
                  <span className="font-mono text-slate-500">{maskedDetails(d)}</span>
                  {d.isDefault ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-700">Default</span> : null}
                  {!d.isDefault ? (
                    <button type="button" disabled={busy === d.id} onClick={() => void makeDefault(d)} className="rounded-lg bg-indigo-50 px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">{D.poMakeDefault}</button>
                  ) : null}
                  <button type="button" disabled={busy === d.id} onClick={() => void removeDestination(d)} className="rounded-lg bg-red-50 px-2 py-1 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">{D.poRemove}</button>
                </li>
              ))}
            </ul>
          )}
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-slate-500">{D.poLabelField}
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={D.poLabelPlaceholder} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">{D.poMethodField}
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
              <option value="bkash">{D.payBkash}</option>
              <option value="bank">{D.poMethodBank}</option>
            </select>
          </label>
          <label className="text-xs text-slate-500">{method === "bkash" ? D.poBkashNumber : D.poBankAccount}
            <input value={methodValue} onChange={(e) => setMethodValue(e.target.value)} placeholder={method === "bkash" ? "01XXXXXXXXX" : D.poAccountPlaceholder} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
        </div>
        <button type="button" disabled={busy === "dest"} onClick={() => void addDestination()} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          {busy === "dest" ? D.poAdding : D.poAddDest}
        </button>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <div className="text-sm font-semibold text-slate-700">{D.poScheduleTitle}</div>
        <p className="text-xs text-slate-500">{scheduleSummary(schedule, D, locale)}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} /> {D.poEnabled}
          </label>
          <label className="text-xs text-slate-500">{D.poCadence}
            <select value={cadence} onChange={(e) => setCadence(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
              <option value="weekly">{D.poWeekly}</option>
              <option value="monthly">{D.poMonthly}</option>
            </select>
          </label>
          {cadence === "weekly" ? (
            <label className="text-xs text-slate-500">{D.poDayOfWeek}
              <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                {DAY_KEYS.map((k, i) => <option key={i} value={i}>{D[k]}</option>)}
              </select>
            </label>
          ) : (
            <label className="text-xs text-slate-500">{D.poDayOfMonth}
              <input inputMode="numeric" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
            </label>
          )}
          <label className="text-xs text-slate-500">{D.poThreshold}
            <input inputMode="decimal" value={thresholdTaka} onChange={(e) => setThresholdTaka(e.target.value)} placeholder="5000" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">{D.poDestField}
            <select value={scheduleDest} onChange={(e) => setScheduleDest(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
              <option value="">{D.poDefaultDest}</option>
              {destinations.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
        </div>
        <button type="button" disabled={busy === "sched"} onClick={() => void saveSchedule()} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          {busy === "sched" ? D.poSavingSched : D.poSaveSchedule}
        </button>
        {systemRequests.length > 0 ? (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-slate-600">{D.poSystemTitle}</div>
            {systemRequests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                <span className="font-semibold text-slate-700">{formatTakaMinor(r.amountMinor, locale)}</span>
                <span className="text-slate-500">{payoutStatusLabel(r.status, locale)}</span>
                <span className="text-slate-400">{D.poSystemNote}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
