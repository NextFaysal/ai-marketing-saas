"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { smsSegments } from "@/lib/sms-segments";
import { couponSnippetHtml, couponSnippetText } from "@/lib/composer-blocks";
import { blockLabelsFor, cleanBlock, moveBlock, newEmailBlock, type EmailBlock, type EmailBlockType } from "@/lib/email-blocks";
import dynamic from "next/dynamic";
import { EmptyState } from "@repo/ui";

const FestivalBlastHub = dynamic(
  () => import("./FestivalBlastHub").then((m) => m.FestivalBlastHub),
  { ssr: false }
);
import { useLocale } from "@/lib/i18n/provider";
import { messagingBn, messagingEn } from "@/lib/i18n/messaging";
import { fmtNumber, fmtMoney, fmtMoneyMinor, fmtDate, fmtDateTime } from "@repo/contracts";

const MD = (locale?: string) => (locale === "en" ? messagingEn : messagingBn);
type MsgKey = keyof typeof messagingBn;
const JOURNEY_STEP_KEY: Record<string, MsgKey> = { wait: "msgStepWait", send_email: "msgStepEmail", send_sms: "msgStepSms", condition: "msgStepCondition", branch: "msgStepBranch", add_tag: "msgStepTag" };
function journeyStepLabelsFor(locale: string): Record<string, string> {
  const out: Record<string, string> = { ...JOURNEY_STEP_LABEL };
  for (const [k, key] of Object.entries(JOURNEY_STEP_KEY)) out[k] = MD(locale)[key];
  return out;
}
const JOURNEY_ADDABLE_KEY: Record<string, MsgKey> = { wait: "msgStepWaitShort", send_email: "msgStepEmailShort", send_sms: "msgStepSmsShort", condition: "msgStepConditionShort", branch: "msgStepBranchShort", add_tag: "msgStepTagShort" };
function journeyAddableFor(locale: string): typeof JOURNEY_ADDABLE {
  return JOURNEY_ADDABLE.map((a) => (JOURNEY_ADDABLE_KEY[a.type] ? { ...a, label: MD(locale)[JOURNEY_ADDABLE_KEY[a.type]] } : a));
}
const FIELD_LABEL_KEY: Record<string, MsgKey> = { source: "msgFieldSource", created_days_ago: "msgFieldCreatedDays", has_email: "msgFieldHasEmail", has_phone: "msgFieldHasPhone", custom_field: "msgFieldCustom", engagement_score: "msgFieldEngagement", predictive_segment: "msgFieldPredictive", orders_count: "msgFieldOrderCount", total_spent_minor: "msgFieldTotalSpent", last_order_days_ago: "msgFieldLastOrderDays", address_key: "msgFieldAddressPart", tag: "msgFieldTag", value_minor: "msgFieldLeadValue" };
function fieldDefsFor(defs: FieldDef[], locale: string): FieldDef[] {
  return defs.map((d) => (FIELD_LABEL_KEY[d.field] ? { ...d, label: MD(locale)[FIELD_LABEL_KEY[d.field]] } : d));
}
const OP_KEY: Record<string, MsgKey> = { eq: "msgOpEq", neq: "msgOpNeq", gt: "msgOpGt", gte: "msgOpGte", lt: "msgOpLt", lte: "msgOpLte", contains: "msgOpContains" };
function opLabelsFor(locale: string): Record<string, string> {
  const out: Record<string, string> = { ...OP_LABEL };
  for (const [k, key] of Object.entries(OP_KEY)) out[k] = MD(locale)[key];
  return out;
}
function predictiveLabelsFor(locale: string): Record<string, string> {
  const suffix = MD(locale).msgRuleEstimateSuffix;
  return { churn_risk: `Churn Risk ${suffix}`, likely_to_buy: `Likely to Buy ${suffix}`, high_ltv: `High LTV ${suffix}` };
}
const TAB_LABEL_KEY: Record<string, MsgKey> = { campaigns: "msgTabCampaigns", templates: "msgTabTemplates", channels: "msgTabWhatsApp", growth: "msgTabGrowth", insights: "msgTabAnalytics", settings: "msgTabSender" };
function msgTabsFor(locale: string) {
  return MSG_TABS.map((tb) => (TAB_LABEL_KEY[tb.id] ? { ...tb, label: MD(locale)[TAB_LABEL_KEY[tb.id]] } : tb));
}

interface Template { id: string; name: string; channel: string; subject?: string | null; body: string; htmlBody?: string | null; blocks?: EmailBlock[] | null; version?: number }
// MX7: builder support shapes (brand kit comes from Org Settings
// branding via the API; discounts are real StoreDiscount rows).
interface BrandKit { brandName: string | null; logoUrl: string | null; primaryColor: string | null; secondaryColor: string | null; font: string | null }
interface ComposerDiscount { id: string; code: string; kind: string; value: number; minOrderMinor?: string | null; endsAt?: string | null }
interface ContentBlock { id: string; name: string; kind: string; data: EmailBlock; createdAt: string }
interface TemplateVersion { id: string; templateId: string; version: number; name: string; subject?: string | null; body: string; createdAt: string }
interface FestivalPack { key: string; name: string; nameBn: string; subject: string; blocks: EmailBlock[] }
interface BlocksPreview { htmlBody: string; body: string; emptySlots: { index: number; type: string; reason: string }[] }
// MS5: composer support types. The variables list is fetched from
// the API's GET messaging/variables (the API builds snapshot vars
// from the same constant — nothing here is a second source).
type TemplateVariables = Record<"customer" | "lead" | "csv", { key: string; labelBn: string }[]>;
interface ComposerProduct { id: string; name: string; priceMinor: string; currency: string; imageUrl?: string | null; url: string | null; snippetText: string; snippetHtml: string }
interface TestSendResult { status: string; providerMessageId?: string; error?: string; address: string }
interface ComposeWarning { code: string; message: string }
// MS6: WhatsApp template hub types (rows come from the inbox
// whatsapp-templates endpoint — full local rows incl. Meta state).
interface WaTemplate { id: string; name: string; language: string; category?: string | null; bodyText?: string | null; status?: string | null; qualityRating?: string | null; components?: unknown; lastSyncedAt?: string | null }
interface WaButtonRow { subType: "url" | "quick_reply"; text: string; payload: string }
// MX9: one carousel card in the submit form (media header handle
// comes from Meta's Resumable Upload, exactly like the image
// header — the app cannot upload example media itself).
interface WaCardRow { headerFormat: "image" | "video"; headerHandle: string; bodyText: string; exampleValues: string; btn1Type: "url" | "quick_reply" | ""; btn1Text: string; btn1Url: string; btn2Type: "url" | "quick_reply" | ""; btn2Text: string; btn2Url: string }
// MX10: growth tool shapes (rows come from the API verbatim).
interface OptInForm { id: string; name: string; slug: string; channels: string[]; topic?: string | null; doubleOptIn: boolean; keyword?: string | null; enabled: boolean; joinUrl: string; popup?: { enabled?: boolean; delaySeconds?: number } | null }
interface CsvImportRow { row: number; name: string; email: string; phone: string; address: string; status: string; reason?: string; reasonText?: string }
interface CsvImportPreview { importId: string; headers: string[]; totalRows: number; cleanCount: number; duplicateCount: number; invalidCount: number; roleCount: number; rows: CsvImportRow[] }
interface ConsentEvent { id: string; channel: string; address: string; fromStatus?: string | null; toStatus: string; source: string; actor: string; createdAt: string }
// MX9: template kind from the REAL stored components (mirrors the
// API's whatsapp-rich classification) — display only.
function waTemplateKind(t: WaTemplate): "carousel" | "catalog" | "flow" | "standard" {
  const comps = Array.isArray(t.components) ? (t.components as Record<string, unknown>[]) : [];
  let catalog = false; let flow = false;
  const scan = (buttons: unknown) => {
    if (!Array.isArray(buttons)) return;
    for (const b of buttons as Record<string, unknown>[]) {
      const ty = String(b?.type ?? "").toUpperCase();
      if (ty === "CATALOG") catalog = true;
      if (ty === "FLOW" || b?.flow_id != null || b?.flow_name != null) flow = true;
    }
  };
  for (const c of comps) {
    const ty = String(c?.type ?? "").toUpperCase();
    if (ty === "CAROUSEL") return "carousel";
    if (ty === "CATALOG") catalog = true;
    if (ty === "BUTTONS") scan(c.buttons);
  }
  return catalog ? "catalog" : flow ? "flow" : "standard";
}
// MX9: the per-message figure for one template — ONLY from the
// org's own entered rates (category rate first, flat fallback).
// Null = no figure is shown, with the "rate not set" note.
function waTemplateRateMinor(t: WaTemplate, rates: SenderSettings["rates"] | undefined): { minor: number; basis: "category" | "flat" } | null {
  if (!rates) return null;
  const cat = t.category === "MARKETING" ? rates.whatsappMarketingCostPerMessageMinor
    : t.category === "UTILITY" ? rates.whatsappUtilityCostPerMessageMinor
    : t.category === "AUTHENTICATION" ? rates.whatsappAuthenticationCostPerMessageMinor : null;
  if (cat !== null && cat !== undefined) return { minor: cat, basis: "category" };
  if (rates.whatsappCostPerMessageMinor !== null && rates.whatsappCostPerMessageMinor !== undefined) return { minor: rates.whatsappCostPerMessageMinor, basis: "flat" };
  return null;
}
interface MessagingIntegration { id: string; provider: string; status: string; wabaId?: string | null }
interface BroadcastProgress { total: number; sent: number; failed: number; skipped: number; pending: number }
interface Broadcast { id: string; name: string; channel: string; approvalStatus?: string | null; abAutoWinnerEnabled?: boolean | null; abWinnerVariant?: string | null; abWinnerAt?: string | null; abWinnerDetail?: AbWinnerDetail | null; approvalNote?: string | null; approvedById?: string | null; budgetCapMinor?: number | null; pushUrl?: string | null; telegramButtons?: { label: string; url: string }[] | null; onsiteUrl?: string | null; status: string; totalRecipients: number; sentCount: number; failedCount: number; audienceType: string; audienceStage?: string | null; audienceSegment?: string | null; audienceSavedId?: string | null; abVariant?: string | null; abGroupId?: string | null; excludePreviousRecipients?: boolean; sentAt?: string | null; scheduledAt?: string | null; progress?: BroadcastProgress; recurrence?: Recurrence | null; recurrenceGroupId?: string | null; subject?: string | null; body: string; htmlBody?: string | null; templateId?: string | null; whatsappTemplateId?: string | null; templateParams?: string[] | null; archivedAt?: string | null }
// MS9: AI draft + deterministic suggestion shapes. Drafts are
// returned only — the composer fills its fields on click.
interface AiDraftVariant { subject?: string; body: string; smsParts?: number }
interface AiDraftResult { variants: AiDraftVariant[]; providerLabel: string; isRealLlm: boolean; notice?: string }
interface AiSubjectsResult { variants: string[]; providerLabel: string; isRealLlm: boolean; notice?: string }
interface SendTimeSuggestion { available: boolean; totalEvents: number; minEvents?: number; reason?: string; bestHours?: { hour: number; events: number }[]; method?: string }
interface SegmentSuggestion { kind: string; audienceType?: string; audienceSegment?: string; size: number; reason: string }
// MS8: recurrence shape (validated strictly server-side).
interface Recurrence { freq: "daily" | "weekly"; interval: number; weekdays?: number[]; endsAt?: string }
// MS7: the per-broadcast report. A null funnel stage means the
// channel cannot produce that signal — never a fake zero.
interface BroadcastFunnel { audience: number; sent: number; failed: number; skipped: number; delivered: number | null; read: number | null; opened: number | null; clickedRecipients: number | null; totalClicks: number | null; failureReasons: { reason: string; count: number }[] }
interface BroadcastReport {
  broadcast: { id: string; name: string; channel: string; status: string; abVariant: string | null; abGroupId: string | null; sentAt: string | null; scheduledAt: string | null; recurrence: Recurrence | null; recurrenceGroupId: string | null };
  funnel: BroadcastFunnel;
  failureReasons: { reason: string; count: number }[];
  revenue: { windowDays: number; orders: number; totalMinor: string; customerRecipients: number; method: string } | null;
  replies: number | null;
  repliesMethod: string;
  ab: { groupId: string; variants: Record<string, BroadcastFunnel>; suggestion: { basis: string | null; leader: string | null; note: string }; autoWinner?: { enabled: boolean; winner: string | null; decidedAt: string | null; detail: AbWinnerDetail | null; rule: string; scopeNote: string } } | null;
  // MX11: holdout section (present only on broadcasts that set one).
  holdout?: { percent: number; heldOutCount: number; label: string };
  // MX2: cascade attempt breakdown (null for single-channel broadcasts).
  cascade: {
    config: { channels: string[]; smartRouting: boolean; ordering: string } | null;
    channels: { channel: string; attempts: number; sent: number; failed: number; skipped: number; finalSuccesses: number }[];
    chains: { key: string; attempts: { channel: string; status: string; attemptIndex: number | null; error: string | null }[]; finalChannel: string | null; finalStatus: string }[];
    breakerEvents: { gatewayKey: string; failures: number; at: string }[];
    skippedChannels: { channel: string; reason: string }[];
    ratesMissing: string[];
    ratesNote?: string;
  } | null;
}
// MS8: a messaging journey preset (installed via the real
// WorkflowsService path; starts disabled for human review).
interface JourneyPreset { key: string; name: string; descriptionBn: string; flow: string; trigger: string; channel?: string; templateName?: string; version?: number; stepsCount?: number; channels?: string[]; templates?: { slot: string; channel: string; name: string }[]; exitOnPurchase?: boolean }
// MX5: presets deliberately NOT built — shown greyed with the honest reason.
interface UnavailableJourneyPreset { key: string; name: string; reasonBn: string }
// MX4: messaging journeys — the visual builder over the REAL
// Workflows engine (a journey IS a workflow with journey meta;
// definitions are engine definitions, no second engine).
interface JourneyStep { type: string; minutes?: number; templateId?: string; field?: string; op?: string; value?: unknown; tag?: string; target?: string; then?: JourneyStep[]; else?: JourneyStep[] }
interface JourneyRunSummary { total: number; waiting: number; completed: number; failed: number; skipped: number }
interface Journey { id: string; name: string; trigger: string; steps: JourneyStep[]; enabled: boolean; journey?: { origin?: string; exitOnPurchase?: boolean } | null; runSummary?: JourneyRunSummary }
interface JourneyMeta { triggers: { trigger: string; labelBn: string }[]; conditionFields: { field: string; labelBn: string; ops: string[]; kind: string }[]; stepTypes: { type: string; labelBn: string }[] }
interface JourneyStepStat { idx: number; type: string; entered: number; ok: number; skipped: number; failed: number; waitingHere: number | null; delivery: { sent: number; failed: number; skipped: number; opened: number } | null }
interface JourneyDetail { workflow: Journey; runSummary: JourneyRunSummary; stepStats: JourneyStepStat[]; legacyRunCount: number; totalClicks: number; recentRuns: { id: string; status: string; trigger: string; createdAt: string }[] }
const JOURNEY_STEP_LABEL: Record<string, string> = { wait: "⏳ অপেক্ষা", send_email: "✉️ ইমেইল পাঠান", send_sms: "📩 SMS পাঠান", condition: "🔀 শর্ত", branch: "🌿 শাখা (Branch)", add_tag: "🏷️ ট্যাগ যোগ" };
const JOURNEY_ADDABLE: { type: string; label: string }[] = [
  { type: "wait", label: "অপেক্ষা" }, { type: "send_email", label: "ইমেইল পাঠান" }, { type: "send_sms", label: "SMS পাঠান" },
  { type: "condition", label: "শর্ত" }, { type: "branch", label: "শাখা (branch)" }, { type: "add_tag", label: "ট্যাগ যোগ" },
];
interface CostEstimate { currency: string; smsParts?: number; totalMinor?: number; basis: string }
interface BroadcastPreview { audienceTotal: number; excludedPreviousCount: number; excludedSuppressedCount: number; excludedFrequencyCount: number; excludedNoOptInCount: number; invalidCount?: number; excludedHoldoutCount?: number; costEstimate?: CostEstimate | null; total: number; sample: { type: string; name: string; address: string }[] }
// MS3: saved audience + the builder's condition vocabulary (mirrors
// the API's audience-rules module — the server validates strictly).
interface SavedAudience { id: string; name: string; definition: { entity: string; match: string; conditions: unknown[] }; createdAt: string }
interface CondRow { field: string; op: string; key: string; value: string }
interface FieldDef { field: string; label: string; ops: string[]; kind: "string" | "number" | "boolean" | "segment" | "stage" | "keyed" | "predictive" }
// MX11: rule-based predictive segments (deterministic rules over
// real records — labelled "rule-based estimate" everywhere).
const PREDICTIVE_SEGMENTS = ["churn_risk", "likely_to_buy", "high_ltv"] as const;
const PREDICTIVE_LABEL: Record<string, string> = { churn_risk: "Churn Risk (নিয়ম-ভিত্তিক অনুমান)", likely_to_buy: "Likely to Buy (নিয়ম-ভিত্তিক অনুমান)", high_ltv: "High LTV (নিয়ম-ভিত্তিক অনুমান)" };
const COMMON_FIELD_DEFS: FieldDef[] = [
  { field: "source", label: "উৎস (Source)", ops: ["eq", "neq"], kind: "string" },
  { field: "created_days_ago", label: "তৈরি হয়েছে (দিন আগে)", ops: ["gte", "lte", "gt", "lt"], kind: "number" },
  { field: "has_email", label: "ইমেইল ঠিকানা আছে", ops: ["eq"], kind: "boolean" },
  { field: "has_phone", label: "ফোন নম্বর আছে", ops: ["eq"], kind: "boolean" },
  { field: "custom_field", label: "কাস্টম ফিল্ড", ops: ["eq", "contains"], kind: "keyed" },
  { field: "engagement_score", label: "Engagement Score (0–100, নিয়ম-ভিত্তিক)", ops: ["eq", "gte", "lte", "gt", "lt"], kind: "number" },
  { field: "predictive_segment", label: "Predictive Segment (নিয়ম-ভিত্তিক অনুমান)", ops: ["eq"], kind: "predictive" },
];
const CUSTOMER_FIELD_DEFS: FieldDef[] = [
  ...COMMON_FIELD_DEFS,
  { field: "orders_count", label: "অর্ডার সংখ্যা", ops: ["eq", "gte", "lte", "gt", "lt"], kind: "number" },
  { field: "total_spent_minor", label: "মোট কেনাকাটা (পয়সায়)", ops: ["gte", "lte", "gt", "lt"], kind: "number" },
  { field: "last_order_days_ago", label: "শেষ অর্ডার (দিন আগে)", ops: ["gte", "lte", "gt", "lt"], kind: "number" },
  { field: "rfm_segment", label: "RFM Segment", ops: ["eq"], kind: "segment" },
  { field: "address_key", label: "ঠিকানার অংশ (যেমন district)", ops: ["eq", "contains"], kind: "keyed" },
];
const LEAD_FIELD_DEFS: FieldDef[] = [
  ...COMMON_FIELD_DEFS,
  { field: "stage", label: "Lead Stage", ops: ["eq", "neq"], kind: "stage" },
  { field: "tag", label: "ট্যাগ", ops: ["contains"], kind: "string" },
  { field: "value_minor", label: "Lead-এর মূল্য (পয়সায়)", ops: ["gte", "lte", "gt", "lt"], kind: "number" },
];
const OP_LABEL: Record<string, string> = { eq: "সমান (=)", neq: "সমান নয় (≠)", gt: "বেশি (>)", gte: "কমপক্ষে (≥)", lt: "কম (<)", lte: "সর্বোচ্চ (≤)", contains: "ধারণ করে" };
// MS4: per-tenant sender settings (safe view — no secrets, ever).
interface SenderSettings {
  email: { path: string; tenantConfigured: boolean; platformConfigured: boolean; smtpHost: string | null; smtpPort: number | null; smtpUser: string | null; smtpPassConfigured: boolean; fromAddress: string | null; fromName: string | null; dkimSelector: string | null };
  sms: { path: string; tenantConfigured: boolean; platformConfigured: boolean; gateway: string | null; smsApiKeyConfigured: boolean; smsSenderId: string | null; smsApiUrl: string | null };
  rates: { smsCostPerPartMinor: number | null; whatsappCostPerMessageMinor: number | null; whatsappMarketingCostPerMessageMinor: number | null; whatsappUtilityCostPerMessageMinor: number | null; whatsappAuthenticationCostPerMessageMinor: number | null; emailCostPerMessageMinor: number | null };
}
interface DomainHealth { domain: string | null; source: string; spf: { status: string; record?: string; reason?: string }; dkim: { status: string; record?: string; reason?: string; selector?: string } }
const SMS_GATEWAY_OPTIONS = [
  { id: "sslwireless", label: "SSL Wireless (BD)" },
  { id: "bulksmsbd", label: "BulkSMS BD" },
  { id: "alphasms", label: "Alpha SMS (sms.net.bd)" },
];
interface MessagingSetting { frequencyCapPerDay: number; whatsappOptInRequired: boolean; linkTrackingEnabled: boolean; marketingMaxBroadcastsPerSweep: number | null; marketingMaxEntriesPerSweep: number | null; quietHoursEnabled: boolean; quietHoursStart: string | null; quietHoursEnd: string | null; whatsappQualityGuardEnabled: boolean; churnRiskSilentDays: number; likelyToBuyMinScore: number; highLtvMinSpentMinor: number; unengagedSuppressDays: number; unengagedMinSends: number; approvalEnabled: boolean; broadcastCostCapMinor: number | null; monthlySpendCapMinor: number | null; abAutoWinnerEnabled: boolean }
// MX15: governance shapes (API verbatim).
interface ChannelHealth { channel: string; total: number; sent: number; failed: number; skipped: number; failureRate: number | null; deliveredRate: number | null; readRate: number | null; bounceRate: null; complaintRate: null; failureReasons: { reason: string; count: number }[] }
interface DeliveryHealth { windowDays: number; available: boolean; reason?: string; channels: ChannelHealth[]; totals: { deliveries: number; sent: number; failed: number; skipped: number; failureRate: number | null; bounceRate: null; complaintRate: null } | null; bounceComplaintNote: string; perSender: null; perSenderNote: string; domainHealth: DomainHealth | null; autoSuppression?: string }
interface SeedRecipient { id: string; channel: string; address: string; label?: string | null; createdAt: string }
// MX16: analytics + AI v2 shapes (API verbatim). A null funnel
// stage means the channel cannot report it — never a fake 0.
// Revenue figures are ASSOCIATION only (labelled in the payload).
interface AbWinnerDetail { winner: string; metric: string; test: string; alpha: number; zCritical: number; minSamplePerVariant: number; a: { sent: number; success: number; rate: number }; b: { sent: number; success: number; rate: number }; z: number | null; pValue: number | null; decidedAt: string; rule: string }
interface AnalyticsBroadcast { id: string; name: string; channel: string; status: string; sentAt: string | null; funnel: BroadcastFunnel; revenueAssociation: { orders: number; totalMinor: string; customerRecipients: number; windowDays: number } | null }
interface ChannelFunnelRow { channel: string; broadcasts: number; audience: number; sent: number; failed: number; skipped: number; delivered: number | null; read: number | null; opened: number | null; clickedRecipients: number | null; totalClicks: number | null }
interface ComparativeAnalytics { range: { from: string; to: string }; broadcasts: AnalyticsBroadcast[]; channels: ChannelFunnelRow[]; totals: ChannelFunnelRow; association: { orders: number; totalMinor: string; label: string }; attribution: null; attributionNote: string; stageNote: string }
interface PlannerProposal { audienceDefinition: unknown; audienceValid: boolean; audienceErrors: string[]; contentDraft: { subject: string | null; body: string }; channelRecommendation: string | null; timingSuggestion: string | null; rationale: string | null }
interface PlannerResult { proposal: PlannerProposal; providerLabel: string; isRealLlm: boolean; notice: string }
interface TranslateResult { subject: string | null; body: string; targetLanguage: string; providerLabel: string; isRealLlm: boolean; notice: string }
interface SubjectScore { method: "heuristic"; score: number; maxScore: number; factors: { code: string; label: string; points: number; maxPoints: number; detail: string }[]; spamWordsMatched: string[]; label: string }
interface RecipientSendTime { recipientKey: string; available: boolean; totalEvents: number; minEvents: number; modalHour: number | null; modalHourEvents: number; method?: string; reason?: string }
interface ChecklistItem { code: string; label: string; status: string; detail: string; verified: string }
interface ComposeCheckV2Result { checks: ChecklistItem[]; warnings: ComposeWarning[]; spamWords: { en: string[]; bn: string[]; label: string } }
// MX11: engagement report + suppression suggestions (API verbatim).
interface EngagementReport { label: string; formula: string; segmentRules: { segment: string; label: string; rule: string }[]; thresholds: { churnRiskSilentDays: number; likelyToBuyMinScore: number; highLtvMinSpentMinor: number; unengagedSuppressDays: number; unengagedMinSends: number }; totalContacts: number; scoredContacts: number; zeroHistoryContacts: number; segmentCounts: Record<string, number>; rows: { type: string; id: string; name: string; score: number; segments: string[]; sentCount: number; openCount: number; clickCount: number; orderFrequency: number; totalSpentMinor: string; lastEngagementAt: string | null; daysSinceLastEngagement: number | null }[] }
interface SuppressionSuggestion { type: string; id: string; name: string; email: string | null; phone: string | null; score: number; totalSends: number; sendsSinceLastEngagement: number; lastEngagementAt: string | null; daysSinceLastEngagement: number | null; lastSendAt: string | null; alreadyOptedOutChannels: string[]; rule: string }
interface SuppressionResult { label: string; note: string; total: number; suggestions: SuppressionSuggestion[] }
// MX3: the settings GET view adds read-only stream info (never sent back in a PATCH).
interface MessagingSettingsView extends MessagingSetting { effectiveMaxBroadcastsPerSweep: number; effectiveMaxEntriesPerSweep: number; timezone: string; quietHoursActive: boolean }
// MX3: unified READ-ONLY transactional view (order notifications).
interface TransactionalOverview {
  setting: { configured: boolean; enabledEvents: number; totalEvents: number; channelsInUse: string[]; events: { event: string; enabled: boolean; channels: string[] }[] } | null;
  recent: { id: string; orderId: string; orderRef: string; event: string; channel: string; status: string; providerMessageId: string | null; error: string | null; createdAt: string }[];
  summary: { total: number | null; sent: number | null; failed: number | null };
}
interface MessagePreference { id: string; channel: string; address: string; status: string; source: string; note?: string | null; updatedAt: string }
interface RfmReport { totalCustomers: number; segments: Record<string, number>; rows: { customerId: string; name: string; recencyDays: number; frequency: number; monetaryMinor: string; segment: string; r: number; f: number; m: number }[] }
const SEGMENTS = ["champions", "loyal", "big_spenders", "at_risk", "lost", "new", "regular"];
const SEG_LABEL: Record<string, string> = { champions: "🏆 Champions", loyal: "💙 Loyal", big_spenders: "💰 Big Spenders", at_risk: "⚠️ At Risk", lost: "💤 Lost", new: "🌱 New", regular: "Regular" };
interface Delivery { id: string; address: string; status: string; providerMessageId?: string | null; error?: string | null; createdAt: string; channel?: string; deliveryStatus?: string | null; deliveredAt?: string | null; readAt?: string | null; openedAt?: string | null; conversationId?: string | null }
// MX6: keyword campaigns (two-way / interactive). Rules match an
// inbound WhatsApp reply in the Unified Inbox; hits carry the
// per-action outcomes exactly as the API recorded them.
interface KeywordRule { id: string; name: string; kind: string; keyword?: string | null; channel: string; tag?: string | null; applyTagTo?: string[] | null; autoReplyText?: string | null; pollOptions?: { key: string; label: string; keywords: string[] }[] | null; enabled: boolean; hitCount: number; createdAt: string }
interface KeywordHitAction { action: string; target?: string; entity?: string; status: string; reason?: string; providerMessageId?: string }
interface KeywordHit { id: string; ruleId: string; ruleName?: string | null; ruleKind?: string | null; conversationId: string; matchedText: string; matchedKeyword: string; pollOptionKey?: string | null; actions?: KeywordHitAction[] | null; suggestedLabel?: string | null; classifyStatus?: string | null; confirmedLabel?: string | null; createdAt: string }
interface PollTally { ruleId: string; options: { key: string; label: string; votes: number }[]; totalVoters: number }
interface ProviderStatus { email: { configured: boolean; transport: string; path?: string; tenantConfigured?: boolean; platformConfigured?: boolean }; sms: { configured: boolean; provider: string; gateway?: string | null; path?: string; tenantConfigured?: boolean; platformConfigured?: boolean } }

const LEAD_STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"];

// MXD design update: the page is one tabbed workspace. Every block of the
// pre-redesign stacked page lives under exactly one tab below; all state
// stays in this component, so switching tabs never loses form state.
const MSG_TABS = [
  { id: "campaigns", icon: "📣", label: "ক্যাম্পেইন ও অডিয়েন্স" },
  { id: "templates", icon: "🧩", label: "Templates ও Builder" },
  { id: "journeys", icon: "🧭", label: "Journeys" },
  { id: "channels", icon: "💬", label: "WhatsApp ও Keywords" },
  { id: "growth", icon: "🌱", label: "Growth ও Consent" },
  { id: "insights", icon: "📊", label: "Analytics ও Health" },
  { id: "settings", icon: "⚙️", label: "প্রেরক সেটিংস" },
] as const;
type MsgTab = (typeof MSG_TABS)[number]["id"];

export default function MessagingPage() {
  const { t: tr, locale } = useLocale();
  const JOURNEY_STEP_LABEL_L = journeyStepLabelsFor(locale);
  const OP_LABEL_L = opLabelsFor(locale);
  const PREDICTIVE_LABEL_L = predictiveLabelsFor(locale);
  const [tab, setTab] = useState<MsgTab>("campaigns");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [tplForm, setTplForm] = useState({ name: "", channel: "email", subject: "", body: "", htmlBody: "" });
  const [bcForm, setBcForm] = useState({ name: "", channel: "email", templateId: "", subject: "", body: "", htmlBody: "", audienceType: "customers", audienceStage: "qualified", audienceSegment: "at_risk", audienceSavedId: "", whatsappTemplateId: "", templateParams: "", waHeaderMediaUrl: "", waHeaderTextParams: "", waButtonRows: [] as { index: string; subType: string; value: string }[], pushUrl: "", tgButtons: [] as { label: string; url: string }[], onsiteUrl: "", cascadeEnabled: false, cascadeChannels: ["sms", "email"] as string[], cascadeSmart: false, cascadeOrdering: "org", cascadeSmsBody: "", cascadeEmailSubject: "", cascadeEmailBody: "", cascadeWhatsappTemplateId: "", abTest: false, abSubject: "", abBody: "", abWhatsappTemplateId: "", abAutoWinner: false, excludePreviousRecipients: false, topic: "", holdoutPercent: "", budgetCapTaka: "", scheduledAt: "", recEnabled: false, recFreq: "weekly", recInterval: "1", recWeekdays: [] as number[], recEndsAt: "" });
  // MS7: report panels + paged deliveries inside a panel.
  const [reports, setReports] = useState<Record<string, BroadcastReport>>({});
  const [pagedDlv, setPagedDlv] = useState<Record<string, { items: Delivery[]; nextCursor: string | null }>>({});
  const [dlvFilter, setDlvFilter] = useState<Record<string, { status: string; q: string }>>({});
  // MS8: journey presets + per-preset install results.
  const [journeyPresets, setJourneyPresets] = useState<JourneyPreset[]>([]);
  const [unavailablePresets, setUnavailablePresets] = useState<UnavailableJourneyPreset[]>([]);
  const [journeyResults, setJourneyResults] = useState<Record<string, string>>({});
  // MX4: custom journeys (list + meta + detail panels + the
  // visual flow-editor draft; a null draft = editor closed).
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [journeyMeta, setJourneyMeta] = useState<JourneyMeta | null>(null);
  const [journeyDetails, setJourneyDetails] = useState<Record<string, JourneyDetail>>({});
  const [journeyDraft, setJourneyDraft] = useState<{ id: string | null; name: string; trigger: string; exitOnPurchase: boolean; steps: JourneyStep[] } | null>(null);
  // MS5: composer state — variables (from the API), products,
  // coupon insert, insert target, compose-check warnings, and
  // per-row test-send boxes for templates and broadcasts.
  const [variables, setVariables] = useState<TemplateVariables | null>(null);
  const [products, setProducts] = useState<ComposerProduct[]>([]);
  const [productPick, setProductPick] = useState("");
  const [couponForm, setCouponForm] = useState({ code: "", label: "" });
  const [insertTarget, setInsertTarget] = useState<"body" | "html">("body");
  const [composeWarnings, setComposeWarnings] = useState<ComposeWarning[]>([]);
  const [tplTestInputs, setTplTestInputs] = useState<Record<string, string>>({});
  const [tplTestResults, setTplTestResults] = useState<Record<string, string>>({});
  const [bcTestInputs, setBcTestInputs] = useState<Record<string, string>>({});
  const [bcTestResults, setBcTestResults] = useState<Record<string, string>>({});
  const [tplHtmlPreview, setTplHtmlPreview] = useState(false);
  const [bcHtmlPreview, setBcHtmlPreview] = useState(false);
  // MS6: WhatsApp hub state — WABA id, sync result, submit form.
  const [waIntegrations, setWaIntegrations] = useState<MessagingIntegration[]>([]);
  const [wabaInput, setWabaInput] = useState("");
  const [syncResult, setSyncResult] = useState<{ synced: number; created: number; updated: number; notOnMeta: number; truncated: boolean } | null>(null);
  const [waSubmit, setWaSubmit] = useState({ name: "", language: "bn", category: "MARKETING", bodyText: "", exampleValues: "", headerType: "none", headerText: "", headerExample: "", headerHandle: "" });
  const [waButtons, setWaButtons] = useState<WaButtonRow[]>([]);
  // MS3: condition-builder state + saved audiences + csv paste.
  const [condEntity, setCondEntity] = useState("customers");
  const [condMatch, setCondMatch] = useState("all");
  const [condRows, setCondRows] = useState<CondRow[]>([{ field: "source", op: "eq", key: "", value: "" }]);
  const [savedAudiences, setSavedAudiences] = useState<SavedAudience[]>([]);
  const [savedName, setSavedName] = useState("");
  const [csvText, setCsvText] = useState("");
  // MS4: sender settings state.
  const [senderSettings, setSenderSettings] = useState<SenderSettings | null>(null);
  const [smtpForm, setSmtpForm] = useState({ smtpHost: "", smtpPort: "587", smtpUser: "", smtpPass: "", fromAddress: "", fromName: "", dkimSelector: "" });
  const [smsForm, setSmsForm] = useState({ smsGateway: "bulksmsbd", smsApiKey: "", smsSenderId: "", smsApiUrl: "" });
  const [rateForm, setRateForm] = useState({ sms: "", whatsapp: "", whatsappMarketing: "", whatsappUtility: "", whatsappAuthentication: "", email: "" });
  // MX9: hub category filter + carousel cards in the submit form.
  const [waCategoryFilter, setWaCategoryFilter] = useState("ALL");
  const [waCards, setWaCards] = useState<WaCardRow[]>([]);
  // MX10: growth tools state — opt-in forms, QR codes, the CSV
  // import wizard and the consent history (begins at MX10).
  const [growthForms, setGrowthForms] = useState<OptInForm[]>([]);
  const [growthDraft, setGrowthDraft] = useState({ name: "", channels: ["email"] as string[], topic: "", keyword: "", doubleOptIn: true, popupEnabled: false, popupDelay: "10", headline: "" });
  const [growthQr, setGrowthQr] = useState<Record<string, string>>({});
  const [prefLink, setPrefLink] = useState({ channel: "email", address: "", url: "" });
  const [csvWiz, setCsvWiz] = useState<{ channel: string; text: string; mapping: { name: string; email: string; phone: string }; preview: CsvImportPreview | null; committed: string }>({ channel: "email", text: "", mapping: { name: "", email: "", phone: "" }, preview: null, committed: "" });
  const [consentEvents, setConsentEvents] = useState<ConsentEvent[]>([]);
  const [testEmailTo, setTestEmailTo] = useState("");
  const [domainHealth, setDomainHealth] = useState<DomainHealth | null>(null);
  const [preview, setPreview] = useState<BroadcastPreview | null>(null);
  const [rfm, setRfm] = useState<RfmReport | null>(null);
  const [waTemplates, setWaTemplates] = useState<WaTemplate[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const composerFormRef = useRef<HTMLFormElement>(null);
  const [storeInfo, setStoreInfo] = useState({ name: tr("messaging.msgOurShop"), url: "https://yourshop.com" });

  const handleApplyFestivalTemplate = (data: {
    name: string;
    channel: "sms" | "whatsapp";
    body: string;
    audienceType: string;
    audienceSegment?: string;
  }) => {
    setBcForm((prev) => ({
      ...prev,
      name: data.name,
      channel: data.channel,
      templateId: "",
      body: data.body,
      audienceType: data.audienceSegment ? "segment" : prev.audienceType,
      audienceSegment: data.audienceSegment || prev.audienceSegment,
    }));
    setNotice(tr("messaging.msgFestivalLoaded", { name: data.name }));
    composerFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // MS1: per-row schedule inputs (datetime-local values).
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, string>>({});
  // MS10: template search (client filter over the loaded list —
  // labelled as such in the UI) + inline template edit form.
  const [tplSearch, setTplSearch] = useState("");
  // MX7: email builder state — the draft being edited (templateId
  // null = new template), brand kit, discounts, content library,
  // festival packs, per-template version panels, server preview.
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [discounts, setDiscounts] = useState<ComposerDiscount[]>([]);
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([]);
  const [festivalPacks, setFestivalPacks] = useState<FestivalPack[]>([]);
  const [builder, setBuilder] = useState<{ templateId: string | null; name: string; subject: string; blocks: EmailBlock[] } | null>(null);
  const [builderPreview, setBuilderPreview] = useState<BlocksPreview | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [cbName, setCbName] = useState("");
  const [tplVersions, setTplVersions] = useState<Record<string, TemplateVersion[]>>({});
  const [tplEdit, setTplEdit] = useState<{ id: string; name: string; subject: string; body: string; htmlBody: string } | null>(null);
  // MS10: broadcast list — server-side search/status filters +
  // cursor pagination (the filters live in a ref too, so the
  // stable load() callback always reads the current ones).
  const [bcFilters, setBcFilters] = useState({ q: "", status: "", archived: false });
  const bcFiltersRef = useRef(bcFilters);
  const [bcNextCursor, setBcNextCursor] = useState<string | null>(null);
  const [bcEditId, setBcEditId] = useState<string | null>(null);
  const [bcEditForm, setBcEditForm] = useState({ name: "", subject: "", body: "", htmlBody: "", templateId: "", whatsappTemplateId: "", templateParams: "", scheduledAt: "", pushUrl: "", tgButtons: [] as { label: string; url: string }[], onsiteUrl: "" });
  // MS9: AI composer state + the deterministic suggestion cards.
  const [aiForm, setAiForm] = useState({ goal: "", productId: "", audienceHint: "", language: "bn" });
  const [aiDraft, setAiDraft] = useState<AiDraftResult | null>(null);
  const [aiSubjects, setAiSubjects] = useState<AiSubjectsResult | null>(null);
  const [sendTime, setSendTime] = useState<SendTimeSuggestion | null>(null);
  const [segmentSuggestions, setSegmentSuggestions] = useState<SegmentSuggestion[]>([]);
  // MS2: consent settings + preference list state.
  // MX3: the form state holds ONLY the settable fields (the API
  // rejects unknown PATCH fields); read-only stream info and the
  // transactional overview live in their own state.
  const [msgSetting, setMsgSetting] = useState<MessagingSetting>({ frequencyCapPerDay: 1, whatsappOptInRequired: false, linkTrackingEnabled: true, marketingMaxBroadcastsPerSweep: null, marketingMaxEntriesPerSweep: null, quietHoursEnabled: false, quietHoursStart: null, quietHoursEnd: null, whatsappQualityGuardEnabled: false, churnRiskSilentDays: 60, likelyToBuyMinScore: 60, highLtvMinSpentMinor: 500000, unengagedSuppressDays: 90, unengagedMinSends: 3, approvalEnabled: false, broadcastCostCapMinor: null, monthlySpendCapMinor: null, abAutoWinnerEnabled: false });
  // MX11: audience intelligence state.
  const [engagement, setEngagement] = useState<EngagementReport | null>(null);
  const [suppression, setSuppression] = useState<SuppressionResult | null>(null);
  const [suppressChannel, setSuppressChannel] = useState("email");
  const [nlDraft, setNlDraft] = useState({ description: "", entity: "customers" });
  const [nlResult, setNlResult] = useState<{ valid: boolean; errors: string[]; notice?: string } | null>(null);
  const [nlDraftJson, setNlDraftJson] = useState("");
  const [nlName, setNlName] = useState("");
  const [streamInfo, setStreamInfo] = useState<{ timezone: string; quietHoursActive: boolean; effectiveMaxBroadcastsPerSweep: number; effectiveMaxEntriesPerSweep: number } | null>(null);
  const [txOverview, setTxOverview] = useState<TransactionalOverview | null>(null);
  // MX15: governance state — delivery health, seed list, approval queue, checklist v2.
  const [health, setHealth] = useState<DeliveryHealth | null>(null);
  // MX16: analytics + AI v2 state.
  const [analytics, setAnalytics] = useState<ComparativeAnalytics | null>(null);
  const [analyticsRange, setAnalyticsRange] = useState({ from: "", to: "" });
  const [planner, setPlanner] = useState<PlannerResult | null>(null);
  const [translation, setTranslation] = useState<TranslateResult | null>(null);
  const [subjectScore, setSubjectScore] = useState<SubjectScore | null>(null);
  const [recipientTimeKey, setRecipientTimeKey] = useState("");
  const [recipientSendTime, setRecipientSendTime] = useState<RecipientSendTime | null>(null);
  const [healthDays, setHealthDays] = useState(30);
  const [seeds, setSeeds] = useState<SeedRecipient[]>([]);
  const [seedForm, setSeedForm] = useState({ channel: "email", address: "", label: "" });
  const [seedTestBroadcastId, setSeedTestBroadcastId] = useState("");
  const [approvals, setApprovals] = useState<Broadcast[]>([]);
  const [checkV2, setCheckV2] = useState<ComposeCheckV2Result | null>(null);
  function applySettingsView(v: Partial<MessagingSettingsView>) {
    setMsgSetting((cur) => ({
      frequencyCapPerDay: v.frequencyCapPerDay ?? cur.frequencyCapPerDay,
      whatsappOptInRequired: v.whatsappOptInRequired ?? cur.whatsappOptInRequired,
      linkTrackingEnabled: v.linkTrackingEnabled ?? cur.linkTrackingEnabled,
      marketingMaxBroadcastsPerSweep: v.marketingMaxBroadcastsPerSweep !== undefined ? v.marketingMaxBroadcastsPerSweep : cur.marketingMaxBroadcastsPerSweep,
      marketingMaxEntriesPerSweep: v.marketingMaxEntriesPerSweep !== undefined ? v.marketingMaxEntriesPerSweep : cur.marketingMaxEntriesPerSweep,
      quietHoursEnabled: v.quietHoursEnabled ?? cur.quietHoursEnabled,
      quietHoursStart: v.quietHoursStart !== undefined ? v.quietHoursStart : cur.quietHoursStart,
      quietHoursEnd: v.quietHoursEnd !== undefined ? v.quietHoursEnd : cur.quietHoursEnd,
      whatsappQualityGuardEnabled: v.whatsappQualityGuardEnabled ?? cur.whatsappQualityGuardEnabled,
      churnRiskSilentDays: v.churnRiskSilentDays ?? cur.churnRiskSilentDays,
      likelyToBuyMinScore: v.likelyToBuyMinScore ?? cur.likelyToBuyMinScore,
      highLtvMinSpentMinor: v.highLtvMinSpentMinor ?? cur.highLtvMinSpentMinor,
      unengagedSuppressDays: v.unengagedSuppressDays ?? cur.unengagedSuppressDays,
      unengagedMinSends: v.unengagedMinSends ?? cur.unengagedMinSends,
      approvalEnabled: v.approvalEnabled ?? cur.approvalEnabled,
      abAutoWinnerEnabled: v.abAutoWinnerEnabled ?? cur.abAutoWinnerEnabled,
      broadcastCostCapMinor: v.broadcastCostCapMinor !== undefined ? v.broadcastCostCapMinor : cur.broadcastCostCapMinor,
      monthlySpendCapMinor: v.monthlySpendCapMinor !== undefined ? v.monthlySpendCapMinor : cur.monthlySpendCapMinor,
    }));
    if (v.timezone !== undefined || v.quietHoursActive !== undefined) {
      setStreamInfo({
        timezone: v.timezone ?? "Asia/Dhaka",
        quietHoursActive: v.quietHoursActive ?? false,
        effectiveMaxBroadcastsPerSweep: v.effectiveMaxBroadcastsPerSweep ?? 20,
        effectiveMaxEntriesPerSweep: v.effectiveMaxEntriesPerSweep ?? 200,
      });
    }
  }
  // MX6: keyword campaigns state.
  const [kwRules, setKwRules] = useState<KeywordRule[]>([]);
  const [kwHits, setKwHits] = useState<KeywordHit[]>([]);
  const [kwTallies, setKwTallies] = useState<Record<string, PollTally>>({});
  const [kwForm, setKwForm] = useState({ name: "", kind: "keyword", keyword: "", tag: "", toCustomer: true, toLead: false, toConversation: false, autoReplyText: "" });
  const [kwPollOptions, setKwPollOptions] = useState<{ key: string; label: string; keywords: string }[]>([{ key: "", label: "", keywords: "" }, { key: "", label: "", keywords: "" }]);
  const [kwEditId, setKwEditId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<MessagePreference[]>([]);
  const [prefForm, setPrefForm] = useState({ channel: "email", address: "", status: "opted_out" });
  const [importForm, setImportForm] = useState({ channel: "email", text: "" });
  const [importResult, setImportResult] = useState<{ imported: number; errors: { address: string; error: string }[] } | null>(null);

  // MS10: the broadcast list is paged server-side (cursor) with
  // server-side name/status filters. reset=true replaces the
  // list (first page); otherwise the next page appends.
  async function loadBroadcastList(reset: boolean, cursor?: string | null) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const f = bcFiltersRef.current;
    const params = new URLSearchParams();
    params.set("cursor", cursor ?? "");
    if (f.q.trim()) params.set("q", f.q.trim());
    if (f.status) params.set("status", f.status);
    if (f.archived) params.set("archived", "1");
    const page = await apiFetch<{ items: Broadcast[]; nextCursor: string | null }>(`/organizations/${orgId}/messaging/broadcasts?${params.toString()}`).catch(() => null);
    if (!page) return;
    setBroadcasts((prev) => (reset ? page.items : [...prev, ...page.items]));
    setBcNextCursor(page.nextCursor);
  }

  function applyBcFilters(patch: Partial<{ q: string; status: string; archived: boolean }>) {
    const next = { ...bcFiltersRef.current, ...patch };
    bcFiltersRef.current = next;
    setBcFilters(next);
    void loadBroadcastList(true);
  }

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const [t, s] = await Promise.all([
        apiFetch<Template[]>(`/organizations/${orgId}/messaging/templates`),
        apiFetch<ProviderStatus>(`/organizations/${orgId}/messaging/provider-status`),
      ]);
      setTemplates(t); setStatus(s);
      void loadBroadcastList(true);
      apiFetch<WaTemplate[]>(`/organizations/${orgId}/inbox/whatsapp-templates`).then(setWaTemplates).catch(() => undefined);
      apiFetch<TemplateVariables>(`/organizations/${orgId}/messaging/variables`).then(setVariables).catch(() => undefined);
      apiFetch<ComposerProduct[]>(`/organizations/${orgId}/messaging/composer/products`).then((ps) => { setProducts(ps); setProductPick((cur) => cur || ps[0]?.id || ""); }).catch(() => undefined);
      apiFetch<MessagingIntegration[]>(`/organizations/${orgId}/inbox/integrations`).then((rows) => { setWaIntegrations(rows); const wa = rows.find((r) => r.provider === "whatsapp"); setWabaInput((cur) => cur || wa?.wabaId || ""); }).catch(() => undefined);
      apiFetch<RfmReport>(`/organizations/${orgId}/messaging/rfm`).then(setRfm).catch(() => undefined);
      apiFetch<EngagementReport>(`/organizations/${orgId}/messaging/engagement`).then(setEngagement).catch(() => undefined);
      apiFetch<SuppressionResult>(`/organizations/${orgId}/messaging/suppression-suggestions`).then(setSuppression).catch(() => undefined);
      apiFetch<MessagingSettingsView>(`/organizations/${orgId}/messaging/settings`).then(applySettingsView).catch(() => undefined);
      apiFetch<TransactionalOverview>(`/organizations/${orgId}/messaging/transactional-overview`).then(setTxOverview).catch(() => undefined);
      apiFetch<DeliveryHealth>(`/organizations/${orgId}/messaging/health?days=30`).then(setHealth).catch(() => undefined);
      apiFetch<SeedRecipient[]>(`/organizations/${orgId}/messaging/seed-recipients`).then(setSeeds).catch(() => undefined);
      apiFetch<Broadcast[]>(`/organizations/${orgId}/messaging/approvals`).then(setApprovals).catch(() => undefined);
      apiFetch<MessagePreference[]>(`/organizations/${orgId}/messaging/preferences`).then(setPreferences).catch(() => undefined);
      apiFetch<BrandKit>(`/organizations/${orgId}/messaging/brand-kit`).then(setBrandKit).catch(() => undefined);
      apiFetch<ComposerDiscount[]>(`/organizations/${orgId}/messaging/composer/discounts`).then(setDiscounts).catch(() => undefined);
      apiFetch<ContentBlock[]>(`/organizations/${orgId}/messaging/content-blocks`).then(setContentBlocks).catch(() => undefined);
      apiFetch<FestivalPack[]>(`/organizations/${orgId}/messaging/template-packs`).then(setFestivalPacks).catch(() => undefined);
      apiFetch<KeywordRule[]>(`/organizations/${orgId}/messaging/keyword-rules`).then(setKwRules).catch(() => undefined);
      apiFetch<KeywordHit[]>(`/organizations/${orgId}/messaging/keyword-hits`).then(setKwHits).catch(() => undefined);
      apiFetch<SavedAudience[]>(`/organizations/${orgId}/messaging/audiences`).then(setSavedAudiences).catch(() => undefined);
      apiFetch<{ name?: string; slug?: string; customDomain?: string | null }>(`/organizations/${orgId}`)
        .then((org) => {
          if (org) {
            const origin = typeof window !== "undefined" ? window.location.origin : "https://app.nextcommerce.com";
            const url = org.customDomain ? `https://${org.customDomain}` : (org.slug ? `${origin}/shop/${org.slug}` : "https://yourshop.com");
            setStoreInfo({ name: org.name || tr("messaging.msgOurShop"), url });
          }
        })
        .catch(() => undefined);
      apiFetch<{ presets: JourneyPreset[]; unavailable: UnavailableJourneyPreset[] } | JourneyPreset[]>(`/organizations/${orgId}/messaging/journey-presets`).then((r) => {
        // MX5: the endpoint now returns { presets, unavailable };
        // a bare array (older deployment) still works.
        if (Array.isArray(r)) { setJourneyPresets(r); return; }
        setJourneyPresets(r.presets ?? []);
        setUnavailablePresets(r.unavailable ?? []);
      }).catch(() => undefined);
      apiFetch<Journey[]>(`/organizations/${orgId}/messaging/journeys`).then(setJourneys).catch(() => undefined);
      apiFetch<JourneyMeta>(`/organizations/${orgId}/messaging/journeys/meta`).then(setJourneyMeta).catch(() => undefined);
      apiFetch<SendTimeSuggestion>(`/organizations/${orgId}/messaging/ai/send-time`).then(setSendTime).catch(() => undefined);
      apiFetch<SegmentSuggestion[]>(`/organizations/${orgId}/messaging/ai/segment-suggestion`).then(setSegmentSuggestions).catch(() => undefined);
      apiFetch<SenderSettings>(`/organizations/${orgId}/messaging/senders`).then((ss) => {
        setSenderSettings(ss);
        setSmtpForm({ smtpHost: ss.email.smtpHost ?? "", smtpPort: String(ss.email.smtpPort ?? 587), smtpUser: ss.email.smtpUser ?? "", smtpPass: "", fromAddress: ss.email.fromAddress ?? "", fromName: ss.email.fromName ?? "", dkimSelector: ss.email.dkimSelector ?? "" });
        setSmsForm({ smsGateway: ss.sms.gateway ?? "bulksmsbd", smsApiKey: "", smsSenderId: ss.sms.smsSenderId ?? "", smsApiUrl: ss.sms.smsApiUrl ?? "" });
        setRateForm({
          sms: ss.rates.smsCostPerPartMinor !== null ? String(ss.rates.smsCostPerPartMinor / 100) : "",
          whatsapp: ss.rates.whatsappCostPerMessageMinor !== null ? String(ss.rates.whatsappCostPerMessageMinor / 100) : "",
          whatsappMarketing: ss.rates.whatsappMarketingCostPerMessageMinor != null ? String(ss.rates.whatsappMarketingCostPerMessageMinor / 100) : "",
          whatsappUtility: ss.rates.whatsappUtilityCostPerMessageMinor != null ? String(ss.rates.whatsappUtilityCostPerMessageMinor / 100) : "",
          whatsappAuthentication: ss.rates.whatsappAuthenticationCostPerMessageMinor != null ? String(ss.rates.whatsappAuthenticationCostPerMessageMinor / 100) : "",
          email: ss.rates.emailCostPerMessageMinor !== null ? String(ss.rates.emailCostPerMessageMinor / 100) : "",
        });
      }).catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // SN4: Social Posts repurpose handoff — a ?prefill= link drops
  // the post's caption into the composer body as a DRAFT (nothing
  // is sent, no broadcast is created) and the param is scrubbed
  // from the URL so a refresh never re-applies it over edits.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get("prefill");
    if (!prefill) return;
    setBcForm((f) => (f.body ? f : { ...f, body: prefill }));
    params.delete("prefill");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    setNotice(tr("messaging.msgCaptionDrafted"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function wrap<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(key); setError("");
    try { return await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); return null; } finally { setBusy(""); }
  }

  // ---------- MX6: keyword campaigns ----------
  async function reloadKwHits() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const rows = await apiFetch<KeywordHit[]>(`/organizations/${orgId}/messaging/keyword-hits`).catch(() => null);
    if (rows) setKwHits(rows);
  }

  function resetKwForm() {
    setKwEditId(null);
    setKwForm({ name: "", kind: "keyword", keyword: "", tag: "", toCustomer: true, toLead: false, toConversation: false, autoReplyText: "" });
    setKwPollOptions([{ key: "", label: "", keywords: "" }, { key: "", label: "", keywords: "" }]);
  }

  function startKwEdit(r: KeywordRule) {
    setKwEditId(r.id);
    setKwForm({
      name: r.name, kind: r.kind, keyword: r.keyword ?? "", tag: r.tag ?? "",
      toCustomer: (r.applyTagTo ?? []).includes("customer"), toLead: (r.applyTagTo ?? []).includes("lead"),
      toConversation: (r.applyTagTo ?? []).includes("conversation"), autoReplyText: r.autoReplyText ?? "",
    });
    if (r.kind === "poll") {
      // Option keys are preserved verbatim — recorded votes
      // (hits) reference them, so an edit must never rename one.
      setKwPollOptions((r.pollOptions ?? []).map((o) => ({ key: o.key, label: o.label, keywords: o.keywords.join(", ") })));
    }
  }

  async function submitKwRule(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    const applyTagTo = [
      ...(kwForm.toCustomer ? ["customer"] : []),
      ...(kwForm.toLead ? ["lead"] : []),
      ...(kwForm.toConversation ? ["conversation"] : []),
    ];
    const body: Record<string, unknown> = kwForm.kind === "poll"
      ? {
          name: kwForm.name, kind: "poll", keyword: "",
          pollOptions: kwPollOptions.map((o, i) => ({
            key: o.key || `opt${i + 1}`, label: o.label,
            keywords: o.keywords.split(",").map((x) => x.trim()).filter(Boolean),
          })),
        }
      : {
          name: kwForm.name, kind: "keyword", keyword: kwForm.keyword,
          tag: kwForm.tag || undefined, applyTagTo: kwForm.tag ? applyTagTo : undefined,
          autoReplyText: kwForm.autoReplyText || undefined,
        };
    const res = await wrap("kw-rule", () => apiFetch(
      kwEditId ? `/organizations/${orgId}/messaging/keyword-rules/${kwEditId}` : `/organizations/${orgId}/messaging/keyword-rules`,
      { method: kwEditId ? "PATCH" : "POST", body: JSON.stringify(body) },
    ));
    if (res) { resetKwForm(); setNotice(kwEditId ? tr("messaging.msgRuleUpdated") : tr("messaging.msgRuleCreated")); await load(); }
  }

  async function toggleKwRule(r: KeywordRule) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await wrap(`kw-toggle-${r.id}`, () => apiFetch(`/organizations/${orgId}/messaging/keyword-rules/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !r.enabled }) }));
    if (res) await load();
  }

  async function deleteKwRule(r: KeywordRule) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(tr("messaging.msgRuleDeleteConfirm", { name: r.name }))) return;
    const res = await wrap(`kw-del-${r.id}`, () => apiFetch(`/organizations/${orgId}/messaging/keyword-rules/${r.id}`, { method: "DELETE" }));
    if (res) { setNotice(tr("messaging.msgRuleDeleted")); await load(); }
  }

  async function loadKwTally(ruleId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const t = await wrap(`kw-tally-${ruleId}`, () => apiFetch<PollTally>(`/organizations/${orgId}/messaging/keyword-rules/${ruleId}/tally`));
    if (t) setKwTallies((s) => ({ ...s, [ruleId]: t }));
  }

  async function classifyKwHit(h: KeywordHit) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await wrap(`kw-classify-${h.id}`, () => apiFetch(`/organizations/${orgId}/messaging/keyword-hits/${h.id}/classify`, { method: "POST", body: JSON.stringify({}) }));
    if (res) { setNotice(tr("messaging.msgAiAdviceArrived")); await reloadKwHits(); }
  }

  async function applyKwHitLabel(h: KeywordHit, decision: "confirm" | "dismiss") {
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await wrap(`kw-label-${h.id}`, () => apiFetch(`/organizations/${orgId}/messaging/keyword-hits/${h.id}/apply-label`, { method: "POST", body: JSON.stringify({ decision }) }));
    if (res) { setNotice(decision === "confirm" ? tr("messaging.msgLabelConfirmed") : tr("messaging.msgAdviceDiscarded")); await reloadKwHits(); }
  }

  // MS3: the builder rows → an API audience definition. Values
  // are converted by field kind (numbers as numbers, booleans as
  // booleans); the server validates strictly and its 400 shows
  // verbatim, so a bad row can never silently change meaning.
  function buildDefinition() {
    const defs = condEntity === "customers" ? fieldDefsFor(CUSTOMER_FIELD_DEFS, locale) : fieldDefsFor(LEAD_FIELD_DEFS, locale);
    const conditions = condRows.map((r) => {
      const def = defs.find((d) => d.field === r.field) ?? defs[0];
      const cond: Record<string, unknown> = { field: r.field, op: r.op };
      if (def.kind === "keyed") cond.key = r.key;
      cond.value = def.kind === "number" ? Number(r.value) : def.kind === "boolean" ? r.value === "true" : r.value;
      return cond;
    });
    return { entity: condEntity, match: condMatch, conditions };
  }

  // MS3: the audience fields of the CURRENT form — shared by the
  // preview and the create submit so they can never drift apart.
  function audienceFields(): Record<string, unknown> {
    const out: Record<string, unknown> = { audienceType: bcForm.audienceType };
    if (bcForm.audienceType === "leads_stage") out.audienceStage = bcForm.audienceStage;
    if (bcForm.audienceType === "segment") out.audienceSegment = bcForm.audienceSegment;
    if (bcForm.audienceType === "custom") out.audienceDefinition = buildDefinition();
    if (bcForm.audienceType === "saved") out.audienceSavedId = bcForm.audienceSavedId || undefined;
    if (bcForm.audienceType === "csv") out.audienceCsv = csvText;
    return out;
  }

  // CX10: preview the CURRENT form's audience (counts + masked
  // sample) before any broadcast is created. Uses the same shared
  // resolver as the send path, so the numbers are the send numbers.
  // MS4: the SMS body rides along ONLY for the parts-based cost
  // estimate.
  async function runPreview() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await wrap("preview", () => apiFetch<BroadcastPreview>(`/organizations/${orgId}/messaging/broadcasts/preview`, {
      method: "POST",
      body: JSON.stringify({
        channel: bcForm.channel, ...audienceFields(),
        excludePreviousRecipients: bcForm.excludePreviousRecipients || undefined,
        body: bcForm.channel === "sms" && !bcForm.templateId ? bcForm.body : undefined,
        // MX9: the selected template's stored Meta category picks
        // the per-category rate in the cost estimate.
        whatsappTemplateId: bcForm.channel === "whatsapp" && bcForm.whatsappTemplateId ? bcForm.whatsappTemplateId : undefined,
        holdoutPercent: bcForm.holdoutPercent ? Number(bcForm.holdoutPercent) : undefined,
      }),
    }));
    if (res) setPreview(res);
  }

  // MX11: NL segment draft — returned only; saving goes through
  // the EXISTING saved-audience create path, by hand, below.
  async function runNlDraft() {
    const orgId = getOrganizationId(); if (!orgId || !nlDraft.description.trim()) return;
    const r = await wrap("ai-segment-draft", () => apiFetch<{ valid: boolean; draft: unknown; rawText: string | null; errors: string[]; notice?: string }>(`/organizations/${orgId}/messaging/ai/segment-draft`, {
      method: "POST", body: JSON.stringify({ description: nlDraft.description.trim(), entity: nlDraft.entity }),
    }));
    if (r) {
      setNlResult({ valid: r.valid, errors: r.errors ?? [], notice: r.notice });
      setNlDraftJson(r.draft ? JSON.stringify(r.draft, null, 2) : (r.rawText ?? ""));
    }
  }
  async function saveNlDraftAsAudience() {
    const orgId = getOrganizationId(); if (!orgId || !nlName.trim() || !nlDraftJson.trim()) return;
    let definition: unknown;
    try { definition = JSON.parse(nlDraftJson); } catch { setNotice(tr("messaging.msgDraftJsonInvalid")); return; }
    const r = await wrap("ai-segment-save", () => apiFetch<SavedAudience>(`/organizations/${orgId}/messaging/audiences`, { method: "POST", body: JSON.stringify({ name: nlName.trim(), definition }) }));
    if (r) { setNotice(tr("messaging.msgSavedAudienceCreated", { name: r.name })); setNlName(""); await load(); }
  }
  // MX11: apply the suppression suggestions for one channel —
  // the explicit human action; writes real opt-outs server-side.
  async function applySuppression() {
    const orgId = getOrganizationId(); if (!orgId || !suppression || suppression.suggestions.length === 0) return;
    if (!window.confirm(tr("messaging.msgSuppressConfirm", { count: fmtNumber(locale, suppression.suggestions.length), channel: suppressChannel }))) return;
    const r = await wrap("suppression-apply", () => apiFetch<{ applied: number; skipped: { reason: string }[] }>(`/organizations/${orgId}/messaging/suppression-suggestions/apply`, {
      method: "POST", body: JSON.stringify({ channel: suppressChannel, items: suppression.suggestions.map((s) => ({ type: s.type, id: s.id })) }),
    }));
    if (r) {
      setNotice(tr("messaging.msgSuppressApplied", { applied: fmtNumber(locale, r.applied), skipped: fmtNumber(locale, r.skipped.length) }));
      const s = await apiFetch<SuppressionResult>(`/organizations/${orgId}/messaging/suppression-suggestions`).catch(() => null);
      if (s) setSuppression(s);
      await load();
    }
  }

  // MS5: composer inserts go into Body or HTML Body per the
  // target toggle (product/coupon/variable chips share this path).
  function insertSnippet(snippetText: string, snippetHtml: string) {
    if (insertTarget === "html" && bcForm.channel === "email") {
      setBcForm((f) => ({ ...f, htmlBody: f.htmlBody ? `${f.htmlBody}\n${snippetHtml}` : snippetHtml }));
    } else {
      setBcForm((f) => ({ ...f, body: f.body ? `${f.body}\n${snippetText}` : snippetText }));
    }
  }

  // MS5: compose-check is advisory — the API never blocks a send
  // for it; warnings are debounced and shown verbatim (Bengali).
  useEffect(() => {
    if (bcForm.channel === "whatsapp" || bcForm.templateId) { setComposeWarnings([]); return; }
    if (!bcForm.body && !bcForm.subject) { setComposeWarnings([]); return; }
    const orgId = getOrganizationId(); if (!orgId) return;
    const t = setTimeout(() => {
      apiFetch<{ warnings: ComposeWarning[] }>(`/organizations/${orgId}/messaging/compose-check`, {
        method: "POST",
        body: JSON.stringify({ channel: bcForm.channel, subject: bcForm.subject || undefined, body: bcForm.body }),
      }).then((r) => setComposeWarnings(r.warnings)).catch(() => undefined);
    }, 600);
    return () => clearTimeout(t);
  }, [bcForm.channel, bcForm.templateId, bcForm.subject, bcForm.body]);

  // MS5: the variable set for the form's current audience —
  // customers/segment/custom(customers)/saved(customer) → customer
  // vars; leads → lead vars; csv → csv vars.
  function variableEntity(): "customer" | "lead" | "csv" {
    if (bcForm.audienceType === "csv") return "csv";
    if (bcForm.audienceType === "leads_stage") return "lead";
    if (bcForm.audienceType === "custom") return condEntity === "leads" ? "lead" : "customer";
    if (bcForm.audienceType === "saved") {
      const s = savedAudiences.find((x) => x.id === bcForm.audienceSavedId);
      return s?.definition.entity === "leads" ? "lead" : "customer";
    }
    return "customer";
  }

  // MS5: test-send one broadcast/template to one address. The API
  // guarantees the broadcast's counters/snapshot are untouched;
  // the result (or verbatim error) is shown next to the row.
  async function runTestSend(kind: "broadcast" | "template", id: string, to: string) {
    const orgId = getOrganizationId(); if (!orgId || !to.trim()) return;
    const setResult = kind === "broadcast" ? setBcTestResults : setTplTestResults;
    const r = await wrap(`test-${kind}-${id}`, () => apiFetch<TestSendResult>(`/organizations/${orgId}/messaging/${kind === "broadcast" ? "broadcasts" : "templates"}/${id}/test-send`, { method: "POST", body: JSON.stringify({ to: to.trim() }) }));
    if (r) setResult((s) => ({ ...s, [id]: r.status === "sent" ? tr("messaging.msgTestSent", { address: r.address }) + (r.providerMessageId ? ` · Provider ID: ${r.providerMessageId}` : "") : tr("messaging.msgTestFailed", { error: r.error ?? "Unknown error" }) }));
  }

  // MS6: Meta status badge for a WhatsApp template row. A null
  // status means the row was never verified against Meta.
  function waStatusBadge(t: WaTemplate) {
    if (!t.status) return <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">{tr("messaging.msgTplLocalOnly")}</span>;
    if (t.status === "APPROVED") return <span className="badge-green">{tr("messaging.msgTplMetaApproved")}</span>;
    if (t.status === "PENDING") return <span className="badge-amber">{tr("messaging.msgTplMetaPending")}</span>;
    if (t.status === "REJECTED") return <span className="badge-red">{tr("messaging.msgTplMetaRejected")}</span>;
    if (t.status === "NOT_ON_META") return <span className="rounded bg-slate-300 px-2 py-0.5 text-xs">{tr("messaging.msgTplMetaGone")}</span>;
    return <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">{t.status}</span>;
  }

  // MS1: one helper for every broadcast engine action; the API
  // refuses illegal transitions with an honest error, shown as-is.
  async function broadcastAction(b: Broadcast, action: string, body?: unknown, noticeText?: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await wrap(`${action}-${b.id}`, () => apiFetch<Broadcast>(`/organizations/${orgId}/messaging/broadcasts/${b.id}/${action}`, {
      method: "POST", ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }));
    if (res) { setNotice(noticeText ?? tr("messaging.msgBroadcastActionDone", { name: b.name, action })); await load(); }
  }

  // MS2: opted_out CSV export (raw fetch — apiFetch parses JSON).
  async function exportPreferences() {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap("pref-export", async () => {
      const res = await fetch(`${API_URL}/organizations/${orgId}/messaging/preferences/export`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? tr("messaging.msgExportFailed")); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "messaging-optouts.csv"; a.click();
      URL.revokeObjectURL(url);
      return true;
    });
  }

  // MX10: growth tools.
  async function loadGrowth() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const forms = await apiFetch<OptInForm[]>(`/organizations/${orgId}/messaging/optin-forms`).catch(() => null);
    if (forms) setGrowthForms(forms);
    const consent = await apiFetch<{ events: ConsentEvent[] }>(`/organizations/${orgId}/messaging/consent-events`).catch(() => null);
    if (consent) setConsentEvents(consent.events);
  }
  useEffect(() => { void loadGrowth(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function createGrowthForm() {
    const orgId = getOrganizationId(); if (!orgId || !growthDraft.name.trim()) return;
    const r = await wrap("growth-create", () => apiFetch<OptInForm>(`/organizations/${orgId}/messaging/optin-forms`, {
      method: "POST",
      body: JSON.stringify({
        name: growthDraft.name.trim(), channels: growthDraft.channels,
        topic: growthDraft.topic.trim() || undefined, keyword: growthDraft.keyword.trim() || undefined,
        doubleOptIn: growthDraft.doubleOptIn, headline: growthDraft.headline.trim() || undefined,
        popup: { enabled: growthDraft.popupEnabled, delaySeconds: Number(growthDraft.popupDelay) || 0 },
      }),
    }));
    if (r) { setNotice(tr("messaging.msgOptinCreated", { name: r.name, url: r.joinUrl })); setGrowthDraft({ name: "", channels: ["email"], topic: "", keyword: "", doubleOptIn: true, popupEnabled: false, popupDelay: "10", headline: "" }); await loadGrowth(); }
  }

  async function toggleGrowthQr(f: OptInForm) {
    if (growthQr[f.id]) { setGrowthQr((s) => { const n = { ...s }; delete n[f.id]; return n; }); return; }
    const orgId = getOrganizationId(); if (!orgId) return;
    const r = await wrap(`growth-qr-${f.id}`, () => apiFetch<{ url: string; dataUrl: string }>(`/organizations/${orgId}/messaging/optin-forms/${f.id}/qr`));
    if (r) setGrowthQr((s) => ({ ...s, [f.id]: r.dataUrl }));
  }

  async function deleteGrowthForm(f: OptInForm) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(tr("messaging.msgOptinDeleteConfirm", { name: f.name }))) return;
    const r = await wrap(`growth-del-${f.id}`, () => apiFetch(`/organizations/${orgId}/messaging/optin-forms/${f.id}`, { method: "DELETE" }));
    if (r) { setNotice(tr("messaging.msgOptinDeleted")); await loadGrowth(); }
  }

  async function issuePrefLink() {
    const orgId = getOrganizationId(); if (!orgId || !prefLink.address.trim()) return;
    const r = await wrap("pref-link", () => apiFetch<{ url: string }>(`/organizations/${orgId}/messaging/preferences/link`, {
      method: "POST", body: JSON.stringify({ channel: prefLink.channel, address: prefLink.address.trim() }),
    }));
    if (r) setPrefLink((s) => ({ ...s, url: r.url }));
  }

  async function previewCsvWiz() {
    const orgId = getOrganizationId(); if (!orgId || !csvWiz.text.trim()) return;
    const mapping: Record<string, string> = {};
    if (csvWiz.mapping.name) mapping.name = csvWiz.mapping.name;
    if (csvWiz.mapping.email) mapping.email = csvWiz.mapping.email;
    if (csvWiz.mapping.phone) mapping.phone = csvWiz.mapping.phone;
    const r = await wrap("csv-preview", () => apiFetch<CsvImportPreview>(`/organizations/${orgId}/messaging/csv-import/preview`, {
      method: "POST", body: JSON.stringify({ channel: csvWiz.channel, csv: csvWiz.text, mapping }),
    }));
    if (r) setCsvWiz((s) => ({ ...s, preview: r, committed: "" }));
  }

  async function commitCsvWiz() {
    const orgId = getOrganizationId(); if (!orgId || !csvWiz.preview) return;
    const r = await wrap("csv-commit", () => apiFetch<{ imported: number; suppressedOptOut: number; errors: { row: number; error: string }[] }>(`/organizations/${orgId}/messaging/csv-import/${csvWiz.preview!.importId}/commit`, { method: "POST", body: JSON.stringify({}) }));
    if (r) { setCsvWiz((s) => ({ ...s, committed: tr("messaging.msgCsvImportedFull", { count: fmtNumber(locale, r.imported) }) + (r.suppressedOptOut ? ` (${tr("messaging.msgCsvOptOutNote", { count: fmtNumber(locale, r.suppressedOptOut) })})` : "") + (r.errors.length ? ` · ${tr("messaging.msgCsvFailedSuffix", { count: fmtNumber(locale, r.errors.length) })}` : "") })); setNotice(tr("messaging.msgCsvDone")); }
  }

  async function downloadCsvReport() {
    const orgId = getOrganizationId(); if (!orgId || !csvWiz.preview) return;
    await wrap("csv-report", async () => {
      const res = await fetch(`${API_URL}/organizations/${orgId}/messaging/csv-import/${csvWiz.preview!.importId}/report.csv`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) throw new Error(tr("messaging.msgReportDownloadFailed"));
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "csv-import-hygiene.csv"; a.click(); URL.revokeObjectURL(url);
      return true;
    });
  }

  async function exportConsent() {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap("consent-export", async () => {
      const res = await fetch(`${API_URL}/organizations/${orgId}/messaging/consent-events/export`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) throw new Error(tr("messaging.msgConsentExportFailed"));
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "consent-events.csv"; a.click(); URL.revokeObjectURL(url);
      return true;
    });
  }

  // MS8: human-readable recurrence summary for rows + the form.
  const WEEKDAY_LABELS = [tr("messaging.msgDaySun"), tr("messaging.msgDayMon"), tr("messaging.msgDayTue"), tr("messaging.msgDayWed"), tr("messaging.msgDayThu"), tr("messaging.msgDayFri"), tr("messaging.msgDaySat")];
  function recurrenceText(rec: Recurrence): string {
    const base = rec.freq === "daily"
      ? rec.interval > 1 ? tr("messaging.msgEveryDays", { n: fmtNumber(locale, rec.interval) }) : tr("messaging.msgDaily")
      : rec.interval > 1 ? tr("messaging.msgEveryWeeks", { n: fmtNumber(locale, rec.interval) }) : tr("messaging.msgWeekly");
    const days = rec.freq === "weekly" && rec.weekdays?.length ? ` (${rec.weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ")})` : "";
    const end = rec.endsAt ? ` · ${tr("messaging.msgEndsLine")} ${fmtDate(locale, rec.endsAt)}` : "";
    return `${base}${days}${end}`;
  }

  // MS7: load (or close) a broadcast's report panel; opening it
  // also loads the first page of its paged deliveries.
  async function toggleReport(b: Broadcast) {
    if (reports[b.id]) { setReports((s) => { const n = { ...s }; delete n[b.id]; return n; }); return; }
    const orgId = getOrganizationId(); if (!orgId) return;
    const r = await wrap(`report-${b.id}`, () => apiFetch<BroadcastReport>(`/organizations/${orgId}/messaging/broadcasts/${b.id}/report`));
    if (r) { setReports((s) => ({ ...s, [b.id]: r })); void loadPagedDeliveries(b.id, true); }
  }

  // MS7: paged deliveries for the report panel — status filter +
  // address search + cursor load-more (page size 50 server-side).
  async function loadPagedDeliveries(broadcastId: string, reset: boolean) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const f = dlvFilter[broadcastId] ?? { status: "", q: "" };
    const cursor = reset ? "" : (pagedDlv[broadcastId]?.nextCursor ?? "");
    const params = new URLSearchParams();
    params.set("cursor", cursor);
    if (f.status) params.set("status", f.status);
    if (f.q.trim()) params.set("q", f.q.trim());
    const page = await wrap(`pdlv-${broadcastId}`, () => apiFetch<{ items: Delivery[]; nextCursor: string | null }>(`/organizations/${orgId}/messaging/broadcasts/${broadcastId}/deliveries?${params.toString()}`));
    if (!page) return;
    setPagedDlv((s) => ({
      ...s,
      [broadcastId]: reset
        ? { items: page.items, nextCursor: page.nextCursor }
        : { items: [...(s[broadcastId]?.items ?? []), ...page.items], nextCursor: page.nextCursor },
    }));
  }

  // MS7: deliveries CSV export (raw fetch, like the opt-out export).
  async function exportDeliveries(broadcastId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`dlv-export-${broadcastId}`, async () => {
      const res = await fetch(`${API_URL}/organizations/${orgId}/messaging/broadcasts/${broadcastId}/deliveries/export`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? tr("messaging.msgExportFailed")); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `broadcast-deliveries-${broadcastId}.csv`; a.click();
      URL.revokeObjectURL(url);
      return true;
    });
  }

  // MS8: install a journey preset — creates a real template +
  // workflow through the API; the workflow starts DISABLED, so
  // the note tells the merchant where to review + enable it.
  async function installJourney(p: JourneyPreset) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const r = await wrap(`journey-${p.key}`, () => apiFetch<{ workflow: { id: string; name: string }; template: { id: string; name: string }; templates?: { id: string; name: string }[] }>(`/organizations/${orgId}/messaging/journey-presets/${p.key}/install`, { method: "POST", body: JSON.stringify({}) }));
    if (r) {
      if (p.version === 2) {
        // MX5: v2 presets install as MX4 journeys — the review,
        // enable toggle and per-step reports all live in the
        // Journeys section below on THIS page.
        const tplText = r.templates?.length ? tr("messaging.msgTemplatesInstalled", { count: fmtNumber(locale, r.templates.length) }) + ` (${r.templates.map((t) => `"${t.name}"`).join(", ")})` : `Template "${r.template.name}"`;
        setJourneyResults((s) => ({ ...s, [p.key]: tr("messaging.msgInstallDoneTplJourney", { templates: tplText, name: r.workflow.name, id: r.workflow.id }) }));
        void loadJourneys();
      } else {
        setJourneyResults((s) => ({ ...s, [p.key]: tr("messaging.msgInstallDoneWfTpl", { wname: r.workflow.name, wid: r.workflow.id, tname: r.template.name }) }));
      }
    }
  }

  // ---------- MX4: custom journeys ----------
  async function loadJourneys() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const rows = await apiFetch<Journey[]>(`/organizations/${orgId}/messaging/journeys`).catch(() => null);
    if (rows) setJourneys(rows);
  }

  function journeyTriggerLabel(trigger: string): string {
    // MX5: scan-enrolled triggers are not builder triggers, so
    // they are not in the meta list — label them here instead of
    // showing the raw engine name.
    const SCAN_LABELS: Record<string, string> = {
      winback_due: tr("messaging.msgScanWinback"),
      anniversary_due: tr("messaging.msgScanAnniversary"),
      browse_abandoned: tr("messaging.msgScanBrowse"),
    };
    return journeyMeta?.triggers.find((t) => t.trigger === trigger)?.labelBn ?? SCAN_LABELS[trigger] ?? trigger;
  }

  // Draft steps keep condition values as STRINGS (form inputs);
  // serialize converts by the meta field kind, deserialize
  // converts back. Steps are otherwise the engine's own shape.
  function defaultJourneyStep(type: string): JourneyStep {
    if (type === "wait") return { type, minutes: 60 };
    if (type === "send_email") return { type, templateId: templates.find((t) => t.channel === "email")?.id ?? "" };
    if (type === "send_sms") return { type, templateId: templates.find((t) => t.channel === "sms")?.id ?? "" };
    if (type === "condition") return { type, field: "total", op: "gte", value: "1000" };
    if (type === "branch") return { type, field: "total", op: "gte", value: "1000", then: [], else: [] };
    return { type: "add_tag", tag: "", target: "lead" };
  }
  function draftSteps(steps: JourneyStep[]): JourneyStep[] {
    return (steps ?? []).map((s) => ({
      ...s,
      ...(s.value !== undefined ? { value: String(s.value) } : {}),
      ...(s.type === "branch" ? { then: draftSteps(s.then ?? []), else: draftSteps(s.else ?? []) } : {}),
    }));
  }
  function serializeJourneySteps(steps: JourneyStep[]): Record<string, unknown>[] {
    return steps.map((s) => {
      const out: Record<string, unknown> = { type: s.type };
      if (s.type === "wait") out.minutes = Number(s.minutes) || 0;
      if (s.type === "send_email" || s.type === "send_sms") out.templateId = s.templateId ?? "";
      if (s.type === "condition" || s.type === "branch") {
        const f = journeyMeta?.conditionFields.find((x) => x.field === s.field);
        const raw = String(s.value ?? "");
        out.field = s.field ?? ""; out.op = s.op ?? "eq";
        out.value = f?.kind === "boolean" ? raw === "true" : f?.kind === "number" ? (Number.isFinite(Number(raw)) && raw !== "" ? Number(raw) : raw) : raw;
      }
      if (s.type === "branch") { out.then = serializeJourneySteps(s.then ?? []); out.else = serializeJourneySteps(s.else ?? []); }
      if (s.type === "add_tag") { out.tag = s.tag ?? ""; out.target = s.target ?? "lead"; }
      return out;
    });
  }

  function startNewJourney() {
    setJourneyDraft({ id: null, name: "", trigger: journeyMeta?.triggers[0]?.trigger ?? "order_created", exitOnPurchase: false, steps: [{ type: "wait", minutes: 60 }] });
  }
  function startEditJourney(j: Journey) {
    setJourneyDraft({ id: j.id, name: j.name, trigger: j.trigger, exitOnPurchase: !!j.journey?.exitOnPurchase, steps: draftSteps(j.steps ?? []) });
  }

  // Draft step mutations: top-level by index; branch-arm by
  // (branch index, arm, sub index).
  function patchDraftStep(i: number, patch: Partial<JourneyStep>) {
    setJourneyDraft((d) => (d ? { ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d));
  }
  function moveDraftStep(i: number, dir: -1 | 1) {
    setJourneyDraft((d) => {
      if (!d) return d;
      const steps = [...d.steps]; const j = i + dir;
      if (j < 0 || j >= steps.length) return d;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...d, steps };
    });
  }
  function patchDraftSub(bi: number, arm: "then" | "else", si: number, patch: Partial<JourneyStep>) {
    setJourneyDraft((d) => (d ? { ...d, steps: d.steps.map((s, j) => (j === bi ? { ...s, [arm]: (s[arm] ?? []).map((x, k) => (k === si ? { ...x, ...patch } : x)) } : s)) } : d));
  }
  function moveDraftSub(bi: number, arm: "then" | "else", si: number, dir: -1 | 1) {
    setJourneyDraft((d) => {
      if (!d) return d;
      return { ...d, steps: d.steps.map((s, j) => {
        if (j !== bi) return s;
        const subs = [...(s[arm] ?? [])]; const k = si + dir;
        if (k < 0 || k >= subs.length) return s;
        [subs[si], subs[k]] = [subs[k], subs[si]];
        return { ...s, [arm]: subs };
      }) };
    });
  }

  async function saveJourneyDraft() {
    const orgId = getOrganizationId(); if (!orgId || !journeyDraft) return;
    const payload = {
      name: journeyDraft.name.trim(), trigger: journeyDraft.trigger,
      steps: serializeJourneySteps(journeyDraft.steps), exitOnPurchase: journeyDraft.exitOnPurchase,
    };
    if (journeyDraft.id) {
      const r = await wrap(`journey-save-${journeyDraft.id}`, () => apiFetch<{ workflow: Journey; note: string }>(`/organizations/${orgId}/messaging/journeys/${journeyDraft.id}`, { method: "PATCH", body: JSON.stringify(payload) }));
      if (r) { setNotice(tr("messaging.msgJourneyUpdated", { name: r.workflow.name, note: r.note })); setJourneyDraft(null); await loadJourneys(); }
    } else {
      const r = await wrap("journey-create", () => apiFetch<{ workflow: Journey; note: string }>(`/organizations/${orgId}/messaging/journeys`, { method: "POST", body: JSON.stringify(payload) }));
      if (r) { setNotice(tr("messaging.msgJourneyCreated", { name: r.workflow.name, note: r.note })); setJourneyDraft(null); await loadJourneys(); await load(); }
    }
  }

  async function toggleJourneyEnabled(j: Journey) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const r = await wrap(`journey-toggle-${j.id}`, () => apiFetch(`/organizations/${orgId}/messaging/journeys/${j.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !j.enabled }) }));
    if (r) { setNotice(tr("messaging.msgJourneyToggled", { name: j.name, state: j.enabled ? tr("messaging.msgStateOff") : tr("messaging.msgStateOn") })); await loadJourneys(); }
  }

  async function toggleJourneyDetail(j: Journey) {
    if (journeyDetails[j.id]) { setJourneyDetails((s) => { const n = { ...s }; delete n[j.id]; return n; }); return; }
    const orgId = getOrganizationId(); if (!orgId) return;
    const r = await wrap(`journey-detail-${j.id}`, () => apiFetch<JourneyDetail>(`/organizations/${orgId}/messaging/journeys/${j.id}`));
    if (r) setJourneyDetails((s) => ({ ...s, [j.id]: r }));
  }

  // MX4: one step's field editors (shared by top-level cards
  // and branch-arm sub-cards; `patch` writes back by position).
  function journeyStepFields(step: JourneyStep, patch: (p: Partial<JourneyStep>) => void) {
    if (step.type === "wait") {
      return <label className="block text-sm">{tr("messaging.msgWaitMinutes")}<input type="number" min={1} max={43200} className={inputCls} value={step.minutes ?? 60} onChange={(e) => patch({ minutes: Number(e.target.value) })} /></label>;
    }
    if (step.type === "send_email" || step.type === "send_sms") {
      const channel = step.type === "send_email" ? "email" : "sms";
      return (
        <label className="block text-sm">Template
          <select className={inputCls} value={step.templateId ?? ""} onChange={(e) => patch({ templateId: e.target.value })}>
            <option value="">{tr("messaging.msgPickTemplate")}</option>
            {templates.filter((t) => t.channel === channel).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      );
    }
    if (step.type === "condition" || step.type === "branch") {
      const fields = journeyMeta?.conditionFields ?? [];
      const f = fields.find((x) => x.field === step.field) ?? fields[0];
      return (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block text-sm">{tr("messaging.msgFieldLabel")}<select className={inputCls} value={step.field ?? ""} onChange={(e) => { const nf = fields.find((x) => x.field === e.target.value); patch({ field: e.target.value, op: nf?.ops[0] ?? "eq" }); }}>
              {fields.map((x) => <option key={x.field} value={x.field}>{x.labelBn}</option>)}
            </select>
          </label>
          <label className="block text-sm">{tr("messaging.msgOperatorLabel")}<select className={inputCls} value={step.op ?? "eq"} onChange={(e) => patch({ op: e.target.value })}>
              {(f?.ops ?? ["eq"]).map((op) => <option key={op} value={op}>{OP_LABEL_L[op] ?? op}</option>)}
            </select>
          </label>
          <label className="block text-sm">{tr("messaging.msgZValueLabel")}
            {f?.kind === "boolean" ? (
              <select className={inputCls} value={String(step.value ?? "true")} onChange={(e) => patch({ value: e.target.value })}>
                <option value="true">{tr("messaging.msgYesTrue")}</option><option value="false">{tr("messaging.msgNoFalse")}</option>
              </select>
            ) : (
              <input className={inputCls} value={String(step.value ?? "")} onChange={(e) => patch({ value: e.target.value })} placeholder={f?.kind === "number" ? tr("messaging.msgEx1000") : tr("messaging.msgValuePlaceholder")} />
            )}
          </label>
        </div>
      );
    }
    if (step.type === "add_tag") {
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-sm">{tr("messaging.msgFieldTag")}<input className={inputCls} value={step.tag ?? ""} onChange={(e) => patch({ tag: e.target.value })} placeholder={tr("messaging.msgTagPlaceholder")} /></label>
          <label className="block text-sm">{tr("messaging.msgOnWhomLabel")}<select className={inputCls} value={step.target ?? "lead"} onChange={(e) => patch({ target: e.target.value })}>
              <option value="lead">{tr("messaging.msgLeadOption")}</option><option value="conversation">{tr("messaging.msgConversationOption")}</option>
            </select>
          </label>
        </div>
      );
    }
    return null;
  }

  // MS9: AI copy drafts for the composer's current channel. The
  // API returns drafts only — nothing is saved or sent; a
  // variant fills the form fields only on an explicit click.
  async function runAiDraft() {
    const orgId = getOrganizationId(); if (!orgId || !aiForm.goal.trim()) return;
    const r = await wrap("ai-draft", () => apiFetch<AiDraftResult>(`/organizations/${orgId}/messaging/ai/draft`, {
      method: "POST",
      body: JSON.stringify({ channel: bcForm.channel, goal: aiForm.goal.trim(), productId: aiForm.productId || undefined, audienceHint: aiForm.audienceHint.trim() || undefined, language: aiForm.language }),
    }));
    if (r) setAiDraft(r);
  }

  async function runAiSubjects() {
    const orgId = getOrganizationId(); if (!orgId || !bcForm.subject.trim()) return;
    const r = await wrap("ai-subjects", () => apiFetch<AiSubjectsResult>(`/organizations/${orgId}/messaging/ai/subjects`, {
      method: "POST",
      body: JSON.stringify({ subject: bcForm.subject.trim(), goal: aiForm.goal.trim() || undefined }),
    }));
    if (r) setAiSubjects(r);
  }

  // MX16: comparative analytics loader (real aggregates only).
  async function loadAnalytics() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const qs = new URLSearchParams();
    if (analyticsRange.from) qs.set("from", analyticsRange.from);
    if (analyticsRange.to) qs.set("to", analyticsRange.to);
    const r = await wrap("analytics", () => apiFetch<ComparativeAnalytics>(`/organizations/${orgId}/messaging/analytics${qs.toString() ? `?${qs.toString()}` : ""}`));
    if (r) setAnalytics(r);
  }
  // MX16: CSV export — the file is built server-side from the
  // SAME aggregates as the on-screen table.
  async function exportAnalytics() {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap("analytics-export", async () => {
      const qs = new URLSearchParams();
      if (analyticsRange.from) qs.set("from", analyticsRange.from);
      if (analyticsRange.to) qs.set("to", analyticsRange.to);
      const res = await fetch(`${API_URL}/organizations/${orgId}/messaging/analytics/export.csv${qs.toString() ? `?${qs.toString()}` : ""}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? tr("messaging.msgExportFailed")); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "messaging-analytics.csv"; a.click();
      URL.revokeObjectURL(url);
      return true;
    });
  }
  // MX16: A/B auto-winner per-pair control (chunk-boundary effect).
  async function setAbAutoWinner(b: Broadcast, enabled: boolean | null) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await wrap(`abw-${b.id}`, () => apiFetch<{ enabled: boolean }>(`/organizations/${orgId}/messaging/broadcasts/${b.id}/ab-auto-winner`, { method: "POST", body: JSON.stringify({ enabled }) }));
    if (res) { setNotice(tr("messaging.msgAbWinnerNotice", { name: b.name, state: res.enabled ? tr("messaging.msgAbWinnerOn") : tr("messaging.msgAbWinnerOff") })); await load(); if (reports[b.id]) { const r = await apiFetch<BroadcastReport>(`/organizations/${orgId}/messaging/broadcasts/${b.id}/report`).catch(() => null); if (r) setReports((st) => ({ ...st, [b.id]: r })); } }
  }
  // MX16: campaign planner — proposal only; every piece is used
  // by an explicit click below, nothing is created automatically.
  async function runPlanner() {
    const orgId = getOrganizationId(); if (!orgId || !aiForm.goal.trim()) return;
    const r = await wrap("ai-plan", () => apiFetch<PlannerResult>(`/organizations/${orgId}/messaging/ai/planner`, { method: "POST", body: JSON.stringify({ goal: aiForm.goal.trim(), channel: bcForm.channel, audienceHint: aiForm.audienceHint.trim() || undefined, language: aiForm.language }) }));
    if (r) setPlanner(r);
  }
  async function runTranslate(target: "bn" | "en") {
    const orgId = getOrganizationId(); if (!orgId || !bcForm.body.trim()) return;
    const r = await wrap("ai-translate", () => apiFetch<TranslateResult>(`/organizations/${orgId}/messaging/ai/translate`, { method: "POST", body: JSON.stringify({ subject: bcForm.subject || undefined, body: bcForm.body, targetLanguage: target }) }));
    if (r) setTranslation(r);
  }
  async function runSubjectScore() {
    const orgId = getOrganizationId(); if (!orgId || !bcForm.subject.trim()) return;
    const r = await wrap("subject-score", () => apiFetch<SubjectScore>(`/organizations/${orgId}/messaging/ai/subject-score`, { method: "POST", body: JSON.stringify({ subject: bcForm.subject }) }));
    if (r) setSubjectScore(r);
  }
  async function runRecipientSendTime() {
    const orgId = getOrganizationId(); if (!orgId || !recipientTimeKey.trim()) return;
    const r = await wrap("recipient-time", () => apiFetch<RecipientSendTime>(`/organizations/${orgId}/messaging/ai/send-time-recipient?recipientKey=${encodeURIComponent(recipientTimeKey.trim())}`));
    if (r) setRecipientSendTime(r);
  }

  function applyAiVariant(v: AiDraftVariant) {
    if ((bcForm.body.trim() || bcForm.subject.trim()) && !window.confirm(tr("messaging.msgApplyDraftConfirm"))) return;
    setBcForm((f) => ({ ...f, ...(v.subject !== undefined ? { subject: v.subject } : {}), body: v.body }));
    setNotice(tr("messaging.msgAiDraftApplied"));
  }

  // MS10: broadcast management (edit / clone / delete / archive).
  const toLocalInput = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  function startBcEdit(b: Broadcast) {
    setBcEditId(b.id);
    setBcEditForm({
      name: b.name, subject: b.subject ?? "", body: b.body ?? "", htmlBody: b.htmlBody ?? "",
      templateId: b.templateId ?? "", whatsappTemplateId: b.whatsappTemplateId ?? "",
      templateParams: (b.templateParams ?? []).join(", "), scheduledAt: toLocalInput(b.scheduledAt), pushUrl: b.pushUrl ?? "",
      tgButtons: (b.telegramButtons ?? []).map((x) => ({ label: x.label, url: x.url })), onsiteUrl: b.onsiteUrl ?? "",
    });
  }

  async function saveBcEdit(b: Broadcast) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const payload: Record<string, unknown> = { name: bcEditForm.name };
    if (b.channel === "whatsapp") {
      if (bcEditForm.whatsappTemplateId) payload.whatsappTemplateId = bcEditForm.whatsappTemplateId;
      payload.templateParams = bcEditForm.templateParams ? bcEditForm.templateParams.split(",").map((x) => x.trim()) : [];
    } else {
      payload.templateId = bcEditForm.templateId || null;
      if (b.channel === "email") {
        payload.subject = bcEditForm.subject || null;
        payload.htmlBody = bcEditForm.htmlBody ? bcEditForm.htmlBody : null;
      }
      if (b.channel === "push") {
        // MX12: for push, subject is the notification title.
        payload.subject = bcEditForm.subject || null;
        payload.pushUrl = bcEditForm.pushUrl.trim() ? bcEditForm.pushUrl.trim() : null;
      }
      if (b.channel === "onsite") {
        // MX14: for onsite, subject is the notification title.
        payload.subject = bcEditForm.subject || null;
        payload.onsiteUrl = bcEditForm.onsiteUrl.trim() ? bcEditForm.onsiteUrl.trim() : null;
      }
      if (b.channel === "telegram") {
        // MX13: telegram has no subject — the buttons ride
        // along (empty rows dropped; no rows = text-only).
        const btns = bcEditForm.tgButtons.filter((x) => x.label.trim() && x.url.trim());
        payload.telegramButtons = btns.length ? btns : null;
      }
      payload.body = bcEditForm.body;
    }
    if (b.status === "draft" || b.status === "scheduled") {
      payload.scheduledAt = bcEditForm.scheduledAt ? new Date(bcEditForm.scheduledAt).toISOString() : null;
    }
    const r = await wrap(`bc-edit-${b.id}`, () => apiFetch<Broadcast>(`/organizations/${orgId}/messaging/broadcasts/${b.id}`, { method: "PATCH", body: JSON.stringify(payload) }));
    if (r) { setBcEditId(null); setNotice(tr("messaging.msgBroadcastUpdated", { name: r.name })); await load(); }
  }

  async function cloneBc(b: Broadcast) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const r = await wrap(`bc-clone-${b.id}`, () => apiFetch<Broadcast & { cloneNote?: string }>(`/organizations/${orgId}/messaging/broadcasts/${b.id}/clone`, { method: "POST" }));
    if (r) { setNotice(tr("messaging.msgBroadcastCloned", { name: r.name }) + (r.cloneNote ? ` ${r.cloneNote}` : "")); await load(); }
  }

  async function deleteBc(b: Broadcast) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(tr("messaging.msgBroadcastDeleteConfirm", { name: b.name }))) return;
    const r = await wrap(`bc-delete-${b.id}`, () => apiFetch(`/organizations/${orgId}/messaging/broadcasts/${b.id}`, { method: "DELETE" }));
    if (r) { setNotice(tr("messaging.msgBroadcastDeleted", { name: b.name })); await load(); }
  }

  async function archiveBc(b: Broadcast, archived: boolean) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const r = await wrap(`bc-archive-${b.id}`, () => apiFetch(`/organizations/${orgId}/messaging/broadcasts/${b.id}/${archived ? "archive" : "unarchive"}`, { method: "POST" }));
    if (r) { setNotice(archived ? tr("messaging.msgBroadcastArchived", { name: b.name }) : tr("messaging.msgBroadcastUnarchived", { name: b.name })); await load(); }
  }

  // MS10: template management (the API already had PATCH/DELETE;
  // duplicate goes through the existing create).
  async function duplicateTemplate(t: Template) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const r = await wrap(`tpl-dup-${t.id}`, () => apiFetch(`/organizations/${orgId}/messaging/templates`, {
      method: "POST",
      body: JSON.stringify({ name: `${t.name} ${tr("messaging.msgCopySuffix")}`, channel: t.channel, subject: t.channel === "email" ? (t.subject ?? undefined) : undefined, body: t.body, htmlBody: t.channel === "email" && t.htmlBody ? t.htmlBody : undefined }),
    }));
    if (r) { setNotice(tr("messaging.msgTemplateCopied", { name: t.name })); await load(); }
  }

  async function deleteTemplateRow(t: Template) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(tr("messaging.msgTemplateDeleteConfirm", { name: t.name }))) return;
    const r = await wrap(`tpl-del-${t.id}`, () => apiFetch(`/organizations/${orgId}/messaging/templates/${t.id}`, { method: "DELETE" }));
    if (r) { setNotice(tr("messaging.msgTemplateDeleted", { name: t.name })); await load(); }
  }

  // ---------- MX7: email builder ----------
  function openBuilder(t?: Template) {
    // A hand-authored template opens with its existing body as a
    // single text block (content preserved); saving in the
    // builder then converts it to a block template.
    if (t) setBuilder({ templateId: t.id, name: t.name, subject: t.subject ?? "", blocks: t.blocks?.length ? t.blocks.map((b) => ({ ...b })) : [{ type: "text", text: t.body }] });
    else setBuilder({ templateId: null, name: "", subject: "", blocks: [newEmailBlock("text")] });
    setBuilderPreview(null);
  }
  async function previewBuilder() {
    const orgId = getOrganizationId(); if (!orgId || !builder) return;
    const r = await wrap("builder-preview", () => apiFetch<BlocksPreview>(`/organizations/${orgId}/messaging/blocks/preview`, {
      method: "POST", body: JSON.stringify({ blocks: builder.blocks.map(cleanBlock) }),
    }));
    if (r) setBuilderPreview(r);
  }
  async function saveBuilder() {
    const orgId = getOrganizationId(); if (!orgId || !builder) return;
    const payload = { name: builder.name, subject: builder.subject, blocks: builder.blocks.map(cleanBlock) };
    const r = await wrap("builder-save", () => builder.templateId
      ? apiFetch<Template & { emptySlots?: BlocksPreview["emptySlots"] }>(`/organizations/${orgId}/messaging/templates/${builder.templateId}`, { method: "PATCH", body: JSON.stringify(payload) })
      : apiFetch<Template & { emptySlots?: BlocksPreview["emptySlots"] }>(`/organizations/${orgId}/messaging/templates`, { method: "POST", body: JSON.stringify({ ...payload, channel: "email" }) }));
    if (r) {
      setNotice(r.emptySlots?.length
        ? tr("messaging.msgTemplateSavedEmptySlots", { count: fmtNumber(locale, r.emptySlots.length) })
        : tr("messaging.msgBuilderTemplateSaved"));
      setBuilder(null); await load();
    }
  }
  async function saveBlockToLibrary(block: EmailBlock) {
    const orgId = getOrganizationId(); if (!orgId || !cbName.trim()) return;
    const r = await wrap("cb-create", () => apiFetch(`/organizations/${orgId}/messaging/content-blocks`, {
      method: "POST", body: JSON.stringify({ name: cbName.trim(), block: cleanBlock(block) }),
    }));
    if (r) { setCbName(""); setNotice(tr("messaging.msgBlockSavedLibrary")); await load(); }
  }
  async function deleteContentBlockRow(cb: ContentBlock) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const r = await wrap(`cb-del-${cb.id}`, () => apiFetch(`/organizations/${orgId}/messaging/content-blocks/${cb.id}`, { method: "DELETE" }));
    if (r) { setNotice(tr("messaging.msgContentBlockDeleted")); await load(); }
  }
  async function installPack(pack: FestivalPack) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const r = await wrap(`pack-${pack.key}`, () => apiFetch<{ template: Template }>(`/organizations/${orgId}/messaging/template-packs/${pack.key}/install`, { method: "POST", body: JSON.stringify({}) }));
    if (r) { setNotice(tr("messaging.msgPackTemplateCreated", { name: locale === "en" ? pack.name : pack.nameBn })); await load(); }
  }
  async function toggleVersions(t: Template) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (tplVersions[t.id]) { setTplVersions((s) => { const n = { ...s }; delete n[t.id]; return n; }); return; }
    const r = await wrap(`tpl-ver-${t.id}`, () => apiFetch<TemplateVersion[]>(`/organizations/${orgId}/messaging/templates/${t.id}/versions`));
    if (r) setTplVersions((s) => ({ ...s, [t.id]: r }));
  }
  async function restoreVersion(t: Template, version: number) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(tr("messaging.msgRestoreVersionConfirm", { version: fmtNumber(locale, version) }))) return;
    const r = await wrap(`tpl-restore-${t.id}-${version}`, () => apiFetch(`/organizations/${orgId}/messaging/templates/${t.id}/versions/${version}/restore`, { method: "POST", body: JSON.stringify({}) }));
    if (r) { setNotice(tr("messaging.msgVersionRestored", { name: t.name, version: fmtNumber(locale, version) })); setTplVersions((s) => { const n = { ...s }; delete n[t.id]; return n; }); await load(); }
  }

  async function saveTplEdit(t: Template) {
    const orgId = getOrganizationId(); if (!orgId || !tplEdit) return;
    const r = await wrap(`tpl-edit-${t.id}`, () => apiFetch(`/organizations/${orgId}/messaging/templates/${t.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: tplEdit.name, subject: t.channel === "email" ? (tplEdit.subject || null) : undefined, body: tplEdit.body, htmlBody: t.channel === "email" ? (tplEdit.htmlBody || null) : undefined }),
    }));
    if (r) { setTplEdit(null); setNotice(tr("messaging.msgTemplateUpdated", { name: tplEdit.name })); await load(); }
  }

  const inputCls = "input mt-1";

  return (
    <div className="space-y-8">
      <div className="msg-hero">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight text-white">💬 Messaging</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/85">{tr("messaging.msgIntro")}</p>
          </div>
          <button type="button" className="msg-hero-cta" onClick={() => setTab("campaigns")}>{tr("messaging.msgZNewBroadcast")}</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="msg-kpi">🧩 Templates <strong>{templates.length}</strong></span>
          <span className="msg-kpi">{tr("messaging.msgBroadcastsLoaded")}<strong>{broadcasts.length}</strong></span>
          <span className="msg-kpi">{tr("messaging.msgPendingApprovalTab")}<strong>{approvals.length}</strong></span>
          <span className="msg-kpi">{tr("messaging.msgKeywordRulesTab")}<strong>{kwRules.length}</strong></span>
          <span className="msg-kpi">🧭 Journeys <strong>{journeys.length}</strong></span>
        </div>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="msg-tabbar">
        <div className="view-switch msg-tabs" role="tablist" aria-label={tr("messaging.msgSectionTitle")}>
          {msgTabsFor(locale).map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`view-switch-btn whitespace-nowrap ${tab === t.id ? "view-switch-btn-active" : ""}`}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>

      {status ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className={`rounded-xl border p-4 text-sm ${status.email.configured ? "bg-green-50" : "bg-amber-50"}`}>
            <span className="font-semibold">Email (SMTP):</span> {status.email.configured
              ? status.email.path === "tenant" ? tr("messaging.msgOwnSmtp") : tr("messaging.msgPlatformSmtp")
              : tr("messaging.msgSmtpNotConfigured")}
          </div>
          <div className={`rounded-xl border p-4 text-sm ${status.sms.configured ? "bg-green-50" : "bg-amber-50"}`}>
            <span className="font-semibold">SMS ({status.sms.provider}):</span> {status.sms.configured
              ? status.sms.path === "tenant" ? tr("messaging.msgOwnGateway") : tr("messaging.msgPlatformGateway")
              : tr("messaging.msgGatewayNotConfigured")}
          </div>
        </div>
      ) : null}

      {/* FESTIVAL & MEGA SALE BROADCAST ENGINE */}
      <FestivalBlastHub
        storeName={storeInfo.name}
        storeUrl={storeInfo.url}
        onApplyTemplate={handleApplyFestivalTemplate}
      />

      {tab === "templates" ? (<>
      <div className="space-y-3 card p-5 msg-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">Templates ({templates.length})</div>
          <input className="input w-64 py-1 text-sm" placeholder={tr("messaging.msgTemplateSearchPlaceholder")} value={tplSearch} onChange={(e) => setTplSearch(e.target.value)} />
        </div>
        <p className="text-[11px] text-slate-400 -mt-1">{tr("messaging.msgTemplateSearchNote")}</p>
        {templates.filter((t) => { const q = tplSearch.trim().toLowerCase(); if (!q) return true; return [t.name, t.subject ?? "", t.body].join(" ").toLowerCase().includes(q); }).map((t) => (
          <div key={t.id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex items-center justify-between"><span className="font-medium">{t.name}</span><span className="flex gap-1"><span className="rounded bg-slate-200 px-2 py-0.5 text-xs capitalize">{t.channel}</span>{t.htmlBody ? <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">{tr("messaging.msgHasHtml")}</span> : null}</span></div>
            {t.subject ? <div className="text-slate-600">Subject: {t.subject}</div> : null}
            <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{t.body}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
              <input className="input w-64" placeholder={t.channel === "email" ? tr("messaging.msgTestEmailPlaceholder") : tr("messaging.msgTestPhonePlaceholder")} value={tplTestInputs[t.id] ?? ""} onChange={(e) => setTplTestInputs((s) => ({ ...s, [t.id]: e.target.value }))} />
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !(tplTestInputs[t.id] ?? "").trim()} onClick={() => runTestSend("template", t.id, tplTestInputs[t.id] ?? "")}>{busy === `test-template-${t.id}` ? tr("messaging.msgSending") : tr("messaging.msgTestSendBtn")}</button>
              {tplTestResults[t.id] ? <span className="text-xs">{tplTestResults[t.id]}</span> : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => setTplEdit(tplEdit?.id === t.id ? null : { id: t.id, name: t.name, subject: t.subject ?? "", body: t.body, htmlBody: t.htmlBody ?? "" })}>{tplEdit?.id === t.id ? tr("messaging.msgEditClose") : tr("messaging.msgEditBtn")}</button>
              <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => duplicateTemplate(t)}>{tr("messaging.msgDuplicate")}</button>
              {t.channel === "email" ? <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => openBuilder(t)}>{tr("messaging.msgOpenInBuilder")}</button> : null}
              <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleVersions(t)}>🕘 Version {t.version ?? 1}</button>
              <button type="button" className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => deleteTemplateRow(t)}>{tr("messaging.msgDelete")}</button>
              <span className="text-[11px] text-slate-400">{tr("messaging.msgDeleteRoleNote")}</span>
            </div>
            {tplVersions[t.id] ? (
              <div className="mt-2 grid gap-1.5 rounded-lg border bg-white p-3 text-xs">
                <div className="font-semibold">{tr("messaging.msgVersionHistoryNote")}</div>
                {tplVersions[t.id].length === 0 ? <p className="text-slate-500">{tr("messaging.msgNoVersions")}</p> : tplVersions[t.id].map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center gap-2 border-t pt-1.5">
                    <span className="font-semibold">v{v.version}</span>
                    <span className="text-slate-500">{fmtDateTime(locale, v.createdAt)}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-600">{v.subject ? `Subject: ${v.subject} · ` : ""}{v.body.slice(0, 90)}</span>
                    {v.version !== (t.version ?? 1) ? <button type="button" className="rounded border px-2 py-0.5 font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => restoreVersion(t, v.version)}>Restore</button> : <span className="rounded bg-green-100 px-2 py-0.5 text-green-700">{tr("messaging.msgCurrent")}</span>}
                  </div>
                ))}
              </div>
            ) : null}
            {tplEdit?.id === t.id ? (
              <div className="mt-2 grid gap-2 rounded-lg border bg-white p-3">
                <label className="block text-sm">{tr("messaging.msgNameLabel")}<input className={inputCls} value={tplEdit.name} onChange={(e) => setTplEdit({ ...tplEdit, name: e.target.value })} /></label>
                {t.channel === "email" ? <label className="block text-sm">Subject<input className={inputCls} value={tplEdit.subject} onChange={(e) => setTplEdit({ ...tplEdit, subject: e.target.value })} /></label> : null}
                <label className="block text-sm">Body (Text)<textarea className={inputCls} rows={3} value={tplEdit.body} onChange={(e) => setTplEdit({ ...tplEdit, body: e.target.value })} /></label>
                {t.channel === "email" ? <label className="block text-sm">{tr("messaging.msgHtmlBodyOptional")}<textarea className={inputCls} rows={3} value={tplEdit.htmlBody} onChange={(e) => setTplEdit({ ...tplEdit, htmlBody: e.target.value })} /></label> : null}
                <div className="flex gap-2">
                  <button type="button" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => saveTplEdit(t)}>{busy === `tpl-edit-${t.id}` ? tr("messaging.msgSaving") : tr("messaging.msgSave")}</button>
                  <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={() => setTplEdit(null)}>{tr("messaging.msgCancel")}</button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        <form className="grid gap-3 border-t pt-3 lg:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const res = await wrap("tpl", () => apiFetch(`/organizations/${orgId}/messaging/templates`, { method: "POST", body: JSON.stringify({ ...tplForm, subject: tplForm.channel === "email" ? tplForm.subject : undefined, htmlBody: tplForm.channel === "email" && tplForm.htmlBody ? tplForm.htmlBody : undefined }) }));
          if (res) { setTplForm({ name: "", channel: "email", subject: "", body: "", htmlBody: "" }); await load(); }
        }}>
          <label className="block text-sm">{tr("messaging.msgTemplateNameLabel")}<input className={inputCls} value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} required /></label>
          <label className="block text-sm">Channel
            <select className={inputCls} value={tplForm.channel} onChange={(e) => setTplForm({ ...tplForm, channel: e.target.value })}>
              <option value="email">Email</option><option value="sms">SMS</option>
            </select>
          </label>
          {tplForm.channel === "email" ? <label className="block text-sm lg:col-span-2">Subject<input className={inputCls} value={tplForm.subject} onChange={(e) => setTplForm({ ...tplForm, subject: e.target.value })} required /></label> : null}
          <label className="block text-sm lg:col-span-2">{tr("messaging.msgBodyTextLabel")}<textarea className={inputCls} rows={3} value={tplForm.body} onChange={(e) => setTplForm({ ...tplForm, body: e.target.value })} required /></label>
          {tplForm.channel === "email" ? (<>
            <label className="block text-sm lg:col-span-2">{tr("messaging.msgHtmlBodyLabelLong")}<textarea className={inputCls} rows={4} value={tplForm.htmlBody} onChange={(e) => setTplForm({ ...tplForm, htmlBody: e.target.value })} placeholder={`<p>${tr("messaging.msgHelloPlaceholder")}</p>`} /></label>
            {tplForm.htmlBody ? <div className="lg:col-span-2">
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={() => setTplHtmlPreview((v) => !v)}>{tplHtmlPreview ? tr("messaging.msgHidePreview") : tr("messaging.msgHtmlPreviewBtn")}</button>
              {tplHtmlPreview ? <iframe title={tr("messaging.msgTemplateHtmlPreview")} sandbox="" srcDoc={tplForm.htmlBody} className="mt-2 h-64 w-full rounded-lg border bg-white" /> : null}
              <p className="mt-1 text-[11px] text-slate-400">{tr("messaging.msgPreviewSandboxNote")}</p>
            </div> : null}
          </>) : null}
          <button className="self-end btn-primary disabled:opacity-50" disabled={busy !== ""}>{tr("messaging.msgCreateTemplate")}</button>
        </form>
      </div>
      </>) : null}

      {tab === "templates" ? (<>
      <div className="space-y-3 card p-5 msg-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">{tr("messaging.msgBuilderSectionTitle")}</div>
          <button type="button" className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy !== ""} onClick={() => openBuilder()}>{tr("messaging.msgNewBuilderTemplate")}</button>
        </div>
        <p className="text-xs text-slate-500">
          {tr("messaging.msgBuilderIntro")}
          {tr("messaging.msgZBrandKitFrom")}{brandKit ? `: ${brandKit.brandName ?? tr("messaging.msgNoName")}${brandKit.primaryColor ? ` · ${brandKit.primaryColor}` : ""}${brandKit.font ? ` · ${tr("messaging.msgZFontLabel")}: ${brandKit.font}` : ""}` : ""} {tr("messaging.msgZBrandKitNote")}
        </p>

        {festivalPacks.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">{tr("messaging.msgFestivalPacksTitle")}</span>
            {festivalPacks.map((p) => (
              <button key={p.key} type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => installPack(p)}>{busy === `pack-${p.key}` ? tr("messaging.msgCreating") : p.nameBn}</button>
            ))}
            <span className="text-[11px] text-slate-400">{tr("messaging.msgPackNote")}</span>
          </div>
        ) : null}

        {builder ? (
          <div className="space-y-3 rounded-lg border bg-white p-3">
            <div className="grid gap-2 lg:grid-cols-2">
              <label className="block text-sm">{tr("messaging.msgTemplateNameLabel")}<input className={inputCls} value={builder.name} onChange={(e) => setBuilder({ ...builder, name: e.target.value })} /></label>
              <label className="block text-sm">Subject<input className={inputCls} value={builder.subject} onChange={(e) => setBuilder({ ...builder, subject: e.target.value })} /></label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(blockLabelsFor(locale)) as EmailBlockType[]).map((type) => (
                <button key={type} type="button" className="rounded-lg border px-2.5 py-1 text-xs font-semibold" onClick={() => setBuilder({ ...builder, blocks: [...builder.blocks, newEmailBlock(type)] })}>+ {blockLabelsFor(locale)[type]}</button>
              ))}
              <span className="ml-1 flex items-center gap-1 text-xs text-slate-500">
                <input className="input w-44 py-1 text-xs" placeholder={tr("messaging.msgLibraryNameLabel")} value={cbName} onChange={(e) => setCbName(e.target.value)} />{tr("messaging.msgLibraryNote")}</span>
            </div>
            {contentBlocks.length ? (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs font-semibold text-slate-600">📚 Content Library:</span>
                {contentBlocks.map((cb) => (
                  <span key={cb.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                    <button type="button" className="font-semibold" title={tr("messaging.msgAddToBuilder")} onClick={() => setBuilder({ ...builder, blocks: [...builder.blocks, { ...cb.data }] })}>{cb.name} ({blockLabelsFor(locale)[cb.kind as EmailBlockType] ?? cb.kind})</button>
                    <button type="button" className="text-red-600" title={tr("messaging.msgDelete")} onClick={() => deleteContentBlockRow(cb)}>✕</button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="space-y-2">
              {builder.blocks.map((b, i) => (
                <div key={i} draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragIdx !== null) setBuilder({ ...builder, blocks: moveBlock(builder.blocks, dragIdx, i) }); setDragIdx(null); }}
                  className="rounded-lg border bg-slate-50 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="cursor-grab text-xs font-semibold" title={tr("messaging.msgDragToArrange")}>⠿ {blockLabelsFor(locale)[b.type]}</span>
                    <span className="ml-auto flex gap-1">
                      <button type="button" className="rounded border px-2 py-0.5 text-xs" disabled={i === 0} onClick={() => setBuilder({ ...builder, blocks: moveBlock(builder.blocks, i, i - 1) })}>↑</button>
                      <button type="button" className="rounded border px-2 py-0.5 text-xs" disabled={i === builder.blocks.length - 1} onClick={() => setBuilder({ ...builder, blocks: moveBlock(builder.blocks, i, i + 1) })}>↓</button>
                      <button type="button" className="rounded border px-2 py-0.5 text-xs disabled:opacity-50" disabled={!cbName.trim()} title={tr("messaging.msgSaveToLibraryTitle")} onClick={() => saveBlockToLibrary(b)}>📚</button>
                      <button type="button" className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700" onClick={() => setBuilder({ ...builder, blocks: builder.blocks.filter((_, j) => j !== i) })}>{tr("messaging.msgDelete")}</button>
                    </span>
                  </div>
                  {b.type === "text" ? <textarea className={inputCls} rows={3} value={b.text ?? ""} placeholder={tr("messaging.msgTextBlockHint")} onChange={(e) => setBuilder({ ...builder, blocks: builder.blocks.map((x, j) => j === i ? { ...x, text: e.target.value } : x) })} /> : null}
                  {b.type === "image" ? (<div className="grid gap-2 lg:grid-cols-2">
                    <label className="block text-xs">{tr("messaging.msgImageUrlLabel")}<input className={inputCls} value={b.url ?? ""} onChange={(e) => setBuilder({ ...builder, blocks: builder.blocks.map((x, j) => j === i ? { ...x, url: e.target.value } : x) })} /></label>
                    <label className="block text-xs">{tr("messaging.msgAltTextLabel")}<input className={inputCls} value={b.alt ?? ""} onChange={(e) => setBuilder({ ...builder, blocks: builder.blocks.map((x, j) => j === i ? { ...x, alt: e.target.value } : x) })} /></label>
                  </div>) : null}
                  {b.type === "button" ? (<div className="grid gap-2 lg:grid-cols-2">
                    <label className="block text-xs">{tr("messaging.msgButtonTextLabel")}<input className={inputCls} value={b.label ?? ""} onChange={(e) => setBuilder({ ...builder, blocks: builder.blocks.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} /></label>
                    <label className="block text-xs">{tr("messaging.msgLinkLabel")}<input className={inputCls} value={b.url ?? ""} onChange={(e) => setBuilder({ ...builder, blocks: builder.blocks.map((x, j) => j === i ? { ...x, url: e.target.value } : x) })} /></label>
                  </div>) : null}
                  {b.type === "product" ? (
                    <label className="block text-xs">{tr("messaging.msgPickRealProduct")}<select className={inputCls} value={b.productId ?? ""} onChange={(e) => setBuilder({ ...builder, blocks: builder.blocks.map((x, j) => j === i ? { ...x, productId: e.target.value || null } : x) })}>
                        <option value="">{tr("messaging.msgSlotEmpty")}</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>) : null}
                  {b.type === "coupon" ? (
                    <div className="grid gap-2 lg:grid-cols-2">
                      <label className="block text-xs">{tr("messaging.msgPickRealDiscount")}<select className={inputCls} value={b.discountId ?? ""} onChange={(e) => setBuilder({ ...builder, blocks: builder.blocks.map((x, j) => j === i ? { ...x, discountId: e.target.value || null } : x) })}>
                          <option value="">{tr("messaging.msgNotDiscount")}</option>
                          {discounts.map((d) => <option key={d.id} value={d.id}>{d.code} ({d.kind === "percent" ? `${d.value}%` : d.kind === "free_shipping" ? tr("messaging.msgFreeDelivery") : `${d.value}`})</option>)}
                        </select>
                      </label>
                      <label className="block text-xs">{tr("messaging.msgCustomCodeLabel")}<input className={inputCls} value={b.code ?? ""} placeholder={tr("messaging.msgExEid20")} onChange={(e) => setBuilder({ ...builder, blocks: builder.blocks.map((x, j) => j === i ? { ...x, code: e.target.value || null } : x) })} /></label>
                    </div>) : null}
                  {b.type === "divider" ? <p className="text-xs text-slate-400">{tr("messaging.msgDividerNote")}</p> : null}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={previewBuilder}>{busy === "builder-preview" ? tr("messaging.msgPreviewing") : tr("messaging.msgPreviewServerBtn")}</button>
              <button type="button" className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy !== "" || !builder.name.trim() || !builder.subject.trim() || builder.blocks.length === 0} onClick={saveBuilder}>{busy === "builder-save" ? tr("messaging.msgSaving") : tr("messaging.msgSaveTemplateBtn")}</button>
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={() => setBuilder(null)}>{tr("messaging.msgClose")}</button>
            </div>
            {builderPreview ? (
              <div>
                {builderPreview.emptySlots.length ? <p className="mb-1 text-xs text-amber-700">{tr("messaging.msgZEmptySlots")}: {builderPreview.emptySlots.map((s) => `#${s.index + 1} ${s.type} — ${s.reason}`).join("; ")}</p> : null}
                <iframe title={tr("messaging.msgBuilderPreviewTitle")} sandbox="" srcDoc={builderPreview.htmlBody} className="h-72 w-full rounded-lg border bg-white" />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      </>) : null}

      {tab === "growth" ? (<>
      <div className="space-y-4 card p-5 msg-section">
        <h2 className="font-semibold">{tr("messaging.msgGrowthTitle")}</h2>
        <p className="text-xs text-slate-500">{tr("messaging.msgGrowthIntro")}</p>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2 rounded-lg border bg-white p-3">
            <div className="text-sm font-semibold">{tr("messaging.msgNewOptinForm")}</div>
            <input className="input w-full py-1 text-sm" placeholder={tr("messaging.msgFormNamePlaceholder")} value={growthDraft.name} onChange={(e) => setGrowthDraft((d) => ({ ...d, name: e.target.value }))} />
            <input className="input w-full py-1 text-sm" placeholder={tr("messaging.msgHeadlinePlaceholder")} value={growthDraft.headline} onChange={(e) => setGrowthDraft((d) => ({ ...d, headline: e.target.value }))} />
            <div className="flex flex-wrap gap-3 text-sm">
              {["email", "sms", "whatsapp"].map((ch) => (
                <label key={ch} className="flex items-center gap-1"><input type="checkbox" checked={growthDraft.channels.includes(ch)} onChange={(e) => setGrowthDraft((d) => ({ ...d, channels: e.target.checked ? [...d.channels, ch] : d.channels.filter((c) => c !== ch) }))} /> {ch}</label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input py-1 text-sm" placeholder={tr("messaging.msgTopicPlaceholder")} value={growthDraft.topic} onChange={(e) => setGrowthDraft((d) => ({ ...d, topic: e.target.value }))} />
              <input className="input py-1 text-sm" placeholder={tr("messaging.msgKeywordPlaceholder")} value={growthDraft.keyword} onChange={(e) => setGrowthDraft((d) => ({ ...d, keyword: e.target.value }))} />
            </div>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={growthDraft.doubleOptIn} onChange={(e) => setGrowthDraft((d) => ({ ...d, doubleOptIn: e.target.checked }))} />{tr("messaging.msgDoubleOptinLabel")}</label>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={growthDraft.popupEnabled} onChange={(e) => setGrowthDraft((d) => ({ ...d, popupEnabled: e.target.checked }))} />{tr("messaging.msgPopupLabel")}</label>
            {growthDraft.popupEnabled ? <input className="input w-32 py-1 text-sm" type="number" min="0" placeholder={tr("messaging.msgDelayPlaceholder")} value={growthDraft.popupDelay} onChange={(e) => setGrowthDraft((d) => ({ ...d, popupDelay: e.target.value }))} /> : null}
            <button className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy !== "" || !growthDraft.name.trim() || growthDraft.channels.length === 0} onClick={createGrowthForm}>{tr("messaging.msgCreateForm")}</button>
          </div>
          <div className="space-y-2 rounded-lg border bg-white p-3">
            <div className="text-sm font-semibold">{tr("messaging.msgPrefLinkTitle")}</div>
            <p className="text-xs text-slate-500">{tr("messaging.msgPrefLinkNote")}</p>
            <div className="flex gap-2">
              <select className="input w-auto py-1 text-sm" value={prefLink.channel} onChange={(e) => setPrefLink((s) => ({ ...s, channel: e.target.value }))}>
                <option value="email">email</option><option value="sms">sms</option><option value="whatsapp">whatsapp</option>
              </select>
              <input className="input flex-1 py-1 text-sm" placeholder={tr("messaging.msgCustomerAddressPlaceholder")} value={prefLink.address} onChange={(e) => setPrefLink((s) => ({ ...s, address: e.target.value }))} />
              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !prefLink.address.trim()} onClick={issuePrefLink}>{tr("messaging.msgLinkBtn")}</button>
            </div>
            {prefLink.url ? <input className="input w-full py-1 text-xs" readOnly value={prefLink.url} onFocus={(e) => e.target.select()} /> : null}
            <div className="pt-2 text-sm font-semibold">{tr("messaging.msgConsentHistoryTitle")}</div>
            <p className="text-xs text-slate-500">{tr("messaging.msgConsentHistoryNote")}</p>
            <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={exportConsent}>📥 Consent Audit Export (CSV)</button>
            {consentEvents.length ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-slate-600">
                {consentEvents.slice(0, 20).map((e) => <li key={e.id}>{fmtDateTime(locale, e.createdAt)} · {e.channel} · {e.address} · {e.fromStatus ?? "—"} → {e.toStatus} · {e.source}</li>)}
              </ul>
            ) : <p className="text-xs text-slate-400">{tr("messaging.msgNoConsentRecords")}</p>}
          </div>
        </div>
        {growthForms.length ? (
          <div className="space-y-2">
            {growthForms.map((f) => (
              <div key={f.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><span className="font-medium">{f.name}</span> <span className="text-slate-400">({f.channels.join(", ")})</span>
                    <div className="text-xs text-slate-500">Slug: {f.slug}{f.topic ? ` · Topic: ${f.topic}` : ""}{f.keyword ? ` · Keyword: ${f.keyword}` : ""} · Double Opt-in: {f.doubleOptIn ? tr("messaging.msgStateOn") : tr("messaging.msgStateOff")}{f.popup?.enabled ? ` · Popup (${f.popup.delaySeconds ?? 0}s)` : ""} · {f.enabled ? tr("messaging.msgActiveWord") : tr("messaging.msgStateOff")}</div>
                    <a className="text-xs text-blue-600 underline" href={f.joinUrl} target="_blank" rel="noreferrer">{f.joinUrl}</a>
                  </div>
                  <div className="flex gap-2">
                    <button className="rounded-lg border px-3 py-1.5 text-xs" onClick={() => toggleGrowthQr(f)}>{growthQr[f.id] ? tr("messaging.msgQrHide") : tr("messaging.msgQrShow")}</button>
                    <button className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => deleteGrowthForm(f)}>{tr("messaging.msgDelete")}</button>
                  </div>
                </div>
                {growthQr[f.id] ? <img src={growthQr[f.id]} alt={`QR — ${f.name}`} className="mt-2 h-40 w-40 rounded border bg-white" /> : null}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-slate-500">{tr("messaging.msgEmbedSnippet")}</summary>
                  <textarea className="input mt-1 w-full text-xs" rows={2} readOnly value={`<iframe src="${f.joinUrl}" width="100%" height="420" style="border:0" title="${f.name}"></iframe>`} onFocus={(e) => e.target.select()} />
                </details>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-slate-400">{tr("messaging.msgNoOptinForms")}</p>}
        <div className="space-y-2 rounded-lg border bg-white p-3">
          <div className="text-sm font-semibold">{tr("messaging.msgCsvWizTitle")}</div>
          <p className="text-xs text-slate-500">{tr("messaging.msgCsvIntro")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-auto py-1 text-sm" value={csvWiz.channel} onChange={(e) => setCsvWiz((s) => ({ ...s, channel: e.target.value, preview: null }))}>
              <option value="email">email</option><option value="sms">sms</option><option value="whatsapp">whatsapp</option>
            </select>
            <input type="file" accept=".csv,text/csv" className="text-xs" onChange={(e) => { const file = e.target.files?.[0]; if (file) { void file.text().then((text) => setCsvWiz((s) => ({ ...s, text, preview: null }))); } }} />
          </div>
          <textarea className="input w-full text-xs" rows={5} placeholder={"Name,Email\nRahim,rahim@example.com"} value={csvWiz.text} onChange={(e) => setCsvWiz((s) => ({ ...s, text: e.target.value, preview: null }))} />
          {csvWiz.text.trim() ? (
            <div className="flex flex-wrap gap-2">
              {(["name", "email", "phone"] as const).map((k) => (
                <label key={k} className="flex items-center gap-1 text-xs">{k}:
                  <select className="input w-auto py-1 text-xs" value={csvWiz.mapping[k]} onChange={(e) => setCsvWiz((s) => ({ ...s, mapping: { ...s.mapping, [k]: e.target.value } }))}>
                    <option value="">{tr("messaging.msgNoneOption")}</option>
                    {csvWiz.text.split("\n")[0].split(",").map((h) => h.trim()).filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
              <button className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy !== ""} onClick={previewCsvWiz}>{tr("messaging.msgHygieneReportBtn")}</button>
            </div>
          ) : null}
          {csvWiz.preview ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="badge-indigo">{tr("messaging.msgZTotalRows", { count: fmtNumber(locale, csvWiz.preview.totalRows) })}</span>
                <span className="badge-indigo">Clean {csvWiz.preview.cleanCount}</span>
                <span className="badge-slate">Duplicate {csvWiz.preview.duplicateCount}</span>
                <span className="badge-slate">Invalid {csvWiz.preview.invalidCount}</span>
                <span className="badge-slate">Role {csvWiz.preview.roleCount}</span>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-xl border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">{tr("messaging.msgColAddress")}</th><th className="px-3 py-2">{tr("messaging.msgZResultCol")}</th><th className="px-3 py-2">{tr("messaging.msgColReason")}</th></tr></thead>
                  <tbody>{csvWiz.preview.rows.map((r) => (
                    <tr key={r.row} className="border-t"><td className="px-3 py-2">{r.row}</td><td className="px-3 py-2">{r.address || "—"}</td><td className="px-3 py-2">{r.status === "clean" ? tr("messaging.msgStatusClean") : tr("messaging.msgStatusDropped")}</td><td className="px-3 py-2">{r.reasonText ?? ""}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy !== "" || csvWiz.committed !== "" || csvWiz.preview.cleanCount === 0} onClick={commitCsvWiz}>{tr("messaging.msgZImportCleanOnly", { count: fmtNumber(locale, csvWiz.preview.cleanCount) })}</button>
                <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={downloadCsvReport}>{tr("messaging.msgHygieneCsvBtn")}</button>
              </div>
              {csvWiz.committed ? <p className="text-xs font-medium text-emerald-700">✅ {csvWiz.committed}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
      </>) : null}

      {tab === "campaigns" ? (<>
      <div className="space-y-3 card p-5 msg-section">
        <div className="card space-y-3">
          <h2 className="font-semibold">{tr("messaging.msgRfmSegTitle")}</h2>
          {rfm ? (<>
            <div className="flex flex-wrap gap-2">
              {SEGMENTS.map((s) => <span key={s} className="badge-indigo">{SEG_LABEL[s]}: {rfm.segments[s] ?? 0}</span>)}
              <span className="badge-slate">{tr("messaging.msgZTotalActiveCustomers", { count: fmtNumber(locale, rfm.totalCustomers) })}</span>
            </div>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">{tr("messaging.msgColCustomer")}</th><th className="px-3 py-2">{tr("messaging.msgColLastOrder")}</th><th className="px-3 py-2">{tr("messaging.msgColOrders")}</th><th className="px-3 py-2">{tr("messaging.msgColTotalBought")}</th><th className="px-3 py-2">Segment</th></tr></thead>
                <tbody>{rfm.rows.slice(0, 8).map((r) => (
                  <tr key={r.customerId} className="border-t"><td className="px-3 py-2 font-medium">{r.name}</td><td className="px-3 py-2">{tr("messaging.msgDaysAgoSuffix", { count: fmtNumber(locale, r.recencyDays) })}</td><td className="px-3 py-2">{tr("messaging.msgCountTi", { count: fmtNumber(locale, r.frequency) })}</td><td className="px-3 py-2">{fmtMoney(locale, Number(r.monetaryMinor) / 100)}</td><td className="px-3 py-2">{SEG_LABEL[r.segment] ?? r.segment} (R{r.r} F{r.f} M{r.m})</td></tr>
                ))}</tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400">{tr("messaging.msgRfmQuintileNote")}</p>
          </>) : <p className="text-sm text-slate-400">{tr("messaging.msgLoading")}</p>}
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold">🧠 Audience Intelligence (MX11) <span className="badge-indigo">rule-based estimate</span></h2>
          <p className="text-xs text-slate-500">{tr("messaging.msgZRuleBasedA")} <strong>{tr("messaging.msgZRuleBasedStrong")}</strong>{tr("messaging.msgZRuleBasedC")}</p>
          {engagement ? (<>
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <div className="font-semibold text-slate-700">{tr("messaging.msgEngagementFormulaTitle")}</div>
              <p className="mt-1">{engagement.formula}</p>
              <p className="mt-1">{tr("messaging.msgZContactTotals", { total: fmtNumber(locale, engagement.totalContacts), scored: fmtNumber(locale, engagement.scoredContacts), zero: fmtNumber(locale, engagement.zeroHistoryContacts) })}</p>
            </div>
            <div className="space-y-1">
              {engagement.segmentRules.map((r) => (
                <div key={r.segment} className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="badge-indigo">{PREDICTIVE_LABEL_L[r.segment] ?? r.label}: {fmtNumber(locale, engagement.segmentCounts[r.segment] ?? 0)} {tr("messaging.msgPeopleWord")}</span>
                  <span className="text-slate-500">{r.rule}</span>
                </div>
              ))}
              <p className="text-[11px] text-slate-400">{tr("messaging.msgThresholdNote")}</p>
            </div>
            {engagement.rows.length ? (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Segments (rule-based estimate)</th><th className="px-3 py-2">{tr("messaging.msgColEvidence")}</th><th className="px-3 py-2">{tr("messaging.msgColLastEngagement")}</th></tr></thead>
                  <tbody>{engagement.rows.slice(0, 10).map((r) => (
                    <tr key={`${r.type}:${r.id}`} className="border-t"><td className="px-3 py-2 font-medium">{r.name || r.id} <span className="text-slate-400">({r.type})</span></td><td className="px-3 py-2 font-semibold">{r.score}</td><td className="px-3 py-2">{r.segments.length ? r.segments.map((s) => PREDICTIVE_LABEL_L[s] ?? s).join(", ") : "—"}</td><td className="px-3 py-2">{tr("messaging.msgZEngEvidence", { sent: fmtNumber(locale, r.sentCount), open: fmtNumber(locale, r.openCount), click: fmtNumber(locale, r.clickCount), orders: fmtNumber(locale, r.orderFrequency), money: fmtMoney(locale, Number(r.totalSpentMinor) / 100) })}</td><td className="px-3 py-2">{r.daysSinceLastEngagement === null ? tr("messaging.msgNeverWord") : tr("messaging.msgDaysAgoSuffix", { count: fmtNumber(locale, r.daysSinceLastEngagement) })}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="text-sm text-slate-400">{tr("messaging.msgNoEngagementHistory")}</p>}
          </>) : <p className="text-sm text-slate-400">{tr("messaging.msgLoading")}</p>}
          <div className="border-t pt-3 space-y-2">
            <div className="text-sm font-semibold">{tr("messaging.msgNlTitle")}</div>
            <p className="text-xs text-slate-500">{tr("messaging.msgZNlNoteA")}<strong>{tr("messaging.msgZNlNoteStrong")}</strong>{tr("messaging.msgZNlNoteB")}</p>
            <div className="flex flex-wrap gap-2">
              <input className="input flex-1 min-w-64 py-1 text-sm" placeholder={tr("messaging.msgNlPlaceholder")} value={nlDraft.description} onChange={(e) => setNlDraft((d) => ({ ...d, description: e.target.value }))} />
              <select className="input w-auto py-1 text-sm" value={nlDraft.entity} onChange={(e) => setNlDraft((d) => ({ ...d, entity: e.target.value }))}>
                <option value="customers">Customers</option><option value="leads">Leads</option>
              </select>
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !nlDraft.description.trim()} onClick={runNlDraft}>{tr("messaging.msgMakeDraft")}</button>
            </div>
            {nlResult ? (
              <div className="space-y-2">
                {nlResult.valid
                  ? <p className="text-xs text-green-700">{tr("messaging.msgZNlValid")} {nlResult.notice}</p>
                  : <div className="text-xs text-red-700">{tr("messaging.msgZNlInvalid")}{nlResult.errors.map((e, i) => <div key={i}>• {e}</div>)}</div>}
                <textarea className="input w-full font-mono text-xs" rows={6} value={nlDraftJson} onChange={(e) => setNlDraftJson(e.target.value)} placeholder={tr("messaging.msgNlJsonPlaceholder")} />
                <div className="flex flex-wrap items-center gap-2">
                  <input className="input w-56 py-1 text-sm" placeholder={tr("messaging.msgSavedAudienceName")} value={nlName} onChange={(e) => setNlName(e.target.value)} />
                  <button type="button" className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy !== "" || !nlName.trim() || !nlDraftJson.trim()} onClick={saveNlDraftAsAudience}>{tr("messaging.msgCreateSavedAudience")}</button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="border-t pt-3 space-y-2">
            <div className="text-sm font-semibold">{tr("messaging.msgSuppressionTitle")}</div>
            <p className="text-xs text-slate-500">{suppression?.note ?? tr("messaging.msgSuppressionDefaultNote")}</p>
            {suppression ? (suppression.suggestions.length ? (<>
              <div className="space-y-1">
                {suppression.suggestions.slice(0, 20).map((s) => (
                  <div key={`${s.type}:${s.id}`} className="flex flex-wrap items-baseline gap-2 rounded bg-slate-50 px-3 py-2 text-xs">
                    <span className="font-medium">{s.name || s.id}</span><span className="text-slate-400">({s.type})</span>
                    <span>{tr("messaging.msgLastEngagementPrefix")} {s.daysSinceLastEngagement != null ? tr("messaging.msgDaysAgoSuffix", { count: fmtNumber(locale, s.daysSinceLastEngagement) }) : tr("messaging.msgNeverWord")}</span>
                    <span>{tr("messaging.msgSentSincePrefix")} {tr("messaging.msgCountTi", { count: fmtNumber(locale, s.sendsSinceLastEngagement) })} ({tr("messaging.msgRevenueTotal")} {fmtNumber(locale, s.totalSends)})</span>
                    <span>Score: {s.score}</span>
                    {s.alreadyOptedOutChannels.length ? <span className="text-amber-700">{tr("messaging.msgAlreadyOptedOut")} {s.alreadyOptedOutChannels.join(", ")}</span> : null}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select className="input w-auto py-1 text-sm" value={suppressChannel} onChange={(e) => setSuppressChannel(e.target.value)}>
                  <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
                </select>
                <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={applySuppression}>{tr("messaging.msgZOptOutAll", { count: fmtNumber(locale, suppression.total) })}</button>
              </div>
            </>) : <p className="text-sm text-slate-400">{tr("messaging.msgNoSuggestionsNow")}</p>) : <p className="text-sm text-slate-400">{tr("messaging.msgLoading")}</p>}
          </div>
        </div>
        <div className="font-semibold">{tr("messaging.msgZBroadcastsLoaded", { count: fmtNumber(locale, broadcasts.length) })}</div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3">
          <input className="input w-56 py-1 text-sm" placeholder={tr("messaging.msgSearchByName")} value={bcFilters.q} onChange={(e) => setBcFilters((f) => ({ ...f, q: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") applyBcFilters({ q: bcFilters.q }); }} />
          <select className="input w-auto py-1 text-sm" value={bcFilters.status} onChange={(e) => applyBcFilters({ status: e.target.value })}>
            <option value="">{tr("messaging.msgAllStatuses")}</option>
            <option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="sending">Sending</option>
            <option value="paused">Paused</option><option value="sent">Sent</option><option value="partial">Partial</option>
            <option value="failed">Failed</option><option value="cancelled">Cancelled</option>
          </select>
          <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => applyBcFilters({ q: bcFilters.q })}>{tr("messaging.msgSearchBtn")}</button>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={bcFilters.archived} onChange={(e) => applyBcFilters({ archived: e.target.checked })} />{tr("messaging.msgShowArchived")}</label>
          <span className="text-[11px] text-slate-400">{tr("messaging.msgServerFilterNote")}</span>
        </div>
        {broadcasts.length === 0 ? <EmptyState title={tr("messaging.msgNoBroadcasts")} description={tr("messaging.msgNoBroadcastsHint")} /> : broadcasts.map((b) => (
          <div key={b.id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><span className="font-medium">{b.name}</span> <span className="text-slate-400 capitalize">({b.channel})</span>
                <div className="text-xs text-slate-500">Audience: {b.audienceType === "custom" ? tr("messaging.msgAudienceCustom") : b.audienceType === "csv" ? tr("messaging.msgAudienceCsv") : b.audienceType === "saved" ? `Saved: ${savedAudiences.find((s) => s.id === b.audienceSavedId)?.name ?? tr("messaging.msgZDeletedWord")}` : b.audienceType}{b.audienceStage ? ` (${b.audienceStage})` : ""}{b.audienceSegment ? ` (${SEG_LABEL[b.audienceSegment] ?? b.audienceSegment})` : ""}{b.abVariant ? ` · 🧪 Variant ${b.abVariant}` : ""}{b.excludePreviousRecipients ? tr("messaging.msgZExcludePrev") : ""} · {tr("messaging.msgZStatusWord")}: {b.status}{b.archivedAt ? tr("messaging.msgZArchivedNote") : ""}{b.sentAt ? ` · ${fmtDateTime(locale, b.sentAt)}` : ""} {tr("messaging.msgZTotalsLine", { total: fmtNumber(locale, b.totalRecipients), sent: fmtNumber(locale, b.sentCount), failed: fmtNumber(locale, b.failedCount) })}</div>
                {b.scheduledAt ? <div className="text-xs text-slate-500">{tr("messaging.msgSchedulePrefix")} {fmtDateTime(locale, b.scheduledAt)}{b.status === "scheduled" ? ` — ${tr("messaging.msgScheduleSweepNote")}` : ""}</div> : null}
                {b.recurrenceGroupId ? <div className="text-xs text-slate-500">{tr("messaging.msgRecurrenceGroup")}{b.recurrence ? `: ${recurrenceText(b.recurrence)} — ${tr("messaging.msgZRecurrenceNext")}` : tr("messaging.msgZRecurrencePrev")}</div> : null}
                {b.progress ? <div className="text-xs text-slate-500">{tr("messaging.msgProgressLine", { total: fmtNumber(locale, b.progress.total), sent: fmtNumber(locale, b.progress.sent), failed: fmtNumber(locale, b.progress.failed), skipped: fmtNumber(locale, b.progress.skipped), pending: fmtNumber(locale, b.progress.pending) })}</div> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="rounded-lg border px-3 py-1.5" onClick={async () => { const o = getOrganizationId(); if (!o) return; const d = await wrap(`dlv-${b.id}`, () => apiFetch<Delivery[]>(`/organizations/${o}/messaging/broadcasts/${b.id}/deliveries`)); if (d) setDeliveries((s) => ({ ...s, [b.id]: d })); }}>Deliveries</button>
                <button className="rounded-lg border px-3 py-1.5" onClick={() => toggleReport(b)}>{reports[b.id] ? tr("messaging.msgReportHide") : tr("messaging.msgReportShow")}</button>
                {b.status === "draft" ? <button className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap(`send-${b.id}`, () => apiFetch<Broadcast>(`/organizations/${o}/messaging/broadcasts/${b.id}/send`, { method: "POST" })); if (r) { setNotice(tr("messaging.msgZSendResult", { name: r.name, sent: fmtNumber(locale, r.progress?.sent ?? r.sentCount), failed: fmtNumber(locale, r.progress?.failed ?? r.failedCount), skipped: fmtNumber(locale, r.progress?.skipped ?? 0) })); await load(); } }}>{busy === `send-${b.id}` ? tr("messaging.msgSending") : tr("messaging.msgZSendNow")}</button> : null}
                {b.status === "pending_approval" ? <span className="rounded bg-amber-100 px-2 py-1.5 text-xs font-semibold text-amber-800">{tr("messaging.msgPendingApprovalBadge")}</span> : null}
                {b.status === "pending_approval" ? <button className="rounded-lg bg-green-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const note = window.prompt(tr("messaging.msgApprovalNotePrompt")) ?? undefined; const r = await wrap(`approve-${b.id}`, () => apiFetch<Broadcast>(`/organizations/${o}/messaging/broadcasts/${b.id}/approve`, { method: "POST", body: JSON.stringify({ note }) })); if (r) { setNotice(tr("messaging.msgZApprovedNotice", { name: r.name })); await load(); } }}>{busy === `approve-${b.id}` ? tr("messaging.msgZWorking") : tr("messaging.msgZApproveBtn")}</button> : null}
                {b.status === "pending_approval" ? <button className="rounded-lg border border-red-300 px-3 py-1.5 font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const note = window.prompt(tr("messaging.msgRejectReasonPrompt")) ?? undefined; const r = await wrap(`reject-${b.id}`, () => apiFetch<Broadcast>(`/organizations/${o}/messaging/broadcasts/${b.id}/reject`, { method: "POST", body: JSON.stringify({ note }) })); if (r) { setNotice(tr("messaging.msgZRejectedNotice", { name: r.name })); await load(); } }}>{busy === `reject-${b.id}` ? tr("messaging.msgZWorking") : tr("messaging.msgZRejectBtn")}</button> : null}
                {b.status === "draft" && b.approvalStatus === "rejected" ? <span className="rounded bg-red-100 px-2 py-1.5 text-xs font-semibold text-red-700">{tr("messaging.msgRejectedBadge")}{b.approvalNote ? `: ${b.approvalNote}` : ""} — {tr("messaging.msgSendingBlockedSuffix")}</span> : null}
                {b.status === "draft" && b.approvalStatus === "rejected" ? <button className="rounded-lg border px-3 py-1.5 font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap(`submit-approval-${b.id}`, () => apiFetch<Broadcast>(`/organizations/${o}/messaging/broadcasts/${b.id}/submit-approval`, { method: "POST" })); if (r) { setNotice(tr("messaging.msgZResubmittedNotice", { name: r.name })); await load(); } }}>{tr("messaging.msgZResubmitBtn")}</button> : null}
                {b.status === "scheduled" ? <>
                  <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => broadcastAction(b, "schedule", { scheduledAt: null }, tr("messaging.msgScheduleCancelled", { name: b.name }))}>{tr("messaging.msgZScheduleCancelBtn")}</button>
                  <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => broadcastAction(b, "pause", undefined, tr("messaging.msgPausedNotice", { name: b.name }))}>Pause</button>
                </> : null}
                {b.status === "sending" ? <>
                  <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => broadcastAction(b, "pause", undefined, tr("messaging.msgPausedChunkNotice", { name: b.name }))}>Pause</button>
                </> : null}
                {b.status === "paused" ? <button className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => broadcastAction(b, "resume", undefined, tr("messaging.msgResumedNotice", { name: b.name }))}>Resume</button> : null}
                {(["sent", "partial", "failed"].includes(b.status) && (b.progress?.failed ?? b.failedCount) > 0) ? <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => broadcastAction(b, "retry-failed", undefined, tr("messaging.msgRetryFailedNotice", { name: b.name }))}>{tr("messaging.msgZRetryFailedBtn", { count: fmtNumber(locale, b.progress?.failed ?? b.failedCount) })}</button> : null}
                {(["draft", "scheduled", "paused", "sending"].includes(b.status)) ? <button className="rounded-lg border border-red-300 px-3 py-1.5 text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => broadcastAction(b, "cancel", undefined, tr("messaging.msgCancelNotice", { name: b.name }))}>{tr("messaging.msgZCancelBtn")}</button> : null}
                {(["draft", "scheduled", "paused", "pending_approval"].includes(b.status) && !b.archivedAt) ? <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => (bcEditId === b.id ? setBcEditId(null) : startBcEdit(b))}>{bcEditId === b.id ? tr("messaging.msgEditClose") : tr("messaging.msgEditBtn")}</button> : null}
                <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => cloneBc(b)}>{tr("messaging.msgCopyBtn")}</button>
                {b.archivedAt
                  ? <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => archiveBc(b, false)}>{tr("messaging.msgUnarchiveBtn")}</button>
                  : <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => archiveBc(b, true)}>{tr("messaging.msgArchiveBtn")}</button>}
                {(["draft", "cancelled"].includes(b.status)) ? <button className="rounded-lg border border-red-300 px-3 py-1.5 text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => deleteBc(b)}>{tr("messaging.msgDelete")}</button> : null}
              </div>
            </div>
            {b.status === "draft" ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input type="datetime-local" className="input w-auto" value={scheduleInputs[b.id] ?? ""} onChange={(e) => setScheduleInputs((s) => ({ ...s, [b.id]: e.target.value }))} />
                <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !(scheduleInputs[b.id] ?? "")} onClick={() => broadcastAction(b, "schedule", { scheduledAt: new Date(scheduleInputs[b.id]).toISOString() }, tr("messaging.msgZScheduledNotice", { name: b.name }))}>{tr("messaging.msgZScheduleDoBtn")}</button>
                <span className="text-[11px] text-slate-400">{tr("messaging.msgZScheduleJobNote")}</span>
              </div>
            ) : null}
            {bcEditId === b.id ? (
              <div className="mt-2 grid gap-2 rounded-lg border bg-white p-3">
                <div className="text-xs font-semibold">{tr("messaging.msgZEditBroadcast", { status: b.status })}</div>
                {b.status === "paused" ? <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">{tr("messaging.msgZPausedEditNote")}</p> : null}
                <label className="block text-sm">{tr("messaging.msgNameLabel")}<input className={inputCls} value={bcEditForm.name} onChange={(e) => setBcEditForm({ ...bcEditForm, name: e.target.value })} /></label>
                {b.channel === "whatsapp" ? (<>
                  <label className="block text-sm">WhatsApp Template
                    <select className={inputCls} value={bcEditForm.whatsappTemplateId} onChange={(e) => setBcEditForm({ ...bcEditForm, whatsappTemplateId: e.target.value })}>
                      <option value="">{tr("messaging.msgKeepPrevious")}</option>
                      {waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
                    </select>
                  </label>
                  <label className="block text-sm">{tr("messaging.msgTplParamsLabel")}<input className={inputCls} value={bcEditForm.templateParams} onChange={(e) => setBcEditForm({ ...bcEditForm, templateParams: e.target.value })} /></label>
                  <p className="text-[11px] text-slate-400">{tr("messaging.msgZWaBodyNote")}</p>
                </>) : (<>
                  <label className="block text-sm">{tr("messaging.msgZTemplateOptionalLabel")}
                    <select className={inputCls} value={bcEditForm.templateId} onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); setBcEditForm({ ...bcEditForm, templateId: e.target.value, ...(t ? { subject: t.subject ?? bcEditForm.subject, body: t.body, htmlBody: t.htmlBody ?? "" } : {}) }); }}>
                      <option value="">{tr("messaging.msgNoTemplate")}</option>
                      {templates.filter((t) => t.channel === b.channel).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                  {b.channel === "email" ? <label className="block text-sm">Subject<input className={inputCls} value={bcEditForm.subject} onChange={(e) => setBcEditForm({ ...bcEditForm, subject: e.target.value })} /></label> : null}
                  {b.channel === "push" ? <label className="block text-sm">{tr("messaging.msgTitleLabel")}<input className={inputCls} maxLength={120} value={bcEditForm.subject} onChange={(e) => setBcEditForm({ ...bcEditForm, subject: e.target.value })} /></label> : null}
                  {b.channel === "push" ? <label className="block text-sm">{tr("messaging.msgClickLinkLabel")}<input className={inputCls} value={bcEditForm.pushUrl} onChange={(e) => setBcEditForm({ ...bcEditForm, pushUrl: e.target.value })} placeholder="/sale" /></label> : null}
                  {b.channel === "onsite" ? <label className="block text-sm">{tr("messaging.msgTitleLabel")}<input className={inputCls} maxLength={120} value={bcEditForm.subject} onChange={(e) => setBcEditForm({ ...bcEditForm, subject: e.target.value })} /></label> : null}
                  {b.channel === "onsite" ? <label className="block text-sm">{tr("messaging.msgClickOpenLabel")}<input className={inputCls} value={bcEditForm.onsiteUrl} onChange={(e) => setBcEditForm({ ...bcEditForm, onsiteUrl: e.target.value })} placeholder="/sale" /></label> : null}
                  {b.channel === "telegram" ? (
                    <div className="space-y-2 lg:col-span-2">
                      <div className="text-sm font-medium">{tr("messaging.msgUrlButtonsLabel")}</div>
                      {bcEditForm.tgButtons.map((row, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                          <input className="input w-48" maxLength={64} value={row.label} onChange={(e) => setBcEditForm({ ...bcEditForm, tgButtons: bcEditForm.tgButtons.map((r, j) => j === i ? { ...r, label: e.target.value } : r) })} placeholder={tr("messaging.msgButtonTextLabel")} />
                          <input className="input w-80" value={row.url} onChange={(e) => setBcEditForm({ ...bcEditForm, tgButtons: bcEditForm.tgButtons.map((r, j) => j === i ? { ...r, url: e.target.value } : r) })} placeholder="https://..." />
                          <button type="button" className="rounded-lg border px-2 py-1 text-xs" onClick={() => setBcEditForm({ ...bcEditForm, tgButtons: bcEditForm.tgButtons.filter((_, j) => j !== i) })}>{tr("messaging.msgRemoveBtn")}</button>
                        </div>
                      ))}
                      <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40" disabled={bcEditForm.tgButtons.length >= 4} onClick={() => setBcEditForm({ ...bcEditForm, tgButtons: [...bcEditForm.tgButtons, { label: "", url: "" }] })}>{tr("messaging.msgZAddButton")}</button>
                    </div>
                  ) : null}
                  <label className="block text-sm">Body<textarea className={inputCls} rows={3} value={bcEditForm.body} onChange={(e) => setBcEditForm({ ...bcEditForm, body: e.target.value })} /></label>
                  {b.channel === "email" ? <label className="block text-sm">{tr("messaging.msgHtmlBodyOptional")}<textarea className={inputCls} rows={3} value={bcEditForm.htmlBody} onChange={(e) => setBcEditForm({ ...bcEditForm, htmlBody: e.target.value })} /></label> : null}
                </>)}
                {(b.status === "draft" || b.status === "scheduled") ? <label className="block text-sm">{tr("messaging.msgScheduleFieldLabel")}<input type="datetime-local" className={inputCls} value={bcEditForm.scheduledAt} onChange={(e) => setBcEditForm({ ...bcEditForm, scheduledAt: e.target.value })} /></label> : null}
                <div className="flex gap-2">
                  <button type="button" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => saveBcEdit(b)}>{busy === `bc-edit-${b.id}` ? tr("messaging.msgSaving") : tr("messaging.msgSave")}</button>
                  <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={() => setBcEditId(null)}>{tr("messaging.msgCancel")}</button>
                </div>
              </div>
            ) : null}
            {(deliveries[b.id] ?? []).map((d) => (
              <div key={d.id} className="mt-1 flex items-center justify-between rounded bg-white px-2 py-1 text-xs">
                <span>{d.address} · {fmtDateTime(locale, d.createdAt)}</span>
                <span className={d.status === "sent" ? "text-green-600" : "text-red-600"}>{d.status}{d.providerMessageId ? ` · ${d.providerMessageId}` : ""}{d.error ? ` · ${d.error}` : ""}</span>
              </div>
            ))}
            {reports[b.id] ? (() => { const report = reports[b.id]; const f = report.funnel; const cells: [string, number | null][] = [
              [tr("messaging.msgReportAudience"), f.audience], [tr("messaging.msgReportSent"), f.sent], [tr("messaging.msgReportFailed"), f.failed], [tr("messaging.msgReportSkipped"), f.skipped],
              [tr("messaging.msgReportDelivered"), f.delivered], [tr("messaging.msgReportRead"), f.read],
              [tr("messaging.msgReportOpened"), f.opened],
              [tr("messaging.msgReportClickers"), f.clickedRecipients], [tr("messaging.msgReportTotalClicks"), f.totalClicks],
            ]; return (
              <div className="mt-3 space-y-3 rounded-lg border bg-slate-100 p-3">
                <div className="font-medium">{tr("messaging.msgReportTitle")}</div>
                <div className="grid grid-cols-3 gap-2 lg:grid-cols-5">
                  {cells.map(([label, value]) => (
                    <div key={label} className="rounded bg-white p-2 text-center">
                      <div className="text-base font-semibold">{value === null ? "—" : value}</div>
                      <div className="text-[11px] text-slate-500">{label}{value === null ? tr("messaging.msgZNotAvailableChannel") : ""}</div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">
                  {b.channel === "email" ? tr("messaging.msgZChanNoteEmail") : null}
                  {b.channel === "sms" ? tr("messaging.msgZChanNoteSms") : null}
                  {b.channel === "whatsapp" ? tr("messaging.msgZChanNoteWhatsapp") : null}
                  {b.channel === "push" ? tr("messaging.msgZChanNotePush") : null}
                  {b.channel === "onsite" ? tr("messaging.msgZChanNoteOnsite") : null}
                  {b.channel === "telegram" ? tr("messaging.msgZChanNoteTelegram") : null}
                </p>
                {report.failureReasons.length ? (
                  <div>
                    <div className="text-xs font-semibold">{tr("messaging.msgFailureReasons")}</div>
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                      {report.failureReasons.map((r) => <li key={r.reason}>• {r.reason} — {tr("messaging.msgCountTi", { count: fmtNumber(locale, r.count) })}</li>)}
                    </ul>
                  </div>
                ) : null}
                {report.cascade ? (
                  <div className="rounded bg-white p-2 text-xs">
                    <div className="font-semibold">{tr("messaging.msgCascadeTitle")}</div>
                    <div className="mt-1 grid gap-2 sm:grid-cols-3">
                      {report.cascade.channels.map((c) => (
                        <div key={c.channel} className="rounded bg-slate-50 p-2">
                          <div className="font-medium capitalize">{c.channel}</div>
                          <div>{tr("messaging.msgZCascadeStats", { attempts: fmtNumber(locale, c.attempts), sent: fmtNumber(locale, c.sent), failed: fmtNumber(locale, c.failed), skipped: fmtNumber(locale, c.skipped) })}</div>
                          <div>{tr("messaging.msgCascadeFinalSuccess")}<strong>{fmtNumber(locale, c.finalSuccesses)}</strong> {tr("messaging.msgPeopleWord")}</div>
                        </div>
                      ))}
                    </div>
                    {report.cascade.ratesNote ? <p className="mt-2 text-amber-700">💰 {report.cascade.ratesNote}</p> : null}
                    {report.cascade.skippedChannels.map((sk) => <p key={sk.channel} className="mt-1 text-slate-500">⏭️ {sk.channel}: {sk.reason}</p>)}
                    {report.cascade.breakerEvents.map((ev, i) => <p key={i} className="mt-1 text-red-600">{tr("messaging.msgZBreaker", { gateway: ev.gatewayKey, failures: fmtNumber(locale, ev.failures) })}</p>)}
                    {report.cascade.chains.length ? (
                      <div className="mt-2">
                        <div className="font-medium">{tr("messaging.msgRecipientChainTitle")}</div>
                        <ul className="mt-1 space-y-0.5 text-slate-600">
                          {report.cascade.chains.slice(0, 20).map((ch) => <li key={ch.key}>• {ch.attempts.map((a) => `${a.channel}: ${a.status}`).join(" → ")} — {tr("messaging.msgZFinalWord")}: {ch.finalChannel ?? "—"} ({ch.finalStatus})</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {report.ab ? (
                  <div className="rounded bg-white p-2 text-xs">
                    <div className="font-semibold">{tr("messaging.msgAbCompareTitle")}</div>
                    <div className="mt-1 grid gap-2 sm:grid-cols-2">
                      {(["A", "B"] as const).map((v) => report.ab!.variants[v] ? (
                        <div key={v} className="rounded bg-slate-50 p-2">
                          <div className="font-medium">Variant {v}</div>
                          <div>{tr("messaging.msgZAbVariantStats", { sent: fmtNumber(locale, report.ab!.variants[v].sent), failed: fmtNumber(locale, report.ab!.variants[v].failed), delivered: report.ab!.variants[v].delivered ?? "—", read: report.ab!.variants[v].read ?? "—", opened: report.ab!.variants[v].opened ?? "—", clicked: report.ab!.variants[v].clickedRecipients ?? "—" })}</div>
                        </div>
                      ) : null)}
                    </div>
                    <p className="mt-2 text-slate-600">💡 {tr("messaging.msgZAdviceWord")}: {report.ab.suggestion.leader ? tr("messaging.msgZVariantLeading", { variant: report.ab.suggestion.leader }) : ""}{report.ab.suggestion.note}</p>
                    {report.ab.autoWinner ? (
                      <div className="mt-2 rounded bg-slate-50 p-2">
                        <div className="font-medium">{tr("messaging.msgZAutoWinnerTitle")} — {report.ab.autoWinner.enabled ? tr("messaging.msgStateOn") : tr("messaging.msgStateOff")}</div>
                        {report.ab.autoWinner.winner ? (
                          <div className="mt-1">{tr("messaging.msgAbDecidedPrefix")}<strong>Variant {report.ab.autoWinner.winner}</strong> — {report.ab.autoWinner.decidedAt ? fmtDateTime(locale, report.ab.autoWinner.decidedAt) : ""}{report.ab.autoWinner.detail ? <span> · {tr("messaging.msgZMetricWord")}: {report.ab.autoWinner.detail.metric} · A: {report.ab.autoWinner.detail.a.success}/{report.ab.autoWinner.detail.a.sent} ({(report.ab.autoWinner.detail.a.rate * 100).toFixed(1)}%) · B: {report.ab.autoWinner.detail.b.success}/{report.ab.autoWinner.detail.b.sent} ({(report.ab.autoWinner.detail.b.rate * 100).toFixed(1)}%) · z = {report.ab.autoWinner.detail.z} · p = {report.ab.autoWinner.detail.pValue}</span> : null}</div>
                        ) : <p className="mt-1 text-slate-500">{tr("messaging.msgZAbNoDecision")}</p>}
                        <p className="mt-1 text-slate-500">{report.ab.autoWinner.rule}</p>
                        <p className="text-slate-500">{report.ab.autoWinner.scopeNote}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => { void setAbAutoWinner(b, true); }}>{tr("messaging.msgAbEnablePair")}</button>
                          <button type="button" className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => { void setAbAutoWinner(b, false); }}>{tr("messaging.msgAbDisablePair")}</button>
                          <button type="button" className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => { void setAbAutoWinner(b, null); }}>{tr("messaging.msgAbOrgDefault")}</button>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">{tr("messaging.msgAbToggleNote")}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {report.holdout ? (
                  <div className="rounded bg-white p-2 text-xs">
                    <div className="font-semibold">🎯 Holdout Group ({report.holdout.percent}%)</div>
                    <div className="mt-1">{tr("messaging.msgHoldoutLine")}<strong>{report.holdout.heldOutCount}</strong>{tr("messaging.msgHoldoutSuffix")}</div>
                    <p className="mt-1 text-slate-500">{report.holdout.label}</p>
                  </div>
                ) : null}
                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded bg-white p-2">
                    <div className="font-semibold">{tr("messaging.msgRevenueTitle")}</div>
                    {report.revenue ? <div className="mt-1">{tr("messaging.msgRevenueOrders")}{tr("messaging.msgZRevenueRest", { orders: fmtNumber(locale, report.revenue.orders), total: fmtMoneyMinor(locale, Number(report.revenue.totalMinor)), recipients: fmtNumber(locale, report.revenue.customerRecipients) })}<div className="mt-1 text-slate-500">{report.revenue.method}</div></div>
                      : <div className="mt-1 text-slate-500">{tr("messaging.msgRevenueNoWindow")}</div>}
                  </div>
                  <div className="rounded bg-white p-2">
                    <div className="font-semibold">{tr("messaging.msgRepliesTitle")}</div>
                    <div className="mt-1">{report.replies === null ? tr("messaging.msgRepliesUnavailable") : <><strong>{report.replies}</strong>{tr("messaging.msgRepliesSuffix")}</>}<div className="mt-1 text-slate-500">{report.repliesMethod}</div></div>
                  </div>
                </div>
                <div className="rounded bg-white p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold">{tr("messaging.msgDeliveryListTitle")}</span>
                    <select className="input w-auto py-1 text-xs" value={(dlvFilter[b.id] ?? { status: "", q: "" }).status} onChange={(e) => setDlvFilter((s) => ({ ...s, [b.id]: { ...(s[b.id] ?? { status: "", q: "" }), status: e.target.value } }))}>
                      <option value="">{tr("messaging.msgAllStatuses")}</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="skipped">Skipped</option>
                    </select>
                    <input className="input w-52 py-1 text-xs" placeholder={tr("messaging.msgAddressSearchPlaceholder")} value={(dlvFilter[b.id] ?? { status: "", q: "" }).q} onChange={(e) => setDlvFilter((s) => ({ ...s, [b.id]: { ...(s[b.id] ?? { status: "", q: "" }), q: e.target.value } }))} />
                    <button type="button" className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => loadPagedDeliveries(b.id, true)}>{tr("messaging.msgSearchBtn")}</button>
                    <button type="button" className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => exportDeliveries(b.id)}>⬇️ CSV Export</button>
                    <span className="text-[11px] text-slate-400">{tr("messaging.msgExportCapNote")}</span>
                  </div>
                  {(pagedDlv[b.id]?.items ?? []).map((d) => (
                    <div key={d.id} className="mt-1 flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-xs">
                      <span>{d.address} · {fmtDateTime(locale, d.createdAt)}</span>
                      <span className="flex items-center gap-2">
                        {/* MX6: WhatsApp rows with a matched inbox conversation link to the Inbox.
                            The inbox page selects a conversation by internal state only (no URL
                            parameter), so this links to the Inbox itself — see the MX6 acceptance. */}
                        {d.conversationId ? <a className="font-semibold text-blue-700 underline" href="/dashboard/inbox">{tr("messaging.msgConversationWord")}</a> : null}
                        <span className={d.status === "sent" ? "text-green-600" : "text-red-600"}>{d.status}{d.deliveryStatus ? ` · ${d.deliveryStatus}` : ""}{d.openedAt ? " · opened" : ""}{d.providerMessageId ? ` · ${d.providerMessageId}` : ""}{d.error ? ` · ${d.error}` : ""}</span>
                      </span>
                    </div>
                  ))}
                  {(pagedDlv[b.id]?.items ?? []).length === 0 ? <p className="mt-1 text-xs text-slate-400">{tr("messaging.msgNoDeliveries")}</p> : null}
                  {pagedDlv[b.id]?.nextCursor ? <button type="button" className="mt-2 rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => loadPagedDeliveries(b.id, false)}>{tr("messaging.msgLoadMore50")}</button> : null}
                </div>
              </div>
            ); })() : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
              {b.channel === "onsite" ? <span className="text-[11px] text-slate-400">{tr("messaging.msgZOnsiteTestNote")}</span> : null}
              {b.channel === "push" ? <span className="text-[11px] text-slate-400">{tr("messaging.msgZPushTestNote")}</span> : null}
              {b.channel !== "push" && b.channel !== "onsite" ? <input className="input w-64" placeholder={b.channel === "email" ? tr("messaging.msgTestEmailPlaceholder") : b.channel === "telegram" ? tr("messaging.msgTelegramTestPlaceholder") : tr("messaging.msgTestPhonePlaceholder")} value={bcTestInputs[b.id] ?? ""} onChange={(e) => setBcTestInputs((s) => ({ ...s, [b.id]: e.target.value }))} /> : null}
              {b.channel !== "push" && b.channel !== "onsite" ? <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !(bcTestInputs[b.id] ?? "").trim()} onClick={() => runTestSend("broadcast", b.id, bcTestInputs[b.id] ?? "")}>{busy === `test-broadcast-${b.id}` ? tr("messaging.msgSending") : tr("messaging.msgTestSendBtn")}</button> : null}
              {b.channel !== "push" && b.channel !== "onsite" ? <span className="text-[11px] text-slate-400">{tr("messaging.msgZTestNote")}</span> : null}
              {bcTestResults[b.id] ? <span className="text-xs">{bcTestResults[b.id]}</span> : null}
            </div>
          </div>
        ))}
        {bcNextCursor ? <button type="button" className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => loadBroadcastList(false, bcNextCursor)}>{tr("messaging.msgMoreBroadcasts")}</button> : null}
        {(sendTime || segmentSuggestions.length > 0) ? (
          <div className="grid gap-3 border-t pt-3 lg:grid-cols-2">
            {sendTime ? (
              <div className="rounded-lg bg-indigo-50 p-3 text-sm">
                <div className="font-medium">{tr("messaging.msgBestTimeTitle")}</div>
                {sendTime.available ? (<>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {(sendTime.bestHours ?? []).map((h) => <span key={h.hour} className="badge-indigo">{h.hour}:00–{(h.hour + 1) % 24}:00 ({tr("messaging.msgZDhaka")}) · {tr("messaging.msgZResponsesTi", { count: fmtNumber(locale, h.events) })}</span>)}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{sendTime.method}</p>
                </>) : <p className="mt-1 text-slate-600">{sendTime.reason}</p>}
              </div>
            ) : null}
            {segmentSuggestions.length > 0 ? (
              <div className="rounded-lg bg-emerald-50 p-3 text-sm">
                <div className="font-medium">{tr("messaging.msgAudienceAdviceTitle")}</div>
                <ul className="mt-1 space-y-2">
                  {segmentSuggestions.map((s) => (
                    <li key={s.kind} className="flex flex-wrap items-start justify-between gap-2">
                      <span className="text-slate-700">{s.reason}</span>
                      {s.audienceType === "segment" && s.audienceSegment ? <button type="button" className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold" onClick={() => { setBcForm((f) => ({ ...f, audienceType: "segment", audienceSegment: s.audienceSegment as string })); setNotice(tr("messaging.msgZSegmentPicked", { segment: SEG_LABEL[s.audienceSegment as string] ?? s.audienceSegment })); }}>{tr("messaging.msgZPickSegment")}</button> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <form ref={composerFormRef} className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          // MS6: rich template components — sent ONLY when at
          // least one part is filled, so a plain template send
          // stays exactly the legacy shape.
          const waComponents = bcForm.channel === "whatsapp" ? (() => {
            const out: Record<string, unknown> = {};
            if (bcForm.waHeaderMediaUrl.trim()) out.headerMediaUrl = bcForm.waHeaderMediaUrl.trim();
            const htp = bcForm.waHeaderTextParams.split(",").map((x) => x.trim()).filter(Boolean);
            if (htp.length) out.headerTextParams = htp;
            const btns = bcForm.waButtonRows.filter((r) => r.value.trim()).map((r) => ({ index: Number(r.index) || 0, subType: r.subType, ...(r.subType === "url" ? { text: r.value.trim() } : { payload: r.value.trim() }) }));
            if (btns.length) out.buttonParams = btns;
            return Object.keys(out).length ? out : undefined;
          })() : undefined;
          // MS8: recurrence rides along ONLY when scheduling with
          // the toggle on — otherwise the create keeps exactly
          // the pre-MS8 shape. endsAt is sent as end-of-day so
          // the picked date itself is included.
          const recurrence = bcForm.scheduledAt && bcForm.recEnabled ? {
            freq: bcForm.recFreq, interval: Math.max(1, Math.floor(Number(bcForm.recInterval) || 1)),
            ...(bcForm.recFreq === "weekly" && bcForm.recWeekdays.length ? { weekdays: bcForm.recWeekdays } : {}),
            ...(bcForm.recEndsAt ? { endsAt: new Date(`${bcForm.recEndsAt}T23:59:59`).toISOString() } : {}),
          } : undefined;
          // MX2: cascade payload — only when the toggle is on,
          // so a plain broadcast keeps exactly its old shape.
          // The primary channel always leads its own cascade
          // list if the user left it out (the API requires it).
          const cascadeChannels = bcForm.cascadeEnabled
            ? Array.from(new Set([bcForm.channel, ...bcForm.cascadeChannels.filter((c) => c !== bcForm.channel)]))
            : [];
          const cascade = bcForm.cascadeEnabled && bcForm.channel !== "push" && bcForm.channel !== "telegram" && bcForm.channel !== "onsite" ? {
            enabled: true,
            channels: cascadeChannels,
            smartRouting: bcForm.cascadeSmart || undefined,
            ordering: bcForm.cascadeOrdering,
            ...(cascadeChannels.includes("sms") && bcForm.channel !== "sms" && bcForm.cascadeSmsBody.trim() ? { smsBody: bcForm.cascadeSmsBody.trim() } : {}),
            ...(cascadeChannels.includes("email") && bcForm.channel !== "email" && bcForm.cascadeEmailBody.trim() ? { emailBody: bcForm.cascadeEmailBody.trim(), emailSubject: bcForm.cascadeEmailSubject.trim() || undefined } : {}),
            ...(cascadeChannels.includes("whatsapp") && bcForm.channel !== "whatsapp" && bcForm.cascadeWhatsappTemplateId ? { whatsappTemplateId: bcForm.cascadeWhatsappTemplateId } : {}),
          } : undefined;
          const res = await wrap("bc", () => apiFetch(`/organizations/${orgId}/messaging/broadcasts`, {
            method: "POST",
            body: JSON.stringify(bcForm.channel === "whatsapp"
              ? { name: bcForm.name, channel: "whatsapp", whatsappTemplateId: bcForm.whatsappTemplateId, templateParams: bcForm.templateParams ? bcForm.templateParams.split(",").map((x) => x.trim()) : [], templateComponents: waComponents, ...audienceFields(), abTest: bcForm.abTest || undefined, abWhatsappTemplateId: bcForm.abTest ? bcForm.abWhatsappTemplateId : undefined, abAutoWinnerEnabled: bcForm.abTest ? bcForm.abAutoWinner : undefined, excludePreviousRecipients: bcForm.excludePreviousRecipients || undefined, topic: bcForm.topic.trim() || undefined, holdoutPercent: bcForm.holdoutPercent ? Number(bcForm.holdoutPercent) : undefined, budgetCapMinor: bcForm.budgetCapTaka ? Math.round(Number(bcForm.budgetCapTaka) * 100) : undefined, scheduledAt: bcForm.scheduledAt ? new Date(bcForm.scheduledAt).toISOString() : undefined, recurrence, cascade }
              : { name: bcForm.name, channel: bcForm.channel, templateId: bcForm.templateId || undefined, subject: bcForm.templateId ? undefined : (bcForm.subject || undefined), body: bcForm.templateId ? undefined : bcForm.body, htmlBody: !bcForm.templateId && bcForm.channel === "email" && bcForm.htmlBody ? bcForm.htmlBody : undefined, pushUrl: bcForm.channel === "push" && bcForm.pushUrl.trim() ? bcForm.pushUrl.trim() : undefined, telegramButtons: bcForm.channel === "telegram" && bcForm.tgButtons.some((b) => b.label.trim() && b.url.trim()) ? bcForm.tgButtons.filter((b) => b.label.trim() && b.url.trim()) : undefined, onsiteUrl: bcForm.channel === "onsite" && bcForm.onsiteUrl.trim() ? bcForm.onsiteUrl.trim() : undefined, ...audienceFields(), abTest: bcForm.abTest || undefined, abAutoWinnerEnabled: bcForm.abTest ? bcForm.abAutoWinner : undefined, abSubject: bcForm.abTest ? (bcForm.abSubject || undefined) : undefined, abBody: bcForm.abTest ? bcForm.abBody : undefined, excludePreviousRecipients: bcForm.excludePreviousRecipients || undefined, topic: bcForm.topic.trim() || undefined, holdoutPercent: bcForm.holdoutPercent ? Number(bcForm.holdoutPercent) : undefined, budgetCapMinor: bcForm.budgetCapTaka ? Math.round(Number(bcForm.budgetCapTaka) * 100) : undefined, scheduledAt: bcForm.scheduledAt ? new Date(bcForm.scheduledAt).toISOString() : undefined, recurrence, cascade }),
          }));
          if (res) { setBcForm({ name: "", channel: "email", templateId: "", subject: "", body: "", htmlBody: "", cascadeEnabled: false, cascadeChannels: ["sms", "email"], cascadeSmart: false, cascadeOrdering: "org", cascadeSmsBody: "", cascadeEmailSubject: "", cascadeEmailBody: "", cascadeWhatsappTemplateId: "", audienceType: "customers", audienceStage: "qualified", audienceSegment: "at_risk", audienceSavedId: "", whatsappTemplateId: "", templateParams: "", waHeaderMediaUrl: "", waHeaderTextParams: "", waButtonRows: [], pushUrl: "", tgButtons: [], onsiteUrl: "", abTest: false, abSubject: "", abBody: "", abWhatsappTemplateId: "", abAutoWinner: false, excludePreviousRecipients: false, topic: "", holdoutPercent: "", budgetCapTaka: "", scheduledAt: "", recEnabled: false, recFreq: "weekly", recInterval: "1", recWeekdays: [], recEndsAt: "" }); setCsvText(""); setPreview(null); setNotice((res as { variants?: unknown[] }).variants ? tr("messaging.msgAbCreatedNotice") : bcForm.scheduledAt ? tr("messaging.msgBcScheduledNotice") : tr("messaging.msgBcDraftNotice")); await load(); }
        }}>
          <label className="block text-sm">{tr("messaging.msgNameLabel")}<input className={inputCls} value={bcForm.name} onChange={(e) => setBcForm({ ...bcForm, name: e.target.value })} required /></label>
          <label className="block text-sm">Channel
            <select className={inputCls} value={bcForm.channel} onChange={(e) => setBcForm({ ...bcForm, channel: e.target.value, templateId: "", ...(e.target.value === "push" ? { audienceType: "push_subscribers" } : {}), ...(e.target.value === "telegram" ? { audienceType: "telegram_subscribers" } : {}) })}>
              <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp (Template)</option><option value="push">🔔 Web Push</option><option value="telegram">✈️ Telegram</option><option value="onsite">{tr("messaging.msgOnsiteChannel")}</option>
            </select>
          </label>
          {bcForm.channel === "whatsapp" ? (<>
            <label className="block text-sm">WhatsApp Template
              <select className={inputCls} value={bcForm.whatsappTemplateId} onChange={(e) => setBcForm({ ...bcForm, whatsappTemplateId: e.target.value })} required>
                <option value="">{tr("messaging.msgPickOption")}</option>
                {waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
              </select>
            </label>
            <label className="block text-sm">{tr("messaging.msgZTemplateParamsLabel")}
              <input className={inputCls} value={bcForm.templateParams} onChange={(e) => setBcForm({ ...bcForm, templateParams: e.target.value })} placeholder={tr("messaging.msgExNameEid")} />
            </label>
            <label className="block text-sm">{tr("messaging.msgHeaderMediaLabel")}<input className={inputCls} value={bcForm.waHeaderMediaUrl} onChange={(e) => setBcForm({ ...bcForm, waHeaderMediaUrl: e.target.value })} placeholder="https://.../image.jpg" />
            </label>
            <label className="block text-sm">{tr("messaging.msgHeaderTextParams")}
              <input className={inputCls} value={bcForm.waHeaderTextParams} onChange={(e) => setBcForm({ ...bcForm, waHeaderTextParams: e.target.value })} placeholder={tr("messaging.msgExNameOnly")} />
            </label>
            <div className="space-y-2 lg:col-span-3 rounded-lg bg-slate-50 p-3">
              <div className="text-sm font-medium">{tr("messaging.msgButtonParamsLabel")}</div>
              {bcForm.waButtonRows.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex items-center gap-1">Index <input type="number" min={0} className="input w-20" value={row.index} onChange={(e) => setBcForm({ ...bcForm, waButtonRows: bcForm.waButtonRows.map((r, j) => j === i ? { ...r, index: e.target.value } : r) })} /></label>
                  <select className="input w-auto" value={row.subType} onChange={(e) => setBcForm({ ...bcForm, waButtonRows: bcForm.waButtonRows.map((r, j) => j === i ? { ...r, subType: e.target.value } : r) })}>
                    <option value="url">{tr("messaging.msgUrlButtonSuffixOption")}</option><option value="quick_reply">Quick Reply (Payload)</option>
                  </select>
                  <input className="input w-64" value={row.value} onChange={(e) => setBcForm({ ...bcForm, waButtonRows: bcForm.waButtonRows.map((r, j) => j === i ? { ...r, value: e.target.value } : r) })} placeholder={row.subType === "url" ? tr("messaging.msgUrlSuffixLabel") : tr("messaging.msgPayloadLabel")} />
                  <button type="button" className="rounded-lg border px-2 py-1 text-xs" onClick={() => setBcForm({ ...bcForm, waButtonRows: bcForm.waButtonRows.filter((_, j) => j !== i) })}>{tr("messaging.msgRemoveBtn")}</button>
                </div>
              ))}
              <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40" disabled={bcForm.waButtonRows.length >= 10} onClick={() => setBcForm({ ...bcForm, waButtonRows: [...bcForm.waButtonRows, { index: String(bcForm.waButtonRows.length), subType: "url", value: "" }] })}>{tr("messaging.msgZAddButtonParam")}</button>
              <p className="text-[11px] text-slate-400">{tr("messaging.msgZUrlSuffixNote")}</p>
            </div>
          </>) : bcForm.channel === "push" ? (<>
            <label className="block text-sm">{tr("messaging.msgTitleLabel")}<input className={inputCls} maxLength={120} value={bcForm.subject} onChange={(e) => setBcForm({ ...bcForm, subject: e.target.value })} placeholder={tr("messaging.msgExEidOffer")} required />
            </label>
            <label className="block text-sm">{tr("messaging.msgZClickOpenLabel")}
              <input className={inputCls} value={bcForm.pushUrl} onChange={(e) => setBcForm({ ...bcForm, pushUrl: e.target.value })} placeholder="/sale" />
            </label>
            <p className="text-xs text-slate-500 lg:col-span-3">{tr("messaging.msgZPushComposerNote")}</p>
          </>) : bcForm.channel === "telegram" ? (<>
            <div className="space-y-2 lg:col-span-3 rounded-lg bg-slate-50 p-3">
              <div className="text-sm font-medium">{tr("messaging.msgZTgButtonsTitle")}</div>
              {bcForm.tgButtons.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <input className="input w-48" maxLength={64} value={row.label} onChange={(e) => setBcForm({ ...bcForm, tgButtons: bcForm.tgButtons.map((r, j) => j === i ? { ...r, label: e.target.value } : r) })} placeholder={tr("messaging.msgZButtonTextPlaceholder")} />
                  <input className="input w-80" value={row.url} onChange={(e) => setBcForm({ ...bcForm, tgButtons: bcForm.tgButtons.map((r, j) => j === i ? { ...r, url: e.target.value } : r) })} placeholder={tr("messaging.msgZHttpsOnlyPlaceholder")} />
                  <button type="button" className="rounded-lg border px-2 py-1 text-xs" onClick={() => setBcForm({ ...bcForm, tgButtons: bcForm.tgButtons.filter((_, j) => j !== i) })}>{tr("messaging.msgRemoveBtn")}</button>
                </div>
              ))}
              <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40" disabled={bcForm.tgButtons.length >= 4} onClick={() => setBcForm({ ...bcForm, tgButtons: [...bcForm.tgButtons, { label: "", url: "" }] })}>{tr("messaging.msgZAddButton")}</button>
            </div>
            <p className="text-xs text-slate-500 lg:col-span-3">{tr("messaging.msgZTgComposerNote")}</p>
          </>) : bcForm.channel === "onsite" ? (<>
            <label className="block text-sm">{tr("messaging.msgTitleLabel")}<input className={inputCls} maxLength={120} value={bcForm.subject} onChange={(e) => setBcForm({ ...bcForm, subject: e.target.value })} placeholder={tr("messaging.msgExEidOffer")} required />
            </label>
            <label className="block text-sm">{tr("messaging.msgZClickOpenLabel")}
              <input className={inputCls} value={bcForm.onsiteUrl} onChange={(e) => setBcForm({ ...bcForm, onsiteUrl: e.target.value })} placeholder="/sale" />
            </label>
            <p className="text-xs text-slate-500 lg:col-span-3">{tr("messaging.msgZOnsiteComposerNote")}</p>
          </>) : (<>
          <label className="block text-sm">{tr("messaging.msgZTemplateOptionalShort")}
            <select className={inputCls} value={bcForm.templateId} onChange={(e) => setBcForm({ ...bcForm, templateId: e.target.value })}>
              <option value="">{tr("messaging.msgZWriteMyself")}</option>
              {templates.filter((t) => t.channel === bcForm.channel).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          </>)}
          {bcForm.channel !== "whatsapp" && !bcForm.templateId && bcForm.channel === "email" ? (
            <div className="text-sm">
              <label className="block">Subject<input className={inputCls} value={bcForm.subject} onChange={(e) => setBcForm({ ...bcForm, subject: e.target.value })} required /></label>
              <button type="button" className="mt-1 rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !bcForm.subject.trim()} onClick={runAiSubjects}>{busy === "ai-subjects" ? tr("messaging.msgZSubjectsWorking") : tr("messaging.msgZAiSubjectBtn")}</button>
              {aiSubjects ? (
                <div className="mt-1 space-y-1">
                  <div className="flex flex-wrap gap-1">
                    {aiSubjects.variants.map((v, i) => <button key={i} type="button" className="rounded-full border bg-white px-2 py-0.5 text-xs hover:bg-slate-100" onClick={() => setBcForm((f) => ({ ...f, subject: v }))}>{v}</button>)}
                  </div>
                  <p className="text-[11px] text-slate-400">{aiSubjects.isRealLlm ? `AI Provider: ${aiSubjects.providerLabel} — ${tr("messaging.msgZAiClickFillSubject")}` : aiSubjects.notice}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {bcForm.channel !== "whatsapp" && !bcForm.templateId ? <label className="block text-sm lg:col-span-2">Body<textarea className={inputCls} rows={2} value={bcForm.body} onChange={(e) => setBcForm({ ...bcForm, body: e.target.value })} required /></label> : null}
          {bcForm.channel === "sms" && !bcForm.templateId && bcForm.body ? (() => { const seg = smsSegments(bcForm.body); return <p className="text-xs text-slate-500 lg:col-span-2">{tr("messaging.msgZSmsCalc", { parts: fmtNumber(locale, seg.parts), encoding: seg.encoding === "unicode" ? tr("messaging.msgZSmsUnicode") : "GSM-7", length: fmtNumber(locale, seg.length) })}</p>; })() : null}
          {composeWarnings.length ? (
            <div className="rounded-lg bg-amber-50 p-3 text-sm lg:col-span-3">
              <div className="font-medium text-amber-800">{tr("messaging.msgZComposeWarnings")}</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-700">{composeWarnings.map((w) => <li key={w.code}>{w.message}</li>)}</ul>
            </div>
          ) : null}
          {bcForm.channel === "email" && !bcForm.templateId ? (<>
            <label className="block text-sm lg:col-span-3">{tr("messaging.msgZHtmlBodyComposer")}<textarea className={inputCls} rows={4} value={bcForm.htmlBody} onChange={(e) => setBcForm({ ...bcForm, htmlBody: e.target.value })} placeholder={`<p>${tr("messaging.msgHelloPlaceholder")}</p>`} /></label>
            {bcForm.htmlBody ? <div className="lg:col-span-3">
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={() => setBcHtmlPreview((v) => !v)}>{bcHtmlPreview ? tr("messaging.msgHidePreview") : tr("messaging.msgHtmlPreviewBtn")}</button>
              {bcHtmlPreview ? <iframe title={tr("messaging.msgZBroadcastHtmlPreview")} sandbox="" srcDoc={bcForm.htmlBody} className="mt-2 h-64 w-full rounded-lg border bg-white" /> : null}
            </div> : null}
          </>) : null}
          {bcForm.channel !== "whatsapp" && !bcForm.templateId ? (
            <div className="space-y-3 rounded-lg bg-slate-50 p-3 lg:col-span-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">✍️ Composer:</span>
                <span className="text-xs text-slate-500">{tr("messaging.msgZInsertTarget")}</span>
                <button type="button" className={`rounded-lg border px-2 py-1 text-xs font-semibold ${insertTarget === "body" ? "bg-slate-800 text-white" : ""}`} onClick={() => setInsertTarget("body")}>Text Body</button>
                {bcForm.channel === "email" ? <button type="button" className={`rounded-lg border px-2 py-1 text-xs font-semibold ${insertTarget === "html" ? "bg-slate-800 text-white" : ""}`} onClick={() => setInsertTarget("html")}>HTML Body</button> : null}
              </div>
              {variables ? (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-slate-500">Variable ({variableEntity() === "customer" ? "Customer" : variableEntity() === "lead" ? "Lead" : "CSV"}):</span>
                  {variables[variableEntity()].map((v) => <button key={v.key} type="button" className="rounded-full border bg-white px-2 py-0.5 hover:bg-slate-100" title={v.labelBn} onClick={() => insertSnippet(`{{${v.key}}}`, `{{${v.key}}}`)}>{`{{${v.key}}}`}</button>)}
                  <span className="text-[11px] text-slate-400">{tr("messaging.msgZVariableEmptyNote")}</span>
                </div>
              ) : null}
              <div className="flex flex-wrap items-end gap-2 text-sm">
                <label className="block">{tr("messaging.msgZInsertProduct")}
                  <select className="input mt-1 w-64" value={productPick} onChange={(e) => setProductPick(e.target.value)}>
                    {products.length === 0 ? <option value="">{tr("messaging.msgZNoActiveProducts")}</option> : products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40" disabled={!productPick} onClick={() => { const p = products.find((x) => x.id === productPick); if (p) insertSnippet(p.snippetText, p.snippetHtml); }}>{tr("messaging.msgZInsertBtn")}</button>
                <span className="text-[11px] text-slate-400">{tr("messaging.msgZProductInsertNote")}</span>
              </div>
              <div className="flex flex-wrap items-end gap-2 text-sm">
                <label className="block">{tr("messaging.msgZCouponCode")}<input className="input mt-1 w-40" value={couponForm.code} onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value })} placeholder="EID20" /></label>
                <label className="block">{tr("messaging.msgZLabelOptional")}<input className="input mt-1 w-48" value={couponForm.label} onChange={(e) => setCouponForm({ ...couponForm, label: e.target.value })} placeholder={tr("messaging.msgZEidOfferPlain")} /></label>
                <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40" disabled={!couponForm.code.trim()} onClick={() => insertSnippet(couponSnippetText(couponForm.code.trim(), couponForm.label.trim() || undefined), couponSnippetHtml(couponForm.code.trim(), couponForm.label.trim() || undefined))}>{tr("messaging.msgZInsertBtn")}</button>
                <span className="text-[11px] text-amber-600">{tr("messaging.msgZCouponNote")}</span>
              </div>
              {bcForm.channel !== "push" && bcForm.channel !== "telegram" && bcForm.channel !== "onsite" ? (<div className="space-y-2 border-t pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{tr("messaging.msgZAiWriteTitle")}</span>
                  <span className="text-[11px] text-slate-400">{tr("messaging.msgZAiWriteNote")}</span>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block">{tr("messaging.msgZGoalLabel")}<input className="input mt-1 w-64" value={aiForm.goal} onChange={(e) => setAiForm({ ...aiForm, goal: e.target.value })} placeholder={tr("messaging.msgZExGoal")} /></label>
                  <label className="block">{tr("messaging.msgZProductOptional")}
                    <select className="input mt-1 w-56" value={aiForm.productId} onChange={(e) => setAiForm({ ...aiForm, productId: e.target.value })}>
                      <option value="">{tr("messaging.msgZNoSpecificProduct")}</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="block">{tr("messaging.msgZAudienceHintLabel")}<input className="input mt-1 w-48" value={aiForm.audienceHint} onChange={(e) => setAiForm({ ...aiForm, audienceHint: e.target.value })} placeholder={tr("messaging.msgZExOldCustomers")} /></label>
                  <label className="block">{tr("messaging.msgZLanguageLabel")}
                    <select className="input mt-1 w-auto" value={aiForm.language} onChange={(e) => setAiForm({ ...aiForm, language: e.target.value })}>
                      <option value="bn">{tr("messaging.msgZBanglaWord")}</option><option value="en">English</option>
                    </select>
                  </label>
                  <button type="button" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== "" || !aiForm.goal.trim()} onClick={runAiDraft}>{busy === "ai-draft" ? tr("messaging.msgZDraftWorking") : tr("messaging.msgZMakeDraftBtn")}</button>
                </div>
                {aiDraft ? (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-500">{aiDraft.isRealLlm ? `AI Provider: ${aiDraft.providerLabel}` : aiDraft.notice}</p>
                    <div className="grid gap-2 lg:grid-cols-2">
                      {aiDraft.variants.map((v, i) => (
                        <div key={i} className="rounded-lg border bg-white p-3">
                          {v.subject ? <div className="font-medium">{v.subject}</div> : null}
                          <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{v.body}</p>
                          {v.smsParts !== undefined ? <p className="mt-1 text-[11px] text-slate-400">{tr("messaging.msgZSmsPartsLine", { count: fmtNumber(locale, v.smsParts) })}</p> : null}
                          <button type="button" className="mt-2 rounded-lg border px-3 py-1 text-xs font-semibold" onClick={() => applyAiVariant(v)}>{tr("messaging.msgZApplyVariant")}</button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="space-y-2 border-t pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{tr("messaging.msgZPlannerTitle")}</span>
                    <span className="text-[11px] text-slate-400">{tr("messaging.msgZPlannerNoteA")}<strong>{tr("messaging.msgZPlannerNoteStrong")}</strong>{tr("messaging.msgZPlannerNoteB")}</span>
                    <button type="button" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== "" || !aiForm.goal.trim()} onClick={runPlanner}>{busy === "ai-plan" ? tr("messaging.msgZSubjectsWorking") : tr("messaging.msgZPlannerMakeBtn")}</button>
                  </div>
                  {planner ? (
                    <div className="space-y-2 rounded-lg border bg-white p-3 text-sm">
                      <p className="text-[11px] text-slate-500">{planner.isRealLlm ? `AI Provider: ${planner.providerLabel}` : planner.notice}</p>
                      <div>
                        <div className="font-medium">{tr("messaging.msgZPlannerAudience")}</div>
                        {planner.proposal.audienceValid ? <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(planner.proposal.audienceDefinition, null, 2)}</pre> : <p className="mt-1 text-amber-700">{tr("messaging.msgZPlannerAudienceInvalid", { errors: planner.proposal.audienceErrors.join("; ") })}</p>}
                        {planner.proposal.audienceValid ? <button type="button" className="mt-1 rounded-lg border px-3 py-1 text-xs font-semibold" onClick={() => { setNlDraftJson(JSON.stringify(planner.proposal.audienceDefinition, null, 2)); setNotice(tr("messaging.msgZPlannerNlNotice")); }}>{tr("messaging.msgZPlannerPutRule")}</button> : null}
                      </div>
                      <div>
                        <div className="font-medium">{tr("messaging.msgZPlannerContent")}</div>
                        {planner.proposal.contentDraft.subject ? <div className="mt-0.5 font-medium">{planner.proposal.contentDraft.subject}</div> : null}
                        <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{planner.proposal.contentDraft.body}</p>
                        <button type="button" className="mt-1 rounded-lg border px-3 py-1 text-xs font-semibold" onClick={() => applyAiVariant({ subject: planner.proposal.contentDraft.subject ?? undefined, body: planner.proposal.contentDraft.body })}>{tr("messaging.msgZApplyDraftShort")}</button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{tr("messaging.msgZPlannerChannel")} <strong>{planner.proposal.channelRecommendation ?? "—"}</strong></span>
                        {planner.proposal.channelRecommendation && ["email", "sms", "whatsapp", "push", "telegram", "onsite"].includes(planner.proposal.channelRecommendation) ? <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold" onClick={() => setBcForm((f) => ({ ...f, channel: planner.proposal.channelRecommendation as string }))}>{tr("messaging.msgZPickChannelBtn")}</button> : null}
                      </div>
                      <div>{tr("messaging.msgZPlannerTiming")} <strong>{planner.proposal.timingSuggestion ?? "—"}</strong> <span className="text-[11px] text-slate-400">{tr("messaging.msgZTimingNote")}</span></div>
                      {planner.proposal.rationale ? <p className="text-slate-500">{planner.proposal.rationale}</p> : null}
                    </div>
                  ) : null}
                </div>
                <div className="space-y-2 border-t pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{tr("messaging.msgZTranslateTitle")}</span>
                    <span className="text-[11px] text-slate-400">{tr("messaging.msgZTranslateNote")}</span>
                    <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !bcForm.body.trim()} onClick={() => runTranslate("bn")}>{tr("messaging.msgZTranslateBn")}</button>
                    <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !bcForm.body.trim()} onClick={() => runTranslate("en")}>Translate to English</button>
                  </div>
                  {translation ? (
                    <div className="rounded-lg border bg-white p-3 text-sm">
                      <p className="text-[11px] text-slate-500">{translation.isRealLlm ? `AI Provider: ${translation.providerLabel}` : translation.notice}</p>
                      {translation.subject ? <div className="mt-1 font-medium">{translation.subject}</div> : null}
                      <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{translation.body}</p>
                      <button type="button" className="mt-2 rounded-lg border px-3 py-1 text-xs font-semibold" onClick={() => applyAiVariant({ subject: translation.subject ?? undefined, body: translation.body })}>{tr("messaging.msgZApplyTranslation")}</button>
                    </div>
                  ) : null}
                </div>
                <div className="space-y-2 border-t pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{tr("messaging.msgZSubjectScoreTitle")}</span>
                    <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !bcForm.subject.trim()} onClick={runSubjectScore}>{busy === "subject-score" ? tr("messaging.msgZScoringWorking") : tr("messaging.msgZSeeScore")}</button>
                    <span className="text-[11px] text-slate-400">{tr("messaging.msgZScoreNote")}</span>
                  </div>
                  {subjectScore ? (
                    <div className="rounded-lg border bg-white p-3 text-sm">
                      <div>{tr("messaging.msgZTotalScorePrefix")} <strong>{subjectScore.score} / {subjectScore.maxScore}</strong></div>
                      <ul className="mt-1 space-y-0.5 text-slate-600">
                        {subjectScore.factors.map((f) => <li key={f.code}>• {f.label}: <strong>{f.points}/{f.maxPoints}</strong> — {f.detail}</li>)}
                      </ul>
                      {subjectScore.spamWordsMatched.length ? <p className="mt-1 text-amber-700">{tr("messaging.msgZSpamMatched", { words: subjectScore.spamWordsMatched.join(", ") })}</p> : null}
                    </div>
                  ) : null}
                </div>
                <div className="space-y-2 border-t pt-2">
                  <div className="flex flex-wrap items-end gap-2">
                    <span className="font-medium">{tr("messaging.msgZRecipientTimeTitle")}</span>
                    <label className="block text-sm">{tr("messaging.msgZRecipientKeyLabel")}<input className="input mt-1 w-64" value={recipientTimeKey} onChange={(e) => setRecipientTimeKey(e.target.value)} placeholder={tr("messaging.msgZExRecipientKey")} /></label>
                    <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !recipientTimeKey.trim()} onClick={runRecipientSendTime}>{busy === "recipient-time" ? tr("messaging.msgZScoringWorking") : tr("messaging.msgZSeeTime")}</button>
                  </div>
                  {recipientSendTime ? (
                    recipientSendTime.available ? <p className="text-sm text-slate-600">{tr("messaging.msgZRecipientActiveA")} <strong>{tr("messaging.msgZHourColon", { hour: fmtNumber(locale, recipientSendTime.modalHour ?? 0) })}</strong>{tr("messaging.msgZRecipientActiveB", { modal: fmtNumber(locale, recipientSendTime.modalHourEvents), total: fmtNumber(locale, recipientSendTime.totalEvents) })}</p>
                      : <p className="text-sm text-amber-700">{tr("messaging.msgZRecipientNoData", { total: fmtNumber(locale, recipientSendTime.totalEvents), min: fmtNumber(locale, recipientSendTime.minEvents) })}</p>
                  ) : null}
                </div>
              </div>) : null}
            </div>
          ) : null}
          {bcForm.channel === "whatsapp" ? <p className="text-xs text-slate-500 lg:col-span-2">{tr("messaging.msgZWaBroadcastNote")}</p> : null}
          {bcForm.channel === "onsite" ? <p className="text-xs text-slate-500 lg:col-span-3">{tr("messaging.msgZNoCascadeOnsite")}</p> : null}
          {bcForm.channel === "push" ? <p className="text-xs text-slate-500 lg:col-span-3">{tr("messaging.msgZNoCascadePush")}</p> : null}
          {bcForm.channel === "telegram" ? <p className="text-xs text-slate-500 lg:col-span-3">{tr("messaging.msgZNoCascadeTelegram")}</p> : null}
          {bcForm.channel !== "push" && bcForm.channel !== "telegram" && bcForm.channel !== "onsite" ? (<div className="space-y-2 rounded-lg bg-slate-50 p-3 lg:col-span-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={bcForm.cascadeEnabled} onChange={(e) => setBcForm({ ...bcForm, cascadeEnabled: e.target.checked })} />
              {tr("messaging.msgZCascadeEnable")}
            </label>
            {bcForm.cascadeEnabled ? (<>
              <p className="text-xs text-slate-500">{tr("messaging.msgZCascadeIntro", { channel: bcForm.channel })}</p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{tr("messaging.msgZCascadeOrder")}</span>
                {(["email", "sms", "whatsapp"] as const).filter((c) => c !== bcForm.channel).map((c) => {
                  const idx = bcForm.cascadeChannels.indexOf(c);
                  const on = idx >= 0;
                  return (
                    <span key={c} className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold ${on ? "bg-indigo-50 border-indigo-300" : "bg-white"}`}>
                      <input type="checkbox" checked={on} onChange={(e) => setBcForm({ ...bcForm, cascadeChannels: e.target.checked ? [...bcForm.cascadeChannels, c] : bcForm.cascadeChannels.filter((x) => x !== c) })} />
                      {on ? `${idx + 2}. ` : ""}{c === "email" ? "Email" : c === "sms" ? "SMS" : "WhatsApp"}
                      {on && idx > 0 ? <button type="button" title={tr("messaging.msgZMoveEarlier")} onClick={() => { const arr = [...bcForm.cascadeChannels]; const j = arr.indexOf(c); [arr[j - 1], arr[j]] = [arr[j], arr[j - 1]]; setBcForm({ ...bcForm, cascadeChannels: arr }); }}>↑</button> : null}
                    </span>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={bcForm.cascadeSmart} onChange={(e) => setBcForm({ ...bcForm, cascadeSmart: e.target.checked })} />
                  {tr("messaging.msgZSmartRouting")}
                </label>
                <label className="flex items-center gap-2">{tr("messaging.msgZOrderingBasis")}
                  <select className="input w-auto py-1" value={bcForm.cascadeOrdering} onChange={(e) => setBcForm({ ...bcForm, cascadeOrdering: e.target.value })}>
                    <option value="org">{tr("messaging.msgZOrderMine")}</option>
                    <option value="cheapest">{tr("messaging.msgZOrderCheapest")}</option>
                  </select>
                </label>
              </div>
              {bcForm.cascadeChannels.includes("sms") && bcForm.channel !== "sms" ? <label className="block text-sm">{tr("messaging.msgZSmsFallbackBody")}<textarea className={inputCls} rows={2} value={bcForm.cascadeSmsBody} onChange={(e) => setBcForm({ ...bcForm, cascadeSmsBody: e.target.value })} placeholder={tr("messaging.msgZSmsFallbackPlaceholder")} /></label> : null}
              {bcForm.cascadeChannels.includes("email") && bcForm.channel !== "email" ? (<>
                <label className="block text-sm">{tr("messaging.msgZEmailFallbackSubject")}<input className={inputCls} value={bcForm.cascadeEmailSubject} onChange={(e) => setBcForm({ ...bcForm, cascadeEmailSubject: e.target.value })} /></label>
                <label className="block text-sm">{tr("messaging.msgZEmailFallbackBody")}<textarea className={inputCls} rows={2} value={bcForm.cascadeEmailBody} onChange={(e) => setBcForm({ ...bcForm, cascadeEmailBody: e.target.value })} /></label>
              </>) : null}
              {bcForm.cascadeChannels.includes("whatsapp") && bcForm.channel !== "whatsapp" ? <label className="block text-sm">{tr("messaging.msgZWaFallbackTemplate")}
                <select className={inputCls} value={bcForm.cascadeWhatsappTemplateId} onChange={(e) => setBcForm({ ...bcForm, cascadeWhatsappTemplateId: e.target.value })}>
                  <option value="">{tr("messaging.msgZWaFallbackPick")}</option>
                  {waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
                </select>
              </label> : null}
            </>) : null}
          </div>) : null}
          <label className="block text-sm">Audience
            <select className={inputCls} value={bcForm.audienceType} onChange={(e) => setBcForm({ ...bcForm, audienceType: e.target.value })}>
              <option value="customers">{tr("messaging.msgZAudAllCustomers")}</option><option value="leads_stage">{tr("messaging.msgZAudLeadStage")}</option><option value="segment">RFM Segment</option>
              <option value="push_subscribers">{tr("messaging.msgZAudPushSubs")}</option>
              <option value="telegram_subscribers">{tr("messaging.msgZAudTgSubs")}</option>
              <option value="custom">{tr("messaging.msgZAudCustom")}</option><option value="saved">💾 Saved Audience</option><option value="csv">{tr("messaging.msgZAudCsv")}</option>
            </select>
          </label>
          {bcForm.audienceType === "leads_stage" ? <label className="block text-sm">Lead Stage
            <select className={inputCls} value={bcForm.audienceStage} onChange={(e) => setBcForm({ ...bcForm, audienceStage: e.target.value })}>
              {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label> : null}
          {bcForm.audienceType === "segment" ? <label className="block text-sm">Segment
            <select className={inputCls} value={bcForm.audienceSegment} onChange={(e) => setBcForm({ ...bcForm, audienceSegment: e.target.value })}>
              {SEGMENTS.map((s) => <option key={s} value={s}>{SEG_LABEL[s]} ({fmtNumber(locale, rfm?.segments[s] ?? 0)} {tr("messaging.msgPeopleWord")})</option>)}
            </select>
          </label> : null}
          {bcForm.audienceType === "custom" ? (
            <div className="space-y-2 lg:col-span-3 rounded-lg bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium">{tr("messaging.msgZBuildConditions")}</span>
                <label className="flex items-center gap-1">{tr("messaging.msgZListWord")}
                  <select className="input w-auto" value={condEntity} onChange={(e) => { setCondEntity(e.target.value); const d = (e.target.value === "customers" ? fieldDefsFor(CUSTOMER_FIELD_DEFS, locale) : fieldDefsFor(LEAD_FIELD_DEFS, locale))[0]; setCondRows([{ field: d.field, op: d.ops[0], key: "", value: "" }]); }}>
                    <option value="customers">Customer</option><option value="leads">Lead</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">{tr("messaging.msgZMatchWord")}
                  <select className="input w-auto" value={condMatch} onChange={(e) => setCondMatch(e.target.value)}>
                    <option value="all">{tr("messaging.msgZMatchAll")}</option><option value="any">{tr("messaging.msgZMatchAny")}</option>
                  </select>
                </label>
              </div>
              {condRows.map((row, i) => {
                const defs = condEntity === "customers" ? fieldDefsFor(CUSTOMER_FIELD_DEFS, locale) : fieldDefsFor(LEAD_FIELD_DEFS, locale);
                const def = defs.find((d) => d.field === row.field) ?? defs[0];
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <select className="input w-auto" value={row.field} onChange={(e) => { const d = defs.find((x) => x.field === e.target.value) ?? defs[0]; setCondRows(condRows.map((r, j) => j === i ? { field: d.field, op: d.ops[0], key: "", value: "" } : r)); }}>
                      {defs.map((d) => <option key={d.field} value={d.field}>{d.label}</option>)}
                    </select>
                    <select className="input w-auto" value={row.op} onChange={(e) => setCondRows(condRows.map((r, j) => j === i ? { ...r, op: e.target.value } : r))}>
                      {def.ops.map((op) => <option key={op} value={op}>{OP_LABEL_L[op] ?? op}</option>)}
                    </select>
                    {def.kind === "keyed" ? <input className="input w-32" value={row.key} onChange={(e) => setCondRows(condRows.map((r, j) => j === i ? { ...r, key: e.target.value } : r))} placeholder={row.field === "address_key" ? tr("messaging.msgZExDistrict") : tr("messaging.msgZExTier")} /> : null}
                    {def.kind === "boolean" ? (
                      <select className="input w-auto" value={row.value || "true"} onChange={(e) => setCondRows(condRows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}>
                        <option value="true">{tr("messaging.msgZYesWord")}</option><option value="false">{tr("messaging.msgZNoWord")}</option>
                      </select>
                    ) : def.kind === "segment" ? (
                      <select className="input w-auto" value={row.value || "champions"} onChange={(e) => setCondRows(condRows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}>
                        {SEGMENTS.map((s) => <option key={s} value={s}>{SEG_LABEL[s]}</option>)}
                      </select>
                    ) : def.kind === "predictive" ? (
                      <select className="input w-auto" value={row.value || "churn_risk"} onChange={(e) => setCondRows(condRows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}>
                        {PREDICTIVE_SEGMENTS.map((s) => <option key={s} value={s}>{PREDICTIVE_LABEL_L[s]}</option>)}
                      </select>
                    ) : def.kind === "stage" ? (
                      <select className="input w-auto" value={row.value || "new"} onChange={(e) => setCondRows(condRows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}>
                        {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <input className="input w-40" type={def.kind === "number" ? "number" : "text"} value={row.value} onChange={(e) => setCondRows(condRows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))} placeholder={tr("messaging.msgValueLabel")} />
                    )}
                    <button type="button" className="rounded-lg border px-2 py-1 text-xs disabled:opacity-40" disabled={condRows.length <= 1} onClick={() => setCondRows(condRows.filter((_, j) => j !== i))}>{tr("messaging.msgRemoveBtn")}</button>
                  </div>
                );
              })}
              <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40" disabled={condRows.length >= 20} onClick={() => { const d = (condEntity === "customers" ? fieldDefsFor(CUSTOMER_FIELD_DEFS, locale) : fieldDefsFor(LEAD_FIELD_DEFS, locale))[0]; setCondRows([...condRows, { field: d.field, op: d.ops[0], key: "", value: "" }]); }}>{tr("messaging.msgZAddCondition", { max: fmtNumber(locale, 20) })}</button>
              <p className="text-[11px] text-slate-400">{tr("messaging.msgZConditionsNote")}</p>
            </div>
          ) : null}
          {bcForm.audienceType === "saved" ? (
            <div className="space-y-2 lg:col-span-3 rounded-lg bg-slate-50 p-3">
              <label className="block text-sm">Saved Audience
                <select className={inputCls} value={bcForm.audienceSavedId} onChange={(e) => setBcForm({ ...bcForm, audienceSavedId: e.target.value })} required>
                  <option value="">{tr("messaging.msgPickOption")}</option>
                  {savedAudiences.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.definition.entity === "leads" ? "Lead" : "Customer"}, {tr("messaging.msgZConditionsCount", { count: fmtNumber(locale, s.definition.conditions?.length ?? 0) })})</option>)}
                </select>
              </label>
              {savedAudiences.length === 0 ? <p className="text-xs text-slate-500">{tr("messaging.msgZNoSavedAudience")}</p> : null}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input className="input w-56" value={savedName} onChange={(e) => setSavedName(e.target.value)} placeholder={tr("messaging.msgZSavedNamePlaceholder")} />
                <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !savedName.trim()} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("aud-create", () => apiFetch<SavedAudience>(`/organizations/${o}/messaging/audiences`, { method: "POST", body: JSON.stringify({ name: savedName.trim(), definition: buildDefinition() }) })); if (r) { setSavedName(""); setNotice(tr("messaging.msgZSavedAudienceCreated", { name: r.name })); await load(); } }}>{tr("messaging.msgZCreateFromCustom")}</button>
                <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !bcForm.audienceSavedId || !savedName.trim()} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("aud-rename", () => apiFetch(`/organizations/${o}/messaging/audiences/${bcForm.audienceSavedId}`, { method: "PATCH", body: JSON.stringify({ name: savedName.trim() }) })); if (r) { setSavedName(""); setNotice(tr("messaging.msgZSavedAudienceRenamed")); await load(); } }}>{tr("messaging.msgZRenameBtn")}</button>
                <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50" disabled={busy !== "" || !bcForm.audienceSavedId} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("aud-delete", () => apiFetch(`/organizations/${o}/messaging/audiences/${bcForm.audienceSavedId}`, { method: "DELETE" })); if (r) { setBcForm({ ...bcForm, audienceSavedId: "" }); setNotice(tr("messaging.msgZSavedAudienceDeleted")); await load(); } }}>{tr("messaging.msgDelete")}</button>
              </div>
              <p className="text-[11px] text-slate-400">{tr("messaging.msgZCreateBtnNote")}</p>
            </div>
          ) : null}
          {bcForm.audienceType === "csv" ? (
            <label className="block text-sm lg:col-span-3">{tr("messaging.msgZAddressListLabel", { max: fmtNumber(locale, 5000) })}
              <textarea className={inputCls} rows={4} value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder={bcForm.channel === "email" ? "one@example.com\ntwo@example.com" : "01712345678\n+8801712345678"} required />
              <span className="mt-1 block text-[11px] font-normal text-slate-400">{tr("messaging.msgZCsvListNote")}</span>
            </label>
          ) : null}
          <label className="block text-sm">{tr("messaging.msgZScheduleLabel")}<input type="datetime-local" className={inputCls} value={bcForm.scheduledAt} onChange={(e) => setBcForm({ ...bcForm, scheduledAt: e.target.value })} /></label>
          {bcForm.scheduledAt ? (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3 lg:col-span-3">
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={bcForm.recEnabled} onChange={(e) => setBcForm({ ...bcForm, recEnabled: e.target.checked })} /> {tr("messaging.msgZRecurringLabel")}</label>
              {bcForm.recEnabled ? <>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block text-sm">{tr("messaging.msgZKindLabel")}
                    <select className={inputCls} value={bcForm.recFreq} onChange={(e) => setBcForm({ ...bcForm, recFreq: e.target.value })}>
                      <option value="daily">{tr("messaging.msgZDailyOption")}</option><option value="weekly">{tr("messaging.msgZWeeklyOption")}</option>
                    </select>
                  </label>
                  <label className="block text-sm">{tr("messaging.msgZIntervalLabel")}<input type="number" min={1} max={52} className={inputCls} value={bcForm.recInterval} onChange={(e) => setBcForm({ ...bcForm, recInterval: e.target.value })} /></label>
                  <label className="block text-sm">{tr("messaging.msgZEndDateLabel")}<input type="date" className={inputCls} value={bcForm.recEndsAt} onChange={(e) => setBcForm({ ...bcForm, recEndsAt: e.target.value })} /></label>
                </div>
                {bcForm.recFreq === "weekly" ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-500">{tr("messaging.msgZWeekdaysLabel")}</span>
                    {[tr("messaging.msgDaySun"), tr("messaging.msgDayMon"), tr("messaging.msgDayTue"), tr("messaging.msgDayWed"), tr("messaging.msgDayThu"), tr("messaging.msgDayFri"), tr("messaging.msgDaySat")].map((label, d) => (
                      <label key={d} className="flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs">
                        <input type="checkbox" checked={bcForm.recWeekdays.includes(d)} onChange={(e) => setBcForm({ ...bcForm, recWeekdays: e.target.checked ? [...bcForm.recWeekdays, d].sort((x, y) => x - y) : bcForm.recWeekdays.filter((x) => x !== d) })} /> {label}
                      </label>
                    ))}
                  </div>
                ) : null}
                <p className="text-[11px] text-slate-400">{tr("messaging.msgZRecurringNote")}</p>
              </> : null}
            </div>
          ) : null}
          <label className="text-sm lg:col-span-2">{tr("messaging.msgZTopicLabel")}
            <input className="input mt-1 w-64" placeholder={tr("messaging.msgZExOffers")} value={bcForm.topic} onChange={(e) => setBcForm({ ...bcForm, topic: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-sm lg:col-span-2"><input type="checkbox" checked={bcForm.excludePreviousRecipients} onChange={(e) => setBcForm({ ...bcForm, excludePreviousRecipients: e.target.checked })} /> {tr("messaging.msgZExcludePrevLong")}</label>
          <label className="flex items-center gap-2 text-sm lg:col-span-2"><input type="checkbox" checked={bcForm.abTest} onChange={(e) => setBcForm({ ...bcForm, abTest: e.target.checked })} /> {tr("messaging.msgZAbTestLabel")}</label>
          {bcForm.abTest ? <label className="flex items-start gap-2 text-sm lg:col-span-2"><input type="checkbox" className="mt-0.5" checked={bcForm.abAutoWinner} onChange={(e) => setBcForm({ ...bcForm, abAutoWinner: e.target.checked })} /> <span>🏆 <strong>{tr("messaging.msgZAutoWinnerName")}</strong>{tr("messaging.msgZAwA")}<strong>{tr("messaging.msgZAwHundred")}</strong>{tr("messaging.msgZAwB")}<strong>two-proportion z-test</strong>{tr("messaging.msgZAwC")}<strong>{tr("messaging.msgZAwConf")}</strong>{tr("messaging.msgZAwD")}<strong>{tr("messaging.msgZAwDefaultOff")}</strong>{tr("messaging.msgZAwE")}</span></label> : null}
          <label className="block text-sm">{tr("messaging.msgZHoldoutLabel", { min: fmtNumber(locale, 1), max: fmtNumber(locale, 50) })}
            <input type="number" min={1} max={50} className={inputCls} value={bcForm.holdoutPercent} onChange={(e) => setBcForm({ ...bcForm, holdoutPercent: e.target.value })} placeholder={tr("messaging.msgZEx10")} />
            <span className="mt-1 block text-[11px] text-slate-400">{tr("messaging.msgZHoldoutNote")}</span>
          </label>
          <label className="block text-sm">{tr("messaging.msgZBudgetLabel")}
            <input type="number" min={0} step="0.01" className={inputCls} value={bcForm.budgetCapTaka} onChange={(e) => setBcForm({ ...bcForm, budgetCapTaka: e.target.value })} placeholder={tr("messaging.msgZEx500")} />
            <span className="mt-1 block text-[11px] text-slate-400">{tr("messaging.msgZBudgetNote")}</span>
          </label>
          {bcForm.abTest && bcForm.channel !== "whatsapp" ? (<>
            {bcForm.channel === "email" || bcForm.channel === "push" || bcForm.channel === "onsite" ? <label className="block text-sm">Variant B {bcForm.channel === "push" || bcForm.channel === "onsite" ? "Title" : "Subject"}<input className={inputCls} value={bcForm.abSubject} onChange={(e) => setBcForm({ ...bcForm, abSubject: e.target.value })} placeholder={tr("messaging.msgZVariantBPlaceholder")} /></label> : null}
            <label className="block text-sm lg:col-span-2">Variant B Body<textarea className={inputCls} rows={2} value={bcForm.abBody} onChange={(e) => setBcForm({ ...bcForm, abBody: e.target.value })} required /></label>
          </>) : null}
          {bcForm.abTest && bcForm.channel === "whatsapp" ? <label className="block text-sm">Variant B Template
            <select className={inputCls} value={bcForm.abWhatsappTemplateId} onChange={(e) => setBcForm({ ...bcForm, abWhatsappTemplateId: e.target.value })} required>
              <option value="">{tr("messaging.msgPickOption")}</option>
              {waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
            </select>
          </label> : null}
          <div className="space-y-2 lg:col-span-3">
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={runPreview}>
              {busy === "preview" ? tr("messaging.msgPreviewing") : tr("messaging.msgZRecipientPreview")}
            </button>
            {preview ? (
              <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>{tr("messaging.msgZPreviewTotal")} <strong>{fmtNumber(locale, preview.audienceTotal)}</strong></span>
                  <span>{tr("messaging.msgZPreviewExcludedPrev")} <strong>{fmtNumber(locale, preview.excludedPreviousCount)}</strong></span>
                  <span>{tr("messaging.msgZPreviewExcludedOptout")} <strong>{fmtNumber(locale, preview.excludedSuppressedCount ?? 0)}</strong></span>
                  <span>{tr("messaging.msgZPreviewExcludedFreq")} <strong>{fmtNumber(locale, preview.excludedFrequencyCount ?? 0)}</strong></span>
                  <span>{tr("messaging.msgZPreviewExcludedOptin")} <strong>{fmtNumber(locale, preview.excludedNoOptInCount ?? 0)}</strong></span>
                  {(preview.invalidCount ?? 0) > 0 ? <span className="text-red-600">{tr("messaging.msgZPreviewInvalid")} <strong>{fmtNumber(locale, preview.invalidCount ?? 0)}</strong></span> : null}
                  {(preview.excludedHoldoutCount ?? 0) > 0 ? <span>{tr("messaging.msgZPreviewExcludedHoldout")} <strong>{fmtNumber(locale, preview.excludedHoldoutCount ?? 0)}</strong></span> : null}
                  <span>{tr("messaging.msgZPreviewFinal")} <strong>{fmtNumber(locale, preview.total)}</strong></span>
                </div>
                {preview.costEstimate ? (
                  <p className="rounded bg-white px-2 py-1 text-xs text-slate-600">{tr("messaging.msgZEstCost")} {preview.costEstimate.totalMinor !== undefined ? <strong>{fmtMoneyMinor(locale, preview.costEstimate.totalMinor)}</strong> : null}{preview.costEstimate.smsParts ? ` · ${tr("messaging.msgZSmsPartsPerMsg", { count: fmtNumber(locale, preview.costEstimate.smsParts) })}` : ""} · <span className="text-slate-500">{preview.costEstimate.basis}</span></p>
                ) : (
                  <p className="text-[11px] text-slate-400">{bcForm.channel === "push" ? tr("messaging.msgZNoCostPush") : bcForm.channel === "onsite" ? tr("messaging.msgZNoCostOnsite") : bcForm.channel === "telegram" ? tr("messaging.msgZNoCostTelegram") : tr("messaging.msgZNoCostGeneric")}</p>
                )}
                {preview.sample.length ? (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {preview.sample.map((s, i) => (
                      <li key={i} className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-slate-500">{s.address} · {s.type === "customer" ? "Customer" : s.type === "lead" ? "Lead" : s.type === "push" ? "Push Subscriber" : s.type === "telegram" ? "Telegram Subscriber" : tr("messaging.msgAudienceCsv")}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-slate-500">{tr("messaging.msgZNoRecipients")}</p>}
                <p className="text-[11px] text-slate-400">{tr("messaging.msgZMaskNote")}</p>
              </div>
            ) : null}
          </div>
          <button className="self-end btn-primary disabled:opacity-50" disabled={busy !== ""}>{tr("messaging.msgZCreateDraft")}</button>
        </form>
        <p className="text-xs text-slate-400">{tr("messaging.msgZSendCapNote")}</p>
      </div>
      </>) : null}

      {tab === "journeys" ? (<>
      <div className="space-y-3 card p-5 msg-section">
        <div className="font-semibold">{tr("messaging.msgZJourneyPresetsTitle")}</div>
        <p className="text-sm text-slate-500">{tr("messaging.msgZPresetsIntroA")}<strong>{tr("messaging.msgZPresetsIntroStrong")}</strong>{tr("messaging.msgZPresetsIntroB")}</p>
        {journeyPresets.length === 0 && unavailablePresets.length === 0 ? <p className="text-sm text-slate-400">{tr("messaging.msgZPresetLoading")}</p> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {journeyPresets.map((p) => (
              <div key={p.key} className="rounded-lg bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{p.name} {p.version === 2 ? <span className="ml-1 rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{tr("messaging.msgZV2MultiStep")}</span> : null}{p.exitOnPurchase ? <span className="ml-1 rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">{tr("messaging.msgZExitOnPurchaseBadge")}</span> : null}</div>
                    <div className="text-xs text-slate-500">{p.flow}{p.stepsCount ? tr("messaging.msgZStepsTotal", { count: fmtNumber(locale, p.stepsCount) }) : ""}</div>
                    {p.version === 2 && p.templates?.length ? (
                      <div className="text-xs text-slate-500">Templates: {p.templates.map((t) => `${t.name} (${t.channel === "email" ? "Email" : "SMS"})`).join(" · ")}</div>
                    ) : (
                      <div className="text-xs text-slate-500">Template: {p.templateName} ({p.channel === "email" ? "Email" : "SMS"})</div>
                    )}
                  </div>
                  <button type="button" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => installJourney(p)}>{busy === `journey-${p.key}` ? tr("messaging.msgZInstalling") : tr("messaging.msgZInstallBtn")}</button>
                </div>
                <p className="mt-1 text-sm text-slate-600">{p.descriptionBn}</p>
                {journeyResults[p.key] ? <p className="mt-2 rounded bg-white px-2 py-1 text-xs text-slate-700">{journeyResults[p.key]} {p.version !== 2 ? <a className="font-semibold text-blue-700 underline" href="/dashboard/workflows">{tr("messaging.msgZGoWorkflows")}</a> : null}</p> : null}
              </div>
            ))}
            {unavailablePresets.map((p) => (
              <div key={p.key} className="rounded-lg bg-slate-100 p-3 opacity-60">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-500">{p.name}</div>
                    <div className="text-xs text-slate-400">{tr("messaging.msgZPresetUnavailable")}</div>
                  </div>
                  <span className="rounded bg-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500">{tr("messaging.msgZUnavailableBadge")}</span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{p.reasonBn}</p>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-slate-400">{tr("messaging.msgZPresetsFootnote")}</p>
      </div>
      </>) : null}

      {tab === "journeys" ? (<>
      <div className="space-y-3 card p-5 msg-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">{tr("messaging.msgZJourneysTitle")}</div>
          <button type="button" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={startNewJourney}>{tr("messaging.msgZNewJourneyBtn")}</button>
        </div>
        <p className="text-sm text-slate-500">{tr("messaging.msgZJourneysIntroA")}<strong>{tr("messaging.msgZPresetsIntroStrong")}</strong>{tr("messaging.msgZJourneysIntroB")}</p>

        {journeyDraft ? (
          <div className="space-y-3 rounded-lg border bg-white p-3">
            <div className="text-sm font-semibold">{journeyDraft.id ? tr("messaging.msgZJourneyEditTitle") : tr("messaging.msgZJourneyNewTitle")}</div>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="block text-sm">{tr("messaging.msgZJourneyName")}<input className={inputCls} value={journeyDraft.name} onChange={(e) => setJourneyDraft({ ...journeyDraft, name: e.target.value })} placeholder={tr("messaging.msgZExJourneyName")} /></label>
              <label className="block text-sm">{tr("messaging.msgZTriggerLabel")}
                <select className={inputCls} value={journeyDraft.trigger} onChange={(e) => setJourneyDraft({ ...journeyDraft, trigger: e.target.value })}>
                  {(journeyMeta?.triggers ?? []).map((t) => <option key={t.trigger} value={t.trigger}>{t.labelBn}</option>)}
                </select>
              </label>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={journeyDraft.exitOnPurchase} onChange={(e) => setJourneyDraft({ ...journeyDraft, exitOnPurchase: e.target.checked })} />
              <span>{tr("messaging.msgZExitOnPurchaseLabel")}
                <span className="block text-[11px] text-slate-400">{tr("messaging.msgZExitOnPurchaseNote")}</span>
              </span>
            </label>

            <div>
              <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-3 text-sm font-medium">{tr("messaging.msgZTriggerBanner")} — {journeyTriggerLabel(journeyDraft.trigger)}</div>
              {journeyDraft.steps.map((step, i) => (
                <div key={i}>
                  <div className="py-0.5 text-center text-slate-400">↓</div>
                  <div className="space-y-2 rounded-lg border bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{tr("messaging.msgZStepN", { n: fmtNumber(locale, i + 1) })} · {JOURNEY_STEP_LABEL_L[step.type] ?? step.type}</span>
                      <span className="flex gap-1">
                        <button type="button" className="rounded border px-2 py-0.5 text-xs disabled:opacity-40" disabled={i === 0} onClick={() => moveDraftStep(i, -1)}>↑ {tr("messaging.msgZMoveUpWord")}</button>
                        <button type="button" className="rounded border px-2 py-0.5 text-xs disabled:opacity-40" disabled={i === journeyDraft.steps.length - 1} onClick={() => moveDraftStep(i, 1)}>↓ {tr("messaging.msgZMoveDownWord")}</button>
                        <button type="button" className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700" onClick={() => setJourneyDraft({ ...journeyDraft, steps: journeyDraft.steps.filter((_, j) => j !== i) })}>{tr("messaging.msgDelete")}</button>
                      </span>
                    </div>
                    {journeyStepFields(step, (p) => patchDraftStep(i, p))}
                    {step.type === "branch" ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {(["then", "else"] as const).map((arm) => (
                          <div key={arm} className="space-y-2 rounded-lg border bg-white p-2">
                            <div className="text-xs font-semibold">{arm === "then" ? tr("messaging.msgZArmThen") : tr("messaging.msgZArmElse")}</div>
                            {(step[arm] ?? []).map((sub, si) => (
                              <div key={si} className="space-y-2 rounded border bg-slate-50 p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium">{JOURNEY_STEP_LABEL_L[sub.type] ?? sub.type}</span>
                                  <span className="flex gap-1">
                                    <button type="button" className="rounded border px-1.5 py-0.5 text-[11px] disabled:opacity-40" disabled={si === 0} onClick={() => moveDraftSub(i, arm, si, -1)}>↑</button>
                                    <button type="button" className="rounded border px-1.5 py-0.5 text-[11px] disabled:opacity-40" disabled={si === (step[arm] ?? []).length - 1} onClick={() => moveDraftSub(i, arm, si, 1)}>↓</button>
                                    <button type="button" className="rounded border border-red-300 px-1.5 py-0.5 text-[11px] text-red-700" onClick={() => patchDraftStep(i, { [arm]: (step[arm] ?? []).filter((_, k) => k !== si) })}>✕</button>
                                  </span>
                                </div>
                                {journeyStepFields(sub, (p) => patchDraftSub(i, arm, si, p))}
                              </div>
                            ))}
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-[11px] text-slate-400">{tr("messaging.msgZAddStepLabel")}</span>
                              {JOURNEY_ADDABLE.filter((a) => ["send_email", "send_sms", "add_tag"].includes(a.type)).map((a) => (
                                <button key={a.type} type="button" className="rounded border px-2 py-0.5 text-[11px] font-semibold" onClick={() => patchDraftStep(i, { [arm]: [...(step[arm] ?? []), defaultJourneyStep(a.type)] })}>+ {a.label}</button>
                              ))}
                            </div>
                            <p className="text-[11px] text-slate-400">{tr("messaging.msgZBranchNestingNote")}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2 pt-3">
                <span className="text-sm text-slate-500">{tr("messaging.msgZAddStepsLabel")}</span>
                {journeyAddableFor(locale).map((a) => (
                  <button key={a.type} type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={() => setJourneyDraft({ ...journeyDraft, steps: [...journeyDraft.steps, defaultJourneyStep(a.type)] })}>+ {a.label}</button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <button type="button" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy !== "" || !journeyDraft.name.trim() || journeyDraft.steps.length === 0} onClick={saveJourneyDraft}>{busy.startsWith("journey-") ? tr("messaging.msgSaving") : tr("messaging.msgSave")}</button>
              <button type="button" className="rounded-lg border px-4 py-2 text-sm font-semibold" onClick={() => setJourneyDraft(null)}>{tr("messaging.msgCancel")}</button>
              {!journeyDraft.id ? <span className="text-[11px] text-slate-400">{tr("messaging.msgZNewJourneyDisabledNote")}</span> : null}
            </div>
          </div>
        ) : null}

        {journeys.length === 0 ? <p className="text-sm text-slate-400">{tr("messaging.msgZNoJourneys")}</p> : journeys.map((j) => (
          <div key={j.id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">{j.name}</span>
                <span className="ml-2 text-xs text-slate-500">{tr("messaging.msgZTriggerWord")}: {journeyTriggerLabel(j.trigger)}</span>
                {j.journey?.exitOnPurchase ? <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{tr("messaging.msgZExitOnPurchaseBadge")}</span> : null}
                <span className={`ml-2 rounded px-2 py-0.5 text-xs ${j.enabled ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-600"}`}>{j.enabled ? tr("messaging.msgStateOn") : tr("messaging.msgStateOff")}</span>
              </div>
              <span className="flex flex-wrap gap-1">
                <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleJourneyEnabled(j)}>{j.enabled ? tr("messaging.msgClose") : tr("messaging.msgZEnableBtn")}</button>
                <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => startEditJourney(j)}>{tr("messaging.msgEditBtn")}</button>
                <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleJourneyDetail(j)}>{journeyDetails[j.id] ? tr("messaging.msgZDetailClose") : tr("messaging.msgZDetailBtn")}</button>
              </span>
            </div>
            {j.runSummary ? (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                <span>{tr("messaging.msgZRunTotal")} <strong>{fmtNumber(locale, j.runSummary.total)}</strong></span>
                <span>{tr("messaging.msgZRunWaiting")} <strong>{fmtNumber(locale, j.runSummary.waiting)}</strong></span>
                <span>{tr("messaging.msgZRunCompleted")} <strong>{fmtNumber(locale, j.runSummary.completed)}</strong></span>
                <span>{tr("messaging.msgZRunFailed")} <strong>{fmtNumber(locale, j.runSummary.failed)}</strong></span>
                <span>{tr("messaging.msgZRunSkipped")} <strong>{fmtNumber(locale, j.runSummary.skipped)}</strong></span>
              </div>
            ) : null}
            {journeyDetails[j.id] ? (
              <div className="mt-3 space-y-3 rounded-lg border bg-white p-3">
                <div className="text-sm font-medium">{tr("messaging.msgZStepStatsTitle")}</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead><tr className="border-b text-slate-500"><th className="py-1 pr-2">{tr("messaging.msgZColStep")}</th><th className="py-1 pr-2">{tr("messaging.msgZColEntered")}</th><th className="py-1 pr-2">{tr("messaging.msgZColOk")}</th><th className="py-1 pr-2">{tr("messaging.msgZColSkipped")}</th><th className="py-1 pr-2">{tr("messaging.msgReportFailed")}</th><th className="py-1 pr-2">{tr("messaging.msgZColWaitingHere")}</th><th className="py-1">{tr("messaging.msgZColDeliveryBreakdown")}</th></tr></thead>
                    <tbody>
                      {journeyDetails[j.id].stepStats.map((s) => (
                        <tr key={s.idx} className="border-b last:border-0">
                          <td className="py-1 pr-2">{s.idx + 1}. {JOURNEY_STEP_LABEL_L[s.type] ?? s.type}</td>
                          <td className="py-1 pr-2">{s.entered}</td><td className="py-1 pr-2">{s.ok}</td><td className="py-1 pr-2">{s.skipped}</td><td className="py-1 pr-2">{s.failed}</td>
                          <td className="py-1 pr-2">{s.waitingHere === null ? "—" : s.waitingHere}</td>
                          <td className="py-1">{s.delivery ? `${s.delivery.sent}/${s.delivery.failed}/${s.delivery.skipped}/${s.delivery.opened}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-400">{tr("messaging.msgZTotalClicksLine", { count: fmtNumber(locale, journeyDetails[j.id].totalClicks) })}</p>
                {journeyDetails[j.id].legacyRunCount > 0 ? <p className="text-[11px] text-amber-600">{tr("messaging.msgZLegacyRunsNote", { count: fmtNumber(locale, journeyDetails[j.id].legacyRunCount) })}</p> : null}
                <div>
                  <div className="mb-1 text-sm font-medium">{tr("messaging.msgZRecentRuns", { count: fmtNumber(locale, journeyDetails[j.id].recentRuns.length) })}</div>
                  {journeyDetails[j.id].recentRuns.length === 0 ? <p className="text-xs text-slate-400">{tr("messaging.msgZNoRuns")}</p> : journeyDetails[j.id].recentRuns.map((r) => (
                    <div key={r.id} className="flex flex-wrap justify-between gap-2 border-b py-1 text-xs last:border-0">
                      <span>{r.trigger} · <span className={r.status === "completed" ? "text-green-700" : r.status === "failed" ? "text-red-600" : "text-slate-600"}>{r.status}</span></span>
                      <span className="text-slate-400">{fmtDateTime(locale, r.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      </>) : null}

      {tab === "channels" ? (<>
      <div className="space-y-3 card p-5 msg-section">
        <div className="font-semibold">💬 WhatsApp Templates (Meta)</div>
        <p className="text-sm text-slate-500">{tr("messaging.msgZWaTemplatesIntro")}</p>

        <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const res = await wrap("waba-save", () => apiFetch(`/organizations/${orgId}/inbox/whatsapp-waba`, { method: "PATCH", body: JSON.stringify({ wabaId: wabaInput.trim() || null }) }));
          if (res) { setNotice(wabaInput.trim() ? tr("messaging.msgZWabaSaved") : tr("messaging.msgZWabaRemoved")); await load(); }
        }}>
          <label className="block text-sm lg:col-span-2">WhatsApp Business Account ID (WABA ID)
            <input className={inputCls} value={wabaInput} onChange={(e) => setWabaInput(e.target.value)} placeholder={tr("messaging.msgZExWaba")} />
          </label>
          <button className="self-end rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""}>{tr("messaging.msgSave")}</button>
          <p className="text-[11px] text-slate-400 lg:col-span-3">{tr("messaging.msgZWabaHelp")} {waIntegrations.some((r) => r.provider === "whatsapp") ? "" : tr("messaging.msgZWabaNoIntegration")}</p>
        </form>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <button className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("wa-sync", () => apiFetch<{ synced: number; created: number; updated: number; notOnMeta: number; truncated: boolean }>(`/organizations/${o}/inbox/whatsapp-templates/sync`, { method: "POST" })); if (r) { setSyncResult(r); setNotice(tr("messaging.msgZSyncDone", { synced: fmtNumber(locale, r.synced), created: fmtNumber(locale, r.created), updated: fmtNumber(locale, r.updated) })); await load(); } }}>{busy === "wa-sync" ? tr("messaging.msgZSyncWorking") : tr("messaging.msgZSyncBtn")}</button>
          {syncResult ? <span className="text-xs text-slate-500">{tr("messaging.msgZLastSync", { synced: fmtNumber(locale, syncResult.synced), created: fmtNumber(locale, syncResult.created), updated: fmtNumber(locale, syncResult.updated), notOnMeta: fmtNumber(locale, syncResult.notOnMeta) })}{syncResult.truncated ? tr("messaging.msgZSyncTruncatedNote") : ""}</span> : null}
        </div>

        {waTemplates.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">{tr("messaging.msgZCategoryFilter")}
              <select className={inputCls} value={waCategoryFilter} onChange={(e) => setWaCategoryFilter(e.target.value)}>
                <option value="ALL">{tr("messaging.msgZAllCategories")}</option>
                <option value="MARKETING">MARKETING</option>
                <option value="UTILITY">UTILITY</option>
                <option value="AUTHENTICATION">AUTHENTICATION</option>
                <option value="NONE">{tr("messaging.msgZCategoryUnknown")}</option>
              </select>
            </label>
            <span className="text-xs text-slate-400">{tr("messaging.msgZCategoryNote")}</span>
          </div>
        ) : null}

        {waTemplates.length === 0 ? <p className="text-sm text-slate-400">{tr("messaging.msgZNoWaTemplates")}</p> : waTemplates.filter((t) => waCategoryFilter === "ALL" ? true : waCategoryFilter === "NONE" ? !t.category : t.category === waCategoryFilter).map((t) => { const kind = waTemplateKind(t); const rate = waTemplateRateMinor(t, senderSettings?.rates); return (
          <div key={t.id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{t.name} <span className="text-xs text-slate-400">({t.language}{t.category ? ` · ${t.category}` : ""})</span></span>
              <span className="flex flex-wrap gap-1">{waStatusBadge(t)}{kind !== "standard" ? <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs">{kind === "carousel" ? "🎠 Carousel" : kind === "catalog" ? "🛍️ Catalog" : "📝 Flow"}</span> : null}{t.qualityRating ? <span className={`rounded px-2 py-0.5 text-xs ${t.qualityRating === "RED" ? "bg-red-200 text-red-800" : "bg-slate-200"}`}>{tr("messaging.msgZQualityWord")}: {t.qualityRating}</span> : null}</span>
            </div>
            {t.bodyText ? <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{t.bodyText}</p> : null}
            {rate ? <div className="text-[11px] text-slate-500">{tr("messaging.msgZTemplateRate", { basis: rate.basis === "category" ? tr("messaging.msgZCategoryRate", { category: t.category ?? "" }) : tr("messaging.msgZFlatRate"), price: fmtMoneyMinor(locale, rate.minor) })}</div> : <div className="text-[11px] text-slate-400">{tr("messaging.msgZTemplateNoRate")}</div>}
            {!t.qualityRating ? <div className="text-[11px] text-slate-400">{tr("messaging.msgZQualityUnknown")}</div> : null}
            {t.qualityRating === "RED" || t.status === "REJECTED" ? <div className="text-[11px] font-medium text-red-600">{tr("messaging.msgZQualityRed")}</div> : null}
            {kind === "carousel" ? <div className="text-[11px] text-slate-400">{tr("messaging.msgZCarouselNote")}</div> : null}
            {t.lastSyncedAt ? <div className="text-[11px] text-slate-400">{tr("messaging.msgZLastSyncPrefix")} {fmtDateTime(locale, t.lastSyncedAt)}</div> : null}
          </div>
        ); })}

        <form className="grid gap-3 border-t pt-3 lg:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const buttons = waButtons.filter((b) => b.text.trim()).map((b) => b.subType === "url" ? { type: "url" as const, text: b.text.trim(), url: b.payload.trim() } : { type: "quick_reply" as const, text: b.text.trim() });
          const carouselCards = waCards.length ? waCards.map((c) => {
            const btns = [
              c.btn1Type ? { type: c.btn1Type, text: c.btn1Text.trim(), ...(c.btn1Type === "url" ? { url: c.btn1Url.trim() } : {}) } : null,
              c.btn2Type ? { type: c.btn2Type, text: c.btn2Text.trim(), ...(c.btn2Type === "url" ? { url: c.btn2Url.trim() } : {}) } : null,
            ].filter(Boolean);
            return { headerFormat: c.headerFormat, headerHandle: c.headerHandle.trim(), bodyText: c.bodyText, exampleValues: c.exampleValues ? c.exampleValues.split(",").map((x) => x.trim()) : undefined, buttons: btns.length ? btns : undefined };
          }) : undefined;
          const res = await wrap("wa-submit", () => apiFetch<WaTemplate>(`/organizations/${orgId}/inbox/whatsapp-templates/submit`, {
            method: "POST",
            body: JSON.stringify({
              name: waSubmit.name.trim(), language: waSubmit.language, category: waSubmit.category, bodyText: waSubmit.bodyText,
              exampleValues: waSubmit.exampleValues ? waSubmit.exampleValues.split(",").map((x) => x.trim()) : undefined,
              headerType: waSubmit.headerType === "none" ? undefined : waSubmit.headerType,
              headerText: waSubmit.headerType === "text" ? waSubmit.headerText : undefined,
              headerExample: waSubmit.headerType === "text" && waSubmit.headerExample.trim() ? waSubmit.headerExample.trim() : undefined,
              headerHandle: waSubmit.headerType === "image" ? waSubmit.headerHandle : undefined,
              buttons: buttons.length ? buttons : undefined,
              carouselCards,
            }),
          }));
          if (res) { setNotice(tr("messaging.msgZTemplateSubmitted", { name: res.name, status: res.status ?? "PENDING" })); setWaSubmit({ name: "", language: "bn", category: "MARKETING", bodyText: "", exampleValues: "", headerType: "none", headerText: "", headerExample: "", headerHandle: "" }); setWaButtons([]); setWaCards([]); await load(); }
        }}>
          <div className="text-sm font-medium lg:col-span-2">{tr("messaging.msgZSubmitTemplateTitle")}</div>
          <label className="block text-sm">{tr("messaging.msgZWaNameLabel")}<input className={inputCls} value={waSubmit.name} onChange={(e) => setWaSubmit({ ...waSubmit, name: e.target.value })} required /></label>
          <label className="block text-sm">{tr("messaging.msgZLanguageCodeLabel")}
            <select className={inputCls} value={waSubmit.language} onChange={(e) => setWaSubmit({ ...waSubmit, language: e.target.value })}>
              <option value="bn">{tr("messaging.msgZBanglaBn")}</option><option value="en">English (en)</option><option value="en_US">English US (en_US)</option>
            </select>
          </label>
          <label className="block text-sm">Category
            <select className={inputCls} value={waSubmit.category} onChange={(e) => setWaSubmit({ ...waSubmit, category: e.target.value })}>
              <option value="MARKETING">MARKETING ({tr("messaging.msgZCatMarketingSuffix")})</option><option value="UTILITY">UTILITY ({tr("messaging.msgZCatUtilitySuffix")})</option><option value="AUTHENTICATION">AUTHENTICATION (OTP)</option>
            </select>
          </label>
          <label className="block text-sm">Header
            <select className={inputCls} value={waSubmit.headerType} onChange={(e) => setWaSubmit({ ...waSubmit, headerType: e.target.value })}>
              <option value="none">{tr("messaging.msgZNoneWord")}</option><option value="text">Text</option><option value="image">{tr("messaging.msgZImageOption")}</option>
            </select>
          </label>
          {waSubmit.headerType === "text" ? (<>
            <label className="block text-sm">{tr("messaging.msgZHeaderTextLabel")}<input className={inputCls} value={waSubmit.headerText} onChange={(e) => setWaSubmit({ ...waSubmit, headerText: e.target.value })} required /></label>
            <label className="block text-sm">{tr("messaging.msgZHeaderExampleLabel")}<input className={inputCls} value={waSubmit.headerExample} onChange={(e) => setWaSubmit({ ...waSubmit, headerExample: e.target.value })} placeholder={tr("messaging.msgZExEidOffer")} /></label>
          </>) : null}
          {waSubmit.headerType === "image" ? <label className="block text-sm lg:col-span-2">{tr("messaging.msgZImageHandleLabel")}<input className={inputCls} value={waSubmit.headerHandle} onChange={(e) => setWaSubmit({ ...waSubmit, headerHandle: e.target.value })} required /></label> : null}
          <label className="block text-sm lg:col-span-2">{tr("messaging.msgZBodyTextVars")}<textarea className={inputCls} rows={3} value={waSubmit.bodyText} onChange={(e) => setWaSubmit({ ...waSubmit, bodyText: e.target.value })} required placeholder={tr("messaging.msgZExBodyText")} /></label>
          <label className="block text-sm lg:col-span-2">{tr("messaging.msgZExampleValuesLabel")}<input className={inputCls} value={waSubmit.exampleValues} onChange={(e) => setWaSubmit({ ...waSubmit, exampleValues: e.target.value })} placeholder={tr("messaging.msgZExExampleValues")} /></label>
          <div className="space-y-2 lg:col-span-2 rounded-lg bg-slate-50 p-3">
            <div className="text-sm font-medium">{tr("messaging.msgZWaButtonsTitle", { max: fmtNumber(locale, 10), chars: fmtNumber(locale, 25) })}</div>
            {waButtons.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <select className="input w-auto" value={b.subType} onChange={(e) => setWaButtons(waButtons.map((x, j) => j === i ? { ...x, subType: e.target.value as WaButtonRow["subType"] } : x))}>
                  <option value="url">{tr("messaging.msgZUrlButtonOption")}</option><option value="quick_reply">Quick Reply</option>
                </select>
                <input className="input w-48" maxLength={25} value={b.text} onChange={(e) => setWaButtons(waButtons.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} placeholder={tr("messaging.msgButtonTextLabel")} />
                {b.subType === "url" ? <input className="input w-64" value={b.payload} onChange={(e) => setWaButtons(waButtons.map((x, j) => j === i ? { ...x, payload: e.target.value } : x))} placeholder={tr("messaging.msgZUrlPayloadPlaceholder")} /> : null}
                <button type="button" className="rounded-lg border px-2 py-1 text-xs" onClick={() => setWaButtons(waButtons.filter((_, j) => j !== i))}>{tr("messaging.msgRemoveBtn")}</button>
              </div>
            ))}
            <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40" disabled={waButtons.length >= 10} onClick={() => setWaButtons([...waButtons, { subType: "quick_reply", text: "", payload: "" }])}>{tr("messaging.msgZAddButton")}</button>
          </div>
          <div className="space-y-2 lg:col-span-2 rounded-lg bg-slate-50 p-3">
            <div className="text-sm font-medium">{tr("messaging.msgZCarouselTitle", { min: fmtNumber(locale, 2), max: fmtNumber(locale, 10) })}</div>
            <p className="text-[11px] text-slate-400">{tr("messaging.msgZCarouselFormNote")}</p>
            {waCards.map((c, i) => (
              <div key={i} className="space-y-2 rounded border bg-white p-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{tr("messaging.msgZCardN", { n: fmtNumber(locale, i + 1) })}</span>
                  <select className="input w-auto" value={c.headerFormat} onChange={(e) => setWaCards(waCards.map((x, j) => j === i ? { ...x, headerFormat: e.target.value as WaCardRow["headerFormat"] } : x))}>
                    <option value="image">{tr("messaging.msgZImageOption")}</option><option value="video">{tr("messaging.msgZVideoOption")}</option>
                  </select>
                  <input className="input w-64" value={c.headerHandle} onChange={(e) => setWaCards(waCards.map((x, j) => j === i ? { ...x, headerHandle: e.target.value } : x))} placeholder={tr("messaging.msgZHandleRequired")} />
                  <button type="button" className="rounded-lg border px-2 py-1 text-xs" onClick={() => setWaCards(waCards.filter((_, j) => j !== i))}>{tr("messaging.msgRemoveBtn")}</button>
                </div>
                <textarea className={inputCls} rows={2} value={c.bodyText} onChange={(e) => setWaCards(waCards.map((x, j) => j === i ? { ...x, bodyText: e.target.value } : x))} placeholder={tr("messaging.msgZCardBodyPlaceholder")} />
                <input className={inputCls} value={c.exampleValues} onChange={(e) => setWaCards(waCards.map((x, j) => j === i ? { ...x, exampleValues: e.target.value } : x))} placeholder={tr("messaging.msgZCardExamplePlaceholder")} />
                {([1, 2] as const).map((n) => {
                  const typeKey = n === 1 ? "btn1Type" : "btn2Type"; const textKey = n === 1 ? "btn1Text" : "btn2Text"; const urlKey = n === 1 ? "btn1Url" : "btn2Url";
                  return (
                    <div key={n} className="flex flex-wrap items-center gap-2 text-sm">
                      <select className="input w-auto" value={c[typeKey]} onChange={(e) => setWaCards(waCards.map((x, j) => j === i ? { ...x, [typeKey]: e.target.value } : x))}>
                        <option value="">{tr("messaging.msgZCardButtonNone", { n: fmtNumber(locale, n) })}</option><option value="url">{tr("messaging.msgZUrlButtonOption")}</option><option value="quick_reply">Quick Reply</option>
                      </select>
                      {c[typeKey] ? <input className="input w-48" maxLength={25} value={c[textKey]} onChange={(e) => setWaCards(waCards.map((x, j) => j === i ? { ...x, [textKey]: e.target.value } : x))} placeholder={tr("messaging.msgButtonTextLabel")} /> : null}
                      {c[typeKey] === "url" ? <input className="input w-64" value={c[urlKey]} onChange={(e) => setWaCards(waCards.map((x, j) => j === i ? { ...x, [urlKey]: e.target.value } : x))} placeholder="https://..." /> : null}
                    </div>
                  );
                })}
              </div>
            ))}
            <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40" disabled={waCards.length >= 10} onClick={() => setWaCards([...waCards, { headerFormat: "image", headerHandle: "", bodyText: "", exampleValues: "", btn1Type: "", btn1Text: "", btn1Url: "", btn2Type: "", btn2Text: "", btn2Url: "" }])}>{tr("messaging.msgZAddCard")}</button>
          </div>
          <button className="self-end btn-primary disabled:opacity-50" disabled={busy !== ""}>{busy === "wa-submit" ? tr("messaging.msgZSubmitting") : tr("messaging.msgZSubmitToMeta")}</button>
        </form>
      </div>
      </>) : null}

      {tab === "settings" ? (<>
      <div className="space-y-3 card p-5 msg-section">
        <div className="font-semibold">{tr("messaging.msgZSenderSettingsTitle")}</div>
        <p className="text-sm text-slate-500">{tr("messaging.msgZSenderIntro")}</p>

        <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const res = await wrap("smtp-save", () => apiFetch<SenderSettings>(`/organizations/${orgId}/messaging/senders/email`, {
            method: "PUT",
            body: JSON.stringify({ smtpHost: smtpForm.smtpHost, smtpPort: Number(smtpForm.smtpPort), smtpUser: smtpForm.smtpUser || undefined, smtpPass: smtpForm.smtpPass || undefined, fromAddress: smtpForm.fromAddress, fromName: smtpForm.fromName || undefined, dkimSelector: smtpForm.dkimSelector || undefined }),
          }));
          if (res) { setSenderSettings(res); setSmtpForm({ ...smtpForm, smtpPass: "" }); setNotice(tr("messaging.msgZSmtpSaved")); await load(); }
        }}>
          <div className="text-sm font-medium lg:col-span-3">{tr("messaging.msgZOwnSmtpTitle")} {senderSettings?.email.tenantConfigured ? <span className="badge-green">{tr("messaging.msgZSmtpActiveBadge")}</span> : senderSettings?.email.platformConfigured ? <span className="badge-slate">{tr("messaging.msgZPlatformSmtpBadge")}</span> : <span className="badge-amber">{tr("messaging.msgZNoEmailPath")}</span>}</div>
          <label className="block text-sm">SMTP Host<input className={inputCls} value={smtpForm.smtpHost} onChange={(e) => setSmtpForm({ ...smtpForm, smtpHost: e.target.value })} placeholder="mail.example.com" /></label>
          <label className="block text-sm">Port<input type="number" className={inputCls} value={smtpForm.smtpPort} onChange={(e) => setSmtpForm({ ...smtpForm, smtpPort: e.target.value })} /></label>
          <label className="block text-sm">Username<input className={inputCls} value={smtpForm.smtpUser} onChange={(e) => setSmtpForm({ ...smtpForm, smtpUser: e.target.value })} /></label>
          <label className="block text-sm">Password<input type="password" className={inputCls} value={smtpForm.smtpPass} onChange={(e) => setSmtpForm({ ...smtpForm, smtpPass: e.target.value })} placeholder={senderSettings?.email.smtpPassConfigured ? tr("messaging.msgZPasswordSavedPlaceholder") : tr("messaging.msgZSmtpPassword")} autoComplete="new-password" /></label>
          <label className="block text-sm">{tr("messaging.msgZFromAddress")}<input className={inputCls} value={smtpForm.fromAddress} onChange={(e) => setSmtpForm({ ...smtpForm, fromAddress: e.target.value })} placeholder="hello@example.com" /></label>
          <label className="block text-sm">{tr("messaging.msgZFromName")}<input className={inputCls} value={smtpForm.fromName} onChange={(e) => setSmtpForm({ ...smtpForm, fromName: e.target.value })} placeholder={tr("messaging.msgZExMyShop")} /></label>
          <label className="block text-sm">{tr("messaging.msgZDkimSelector")}<input className={inputCls} value={smtpForm.dkimSelector} onChange={(e) => setSmtpForm({ ...smtpForm, dkimSelector: e.target.value })} placeholder={tr("messaging.msgZExDkim")} /></label>
          <div className="flex flex-wrap items-end gap-2">
            <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{busy === "smtp-save" ? tr("messaging.msgZVerifying") : tr("messaging.msgZVerifyAndSave")}</button>
            {senderSettings?.email.tenantConfigured ? <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("smtp-clear", () => apiFetch<SenderSettings>(`/organizations/${o}/messaging/senders/email`, { method: "PUT", body: JSON.stringify({ clear: true }) })); if (r) { setSenderSettings(r); setNotice(tr("messaging.msgZSmtpRemoved")); await load(); } }}>{tr("messaging.msgZRemoveOwnSmtp")}</button> : null}
          </div>
        </form>

        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <label className="block text-sm">{tr("messaging.msgZTestEmailLabel")}<input className={inputCls} value={testEmailTo} onChange={(e) => setTestEmailTo(e.target.value)} placeholder={tr("messaging.msgZYourEmail")} /></label>
          <button className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== "" || !testEmailTo} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("smtp-test", () => apiFetch<{ sent: boolean; path: string; providerMessageId: string }>(`/organizations/${o}/messaging/senders/email/test`, { method: "POST", body: JSON.stringify({ to: testEmailTo }) })); if (r) setNotice(tr("messaging.msgZTestEmailSent", { path: r.path === "tenant" ? tr("messaging.msgZPathOwnSmtp") : tr("messaging.msgZPathPlatformSmtp"), id: r.providerMessageId })); }}>{busy === "smtp-test" ? tr("messaging.msgSending") : tr("messaging.msgZTestEmailBtn")}</button>
          <button className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("domain-health", () => apiFetch<DomainHealth>(`/organizations/${o}/messaging/senders/email/domain-health`)); if (r) setDomainHealth(r); }}>{tr("messaging.msgZDomainHealthBtn")}</button>
        </div>
        {domainHealth ? (
          <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
            {domainHealth.domain ? <>
              <div>{tr("messaging.msgZDomainWord")} <strong>{domainHealth.domain}</strong> ({domainHealth.source === "tenant" ? tr("messaging.msgZYourFrom") : tr("messaging.msgZPlatformFrom")})</div>
              <div>SPF: {domainHealth.spf.status === "found" ? <span className="text-green-700">{tr("messaging.msgZFoundWord")} — <span className="break-all text-xs">{domainHealth.spf.record}</span></span> : domainHealth.spf.status === "missing" ? <span className="text-red-600">{tr("messaging.msgZMissingWord")} — {domainHealth.spf.reason}</span> : <span className="text-amber-600">{tr("messaging.msgZUnknownWord")} — {domainHealth.spf.reason}</span>}</div>
              <div>DKIM: {domainHealth.dkim.status === "found" ? <span className="text-green-700">{tr("messaging.msgZFoundWord")} ({tr("messaging.msgZSelectorWord")}: {domainHealth.dkim.selector})</span> : domainHealth.dkim.status === "missing" ? <span className="text-red-600">{tr("messaging.msgZMissingWord")} — {domainHealth.dkim.reason}</span> : domainHealth.dkim.status === "not_checked" ? <span className="text-slate-500">{tr("messaging.msgZNotCheckedWord")} — {domainHealth.dkim.reason}</span> : <span className="text-amber-600">{tr("messaging.msgZUnknownWord")} — {domainHealth.dkim.reason}</span>}</div>
            </> : <div className="text-amber-600">{domainHealth.spf.reason}</div>}
          </div>
        ) : null}

        <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const res = await wrap("sms-save", () => apiFetch<SenderSettings & { note?: string }>(`/organizations/${orgId}/messaging/senders/sms`, {
            method: "PUT",
            body: JSON.stringify({ smsGateway: smsForm.smsGateway, smsApiKey: smsForm.smsApiKey || undefined, smsSenderId: smsForm.smsSenderId, smsApiUrl: smsForm.smsApiUrl || undefined }),
          }));
          if (res) { setSenderSettings(res); setSmsForm({ ...smsForm, smsApiKey: "" }); setNotice(res.note ? tr("messaging.msgZSmsSavedWithNote", { note: res.note }) : tr("messaging.msgZSmsSaved")); await load(); }
        }}>
          <div className="text-sm font-medium lg:col-span-3">{tr("messaging.msgZOwnSmsTitle")} {senderSettings?.sms.tenantConfigured ? <span className="badge-green">{tr("messaging.msgZSmsActiveBadge")}</span> : senderSettings?.sms.platformConfigured ? <span className="badge-slate">{tr("messaging.msgZPlatformGatewayBadge")}</span> : <span className="badge-amber">{tr("messaging.msgZNoSmsPath")}</span>}</div>
          <label className="block text-sm">Gateway
            <select className={inputCls} value={smsForm.smsGateway} onChange={(e) => setSmsForm({ ...smsForm, smsGateway: e.target.value })}>
              {SMS_GATEWAY_OPTIONS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">API Key<input type="password" className={inputCls} value={smsForm.smsApiKey} onChange={(e) => setSmsForm({ ...smsForm, smsApiKey: e.target.value })} placeholder={senderSettings?.sms.smsApiKeyConfigured ? tr("messaging.msgZKeySavedPlaceholder") : "Gateway API Key"} autoComplete="new-password" /></label>
          <label className="block text-sm">Sender ID<input className={inputCls} value={smsForm.smsSenderId} onChange={(e) => setSmsForm({ ...smsForm, smsSenderId: e.target.value })} placeholder={tr("messaging.msgZSenderIdPlaceholder")} /></label>
          <label className="block text-sm">{tr("messaging.msgZApiUrlLabel")}<input className={inputCls} value={smsForm.smsApiUrl} onChange={(e) => setSmsForm({ ...smsForm, smsApiUrl: e.target.value })} placeholder={tr("messaging.msgZApiUrlPlaceholder")} /></label>
          <div className="flex flex-wrap items-end gap-2">
            <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{tr("messaging.msgSave")}</button>
            {senderSettings?.sms.tenantConfigured ? <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("sms-clear", () => apiFetch<SenderSettings>(`/organizations/${o}/messaging/senders/sms`, { method: "PUT", body: JSON.stringify({ clear: true }) })); if (r) { setSenderSettings(r); setNotice(tr("messaging.msgZSmsGatewayRemoved")); await load(); } }}>{tr("messaging.msgZRemoveOwnGateway")}</button> : null}
          </div>
          <p className="text-[11px] text-slate-400 lg:col-span-3">{tr("messaging.msgZSmsGatewayNote")}</p>
        </form>

        <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const toMinor = (v: string) => v.trim() === "" ? null : Math.round(Number(v) * 100);
          const res = await wrap("rates-save", () => apiFetch<SenderSettings>(`/organizations/${orgId}/messaging/senders/rates`, {
            method: "PATCH",
            body: JSON.stringify({ smsCostPerPartMinor: toMinor(rateForm.sms), whatsappCostPerMessageMinor: toMinor(rateForm.whatsapp), whatsappMarketingCostPerMessageMinor: toMinor(rateForm.whatsappMarketing), whatsappUtilityCostPerMessageMinor: toMinor(rateForm.whatsappUtility), whatsappAuthenticationCostPerMessageMinor: toMinor(rateForm.whatsappAuthentication), emailCostPerMessageMinor: toMinor(rateForm.email) }),
          }));
          if (res) { setSenderSettings(res); setNotice(tr("messaging.msgZRatesSaved")); await load(); }
        }}>
          <div className="text-sm font-medium lg:col-span-3">{tr("messaging.msgZRatesTitle")}</div>
          <label className="block text-sm">{tr("messaging.msgZRateSms")}<input type="number" step="0.01" min="0" className={inputCls} value={rateForm.sms} onChange={(e) => setRateForm({ ...rateForm, sms: e.target.value })} placeholder={tr("messaging.msgZRateUnknownPh")} /></label>
          <label className="block text-sm">{tr("messaging.msgZRateWa")}<input type="number" step="0.01" min="0" className={inputCls} value={rateForm.whatsapp} onChange={(e) => setRateForm({ ...rateForm, whatsapp: e.target.value })} placeholder={tr("messaging.msgZRateUnknownPh")} /></label>
          <label className="block text-sm">{tr("messaging.msgZRateWaMarketing")}<input type="number" step="0.01" min="0" className={inputCls} value={rateForm.whatsappMarketing} onChange={(e) => setRateForm({ ...rateForm, whatsappMarketing: e.target.value })} placeholder={tr("messaging.msgZRateFlatPh")} /></label>
          <label className="block text-sm">{tr("messaging.msgZRateWaUtility")}<input type="number" step="0.01" min="0" className={inputCls} value={rateForm.whatsappUtility} onChange={(e) => setRateForm({ ...rateForm, whatsappUtility: e.target.value })} placeholder={tr("messaging.msgZRateFlatPh")} /></label>
          <label className="block text-sm">{tr("messaging.msgZRateWaAuth")}<input type="number" step="0.01" min="0" className={inputCls} value={rateForm.whatsappAuthentication} onChange={(e) => setRateForm({ ...rateForm, whatsappAuthentication: e.target.value })} placeholder={tr("messaging.msgZRateFlatPh")} /></label>
          <label className="block text-sm">{tr("messaging.msgZRateEmail")}<input type="number" step="0.01" min="0" className={inputCls} value={rateForm.email} onChange={(e) => setRateForm({ ...rateForm, email: e.target.value })} placeholder={tr("messaging.msgZRateUnknownPh")} /></label>
          <button className="self-end rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""}>{tr("messaging.msgZSaveRates")}</button>
          <p className="text-[11px] text-slate-400 lg:col-span-3">{tr("messaging.msgZRatesNote")}</p>
        </form>
      </div>
      </>) : null}

      {tab === "settings" ? (<>
      <div className="space-y-3 card p-5 msg-section">
        <div className="font-semibold">{tr("messaging.msgZConsentTitle")}</div>
        <p className="text-sm text-slate-500">{tr("messaging.msgZConsentIntro")}</p>
        <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const res = await wrap("msg-setting", () => apiFetch<MessagingSetting>(`/organizations/${orgId}/messaging/settings`, { method: "PATCH", body: JSON.stringify(msgSetting) }));
          if (res) { applySettingsView(res); setNotice(tr("messaging.msgZConsentSaved")); void load(); }
        }}>
          <label className="block text-sm">{tr("messaging.msgZFrequencyCapLabel")}<input type="number" min={0} max={20} className={inputCls} value={msgSetting.frequencyCapPerDay} onChange={(e) => setMsgSetting({ ...msgSetting, frequencyCapPerDay: Number(e.target.value) })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={msgSetting.whatsappOptInRequired} onChange={(e) => setMsgSetting({ ...msgSetting, whatsappOptInRequired: e.target.checked })} /> {tr("messaging.msgZWaOptInLabel")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={msgSetting.whatsappQualityGuardEnabled} onChange={(e) => setMsgSetting({ ...msgSetting, whatsappQualityGuardEnabled: e.target.checked })} /> {tr("messaging.msgZQualityGuardLabel")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={msgSetting.abAutoWinnerEnabled} onChange={(e) => setMsgSetting({ ...msgSetting, abAutoWinnerEnabled: e.target.checked })} /> {tr("messaging.msgZAwDefaultA")}{tr("messaging.msgZAwConf")}{tr("messaging.msgZAwDefaultB")}<strong>{tr("messaging.msgZAwDefaultOffNote")}</strong></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={msgSetting.approvalEnabled} onChange={(e) => setMsgSetting({ ...msgSetting, approvalEnabled: e.target.checked })} /> {tr("messaging.msgZApprovalLabelA")}<strong>{tr("messaging.msgZApprovalRecommend")}</strong>{tr("messaging.msgZApprovalTail")}</label>
          <label className="block text-sm">{tr("messaging.msgZBroadcastCostCapLabel")}<input type="number" min={0} step="0.01" className={inputCls} value={msgSetting.broadcastCostCapMinor === null ? "" : msgSetting.broadcastCostCapMinor / 100} onChange={(e) => setMsgSetting({ ...msgSetting, broadcastCostCapMinor: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })} placeholder={tr("messaging.msgZNoCapPh")} /></label>
          <label className="block text-sm">{tr("messaging.msgZMonthlyCapLabel")}<input type="number" min={0} step="0.01" className={inputCls} value={msgSetting.monthlySpendCapMinor === null ? "" : msgSetting.monthlySpendCapMinor / 100} onChange={(e) => setMsgSetting({ ...msgSetting, monthlySpendCapMinor: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })} placeholder={tr("messaging.msgZNoCapPh")} /></label>
          <p className="text-[11px] text-slate-400 lg:col-span-3">{tr("messaging.msgZBudgetNoteA")}<strong>{tr("messaging.msgZBudgetNoteStrong")}</strong>{tr("messaging.msgZBudgetNoteB")}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={msgSetting.linkTrackingEnabled} onChange={(e) => setMsgSetting({ ...msgSetting, linkTrackingEnabled: e.target.checked })} /> {tr("messaging.msgZLinkTrackingLabel")}</label>
          <label className="block text-sm">{tr("messaging.msgZSweepBroadcastsLabel")}<input type="number" min={1} max={50} className={inputCls} value={msgSetting.marketingMaxBroadcastsPerSweep ?? ""} onChange={(e) => setMsgSetting({ ...msgSetting, marketingMaxBroadcastsPerSweep: e.target.value === "" ? null : Number(e.target.value) })} placeholder={tr("messaging.msgZDefaultPh")} /></label>
          <label className="block text-sm">{tr("messaging.msgZSweepEntriesLabel")}<input type="number" min={1} max={5000} className={inputCls} value={msgSetting.marketingMaxEntriesPerSweep ?? ""} onChange={(e) => setMsgSetting({ ...msgSetting, marketingMaxEntriesPerSweep: e.target.value === "" ? null : Number(e.target.value) })} placeholder={tr("messaging.msgZDefaultPh")} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={msgSetting.quietHoursEnabled} onChange={(e) => setMsgSetting({ ...msgSetting, quietHoursEnabled: e.target.checked })} /> {tr("messaging.msgZQuietHoursLabel")}</label>
          <label className="block text-sm">{tr("messaging.msgZQuietStart")}<input type="time" className={inputCls} value={msgSetting.quietHoursStart ?? ""} onChange={(e) => setMsgSetting({ ...msgSetting, quietHoursStart: e.target.value || null })} /></label>
          <label className="block text-sm">{tr("messaging.msgZQuietEnd")}<input type="time" className={inputCls} value={msgSetting.quietHoursEnd ?? ""} onChange={(e) => setMsgSetting({ ...msgSetting, quietHoursEnd: e.target.value || null })} /></label>
          <div className="text-sm font-medium lg:col-span-3 border-t pt-3">{tr("messaging.msgZThresholdsTitle")}</div>
          <label className="block text-sm">{tr("messaging.msgZThChurn")}<input type="number" min={1} max={3650} className={inputCls} value={msgSetting.churnRiskSilentDays} onChange={(e) => setMsgSetting({ ...msgSetting, churnRiskSilentDays: Number(e.target.value) })} /></label>
          <label className="block text-sm">{tr("messaging.msgZThLikely")}<input type="number" min={0} max={100} className={inputCls} value={msgSetting.likelyToBuyMinScore} onChange={(e) => setMsgSetting({ ...msgSetting, likelyToBuyMinScore: Number(e.target.value) })} /></label>
          <label className="block text-sm">{tr("messaging.msgZThLtv")}<input type="number" min={0} className={inputCls} value={msgSetting.highLtvMinSpentMinor} onChange={(e) => setMsgSetting({ ...msgSetting, highLtvMinSpentMinor: Number(e.target.value) })} /></label>
          <label className="block text-sm">{tr("messaging.msgZThSuppressDays")}<input type="number" min={1} max={3650} className={inputCls} value={msgSetting.unengagedSuppressDays} onChange={(e) => setMsgSetting({ ...msgSetting, unengagedSuppressDays: Number(e.target.value) })} /></label>
          <label className="block text-sm">{tr("messaging.msgZThSuppressSends")}<input type="number" min={1} max={1000} className={inputCls} value={msgSetting.unengagedMinSends} onChange={(e) => setMsgSetting({ ...msgSetting, unengagedMinSends: Number(e.target.value) })} /></label>
          <button className="self-end rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""}>{tr("messaging.msgZSaveSettings")}</button>
          <p className="text-[11px] text-slate-400 lg:col-span-3">{tr("messaging.msgZQuietInfoA", { tz: streamInfo?.timezone ?? "Asia/Dhaka" })}{streamInfo?.quietHoursActive ? tr("messaging.msgZQuietActiveNote") : ""}{tr("messaging.msgZQuietInfoB")}</p>
          <p className="text-[11px] text-slate-400 lg:col-span-3">{tr("messaging.msgZLinkInfoA")}<strong>{tr("messaging.msgZLinkInfoStrong")}</strong>{tr("messaging.msgZLinkInfoB")}</p>
        </form>

        <div className="border-t pt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{tr("messaging.msgZConsentListTitle", { count: fmtNumber(locale, preferences.length) })}</span>
            <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={exportPreferences}>{tr("messaging.msgZExportOptOut")}</button>
          </div>
          {preferences.length === 0 ? <p className="text-sm text-slate-400">{tr("messaging.msgZNoPrefRecords")}</p> : preferences.map((p) => (
            <div key={p.id} className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 px-3 py-2 text-sm">
              <span><span className="rounded bg-slate-200 px-2 py-0.5 text-xs capitalize">{p.channel}</span> <span className="font-medium">{p.address}</span> <span className={p.status === "opted_out" ? "text-red-600" : "text-green-600"}>{p.status === "opted_out" ? tr("messaging.msgZOptedOut") : tr("messaging.msgZOptedIn")}</span> <span className="text-xs text-slate-400">· {p.source} · {fmtDateTime(locale, p.updatedAt)}</span></span>
              <button className="rounded-lg border px-2 py-1 text-xs disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap(`pref-del-${p.id}`, () => apiFetch(`/organizations/${o}/messaging/preferences/${p.id}`, { method: "DELETE" })); if (r) { setNotice(tr("messaging.msgZPrefRemoved")); await load(); } }}>{tr("messaging.msgRemoveBtn")}</button>
            </div>
          ))}
          <form className="mt-3 grid gap-3 lg:grid-cols-4" onSubmit={async (e) => {
            e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
            const res = await wrap("pref-add", () => apiFetch(`/organizations/${orgId}/messaging/preferences`, { method: "POST", body: JSON.stringify(prefForm) }));
            if (res) { setPrefForm({ channel: "email", address: "", status: "opted_out" }); setNotice(tr("messaging.msgZPrefAdded")); await load(); }
          }}>
            <label className="block text-sm">Channel
              <select className={inputCls} value={prefForm.channel} onChange={(e) => setPrefForm({ ...prefForm, channel: e.target.value })}>
                <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
              </select>
            </label>
            <label className="block text-sm">{tr("messaging.msgZAddressLabel")}<input className={inputCls} value={prefForm.address} onChange={(e) => setPrefForm({ ...prefForm, address: e.target.value })} required placeholder={tr("messaging.msgZPrefAddressPlaceholder")} /></label>
            <label className="block text-sm">{tr("messaging.msgZStatusLabel")}
              <select className={inputCls} value={prefForm.status} onChange={(e) => setPrefForm({ ...prefForm, status: e.target.value })}>
                <option value="opted_out">{tr("messaging.msgZOptedOut")}</option><option value="opted_in">{tr("messaging.msgZOptedIn")}</option>
              </select>
            </label>
            <button className="self-end rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""}>{tr("messaging.msgZAddBtn")}</button>
          </form>
          <form className="mt-3 grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
            e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
            const addresses = importForm.text.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
            if (!addresses.length) { setError(tr("messaging.msgZImportNeedAddress")); return; }
            const res = await wrap("pref-import", () => apiFetch<{ imported: number; errors: { address: string; error: string }[] }>(`/organizations/${orgId}/messaging/preferences/import`, { method: "POST", body: JSON.stringify({ channel: importForm.channel, addresses }) }));
            if (res) { setImportResult(res); setImportForm({ channel: "email", text: "" }); setNotice(tr("messaging.msgZImportDone", { imported: fmtNumber(locale, res.imported), failed: fmtNumber(locale, res.errors.length) })); await load(); }
          }}>
            <label className="block text-sm">Import Channel
              <select className={inputCls} value={importForm.channel} onChange={(e) => setImportForm({ ...importForm, channel: e.target.value })}>
                <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
              </select>
            </label>
            <label className="block text-sm lg:col-span-2">{tr("messaging.msgZImportLabel", { max: fmtNumber(locale, 1000) })}<textarea className={inputCls} rows={3} value={importForm.text} onChange={(e) => setImportForm({ ...importForm, text: e.target.value })} placeholder={"one@example.com\ntwo@example.com"} /></label>
            <button className="self-end rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""}>{tr("messaging.msgZImportBtn")}</button>
            {importResult && importResult.errors.length ? (
              <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 lg:col-span-3">
                {tr("messaging.msgZFailedAddresses")} {importResult.errors.map((x) => `${x.address} (${x.error})`).join("; ")}
              </div>
            ) : null}
          </form>
          <p className="mt-2 text-[11px] text-slate-400">{tr("messaging.msgZDailyCapNote")}</p>
        </div>
      </div>
      </>) : null}

      {tab === "channels" ? (<>
      <div className="space-y-3 card p-5 msg-section">
        <div className="font-semibold">{tr("messaging.msgZKeywordTitle")}</div>
        <p className="text-sm text-slate-500">{tr("messaging.msgZKeywordIntro")}</p>
        {kwRules.length === 0 ? <p className="text-sm text-slate-400">{tr("messaging.msgZNoKwRules")}</p> : kwRules.map((r) => (
          <div key={r.id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{r.name}</span>
              <span className="flex flex-wrap items-center gap-1">
                <span className={`rounded px-2 py-0.5 text-xs ${r.kind === "poll" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}`}>{r.kind === "poll" ? tr("messaging.msgZPollBadge") : tr("messaging.msgZKeywordBadge")}</span>
                <span className={`rounded px-2 py-0.5 text-xs ${r.enabled ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>{r.enabled ? tr("messaging.msgStateOn") : tr("messaging.msgStateOff")}</span>
                <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">{tr("messaging.msgZHits", { count: fmtNumber(locale, r.hitCount) })}</span>
              </span>
            </div>
            {r.kind === "keyword" ? (
              <div className="mt-1 text-slate-600">
                {tr("messaging.msgZKeywordWord")}: <strong>&quot;{r.keyword}&quot;</strong>
                {r.tag ? <> · 🏷️ {tr("messaging.msgZTagWord")} &quot;{r.tag}&quot; → {(r.applyTagTo ?? []).map((t) => t === "customer" ? tr("messaging.msgZTagCustomer") : t === "lead" ? tr("messaging.msgZTagLead") : tr("messaging.msgZTagConversation")).join(", ")}</> : null}
                {r.autoReplyText ? <> · ↩️ {tr("messaging.msgZAutoReplyPrefix")}: &quot;{r.autoReplyText.length > 80 ? `${r.autoReplyText.slice(0, 80)}…` : r.autoReplyText}&quot;</> : null}
              </div>
            ) : (
              <div className="mt-1 text-slate-600">{(r.pollOptions ?? []).map((o) => `${o.label} (${o.keywords.join(" / ")})`).join(" · ")}</div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleKwRule(r)}>{busy === `kw-toggle-${r.id}` ? "..." : r.enabled ? tr("messaging.msgClose") : tr("messaging.msgZEnableBtn")}</button>
              <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => startKwEdit(r)}>{tr("messaging.msgEditBtn")}</button>
              {r.kind === "poll" ? <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => loadKwTally(r.id)}>{busy === `kw-tally-${r.id}` ? tr("messaging.msgLoading") : tr("messaging.msgZSeeResults")}</button> : null}
              <button type="button" className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => deleteKwRule(r)}>{tr("messaging.msgDelete")}</button>
              <span className="text-[11px] text-slate-400">{tr("messaging.msgZDeleteRoleShort")}</span>
            </div>
            {r.kind === "poll" && kwTallies[r.id] ? (
              <div className="mt-2 space-y-1 rounded-lg border bg-white p-3">
                {kwTallies[r.id].options.map((o) => {
                  const total = kwTallies[r.id].totalVoters;
                  const pct = total > 0 ? Math.round((o.votes / total) * 100) : 0;
                  return (
                    <div key={o.key} className="flex items-center gap-2 text-xs">
                      <span className="w-36 shrink-0 font-medium">{o.label}</span>
                      <span className="h-3 flex-1 overflow-hidden rounded bg-slate-100"><span className="block h-full bg-violet-400" style={{ width: `${pct}%` }} /></span>
                      <span className="w-20 shrink-0 text-right">{tr("messaging.msgZVotes", { votes: fmtNumber(locale, o.votes), pct: fmtNumber(locale, pct) })}</span>
                    </div>
                  );
                })}
                <p className="text-[11px] text-slate-400">{tr("messaging.msgZTotalVoters", { count: fmtNumber(locale, kwTallies[r.id].totalVoters) })}</p>
              </div>
            ) : null}
          </div>
        ))}
        <form className="grid gap-3 border-t pt-3 lg:grid-cols-2" onSubmit={submitKwRule}>
          <label className="block text-sm">{tr("messaging.msgZRuleName")}<input className={inputCls} value={kwForm.name} onChange={(e) => setKwForm({ ...kwForm, name: e.target.value })} required /></label>
          <label className="block text-sm">{tr("messaging.msgZKindLabel")}
            <select className={inputCls} value={kwForm.kind} disabled={kwEditId !== null} onChange={(e) => setKwForm({ ...kwForm, kind: e.target.value })}>
              <option value="keyword">{tr("messaging.msgZKwKindKeyword")}</option>
              <option value="poll">{tr("messaging.msgZKwKindPoll")}</option>
            </select>
          </label>
          {kwEditId !== null ? <p className="text-[11px] text-slate-400 lg:col-span-2">{tr("messaging.msgZKwKindLockedNote")}</p> : null}
          {kwForm.kind === "keyword" ? (<>
            <label className="block text-sm lg:col-span-2">{tr("messaging.msgZKwKeywordLabel")}
              <input className={inputCls} value={kwForm.keyword} onChange={(e) => setKwForm({ ...kwForm, keyword: e.target.value })} placeholder={tr("messaging.msgZExOfferKw")} required />
              <span className="mt-1 block text-[11px] text-slate-400">{tr("messaging.msgZKwReservedNote")}</span>
            </label>
            <label className="block text-sm">{tr("messaging.msgZTagOptional")}<input className={inputCls} value={kwForm.tag} onChange={(e) => setKwForm({ ...kwForm, tag: e.target.value })} placeholder={tr("messaging.msgZExInterested")} /></label>
            <div className="block text-sm">{tr("messaging.msgZTagWhere")}
              <div className="mt-1 flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-1"><input type="checkbox" checked={kwForm.toCustomer} onChange={(e) => setKwForm({ ...kwForm, toCustomer: e.target.checked })} /> {tr("messaging.msgZTagCustomer")}</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={kwForm.toLead} onChange={(e) => setKwForm({ ...kwForm, toLead: e.target.checked })} /> {tr("messaging.msgZTagLead")}</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={kwForm.toConversation} onChange={(e) => setKwForm({ ...kwForm, toConversation: e.target.checked })} /> {tr("messaging.msgZTagConversation")}</label>
              </div>
            </div>
            <label className="block text-sm lg:col-span-2">{tr("messaging.msgZKwAutoReplyLabel", { max: fmtNumber(locale, 1000) })}
              <textarea className={inputCls} rows={2} value={kwForm.autoReplyText} onChange={(e) => setKwForm({ ...kwForm, autoReplyText: e.target.value })} placeholder={tr("messaging.msgZKwAutoReplyPlaceholder")} />
              <span className="mt-1 block text-[11px] text-slate-400">{tr("messaging.msgZKwAutoReplyNote")}</span>
            </label>
          </>) : (<>
            <div className="lg:col-span-2">
              <div className="text-sm font-medium">{tr("messaging.msgZPollOptionsTitle", { min: fmtNumber(locale, 2), max: fmtNumber(locale, 6) })}</div>
              <div className="mt-2 space-y-2">
                {kwPollOptions.map((o, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input className="input w-52" placeholder={tr("messaging.msgZPollLabelPlaceholder")} value={o.label} onChange={(e) => setKwPollOptions((s) => s.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))} required />
                    <input className="input w-72" placeholder={tr("messaging.msgZPollKeywordPlaceholder")} value={o.keywords} onChange={(e) => setKwPollOptions((s) => s.map((x, xi) => (xi === i ? { ...x, keywords: e.target.value } : x)))} required />
                    {kwPollOptions.length > 2 ? <button type="button" className="rounded-lg border border-red-300 px-2 py-1 text-xs font-semibold text-red-700" onClick={() => setKwPollOptions((s) => s.filter((_, xi) => xi !== i))}>{tr("messaging.msgRemoveBtn")}</button> : null}
                  </div>
                ))}
              </div>
              {kwPollOptions.length < 6 ? <button type="button" className="mt-2 rounded-lg border px-3 py-1 text-xs font-semibold" onClick={() => setKwPollOptions((s) => [...s, { key: "", label: "", keywords: "" }])}>{tr("messaging.msgZAddOption")}</button> : null}
              <p className="mt-1 text-[11px] text-slate-400">{tr("messaging.msgZPollNote")}</p>
            </div>
          </>)}
          <div className="flex items-end gap-2">
            <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{busy === "kw-rule" ? tr("messaging.msgSaving") : kwEditId ? tr("messaging.msgSave") : tr("messaging.msgZCreateRule")}</button>
            {kwEditId ? <button type="button" className="rounded-lg border px-3 py-1.5 text-sm font-semibold" onClick={resetKwForm}>{tr("messaging.msgCancel")}</button> : null}
          </div>
        </form>
        <div className="border-t pt-3">
          <div className="text-sm font-semibold">{tr("messaging.msgZRecentHits", { count: fmtNumber(locale, kwHits.length) })}</div>
          {kwHits.length === 0 ? <p className="mt-1 text-sm text-slate-400">{tr("messaging.msgZNoKwHits")}</p> : kwHits.map((h) => (
            <div key={h.id} className="mt-2 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-medium">&quot;{h.matchedText}&quot;</span> <span className="text-slate-500">→ {tr("messaging.msgZRuleWord")}: {h.ruleName ?? h.ruleId}{h.pollOptionKey ? tr("messaging.msgZVoteSuffix", { key: h.pollOptionKey }) : tr("messaging.msgZKwSuffix", { keyword: h.matchedKeyword })}</span></span>
                <span className="text-xs text-slate-400">{fmtDateTime(locale, h.createdAt)}</span>
              </div>
              {(h.actions ?? []).length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(h.actions ?? []).map((a, i) => (
                    <span key={i} className={`rounded px-2 py-0.5 text-xs ${a.status === "applied" ? "bg-green-100 text-green-700" : a.status === "failed" ? "bg-red-100 text-red-700" : "bg-slate-200 text-slate-600"}`}>
                      {a.action === "tag" ? tr("messaging.msgZTagChip", { entity: a.entity ?? a.target ?? "" }) : tr("messaging.msgZReplyChip")}: {a.status === "applied" ? tr("messaging.msgZAppliedWord") : a.status === "failed" ? tr("messaging.msgReportFailed") : tr("messaging.msgZSkippedWord")}{a.reason ? ` — ${a.reason}` : ""}{a.providerMessageId ? ` · ${a.providerMessageId}` : ""}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {h.classifyStatus === "suggested" && h.suggestedLabel ? (<>
                  <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">{tr("messaging.msgZAiSuggestion", { label: h.suggestedLabel })}</span>
                  <button type="button" className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => applyKwHitLabel(h, "confirm")}>{tr("messaging.msgZConfirmBtn")}</button>
                  <button type="button" className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => applyKwHitLabel(h, "dismiss")}>{tr("messaging.msgCancel")}</button>
                  <span className="text-[11px] text-slate-400">{tr("messaging.msgZClassifyNote")}</span>
                </>) : h.classifyStatus === "confirmed" ? (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">{tr("messaging.msgZLabelConfirmed", { label: h.confirmedLabel ?? "" })}</span>
                ) : h.classifyStatus === "dismissed" ? (
                  <span className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-500">{tr("messaging.msgZAiDismissed")}</span>
                ) : (
                  <button type="button" className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => classifyKwHit(h)}>{busy === `kw-classify-${h.id}` ? tr("messaging.msgZThinking") : tr("messaging.msgZClassifyBtn")}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      </>) : null}

      {tab === "insights" ? (<>
      <div className="space-y-3 card p-5 msg-section">
      <div className="space-y-3 card p-5">
        <div className="font-semibold">{tr("messaging.msgZAnalyticsTitle")}</div>
        <p className="text-sm text-slate-500">{tr("messaging.msgZAnalyticsIntroA")}<strong>—</strong>{tr("messaging.msgZAnalyticsIntroB")}<strong>{tr("messaging.msgZAnalyticsIntroStrong")}</strong>{tr("messaging.msgZAnalyticsIntroC")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">{tr("messaging.msgZFromLabel")}<input type="date" className={inputCls} value={analyticsRange.from} onChange={(e) => setAnalyticsRange({ ...analyticsRange, from: e.target.value })} /></label>
          <label className="block text-sm">{tr("messaging.msgZToLabel")}<input type="date" className={inputCls} value={analyticsRange.to} onChange={(e) => setAnalyticsRange({ ...analyticsRange, to: e.target.value })} /></label>
          <button type="button" className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={loadAnalytics}>{busy === "analytics" ? tr("messaging.msgLoading") : tr("messaging.msgZSeeAnalytics")}</button>
          <button type="button" className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={exportAnalytics}>{tr("messaging.msgZCsvExportSame")}</button>
        </div>
        {analytics ? (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-slate-400">{fmtDate(locale, analytics.range.from)} – {fmtDate(locale, analytics.range.to)} · {analytics.stageNote}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead><tr className="border-b text-slate-500"><th className="py-1 pr-2">{tr("messaging.msgZColChannel")}</th><th className="py-1 pr-2">Broadcast</th><th className="py-1 pr-2">Audience</th><th className="py-1 pr-2">Sent</th><th className="py-1 pr-2">Failed</th><th className="py-1 pr-2">Skipped</th><th className="py-1 pr-2">Delivered</th><th className="py-1 pr-2">Read</th><th className="py-1 pr-2">Opened</th><th className="py-1 pr-2">{tr("messaging.msgZColClicksPeople")}</th><th className="py-1">{tr("messaging.msgZColClicksTotal")}</th></tr></thead>
                <tbody>
                  {analytics.channels.map((c) => (
                    <tr key={c.channel} className="border-b">
                      <td className="py-1 pr-2 font-medium">{c.channel}</td><td className="py-1 pr-2">{c.broadcasts}</td><td className="py-1 pr-2">{c.audience}</td><td className="py-1 pr-2">{c.sent}</td><td className="py-1 pr-2">{c.failed}</td><td className="py-1 pr-2">{c.skipped}</td><td className="py-1 pr-2">{c.delivered ?? "—"}</td><td className="py-1 pr-2">{c.read ?? "—"}</td><td className="py-1 pr-2">{c.opened ?? "—"}</td><td className="py-1 pr-2">{c.clickedRecipients ?? "—"}</td><td className="py-1">{c.totalClicks ?? "—"}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold"><td className="py-1 pr-2">{tr("messaging.msgZTotalWord")}</td><td className="py-1 pr-2">{analytics.totals.broadcasts}</td><td className="py-1 pr-2">{analytics.totals.audience}</td><td className="py-1 pr-2">{analytics.totals.sent}</td><td className="py-1 pr-2">{analytics.totals.failed}</td><td className="py-1 pr-2">{analytics.totals.skipped}</td><td className="py-1 pr-2">{analytics.totals.delivered ?? "—"}</td><td className="py-1 pr-2">{analytics.totals.read ?? "—"}</td><td className="py-1 pr-2">{analytics.totals.opened ?? "—"}</td><td className="py-1 pr-2">{analytics.totals.clickedRecipients ?? "—"}</td><td className="py-1">{analytics.totals.totalClicks ?? "—"}</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <div className="font-medium">{tr("messaging.msgZPerBroadcastCompare")}</div>
              <ul className="mt-1 space-y-1 text-xs text-slate-600">
                {analytics.broadcasts.map((b) => <li key={b.id}>• <strong>{b.name}</strong> ({b.channel}, {b.status}) — Sent {b.funnel.sent} · Delivered {b.funnel.delivered ?? "—"} · Read {b.funnel.read ?? "—"} · Opened {b.funnel.opened ?? "—"} · {tr("messaging.msgZColClicksPeople")} {b.funnel.clickedRecipients ?? "—"}{b.revenueAssociation ? ` · ${tr("messaging.msgZAssocOrders", { orders: fmtNumber(locale, b.revenueAssociation.orders), total: fmtMoneyMinor(locale, Number(b.revenueAssociation.totalMinor)) })}` : ""}</li>)}
                {analytics.broadcasts.length === 0 ? <li>{tr("messaging.msgZNoBroadcastsInRange")}</li> : null}
              </ul>
            </div>
            <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">💰 {analytics.association.label}{tr("messaging.msgZAssocLine", { orders: fmtNumber(locale, analytics.association.orders), total: fmtMoneyMinor(locale, Number(analytics.association.totalMinor)) })}<br />{analytics.attributionNote}</p>
          </div>
        ) : null}
      </div>

        <div className="font-semibold">{tr("messaging.msgZGovernanceTitle")}</div>
        <p className="text-sm text-slate-500">{tr("messaging.msgZGovernanceIntro")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">📈 Delivery Health</span>
          <select className="rounded-lg border px-2 py-1 text-sm" value={healthDays} onChange={(e) => setHealthDays(Number(e.target.value))}>
            <option value={7}>{tr("messaging.msgZLast7Days")}</option><option value={30}>{tr("messaging.msgZLast30Days")}</option><option value={90}>{tr("messaging.msgZLast90Days")}</option>
          </select>
          <button type="button" className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("health", () => apiFetch<DeliveryHealth>(`/organizations/${o}/messaging/health?days=${healthDays}`)); if (r) setHealth(r); }}>{busy === "health" ? tr("messaging.msgLoading") : tr("messaging.msgZSeeHealth")}</button>
        </div>
        {health ? (health.available ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5 text-xs">
              <span className="rounded bg-slate-100 px-2 py-1">{tr("messaging.msgZHealthTotals", { deliveries: health.totals?.deliveries ?? "—", sent: health.totals?.sent ?? "—", failed: health.totals?.failed ?? "—", rate: health.totals?.failureRate === null || health.totals?.failureRate === undefined ? "—" : `${(health.totals.failureRate * 100).toFixed(1)}%` })}</span>
              <span className="rounded bg-slate-100 px-2 py-1">Bounce Rate: — (null) · Complaint Rate: — (null)</span>
              {health.domainHealth?.domain ? <span className="rounded bg-slate-100 px-2 py-1">{tr("messaging.msgZHealthDomain", { domain: health.domainHealth.domain, spf: health.domainHealth.spf.status, dkim: health.domainHealth.dkim.status })}</span> : null}
            </div>
            {health.channels.map((c) => (
              <div key={c.channel} className="rounded bg-slate-50 px-3 py-2 text-sm">
                <span className="font-medium capitalize">{c.channel}</span>
                <span className="text-slate-500"> — Sent {c.sent} · Failed {c.failed} · Skipped {c.skipped} · Failure {c.failureRate === null ? "—" : `${(c.failureRate * 100).toFixed(1)}%`} · Delivered {c.deliveredRate === null ? "—" : `${(c.deliveredRate * 100).toFixed(1)}%`} · Read {c.readRate === null ? "—" : `${(c.readRate * 100).toFixed(1)}%`} · Bounce — · Complaint —</span>
                {c.failureReasons.length ? <div className="text-xs text-red-500">{tr("messaging.msgZFailureReasonsWord")}: {c.failureReasons.map((f) => `${f.reason} (${f.count})`).join(" · ")}</div> : null}
              </div>
            ))}
            <p className="text-[11px] text-slate-400">{health.bounceComplaintNote}</p>
            <p className="text-[11px] text-slate-400">{health.perSenderNote}</p>
            {health.autoSuppression ? <p className="text-[11px] text-slate-400">🤖 Auto-suppression: {health.autoSuppression}</p> : null}
          </div>
        ) : <p className="text-sm text-amber-600">{health.reason}</p>) : <p className="text-sm text-slate-400">{tr("messaging.msgZHealthNotLoaded")}</p>}
        <div className="border-t pt-3">
          <div className="text-sm font-medium">{tr("messaging.msgZChecklistTitle")}</div>
          <p className="text-xs text-slate-500">{tr("messaging.msgZChecklistIntro")}</p>
          <button type="button" className="mt-1 rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("check-v2", () => apiFetch<ComposeCheckV2Result>(`/organizations/${o}/messaging/compose-check-v2`, { method: "POST", body: JSON.stringify({ channel: bcForm.channel, subject: bcForm.subject || undefined, body: bcForm.body, htmlBody: bcForm.htmlBody || undefined, audienceType: bcForm.audienceType, audienceStage: bcForm.audienceStage || undefined, audienceSegment: bcForm.audienceSegment || undefined }) })); if (r) setCheckV2(r); }}>{busy === "check-v2" ? tr("messaging.msgZVerifying") : tr("messaging.msgZRunChecklist")}</button>
          {checkV2 ? (
            <div className="mt-2 space-y-1.5">
              {checkV2.checks.map((c) => (
                <div key={c.code} className="rounded bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium">{c.status === "pass" ? "✅" : c.status === "warn" ? "⚠️" : c.status === "fail" ? "❌" : "➖"} {c.label}</span>
                  <span className="text-slate-600"> — {c.detail}</span>
                  <div className="text-[11px] text-slate-400">{tr("messaging.msgZVerifiedPrefix")} {c.verified}</div>
                </div>
              ))}
              <p className="text-[11px] text-slate-400">{tr("messaging.msgZSpamWordList", { label: checkV2.spamWords.label, en: checkV2.spamWords.en.join(", "), bn: checkV2.spamWords.bn.join(", ") })}</p>
            </div>
          ) : null}
        </div>
        <div className="border-t pt-3">
          <div className="text-sm font-medium">{tr("messaging.msgZSeedTitle")}</div>
          <p className="text-xs text-slate-500">{tr("messaging.msgZSeedIntro")}</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block text-sm">Channel<select className={inputCls} value={seedForm.channel} onChange={(e) => setSeedForm({ ...seedForm, channel: e.target.value })}><option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option></select></label>
            <label className="block text-sm">{tr("messaging.msgColAddress")}<input className={inputCls} value={seedForm.address} onChange={(e) => setSeedForm({ ...seedForm, address: e.target.value })} placeholder={tr("messaging.msgZSeedAddressPlaceholder")} /></label>
            <label className="block text-sm">{tr("messaging.msgZLabelOptional")}<input className={inputCls} value={seedForm.label} onChange={(e) => setSeedForm({ ...seedForm, label: e.target.value })} placeholder={tr("messaging.msgZExOwnerPhone")} /></label>
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== "" || !seedForm.address.trim()} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("seed-add", () => apiFetch<SeedRecipient>(`/organizations/${o}/messaging/seed-recipients`, { method: "POST", body: JSON.stringify(seedForm) })); if (r) { setSeedForm({ ...seedForm, address: "", label: "" }); setNotice(tr("messaging.msgZSeedAdded")); await load(); } }}>{tr("messaging.msgZAddBtn")}</button>
            <label className="block text-sm">{tr("messaging.msgZSeedTestBroadcast")}<select className={inputCls} value={seedTestBroadcastId} onChange={(e) => setSeedTestBroadcastId(e.target.value)}><option value="">{tr("messaging.msgZPickEllipsis")}</option>{broadcasts.filter((b) => ["email", "sms", "whatsapp", "telegram"].includes(b.channel)).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.channel})</option>)}</select></label>
          </div>
          {seeds.length === 0 ? <p className="mt-1 text-sm text-slate-400">{tr("messaging.msgZNoSeeds")}</p> : seeds.map((sd) => (
            <div key={sd.id} className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 px-3 py-2 text-sm">
              <span><span className="rounded bg-slate-200 px-2 py-0.5 text-xs capitalize">{sd.channel}</span> <span className="font-medium">{sd.address}</span>{sd.label ? <span className="text-slate-500"> · {sd.label}</span> : null}</span>
              <span className="flex gap-2">
                <button type="button" className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !seedTestBroadcastId} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap(`seed-test-${sd.id}`, () => apiFetch<TestSendResult>(`/organizations/${o}/messaging/broadcasts/${seedTestBroadcastId}/test-send-seed`, { method: "POST", body: JSON.stringify({ seedId: sd.id }) })); if (r) setNotice(tr("messaging.msgZSeedTestPrefix", { address: sd.address, status: r.status }) + (r.error ? ` — ${r.error}` : "")); }}>{tr("messaging.msgTestSendBtn")}</button>
                <button type="button" className="rounded-lg border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap(`seed-del-${sd.id}`, () => apiFetch(`/organizations/${o}/messaging/seed-recipients/${sd.id}`, { method: "DELETE" })); if (r) { setNotice(tr("messaging.msgZSeedRemoved")); await load(); } }}>{tr("messaging.msgDelete")}</button>
              </span>
            </div>
          ))}
        </div>
        <div className="border-t pt-3">
          <div className="text-sm font-medium">{tr("messaging.msgZApprovalsQueue", { count: fmtNumber(locale, approvals.length) })}</div>
          <p className="text-xs text-slate-500">{tr("messaging.msgZApprovalsIntro")}</p>
          {approvals.length === 0 ? <p className="mt-1 text-sm text-slate-400">{tr("messaging.msgZNoApprovals")}</p> : approvals.map((b) => (
            <div key={b.id} className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded bg-amber-50 px-3 py-2 text-sm">
              <span><span className="font-medium">{b.name}</span> <span className="text-slate-500 capitalize">({b.channel})</span>{b.scheduledAt ? <span className="text-slate-500"> · {tr("messaging.msgZScheduleWord")}: {fmtDateTime(locale, b.scheduledAt)}</span> : null}</span>
              <span className="flex gap-2">
                <button type="button" className="rounded-lg bg-green-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const note = window.prompt(tr("messaging.msgApprovalNotePrompt")) ?? undefined; const r = await wrap(`approve-${b.id}`, () => apiFetch<Broadcast>(`/organizations/${o}/messaging/broadcasts/${b.id}/approve`, { method: "POST", body: JSON.stringify({ note }) })); if (r) { setNotice(tr("messaging.msgZApprovedShort", { name: r.name })); await load(); } }}>{tr("messaging.msgZApproveShort")}</button>
                <button type="button" className="rounded-lg border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const note = window.prompt(tr("messaging.msgRejectReasonPrompt")) ?? undefined; const r = await wrap(`reject-${b.id}`, () => apiFetch<Broadcast>(`/organizations/${o}/messaging/broadcasts/${b.id}/reject`, { method: "POST", body: JSON.stringify({ note }) })); if (r) { setNotice(tr("messaging.msgZRejectedShort", { name: r.name })); await load(); } }}>{tr("messaging.msgZRejectShort")}</button>
              </span>
            </div>
          ))}
        </div>
      </div>
      </>) : null}

      {tab === "insights" ? (<>
      <div className="space-y-3 card p-5 msg-section">
        <div className="font-semibold">{tr("messaging.msgZTxTitle")}</div>
        <p className="text-sm text-slate-500">{tr("messaging.msgZTxIntro")}</p>
        {!txOverview ? <p className="text-sm text-slate-400">{tr("messaging.msgZLoadingEllipsis")}</p> : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded bg-slate-100 px-2 py-1">{tr("messaging.msgZTxSettingsWord")}: {txOverview.setting === null ? tr("messaging.msgZTxUnreadable") : txOverview.setting.configured ? tr("messaging.msgZTxConfigured") : tr("messaging.msgZTxDefault")}</span>
              {txOverview.setting ? <span className="rounded bg-slate-100 px-2 py-1">{tr("messaging.msgZTxActiveEvents", { enabled: fmtNumber(locale, txOverview.setting.enabledEvents), total: fmtNumber(locale, txOverview.setting.totalEvents) })}</span> : null}
              {txOverview.setting && txOverview.setting.channelsInUse.length ? <span className="rounded bg-slate-100 px-2 py-1">Channel: {txOverview.setting.channelsInUse.join(", ")}</span> : null}
              <span className="rounded bg-slate-100 px-2 py-1">{tr("messaging.msgZTxTotals", { total: txOverview.summary.total ?? "—", sent: txOverview.summary.sent ?? "—", failed: txOverview.summary.failed ?? "—" })}</span>
            </div>
            {txOverview.setting ? (
              <div className="flex flex-wrap gap-1.5">
                {txOverview.setting.events.map((ev) => (
                  <span key={ev.event} className={`rounded px-2 py-0.5 text-xs ${ev.enabled ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-400"}`}>{ev.event}: {ev.enabled ? tr("messaging.msgZTxEventOn", { channels: ev.channels.join("/") }) : tr("messaging.msgStateOff")}</span>
                ))}
              </div>
            ) : null}
            <div>
              <div className="mb-2 text-sm font-medium">{tr("messaging.msgZTxRecent", { count: fmtNumber(locale, txOverview.recent.length) })}</div>
              {txOverview.recent.length === 0 ? <p className="text-sm text-slate-400">{tr("messaging.msgZTxNone")}</p> : txOverview.recent.map((l) => (
                <div key={l.id} className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 px-3 py-2 text-sm">
                  <span><span className="rounded bg-slate-200 px-2 py-0.5 text-xs capitalize">{l.channel}</span> <span className="font-medium">{tr("messaging.msgZOrderWord")} {l.orderRef}</span> <span className="text-slate-500">{l.event}</span> <span className={l.status === "sent" ? "text-green-600" : l.status.startsWith("failed") ? "text-red-600" : "text-slate-500"}>{l.status}</span>{l.error ? <span className="text-xs text-red-500"> · {l.error}</span> : null}</span>
                  <span className="text-xs text-slate-400">{fmtDateTime(locale, l.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      </>) : null}
    </div>
  );
}
