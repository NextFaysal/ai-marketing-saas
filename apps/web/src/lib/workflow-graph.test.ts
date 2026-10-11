import { describe, expect, it } from "vitest";
import {
  WorkflowDefinition,
  applyDraftToStep,
  buildPayloadStep,
  definitionToGraph,
  graphToDefinition,
  graphToDefinitionLenient,
  insertStep,
  parseConditionValue,
  removeStep,
  stepToDraft,
} from "./workflow-graph";

function roundTrip(def: WorkflowDefinition): WorkflowDefinition {
  return graphToDefinition(definitionToGraph(def));
}

const ALL_STEP_TYPES: WorkflowDefinition = {
  name: "সব ধরনের ধাপ",
  trigger: "order_created",
  conditions: [{ field: "total", op: "gte", value: 1000 }],
  steps: [
    { type: "send_email", templateId: "tmpl-email-1" },
    { type: "send_sms", templateId: "tmpl-sms-1" },
    { type: "wait", minutes: 120 },
    { type: "condition", field: "agentReplied", op: "eq", value: false },
    { type: "send_inbox_message", text: "আসসালামু আলাইকুম {{contactName}}" },
    { type: "send_inbox_message", whatsappTemplateId: "wa-1", templateParams: ["a", "b"] },
    { type: "add_conversation_note", text: "অগ্রাধিকার দিয়ে দেখুন" },
    { type: "add_lead_activity", text: "Workflow note" },
    { type: "add_lead_activity" },
  ],
};

describe("definition -> graph -> definition identity", () => {
  it("round-trips every engine step type", () => {
    expect(roundTrip(ALL_STEP_TYPES)).toEqual(ALL_STEP_TYPES);
  });

  it("round-trips a single-step workflow with no conditions", () => {
    const def: WorkflowDefinition = {
      name: "সহজ",
      trigger: "lead_created",
      steps: [{ type: "send_sms", templateId: "t1" }],
    };
    expect(roundTrip(def)).toEqual(def);
  });

  it("round-trips an unknown step type untouched (locked node)", () => {
    const def: WorkflowDefinition = {
      name: "ভবিষ্যতের ধাপ",
      trigger: "order_created",
      steps: [
        { type: "send_email", templateId: "t1" },
        { type: "future_ai_step", model: "x", config: { nested: [1, 2, { deep: true }] } },
        { type: "wait", minutes: 5 },
      ],
    };
    const out = roundTrip(def);
    expect(out).toEqual(def);
    expect(out.steps[1]).toEqual({ type: "future_ai_step", model: "x", config: { nested: [1, 2, { deep: true }] } });
  });

  it("preserves unknown EXTRA fields on known steps verbatim", () => {
    const def: WorkflowDefinition = {
      name: "অতিরিক্ত ফিল্ড",
      trigger: "inbox_message_received",
      steps: [
        { type: "send_inbox_message", text: "হ্যালো", templateParams: ["x"], futureFlag: true, meta: { a: 1 } },
        { type: "wait", minutes: 30, note: "engine ignores me" },
      ],
    };
    expect(roundTrip(def)).toEqual(def);
  });

  it("condition node exposes both arms; the NO arm is never written back", () => {
    const graph = definitionToGraph(ALL_STEP_TYPES);
    const condIdx = ALL_STEP_TYPES.steps.findIndex((s) => s.type === "condition");
    const noEdge = graph.edges.find((e) => e.kind === "no");
    const yesEdge = graph.edges.find((e) => e.source === `step-${condIdx}` && e.kind === "yes");
    expect(noEdge).toBeTruthy();
    expect(noEdge?.target).toBe(`stop-${condIdx}`);
    expect(yesEdge).toBeTruthy();
    // and the definition contains no trace of the synthetic stop node
    const out = graphToDefinition(graph);
    expect(JSON.stringify(out)).not.toContain("stop-");
    expect(out.steps).toHaveLength(ALL_STEP_TYPES.steps.length);
  });

  it("round-trips a trailing condition (yes arm goes to End)", () => {
    const def: WorkflowDefinition = {
      name: "শেষে শর্ত",
      trigger: "inbox_unanswered",
      conditions: [{ field: "unansweredMinutes", op: "gte", value: 120 }],
      steps: [
        { type: "add_conversation_note", text: "২ ঘণ্টা ধরে উত্তর হয়নি" },
        { type: "condition", field: "agentReplied", op: "eq", value: false },
      ],
    };
    expect(roundTrip(def)).toEqual(def);
  });

  it("round-trips multiple conditions (workflow-level) in order", () => {
    const def: WorkflowDefinition = {
      name: "একাধিক শর্ত",
      trigger: "inbox_message_received",
      steps: [
        { type: "condition", field: "intent", op: "eq", value: "complaint" },
        { type: "condition", field: "total", op: "gt", value: 500 },
        { type: "send_email", templateId: "t9" },
      ],
    };
    expect(roundTrip(def)).toEqual(def);
  });
});

describe("the three built-in presets (form editor shapes)", () => {
  const presets: WorkflowDefinition[] = [
    {
      name: "Recovery Follow-up",
      trigger: "inbox_message_received",
      steps: [
        { type: "wait", minutes: 60 },
        { type: "condition", field: "agentReplied", op: "eq", value: false },
        { type: "send_inbox_message", text: "আসসালামু আলাইকুম {{contactName}}, আপনার বার্তা আমরা পেয়েছি। কোনো সাহায্য লাগলে জানাবেন।" },
      ],
    },
    {
      name: "অভিযোগ সতর্কতা",
      trigger: "inbox_message_received",
      conditions: [{ field: "intent", op: "eq", value: "complaint" }],
      steps: [{ type: "add_conversation_note", text: "অভিযোগ এসেছে — অগ্রাধিকার দিয়ে দেখুন" }],
    },
    {
      name: "Unanswered Escalation",
      trigger: "inbox_unanswered",
      conditions: [{ field: "unansweredMinutes", op: "gte", value: 120 }],
      steps: [
        { type: "add_conversation_note", text: "২ ঘণ্টা ধরে উত্তর হয়নি" },
        { type: "wait", minutes: 1440 },
        { type: "condition", field: "agentReplied", op: "eq", value: false },
        { type: "send_inbox_message", text: "আসসালামু আলাইকুম {{contactName}}, আমরা আপনার বার্তাটি দেখেছি। এখনই সাহায্য করছি।" },
      ],
    },
  ];
  for (const preset of presets) {
    it(`round-trips preset "${preset.name}"`, () => {
      expect(roundTrip(preset)).toEqual(preset);
    });
  }
});

describe("graph structure validation", () => {
  it("rejects a disconnected fragment instead of dropping steps", () => {
    const graph = definitionToGraph(ALL_STEP_TYPES);
    // cut the chain after step 1
    graph.edges = graph.edges.filter((e) => !(e.source === "step-1" && e.target === "step-2"));
    expect(() => graphToDefinition(graph)).toThrow();
  });

  it("rejects a cycle", () => {
    const graph = definitionToGraph({
      name: "x",
      trigger: "order_created",
      steps: [
        { type: "wait", minutes: 1 },
        { type: "wait", minutes: 2 },
      ],
    });
    graph.edges = graph.edges.filter((e) => e.target !== "end");
    graph.edges.push({ id: "loop", source: "step-1", target: "step-0", kind: "next" });
    expect(() => graphToDefinition(graph)).toThrow();
  });

  it("follows a rewired chain order (reconnect = reorder)", () => {
    const def: WorkflowDefinition = {
      name: "ক্রম",
      trigger: "order_created",
      steps: [
        { type: "wait", minutes: 1 },
        { type: "wait", minutes: 2 },
        { type: "wait", minutes: 3 },
      ],
    };
    const graph = definitionToGraph(def);
    // rewire: trigger->step-2, step-2->step-0, step-0->step-1, step-1->end
    graph.edges = [
      { id: "a", source: "trigger", target: "step-2", kind: "next" },
      { id: "b", source: "step-2", target: "step-0", kind: "next" },
      { id: "c", source: "step-0", target: "step-1", kind: "next" },
      { id: "d", source: "step-1", target: "end", kind: "next" },
    ];
    const out = graphToDefinition(graph);
    expect(out.steps.map((s) => s.minutes)).toEqual([3, 1, 2]);
  });
});

describe("structural edits", () => {
  it("insertStep appends after the trigger and mid-chain", () => {
    const base = definitionToGraph({ name: "x", trigger: "order_created", steps: [{ type: "wait", minutes: 9 }] });
    const appended = insertStep(base, "send_sms", 0);
    expect(graphToDefinitionLenient(appended).steps.map((s) => s.type)).toEqual(["wait", "send_sms"]);
    const front = insertStep(base, "send_email", -1);
    expect(graphToDefinitionLenient(front).steps.map((s) => s.type)).toEqual(["send_email", "wait"]);
  });

  it("removeStep removes a condition together with its stop node", () => {
    const graph = definitionToGraph(ALL_STEP_TYPES);
    const condIdx = ALL_STEP_TYPES.steps.findIndex((s) => s.type === "condition");
    const after = removeStep(graph, condIdx);
    expect(after.nodes.some((n) => n.kind === "stop")).toBe(false);
    const out = graphToDefinition(after);
    expect(out.steps).toHaveLength(ALL_STEP_TYPES.steps.length - 1);
    expect(out.steps.some((s) => s.type === "condition")).toBe(false);
  });
});

describe("draft <-> raw step (shared form/canvas field logic)", () => {
  it("parseConditionValue matches the form editor exactly", () => {
    expect(parseConditionValue("true")).toBe(true);
    expect(parseConditionValue("false")).toBe(false);
    expect(parseConditionValue("120")).toBe(120);
    expect(parseConditionValue("complaint")).toBe("complaint");
    expect(parseConditionValue("")).toBe("");
  });

  it("buildPayloadStep reproduces the form's payload shapes", () => {
    expect(buildPayloadStep({ type: "wait", templateId: "", text: "", minutes: 45 })).toEqual({ type: "wait", minutes: 45 });
    expect(buildPayloadStep({ type: "condition", templateId: "", text: "", field: "agentReplied", op: "eq", value: "false" })).toEqual({ type: "condition", field: "agentReplied", op: "eq", value: false });
    expect(buildPayloadStep({ type: "send_inbox_message", templateId: "", text: "hi", whatsappTemplateId: "w1" })).toEqual({ type: "send_inbox_message", whatsappTemplateId: "w1" });
    expect(buildPayloadStep({ type: "add_lead_activity", templateId: "", text: "n" })).toEqual({ type: "add_lead_activity", text: "n" });
    expect(buildPayloadStep({ type: "send_email", templateId: "t1", text: "" })).toEqual({ type: "send_email", templateId: "t1" });
  });

  it("applying an UNEDITED draft returns the step unchanged, extra fields included", () => {
    const raw = { type: "send_inbox_message", text: "হ্যালো", templateParams: ["x"], futureFlag: true };
    expect(applyDraftToStep(raw, stepToDraft(raw))).toEqual(raw);
    const cond = { type: "condition", field: "agentReplied", op: "eq", value: false, extra: 1 };
    expect(applyDraftToStep(cond, stepToDraft(cond))).toEqual(cond);
    const wait = { type: "wait", minutes: 30, note: "keep me" };
    expect(applyDraftToStep(wait, stepToDraft(wait))).toEqual(wait);
  });

  it("editing one panel field changes only that field", () => {
    const raw = { type: "wait", minutes: 30, note: "keep me" };
    const draft = stepToDraft(raw);
    draft.minutes = 90;
    expect(applyDraftToStep(raw, draft)).toEqual({ type: "wait", minutes: 90, note: "keep me" });
  });

  it("switching send_inbox_message from text to a WhatsApp template drops text like the form does", () => {
    const raw = { type: "send_inbox_message", text: "হ্যালো" };
    const draft = stepToDraft(raw);
    draft.whatsappTemplateId = "wa-9";
    expect(applyDraftToStep(raw, draft)).toEqual({ type: "send_inbox_message", whatsappTemplateId: "wa-9" });
  });
});
