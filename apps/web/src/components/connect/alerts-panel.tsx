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

const CATEGORY_OPTIONS: { key: string; label: string }[] = [
  { key: "messaging", label: "মেসেজিং" },
  { key: "social", label: "সোশ্যাল" },
  { key: "ads", label: "বিজ্ঞাপন" },
  { key: "commerce", label: "কমার্স" },
  { key: "courier", label: "কুরিয়ার" },
  { key: "senders", label: "প্রেরক" },
  { key: "ai", label: "AI" },
  { key: "payment", label: "পেমেন্ট" },
  { key: "business", label: "ব্যবসা" },
];

export function AlertsPanel({ onChanged }: { onChanged?: () => void }) {
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
      setNotice(`সব পরীক্ষা শেষ: ${res.ranTargets}/${res.totalTargets}টি অ্যাকাউন্ট পরীক্ষা হয়েছে${res.skippedBeyondCap > 0 ? ` (সীমার কারণে ${res.skippedBeyondCap}টি বাদ)` : ""} — ব্যর্থ ${fails}টি, আংশিক ${partials}টি।`);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "সব পরীক্ষা চালানো যায়নি");
    } finally { setBusy(""); }
  }

  async function runSweep() {
    setBusy("sweep"); setError(""); setNotice("");
    try {
      const res = await apiFetch<{ checked: number; alertsCreated: number; doctorRuns: number }>(`${base()}/run-sweep`, { method: "POST" });
      setNotice(`পর্যবেক্ষণ শেষ: ${res.checked}টি অ্যাকাউন্ট দেখা হয়েছে, ${res.alertsCreated}টি নতুন অ্যালার্ট${res.doctorRuns > 0 ? `, ${res.doctorRuns}টি live পরীক্ষা` : ""}।`);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "পর্যবেক্ষণ চালানো যায়নি");
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
      setNotice("অ্যালার্ট সেটিং সেভ হয়েছে।");
    } catch (e) {
      setError(e instanceof Error ? e.message : "সেটিং সেভ হয়নি");
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
          🔔 কানেকশন অ্যালার্ট ও পর্যবেক্ষণ
          {unread > 0 ? <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">{unread}টি পড়া হয়নি</span> : null}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={busy === "all"} onClick={() => void diagnoseAll()} className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
            {busy === "all" ? "পরীক্ষা চলছে…" : "🩺 সব পরীক্ষা করুন"}
          </button>
          <button type="button" disabled={busy === "sweep"} onClick={() => void runSweep()} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
            {busy === "sweep" ? "চলছে…" : "এখনই পর্যবেক্ষণ চালান"}
          </button>
          <button type="button" onClick={() => setShowPrefs((v) => !v)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">⚙️ অ্যালার্ট সেটিং</button>
          {unread > 0 ? (
            <button type="button" disabled={busy === "readall"} onClick={() => void markAllRead()} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">সব পড়া হয়েছে ধরুন</button>
          ) : null}
        </div>
      </div>
      <p className="text-[13px] text-slate-500">
        পর্যবেক্ষণ (scheduled job) অবস্থার <b>পরিবর্তন</b> দেখলেই অ্যালার্ট দেয় — একই সমস্যা বারবার নয়; ঠিক হয়ে গেলে তাও জানায়।
        ইমেইল যায় সংস্থার OWNER/ADMIN-দের কাছে; "পৌঁছেছে" ধরা হয় কেবল মেইল provider-এর আসল message id পেলেই।
      </p>
      {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
      {notice ? <p className="text-sm font-medium text-green-700">{notice}</p> : null}

      {showPrefs && prefs ? (
        <div className="space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-100">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={prefs.emailEnabled} onChange={(e) => setPrefs({ ...prefs, emailEnabled: e.target.checked })} />
            ইমেইল অ্যালার্ট চালু (OWNER/ADMIN)
          </label>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500">কোন ক্যাটাগরিতে অ্যালার্ট আসবে</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_OPTIONS.map((c) => {
                const active = prefs.categories === null || prefs.categories.includes(c.key);
                return (
                  <label key={c.key} className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
                    <input type="checkbox" checked={active} onChange={() => toggleCategory(c.key)} />
                    {c.label}
                  </label>
                );
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={prefs.doctorEnabled} onChange={(e) => setPrefs({ ...prefs, doctorEnabled: e.target.checked })} />
            পর্যবেক্ষণে live Doctor পরীক্ষাও চালাও (provider API কল লাগে — তাই ডিফল্ট বন্ধ)
          </label>
          {prefs.doctorEnabled ? (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              প্রতি অ্যাকাউন্টে live পরীক্ষার ব্যবধান (ঘণ্টা):
              <input
                type="number" min={1} max={720} value={prefs.doctorIntervalHours}
                onChange={(e) => setPrefs({ ...prefs, doctorIntervalHours: Math.max(1, Math.min(720, Number(e.target.value) || 24)) })}
                className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm"
              />
            </label>
          ) : null}
          <button type="button" disabled={busy === "prefs"} onClick={() => void savePrefs()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {busy === "prefs" ? "সেভ হচ্ছে…" : "সেটিং সেভ করুন"}
          </button>
        </div>
      ) : null}

      {alerts.length === 0 ? (
        <p className="text-sm text-slate-400">কোনো অ্যালার্ট এখনও আসেনি — সব কানেকশন ঠিক থাকলে এখানে কিছু আসবেও না।</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {alerts.map((alert) => {
            const meta = alertKindMeta(alert.kind);
            return (
              <li key={alert.id} className={`flex flex-wrap items-start gap-2 py-2 ${alert.readAt ? "opacity-60" : ""}`}>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-700">{alert.title}</span>
                  {alert.body ? <span className="block text-xs text-slate-500">{alert.body}</span> : null}
                  <span className="block text-[11px] text-slate-400">
                    {formatWhen(alert.createdAt)} · {alert.emailSentCount > 0 ? `ইমেইল পৌঁছেছে ${alert.emailSentCount} জনের কাছে` : "ইমেইল পৌঁছায়নি"}
                    {alert.emailError ? ` — ত্রুটি: ${alert.emailError}` : ""}
                  </span>
                </span>
                {!alert.readAt ? (
                  <button type="button" onClick={() => void markRead(alert.id)} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">পড়া হয়েছে</button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
