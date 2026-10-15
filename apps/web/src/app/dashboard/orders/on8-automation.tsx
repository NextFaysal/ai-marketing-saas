"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  ACTION_TYPE_OPTIONS, TRIGGER_OPTIONS, actionSummary, buildRulePayload, draftFromRule,
  emptyActionDraft, emptyRuleDraft, logActionSummary, triggerLabel,
  type AutomationLogRow, type AutomationPreset, type AutomationRule, type RuleDraft,
} from "@/lib/orders-on8";
import { memberName, type MemberRow } from "./on2-detail";

/**
 * ON8 — Orders Automation Studio panel (opened from the
 * orders page header, same modal pattern as the Fraud Shield
 * / notification panels). Rule list with enabled switch + run
 * counts, a CONSTRAINED builder (only the ON8 vocabulary —
 * trigger select → trigger config + conditions → ordered
 * action rows; payload shaping lives in lib/orders-on8 and is
 * unit-tested), the preset gallery (install creates the rule
 * DISABLED; a duplicate install shows the server's refusal),
 * and a per-rule log viewer. Bengali-first.
 */
export function OrderAutomationPanel({ members, statusOptions, onClose }: {
  members: MemberRow[];
  statusOptions: string[];
  onClose: () => void;
}) {
  const orgId = getOrganizationId() ?? "";
  const base = `/organizations/${orgId}/order-automation`;
  const [rules, setRules] = useState<AutomationRule[] | null>(null);
  const [presets, setPresets] = useState<AutomationPreset[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [logRule, setLogRule] = useState<AutomationRule | null>(null);
  const [logs, setLogs] = useState<AutomationLogRow[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const [rs, ps] = await Promise.all([
        apiFetch<AutomationRule[]>(`${base}/rules`),
        apiFetch<AutomationPreset[]>(`${base}/presets`),
      ]);
      setRules(rs); setPresets(ps); setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "অটোমেশন লোড ব্যর্থ হয়েছে");
    }
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  const loadLogs = useCallback(async (rule: AutomationRule, page: number) => {
    try {
      const out = await apiFetch<{ total: number; items: AutomationLogRow[] }>(`${base}/rules/${rule.id}/logs?page=${page}&pageSize=10`);
      setLogs(out.items); setLogTotal(out.total); setLogPage(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "লগ লোড ব্যর্থ হয়েছে");
    }
  }, [base]);

  async function toggleEnabled(rule: AutomationRule) {
    setBusy(`toggle-${rule.id}`);
    try {
      const updated = await apiFetch<AutomationRule>(`${base}/rules/${rule.id}`, {
        method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled }),
      });
      setRules((rs) => (rs ?? []).map((r) => (r.id === rule.id ? { ...r, enabled: updated.enabled } : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "চালু/বন্ধ করা যায়নি");
    } finally { setBusy(""); }
  }

  async function deleteRule(rule: AutomationRule) {
    setBusy(`del-${rule.id}`);
    try {
      await apiFetch(`${base}/rules/${rule.id}`, { method: "DELETE" });
      setRules((rs) => (rs ?? []).filter((r) => r.id !== rule.id));
      if (logRule?.id === rule.id) setLogRule(null);
      setNotice(`"${rule.name}" নিয়মটি মোছা হয়েছে`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "মোছা যায়নি");
    } finally { setBusy(""); }
  }

  async function installPreset(preset: AutomationPreset) {
    setBusy(`install-${preset.key}`); setError(""); setNotice("");
    try {
      const created = await apiFetch<AutomationRule>(`${base}/presets/${preset.key}/install`, { method: "POST" });
      setRules((rs) => [created, ...(rs ?? [])]);
      setPresets((ps) => ps.map((p) => (p.key === preset.key ? { ...p, installed: true } : p)));
      setNotice(`"${preset.name}" ইনস্টল হয়েছে — নিয়মটি বন্ধ আছে, তালিকা থেকে নিজে চালু করুন।`);
    } catch (e) {
      // Duplicate install lands here with the server's Bengali refusal.
      setError(e instanceof Error ? e.message : "ইনস্টল করা যায়নি");
    } finally { setBusy(""); }
  }

  async function saveDraft() {
    if (!draft) return;
    const { payload, error: buildError } = buildRulePayload(draft);
    if (buildError || !payload) { setError(buildError ?? "তথ্য সঠিক নয়"); return; }
    setBusy("save"); setError("");
    try {
      if (editingId) {
        const updated = await apiFetch<AutomationRule>(`${base}/rules/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
        setRules((rs) => (rs ?? []).map((r) => (r.id === editingId ? { ...r, ...updated } : r)));
        setNotice("নিয়মটি হালনাগাদ হয়েছে");
      } else {
        const created = await apiFetch<AutomationRule>(`${base}/rules`, { method: "POST", body: JSON.stringify(payload) });
        setRules((rs) => [created, ...(rs ?? [])]);
        setNotice("নতুন নিয়ম তৈরি হয়েছে");
      }
      setDraft(null); setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "সংরক্ষণ করা যায়নি");
    } finally { setBusy(""); }
  }

  const setAction = (idx: number, patch: Partial<RuleDraft["actions"][number]>) =>
    setDraft((d) => (d ? { ...d, actions: d.actions.map((a, i) => (i === idx ? { ...a, ...patch } : a)) } : d));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="অর্ডার অটোমেশন">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">🤖 অর্ডার অটোমেশন</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>বন্ধ করুন</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          শর্ত মিললে অর্ডারে স্বয়ংক্রিয়ভাবে ট্যাগ, দায়িত্ব, আটকানো বা বার্তার কাজ হবে। কোনো নিয়মই অর্ডারের টাকা, পেমেন্ট বা স্ট্যাটাস বদলাতে পারে না।
          সময়ভিত্তিক নিয়ম (পার্সেল আটকে থাকা / বকেয়া) চলতে অটোমেশন পেজ থেকে "অর্ডার অটোমেশন যাচাই" কাজটি চালু থাকতে হবে।
        </p>
        {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
        {notice ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}

        {/* ---- rule list ---- */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">আমার নিয়ম</h3>
            <button type="button" className="btn-primary btn-sm" onClick={() => { setDraft(emptyRuleDraft()); setEditingId(null); }}>+ নতুন নিয়ম</button>
          </div>
          {rules === null ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : rules.length === 0 ? (
            <p className="text-sm text-slate-400">এখনো কোনো নিয়ম নেই — নিচের প্রিসেট থেকে শুরু করুন অথবা নতুন নিয়ম বানান।</p>
          ) : rules.map((rule) => (
            <div key={rule.id} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-sm" title={rule.enabled ? "চালু আছে" : "বন্ধ আছে"}>
                  <input type="checkbox" checked={rule.enabled} disabled={busy !== ""} onChange={() => void toggleEnabled(rule)} />
                </label>
                <span className="font-medium">{rule.name}</span>
                {rule.presetKey ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">প্রিসেট</span> : null}
                <span className="ml-auto text-xs text-slate-500">{rule.runCount} বার চলেছে{rule.lastRunAt ? ` · শেষ: ${new Date(rule.lastRunAt).toLocaleString("bn-BD")}` : ""}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{triggerLabel(rule.trigger)} → {actionSummary(rule.actions)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setDraft(draftFromRule(rule)); setEditingId(rule.id); }}>সম্পাদনা</button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setLogRule(rule); void loadLogs(rule, 1); }}>লগ দেখুন</button>
                <button type="button" className="btn-ghost btn-sm text-red-600" disabled={busy !== ""} onClick={() => void deleteRule(rule)}>
                  {busy === `del-${rule.id}` ? "মোছা হচ্ছে…" : "মুছুন"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ---- per-rule log viewer ---- */}
        {logRule ? (
          <div className="mt-5 rounded-xl border p-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">📜 লগ — {logRule.name}</h3>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setLogRule(null)}>লগ বন্ধ করুন</button>
            </div>
            {logs.length === 0 ? <p className="mt-2 text-sm text-slate-400">এই নিয়মটি এখনো কোনো অর্ডারে চলেনি।</p> : (
              <ul className="mt-2 space-y-1.5">
                {logs.map((row) => (
                  <li key={row.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="font-medium">{new Date(row.createdAt).toLocaleString("bn-BD")}</span>
                    <span className="text-slate-500"> · অর্ডার: {row.orderId} · {row.triggerKey}</span>
                    <div className="text-xs text-slate-600">{logActionSummary(row)}</div>
                  </li>
                ))}
              </ul>
            )}
            {logTotal > 10 ? (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <button type="button" className="btn-ghost btn-sm" disabled={logPage <= 1} onClick={() => void loadLogs(logRule, logPage - 1)}>← আগের</button>
                <span className="text-xs text-slate-500">পৃষ্ঠা {logPage} · মোট {logTotal}টি</span>
                <button type="button" className="btn-ghost btn-sm" disabled={logPage * 10 >= logTotal} onClick={() => void loadLogs(logRule, logPage + 1)}>পরের →</button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ---- builder ---- */}
        {draft ? (
          <div className="mt-5 space-y-3 rounded-xl border p-4">
            <h3 className="font-semibold">{editingId ? "নিয়ম সম্পাদনা" : "নতুন নিয়ম"}</h3>
            <label className="block text-sm">নিয়মের নাম
              <input className="input mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="যেমন: বড় অর্ডার যাচাই" />
            </label>
            <label className="block text-sm">কখন চলবে (ট্রিগার)
              <select className="input mt-1" value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.target.value })}>
                {TRIGGER_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            {draft.trigger === "status_changed" ? (
              <label className="block text-sm">কোন স্ট্যাটাসে গেলে
                <select className="input mt-1" value={draft.toStatus} onChange={(e) => setDraft({ ...draft, toStatus: e.target.value })}>
                  <option value="">— বেছে দিন —</option>
                  {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            ) : null}
            {draft.trigger === "parcel_stuck_hours" ? (
              <label className="block text-sm">কত ঘণ্টা আটকে থাকলে
                <input className="input mt-1" type="number" min={1} max={8760} value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value })} />
              </label>
            ) : null}
            {draft.trigger === "due_overdue_days" ? (
              <label className="block text-sm">বকেয়া কত দিনের পুরনো হলে
                <input className="input mt-1" type="number" min={1} max={365} value={draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.value })} />
              </label>
            ) : null}

            <fieldset className="space-y-2 rounded-lg bg-slate-50 p-3">
              <legend className="px-1 text-sm font-medium">শর্ত (সবগুলো মিললেই চলবে — ফাঁকা রাখলে শর্ত নেই)</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">কমপক্ষে মোট (৳)
                  <input className="input mt-1" inputMode="decimal" placeholder="যেমন: 3000" value={draft.minTotalTaka} onChange={(e) => setDraft({ ...draft, minTotalTaka: e.target.value })} />
                </label>
                <label className="text-sm">উৎস (কমা দিয়ে একাধিক)
                  <input className="input mt-1" placeholder="woocommerce, manual" value={draft.sources} onChange={(e) => setDraft({ ...draft, sources: e.target.value })} />
                </label>
                <label className="text-sm">COD অর্ডার
                  <select className="input mt-1" value={draft.isCod} onChange={(e) => setDraft({ ...draft, isCod: e.target.value as RuleDraft["isCod"] })}>
                    <option value="">যেকোনো</option><option value="true">শুধু COD</option><option value="false">COD নয়</option>
                  </select>
                </label>
                <label className="text-sm">গ্রাহক
                  <select className="input mt-1" value={draft.customerIsNew} onChange={(e) => setDraft({ ...draft, customerIsNew: e.target.value as RuleDraft["customerIsNew"] })}>
                    <option value="">যেকোনো</option><option value="true">নতুন গ্রাহক</option><option value="false">পুরনো গ্রাহক</option>
                  </select>
                </label>
                <label className="text-sm">জেলা
                  <input className="input mt-1" placeholder="যেমন: Dhaka" value={draft.district} onChange={(e) => setDraft({ ...draft, district: e.target.value })} />
                </label>
                <label className="text-sm">কমপক্ষে ঝুঁকি (Fraud Shield)
                  <select className="input mt-1" value={draft.riskBandAtLeast} onChange={(e) => setDraft({ ...draft, riskBandAtLeast: e.target.value as RuleDraft["riskBandAtLeast"] })}>
                    <option value="">যেকোনো</option><option value="medium">মাঝারি বা বেশি</option><option value="high">শুধু উচ্চ</option>
                  </select>
                </label>
              </div>
            </fieldset>

            <div className="space-y-2">
              <p className="text-sm font-medium">কাজ (পরপর চলবে — একটি ব্যর্থ হলেও বাকিগুলো চলবে)</p>
              {draft.actions.map((a, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                  <select className="input w-auto" value={a.type} onChange={(e) => setAction(idx, { type: e.target.value as typeof a.type })}>
                    {ACTION_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  {a.type === "add_tag" ? <input className="input w-40" placeholder="ট্যাগ" value={a.tag} onChange={(e) => setAction(idx, { tag: e.target.value })} /> : null}
                  {a.type === "assign" ? (
                    <select className="input w-auto" value={a.userId} onChange={(e) => setAction(idx, { userId: e.target.value })}>
                      <option value="">— সদস্য বেছে দিন —</option>
                      {members.map((m) => <option key={m.user.id} value={m.user.id}>{memberName(members, m.user.id)}</option>)}
                    </select>
                  ) : null}
                  {a.type === "hold" ? <input className="input w-64" placeholder="আটকানোর কারণ" value={a.reason} onChange={(e) => setAction(idx, { reason: e.target.value })} /> : null}
                  {a.type === "notify_staff" || a.type === "notify_customer" ? (
                    <input className="input w-80" placeholder="বার্তা — {{orderNumber}} {{total}} {{customerName}} ব্যবহার করা যাবে" value={a.message} onChange={(e) => setAction(idx, { message: e.target.value })} />
                  ) : null}
                  <button type="button" className="btn-ghost btn-sm text-red-600" disabled={draft.actions.length <= 1} onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, i) => i !== idx) })}>সরান</button>
                </div>
              ))}
              <button type="button" className="btn-secondary btn-sm" disabled={draft.actions.length >= 10} onClick={() => setDraft({ ...draft, actions: [...draft.actions, emptyActionDraft()] })}>+ আরেকটি কাজ</button>
            </div>

            <div className="flex gap-2">
              <button type="button" className="btn-primary btn-sm" disabled={busy !== ""} onClick={() => void saveDraft()}>
                {busy === "save" ? "সংরক্ষণ হচ্ছে…" : editingId ? "হালনাগাদ করুন" : "নিয়ম তৈরি করুন"}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => { setDraft(null); setEditingId(null); }}>বাতিল</button>
            </div>
            <p className="text-xs text-slate-400">নতুন নিয়ম বন্ধ অবস্থায় তৈরি হয় — তালিকা থেকে চালু করুন।</p>
          </div>
        ) : null}

        {/* ---- preset gallery ---- */}
        <div className="mt-6 space-y-2 border-t pt-4">
          <h3 className="font-semibold">⭐ প্রিসেট লাইব্রেরি</h3>
          <p className="text-xs text-slate-500">ইনস্টল করলে নিয়মটি বন্ধ অবস্থায় তৈরি হবে — নিজে চালু করলেই কেবল চলবে।</p>
          {presets.map((p) => (
            <div key={p.key} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-slate-500">{p.descriptionBn}</p>
                <p className="text-xs text-slate-400">{triggerLabel(p.trigger)} → {actionSummary(p.actions)}</p>
              </div>
              {p.installed ? (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">ইনস্টল করা আছে</span>
              ) : (
                <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => void installPreset(p)}>
                  {busy === `install-${p.key}` ? "ইনস্টল হচ্ছে…" : "ইনস্টল করুন"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
