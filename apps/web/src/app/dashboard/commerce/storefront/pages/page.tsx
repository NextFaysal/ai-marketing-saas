"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { BlocksEditor, cleanBlocks, normalizeBlock, type EditableBlock } from "../BlocksEditor";

// GC3 — staff content-pages manager. Consumes the staff routes:
//   GET    /organizations/:id/storefront/pages          -> { pages[] }
//   POST   /organizations/:id/storefront/pages
//   PATCH  /organizations/:id/storefront/pages/:pageId
//   DELETE /organizations/:id/storefront/pages/:pageId  (system pages refuse)
// System pages are auto-seeded server-side as unpublished drafts on the
// first GET; their slug is immutable and their template copy must be
// edited to the shop's real policy before publishing (banner below).
// Public URL: /shop/<orgSlug>/p/<slug>.

type PageBlock = EditableBlock;
interface ShopPage {
  id: string;
  slug: string;
  title: string;
  blocks: PageBlock[];
  published: boolean;
  showInFooter: boolean;
  showInMenu: boolean;
  sortOrder: number;
  isSystem: boolean;
  updatedAt: string;
}

const SYSTEM_DRAFT_BANNER = "⚠️ এটি একটি খসড়া টেমপ্লেট — প্রকাশের আগে নিজের ব্যবসার প্রকৃত নীতি অনুযায়ী লেখা সম্পাদনা করুন।";

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function StorefrontPagesManager() {
  const [pages, setPages] = useState<ShopPage[]>([]);
  const [orgSlug, setOrgSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // editor (selectedId === null + editorOpen === true means "new page")
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIsSystem, setSelectedIsSystem] = useState(false);
  const [eTitle, setETitle] = useState("");
  const [eSlug, setESlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [ePublished, setEPublished] = useState(false);
  const [eShowInFooter, setEShowInFooter] = useState(false);
  const [eShowInMenu, setEShowInMenu] = useState(false);
  const [eSortOrder, setESortOrder] = useState("0");
  const [blocks, setBlocks] = useState<PageBlock[]>([]);


  const load = useCallback(async (): Promise<ShopPage[]> => {
    const orgId = getOrganizationId();
    if (!orgId) { setLoading(false); setError("কোনো Organization নির্বাচিত নেই।"); return []; }
    setLoading(true);
    try {
      const [p, s] = await Promise.all([
        apiFetch<{ pages: ShopPage[] }>(`/organizations/${orgId}/storefront/pages`),
        apiFetch<{ organization: { slug: string } }>(`/organizations/${orgId}/storefront`).catch(() => null),
      ]);
      const list = p.pages ?? [];
      setPages(list);
      if (s?.organization?.slug) setOrgSlug(s.organization.slug);
      setError("");
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : "লোড ব্যর্থ");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function selectPage(p: ShopPage) {
    setSelectedId(p.id);
    setSelectedIsSystem(!!p.isSystem);
    setEditorOpen(true);
    setETitle(p.title ?? "");
    setESlug(p.slug ?? "");
    setSlugTouched(true);
    setEPublished(!!p.published);
    setEShowInFooter(!!p.showInFooter);
    setEShowInMenu(!!p.showInMenu);
    setESortOrder(String(p.sortOrder ?? 0));
    // Blocks arrive as { type, data } per the staff contract; seeded
    // system pages may still carry flat fields ({ type, text, … }) —
    // normalize those into the editor's data shape so nothing opens
    // blank. Saving always writes the contract shape { type, data }.
    setBlocks(Array.isArray(p.blocks) ? p.blocks.map((b) => normalizeBlock(b)) : []);
    setError(""); setNotice("");
  }

  function startNew() {
    setSelectedId(null);
    setSelectedIsSystem(false);
    setEditorOpen(true);
    setETitle("");
    setESlug("");
    setSlugTouched(false);
    setEPublished(false);
    setEShowInFooter(false);
    setEShowInMenu(false);
    setESortOrder("0");
    setBlocks([]);
    setError(""); setNotice("");
  }

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!eTitle.trim()) { setError("পেজের শিরোনাম দিন।"); return; }
    setBusy("save"); setError(""); setNotice("");
    const cleanedBlocks = cleanBlocks(blocks);
    const body: Record<string, any> = {
      title: eTitle.trim(),
      blocks: cleanedBlocks,
      published: ePublished,
      showInFooter: eShowInFooter,
      showInMenu: eShowInMenu,
      sortOrder: parseInt(eSortOrder || "0", 10) || 0,
    };
    // Slug is immutable for system pages — don't send it back at all.
    if (!selectedIsSystem) body.slug = eSlug.trim() || undefined;
    try {
      let savedId = selectedId;
      if (selectedId) {
        const out = await apiFetch<any>(`/organizations/${orgId}/storefront/pages/${selectedId}`, {
          method: "PATCH", body: JSON.stringify(body),
        });
        savedId = out?.page?.id ?? out?.id ?? selectedId;
        setNotice("পেজ আপডেট হয়েছে।");
      } else {
        const out = await apiFetch<any>(`/organizations/${orgId}/storefront/pages`, {
          method: "POST", body: JSON.stringify(body),
        });
        savedId = out?.page?.id ?? out?.id ?? null;
        setNotice("নতুন পেজ তৈরি হয়েছে।");
      }
      const list = await load();
      const saved = list.find((p) => p.id === savedId);
      if (saved) selectPage(saved);
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function deletePage(p: ShopPage) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`"${p.title}" পেজটি মুছে ফেলবেন? পাবলিক লিংকটি বন্ধ হয়ে যাবে।`)) return;
    setBusy(`del-${p.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/pages/${p.id}`, { method: "DELETE" });
      setNotice("পেজ মুছে ফেলা হয়েছে।");
      if (selectedId === p.id) { setSelectedId(null); setEditorOpen(false); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  function publicLink(slug: string) {
    const path = orgSlug && slug ? `/shop/${orgSlug}/p/${slug}` : "";
    if (!path) return "";
    return typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  }


  const hasUneditedSystemDraft = pages.some((p) => p.isSystem && !p.published);
  const editorLink = publicLink(eSlug.trim());

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">কনটেন্ট পেজ — দোকানের তথ্য পেজ</h1>
          <p className="text-sm text-slate-500">
            রিটার্ন নীতি, শর্তাবলি, আমাদের সম্পর্কে ইত্যাদি পেজ ব্লক দিয়ে সাজান। প্রকাশিত পেজ পাবলিক লিংকে দেখা যাবে;
            ফুটার/মেনুতে দেখানোর অপশনও এখান থেকেই।
          </p>
        </div>
        <Link href="/dashboard/commerce/storefront" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">← Storefront সেটিংস</Link>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[320px_1fr]">
        {/* List */}
        <div className="card space-y-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">সব পেজ ({pages.length})</div>
            <button type="button" onClick={startNew} className="btn-primary">+ নতুন পেজ</button>
          </div>
          {hasUneditedSystemDraft ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{SYSTEM_DRAFT_BANNER}</p>
          ) : null}
          {loading ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : pages.length === 0 ? (
            <p className="text-sm text-slate-500">এখনো কোনো পেজ নেই।</p>
          ) : (
            <ul className="space-y-2">
              {pages.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => selectPage(p)}
                    className={`w-full rounded-xl border p-3 text-left ${selectedId === p.id ? "border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-600" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{p.title}</span>
                      {p.isSystem ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">সিস্টেম</span> : null}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${p.published ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {p.published ? "প্রকাশিত" : "খসড়া"}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-xs text-slate-400">/p/{p.slug}</div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-500">
                      {p.showInFooter ? <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold">ফুটারে</span> : null}
                      {p.showInMenu ? <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold">মেনুতে</span> : null}
                      <span>ক্রম: {p.sortOrder ?? 0}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Editor */}
        {editorOpen ? (
          <div className="card space-y-4 p-5">
            <div className="font-semibold">{selectedId ? `সম্পাদনা — ${eTitle || "পেজ"}` : "নতুন পেজ"}</div>
            {selectedIsSystem ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800">{SYSTEM_DRAFT_BANNER}</p>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">শিরোনাম *
                <input className="input mt-1" value={eTitle} onChange={(e) => {
                  setETitle(e.target.value);
                  if (!selectedIsSystem && !slugTouched) setESlug(slugify(e.target.value));
                }} placeholder="যেমন: রিটার্ন নীতি" />
              </label>
              <label className="block text-sm">স্লাগ (URL)
                <input className="input mt-1 font-mono" value={eSlug} disabled={selectedIsSystem}
                  onChange={(e) => { setESlug(e.target.value); setSlugTouched(true); }} placeholder="return-policy" />
                {selectedIsSystem ? <span className="mt-1 block text-xs font-normal text-slate-500">সিস্টেম পেজের স্লাগ বদলানো যায় না।</span> : null}
              </label>
              <label className="block text-sm">ক্রম (sortOrder — ছোট = আগে)
                <input className="input mt-1" type="number" value={eSortOrder} onChange={(e) => setESortOrder(e.target.value)} />
              </label>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={ePublished} onChange={(e) => setEPublished(e.target.checked)} /> প্রকাশিত</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={eShowInFooter} onChange={(e) => setEShowInFooter(e.target.checked)} /> ফুটারে দেখান</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={eShowInMenu} onChange={(e) => setEShowInMenu(e.target.checked)} /> মেনুতে দেখান</label>
            </div>
            {editorLink ? (
              <p className="text-xs text-slate-500">
                পাবলিক লিংক:{" "}
                <Link href={editorLink} target="_blank" className="font-mono font-semibold text-indigo-700">{editorLink} ↗</Link>
                {!ePublished ? <span> (খসড়া অবস্থায় লিংকটি ক্রেতার জন্য খুলবে না)</span> : null}
              </p>
            ) : null}

            <div className="space-y-3 border-t pt-4">
              <div className="font-semibold">ব্লকসমূহ (টেনে অথবা ↑/↓ দিয়ে সাজান)</div>
              <BlocksEditor blocks={blocks} onChange={setBlocks} />
            </div>

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <button type="button" onClick={save} disabled={busy === "save" || !eTitle.trim()} className="btn-primary disabled:opacity-50">
                {busy === "save" ? "সংরক্ষণ হচ্ছে…" : selectedId ? "পেজ আপডেট করুন" : "পেজ তৈরি করুন"}
              </button>
              {selectedId && !selectedIsSystem ? (
                <button type="button" onClick={() => { const p = pages.find((x) => x.id === selectedId); if (p) void deletePage(p); }}
                  disabled={busy !== ""} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold text-rose-600 disabled:opacity-50">
                  পেজ মুছুন
                </button>
              ) : null}
              {selectedId && selectedIsSystem ? (
                <span className="self-center text-xs text-slate-500">সিস্টেম পেজ মোছা যায় না — চাইলে অপ্রকাশিত রেখে দিন।</span>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="card p-5">
            <p className="text-sm text-slate-500">বামে তালিকা থেকে একটি পেজ বেছে নিন, অথবা &ldquo;+ নতুন পেজ&rdquo; দিয়ে নতুন পেজ শুরু করুন।</p>
          </div>
        )}
      </div>
    </div>
  );
}
