"use client";
import React, { useEffect, useState } from "react";
import type { SocialPageCtx } from "./shared";
import { PLATFORM_LABELS, ACCOUNT_STATUS_META, MAX_MEDIA, MediaThumb, formatMb, AccountAvatar, PlatformDot, metaLabel } from "./shared";
import { buildPlatformPreview, isFirstCommentApplicable, type RecurrenceFrequency } from "@/lib/social-composer";
import { fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

/**
 * SU11 — the composer card (SU1/SU2/SU3/SU4/SU8 composer sections). Pure move from the former single-file page:
 * all state stays in page.tsx and arrives through the page
 * context prop `c` (every panel stays mounted, so no state is
 * lost on tab switches).
 *
 * SD8 — presentation only: the remaining plain-text empty states
 * in this panel (no accounts in Step 3, no content plan yet, no
 * saved hashtag set) take the compact .soc-empty-sm surface, same
 * texts. Guidance notes (hashtag advice, dropzone hint) are not
 * list empties and stay as they are.
 */
export function ComposerPanel({ c }: { c: SocialPageCtx }) {
  const { t, locale } = useLocale();
  const { accountSelected, accounts, aiCount, aiHashtags, aiImageProductId, aiImagePrompt, aiLanguage, aiNotice, aiProductId, aiProducts, aiScript, aiTopic, aiVariants, applyHashtagSet, assets, attachMedia, busy, caption, composerTargets, contentPlan, coverAssetId, createTemplatePoster, editingPostId, firstCommentText, generateAiCopy, generateAiImage, generateAiScript, generateContentPlan, hashtagInsights, hashtagSetName, hashtagSets, imageStatus, importError, importProductId, importProductImage, inputCls, isStory, linkUrl, loadAssets, loadMediaFolders, materializeContentPlan, mediaLimits, planAccountId, planFocus, planMonth, planPillars, planSelectedItems, platformModes, posts, recurrenceFrequency, recurrenceInterval, resetComposer, saveDraft, saveHashtagSet, scriptProductId, scriptTopic, selectedHashtags, selectedMedia, setAccountSelected, setAiCount, setAiImageProductId, setAiImagePrompt, setAiLanguage, setAiProductId, setAiTopic, setCaption, setCoverAssetId, setFirstCommentText, setHashtagSetName, setImportError, setImportProductId, setIsStory, setLinkUrl, setPlanAccountId, setPlanFocus, setPlanMonth, setPlanPillars, setPlanSelectedItems, setRecurrenceFrequency, setRecurrenceInterval, setScriptProductId, setScriptTopic, setSelectedMedia, setShowLibrary, setTemplateAssetId, setTemplateHeadline, setTemplateProductId, setTemplateSubtext, setVariantOverrides, setYtCategoryId, setYtIsShort, setYtTagsInput, setYtTitle, setYtPlaylistId, showAiPanel, showFirstCommentInput, showLibrary, templateAssetId, templateHeadline, templatePoster, templateProductId, templateSubtext, toggleAiPanel, toggleHashtag, uploadMedia, useAiCaption, variantOverrides, ytCategoryId, ytIsShort, ytTagsInput, ytTitle, ytPlaylistId, ytPlaylists, ytPlaylistsAccountId, loadYouTubePlaylists, csvImportResults, importPostsCsv, aiPlatformVariants, aiVariantDropped, translations, generatePlatformVariants, applyPlatformVariant, translateComposerText, } = c;

  // SN1: the YouTube target in this composer session (if any) —
  // its playlists feed the playlist select below.
  const ytTarget = composerTargets.find((a) => a.platform === "youtube");
  useEffect(() => {
    if (ytTarget) void loadYouTubePlaylists(ytTarget.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytTarget?.id]);
  // SD3: the drag-over highlight is pure presentation (no page state).
  const [dragOver, setDragOver] = useState(false);

  // SD3: dropped / pasted files go through the EXISTING upload handler,
  // one file at a time — its busy state and the attachMedia MAX_MEDIA
  // cap behave exactly like picking files one by one. No new endpoint,
  // no new upload path.
  const uploadFiles = async (files: File[]) => {
    const media = files.filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    for (const f of media.slice(0, MAX_MEDIA)) await uploadMedia(f);
  };

  return (
    <div
      onPaste={(e) => {
        const files = Array.from(e.clipboardData?.files ?? []);
        if (files.length > 0) { e.preventDefault(); void uploadFiles(files); }
      }}
    >
      <div className={composerTargets.length > 0 ? "grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]" : undefined}>
        <div className="min-w-0 space-y-5">
      {/* SD3 Step 1 — Content */}
      <div className="soc-section-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="soc-step-num">{fmtNumber(locale, 1)}</span>
            <div className="font-semibold">{editingPostId ? t("social.cpEditDraft") : t("social.cpNewPost")}</div>
          </div>
          {editingPostId ? (
            <button className="btn-secondary btn-sm" onClick={resetComposer}>{t("social.cpCancelEdit")}</button>
          ) : null}
        </div>

        <label className="block text-sm">{t("social.cpCaption")}
          <textarea className={inputCls} rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={t("social.cpCaptionPlaceholder")} />
        </label>
        <div className="-mt-2 flex flex-wrap items-center justify-between gap-2">
          {/* SN4: caption translation — the result is only shown;
              it replaces the caption when the user taps বসান. */}
          <span className="flex flex-wrap gap-1.5">
            <button type="button" className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-50" disabled={busy !== "" || !caption.trim()} onClick={() => translateComposerText("caption", caption, "en")}>
              {busy === "ai-translate-caption" ? t("social.cpTranslating") : t("social.cpTranslateToEn")}
            </button>
            <button type="button" className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-50" disabled={busy !== "" || !caption.trim()} onClick={() => translateComposerText("caption", caption, "bn")}>
              {busy === "ai-translate-caption" ? t("social.cpTranslating") : t("social.cpTranslateToBn")}
            </button>
          </span>
          <span className="text-xs text-slate-400">{t("social.cpChars", { count: fmtNumber(locale, caption.length) })}</span>
        </div>
        {translations["caption"] ? (
          <div className="space-y-1.5 rounded-xl bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-500">{translations["caption"].targetLang === "en" ? t("social.cpTranslationEn") : t("social.cpTranslationBn")}</div>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{translations["caption"].text}</p>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setCaption(translations["caption"].text)}>{t("social.cpUseTranslationCaption")}</button>
          </div>
        ) : null}

        <label className="block text-sm">{t("social.cpLinkUrl")}
          <input className={inputCls} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." />
        </label>

        {/* SU1: first comment — only when a Meta Page / Instagram account is selected */}
        {showFirstCommentInput ? (
          <div className="space-y-1">
            <label className="block text-sm">{t("social.cpFirstComment")}
              <textarea className={inputCls} rows={2} value={firstCommentText} onChange={(e) => setFirstCommentText(e.target.value)} placeholder={t("social.cpFirstCommentPlaceholder")} />
            </label>
            <p className="text-xs text-slate-400">{t("social.cpFirstCommentNote")}</p>
          </div>
        ) : null}

        {/* SU2: recurrence for a recurring series */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">{t("social.cpRecurrence")}
            <select className={inputCls} value={recurrenceFrequency} onChange={(e) => setRecurrenceFrequency(e.target.value as RecurrenceFrequency | "")}>
              <option value="">{t("social.cpNone")}</option>
              <option value="daily">{t("social.cpDaily")}</option>
              <option value="weekly">{t("social.cpWeekly")}</option>
              <option value="monthly">{t("social.cpMonthly")}</option>
            </select>
          </label>
          <label className="block text-sm">{t("social.cpInterval")}
            <input type="number" min={1} className={`${inputCls} w-28`} value={recurrenceInterval}
              disabled={!recurrenceFrequency}
              onChange={(e) => setRecurrenceInterval(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          {recurrenceFrequency ? (
            <p className="pb-2 text-xs text-slate-500">{t("social.cpRecurrenceNote", { interval: fmtNumber(locale, recurrenceInterval) })}</p>
          ) : null}
        </div>

        {/* SU8: optional YouTube / Story platform fields */}
        <div className="space-y-3 rounded-xl border border-slate-200 p-4">
          <div className="text-sm font-semibold">{t("social.cpYtSection")}</div>
          <p className="text-xs text-slate-400">{t("social.cpYtSectionNote")}</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-[220px] flex-1 text-sm">{t("social.cpYtTitle")}
              <input className={inputCls} value={ytTitle} onChange={(e) => setYtTitle(e.target.value)} placeholder={t("social.cpYtTitlePlaceholder")} />
            </label>
            <label className="block text-sm">{t("social.cpYtCategory")}
              <input className={`${inputCls} w-36`} value={ytCategoryId} onChange={(e) => setYtCategoryId(e.target.value)} placeholder={t("social.cpExample22")} />
            </label>
            <label className="block min-w-[220px] flex-1 text-sm">{t("social.cpCoverLabel")}
              <select className={inputCls} value={coverAssetId} onChange={(e) => setCoverAssetId(e.target.value)}>
                <option value="">{t("social.cpNoCover")}</option>
                {assets.filter((a) => a.kind === "image").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-sm">{t("social.cpYtTags")}
            <input className={inputCls} value={ytTagsInput} onChange={(e) => setYtTagsInput(e.target.value)} placeholder={t("social.cpYtTagsPlaceholder")} />
          </label>
          {ytTarget ? (
            <label className="block text-sm">{t("social.cpYtPlaylist")}
              <select className={inputCls} value={ytPlaylistId} onChange={(e) => setYtPlaylistId(e.target.value)}>
                <option value="">{t("social.cpNoPlaylist")}</option>
                {ytPlaylistId && !ytPlaylists.some((pl) => pl.id === ytPlaylistId) ? (
                  <option value={ytPlaylistId}>{t("social.cpCurrentPlaylist", { id: ytPlaylistId })}</option>
                ) : null}
                {ytPlaylists.map((pl) => <option key={pl.id} value={pl.id}>{pl.title}</option>)}
              </select>
              {busy === "yt-playlists" ? (
                <span className="text-xs text-slate-400">{t("social.cpPlaylistLoading")}</span>
              ) : ytPlaylistsAccountId === ytTarget.id && ytPlaylists.length === 0 ? (
                <span className="text-xs text-slate-400">{t("social.cpNoPlaylists")}</span>
              ) : (
                <span className="text-xs text-slate-400">{t("social.cpPlaylistNote")}</span>
              )}
            </label>
          ) : null}
          <div className="flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={ytIsShort} onChange={(e) => setYtIsShort(e.target.checked)} />
              <span>{t("social.cpYtShorts")}</span>
            </label>
            {composerTargets.some((a) => a.platform === "meta_page") ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={isStory} onChange={(e) => setIsStory(e.target.checked)} />
                <span>{t("social.cpFbStory")}</span>
              </label>
            ) : null}
          </div>
        </div>

        {/* SP3 AI copy panel */}
        <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
          <button type="button" className="flex w-full items-center justify-between text-left font-semibold" onClick={toggleAiPanel}>
            <span>{t("social.cpAiCaptionTitle")}</span>
            <span className="text-xs text-slate-500">{showAiPanel ? t("social.cpHide") : t("social.cpShow")}</span>
          </button>
          {showAiPanel ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="block min-w-[200px] flex-1 text-sm">{t("social.cpProductOptional")}
                  <select className={inputCls} value={aiProductId} onChange={(e) => setAiProductId(e.target.value)}>
                    <option value="">{t("social.cpNoProduct")}</option>
                    {aiProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="block min-w-[200px] flex-1 text-sm">{t("social.cpTopicOptional")}
                  <input className={inputCls} value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} placeholder={t("social.cpTopicPlaceholder")} />
                </label>
                <label className="block text-sm">{t("social.cpLanguage")}
                  <select className={inputCls} value={aiLanguage} onChange={(e) => setAiLanguage(e.target.value as "bn" | "en")}>
                    <option value="bn">{t("social.cpLangBn")}</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label className="block text-sm">{t("social.cpCount")}
                  <select className={inputCls} value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <button type="button" className="btn-ai" disabled={busy !== ""} onClick={generateAiCopy}>
                  {busy === "ai-generate" ? t("social.cpGenerating") : t("social.cpGenerateCaption")}
                </button>
              </div>
              <p className="text-xs text-slate-400">{t("social.cpAiGroundingNote")}</p>

              {aiNotice ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{aiNotice}</p> : null}

              {aiHashtags.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-sm font-medium">{t("social.cpSuggestedHashtags")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {aiHashtags.map((tag) => {
                      const active = selectedHashtags.includes(tag);
                      return (
                        <button key={tag} type="button" onClick={() => toggleHashtag(tag)}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {aiVariants.length > 0 ? (
                <div className="space-y-2">
                  {aiVariants.map((v, i) => (
                    <div key={i} className="space-y-2 rounded-xl bg-white p-3">
                      <p className="whitespace-pre-wrap text-sm text-slate-700">{v.caption}</p>
                      {v.policy.status === "pass" ? (
                        <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">{t("social.cpPolicyPass")}</span>
                      ) : (
                        <div className="space-y-1">
                          <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{t("social.cpFlagged")}</span>
                          {v.policy.findings.map((f, j) => (
                            <p key={j} className="text-xs text-amber-800">{f.explanation}</p>
                          ))}
                        </div>
                      )}
                      <div>
                        <button type="button" className="btn-secondary btn-sm" onClick={() => useAiCaption(v)}>{t("social.cpUseCaption")}</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* SN4: per-platform variants of the composer's own
                  caption — generated on demand, shown per platform,
                  and written into the Step-3 variant fields only
                  when the user taps বসান. Nothing is saved. */}
              {!editingPostId ? (
                <div className="space-y-2 border-t border-indigo-100 pt-3">
                  <div className="text-sm font-medium">{t("social.cpPlatformVariants")}</div>
                  <p className="text-xs text-slate-400">{t("social.cpPlatformVariantsNote")}</p>
                  <button type="button" className="btn-ai" disabled={busy !== ""} onClick={generatePlatformVariants}>
                    {busy === "ai-variants" ? t("social.cpGenerating") : t("social.cpMakeVariants")}
                  </button>
                  {aiVariantDropped > 0 ? (
                    <p className="text-xs text-amber-700">{t("social.cpVariantsDropped", { count: fmtNumber(locale, aiVariantDropped) })}</p>
                  ) : null}
                  {aiPlatformVariants.length > 0 ? (
                    <div className="space-y-2">
                      {aiPlatformVariants.map((v) => {
                        const targets = composerTargets.filter((a) => a.platform === v.platform);
                        return (
                          <div key={v.platform} className="space-y-2 rounded-xl bg-white p-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <PlatformDot platform={v.platform} />
                              <span className="badge-slate">{PLATFORM_LABELS[v.platform] ?? v.platform}</span>
                              {v.policy.status === "pass" ? (
                                <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">{t("social.cpPolicyPass")}</span>
                              ) : (
                                <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">{t("social.cpFlagged")}</span>
                              )}
                            </div>
                            <p className="whitespace-pre-wrap text-sm text-slate-700">{v.caption}</p>
                            {targets.length > 0 ? (
                              <button type="button" className="btn-secondary btn-sm" onClick={() => applyPlatformVariant(v.platform, v.caption)}>
                                {t("social.cpApplyVariant", { names: targets.map((a) => a.name).join(", ") })}
                              </button>
                            ) : (
                              <p className="text-xs text-slate-400">{t("social.cpNoAccountForPlatform")}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Hashtag sets */}
              <div className="space-y-2 border-t border-indigo-100 pt-3">
                <div className="text-sm font-medium">{t("social.cpSavedHashtagSets")}</div>
                {hashtagSets.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {hashtagSets.map((s) => (
                      <button key={s.id} type="button" onClick={() => applyHashtagSet(s)}
                        className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
                        title={s.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}>
                        {s.name} ({s.tags.length})
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="soc-empty-sm">
                    <p className="text-xs text-slate-400">{t("social.cpNoHashtagSets")}</p>
                  </div>
                )}
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block min-w-[200px] flex-1 text-sm">{t("social.cpSetName")}
                    <input className={inputCls} value={hashtagSetName} onChange={(e) => setHashtagSetName(e.target.value)} placeholder={t("social.cpSetNamePlaceholder")} />
                  </label>
                  <button type="button" className="btn-secondary disabled:opacity-50" disabled={busy !== ""} onClick={saveHashtagSet}>
                    {busy === "ai-save-set" ? t("social.cpSaving") : t("social.cpSaveAsSet")}
                  </button>
                </div>
                <p className="text-xs text-slate-400">{t("social.cpSetSaveNote", { count: fmtNumber(locale, selectedHashtags.length) })}</p>
              </div>

              {/* SU4: hashtag advice from the org's own published data */}
              <div className="space-y-2 border-t border-indigo-100 pt-3">
                <div className="text-sm font-medium">{t("social.cpHashtagAdvice")}</div>
                {hashtagInsights && hashtagInsights.postsConsidered > 0 && hashtagInsights.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {hashtagInsights.tags.map((ht) => {
                      const normalized = ht.tag.startsWith("#") ? ht.tag : `#${ht.tag}`;
                      const active = selectedHashtags.includes(normalized);
                      return (
                        <button key={ht.tag} type="button" onClick={() => toggleHashtag(normalized)}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                          {t("social.cpTagStats", { tag: normalized, avg: fmtNumber(locale, ht.avgEngagement), posts: fmtNumber(locale, ht.posts) })}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">{t("social.cpNoHashtagData")}</p>
                )}
              </div>

              {/* SU4: monthly content plan */}
              <div className="space-y-3 border-t border-indigo-100 pt-3">
                <div className="text-sm font-medium">{t("social.cpContentPlan")}</div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block text-sm">{t("social.cpMonth")}
                    <input type="month" className={inputCls} value={planMonth} onChange={(e) => setPlanMonth(e.target.value)} />
                  </label>
                  <label className="block min-w-[180px] flex-1 text-sm">{t("social.cpPillars")}
                    <input className={inputCls} value={planPillars} onChange={(e) => setPlanPillars(e.target.value)} placeholder={t("social.cpPillarsPlaceholder")} />
                  </label>
                  <label className="block min-w-[180px] flex-1 text-sm">{t("social.cpFocus")}
                    <input className={inputCls} value={planFocus} onChange={(e) => setPlanFocus(e.target.value)} placeholder={t("social.cpFocusPlaceholder")} />
                  </label>
                  <button type="button" className="btn-ai" disabled={busy !== ""} onClick={generateContentPlan}>
                    {busy === "ai-plan" ? t("social.cpGenerating") : t("social.cpMakePlan")}
                  </button>
                </div>
                {contentPlan ? (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">{t("social.cpPlanMeta", { month: contentPlan.month, status: contentPlan.status, pillars: contentPlan.pillars.join(", ") || "—" })}</p>
                    <div className="space-y-2">
                      {contentPlan.items.map((item, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-xl bg-white p-3">
                          <input type="checkbox" className="mt-1" checked={planSelectedItems[i] ?? false}
                            onChange={(e) => setPlanSelectedItems((s) => ({ ...s, [i]: e.target.checked }))} />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5 text-sm">
                              <span className="font-medium">{t("social.cpPlanDay", { day: fmtNumber(locale, item.day) })}</span>
                              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700">{item.pillar}</span>
                              {item.productName ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{item.productName}</span> : null}
                              {item.materializedPostId ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700">{t("social.cpDraftCreated")}</span> : null}
                            </div>
                            <p className="whitespace-pre-wrap text-sm text-slate-700">{item.caption}</p>
                            {item.mediaIdea ? <p className="text-xs text-slate-500">{t("social.cpMediaIdea", { idea: item.mediaIdea })}</p> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="block min-w-[200px] flex-1 text-sm">{t("social.cpDraftAccount")}
                        <select className={inputCls} value={planAccountId} onChange={(e) => setPlanAccountId(e.target.value)}>
                          <option value="">{t("social.cpChooseAccount")}</option>
                          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({PLATFORM_LABELS[a.platform] ?? a.platform})</option>)}
                        </select>
                      </label>
                      <button type="button" className="btn-secondary disabled:opacity-50" disabled={busy !== ""} onClick={materializeContentPlan}>
                        {busy === "ai-plan-materialize" ? t("social.cpDraftCreating") : t("social.cpMakeDrafts")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="soc-empty-sm">
                    <p className="text-xs text-slate-400">{t("social.cpNoPlan")}</p>
                  </div>
                )}
              </div>

              {/* SU4: Reel / Short script */}
              <div className="space-y-3 border-t border-indigo-100 pt-3">
                <div className="text-sm font-medium">{t("social.cpScriptTitle")}</div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block min-w-[200px] flex-1 text-sm">{t("social.cpTopic")}
                    <input className={inputCls} value={scriptTopic} onChange={(e) => setScriptTopic(e.target.value)} placeholder={t("social.cpScriptTopicPlaceholder")} />
                  </label>
                  <label className="block min-w-[180px] flex-1 text-sm">{t("social.cpProductOptional")}
                    <select className={inputCls} value={scriptProductId} onChange={(e) => setScriptProductId(e.target.value)}>
                      <option value="">{t("social.cpNoProduct")}</option>
                      {aiProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <button type="button" className="btn-ai" disabled={busy !== ""} onClick={generateAiScript}>
                    {busy === "ai-script" ? t("social.cpGenerating") : t("social.cpMakeScript")}
                  </button>
                </div>
                {aiScript ? (
                  <div className="space-y-2 rounded-xl bg-white p-3">
                    <p className="text-base font-semibold text-slate-800">{aiScript.hook}</p>
                    {aiScript.onScreenText.length > 0 ? (
                      <div>
                        <div className="text-sm font-medium">{t("social.cpOnScreenText")}</div>
                        <ul className="list-inside list-disc text-sm text-slate-700">
                          {aiScript.onScreenText.map((line, i) => <li key={i}>{line}</li>)}
                        </ul>
                      </div>
                    ) : null}
                    {aiScript.shotList.length > 0 ? (
                      <div>
                        <div className="text-sm font-medium">{t("social.cpShotList")}</div>
                        <ol className="list-inside list-decimal text-sm text-slate-700">
                          {aiScript.shotList.map((shot, i) => <li key={i}>{shot}</li>)}
                        </ol>
                      </div>
                    ) : null}
                    {aiScript.captionDraft ? (
                      <div className="space-y-1">
                        <div className="text-sm font-medium">{t("social.cpCaptionDraft")}</div>
                        <p className="whitespace-pre-wrap text-sm text-slate-700">{aiScript.captionDraft}</p>
                        <button type="button" className="btn-secondary btn-sm" onClick={() => setCaption(aiScript.captionDraft)}>{t("social.cpUseAsCaption")}</button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

      </div>

      {/* SD3 Step 2 — Media */}
      <div className="soc-section-card">
        <div className="flex items-center gap-2.5">
          <span className="soc-step-num">{fmtNumber(locale, 2)}</span>
          <div className="text-sm font-semibold">{t("social.cpMediaMax", { max: fmtNumber(locale, MAX_MEDIA) })}</div>
        </div>
        <div className="space-y-3">
          <div
            className={`soc-dropzone ${dragOver ? "soc-dropzone-active" : ""} space-y-3`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void uploadFiles(Array.from(e.dataTransfer.files)); }}
          >
          {selectedMedia.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedMedia.map((m) => (
                <div key={m.assetId} className="relative">
                  <MediaThumb assetId={m.assetId} kind={m.kind} className="h-20 w-20 rounded-lg object-cover" />
                  <button type="button" aria-label={t("social.cpRemoveMediaAria", { name: m.name ?? t("social.cpMediaFallback") })}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold text-white shadow"
                    onClick={() => setSelectedMedia((prev) => prev.filter((x) => x.assetId !== m.assetId))}>✕</button>
                  {m.name ? <div className="mt-0.5 w-20 truncate text-xs text-slate-400" title={m.name}>{m.name}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">{t("social.cpNoMedia")}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className={`btn-secondary btn-sm cursor-pointer ${busy !== "" ? "pointer-events-none opacity-50" : ""}`}>
              {busy === "upload" ? t("social.cpUploading") : t("social.cpUploadNew")}
              <input type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadMedia(f); }} />
            </label>
            <button type="button" className="btn-secondary btn-sm" onClick={() => { setShowLibrary((s) => !s); if (!showLibrary) { loadAssets().catch(() => undefined); loadMediaFolders().catch(() => undefined); } }}>
              {t("social.cpMediaLibraryToggle", { state: showLibrary ? t("social.cpLibHide") : t("social.cpLibPick") })}
            </button>
          </div>
          </div>
          <p className="text-xs text-slate-400">{t("social.cpMediaLimits", { image: formatMb(mediaLimits?.imageMaxBytes ?? 2_100_000, locale), video: formatMb(mediaLimits?.videoMaxBytes ?? 268_435_456, locale) })}</p>
          {/* PP3: Product থেকে ছবি import */}
          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <div className="text-sm font-medium">{t("social.cpProductImage")}</div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[200px] flex-1 text-sm">{t("social.cpChooseProduct")}
                <select className={inputCls} value={importProductId} onChange={(e) => { setImportProductId(e.target.value); setImportError(""); }}>
                  <option value="">{t("social.cpChooseProduct")}</option>
                  {aiProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <button type="button" className="btn-secondary disabled:opacity-50" disabled={busy !== "" || !importProductId} onClick={importProductImage}>
                {busy === "import-media" ? t("social.cpImporting") : t("social.cpImportImage")}
              </button>
            </div>
            {importError ? <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{importError}</p> : null}
            <p className="text-xs text-slate-400">{t("social.cpProductImageNote")}</p>
          </div>
          {/* SP4: AI image generation */}
          <div className="space-y-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
            <div className="font-semibold">{t("social.cpAiImage")}</div>
            {imageStatus && !imageStatus.configured ? (
              <p className="text-sm text-slate-500">{t("social.cpAiImageNotConfigured")}</p>
            ) : (
              <div className="space-y-3">
                <label className="block text-sm">{t("social.cpImagePrompt")}
                  <textarea className={inputCls} rows={3} value={aiImagePrompt} onChange={(e) => setAiImagePrompt(e.target.value)} placeholder={t("social.cpImagePromptPlaceholder")} />
                </label>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block min-w-[200px] flex-1 text-sm">{t("social.cpProductForPrompt")}
                    <select className={inputCls} value={aiImageProductId} onChange={(e) => setAiImageProductId(e.target.value)}>
                      <option value="">{t("social.cpNoProduct")}</option>
                      {aiProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <button type="button" className="btn-ai" disabled={busy !== ""} onClick={generateAiImage}>
                    {busy === "ai-image" ? t("social.cpGenerating") : t("social.cpMakeImage")}
                  </button>
                </div>
                <p className="text-xs text-slate-400">{t("social.cpAiImageNote")}</p>
              </div>
            )}
          </div>

          {/* SP4: template poster composer */}
          <div className="space-y-3 rounded-xl border border-teal-100 bg-teal-50/40 p-4">
            <div className="font-semibold">{t("social.cpTemplatePoster")}</div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[200px] flex-1 text-sm">{t("social.cpTemplateImage")}{templateProductId ? t("social.cpTemplateImageSuffix") : ""}
                <select className={inputCls} value={templateAssetId} onChange={(e) => setTemplateAssetId(e.target.value)}>
                  <option value="">{t("social.cpChooseImage")}</option>
                  {assets.filter((a) => a.kind === "image").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label className="block min-w-[200px] flex-1 text-sm">{t("social.cpProductOptional")}
                <select className={inputCls} value={templateProductId} onChange={(e) => setTemplateProductId(e.target.value)}>
                  <option value="">{t("social.cpNoProduct")}</option>
                  {aiProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
            <p className="text-xs text-teal-700">{t("social.cpTemplateProductNote")}</p>
            <label className="block text-sm">Headline
              <input className={inputCls} value={templateHeadline} onChange={(e) => setTemplateHeadline(e.target.value)} placeholder={t("social.cpHeadlinePlaceholder")} maxLength={120} />
            </label>
            <label className="block text-sm">{t("social.cpSubtext")}
              <input className={inputCls} value={templateSubtext} onChange={(e) => setTemplateSubtext(e.target.value)} placeholder={t("social.cpSubtextPlaceholder")} maxLength={160} />
            </label>
            <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={createTemplatePoster}>
              {busy === "template-image" ? t("social.cpGenerating") : t("social.cpMakePoster")}
            </button>
            <p className="text-xs text-slate-400">{t("social.cpPosterNote")}</p>
            {templatePoster ? (
              <div className="flex flex-wrap items-center gap-3">
                <MediaThumb assetId={templatePoster.id} kind="image" className="h-24 w-24 rounded-lg object-cover" />
                <div className="space-y-1">
                  <div className="text-sm font-medium">{templatePoster.name}</div>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => attachMedia({ assetId: templatePoster.id, kind: templatePoster.kind, name: templatePoster.name })}>{t("social.cpUseInPost")}</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

      </div>

      {/* SD3 Step 3 — Accounts & variants */}
      <div className="soc-section-card">
        <div className="flex items-center gap-2.5">
          <span className="soc-step-num">{fmtNumber(locale, 3)}</span>
          <div className="text-sm font-semibold">{t("social.cpAccountsFor")}{editingPostId ? "" : t("social.cpAccountsMulti")}</div>
        </div>
        <div className="space-y-2">
          {accounts.length === 0 ? (
            <div className="soc-empty-sm">
              <p className="text-sm text-slate-400">{t("social.cpConnectFirst")}</p>
            </div>
          ) : accounts.map((a) => {
            const usable = a.status === "connected";
            return (
              <label key={a.id} className={`flex items-center gap-2.5 text-sm ${usable ? "" : "opacity-60"}`}>
                <input type="checkbox" disabled={!usable || editingPostId !== null}
                  checked={accountSelected[a.id] ?? false}
                  onChange={(e) => setAccountSelected((s) => ({ ...s, [a.id]: e.target.checked }))} />
                <AccountAvatar name={a.name} pictureUrl={a.pictureUrl} platform={a.platform} />
                <span className="font-medium">{a.name}</span>
                <span className="badge-slate">{PLATFORM_LABELS[a.platform] ?? a.platform}</span>
                {(a.platform === "instagram" || a.platform === "telegram" || a.platform === "threads") && a.username ? <span className="text-xs text-slate-500">@{a.username}</span> : null}
                {!usable ? (
                  <span className="text-xs text-red-600">
                    ({metaLabel(ACCOUNT_STATUS_META[a.status], t, a.status)}{a.lastError ? ` — ${a.lastError}` : ""})
                  </span>
                ) : null}
              </label>
            );
          })}
          {editingPostId ? <p className="text-xs text-slate-400">{t("social.cpEditAccountLocked")}</p> : null}
          {!editingPostId && accounts.some((a) => (a.platform === "tiktok" || a.platform === "youtube") && a.status === "connected" && accountSelected[a.id]) ? (
            <p className="rounded-lg bg-violet-50 p-2.5 text-xs text-violet-800">
              {t("social.cpTiktokYtNoteA")}<strong>{t("social.cpExactlyOneVideo")}</strong>{t("social.cpTiktokYtNoteB")}
              {accounts.some((a) => a.platform === "tiktok" && a.status === "connected" && accountSelected[a.id]) && platformModes && !platformModes.tiktok.audited
                ? t("social.cpTiktokInboxSuffix")
                : null}
            </p>
          ) : null}
          {!editingPostId && accounts.some((a) => a.platform === "telegram" && a.status === "connected" && accountSelected[a.id]) ? (
            <p className="rounded-lg bg-sky-50 p-2.5 text-xs text-sky-800">
              {t("social.cpTelegramNoteA")}<strong>{t("social.cpTenMedia")}</strong>{t("social.cpTelegramNoteB")}
            </p>
          ) : null}
          {!editingPostId && accounts.some((a) => a.platform === "threads" && a.status === "connected" && accountSelected[a.id]) ? (
            <p className="rounded-lg bg-slate-100 p-2.5 text-xs text-slate-700">
              {t("social.cpThreadsNoteA")}<strong>{t("social.cp500Chars")}</strong>{t("social.cpThreadsNoteB")}<strong>{t("social.cp20Media")}</strong>{t("social.cpThreadsNoteC")}
            </p>
          ) : null}
        </div>

        {/* SU1: per-account variant panels (multiple accounts, or
            a single account once SN4/a hand edit has put an
            override on it — otherwise an applied AI variant would
            be invisible and uneditable). */}
        {!editingPostId && (composerTargets.length > 1 || composerTargets.some((a) => ((variantOverrides[a.id]?.caption ?? "").trim() || (variantOverrides[a.id]?.firstCommentText ?? "").trim()))) ? (
          <div className="space-y-3 rounded-xl border border-slate-200 p-4">
            <div className="text-sm font-semibold">{t("social.cpVariantTitle")}</div>
            <p className="text-xs text-slate-400">{t("social.cpVariantNote")}</p>
            {composerTargets.map((a) => (
              <div key={a.id} className="space-y-2 rounded-lg bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <PlatformDot platform={a.platform} />
                  <span className="font-medium">{a.name}</span>
                  <span className="badge-slate">{PLATFORM_LABELS[a.platform] ?? a.platform}</span>
                </div>
                <label className="block text-xs text-slate-500">{t("social.cpCaptionOverride")}
                  <textarea className="input mt-1" rows={2}
                    value={variantOverrides[a.id]?.caption ?? ""}
                    onChange={(e) => setVariantOverrides((s) => ({ ...s, [a.id]: { ...s[a.id], caption: e.target.value } }))}
                    placeholder={t("social.cpCaptionOverridePlaceholder")} />
                </label>
                {/* SN4: translate this account's effective caption
                    (its override, or the main caption when the
                    override is empty) — result shown, applied by hand. */}
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-100 disabled:opacity-50"
                    disabled={busy !== ""}
                    onClick={() => translateComposerText(`variant-${a.id}`, (variantOverrides[a.id]?.caption ?? "").trim() || caption, "en")}>
                    {busy === `ai-translate-variant-${a.id}` ? t("social.cpTranslating") : t("social.cpTranslateToEn")}
                  </button>
                  <button type="button" className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-100 disabled:opacity-50"
                    disabled={busy !== ""}
                    onClick={() => translateComposerText(`variant-${a.id}`, (variantOverrides[a.id]?.caption ?? "").trim() || caption, "bn")}>
                    {busy === `ai-translate-variant-${a.id}` ? t("social.cpTranslating") : t("social.cpTranslateToBn")}
                  </button>
                </div>
                {translations[`variant-${a.id}`] ? (
                  <div className="space-y-1.5 rounded-lg bg-white p-2.5">
                    <p className="whitespace-pre-wrap text-xs text-slate-700">{translations[`variant-${a.id}`].text}</p>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setVariantOverrides((s) => ({ ...s, [a.id]: { ...s[a.id], caption: translations[`variant-${a.id}`].text } }))}>
                      {t("social.cpUseTranslationVariant")}
                    </button>
                  </div>
                ) : null}
                {isFirstCommentApplicable(a.platform) ? (
                  <label className="block text-xs text-slate-500">{t("social.cpFirstCommentOverride")}
                    <input className="input mt-1"
                      value={variantOverrides[a.id]?.firstCommentText ?? ""}
                      onChange={(e) => setVariantOverrides((s) => ({ ...s, [a.id]: { ...s[a.id], firstCommentText: e.target.value } }))}
                      placeholder={t("social.cpFirstCommentOverridePlaceholder")} />
                  </label>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

      </div>
      </div>

      {/* SD3: sticky preview rail — the SU1 platform preview (pure UI
          from the composer state, no fetch), moved out of the form
          column into a rail that sticks on desktop; on mobile it
          stacks below the steps. */}
      {composerTargets.length > 0 ? (
        <div className="min-w-0 lg:sticky lg:top-[148px]">
          <div className="soc-section-card">
            <div className="text-sm font-semibold">{t("social.cpPreviewTitle")}</div>
            <div className="grid gap-3">
              {composerTargets.map((a) => {
                const override = variantOverrides[a.id];
                const effectiveCaption = !editingPostId && (override?.caption ?? "").trim() ? (override?.caption as string) : caption;
                const effectiveFirstComment = !editingPostId && (override?.firstCommentText ?? "").trim() ? (override?.firstCommentText as string) : firstCommentText;
                const preview = buildPlatformPreview(a.platform, {
                  caption: effectiveCaption,
                  linkUrl: linkUrl.trim() || null,
                  mediaKinds: selectedMedia.map((m) => m.kind),
                  firstCommentText: effectiveFirstComment,
                }, locale);
                return (
                  <div key={a.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <PlatformDot platform={a.platform} />
                      <span className="font-medium text-sm">{a.name}</span>
                      <span className="badge-slate">{preview.label}</span>
                      <span className="badge-brand">{preview.mediaSummary}</span>
                    </div>
                    {preview.title ? <p className="text-sm font-semibold text-slate-800">{preview.title}</p> : null}
                    <p className="whitespace-pre-wrap text-sm text-slate-700 line-clamp-4">{preview.description ?? preview.captionShown}{(preview.description ?? preview.captionShown) ? "" : <span className="text-slate-400">{t("social.cpNoCaption")}</span>}</p>
                    {linkUrl.trim() ? <p className="truncate text-xs text-indigo-600">{linkUrl.trim()}</p> : null}
                    {preview.firstCommentShown ? (
                      <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-xs text-slate-600">{t("social.cpFirstCommentShown", { text: preview.firstCommentShown })}</p>
                    ) : null}
                    {/* SD3: the SAME pre-flight warnings, shown as a
                        checklist — ✗ per failing rule, one ✓ line
                        when an account passes every rule. */}
                    {preview.warnings.length > 0 ? (
                      <ul className="space-y-1.5">
                        {preview.warnings.map((w, i) => (
                          <li key={i} className="flex items-start gap-1.5 rounded-lg bg-red-50 px-2 py-1.5 text-xs font-medium text-red-700">
                            <span aria-hidden="true">✗</span>
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="flex items-center gap-1.5 rounded-lg bg-green-50 px-2 py-1.5 text-xs font-medium text-green-700">
                        <span aria-hidden="true">✓</span> {t("social.cpReady")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      </div>

      {/* SD3 Step 4 — Save & CSV import: full-width card under the
          steps/rail grid (the save action also lives on the mobile
          sticky action bar below). */}
      <div className="soc-section-card">
        <div className="flex items-center gap-2.5">
          <span className="soc-step-num">{fmtNumber(locale, 4)}</span>
          <div className="text-sm font-semibold">{t("social.cpSaveSection")}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={saveDraft}>
            {busy === "save" ? t("social.cpSaving") : editingPostId ? t("social.cpSaveChanges") : t("social.cpSaveDraft")}
          </button>
          <p className="text-xs text-slate-400">{t("social.cpSaveNote")}</p>
        </div>

        {/* SU11: CSV bulk draft import */}
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <div className="text-sm font-semibold">{t("social.cpCsvTitle")}</div>
          <p className="text-xs text-slate-400">{t("social.cpCsvNote")}</p>
          <label className={`btn-secondary btn-sm cursor-pointer ${busy !== "" ? "pointer-events-none opacity-50" : ""}`}>
            {busy === "csv-import" ? t("social.cpImporting") : t("social.cpCsvPick")}
            <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void importPostsCsv(file); }} />
          </label>
          {csvImportResults ? (
            <div className="space-y-1">
              <p className="text-sm text-slate-700">{t("social.cpCsvSummary", { created: fmtNumber(locale, csvImportResults.created), failed: fmtNumber(locale, csvImportResults.failed) })}</p>
              {csvImportResults.results.map((r) => (
                <p key={r.row} className={`text-xs ${r.ok ? "text-green-700" : "text-red-600"}`}>
                  {t("social.cpCsvRow", { row: fmtNumber(locale, r.row) })}{r.ok ? t("social.cpCsvRowOk") : `❌ ${r.error ?? t("social.cpCsvRowFail")}`}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* SD3: mobile sticky action bar — the composer's own save
          action, same handler and same busy guard as the in-card
          button above (whichever is tapped, busy disables both, so
          there is no double submit). Schedule / Publish Now act on
          saved posts from the Posts tab and have no composer-level
          handler, so the bar honestly carries only Save. */}
      <div className="soc-action-bar">
        <button type="button" className="btn-primary min-h-[44px] w-full disabled:opacity-50" disabled={busy !== ""} onClick={saveDraft}>
          {busy === "save" ? t("social.cpSaving") : editingPostId ? t("social.cpSaveChanges") : t("social.cpSaveDraft")}
        </button>
      </div>
    </div>
  );
}
