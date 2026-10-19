"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import { MediaImage } from "@/components/media-image";
import { fmtDate, fmtNumber, type UiLocale } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { miscBn, miscEn } from "@/lib/i18n/misc";

/**
 * RB5/RM7 — unified media library: every StoredFile the org owns
 * (product, social, branding, creative, inbox, library uploads…)
 * in one grid, served by GET /organizations/:id/media-library.
 * Public files render from their CDN URL; private files only via
 * the short-lived presigned URL the API returns — when the API
 * returns no URL (local-disk storage mode) the card says so
 * plainly instead of showing a broken preview.
 */

interface MediaItem {
  id: string;
  key: string;
  surface: string;
  visibility: string;
  contentType: string;
  sizeBytes: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  url: string | null;
}

const SURFACE_KEYS: Record<string, keyof typeof miscBn> = {
  product: "f3MlSurfaceProduct",
  social: "f3MlSurfaceSocial",
  branding: "f3MlSurfaceBranding",
  creative: "f3MlSurfaceCreative",
  inbox: "f3MlSurfaceInbox",
  review: "f3MlSurfaceReview",
  digital: "f3MlSurfaceDigital",
  document: "f3MlSurfaceDocument",
  library: "f3MlSurfaceLibrary",
  other: "f3MlSurfaceOther",
};
function surfaceLabel(surface: string, locale: UiLocale): string {
  const key = SURFACE_KEYS[surface];
  if (!key) return surface;
  return (locale === "en" ? miscEn : miscBn)[key];
}
const SURFACES = ["", ...Object.keys(SURFACE_KEYS)];
const KINDS = [
  { value: "", labelKey: "social.mlKindAll" },
  { value: "image", labelKey: "social.mlKindImage" },
  { value: "video", labelKey: "social.mlKindVideo" },
  { value: "file", labelKey: "social.mlKindFile" },
];
const PAGE_SIZE = 24;
const UPLOAD_MAX = 10 * 1024 * 1024; // = API MEDIA_LIBRARY_UPLOAD_MAX_BYTES
const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];

function formatSize(sizeBytes: string, locale: UiLocale): string {
  const n = Number(sizeBytes);
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${fmtNumber(locale, n)} B`;
  if (n < 1024 * 1024) return `${fmtNumber(locale, Number((n / 1024).toFixed(1)))} KB`;
  return `${fmtNumber(locale, Number((n / (1024 * 1024)).toFixed(1)))} MB`;
}
function fileName(key: string): string {
  const seg = key.split("/").pop() ?? key;
  return seg.length > 42 ? `${seg.slice(0, 20)}…${seg.slice(-18)}` : seg;
}

export default function MediaLibraryPage() {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [surface, setSurface] = useState("");
  const [kind, setKind] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const orgId = typeof window !== "undefined" ? getOrganizationId() : null;

  // Search applies after a short pause (no per-keystroke requests).
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (surface) params.set("surface", surface);
      if (kind) params.set("kind", kind);
      if (q) params.set("q", q);
      const res = await apiFetch<{ total: number; items: MediaItem[] }>(
        `/organizations/${orgId}/media-library?${params.toString()}`,
      );
      setItems(res.items ?? []);
      setTotal(res.total ?? 0);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("social.mlLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [orgId, page, surface, kind, q]);
  useEffect(() => { load(); }, [load]);

  async function uploadFiles(fileList: FileList | File[]) {
    if (!orgId) return;
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setUploading(true);
    setMsg("");
    setError("");
    const problems: string[] = [];
    let okCount = 0;
    for (const file of files) {
      try {
        if (!UPLOAD_TYPES.includes(file.type)) throw new Error(t("social.mlUploadTypeError"));
        if (file.size > UPLOAD_MAX) throw new Error(t("social.mlUploadTooBig"));
        const pre = await apiFetch<{ uploadUrl: string; key: string }>(
          `/organizations/${orgId}/media-library/upload/presign`,
          { method: "POST", body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size }) },
        );
        const putRes = await fetch(pre.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        if (!putRes.ok) throw new Error(t("social.mlUploadServerError", { status: putRes.status }));
        await apiFetch(`/organizations/${orgId}/media-library/upload/complete`, {
          method: "POST", body: JSON.stringify({ key: pre.key, contentType: file.type, sizeBytes: file.size }),
        });
        okCount += 1;
      } catch (e) {
        problems.push(`${file.name}: ${e instanceof Error ? e.message : t("social.mlUploadFailed")}`);
      }
    }
    setUploading(false);
    if (okCount > 0) {
      setSurface("library");
      setKind("");
      setQInput("");
      setQ("");
      setPage(1);
      await load();
    }
    setMsg([...(okCount > 0 ? [t("social.mlUploadedCount", { count: fmtNumber(locale, okCount) })] : []), ...problems].join("\n"));
  }

  async function copyUrl(item: MediaItem) {
    if (!item.url) return;
    try {
      await navigator.clipboard.writeText(item.url);
      setMsg(t("social.mlUrlCopied"));
      setError("");
    } catch {
      setError(t("social.mlUrlCopyFailed"));
    }
  }

  async function trash(item: MediaItem) {
    if (!orgId) return;
    if (!window.confirm(t("social.mlTrashConfirm"))) return;
    setBusyId(item.id);
    setMsg("");
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/media-library/${item.id}`, { method: "DELETE" });
      setMsg(t("social.mlTrashed"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("social.mlTrashFailed"));
    } finally {
      setBusyId("");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{t("social.mlTitle")}</h1>
          <p className="text-sm text-slate-500">{t("social.mlSub")}</p>
        </div>
        <div>
          <button type="button" className="btn-primary disabled:opacity-50" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            {uploading ? t("social.mlUploading") : t("social.mlUploadImage")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(e) => { void uploadFiles(e.target.files ?? []); e.target.value = ""; }}
          />
          <p className="mt-1 text-right text-[11px] text-slate-400">{t("social.mlUploadHint")}</p>
        </div>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {msg ? <p className="whitespace-pre-line rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</p> : null}

      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          {SURFACES.map((s) => (
            <button
              key={s || "all"}
              type="button"
              onClick={() => { setSurface(s); setPage(1); }}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${surface === s ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {s === "" ? t("social.mlAllSurfaces") : surfaceLabel(s, locale)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {KINDS.map((k) => (
            <button
              key={k.value || "all-kinds"}
              type="button"
              onClick={() => { setKind(k.value); setPage(1); }}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${kind === k.value ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {t(k.labelKey)}
            </button>
          ))}
          <input
            className="input ml-auto w-full sm:w-64"
            type="search"
            placeholder={t("social.mlSearchPlaceholder")}
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">{t("social.mlLoading")}</p>
      ) : items.length === 0 ? (
        <EmptyState title={t("social.mlEmptyTitle")} description={t("social.mlEmptyDesc")} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => {
              const isImage = item.contentType.startsWith("image/");
              const isVideo = item.contentType.startsWith("video/");
              return (
                <div key={item.id} className="card space-y-2 p-3">
                  {isImage && item.url ? (
                    <MediaImage
                      src={item.url}
                      alt={fileName(item.key)}
                      width={item.width ?? 640}
                      height={item.height ?? 480}
                      className="h-44 w-full rounded-lg object-cover"
                    />
                  ) : isVideo && item.url ? (
                    <video src={item.url} className="h-44 w-full rounded-lg bg-slate-900 object-cover" muted preload="metadata" controls />
                  ) : (
                    <div className="flex h-44 w-full flex-col items-center justify-center gap-1 rounded-lg bg-slate-100 text-slate-400">
                      <span className="text-3xl">{isVideo ? "🎬" : isImage ? "🖼️" : "📄"}</span>
                      <span className="px-2 text-center text-[11px]">{t("social.mlNoPreview")}{item.url ? "" : t("social.mlNoUrlSuffix")}</span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={item.key}>{fileName(item.key)}</p>
                    <p className="text-[11px] text-slate-400">
                      {surfaceLabel(item.surface, locale)}
                      {item.visibility === "private" ? t("social.mlPrivate") : t("social.mlPublic")}
                      {" · "}{formatSize(item.sizeBytes, locale)}
                      {" · "}{fmtDate(locale, item.createdAt)}
                    </p>
                    {item.visibility === "private" && item.url ? (
                      <p className="text-[11px] text-amber-600">{t("social.mlPrivateUrlNote")}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className="btn-secondary btn-sm disabled:opacity-40" disabled={!item.url} onClick={() => copyUrl(item)}>
                      {t("social.mlCopyUrl")}
                    </button>
                    <button type="button" className="btn-secondary btn-sm text-red-600 disabled:opacity-40" disabled={busyId === item.id} onClick={() => trash(item)}>
                      {t("social.mlTrash")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>{t("social.mlTotalLine", { total: fmtNumber(locale, total), page: fmtNumber(locale, page), pages: fmtNumber(locale, totalPages) })}</span>
            <span className="flex gap-2">
              <button type="button" className="btn-secondary btn-sm disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{t("social.mlPrev")}</button>
              <button type="button" className="btn-secondary btn-sm disabled:opacity-40" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>{t("social.mlNext")}</button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
