"use client";
import React, { useState } from "react";
import type { StepDraftLike } from "@/lib/workflow-graph";

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
  { tag: "{{contactName}}", label: "গ্রাহকের নাম", category: "গ্রাহক" },
  { tag: "{{contactPhone}}", label: "ফোন নম্বর", category: "গ্রাহক" },
  { tag: "{{contactEmail}}", label: "ইমেইল", category: "গ্রাহক" },
  { tag: "{{orderNumber}}", label: "অর্ডার নম্বর", category: "অর্ডার" },
  { tag: "{{total}}", label: "মোট টাকা (৳)", category: "অর্ডার" },
  { tag: "{{currency}}", label: "কারেন্সি (BDT)", category: "অর্ডার" },
  { tag: "{{cartValue}}", label: "কার্টের মূল্য (৳)", category: "কার্ট" },
  { tag: "{{itemsCount}}", label: "পণ্য সংখ্যা", category: "কার্ট" },
  { tag: "{{itemsSummary}}", label: "পণ্যের তালিকা", category: "কার্ট" },
  { tag: "{{cartUrl}}", label: "কার্ট লিংক", category: "কার্ট" },
  { tag: "{{stage}}", label: "লিড স্টেজ", category: "লিড" },
  { tag: "{{source}}", label: "সোর্স / মাধ্যম", category: "লিড" },
  { tag: "{{channel}}", label: "মেসেজ চ্যানেল", category: "ইনবক্স" },
  { tag: "{{refundAmount}}", label: "রিফান্ড টাকা", category: "অর্ডার" },
  { tag: "{{trackingCode}}", label: "কুরিয়ার ট্র্যাকিং কোড", category: "শিপমেন্ট" },
];

function VariablePicker({ onInsert }: { onInsert: (tag: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-100 transition"
        title="ডাইনামিক ভ্যারিয়েবল ইনসার্ট করুন"
      >
        <span>⚡ + ভ্যারিয়েবল</span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-xl animate-fadeIn">
          <div className="flex items-center justify-between border-b pb-1 mb-1 text-[11px] font-bold text-slate-700">
            <span>স্মার্ট ভ্যারিয়েবল বেছে নিন:</span>
            <button
              type="button"
              className="text-slate-400 hover:text-slate-600"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {DYNAMIC_VARIABLES.map((v) => (
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
          পদক্ষেপের ধরন (Action Type)
          <select className={inputCls} value={s.type} onChange={(e) => set({ type: e.target.value })}>
            <optgroup label="মেসেজিং ও যোগাযোগ">
              <option value="send_email">✉️ Email পাঠান</option>
              <option value="send_sms">📱 SMS পাঠান</option>
              <option value="send_inbox_message">💬 Inbox এ বার্তা পাঠান</option>
            </optgroup>
            <optgroup label="টিম ও সিআরএম (CRM)">
              <option value="add_lead_activity">📝 Lead এ Note যোগ করুন</option>
              <option value="add_conversation_note">🔒 Conversation এ Internal Note</option>
              <option value="assign_conversation">👤 কথোপকথন Assign করুন</option>
              <option value="change_lead_stage">🏷️ Lead Stage বদলান</option>
              <option value="add_tag">🏷️ Tag যোগ করুন</option>
              <option value="notify_team">👥 টিমকে জানান (Notify Team)</option>
              <option value="create_follow_up">📅 Follow-up তৈরি করুন</option>
            </optgroup>
            <optgroup label="অটোমেশন ও এআই (AI)">
              <option value="ai_generate">🤖 AI দিয়ে তৈরি করুন (AI Action)</option>
              <option value="notify_channel">📢 চ্যানেল অ্যালার্ট (Slack / Discord)</option>
              <option value="http_webhook">🌐 Webhook পাঠান (HTTPS)</option>
            </optgroup>
            {inArm ? null : (
              <optgroup label="প্রবাহ নিয়ন্ত্রণ (Logic & Flow)">
                <option value="wait">⏱️ অপেক্ষা (Wait)</option>
                <option value="condition">🔍 শর্ত (থামুন/এগোন)</option>
                <option value="branch">🔀 শাখা (যদি / নয়তো)</option>
              </optgroup>
            )}
          </select>
        </label>

        {s.type === "wait" ? (
          <label className="block text-sm w-44">
            অপেক্ষার সময় (মিনিট)
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
                  <option value="eq">eq (সমান)</option>
                  <option value="neq">neq (সমান নয়)</option>
                  <option value="gt">gt (বেশি)</option>
                  <option value="gte">gte (কমপক্ষে)</option>
                  <option value="lt">lt (কম)</option>
                  <option value="lte">lte (সর্বোচ্চ)</option>
                  <option value="contains">contains (রয়েছে)</option>
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
                  {arm === "then" ? "✓ শর্ত মিললে (True Arm)" : "✗ শর্ত না মিললে (False Arm)"}
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
                      মুছুন
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
                  + এই শাখায় ধাপ যোগ করুন
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
                <label className="block text-xs font-semibold text-slate-700">বার্তা (Custom Message)</label>
                <VariablePicker onInsert={(tag) => appendText("text", tag)} />
              </div>
              <input
                className={inputCls}
                value={s.text ?? ""}
                placeholder="আসসালামু আলাইকুম {{contactName}}, অর্ডার #{{orderNumber}} সম্পন্ন হয়েছে..."
                onChange={(e) => set({ text: e.target.value, whatsappTemplateId: "" })}
              />
            </div>
            <label className="block text-sm min-w-[200px]">
              অথবা WhatsApp Template
              <select
                className={inputCls}
                value={s.whatsappTemplateId ?? ""}
                onChange={(e) => set({ whatsappTemplateId: e.target.value })}
              >
                <option value="">নেই (সরাসরি টেক্সট যাবে)</option>
                {waTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.language})
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : s.type === "add_lead_activity" || s.type === "add_conversation_note" ? (
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-700">নোট (Note Content)</label>
              <VariablePicker onInsert={(tag) => appendText("text", tag)} />
            </div>
            <input
              className={inputCls}
              value={s.text ?? ""}
              onChange={(e) => set({ text: e.target.value })}
              placeholder="যেমন: {{contactName}} এর অর্ডার ভ্যালু ৳{{total}} — বিশেষ ফলো-আপ দিন"
            />
          </div>
        ) : s.type === "assign_conversation" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm min-w-[220px]">
              কাকে Assign করবেন
              <select
                className={inputCls}
                value={s.clear ? "__clear__" : s.userId ?? ""}
                onChange={(e) =>
                  e.target.value === "__clear__"
                    ? set({ clear: true, userId: "" })
                    : set({ clear: false, userId: e.target.value })
                }
              >
                <option value="">সদস্য বেছে নিন</option>
                <option value="__clear__">Assign সরান (Unassign)</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            </label>
            {members.length === 0 && (
              <span className="text-xs text-slate-500">টিম সদস্য পাওয়া যায়নি — Team পেজে সদস্য যোগ করুন</span>
            )}
          </div>
        ) : s.type === "change_lead_stage" ? (
          <label className="block text-sm w-44">
            নতুন Stage
            <select
              className={inputCls}
              value={s.stage ?? "contacted"}
              onChange={(e) => set({ stage: e.target.value })}
            >
              <option value="new">new (নতুন)</option>
              <option value="contacted">contacted (যোগাযোগকৃত)</option>
              <option value="qualified">qualified (উপযুক্ত)</option>
              <option value="proposal">proposal (প্রস্তাবনা)</option>
              <option value="won">won (জয়ী)</option>
              <option value="lost">lost (ব্যর্থ)</option>
            </select>
          </label>
        ) : s.type === "add_tag" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm w-40">
              কোথায় ট্যাগ হবে
              <select
                className={inputCls}
                value={s.target ?? "lead"}
                onChange={(e) => set({ target: e.target.value })}
              >
                <option value="lead">Lead (লিড)</option>
                <option value="conversation">কথোপকথন (Conversation)</option>
              </select>
            </label>
            <label className="block text-sm min-w-[160px]">
              Tag নাম
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
              কাদের নোটিফিকেশন যাবে
              <select className={inputCls} value={s.role ?? ""} onChange={(e) => set({ role: e.target.value })}>
                <option value="">সব সক্রিয় সদস্য</option>
                <option value="OWNER">OWNER (মালিক)</option>
                <option value="ADMIN">ADMIN</option>
                <option value="MARKETING_MANAGER">MARKETING_MANAGER</option>
                <option value="SUPPORT_AGENT">SUPPORT_AGENT</option>
              </select>
            </label>
            <label className="block text-sm min-w-[160px]">
              শিরোনাম
              <input
                className={inputCls}
                value={s.title ?? ""}
                placeholder="🚨 জরুরি নোটিফিকেশন"
                onChange={(e) => set({ title: e.target.value })}
              />
            </label>
            <div className="flex-1 min-w-[240px]">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-700">বার্তা</label>
                <VariablePicker onInsert={(tag) => appendText("text", tag)} />
              </div>
              <input
                className={inputCls}
                value={s.text ?? ""}
                placeholder="অর্ডার #{{orderNumber}} এর বিষয়ে দেখুন..."
                onChange={(e) => set({ text: e.target.value })}
              />
            </div>
          </div>
        ) : s.type === "create_follow_up" ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm w-36">
              কত দিন পরে
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
                <label className="block text-xs font-semibold text-slate-700">নোট (ঐচ্ছিক)</label>
                <VariablePicker onInsert={(tag) => appendText("text", tag)} />
              </div>
              <input
                className={inputCls}
                value={s.text ?? ""}
                onChange={(e) => set({ text: e.target.value })}
                placeholder="গ্রাহক {{contactName}} এর সাথে ফলো-আপ করুন"
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
              Secret (HMAC ঐচ্ছিক)
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
              চ্যানেল Webhook URL (Slack / Discord)
              <input
                className={inputCls}
                value={s.url ?? ""}
                placeholder="https://hooks.slack.com/services/... বা discord.com/api/webhooks/..."
                onChange={(e) => set({ url: e.target.value })}
              />
            </label>
            <label className="block text-sm w-44">
              শিরোনাম (ঐচ্ছিক)
              <input
                className={inputCls}
                value={s.title ?? ""}
                placeholder="🚨 অর্ডার অ্যালার্ট"
                onChange={(e) => set({ title: e.target.value })}
              />
            </label>
            <div className="flex-1 min-w-[220px]">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-700">বার্তা</label>
                <VariablePicker onInsert={(tag) => appendText("text", tag)} />
              </div>
              <input
                className={inputCls}
                value={s.text ?? ""}
                placeholder="অর্ডার #{{orderNumber}} সম্পন্ন হয়েছে (৳{{total}})"
                onChange={(e) => set({ text: e.target.value })}
              />
            </div>
          </div>
        ) : s.type === "ai_generate" ? (
          <div className="flex flex-1 flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[260px]">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-700">AI নির্দেশিকা (Prompt)</label>
                <VariablePicker onInsert={(tag) => appendText("prompt", tag)} />
              </div>
              <input
                className={inputCls}
                value={s.prompt ?? ""}
                placeholder="গ্রাহক {{contactName}} এর জন্য একটি সুন্দর ধন্যবাদ বার্তা লিখুন..."
                onChange={(e) => set({ prompt: e.target.value })}
              />
            </div>
            <label className="block text-sm min-w-[200px]">
              ফলাফল কোথায় রাখবেন
              <select
                className={inputCls}
                value={s.action ?? "add_conversation_note"}
                onChange={(e) => set({ action: e.target.value })}
              >
                <option value="add_conversation_note">কথোপকথনে Internal Note হিসেবে</option>
                <option value="add_lead_activity">Lead টাইমলাইনে Note হিসেবে</option>
                <option value="save_to_context">ভ্যারিয়েবলে সংরক্ষণ</option>
              </select>
            </label>
            <label className="block text-sm w-36">
              ভ্যারিয়েবলের নাম
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
            টেমপ্লেট (Template)
            <select
              className={inputCls}
              value={s.templateId ?? ""}
              onChange={(e) => set({ templateId: e.target.value })}
              required
            >
              <option value="">বেছে নিন</option>
              {templates
                .filter((t) => t.channel === (s.type === "send_email" ? "email" : "sms"))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
