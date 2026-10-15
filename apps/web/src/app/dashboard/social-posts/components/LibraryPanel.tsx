"use client";
import React from "react";
import type { SocialPageCtx } from "./shared";
import { POST_STATUS_META, MediaThumb } from "./shared";
import { ASPECT_OPTIONS, type MediaAspect } from "@/lib/social-media-library";

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
  const { applyMediaFilters, assetAspect, assets, attachMedia, bulkFolderId, bulkSelected, busy, captureAssetCover, changeAssetFolder, clearMediaFilters, createMediaFolder, cropAsset, deleteMediaFolder, inputCls, loadAssetUsage, mediaFolderFilter, mediaFolders, mediaSearchInput, mediaTagInput, posts, rasterizeMedia, runBulkAction, selectMediaFolder, selectedMedia, setAssetAspect, setBulkFolderId, setBulkSelected, setMediaSearchInput, setMediaTagInput, toggleBulkSelected, updateAssetTags, usageByAsset } = c;
  return (
<>
          <div className="space-y-3">
            {/* SU3: folder bar — SD5: scrollable chip rail, brand-gradient active chip */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <button type="button" onClick={() => selectMediaFolder("")}
                className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${mediaFolderFilter === "" ? "soc-chip-active" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                সব
              </button>
              <button type="button" onClick={() => selectMediaFolder("none")}
                className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${mediaFolderFilter === "none" ? "soc-chip-active" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                ফোল্ডারহীন
              </button>
              {mediaFolders.map((f) => (
                <span key={f.id} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full py-1 pl-2.5 pr-1 text-xs font-medium ${mediaFolderFilter === f.id ? "soc-chip-active" : "bg-slate-100 text-slate-600"}`}>
                  <button type="button" onClick={() => selectMediaFolder(f.id)}>{f.name} ({f.assetCount.toLocaleString("bn-BD")})</button>
                  <button type="button" disabled={busy !== ""} aria-label={`${f.name} ফোল্ডার মুছুন`}
                    title="ফোল্ডার মুছুন — এই ফোল্ডারের asset-গুলো ফোল্ডারহীন হয়ে যাবে, মুছে যাবে না"
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-black/10 text-[10px] font-bold disabled:opacity-50"
                    onClick={() => deleteMediaFolder(f)}>✕</button>
                </span>
              ))}
              <button type="button" className="btn-secondary btn-sm shrink-0 disabled:opacity-50" disabled={busy !== ""} onClick={createMediaFolder}>
                {busy === "folder-create" ? "তৈরি হচ্ছে..." : "+ নতুন ফোল্ডার"}
              </button>
            </div>

            {/* SU3: name / tag filters */}
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[160px] flex-1 text-sm">নাম দিয়ে খুঁজুন
                <input className={inputCls} value={mediaSearchInput} onChange={(e) => setMediaSearchInput(e.target.value)} placeholder="ফাইলের নাম" />
              </label>
              <label className="block min-w-[140px] flex-1 text-sm">ট্যাগ
                <input className={inputCls} value={mediaTagInput} onChange={(e) => setMediaTagInput(e.target.value)} placeholder="যেমন: eid" />
              </label>
              <button type="button" className="btn-secondary btn-sm" onClick={applyMediaFilters}>খুঁজুন</button>
              {mediaFolderFilter || mediaSearchInput || mediaTagInput ? (
                <button type="button" className="btn-secondary btn-sm" onClick={clearMediaFilters}>ফিল্টার মুছুন</button>
              ) : null}
            </div>

            {/* SU3: bulk bar */}
            {bulkSelected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2.5">
                <span className="text-sm font-medium">{bulkSelected.size.toLocaleString("bn-BD")}টি বাছাই করা হয়েছে</span>
                <select className="input w-auto" value={bulkFolderId} onChange={(e) => setBulkFolderId(e.target.value)}>
                  <option value="">ফোল্ডারহীন</option>
                  {mediaFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => runBulkAction("move")}>
                  {busy === "bulk-move" ? "সরানো হচ্ছে..." : "সরান"}
                </button>
                <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => runBulkAction("delete")}>
                  {busy === "bulk-delete" ? "মোছা হচ্ছে..." : "মুছুন"}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setBulkSelected(new Set())}>বাছাই মুছুন</button>
              </div>
            ) : null}

            {assets.length === 0 ? (
              <div className="soc-empty">
                <span className="soc-empty-icon">🖼️</span>
                <p className="text-sm text-slate-500">লাইব্রেরিতে এখনো কোনো মিডিয়া নেই — আগে একটি ফাইল আপলোড করুন।</p>
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
                        বাল্ক বাছাই
                      </label>
                      <div className="relative">
                        <button type="button" disabled={attached}
                          className={`relative block w-full rounded-lg text-left ${attached ? "opacity-50" : "hover:ring-2 hover:ring-indigo-400"}`}
                          title={attached ? "ইতিমধ্যে যোগ হয়েছে" : a.name}
                          onClick={() => attachMedia({ assetId: a.id, kind: a.kind, name: a.name })}>
                          <MediaThumb assetId={a.id} kind={a.kind} className="h-28 w-full rounded-lg object-cover" />
                          {attached ? <span className="absolute left-1 top-1 rounded bg-green-600 px-1 py-0.5 text-[9px] font-bold text-white">যোগ হয়েছে</span> : null}
                        </button>
                        {a.kind === "video" ? <span className="absolute right-1 top-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-bold text-white">🎬 ভিডিও</span> : null}
                        {/* SD5: hover/focus quick action — the SAME per-kind
                            handler as the control below the thumb; the
                            below controls stay for touch. */}
                        {!attached ? (
                          <div className="pointer-events-none absolute inset-x-1 bottom-1 flex opacity-0 transition duration-150 focus-within:opacity-100 group-hover:opacity-100">
                            {a.kind === "video" ? (
                              <button type="button" disabled={busy !== ""} className="pointer-events-auto flex-1 rounded-lg bg-slate-900/85 px-2 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-slate-900 disabled:opacity-50" onClick={() => captureAssetCover(a)}>
                                {busy === `cover-${a.id}` ? "তোলা হচ্ছে..." : "🖼️ Cover তুলুন"}
                              </button>
                            ) : isSvg ? (
                              <button type="button" disabled={busy !== ""} className="pointer-events-auto flex-1 rounded-lg bg-slate-900/85 px-2 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-slate-900 disabled:opacity-50" onClick={() => rasterizeMedia(a)}>
                                {busy === `rasterize-${a.id}` ? "তৈরি হচ্ছে..." : "PNG সংস্করণ তৈরি করুন"}
                              </button>
                            ) : (
                              <button type="button" disabled={busy !== ""} className="pointer-events-auto flex-1 rounded-lg bg-slate-900/85 px-2 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-slate-900 disabled:opacity-50" onClick={() => cropAsset(a)}>
                                {busy === `crop-${a.id}` ? "হচ্ছে..." : "✂️ Crop"}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </div>
                      <span className="block truncate text-xs font-medium text-slate-600" title={a.name}>{a.name}</span>
                      <span className="block text-[10px] text-slate-400">ফোল্ডার: {folderName ?? "ফোল্ডারহীন"}</span>
                      {(a.tags ?? []).length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {(a.tags ?? []).map((tag) => (
                            <span key={tag} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{tag}</span>
                          ))}
                        </span>
                      ) : null}
                      <select className="input mt-0 w-full px-1 py-1 text-xs" value={a.folderId ?? ""} disabled={busy !== ""}
                        onChange={(e) => changeAssetFolder(a, e.target.value)} aria-label="ফোল্ডার বদলান">
                        <option value="">ফোল্ডারহীন</option>
                        {mediaFolders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                      <span className="flex flex-wrap gap-1">
                        <button type="button" disabled={busy !== ""} className="btn-secondary btn-sm px-1.5 text-xs disabled:opacity-50" onClick={() => updateAssetTags(a)}>
                          {busy === `tags-${a.id}` ? "হচ্ছে..." : "🏷️ ট্যাগ"}
                        </button>
                        <button type="button" disabled={busy !== ""} className="btn-secondary btn-sm px-1.5 text-xs disabled:opacity-50" onClick={() => loadAssetUsage(a)}>
                          {busy === `usage-${a.id}` ? "হচ্ছে..." : "ব্যবহার"}
                        </button>
                      </span>
                      {a.kind === "image" ? (
                        <span className="flex flex-wrap items-center gap-1">
                          <select className="input w-auto px-1 py-1 text-xs" value={assetAspect[a.id] ?? "1:1"}
                            onChange={(e) => setAssetAspect((s) => ({ ...s, [a.id]: e.target.value as MediaAspect }))} aria-label="Aspect বেছে নিন">
                            {ASPECT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <button type="button" disabled={busy !== ""} className="btn-secondary btn-sm px-1.5 text-xs disabled:opacity-50" onClick={() => cropAsset(a)}>
                            {busy === `crop-${a.id}` ? "হচ্ছে..." : "✂️ Crop"}
                          </button>
                        </span>
                      ) : null}
                      {a.kind === "video" ? (
                        <button type="button" disabled={busy !== ""} className="btn-secondary btn-sm px-1.5 text-xs disabled:opacity-50" onClick={() => captureAssetCover(a)}>
                          {busy === `cover-${a.id}` ? "তোলা হচ্ছে..." : "🖼️ Cover তুলুন"}
                        </button>
                      ) : null}
                      {isSvg ? (
                        <button type="button" disabled={busy !== ""}
                          className="btn-secondary btn-sm px-1.5 text-xs disabled:opacity-50"
                          onClick={() => rasterizeMedia(a)}>
                          {busy === `rasterize-${a.id}` ? "তৈরি হচ্ছে..." : "PNG সংস্করণ তৈরি করুন"}
                        </button>
                      ) : null}
                      {usage ? (
                        <p className="text-[10px] text-slate-500">
                          {usage.count > 0
                            ? `${usage.count.toLocaleString("bn-BD")}টি post-এ ব্যবহৃত: ${usage.posts.map((p) => POST_STATUS_META[p.status]?.label ?? p.status).join(", ")}`
                            : "কোনো post-এ ব্যবহৃত হয়নি"}
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
