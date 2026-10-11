"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

/**
 * CRM C4: shared custom-field UI. Definitions come from
 * GET /organizations/:id/crm/custom-fields?entity=...; values are
 * edited as raw strings here and converted by buildCustomFieldsPayload
 * (numbers -> numbers, empty -> explicit null clear when the record
 * already held a value). The server re-validates everything.
 */
export interface CustomFieldDef {
  id: string; entity: string; key: string; label: string;
  type: "text" | "number" | "date" | "select";
  options: string[] | null; required: boolean; sortOrder: number;
  archivedAt?: string | null;
}

export async function fetchCustomFieldDefs(entity: "lead" | "customer"): Promise<CustomFieldDef[]> {
  const orgId = getOrganizationId(); if (!orgId) return [];
  const all = await apiFetch<CustomFieldDef[]>(`/organizations/${orgId}/crm/custom-fields?entity=${entity}`);
  return all.filter((d) => !d.archivedAt);
}

/** Stored values -> raw input strings for the editor. */
export function customFieldsToRaw(defs: CustomFieldDef[], values?: Record<string, unknown> | null): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const d of defs) {
    const v = values?.[d.key];
    raw[d.key] = v === null || v === undefined ? "" : String(v);
  }
  return raw;
}

/** Raw editor strings -> the PATCH/POST payload. Keys whose input is
 * empty are OMITTED unless the record already held a value — then
 * they are sent as null (an explicit clear), matching the API. */
export function buildCustomFieldsPayload(
  defs: CustomFieldDef[],
  raw: Record<string, string>,
  existing?: Record<string, unknown> | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const v = (raw[d.key] ?? "").trim();
    if (!v) {
      if (existing && existing[d.key] !== null && existing[d.key] !== undefined) out[d.key] = null;
      continue;
    }
    out[d.key] = d.type === "number" ? Number(v) : v;
  }
  return out;
}

export function CustomFieldsEditor({ defs, raw, onChange }: {
  defs: CustomFieldDef[];
  raw: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  if (!defs.length) return null;
  return (
    <>
      {defs.map((d) => (
        <label key={d.id} className="block text-sm">{d.label}{d.required ? <span className="text-red-500"> *</span> : null}
          {d.type === "select" ? (
            <select className="input mt-1" value={raw[d.key] ?? ""} onChange={(e) => onChange(d.key, e.target.value)}>
              <option value="">—</option>
              {(d.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : d.type === "date" ? (
            <input type="date" className="input mt-1" value={raw[d.key] ?? ""} onChange={(e) => onChange(d.key, e.target.value)} />
          ) : d.type === "number" ? (
            <input type="number" step="any" className="input mt-1" value={raw[d.key] ?? ""} onChange={(e) => onChange(d.key, e.target.value)} />
          ) : (
            <input className="input mt-1" value={raw[d.key] ?? ""} onChange={(e) => onChange(d.key, e.target.value)} />
          )}
        </label>
      ))}
    </>
  );
}

const TYPE_LABEL: Record<string, string> = { text: "লেখা (text)", number: "সংখ্যা (number)", date: "তারিখ (date)", select: "তালিকা থেকে বাছাই (select)" };

/** Definition manager: list + create + archive/unarchive, for one
 * entity at a time (tab switcher). OWNER/ADMIN only on the server;
 * others see the API's 403 as an error message here. */
export function CustomFieldsManager() {
  const [entity, setEntity] = useState<"lead" | "customer">("lead");
  const [defs, setDefs] = useState<CustomFieldDef[]>([]);
  const [form, setForm] = useState({ label: "", type: "text", options: "", required: false });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      setDefs(await apiFetch<CustomFieldDef[]>(`/organizations/${orgId}/crm/custom-fields?entity=${entity}`));
    } catch { /* page-level errors elsewhere; manager stays empty */ }
  }, [entity]);
  useEffect(() => { load(); }, [load]);

  async function createDef(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/crm/custom-fields`, {
        method: "POST",
        body: JSON.stringify({
          entity, label: form.label, type: form.type, required: form.required,
          options: form.type === "select" ? form.options.split("\n").map((s) => s.trim()).filter(Boolean) : undefined,
        }),
      });
      setForm({ label: "", type: "text", options: "", required: false });
      setNotice("ফিল্ড তৈরি হয়েছে। key label থেকে নিজে তৈরি হয় (পরে বদলানো যায় না)।");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "তৈরি ব্যর্থ"); }
    finally { setBusy(false); }
  }

  async function toggleArchive(d: CustomFieldDef) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setNotice("");
    try {
      if (d.archivedAt) {
        await apiFetch(`/organizations/${orgId}/crm/custom-fields/${d.id}`, { method: "PATCH", body: JSON.stringify({ archived: false }) });
      } else {
        await apiFetch(`/organizations/${orgId}/crm/custom-fields/${d.id}/archive`, { method: "POST" });
      }
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "ব্যর্থ"); }
  }

  async function toggleRequired(d: CustomFieldDef) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/crm/custom-fields/${d.id}`, { method: "PATCH", body: JSON.stringify({ required: !d.required }) });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "ব্যর্থ"); }
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">🧩 কাস্টম ফিল্ড</div>
        <div className="flex gap-1 text-xs">
          {(["lead", "customer"] as const).map((e) => (
            <button key={e} onClick={() => setEntity(e)} className={`rounded-full px-3 py-1 font-semibold ${entity === e ? "bg-slate-900 text-white" : "bg-slate-100"}`}>
              {e === "lead" ? "Lead" : "Customer"}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        নিজের ব্যবসার দরকারি তথ্যের জন্য অতিরিক্ত ফিল্ড বানান — {entity === "lead" ? "Lead" : "Customer"}-এর বিস্তারিত পেজে মান বসানো/বদলানো যাবে,
        CSV এক্সপোর্টেও কলাম হিসেবে আসবে। Archive করলে ফিল্ডটি লুকিয়ে থাকবে কিন্তু আগের মান মুছবে না। শুধু OWNER/ADMIN ফিল্ড ম্যানেজ করতে পারেন।
      </p>
      {error ? <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-2 text-xs text-green-700">{notice}</p> : null}
      <div className="space-y-1.5">
        {defs.length === 0 ? <p className="text-sm text-slate-400">এখনো কোনো কাস্টম ফিল্ড নেই।</p> : defs.map((d) => (
          <div key={d.id} className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${d.archivedAt ? "opacity-50" : ""}`}>
            <span className="font-medium">{d.label}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">{d.key}</span>
            <span className="text-xs text-slate-500">{TYPE_LABEL[d.type] ?? d.type}</span>
            {d.type === "select" && d.options ? <span className="text-xs text-slate-400">{d.options.join(" / ")}</span> : null}
            {d.archivedAt ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px]">আর্কাইভ</span> : null}
            <span className="ml-auto flex gap-1.5">
              <button className="rounded border px-2 py-0.5 text-xs" onClick={() => toggleRequired(d)}>{d.required ? "আবশ্যক ✓" : "ঐচ্ছিক"}</button>
              <button className="rounded border px-2 py-0.5 text-xs" onClick={() => toggleArchive(d)}>{d.archivedAt ? "ফিরিয়ে আনুন" : "আর্কাইভ"}</button>
            </span>
          </div>
        ))}
      </div>
      <form onSubmit={createDef} className="grid gap-3 border-t pt-3 md:grid-cols-2">
        <label className="block text-sm">নতুন ফিল্ডের নাম (label)
          <input className="input mt-1" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="যেমন: জেলা" required />
        </label>
        <label className="block text-sm">ধরন
          <select className="input mt-1" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="text">লেখা (text)</option>
            <option value="number">সংখ্যা (number)</option>
            <option value="date">তারিখ (date)</option>
            <option value="select">তালিকা থেকে বাছাই (select)</option>
          </select>
        </label>
        {form.type === "select" ? (
          <label className="block text-sm md:col-span-2">অপশন (প্রতি লাইনে একটি)
            <textarea className="input mt-1" rows={3} value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} placeholder={"ঢাকা\nখুলনা\nচট্টগ্রাম"} />
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} />
          নতুন {entity === "lead" ? "Lead" : "Customer"} তৈরির সময় আবশ্যক {entity === "customer" ? "(Customer sync থেকে তৈরি হয় — আবশ্যক শুধু তথ্যের জন্য)" : ""}
        </label>
        <div><button className="btn-primary" disabled={busy}>{busy ? "তৈরি হচ্ছে..." : "ফিল্ড যোগ করুন"}</button></div>
      </form>
    </div>
  );
}
