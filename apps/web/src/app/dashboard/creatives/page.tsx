"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import { MediaImage } from "@/components/media-image";

interface Account { id: string; name: string; platform: string; integrationId?: string | null }
interface Asset { id: string; kind: string; name: string; sourceUrl: string; status: string; externalHash?: string | null; externalVideoId?: string | null; error?: string | null; adAccountId: string }

const STATUS: Record<string, string> = { ready: "badge-green", processing: "badge-amber", pending: "badge-slate", failed: "badge-red" };

export default function CreativesPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [form, setForm] = useState({ adAccountId: "", kind: "image", name: "", sourceUrl: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const orgId = typeof window !== "undefined" ? getOrganizationId() : null;

  const load = useCallback(async () => {
    if (!orgId) return;
    const list = await apiFetch<Account[]>(`/organizations/${orgId}/ad-accounts`).catch(() => []);
    const meta = list.filter((a) => a.platform === "meta" && a.integrationId);
    setAccounts(meta);
    if (meta[0]) setForm((f) => ({ ...f, adAccountId: f.adAccountId || meta[0].id }));
    setAssets(await apiFetch<Asset[]>(`/organizations/${orgId}/creatives`).catch(() => []));
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setBusy("upload"); setError("");
    try {
      const asset = await apiFetch<Asset>(`/organizations/${orgId}/creatives/upload`, { method: "POST", body: JSON.stringify(form) });
      setNotice(asset.status === "ready" ? "ছবি Meta তে আপলোড হয়েছে (Hash পাওয়া গেছে)।" : asset.status === "processing" ? "ভিডিও Meta প্রসেস করছে — কিছুক্ষণ পর Refresh চাপুন।" : `আপলোড সম্পন্ন হয়নি: ${asset.error ?? asset.status}`);
      setForm({ ...form, name: "", sourceUrl: "" });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">🎨 Creative Library</h1>
        <p className="text-sm text-slate-500">ছবি ও ভিডিও Meta তে আপলোড করে রাখুন; Campaign Builder এ এগুলোই ব্যবহার হবে। ছবি আপলোড হলে Meta একটি Hash দেয়, ভিডিও প্রসেস হতে সময় নেয়। Status তখনই "Ready" হয় যখন Meta নিশ্চিত করে।</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <form onSubmit={upload} className="card grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block text-sm">Ad Account
          <select className="input mt-1" value={form.adAccountId} onChange={(e) => setForm({ ...form, adAccountId: e.target.value })} required>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="block text-sm">ধরন
          <select className="input mt-1" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="image">ছবি</option><option value="video">ভিডিও</option>
          </select>
        </label>
        <label className="block text-sm">নাম<input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="যেমন: Eid Hero Banner" /></label>
        <label className="block text-sm lg:col-span-2">মিডিয়ার URL (https, পাবলিক)<input className="input mt-1" value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} required placeholder="https://.../banner.jpg" /></label>
        <span><button className="btn-primary" disabled={busy !== "" || accounts.length === 0}>{busy === "upload" ? "আপলোড হচ্ছে..." : "Meta তে আপলোড"}</button></span>
        {accounts.length === 0 ? <p className="text-sm text-amber-600 lg:col-span-4">আগে একটি Meta Ad Account কানেক্ট করুন (Ad Accounts পেজ)।</p> : null}
      </form>

      {assets.length === 0 ? (
        <EmptyState title="এখনো কোনো Creative নেই" description="প্রথম ছবি বা ভিডিও আপলোড করলে এখানে লাইব্রেরি তৈরি হবে।" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => (
            <div key={a.id} className="card space-y-2 p-4">
              {a.kind === "image" && a.sourceUrl ? (
                <MediaImage src={a.sourceUrl} alt={a.name} width={640} height={360} className="h-40 w-full rounded-lg object-cover" />
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{a.kind === "video" ? "🎬" : "🖼️"} {a.name}</span>
                <span className={STATUS[a.status] ?? "badge-slate"}>{a.status}</span>
              </div>
              <p className="truncate text-xs text-slate-400" title={a.sourceUrl}>{a.sourceUrl}</p>
              {a.externalHash ? <p className="text-xs text-slate-500">Image Hash: {a.externalHash.slice(0, 16)}…</p> : null}
              {a.externalVideoId ? <p className="text-xs text-slate-500">Video ID: {a.externalVideoId}</p> : null}
              {a.error ? <p className="text-xs text-red-600">{a.error}</p> : null}
              {a.kind === "video" && a.status !== "ready" ? (
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  if (!orgId) return;
                  setBusy(a.id);
                  try { await apiFetch(`/organizations/${orgId}/creatives/${a.id}/refresh-video`, { method: "POST" }); await load(); }
                  catch (err) { setError(err instanceof Error ? err.message : "Refresh failed"); }
                  finally { setBusy(""); }
                }}>{busy === a.id ? "যাচাই হচ্ছে..." : "Status যাচাই"}</button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
