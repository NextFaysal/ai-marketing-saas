"use client";
import React, { useCallback, useEffect, useState } from "react";
import { API_URL, apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { fmtMoneyBn } from "@/lib/money-bn";
import {
  VIDEO_HONESTY_NOTE, VIDEO_LANGUAGES, VIDEO_TEMPLATES, buildCreateProjectPayload,
  buildPublishPayload, canPublish, canRetryRender, isPublished, projectStatusChip,
  socialPostHref, templateLabel, videoPreviewSrc, type VideoProjectView,
} from "@/lib/video-studio";
import type { LiveCatalogProduct } from "@/lib/live-commerce";
import type { SocialAccount } from "../social-posts/components/shared";
import { useToast } from "@repo/ui/client";

// NF2 (FB1 Part C) — Short Video Studio. Projects render ONE
// product into a vertical template video LOCALLY (ffmpeg — see
// the honesty note rendered on the page; nothing here is
// AI-generated). Failed projects show the API's errorLabel
// verbatim; ready projects preview via the asset URL the API
// returns; publish rides the API's SocialService.createPost
// path and shows the returned socialPostId.

export default function VideoStudioPage() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<VideoProjectView[]>([]);
  const [catalog, setCatalog] = useState<LiveCatalogProduct[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  // Create-project form.
  const [productId, setProductId] = useState("");
  const [template, setTemplate] = useState<string>("showcase");
  const [language, setLanguage] = useState<string>("bn");
  const [offerText, setOfferText] = useState("");

  // Publish form (per project, opened inline).
  const [publishOpenId, setPublishOpenId] = useState<string | null>(null);
  const [publishAccountId, setPublishAccountId] = useState("");
  const [publishCaption, setPublishCaption] = useState("");

  const loadProjects = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setProjects(await apiFetch<VideoProjectView[]>(`/organizations/${orgId}/video-projects`));
  }, []);

  useEffect(() => {
    (async () => {
      const orgId = getOrganizationId();
      if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
      try {
        await loadProjects();
        const [prod, acc] = await Promise.all([
          apiFetch<unknown>(`/organizations/${orgId}/products?pageSize=100`).catch(() => null),
          apiFetch<SocialAccount[]>(`/organizations/${orgId}/social/accounts`).catch(() => [] as SocialAccount[]),
        ]);
        const list: unknown[] = Array.isArray(prod) ? prod
          : Array.isArray((prod as { items?: unknown[] })?.items) ? (prod as { items: unknown[] }).items : [];
        const products = list.filter((p): p is LiveCatalogProduct =>
          !!p && typeof p === "object" && typeof (p as LiveCatalogProduct).id === "string"
          && typeof (p as LiveCatalogProduct).name === "string");
        setCatalog(products);
        if (products[0]) setProductId(products[0].id);
        setAccounts(acc);
      } catch (e) {
        setError(e instanceof Error ? e.message : "লোড করা যায়নি");
      } finally { setLoading(false); }
    })();
  }, [loadProjects]);

  const createProject = async () => {
    const orgId = getOrganizationId();
    if (!orgId || !productId || busy) return;
    setBusy("create"); setError("");
    try {
      await apiFetch<VideoProjectView>(`/organizations/${orgId}/video-projects`, {
        method: "POST",
        body: JSON.stringify(buildCreateProjectPayload({ productId, template, language, offerText })),
      });
      setOfferText("");
      await loadProjects();
      toast({ title: "ভিডিও প্রজেক্ট তৈরি হয়েছে — রেন্ডার শুরু হয়েছে", tone: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "প্রজেক্ট তৈরি করা যায়নি");
    } finally { setBusy(""); }
  };

  const retryRender = async (project: VideoProjectView) => {
    const orgId = getOrganizationId();
    if (!orgId || busy) return;
    setBusy(`render-${project.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/video-projects/${project.id}/render`, { method: "POST" });
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : "আবার রেন্ডার করা যায়নি");
    } finally { setBusy(""); }
  };

  const publish = async (project: VideoProjectView) => {
    const orgId = getOrganizationId();
    if (!orgId || busy) return;
    setBusy(`publish-${project.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/video-projects/${project.id}/publish`, {
        method: "POST",
        body: JSON.stringify(buildPublishPayload({ socialAccountId: publishAccountId, caption: publishCaption })),
      });
      setPublishOpenId(null);
      setPublishCaption("");
      await loadProjects();
      toast({ title: "Social পোস্ট (ড্রাফট) তৈরি হয়েছে", tone: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish করা যায়নি");
    } finally { setBusy(""); }
  };

  return (
    <div className="space-y-6">
      <h1 className="page-title">ভিডিও স্টুডিও</h1>
      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{VIDEO_HONESTY_NOTE}</p>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {/* ---------- create project ---------- */}
      <section className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="text-sm font-semibold">নতুন ভিডিও প্রজেক্ট</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">পণ্য
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm">
              {catalog.length === 0 ? <option value="">কোনো পণ্য নেই</option> : null}
              {catalog.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {fmtMoneyBn(p.priceMinor)}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">টেমপ্লেট
            <select value={template} onChange={(e) => setTemplate(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm">
              {VIDEO_TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">ভাষা
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm">
              {VIDEO_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">অফারের লেখা (ঐচ্ছিক)
            <input
              value={offerText}
              onChange={(e) => setOfferText(e.target.value)}
              placeholder="যেমন: ২০% ছাড় — আজই শেষ"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">অফারের লেখা শুধু “অফার” টেমপ্লেটে ভিডিওতে দেখানো হয়। পণ্যের ছবি থেকেই ভিডিও তৈরি হয় — পণ্যে ছবি না থাকলে রেন্ডার ব্যর্থ হবে।</p>
        <button type="button" className="btn-primary" disabled={!productId || busy === "create"} onClick={createProject}>
          {busy === "create" ? "তৈরি হচ্ছে…" : "ভিডিও তৈরি করুন"}
        </button>
      </section>

      {/* ---------- project list ---------- */}
      <section className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">প্রজেক্টসমূহ</h2>
          <button type="button" className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => loadProjects().catch(() => undefined)}>
            রিফ্রেশ
          </button>
        </div>
        {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : projects.length === 0 ? (
          <p className="text-sm text-slate-500">এখনো কোনো ভিডিও প্রজেক্ট নেই — উপরে একটি পণ্য বেছে ভিডিও তৈরি করুন।</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => {
              const chip = projectStatusChip(p.status);
              const src = p.status === "ready" ? videoPreviewSrc(p.assetUrl, API_URL) : null;
              const published = isPublished(p);
              return (
                <li key={p.id} className="space-y-2 rounded-xl border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.productName ?? p.productId}</span>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}>{chip.label}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {templateLabel(p.template)} · {p.language === "en" ? "English" : "বাংলা"}
                    {p.offerText ? ` · “${p.offerText}”` : ""} · {new Date(p.createdAt).toLocaleString("bn-BD")}
                  </div>

                  {p.status === "failed" && p.errorLabel ? (
                    <p className="rounded-lg bg-red-50 p-2.5 text-xs font-medium text-red-700">{p.errorLabel}</p>
                  ) : null}

                  {src ? (
                    <>
                      <video src={src} controls playsInline className="aspect-[9/16] w-full rounded-lg bg-black object-contain" />
                      <a href={src} download className="inline-block text-xs font-semibold text-indigo-600 hover:underline">
                        ভিডিও ডাউনলোড করুন
                      </a>
                    </>
                  ) : null}

                  {published ? (
                    <p className="rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800">
                      Publish হয়েছে — Social Post ID: {p.socialPostId}{" "}
                      <a href={socialPostHref(p)} className="font-semibold text-indigo-600 hover:underline">Social Posts-এ দেখুন</a>
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {canRetryRender(p) ? (
                      <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" disabled={busy === `render-${p.id}`} onClick={() => retryRender(p)}>
                        {busy === `render-${p.id}` ? "রেন্ডার হচ্ছে…" : "আবার রেন্ডার করুন"}
                      </button>
                    ) : null}
                    {canPublish(p) && !published ? (
                      <button
                        type="button"
                        className="btn-primary px-3 py-1.5 text-xs"
                        onClick={() => { setPublishOpenId(publishOpenId === p.id ? null : p.id); setPublishAccountId(""); setPublishCaption(""); }}
                      >
                        Publish করুন
                      </button>
                    ) : null}
                  </div>

                  {publishOpenId === p.id && canPublish(p) && !published ? (
                    <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                      <select value={publishAccountId} onChange={(e) => setPublishAccountId(e.target.value)} className="w-full rounded-lg border bg-white px-2 py-2 text-sm">
                        <option value="">প্রথম connected অ্যাকাউন্ট (ডিফল্ট)</option>
                        {accounts.filter((a) => a.status === "connected").map((a) => (
                          <option key={a.id} value={a.id}>{a.name} ({a.platform})</option>
                        ))}
                      </select>
                      <textarea
                        value={publishCaption}
                        onChange={(e) => setPublishCaption(e.target.value)}
                        placeholder="ক্যাপশন (ঐচ্ছিক — না দিলে পণ্যের নাম ও দাম)"
                        rows={2}
                        className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                      />
                      <p className="text-[11px] text-slate-500">পোস্টটি Social engine-এ ড্রাফট হিসেবে তৈরি হবে — সেখান থেকেই প্রকাশ হবে।</p>
                      <button type="button" className="btn-primary w-full" disabled={busy === `publish-${p.id}`} onClick={() => publish(p)}>
                        {busy === `publish-${p.id}` ? "Publish হচ্ছে…" : "ড্রাফট পোস্ট তৈরি করুন"}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
