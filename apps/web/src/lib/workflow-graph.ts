/**
 * Workflow definition ⇄ node-graph mapping (Milestone 54).
 *
 * The workflow ENGINE (apps/api/src/workflows) stores a workflow as
 * { name, trigger, conditions?, steps: Step[] } where steps are a FLAT,
 * ordered array. Execution walks the array in order; a "condition"
 * step whose test fails STOPS the run (the remaining steps belong to
 * the taken branch only). There are no nested branches and no step ids.
 *
 * This module is the single source of truth for translating that
 * definition into an editable node graph and back, LOSSLESSLY:
 * - Every step object is carried through the graph VERBATIM (deep
 *   cloned). Unknown step types and unknown extra fields on known
 *   steps round-trip untouched; the canvas renders unknown steps as
 *   locked nodes holding their raw JSON.
 * - The graph is a single chain: trigger -> step -> step -> end.
 *   A condition node additionally shows a synthetic "stop" node on
 *   its NO arm - that node is pure presentation of the engine's
 *   stop-on-false semantics and is NEVER written back.
 * - graphToDefinition walks the chain edges; a graph that is not a
 *   single connected path (orphan fragment, cycle, missing link) is
 *   rejected with a structural error instead of silently dropping
 *   steps.
 *
 * Positions are NOT part of the definition. The engine would ignore
 * unknown fields inside a step at runtime, but writing UI data into
 * stored steps would contaminate every definition the canvas saves,
 * so positions live client-side (localStorage, keyed by workflow
 * scope + positional node id) - see workflow-canvas.tsx.
 */

import type { UiLocale } from "./i18n/dict";
import { interpolate } from "./i18n/lookup";
import { sharedBn, sharedEn } from "./i18n/shared";

/** MB2 F2: step labels, structural-error messages and step
 * summaries resolve through the `shared` namespace; locale
 * defaults to "bn" everywhere so existing callers/tests stay
 * byte-identical. */
const SD = (locale: UiLocale = "bn"): typeof sharedBn =>
  locale === "en" ? sharedEn : sharedBn;

export interface ConditionRule {
  field: string;
  op: string;
  value: unknown;
  [key: string]: unknown;
}

/** A workflow step exactly as stored: known shape or anything else. */
export type RawStep = { type: string; [key: string]: unknown };

export interface WorkflowDefinition {
  name: string;
  trigger: string;
  conditions?: ConditionRule[];
  steps: RawStep[];
}

export const KNOWN_STEP_TYPES = [
  "send_email",
  "send_sms",
  "add_lead_activity",
  "add_conversation_note",
  "wait",
  "condition",
  "send_inbox_message",
  // Workflows W3 actions.
  "assign_conversation",
  "change_lead_stage",
  "add_tag",
  "notify_team",
  "create_follow_up",
  "http_webhook",
  // Workflows W4.
  "branch",
  // Advanced actions: channels and AI.
  "notify_channel",
  "ai_generate",
] as const;

/** Step-type meta per locale: labels from the `shared`
 * namespace, colors locale-free. */
export function stepTypeMetaFor(locale: UiLocale = "bn"): Record<string, { label: string; color: string }> {
  const d = SD(locale);
  return {
    send_email: { label: d.stepSendEmail, color: "#2563eb" },
    send_sms: { label: d.stepSendSms, color: "#0891b2" },
    add_lead_activity: { label: d.stepAddLeadActivity, color: "#65a30d" },
    add_conversation_note: { label: d.stepAddConversationNote, color: "#65a30d" },
    wait: { label: d.stepWait, color: "#d97706" },
    condition: { label: d.stepCondition, color: "#9333ea" },
    send_inbox_message: { label: d.stepSendInboxMessage, color: "#db2777" },
    assign_conversation: { label: d.stepAssignConversation, color: "#0f766e" },
    change_lead_stage: { label: d.stepChangeLeadStage, color: "#7c3aed" },
    add_tag: { label: d.stepAddTag, color: "#b45309" },
    notify_team: { label: d.stepNotifyTeam, color: "#be185d" },
    create_follow_up: { label: d.stepCreateFollowUp, color: "#15803d" },
    http_webhook: { label: d.stepHttpWebhook, color: "#334155" },
    branch: { label: d.stepBranch, color: "#9333ea" },
    notify_channel: { label: d.stepNotifyChannel, color: "#0284c7" },
    ai_generate: { label: d.stepAiGenerate, color: "#6366f1" },
    unknown: { label: d.stepUnknown, color: "#64748b" },
  };
}

/** The bn meta record stays the pinned default export shape. */
export const STEP_TYPE_META: Record<string, { label: string; color: string }> = stepTypeMetaFor("bn");

export function isKnownStepType(type: string): boolean {
  return (KNOWN_STEP_TYPES as readonly string[]).includes(type);
}

/** Default raw step for a palette drop - mirrors the form editor. */
export function defaultStep(type: string): RawStep {
  switch (type) {
    case "wait":
      return { type, minutes: 60 };
    case "condition":
      return { type, field: "", op: "eq", value: "" };
    case "branch":
      return { type, field: "", op: "eq", value: "", then: [{ type: "send_inbox_message", text: "" }], else: [] };
    case "send_email":
    case "send_sms":
      return { type, templateId: "" };
    case "send_inbox_message":
      return { type, text: "" };
    case "add_lead_activity":
    case "add_conversation_note":
      return { type, text: "" };
    case "notify_channel":
      return { type, url: "", text: "", title: "" };
    case "ai_generate":
      return { type, prompt: "", action: "add_conversation_note", outputField: "aiResult" };
    default:
      return { type };
  }
}

// ---------- Graph model (framework-free; the canvas adapts these) ----------

export type GraphNodeKind = "trigger" | "step" | "stop" | "end";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  /** index into definition.steps for kind==="step", else -1 */
  stepIndex: number;
  /** step nodes: the verbatim step object. trigger node: unused. */
  step?: RawStep;
  position: { x: number; y: number };
}

export type GraphEdgeKind = "next" | "yes" | "no";

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
}

export interface WorkflowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** carried on the trigger node conceptually; kept top-level so the
   *  graph model stays a plain data structure */
  name: string;
  trigger: string;
  conditions: ConditionRule[];
}

export const TRIGGER_NODE_ID = "trigger";
export const END_NODE_ID = "end";
export const stopNodeId = (stepIndex: number) => `stop-${stepIndex}`;
export const stepNodeId = (stepIndex: number) => `step-${stepIndex}`;

const CHAIN_X = 260;
const ROW_Y = 130;
const STOP_DX = 300;

function deepClone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

/** Deterministic tidy layout: vertical chain, stop nodes to the side. */
export function autoLayout(def: WorkflowDefinition): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  pos[TRIGGER_NODE_ID] = { x: CHAIN_X, y: 0 };
  def.steps.forEach((step, i) => {
    pos[stepNodeId(i)] = { x: CHAIN_X, y: (i + 1) * ROW_Y };
    if (step.type === "condition") {
      pos[stopNodeId(i)] = { x: CHAIN_X + STOP_DX, y: (i + 1) * ROW_Y };
    }
  });
  pos[END_NODE_ID] = { x: CHAIN_X, y: (def.steps.length + 1) * ROW_Y };
  return pos;
}

export function definitionToGraph(
  def: WorkflowDefinition,
  positions?: Record<string, { x: number; y: number }>,
): WorkflowGraph {
  const layout = { ...autoLayout(def), ...(positions ?? {}) };
  const nodes: GraphNode[] = [
    { id: TRIGGER_NODE_ID, kind: "trigger", stepIndex: -1, position: layout[TRIGGER_NODE_ID] },
  ];
  const edges: GraphEdge[] = [];
  let prev = TRIGGER_NODE_ID;
  def.steps.forEach((step, i) => {
    const id = stepNodeId(i);
    nodes.push({ id, kind: "step", stepIndex: i, step: deepClone(step), position: layout[id] });
    const prevStep = i > 0 ? def.steps[i - 1] : null;
    edges.push({
      id: `e-${prev}-${id}`,
      source: prev,
      target: id,
      // an edge OUT of a condition on the main chain is its YES arm
      kind: prevStep?.type === "condition" ? "yes" : "next",
    });
    if (step.type === "condition") {
      const sid = stopNodeId(i);
      nodes.push({ id: sid, kind: "stop", stepIndex: i, position: layout[sid] });
      edges.push({ id: `e-${id}-${sid}`, source: id, target: sid, kind: "no" });
    }
    prev = id;
  });
  nodes.push({ id: END_NODE_ID, kind: "end", stepIndex: -1, position: layout[END_NODE_ID] });
  const lastStep = def.steps[def.steps.length - 1];
  edges.push({
    id: `e-${prev}-${END_NODE_ID}`,
    source: prev,
    target: END_NODE_ID,
    kind: lastStep?.type === "condition" ? "yes" : "next",
  });
  return {
    nodes,
    edges,
    name: def.name,
    trigger: def.trigger,
    conditions: deepClone(def.conditions ?? []),
  };
}

export class GraphStructureError extends Error {}

/**
 * Walk the main chain (next/yes edges) from the trigger and rebuild
 * the definition. Synthetic stop/end nodes terminate the walk and are
 * not written back. Throws GraphStructureError when the graph is not
 * one connected path covering every step node exactly once.
 */
export function graphToDefinition(graph: WorkflowGraph, locale: UiLocale = "bn"): WorkflowDefinition {
  const d = SD(locale);
  const stepNodes = graph.nodes.filter((n) => n.kind === "step");
  const mainEdge = new Map<string, GraphEdge>();
  for (const e of graph.edges) {
    if (e.kind === "no") continue; // presentation only
    if (mainEdge.has(e.source)) {
      throw new GraphStructureError(interpolate(d.graphErrMultiplePaths, { source: e.source }));
    }
    mainEdge.set(e.source, e);
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const ordered: RawStep[] = [];
  const seen = new Set<string>();
  let cursor: string = TRIGGER_NODE_ID;
  for (;;) {
    const edge = mainEdge.get(cursor);
    if (!edge) {
      throw new GraphStructureError(d.graphErrNotConnectedToEnd);
    }
    const target = byId.get(edge.target);
    if (!target) throw new GraphStructureError(interpolate(d.graphErrUnknownTarget, { target: edge.target }));
    if (target.kind === "end") break;
    if (target.kind !== "step") throw new GraphStructureError(d.graphErrWrongTarget);
    if (seen.has(target.id)) throw new GraphStructureError(d.graphErrCycle);
    seen.add(target.id);
    ordered.push(deepClone(target.step as RawStep));
    cursor = target.id;
  }
  if (seen.size !== stepNodes.length) {
    throw new GraphStructureError(d.graphErrOrphanSteps);
  }
  const def: WorkflowDefinition = {
    name: graph.name,
    trigger: graph.trigger,
    steps: ordered,
  };
  if (graph.conditions.length > 0) def.conditions = deepClone(graph.conditions);
  return def;
}

// ---------- Structural edits used by the canvas (pure, immutable) ----------

/** Insert a step node after `afterStepIndex` (-1 = right after trigger). */
export function insertStep(graph: WorkflowGraph, type: string, afterStepIndex: number): WorkflowGraph {
  const def = graphToDefinitionLenient(graph);
  const idx = Math.max(0, Math.min(afterStepIndex + 1, def.steps.length));
  def.steps.splice(idx, 0, defaultStep(type));
  return definitionToGraph(def, graphPositions(graph));
}

/** Remove the step at `stepIndex`. Stop nodes/edges are derived, so
 *  removing a condition removes its stop node automatically. */
export function removeStep(graph: WorkflowGraph, stepIndex: number): WorkflowGraph {
  const def = graphToDefinitionLenient(graph);
  def.steps.splice(stepIndex, 1);
  return definitionToGraph(def, graphPositions(graph));
}

/** Replace the step at `stepIndex` (panel edits write through here). */
export function replaceStep(graph: WorkflowGraph, stepIndex: number, step: RawStep): WorkflowGraph {
  const next: WorkflowGraph = {
    ...graph,
    conditions: deepClone(graph.conditions),
    nodes: graph.nodes.map((n) =>
      n.stepIndex === stepIndex && n.kind === "step" ? { ...n, step: deepClone(step) } : n,
    ),
  };
  return next;
}

function graphPositions(graph: WorkflowGraph): Record<string, { x: number; y: number }> {
  // Positions are SLOT-based: node ids are step-<index>, and a slot
  // keeps its canvas position across structural edits (the step shown
  // in a slot may change after a mid-chain insert/delete). The Tidy
  // button re-runs auto-layout when the result looks off.
  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of graph.nodes) pos[n.id] = n.position;
  return pos;
}

/** graphToDefinition for edits: the canvas keeps graphs valid by
 *  construction during add/remove, but if a user has disconnected an
 *  edge we still need the step list - fall back to node order. */
export function graphToDefinitionLenient(graph: WorkflowGraph, locale: UiLocale = "bn"): WorkflowDefinition {
  try {
    return graphToDefinition(graph, locale);
  } catch {
    const steps = graph.nodes
      .filter((n) => n.kind === "step")
      .sort((a, b) => a.stepIndex - b.stepIndex)
      .map((n) => deepClone(n.step as RawStep));
    const def: WorkflowDefinition = { name: graph.name, trigger: graph.trigger, steps };
    if (graph.conditions.length > 0) def.conditions = deepClone(graph.conditions);
    return def;
  }
}

// ---------- Shared with the form editor (single validation/build path) ----------

/** The form editor's value parser: "true"/"false" -> boolean, numeric -> number. */
export function parseConditionValue(v?: string): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v !== undefined && v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

export interface StepDraftLike {
  type: string;
  templateId: string;
  text: string;
  minutes?: number;
  field?: string;
  op?: string;
  value?: string;
  whatsappTemplateId?: string;
  // Workflows W3 action fields.
  userId?: string;
  clear?: boolean;
  stage?: string;
  tag?: string;
  target?: string;
  role?: string;
  title?: string;
  days?: number;
  url?: string;
  secret?: string;
  // Advanced actions (channel webhook & AI).
  channelName?: string;
  prompt?: string;
  outputField?: string;
  action?: string;
  // Workflows W4: branch arms (drafts; built recursively).
  then?: StepDraftLike[];
  else?: StepDraftLike[];
}

/** Build the API step payload from a form/canvas draft. This is the
 *  exact builder the form editor has always used - the canvas panel
 *  produces drafts through `stepToDraft` and saves through here too,
 *  so there is one field->payload logic, not two. */
export function buildPayloadStep(s: StepDraftLike): RawStep {
  if (s.type === "add_lead_activity" || s.type === "add_conversation_note") return { type: s.type, text: s.text || undefined };
  if (s.type === "wait") return { type: s.type, minutes: Number(s.minutes) || 60 };
  if (s.type === "condition") return { type: s.type, field: s.field || "", op: s.op || "eq", value: parseConditionValue(s.value) };
  if (s.type === "send_inbox_message") return s.whatsappTemplateId ? { type: s.type, whatsappTemplateId: s.whatsappTemplateId } : { type: s.type, text: s.text || undefined };
  // Workflows W3 actions.
  if (s.type === "assign_conversation") return s.clear ? { type: s.type, clear: true } : { type: s.type, userId: s.userId || undefined };
  if (s.type === "change_lead_stage") return { type: s.type, stage: s.stage || "contacted" };
  if (s.type === "add_tag") return { type: s.type, tag: s.tag || "", target: s.target || "lead" };
  if (s.type === "notify_team") return { type: s.type, text: s.text || "", title: s.title || undefined, role: s.role || undefined, userId: s.userId || undefined };
  if (s.type === "create_follow_up") return { type: s.type, days: Number(s.days) || 3, text: s.text || undefined };
  if (s.type === "http_webhook") return { type: s.type, url: s.url || "", secret: s.secret || undefined };
  if (s.type === "notify_channel") return { type: s.type, url: s.url || "", text: s.text || "", title: s.title || undefined, channelName: s.channelName || undefined };
  if (s.type === "ai_generate") return { type: s.type, prompt: s.prompt || "", action: s.action || "add_conversation_note", outputField: s.outputField || "aiResult" };
  if (s.type === "branch") return {
    type: s.type, field: s.field || "", op: s.op || "eq", value: parseConditionValue(s.value),
    then: (s.then ?? []).map(buildPayloadStep), else: (s.else ?? []).map(buildPayloadStep),
  };
  return { type: s.type, templateId: s.templateId };
}

/** Convert a stored raw step into the editable draft shape. Only the
 *  panel-controlled keys are projected; `applyDraftToStep` merges the
 *  draft back over the raw step so untouched extra fields survive. */
export function stepToDraft(step: RawStep): StepDraftLike {
  return {
    type: step.type,
    templateId: typeof step.templateId === "string" ? step.templateId : "",
    text: typeof step.text === "string" ? step.text : "",
    minutes: typeof step.minutes === "number" ? step.minutes : 60,
    field: typeof step.field === "string" ? step.field : "",
    op: typeof step.op === "string" ? step.op : "eq",
    value: step.value === undefined || step.value === null ? "" : String(step.value),
    whatsappTemplateId: typeof step.whatsappTemplateId === "string" ? step.whatsappTemplateId : "",
    userId: typeof step.userId === "string" ? step.userId : "",
    clear: step.clear === true,
    stage: typeof step.stage === "string" ? step.stage : "contacted",
    tag: typeof step.tag === "string" ? step.tag : "",
    target: typeof step.target === "string" ? step.target : "lead",
    role: typeof step.role === "string" ? step.role : "",
    title: typeof step.title === "string" ? step.title : "",
    days: typeof step.days === "number" ? step.days : 3,
    url: typeof step.url === "string" ? step.url : "",
    secret: typeof step.secret === "string" ? step.secret : "",
    channelName: typeof step.channelName === "string" ? step.channelName : "",
    prompt: typeof step.prompt === "string" ? step.prompt : "",
    outputField: typeof step.outputField === "string" ? step.outputField : "aiResult",
    action: typeof step.action === "string" ? step.action : "add_conversation_note",
    then: Array.isArray(step.then) ? (step.then as RawStep[]).map((x) => stepToDraft(x)) : [],
    else: Array.isArray(step.else) ? (step.else as RawStep[]).map((x) => stepToDraft(x)) : [],
  };
}

const PANEL_KEYS: (keyof StepDraftLike)[] = [
  "templateId", "text", "minutes", "field", "op", "value", "whatsappTemplateId",
  "userId", "clear", "stage", "tag", "target", "role", "title", "days", "url", "secret",
  "channelName", "prompt", "outputField", "action", "then", "else"
];

/**
 * Merge a panel draft back into the raw step. The payload builder
 * decides the canonical fields for the type; fields the builder does
 * not emit for this type are REMOVED from the panel-controlled set
 * (matching what the form would save), while every other key on the
 * raw step (e.g. templateParams, future engine fields) is preserved
 * verbatim.
 */
export function applyDraftToStep(raw: RawStep, draft: StepDraftLike): RawStep {
  const built = buildPayloadStep(draft);
  const next: RawStep = { ...deepClone(raw), type: draft.type };
  for (const key of PANEL_KEYS) {
    if (key in built) {
      if (built[key] !== undefined) (next as Record<string, unknown>)[key] = built[key];
      else delete (next as Record<string, unknown>)[key];
    } else {
      delete (next as Record<string, unknown>)[key];
    }
  }
  return next;
}

/** One-line summary of a step for node display, in the UI
 * locale (bn default — byte-identical to the original). */
export function stepSummary(step: RawStep, locale: UiLocale = "bn"): string {
  const d = SD(locale);
  switch (step.type) {
    case "wait":
      return interpolate(d.wgWaitSummary, { minutes: String(step.minutes ?? "?") });
    case "condition":
      return `${String(step.field ?? "?")} ${String(step.op ?? "eq")} ${JSON.stringify(step.value ?? "")}`;
    case "send_email":
    case "send_sms":
      return step.templateId ? d.wgTemplateSet : d.wgTemplateNotSet;
    case "send_inbox_message":
      if (step.whatsappTemplateId) return "WhatsApp Template";
      return typeof step.text === "string" && step.text ? step.text.slice(0, 42) : d.wgMessageEmpty;
    case "add_lead_activity":
    case "add_conversation_note":
      return typeof step.text === "string" && step.text ? step.text.slice(0, 42) : d.wgNoteEmpty;
    case "branch": {
      const t = Array.isArray(step.then) ? step.then.length : 0;
      const e = Array.isArray(step.else) ? step.else.length : 0;
      const cond = `${String(step.field ?? "?")} ${String(step.op ?? "eq")} ${JSON.stringify(step.value ?? "")}`;
      return interpolate(d.wgBranchSummary, { cond, thenCount: t, elseCount: e });
    }
    case "notify_channel":
      return typeof step.text === "string" && step.text
        ? interpolate(d.wgChannelAlertText, { text: step.text.slice(0, 30) })
        : d.wgChannelAlert;
    case "ai_generate":
      return typeof step.prompt === "string" && step.prompt ? `AI: ${step.prompt.slice(0, 30)}` : d.wgAiStep;
    default:
      return d.wgLockedStep;
  }
}
