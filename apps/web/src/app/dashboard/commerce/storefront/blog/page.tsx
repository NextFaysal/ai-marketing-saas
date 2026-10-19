"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useConfirm, useToast } from "@repo/ui/client";
import { BlocksEditor, cleanBlocks, normalizeBlock, type EditableBlock } from "../BlocksEditor";

// AB6 (AX12) — staff blog manager. Consumes the staff routes:
//   GET    /organizations/:id/storefront/blog           -> { posts[] }
//   POST   /organizations/:id/storefront/blog
//   PATCH  /organizations/:id/storefront/blog/:postId
//   DELETE /organizations/:id/storefront/blog/:postId
// Public URLs: /shop/<orgSlug>/blog and /shop/<orgSlug>/blog/<slug>
// (drafts answer 404 publicly).

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  blocks: EditableBlock[];
  tags: string[];
  status: "draft" | "published" | string;
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
}

type StatusFilter = "all" | "draft" | "published";

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
function parseTags(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

export default function StorefrontBlogManager() {
  const { dict, t, locale } = useLocale();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [orgSlug, setOrgSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eSlug, setESlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [eExcerpt, setEExcerpt] = useState("");
  const [eCoverImageUrl, setECoverImageUrl] = useState("");
  const [eTags, setETags] = useState("");
  const [eAuthorName, setEAuthorName] = useState("");
  const [eSeoTitle, setESeoTitle] = useState("");
  const [eSeoDescription, setESeoDescription] = useState("");
  const [eStatus, setEStatus] = useState<"draft" | "published">("draft");
  const [blocks, setBlocks] = useState<EditableBlock[]>([]);

  const load = useCallback(async (): Promise<BlogPost[]> => {
    const orgId = getOrganizationId();
    if (!orgId) { setLoading(false); setError(dict.commerce.noOrganizationSelected); return []; }
    setLoading(true);
    try {
      const [b, s] = await Promise.all([
        apiFetch<any>(`/organizations/${orgId}/storefront/blog`),
        apiFetch<{ organization: { slug: string } }>(`/organizations/${orgId}/storefront`).catch(() => null),
      ]);
      const list: BlogPost[] = (Array.isArray(b) ? b : b?.posts ?? b?.items ?? []) as BlogPost[];
      setPosts(list);
      if (s?.organization?.slug) setOrgSlug(s.organization.slug);
      setError("");
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.loadingFailed);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function selectPost(p: BlogPost) {
    setSelectedId(p.id);
    setEditorOpen(true);
    setETitle(p.title ?? "");
    setESlug(p.slug ?? "");
    setSlugTouched(true);
    setEExcerpt(p.excerpt ?? "");
    setECoverImageUrl(p.coverImageUrl ?? "");
    setETags((p.tags ?? []).join(", "));
    setEAuthorName(p.authorName ?? "");
    setESeoTitle(p.seoTitle ?? "");
    setESeoDescription(p.seoDescription ?? "");
    setEStatus(p.status === "published" ? "published" : "draft");
    setBlocks(Array.isArray(p.blocks) ? p.blocks.map((b) => normalizeBlock(b)) : []);
    setError("");
  }

  function startNew() {
    setSelectedId(null);
    setEditorOpen(true);
    setETitle(""); setESlug(""); setSlugTouched(false);
    setEExcerpt(""); setECoverImageUrl(""); setETags("");
    setEAuthorName(""); setESeoTitle(""); setESeoDescription("");
    setEStatus("draft");
    setBlocks([]);
    setError("");
  }

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!eTitle.trim()) { setError(dict.commerce.giveThePostATitle); return; }
    setBusy("save"); setError("");
    const body: Record<string, any> = {
      title: eTitle.trim(),
      slug: eSlug.trim() || undefined,
      excerpt: eExcerpt.trim() || null,
      coverImageUrl: eCoverImageUrl.trim() || null,
      tags: parseTags(eTags),
      authorName: eAuthorName.trim() || null,
      seoTitle: eSeoTitle.trim() || null,
      seoDescription: eSeoDescription.trim() || null,
      status: eStatus,
      blocks: cleanBlocks(blocks),
    };
    try {
      let savedId = selectedId;
      if (selectedId) {
        const out = await apiFetch<any>(`/organizations/${orgId}/storefront/blog/${selectedId}`, {
          method: "PATCH", body: JSON.stringify(body),
        });
        savedId = out?.post?.id ?? out?.id ?? selectedId;
        toast({ title: dict.commerce.blogPostUpdated, tone: "success" });
      } else {
        const out = await apiFetch<any>(`/organizations/${orgId}/storefront/blog`, {
          method: "POST", body: JSON.stringify(body),
        });
        savedId = out?.post?.id ?? out?.id ?? null;
        toast({ title: dict.commerce.newBlogPostCreated, tone: "success" });
      }
      const list = await load();
      const saved = list.find((p) => p.id === savedId);
      if (saved) selectPost(saved);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.saveFailed); }
    finally { setBusy(""); }
  }

  async function setStatus(p: BlogPost, status: "draft" | "published") {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`status-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/blog/${p.id}`, {
        method: "PATCH", body: JSON.stringify({ status }),
      });
      toast({ title: status === "published" ? t("commerce.published2", { title: p.title }) : t("commerce.movedBackToDraft", { title: p.title }), tone: "success" });
      if (selectedId === p.id) setEStatus(status);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.statusChangeFailed2); }
    finally { setBusy(""); }
  }

  async function deletePost(p: BlogPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: t("commerce.deleteThePost", { title: p.title }), body: dict.commerce.thePublicLinkWillBe, danger: true, confirmLabel: dict.commerce.delete2 }))) return;
    setBusy(`del-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/blog/${p.id}`, { method: "DELETE" });
      toast({ title: dict.commerce.blogPostDeleted, tone: "success" });
      if (selectedId === p.id) { setSelectedId(null); setEditorOpen(false); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.deleteFailed); }
    finally { setBusy(""); }
  }

  function publicLink(slug: string) {
    const path = orgSlug && slug ? `/shop/${orgSlug}/blog/${slug}` : "";
    if (!path) return "";
    return typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  }

  const visible = posts.filter((p) => filter === "all" || p.status === filter);
  const editorLink = publicLink(eSlug.trim());

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{dict.commerce.blogTheShopSBlog}</h1>
          <p className="text-sm text-slate-500">
            {dict.commerce.arrangeProductGuideTipsAnnouncement}</p>
        </div>
        <Link href="/dashboard/commerce/storefront" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">{dict.commerce.storefrontSettings}</Link>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <div className="grid items-start gap-6 lg:grid-cols-[320px_1fr]">
        <div className="card space-y-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">{dict.commerce.allPosts}{posts.length})</div>
            <button type="button" onClick={startNew} className="btn-primary">{dict.commerce.newPost}</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([["all", dict.commerce.all], ["draft", dict.commerce.draft], ["published", dict.commerce.published]] as [StatusFilter, string][]).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setFilter(v)}
                className={`rounded-full px-3 py-1 text-xs font-bold ${filter === v ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                {label}
              </button>
            ))}
          </div>
          {loading ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : visible.length === 0 ? (
            <p className="text-sm text-slate-500">{dict.commerce.noPostsInThisFilter}</p>
          ) : (
            <ul className="space-y-2">
              {visible.map((p) => (
                <li key={p.id} className={`rounded-xl border p-3 ${selectedId === p.id ? "border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-600" : "border-slate-200 bg-white"}`}>
                  <button type="button" onClick={() => selectPost(p)} className="w-full text-left">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold">{p.title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${p.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {p.status === "published" ? dict.commerce.published : dict.commerce.draft}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-xs text-slate-400">/blog/{p.slug}</div>
                  </button>
                  <div className="mt-2 flex gap-1.5">
                    {p.status === "published" ? (
                      <button type="button" disabled={busy !== ""} onClick={() => void setStatus(p, "draft")} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold disabled:opacity-50">{dict.commerce.unpublish}</button>
                    ) : (
                      <button type="button" disabled={busy !== ""} onClick={() => void setStatus(p, "published")} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-50">{dict.commerce.publish}</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {editorOpen ? (
          <div className="card space-y-4 p-5">
            <div className="font-semibold">{selectedId ? t("commerce.edit2", { p0: eTitle || dict.commerce.post }) : dict.commerce.newPost2}</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">{dict.commerce.title2}<input className="input mt-1" value={eTitle} onChange={(e) => {
                  setETitle(e.target.value);
                  if (!slugTouched) setESlug(slugify(e.target.value));
                }} placeholder={dict.commerce.eGAGuideTo} />
              </label>
              <label className="block text-sm">{dict.commerce.slugURL}<input className="input mt-1 font-mono" value={eSlug}
                  onChange={(e) => { setESlug(e.target.value); setSlugTouched(true); }} placeholder="size-guide" />
              </label>
              <label className="block text-sm">{dict.commerce.authorAuthorName}<input className="input mt-1" value={eAuthorName} onChange={(e) => setEAuthorName(e.target.value)} placeholder={dict.commerce.eGTheShopTeam} />
              </label>
              <label className="block text-sm">{dict.commerce.status2}<select className="input mt-1" value={eStatus} onChange={(e) => setEStatus(e.target.value as "draft" | "published")}>
                  <option value="draft">{dict.commerce.draft}</option>
                  <option value="published">{dict.commerce.published}</option>
                </select>
              </label>
              <label className="block text-sm md:col-span-2">{dict.commerce.summaryExcerpt}<textarea className="input mt-1" rows={2} value={eExcerpt} onChange={(e) => setEExcerpt(e.target.value)} placeholder={dict.commerce.aShortDescriptionShownIn} />
              </label>
              <label className="block text-sm md:col-span-2">{dict.commerce.coverImageURLCoverImageUrl}<input className="input mt-1" value={eCoverImageUrl} onChange={(e) => setECoverImageUrl(e.target.value)} placeholder="https://…" />
              </label>
              <label className="block text-sm md:col-span-2">{dict.commerce.tagsSeparateWithCommas}<input className="input mt-1" value={eTags} onChange={(e) => setETags(e.target.value)} placeholder={dict.commerce.guidesTipsOffers} />
              </label>
              <label className="block text-sm">{dict.commerce.sEOTitle}<input className="input mt-1" value={eSeoTitle} onChange={(e) => setESeoTitle(e.target.value)} placeholder={dict.commerce.emptyThePostTitle} />
              </label>
              <label className="block text-sm">{dict.commerce.sEODescription}<input className="input mt-1" value={eSeoDescription} onChange={(e) => setESeoDescription(e.target.value)} placeholder={dict.commerce.emptyTheSummary} />
              </label>
            </div>
            {editorLink ? (
              <p className="text-xs text-slate-500">
                {dict.commerce.publicLink2}{" "}
                <Link href={editorLink} target="_blank" className="font-mono font-semibold text-indigo-700">{editorLink} ↗</Link>
                {eStatus !== "published" ? <span> {dict.commerce.inDraftStateTheLink}</span> : null}
              </p>
            ) : null}

            <div className="space-y-3 border-t pt-4">
              <div className="font-semibold">{dict.commerce.blocksRearrangeByDraggingOr}</div>
              <BlocksEditor blocks={blocks} onChange={setBlocks} />
            </div>

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <button type="button" onClick={save} disabled={busy === "save" || !eTitle.trim()} className="btn-primary disabled:opacity-50">
                {busy === "save" ? dict.commerce.saving : selectedId ? dict.commerce.updatePost : dict.commerce.createPost}
              </button>
              {selectedId ? (
                <button type="button" onClick={() => { const p = posts.find((x) => x.id === selectedId); if (p) void deletePost(p); }}
                  disabled={busy !== ""} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold text-rose-600 disabled:opacity-50">
                  {dict.commerce.deletePost}</button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="card p-5">
            <p className="text-sm text-slate-500">{dict.commerce.selectAPostFromThe}</p>
          </div>
        )}
      </div>
    </div>
  );
}
