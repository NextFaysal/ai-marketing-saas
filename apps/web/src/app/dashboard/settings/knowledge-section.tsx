"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

interface Policy { id: string; type: string; title: string; content: string }
interface Doc { id: string; title: string; content: string; kind: string; source?: string }

const POLICY_TYPES = ["shipping", "delivery", "refund", "return", "cancellation", "payment", "custom"];

/**
 * Business Knowledge — moved from the standalone /dashboard/knowledge
 * page into Organization Settings (owner decision 2026-10-15: it is
 * not used regularly, so it should not be a top-level nav page).
 * Policies, FAQ / knowledge documents and the file-upload form are the
 * knowledge page's code, moved verbatim. The ব্যবসার প্রোফাইল form is
 * deliberately NOT duplicated here: the settings page's BusinessHub
 * already edits the same business-profile record (industry,
 * websiteUrl, description, goals, brandVoice — plus more) through its
 * single form, so the page keeps exactly one profile form.
 */
export function BusinessKnowledgeSection() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [policyForm, setPolicyForm] = useState({ type: "shipping", title: "", content: "" });
  const [docForm, setDocForm] = useState({ title: "", content: "" });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const orgId = typeof window !== "undefined" ? getOrganizationId() : null;

  const load = useCallback(async () => {
    const id = getOrganizationId();
    if (!id) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      const [p, d] = await Promise.all([
        apiFetch<Policy[]>(`/organizations/${id}/policies`),
        apiFetch<Doc[]>(`/organizations/${id}/knowledge-documents`),
      ]);
      setPolicies(p); setDocs(d);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
  }, []);

  useEffect(() => { load(); }, [load]);

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
  async function uploadDocFile(e: React.FormEvent) {
    e.preventDefault(); if (!orgId || !uploadFile) return;
    setUploading(true); setUploadError("");
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      const token = getToken();
      const res = await fetch(`${API_URL}/organizations/${orgId}/knowledge-documents/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `আপলোড ব্যর্থ হয়েছে (${res.status})`);
      }
      const result = await res.json();
      setNotice(`ফাইল থেকে ${result.documentsCreated}টি ডকুমেন্ট তৈরি হয়েছে`);
      setUploadFile(null);
      await load();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "আপলোড ব্যর্থ হয়েছে");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section id="hub-knowledge" className="card scroll-mt-24 p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="stat-icon stat-icon-brand !h-10 !w-10 text-lg">📚</span>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight text-slate-900">Business Knowledge</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">AI শুধু এখানে থাকা যাচাইকৃত তথ্যই ব্যবহার করবে। এখানে না থাকা দাম, স্টক বা পলিসি AI বানিয়ে বলতে পারবে না, এটাই নিয়ম।</p>
        </div>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {notice ? <p className="text-sm text-green-600">{notice}</p> : null}
      <p className="text-[13px] leading-snug text-slate-500">
        ব্যবসার প্রোফাইল (বিবরণ, ইন্ডাস্ট্রি, ওয়েবসাইট, লক্ষ্য, ব্র্যান্ড ভয়েস) এই পেজের{" "}
        <a href="#hub-identity" className="font-medium text-indigo-600 underline">ব্যবসার পরিচিতি</a>{" "}
        সেকশনে সম্পাদনা হয়।
      </p>

      <div className="mt-6">
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

      <div className="mt-6 border-t border-slate-100 pt-6">
        <div className="font-semibold">FAQ ও জ্ঞান ডকুমেন্ট</div>
        {docs.length === 0 ? <p className="mt-2 text-sm text-slate-500">এখনো কোনো ডকুমেন্ট নেই।</p> : (
          <ul className="mt-3 space-y-2">
            {docs.map((d) => (
              <li key={d.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <span className="font-medium">{d.title}</span>{" "}
                {d.source && d.source.startsWith("file:")
                  ? <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">📄 {d.source.slice(5)}</span>
                  : <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">✍️ হাতে লেখা</span>}
                <div className="text-slate-600">{d.content}</div>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addDoc} className="mt-4 grid grid-cols-2 gap-3">
          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="প্রশ্ন / শিরোনাম" value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} required />
          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="উত্তর / বিস্তারিত" value={docForm.content} onChange={(e) => setDocForm({ ...docForm, content: e.target.value })} required />
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold">FAQ যোগ করুন</button>
        </form>
        <form onSubmit={uploadDocFile} className="mt-4 border-t pt-4">
          <div className="text-sm font-medium">ফাইল থেকে যোগ করুন (PDF, DOCX, TXT, MD — সর্বোচ্চ ১০MB)</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".pdf,.txt,.md,.docx"
              className="text-sm"
              onChange={(e) => { setUploadFile(e.target.files?.[0] ?? null); setUploadError(""); }}
            />
            <button className="rounded-lg border px-4 py-2 text-sm font-semibold" disabled={!uploadFile || uploading}>
              {uploading ? "আপলোড হচ্ছে…" : "ফাইল আপলোড করুন"}
            </button>
          </div>
          {uploadError ? <p className="mt-2 text-sm text-red-600">{uploadError}</p> : null}
        </form>
      </div>
    </section>
  );
}
