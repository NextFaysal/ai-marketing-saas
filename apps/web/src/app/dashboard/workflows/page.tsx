"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import { StepFields } from "@/components/step-fields";
import WorkflowCanvas from "@/components/workflow-canvas";
import { buildPayloadStep, parseConditionValue, type RawStep, type StepDraftLike, type WorkflowDefinition } from "@/lib/workflow-graph";

interface Template { id: string; name: string; channel: string }
type StepDraft = StepDraftLike;
interface Workflow { id: string; name: string; trigger: string; conditions?: { field: string; op: string; value: unknown }[] | null; steps: { type: string; templateId?: string; text?: string }[]; enabled: boolean }
interface Run { id: string; trigger: string; status: string; stepsLog?: { step: string; status: string; detail: string }[] | null; error?: string | null; createdAt: string }

const TRIGGERS = [
  { value: "order_created", label: "নতুন Order তৈরি হলে" },
  { value: "lead_created", label: "নতুন Lead তৈরি হলে" },
  { value: "inbox_message_received", label: "Inbox এ নতুন বার্তা এলে" },
  { value: "inbox_unanswered", label: "Inbox বার্তার উত্তর না হলে (সময়ভিত্তিক)" },
  { value: "lead_stage_changed", label: "Lead এর Stage বদলালে" },
];

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState({ name: "", trigger: "order_created", condField: "", condOp: "gte", condValue: "" });
  const [steps, setSteps] = useState<StepDraft[]>([{ type: "send_email", templateId: "", text: "" }]);
  const [waTemplates, setWaTemplates] = useState<{ id: string; name: string; language: string }[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [editorView, setEditorView] = useState<"form" | "canvas">("form");
  const [canvasDef, setCanvasDef] = useState<WorkflowDefinition>({ name: "", trigger: "order_created", steps: [{ type: "send_email", templateId: "" }] });
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [canvasScope, setCanvasScope] = useState("new");
  const [canvasNote, setCanvasNote] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const [w, r, t] = await Promise.all([
        apiFetch<Workflow[]>(`/organizations/${orgId}/workflows`),
        apiFetch<Run[]>(`/organizations/${orgId}/workflows/runs`),
        apiFetch<Template[]>(`/organizations/${orgId}/messaging/templates`),
      ]);
      setWorkflows(w); setRuns(r); setTemplates(t);
      apiFetch<{ id: string; name: string; language: string }[]>(`/organizations/${orgId}/inbox/whatsapp-templates`).then(setWaTemplates).catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createWorkflow(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("create"); setError("");
    try {
      const payloadSteps = steps.map(buildPayloadStep);
      const conditions = form.condField ? [{ field: form.condField, op: form.condOp, value: parseConditionValue(form.condValue) }] : undefined;
      await apiFetch(`/organizations/${orgId}/workflows`, { method: "POST", body: JSON.stringify({ name: form.name, trigger: form.trigger, conditions, steps: payloadSteps }) });
      setForm({ name: "", trigger: "order_created", condField: "", condOp: "gte", condValue: "" });
      setSteps([{ type: "send_email", templateId: "", text: "" }]);
      setNotice("Workflow তৈরি হয়েছে ও সক্রিয় আছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  function loadPreset(which: "recovery" | "complaint" | "escalation") {
    const presets = {
      recovery: {
        form: { name: "Recovery Follow-up", trigger: "inbox_message_received", condField: "", condOp: "gte", condValue: "" },
        steps: [
          { type: "wait", templateId: "", text: "", minutes: 60 },
          { type: "condition", templateId: "", text: "", field: "agentReplied", op: "eq", value: "false" },
          { type: "send_inbox_message", templateId: "", text: "আসসালামু আলাইকুম {{contactName}}, আপনার বার্তা আমরা পেয়েছি। কোনো সাহায্য লাগলে জানাবেন।" },
        ] as StepDraft[],
      },
      complaint: {
        form: { name: "অভিযোগ সতর্কতা", trigger: "inbox_message_received", condField: "intent", condOp: "eq", condValue: "complaint" },
        steps: [{ type: "add_conversation_note", templateId: "", text: "অভিযোগ এসেছে — অগ্রাধিকার দিয়ে দেখুন" }] as StepDraft[],
      },
      escalation: {
        form: { name: "Unanswered Escalation", trigger: "inbox_unanswered", condField: "unansweredMinutes", condOp: "gte", condValue: "120" },
        steps: [
          { type: "add_conversation_note", templateId: "", text: "২ ঘণ্টা ধরে উত্তর হয়নি" },
          { type: "wait", templateId: "", text: "", minutes: 1440 },
          { type: "condition", templateId: "", text: "", field: "agentReplied", op: "eq", value: "false" },
          { type: "send_inbox_message", templateId: "", text: "আসসালামু আলাইকুম {{contactName}}, আমরা আপনার বার্তাটি দেখেছি। এখনই সাহায্য করছি।" },
        ] as StepDraft[],
      },
    } as const;
    const preset = presets[which];
    if (editorView === "canvas") {
      const def: WorkflowDefinition = {
        name: preset.form.name,
        trigger: preset.form.trigger,
        steps: preset.steps.map(buildPayloadStep),
      };
      if (preset.form.condField) def.conditions = [{ field: preset.form.condField, op: preset.form.condOp, value: parseConditionValue(preset.form.condValue) }];
      setCanvasDef(def);
      setCanvasScope(`preset-${which}-${Date.now()}`);
      setCanvasNote("");
      setCanvasEpoch((n) => n + 1);
      return;
    }
    setForm({ ...preset.form });
    setSteps(preset.steps.map((x) => ({ ...x })));
  }

  function openInCanvas(w: Workflow) {
    setCanvasDef({
      name: w.name,
      trigger: w.trigger,
      conditions: w.conditions ?? undefined,
      steps: (w.steps ?? []) as RawStep[],
    });
    setCanvasScope(`wf-${w.id}`);
    setCanvasNote("আপনি বিদ্যমান Workflow “" + w.name + "” ক্যানভাসে খুলেছেন। বিদ্যমান Workflow-র ধাপ বদলানোর কোনো API নেই — ক্যানভাস থেকে সংরক্ষণ করলে এটি নতুন Workflow হিসেবে তৈরি হবে, পুরোনোটি যেমন আছে তেমনই থাকবে।");
    setCanvasEpoch((n) => n + 1);
    setEditorView("canvas");
  }

  const inputCls = "input mt-1";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Workflows</h1>
        <p className="text-sm text-slate-500">ঘটনা ঘটলে নিজে থেকে কাজ: যেমন নতুন Order ১০০০ টাকার বেশি হলেই ধন্যবাদ Email, বা Lead Qualified হলেই SMS। পুরনো Order এর Backfill এ Workflow চলবে না, শুধু সাম্প্রতিক ঘটনায়।</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="space-y-3 card p-5">
        <div className="font-semibold">Workflows ({workflows.length})</div>
        {workflows.length === 0 ? <EmptyState title="কোনো Workflow নেই" description="নিচের ফর্মে প্রথম Workflow বানান। Template আগে Messaging পেজে তৈরি করুন।" /> : workflows.map((w) => (
          <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <div>
              <span className="font-medium">{w.name}</span>
              <div className="text-xs text-slate-500">
                Trigger: {TRIGGERS.find((t) => t.value === w.trigger)?.label ?? w.trigger}
                {w.conditions?.length ? ` · শর্ত: ${w.conditions.map((c) => `${c.field} ${c.op} ${String(c.value)}`).join(", ")}` : " · কোনো শর্ত নেই"}
                {` · ধাপ: ${w.steps.map((s) => s.type).join(" → ")}`}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="rounded-lg border px-3 py-1.5" onClick={() => openInCanvas(w)}>ক্যানভাসে খুলুন</button>
              <button className="rounded-lg border px-3 py-1.5" onClick={async () => { const o = getOrganizationId(); if (o) { await apiFetch(`/organizations/${o}/workflows/${w.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !w.enabled }) }); await load(); } }}>{w.enabled ? "বন্ধ করুন" : "চালু করুন"}</button>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-sm font-semibold">নতুন Workflow:</span>
          <div className="flex overflow-hidden rounded-lg border">
            <button type="button" className={`px-3 py-1.5 text-sm ${editorView === "form" ? "bg-indigo-600 text-white" : "bg-white"}`} onClick={() => setEditorView("form")}>ফর্ম</button>
            <button type="button" className={`px-3 py-1.5 text-sm ${editorView === "canvas" ? "bg-indigo-600 text-white" : "bg-white"}`} onClick={() => setEditorView("canvas")}>ক্যানভাস (Visual)</button>
          </div>
        </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-indigo-50 p-3">
            <span className="text-xs font-semibold text-indigo-700">তৈরি Flow:</span>
            <button type="button" className="btn-secondary btn-sm" onClick={() => loadPreset("recovery")}>উত্তর না পেলে ফলো-আপ (১ ঘণ্টা)</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => loadPreset("complaint")}>অভিযোগ এলে নোট</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => loadPreset("escalation")}>Unanswered Escalation</button>
          </div>
        <form onSubmit={createWorkflow} className={`space-y-3 ${editorView === "canvas" ? "hidden" : ""}`}>
          <div className="grid gap-3 lg:grid-cols-3">
            <label className="block text-sm">Workflow এর নাম<input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="বড় Order এ ধন্যবাদ" /></label>
            <label className="block text-sm">Trigger
              <select className={inputCls} value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
                {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="block text-sm">শর্তের Field (ঐচ্ছিক)
              <select className={inputCls} value={form.condField} onChange={(e) => setForm({ ...form, condField: e.target.value })}>
                <option value="">কোনো শর্ত নেই</option>
                <option value="total">Order Total</option><option value="stage">Lead Stage</option><option value="source">Source</option><option value="status">Order Status</option>
              </select>
            </label>
            {form.condField ? <>
              <label className="block text-sm">Operator
                <select className={inputCls} value={form.condOp} onChange={(e) => setForm({ ...form, condOp: e.target.value })}>
                  <option value="gte">কমপক্ষে (gte)</option><option value="gt">বেশি (gt)</option><option value="eq">সমান (eq)</option><option value="lt">কম (lt)</option><option value="lte">সর্বোচ্চ (lte)</option>
                </select>
              </label>
              <label className="block text-sm">শর্তের মান<input className={inputCls} value={form.condValue} onChange={(e) => setForm({ ...form, condValue: e.target.value })} placeholder="1000 অথবা qualified" /></label>
            </> : null}
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold">ধাপসমূহ</div>
            {steps.map((s, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <StepFields draft={s} onChange={(next) => setSteps(steps.map((x, j) => (j === i ? next : x)))} templates={templates} waTemplates={waTemplates} inputCls={inputCls} />
                {steps.length > 1 ? <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>মুছুন</button> : null}
              </div>
            ))}
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => setSteps([...steps, { type: "send_sms", templateId: "", text: "" }])}>+ আরেকটি ধাপ</button>
          </div>
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>Workflow তৈরি করুন</button>
        </form>
        {editorView === "canvas" ? (
          <div className="border-t pt-3">
            <WorkflowCanvas
              key={`${canvasScope}-${canvasEpoch}`}
              initialDefinition={canvasDef}
              scopeKey={canvasScope}
              templates={templates}
              waTemplates={waTemplates}
              sourceNote={canvasNote || undefined}
              onSaved={load}
            />
          </div>
        ) : null}
      </div>

      <div className="card p-5">
        <div className="font-semibold">সাম্প্রতিক Workflow Runs</div>
        {runs.length === 0 ? <p className="mt-2 text-sm text-slate-500">এখনো কোনো Run নেই।</p> : (
          <div className="mt-2 space-y-1">
            {runs.slice(0, 30).map((r) => (
              <div key={r.id} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span>{r.trigger} · {new Date(r.createdAt).toLocaleString()}</span>
                  <span className={r.status === "completed" ? "text-green-600" : r.status === "waiting" ? "text-amber-600" : r.status === "skipped" ? "text-slate-500" : "text-red-600"}>{r.status === "waiting" ? "waiting (অপেক্ষমাণ)" : r.status}</span>
                </div>
                {(r.stepsLog ?? []).map((s, i) => <div key={i} className="text-xs text-slate-500">{s.step}: {s.status} - {s.detail}</div>)}
                {r.error ? <div className="text-xs text-red-600">{r.error}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
