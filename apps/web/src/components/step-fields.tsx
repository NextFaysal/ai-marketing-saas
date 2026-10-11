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
export function StepFields({
  draft,
  onChange,
  templates,
  waTemplates,
  inputCls = "input mt-1",
}: {
  draft: StepDraftLike;
  onChange: (next: StepDraftLike) => void;
  templates: TemplateOption[];
  waTemplates: WaTemplateOption[];
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
          <option value="wait">অপেক্ষা (Wait)</option>
          <option value="condition">শর্ত (Branch)</option>
        </select>
      </label>
      {s.type === "wait" ? (
        <label className="block text-sm">মিনিট<input className={inputCls} type="number" min={1} max={43200} value={s.minutes ?? 60} onChange={(e) => set({ minutes: Number(e.target.value) })} /></label>
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
