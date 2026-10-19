"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtNumber, fmtDateTime } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
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
  const { dict, t, locale } = useLocale();
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
      setError(e instanceof Error ? e.message : dict.orders.automationLoadFailed);
    }
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  const loadLogs = useCallback(async (rule: AutomationRule, page: number) => {
    try {
      const out = await apiFetch<{ total: number; items: AutomationLogRow[] }>(`${base}/rules/${rule.id}/logs?page=${page}&pageSize=10`);
      setLogs(out.items); setLogTotal(out.total); setLogPage(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.orders.logLoadFailed);
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
      setError(e instanceof Error ? e.message : dict.orders.couldNotTurnOnOff);
    } finally { setBusy(""); }
  }

  async function deleteRule(rule: AutomationRule) {
    setBusy(`del-${rule.id}`);
    try {
      await apiFetch(`${base}/rules/${rule.id}`, { method: "DELETE" });
      setRules((rs) => (rs ?? []).filter((r) => r.id !== rule.id));
      if (logRule?.id === rule.id) setLogRule(null);
      setNotice(t("orders.theRuleHasBeenDeleted", { name: rule.name }));
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.orders.couldNotDelete);
    } finally { setBusy(""); }
  }

  async function installPreset(preset: AutomationPreset) {
    setBusy(`install-${preset.key}`); setError(""); setNotice("");
    try {
      const created = await apiFetch<AutomationRule>(`${base}/presets/${preset.key}/install`, { method: "POST" });
      setRules((rs) => [created, ...(rs ?? [])]);
      setPresets((ps) => ps.map((p) => (p.key === preset.key ? { ...p, installed: true } : p)));
      setNotice(t("orders.installedTheRuleIsOff", { name: preset.name }));
    } catch (e) {
      // Duplicate install lands here with the server's Bengali refusal.
      setError(e instanceof Error ? e.message : dict.orders.couldNotInstall);
    } finally { setBusy(""); }
  }

  async function saveDraft() {
    if (!draft) return;
    const { payload, error: buildError } = buildRulePayload(draft, locale);
    if (buildError || !payload) { setError(buildError ?? dict.orders.informationIsIncorrect); return; }
    setBusy("save"); setError("");
    try {
      if (editingId) {
        const updated = await apiFetch<AutomationRule>(`${base}/rules/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
        setRules((rs) => (rs ?? []).map((r) => (r.id === editingId ? { ...r, ...updated } : r)));
        setNotice(dict.orders.theRuleHasBeenUpdated);
      } else {
        const created = await apiFetch<AutomationRule>(`${base}/rules`, { method: "POST", body: JSON.stringify(payload) });
        setRules((rs) => [created, ...(rs ?? [])]);
        setNotice(dict.orders.newRuleCreated);
      }
      setDraft(null); setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.orders.couldNotSave);
    } finally { setBusy(""); }
  }

  const setAction = (idx: number, patch: Partial<RuleDraft["actions"][number]>) =>
    setDraft((d) => (d ? { ...d, actions: d.actions.map((a, i) => (i === idx ? { ...a, ...patch } : a)) } : d));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={dict.orders.orderAutomation}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{dict.orders.orderAutomation2}</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{dict.orders.close}</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {dict.orders.whenConditionsMatchTheOrder}</p>
        {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}
        {notice ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}

        {/* ---- rule list ---- */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{dict.orders.myRules}</h3>
            <button type="button" className="btn-primary btn-sm" onClick={() => { setDraft(emptyRuleDraft()); setEditingId(null); }}>{dict.orders.newRule2}</button>
          </div>
          {rules === null ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : rules.length === 0 ? (
            <p className="text-sm text-slate-400">{dict.orders.noRulesYetStartFrom}</p>
          ) : rules.map((rule) => (
            <div key={rule.id} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-sm" title={rule.enabled ? dict.orders.active2 : dict.orders.off3}>
                  <input type="checkbox" checked={rule.enabled} disabled={busy !== ""} onChange={() => void toggleEnabled(rule)} />
                </label>
                <span className="font-medium">{rule.name}</span>
                {rule.presetKey ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{dict.orders.presets}</span> : null}
                <span className="ml-auto text-xs text-slate-500">{rule.runCount} {dict.orders.timesRun}{rule.lastRunAt ? t("orders.last3", { p0: fmtDateTime(locale, new Date(rule.lastRunAt)) }) : ""}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{triggerLabel(rule.trigger, locale)} → {actionSummary(rule.actions, locale)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setDraft(draftFromRule(rule)); setEditingId(rule.id); }}>{dict.orders.edit}</button>
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setLogRule(rule); void loadLogs(rule, 1); }}>{dict.orders.viewLog}</button>
                <button type="button" className="btn-ghost btn-sm text-red-600" disabled={busy !== ""} onClick={() => void deleteRule(rule)}>
                  {busy === `del-${rule.id}` ? dict.orders.deleting : dict.orders.delete}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ---- per-rule log viewer ---- */}
        {logRule ? (
          <div className="mt-5 rounded-xl border p-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{dict.orders.log}{logRule.name}</h3>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setLogRule(null)}>{dict.orders.closeLog}</button>
            </div>
            {logs.length === 0 ? <p className="mt-2 text-sm text-slate-400">{dict.orders.thisRuleHasNotRun}</p> : (
              <ul className="mt-2 space-y-1.5">
                {logs.map((row) => (
                  <li key={row.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="font-medium">{fmtDateTime(locale, new Date(row.createdAt))}</span>
                    <span className="text-slate-500"> {dict.orders.order5}{row.orderId} · {row.triggerKey}</span>
                    <div className="text-xs text-slate-600">{logActionSummary(row, locale)}</div>
                  </li>
                ))}
              </ul>
            )}
            {logTotal > 10 ? (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <button type="button" className="btn-ghost btn-sm" disabled={logPage <= 1} onClick={() => void loadLogs(logRule, logPage - 1)}>{dict.orders.previous}</button>
                <span className="text-xs text-slate-500">{dict.orders.page}{logPage} {dict.orders.total2}{logTotal}{dict.orders.items}</span>
                <button type="button" className="btn-ghost btn-sm" disabled={logPage * 10 >= logTotal} onClick={() => void loadLogs(logRule, logPage + 1)}>{dict.orders.next}</button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ---- builder ---- */}
        {draft ? (
          <div className="mt-5 space-y-3 rounded-xl border p-4">
            <h3 className="font-semibold">{editingId ? dict.orders.editRule2 : dict.orders.newRule}</h3>
            <label className="block text-sm">{dict.orders.ruleName2}<input className="input mt-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={dict.orders.eGVerifyLargeOrders} />
            </label>
            <label className="block text-sm">{dict.orders.whenItRunsTrigger}<select className="input mt-1" value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.target.value })}>
                {TRIGGER_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            {draft.trigger === "status_changed" ? (
              <label className="block text-sm">{dict.orders.onReachingWhichStatus}<select className="input mt-1" value={draft.toStatus} onChange={(e) => setDraft({ ...draft, toStatus: e.target.value })}>
                  <option value="">{dict.orders.choose}</option>
                  {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            ) : null}
            {draft.trigger === "parcel_stuck_hours" ? (
              <label className="block text-sm">{dict.orders.stuckForHowManyHours}<input className="input mt-1" type="number" min={1} max={8760} value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value })} />
              </label>
            ) : null}
            {draft.trigger === "due_overdue_days" ? (
              <label className="block text-sm">{dict.orders.dueOlderThanHowMany}<input className="input mt-1" type="number" min={1} max={365} value={draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.value })} />
              </label>
            ) : null}

            <fieldset className="space-y-2 rounded-lg bg-slate-50 p-3">
              <legend className="px-1 text-sm font-medium">{dict.orders.conditionsRunsOnlyIfAll}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">{dict.orders.minimumTotal}<input className="input mt-1" inputMode="decimal" placeholder={dict.orders.eG3000} value={draft.minTotalTaka} onChange={(e) => setDraft({ ...draft, minTotalTaka: e.target.value })} />
                </label>
                <label className="text-sm">{dict.orders.sourcesMultipleCommaSeparated}<input className="input mt-1" placeholder="woocommerce, manual" value={draft.sources} onChange={(e) => setDraft({ ...draft, sources: e.target.value })} />
                </label>
                <label className="text-sm">{dict.orders.cODOrders}<select className="input mt-1" value={draft.isCod} onChange={(e) => setDraft({ ...draft, isCod: e.target.value as RuleDraft["isCod"] })}>
                    <option value="">{dict.orders.any}</option><option value="true">{dict.orders.cODOnly}</option><option value="false">{dict.orders.notCOD}</option>
                  </select>
                </label>
                <label className="text-sm">{dict.orders.customer}<select className="input mt-1" value={draft.customerIsNew} onChange={(e) => setDraft({ ...draft, customerIsNew: e.target.value as RuleDraft["customerIsNew"] })}>
                    <option value="">{dict.orders.any}</option><option value="true">{dict.orders.newCustomer}</option><option value="false">{dict.orders.returningCustomer}</option>
                  </select>
                </label>
                <label className="text-sm">{dict.orders.district}<input className="input mt-1" placeholder={dict.orders.eGDhaka} value={draft.district} onChange={(e) => setDraft({ ...draft, district: e.target.value })} />
                </label>
                <label className="text-sm">{dict.orders.minimumRiskFraudShield}<select className="input mt-1" value={draft.riskBandAtLeast} onChange={(e) => setDraft({ ...draft, riskBandAtLeast: e.target.value as RuleDraft["riskBandAtLeast"] })}>
                    <option value="">{dict.orders.any}</option><option value="medium">{dict.orders.mediumOrHigher}</option><option value="high">{dict.orders.highOnly}</option>
                  </select>
                </label>
              </div>
            </fieldset>

            <div className="space-y-2">
              <p className="text-sm font-medium">{dict.orders.actionsRunInSequenceThe}</p>
              {draft.actions.map((a, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                  <select className="input w-auto" value={a.type} onChange={(e) => setAction(idx, { type: e.target.value as typeof a.type })}>
                    {ACTION_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  {a.type === "add_tag" ? <input className="input w-40" placeholder={dict.orders.tag} value={a.tag} onChange={(e) => setAction(idx, { tag: e.target.value })} /> : null}
                  {a.type === "assign" ? (
                    <select className="input w-auto" value={a.userId} onChange={(e) => setAction(idx, { userId: e.target.value })}>
                      <option value="">{dict.orders.chooseAMember2}</option>
                      {members.map((m) => <option key={m.user.id} value={m.user.id}>{memberName(members, m.user.id, dict.orders.teamMember)}</option>)}
                    </select>
                  ) : null}
                  {a.type === "hold" ? <input className="input w-64" placeholder={dict.orders.holdReason} value={a.reason} onChange={(e) => setAction(idx, { reason: e.target.value })} /> : null}
                  {a.type === "notify_staff" || a.type === "notify_customer" ? (
                    <input className="input w-80" placeholder={dict.orders.messageCanBeUsed} value={a.message} onChange={(e) => setAction(idx, { message: e.target.value })} />
                  ) : null}
                  <button type="button" className="btn-ghost btn-sm text-red-600" disabled={draft.actions.length <= 1} onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, i) => i !== idx) })}>{dict.orders.remove}</button>
                </div>
              ))}
              <button type="button" className="btn-secondary btn-sm" disabled={draft.actions.length >= 10} onClick={() => setDraft({ ...draft, actions: [...draft.actions, emptyActionDraft()] })}>{dict.orders.addAnotherAction}</button>
            </div>

            <div className="flex gap-2">
              <button type="button" className="btn-primary btn-sm" disabled={busy !== ""} onClick={() => void saveDraft()}>
                {busy === "save" ? dict.orders.saving : editingId ? dict.orders.update : dict.orders.createRule}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => { setDraft(null); setEditingId(null); }}>{dict.common.cancel}</button>
            </div>
            <p className="text-xs text-slate-400">{dict.orders.newRulesAreCreatedTurned}</p>
          </div>
        ) : null}

        {/* ---- preset gallery ---- */}
        <div className="mt-6 space-y-2 border-t pt-4">
          <h3 className="font-semibold">{dict.orders.presetLibrary}</h3>
          <p className="text-xs text-slate-500">{dict.orders.installingCreatesTheRuleTurned}</p>
          {presets.map((p) => (
            <div key={p.key} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-slate-500">{p.descriptionBn}</p>
                <p className="text-xs text-slate-400">{triggerLabel(p.trigger, locale)} → {actionSummary(p.actions, locale)}</p>
              </div>
              {p.installed ? (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">{dict.orders.installed}</span>
              ) : (
                <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => void installPreset(p)}>
                  {busy === `install-${p.key}` ? dict.orders.installing : dict.orders.install}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
