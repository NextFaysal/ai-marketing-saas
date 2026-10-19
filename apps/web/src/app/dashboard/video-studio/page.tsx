"use client";
import React, { useCallback, useEffect, useState } from "react";
import { API_URL, apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { fmtDateTime, fmtMoneyMinor } from "@repo/contracts";
import {
  videoHonestyNote, VIDEO_LANGUAGES, VIDEO_TEMPLATES, buildCreateProjectPayload,
  buildPublishPayload, canPublish, canRetryRender, isPublished, projectStatusChip,
  socialPostHref, templateLabel, videoPreviewSrc, type VideoProjectView,
} from "@/lib/video-studio";
import type { LiveCatalogProduct } from "@/lib/live-commerce";
import type { SocialAccount } from "../social-posts/components/shared";
import { useToast } from "@repo/ui/client";
import { useLocale } from "@/lib/i18n/provider";

// NF2 (FB1 Part C) — Short Video Studio. Projects render ONE
// product into a vertical template video LOCALLY (ffmpeg — see
// the honesty note rendered on the page; nothing here is
// AI-generated). Failed projects show the API's errorLabel
// verbatim; ready projects preview via the asset URL the API
// returns; publish rides the API's SocialService.createPost
// path and shows the returned socialPostId.

export default function VideoStudioPage() {
  const { t, locale } = useLocale();
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
      if (!orgId) { setError(t("ai.vidNoOrg")); setLoading(false); return; }
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
        setError(e instanceof Error ? e.message : t("ai.vidLoadFailed"));
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
      toast({ title: t("ai.vidCreatedToast"), tone: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ai.vidCreateFailed"));
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
      setError(e instanceof Error ? e.message : t("ai.vidRenderFailed"));
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
      toast({ title: t("ai.vidPublishedToast"), tone: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ai.vidPublishFailed"));
    } finally { setBusy(""); }
  };

  return (
    <div className="space-y-6">
      <h1 className="page-title">{t("ai.vidTitle")}</h1>
      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{videoHonestyNote(locale)}</p>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {/* ---------- create project ---------- */}
      <section className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="text-sm font-semibold">{t("ai.vidNewProject")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">{t("ai.vidProduct")}
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm">
              {catalog.length === 0 ? <option value="">{t("ai.vidNoProduct")}</option> : null}
              {catalog.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {fmtMoneyMinor(locale, BigInt(p.priceMinor))}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">{t("ai.vidTemplate")}
            <select value={template} onChange={(e) => setTemplate(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm">
              {VIDEO_TEMPLATES.map((tpl) => (
                <option key={tpl.value} value={tpl.value}>{locale === "en" ? tpl.labelEn : tpl.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">{t("ai.vidLanguage")}
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm">
              {VIDEO_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{locale === "en" ? l.labelEn : l.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">{t("ai.vidOfferText")}
            <input
              value={offerText}
              onChange={(e) => setOfferText(e.target.value)}
              placeholder={t("ai.vidOfferPlaceholder")}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">{t("ai.vidOfferHint")}</p>
        <button type="button" className="btn-primary" disabled={!productId || busy === "create"} onClick={createProject}>
          {busy === "create" ? t("ai.vidCreating") : t("ai.vidCreateButton")}
        </button>
      </section>

      {/* ---------- project list ---------- */}
      <section className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("ai.vidProjects")}</h2>
          <button type="button" className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => loadProjects().catch(() => undefined)}>
            {t("ai.vidRefresh")}
          </button>
        </div>
        {loading ? <p className="text-sm text-slate-500">{t("ai.vidLoading")}</p> : projects.length === 0 ? (
          <p className="text-sm text-slate-500">{t("ai.vidEmpty")}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => {
              const chip = projectStatusChip(p.status, locale);
              const src = p.status === "ready" ? videoPreviewSrc(p.assetUrl, API_URL) : null;
              const published = isPublished(p);
              return (
                <li key={p.id} className="space-y-2 rounded-xl border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.productName ?? p.productId}</span>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}>{chip.label}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {templateLabel(p.template, locale)} · {p.language === "en" ? "English" : t("ai.vidLangBn")}
                    {p.offerText ? ` · “${p.offerText}”` : ""} · {fmtDateTime(locale, p.createdAt)}
                  </div>

                  {p.status === "failed" && p.errorLabel ? (
                    <p className="rounded-lg bg-red-50 p-2.5 text-xs font-medium text-red-700">{p.errorLabel}</p>
                  ) : null}

                  {src ? (
                    <>
                      <video src={src} controls playsInline className="aspect-[9/16] w-full rounded-lg bg-black object-contain" />
                      <a href={src} download className="inline-block text-xs font-semibold text-indigo-600 hover:underline">
                        {t("ai.vidDownload")}
                      </a>
                    </>
                  ) : null}

                  {published ? (
                    <p className="rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800">
                      {t("ai.vidPublishedLine", { id: String(p.socialPostId ?? "") })}{" "}
                      <a href={socialPostHref(p)} className="font-semibold text-indigo-600 hover:underline">{t("ai.vidViewInSocial")}</a>
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {canRetryRender(p) ? (
                      <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" disabled={busy === `render-${p.id}`} onClick={() => retryRender(p)}>
                        {busy === `render-${p.id}` ? t("ai.vidRendering") : t("ai.vidRenderAgain")}
                      </button>
                    ) : null}
                    {canPublish(p) && !published ? (
                      <button
                        type="button"
                        className="btn-primary px-3 py-1.5 text-xs"
                        onClick={() => { setPublishOpenId(publishOpenId === p.id ? null : p.id); setPublishAccountId(""); setPublishCaption(""); }}
                      >
                        {t("ai.vidPublish")}
                      </button>
                    ) : null}
                  </div>

                  {publishOpenId === p.id && canPublish(p) && !published ? (
                    <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                      <select value={publishAccountId} onChange={(e) => setPublishAccountId(e.target.value)} className="w-full rounded-lg border bg-white px-2 py-2 text-sm">
                        <option value="">{t("ai.vidDefaultAccount")}</option>
                        {accounts.filter((a) => a.status === "connected").map((a) => (
                          <option key={a.id} value={a.id}>{a.name} ({a.platform})</option>
                        ))}
                      </select>
                      <textarea
                        value={publishCaption}
                        onChange={(e) => setPublishCaption(e.target.value)}
                        placeholder={t("ai.vidCaptionPlaceholder")}
                        rows={2}
                        className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                      />
                      <p className="text-[11px] text-slate-500">{t("ai.vidDraftNote")}</p>
                      <button type="button" className="btn-primary w-full" disabled={busy === `publish-${p.id}`} onClick={() => publish(p)}>
                        {busy === `publish-${p.id}` ? t("ai.vidPublishing") : t("ai.vidCreateDraft")}
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
