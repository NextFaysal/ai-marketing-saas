"use client";
import React, { useMemo, useState } from "react";
import { EmptyState } from "@repo/ui";
import { WORKFLOW_BLUEPRINTS_CATALOG, bpText, type WorkflowBlueprint } from "@/lib/workflow-blueprints";
import { useLocale } from "@/lib/i18n/provider";
import { sharedBn, sharedEn } from "@/lib/i18n/shared";
import { fmtNumber, type UiLocale } from "@repo/contracts";

const BUSINESS_BLUEPRINTS = WORKFLOW_BLUEPRINTS_CATALOG;

// Step-meta labels via the shared dictionary, exactly as
// workflows/page.tsx's getStepMeta does (STEP_LABEL_KEY pattern):
// the label is localized, icon + badge classes stay fixed.
const STEP_LABEL_KEY: Record<string, keyof typeof sharedBn> = {
  send_email: "stepSendEmail", send_sms: "stepSendSms", send_inbox_message: "stepSendInboxMessage", wait: "stepWait",
  condition: "stepCondition", branch: "stepBranch", change_lead_stage: "stepChangeLeadStage", add_tag: "stepAddTag",
  notify_team: "stepNotifyTeam", notify_channel: "stepNotifyChannel", ai_generate: "stepAiGenerate",
  add_lead_activity: "stepAddLeadActivity", add_conversation_note: "stepAddConversationNote",
  assign_conversation: "stepAssignConversation", create_follow_up: "stepCreateFollowUp", http_webhook: "stepHttpWebhook",
};

function getStepMeta(type: string, locale: UiLocale = "bn"): { label: string; icon: string; badgeCls: string } {
  const key = STEP_LABEL_KEY[type];
  if (key) {
    const base = getStepMetaBase(type);
    return { ...base, label: (locale === "en" ? sharedEn : sharedBn)[key] };
  }
  return getStepMetaBase(type);
}

function getStepMetaBase(type: string): { label: string; icon: string; badgeCls: string } {
  switch (type) {
    case "send_email":
      return { label: sharedBn.stepSendEmail, icon: "✉️", badgeCls: "bg-sky-50 text-sky-700 border-sky-200" };
    case "send_sms":
      return { label: sharedBn.stepSendSms, icon: "📱", badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "add_lead_activity":
      return { label: sharedBn.stepAddLeadActivity, icon: "📝", badgeCls: "bg-indigo-50 text-indigo-700 border-indigo-200" };
    case "add_conversation_note":
      return { label: sharedBn.stepAddConversationNote, icon: "🔒", badgeCls: "bg-violet-50 text-violet-700 border-violet-200" };
    case "send_inbox_message":
      return { label: sharedBn.stepSendInboxMessage, icon: "💬", badgeCls: "bg-teal-50 text-teal-700 border-teal-200" };
    case "wait":
      return { label: sharedBn.stepWait, icon: "⏱️", badgeCls: "bg-amber-50 text-amber-700 border-amber-200" };
    case "condition":
      return { label: sharedBn.stepCondition, icon: "🔍", badgeCls: "bg-amber-50 text-amber-700 border-amber-200" };
    case "branch":
      return { label: sharedBn.stepBranch, icon: "🔀", badgeCls: "bg-purple-50 text-purple-700 border-purple-200" };
    case "assign_conversation":
      return { label: sharedBn.stepAssignConversation, icon: "👤", badgeCls: "bg-blue-50 text-blue-700 border-blue-200" };
    case "change_lead_stage":
      return { label: sharedBn.stepChangeLeadStage, icon: "🏷️", badgeCls: "bg-indigo-50 text-indigo-700 border-indigo-200" };
    case "add_tag":
      return { label: sharedBn.stepAddTag, icon: "🏷️", badgeCls: "bg-slate-100 text-slate-700 border-slate-300" };
    case "notify_team":
      return { label: sharedBn.stepNotifyTeam, icon: "👥", badgeCls: "bg-orange-50 text-orange-700 border-orange-200" };
    case "create_follow_up":
      return { label: sharedBn.stepCreateFollowUp, icon: "📅", badgeCls: "bg-rose-50 text-rose-700 border-rose-200" };
    case "http_webhook":
      return { label: sharedBn.stepHttpWebhook, icon: "🌐", badgeCls: "bg-cyan-50 text-cyan-700 border-cyan-200" };
    case "notify_channel":
      return { label: sharedBn.stepNotifyChannel, icon: "📢", badgeCls: "bg-indigo-50 text-indigo-700 border-indigo-200" };
    case "ai_generate":
      return { label: sharedBn.stepAiGenerate, icon: "🤖", badgeCls: "bg-purple-50 text-purple-700 border-purple-200" };
    default:
      return { label: type, icon: "⚡", badgeCls: "bg-slate-100 text-slate-700 border-slate-200" };
  }
}

interface WorkflowPresetsTabProps {
  triggers: { value: string; label: string; icon: string }[];
  presets: { key: string; name: string; descriptionBn: string }[];
  loadBlueprint: (bp: WorkflowBlueprint) => void;
  openBlueprintInCanvas: (bp: WorkflowBlueprint) => void;
  installPreset: (key: string, name: string) => Promise<void>;
}

export default function WorkflowPresetsTab({
  triggers,
  presets,
  loadBlueprint,
  openBlueprintInCanvas,
  installPreset,
}: WorkflowPresetsTabProps) {
  const { t, locale } = useLocale();
  const [blueprintCategory, setBlueprintCategory] = useState<string>("all");
  const [blueprintSearch, setBlueprintSearch] = useState("");

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: BUSINESS_BLUEPRINTS.length };
    for (const bp of BUSINESS_BLUEPRINTS) {
      counts[bp.category] = (counts[bp.category] || 0) + 1;
    }
    return counts;
  }, []);

  const filteredBlueprints = useMemo(() => {
    return BUSINESS_BLUEPRINTS.filter((b) => {
      if (blueprintCategory !== "all" && b.category !== blueprintCategory) {
        return false;
      }
      if (blueprintSearch.trim()) {
        const q = blueprintSearch.toLowerCase().trim();
        const matchName = b.name.toLowerCase().includes(q);
        const matchCat = b.catLabel.toLowerCase().includes(q);
        const matchProblem = b.problemBn.toLowerCase().includes(q);
        const matchSolution = b.solutionBn.toLowerCase().includes(q);
        const matchImpact = b.impactBn.toLowerCase().includes(q);
        if (!matchName && !matchCat && !matchProblem && !matchSolution && !matchImpact) {
          return false;
        }
      }
      return true;
    });
  }, [blueprintCategory, blueprintSearch]);

  return (
    <div className="space-y-6">
      {/* Header & Search Bar Card */}
      <div className="card p-5 sm:p-6 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">{t("workflows.galleryTitle")}</h2>
              <span className="badge badge-brand font-bold">{t("workflows.galleryCount")}</span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {t("workflows.galleryIntro")}
            </p>
          </div>

          {(blueprintCategory !== "all" || blueprintSearch.trim()) && (
            <button
              type="button"
              onClick={() => {
                setBlueprintCategory("all");
                setBlueprintSearch("");
              }}
              className="btn-secondary btn-xs self-start sm:self-center"
            >
              {t("workflows.resetFilter")}
            </button>
          )}
        </div>

        {/* Smart Search Bar */}
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            type="text"
            className="input !pl-10 !pr-10 !py-2.5 w-full text-sm rounded-xl border-slate-200 focus:border-brand-500 focus:ring-brand-500"
            placeholder={t("workflows.gallerySearchPlaceholder")}
            value={blueprintSearch}
            onChange={(e) => setBlueprintSearch(e.target.value)}
          />
          {blueprintSearch && (
            <button
              type="button"
              onClick={() => setBlueprintSearch("")}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
              title={t("workflows.clearSearch")}
            >
              ✕
            </button>
          )}
        </div>

        {/* Categorized Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1 border-t border-slate-100">
          <span className="text-xs font-semibold text-slate-400 mr-1">{t("workflows.categoryLabel")}</span>
          {[
            { id: "all", label: t("workflows.catAll"), icon: "✨", count: categoryCounts.all || BUSINESS_BLUEPRINTS.length },
            { id: "ecommerce", label: t("workflows.catEcomSales"), icon: "🛍️", count: categoryCounts.ecommerce || 0 },
            { id: "courier", label: t("workflows.catCourierReturn"), icon: "🚚", count: categoryCounts.courier || 0 },
            { id: "leads", label: t("workflows.catLeadCrm"), icon: "👥", count: categoryCounts.leads || 0 },
            { id: "inbox", label: t("workflows.catInboxCare"), icon: "💬", count: categoryCounts.inbox || 0 },
            { id: "ai", label: t("workflows.catAiAuto"), icon: "🤖", count: categoryCounts.ai || 0 },
            { id: "ops", label: t("workflows.catTeamOps"), icon: "📢", count: categoryCounts.ops || 0 },
            { id: "schedule", label: t("workflows.catScheduleRoutine"), icon: "⏰", count: categoryCounts.schedule || 0 },
          ].map((cat) => {
            const isActive = blueprintCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setBlueprintCategory(cat.id)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-medium transition ${
                  isActive
                    ? "bg-brand-600 text-white shadow-sm ring-1 ring-brand-700"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200/80"
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    isActive ? "bg-white/25 text-white" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {fmtNumber(locale, cat.count)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Result Stats Line */}
        <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
          <div>
            {t("workflows.showingLine")} <strong className="text-slate-800">{fmtNumber(locale, filteredBlueprints.length)}</strong> {t("workflows.showingSuffix")}
            {blueprintSearch && ` ${t("workflows.forSearchSuffix", { q: blueprintSearch })}`}
          </div>
        </div>
      </div>

      {/* Blueprint Cards Grid */}
      {filteredBlueprints.length === 0 ? (
        <div className="card p-10">
          <EmptyState
            title={t("workflows.noBlueprints")}
            description={t("workflows.noBlueprintsHint", { q: blueprintSearch })}
            actionLabel={t("workflows.showAllBlueprints")}
            onAction={() => {
              setBlueprintCategory("all");
              setBlueprintSearch("");
            }}
          />
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredBlueprints.map((bp) => {
            const tr = triggers.find((t) => t.value === bp.trigger);
            return (
              <div
                key={bp.key}
                className="card card-hover p-5 border border-slate-200/90 flex flex-col justify-between hover:shadow-md hover:border-brand-200 transition-all duration-200"
              >
                <div className="space-y-3">
                  {/* Top Badges */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="badge badge-brand text-[11px] font-medium">{bpText(bp, "catLabel", locale)}</span>
                    <div className="flex items-center gap-1.5">
                      {bp.badge && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200">
                          ★ {bp.badge}
                        </span>
                      )}
                      <span className="badge badge-slate text-[10px]">
                        {tr?.icon} {tr?.label}
                      </span>
                    </div>
                  </div>

                  {/* Workflow Name */}
                  <h3 className="text-base font-bold text-slate-900 leading-snug">{bpText(bp, "name", locale)}</h3>

                  {/* Problem Block */}
                  <div className="rounded-xl bg-rose-50/70 p-3 text-xs border border-rose-100/80 text-rose-950 space-y-1">
                    <div className="font-bold text-rose-700 flex items-center gap-1.5 text-[11px]">
                      <span>🔴</span>
                      <span>{t("workflows.bpProblemLabel")}</span>
                    </div>
                    <p className="text-slate-700 leading-relaxed text-[11.5px]">{bpText(bp, "problem", locale)}</p>
                  </div>

                  {/* Solution Block */}
                  <div className="rounded-xl bg-emerald-50/70 p-3 text-xs border border-emerald-100/80 text-emerald-950 space-y-1">
                    <div className="font-bold text-emerald-700 flex items-center gap-1.5 text-[11px]">
                      <span>🟢</span>
                      <span>{t("workflows.bpSolutionLabel")}</span>
                    </div>
                    <p className="text-slate-700 leading-relaxed text-[11.5px]">{bpText(bp, "solution", locale)}</p>
                  </div>

                  {/* Impact / ROI Box */}
                  <div className="rounded-xl bg-indigo-50/70 p-2.5 text-xs border border-indigo-100/80 text-indigo-950 flex items-start gap-1.5">
                    <span className="font-bold text-indigo-700 shrink-0 text-[11px]">{t("workflows.bpImpactLabel")}</span>
                    <span className="text-indigo-900 font-medium text-[11.5px] leading-snug">{bpText(bp, "impact", locale)}</span>
                  </div>

                  {/* Conditions (if any) */}
                  {bp.conditions && bp.conditions.length > 0 && (
                    <div className="rounded-lg bg-amber-50/50 px-2.5 py-1.5 text-[11px] text-amber-900 border border-amber-100 flex items-center gap-1.5">
                      <span className="font-semibold text-amber-700 shrink-0">{t("workflows.bpCondLabel")}</span>
                      <span className="font-mono text-[10.5px] truncate">
                        {bp.conditions.map((c) => `${c.field} ${c.op} ${c.value}`).join(t("workflows.bpAnd"))}
                      </span>
                    </div>
                  )}

                  {/* Steps Pipeline Preview */}
                  <div className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-700 border border-slate-100 space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <span>{t("workflows.bpStepsLabel")}</span>
                      <span className="text-slate-500 font-mono">{t("workflows.bpStepsSuffix", { count: fmtNumber(locale, bp.steps.length) })}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                      {bp.steps.map((st, sIdx) => {
                        const meta = getStepMeta(st.type, locale);
                        return (
                          <React.Fragment key={sIdx}>
                            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium border ${meta.badgeCls}`}>
                              <span>{meta.icon}</span>
                              <span>{meta.label}</span>
                            </span>
                            {sIdx < bp.steps.length - 1 && <span className="text-slate-300 text-xs">➔</span>}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-primary btn-sm flex-1 font-semibold"
                    onClick={() => loadBlueprint(bp)}
                    title={t("workflows.bpLoadBuilderTitle")}
                  >
                    {t("workflows.bpLoadBuilder")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm font-semibold"
                    onClick={() => openBlueprintInCanvas(bp)}
                    title={t("workflows.bpCanvasTitle")}
                  >
                    {t("workflows.canvasBtn")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Server-Provided Presets (if any configured on server) */}
      {presets.length > 0 && (
        <div className="card p-5 space-y-4 mt-8">
          <h3 className="font-bold text-slate-900 text-sm">{t("workflows.presetTitle")}</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {presets.map((p) => (
              <div key={p.key} className="card card-hover p-4 border border-slate-200 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="badge badge-green text-[10px]">{t("workflows.presetBadge")}</span>
                    <span className="text-base">⚡</span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-900">{p.name}</h4>
                  <p className="text-xs text-slate-500 leading-relaxed">{p.descriptionBn}</p>
                </div>

                <div className="mt-3 pt-2.5 border-t flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary btn-sm flex-1 text-xs"
                    onClick={() => installPreset(p.key, p.name)}
                  >
                    {t("workflows.presetInstall")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
