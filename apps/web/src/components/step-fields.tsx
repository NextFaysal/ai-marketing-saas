"use client";
import React, { useState } from "react";
import type { StepDraftLike } from "@/lib/workflow-graph";
import { useLocale } from "@/lib/i18n/provider";

export interface TemplateOption {
  id: string;
  name: string;
  channel: string;
}
export interface WaTemplateOption {
  id: string;
  name: string;
  language: string;
}

export interface MemberOption {
  userId: string;
  name: string;
  role: string;
}

export const DYNAMIC_VARIABLES = [
  { tag: "{{contactName}}", label: "গ্রাহকের নাম", labelEn: "Customer name", category: "গ্রাহক", categoryEn: "Customer" },
  { tag: "{{contactPhone}}", label: "ফোন নম্বর", labelEn: "Phone number", category: "গ্রাহক", categoryEn: "Customer" },
  { tag: "{{contactEmail}}", label: "ইমেইল", labelEn: "Email", category: "গ্রাহক", categoryEn: "Customer" },
  { tag: "{{orderNumber}}", label: "অর্ডার নম্বর", labelEn: "Order number", category: "অর্ডার", categoryEn: "Order" },
  { tag: "{{total}}", label: "মোট টাকা (৳)", labelEn: "Total amount (৳)", category: "অর্ডার", categoryEn: "Order" },
  { tag: "{{currency}}", label: "কারেন্সি (BDT)", labelEn: "Currency (BDT)", category: "অর্ডার", categoryEn: "Order" },
  { tag: "{{cartValue}}", label: "কার্টের মূল্য (৳)", labelEn: "Cart value (৳)", category: "কার্ট", categoryEn: "Cart" },
  { tag: "{{itemsCount}}", label: "পণ্য সংখ্যা", labelEn: "Item count", category: "কার্ট", categoryEn: "Cart" },
  { tag: "{{itemsSummary}}", label: "পণ্যের তালিকা", labelEn: "Item list", category: "কার্ট", categoryEn: "Cart" },
  { tag: "{{cartUrl}}", label: "কার্ট লিংক", labelEn: "Cart link", category: "কার্ট", categoryEn: "Cart" },
  { tag: "{{stage}}", label: "লিড স্টেজ", labelEn: "Lead stage", category: "লিড", categoryEn: "Lead" },
  { tag: "{{source}}", label: "সোর্স / মাধ্যম", labelEn: "Source / medium", category: "লিড", categoryEn: "Lead" },
  { tag: "{{channel}}", label: "মেসেজ চ্যানেল", labelEn: "Message channel", category: "ইনবক্স", categoryEn: "Inbox" },
  { tag: "{{refundAmount}}", label: "রিফান্ড টাকা", labelEn: "Refund amount", category: "অর্ডার", categoryEn: "Order" },
  { tag: "{{trackingCode}}", label: "কুরিয়ার ট্র্যাকিং কোড", labelEn: "Courier tracking code", category: "শিপমেন্ট", categoryEn: "Shipment" },
];

/** D7 picker: variable labels/categories by UI locale (bn fields stay
 * the source of truth; en companions are additive). */
export function dynamicVariablesForLocale(locale: "bn" | "en") {
  return DYNAMIC_VARIABLES.map((v) => ({
    tag: v.tag,
    label: locale === "en" ? v.labelEn : v.label,
    category: locale === "en" ? v.categoryEn : v.category,
  }));
}

function VariablePicker({ onInsert }: { onInsert: (tag: string) => void }) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-100 transition"
        title={t("misc.sfVarInsertTitle")}
      >
        <span>{t("misc.sfVarButton")}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-xl animate-fadeIn">
          <div className="flex items-center justify-between border-b pb-1 mb-1 text-[11px] font-bold text-slate-700">
            <span>{t("misc.sfVarPick")}</span>
            <button
              type="button"
              className="text-slate-400 hover:text-slate-600"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {dynamicVariablesForLocale(locale).map((v) => (
              <button
                key={v.tag}
                type="button"
                onClick={() => {
                  onInsert(v.tag);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-xs hover:bg-brand-50/60 transition group"
              >
                <span className="font-medium text-slate-700 group-hover:text-brand-700">{v.label}</span>
                <span className="font-mono text-[10px] text-brand-600 bg-brand-50 px-1 py-0.5 rounded border border-brand-100">
                  {v.tag}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function StepFields({
  draft,
  onChange,
  templates,
  waTemplates,
  members = [],
  inArm = false,
  inputCls = "input mt-1",
}: {
  draft: StepDraftLike;
  onChange: (next: StepDraftLike) => void;
  templates: TemplateOption[];
  waTemplates: WaTemplateOption[];
  members?: MemberOption[];
  inArm?: boolean;
  inputCls?: string;
}) {
  const { t } = useLocale();
  const s = draft;
  const set = (patch: Partial<StepDraftLike>) => onChange({ ...s, ...patch });

  const appendText = (field: "text" | "prompt", tag: string) => {
    const cur = (s[field] as string) || "";
    set({ [field]: cur ? `${cur} ${tag}` : tag });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm min-w-[200px]">
          {t("misc.sfActionType")}
          <select className={inputCls} value={s.type} onChange={(e) => set({ type: e.target.value })}>
            <optgroup label={t("misc.sfGroupMessaging")}>
              <option value="send_email">{t("misc.sfSendEmail")}</option>
              <option value="send_sms">{t("misc.sfSendSms")}</option>
              <option value="send_inbox_message">{t("misc.sfSendInbox")}</option>
            </optgroup>
            <optgroup label={t("misc.sfGroupCrm")}>
              <option value="add_lead_activity">{t("misc.sfLeadNote")}</option>
              <option value="add_conversation_note">{t("misc.sfConvNote")}</option>
              <option value="assign_conversation">{t("misc.sfAssign")}</option>
              <option value="change_lead_stage">{t("misc.sfChangeStage")}</option>
              <option value="add_tag">{t("misc.sfAddTag")}</option>
              <option value="notify_team">{t("misc.sfNotifyTeam")}</option>
              <option value="create_follow_up">{t("misc.sfFollowUp")}</option>
            </optgroup>
            <optgroup label={t("misc.sfGroupAi")}>
              <option value="ai_generate">{t("misc.sfAiGenerate")}</option>
              <option value="notify_channel">{t("misc.sfNotifyChannel")}</option>
              <option value="http_webhook">{t("misc.sfWebhook")}</option>
            </optgroup>
            {inArm ? null : (
              <optgroup label={t("misc.sfGroupFlow")}>
                <option value="wait">{t("misc.sfWait")}</option>
                <option value="condition">{t("misc.sfCondition")}</option>
                <option value="branch">{t("misc.sfBranch")}</option>
              </optgroup>
            )}
          </select>
        </label>

        {s.type === "wait" ? (
          <label className="block text-sm w-44">
            {t("misc.sfWaitMinutes")}
            <input
              className={inputCls}
              type="number"
              min={1}
              max={43200}
              value={s.minutes ?? 60}
              onChange={(e) => set({ minutes: Number(e.target.value) })}
            />
          </label>
        ) : s.type === "branch" ? (
          <div className="w-full space-y-3 rounded-xl border border-purple-200 bg-purple-50/60 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-sm">
                Field
                <input
                  className={inputCls}
                  value={s.field ?? ""}
                  placeholder="total / intent / stage"
                  onChange={(e) => set({ field: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                Op
                <select className={inputCls} value={s.op ?? "eq"} onChange={(e) => set({ op: e.target.value })}>
                  <option value="eq">{t("misc.sfOpEq")}</option>
                  <option value="neq">{t("misc.sfOpNeq")}</option>
                  <option value="gt">{t("misc.sfOpGt")}</option>
                  <option value="gte">{t("misc.sfOpGte")}</option>
                  <option value="lt">{t("misc.sfOpLt")}</option>
                  <option value="lte">{t("misc.sfOpLte")}</option>
                  <option value="contains">{t("misc.sfOpContains")}</option>
                </select>
              </label>
              <label className="block text-sm">
                Value
                <input
                  className={inputCls}
                  value={s.value ?? ""}
                  placeholder="1000 / complaint"
                  onChange={(e) => set({ value: e.target.value })}
                />
              </label>
            </div>
            {(["then", "else"] as const).map((arm) => (
              <div key={arm} className="space-y-2 rounded-lg bg-white/80 p-3 shadow-sm border border-purple-100">
                <div className="text-xs font-semibold text-purple-900">
                  {arm === "then" ? t("misc.sfArmThen") : t("misc.sfArmElse")}
                </div>
                {(s[arm] ?? []).map((sub, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2 border-b border-dashed pb-2">
                    <StepFields
                      draft={sub}
                      onChange={(next) => {
                        const arr = [...(s[arm] ?? [])];
                        arr[i] = next;
                        set({ [arm]: arr });
                      }}
                      templates={templates}
                      waTemplates={waTemplates}
                      members={members}
                      inArm
                      inputCls={inputCls}
                    />
                    <button
                      type="button"
                      className="rounded-lg border px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      onClick={() => set({ [arm]: (s[arm] ?? []).filter((_, j) => j !== i) })}
                    >
                      {t("misc.sfDelete")}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="rounded-lg border border-purple-200 bg-white px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-50"
                  onClick={() =>
                    set({ [arm]: [...(s[arm] ?? []), { type: "send_inbox_message", templateId: "", text: "" }] })
                  }
                >
                  {t("misc.sfAddStepToArm")}
                </button>
              </div>
            ))}
          </div>
        ) : s.type === "condition" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm">
              Field
              <input
                className={inputCls}
                value={s.field ?? ""}
                placeholder="agentReplied / intent / total"
                onChange={(e) => set({ field: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              Op
              <select className={inputCls} value={s.op ?? "eq"} onChange={(e) => set({ op: e.target.value })}>
                <option value="eq">eq</option>
                <option value="neq">neq</option>
                <option value="gt">gt</option>
                <option value="gte">gte</option>
                <option value="lt">lt</option>
                <option value="lte">lte</option>
                <option value="contains">contains</option>
              </select>
            </label>
            <label className="block text-sm">
              Value
              <input
                className={inputCls}
                value={s.value ?? ""}
                placeholder="false / complaint / 1000"
                onChange={(e) => set({ value: e.target.value })}
              />
            </label>
          </div>
        ) : s.type === "send_inbox_message" ? (
          <div className="flex flex-1 flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[260px]">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-700">{t("misc.sfMessageLabel")}</label>
                <VariablePicker onInsert={(tag) => appendText("text", tag)} />
              </div>
              <input
                className={inputCls}
                value={s.text ?? ""}
                placeholder={t("misc.sfMessagePlaceholder")}
                onChange={(e) => set({ text: e.target.value, whatsappTemplateId: "" })}
              />
            </div>
            <label className="block text-sm min-w-[200px]">
              {t("misc.sfOrWaTemplate")}
              <select
                className={inputCls}
                value={s.whatsappTemplateId ?? ""}
                onChange={(e) => set({ whatsappTemplateId: e.target.value })}
              >
                <option value="">{t("misc.sfNoTemplate")}</option>
                {waTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} ({tpl.language})
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : s.type === "add_lead_activity" || s.type === "add_conversation_note" ? (
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-700">{t("misc.sfNoteLabel")}</label>
              <VariablePicker onInsert={(tag) => appendText("text", tag)} />
            </div>
            <input
              className={inputCls}
              value={s.text ?? ""}
              onChange={(e) => set({ text: e.target.value })}
              placeholder={t("misc.sfNotePlaceholder")}
            />
          </div>
        ) : s.type === "assign_conversation" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm min-w-[220px]">
              {t("misc.sfAssignTo")}
              <select
                className={inputCls}
                value={s.clear ? "__clear__" : s.userId ?? ""}
                onChange={(e) =>
                  e.target.value === "__clear__"
                    ? set({ clear: true, userId: "" })
                    : set({ clear: false, userId: e.target.value })
                }
              >
                <option value="">{t("misc.sfPickMember")}</option>
                <option value="__clear__">{t("misc.sfUnassign")}</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            </label>
            {members.length === 0 && (
              <span className="text-xs text-slate-500">{t("misc.sfNoMembers")}</span>
            )}
          </div>
        ) : s.type === "change_lead_stage" ? (
          <label className="block text-sm w-44">
            {t("misc.sfNewStage")}
            <select
              className={inputCls}
              value={s.stage ?? "contacted"}
              onChange={(e) => set({ stage: e.target.value })}
            >
              <option value="new">{t("misc.sfStageNew")}</option>
              <option value="contacted">{t("misc.sfStageContacted")}</option>
              <option value="qualified">{t("misc.sfStageQualified")}</option>
              <option value="proposal">{t("misc.sfStageProposal")}</option>
              <option value="won">{t("misc.sfStageWon")}</option>
              <option value="lost">{t("misc.sfStageLost")}</option>
            </select>
          </label>
        ) : s.type === "add_tag" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm w-40">
              {t("misc.sfTagTarget")}
              <select
                className={inputCls}
                value={s.target ?? "lead"}
                onChange={(e) => set({ target: e.target.value })}
              >
                <option value="lead">{t("misc.sfTagLead")}</option>
                <option value="conversation">{t("misc.sfTagConversation")}</option>
              </select>
            </label>
            <label className="block text-sm min-w-[160px]">
              {t("misc.sfTagName")}
              <input
                className={inputCls}
                value={s.tag ?? ""}
                placeholder="vip / high-priority / repeat"
                onChange={(e) => set({ tag: e.target.value })}
              />
            </label>
          </div>
        ) : s.type === "notify_team" ? (
          <div className="flex flex-1 flex-wrap items-end gap-2">
            <label className="block text-sm w-44">
              {t("misc.sfNotifyWho")}
              <select className={inputCls} value={s.role ?? ""} onChange={(e) => set({ role: e.target.value })}>
                <option value="">{t("misc.sfAllActiveMembers")}</option>
                <option value="OWNER">{t("misc.sfOwnerRole")}</option>
                <option value="ADMIN">ADMIN</option>
                <option value="MARKETING_MANAGER">MARKETING_MANAGER</option>
                <option value="SUPPORT_AGENT">SUPPORT_AGENT</option>
              </select>
            </label>
            <label className="block text-sm min-w-[160px]">
              {t("misc.sfTitleLabel")}
              <input
                className={inputCls}
                value={s.title ?? ""}
                placeholder={t("misc.sfTitlePlaceholder")}
                onChange={(e) => set({ title: e.target.value })}
              />
            </label>
            <div className="flex-1 min-w-[240px]">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-700">{t("misc.sfMessage")}</label>
                <VariablePicker onInsert={(tag) => appendText("text", tag)} />
              </div>
              <input
                className={inputCls}
                value={s.text ?? ""}
                placeholder={t("misc.sfNotifyTextPlaceholder")}
                onChange={(e) => set({ text: e.target.value })}
              />
            </div>
          </div>
        ) : s.type === "create_follow_up" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm w-36">
              {t("misc.sfDaysLater")}
              <input
                className={inputCls}
                type="number"
                min={1}
                max={90}
                value={s.days ?? 3}
                onChange={(e) => set({ days: Number(e.target.value) })}
              />
            </label>
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-700">{t("misc.sfNoteOptional")}</label>
                <VariablePicker onInsert={(tag) => appendText("text", tag)} />
              </div>
              <input
                className={inputCls}
                value={s.text ?? ""}
                onChange={(e) => set({ text: e.target.value })}
                placeholder={t("misc.sfFollowUpPlaceholder")}
              />
            </div>
          </div>
        ) : s.type === "http_webhook" ? (
          <div className="flex flex-1 flex-wrap items-end gap-2">
            <label className="block flex-1 text-sm min-w-[240px]">
              Webhook URL (HTTPS)
              <input
                className={inputCls}
                value={s.url ?? ""}
                placeholder="https://api.yourdomain.com/webhook"
                onChange={(e) => set({ url: e.target.value })}
              />
            </label>
            <label className="block text-sm w-48">
              {t("misc.sfSecretLabel")}
              <input
                className={inputCls}
                value={s.secret ?? ""}
                onChange={(e) => set({ secret: e.target.value })}
                placeholder="hmac_secret_key"
              />
            </label>
          </div>
        ) : s.type === "notify_channel" ? (
          <div className="flex flex-1 flex-wrap items-end gap-2">
            <label className="block flex-1 text-sm min-w-[220px]">
              {t("misc.sfChannelUrlLabel")}
              <input
                className={inputCls}
                value={s.url ?? ""}
                placeholder={t("misc.sfChannelUrlPlaceholder")}
                onChange={(e) => set({ url: e.target.value })}
              />
            </label>
            <label className="block text-sm w-44">
              {t("misc.sfTitleOptional")}
              <input
                className={inputCls}
                value={s.title ?? ""}
                placeholder={t("misc.sfAlertTitlePlaceholder")}
                onChange={(e) => set({ title: e.target.value })}
              />
            </label>
            <div className="flex-1 min-w-[220px]">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-700">{t("misc.sfMessage")}</label>
                <VariablePicker onInsert={(tag) => appendText("text", tag)} />
              </div>
              <input
                className={inputCls}
                value={s.text ?? ""}
                placeholder={t("misc.sfChannelTextPlaceholder")}
                onChange={(e) => set({ text: e.target.value })}
              />
            </div>
          </div>
        ) : s.type === "ai_generate" ? (
          <div className="flex flex-1 flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[260px]">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-700">{t("misc.sfAiPromptLabel")}</label>
                <VariablePicker onInsert={(tag) => appendText("prompt", tag)} />
              </div>
              <input
                className={inputCls}
                value={s.prompt ?? ""}
                placeholder={t("misc.sfAiPromptPlaceholder")}
                onChange={(e) => set({ prompt: e.target.value })}
              />
            </div>
            <label className="block text-sm min-w-[200px]">
              {t("misc.sfAiResultWhere")}
              <select
                className={inputCls}
                value={s.action ?? "add_conversation_note"}
                onChange={(e) => set({ action: e.target.value })}
              >
                <option value="add_conversation_note">{t("misc.sfAiResultNote")}</option>
                <option value="add_lead_activity">{t("misc.sfAiResultLead")}</option>
                <option value="save_to_context">{t("misc.sfAiResultVar")}</option>
              </select>
            </label>
            <label className="block text-sm w-36">
              {t("misc.sfVarName")}
              <input
                className={inputCls}
                value={s.outputField ?? "aiResult"}
                placeholder="aiResult"
                onChange={(e) => set({ outputField: e.target.value })}
              />
            </label>
          </div>
        ) : (
          <label className="block text-sm min-w-[200px]">
            {t("misc.sfTemplateLabel")}
            <select
              className={inputCls}
              value={s.templateId ?? ""}
              onChange={(e) => set({ templateId: e.target.value })}
              required
            >
              <option value="">{t("misc.sfPick")}</option>
              {templates
                .filter((tpl) => tpl.channel === (s.type === "send_email" ? "email" : "sms"))
                .map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
