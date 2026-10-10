"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

interface Policy { id: string; type: string; title: string; content: string }
interface Doc { id: string; title: string; content: string; kind: string }

const POLICY_TYPES = ["shipping", "delivery", "refund", "return", "cancellation", "payment", "custom"];

export default function KnowledgePage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [profile, setProfile] = useState({ description: "", goals: "", brandVoice: "", industry: "", websiteUrl: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [policyForm, setPolicyForm] = useState({ type: "shipping", title: "", content: "" });
  const [docForm, setDocForm] = useState({ title: "", content: "" });

  const orgId = typeof window !== "undefined" ? getOrganizationId() : null;

  const load = useCallback(async () => {
    const id = getOrganizationId();
    if (!id) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      const [p, d, prof] = await Promise.all([
        apiFetch<Policy[]>(`/organizations/${id}/policies`),
        apiFetch<Doc[]>(`/organizations/${id}/knowledge-documents`),
        apiFetch<any>(`/organizations/${id}/business-profile`),
      ]);
      setPolicies(p); setDocs(d);
      if (prof) setProfile({
        description: prof.description ?? "", goals: prof.goals ?? "",
        brandVoice: prof.brandVoice ?? "", industry: prof.industry ?? "", websiteUrl: prof.websiteUrl ?? "",
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/business-profile`, { method: "PATCH", body: JSON.stringify({ ...profile, websiteUrl: profile.websiteUrl || "" }) });
    setNotice("প্রোফাইল সেভ হয়েছে");
  }
  async function addPolicy(e: React.FormEvent) {
    e.preventDefault(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/policies`, { method: "POST", body: JSON.stringify(policyForm) });
    setPolicyForm({ type: "shipping", title: "", content: "" }); await load();
  }
  async function addDoc(e: React.FormEvent) {
    e.preventDefault(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/knowledge-documents`, { method: "POST", body: JSON.stringify({ ...docForm, kind: "faq" }) });
    setDocForm({ title: "", content: "" }); await load();
  }

  const inputCls = "input mt-1";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Business Knowledge</h1>
        <p className="text-sm text-slate-500">AI শুধু এখানে থাকা যাচাইকৃত তথ্যই ব্যবহার করবে। এখানে না থাকা দাম, স্টক বা পলিসি AI বানিয়ে বলতে পারবে না, এটাই নিয়ম।</p>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {notice ? <p className="text-sm text-green-600">{notice}</p> : null}

      <form onSubmit={saveProfile} className="space-y-3 card p-5">
        <div className="font-semibold">ব্যবসার প্রোফাইল</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">ইন্ডাস্ট্রি<input className={inputCls} value={profile.industry} onChange={(e) => setProfile({ ...profile, industry: e.target.value })} /></label>
          <label className="block text-sm">ওয়েবসাইট<input className={inputCls} value={profile.websiteUrl} onChange={(e) => setProfile({ ...profile, websiteUrl: e.target.value })} /></label>
        </div>
        <label className="block text-sm">বিবরণ<textarea className={inputCls} rows={3} value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} /></label>
        <label className="block text-sm">লক্ষ্য<textarea className={inputCls} rows={2} value={profile.goals} onChange={(e) => setProfile({ ...profile, goals: e.target.value })} /></label>
        <label className="block text-sm">ব্র্যান্ড ভয়েস<input className={inputCls} value={profile.brandVoice} onChange={(e) => setProfile({ ...profile, brandVoice: e.target.value })} /></label>
        <button className="btn-primary">সেভ করুন</button>
      </form>

      <div className="card p-5">
        <div className="font-semibold">পলিসি (শিপিং, রিফান্ড ইত্যাদি)</div>
        {policies.length === 0 ? <p className="mt-2 text-sm text-slate-500">এখনো কোনো পলিসি নেই।</p> : (
          <ul className="mt-3 space-y-2">
            {policies.map((p) => <li key={p.id} className="rounded-lg bg-slate-50 p-3 text-sm"><span className="font-medium">{p.title}</span> <span className="text-slate-400">({p.type})</span><div className="text-slate-600">{p.content}</div></li>)}
          </ul>
        )}
        <form onSubmit={addPolicy} className="mt-4 grid grid-cols-3 gap-3">
          <select className="rounded-lg border px-3 py-2 text-sm" value={policyForm.type} onChange={(e) => setPolicyForm({ ...policyForm, type: e.target.value })}>
            {POLICY_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="শিরোনাম" value={policyForm.title} onChange={(e) => setPolicyForm({ ...policyForm, title: e.target.value })} required />
          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="বিস্তারিত" value={policyForm.content} onChange={(e) => setPolicyForm({ ...policyForm, content: e.target.value })} required />
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold">পলিসি যোগ করুন</button>
        </form>
      </div>

      <div className="card p-5">
        <div className="font-semibold">FAQ ও জ্ঞান ডকুমেন্ট</div>
        {docs.length === 0 ? <p className="mt-2 text-sm text-slate-500">এখনো কোনো ডকুমেন্ট নেই।</p> : (
          <ul className="mt-3 space-y-2">
            {docs.map((d) => <li key={d.id} className="rounded-lg bg-slate-50 p-3 text-sm"><span className="font-medium">{d.title}</span><div className="text-slate-600">{d.content}</div></li>)}
          </ul>
        )}
        <form onSubmit={addDoc} className="mt-4 grid grid-cols-2 gap-3">
          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="প্রশ্ন / শিরোনাম" value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} required />
          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="উত্তর / বিস্তারিত" value={docForm.content} onChange={(e) => setDocForm({ ...docForm, content: e.target.value })} required />
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold">FAQ যোগ করুন</button>
        </form>
      </div>
    </div>
  );
}
