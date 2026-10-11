"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Connection,
  Controls,
  Edge,
  Handle,
  Node,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  ConditionRule,
  GraphEdgeKind,
  KNOWN_STEP_TYPES,
  RawStep,
  STEP_TYPE_META,
  WorkflowDefinition,
  WorkflowGraph,
  applyDraftToStep,
  definitionToGraph,
  graphToDefinition,
  graphToDefinitionLenient,
  insertStep,
  isKnownStepType,
  parseConditionValue,
  removeStep,
  replaceStep,
  stepSummary,
  stepToDraft,
  type StepDraftLike,
} from "@/lib/workflow-graph";
import { StepFields, TemplateOption, WaTemplateOption } from "./step-fields";

const TRIGGERS = [
  { value: "order_created", label: "নতুন Order তৈরি হলে" },
  { value: "order_delivered", label: "Order ডেলিভারি হলে" },
  { value: "order_cod_confirmed", label: "COD Order কনফার্ম হলে" },
  { value: "order_status_changed", label: "Order এর Status বদলালে" },
  { value: "order_refunded", label: "Order Refund হলে" },
  { value: "cart_abandoned", label: "কার্ট ফেলে রেখে গেলে (Cart Abandoned)" },
  { value: "shipment_status_changed", label: "পার্সেলের Status বদলালে" },
  { value: "shipment_delivered", label: "পার্সেল ডেলিভারি হলে" },
  { value: "shipment_returned", label: "পার্সেল রিটার্ন হলে" },
  { value: "lead_created", label: "নতুন Lead তৈরি হলে" },
  { value: "lead_stage_changed", label: "Lead এর Stage বদলালে" },
  { value: "inbox_message_received", label: "Inbox এ নতুন বার্তা এলে" },
  { value: "inbox_unanswered", label: "Inbox বার্তার উত্তর না হলে (সময়ভিত্তিক)" },
  { value: "conversation_assigned", label: "কথোপকথন Assign হলে" },
  { value: "conversation_closed", label: "কথোপকথন বন্ধ হলে" },
  { value: "schedule", label: "প্রতিদিন নির্দিষ্ট সময়ে (Schedule)" },
];
const OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains"];

interface StepNodeData {
  kind: "trigger" | "step" | "stop" | "end";
  stepIndex: number;
  step?: RawStep;
  label: string;
  summary: string;
  color: string;
  locked?: boolean;
  isCondition?: boolean;
  [key: string]: unknown;
}

type FlowNode = Node<StepNodeData>;
type FlowEdge = Edge<{ kind: GraphEdgeKind }>;

function nodeLabel(kind: StepNodeData["kind"], step?: RawStep, name?: string): { label: string; summary: string; color: string } {
  if (kind === "trigger") return { label: name || "Workflow শুরু", summary: "Trigger", color: "#0f172a" };
  if (kind === "end") return { label: "শেষ", summary: "Flow এখানে শেষ", color: "#475569" };
  if (kind === "stop") return { label: "থামবে", summary: "শর্ত না মিললে Run এখানেই শেষ", color: "#dc2626" };
  const meta = STEP_TYPE_META[step?.type ?? ""] ?? STEP_TYPE_META.unknown;
  return { label: meta.label, summary: step ? stepSummary(step) : "", color: meta.color };
}

function StepNode({ data, selected }: NodeProps<FlowNode>) {
  const { kind, color } = data;
  return (
    <div
      className={`min-w-44 rounded-xl border bg-white px-3 py-2 shadow-sm ${selected ? "ring-2 ring-indigo-500" : ""}`}
      style={{ borderLeft: `5px solid ${color}` }}
    >
      {kind !== "trigger" ? <Handle type="target" position={Position.Top} isConnectable={kind === "step" || kind === "end"} /> : null}
      <div className="text-sm font-semibold">
        {data.label} {data.locked ? <span className="text-xs text-slate-400">🔒</span> : null}
      </div>
      <div className="max-w-56 truncate text-xs text-slate-500">{data.summary}</div>
      {kind === "trigger" || kind === "step" ? (
        <Handle type="source" position={Position.Bottom} id="out" />
      ) : null}
      {data.isCondition ? (
        <Handle type="source" position={Position.Right} id="no" isConnectable={false} style={{ background: "#dc2626" }} />
      ) : null}
    </div>
  );
}

const nodeTypes = { step: StepNode };

function graphToFlow(graph: WorkflowGraph, meta: { name: string; trigger: string }): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = graph.nodes.map((n) => {
    const info = nodeLabel(n.kind, n.step, meta.name);
    return {
      id: n.id,
      type: "step",
      position: n.position,
      // nodes are deleted from the side panel only (which rebuilds
      // derived stop nodes correctly); edges stay keyboard-deletable
      deletable: false,
      data: {
        kind: n.kind,
        stepIndex: n.stepIndex,
        step: n.step,
        label: n.kind === "trigger" ? info.label : info.label,
        summary: n.kind === "trigger" ? (TRIGGERS.find((t) => t.value === meta.trigger)?.label ?? meta.trigger) : info.summary,
        color: info.color,
        locked: n.kind === "step" && !!n.step && !isKnownStepType(n.step.type),
        isCondition: n.kind === "step" && n.step?.type === "condition",
      },
    };
  });
  const edges: FlowEdge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.kind === "no" ? "no" : "out",
    label: e.kind === "yes" ? "হ্যাঁ" : e.kind === "no" ? "না" : undefined,
    deletable: e.kind !== "no",
    selectable: e.kind !== "no",
    animated: e.kind === "no",
    style: e.kind === "yes" ? { stroke: "#16a34a", strokeWidth: 2 } : e.kind === "no" ? { stroke: "#dc2626", strokeDasharray: "5 4" } : { stroke: "#64748b", strokeWidth: 1.5 },
    data: { kind: e.kind },
  }));
  return { nodes, edges };
}

function flowToGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  meta: { name: string; trigger: string; conditions: ConditionRule[] },
): WorkflowGraph {
  return {
    name: meta.name,
    trigger: meta.trigger,
    conditions: meta.conditions,
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      stepIndex: n.data.stepIndex,
      step: n.data.step,
      position: n.position,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, kind: (e.data?.kind ?? "next") as GraphEdgeKind })),
  };
}

function CanvasInner({
  initialDefinition,
  scopeKey,
  templates,
  waTemplates,
  sourceNote,
  onSaved,
  workflowId,
  members = [],
}: {
  initialDefinition: WorkflowDefinition;
  scopeKey: string;
  templates: TemplateOption[];
  waTemplates: WaTemplateOption[];
  sourceNote?: string;
  onSaved: () => void | Promise<void>;
  // Workflows W1: when set, Save PATCHES this workflow in
  // place instead of creating a new one.
  workflowId?: string;
  members?: { userId: string; name: string; role: string }[];
}) {
  const storageKey = `wfc-pos:${scopeKey}`;
  const [meta, setMeta] = useState({
    name: initialDefinition.name ?? "",
    trigger: initialDefinition.trigger ?? "order_created",
    conditions: (initialDefinition.conditions ?? []) as ConditionRule[],
  });
  const initial = useMemo(() => {
    let stored: Record<string, { x: number; y: number }> | undefined;
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      if (raw) stored = JSON.parse(raw);
    } catch { /* corrupted storage -> auto-layout */ }
    return graphToFlow(definitionToGraph(initialDefinition, stored), { name: initialDefinition.name, trigger: initialDefinition.trigger });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(initial.edges);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<StepDraftLike | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const selectedNode = nodes.find((n) => n.id === selectedId);
  const graphNow = useCallback(
    () => flowToGraph(nodes, edges, meta),
    [nodes, edges, meta],
  );

  // Selecting a step loads its draft into the side panel.
  useEffect(() => {
    if (selectedNode?.data.kind === "step" && selectedNode.data.step && isKnownStepType(selectedNode.data.step.type)) {
      setDraft(stepToDraft(selectedNode.data.step));
    } else {
      setDraft(null);
    }
  }, [selectedId, nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const persistPositions = useCallback(
    (current: FlowNode[]) => {
      try {
        const pos: Record<string, { x: number; y: number }> = {};
        for (const n of current) pos[n.id] = n.position;
        window.localStorage.setItem(storageKey, JSON.stringify(pos));
      } catch { /* storage full/blocked: positions are cosmetic */ }
    },
    [storageKey],
  );

  const rebuildFrom = useCallback(
    (graph: WorkflowGraph, keepMeta = true, selectId = "") => {
      const m = keepMeta ? meta : { name: graph.name, trigger: graph.trigger, conditions: graph.conditions };
      if (!keepMeta) setMeta(m);
      const flow = graphToFlow(graph, m);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setSelectedId(selectId);
    },
    [meta, setNodes, setEdges],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      setError("");
      const { source, target, sourceHandle } = conn;
      if (!source || !target) return;
      if (sourceHandle === "no") {
        setError("“না” পথটি Engine-এর নিয়ম — শর্ত না মিললে Run থেমে যায়, এটি বদলানো যায় না।");
        return;
      }
      const targetNode = nodes.find((n) => n.id === target);
      const sourceNode = nodes.find((n) => n.id === source);
      if (!targetNode || (targetNode.data.kind !== "step" && targetNode.data.kind !== "end")) {
        setError("সংযোগ শুধু কোনো ধাপে বা শেষ ধাপে দেওয়া যায়।");
        return;
      }
      if (edges.some((e) => e.source === source && e.data?.kind !== "no")) {
        setError("এই ধাপের একটি বহির্গামী সংযোগ আগেই আছে — আগে সেটি মুছে তারপর নতুন সংযোগ দিন।");
        return;
      }
      if (edges.some((e) => e.target === target)) {
        setError("এই ধাপে আগেই একটি সংযোগ এসেছে — আগে সেটি মুছে তারপর নতুন সংযোগ দিন।");
        return;
      }
      // cycle check: walking forward from target must never reach source
      const forward = new Map<string, string>();
      for (const e of edges) if (e.data?.kind !== "no") forward.set(e.source, e.target);
      let cursor: string | undefined = target;
      const guard = new Set<string>();
      while (cursor) {
        if (cursor === source) { setError("এই সংযোগে বৃত্ত (cycle) তৈরি হবে — Workflow এগিয়ে যাওয়ার পথে লুপ হতে পারে না।"); return; }
        if (guard.has(cursor)) break;
        guard.add(cursor);
        cursor = forward.get(cursor);
      }
      const kind: GraphEdgeKind = sourceNode?.data.step?.type === "condition" ? "yes" : "next";
      setEdges((eds) =>
        addEdge(
          {
            ...conn,
            id: `e-${source}-${target}-${Date.now()}`,
            label: kind === "yes" ? "হ্যাঁ" : undefined,
            style: kind === "yes" ? { stroke: "#16a34a", strokeWidth: 2 } : { stroke: "#64748b", strokeWidth: 1.5 },
            data: { kind },
          } as FlowEdge,
          eds,
        ),
      );
    },
    [edges, nodes, setEdges],
  );

  const addStepAt = useCallback(
    (type: string, afterStepIndex: number, position?: { x: number; y: number }) => {
      const graph = insertStep(graphNow(), type, afterStepIndex);
      if (position) {
        const def = graphToDefinitionLenient(graph);
        const idx = Math.max(0, Math.min(afterStepIndex + 1, def.steps.length - 1));
        const positions: Record<string, { x: number; y: number }> = {};
        for (const n of graph.nodes) positions[n.id] = n.position;
        positions[`step-${idx}`] = position;
        rebuildFrom(definitionToGraph(def, positions));
        return;
      }
      rebuildFrom(graph);
    },
    [graphNow, rebuildFrom],
  );

  const selectedStepIndex = selectedNode?.data.kind === "step" ? selectedNode.data.stepIndex : -1;
  const lastStepIndex = nodes.filter((n) => n.data.kind === "step").length - 1;

  function applyPanel() {
    if (!selectedNode || selectedNode.data.kind !== "step" || !draft || !selectedNode.data.step) return;
    const before = selectedNode.data.step;
    const nextStep = applyDraftToStep(before, draft);
    const wasCondition = before.type === "condition";
    const isCondition = nextStep.type === "condition";
    if (wasCondition !== isCondition) {
      // topology changes (stop node appears/disappears): rebuild
      const graph = graphNow();
      const def = graphToDefinitionLenient(graph);
      def.steps[selectedNode.data.stepIndex] = nextStep;
      const positions: Record<string, { x: number; y: number }> = {};
      for (const n of graph.nodes) positions[n.id] = n.position;
      rebuildFrom(definitionToGraph(def, positions), true, selectedNode.id);
    } else {
      const graph = replaceStep(graphNow(), selectedNode.data.stepIndex, nextStep);
      rebuildFrom(graph, true, selectedNode.id);
    }
    setNotice("ধাপের পরিবর্তন ক্যানভাসে প্রয়োগ হয়েছে — সংরক্ষণ না করলে সার্ভারে যাবে না।");
  }

  function deleteSelectedStep() {
    if (selectedNode?.data.kind !== "step") return;
    rebuildFrom(removeStep(graphNow(), selectedNode.data.stepIndex));
  }

  function moveSelected(dir: -1 | 1) {
    if (selectedNode?.data.kind !== "step") return;
    const graph = graphNow();
    const def = graphToDefinitionLenient(graph);
    const i = selectedNode.data.stepIndex;
    const j = i + dir;
    if (j < 0 || j >= def.steps.length) return;
    const tmp = def.steps[i];
    def.steps[i] = def.steps[j];
    def.steps[j] = tmp;
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of graph.nodes) positions[n.id] = n.position;
    rebuildFrom(definitionToGraph(def, positions));
  }

  function tidy() {
    try { window.localStorage.removeItem(storageKey); } catch { /* noop */ }
    const def = graphToDefinitionLenient(graphNow());
    rebuildFrom(definitionToGraph(def));
  }

  async function save() {
    setError(""); setNotice(""); setBusy(true);
    try {
      const def = graphToDefinition(graphNow());
      if (!def.name.trim()) throw new Error("Workflow এর নাম দিন");
      if (def.steps.length === 0) throw new Error("কমপক্ষে একটি ধাপ যোগ করুন");
      const orgId = getOrganizationId();
      if (!orgId) throw new Error("Organization পাওয়া যায়নি");
      const payload: Record<string, unknown> = { name: def.name, trigger: def.trigger, steps: def.steps };
      if (def.conditions && def.conditions.length > 0) payload.conditions = def.conditions;
      if (workflowId) {
        // Workflows W1: edit in place. Runs already in
        // flight keep their start-time snapshot.
        await apiFetch(`/organizations/${orgId}/workflows/${workflowId}`, { method: "PATCH", body: JSON.stringify(payload) });
        setNotice("Workflow আপডেট হয়েছে। চলমান Run গুলো আগের ধাপেই চলবে (Snapshot)।");
      } else {
        await apiFetch(`/organizations/${orgId}/workflows`, { method: "POST", body: JSON.stringify(payload) });
        setNotice("Workflow তৈরি হয়েছে ও সক্রিয় আছে।");
      }
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ হয়েছে");
    } finally {
      setBusy(false);
    }
  }

  const firstCondition = meta.conditions[0];
  const extraConditions = meta.conditions.slice(1);

  return (
    <div className="space-y-3">
      {sourceNote ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{sourceNote}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">ধাপ যোগ করুন (টেনে ক্যানভাসে ছাড়ুন অথবা ক্লিক করুন):</span>
        {KNOWN_STEP_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            draggable
            onDragStart={(e) => { e.dataTransfer.setData("application/workflow-step", t); e.dataTransfer.effectAllowed = "move"; }}
            onClick={() => addStepAt(t, selectedStepIndex >= 0 ? selectedStepIndex : lastStepIndex)}
            className="rounded-full border bg-white px-3 py-1 text-xs font-medium hover:bg-slate-50"
            style={{ borderLeft: `4px solid ${STEP_TYPE_META[t].color}` }}
          >
            + {STEP_TYPE_META[t].label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button type="button" className="rounded-lg border px-3 py-1.5 text-xs" onClick={tidy}>সাজানো (Tidy)</button>
        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? "সংরক্ষণ হচ্ছে..." : "Workflow তৈরি করুন"}</button>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
      <div className="flex flex-col gap-3 xl:flex-row">
        <div
          className="relative h-130 flex-1 overflow-hidden rounded-xl border bg-slate-50"
          style={{ height: 540 }}
          ref={wrapperRef}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
          onDrop={(e) => {
            e.preventDefault();
            const type = e.dataTransfer.getData("application/workflow-step");
            if (!type) return;
            const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            addStepAt(type, selectedStepIndex >= 0 ? selectedStepIndex : lastStepIndex, position);
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId("")}
            onNodeDragStop={(_, __, dragged) => persistPositions(dragged as FlowNode[])}
            nodeTypes={nodeTypes}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="w-full shrink-0 space-y-3 rounded-xl border bg-white p-4 xl:w-96">
          {!selectedNode || selectedNode.data.kind === "trigger" ? (
            <div className="space-y-3">
              <div className="font-semibold">Workflow এর তথ্য (Trigger)</div>
              <label className="block text-sm">নাম<input className="input mt-1" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder="বড় Order এ ধন্যবাদ" /></label>
              <label className="block text-sm">Trigger
                <select className="input mt-1" value={meta.trigger} onChange={(e) => setMeta({ ...meta, trigger: e.target.value })}>
                  {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="block text-sm">শর্তের Field (ঐচ্ছিক)
                <select className="input mt-1" value={firstCondition?.field ?? ""} onChange={(e) => {
                  const field = e.target.value;
                  if (!field) setMeta({ ...meta, conditions: extraConditions });
                  else setMeta({ ...meta, conditions: [{ field, op: firstCondition?.op ?? "gte", value: firstCondition?.value ?? "" }, ...extraConditions] });
                }}>
                  <option value="">কোনো শর্ত নেই</option>
                  <option value="total">Order Total (টাকায়)</option>
                  <option value="stage">Lead Stage</option>
                  <option value="source">Source</option>
                  <option value="status">Order Status</option>
                  <option value="cartValue">কার্টের মোট মূল্য (টাকা)</option>
                  <option value="itemsCount">কার্টের আইটেম সংখ্যা</option>
                  <option value="intent">গ্রাহকের Intent (complaint/order)</option>
                  <option value="refundAmount">রিফান্ড পরিমাণ (টাকায়)</option>
                  <option value="shipmentStatus">পার্সেল স্ট্যাটাস</option>
                  <option value="scheduleTime">Schedule সময় (HH:MM)</option>
                </select>
              </label>
              {firstCondition ? <>
                <label className="block text-sm">Operator
                  <select className="input mt-1" value={firstCondition.op} onChange={(e) => setMeta({ ...meta, conditions: [{ ...firstCondition, op: e.target.value }, ...extraConditions] })}>
                    {OPS.map((op) => <option key={op} value={op}>{op}</option>)}
                  </select>
                </label>
                <label className="block text-sm">শর্তের মান<input className="input mt-1" value={firstCondition.value === undefined ? "" : String(firstCondition.value)} onChange={(e) => setMeta({ ...meta, conditions: [{ ...firstCondition, value: parseConditionValue(e.target.value) }, ...extraConditions] })} placeholder="1000 অথবা qualified" /></label>
              </> : null}
              {extraConditions.length > 0 ? (
                <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
                  আরও {extraConditions.length}টি শর্ত আছে — ক্যানভাস সেগুলো বদলায় না, যেমন আছে তেমনই সংরক্ষণ হবে: <code>{JSON.stringify(extraConditions)}</code>
                </p>
              ) : null}
              <p className="text-xs text-slate-400">কোনো ধাপ বেছে নিলে তার ফিল্ড এখানে বদলানো যাবে। ধাপের ক্রম বদলাতে ধাপ বেছে ↑ ↓ বোতাম ব্যবহার করুন, অথবা সংযোগ মুছে নতুন করে যুক্ত করুন।</p>
            </div>
          ) : selectedNode.data.kind === "stop" || selectedNode.data.kind === "end" ? (
            <div className="space-y-2">
              <div className="font-semibold">{selectedNode.data.label}</div>
              <p className="text-sm text-slate-500">এটি Engine-এর আচরণের ছবি মাত্র — আলাদা কোনো ধাপ নয়, সংরক্ষণেও যায় না। শর্ত না মিললে Workflow Run এখানেই শেষ হয়।</p>
            </div>
          ) : selectedNode.data.locked ? (
            <div className="space-y-2">
              <div className="font-semibold">অজানা ধাপ 🔒</div>
              <p className="text-sm text-slate-500">এই ধাপের ধরন (<code>{selectedNode.data.step?.type}</code>) ক্যানভাস চেনে না — সম্ভবত ভবিষ্যৎ বা অন্য টুলের তৈরি। এটি বদলানো যাবে না, তবে সংরক্ষণে **হুবহু যেমন আছে তেমনই** থেকে যাবে:</p>
              <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{JSON.stringify(selectedNode.data.step, null, 2)}</pre>
              <button type="button" className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600" onClick={deleteSelectedStep}>ধাপটি মুছুন</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="font-semibold">ধাপ সম্পাদনা</div>
              {draft ? (
                <StepFields draft={draft} onChange={setDraft} templates={templates} waTemplates={waTemplates} members={members} />
              ) : null}
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <button type="button" className="btn-primary btn-sm" onClick={applyPanel}>প্রয়োগ করুন</button>
                <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => moveSelected(-1)}>↑ উপরে</button>
                <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => moveSelected(1)}>↓ নিচে</button>
                <button type="button" className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600" onClick={deleteSelectedStep}>ধাপ মুছুন</button>
              </div>
              <p className="text-xs text-slate-400">ফর্ম এডিটরের একই ফিল্ড ও একই যাচাই ব্যবহৃত হচ্ছে। “প্রয়োগ করুন” শুধু ক্যানভাসে বদলায়; সার্ভারে যেতে উপরের “Workflow তৈরি করুন” চাপুন।</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkflowCanvas(props: {
  initialDefinition: WorkflowDefinition;
  scopeKey: string;
  templates: TemplateOption[];
  waTemplates: WaTemplateOption[];
  sourceNote?: string;
  onSaved: () => void | Promise<void>;
  workflowId?: string;
  members?: { userId: string; name: string; role: string }[];
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
