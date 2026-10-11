"use client";
import React from "react";
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

/**
 * The per-step field editor for workflows, extracted (Milestone 54)
 * from the form editor so the form AND the canvas side panel render
 * the exact same fields with the exact same change semantics. The
 * draft shape and the payload builder (lib/workflow-graph
 * buildPayloadStep) are shared too - there is one field logic.
 */
export interface MemberOption {
  userId: string;
  name: string;
  role: string;
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
  // Workflows W4: inside a branch arm, branch + wait are
  // not offered (the engine refuses them there).
  inArm?: boolean;
  inputCls?: string;
}) {
  const s = draft;
  const set = (patch: Partial<StepDraftLike>) => onChange({ ...s, ...patch });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block text-sm">ধরন
        <select className={inputCls} value={s.type} onChange={(e) => set({ type: e.target.value })}>
          <option value="send_email">Email পাঠান</option>
          <option value="send_sms">SMS পাঠান</option>
          <option value="add_lead_activity">Lead এ Note যোগ করুন</option>
          <option value="add_conversation_note">Conversation এ Internal Note যোগ করুন</option>
          <option value="send_inbox_message">Inbox এ বার্তা পাঠান</option>
          {inArm ? null : <option value="wait">অপেক্ষা (Wait)</option>}
          {inArm ? null : <option value="condition">শর্ত (থামুন/এগোন)</option>}
          {inArm ? null : <option value="branch">শাখা (যদি / নয়তো)</option>}
          <option value="assign_conversation">কথোপকথন Assign করুন</option>
          <option value="change_lead_stage">Lead Stage বদলান</option>
          <option value="add_tag">Tag যোগ করুন</option>
          <option value="notify_team">টিমকে জানান</option>
          <option value="create_follow_up">Follow-up তৈরি করুন</option>
          <option value="http_webhook">Webhook পাঠান (HTTPS)</option>
          <option value="notify_channel">📢 চ্যানেল অ্যালার্ট (Slack / Discord)</option>
          <option value="ai_generate">🤖 AI দিয়ে তৈরি করুন (AI Action)</option>
        </select>
      </label>
      {s.type === "wait" ? (
        <label className="block text-sm">মিনিট<input className={inputCls} type="number" min={1} max={43200} value={s.minutes ?? 60} onChange={(e) => set({ minutes: Number(e.target.value) })} /></label>
      ) : s.type === "branch" ? (
        <div className="w-full space-y-3 rounded-xl border border-purple-200 bg-purple-50/60 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm">Field<input className={inputCls} value={s.field ?? ""} placeholder="total / intent" onChange={(e) => set({ field: e.target.value })} /></label>
            <label className="block text-sm">Op
              <select className={inputCls} value={s.op ?? "eq"} onChange={(e) => set({ op: e.target.value })}>
                <option value="eq">eq</option><option value="neq">neq</option><option value="gt">gt</option><option value="gte">gte</option><option value="lt">lt</option><option value="lte">lte</option><option value="contains">contains</option>
              </select>
            </label>
            <label className="block text-sm">Value<input className={inputCls} value={s.value ?? ""} placeholder="1000 / complaint" onChange={(e) => set({ value: e.target.value })} /></label>
          </div>
          {(["then", "else"] as const).map((arm) => (
            <div key={arm} className="space-y-2 rounded-lg bg-white/70 p-2">
              <div className="text-xs font-semibold text-slate-600">{arm === "then" ? "✓ সত্যি হলে এই ধাপগুলো" : "✗ নয়তো এই ধাপগুলো"}</div>
              {(s[arm] ?? []).map((sub, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2 border-b border-dashed pb-2">
                  <StepFields draft={sub} onChange={(next) => { const arr = [...(s[arm] ?? [])]; arr[i] = next; set({ [arm]: arr }); }} templates={templates} waTemplates={waTemplates} members={members} inArm inputCls={inputCls} />
                  <button type="button" className="rounded-lg border px-2 py-1 text-xs" onClick={() => set({ [arm]: (s[arm] ?? []).filter((_, j) => j !== i) })}>মুছুন</button>
                </div>
              ))}
              <button type="button" className="rounded-lg border px-2 py-1 text-xs" onClick={() => set({ [arm]: [...(s[arm] ?? []), { type: "send_inbox_message", templateId: "", text: "" }] })}>+ ধাপ যোগ করুন</button>
            </div>
          ))}
        </div>
      ) : s.type === "condition" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">Field<input className={inputCls} value={s.field ?? ""} placeholder="agentReplied / intent" onChange={(e) => set({ field: e.target.value })} /></label>
          <label className="block text-sm">Op
            <select className={inputCls} value={s.op ?? "eq"} onChange={(e) => set({ op: e.target.value })}>
              <option value="eq">eq</option><option value="neq">neq</option><option value="gt">gt</option><option value="gte">gte</option><option value="lt">lt</option><option value="lte">lte</option><option value="contains">contains</option>
            </select>
          </label>
          <label className="block text-sm">Value<input className={inputCls} value={s.value ?? ""} placeholder="false / complaint" onChange={(e) => set({ value: e.target.value })} /></label>
        </div>
      ) : s.type === "send_inbox_message" ? (
        <div className="flex flex-1 flex-wrap items-end gap-2">
          <label className="block flex-1 text-sm">বার্তা ({"{{contactName}}"} ব্যবহার করা যায়)<input className={inputCls} value={s.text} placeholder="ফলো-আপ বার্তা" onChange={(e) => set({ text: e.target.value, whatsappTemplateId: "" })} /></label>
          <label className="block text-sm">অথবা WhatsApp Template
            <select className={inputCls} value={s.whatsappTemplateId ?? ""} onChange={(e) => set({ whatsappTemplateId: e.target.value })}>
              <option value="">নেই (টেক্সট যাবে)</option>
              {waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
            </select>
          </label>
        </div>
      ) : (s.type === "add_lead_activity" || s.type === "add_conversation_note") ? (
        <label className="block flex-1 text-sm">Note<input className={inputCls} value={s.text} onChange={(e) => set({ text: e.target.value })} placeholder="Workflow note" /></label>
      ) : s.type === "assign_conversation" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">কাকে Assign
            <select className={inputCls} value={s.clear ? "__clear__" : (s.userId ?? "")} onChange={(e) => e.target.value === "__clear__" ? set({ clear: true, userId: "" }) : set({ clear: false, userId: e.target.value })}>
              <option value="">বেছে নিন</option>
              <option value="__clear__">Assign সরান (Unassign)</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.name} ({m.role})</option>)}
            </select>
          </label>
          {members.length === 0 ? <span className="text-xs text-slate-500">সদস্য তালিকা লোড হয়নি — Team পেজে সদস্য যোগ করুন</span> : null}
        </div>
      ) : s.type === "change_lead_stage" ? (
        <label className="block text-sm">নতুন Stage
          <select className={inputCls} value={s.stage ?? "contacted"} onChange={(e) => set({ stage: e.target.value })}>
            <option value="new">new</option><option value="contacted">contacted</option><option value="qualified">qualified</option><option value="proposal">proposal</option><option value="won">won</option><option value="lost">lost</option>
          </select>
        </label>
      ) : s.type === "add_tag" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">কোথায়
            <select className={inputCls} value={s.target ?? "lead"} onChange={(e) => set({ target: e.target.value })}>
              <option value="lead">Lead</option><option value="conversation">কথোপকথন</option>
            </select>
          </label>
          <label className="block text-sm">Tag<input className={inputCls} value={s.tag ?? ""} placeholder="vip / আগ্রহী" onChange={(e) => set({ tag: e.target.value })} /></label>
        </div>
      ) : s.type === "notify_team" ? (
        <div className="flex flex-1 flex-wrap items-end gap-2">
          <label className="block text-sm">কাদের
            <select className={inputCls} value={s.role ?? ""} onChange={(e) => set({ role: e.target.value })}>
              <option value="">সব সক্রিয় সদস্য</option><option value="OWNER">OWNER</option><option value="ADMIN">ADMIN</option><option value="MARKETING_MANAGER">MARKETING_MANAGER</option><option value="SUPPORT_AGENT">SUPPORT_AGENT</option>
            </select>
          </label>
          <label className="block text-sm">শিরোনাম<input className={inputCls} value={s.title ?? ""} placeholder="Workflow" onChange={(e) => set({ title: e.target.value })} /></label>
          <label className="block flex-1 text-sm">বার্তা<input className={inputCls} value={s.text} placeholder="{{contactName}} এর ব্যাপারে দেখুন" onChange={(e) => set({ text: e.target.value })} /></label>
        </div>
      ) : s.type === "create_follow_up" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">কত দিন পরে<input className={inputCls} type="number" min={1} max={90} value={s.days ?? 3} onChange={(e) => set({ days: Number(e.target.value) })} /></label>
          <label className="block flex-1 text-sm">নোট (ঐচ্ছিক)<input className={inputCls} value={s.text} onChange={(e) => set({ text: e.target.value })} placeholder="Follow-up নোট" /></label>
        </div>
      ) : s.type === "http_webhook" ? (
        <div className="flex flex-1 flex-wrap items-end gap-2">
          <label className="block flex-1 text-sm">Webhook URL (HTTPS)<input className={inputCls} value={s.url ?? ""} placeholder="https://example.com/hook" onChange={(e) => set({ url: e.target.value })} /></label>
          <label className="block text-sm">Secret (ঐচ্ছিক, HMAC)<input className={inputCls} value={s.secret ?? ""} onChange={(e) => set({ secret: e.target.value })} /></label>
        </div>
      ) : s.type === "notify_channel" ? (
        <div className="flex flex-1 flex-wrap items-end gap-2">
          <label className="block flex-1 text-sm">চ্যানেল Webhook URL (Slack / Discord)
            <input className={inputCls} value={s.url ?? ""} placeholder="https://hooks.slack.com/services/... বা discord.com/api/webhooks/..." onChange={(e) => set({ url: e.target.value })} />
          </label>
          <label className="block text-sm">শিরোনাম (ঐচ্ছিক)
            <input className={inputCls} value={s.title ?? ""} placeholder="🚨 নতুন অর্ডার অ্যালার্ট" onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="block flex-1 text-sm">বার্তা
            <input className={inputCls} value={s.text ?? ""} placeholder="অর্ডার #{{orderNumber}} সম্পন্ন হয়েছে (৳{{total}})" onChange={(e) => set({ text: e.target.value })} />
          </label>
        </div>
      ) : s.type === "ai_generate" ? (
        <div className="flex flex-1 flex-wrap items-end gap-2">
          <label className="block flex-1 text-sm">AI নির্দেশিকা (Prompt)
            <input className={inputCls} value={s.prompt ?? ""} placeholder="গ্রাহক {{contactName}} এর জন্য একটি সুন্দর ধন্যবাদ বার্তা লিখুন..." onChange={(e) => set({ prompt: e.target.value })} />
          </label>
          <label className="block text-sm">ফলাফল কোথায় রাখবেন
            <select className={inputCls} value={s.action ?? "add_conversation_note"} onChange={(e) => set({ action: e.target.value })}>
              <option value="add_conversation_note">কথোপকথনে Internal Note হিসেবে</option>
              <option value="add_lead_activity">Lead টাইমলাইনে Note হিসেবে</option>
              <option value="save_to_context">ভ্যারিয়েবলে সংরক্ষণ</option>
            </select>
          </label>
          <label className="block text-sm">ভ্যারিয়েবলের নাম (ঐচ্ছিক)
            <input className={inputCls} value={s.outputField ?? "aiResult"} placeholder="aiResult" onChange={(e) => set({ outputField: e.target.value })} />
          </label>
        </div>
      ) : (
        <label className="block text-sm">Template
          <select className={inputCls} value={s.templateId} onChange={(e) => set({ templateId: e.target.value })} required>
            <option value="">বেছে নিন</option>
            {templates.filter((t) => t.channel === (s.type === "send_email" ? "email" : "sms")).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
