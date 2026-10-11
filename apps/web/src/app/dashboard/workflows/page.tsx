"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import { StepFields, DYNAMIC_VARIABLES } from "@/components/step-fields";
import WorkflowCanvas from "@/components/workflow-canvas";
import {
  buildPayloadStep,
  parseConditionValue,
  stepToDraft,
  type RawStep,
  type StepDraftLike,
  type WorkflowDefinition,
} from "@/lib/workflow-graph";

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

// Rich business blueprints for any merchant
const BUSINESS_BLUEPRINTS = [
  {
    key: "cart_recovery_power",
    category: "ecommerce",
    catLabel: "🛍️ ই-কমার্স",
    name: "কার্ট রিকভারি ও স্মার্ট এসএমএস",
    descriptionBn: "গ্রাহক পণ্য কার্টে রেখে চলে গেলে ৩০ মিনিট পর অটোমেটিক ফলো-আপ এসএমএস পাঠানো ও টিমকে অবগত করা।",
    trigger: "cart_abandoned",
    conditions: [{ field: "cartValue", op: "gte", value: "500" }],
    steps: [
      { type: "wait", minutes: 30 },
      { type: "send_inbox_message", text: "আসসালামু আলাইকুম {{contactName}}, আপনার কার্টে থাকা পণ্যগুলো ({{itemsSummary}}) এখনো আপনার জন্য সংরক্ষিত আছে। কিনতে ক্লিক করুন: {{cartUrl}}" },
      { type: "notify_team", role: "MARKETING_MANAGER", title: "Abandoned Cart", text: "গ্রাহক {{contactName}} এর কার্ট (৳{{cartValue}}) রিকভারি মেসেজ পাঠানো হয়েছে।" },
    ],
  },
  {
    key: "vip_order_concierge",
    category: "ecommerce",
    catLabel: "🛍️ ই-কমার্স",
    name: "ভিআইপি অর্ডার ডিটেকশন ও ওনার অ্যালার্ট",
    descriptionBn: "কোনো গ্রাহক ৳৩,০০০ বা তার বেশি অর্ডার করলেই সাথে সাথে ওনারকে জানানো এবং কাস্টমারকে VIP ট্যাগ দেওয়া।",
    trigger: "order_created",
    conditions: [{ field: "total", op: "gte", value: "3000" }],
    steps: [
      { type: "add_tag", target: "lead", tag: "vip-customer" },
      { type: "notify_team", role: "OWNER", title: "🌟 ভিআইপি অর্ডার অ্যালার্ট", text: "অভিনন্দন! অর্ডার #{{orderNumber}} সম্পন্ন হয়েছে ৳{{total}} টাকার! গ্রাহক: {{contactName}}।" },
      { type: "notify_channel", title: "🌟 নতুন ভিআইপি অর্ডার", text: "অর্ডার #{{orderNumber}} (৳{{total}}) সম্পন্ন করেছেন {{contactName}}।" },
    ],
  },
  {
    key: "cod_instant_confirm",
    category: "ecommerce",
    catLabel: "🛍️ ই-কমার্স",
    name: "COD অর্ডার কনফার্মেশন ও ফলো-আপ",
    descriptionBn: "ক্যাশ অন ডেলিভারি (COD) অর্ডার কনফার্ম হওয়ামাত্রই গ্রাহককে ধন্যবাদ মেসেজ ও টিমকে প্যাকিং শুরু করতে বলা।",
    trigger: "order_cod_confirmed",
    conditions: [],
    steps: [
      { type: "send_inbox_message", text: "ধন্যবাদ {{contactName}}! আপনার COD অর্ডার #{{orderNumber}} (৳{{total}}) কনফার্ম হয়েছে। পার্সেল ডেলিভারিতে পাঠালে ট্র্যাকিং কোড পাবেন।" },
      { type: "notify_team", role: "ADMIN", title: "COD কনফার্মড", text: "অর্ডার #{{orderNumber}} এর প্যাকেজিং সম্পন্ন করে কুরিয়ারে দিন।" },
    ],
  },
  {
    key: "delivered_review_voucher",
    category: "ecommerce",
    catLabel: "🛍️ ই-কমার্স",
    name: "ডেলিভারি সম্পন্ন হলে ৫-স্টার রিভিউ রিকোয়েস্ট",
    descriptionBn: "অর্ডার সফলভাবে ডেলিভারি হওয়ার ২৪ ঘণ্টা পর গ্রাহককে সন্তুষ্টি যাচাই ও রিভিউ দেওয়ার অনুরোধ পাঠানো।",
    trigger: "order_delivered",
    conditions: [],
    steps: [
      { type: "wait", minutes: 1440 },
      { type: "send_inbox_message", text: "আসসালামু আলাইকুম {{contactName}}, অর্ডার #{{orderNumber}} এর পণ্যগুলো আপনার কেমন লাগলো? আপনার মূল্যবান মতামত ও ৫-স্টার রিভিউ আমাদের অনুপ্রেরণা দেবে!" },
      { type: "create_follow_up", days: 3, text: "গ্রাহক {{contactName}} এর রিভিউ ও রিপিট অর্ডারের খোঁজ নিন" },
    ],
  },
  {
    key: "new_lead_auto_assign",
    category: "leads",
    catLabel: "👥 লিড ও সিআরএম",
    name: "নতুন লিড স্বাগতম ও তাৎক্ষণিক অ্যাসাইন",
    descriptionBn: "ওয়েবসাইট বা ফেসবুক থেকে নতুন লিড আসা মাত্রই সেলস এজেন্টের কাছে অ্যাসাইন ও কাস্টমারকে স্বাগতম জানানো।",
    trigger: "lead_created",
    conditions: [],
    steps: [
      { type: "send_inbox_message", text: "আসসালামু আলাইকুম {{contactName}}, আমাদের সাথে যোগাযোগের জন্য ধন্যবাদ! আমাদের প্রতিনিধি দ্রুতই আপনার সাথে কথা বলছেন।" },
      { type: "create_follow_up", days: 1, text: "নতুন লিড {{contactName}} এর সাথে বিস্তারিত আলোচনা করুন" },
    ],
  },
  {
    key: "lead_qualified_quote",
    category: "leads",
    catLabel: "👥 লিড ও সিআরএম",
    name: "লিড Qualified হলে কোটেশন রিমাইন্ডার",
    descriptionBn: "লিড স্টেজ 'Qualified' এ পরিবর্তন হলে সেলস টিমকে কোটেশন পাঠানোর টাস্ক ও ২ দিন পর ফলো-আপ শিডিউল।",
    trigger: "lead_stage_changed",
    conditions: [{ field: "stage", op: "eq", value: "qualified" }],
    steps: [
      { type: "notify_team", role: "MARKETING_MANAGER", title: "লিড Qualified", text: "{{contactName}} উপযুক্ত লিড হিসেবে চিহ্নিত হয়েছে — দ্রুত প্রস্তাবনা পাঠান।" },
      { type: "create_follow_up", days: 2, text: "{{contactName}} এর কোটেশনের ফলো-আপ নিন" },
    ],
  },
  {
    key: "complaint_escalation_manager",
    category: "support",
    catLabel: "💬 সাপোর্ট ও ইনবক্স",
    name: "গ্রাহকের অভিযোগ শনাক্ত ও ম্যানেজার এসকেলেশন",
    descriptionBn: "ইনবক্সে কোনো অভিযোগ শনাক্ত হলে অবিলম্বে কাস্টমার কেয়ার ম্যানেজারের কাছে ফ্ল্যাগ ও ইন্টারনাল নোট তৈরি।",
    trigger: "inbox_message_received",
    conditions: [{ field: "intent", op: "eq", value: "complaint" }],
    steps: [
      { type: "add_tag", target: "conversation", tag: "urgent-complaint" },
      { type: "add_conversation_note", text: "🚨 গ্রাহকের অভিযোগ এসেছে — দ্রুত অগ্রাধিকার দিয়ে সমাধান করুন" },
      { type: "notify_team", role: "ADMIN", title: "জরুরি অভিযোগ", text: "গ্রাহক {{contactName}} একটি অভিযোগ করেছেন, দ্রুত ইনবক্স দেখুন।" },
    ],
  },
  {
    key: "ai_inbox_reply_assistant",
    category: "support",
    catLabel: "💬 সাপোর্ট ও ইনবক্স",
    name: "AI স্মার্ট উত্তর ও সামারি জেনারেটর",
    descriptionBn: "গ্রাহকের বার্তার প্রেক্ষিতে কৃত্রিম বুদ্ধিমত্তা (AI) দ্বারা তাৎক্ষণিক সারসংক্ষেপ ও খসড়া প্রস্তুত রাখা।",
    trigger: "inbox_message_received",
    conditions: [],
    steps: [
      { type: "ai_generate", prompt: "গ্রাহকের বার্তার মূল বক্তব্য সংক্ষেপে লিখুন এবং একজন আদর্শ সাপোর্ট এজেন্টের জন্য উত্তরের পয়েন্টগুলো দিন।", action: "add_conversation_note", outputField: "aiSummary" },
    ],
  },
  {
    key: "slack_discord_ops_alert",
    category: "alerts",
    catLabel: "📢 চ্যানেল অ্যালার্ট",
    name: "স্ল্যাক / ডিসকর্ড চ্যানেলে রিয়েলটাইম অর্ডার অ্যালার্ট",
    descriptionBn: "প্রতিটি নতুন অর্ডারে সরাসরি আপনার স্ল্যাক বা ডিসকর্ড চ্যানেলে স্বয়ংক্রিয় নোটিফিকেশন প্রেরণ।",
    trigger: "order_created",
    conditions: [{ field: "total", op: "gte", value: "1000" }],
    steps: [
      { type: "notify_channel", title: "🛒 নতুন অর্ডার সম্পন্ন!", text: "অর্ডার #{{orderNumber}} সম্পন্ন হয়েছে (৳{{total}})। গ্রাহক: {{contactName}} ({{contactPhone}})" },
    ],
  },
];

function getStepMeta(type: string): { label: string; icon: string; badgeCls: string } {
  switch (type) {
    case "send_email":
      return { label: "Email পাঠান", icon: "✉️", badgeCls: "bg-sky-50 text-sky-700 border-sky-200" };
    case "send_sms":
      return { label: "SMS পাঠান", icon: "📱", badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "add_lead_activity":
      return { label: "Lead Note", icon: "📝", badgeCls: "bg-indigo-50 text-indigo-700 border-indigo-200" };
    case "add_conversation_note":
      return { label: "Internal Note", icon: "🔒", badgeCls: "bg-violet-50 text-violet-700 border-violet-200" };
    case "send_inbox_message":
      return { label: "Inbox বার্তা", icon: "💬", badgeCls: "bg-teal-50 text-teal-700 border-teal-200" };
    case "wait":
      return { label: "অপেক্ষা (Wait)", icon: "⏱️", badgeCls: "bg-amber-50 text-amber-700 border-amber-200" };
    case "condition":
      return { label: "শর্ত যাচাই", icon: "🔍", badgeCls: "bg-amber-50 text-amber-700 border-amber-200" };
    case "branch":
      return { label: "শাখা (Branch)", icon: "🔀", badgeCls: "bg-purple-50 text-purple-700 border-purple-200" };
    case "assign_conversation":
      return { label: "Assign", icon: "👤", badgeCls: "bg-blue-50 text-blue-700 border-blue-200" };
    case "change_lead_stage":
      return { label: "Stage বদলান", icon: "🏷️", badgeCls: "bg-indigo-50 text-indigo-700 border-indigo-200" };
    case "add_tag":
      return { label: "Tag যোগ", icon: "🏷️", badgeCls: "bg-slate-100 text-slate-700 border-slate-300" };
    case "notify_team":
      return { label: "টিমকে জানান", icon: "👥", badgeCls: "bg-orange-50 text-orange-700 border-orange-200" };
    case "create_follow_up":
      return { label: "Follow-up", icon: "📅", badgeCls: "bg-rose-50 text-rose-700 border-rose-200" };
    case "http_webhook":
      return { label: "Webhook", icon: "🌐", badgeCls: "bg-cyan-50 text-cyan-700 border-cyan-200" };
    case "notify_channel":
      return { label: "চ্যানেল অ্যালার্ট", icon: "📢", badgeCls: "bg-indigo-50 text-indigo-700 border-indigo-200" };
    case "ai_generate":
      return { label: "AI অ্যাকশন", icon: "🤖", badgeCls: "bg-purple-50 text-purple-700 border-purple-200" };
    default:
      return { label: type, icon: "⚡", badgeCls: "bg-slate-100 text-slate-700 border-slate-200" };
  }
}

export default function WorkflowsPage() {
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
  const [blueprintCategory, setBlueprintCategory] = useState<string>("all");

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

  const filteredBlueprints = useMemo(() => {
    if (blueprintCategory === "all") return BUSINESS_BLUEPRINTS;
    return BUSINESS_BLUEPRINTS.filter((b) => b.category === blueprintCategory);
  }, [blueprintCategory]);

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
      setError(e instanceof Error ? e.message : "Dry-run সম্পন্ন হয়নি");
    } finally {
      setIsDryRunning(false);
    }
  }

  async function runManual() {
    const orgId = getOrganizationId();
    if (!orgId || !testPanel) return;
    if (!window.confirm("এটি লাইভ Run — ধাপগুলো সত্যিই কার্যকর হবে (মেসেজ যাবে, Stage বদলাবে)। নিশ্চিতভাবে চালাতে চান?")) return;
    setError("");
    setIsManualRunning(true);
    try {
      const run = await apiFetch<Run>(`/organizations/${orgId}/workflows/${testPanel.workflowId}/run`, {
        method: "POST",
        body: JSON.stringify({ context: testContext() }),
      });
      setNotice(`Manual Run সম্পন্ন: ${run.status}`);
      setTestPanel(null);
      setTrace(null);
      await load();
      setActiveTab("runs");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run সম্পন্ন হয়নি");
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
      setNotice(`Retry সম্পন্ন: ${run.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry হয়নি");
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
      setNotice(`"${w.name}" সফলভাবে ${!w.enabled ? "চালু" : "বন্ধ"} করা হয়েছে।`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "স্ট্যাটাস পরিবর্তন ব্যর্থ হয়েছে");
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
        setNotice(`Workflow "${form.name}" আপডেট করা হয়েছে। চলমান Run গুলো আগের ধাপেই চলবে (Snapshot)।`);
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
        setNotice(`Workflow "${form.name}" তৈরি ও সক্রিয় করা হয়েছে।`);
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
        newStep = { type: "send_inbox_message", templateId: "", text: "আসসালামু আলাইকুম {{contactName}}..." };
        break;
      case "wait":
        newStep = { type: "wait", minutes: 60 };
        break;
      case "condition":
        newStep = { type: "condition", field: "total", op: "gte", value: "1000" };
        break;
      case "branch":
        newStep = { type: "branch", field: "total", op: "gte", value: "1000", then: [], else: [] };
        break;
      case "ai_generate":
        newStep = {
          type: "ai_generate",
          prompt: "গ্রাহকের জন্য একটি ব্যক্তিগত বার্তা লিখুন...",
          action: "add_conversation_note",
          outputField: "aiResult",
        };
        break;
      case "notify_channel":
        newStep = { type: "notify_channel", url: "", title: "🚨 সতর্কতা", text: "অর্ডার #{{orderNumber}} সম্পন্ন হয়েছে।" };
        break;
      case "notify_team":
        newStep = { type: "notify_team", role: "OWNER", title: "টিম অ্যালার্ট", text: "{{contactName}} এর অর্ডার দেখুন।" };
        break;
      case "assign_conversation":
        newStep = { type: "assign_conversation", userId: "" };
        break;
      case "change_lead_stage":
        newStep = { type: "change_lead_stage", stage: "qualified" };
        break;
      case "add_tag":
        newStep = { type: "add_tag", target: "lead", tag: "vip" };
        break;
      case "create_follow_up":
        newStep = { type: "create_follow_up", days: 3, text: "{{contactName}} এর ফলো-আপ" };
        break;
      case "http_webhook":
        newStep = { type: "http_webhook", url: "", secret: "" };
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
    setNotice(`"${name}" এর JSON ডাউনলোড হয়েছে!`);
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
          setNotice(`"${w.name}" এর JSON ক্লিপবোর্ডে কপি করা হয়েছে!`);
        })
        .catch(() => {
          downloadJson(w.name, jsonStr);
        });
    } else {
      downloadJson(w.name, jsonStr);
    }
  }

  function handleImportJson() {
    setError("");
    try {
      const parsed = JSON.parse(importText);
      if (!parsed.name || !parsed.trigger || !Array.isArray(parsed.steps)) {
        throw new Error("JSON এ 'name', 'trigger' এবং 'steps' থাকা আবশ্যক");
      }
      setEditingId(null);
      setForm({
        name: `${parsed.name} (ইমপোর্টেড)`,
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
      setNotice("Workflow JSON সফলভাবে লোড হয়েছে! নিচের ফর্মে যাচাই করে সংরক্ষণ করুন।");
      setEditorView("form");
      setActiveTab("builder");
    } catch (e) {
      setError(e instanceof Error ? e.message : "অবৈধ JSON");
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
      setNotice(`Preset "${name}" ইনস্টল হয়েছে — ড্রাফট হিসেবে বন্ধ অবস্থায় আছে, যাচাই করে চালু করুন।`);
      await load();
      setActiveTab("workflows");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ইনস্টল হয়নি");
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
      setNotice(`"${w.name}" এর নতুন ক্লোন তৈরি হয়েছে (নিরাপত্তার জন্য বন্ধ অবস্থায় আছে)।`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ক্লোন হয়নি");
    }
  }

  function loadBlueprint(bp: (typeof BUSINESS_BLUEPRINTS)[0]) {
    setEditingId(null);
    setForm({
      name: bp.name,
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
    setNotice(`"${bp.name}" ব্লুপ্রিন্ট সফলভাবে বিল্ডারে লোড হয়েছে! পর্যালোচনা করে সংরক্ষণ করুন।`);
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
    setCanvasNote(`আপনি বিদ্যমান Workflow "${w.name}" ক্যানভাসে সম্পাদনা করছেন — সেভ করলে এখানেই আপডেট হবে।`);
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
                ই-কমার্স, লিড ও কাস্টমার সাপোর্টের জন্য সুপার-ডাইনামিক অটোমেশন ও স্মার্ট রুলস ইঞ্জিন।
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
              setNotice("ডাটা রিফ্রেশ করা হয়েছে");
            }}
            title="রিফ্রেশ"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">রিফ্রেশ</span>
          </button>

          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setImportOpen(true)}
          >
            <svg className="h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>JSON ইমপোর্ট</span>
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
            <span>নতুন Workflow</span>
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
            <span className="stat-label">মোট ওয়ার্কফ্লো</span>
            <div className="stat-icon stat-icon-brand text-sm font-bold">⚡</div>
          </div>
          <div className="stat-value">{workflows.length}</div>
          <div className="stat-hint flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-emerald-700 font-semibold">{activeWorkflowsCount} সক্রিয়</span>
            <span>· {workflows.length - activeWorkflowsCount} ড্রাফট</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <span className="stat-label">৩০ দিনের অটো-রান</span>
            <div className="stat-icon stat-icon-green text-sm">🚀</div>
          </div>
          <div className="stat-value">{totalRuns30d.toLocaleString()}</div>
          <div className="stat-hint">স্বয়ংক্রিয় নির্বাহ ও প্রতিক্রিয়া</div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <span className="stat-label">গড় সাফল্যের হার</span>
            <div className="stat-icon stat-icon-sky text-sm">📈</div>
          </div>
          <div className="stat-value">{avgSuccessRate !== null ? `${avgSuccessRate}%` : "১০০%"}</div>
          <div className="stat-hint">ত্রুটিহীন নির্বাহের হার</div>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between">
            <span className="stat-label">ট্রিগার ইভেন্ট সাপোর্ট</span>
            <div className="stat-icon stat-icon-amber text-sm">🎯</div>
          </div>
          <div className="stat-value">{TRIGGERS.length}টি</div>
          <div className="stat-hint">অর্ডার, কার্ট, লিড ও চ্যাট</div>
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
          <span>⚡ ওয়ার্কফ্লো তালিকা</span>
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
          <span>🛠️ অটোমেশন বিল্ডার</span>
          {editingId ? (
            <span className="badge badge-amber">এডিট চলছে</span>
          ) : (
            <span className="badge badge-slate">নতুন</span>
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
          <span>📚 বিজনেস ব্লুপ্রিন্ট ও টেমপ্লেট</span>
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
          <span>📊 রান হিস্ট্রি ও লগ</span>
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
                  placeholder="নাম দিয়ে খুঁজুন (যেমন: বড় Order, ফলো-আপ, রিকভারি)..."
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
                  <option value="">সব ট্রিগার</option>
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
                    সব ({workflows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterStatus("active")}
                    className={`rounded-lg px-2.5 py-1.5 font-medium transition ${
                      filterStatus === "active" ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    সক্রিয় ({activeWorkflowsCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterStatus("inactive")}
                    className={`rounded-lg px-2.5 py-1.5 font-medium transition ${
                      filterStatus === "inactive" ? "bg-white text-slate-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    নিষ্ক্রিয় ({workflows.length - activeWorkflowsCount})
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Workflow Cards */}
          {filteredWorkflows.length === 0 ? (
            <div className="card p-8">
              <EmptyState
                title={workflows.length === 0 ? "কোনো Workflow নেই" : "কোনো ফলাফল পাওয়া যায়নি"}
                description={
                  workflows.length === 0
                    ? "উপরে 'নতুন Workflow' বাটনে ক্লিক করে অথবা 'বিজনেস ব্লুপ্রিন্ট' থেকে ১-ক্লিকে প্রথম অটোমেশন তৈরি করুন।"
                    : "অনুসন্ধানের শর্ত অনুযায়ী কোনো Workflow মেলেনি। ফিল্টার রিসেট করুন।"
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
                  category: "ইভেন্ট",
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
                              <span className="badge badge-green">🟢 সক্রিয়</span>
                            ) : (
                              <span className="badge badge-slate">⚪ নিষ্ক্রিয়</span>
                            )}
                          </div>

                          <h3 className="text-base font-bold text-slate-900 sm:text-lg">{w.name}</h3>
                        </div>

                        {/* Status Toggle Switch */}
                        <div className="flex items-center gap-3 self-end sm:self-auto">
                          <span className="text-xs font-medium text-slate-500">
                            {w.enabled ? "সক্রিয়" : "বন্ধ"}
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
                          পাইপলাইন ফ্লো
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
                                    : `${w.conditions.length}টি শর্ত`}
                                </span>
                              </div>
                            </>
                          )}

                          {/* Steps preview */}
                          {w.steps.map((stStep, idx) => {
                            const meta = getStepMeta(stStep.type);
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
                              📊 ৩০ দিনে {st.runs30d} রান ·{" "}
                              <span className={st.successRate !== null && st.successRate >= 90 ? "text-emerald-600 font-semibold" : ""}>
                                {st.successRate !== null ? `${st.successRate}% সাফল্য` : "সাফল্যের হার নেই"}
                              </span>
                              {st.lastRunAt && (
                                <span className="text-slate-400">
                                  · শেষ রান: {new Date(st.lastRunAt).toLocaleDateString()}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span>📊 ৩০ দিনে কোনো রান নেই</span>
                          )}

                          {w.cooldownMinutes ? (
                            <span className="badge badge-slate">⏱️ ব্যবধান: {w.cooldownMinutes} মি.</span>
                          ) : null}

                          {w.dailyRunCap != null ? (
                            <span className="badge badge-slate">🎯 দৈনিক সীমা: {w.dailyRunCap}</span>
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
                            title="টেস্ট ও Dry-run"
                          >
                            🧪 টেস্ট / চালান
                          </button>

                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => loadForEdit(w)}
                            title="ফর্মে সম্পাদনা করুন"
                          >
                            ✏️ এডিট
                          </button>

                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => openInCanvas(w)}
                            title="ভিজ্যুয়াল ক্যানভাসে খুলুন"
                          >
                            🎨 ক্যানভাস
                          </button>

                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => exportWorkflow(w)}
                            title="JSON হিসেবে এক্সপোর্ট বা কপি করুন"
                          >
                            📋 এক্সপোর্ট
                          </button>

                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => cloneWorkflow(w)}
                            title="অনুরূপ আরেকটি কপি বানান"
                          >
                            📑 ক্লোন
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
                  {editingId ? "✏️ বিদ্যমান Workflow সম্পাদনা" : "🛠️ নতুন Workflow বিল্ডার"}
                </h2>
                <p className="text-xs text-slate-500">
                  {editingId
                    ? "সতর্কতা: আপডেট সেভ করলে ইতিমধ্যে শুরু হওয়া রানগুলো আগের স্ন্যাপশটেই শেষ হবে।"
                    : "ইভেন্ট নির্ধারণ করুন, শর্ত সেট করুন এবং ক্রমান্বয়ে পদক্ষেপগুলো সাজান।"}
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
                    📝 সাধারণ ফর্ম
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-1.5 transition ${
                      editorView === "canvas" ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                    onClick={() => setEditorView("canvas")}
                  >
                    🎨 ভিজ্যুয়াল ক্যানভাস
                  </button>
                </div>

                {editingId && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm text-red-600 hover:bg-red-50"
                    onClick={() => resetForm()}
                  >
                    ✕ বাতিল
                  </button>
                )}
              </div>
            </div>

            {/* Smart Dynamic Variables Quick Guide */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-slate-600">⚡ ব্যবহারযোগ্য স্মার্ট ভ্যারিয়েবল:</span>
              {DYNAMIC_VARIABLES.slice(0, 7).map((v) => (
                <span
                  key={v.tag}
                  className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700 border border-slate-200"
                  title={v.label}
                >
                  {v.tag}
                </span>
              ))}
              <span className="text-[11px] text-slate-400">ইত্যাদি (মেসেজ বক্সে ক্লিক করে সরাসরি বসানো যায়)</span>
            </div>
          </div>

          {/* Form Mode View */}
          {editorView === "form" && (
            <form onSubmit={createWorkflow} className="space-y-6">
              {/* Card 1: Basic Info & Trigger */}
              <div className="card p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700">
                    ১
                  </span>
                  <h3 className="font-bold text-slate-900">মৌলিক তথ্য ও ইভেন্ট ট্রিগার</h3>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Workflow এর নাম *
                    </label>
                    <input
                      className={inputCls}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                      placeholder="যেমন: বড় অর্ডারে বিশেষ ধন্যবাদ ও SMS"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      ইভেন্ট ট্রিগার *
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
                      ২
                    </span>
                    <div>
                      <h3 className="font-bold text-slate-900">ট্রিগার শর্তসমূহ (Multi-Conditions Filter)</h3>
                      <p className="text-xs text-slate-500">
                        নির্ধারিত শর্তগুলো সত্য হলেই কেবল এই ফ্লো চলবে (AND শর্ত যুক্তি)।
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn-secondary btn-sm self-start sm:self-auto"
                    onClick={() => setFormConditions([...formConditions, { field: "total", op: "gte", value: "1000" }])}
                  >
                    + কাস্টম শর্ত যোগ করুন
                  </button>
                </div>

                {/* Contextual Quick Condition Suggestions based on selected trigger */}
                {TRIGGER_SUGGESTIONS[form.trigger] && TRIGGER_SUGGESTIONS[form.trigger].length > 0 && (
                  <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3">
                    <div className="text-xs font-semibold text-amber-900 mb-1.5">
                      💡 নির্বাচিত ট্রিগারের জন্য দ্রুত প্রস্তাবিত শর্ত (১-ক্লিকে যোগ করুন):
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {TRIGGER_SUGGESTIONS[form.trigger].map((sug, sIdx) => (
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
                    কোনো শর্ত যোগ করা হয়নি — নির্বাচিত ট্রিগার ঘটলেই এই Workflow সরাসরি কার্যকর হবে।
                  </div>
                ) : (
                  <div className="space-y-3">
                    {formConditions.map((cond, idx) => (
                      <div
                        key={idx}
                        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 shadow-sm"
                      >
                        <div className="min-w-[180px] flex-1">
                          <label className="block text-xs font-semibold text-slate-600">ফিল্ড (Field)</label>
                          <select
                            className={inputCls}
                            value={cond.field}
                            onChange={(e) => {
                              const next = [...formConditions];
                              next[idx].field = e.target.value;
                              setFormConditions(next);
                            }}
                          >
                            {CONDITION_FIELDS.map((f) => (
                              <option key={f.value} value={f.value}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="w-36">
                          <label className="block text-xs font-semibold text-slate-600">অপারেটর (Operator)</label>
                          <select
                            className={inputCls}
                            value={cond.op}
                            onChange={(e) => {
                              const next = [...formConditions];
                              next[idx].op = e.target.value;
                              setFormConditions(next);
                            }}
                          >
                            {CONDITION_OPERATORS.map((op) => (
                              <option key={op.value} value={op.value}>
                                {op.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="min-w-[160px] flex-1">
                          <label className="block text-xs font-semibold text-slate-600">তুলনা মান (Value)</label>
                          <input
                            className={inputCls}
                            value={cond.value}
                            placeholder="1000 বা qualified বা complaint"
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
                          title="শর্ত মুছুন"
                        >
                          মুছুন
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
                      ৩
                    </span>
                    <div>
                      <h3 className="font-bold text-slate-900">অটোমেশন পদক্ষেপসমূহ (Steps Pipeline)</h3>
                      <p className="text-xs text-slate-500">
                        ক্রমান্বয়ে এক্সিকিউট হওয়া ধাপগুলো সাজান। প্রতিটি ধাপে ডাইনামিক ভ্যারিয়েবল ব্যবহার করতে পারেন।
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {steps.map((s, i) => {
                    const meta = getStepMeta(s.type);
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
                                title="উপরে তুলুন"
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
                                title="নিচে নামান"
                              >
                                ↓
                              </button>
                            )}

                            {steps.length > 1 && (
                              <button
                                type="button"
                                className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                                onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                                title="ধাপটি মুছুন"
                              >
                                ধাপ মুছুন
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
                    + পরবর্তী পদক্ষেপ যোগ করুন (যেটি প্রয়োজন ক্লিক করুন):
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
                      💬 Inbox বার্তা
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("wait")}
                    >
                      ⏱️ অপেক্ষা (Wait)
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("branch")}
                    >
                      🔀 শাখা (Branch)
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("ai_generate")}
                    >
                      🤖 AI অ্যাকশন
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("notify_channel")}
                    >
                      📢 চ্যানেল অ্যালার্ট
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => addStepByType("notify_team")}
                    >
                      👥 টিমকে জানান
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
                    ৪
                  </span>
                  <div>
                    <h3 className="font-bold text-slate-900">গভর্ন্যান্স ও অটো-রান সীমা (Governance & Safety)</h3>
                    <p className="text-xs text-slate-500">
                      গ্রাহকের কাছে অতিরিক্ত বা অপ্রয়োজনীয় মেসেজ যাওয়া রোধ করতে সীমা নির্ধারণ করুন।
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Cooldown ব্যবধান (মিনিটে, ঐচ্ছিক)
                    </label>
                    <input
                      className={inputCls}
                      type="number"
                      min={0}
                      max={10080}
                      value={form.cooldown}
                      onChange={(e) => setForm({ ...form, cooldown: e.target.value })}
                      placeholder="0 = কোনো ব্যবধান নেই"
                    />
                    <span className="mt-1 block text-xs text-slate-400">
                      একই গ্রাহক বা লিডের জন্য পরপর রান হওয়ার মধ্যবর্তী ন্যূনতম সময়।
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      দৈনিক সর্বোচ্চ রান সীমা (ঐচ্ছিক)
                    </label>
                    <input
                      className={inputCls}
                      type="number"
                      min={1}
                      max={10000}
                      value={form.cap}
                      onChange={(e) => setForm({ ...form, cap: e.target.value })}
                      placeholder="খালি = সীমাহীন"
                    />
                    <span className="mt-1 block text-xs text-slate-400">
                      ২৪ ঘণ্টায় মোট সর্বোচ্চ রান। সীমা পেরোলে অতিরিক্ত রানগুলো Skipped হবে।
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
                  বাতিল করুন
                </button>

                <button
                  type="submit"
                  className="btn-primary"
                  disabled={busy !== ""}
                >
                  {busy ? "সংরক্ষণ হচ্ছে..." : editingId ? "আপডেট সংরক্ষণ করুন" : "Workflow তৈরি ও সক্রিয় করুন"}
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
      {/* TAB 3: BUSINESS BLUEPRINTS & PRESETS GALLERY                   */}
      {/* ============================================================== */}
      {activeTab === "presets" && (
        <div className="space-y-6">
          <div className="card p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">📚 রেডিমেড বিজনেস ব্লুপ্রিন্ট ও টেমপ্লেট</h2>
                <p className="text-sm text-slate-500">
                  যেকোনো ব্যবসা প্রতিষ্ঠানের জন্য তৈরি সম্পূর্ণ কার্যক্ষম অটোমেশন — ১-ক্লিকে বিল্ডারে লোড বা সরাসরি ইনস্টল করুন।
                </p>
              </div>

              {/* Blueprint Category Pills */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setBlueprintCategory("all")}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                    blueprintCategory === "all" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  সব ({BUSINESS_BLUEPRINTS.length})
                </button>
                <button
                  type="button"
                  onClick={() => setBlueprintCategory("ecommerce")}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                    blueprintCategory === "ecommerce" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  🛍️ ই-কমার্স
                </button>
                <button
                  type="button"
                  onClick={() => setBlueprintCategory("leads")}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                    blueprintCategory === "leads" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  👥 লিড ও সিআরএম
                </button>
                <button
                  type="button"
                  onClick={() => setBlueprintCategory("support")}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                    blueprintCategory === "support" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  💬 সাপোর্ট ও AI
                </button>
                <button
                  type="button"
                  onClick={() => setBlueprintCategory("alerts")}
                  className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                    blueprintCategory === "alerts" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  📢 চ্যানেল অ্যালার্ট
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Business Blueprints */}
            {filteredBlueprints.map((bp) => {
              const tr = TRIGGERS.find((t) => t.value === bp.trigger);
              return (
                <div
                  key={bp.key}
                  className="card card-hover p-5 border border-slate-200 flex flex-col justify-between"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="badge badge-brand">{bp.catLabel}</span>
                      <span className="badge badge-slate">{tr?.icon} {tr?.label}</span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900">{bp.name}</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">{bp.descriptionBn}</p>

                    <div className="rounded-xl bg-slate-50 p-2.5 text-xs text-slate-700 border border-slate-100 font-mono space-y-1">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ধাপসমূহের ফ্লো:</div>
                      <div className="line-clamp-2">
                        {bp.steps.map((st) => getStepMeta(st.type).label).join(" ➔ ")}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t flex gap-2">
                    <button
                      type="button"
                      className="btn-primary btn-sm flex-1"
                      onClick={() => loadBlueprint(bp)}
                    >
                      🛠️ বিল্ডারে লোড করুন
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Server-Provided Presets */}
            {presets.map((p) => (
              <div key={p.key} className="card card-hover p-5 border border-slate-200 flex flex-col justify-between">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="badge badge-green">সার্ভার প্রিসেট</span>
                    <span className="text-lg">⚡</span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900">{p.name}</h3>
                  <p className="text-xs text-slate-500 leading-relaxed">{p.descriptionBn}</p>
                </div>

                <div className="mt-4 pt-3 border-t flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary btn-sm flex-1"
                    onClick={() => installPreset(p.key, p.name)}
                  >
                    ১-ক্লিকে ইনস্টল
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
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
                <h3 className="font-bold text-slate-900">সাম্প্রতিক Workflow Runs</h3>
                <p className="text-xs text-slate-500">লাইভ এক্সিকিউশন স্টেটাস ও প্রতিটি ধাপের বিস্তারিত লগ</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input !mt-0 !w-auto text-xs sm:text-sm"
                  value={runFilter.workflowId}
                  onChange={(e) => setRunFilter({ ...runFilter, workflowId: e.target.value })}
                >
                  <option value="">সব Workflow</option>
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
                  <option value="">সব Status</option>
                  <option value="completed">completed (সফল)</option>
                  <option value="failed">failed (ব্যর্থ)</option>
                  <option value="waiting">waiting (অপেক্ষমাণ)</option>
                  <option value="skipped">skipped (স্কিপড)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Runs Feed */}
          {runs.length === 0 ? (
            <div className="card p-8">
              <EmptyState
                title="এখনো কোনো Run রেকর্ড নেই"
                description="যখন কোনো ইভেন্ট ঘটবে অথবা আপনি ম্যানুয়াল টেস্ট করবেন, তখন এখানে রানের ফলাফল দৃশ্যমান হবে।"
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
                  statusLabel = "completed (সফল)";
                } else if (r.status === "waiting") {
                  statusBadgeCls = "badge-amber";
                  statusLabel = "waiting (অপেক্ষমাণ)";
                } else if (r.status === "failed") {
                  statusBadgeCls = "badge-red";
                  statusLabel = "failed (ব্যর্থ)";
                } else if (r.status === "skipped") {
                  statusBadgeCls = "badge-slate";
                  statusLabel = "skipped (স্কিপড)";
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
                            ↻ আবার চেষ্টা
                          </button>
                        )}

                        {r.stepsLog && r.stepsLog.length > 0 && (
                          <button
                            type="button"
                            className="rounded-lg border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                            onClick={() => setExpandedRunId(isExpanded ? null : r.id)}
                          >
                            {isExpanded ? "লগ লুকান ▲" : `লগ দেখুন (${r.stepsLog.length} ধাপ) ▼`}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Error Banner */}
                    {r.error && (
                      <div className="mt-2.5 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
                        <b>ত্রুটি:</b> {r.error}
                      </div>
                    )}

                    {/* Step Execution Logs */}
                    {isExpanded && r.stepsLog && (
                      <div className="mt-3 space-y-1.5 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs">
                        <div className="font-semibold text-slate-700">এক্সিকিউশন ধাপসমূহ:</div>
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
                <h3 className="font-bold text-slate-900 text-lg">টেস্ট ও Dry-run — {testPanel.name}</h3>
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

            <p className="text-xs text-slate-500">
              কোন প্রেক্ষাপটে টেস্ট করতে চান তা উল্লেখ করুন (ঐচ্ছিক)। <b>Dry-run</b> এ কোনো এসএমএস বা ইমেইল পাঠানো হয় না — শুধু শর্ত যাচাই ও লজিক সিমুলেট করে।
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-600">Lead ID</label>
                <input
                  className={inputCls}
                  value={testCtx.leadId}
                  onChange={(e) => setTestCtx({ ...testCtx, leadId: e.target.value })}
                  placeholder="যেমন: lead_123"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600">Customer ID</label>
                <input
                  className={inputCls}
                  value={testCtx.customerId}
                  onChange={(e) => setTestCtx({ ...testCtx, customerId: e.target.value })}
                  placeholder="যেমন: cust_456"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600">Conversation ID</label>
                <input
                  className={inputCls}
                  value={testCtx.conversationId}
                  onChange={(e) => setTestCtx({ ...testCtx, conversationId: e.target.value })}
                  placeholder="যেমন: conv_789"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600">Order ID</label>
                <input
                  className={inputCls}
                  value={testCtx.orderId}
                  onChange={(e) => setTestCtx({ ...testCtx, orderId: e.target.value })}
                  placeholder="যেমন: ord_101"
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
                {isDryRunning ? "সিমুলেট হচ্ছে..." : "🧪 Dry-run (নিরাপদ সিমুলেশন)"}
              </button>
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={isManualRunning}
                onClick={runManual}
              >
                {isManualRunning ? "চালানো হচ্ছে..." : "▶️ আসল Run (লাইভ প্রয়োগ)"}
              </button>
            </div>

            {/* Dry-run trace result */}
            {trace && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">ফলাফল:</span>
                  {trace.conditionsPassed ? (
                    <span className="badge badge-green">✅ সব শর্ত মিলেছে — ফ্লো চলবে</span>
                  ) : (
                    <span className="badge badge-amber">⚠️ শর্ত মেলেনি — Run Skipped হতো</span>
                  )}
                </div>

                {trace.conditionsPassed && trace.trace && trace.trace.length > 0 && (
                  <div className="mt-2 space-y-1.5 text-xs">
                    <div className="font-semibold text-slate-700">ধাপসমূহের ট্রেস:</div>
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
                <h3 className="font-bold text-slate-900 text-lg">Workflow JSON ইমপোর্ট</h3>
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
              পূর্বে এক্সপোর্ট করা কোনো Workflow এর সম্পূর্ণ JSON কোড এখানে পেস্ট করুন:
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
                বাতিল
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleImportJson}
              >
                ইমপোর্ট ও বিল্ডারে লোড করুন
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
