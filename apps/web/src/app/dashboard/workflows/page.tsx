"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import { StepFields } from "@/components/step-fields";
import WorkflowCanvas from "@/components/workflow-canvas";
import { buildPayloadStep, parseConditionValue, stepToDraft, type RawStep, type StepDraftLike, type WorkflowDefinition } from "@/lib/workflow-graph";

interface Template { id: string; name: string; channel: string }
type StepDraft = StepDraftLike;
interface Workflow { id: string; name: string; trigger: string; conditions?: { field: string; op: string; value: unknown }[] | null; steps: { type: string; templateId?: string; text?: string }[]; enabled: boolean; cooldownMinutes?: number; dailyRunCap?: number | null }
interface Run { id: string; trigger: string; status: string; stepsLog?: { step: string; status: string; detail: string }[] | null; error?: string | null; createdAt: string }

const TRIGGERS = [
  { value: "order_created", label: "নতুন Order তৈরি হলে" },
  { value: "order_delivered", label: "Order ডেলিভারি হলে" },
  { value: "order_cod_confirmed", label: "COD Order কনফার্ম হলে" },
  { value: "order_status_changed", label: "Order এর Status বদলালে" },
  { value: "order_refunded", label: "Order Refund হলে" },
  { value: "shipment_status_changed", label: "পার্সেলের Status বদলালে" },
  { value: "shipment_delivered", label: "পার্সেল ডেলিভারি হলে" },
  { value: "shipment_returned", label: "পার্সেল রিটার্ন হলে" },
  { value: "lead_created", label: "নতুন Lead তৈরি হলে" },
  { value: "inbox_message_received", label: "Inbox এ নতুন বার্তা এলে" },
  { value: "inbox_unanswered", label: "Inbox বার্তার উত্তর না হলে (সময়ভিত্তিক)" },
  { value: "conversation_assigned", label: "কথোপকথন Assign হলে" },
  { value: "conversation_closed", label: "কথোপকথন বন্ধ হলে" },
  { value: "lead_stage_changed", label: "Lead এর Stage বদলালে" },
  { value: "schedule", label: "প্রতিদিন নির্দিষ্ট সময়ে (Schedule)" },
];

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState({ name: "", trigger: "order_created", condField: "", condOp: "gte", condValue: "", cooldown: "", cap: "" });
  // Workflows W6: server preset gallery.
  const [presets, setPresets] = useState<{ key: string; name: string; descriptionBn: string }[]>([]);
  const [steps, setSteps] = useState<StepDraft[]>([{ type: "send_email", templateId: "", text: "" }]);
  const [waTemplates, setWaTemplates] = useState<{ id: string; name: string; language: string }[]>([]);
  // Workflows W3: member list for the assign step.
  const [members, setMembers] = useState<{ userId: string; name: string; role: string }[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [editorView, setEditorView] = useState<"form" | "canvas">("form");
  const [canvasDef, setCanvasDef] = useState<WorkflowDefinition>({ name: "", trigger: "order_created", steps: [{ type: "send_email", templateId: "" }] });
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [canvasScope, setCanvasScope] = useState("new");
  const [canvasNote, setCanvasNote] = useState("");
  // Workflows W1: edit-in-place state (form + canvas).
  const [canvasWorkflowId, setCanvasWorkflowId] = useState<string | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Workflows W5: stats, run filters, test panel.
  const [stats, setStats] = useState<{ workflowId: string; runs30d: number; successRate: number | null; lastRunAt: string | null }[]>([]);
  const [runFilter, setRunFilter] = useState({ workflowId: "", status: "" });
  const [testPanel, setTestPanel] = useState<{ workflowId: string; name: string } | null>(null);
  const [testCtx, setTestCtx] = useState({ leadId: "", customerId: "", conversationId: "", orderId: "" });
  const [trace, setTrace] = useState<{ conditionsPassed: boolean; trace: { step: string; detail: string; branch?: string }[] } | null>(null);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const runQuery = new URLSearchParams();
      if (runFilter.workflowId) runQuery.set("workflowId", runFilter.workflowId);
      if (runFilter.status) runQuery.set("status", runFilter.status);
      const [w, r, t] = await Promise.all([
        apiFetch<Workflow[]>(`/organizations/${orgId}/workflows`),
        apiFetch<Run[]>(`/organizations/${orgId}/workflows/runs${runQuery.toString() ? `?${runQuery}` : ""}`),
        apiFetch<Template[]>(`/organizations/${orgId}/messaging/templates`),
      ]);
      apiFetch<{ workflowId: string; runs30d: number; successRate: number | null; lastRunAt: string | null }[]>(`/organizations/${orgId}/workflows/stats`).then(setStats).catch(() => undefined);
      setWorkflows(w); setRuns(r); setTemplates(t);
      apiFetch<{ id: string; name: string; language: string }[]>(`/organizations/${orgId}/inbox/whatsapp-templates`).then(setWaTemplates).catch(() => undefined);
      apiFetch<any[]>(`/organizations/${orgId}/members`).then((rows) => setMembers(rows.filter((m) => m.status === "ACTIVE").map((m) => ({ userId: m.userId, name: m.user?.name ?? m.user?.email ?? m.userId, role: m.role })))).catch(() => undefined);
      apiFetch<{ key: string; name: string; descriptionBn: string }[]>(`/organizations/${orgId}/workflows/presets`).then(setPresets).catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, [runFilter]);
  useEffect(() => { load(); }, [load]);

  // Workflows W5 helpers.
  function testContext() {
    const ctx: Record<string, string> = {};
    if (testCtx.leadId.trim()) ctx.leadId = testCtx.leadId.trim();
    if (testCtx.customerId.trim()) ctx.customerId = testCtx.customerId.trim();
    if (testCtx.conversationId.trim()) ctx.conversationId = testCtx.conversationId.trim();
    if (testCtx.orderId.trim()) ctx.orderId = testCtx.orderId.trim();
    return ctx;
  }
  async function runDry() {
    const orgId = getOrganizationId(); if (!orgId || !testPanel) return;
    setError(""); setTrace(null);
    try {
      const out = await apiFetch<{ conditionsPassed: boolean; trace: { step: string; detail: string; branch?: string }[] }>(`/organizations/${orgId}/workflows/${testPanel.workflowId}/dry-run`, { method: "POST", body: JSON.stringify({ context: testContext() }) });
      setTrace(out);
    } catch (e) { setError(e instanceof Error ? e.message : "Dry-run হয়নি"); }
  }
  async function runManual() {
    const orgId = getOrganizationId(); if (!orgId || !testPanel) return;
    if (!window.confirm("এটি আসল Run — ধাপগুলো সত্যিই কার্যকর হবে (মেসেজ যাবে, Stage বদলাবে)। চালাবেন?")) return;
    setError("");
    try {
      const run = await apiFetch<Run>(`/organizations/${orgId}/workflows/${testPanel.workflowId}/run`, { method: "POST", body: JSON.stringify({ context: testContext() }) });
      setNotice(`Manual Run শেষ: ${run.status}`);
      setTestPanel(null); setTrace(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Run হয়নি"); }
  }
  async function retryRun(runId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      const run = await apiFetch<Run>(`/organizations/${orgId}/workflows/runs/${runId}/retry`, { method: "POST", body: JSON.stringify({}) });
      setNotice(`Retry শেষ: ${run.status}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Retry হয়নি"); }
  }

  async function createWorkflow(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("create"); setError("");
    try {
      const payloadSteps = steps.map(buildPayloadStep);
      const conditions = form.condField ? [{ field: form.condField, op: form.condOp, value: parseConditionValue(form.condValue) }] : undefined;
      // Workflows W6 governance (empty cap on edit = clear).
      const governance = {
        cooldownMinutes: form.cooldown ? Number(form.cooldown) : 0,
        dailyRunCap: form.cap ? Number(form.cap) : null,
      };
      if (editingId) {
        // Workflows W1: full-definition PATCH (validated
        // server-side exactly like create).
        await apiFetch(`/organizations/${orgId}/workflows/${editingId}`, { method: "PATCH", body: JSON.stringify({ name: form.name, trigger: form.trigger, conditions: conditions ?? [], steps: payloadSteps, ...governance }) });
        setNotice("Workflow আপডেট হয়েছে। চলমান Run গুলো আগের ধাপেই চলবে (Snapshot)।");
      } else {
        await apiFetch(`/organizations/${orgId}/workflows`, { method: "POST", body: JSON.stringify({ name: form.name, trigger: form.trigger, conditions, steps: payloadSteps, ...governance }) });
        setNotice("Workflow তৈরি হয়েছে ও সক্রিয় আছে।");
      }
      setEditingId(null);
      setForm({ name: "", trigger: "order_created", condField: "", condOp: "gte", condValue: "", cooldown: "", cap: "" });
      setSteps([{ type: "send_email", templateId: "", text: "" }]);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  function loadForEdit(w: Workflow) {
    const conds = w.conditions ?? [];
    if (conds.length > 1) {
      setError("এই Workflow এ একাধিক শর্ত আছে — ফর্মে শুধু একটি শর্ত সম্পাদনা যায়। ক্যানভাসে সম্পাদনা করুন।");
      return;
    }
    setError("");
    setEditingId(w.id);
    setForm({
      name: w.name, trigger: w.trigger,
      condField: conds[0]?.field ?? "", condOp: conds[0]?.op ?? "gte",
      condValue: conds[0] ? String(conds[0].value ?? "") : "",
      cooldown: w.cooldownMinutes ? String(w.cooldownMinutes) : "",
      cap: w.dailyRunCap != null ? String(w.dailyRunCap) : "",
    });
    // The lib's converter is the single source of truth
    // (W3 fields + W4 branch arms included, recursively).
    setSteps((w.steps ?? []).map((s) => stepToDraft(s as unknown as RawStep)));
    setEditorView("form");
  }

  async function installPreset(key: string, name: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/workflows/presets/${key}/install`, { method: "POST", body: JSON.stringify({}) });
      setNotice(`Preset "${name}" ইনস্টল হয়েছে — বন্ধ অবস্থায় আছে, যাচাই করে চালু করুন।`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ইনস্টল হয়নি"); }
  }

  async function cloneWorkflow(w: Workflow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/workflows/${w.id}/clone`, { method: "POST", body: JSON.stringify({}) });
      setNotice(`"${w.name}" এর কপি তৈরি হয়েছে — নিরাপত্তার জন্য কপিটি বন্ধ অবস্থায় আছে, যাচাই করে চালু করুন।`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ক্লোন হয়নি"); }
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
      setCanvasWorkflowId(undefined);
      setCanvasEpoch((n) => n + 1);
      return;
    }
    setForm({ ...preset.form, cooldown: "", cap: "" });
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
    setCanvasWorkflowId(w.id);
    setCanvasNote("আপনি বিদ্যমান Workflow “" + w.name + "” সম্পাদনা করছেন — সংরক্ষণ করলে এখানেই আপডেট হবে। ইতিমধ্যে চলমান Run গুলো শুরুর সময়ের ধাপ (Snapshot) দিয়েই শেষ হবে।");
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
              {(() => { const st = stats.find((s) => s.workflowId === w.id); return st ? (
                <div className="mt-0.5 text-xs text-slate-500">📊 ৩০ দিনে {st.runs30d} Run{st.successRate !== null ? ` · সাফল্য ${st.successRate}%` : " · সাফল্যের হার নেই (শেষ হয়নি)"}{st.lastRunAt ? ` · শেষ: ${new Date(st.lastRunAt).toLocaleString()}` : ""}</div>
              ) : null; })()}
            </div>
            <div className="flex gap-2">
              <button className="rounded-lg border px-3 py-1.5" onClick={() => { setTestPanel({ workflowId: w.id, name: w.name }); setTrace(null); }}>🧪 টেস্ট / চালান</button>
              <button className="rounded-lg border px-3 py-1.5" onClick={() => loadForEdit(w)}>ফর্মে সম্পাদনা</button>
              <button className="rounded-lg border px-3 py-1.5" onClick={() => openInCanvas(w)}>ক্যানভাসে খুলুন</button>
              <button className="rounded-lg border px-3 py-1.5" onClick={() => void cloneWorkflow(w)}>ক্লোন</button>
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
          {presets.length ? (
            <div className="rounded-xl bg-emerald-50 p-3">
              <div className="text-xs font-semibold text-emerald-700">📚 Preset Gallery — এক ক্লিকে ইনস্টল (বন্ধ অবস্থায় আসে, যাচাই করে চালু করুন)</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {presets.map((p) => (
                  <div key={p.key} className="rounded-lg bg-white p-3 text-sm shadow-sm">
                    <div className="font-medium">{p.name}</div>
                    <p className="mt-0.5 text-xs text-slate-500">{p.descriptionBn}</p>
                    <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => void installPreset(p.key, p.name)}>ইনস্টল করুন</button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
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
                <option value="fromStatus">আগের Status (শুধু Order Status Changed এ)</option><option value="toStatus">নতুন Status (শুধু Order Status Changed এ)</option>
                <option value="refundAmount">Refund পরিমাণ, টাকায় (শুধু Order Refunded এ)</option><option value="cumulativeRefunded">মোট Refund, টাকায় (শুধু Order Refunded এ)</option>
                <option value="shipmentStatus">পার্সেলের নতুন Status (শুধু Shipment Trigger গুলোতে)</option><option value="previousStatus">পার্সেলের আগের Status (শুধু Shipment Trigger গুলোতে)</option>
                <option value="scheduleTime">Schedule সময় (HH:MM — শুধু Schedule Trigger এ)</option><option value="scheduleDays">Schedule দিন (0=রবি..6=শনি, কমা দিয়ে)</option>
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">Cooldown (মিনিট, ঐচ্ছিক)
              <input className={inputCls} type="number" min={0} max={10080} value={form.cooldown} onChange={(e) => setForm({ ...form, cooldown: e.target.value })} placeholder="0 = নেই" />
              <span className="text-xs text-slate-500">একই Lead/Customer/কথোপকথনের জন্য অটো-Run এর মধ্যে ন্যূনতম ব্যবধান</span>
            </label>
            <label className="block text-sm">দৈনিক সর্বোচ্চ অটো-Run (ঐচ্ছিক)
              <input className={inputCls} type="number" min={1} max={10000} value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} placeholder="খালি = সীমা নেই" />
              <span className="text-xs text-slate-500">সীমা পেরোলে Run skipped হিসেবে রেকর্ড হবে (হাতে চালানো/Retry এ প্রযোজ্য নয়)</span>
            </label>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold">ধাপসমূহ</div>
            {steps.map((s, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <StepFields draft={s} onChange={(next) => setSteps(steps.map((x, j) => (j === i ? next : x)))} templates={templates} waTemplates={waTemplates} members={members} inputCls={inputCls} />
                {steps.length > 1 ? <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>মুছুন</button> : null}
              </div>
            ))}
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => setSteps([...steps, { type: "send_sms", templateId: "", text: "" }])}>+ আরেকটি ধাপ</button>
          </div>
          {editingId ? (
            <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
              ✏️ একটি বিদ্যমান Workflow সম্পাদনা করছেন — সংরক্ষণে এখানেই আপডেট হবে।
              <button type="button" className="ml-2 underline" onClick={() => { setEditingId(null); setForm({ name: "", trigger: "order_created", condField: "", condOp: "gte", condValue: "", cooldown: "", cap: "" }); setSteps([{ type: "send_email", templateId: "", text: "" }]); }}>বাতিল</button>
            </p>
          ) : null}
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{editingId ? "আপডেট সংরক্ষণ করুন" : "Workflow তৈরি করুন"}</button>
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
              workflowId={canvasWorkflowId}
              members={members}
            />
          </div>
        ) : null}
      </div>

      {testPanel ? (
        <div className="card space-y-3 border-indigo-200 p-5">
          <div className="flex items-center justify-between">
            <div className="font-semibold">🧪 টেস্ট / হাতে চালান — {testPanel.name}</div>
            <button className="rounded-lg border px-3 py-1 text-sm" onClick={() => { setTestPanel(null); setTrace(null); }}>বন্ধ করুন</button>
          </div>
          <p className="text-xs text-slate-500">কোন Lead/Customer/কথোপকথন/Order এর প্রেক্ষিতে চালাবেন তার ID দিন (যেকোনো একটি বা একাধিক)। Dry-run এ কিছুই পাঠানো বা বদলানো হয় না — শুধু দেখায় কী হতো।</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm">Lead ID<input className={inputCls} value={testCtx.leadId} onChange={(e) => setTestCtx({ ...testCtx, leadId: e.target.value })} placeholder="ঐচ্ছিক" /></label>
            <label className="block text-sm">Customer ID<input className={inputCls} value={testCtx.customerId} onChange={(e) => setTestCtx({ ...testCtx, customerId: e.target.value })} placeholder="ঐচ্ছিক" /></label>
            <label className="block text-sm">Conversation ID<input className={inputCls} value={testCtx.conversationId} onChange={(e) => setTestCtx({ ...testCtx, conversationId: e.target.value })} placeholder="ঐচ্ছিক" /></label>
            <label className="block text-sm">Order ID<input className={inputCls} value={testCtx.orderId} onChange={(e) => setTestCtx({ ...testCtx, orderId: e.target.value })} placeholder="ঐচ্ছিক" /></label>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => void runDry()}>🧪 Dry-run (কিছু পাঠাবো না)</button>
            <button className="btn-primary" onClick={() => void runManual()}>▶️ আসল Run</button>
          </div>
          {trace ? (
            <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
              {trace.conditionsPassed ? trace.trace.map((t, i) => (
                <div key={i} className="text-xs text-slate-600"><span className="font-mono font-semibold">{t.step}</span>{t.branch ? ` (${t.branch})` : ""}: {t.detail}</div>
              )) : <div className="text-xs text-amber-700">Workflow এর শর্ত মেলেনি — এই প্রেক্ষিতে Run টি skipped হতো।</div>}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">সাম্প্রতিক Workflow Runs</div>
          <div className="flex gap-2">
            <select className="input !mt-0 !w-auto text-sm" value={runFilter.workflowId} onChange={(e) => setRunFilter({ ...runFilter, workflowId: e.target.value })}>
              <option value="">সব Workflow</option>
              {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <select className="input !mt-0 !w-auto text-sm" value={runFilter.status} onChange={(e) => setRunFilter({ ...runFilter, status: e.target.value })}>
              <option value="">সব Status</option><option value="completed">completed</option><option value="failed">failed</option><option value="waiting">waiting</option><option value="skipped">skipped</option>
            </select>
          </div>
        </div>
        {runs.length === 0 ? <p className="mt-2 text-sm text-slate-500">এখনো কোনো Run নেই।</p> : (
          <div className="mt-2 space-y-1">
            {runs.slice(0, 30).map((r) => (
              <div key={r.id} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span>{r.trigger} · {new Date(r.createdAt).toLocaleString()}</span>
                  <span className="flex items-center gap-2">
                    {r.status === "failed" ? <button className="rounded border bg-white px-2 py-0.5 text-xs" onClick={() => void retryRun(r.id)}>↻ আবার চেষ্টা</button> : null}
                    <span className={r.status === "completed" ? "text-green-600" : r.status === "waiting" ? "text-amber-600" : r.status === "skipped" ? "text-slate-500" : "text-red-600"}>{r.status === "waiting" ? "waiting (অপেক্ষমাণ)" : r.status}</span>
                  </span>
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
