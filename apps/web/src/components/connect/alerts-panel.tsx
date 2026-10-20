"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  AlertPreferencesView,
  ConnectionAlertView,
  alertKindMeta,
  formatWhen,
} from "@/lib/connections";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber } from "@repo/contracts";

/**
 * CC12 — connection alerts + monitoring controls.
 *
 * The panel shows the alerts the sweep ACTUALLY delivered (rows
 * in ConnectionAlert) — the email count on each row is the number
 * of recipients for whom the mail provider returned a real
 * message id; a failed email shows its error verbatim here.
 * "সব পরীক্ষা করুন" runs the Connection Doctor over every
 * account (bounded server-side); "এখনই পর্যবেক্ষণ" triggers the
 * same sweep the per-org scheduled job runs. Preferences choose
 * which categories email/in-app alert and whether the (opt-in)
 * doctor joins the sweep.
 */

const CATEGORY_OPTIONS: { key: string; labelKey: string }[] = [
  { key: "messaging", labelKey: "alCatMessaging" },
  { key: "social", labelKey: "alCatSocial" },
  { key: "ads", labelKey: "alCatAds" },
  { key: "commerce", labelKey: "alCatCommerce" },
  { key: "courier", labelKey: "alCatCourier" },
  { key: "senders", labelKey: "alCatSenders" },
  { key: "ai", labelKey: "alCatAi" },
  { key: "payment", labelKey: "alCatPayment" },
  { key: "business", labelKey: "alCatBusiness" },
];

export function AlertsPanel({ onChanged }: { onChanged?: () => void }) {
  const { dict, t, locale } = useLocale();
  const D = dict.connections;
  const [alerts, setAlerts] = useState<ConnectionAlertView[]>([]);
  const [unread, setUnread] = useState(0);
  const [prefs, setPrefs] = useState<AlertPreferencesView | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const base = () => `/organizations/${getOrganizationId()}/connections`;

  const load = useCallback(async () => {
    try {
      const [list, p] = await Promise.all([
        apiFetch<{ items: ConnectionAlertView[]; unread: number }>(`${base()}/alerts?limit=30`),
        apiFetch<AlertPreferencesView>(`${base()}/alert-preferences`),
      ]);
      setAlerts(list.items);
      setUnread(list.unread);
      setPrefs(p);
    } catch { /* panel stays empty; the page itself reports load errors */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function diagnoseAll() {
    setBusy("all"); setError(""); setNotice("");
    try {
      const res = await apiFetch<{ totalTargets: number; ranTargets: number; skippedBeyondCap: number; runs: { overall: string }[] }>(`${base()}/diagnose-all`, { method: "POST" });
      const fails = res.runs.filter((r) => r.overall === "fail").length;
      const partials = res.runs.filter((r) => r.overall === "partial").length;
      setNotice(t("connections.alDiagDone", { ran: fmtNumber(locale, res.ranTargets), total: fmtNumber(locale, res.totalTargets), skipped: res.skippedBeyondCap > 0 ? t("connections.alDiagSkipped", { count: fmtNumber(locale, res.skippedBeyondCap) }) : "", fails: fmtNumber(locale, fails), partials: fmtNumber(locale, partials) }));
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.alDiagFailed);
    } finally { setBusy(""); }
  }

  async function runSweep() {
    setBusy("sweep"); setError(""); setNotice("");
    try {
      const res = await apiFetch<{ checked: number; alertsCreated: number; doctorRuns: number }>(`${base()}/run-sweep`, { method: "POST" });
      setNotice(t("connections.alSweepDone", { checked: fmtNumber(locale, res.checked), alerts: fmtNumber(locale, res.alertsCreated), doctor: res.doctorRuns > 0 ? t("connections.alSweepDoctor", { count: fmtNumber(locale, res.doctorRuns) }) : "" }));
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.alSweepFailed);
    } finally { setBusy(""); }
  }

  async function markRead(id: string) {
    try {
      await apiFetch(`${base()}/alerts/${id}/read`, { method: "POST" });
      await load();
      onChanged?.();
    } catch { /* non-critical */ }
  }

  async function markAllRead() {
    setBusy("readall");
    try {
      await apiFetch(`${base()}/alerts/read-all`, { method: "POST" });
      await load();
      onChanged?.();
    } catch { /* non-critical */ } finally { setBusy(""); }
  }

  async function savePrefs() {
    if (!prefs) return;
    setBusy("prefs"); setError(""); setNotice("");
    try {
      const saved = await apiFetch<AlertPreferencesView>(`${base()}/alert-preferences`, {
        method: "PUT",
        body: JSON.stringify(prefs),
      });
      setPrefs(saved);
      setNotice(D.alPrefsSaved);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.alPrefsSaveFailed);
    } finally { setBusy(""); }
  }

  function toggleCategory(key: string) {
    if (!prefs) return;
    const current = prefs.categories ?? CATEGORY_OPTIONS.map((c) => c.key);
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    setPrefs({ ...prefs, categories: next.length === CATEGORY_OPTIONS.length ? null : next });
  }

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-800">
          {D.alTitle}
          {unread > 0 ? <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">{t("connections.alUnread", { count: fmtNumber(locale, unread) })}</span> : null}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={busy === "all"} onClick={() => void diagnoseAll()} className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
            {busy === "all" ? D.alDiagnosing : D.alDiagnoseAll}
          </button>
          <button type="button" disabled={busy === "sweep"} onClick={() => void runSweep()} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
            {busy === "sweep" ? D.alRunning : D.alRunSweep}
          </button>
          <button type="button" onClick={() => setShowPrefs((v) => !v)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">{D.alSettingsBtn}</button>
          {unread > 0 ? (
            <button type="button" disabled={busy === "readall"} onClick={() => void markAllRead()} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">{D.alMarkAllRead}</button>
          ) : null}
        </div>
      </div>
      <p className="text-[13px] text-slate-500">
        {D.alIntroA}<b>{D.alIntroBold}</b>{D.alIntroB}
      </p>
      {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
      {notice ? <p className="text-sm font-medium text-green-700">{notice}</p> : null}

      {showPrefs && prefs ? (
        <div className="space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-100">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={prefs.emailEnabled} onChange={(e) => setPrefs({ ...prefs, emailEnabled: e.target.checked })} />
            {D.alEmailEnabled}
          </label>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500">{D.alCategoriesTitle}</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((c) => {
                const active = prefs.categories === null || prefs.categories.includes(c.key);
                return (
                  <label key={c.key} className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
                    <input type="checkbox" checked={active} onChange={() => toggleCategory(c.key)} />
                    {D[c.labelKey as keyof typeof D]}
                  </label>
                );
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={prefs.doctorEnabled} onChange={(e) => setPrefs({ ...prefs, doctorEnabled: e.target.checked })} />
            {D.alDoctorEnabled}
          </label>
          {prefs.doctorEnabled ? (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              {D.alDoctorInterval}
              <input
                type="number" min={1} max={720} value={prefs.doctorIntervalHours}
                onChange={(e) => setPrefs({ ...prefs, doctorIntervalHours: Math.max(1, Math.min(720, Number(e.target.value) || 24)) })}
                className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm"
              />
            </label>
          ) : null}
          <button type="button" disabled={busy === "prefs"} onClick={() => void savePrefs()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy === "prefs" ? D.maSaving : D.alSavePrefs}
          </button>
        </div>
      ) : null}

      {alerts.length === 0 ? (
        <p className="text-sm text-slate-400">{D.alEmpty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {alerts.map((alert) => {
            const meta = alertKindMeta(alert.kind, locale);
            return (
              <li key={alert.id} className={`flex flex-wrap items-start gap-2 py-2 ${alert.readAt ? "opacity-60" : ""}`}>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-700">{alert.title}</span>
                  {alert.body ? <span className="block text-xs text-slate-500">{alert.body}</span> : null}
                  <span className="block text-[11px] text-slate-400">
                    {formatWhen(alert.createdAt, locale)} · {alert.emailSentCount > 0 ? t("connections.alEmailReached", { count: fmtNumber(locale, alert.emailSentCount) }) : D.alEmailNotDelivered}
                    {alert.emailError ? t("connections.alErrorSuffix", { error: alert.emailError }) : ""}
                  </span>
                </span>
                {!alert.readAt ? (
                  <button type="button" onClick={() => void markRead(alert.id)} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">{D.alMarkRead}</button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
