"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { EmptyState, KpiCard } from "@repo/ui";

const STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
const STAGE_LABEL: Record<string, string> = { new: "নতুন", contacted: "যোগাযোগ হয়েছে", qualified: "Qualified", proposal: "Proposal পাঠানো", won: "Won", lost: "Lost" };

interface Lead { id: string; name: string; phone?: string | null; email?: string | null; source: string; stage: string; valueMinor?: string | null; currency: string; customerId?: string | null; updatedAt: string }
interface LeadDetail extends Lead { activities: { id: string; type: string; content: string; createdAt: string }[] }

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pipeline, setPipeline] = useState<{ byStage: Record<string, { count: number; valueMinor: string }>; totalLeads: number; openPipelineValueMinor: string } | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", source: "manual", value: "" });
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [dupGroups, setDupGroups] = useState<{ phoneKey: string; leads: { id: string; name: string; phone?: string | null; stage: string }[] }[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const [l, p] = await Promise.all([
        apiFetch<Lead[]>(`/organizations/${orgId}/leads${search ? `?search=${encodeURIComponent(search)}` : ""}`),
        apiFetch<any>(`/organizations/${orgId}/leads/pipeline`),
      ]);
      setLeads(l); setPipeline(p);
      apiFetch<{ phoneKey: string; leads: { id: string; name: string; phone?: string | null; stage: string }[] }[]>(`/organizations/${orgId}/leads/duplicates`).then(setDupGroups).catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, [search]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/leads`, { method: "POST", body: JSON.stringify({ ...form, value: form.value || undefined }) });
      setForm({ name: "", phone: "", email: "", source: "manual", value: "" });
      setNotice("Lead তৈরি হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function openDetail(lead: Lead) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setDetail(await apiFetch<LeadDetail>(`/organizations/${orgId}/leads/${lead.id}`));
  }

  async function changeStage(lead: Lead, stage: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    await load();
    if (detail?.id === lead.id) await openDetail(lead);
  }

  // M51: drag-and-drop is a convenience over the SAME stage PATCH.
  // The card moves optimistically; if the PATCH fails it snaps back
  // and the error is shown. The select below keeps working (mobile).
  async function dropStage(leadId: string, stage: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === stage) return;
    const before = leads;
    setLeads(leads.map((l) => (l.id === leadId ? { ...l, stage } : l)));
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ stage }) });
      await load();
    } catch (e) {
      setLeads(before);
      setError(`Stage বদলানো যায়নি — কার্ডটি আগের জায়গায় ফিরে গেছে। ${e instanceof Error ? e.message : ""}`);
    }
  }

  async function addNote() {
    const orgId = getOrganizationId(); if (!orgId || !detail || !note.trim()) return;
    setDetail(await apiFetch<LeadDetail>(`/organizations/${orgId}/leads/${detail.id}/notes`, { method: "POST", body: JSON.stringify({ content: note }) }));
    setNote("");
  }

  async function convert(lead: Lead) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await apiFetch<{ alreadyConverted: boolean }>(`/organizations/${orgId}/leads/${lead.id}/convert`, { method: "POST" });
    setNotice(res.alreadyConverted ? "এই Lead আগেই Customer এ রূপান্তরিত।" : "Customer এ রূপান্তর সম্পন্ন।");
    await load();
  }

  const inputCls = "input mt-1";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Leads & CRM</h1>
        {dupGroups.length > 0 ? (
          <div className="card space-y-2 border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-800">🔀 সম্ভাব্য একই ব্যক্তি (একই ফোনে একাধিক Lead)</div>
            {dupGroups.map((g) => (
              <div key={g.phoneKey} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">📞 …{g.phoneKey.slice(-6)}:</span>
                {g.leads.map((l) => <span key={l.id} className="rounded bg-white px-2 py-0.5 ring-1 ring-amber-200">{l.name} · {l.stage}</span>)}
                <button className="btn-warning btn-sm !px-2 !py-0.5 !text-[11px]" onClick={async () => {
                  const orgId = getOrganizationId(); if (!orgId) return;
                  const [target, ...rest] = g.leads;
                  try {
                    for (const src of rest) {
                      await apiFetch(`/organizations/${orgId}/leads/${target.id}/merge`, { method: "POST", body: JSON.stringify({ sourceLeadId: src.id }) });
                    }
                    setNotice(`"${target.name}" এর সাথে বাকিগুলো মার্জ হয়েছে।`);
                    await load();
                  } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
                }}>প্রথমটিতে মার্জ করুন</button>
              </div>
            ))}
            <p className="text-[11px] text-amber-700">মার্জ হলে বাকি Lead গুলোর কথোপকথন, নোট ও ট্যাগ প্রথম Lead এ চলে আসে; পুরনো Lead টি মুছে যায় না, শুধু তালিকা থেকে লুকিয়ে থাকে।</p>
          </div>
        ) : null}
        <p className="text-sm text-slate-500">Inbox থেকে নতুন গ্রাহক এলে Lead স্বয়ংক্রিয়ভাবে তৈরি হয়। এছাড়া হাতে Lead যোগ করে Pipeline এ এগিয়ে নিতে পারেন।</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {pipeline ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="মোট Lead" value={String(pipeline.totalLeads)} />
          <KpiCard label="Open Pipeline Value" value={formatMinor(BigInt(pipeline.openPipelineValueMinor))} hint="Lost বাদে সব Stage এর মূল্য" />
          <KpiCard label="Won" value={String(pipeline.byStage.won?.count ?? 0)} hint={formatMinor(BigInt(pipeline.byStage.won?.valueMinor ?? "0"))} />
          <KpiCard label="নতুন Lead" value={String(pipeline.byStage.new?.count ?? 0)} />
        </div>
      ) : null}

      <div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {STAGES.map((stage) => (
          <div key={stage} className="rounded-xl border bg-slate-50 p-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id) void dropStage(id, stage); }}>
            <div className="flex items-center justify-between text-sm font-semibold">{STAGE_LABEL[stage]}<span className="rounded-full bg-white px-2 py-0.5 text-xs">{pipeline?.byStage[stage]?.count ?? 0}</span></div>
            <div className="mt-2 space-y-2">
              {leads.filter((l) => l.stage === stage).map((lead) => (
                <div key={lead.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)} className="cursor-grab rounded-lg border bg-white p-2.5 text-sm active:cursor-grabbing">
                  <button className="font-medium hover:underline" onClick={() => openDetail(lead)}>{lead.name}</button>
                  <div className="text-xs text-slate-400">{lead.phone ?? lead.email ?? ""} · {lead.source}</div>
                  {lead.valueMinor ? <div className="text-xs font-semibold">{formatMinor(BigInt(lead.valueMinor), lead.currency)}</div> : null}
                  <select className="mt-1.5 w-full rounded border px-1 py-1 text-xs" value={lead.stage} onChange={(e) => changeStage(lead, e.target.value)}>
                    {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">কার্ড Drag করে অন্য Stage-এর কলামে ছাড়লেই Stage বদলে যায় (একই API)। ব্যর্থ হলে কার্ড আগের জায়গায় ফিরে যায় ও কারণ দেখায়। মোবাইলে কার্ডের নিচের Stage মেনু ব্যবহার করুন। Inbox-এর কথোপকথনের Pipeline (New Lead → Talking → Order Placed → Shipped → Completed) Inbox পেজের “পাইপলাইন বোর্ড” ভিউতে আছে।</p>
      {leads.length === 0 ? <EmptyState title="কোনো Lead নেই" description="নিচের ফর্মে প্রথম Lead যোগ করুন, অথবা Inbox কানেক্ট করুন, নতুন গ্রাহক মেসেজ দিলেই Lead তৈরি হবে।" /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={create} className="space-y-3 card p-5">
          <div className="font-semibold">নতুন Lead</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">নাম<input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label className="block text-sm">ফোন<input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label className="block text-sm">ইমেইল<input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="block text-sm">আনুমানিক মূল্য<input className={inputCls} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="0.00" /></label>
            <label className="block text-sm">উৎস
              <select className={inputCls} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                <option value="manual">Manual</option><option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option><option value="website">Website</option><option value="woocommerce">WooCommerce</option>
              </select>
            </label>
          </div>
          <button className="btn-primary">Lead যোগ করুন</button>
        </form>

        {detail ? (
          <div className="space-y-3 card p-5">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{detail.name}</div>
              {!detail.customerId ? <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={() => convert(detail)}>Customer এ রূপান্তর</button> : <span className="text-xs text-green-600">Customer সংযুক্ত</span>}
            </div>
            <div className="text-sm text-slate-500">{detail.phone ?? ""} {detail.email ?? ""} · উৎস: {detail.source} · Stage: {STAGE_LABEL[detail.stage]}</div>
            <div className="flex gap-2">
              <input className="flex-1 rounded-lg border px-3 py-2 text-sm" placeholder="নোট যোগ করুন..." value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn-primary btn-sm" onClick={addNote}>নোট সেভ</button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {detail.activities.map((a) => (
                <div key={a.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-xs font-semibold text-slate-400">{a.type} · {new Date(a.createdAt).toLocaleString()}</span>
                  <div>{a.content}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card p-5 text-sm text-slate-500">বোর্ডে কোনো Lead এর নামে ক্লিক করলে বিস্তারিত, নোট ও ইতিহাস এখানে দেখা যাবে।</div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input className="w-72 rounded-lg border bg-white px-3 py-2 text-sm" placeholder="নাম, ফোন বা ইমেইল দিয়ে খুঁজুন" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
    </div>
  );
}
