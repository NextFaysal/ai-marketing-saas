"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import dynamic from "next/dynamic";
import { StepFields, dynamicVariablesForLocale } from "@/components/step-fields";

const WorkflowCanvas = dynamic(() => import("@/components/workflow-canvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center bg-slate-50 text-xs text-slate-500">
      Loading visual workflow editor...
    </div>
  ),
});
const WorkflowPresetsTab = dynamic(() => import("./WorkflowPresetsTab"), {
  ssr: false,
  loading: () => (
    <div className="card p-12 text-center text-sm text-slate-500">
      রেডিমেড বিজনেস সল্যুশন গ্যালারি লোড হচ্ছে...
    </div>
  ),
});
import {
  buildPayloadStep,
  parseConditionValue,
  stepToDraft,
  type RawStep,
  type StepDraftLike,
  type WorkflowDefinition,
} from "@/lib/workflow-graph";
import { WORKFLOW_BLUEPRINTS_CATALOG, bpText, type WorkflowBlueprint } from "@/lib/workflow-blueprints";
import { useLocale } from "@/lib/i18n/provider";
import { workflowsBn, workflowsEn } from "@/lib/i18n/workflows";
import { sharedBn, sharedEn } from "@/lib/i18n/shared";
import { fmtNumber, fmtDate } from "@repo/contracts";
import type { UiLocale } from "@repo/contracts";

const WD = (locale?: string) => (locale === "en" ? workflowsEn : workflowsBn);
type WfKey = keyof typeof workflowsBn;
const wt = (locale: string | undefined, key: WfKey, params?: Record<string, string | number>): string => {
  let out: string = WD(locale)[key];
  if (params) for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v));
  return out;
};
const TRIG_LABEL_KEY: Record<string, WfKey> = {
  order_created: "trigOrderCreated", order_delivered: "trigOrderDelivered", order_cod_confirmed: "trigCodConfirmed",
  order_status_changed: "trigOrderStatus", order_refunded: "trigOrderRefunded", cart_abandoned: "trigCartAbandoned",
  shipment_status_changed: "trigShipmentStatus", shipment_delivered: "trigShipmentDelivered", shipment_returned: "trigShipmentReturned",
  lead_created: "trigLeadCreated", lead_stage_changed: "trigLeadStage", inbox_message_received: "trigInboxMessage",
  inbox_unanswered: "trigInboxUnanswered", conversation_assigned: "trigConvAssigned", conversation_closed: "trigConvClosed",
  schedule: "trigSchedule",
};
const TRIG_CAT_KEY: Record<string, WfKey> = { "ই-কমার্স": "catEcommerce", "শিপমেন্ট": "catShipment", "ইনবক্স": "catInbox", "শিডিউল": "catSchedule" };
function triggersFor(locale: string): typeof TRIGGERS {
  return TRIGGERS.map((tr) => ({
    ...tr,
    label: TRIG_LABEL_KEY[tr.value] ? wt(locale, TRIG_LABEL_KEY[tr.value]) : tr.label,
    category: TRIG_CAT_KEY[tr.category] ? wt(locale, TRIG_CAT_KEY[tr.category]) : tr.category,
  }));
}
const FIELD_LABEL_KEY: Record<string, WfKey> = {
  "": "fieldPick", stage: "fieldLeadStage", status: "fieldOrderStatus", total: "fieldOrderTotal", source: "fieldSource", fromStatus: "fieldPrevStatus", toStatus: "fieldNewStatus",
  refundAmount: "fieldRefundAmount", cumulativeRefunded: "fieldTotalRefund", shipmentStatus: "fieldParcelNewStatus",
  previousStatus: "fieldParcelPrevStatus", cartValue: "fieldCartTotal", itemsCount: "fieldCartItems",
  scheduleTime: "fieldScheduleTime", scheduleDays: "fieldScheduleDay", intent: "fieldIntent",
  contactName: "fieldContactName", contactPhone: "fieldContactPhone",
};
function conditionFieldsFor(locale: string): typeof CONDITION_FIELDS {
  return CONDITION_FIELDS.map((f) => (FIELD_LABEL_KEY[f.value] ? { ...f, label: wt(locale, FIELD_LABEL_KEY[f.value]) } : f));
}
const OP_LABEL_KEY: Record<string, WfKey> = { gte: "opGte", gt: "opGt", eq: "opEq", neq: "opNeq", lt: "opLt", lte: "opLte", contains: "opContains" };
function conditionOperatorsFor(locale: string): typeof CONDITION_OPERATORS {
  return CONDITION_OPERATORS.map((o) => (OP_LABEL_KEY[o.value] ? { ...o, label: wt(locale, OP_LABEL_KEY[o.value]) } : o));
}
const SUGGESTION_LABEL_KEY: Record<string, WfKey> = {
  "অর্ডার ৳১,০০০+": "qcOrder1000", "ভিআইপি অর্ডার ৳৫,০০০+": "qcVipOrder", "ওয়েবসাইট অর্ডার": "qcWebsiteOrder",
  "কার্ট ভ্যালু ৳৫০০+": "qcCart500", "পণ্য সংখ্যা ২ বা বেশি": "qcItems2", "অভিযোগ (complaint)": "qcComplaint",
  "ক্রয় অনুসন্ধান (order)": "qcOrderIntent", "Facebook লিড": "qcFbLead", "Website লিড": "qcWebLead",
  "Qualified স্টেজ": "qcQualified", "Won (সফল) স্টেজ": "qcWon", "Lost (ব্যর্থ) স্টেজ": "qcLost",
  "নতুন স্টেজ Processing": "qcProcessing", "নতুন স্টেজ Cancelled": "qcCancelled", "রিফান্ড ৳৫০০ বা বেশি": "qcRefund500",
  "রিটার্ন কনফার্মড": "qcReturnConfirmed",
};
function suggestionsFor(locale: string, trigger: string) {
  const list = TRIGGER_SUGGESTIONS[trigger] ?? [];
  return list.map((sg) => (SUGGESTION_LABEL_KEY[sg.label] ? { ...sg, label: wt(locale, SUGGESTION_LABEL_KEY[sg.label]) } : sg));
}
const STEP_LABEL_KEY: Record<string, keyof typeof sharedBn> = {
  send_email: "stepSendEmail", send_sms: "stepSendSms", send_inbox_message: "stepSendInboxMessage", wait: "stepWait",
  condition: "stepCondition", branch: "stepBranch", change_lead_stage: "stepChangeLeadStage", add_tag: "stepAddTag",
  notify_team: "stepNotifyTeam", notify_channel: "stepNotifyChannel", ai_generate: "stepAiGenerate",
  add_lead_activity: "stepAddLeadActivity", add_conversation_note: "stepAddConversationNote",
  assign_conversation: "stepAssignConversation", create_follow_up: "stepCreateFollowUp", http_webhook: "stepHttpWebhook",
};

interface Template {
  id: string;
  name: string;
  channel: string;
}
type StepDraft = StepDraftLike;
interface Workflow {
  id: string;
  name: string;
  trigger: string;
  conditions?: { field: string; op: string; value: unknown }[] | null;
  steps: { type: string; templateId?: string; text?: string; [key: string]: unknown }[];
  enabled: boolean;
  cooldownMinutes?: number;
  dailyRunCap?: number | null;
}
interface Run {
  id: string;
  trigger: string;
  status: string;
  stepsLog?: { step: string; status: string; detail: string }[] | null;
  error?: string | null;
  createdAt: string;
}

interface ConditionDraft {
  field: string;
  op: string;
  value: string;
}

type TabKey = "workflows" | "builder" | "presets" | "runs";

const TRIGGERS = [
  { value: "order_created", label: "নতুন Order তৈরি হলে", icon: "🛒", category: "ই-কমার্স" },
  { value: "order_delivered", label: "Order ডেলিভারি হলে", icon: "📦", category: "ই-কমার্স" },
  { value: "order_cod_confirmed", label: "COD Order কনফার্ম হলে", icon: "💵", category: "ই-কমার্স" },
  { value: "order_status_changed", label: "Order এর Status বদলালে", icon: "🔄", category: "ই-কমার্স" },
  { value: "order_refunded", label: "Order Refund হলে", icon: "💸", category: "ই-কমার্স" },
  { value: "cart_abandoned", label: "কার্ট ফেলে রেখে গেলে (Cart Abandoned)", icon: "🛒", category: "ই-কমার্স" },
  { value: "shipment_status_changed", label: "পার্সেলের Status বদলালে", icon: "🚚", category: "শিপমেন্ট" },
  { value: "shipment_delivered", label: "পার্সেল ডেলিভারি হলে", icon: "✅", category: "শিপমেন্ট" },
  { value: "shipment_returned", label: "পার্সেল রিটার্ন হলে", icon: "↩️", category: "শিপমেন্ট" },
  { value: "lead_created", label: "নতুন Lead তৈরি হলে", icon: "👤", category: "CRM" },
  { value: "lead_stage_changed", label: "Lead এর Stage বদলালে", icon: "📈", category: "CRM" },
  { value: "inbox_message_received", label: "Inbox এ নতুন বার্তা এলে", icon: "💬", category: "ইনবক্স" },
  { value: "inbox_unanswered", label: "Inbox বার্তার উত্তর না হলে (সময়ভিত্তিক)", icon: "⏳", category: "ইনবক্স" },
  { value: "conversation_assigned", label: "কথোপকথন Assign হলে", icon: "👥", category: "ইনবক্স" },
  { value: "conversation_closed", label: "কথোপকথন বন্ধ হলে", icon: "🔒", category: "ইনবক্স" },
  { value: "schedule", label: "প্রতিদিন নির্দিষ্ট সময়ে (Schedule)", icon: "⏰", category: "শিডিউল" },
];

const CONDITION_FIELDS = [
  { value: "", label: "ফিল্ড বেছে নিন" },
  { value: "total", label: "Order Total (টাকায়)" },
  { value: "stage", label: "Lead Stage (new/contacted/qualified/won/lost)" },
  { value: "source", label: "Source (ওয়েবসাইট/ফেসবুক/ইত্যাদি)" },
  { value: "status", label: "Order Status" },
  { value: "fromStatus", label: "আগের Status (Order Status Changed)" },
  { value: "toStatus", label: "নতুন Status (Order Status Changed)" },
  { value: "refundAmount", label: "Refund পরিমাণ, টাকায়" },
  { value: "cumulativeRefunded", label: "মোট Refund, টাকায়" },
  { value: "shipmentStatus", label: "পার্সেলের নতুন Status" },
  { value: "previousStatus", label: "পার্সেলের আগের Status" },
  { value: "cartValue", label: "কার্টের মোট মূল্য (টাকা)" },
  { value: "itemsCount", label: "কার্টের আইটেম সংখ্যা" },
  { value: "scheduleTime", label: "Schedule সময় (HH:MM)" },
  { value: "scheduleDays", label: "Schedule দিন (0=রবি..6=শনি)" },
  { value: "intent", label: "গ্রাহকের Intent (complaint/order/info)" },
  { value: "contactName", label: "গ্রাহকের নাম" },
  { value: "contactPhone", label: "গ্রাহকের ফোন নম্বর" },
];

const CONDITION_OPERATORS = [
  { value: "gte", label: "কমপক্ষে (>=)" },
  { value: "gt", label: "বেশি (>)" },
  { value: "eq", label: "সমান (==)" },
  { value: "neq", label: "সমান নয় (!=)" },
  { value: "lt", label: "কম (<)" },
  { value: "lte", label: "সর্বোচ্চ (<=)" },
  { value: "contains", label: "রয়েছে (contains)" },
];

// Smart suggested conditions based on selected trigger
const TRIGGER_SUGGESTIONS: Record<string, { label: string; field: string; op: string; value: string }[]> = {
  order_created: [
    { label: "অর্ডার ৳১,০০০+", field: "total", op: "gte", value: "1000" },
    { label: "ভিআইপি অর্ডার ৳৫,০০০+", field: "total", op: "gte", value: "5000" },
    { label: "ওয়েবসাইট অর্ডার", field: "source", op: "eq", value: "website" },
  ],
  cart_abandoned: [
    { label: "কার্ট ভ্যালু ৳৫০০+", field: "cartValue", op: "gte", value: "500" },
    { label: "পণ্য সংখ্যা ২ বা বেশি", field: "itemsCount", op: "gte", value: "2" },
  ],
  inbox_message_received: [
    { label: "অভিযোগ (complaint)", field: "intent", op: "eq", value: "complaint" },
    { label: "ক্রয় অনুসন্ধান (order)", field: "intent", op: "eq", value: "order" },
  ],
  lead_created: [
    { label: "Facebook লিড", field: "source", op: "eq", value: "facebook" },
    { label: "Website লিড", field: "source", op: "eq", value: "website" },
  ],
  lead_stage_changed: [
    { label: "Qualified স্টেজ", field: "stage", op: "eq", value: "qualified" },
    { label: "Won (সফল) স্টেজ", field: "stage", op: "eq", value: "won" },
    { label: "Lost (ব্যর্থ) স্টেজ", field: "stage", op: "eq", value: "lost" },
  ],
  order_status_changed: [
    { label: "নতুন স্টেজ Processing", field: "toStatus", op: "eq", value: "processing" },
    { label: "নতুন স্টেজ Cancelled", field: "toStatus", op: "eq", value: "cancelled" },
  ],
  order_refunded: [
    { label: "রিফান্ড ৳৫০০ বা বেশি", field: "refundAmount", op: "gte", value: "500" },
  ],
  shipment_returned: [
    { label: "রিটার্ন কনফার্মড", field: "shipmentStatus", op: "eq", value: "returned" },
  ],
};

// 105+ Rich business blueprints catalog for any merchant problem
const BUSINESS_BLUEPRINTS = WORKFLOW_BLUEPRINTS_CATALOG;

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

export default function WorkflowsPage() {
  const { t, locale } = useLocale();
  const TRIGGERS_L = triggersFor(locale);
  const [activeTab, setActiveTab] = useState<TabKey>("workflows");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState({ name: "", trigger: "order_created", cooldown: "", cap: "" });
  const [formConditions, setFormConditions] = useState<ConditionDraft[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [presets, setPresets] = useState<{ key: string; name: string; descriptionBn: string }[]>([]);
  const [steps, setSteps] = useState<StepDraft[]>([{ type: "send_email", templateId: "", text: "" }]);
  const [waTemplates, setWaTemplates] = useState<{ id: string; name: string; language: string }[]>([]);
  const [members, setMembers] = useState<{ userId: string; name: string; role: string }[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [editorView, setEditorView] = useState<"form" | "canvas">("form");
  const [canvasDef, setCanvasDef] = useState<WorkflowDefinition>({
    name: "",
    trigger: "order_created",
    steps: [{ type: "send_email", templateId: "" }],
  });
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [canvasScope, setCanvasScope] = useState("new");
  const [canvasNote, setCanvasNote] = useState("");
  const [canvasWorkflowId, setCanvasWorkflowId] = useState<string | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [stats, setStats] = useState<{ workflowId: string; runs30d: number; successRate: number | null; lastRunAt: string | null }[]>([]);
  const [runFilter, setRunFilter] = useState({ workflowId: "", status: "" });
  const [testPanel, setTestPanel] = useState<{ workflowId: string; name: string } | null>(null);
  const [testCtx, setTestCtx] = useState({ leadId: "", customerId: "", conversationId: "", orderId: "" });
  const [trace, setTrace] = useState<{ conditionsPassed: boolean; trace: { step: string; detail: string; branch?: string }[] } | null>(null);
  const [isDryRunning, setIsDryRunning] = useState(false);
  const [isManualRunning, setIsManualRunning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTrigger, setFilterTrigger] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const runQuery = new URLSearchParams();
      if (runFilter.workflowId) runQuery.set("workflowId", runFilter.workflowId);
      if (runFilter.status) runQuery.set("status", runFilter.status);
      const [w, r, t] = await Promise.all([
        apiFetch<Workflow[]>(`/organizations/${orgId}/workflows`),
        apiFetch<Run[]>(`/organizations/${orgId}/workflows/runs${runQuery.toString() ? `?${runQuery}` : ""}`),
        apiFetch<Template[]>(`/organizations/${orgId}/messaging/templates`),
      ]);
      apiFetch<{ workflowId: string; runs30d: number; successRate: number | null; lastRunAt: string | null }[]>(
        `/organizations/${orgId}/workflows/stats`
      )
        .then(setStats)
        .catch(() => undefined);
      setWorkflows(w);
      setRuns(r);
      setTemplates(t);
      apiFetch<{ id: string; name: string; language: string }[]>(`/organizations/${orgId}/inbox/whatsapp-templates`)
        .then(setWaTemplates)
        .catch(() => undefined);
      apiFetch<any[]>(`/organizations/${orgId}/members`)
        .then((rows) =>
          setMembers(
            rows
              .filter((m) => m.status === "ACTIVE")
              .map((m) => ({ userId: m.userId, name: m.user?.name ?? m.user?.email ?? m.userId, role: m.role }))
          )
        )
        .catch(() => undefined);
      apiFetch<{ key: string; name: string; descriptionBn: string }[]>(`/organizations/${orgId}/workflows/presets`)
        .then(setPresets)
        .catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [runFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const totalRuns30d = useMemo(() => stats.reduce((acc, s) => acc + (s.runs30d || 0), 0), [stats]);
  const activeWorkflowsCount = useMemo(() => workflows.filter((w) => w.enabled).length, [workflows]);
  const avgSuccessRate = useMemo(() => {
    const valid = stats.map((s) => s.successRate).filter((r): r is number => r !== null);
    if (!valid.length) return null;
    return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
  }, [stats]);

  const runStats = useMemo(() => {
    const total = runs.length;
    const completed = runs.filter((r) => r.status === "completed").length;
    const failed = runs.filter((r) => r.status === "failed").length;
    const waiting = runs.filter((r) => r.status === "waiting").length;
    const skipped = runs.filter((r) => r.status === "skipped").length;
    return { total, completed, failed, waiting, skipped };
  }, [runs]);

  const filteredWorkflows = useMemo(() => {
    return workflows.filter((w) => {
      if (searchQuery.trim() && !w.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (filterTrigger && w.trigger !== filterTrigger) {
        return false;
      }
      if (filterStatus === "active" && !w.enabled) return false;
      if (filterStatus === "inactive" && w.enabled) return false;
      return true;
    });
  }, [workflows, searchQuery, filterTrigger, filterStatus]);

  function testContext() {
    const ctx: Record<string, string> = {};
    if (testCtx.leadId.trim()) ctx.leadId = testCtx.leadId.trim();
    if (testCtx.customerId.trim()) ctx.customerId = testCtx.customerId.trim();
    if (testCtx.conversationId.trim()) ctx.conversationId = testCtx.conversationId.trim();
    if (testCtx.orderId.trim()) ctx.orderId = testCtx.orderId.trim();
    return ctx;
  }

  async function runDry() {
    const orgId = getOrganizationId();
    if (!orgId || !testPanel) return;
    setError("");
    setTrace(null);
    setIsDryRunning(true);
    try {
      const out = await apiFetch<{ conditionsPassed: boolean; trace: { step: string; detail: string; branch?: string }[] }>(
        `/organizations/${orgId}/workflows/${testPanel.workflowId}/dry-run`,
        { method: "POST", body: JSON.stringify({ context: testContext() }) }
      );
      setTrace(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workflows.dryRunFailed"));
    } finally {
      setIsDryRunning(false);
    }
  }

  async function runManual() {
    const orgId = getOrganizationId();
    if (!orgId || !testPanel) return;
    if (!window.confirm(t("workflows.liveRunConfirm"))) return;
    setError("");
    setIsManualRunning(true);
    try {
      const run = await apiFetch<Run>(`/organizations/${orgId}/workflows/${testPanel.workflowId}/run`, {
        method: "POST",
        body: JSON.stringify({ context: testContext() }),
      });
      setNotice(t("workflows.manualRunDone", { status: run.status }));
      setTestPanel(null);
      setTrace(null);
      await load();
      setActiveTab("runs");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workflows.runFailed"));
    } finally {
      setIsManualRunning(false);
    }
  }

  async function retryRun(runId: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setError("");
    try {
      const run = await apiFetch<Run>(`/organizations/${orgId}/workflows/runs/${runId}/retry`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNotice(t("workflows.retryDone", { status: run.status }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workflows.retryFailed"));
    }
  }

  async function toggleWorkflow(w: Workflow) {
    const o = getOrganizationId();
    if (!o) return;
    try {
      await apiFetch(`/organizations/${o}/workflows/${w.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !w.enabled }),
      });
      setNotice(t("workflows.wfToggled", { name: w.name, state: !w.enabled ? t("workflows.stateOn2") : t("workflows.stateOff2") }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workflows.statusChangeFailed"));
    }
  }

  async function createWorkflow(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy("create");
    setError("");
    try {
      const payloadSteps = steps.map(buildPayloadStep);
      const conditions = formConditions
        .filter((c) => c.field.trim())
        .map((c) => ({
          field: c.field,
          op: c.op,
          value: parseConditionValue(c.value),
        }));
      const governance = {
        cooldownMinutes: form.cooldown ? Number(form.cooldown) : 0,
        dailyRunCap: form.cap ? Number(form.cap) : null,
      };
      if (editingId) {
        await apiFetch(`/organizations/${orgId}/workflows/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name,
            trigger: form.trigger,
            conditions: conditions,
            steps: payloadSteps,
            ...governance,
          }),
        });
        setNotice(t("workflows.wfUpdated", { name: form.name }));
      } else {
        await apiFetch(`/organizations/${orgId}/workflows`, {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            trigger: form.trigger,
            conditions: conditions.length ? conditions : undefined,
            steps: payloadSteps,
            ...governance,
          }),
        });
        setNotice(t("workflows.wfCreated", { name: form.name }));
      }
      resetForm();
      await load();
      setActiveTab("workflows");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy("");
    }
  }

  function resetForm() {
    setEditingId(null);
    setForm({ name: "", trigger: "order_created", cooldown: "", cap: "" });
    setFormConditions([]);
    setSteps([{ type: "send_email", templateId: "", text: "" }]);
  }

  function addStepByType(type: string) {
    let newStep: StepDraft;
    switch (type) {
      case "send_sms":
        newStep = { type: "send_sms", templateId: "", text: "" };
        break;
      case "send_email":
        newStep = { type: "send_email", templateId: "", text: "" };
        break;
      case "send_inbox_message":
        newStep = { type: "send_inbox_message", templateId: "", text: t("workflows.tplGreeting") };
        break;
      case "wait":
        newStep = { type: "wait", templateId: "", text: "", minutes: 60 };
        break;
      case "condition":
        newStep = { type: "condition", templateId: "", text: "", field: "total", op: "gte", value: "1000" };
        break;
      case "branch":
        newStep = { type: "branch", templateId: "", text: "", field: "total", op: "gte", value: "1000", then: [], else: [] };
        break;
      case "ai_generate":
        newStep = {
          type: "ai_generate",
          templateId: "",
          text: "",
          prompt: t("workflows.tplPersonalMsg"),
          action: "add_conversation_note",
          outputField: "aiResult",
        };
        break;
      case "notify_channel":
        newStep = { type: "notify_channel", templateId: "", url: "", title: t("workflows.tplAlertTitle"), text: t("workflows.tplOrderDone") };
        break;
      case "notify_team":
        newStep = { type: "notify_team", templateId: "", role: "OWNER", title: t("workflows.tplTeamAlert"), text: t("workflows.tplOrderLook") };
        break;
      case "assign_conversation":
        newStep = { type: "assign_conversation", templateId: "", text: "", userId: "" };
        break;
      case "change_lead_stage":
        newStep = { type: "change_lead_stage", templateId: "", text: "", stage: "qualified" };
        break;
      case "add_tag":
        newStep = { type: "add_tag", templateId: "", text: "", target: "lead", tag: "vip" };
        break;
      case "create_follow_up":
        newStep = { type: "create_follow_up", templateId: "", days: 3, text: t("workflows.tplFollowUp") };
        break;
      case "http_webhook":
        newStep = { type: "http_webhook", templateId: "", text: "", url: "", secret: "" };
        break;
      default:
        newStep = { type: "send_sms", templateId: "", text: "" };
    }
    setSteps([...steps, newStep]);
  }

  function downloadJson(name: string, content: string) {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice(t("workflows.jsonDownloaded", { name }));
  }

  function exportWorkflow(w: Workflow) {
    const data = {
      name: w.name,
      trigger: w.trigger,
      conditions: w.conditions ?? [],
      steps: w.steps,
      cooldownMinutes: w.cooldownMinutes ?? 0,
      dailyRunCap: w.dailyRunCap ?? null,
    };
    const jsonStr = JSON.stringify(data, null, 2);
    if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(jsonStr)
        .then(() => {
          setNotice(t("workflows.jsonCopied", { name: w.name }));
        })
        .catch(() => {
          downloadJson(w.name, jsonStr);
        });
    } else {
      downloadJson(w.name, jsonStr);
    }
  }

  function exportAllWorkflows() {
    if (workflows.length === 0) {
      setError(t("workflows.noWfToExport"));
      return;
    }
    const data = workflows.map((w) => ({
      name: w.name,
      trigger: w.trigger,
      conditions: w.conditions ?? [],
      steps: w.steps,
      cooldownMinutes: w.cooldownMinutes ?? 0,
      dailyRunCap: w.dailyRunCap ?? null,
      enabled: w.enabled,
    }));
    downloadJson(`all_workflows_backup_${new Date().toISOString().slice(0, 10)}`, JSON.stringify(data, null, 2));
  }

  function handleImportJson() {
    setError("");
    try {
      const parsed = JSON.parse(importText);
      if (!parsed.name || !parsed.trigger || !Array.isArray(parsed.steps)) {
        throw new Error(t("workflows.jsonRequired"));
      }
      setEditingId(null);
      setForm({
        name: `${parsed.name} ${t("workflows.importedSuffix")}`,
        trigger: parsed.trigger,
        cooldown: parsed.cooldownMinutes ? String(parsed.cooldownMinutes) : "",
        cap: parsed.dailyRunCap != null ? String(parsed.dailyRunCap) : "",
      });
      setFormConditions(
        Array.isArray(parsed.conditions)
          ? parsed.conditions.map((c: any) => ({
              field: c.field ?? "",
              op: c.op ?? "gte",
              value: c.value === undefined || c.value === null ? "" : String(c.value),
            }))
          : []
      );
      setSteps(parsed.steps.map((s: any) => stepToDraft(s)));
      setImportOpen(false);
      setImportText("");
      setNotice(t("workflows.jsonLoaded"));
      setEditorView("form");
      setActiveTab("builder");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workflows.invalidJson"));
    }
  }

  function loadForEdit(w: Workflow) {
    setError("");
    setEditingId(w.id);
    setForm({
      name: w.name,
      trigger: w.trigger,
      cooldown: w.cooldownMinutes ? String(w.cooldownMinutes) : "",
      cap: w.dailyRunCap != null ? String(w.dailyRunCap) : "",
    });
    setFormConditions(
      (w.conditions ?? []).map((c) => ({
        field: c.field,
        op: c.op,
        value: c.value === undefined || c.value === null ? "" : String(c.value),
      }))
    );
    setSteps((w.steps ?? []).map((s) => stepToDraft(s as unknown as RawStep)));
    setEditorView("form");
    setActiveTab("builder");
  }

  async function installPreset(key: string, name: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/workflows/presets/${key}/install`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNotice(t("workflows.presetInstalled", { name }));
      await load();
      setActiveTab("workflows");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workflows.installFailed"));
    }
  }

  async function cloneWorkflow(w: Workflow) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/workflows/${w.id}/clone`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNotice(t("workflows.cloned", { name: w.name }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workflows.cloneFailed"));
    }
  }

  function loadBlueprint(bp: (typeof BUSINESS_BLUEPRINTS)[0]) {
    setEditingId(null);
    setForm({
      name: bpText(bp, "name", locale),
      trigger: bp.trigger,
      cooldown: "",
      cap: "",
    });
    setFormConditions(
      bp.conditions.map((c) => ({
        field: c.field,
        op: c.op,
        value: c.value,
      }))
    );
    setSteps(bp.steps.map((s) => stepToDraft(s as unknown as RawStep)));
    setEditorView("form");
    setActiveTab("builder");
    setNotice(t("workflows.bpLoadedBuilder", { name: bpText(bp, "name", locale) }));
  }

  function openBlueprintInCanvas(bp: WorkflowBlueprint) {
    setCanvasDef({
      name: bpText(bp, "name", locale),
      trigger: bp.trigger,
      conditions: bp.conditions,
      steps: bp.steps as RawStep[],
    });
    setCanvasScope(`bp-${bp.key}`);
    setCanvasWorkflowId(undefined);
    setCanvasNote(t("workflows.bpLoadedCanvas", { name: bpText(bp, "name", locale) }));
    setCanvasEpoch((n) => n + 1);
    setEditorView("canvas");
    setActiveTab("builder");
    setNotice(t("workflows.bpLoadedCanvas2", { name: bpText(bp, "name", locale) }));
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
    setCanvasNote(t("workflows.editingExisting", { name: w.name }));
    setCanvasEpoch((n) => n + 1);
    setEditorView("canvas");
    setActiveTab("builder");
  }

  const inputCls = "input mt-1";

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header & Quick Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-500 to-violet-500 text-white shadow-glow">
              <span className="text-xl">⚡</span>
            </div>
            <div>
              <h1 className="page-title text-2xl font-bold tracking-tight text-slate-900">Workflows & Automations</h1>
              <p className="page-sub text-xs text-slate-500 sm:text-sm">
                {t("workflows.pageIntro")}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              load();
              setNotice(t("workflows.dataRefreshed"));
            }}
            title={t("workflows.refresh")}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">{t("workflows.refresh")}</span>
          </button>

          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setImportOpen(true)}
          >
            <svg className="h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>{t("workflows.jsonImport")}</span>
          </button>

          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={exportAllWorkflows}
            title={t("workflows.backupAllTitle")}
          >
            <svg className="h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>{t("workflows.fullBackup")}</span>
          </button>

          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => {
              resetForm();
              setEditorView("form");
              setActiveTab("builder");
            }}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            <span>{t("workflows.newWorkflow")}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50/90 p-3 text-sm text-red-800 shadow-sm animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>{error}</span>
          </div>
          <button className="text-xs font-semibold text-red-600 hover:text-red-800" onClick={() => setError("")}>
            ✕
          </button>
        </div>
      )}

      {notice && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/90 p-3 text-sm text-emerald-800 shadow-sm animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="text-base">✅</span>
            <span>{notice}</span>
          </div>
          <button className="text-xs font-semibold text-emerald-600 hover:text-emerald-800" onClick={() => setNotice("")}>
            ✕
          </button>
        </div>
      )}

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="stat-card">
          <div className="flex items-center justify-between">
            <span className="stat-label">{t("workflows.statTotalWf")}</span>
            <div className="stat-icon stat-icon-brand text-sm font-bold">⚡</div>
          </div>
          <div className="stat-value">{workflows.length}</div>
          <div className="stat-hint flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-emerald-700 font-semibold">{fmtNumber(locale, activeWorkflowsCount)} {t("workflows.statActiveSuffix")}</span>
            <span>· {fmtNumber(locale, workflows.length - activeWorkflowsCount)} {t("workflows.statDraftSuffix")}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <span className="stat-label">{t("workflows.statRuns30d")}</span>
            <div className="stat-icon stat-icon-green text-sm">🚀</div>
          </div>
          <div className="stat-value">{totalRuns30d.toLocaleString()}</div>
          <div className="stat-hint">{t("workflows.statRuns30dSub")}</div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <span className="stat-label">{t("workflows.statSuccessRate")}</span>
            <div className="stat-icon stat-icon-sky text-sm">📈</div>
          </div>
          <div className="stat-value">{avgSuccessRate !== null ? `${fmtNumber(locale, avgSuccessRate)}%` : fmtNumber(locale, 100) + "%"}</div>
          <div className="stat-hint">{t("workflows.statSuccessSub")}</div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <span className="stat-label">{t("workflows.statTriggerSupport")}</span>
            <div className="stat-icon stat-icon-amber text-sm">🎯</div>
          </div>
          <div className="stat-value">{fmtNumber(locale, TRIGGERS.length)}{t("workflows.countSuffixTi")}</div>
          <div className="stat-hint">{t("workflows.statTriggerSub")}</div>
        </div>
      </div>

      {/* Modern Segmented Navigation Tabs */}
      <div className="flex overflow-x-auto rounded-2xl border border-slate-200 bg-slate-100/80 p-1.5 shadow-sm scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveTab("workflows")}
          className={`flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all sm:text-sm whitespace-nowrap ${
            activeTab === "workflows"
              ? "bg-white text-brand-700 shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}
        >
          <span>{t("workflows.tabList")}</span>
          <span className="badge badge-brand">{workflows.length}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("builder")}
          className={`flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all sm:text-sm whitespace-nowrap ${
            activeTab === "builder"
              ? "bg-white text-brand-700 shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}
        >
          <span>{t("workflows.tabBuilder")}</span>
          {editingId ? (
            <span className="badge badge-amber">{t("workflows.tabEditing")}</span>
          ) : (
            <span className="badge badge-slate">{t("workflows.tabNew")}</span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("presets")}
          className={`flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all sm:text-sm whitespace-nowrap ${
            activeTab === "presets"
              ? "bg-white text-brand-700 shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}
        >
          <span>{t("workflows.tabBlueprints")}</span>
          <span className="badge badge-green">{BUSINESS_BLUEPRINTS.length + presets.length}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("runs")}
          className={`flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all sm:text-sm whitespace-nowrap ${
            activeTab === "runs"
              ? "bg-white text-brand-700 shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}
        >
          <span>{t("workflows.tabRuns")}</span>
          <span className="badge badge-slate">{runs.length}</span>
        </button>
      </div>

      {/* ============================================================== */}
      {/* TAB 1: WORKFLOWS LIST                                          */}
      {/* ============================================================== */}
      {activeTab === "workflows" && (
        <div className="space-y-4">
          {/* Search & Filter Bar */}
          <div className="card p-3 sm:p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder={t("workflows.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input pl-9"
                />
                <svg
                  className="absolute left-3 top-3.5 h-4 w-4 text-slate-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input !mt-0 !w-auto text-xs sm:text-sm"
                  value={filterTrigger}
                  onChange={(e) => setFilterTrigger(e.target.value)}
                >
                  <option value="">{t("workflows.allTriggers")}</option>
                  {TRIGGERS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.icon} {t.label}
                    </option>
                  ))}
                </select>

                <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setFilterStatus("all")}
                    className={`rounded-lg px-2.5 py-1.5 font-medium transition ${
                      filterStatus === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {t("workflows.filterAll")} ({fmtNumber(locale, workflows.length)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterStatus("active")}
                    className={`rounded-lg px-2.5 py-1.5 font-medium transition ${
                      filterStatus === "active" ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {t("workflows.filterActive")} ({fmtNumber(locale, activeWorkflowsCount)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterStatus("inactive")}
                    className={`rounded-lg px-2.5 py-1.5 font-medium transition ${
                      filterStatus === "inactive" ? "bg-white text-slate-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {t("workflows.filterInactive")} ({fmtNumber(locale, workflows.length - activeWorkflowsCount)})
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Workflow Cards */}
          {filteredWorkflows.length === 0 ? (
            <div className="card p-8">
              <EmptyState
                title={workflows.length === 0 ? t("workflows.noWf") : t("workflows.noResults")}
                description={
                  workflows.length === 0
                    ? t("workflows.noWfHint")
                    : t("workflows.noResultsHint")
                }
              />
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredWorkflows.map((w) => {
                const tr = TRIGGERS.find((t) => t.value === w.trigger) ?? {
                  value: w.trigger,
                  label: w.trigger,
                  icon: "⚡",
                  category: t("workflows.colEvent"),
                };
                const st = stats.find((s) => s.workflowId === w.id);

                return (
                  <div
                    key={w.id}
                    className="card card-hover overflow-hidden border border-slate-200/90 transition-all hover:border-brand-300"
                  >
                    <div className="p-4 sm:p-5">
                      {/* Top Row: Info & Toggle */}
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="badge badge-brand">
                              <span>{tr.icon}</span>
                              <span>{tr.label}</span>
                            </span>
                            <span className="badge badge-slate">{tr.category}</span>
                            {w.enabled ? (
                              <span className="badge badge-green">{t("workflows.badgeActive")}</span>
                            ) : (
                              <span className="badge badge-slate">{t("workflows.badgeInactive")}</span>
                            )}
                          </div>

                          <h3 className="text-base font-bold text-slate-900 sm:text-lg">{w.name}</h3>
                        </div>

                        {/* Status Toggle Switch */}
                        <div className="flex items-center gap-3 self-end sm:self-auto">
                          <span className="text-xs font-medium text-slate-500">
                            {w.enabled ? t("workflows.toggleActive") : t("workflows.toggleOff")}
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={w.enabled}
                            onClick={() => toggleWorkflow(w)}
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
                              w.enabled ? "bg-emerald-500" : "bg-slate-300"
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                w.enabled ? "translate-x-5" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      {/* Middle: Visual Pipeline Path Preview */}
                      <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                          {t("workflows.pipelineFlow")}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          {/* Trigger pill */}
                          <div className="flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-medium text-slate-800 shadow-sm border border-slate-200">
                            <span>{tr.icon}</span>
                            <span>{tr.label}</span>
                          </div>

                          {/* Conditions preview */}
                          {w.conditions && w.conditions.length > 0 && (
                            <>
                              <span className="text-slate-400 font-bold">➔</span>
                              <div className="flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-amber-800 border border-amber-200 font-medium">
                                <span>🔍</span>
                                <span>
                                  {w.conditions.length === 1
                                    ? `${w.conditions[0].field} ${w.conditions[0].op} ${String(w.conditions[0].value)}`
                                    : t("workflows.conditionsSuffix", { count: fmtNumber(locale, w.conditions.length) })}
                                </span>
                              </div>
                            </>
                          )}

                          {/* Steps preview */}
                          {w.steps.map((stStep, idx) => {
                            const meta = getStepMeta(stStep.type, locale);
                            return (
                              <React.Fragment key={idx}>
                                <span className="text-slate-400 font-bold">➔</span>
                                <div
                                  className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 font-medium shadow-sm ${meta.badgeCls}`}
                                >
                                  <span>{meta.icon}</span>
                                  <span>{meta.label}</span>
                                </div>
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>

                      {/* Meta Information Bar */}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <div className="flex flex-wrap items-center gap-3">
                          {st ? (
                            <span className="flex items-center gap-1 font-medium text-slate-700">
                              {t("workflows.runs30dLine", { count: fmtNumber(locale, st.runs30d) })} ·{" "}
                              <span className={st.successRate !== null && st.successRate >= 90 ? "text-emerald-600 font-semibold" : ""}>
                                {st.successRate !== null ? t("workflows.successRateSuffix", { pct: fmtNumber(locale, st.successRate) }) : t("workflows.noSuccessRate")}
                              </span>
                              {st.lastRunAt && (
                                <span className="text-slate-400">
                                  · {t("workflows.lastRunSuffix")} {fmtDate(locale, st.lastRunAt)}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span>{t("workflows.noRuns30d")}</span>
                          )}

                          {w.cooldownMinutes ? (
                            <span className="badge badge-slate">{t("workflows.cooldownLine", { min: fmtNumber(locale, w.cooldownMinutes) })}</span>
                          ) : null}

                          {w.dailyRunCap != null ? (
                            <span className="badge badge-slate">{t("workflows.dailyCapLine", { cap: fmtNumber(locale, w.dailyRunCap) })}</span>
                          ) : null}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-2 sm:pt-0">
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => {
                              setTestPanel({ workflowId: w.id, name: w.name });
                              setTrace(null);
                            }}
                            title={t("workflows.testTitle")}
                          >
                            {t("workflows.testBtn")}
                          </button>

                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => loadForEdit(w)}
                            title={t("workflows.editFormTitle")}
                          >
                            {t("workflows.editBtn")}
                          </button>

                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => openInCanvas(w)}
                            title={t("workflows.canvasTitle")}
                          >
                            {t("workflows.canvasBtn")}
                          </button>

                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => exportWorkflow(w)}
                            title={t("workflows.exportTitle")}
                          >
                            {t("workflows.exportBtn")}
                          </button>

                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => cloneWorkflow(w)}
                            title={t("workflows.cloneTitle")}
                          >
                            {t("workflows.cloneBtn")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: WORKFLOW BUILDER                                        */}
      {/* ============================================================== */}
      {activeTab === "builder" && (
        <div className="space-y-6">
          {/* Builder Controls Header */}
          <div className="card p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {editingId ? t("workflows.builderEditTitle") : t("workflows.builderNewTitle")}
                </h2>
                <p className="text-xs text-slate-500">
                  {editingId
                    ? t("workflows.builderSnapshotWarn")
                    : t("workflows.builderIntro")}
                </p>
              </div>

              {/* Mode Toggle: Form vs Canvas */}
              <div className="flex items-center gap-2">
                <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-slate-100 p-0.5 text-xs font-semibold">
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-1.5 transition ${
                      editorView === "form" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                    onClick={() => setEditorView("form")}
                  >
                    {t("workflows.formTab")}
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-1.5 transition ${
                      editorView === "canvas" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                    onClick={() => setEditorView("canvas")}
                  >
                    {t("workflows.canvasTab")}
                  </button>
                </div>

                {editingId && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm text-red-600 hover:bg-red-50"
                    onClick={() => resetForm()}
                  >
                    {t("workflows.cancelBtn")}
                  </button>
                )}
              </div>
            </div>

            {/* Smart Dynamic Variables Quick Guide */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-slate-600">{t("workflows.smartVarsLabel")}</span>
              {dynamicVariablesForLocale(locale).slice(0, 7).map((v) => (
                <span
                  key={v.tag}
                  className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700 border border-slate-200"
                  title={v.label}
                >
                  {v.tag}
                </span>
              ))}
              <span className="text-[11px] text-slate-400">{t("workflows.smartVarsNote")}</span>
            </div>
          </div>

          {/* Form Mode View */}
          {editorView === "form" && (
            <form onSubmit={createWorkflow} className="space-y-6">
              {/* Card 1: Basic Info & Trigger */}
              <div className="card p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700">
                    {fmtNumber(locale, 1)}
                  </span>
                  <h3 className="font-bold text-slate-900">{t("workflows.sec1Title")}</h3>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {t("workflows.wfNameLabel")}
                    </label>
                    <input
                      className={inputCls}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                      placeholder={t("workflows.wfNamePlaceholder")}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {t("workflows.triggerLabel")}
                    </label>
                    <select
                      className={inputCls}
                      value={form.trigger}
                      onChange={(e) => setForm({ ...form, trigger: e.target.value })}
                    >
                      {TRIGGERS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.icon} {t.label} ({t.category})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Card 2: Trigger Conditions with Dynamic Suggestions */}
              <div className="card p-5 space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-xs font-bold text-amber-700">
                      {fmtNumber(locale, 2)}
                    </span>
                    <div>
                      <h3 className="font-bold text-slate-900">{t("workflows.sec2Title")}</h3>
                      <p className="text-xs text-slate-500">
                        {t("workflows.sec2Sub")}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn-secondary btn-sm self-start sm:self-auto"
                    onClick={() => setFormConditions([...formConditions, { field: "total", op: "gte", value: "1000" }])}
                  >
                    {t("workflows.addCondition")}
                  </button>
                </div>

                {/* Contextual Quick Condition Suggestions based on selected trigger */}
                {suggestionsFor(locale, form.trigger).length > 0 && (
                  <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3">
                    <div className="text-xs font-semibold text-amber-900 mb-1.5">
                      {t("workflows.quickCondLabel")}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {suggestionsFor(locale, form.trigger).map((sug, sIdx) => (
                        <button
                          key={sIdx}
                          type="button"
                          className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 shadow-sm hover:bg-amber-100 transition"
                          onClick={() =>
                            setFormConditions([
                              ...formConditions,
                              { field: sug.field, op: sug.op, value: sug.value },
                            ])
                          }
                        >
                          + {sug.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {formConditions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center text-xs text-slate-500">
                    {t("workflows.noConditions")}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {formConditions.map((cond, idx) => (
                      <div
                        key={idx}
                        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 shadow-sm"
                      >
                        <div className="min-w-[180px] flex-1">
                          <label className="block text-xs font-semibold text-slate-600">{t("workflows.condField")}</label>
                          <select
                            className={inputCls}
                            value={cond.field}
                            onChange={(e) => {
                              const next = [...formConditions];
                              next[idx].field = e.target.value;
                              setFormConditions(next);
                            }}
                          >
                            {conditionFieldsFor(locale).map((f) => (
                              <option key={f.value} value={f.value}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="w-36">
                          <label className="block text-xs font-semibold text-slate-600">{t("workflows.condOperator")}</label>
                          <select
                            className={inputCls}
                            value={cond.op}
                            onChange={(e) => {
                              const next = [...formConditions];
                              next[idx].op = e.target.value;
                              setFormConditions(next);
                            }}
                          >
                            {conditionOperatorsFor(locale).map((op) => (
                              <option key={op.value} value={op.value}>
                                {op.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="min-w-[160px] flex-1">
                          <label className="block text-xs font-semibold text-slate-600">{t("workflows.condValue")}</label>
                          <input
                            className={inputCls}
                            value={cond.value}
                            placeholder={t("workflows.condValuePlaceholder")}
                            onChange={(e) => {
                              const next = [...formConditions];
                              next[idx].value = e.target.value;
                              setFormConditions(next);
                            }}
                          />
                        </div>

                        <button
                          type="button"
                          className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                          onClick={() => setFormConditions(formConditions.filter((_, i) => i !== idx))}
                          title={t("workflows.condDeleteTitle")}
                        >
                          {t("workflows.deleteShort")}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Card 3: Automation Steps Pipeline with Action Palette */}
              <div className="card p-5 space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-xs font-bold text-emerald-700">
                      {fmtNumber(locale, 3)}
                    </span>
                    <div>
                      <h3 className="font-bold text-slate-900">{t("workflows.sec3Title")}</h3>
                      <p className="text-xs text-slate-500">
                        {t("workflows.sec3Sub")}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {steps.map((s, i) => {
                    const meta = getStepMeta(s.type, locale);
                    return (
                      <div
                        key={i}
                        className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 mb-3">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                              {i + 1}
                            </span>
                            <span className={`badge ${meta.badgeCls}`}>
                              <span>{meta.icon}</span>
                              <span>{meta.label}</span>
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {i > 0 && (
                              <button
                                type="button"
                                className="rounded-lg border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                                onClick={() => {
                                  const copy = [...steps];
                                  const [item] = copy.splice(i, 1);
                                  copy.splice(i - 1, 0, item);
                                  setSteps(copy);
                                }}
                                title={t("workflows.moveUp")}
                              >
                                ↑
                              </button>
                            )}

                            {i < steps.length - 1 && (
                              <button
                                type="button"
                                className="rounded-lg border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                                onClick={() => {
                                  const copy = [...steps];
                                  const [item] = copy.splice(i, 1);
                                  copy.splice(i + 1, 0, item);
                                  setSteps(copy);
                                }}
                                title={t("workflows.moveDown")}
                              >
                                ↓
                              </button>
                            )}

                            {steps.length > 1 && (
                              <button
                                type="button"
                                className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                                onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                                title={t("workflows.stepDeleteTitle")}
                              >
                                {t("workflows.stepDelete")}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Step field parameters with Variable Inserter */}
                        <StepFields
                          draft={s}
                          onChange={(next) => setSteps(steps.map((x, j) => (j === i ? next : x)))}
                          templates={templates}
                          waTemplates={waTemplates}
                          members={members}
                          inputCls={inputCls}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Categorized Quick Action Palette */}
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
                  <div className="text-xs font-bold text-slate-700 mb-2">
                    {t("workflows.addStepLabel")}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("send_sms")}
                    >
                      📱 SMS
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("send_email")}
                    >
                      ✉️ Email
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("send_inbox_message")}
                    >
                      {t("workflows.addInboxMsg")}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("wait")}
                    >
                      {t("workflows.addWait")}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("branch")}
                    >
                      {t("workflows.addBranch")}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("ai_generate")}
                    >
                      {t("workflows.addAi")}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("notify_channel")}
                    >
                      {t("workflows.addChannelAlert")}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("notify_team")}
                    >
                      {t("workflows.addNotifyTeam")}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("assign_conversation")}
                    >
                      👤 Assign
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("create_follow_up")}
                    >
                      📅 Follow-up
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("add_tag")}
                    >
                      🏷️ Tag
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("http_webhook")}
                    >
                      🌐 Webhook
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 4: Governance & Throttling Limits */}
              <div className="card p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-xs font-bold text-sky-700">
                    {fmtNumber(locale, 4)}
                  </span>
                  <div>
                    <h3 className="font-bold text-slate-900">{t("workflows.sec4Title")}</h3>
                    <p className="text-xs text-slate-500">
                      {t("workflows.sec4Sub")}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {t("workflows.cooldownLabel")}
                    </label>
                    <input
                      className={inputCls}
                      type="number"
                      min={0}
                      max={10080}
                      value={form.cooldown}
                      onChange={(e) => setForm({ ...form, cooldown: e.target.value })}
                      placeholder={t("workflows.cooldownZero")}
                    />
                    <span className="mt-1 block text-xs text-slate-400">
                      {t("workflows.cooldownNote")}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {t("workflows.dailyCapLabel")}
                    </label>
                    <input
                      className={inputCls}
                      type="number"
                      min={1}
                      max={10000}
                      value={form.cap}
                      onChange={(e) => setForm({ ...form, cap: e.target.value })}
                      placeholder={t("workflows.dailyCapEmpty")}
                    />
                    <span className="mt-1 block text-xs text-slate-400">
                      {t("workflows.dailyCapNote")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Form Bottom Save Action Bar */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end card p-4">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    resetForm();
                    setActiveTab("workflows");
                  }}
                >
                  {t("workflows.cancelPlain")}
                </button>

                <button
                  type="submit"
                  className="btn-primary"
                  disabled={busy !== ""}
                >
                  {busy ? t("workflows.saving") : editingId ? t("workflows.saveUpdate") : t("workflows.createActivate")}
                </button>
              </div>
            </form>
          )}

          {/* Canvas Mode View */}
          {editorView === "canvas" && (
            <div className="card p-4 sm:p-5">
              <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                <WorkflowCanvas
                  key={`${canvasScope}-${canvasEpoch}`}
                  initialDefinition={canvasDef}
                  scopeKey={canvasScope}
                  templates={templates}
                  waTemplates={waTemplates}
                  sourceNote={canvasNote || undefined}
                  onSaved={() => {
                    load();
                    setActiveTab("workflows");
                  }}
                  workflowId={canvasWorkflowId}
                  members={members}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 3: PROBLEM-BASED BUSINESS BLUEPRINTS GALLERY (105+ SOLS)   */}
      {/* ============================================================== */}
      {activeTab === "presets" && (
        <WorkflowPresetsTab
          triggers={TRIGGERS_L}
          presets={presets}
          loadBlueprint={loadBlueprint}
          openBlueprintInCanvas={openBlueprintInCanvas}
          installPreset={installPreset}
        />
      )}

      {/* ============================================================== */}
      {/* TAB 4: RUN HISTORY & LOGS                                      */}
      {/* ============================================================== */}
      {activeTab === "runs" && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-bold text-slate-900">{t("workflows.runsTitle")}</h3>
                <p className="text-xs text-slate-500">{t("workflows.runsSub")}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input !mt-0 !w-auto text-xs sm:text-sm"
                  value={runFilter.workflowId}
                  onChange={(e) => setRunFilter({ ...runFilter, workflowId: e.target.value })}
                >
                  <option value="">{t("workflows.allWorkflows")}</option>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>

                <select
                  className="input !mt-0 !w-auto text-xs sm:text-sm"
                  value={runFilter.status}
                  onChange={(e) => setRunFilter({ ...runFilter, status: e.target.value })}
                >
                  <option value="">{t("workflows.allStatus")}</option>
                  <option value="completed">{t("workflows.runCompleted")}</option>
                  <option value="failed">{t("workflows.runFailedOpt")}</option>
                  <option value="waiting">{t("workflows.runWaitingOpt")}</option>
                  <option value="skipped">{t("workflows.runSkippedOpt")}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Run Health Visual Breakdown */}
          {runs.length > 0 && (
            <div className="card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-700">{t("workflows.runHealthLabel")}</span>
                <div className="flex flex-wrap gap-2">
                  <span className="badge badge-green">
                    {t("workflows.runCompletedShort")} {fmtNumber(locale, runStats.completed)} ({fmtNumber(locale, runStats.total ? Math.round((runStats.completed / runStats.total) * 100) : 0)}%)
                  </span>
                  <span className="badge badge-red">
                    {t("workflows.runFailedShort")} {fmtNumber(locale, runStats.failed)}
                  </span>
                  <span className="badge badge-amber">
                    {t("workflows.runWaitingShort")} {fmtNumber(locale, runStats.waiting)}
                  </span>
                  <span className="badge badge-slate">
                    {t("workflows.runSkippedShort")} {fmtNumber(locale, runStats.skipped)}
                  </span>
                </div>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="bg-emerald-500 transition-all duration-300"
                  style={{ width: `${(runStats.completed / (runStats.total || 1)) * 100}%` }}
                  title={`Completed: ${runStats.completed}`}
                />
                <div
                  className="bg-red-500 transition-all duration-300"
                  style={{ width: `${(runStats.failed / (runStats.total || 1)) * 100}%` }}
                  title={`Failed: ${runStats.failed}`}
                />
                <div
                  className="bg-amber-400 transition-all duration-300"
                  style={{ width: `${(runStats.waiting / (runStats.total || 1)) * 100}%` }}
                  title={`Waiting: ${runStats.waiting}`}
                />
                <div
                  className="bg-slate-300 transition-all duration-300"
                  style={{ width: `${(runStats.skipped / (runStats.total || 1)) * 100}%` }}
                  title={`Skipped: ${runStats.skipped}`}
                />
              </div>
            </div>
          )}

          {/* Runs Feed */}
          {runs.length === 0 ? (
            <div className="card p-8">
              <EmptyState
                title={t("workflows.noRuns")}
                description={t("workflows.noRunsHint")}
              />
            </div>
          ) : (
            <div className="space-y-2.5">
              {runs.map((r) => {
                const tr = TRIGGERS.find((t) => t.value === r.trigger) ?? {
                  value: r.trigger,
                  label: r.trigger,
                  icon: "⚡",
                };
                const isExpanded = expandedRunId === r.id;

                let statusBadgeCls = "badge-slate";
                let statusLabel = r.status;
                if (r.status === "completed") {
                  statusBadgeCls = "badge-green";
                  statusLabel = t("workflows.runCompleted");
                } else if (r.status === "waiting") {
                  statusBadgeCls = "badge-amber";
                  statusLabel = t("workflows.runWaitingOpt");
                } else if (r.status === "failed") {
                  statusBadgeCls = "badge-red";
                  statusLabel = t("workflows.runFailedOpt");
                } else if (r.status === "skipped") {
                  statusBadgeCls = "badge-slate";
                  statusLabel = t("workflows.runSkippedOpt");
                }

                return (
                  <div
                    key={r.id}
                    className="card p-4 transition hover:border-slate-300"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="badge badge-brand">
                            {tr.icon} {tr.label}
                          </span>
                          <span className={`badge ${statusBadgeCls}`}>{statusLabel}</span>
                          <span className="text-xs text-slate-400">
                            {new Date(r.createdAt).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        {r.status === "failed" && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm text-xs font-semibold"
                            onClick={() => retryRun(r.id)}
                          >
                            {t("workflows.retryBtn")}
                          </button>
                        )}

                        {r.stepsLog && r.stepsLog.length > 0 && (
                          <button
                            type="button"
                            className="rounded-lg border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                            onClick={() => setExpandedRunId(isExpanded ? null : r.id)}
                          >
                            {isExpanded ? t("workflows.logHide") : t("workflows.logShow", { count: fmtNumber(locale, r.stepsLog.length) })}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Error Banner */}
                    {r.error && (
                      <div className="mt-2.5 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
                        <b>{t("workflows.errorLabel")}</b> {r.error}
                      </div>
                    )}

                    {/* Step Execution Logs */}
                    {isExpanded && r.stepsLog && (
                      <div className="mt-3 space-y-1.5 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs">
                        <div className="font-semibold text-slate-700">{t("workflows.execStepsLabel")}</div>
                        {r.stepsLog.map((s, idx) => (
                          <div
                            key={idx}
                            className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-slate-200 pb-1.5 last:border-0 last:pb-0"
                          >
                            <span className="font-mono font-medium text-slate-800">
                              {idx + 1}. {s.step}
                            </span>
                            <span className="text-slate-500">{s.detail}</span>
                            <span
                              className={`badge ${
                                s.status === "completed"
                                  ? "badge-green"
                                  : s.status === "failed"
                                  ? "badge-red"
                                  : "badge-slate"
                              }`}
                            >
                              {s.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: TEST & DRY-RUN                                          */}
      {/* ============================================================== */}
      {testPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">🧪</span>
                <h3 className="font-bold text-slate-900 text-lg">{t("workflows.testPanelTitle")} — {testPanel.name}</h3>
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600 font-bold"
                onClick={() => {
                  setTestPanel(null);
                  setTrace(null);
                }}
              >
                ✕
              </button>
            </div>

            {/* Quick Sample Presets */}
            <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3 space-y-1.5">
              <div className="text-xs font-semibold text-brand-900">
                {t("workflows.sampleHint")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="rounded-lg border border-brand-300 bg-white px-2.5 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100 transition"
                  onClick={() =>
                    setTestCtx({ orderId: "sample_order_101", customerId: "cust_vip_01", leadId: "", conversationId: "" })
                  }
                >
                  {t("workflows.sampleOrder")}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-brand-300 bg-white px-2.5 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100 transition"
                  onClick={() =>
                    setTestCtx({ leadId: "sample_lead_01", customerId: "", conversationId: "", orderId: "" })
                  }
                >
                  {t("workflows.sampleLead")}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-brand-300 bg-white px-2.5 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100 transition"
                  onClick={() =>
                    setTestCtx({ conversationId: "sample_conv_01", customerId: "", leadId: "", orderId: "" })
                  }
                >
                  {t("workflows.sampleInbox")}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:text-slate-800 transition"
                  onClick={() => setTestCtx({ leadId: "", customerId: "", conversationId: "", orderId: "" })}
                >
                  {t("workflows.deleteShort")}
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-600">Lead ID</label>
                <input
                  className={inputCls}
                  value={testCtx.leadId}
                  onChange={(e) => setTestCtx({ ...testCtx, leadId: e.target.value })}
                  placeholder={t("workflows.exLeadId")}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600">Customer ID</label>
                <input
                  className={inputCls}
                  value={testCtx.customerId}
                  onChange={(e) => setTestCtx({ ...testCtx, customerId: e.target.value })}
                  placeholder={t("workflows.exCustId")}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600">Conversation ID</label>
                <input
                  className={inputCls}
                  value={testCtx.conversationId}
                  onChange={(e) => setTestCtx({ ...testCtx, conversationId: e.target.value })}
                  placeholder={t("workflows.exConvId")}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600">Order ID</label>
                <input
                  className={inputCls}
                  value={testCtx.orderId}
                  onChange={(e) => setTestCtx({ ...testCtx, orderId: e.target.value })}
                  placeholder={t("workflows.exOrderId")}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <button
                type="button"
                className="btn-secondary flex-1"
                disabled={isDryRunning}
                onClick={runDry}
              >
                {isDryRunning ? t("workflows.simulating") : t("workflows.dryRunBtn")}
              </button>
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={isManualRunning}
                onClick={runManual}
              >
                {isManualRunning ? t("workflows.running") : t("workflows.liveRunBtn")}
              </button>
            </div>

            {/* Dry-run trace result */}
            {trace && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">{t("workflows.resultLabel")}</span>
                  {trace.conditionsPassed ? (
                    <span className="badge badge-green">{t("workflows.allCondsMet")}</span>
                  ) : (
                    <span className="badge badge-amber">{t("workflows.condsNotMet")}</span>
                  )}
                </div>

                {trace.conditionsPassed && trace.trace && trace.trace.length > 0 && (
                  <div className="mt-2 space-y-1.5 text-xs">
                    <div className="font-semibold text-slate-700">{t("workflows.stepsTrace")}</div>
                    {trace.trace.map((t, idx) => (
                      <div key={idx} className="rounded-lg bg-white p-2 border border-slate-100 shadow-sm">
                        <span className="font-mono font-bold text-slate-900">{t.step}</span>
                        {t.branch && <span className="ml-1 text-purple-600">({t.branch})</span>}: {t.detail}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: JSON IMPORT                                             */}
      {/* ============================================================== */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">📥</span>
                <h3 className="font-bold text-slate-900 text-lg">Workflow {t("workflows.jsonImport")}</h3>
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600 font-bold"
                onClick={() => {
                  setImportOpen(false);
                  setImportText("");
                }}
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500">
              {t("workflows.importHint")}
            </p>

            <textarea
              className="input w-full font-mono text-xs h-36 bg-slate-50"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='{ "name": "...", "trigger": "order_created", "steps": [...] }'
            />

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setImportOpen(false);
                  setImportText("");
                }}
              >
                {t("workflows.cancelBtn")}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleImportJson}
              >
                {t("workflows.importLoad")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}