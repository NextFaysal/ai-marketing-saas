"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { buildLlmConfigBody, type LlmConfigForm } from "@/lib/connect-forms";
import { formatWhen, llmConfigStatusLabel, type OrgLlmConfigView } from "@/lib/connections";
import { useLocale } from "@/lib/i18n/provider";

/**
 * CC8 (Connect Center B4) — the tenant's OWN LLM key.
 *
 * সেভ করার আগে সার্ভার ওই key দিয়ে সত্যিকারের একটি ছোট
 * completion চালায়: যাচাই ব্যর্থ হলে কিছুই সেভ হয় না এবং
 * provider-এর নিজের ত্রুটি দেখায়। Key সেভ হলে এই সংস্থার
 * AI কলগুলো (যেগুলোতে organizationId থাকে) এই key দিয়েই চলবে;
 * key না থাকলে আগের মতো প্ল্যাটফর্মের LLM।
 */

const LLM_PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "gemini", label: "Google Gemini" },
];

const inputCls = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400";

export function LlmConfigPanel({ onChanged }: { onChanged?: () => void }) {
  const { dict, locale } = useLocale();
  const D = dict.connections;
  const [config, setConfig] = useState<OrgLlmConfigView | null>(null);
  const [form, setForm] = useState<LlmConfigForm>({ provider: "openai", apiKey: "", model: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<{ config: OrgLlmConfigView | null }>(`organizations/${orgId}/connections/llm-config`);
      setConfig(res.config);
      if (res.config) setForm((f) => ({ ...f, provider: res.config!.provider, model: res.config!.model ?? "" }));
    } catch { /* the card simply shows "not configured" */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const verifiedAt = formatWhen(config?.lastVerifiedAt, locale);

  return (
    <div className="card space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="font-semibold text-slate-800">{D.llmTitle}</div>
        {config ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${config.status === "verified" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
            {llmConfigStatusLabel(config, locale)}
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{D.llmNotConfigured}</span>
        )}
      </div>
      {config ? (
        <div className="space-y-1 text-xs text-slate-500">
          <div>Provider: <span className="font-medium text-slate-700">{config.provider}</span>{config.model ? <> · Model: <span className="font-medium text-slate-700">{config.model}</span></> : null}</div>
          {verifiedAt ? <div>{D.llmLastVerified}{verifiedAt}</div> : null}
        </div>
      ) : null}
      <p className="text-xs leading-relaxed text-slate-500">{D.llmIntro}</p>
      {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{error}</div> : null}
      {notice ? <div className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{notice}</div> : null}
      <form className="grid gap-3 lg:grid-cols-3" onSubmit={(e) => {
        e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
        setBusy(true); setError(""); setNotice("");
        void (async () => {
          try {
            const saved = await apiFetch<OrgLlmConfigView>(`organizations/${orgId}/connections/llm-config`, { method: "PUT", body: JSON.stringify(buildLlmConfigBody(form)) });
            setConfig(saved);
            setForm((f) => ({ ...f, apiKey: "" }));
            setNotice(D.llmSavedNotice);
            await load(); onChanged?.();
          } catch (err) {
            setError(err instanceof Error ? err.message : D.llmSaveFailed);
          } finally { setBusy(false); }
        })();
      }}>
        <label className="block text-sm">Provider
          <select className={inputCls} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
            {LLM_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">{D.llmModelLabel}<input className={inputCls} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={D.llmModelPlaceholder} /></label>
        <label className="block text-sm">API Key<input type="password" className={inputCls} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} required placeholder={config ? D.llmKeyChangePlaceholder : D.llmKeyPlaceholder} autoComplete="new-password" /></label>
        <div className="flex flex-wrap items-end gap-2">
          <button className="btn-primary disabled:opacity-50" disabled={busy}>{busy ? D.llmVerifying : config ? D.llmVerifyResaveBtn : D.llmSaveBtn}</button>
          {config ? (
            <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={busy} onClick={() => { const orgId = getOrganizationId(); if (!orgId) return; if (!window.confirm(D.llmRemoveConfirm)) return; setBusy(true); void (async () => { try { await apiFetch(`organizations/${orgId}/connections/llm-config`, { method: "DELETE" }); setConfig(null); setNotice(D.llmRemovedNotice); await load(); onChanged?.(); } catch (err) { setError(err instanceof Error ? err.message : D.llmRemoveFailed); } finally { setBusy(false); } })(); }}>{D.llmRemoveBtn}</button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
