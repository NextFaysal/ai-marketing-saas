"use client";
import React from "react";
import type { SocialPageCtx } from "./shared";
import { POST_STATUS_META, MediaThumb, metaLabel } from "./shared";
import { ASPECT_OPTIONS, aspectLabel, type MediaAspect } from "@/lib/social-media-library";
import { OVERLAY_POSITIONS, formatStockDuration, overlayPositionLabel } from "@/lib/social-stock-coach";
import { fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

/**
 * SU11 — Media Library v2 section (SU3), extracted for the Library tab and the composer picker. Pure move from the former single-file page:
 * all state stays in page.tsx and arrives through the page
 * context prop `c` (every panel stays mounted, so no state is
 * lost on tab switches).
 *
 * SD5 — presentation only: responsive media grid (2/3/4/5 columns),
 * scrollable folder chip rail with the brand-gradient active chip,
 * video kind badge + a hover/focus quick-action overlay carrying the
 * SAME per-kind handler as the controls below the thumb (touch keeps
 * the below controls), bulk-selected tile ring, designed empty
 * state. No handler, state or label changed.
 *
 * SD8 — presentation only: the typography floor reaches the media
 * tiles — asset name, bulk label, folder/aspect selects, overlay
 * quick actions and the below-thumb action buttons move to 12px.
 * What stays small is badge/meta only (kind badge, tag chips,
 * folder/usage meta lines, the icon-only folder-delete button).
 */
export function LibraryPanel({ c }: { c: SocialPageCtx }) {
  const { t, locale } = useLocale();
  const { applyMediaFilters, assetAspect, assets, attachMedia, brandOverlayFor, bulkFolderId, bulkSelected, busy, captureAssetCover, changeAssetFolder, clearMediaFilters, createMediaFolder, cropAsset, deleteMediaFolder, deleteStockKey, importStockItem, inputCls, loadAssetUsage, mediaFolderFilter, mediaFolders, mediaSearchInput, mediaTagInput, overlayPos, posts, rasterizeMedia, runBulkAction, saveStockKey, searchStock, selectMediaFolder, selectedMedia, setAssetAspect, setBulkFolderId, setBulkSelected, setMediaSearchInput, setMediaTagInput, setOverlayPos, setStockKeyInput, setStockKind, setStockQuery, stockKeyInput, stockKind, stockQuery, stockResults, stockSearched, stockStatus, toggleBulkSelected, updateAssetTags, usageByAsset } = c;
  return (
<>
          <div className="space-y-3">
            {/* SN5: Stock media (Pexels) — the org's OWN key. The key
                is verified with a real Pexels call BEFORE it is saved
                (the API does that); the key itself never comes back
                here — only "configured + last 4". */}
            <div className="space-y-2 rounded-2xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800">{t("social.libStockMedia")}</span>
                {stockStatus?.configured ? (
                  <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                    {t("social.libKeyConnected", { last4: stockStatus.keyLast4 ?? "????" })}
                    <button type="button" className="btn-secondary btn-sm px-1.5 text-xs disabled:opacity-50" disabled={busy !== ""} onClick={deleteStockKey}>
                      {busy === "stock-key-delete" ? t("social.libDeleting") : t("social.libDeleteKey")}
                    </button>
                  </span>
                ) : null}
              </div>
              {stockStatus && !stockStatus.configured ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block min-w-[220px] flex-1 text-sm">{t("social.libOwnPexelsKey")}
                    <input type="password" className={inputCls} value={stockKeyInput} onChange={(e) => setStockKeyInput(e.target.value)}
                      placeholder={t("social.libPexelsKeyPlaceholder")} autoComplete="off" />
                  </label>
                  <button type="button" className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={saveStockKey}>
                    {busy === "stock-key-save" ? t("social.libVerifying") : t("social.libVerifySave")}
                  </button>
                  <p className="w-full text-xs text-slate-500">{t("social.libKeyVerifyNote")}</p>
                </div>
              ) : null}
              {stockStatus?.configured ? (
                <>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block min-w-[180px] flex-1 text-sm">{t("social.libStockSearch")}
                      <input className={inputCls} value={stockQuery} onChange={(e) => setStockQuery(e.target.value)} placeholder={t("social.libStockSearchPlaceholder")} />
                    </label>
                    <label className="block text-sm">{t("social.libType")}
                      <select className={inputCls} value={stockKind} onChange={(e) => setStockKind(e.target.value as "photo" | "video")}>
                        <option value="photo">{t("social.libPhoto")}</option>
                        <option value="video">{t("social.libVideo")}</option>
                      </select>
                    </label>
                    <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={searchStock}>
                      {busy === "stock-search" ? t("social.libSearching") : t("social.libSearch")}
                    </button>
                  </div>
                  {stockResults.length > 0 ? (
                    <>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                        {stockResults.map((item) => (
                          <div key={`${item.kind}-${item.stockId}`} className="space-y-1 rounded-xl border border-slate-200 bg-white p-1.5">
                            {item.thumbUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={item.thumbUrl} alt={item.alt || item.photographer} className="h-20 w-full rounded-lg object-cover" loading="lazy" />
                            ) : (
                              <div className="flex h-20 w-full items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">{t("social.libNoImage")}</div>
                            )}
                            <span className="block truncate text-[11px] text-slate-500" title={item.photographer}>
                              {item.kind === "video" ? `🎬 ${formatStockDuration(item.duration, locale) ?? ""} · ` : ""}{item.photographer || "Pexels"}
                            </span>
                            <button type="button" className="btn-secondary btn-sm w-full px-1.5 text-xs disabled:opacity-50" disabled={busy !== ""}
                              onClick={() => importStockItem(item)}>
                              {busy === `stock-import-${item.stockId}` ? t("social.libImporting") : t("social.libImportToLibrary")}
                            </button>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-slate-500">{t("social.libPexelsCreditNote")}</p>
                    </>
                  ) : stockSearched ? (
                    <p className="text-xs text-slate-500">{t("social.libNothingFound")}</p>
                  ) : null}
                </>
              ) : null}
            </div>

            {/* SU3: folder bar — SD5: scrollable chip rail, brand-gradient active chip */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <button type="button" onClick={() => selectMediaFolder("")}
                className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${mediaFolderFilter === "" ? "soc-chip-active" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {t("social.libAll")}
              </button>
              <button type="button" onClick={() => selectMediaFolder("none")}
                className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${mediaFolderFilter === "none" ? "soc-chip-active" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                {t("social.libNoFolder")}
              </button>
              {mediaFolders.map((f) => (
                <span key={f.id} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full py-1 pl-2.5 pr-1 text-xs font-medium ${mediaFolderFilter === f.id ? "soc-chip-active" : "bg-slate-100 text-slate-600"}`}>
                  <button type="button" onClick={() => selectMediaFolder(f.id)}>{f.name} ({fmtNumber(locale, f.assetCount)})</button>
                  <button type="button" disabled={busy !== ""} aria-label={t("social.libFolderDeleteAria", { name: f.name })}
                    title={t("social.libFolderDeleteTitle")}
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-black/10 text-[10px] font-bold disabled:opacity-50"
                    onClick={() => deleteMediaFolder(f)}>✕</button>
                </span>
              ))}
              <button type="button" className="btn-secondary btn-sm shrink-0 disabled:opacity-50" disabled={busy !== ""} onClick={createMediaFolder}>
                {busy === "folder-create" ? t("social.libCreating") : t("social.libNewFolder")}
              </button>
            </div>

            {/* SU3: name / tag filters */}
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[160px] flex-1 text-sm">{t("social.libSearchByName")}
                <input className={inputCls} value={mediaSearchInput} onChange={(e) => setMediaSearchInput(e.target.value)} placeholder={t("social.libFileNamePlaceholder")} />
              </label>
              <label className="block min-w-[140px] flex-1 text-sm">{t("social.libTag")}
                <input className={inputCls} value={mediaTagInput} onChange={(e) => setMediaTagInput(e.target.value)} placeholder={t("social.libTagPlaceholder")} />
              </label>
              <button type="button" className="btn-secondary btn-sm" onClick={applyMediaFilters}>{t("social.libSearch")}</button>
              {mediaFolderFilter || mediaSearchInput || mediaTagInput ? (
                <button type="button" className="btn-secondary btn-sm" onClick={clearMediaFilters}>{t("social.libClearFilters")}</button>
              ) : null}
            </div>

            {/* SU3: bulk bar */}
            {bulkSelected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2.5">
                <span className="text-sm font-medium">{t("social.libSelectedCount", { count: fmtNumber(locale, bulkSelected.size) })}</span>
                <select className="input w-auto" value={bulkFolderId} onChange={(e) => setBulkFolderId(e.target.value)}>
                  <option value="">{t("social.libNoFolder")}</option>
                  {mediaFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => runBulkAction("move")}>
                  {busy === "bulk-move" ? t("social.libMoving") : t("social.libMove")}
                </button>
                <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => runBulkAction("delete")}>
                  {busy === "bulk-delete" ? t("social.libDeleting") : t("social.libDelete")}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setBulkSelected(new Set())}>{t("social.libClearSelection")}</button>
              </div>
            ) : null}

            {assets.length === 0 ? (
              <div className="soc-empty">
                <span className="soc-empty-icon">🖼️</span>
                <p className="text-sm text-slate-500">{t("social.libEmpty")}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {assets.map((a) => {
                  const attached = selectedMedia.some((m) => m.assetId === a.id);
                  const isSvg = a.contentType.includes("svg");
                  const folderName = a.folderId ? mediaFolders.find((f) => f.id === a.folderId)?.name : null;
                  const usage = usageByAsset[a.id];
                  return (
                    <div key={a.id} className={`group space-y-1.5 rounded-xl border border-slate-200 p-2 ${bulkSelected.has(a.id) ? "soc-selected" : ""}`}>
                      <label className="flex items-center gap-1.5 text-xs text-slate-500">
                        <input type="checkbox" className="h-4 w-4" checked={bulkSelected.has(a.id)} onChange={() => toggleBulkSelected(a.id)} />
                        {t("social.libBulkSelect")}
                      </label>
                      <div className="relative">
                        <button type="button" disabled={attached}
                          className={`relative block w-full rounded-lg text-left ${attached ? "opacity-50" : "hover:ring-2 hover:ring-indigo-400"}`}
                          title={attached ? t("social.libAlreadyAttached") : a.name}
                          onClick={() => attachMedia({ assetId: a.id, kind: a.kind, name: a.name })}>
                          <MediaThumb assetId={a.id} kind={a.kind} className="h-28 w-full rounded-lg object-cover" />
                          {attached ? <span className="absolute left-1 top-1 rounded bg-green-600 px-1 py-0.5 text-[9px] font-bold text-white">{t("social.libAttached")}</span> : null}
                        </button>
                        {a.kind === "video" ? <span className="absolute right-1 top-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-bold text-white">{t("social.libVideoBadge")}</span> : null}
                        {/* SD5: hover/focus quick action — the SAME per-kind
                            handler as the control below the thumb; the
                            below controls stay for touch. */}
                        {!attached ? (
                          <div className="pointer-events-none absolute inset-x-1 bottom-1 flex opacity-0 transition duration-150 focus-within:opacity-100 group-hover:opacity-100">
                            {a.kind === "video" ? (
                              <button type="button" disabled={busy !== ""} className="pointer-events-auto flex-1 rounded-lg bg-slate-900/85 px-2 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-slate-900 disabled:opacity-50" onClick={() => captureAssetCover(a)}>
                                {busy === `cover-${a.id}` ? t("social.libCoverBusy") : t("social.libCover")}
                              </button>
                            ) : isSvg ? (
                              <button type="button" disabled={busy !== ""} className="pointer-events-auto flex-1 rounded-lg bg-slate-900/85 px-2 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-slate-900 disabled:opacity-50" onClick={() => rasterizeMedia(a)}>
                                {busy === `rasterize-${a.id}` ? t("social.libRasterizing") : t("social.libMakePng")}
                              </button>
                            ) : (
                              <button type="button" disabled={busy !== ""} className="pointer-events-auto flex-1 rounded-lg bg-slate-900/85 px-2 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-slate-900 disabled:opacity-50" onClick={() => cropAsset(a)}>
                                {busy === `crop-${a.id}` ? t("social.libDoing") : t("social.libCrop")}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                      <span className="block truncate text-xs font-medium text-slate-600" title={a.name}>{a.name}</span>
                      {a.attribution ? (
                        <span className="block text-[10px] text-slate-500">
                          📷 {a.attribution}
                          {a.sourceUrl ? <> · <a href={a.sourceUrl} target="_blank" rel="noreferrer" className="underline">{t("social.libViewOnPexels")}</a></> : null}
                        </span>
                      ) : null}
                      <span className="block text-[10px] text-slate-400">{t("social.libFolderLine", { name: folderName ?? t("social.libNoFolder") })}</span>
                      {(a.tags ?? []).length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {(a.tags ?? []).map((tag) => (
                            <span key={tag} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{tag}</span>
                          ))}
                        </span>
                      ) : null}
                      <select className="input mt-0 w-full px-1 py-1 text-xs" value={a.folderId ?? ""} disabled={busy !== ""}
                        onChange={(e) => changeAssetFolder(a, e.target.value)} aria-label={t("social.libChangeFolderAria")}>
                        <option value="">{t("social.libNoFolder")}</option>
                        {mediaFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                      <span className="flex flex-wrap gap-1">
                        <button type="button" disabled={busy !== ""} className="btn-secondary btn-sm px-1.5 text-xs disabled:opacity-50" onClick={() => updateAssetTags(a)}>
                          {busy === `tags-${a.id}` ? t("social.libDoing") : t("social.libTagsBtn")}
                        </button>
                        <button type="button" disabled={busy !== ""} className="btn-secondary btn-sm px-1.5 text-xs disabled:opacity-50" onClick={() => loadAssetUsage(a)}>
                          {busy === `usage-${a.id}` ? t("social.libDoing") : t("social.libUsageBtn")}
                        </button>
                      </span>
                      {a.kind === "image" ? (
                        <span className="flex flex-wrap items-center gap-1">
                          <select className="input w-auto px-1 py-1 text-xs" value={assetAspect[a.id] ?? "1:1"}
                            onChange={(e) => setAssetAspect((s) => ({ ...s, [a.id]: e.target.value as MediaAspect }))} aria-label={t("social.libAspectAria")}>
                            {ASPECT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{aspectLabel(o.value, locale)}</option>)}
                          </select>
                          <button type="button" disabled={busy !== ""} className="btn-secondary btn-sm px-1.5 text-xs disabled:opacity-50" onClick={() => cropAsset(a)}>
                            {busy === `crop-${a.id}` ? t("social.libDoing") : t("social.libCrop")}
                          </button>
                        </span>
                      ) : null}
                      {/* SN5: brand overlay — image only (video overlay is
                          not available; that is stated, not hidden). */}
                      {a.kind === "image" ? (
                        <span className="flex flex-wrap items-center gap-1">
                          <select className="input w-auto px-1 py-1 text-xs" value={overlayPos[a.id] ?? "bottom"}
                            onChange={(e) => setOverlayPos((s) => ({ ...s, [a.id]: e.target.value }))} aria-label={t("social.libOverlayPosAria")}>
                            {OVERLAY_POSITIONS.map((o) => <option key={o.value} value={o.value}>{overlayPositionLabel(o.value, locale)}</option>)}
                          </select>
                          <button type="button" disabled={busy !== ""} className="btn-secondary btn-sm px-1.5 text-xs disabled:opacity-50" onClick={() => brandOverlayFor(a)}>
                            {busy === `overlay-${a.id}` ? t("social.libOverlayBusy") : t("social.libBrandOverlay")}
                          </button>
                        </span>
                      ) : (
                        <span className="block text-[10px] text-slate-400">{t("social.libOverlayImageOnly")}</span>
                      )}
                      {a.kind === "video" ? (
                        <button type="button" disabled={busy !== ""} className="btn-secondary btn-sm px-1.5 text-xs disabled:opacity-50" onClick={() => captureAssetCover(a)}>
                          {busy === `cover-${a.id}` ? t("social.libCoverBusy") : t("social.libCover")}
                        </button>
                      ) : null}
                      {isSvg ? (
                        <button type="button" disabled={busy !== ""}
                          className="btn-secondary btn-sm px-1.5 text-xs disabled:opacity-50"
                          onClick={() => rasterizeMedia(a)}>
                          {busy === `rasterize-${a.id}` ? t("social.libRasterizing") : t("social.libMakePng")}
                        </button>
                      ) : null}
                      {usage ? (
                        <p className="text-[10px] text-slate-500">
                          {usage.count > 0
                            ? t("social.libUsageUsed", { count: fmtNumber(locale, usage.count), labels: usage.posts.map((p) => metaLabel(POST_STATUS_META[p.status], t, p.status)).join(", ") })
                            : t("social.libUsageNone")}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

</>
  );
}
