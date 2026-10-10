"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";

interface Template { id: string; name: string; channel: string; subject?: string | null; body: string }
interface Broadcast { id: string; name: string; channel: string; status: string; totalRecipients: number; sentCount: number; failedCount: number; audienceType: string; audienceStage?: string | null; audienceSegment?: string | null; abVariant?: string | null; abGroupId?: string | null; sentAt?: string | null }
interface RfmReport { totalCustomers: number; segments: Record<string, number>; rows: { customerId: string; name: string; recencyDays: number; frequency: number; monetaryMinor: string; segment: string; r: number; f: number; m: number }[] }
const SEGMENTS = ["champions", "loyal", "big_spenders", "at_risk", "lost", "new", "regular"];
const SEG_LABEL: Record<string, string> = { champions: "🏆 Champions", loyal: "💙 Loyal", big_spenders: "💰 Big Spenders", at_risk: "⚠️ At Risk", lost: "💤 Lost", new: "🌱 New", regular: "Regular" };
interface Delivery { id: string; address: string; status: string; providerMessageId?: string | null; error?: string | null; createdAt: string }
interface ProviderStatus { email: { configured: boolean; transport: string }; sms: { configured: boolean; provider: string } }

const LEAD_STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"];

export default function MessagingPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [tplForm, setTplForm] = useState({ name: "", channel: "email", subject: "", body: "" });
  const [bcForm, setBcForm] = useState({ name: "", channel: "email", templateId: "", subject: "", body: "", audienceType: "customers", audienceStage: "qualified", audienceSegment: "at_risk", whatsappTemplateId: "", templateParams: "", abTest: false, abSubject: "", abBody: "", abWhatsappTemplateId: "" });
  const [rfm, setRfm] = useState<RfmReport | null>(null);
  const [waTemplates, setWaTemplates] = useState<{ id: string; name: string; language: string }[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const [t, b, s] = await Promise.all([
        apiFetch<Template[]>(`/organizations/${orgId}/messaging/templates`),
        apiFetch<Broadcast[]>(`/organizations/${orgId}/messaging/broadcasts`),
        apiFetch<ProviderStatus>(`/organizations/${orgId}/messaging/provider-status`),
      ]);
      setTemplates(t); setBroadcasts(b); setStatus(s);
      apiFetch<{ id: string; name: string; language: string }[]>(`/organizations/${orgId}/inbox/whatsapp-templates`).then(setWaTemplates).catch(() => undefined);
      apiFetch<RfmReport>(`/organizations/${orgId}/messaging/rfm`).then(setRfm).catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function wrap<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(key); setError("");
    try { return await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); return null; } finally { setBusy(""); }
  }

  const inputCls = "input mt-1";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Messaging</h1>
        <p className="text-sm text-slate-500">Email (SMTP) ও SMS (SSL Wireless) Broadcast। কোনো বার্তা Sent ধরা হয় শুধুমাত্র Provider নিশ্চিত করলে, প্রতিটি বার্তার Delivery রেকর্ড থাকে।</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {status ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className={`rounded-xl border p-4 text-sm ${status.email.configured ? "bg-green-50" : "bg-amber-50"}`}>
            <span className="font-semibold">Email (SMTP):</span> {status.email.configured ? "কনফিগার করা আছে" : "কনফিগার করা নেই, API Environment এ SMTP_HOST/SMTP_FROM বসান। লোকাল ডেভেলপমেন্টে docker-compose এর Mailpit (localhost:1025) ব্যবহার করুন।"}
          </div>
          <div className={`rounded-xl border p-4 text-sm ${status.sms.configured ? "bg-green-50" : "bg-amber-50"}`}>
            <span className="font-semibold">SMS (SSL Wireless):</span> {status.sms.configured ? "কনফিগার করা আছে" : "কনফিগার করা নেই, SMS_API_TOKEN ও SMS_SENDER_ID বসান (SSL Wireless অ্যাকাউন্ট লাগবে)।"}
          </div>
        </div>
      ) : null}

      <div className="space-y-3 card p-5">
        <div className="font-semibold">Templates ({templates.length})</div>
        {templates.map((t) => (
          <div key={t.id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex items-center justify-between"><span className="font-medium">{t.name}</span><span className="rounded bg-slate-200 px-2 py-0.5 text-xs capitalize">{t.channel}</span></div>
            {t.subject ? <div className="text-slate-600">Subject: {t.subject}</div> : null}
            <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{t.body}</p>
          </div>
        ))}
        <form className="grid gap-3 border-t pt-3 lg:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const res = await wrap("tpl", () => apiFetch(`/organizations/${orgId}/messaging/templates`, { method: "POST", body: JSON.stringify({ ...tplForm, subject: tplForm.channel === "email" ? tplForm.subject : undefined }) }));
          if (res) { setTplForm({ name: "", channel: "email", subject: "", body: "" }); await load(); }
        }}>
          <label className="block text-sm">Template এর নাম<input className={inputCls} value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} required /></label>
          <label className="block text-sm">Channel
            <select className={inputCls} value={tplForm.channel} onChange={(e) => setTplForm({ ...tplForm, channel: e.target.value })}>
              <option value="email">Email</option><option value="sms">SMS</option>
            </select>
          </label>
          {tplForm.channel === "email" ? <label className="block text-sm lg:col-span-2">Subject<input className={inputCls} value={tplForm.subject} onChange={(e) => setTplForm({ ...tplForm, subject: e.target.value })} required /></label> : null}
          <label className="block text-sm lg:col-span-2">Body (&#123;&#123;name&#125;&#125;, &#123;&#123;orderNumber&#125;&#125;, &#123;&#123;total&#125;&#125; এর মতো Variable চলবে)<textarea className={inputCls} rows={3} value={tplForm.body} onChange={(e) => setTplForm({ ...tplForm, body: e.target.value })} required /></label>
          <button className="self-end btn-primary disabled:opacity-50" disabled={busy !== ""}>Template তৈরি করুন</button>
        </form>
      </div>

      <div className="space-y-3 card p-5">
        <div className="card space-y-3">
          <h2 className="font-semibold">📊 RFM Segments (আসল অর্ডার থেকে)</h2>
          {rfm ? (<>
            <div className="flex flex-wrap gap-2">
              {SEGMENTS.map((s) => <span key={s} className="badge-indigo">{SEG_LABEL[s]}: {rfm.segments[s] ?? 0}</span>)}
              <span className="badge-slate">মোট সক্রিয় কাস্টমার: {rfm.totalCustomers}</span>
            </div>
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">কাস্টমার</th><th className="px-3 py-2">শেষ অর্ডার</th><th className="px-3 py-2">অর্ডার</th><th className="px-3 py-2">মোট কেনা</th><th className="px-3 py-2">Segment</th></tr></thead>
                <tbody>{rfm.rows.slice(0, 8).map((r) => (
                  <tr key={r.customerId} className="border-t"><td className="px-3 py-2 font-medium">{r.name}</td><td className="px-3 py-2">{r.recencyDays} দিন আগে</td><td className="px-3 py-2">{r.frequency}টি</td><td className="px-3 py-2">৳{(Number(r.monetaryMinor) / 100).toLocaleString("en-IN")}</td><td className="px-3 py-2">{SEG_LABEL[r.segment] ?? r.segment} (R{r.r} F{r.f} M{r.m})</td></tr>
                ))}</tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400">স্কোর ১–৫ আপনার নিজের কাস্টমার বেসের আপেক্ষিক (quintile)। বাতিল অর্ডার হিসাবের বাইরে।</p>
          </>) : <p className="text-sm text-slate-400">লোড হচ্ছে...</p>}
        </div>
        <div className="font-semibold">Broadcasts ({broadcasts.length})</div>
        {broadcasts.length === 0 ? <EmptyState title="কোনো Broadcast নেই" description="নিচের ফর্মে প্রথম Broadcast তৈরি করুন। পাঠানো হবে শুধু Send বাটনে ক্লিক করলে।" /> : broadcasts.map((b) => (
          <div key={b.id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><span className="font-medium">{b.name}</span> <span className="text-slate-400 capitalize">({b.channel})</span>
                <div className="text-xs text-slate-500">Audience: {b.audienceType}{b.audienceStage ? ` (${b.audienceStage})` : ""}{b.audienceSegment ? ` (${SEG_LABEL[b.audienceSegment] ?? b.audienceSegment})` : ""}{b.abVariant ? ` · 🧪 Variant ${b.abVariant}` : ""} · অবস্থা: {b.status}{b.sentAt ? ` · ${new Date(b.sentAt).toLocaleString()}` : ""} · মোট {b.totalRecipients}, Sent {b.sentCount}, Failed {b.failedCount}</div>
              </div>
              <div className="flex gap-2">
                <button className="rounded-lg border px-3 py-1.5" onClick={async () => { const o = getOrganizationId(); if (!o) return; const d = await wrap(`dlv-${b.id}`, () => apiFetch<Delivery[]>(`/organizations/${o}/messaging/broadcasts/${b.id}/deliveries`)); if (d) setDeliveries((s) => ({ ...s, [b.id]: d })); }}>Deliveries</button>
                {b.status === "draft" ? <button className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap(`send-${b.id}`, () => apiFetch<Broadcast>(`/organizations/${o}/messaging/broadcasts/${b.id}/send`, { method: "POST" })); if (r) { setNotice(`Broadcast "${r.name}": ${r.sentCount}টি Sent, ${r.failedCount}টি Failed।`); await load(); } }}>{busy === `send-${b.id}` ? "পাঠানো হচ্ছে..." : "Send করুন"}</button> : null}
              </div>
            </div>
            {(deliveries[b.id] ?? []).map((d) => (
              <div key={d.id} className="mt-1 flex items-center justify-between rounded bg-white px-2 py-1 text-xs">
                <span>{d.address} · {new Date(d.createdAt).toLocaleString()}</span>
                <span className={d.status === "sent" ? "text-green-600" : "text-red-600"}>{d.status}{d.providerMessageId ? ` · ${d.providerMessageId}` : ""}{d.error ? ` · ${d.error}` : ""}</span>
              </div>
            ))}
          </div>
        ))}
        <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const res = await wrap("bc", () => apiFetch(`/organizations/${orgId}/messaging/broadcasts`, {
            method: "POST",
            body: JSON.stringify(bcForm.channel === "whatsapp"
              ? { name: bcForm.name, channel: "whatsapp", whatsappTemplateId: bcForm.whatsappTemplateId, templateParams: bcForm.templateParams ? bcForm.templateParams.split(",").map((x) => x.trim()) : [], audienceType: bcForm.audienceType, audienceStage: bcForm.audienceType === "leads_stage" ? bcForm.audienceStage : undefined, audienceSegment: bcForm.audienceType === "segment" ? bcForm.audienceSegment : undefined, abTest: bcForm.abTest || undefined, abWhatsappTemplateId: bcForm.abTest ? bcForm.abWhatsappTemplateId : undefined }
              : { name: bcForm.name, channel: bcForm.channel, templateId: bcForm.templateId || undefined, subject: bcForm.templateId ? undefined : (bcForm.subject || undefined), body: bcForm.templateId ? undefined : bcForm.body, audienceType: bcForm.audienceType, audienceStage: bcForm.audienceType === "leads_stage" ? bcForm.audienceStage : undefined, audienceSegment: bcForm.audienceType === "segment" ? bcForm.audienceSegment : undefined, abTest: bcForm.abTest || undefined, abSubject: bcForm.abTest ? (bcForm.abSubject || undefined) : undefined, abBody: bcForm.abTest ? bcForm.abBody : undefined }),
          }));
          if (res) { setBcForm({ name: "", channel: "email", templateId: "", subject: "", body: "", audienceType: "customers", audienceStage: "qualified", audienceSegment: "at_risk", whatsappTemplateId: "", templateParams: "", abTest: false, abSubject: "", abBody: "", abWhatsappTemplateId: "" }); setNotice((res as { variants?: unknown[] }).variants ? "A/B Broadcast তৈরি হয়েছে — দুটি Draft (A ও B) পাঠানোর জন্য প্রস্তুত।" : "Broadcast Draft তৈরি হয়েছে।"); await load(); }
        }}>
          <label className="block text-sm">নাম<input className={inputCls} value={bcForm.name} onChange={(e) => setBcForm({ ...bcForm, name: e.target.value })} required /></label>
          <label className="block text-sm">Channel
            <select className={inputCls} value={bcForm.channel} onChange={(e) => setBcForm({ ...bcForm, channel: e.target.value, templateId: "" })}>
              <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp (Template)</option>
            </select>
          </label>
          {bcForm.channel === "whatsapp" ? (<>
            <label className="block text-sm">WhatsApp Template
              <select className={inputCls} value={bcForm.whatsappTemplateId} onChange={(e) => setBcForm({ ...bcForm, whatsappTemplateId: e.target.value })} required>
                <option value="">বেছে নিন</option>
                {waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
              </select>
            </label>
            <label className="block text-sm">Template প্যারামিটার (কমা দিয়ে, {"{name}"} ব্যবহার করা যায়)
              <input className={inputCls} value={bcForm.templateParams} onChange={(e) => setBcForm({ ...bcForm, templateParams: e.target.value })} placeholder="যেমন: {name}, ঈদ" />
            </label>
          </>) : (<>
          <label className="block text-sm">Template (ঐচ্ছিক)
            <select className={inputCls} value={bcForm.templateId} onChange={(e) => setBcForm({ ...bcForm, templateId: e.target.value })}>
              <option value="">নিজে লিখব</option>
              {templates.filter((t) => t.channel === bcForm.channel).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          </>)}
          {bcForm.channel !== "whatsapp" && !bcForm.templateId && bcForm.channel === "email" ? <label className="block text-sm">Subject<input className={inputCls} value={bcForm.subject} onChange={(e) => setBcForm({ ...bcForm, subject: e.target.value })} required /></label> : null}
          {bcForm.channel !== "whatsapp" && !bcForm.templateId ? <label className="block text-sm lg:col-span-2">Body<textarea className={inputCls} rows={2} value={bcForm.body} onChange={(e) => setBcForm({ ...bcForm, body: e.target.value })} required /></label> : null}
          {bcForm.channel === "whatsapp" ? <p className="text-xs text-slate-500 lg:col-span-2">WhatsApp Broadcast শুধুমাত্র Meta-অনুমোদিত Template দিয়েই যায় (২৪ ঘণ্টার Window এর বাইরে ফ্রি-ফর্ম মার্কেটিং বার্তা Meta নিষেধ করে)। প্রতিটি প্রাপকের জন্য আলাদা Delivery রেকর্ড থাকে।</p> : null}
          <label className="block text-sm">Audience
            <select className={inputCls} value={bcForm.audienceType} onChange={(e) => setBcForm({ ...bcForm, audienceType: e.target.value })}>
              <option value="customers">সব Customer (ঠিকানা থাকলে)</option><option value="leads_stage">একটি Lead Stage</option><option value="segment">RFM Segment</option>
            </select>
          </label>
          {bcForm.audienceType === "leads_stage" ? <label className="block text-sm">Lead Stage
            <select className={inputCls} value={bcForm.audienceStage} onChange={(e) => setBcForm({ ...bcForm, audienceStage: e.target.value })}>
              {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label> : null}
          {bcForm.audienceType === "segment" ? <label className="block text-sm">Segment
            <select className={inputCls} value={bcForm.audienceSegment} onChange={(e) => setBcForm({ ...bcForm, audienceSegment: e.target.value })}>
              {SEGMENTS.map((s) => <option key={s} value={s}>{SEG_LABEL[s]} ({rfm?.segments[s] ?? 0} জন)</option>)}
            </select>
          </label> : null}
          <label className="flex items-center gap-2 text-sm lg:col-span-2"><input type="checkbox" checked={bcForm.abTest} onChange={(e) => setBcForm({ ...bcForm, abTest: e.target.checked })} /> 🧪 A/B Test (অডিয়েন্স অর্ধেক-অর্ধেক ভাগ হয়ে দুটি Variant যাবে)</label>
          {bcForm.abTest && bcForm.channel !== "whatsapp" ? (<>
            {bcForm.channel === "email" ? <label className="block text-sm">Variant B Subject<input className={inputCls} value={bcForm.abSubject} onChange={(e) => setBcForm({ ...bcForm, abSubject: e.target.value })} placeholder="ফাঁকা রাখলে A এর Subject" /></label> : null}
            <label className="block text-sm lg:col-span-2">Variant B Body<textarea className={inputCls} rows={2} value={bcForm.abBody} onChange={(e) => setBcForm({ ...bcForm, abBody: e.target.value })} required /></label>
          </>) : null}
          {bcForm.abTest && bcForm.channel === "whatsapp" ? <label className="block text-sm">Variant B Template
            <select className={inputCls} value={bcForm.abWhatsappTemplateId} onChange={(e) => setBcForm({ ...bcForm, abWhatsappTemplateId: e.target.value })} required>
              <option value="">বেছে নিন</option>
              {waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
            </select>
          </label> : null}
          <button className="self-end btn-primary disabled:opacity-50" disabled={busy !== ""}>Draft তৈরি করুন</button>
        </form>
        <p className="text-xs text-slate-400">প্রতি Send এ সর্বোচ্চ ১০০০ জন (Environment এ বদলানো যায়)। তার বেশি হলে সার্ভার আটকে দেবে, নিজে থেকে কাউকে বাদ দেবে না।</p>
      </div>
    </div>
  );
}
