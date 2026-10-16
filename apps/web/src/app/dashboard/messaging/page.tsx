"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { smsSegments } from "@/lib/sms-segments";
import { couponSnippetHtml, couponSnippetText } from "@/lib/composer-blocks";
import { EmptyState } from "@repo/ui";

interface Template { id: string; name: string; channel: string; subject?: string | null; body: string; htmlBody?: string | null }
// MS5: composer support types. The variables list is fetched from
// the API's GET messaging/variables (the API builds snapshot vars
// from the same constant — nothing here is a second source).
type TemplateVariables = Record<"customer" | "lead" | "csv", { key: string; labelBn: string }[]>;
interface ComposerProduct { id: string; name: string; priceMinor: string; currency: string; imageUrl?: string | null; url: string | null; snippetText: string; snippetHtml: string }
interface TestSendResult { status: string; providerMessageId?: string; error?: string; address: string }
interface ComposeWarning { code: string; message: string }
// MS6: WhatsApp template hub types (rows come from the inbox
// whatsapp-templates endpoint — full local rows incl. Meta state).
interface WaTemplate { id: string; name: string; language: string; category?: string | null; bodyText?: string | null; status?: string | null; qualityRating?: string | null; lastSyncedAt?: string | null }
interface WaButtonRow { subType: "url" | "quick_reply"; text: string; payload: string }
interface MessagingIntegration { id: string; provider: string; status: string; wabaId?: string | null }
interface BroadcastProgress { total: number; sent: number; failed: number; skipped: number; pending: number }
interface Broadcast { id: string; name: string; channel: string; status: string; totalRecipients: number; sentCount: number; failedCount: number; audienceType: string; audienceStage?: string | null; audienceSegment?: string | null; audienceSavedId?: string | null; abVariant?: string | null; abGroupId?: string | null; excludePreviousRecipients?: boolean; sentAt?: string | null; scheduledAt?: string | null; progress?: BroadcastProgress; recurrence?: Recurrence | null; recurrenceGroupId?: string | null; subject?: string | null; body: string; htmlBody?: string | null; templateId?: string | null; whatsappTemplateId?: string | null; templateParams?: string[] | null; archivedAt?: string | null }
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
  ab: { groupId: string; variants: Record<string, BroadcastFunnel>; suggestion: { basis: string | null; leader: string | null; note: string } } | null;
}
// MS8: a messaging journey preset (installed via the real
// WorkflowsService path; starts disabled for human review).
interface JourneyPreset { key: string; name: string; descriptionBn: string; flow: string; trigger: string; channel: string; templateName: string }
interface CostEstimate { currency: string; smsParts?: number; totalMinor?: number; basis: string }
interface BroadcastPreview { audienceTotal: number; excludedPreviousCount: number; excludedSuppressedCount: number; excludedFrequencyCount: number; excludedNoOptInCount: number; invalidCount?: number; costEstimate?: CostEstimate | null; total: number; sample: { type: string; name: string; address: string }[] }
// MS3: saved audience + the builder's condition vocabulary (mirrors
// the API's audience-rules module — the server validates strictly).
interface SavedAudience { id: string; name: string; definition: { entity: string; match: string; conditions: unknown[] }; createdAt: string }
interface CondRow { field: string; op: string; key: string; value: string }
interface FieldDef { field: string; label: string; ops: string[]; kind: "string" | "number" | "boolean" | "segment" | "stage" | "keyed" }
const COMMON_FIELD_DEFS: FieldDef[] = [
  { field: "source", label: "উৎস (Source)", ops: ["eq", "neq"], kind: "string" },
  { field: "created_days_ago", label: "তৈরি হয়েছে (দিন আগে)", ops: ["gte", "lte", "gt", "lt"], kind: "number" },
  { field: "has_email", label: "ইমেইল ঠিকানা আছে", ops: ["eq"], kind: "boolean" },
  { field: "has_phone", label: "ফোন নম্বর আছে", ops: ["eq"], kind: "boolean" },
  { field: "custom_field", label: "কাস্টম ফিল্ড", ops: ["eq", "contains"], kind: "keyed" },
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
  rates: { smsCostPerPartMinor: number | null; whatsappCostPerMessageMinor: number | null; emailCostPerMessageMinor: number | null };
}
interface DomainHealth { domain: string | null; source: string; spf: { status: string; record?: string; reason?: string }; dkim: { status: string; record?: string; reason?: string; selector?: string } }
const SMS_GATEWAY_OPTIONS = [
  { id: "sslwireless", label: "SSL Wireless (BD)" },
  { id: "bulksmsbd", label: "BulkSMS BD" },
  { id: "alphasms", label: "Alpha SMS (sms.net.bd)" },
];
interface MessagingSetting { frequencyCapPerDay: number; whatsappOptInRequired: boolean; linkTrackingEnabled: boolean }
interface MessagePreference { id: string; channel: string; address: string; status: string; source: string; note?: string | null; updatedAt: string }
interface RfmReport { totalCustomers: number; segments: Record<string, number>; rows: { customerId: string; name: string; recencyDays: number; frequency: number; monetaryMinor: string; segment: string; r: number; f: number; m: number }[] }
const SEGMENTS = ["champions", "loyal", "big_spenders", "at_risk", "lost", "new", "regular"];
const SEG_LABEL: Record<string, string> = { champions: "🏆 Champions", loyal: "💙 Loyal", big_spenders: "💰 Big Spenders", at_risk: "⚠️ At Risk", lost: "💤 Lost", new: "🌱 New", regular: "Regular" };
interface Delivery { id: string; address: string; status: string; providerMessageId?: string | null; error?: string | null; createdAt: string; channel?: string; deliveryStatus?: string | null; deliveredAt?: string | null; readAt?: string | null; openedAt?: string | null }
interface ProviderStatus { email: { configured: boolean; transport: string; path?: string; tenantConfigured?: boolean; platformConfigured?: boolean }; sms: { configured: boolean; provider: string; gateway?: string | null; path?: string; tenantConfigured?: boolean; platformConfigured?: boolean } }

const LEAD_STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"];

export default function MessagingPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [tplForm, setTplForm] = useState({ name: "", channel: "email", subject: "", body: "", htmlBody: "" });
  const [bcForm, setBcForm] = useState({ name: "", channel: "email", templateId: "", subject: "", body: "", htmlBody: "", audienceType: "customers", audienceStage: "qualified", audienceSegment: "at_risk", audienceSavedId: "", whatsappTemplateId: "", templateParams: "", waHeaderMediaUrl: "", waHeaderTextParams: "", waButtonRows: [] as { index: string; subType: string; value: string }[], abTest: false, abSubject: "", abBody: "", abWhatsappTemplateId: "", excludePreviousRecipients: false, scheduledAt: "", recEnabled: false, recFreq: "weekly", recInterval: "1", recWeekdays: [] as number[], recEndsAt: "" });
  // MS7: report panels + paged deliveries inside a panel.
  const [reports, setReports] = useState<Record<string, BroadcastReport>>({});
  const [pagedDlv, setPagedDlv] = useState<Record<string, { items: Delivery[]; nextCursor: string | null }>>({});
  const [dlvFilter, setDlvFilter] = useState<Record<string, { status: string; q: string }>>({});
  // MS8: journey presets + per-preset install results.
  const [journeyPresets, setJourneyPresets] = useState<JourneyPreset[]>([]);
  const [journeyResults, setJourneyResults] = useState<Record<string, string>>({});
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
  const [rateForm, setRateForm] = useState({ sms: "", whatsapp: "", email: "" });
  const [testEmailTo, setTestEmailTo] = useState("");
  const [domainHealth, setDomainHealth] = useState<DomainHealth | null>(null);
  const [preview, setPreview] = useState<BroadcastPreview | null>(null);
  const [rfm, setRfm] = useState<RfmReport | null>(null);
  const [waTemplates, setWaTemplates] = useState<WaTemplate[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  // MS1: per-row schedule inputs (datetime-local values).
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, string>>({});
  // MS10: template search (client filter over the loaded list —
  // labelled as such in the UI) + inline template edit form.
  const [tplSearch, setTplSearch] = useState("");
  const [tplEdit, setTplEdit] = useState<{ id: string; name: string; subject: string; body: string; htmlBody: string } | null>(null);
  // MS10: broadcast list — server-side search/status filters +
  // cursor pagination (the filters live in a ref too, so the
  // stable load() callback always reads the current ones).
  const [bcFilters, setBcFilters] = useState({ q: "", status: "", archived: false });
  const bcFiltersRef = useRef(bcFilters);
  const [bcNextCursor, setBcNextCursor] = useState<string | null>(null);
  const [bcEditId, setBcEditId] = useState<string | null>(null);
  const [bcEditForm, setBcEditForm] = useState({ name: "", subject: "", body: "", htmlBody: "", templateId: "", whatsappTemplateId: "", templateParams: "", scheduledAt: "" });
  // MS9: AI composer state + the deterministic suggestion cards.
  const [aiForm, setAiForm] = useState({ goal: "", productId: "", audienceHint: "", language: "bn" });
  const [aiDraft, setAiDraft] = useState<AiDraftResult | null>(null);
  const [aiSubjects, setAiSubjects] = useState<AiSubjectsResult | null>(null);
  const [sendTime, setSendTime] = useState<SendTimeSuggestion | null>(null);
  const [segmentSuggestions, setSegmentSuggestions] = useState<SegmentSuggestion[]>([]);
  // MS2: consent settings + preference list state.
  const [msgSetting, setMsgSetting] = useState<MessagingSetting>({ frequencyCapPerDay: 1, whatsappOptInRequired: false, linkTrackingEnabled: true });
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
      apiFetch<MessagingSetting>(`/organizations/${orgId}/messaging/settings`).then(setMsgSetting).catch(() => undefined);
      apiFetch<MessagePreference[]>(`/organizations/${orgId}/messaging/preferences`).then(setPreferences).catch(() => undefined);
      apiFetch<SavedAudience[]>(`/organizations/${orgId}/messaging/audiences`).then(setSavedAudiences).catch(() => undefined);
      apiFetch<JourneyPreset[]>(`/organizations/${orgId}/messaging/journey-presets`).then(setJourneyPresets).catch(() => undefined);
      apiFetch<SendTimeSuggestion>(`/organizations/${orgId}/messaging/ai/send-time`).then(setSendTime).catch(() => undefined);
      apiFetch<SegmentSuggestion[]>(`/organizations/${orgId}/messaging/ai/segment-suggestion`).then(setSegmentSuggestions).catch(() => undefined);
      apiFetch<SenderSettings>(`/organizations/${orgId}/messaging/senders`).then((ss) => {
        setSenderSettings(ss);
        setSmtpForm({ smtpHost: ss.email.smtpHost ?? "", smtpPort: String(ss.email.smtpPort ?? 587), smtpUser: ss.email.smtpUser ?? "", smtpPass: "", fromAddress: ss.email.fromAddress ?? "", fromName: ss.email.fromName ?? "", dkimSelector: ss.email.dkimSelector ?? "" });
        setSmsForm({ smsGateway: ss.sms.gateway ?? "bulksmsbd", smsApiKey: "", smsSenderId: ss.sms.smsSenderId ?? "", smsApiUrl: ss.sms.smsApiUrl ?? "" });
        setRateForm({
          sms: ss.rates.smsCostPerPartMinor !== null ? String(ss.rates.smsCostPerPartMinor / 100) : "",
          whatsapp: ss.rates.whatsappCostPerMessageMinor !== null ? String(ss.rates.whatsappCostPerMessageMinor / 100) : "",
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
    setNotice("Social Posts থেকে ক্যাপশনটি খসড়া হিসেবে বসানো হয়েছে — পাঠানোর আগে দেখে নিন।");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function wrap<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(key); setError("");
    try { return await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); return null; } finally { setBusy(""); }
  }

  // MS3: the builder rows → an API audience definition. Values
  // are converted by field kind (numbers as numbers, booleans as
  // booleans); the server validates strictly and its 400 shows
  // verbatim, so a bad row can never silently change meaning.
  function buildDefinition() {
    const defs = condEntity === "customers" ? CUSTOMER_FIELD_DEFS : LEAD_FIELD_DEFS;
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
      }),
    }));
    if (res) setPreview(res);
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
    if (r) setResult((s) => ({ ...s, [id]: r.status === "sent" ? `✅ টেস্ট পাঠানো হয়েছে (${r.address})${r.providerMessageId ? ` · Provider ID: ${r.providerMessageId}` : ""}` : `❌ ব্যর্থ: ${r.error ?? "অজানা ত্রুটি"}` }));
  }

  // MS6: Meta status badge for a WhatsApp template row. A null
  // status means the row was never verified against Meta.
  function waStatusBadge(t: WaTemplate) {
    if (!t.status) return <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">শুধু লোকাল — Meta-তে যাচাই হয়নি</span>;
    if (t.status === "APPROVED") return <span className="badge-green">✅ Meta অনুমোদিত</span>;
    if (t.status === "PENDING") return <span className="badge-amber">⏳ Meta-তে অপেক্ষমাণ</span>;
    if (t.status === "REJECTED") return <span className="badge-red">❌ Meta প্রত্যাখ্যান করেছে</span>;
    if (t.status === "NOT_ON_META") return <span className="rounded bg-slate-300 px-2 py-0.5 text-xs">Meta-তে আর নেই</span>;
    return <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">{t.status}</span>;
  }

  // MS1: one helper for every broadcast engine action; the API
  // refuses illegal transitions with an honest error, shown as-is.
  async function broadcastAction(b: Broadcast, action: string, body?: unknown, noticeText?: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await wrap(`${action}-${b.id}`, () => apiFetch<Broadcast>(`/organizations/${orgId}/messaging/broadcasts/${b.id}/${action}`, {
      method: "POST", ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }));
    if (res) { setNotice(noticeText ?? `Broadcast "${b.name}": ${action} সম্পন্ন হয়েছে।`); await load(); }
  }

  // MS2: opted_out CSV export (raw fetch — apiFetch parses JSON).
  async function exportPreferences() {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap("pref-export", async () => {
      const res = await fetch(`${API_URL}/organizations/${orgId}/messaging/preferences/export`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? "Export ব্যর্থ হয়েছে"); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "messaging-optouts.csv"; a.click();
      URL.revokeObjectURL(url);
      return true;
    });
  }

  // MS8: human-readable recurrence summary for rows + the form.
  const WEEKDAY_LABELS = ["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহস্পতি", "শুক্র", "শনি"];
  function recurrenceText(rec: Recurrence): string {
    const base = rec.freq === "daily"
      ? rec.interval > 1 ? `প্রতি ${rec.interval} দিনে` : "প্রতিদিন"
      : rec.interval > 1 ? `প্রতি ${rec.interval} সপ্তাহে` : "প্রতি সপ্তাহে";
    const days = rec.freq === "weekly" && rec.weekdays?.length ? ` (${rec.weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ")})` : "";
    const end = rec.endsAt ? ` · শেষ: ${new Date(rec.endsAt).toLocaleDateString()}` : "";
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
      if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? "Export ব্যর্থ হয়েছে"); }
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
    const r = await wrap(`journey-${p.key}`, () => apiFetch<{ workflow: { id: string; name: string }; template: { id: string; name: string } }>(`/organizations/${orgId}/messaging/journey-presets/${p.key}/install`, { method: "POST", body: JSON.stringify({}) }));
    if (r) {
      setJourneyResults((s) => ({ ...s, [p.key]: `✅ ইনস্টল হয়েছে — Workflow "${r.workflow.name}" (ID: ${r.workflow.id}) ও Template "${r.template.name}" তৈরি হয়েছে। Workflow-টি বন্ধ (disabled) অবস্থায় আছে — চালু করতে Workflows পেজে গিয়ে পর্যালোচনা করে Enable করুন।` }));
    }
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

  function applyAiVariant(v: AiDraftVariant) {
    if ((bcForm.body.trim() || bcForm.subject.trim()) && !window.confirm("বর্তমান Subject/Body বদলে এই খসড়াটি বসবে — নিশ্চিত?")) return;
    setBcForm((f) => ({ ...f, ...(v.subject !== undefined ? { subject: v.subject } : {}), body: v.body }));
    setNotice("AI খসড়াটি ফর্মে বসানো হয়েছে — পাঠানোর আগে নিজে দেখে নিন। খসড়াটি কোথাও সংরক্ষিত হয়নি।");
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
      templateParams: (b.templateParams ?? []).join(", "), scheduledAt: toLocalInput(b.scheduledAt),
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
      payload.body = bcEditForm.body;
    }
    if (b.status === "draft" || b.status === "scheduled") {
      payload.scheduledAt = bcEditForm.scheduledAt ? new Date(bcEditForm.scheduledAt).toISOString() : null;
    }
    const r = await wrap(`bc-edit-${b.id}`, () => apiFetch<Broadcast>(`/organizations/${orgId}/messaging/broadcasts/${b.id}`, { method: "PATCH", body: JSON.stringify(payload) }));
    if (r) { setBcEditId(null); setNotice(`Broadcast "${r.name}" হালনাগাদ হয়েছে।`); await load(); }
  }

  async function cloneBc(b: Broadcast) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const r = await wrap(`bc-clone-${b.id}`, () => apiFetch<Broadcast & { cloneNote?: string }>(`/organizations/${orgId}/messaging/broadcasts/${b.id}/clone`, { method: "POST" }));
    if (r) { setNotice(`কপি তৈরি হয়েছে: "${r.name}" (Draft)।${r.cloneNote ? ` ${r.cloneNote}` : ""}`); await load(); }
  }

  async function deleteBc(b: Broadcast) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`"${b.name}" স্থায়ীভাবে মুছে যাবে — নিশ্চিত?`)) return;
    const r = await wrap(`bc-delete-${b.id}`, () => apiFetch(`/organizations/${orgId}/messaging/broadcasts/${b.id}`, { method: "DELETE" }));
    if (r) { setNotice(`Broadcast "${b.name}" মুছে ফেলা হয়েছে।`); await load(); }
  }

  async function archiveBc(b: Broadcast, archived: boolean) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const r = await wrap(`bc-archive-${b.id}`, () => apiFetch(`/organizations/${orgId}/messaging/broadcasts/${b.id}/${archived ? "archive" : "unarchive"}`, { method: "POST" }));
    if (r) { setNotice(archived ? `Broadcast "${b.name}" আর্কাইভ করা হয়েছে — তালিকা থেকে লুকানো ও পাঠানো বন্ধ থাকবে।` : `Broadcast "${b.name}" আর্কাইভ থেকে ফিরিয়ে আনা হয়েছে।`); await load(); }
  }

  // MS10: template management (the API already had PATCH/DELETE;
  // duplicate goes through the existing create).
  async function duplicateTemplate(t: Template) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const r = await wrap(`tpl-dup-${t.id}`, () => apiFetch(`/organizations/${orgId}/messaging/templates`, {
      method: "POST",
      body: JSON.stringify({ name: `${t.name} (কপি)`, channel: t.channel, subject: t.channel === "email" ? (t.subject ?? undefined) : undefined, body: t.body, htmlBody: t.channel === "email" && t.htmlBody ? t.htmlBody : undefined }),
    }));
    if (r) { setNotice(`Template "${t.name}"-এর কপি তৈরি হয়েছে।`); await load(); }
  }

  async function deleteTemplateRow(t: Template) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`Template "${t.name}" স্থায়ীভাবে মুছে যাবে — নিশ্চিত?`)) return;
    const r = await wrap(`tpl-del-${t.id}`, () => apiFetch(`/organizations/${orgId}/messaging/templates/${t.id}`, { method: "DELETE" }));
    if (r) { setNotice(`Template "${t.name}" মুছে ফেলা হয়েছে।`); await load(); }
  }

  async function saveTplEdit(t: Template) {
    const orgId = getOrganizationId(); if (!orgId || !tplEdit) return;
    const r = await wrap(`tpl-edit-${t.id}`, () => apiFetch(`/organizations/${orgId}/messaging/templates/${t.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: tplEdit.name, subject: t.channel === "email" ? (tplEdit.subject || null) : undefined, body: tplEdit.body, htmlBody: t.channel === "email" ? (tplEdit.htmlBody || null) : undefined }),
    }));
    if (r) { setTplEdit(null); setNotice(`Template "${tplEdit.name}" হালনাগাদ হয়েছে।`); await load(); }
  }

  const inputCls = "input mt-1";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Messaging</h1>
        <p className="text-sm text-slate-500">Email ও SMS Broadcast — নিজের SMTP/Gateway থাকলে তা দিয়েই, নাহলে প্ল্যাটফর্মেরটি দিয়ে। কোনো বার্তা Sent ধরা হয় শুধুমাত্র Provider নিশ্চিত করলে, প্রতিটি বার্তার Delivery রেকর্ড থাকে।</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {status ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className={`rounded-xl border p-4 text-sm ${status.email.configured ? "bg-green-50" : "bg-amber-50"}`}>
            <span className="font-semibold">Email (SMTP):</span> {status.email.configured
              ? status.email.path === "tenant" ? "আপনার নিজের SMTP দিয়ে পাঠানো হবে (প্রেরক সেটিংসে দেওয়া)।" : "প্ল্যাটফর্ম SMTP দিয়ে পাঠানো হবে। নিজের SMTP বসালে সেটাই ব্যবহৃত হবে।"
              : "কনফিগার করা নেই — নিচের প্রেরক সেটিংসে নিজের SMTP বসান, অথবা প্ল্যাটফর্ম অ্যাডমিনকে SMTP কনফিগার করতে বলুন।"}
          </div>
          <div className={`rounded-xl border p-4 text-sm ${status.sms.configured ? "bg-green-50" : "bg-amber-50"}`}>
            <span className="font-semibold">SMS ({status.sms.provider}):</span> {status.sms.configured
              ? status.sms.path === "tenant" ? "আপনার নিজের Gateway দিয়ে পাঠানো হবে (প্রেরক সেটিংসে দেওয়া)।" : "প্ল্যাটফর্ম Gateway (SSL Wireless) দিয়ে পাঠানো হবে। নিজের Gateway বসালে সেটাই ব্যবহৃত হবে।"
              : "কনফিগার করা নেই — নিচের প্রেরক সেটিংসে নিজের SMS Gateway বসান, অথবা প্ল্যাটফর্ম অ্যাডমিনকে কনফিগার করতে বলুন।"}
          </div>
        </div>
      ) : null}

      <div className="space-y-3 card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">Templates ({templates.length})</div>
          <input className="input w-64 py-1 text-sm" placeholder="Template খুঁজুন (নাম/বিষয়/লেখা)" value={tplSearch} onChange={(e) => setTplSearch(e.target.value)} />
        </div>
        <p className="text-[11px] text-slate-400 -mt-1">অনুসন্ধানটি লোড করা তালিকার মধ্যেই হয় (সার্ভার অনুসন্ধান নয়) — সব Template একসঙ্গেই লোড করা থাকে।</p>
        {templates.filter((t) => { const q = tplSearch.trim().toLowerCase(); if (!q) return true; return [t.name, t.subject ?? "", t.body].join(" ").toLowerCase().includes(q); }).map((t) => (
          <div key={t.id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex items-center justify-between"><span className="font-medium">{t.name}</span><span className="flex gap-1"><span className="rounded bg-slate-200 px-2 py-0.5 text-xs capitalize">{t.channel}</span>{t.htmlBody ? <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">HTML আছে</span> : null}</span></div>
            {t.subject ? <div className="text-slate-600">Subject: {t.subject}</div> : null}
            <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{t.body}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
              <input className="input w-64" placeholder={t.channel === "email" ? "টেস্ট পাঠানোর ইমেইল" : "টেস্ট পাঠানোর ফোন নম্বর"} value={tplTestInputs[t.id] ?? ""} onChange={(e) => setTplTestInputs((s) => ({ ...s, [t.id]: e.target.value }))} />
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !(tplTestInputs[t.id] ?? "").trim()} onClick={() => runTestSend("template", t.id, tplTestInputs[t.id] ?? "")}>{busy === `test-template-${t.id}` ? "পাঠানো হচ্ছে..." : "🧪 টেস্ট পাঠান"}</button>
              {tplTestResults[t.id] ? <span className="text-xs">{tplTestResults[t.id]}</span> : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => setTplEdit(tplEdit?.id === t.id ? null : { id: t.id, name: t.name, subject: t.subject ?? "", body: t.body, htmlBody: t.htmlBody ?? "" })}>{tplEdit?.id === t.id ? "সম্পাদনা বন্ধ করুন" : "✏️ সম্পাদনা"}</button>
              <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => duplicateTemplate(t)}>📄 কপি (Duplicate)</button>
              <button type="button" className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => deleteTemplateRow(t)}>মুছুন</button>
              <span className="text-[11px] text-slate-400">মুছতে OWNER/ADMIN ভূমিকা লাগে — অন্য ভূমিকায় সার্ভারের ত্রুটিই দেখানো হবে।</span>
            </div>
            {tplEdit?.id === t.id ? (
              <div className="mt-2 grid gap-2 rounded-lg border bg-white p-3">
                <label className="block text-sm">নাম<input className={inputCls} value={tplEdit.name} onChange={(e) => setTplEdit({ ...tplEdit, name: e.target.value })} /></label>
                {t.channel === "email" ? <label className="block text-sm">Subject<input className={inputCls} value={tplEdit.subject} onChange={(e) => setTplEdit({ ...tplEdit, subject: e.target.value })} /></label> : null}
                <label className="block text-sm">Body (Text)<textarea className={inputCls} rows={3} value={tplEdit.body} onChange={(e) => setTplEdit({ ...tplEdit, body: e.target.value })} /></label>
                {t.channel === "email" ? <label className="block text-sm">HTML Body (ঐচ্ছিক — খালি রাখলে HTML অংশ থাকবে না)<textarea className={inputCls} rows={3} value={tplEdit.htmlBody} onChange={(e) => setTplEdit({ ...tplEdit, htmlBody: e.target.value })} /></label> : null}
                <div className="flex gap-2">
                  <button type="button" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => saveTplEdit(t)}>{busy === `tpl-edit-${t.id}` ? "সংরক্ষণ হচ্ছে..." : "সংরক্ষণ করুন"}</button>
                  <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={() => setTplEdit(null)}>বাতিল</button>
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
          <label className="block text-sm">Template এর নাম<input className={inputCls} value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} required /></label>
          <label className="block text-sm">Channel
            <select className={inputCls} value={tplForm.channel} onChange={(e) => setTplForm({ ...tplForm, channel: e.target.value })}>
              <option value="email">Email</option><option value="sms">SMS</option>
            </select>
          </label>
          {tplForm.channel === "email" ? <label className="block text-sm lg:col-span-2">Subject<input className={inputCls} value={tplForm.subject} onChange={(e) => setTplForm({ ...tplForm, subject: e.target.value })} required /></label> : null}
          <label className="block text-sm lg:col-span-2">Body (Text) — Broadcast-এ &#123;&#123;name&#125;&#125;, &#123;&#123;lastOrderNumber&#125;&#125; এর মতো Variable আসল মানে নিয়ে বসে (নিচের Broadcast ফর্মে পুরো তালিকা আছে); Workflow-তে ইভেন্টের তথ্য অনুযায়ী মেলে<textarea className={inputCls} rows={3} value={tplForm.body} onChange={(e) => setTplForm({ ...tplForm, body: e.target.value })} required /></label>
          {tplForm.channel === "email" ? (<>
            <label className="block text-sm lg:col-span-2">HTML Body (ঐচ্ছিক) — দিলে ইমেইল HTML হিসেবে যাবে (Text Body Fallback থাকবেই); HTML যেমন লিখবেন তেমনই পাঠানো হয়, তাই শুধু নিজের বিশ্বস্ত HTML বসান<textarea className={inputCls} rows={4} value={tplForm.htmlBody} onChange={(e) => setTplForm({ ...tplForm, htmlBody: e.target.value })} placeholder="<p>হ্যালো {{name}}, ...</p>" /></label>
            {tplForm.htmlBody ? <div className="lg:col-span-2">
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={() => setTplHtmlPreview((v) => !v)}>{tplHtmlPreview ? "প্রিভিউ লুকান" : "👁️ HTML প্রিভিউ (Sandbox)"}</button>
              {tplHtmlPreview ? <iframe title="Template HTML প্রিভিউ" sandbox="" srcDoc={tplForm.htmlBody} className="mt-2 h-64 w-full rounded-lg border bg-white" /> : null}
              <p className="mt-1 text-[11px] text-slate-400">প্রিভিউ Sandbox-এ চলে — কোনো Script চলবে না। Variable (&#123;&#123;...&#125;&#125;) প্রিভিউতে যেমন আছে তেমনই দেখায়; পাঠানোর সময় আসল মানে বসে।</p>
            </div> : null}
          </>) : null}
          <button className="self-end btn-primary disabled:opacity-50" disabled={busy !== ""}>Template তৈরি করুন</button>
        </form>
      </div>

      <div className="space-y-3 card p-5">
        <div className="card space-y-3">
          <h2 className="font-semibold">📊 RFM Segments (আসল অর্ডার থেকে)</h2>
          {rfm ? (<>
            <div className="flex flex-wrap gap-2">
              {SEGMENTS.map((s) => <span key={s} className="badge-indigo">{SEG_LABEL[s]}: {rfm.segments[s] ?? 0}</span>)}
              <span className="badge-slate">মোট সক্রিয় কাস্টমার: {rfm.totalCustomers}</span>
            </div>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">কাস্টমার</th><th className="px-3 py-2">শেষ অর্ডার</th><th className="px-3 py-2">অর্ডার</th><th className="px-3 py-2">মোট কেনা</th><th className="px-3 py-2">Segment</th></tr></thead>
                <tbody>{rfm.rows.slice(0, 8).map((r) => (
                  <tr key={r.customerId} className="border-t"><td className="px-3 py-2 font-medium">{r.name}</td><td className="px-3 py-2">{r.recencyDays} দিন আগে</td><td className="px-3 py-2">{r.frequency}টি</td><td className="px-3 py-2">৳{(Number(r.monetaryMinor) / 100).toLocaleString("en-IN")}</td><td className="px-3 py-2">{SEG_LABEL[r.segment] ?? r.segment} (R{r.r} F{r.f} M{r.m})</td></tr>
                ))}</tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400">স্কোর ১–৫ আপনার নিজের কাস্টমার বেসের আপেক্ষিক (quintile)। বাতিল অর্ডার হিসাবের বাইরে।</p>
          </>) : <p className="text-sm text-slate-400">লোড হচ্ছে...</p>}
        </div>
        <div className="font-semibold">Broadcasts ({broadcasts.length}টি লোড হয়েছে)</div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3">
          <input className="input w-56 py-1 text-sm" placeholder="নাম দিয়ে খুঁজুন (সার্ভার অনুসন্ধান)" value={bcFilters.q} onChange={(e) => setBcFilters((f) => ({ ...f, q: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") applyBcFilters({ q: bcFilters.q }); }} />
          <select className="input w-auto py-1 text-sm" value={bcFilters.status} onChange={(e) => applyBcFilters({ status: e.target.value })}>
            <option value="">সব অবস্থা</option>
            <option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="sending">Sending</option>
            <option value="paused">Paused</option><option value="sent">Sent</option><option value="partial">Partial</option>
            <option value="failed">Failed</option><option value="cancelled">Cancelled</option>
          </select>
          <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => applyBcFilters({ q: bcFilters.q })}>খুঁজুন</button>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={bcFilters.archived} onChange={(e) => applyBcFilters({ archived: e.target.checked })} /> আর্কাইভ করা Broadcast দেখুন</label>
          <span className="text-[11px] text-slate-400">খোঁজ ও ফিল্টার সার্ভারেই হয় — প্রতিটি পেজে ৫০টি করে আসে।</span>
        </div>
        {broadcasts.length === 0 ? <EmptyState title="কোনো Broadcast নেই" description="নিচের ফর্মে প্রথম Broadcast তৈরি করুন। পাঠানো হবে শুধু Send বাটনে ক্লিক করলে।" /> : broadcasts.map((b) => (
          <div key={b.id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><span className="font-medium">{b.name}</span> <span className="text-slate-400 capitalize">({b.channel})</span>
                <div className="text-xs text-slate-500">Audience: {b.audienceType === "custom" ? "Custom শর্ত" : b.audienceType === "csv" ? "CSV তালিকা" : b.audienceType === "saved" ? `Saved: ${savedAudiences.find((s) => s.id === b.audienceSavedId)?.name ?? "(মুছে ফেলা হয়েছে)"}` : b.audienceType}{b.audienceStage ? ` (${b.audienceStage})` : ""}{b.audienceSegment ? ` (${SEG_LABEL[b.audienceSegment] ?? b.audienceSegment})` : ""}{b.abVariant ? ` · 🧪 Variant ${b.abVariant}` : ""}{b.excludePreviousRecipients ? " · আগের প্রাপক বাদ দেওয়া" : ""} · অবস্থা: {b.status}{b.archivedAt ? " · 🗄️ আর্কাইভ করা (পাঠানো/শিডিউল বন্ধ)" : ""}{b.sentAt ? ` · ${new Date(b.sentAt).toLocaleString()}` : ""} · মোট {b.totalRecipients}, Sent {b.sentCount}, Failed {b.failedCount}</div>
                {b.scheduledAt ? <div className="text-xs text-slate-500">🗓️ শিডিউল: {new Date(b.scheduledAt).toLocaleString()}{b.status === "scheduled" ? " — সময় হলে Broadcast Send Sweep Job পাঠাবে (Automations-এ Jobটি চালু থাকতে হবে)" : ""}</div> : null}
                {b.recurrenceGroupId ? <div className="text-xs text-slate-500">🔁 পুনরাবৃত্তি গ্রুপ{b.recurrence ? `: ${recurrenceText(b.recurrence)} — এই ধারার পরের Broadcastটি এই Row-তেই নির্ধারিত; পাঠানো শেষ হলে পরেরটি নিজে থেকে তৈরি হবে` : " — এই ধারার আগের Broadcast থেকে এসেছে (পরের ধাপটি নির্ধারিত Row-তে)"}</div> : null}
                {b.progress ? <div className="text-xs text-slate-500">অগ্রগতি: মোট {b.progress.total} · Sent {b.progress.sent} · Failed {b.progress.failed} · Skipped {b.progress.skipped} · বাকি {b.progress.pending}</div> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="rounded-lg border px-3 py-1.5" onClick={async () => { const o = getOrganizationId(); if (!o) return; const d = await wrap(`dlv-${b.id}`, () => apiFetch<Delivery[]>(`/organizations/${o}/messaging/broadcasts/${b.id}/deliveries`)); if (d) setDeliveries((s) => ({ ...s, [b.id]: d })); }}>Deliveries</button>
                <button className="rounded-lg border px-3 py-1.5" onClick={() => toggleReport(b)}>{reports[b.id] ? "📊 রিপোর্ট লুকান" : "📊 রিপোর্ট"}</button>
                {b.status === "draft" ? <button className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap(`send-${b.id}`, () => apiFetch<Broadcast>(`/organizations/${o}/messaging/broadcasts/${b.id}/send`, { method: "POST" })); if (r) { setNotice(`Broadcast "${r.name}": ${r.progress?.sent ?? r.sentCount}টি Sent, ${r.progress?.failed ?? r.failedCount}টি Failed, ${r.progress?.skipped ?? 0}টি Skipped।`); await load(); } }}>{busy === `send-${b.id}` ? "পাঠানো হচ্ছে..." : "Send করুন"}</button> : null}
                {b.status === "scheduled" ? <>
                  <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => broadcastAction(b, "schedule", { scheduledAt: null }, `Broadcast "${b.name}": শিডিউল বাতিল হয়েছে, আবার Draft অবস্থায় আছে।`)}>শিডিউল বাতিল</button>
                  <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => broadcastAction(b, "pause", undefined, `Broadcast "${b.name}" Pause করা হয়েছে।`)}>Pause</button>
                </> : null}
                {b.status === "sending" ? <>
                  <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => broadcastAction(b, "pause", undefined, `Broadcast "${b.name}" Pause করা হয়েছে — চলমান অংশ (chunk) শেষ হলেই থামবে।`)}>Pause</button>
                </> : null}
                {b.status === "paused" ? <button className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => broadcastAction(b, "resume", undefined, `Broadcast "${b.name}" আবার চালু হয়েছে।`)}>Resume</button> : null}
                {(["sent", "partial", "failed"].includes(b.status) && (b.progress?.failed ?? b.failedCount) > 0) ? <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => broadcastAction(b, "retry-failed", undefined, `Broadcast "${b.name}": ব্যর্থ প্রাপকদের আবার পাঠানো হয়েছে।`)}>ব্যর্থগুলো আবার পাঠান ({b.progress?.failed ?? b.failedCount})</button> : null}
                {(["draft", "scheduled", "paused", "sending"].includes(b.status)) ? <button className="rounded-lg border border-red-300 px-3 py-1.5 text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => broadcastAction(b, "cancel", undefined, `Broadcast "${b.name}" বাতিল করা হয়েছে — এটি আর পাঠানো যাবে না।`)}>বাতিল করুন</button> : null}
                {(["draft", "scheduled", "paused"].includes(b.status) && !b.archivedAt) ? <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => (bcEditId === b.id ? setBcEditId(null) : startBcEdit(b))}>{bcEditId === b.id ? "সম্পাদনা বন্ধ করুন" : "✏️ সম্পাদনা"}</button> : null}
                <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => cloneBc(b)}>📄 কপি</button>
                {b.archivedAt
                  ? <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => archiveBc(b, false)}>আনআর্কাইভ</button>
                  : <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => archiveBc(b, true)}>🗄️ আর্কাইভ</button>}
                {(["draft", "cancelled"].includes(b.status)) ? <button className="rounded-lg border border-red-300 px-3 py-1.5 text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => deleteBc(b)}>মুছুন</button> : null}
              </div>
            </div>
            {b.status === "draft" ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input type="datetime-local" className="input w-auto" value={scheduleInputs[b.id] ?? ""} onChange={(e) => setScheduleInputs((s) => ({ ...s, [b.id]: e.target.value }))} />
                <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !(scheduleInputs[b.id] ?? "")} onClick={() => broadcastAction(b, "schedule", { scheduledAt: new Date(scheduleInputs[b.id]).toISOString() }, `Broadcast "${b.name}" শিডিউল করা হয়েছে।`)}>🗓️ শিডিউল করুন</button>
                <span className="text-[11px] text-slate-400">শিডিউল অনুযায়ী পাঠাতে Automations-এ Broadcast Send Sweep Job চালু থাকতে হবে।</span>
              </div>
            ) : null}
            {bcEditId === b.id ? (
              <div className="mt-2 grid gap-2 rounded-lg border bg-white p-3">
                <div className="text-xs font-semibold">✏️ Broadcast সম্পাদনা — অবস্থা: {b.status}</div>
                {b.status === "paused" ? <p className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">⚠️ এই Broadcast-টি Pause অবস্থায় আছে। লেখা পাঠানোর মুহূর্তে Broadcast Row থেকেই নেওয়া হয় — তাই Subject/Body বদলালে বাকি (এখনো পাঠানো হয়নি) প্রাপকদের কাছে নতুন লেখাটাই যাবে; যাদের কাছে ইতিমধ্যে গেছে, তাদেরটা বদলাবে না।</p> : null}
                <label className="block text-sm">নাম<input className={inputCls} value={bcEditForm.name} onChange={(e) => setBcEditForm({ ...bcEditForm, name: e.target.value })} /></label>
                {b.channel === "whatsapp" ? (<>
                  <label className="block text-sm">WhatsApp Template
                    <select className={inputCls} value={bcEditForm.whatsappTemplateId} onChange={(e) => setBcEditForm({ ...bcEditForm, whatsappTemplateId: e.target.value })}>
                      <option value="">আগেরটাই থাক</option>
                      {waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
                    </select>
                  </label>
                  <label className="block text-sm">Template প্যারামিটার (কমা দিয়ে)<input className={inputCls} value={bcEditForm.templateParams} onChange={(e) => setBcEditForm({ ...bcEditForm, templateParams: e.target.value })} /></label>
                  <p className="text-[11px] text-slate-400">WhatsApp-এর লেখা Template থেকেই আসে — Template বদলালে Broadcast-এর সংরক্ষিত Body-ও নতুন Template অনুযায়ী বদলে যাবে।</p>
                </>) : (<>
                  <label className="block text-sm">Template (ঐচ্ছিক — বেছে নিলে লিংক হিসেবে যুক্ত হয়; লেখা নিচের Subject/Body থেকেই যাবে)
                    <select className={inputCls} value={bcEditForm.templateId} onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); setBcEditForm({ ...bcEditForm, templateId: e.target.value, ...(t ? { subject: t.subject ?? bcEditForm.subject, body: t.body, htmlBody: t.htmlBody ?? "" } : {}) }); }}>
                      <option value="">কোনো Template নয়</option>
                      {templates.filter((t) => t.channel === b.channel).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                  {b.channel === "email" ? <label className="block text-sm">Subject<input className={inputCls} value={bcEditForm.subject} onChange={(e) => setBcEditForm({ ...bcEditForm, subject: e.target.value })} /></label> : null}
                  <label className="block text-sm">Body<textarea className={inputCls} rows={3} value={bcEditForm.body} onChange={(e) => setBcEditForm({ ...bcEditForm, body: e.target.value })} /></label>
                  {b.channel === "email" ? <label className="block text-sm">HTML Body (ঐচ্ছিক — খালি রাখলে HTML অংশ থাকবে না)<textarea className={inputCls} rows={3} value={bcEditForm.htmlBody} onChange={(e) => setBcEditForm({ ...bcEditForm, htmlBody: e.target.value })} /></label> : null}
                </>)}
                {(b.status === "draft" || b.status === "scheduled") ? <label className="block text-sm">শিডিউল (খালি রাখলে Schedule থাকবে না / Draft হবে)<input type="datetime-local" className={inputCls} value={bcEditForm.scheduledAt} onChange={(e) => setBcEditForm({ ...bcEditForm, scheduledAt: e.target.value })} /></label> : null}
                <div className="flex gap-2">
                  <button type="button" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => saveBcEdit(b)}>{busy === `bc-edit-${b.id}` ? "সংরক্ষণ হচ্ছে..." : "সংরক্ষণ করুন"}</button>
                  <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={() => setBcEditId(null)}>বাতিল</button>
                </div>
              </div>
            ) : null}
            {(deliveries[b.id] ?? []).map((d) => (
              <div key={d.id} className="mt-1 flex items-center justify-between rounded bg-white px-2 py-1 text-xs">
                <span>{d.address} · {new Date(d.createdAt).toLocaleString()}</span>
                <span className={d.status === "sent" ? "text-green-600" : "text-red-600"}>{d.status}{d.providerMessageId ? ` · ${d.providerMessageId}` : ""}{d.error ? ` · ${d.error}` : ""}</span>
              </div>
            ))}
            {reports[b.id] ? (() => { const report = reports[b.id]; const f = report.funnel; const cells: [string, number | null][] = [
              ["দর্শক (Audience)", f.audience], ["পাঠানো হয়েছে", f.sent], ["ব্যর্থ", f.failed], ["বাদ (Skipped)", f.skipped],
              ["পৌঁছেছে (Delivered)", f.delivered], ["পড়া হয়েছে (Read)", f.read],
              ["খোলা হয়েছে (Opened — শুধু HTML ইমেইলে)", f.opened],
              ["ক্লিক করেছেন (জন)", f.clickedRecipients], ["মোট ক্লিক", f.totalClicks],
            ]; return (
              <div className="mt-3 space-y-3 rounded-lg border bg-slate-100 p-3">
                <div className="font-medium">📊 Broadcast রিপোর্ট</div>
                <div className="grid grid-cols-3 gap-2 lg:grid-cols-5">
                  {cells.map(([label, value]) => (
                    <div key={label} className="rounded bg-white p-2 text-center">
                      <div className="text-base font-semibold">{value === null ? "—" : value}</div>
                      <div className="text-[11px] text-slate-500">{label}{value === null ? " · এই চ্যানেলে পাওয়া যায় না" : ""}</div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">
                  {b.channel === "email" ? "ইমেইলে Delivered/Read পাওয়া যায় না — SMTP-তে ডেলিভারির কোনো সংকেত নেই (তাই ০ না দেখিয়ে ফাঁকা রাখা হয়েছে)। Opened শুধু HTML ইমেইলের পিক্সেল থেকে আসে।" : null}
                  {b.channel === "sms" ? "SMS-এ Delivered/Read পাওয়া যায় না — SSL Wireless-এর কোনো নথিভুক্ত DLR (ডেলিভারি রিপোর্ট) API নেই, তাই ধাপগুলো ফাঁকা রাখা হয়েছে (অনুমান করে সংখ্যা বসানো হয়নি)। Tenant Gateway-এর DLR-ও এই রিপোর্টের বাইরে।" : null}
                  {b.channel === "whatsapp" ? "Delivered/Read আসে Meta-র Webhook থেকে। WhatsApp-এ ক্লিক ট্র্যাকিং হয় না — Template-এর লিংক Meta-র দিকে থাকে, তাই ক্লিক ফাঁকা।" : null}
                </p>
                {report.failureReasons.length ? (
                  <div>
                    <div className="text-xs font-semibold">ব্যর্থতার কারণ (Provider-এর ত্রুটি গোষ্ঠীভুক্ত)</div>
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                      {report.failureReasons.map((r) => <li key={r.reason}>• {r.reason} — {r.count}টি</li>)}
                    </ul>
                  </div>
                ) : null}
                {report.ab ? (
                  <div className="rounded bg-white p-2 text-xs">
                    <div className="font-semibold">🧪 A/B তুলনা</div>
                    <div className="mt-1 grid gap-2 sm:grid-cols-2">
                      {(["A", "B"] as const).map((v) => report.ab!.variants[v] ? (
                        <div key={v} className="rounded bg-slate-50 p-2">
                          <div className="font-medium">Variant {v}</div>
                          <div>পাঠানো: {report.ab!.variants[v].sent} · ব্যর্থ: {report.ab!.variants[v].failed} · Delivered: {report.ab!.variants[v].delivered ?? "—"} · Read: {report.ab!.variants[v].read ?? "—"} · Opened: {report.ab!.variants[v].opened ?? "—"} · ক্লিক (জন): {report.ab!.variants[v].clickedRecipients ?? "—"}</div>
                        </div>
                      ) : null)}
                    </div>
                    <p className="mt-2 text-slate-600">💡 পরামর্শ: {report.ab.suggestion.leader ? `Variant ${report.ab.suggestion.leader} এগিয়ে। ` : ""}{report.ab.suggestion.note}</p>
                  </div>
                ) : null}
                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded bg-white p-2">
                    <div className="font-semibold">💰 আয়ের সম্পর্ক</div>
                    {report.revenue ? <div className="mt-1">৭ দিনে অর্ডার: <strong>{report.revenue.orders}</strong>টি · মোট: <strong>৳{(Number(report.revenue.totalMinor) / 100).toFixed(2)}</strong> ({report.revenue.customerRecipients} জন প্রাপক কাস্টমারের মধ্যে)<div className="mt-1 text-slate-500">{report.revenue.method}</div></div>
                      : <div className="mt-1 text-slate-500">এখনো পাঠানো হয়নি — আয়ের হিসাবের উইন্ডো নেই।</div>}
                  </div>
                  <div className="rounded bg-white p-2">
                    <div className="font-semibold">💬 জবাব (Replies)</div>
                    <div className="mt-1">{report.replies === null ? "এই চ্যানেলে পাওয়া যায় না।" : <><strong>{report.replies}</strong>টি কথোপকথনে জবাব এসেছে।</>}<div className="mt-1 text-slate-500">{report.repliesMethod}</div></div>
                  </div>
                </div>
                <div className="rounded bg-white p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold">ডেলিভারি তালিকা</span>
                    <select className="input w-auto py-1 text-xs" value={(dlvFilter[b.id] ?? { status: "", q: "" }).status} onChange={(e) => setDlvFilter((s) => ({ ...s, [b.id]: { ...(s[b.id] ?? { status: "", q: "" }), status: e.target.value } }))}>
                      <option value="">সব অবস্থা</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="skipped">Skipped</option>
                    </select>
                    <input className="input w-52 py-1 text-xs" placeholder="ঠিকানা খুঁজুন (ইমেইল/ফোন)" value={(dlvFilter[b.id] ?? { status: "", q: "" }).q} onChange={(e) => setDlvFilter((s) => ({ ...s, [b.id]: { ...(s[b.id] ?? { status: "", q: "" }), q: e.target.value } }))} />
                    <button type="button" className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => loadPagedDeliveries(b.id, true)}>খুঁজুন</button>
                    <button type="button" className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => exportDeliveries(b.id)}>⬇️ CSV Export</button>
                    <span className="text-[11px] text-slate-400">সর্বোচ্চ ১০,০০০ রেকর্ড; বেশি থাকলে ফাইলের প্রথম লাইনে সতর্কতা থাকে। Export Audit Log-এ লেখা হয়।</span>
                  </div>
                  {(pagedDlv[b.id]?.items ?? []).map((d) => (
                    <div key={d.id} className="mt-1 flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-xs">
                      <span>{d.address} · {new Date(d.createdAt).toLocaleString()}</span>
                      <span className={d.status === "sent" ? "text-green-600" : "text-red-600"}>{d.status}{d.deliveryStatus ? ` · ${d.deliveryStatus}` : ""}{d.openedAt ? " · opened" : ""}{d.providerMessageId ? ` · ${d.providerMessageId}` : ""}{d.error ? ` · ${d.error}` : ""}</span>
                    </div>
                  ))}
                  {(pagedDlv[b.id]?.items ?? []).length === 0 ? <p className="mt-1 text-xs text-slate-400">কোনো ডেলিভারি পাওয়া যায়নি।</p> : null}
                  {pagedDlv[b.id]?.nextCursor ? <button type="button" className="mt-2 rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => loadPagedDeliveries(b.id, false)}>আরও দেখুন (পরের ৫০টি)</button> : null}
                </div>
              </div>
            ); })() : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
              <input className="input w-64" placeholder={b.channel === "email" ? "টেস্ট পাঠানোর ইমেইল" : "টেস্ট পাঠানোর ফোন নম্বর"} value={bcTestInputs[b.id] ?? ""} onChange={(e) => setBcTestInputs((s) => ({ ...s, [b.id]: e.target.value }))} />
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !(bcTestInputs[b.id] ?? "").trim()} onClick={() => runTestSend("broadcast", b.id, bcTestInputs[b.id] ?? "")}>{busy === `test-broadcast-${b.id}` ? "পাঠানো হচ্ছে..." : "🧪 টেস্ট পাঠান"}</button>
              <span className="text-[11px] text-slate-400">টেস্ট পাঠানো Broadcast-এর গণনা/অবস্থা বদলায় না — শুধু একটি &quot;test&quot; Delivery রেকর্ড হয়।</span>
              {bcTestResults[b.id] ? <span className="text-xs">{bcTestResults[b.id]}</span> : null}
            </div>
          </div>
        ))}
        {bcNextCursor ? <button type="button" className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => loadBroadcastList(false, bcNextCursor)}>আরও Broadcast দেখুন (পরের ৫০টি)</button> : null}
        {(sendTime || segmentSuggestions.length > 0) ? (
          <div className="grid gap-3 border-t pt-3 lg:grid-cols-2">
            {sendTime ? (
              <div className="rounded-lg bg-indigo-50 p-3 text-sm">
                <div className="font-medium">🕐 পাঠানোর সময়ের পরামর্শ (নিজের ডেটা থেকে)</div>
                {sendTime.available ? (<>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {(sendTime.bestHours ?? []).map((h) => <span key={h.hour} className="badge-indigo">{h.hour}:00–{(h.hour + 1) % 24}:00 (ঢাকা) · {h.events}টি সাড়া</span>)}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{sendTime.method}</p>
                </>) : <p className="mt-1 text-slate-600">{sendTime.reason}</p>}
              </div>
            ) : null}
            {segmentSuggestions.length > 0 ? (
              <div className="rounded-lg bg-emerald-50 p-3 text-sm">
                <div className="font-medium">🎯 Audience পরামর্শ (আসল RFM হিসাব থেকে)</div>
                <ul className="mt-1 space-y-2">
                  {segmentSuggestions.map((s) => (
                    <li key={s.kind} className="flex flex-wrap items-start justify-between gap-2">
                      <span className="text-slate-700">{s.reason}</span>
                      {s.audienceType === "segment" && s.audienceSegment ? <button type="button" className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold" onClick={() => { setBcForm((f) => ({ ...f, audienceType: "segment", audienceSegment: s.audienceSegment as string })); setNotice(`Audience হিসেবে "${SEG_LABEL[s.audienceSegment as string] ?? s.audienceSegment}" Segment বেছে দেওয়া হয়েছে — নিচের ফর্মে দেখে নিয়ে তৈরি করুন।`); }}>এই Segment বেছে নিন</button> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
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
          const res = await wrap("bc", () => apiFetch(`/organizations/${orgId}/messaging/broadcasts`, {
            method: "POST",
            body: JSON.stringify(bcForm.channel === "whatsapp"
              ? { name: bcForm.name, channel: "whatsapp", whatsappTemplateId: bcForm.whatsappTemplateId, templateParams: bcForm.templateParams ? bcForm.templateParams.split(",").map((x) => x.trim()) : [], templateComponents: waComponents, ...audienceFields(), abTest: bcForm.abTest || undefined, abWhatsappTemplateId: bcForm.abTest ? bcForm.abWhatsappTemplateId : undefined, excludePreviousRecipients: bcForm.excludePreviousRecipients || undefined, scheduledAt: bcForm.scheduledAt ? new Date(bcForm.scheduledAt).toISOString() : undefined, recurrence }
              : { name: bcForm.name, channel: bcForm.channel, templateId: bcForm.templateId || undefined, subject: bcForm.templateId ? undefined : (bcForm.subject || undefined), body: bcForm.templateId ? undefined : bcForm.body, htmlBody: !bcForm.templateId && bcForm.channel === "email" && bcForm.htmlBody ? bcForm.htmlBody : undefined, ...audienceFields(), abTest: bcForm.abTest || undefined, abSubject: bcForm.abTest ? (bcForm.abSubject || undefined) : undefined, abBody: bcForm.abTest ? bcForm.abBody : undefined, excludePreviousRecipients: bcForm.excludePreviousRecipients || undefined, scheduledAt: bcForm.scheduledAt ? new Date(bcForm.scheduledAt).toISOString() : undefined, recurrence }),
          }));
          if (res) { setBcForm({ name: "", channel: "email", templateId: "", subject: "", body: "", htmlBody: "", audienceType: "customers", audienceStage: "qualified", audienceSegment: "at_risk", audienceSavedId: "", whatsappTemplateId: "", templateParams: "", waHeaderMediaUrl: "", waHeaderTextParams: "", waButtonRows: [], abTest: false, abSubject: "", abBody: "", abWhatsappTemplateId: "", excludePreviousRecipients: false, scheduledAt: "", recEnabled: false, recFreq: "weekly", recInterval: "1", recWeekdays: [], recEndsAt: "" }); setCsvText(""); setPreview(null); setNotice((res as { variants?: unknown[] }).variants ? "A/B Broadcast তৈরি হয়েছে — দুটি (A ও B) পাঠানোর জন্য প্রস্তুত।" : bcForm.scheduledAt ? "Broadcast শিডিউল করা হয়েছে — সময় হলে Sweep Job পাঠাবে।" : "Broadcast Draft তৈরি হয়েছে।"); await load(); }
        }}>
          <label className="block text-sm">নাম<input className={inputCls} value={bcForm.name} onChange={(e) => setBcForm({ ...bcForm, name: e.target.value })} required /></label>
          <label className="block text-sm">Channel
            <select className={inputCls} value={bcForm.channel} onChange={(e) => setBcForm({ ...bcForm, channel: e.target.value, templateId: "" })}>
              <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp (Template)</option>
            </select>
          </label>
          {bcForm.channel === "whatsapp" ? (<>
            <label className="block text-sm">WhatsApp Template
              <select className={inputCls} value={bcForm.whatsappTemplateId} onChange={(e) => setBcForm({ ...bcForm, whatsappTemplateId: e.target.value })} required>
                <option value="">বেছে নিন</option>
                {waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
              </select>
            </label>
            <label className="block text-sm">Template প্যারামিটার (কমা দিয়ে, {"{name}"} ব্যবহার করা যায়)
              <input className={inputCls} value={bcForm.templateParams} onChange={(e) => setBcForm({ ...bcForm, templateParams: e.target.value })} placeholder="যেমন: {name}, ঈদ" />
            </label>
            <label className="block text-sm">Header Media URL (ঐচ্ছিক — Template-এ ছবির Header থাকলে; ছবি হিসেবেই পাঠানো হয়)
              <input className={inputCls} value={bcForm.waHeaderMediaUrl} onChange={(e) => setBcForm({ ...bcForm, waHeaderMediaUrl: e.target.value })} placeholder="https://.../image.jpg" />
            </label>
            <label className="block text-sm">Header Text প্যারামিটার (ঐচ্ছিক, কমা দিয়ে — Template-এর Header-এ &#123;&#123;1&#125;&#125; থাকলে)
              <input className={inputCls} value={bcForm.waHeaderTextParams} onChange={(e) => setBcForm({ ...bcForm, waHeaderTextParams: e.target.value })} placeholder="যেমন: {name}" />
            </label>
            <div className="space-y-2 lg:col-span-3 rounded-lg bg-slate-50 p-3">
              <div className="text-sm font-medium">বাটন প্যারামিটার (ঐচ্ছিক — Template-এর বাটনে Variable থাকলেই লাগে)</div>
              {bcForm.waButtonRows.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="flex items-center gap-1">Index <input type="number" min={0} className="input w-20" value={row.index} onChange={(e) => setBcForm({ ...bcForm, waButtonRows: bcForm.waButtonRows.map((r, j) => j === i ? { ...r, index: e.target.value } : r) })} /></label>
                  <select className="input w-auto" value={row.subType} onChange={(e) => setBcForm({ ...bcForm, waButtonRows: bcForm.waButtonRows.map((r, j) => j === i ? { ...r, subType: e.target.value } : r) })}>
                    <option value="url">URL বাটন (Suffix)</option><option value="quick_reply">Quick Reply (Payload)</option>
                  </select>
                  <input className="input w-64" value={row.value} onChange={(e) => setBcForm({ ...bcForm, waButtonRows: bcForm.waButtonRows.map((r, j) => j === i ? { ...r, value: e.target.value } : r) })} placeholder={row.subType === "url" ? "URL-এর শেষ অংশ (যেমন অফারের কোড)" : "Payload (যেমন ORDER_STATUS)"} />
                  <button type="button" className="rounded-lg border px-2 py-1 text-xs" onClick={() => setBcForm({ ...bcForm, waButtonRows: bcForm.waButtonRows.filter((_, j) => j !== i) })}>সরান</button>
                </div>
              ))}
              <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40" disabled={bcForm.waButtonRows.length >= 10} onClick={() => setBcForm({ ...bcForm, waButtonRows: [...bcForm.waButtonRows, { index: String(bcForm.waButtonRows.length), subType: "url", value: "" }] })}>+ বাটন প্যারামিটার যোগ করুন</button>
              <p className="text-[11px] text-slate-400">URL বাটনে শুধু বাটনের URL-এর বদলি অংশ (suffix) যায় — পুরো URL Template-এই থাকে। মানগুলোতে {"{name}"} জাতীয় Variable চলবে।</p>
            </div>
          </>) : (<>
          <label className="block text-sm">Template (ঐচ্ছিক)
            <select className={inputCls} value={bcForm.templateId} onChange={(e) => setBcForm({ ...bcForm, templateId: e.target.value })}>
              <option value="">নিজে লিখব</option>
              {templates.filter((t) => t.channel === bcForm.channel).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          </>)}
          {bcForm.channel !== "whatsapp" && !bcForm.templateId && bcForm.channel === "email" ? (
            <div className="text-sm">
              <label className="block">Subject<input className={inputCls} value={bcForm.subject} onChange={(e) => setBcForm({ ...bcForm, subject: e.target.value })} required /></label>
              <button type="button" className="mt-1 rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !bcForm.subject.trim()} onClick={runAiSubjects}>{busy === "ai-subjects" ? "প্রস্তাব তৈরি হচ্ছে..." : "🤖 AI Subject প্রস্তাব"}</button>
              {aiSubjects ? (
                <div className="mt-1 space-y-1">
                  <div className="flex flex-wrap gap-1">
                    {aiSubjects.variants.map((v, i) => <button key={i} type="button" className="rounded-full border bg-white px-2 py-0.5 text-xs hover:bg-slate-100" onClick={() => setBcForm((f) => ({ ...f, subject: v }))}>{v}</button>)}
                  </div>
                  <p className="text-[11px] text-slate-400">{aiSubjects.isRealLlm ? `AI Provider: ${aiSubjects.providerLabel} — প্রস্তাবে ক্লিক করলে Subject বসবে।` : aiSubjects.notice}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {bcForm.channel !== "whatsapp" && !bcForm.templateId ? <label className="block text-sm lg:col-span-2">Body<textarea className={inputCls} rows={2} value={bcForm.body} onChange={(e) => setBcForm({ ...bcForm, body: e.target.value })} required /></label> : null}
          {bcForm.channel === "sms" && !bcForm.templateId && bcForm.body ? (() => { const seg = smsSegments(bcForm.body); return <p className="text-xs text-slate-500 lg:col-span-2">📱 SMS হিসাব: {seg.parts}টি পার্ট ({seg.encoding === "unicode" ? "Unicode — বাংলা/বিশেষ অক্ষর আছে" : "GSM-7"}, {seg.length} অক্ষর/ইউনিট)। লিংক ট্র্যাকিং চালু থাকলে লিংকগুলো ছোট Redirect লিংকে বদলে যায় — তাতে পার্ট বাড়তে পারে।</p>; })() : null}
          {composeWarnings.length ? (
            <div className="rounded-lg bg-amber-50 p-3 text-sm lg:col-span-3">
              <div className="font-medium text-amber-800">⚠️ Compose সতর্কতা (পরামর্শমূলক — পাঠানো আটকাবে না)</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-700">{composeWarnings.map((w) => <li key={w.code}>{w.message}</li>)}</ul>
            </div>
          ) : null}
          {bcForm.channel === "email" && !bcForm.templateId ? (<>
            <label className="block text-sm lg:col-span-3">HTML Body (ঐচ্ছিক) — দিলে ইমেইল HTML হিসেবে যাবে; Text Body Fallback থাকবেই<textarea className={inputCls} rows={4} value={bcForm.htmlBody} onChange={(e) => setBcForm({ ...bcForm, htmlBody: e.target.value })} placeholder="<p>হ্যালো {{name}}, ...</p>" /></label>
            {bcForm.htmlBody ? <div className="lg:col-span-3">
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={() => setBcHtmlPreview((v) => !v)}>{bcHtmlPreview ? "প্রিভিউ লুকান" : "👁️ HTML প্রিভিউ (Sandbox)"}</button>
              {bcHtmlPreview ? <iframe title="Broadcast HTML প্রিভিউ" sandbox="" srcDoc={bcForm.htmlBody} className="mt-2 h-64 w-full rounded-lg border bg-white" /> : null}
            </div> : null}
          </>) : null}
          {bcForm.channel !== "whatsapp" && !bcForm.templateId ? (
            <div className="space-y-3 rounded-lg bg-slate-50 p-3 lg:col-span-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">✍️ Composer:</span>
                <span className="text-xs text-slate-500">বসানোর জায়গা:</span>
                <button type="button" className={`rounded-lg border px-2 py-1 text-xs font-semibold ${insertTarget === "body" ? "bg-slate-800 text-white" : ""}`} onClick={() => setInsertTarget("body")}>Text Body</button>
                {bcForm.channel === "email" ? <button type="button" className={`rounded-lg border px-2 py-1 text-xs font-semibold ${insertTarget === "html" ? "bg-slate-800 text-white" : ""}`} onClick={() => setInsertTarget("html")}>HTML Body</button> : null}
              </div>
              {variables ? (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-slate-500">Variable ({variableEntity() === "customer" ? "Customer" : variableEntity() === "lead" ? "Lead" : "CSV"}):</span>
                  {variables[variableEntity()].map((v) => <button key={v.key} type="button" className="rounded-full border bg-white px-2 py-0.5 hover:bg-slate-100" title={v.labelBn} onClick={() => insertSnippet(`{{${v.key}}}`, `{{${v.key}}}`)}>{`{{${v.key}}}`}</button>)}
                  <span className="text-[11px] text-slate-400">যার কাছে মান নেই, সেখানে Variable খালি থাকে — কখনো ভুয়া মান বসে না।</span>
                </div>
              ) : null}
              <div className="flex flex-wrap items-end gap-2 text-sm">
                <label className="block">প্রোডাক্ট বসান
                  <select className="input mt-1 w-64" value={productPick} onChange={(e) => setProductPick(e.target.value)}>
                    {products.length === 0 ? <option value="">কোনো সক্রিয় প্রোডাক্ট নেই</option> : products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40" disabled={!productPick} onClick={() => { const p = products.find((x) => x.id === productPick); if (p) insertSnippet(p.snippetText, p.snippetHtml); }}>বসান</button>
                <span className="text-[11px] text-slate-400">আসল প্রোডাক্টের নাম ও দাম বসে; প্রোডাক্টের লিংক (Slug) থাকলেই কেবল লিংক আসে — না থাকলে শুধু নাম ও দাম।</span>
              </div>
              <div className="flex flex-wrap items-end gap-2 text-sm">
                <label className="block">কুপন কোড<input className="input mt-1 w-40" value={couponForm.code} onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value })} placeholder="EID20" /></label>
                <label className="block">লেবেল (ঐচ্ছিক)<input className="input mt-1 w-48" value={couponForm.label} onChange={(e) => setCouponForm({ ...couponForm, label: e.target.value })} placeholder="ঈদ অফার" /></label>
                <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40" disabled={!couponForm.code.trim()} onClick={() => insertSnippet(couponSnippetText(couponForm.code.trim(), couponForm.label.trim() || undefined), couponSnippetHtml(couponForm.code.trim(), couponForm.label.trim() || undefined))}>বসান</button>
                <span className="text-[11px] text-amber-600">⚠️ কুপন কোড শুধু লেখা হিসেবে বার্তায় যায় — এই সিস্টেম কোডটি যাচাই, রিডিম বা ট্র্যাক করে না।</span>
              </div>
              <div className="space-y-2 border-t pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">🤖 AI দিয়ে লিখুন:</span>
                  <span className="text-[11px] text-slate-400">খসড়া শুধু এখানেই দেখানো হয় — কোথাও সংরক্ষিত হয় না, নিজে থেকে কিছু পাঠানোও হয় না। পছন্দের খসড়ায় ক্লিক করলে তবেই ফর্মে বসে।</span>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block">লক্ষ্য (Goal)<input className="input mt-1 w-64" value={aiForm.goal} onChange={(e) => setAiForm({ ...aiForm, goal: e.target.value })} placeholder="যেমন: ঈদ কালেকশনের বিক্রি বাড়ানো" /></label>
                  <label className="block">প্রোডাক্ট (ঐচ্ছিক)
                    <select className="input mt-1 w-56" value={aiForm.productId} onChange={(e) => setAiForm({ ...aiForm, productId: e.target.value })}>
                      <option value="">কোনো নির্দিষ্ট প্রোডাক্ট নয়</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <label className="block">Audience ইঙ্গিত (ঐচ্ছিক)<input className="input mt-1 w-48" value={aiForm.audienceHint} onChange={(e) => setAiForm({ ...aiForm, audienceHint: e.target.value })} placeholder="যেমন: পুরনো কাস্টমার" /></label>
                  <label className="block">ভাষা
                    <select className="input mt-1 w-auto" value={aiForm.language} onChange={(e) => setAiForm({ ...aiForm, language: e.target.value })}>
                      <option value="bn">বাংলা</option><option value="en">English</option>
                    </select>
                  </label>
                  <button type="button" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== "" || !aiForm.goal.trim()} onClick={runAiDraft}>{busy === "ai-draft" ? "খসড়া তৈরি হচ্ছে..." : "খসড়া তৈরি করুন"}</button>
                </div>
                {aiDraft ? (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-500">{aiDraft.isRealLlm ? `AI Provider: ${aiDraft.providerLabel}` : aiDraft.notice}</p>
                    <div className="grid gap-2 lg:grid-cols-2">
                      {aiDraft.variants.map((v, i) => (
                        <div key={i} className="rounded-lg border bg-white p-3">
                          {v.subject ? <div className="font-medium">{v.subject}</div> : null}
                          <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{v.body}</p>
                          {v.smsParts !== undefined ? <p className="mt-1 text-[11px] text-slate-400">SMS হিসেবে: {v.smsParts}টি পার্ট</p> : null}
                          <button type="button" className="mt-2 rounded-lg border px-3 py-1 text-xs font-semibold" onClick={() => applyAiVariant(v)}>এই খসড়াটি ফর্মে বসান</button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {bcForm.channel === "whatsapp" ? <p className="text-xs text-slate-500 lg:col-span-2">WhatsApp Broadcast শুধুমাত্র Meta-অনুমোদিত Template দিয়েই যায় (২৪ ঘণ্টার Window এর বাইরে ফ্রি-ফর্ম মার্কেটিং বার্তা Meta নিষেধ করে)। প্রতিটি প্রাপকের জন্য আলাদা Delivery রেকর্ড থাকে।</p> : null}
          <label className="block text-sm">Audience
            <select className={inputCls} value={bcForm.audienceType} onChange={(e) => setBcForm({ ...bcForm, audienceType: e.target.value })}>
              <option value="customers">সব Customer (ঠিকানা থাকলে)</option><option value="leads_stage">একটি Lead Stage</option><option value="segment">RFM Segment</option>
              <option value="custom">🎯 Custom শর্ত (Audience Builder)</option><option value="saved">💾 Saved Audience</option><option value="csv">📋 CSV / ঠিকানার তালিকা</option>
            </select>
          </label>
          {bcForm.audienceType === "leads_stage" ? <label className="block text-sm">Lead Stage
            <select className={inputCls} value={bcForm.audienceStage} onChange={(e) => setBcForm({ ...bcForm, audienceStage: e.target.value })}>
              {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label> : null}
          {bcForm.audienceType === "segment" ? <label className="block text-sm">Segment
            <select className={inputCls} value={bcForm.audienceSegment} onChange={(e) => setBcForm({ ...bcForm, audienceSegment: e.target.value })}>
              {SEGMENTS.map((s) => <option key={s} value={s}>{SEG_LABEL[s]} ({rfm?.segments[s] ?? 0} জন)</option>)}
            </select>
          </label> : null}
          {bcForm.audienceType === "custom" ? (
            <div className="space-y-2 lg:col-span-3 rounded-lg bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium">শর্ত তৈরি করুন:</span>
                <label className="flex items-center gap-1">তালিকা
                  <select className="input w-auto" value={condEntity} onChange={(e) => { setCondEntity(e.target.value); const d = (e.target.value === "customers" ? CUSTOMER_FIELD_DEFS : LEAD_FIELD_DEFS)[0]; setCondRows([{ field: d.field, op: d.ops[0], key: "", value: "" }]); }}>
                    <option value="customers">Customer</option><option value="leads">Lead</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">মিল
                  <select className="input w-auto" value={condMatch} onChange={(e) => setCondMatch(e.target.value)}>
                    <option value="all">সব শর্ত (AND)</option><option value="any">যেকোনো শর্ত (OR)</option>
                  </select>
                </label>
              </div>
              {condRows.map((row, i) => {
                const defs = condEntity === "customers" ? CUSTOMER_FIELD_DEFS : LEAD_FIELD_DEFS;
                const def = defs.find((d) => d.field === row.field) ?? defs[0];
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <select className="input w-auto" value={row.field} onChange={(e) => { const d = defs.find((x) => x.field === e.target.value) ?? defs[0]; setCondRows(condRows.map((r, j) => j === i ? { field: d.field, op: d.ops[0], key: "", value: "" } : r)); }}>
                      {defs.map((d) => <option key={d.field} value={d.field}>{d.label}</option>)}
                    </select>
                    <select className="input w-auto" value={row.op} onChange={(e) => setCondRows(condRows.map((r, j) => j === i ? { ...r, op: e.target.value } : r))}>
                      {def.ops.map((op) => <option key={op} value={op}>{OP_LABEL[op] ?? op}</option>)}
                    </select>
                    {def.kind === "keyed" ? <input className="input w-32" value={row.key} onChange={(e) => setCondRows(condRows.map((r, j) => j === i ? { ...r, key: e.target.value } : r))} placeholder={row.field === "address_key" ? "যেমন: district" : "যেমন: tier"} /> : null}
                    {def.kind === "boolean" ? (
                      <select className="input w-auto" value={row.value || "true"} onChange={(e) => setCondRows(condRows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}>
                        <option value="true">হ্যাঁ</option><option value="false">না</option>
                      </select>
                    ) : def.kind === "segment" ? (
                      <select className="input w-auto" value={row.value || "champions"} onChange={(e) => setCondRows(condRows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}>
                        {SEGMENTS.map((s) => <option key={s} value={s}>{SEG_LABEL[s]}</option>)}
                      </select>
                    ) : def.kind === "stage" ? (
                      <select className="input w-auto" value={row.value || "new"} onChange={(e) => setCondRows(condRows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}>
                        {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <input className="input w-40" type={def.kind === "number" ? "number" : "text"} value={row.value} onChange={(e) => setCondRows(condRows.map((r, j) => j === i ? { ...r, value: e.target.value } : r))} placeholder="মান" />
                    )}
                    <button type="button" className="rounded-lg border px-2 py-1 text-xs disabled:opacity-40" disabled={condRows.length <= 1} onClick={() => setCondRows(condRows.filter((_, j) => j !== i))}>সরান</button>
                  </div>
                );
              })}
              <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40" disabled={condRows.length >= 20} onClick={() => { const d = (condEntity === "customers" ? CUSTOMER_FIELD_DEFS : LEAD_FIELD_DEFS)[0]; setCondRows([...condRows, { field: d.field, op: d.ops[0], key: "", value: "" }]); }}>+ শর্ত যোগ করুন (সর্বোচ্চ ২০)</button>
              <p className="text-[11px] text-slate-400">অর্ডার-ভিত্তিক শর্ত আসল অর্ডার হিসাব থেকে আসে। যার কোনো অর্ডার নেই, তার অর্ডার সংখ্যা ০ — তবে &quot;শেষ অর্ডার&quot; শর্তে সে কখনো মিলবে না। ঠিকানার শর্ত (district ইত্যাদি) নির্ভর করে কাস্টমারের ঠিকানা যেভাবে সংরক্ষিত আছে তার ওপর।</p>
            </div>
          ) : null}
          {bcForm.audienceType === "saved" ? (
            <div className="space-y-2 lg:col-span-3 rounded-lg bg-slate-50 p-3">
              <label className="block text-sm">Saved Audience
                <select className={inputCls} value={bcForm.audienceSavedId} onChange={(e) => setBcForm({ ...bcForm, audienceSavedId: e.target.value })} required>
                  <option value="">বেছে নিন</option>
                  {savedAudiences.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.definition.entity === "leads" ? "Lead" : "Customer"}, {s.definition.conditions?.length ?? 0}টি শর্ত)</option>)}
                </select>
              </label>
              {savedAudiences.length === 0 ? <p className="text-xs text-slate-500">এখনো কোনো Saved Audience নেই — নিচে Custom শর্ত বানিয়ে নাম দিয়ে সংরক্ষণ করুন।</p> : null}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input className="input w-56" value={savedName} onChange={(e) => setSavedName(e.target.value)} placeholder="নতুন নাম / নতুন নাম (Rename-এর জন্য)" />
                <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !savedName.trim()} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("aud-create", () => apiFetch<SavedAudience>(`/organizations/${o}/messaging/audiences`, { method: "POST", body: JSON.stringify({ name: savedName.trim(), definition: buildDefinition() }) })); if (r) { setSavedName(""); setNotice(`Saved Audience "${r.name}" তৈরি হয়েছে (বর্তমান Custom শর্ত থেকে)।`); await load(); } }}>বর্তমান Custom শর্ত থেকে তৈরি করুন</button>
                <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !bcForm.audienceSavedId || !savedName.trim()} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("aud-rename", () => apiFetch(`/organizations/${o}/messaging/audiences/${bcForm.audienceSavedId}`, { method: "PATCH", body: JSON.stringify({ name: savedName.trim() }) })); if (r) { setSavedName(""); setNotice("Saved Audience-এর নাম বদলানো হয়েছে।"); await load(); } }}>নাম বদলান</button>
                <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50" disabled={busy !== "" || !bcForm.audienceSavedId} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("aud-delete", () => apiFetch(`/organizations/${o}/messaging/audiences/${bcForm.audienceSavedId}`, { method: "DELETE" })); if (r) { setBcForm({ ...bcForm, audienceSavedId: "" }); setNotice("Saved Audience মুছে ফেলা হয়েছে। যেসব Draft Broadcast এটি ব্যবহার করছিল, সেগুলোর প্রিভিউ/পাঠানো এখন সৎভাবে ব্যর্থ হবে।"); await load(); } }}>মুছুন</button>
              </div>
              <p className="text-[11px] text-slate-400">&quot;তৈরি করুন&quot; বাটনটি উপরের Custom শর্ত-বিল্ডারের বর্তমান শর্তগুলো সংরক্ষণ করে — আগে Audience ধরণ Custom করে শর্তগুলো সাজিয়ে নিন।</p>
            </div>
          ) : null}
          {bcForm.audienceType === "csv" ? (
            <label className="block text-sm lg:col-span-3">ঠিকানার তালিকা (এক লাইনে একটি, অথবা কমা দিয়ে — সর্বোচ্চ ৫০০০)
              <textarea className={inputCls} rows={4} value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder={bcForm.channel === "email" ? "one@example.com\ntwo@example.com" : "01712345678\n+8801712345678"} required />
              <span className="mt-1 block text-[11px] font-normal text-slate-400">তালিকার ঠিকানা আপনার Customer/Lead তালিকার সঙ্গে মিললে নামসহ তাদের কাছেই যাবে; না মিললেও ঠিকানাটিতে পাঠানো যাবে। অবৈধ ঠিকানা প্রিভিউতে গণনা দেখানো হবে — নীরবে বাদ যাবে না।</span>
            </label>
          ) : null}
          <label className="block text-sm">শিডিউল (ঐচ্ছিক) — সময় দিলে Draft না হয়ে Scheduled হবে<input type="datetime-local" className={inputCls} value={bcForm.scheduledAt} onChange={(e) => setBcForm({ ...bcForm, scheduledAt: e.target.value })} /></label>
          {bcForm.scheduledAt ? (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3 lg:col-span-3">
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={bcForm.recEnabled} onChange={(e) => setBcForm({ ...bcForm, recEnabled: e.target.checked })} /> 🔁 পুনরাবৃত্তি (Recurring) — পাঠানো শেষ হলে পরেরটি নিজে থেকেই শিডিউল হবে</label>
              {bcForm.recEnabled ? <>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block text-sm">ধরন
                    <select className={inputCls} value={bcForm.recFreq} onChange={(e) => setBcForm({ ...bcForm, recFreq: e.target.value })}>
                      <option value="daily">প্রতিদিন (Daily)</option><option value="weekly">সাপ্তাহিক (Weekly)</option>
                    </select>
                  </label>
                  <label className="block text-sm">ব্যবধান (Interval)<input type="number" min={1} max={52} className={inputCls} value={bcForm.recInterval} onChange={(e) => setBcForm({ ...bcForm, recInterval: e.target.value })} /></label>
                  <label className="block text-sm">শেষ তারিখ (ঐচ্ছিক)<input type="date" className={inputCls} value={bcForm.recEndsAt} onChange={(e) => setBcForm({ ...bcForm, recEndsAt: e.target.value })} /></label>
                </div>
                {bcForm.recFreq === "weekly" ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-500">সপ্তাহের দিন (ফাঁকা = শিডিউলের দিনেই):</span>
                    {["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহস্পতি", "শুক্র", "শনি"].map((label, d) => (
                      <label key={d} className="flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs">
                        <input type="checkbox" checked={bcForm.recWeekdays.includes(d)} onChange={(e) => setBcForm({ ...bcForm, recWeekdays: e.target.checked ? [...bcForm.recWeekdays, d].sort((x, y) => x - y) : bcForm.recWeekdays.filter((x) => x !== d) })} /> {label}
                      </label>
                    ))}
                  </div>
                ) : null}
                <p className="text-[11px] text-slate-400">একটি ধারায় একবারে একটি মাত্র পরবর্তী Broadcast নির্ধারিত থাকে। Pause বা বাতিল করলে ধারা সেখানেই থেমে যায়। প্রতিটি পাঠানোর সময় প্রাপক তালিকা নতুন করে তৈরি হয় — অপ্ট-আউট ও দৈনিক সীমা প্রতিবারই নতুনভাবে যাচাই হয়।</p>
              </> : null}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm lg:col-span-2"><input type="checkbox" checked={bcForm.excludePreviousRecipients} onChange={(e) => setBcForm({ ...bcForm, excludePreviousRecipients: e.target.checked })} /> আগের Broadcast-এর প্রাপকদের বাদ দিন (যাদের কাছে আগের কোনো Broadcast সফলভাবে পৌঁছেছে; ব্যর্থ পাঠানো গণনায় আসে না)</label>
          <label className="flex items-center gap-2 text-sm lg:col-span-2"><input type="checkbox" checked={bcForm.abTest} onChange={(e) => setBcForm({ ...bcForm, abTest: e.target.checked })} /> 🧪 A/B Test (অডিয়েন্স অর্ধেক-অর্ধেক ভাগ হয়ে দুটি Variant যাবে)</label>
          {bcForm.abTest && bcForm.channel !== "whatsapp" ? (<>
            {bcForm.channel === "email" ? <label className="block text-sm">Variant B Subject<input className={inputCls} value={bcForm.abSubject} onChange={(e) => setBcForm({ ...bcForm, abSubject: e.target.value })} placeholder="ফাঁকা রাখলে A এর Subject" /></label> : null}
            <label className="block text-sm lg:col-span-2">Variant B Body<textarea className={inputCls} rows={2} value={bcForm.abBody} onChange={(e) => setBcForm({ ...bcForm, abBody: e.target.value })} required /></label>
          </>) : null}
          {bcForm.abTest && bcForm.channel === "whatsapp" ? <label className="block text-sm">Variant B Template
            <select className={inputCls} value={bcForm.abWhatsappTemplateId} onChange={(e) => setBcForm({ ...bcForm, abWhatsappTemplateId: e.target.value })} required>
              <option value="">বেছে নিন</option>
              {waTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
            </select>
          </label> : null}
          <div className="space-y-2 lg:col-span-3">
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={runPreview}>
              {busy === "preview" ? "প্রিভিউ হচ্ছে..." : "👁️ প্রাপক প্রিভিউ"}
            </button>
            {preview ? (
              <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>মোট দর্শক: <strong>{preview.audienceTotal}</strong></span>
                  <span>বাদ পড়েছে (আগের প্রাপক): <strong>{preview.excludedPreviousCount}</strong></span>
                  <span>বাদ পড়েছে (অপ্ট-আউট): <strong>{preview.excludedSuppressedCount ?? 0}</strong></span>
                  <span>বাদ পড়েছে (দৈনিক সীমা): <strong>{preview.excludedFrequencyCount ?? 0}</strong></span>
                  <span>বাদ পড়েছে (WhatsApp সম্মতি নেই): <strong>{preview.excludedNoOptInCount ?? 0}</strong></span>
                  {(preview.invalidCount ?? 0) > 0 ? <span className="text-red-600">অবৈধ ঠিকানা (গণনা করা হয়েছে, পাঠানো হবে না): <strong>{preview.invalidCount}</strong></span> : null}
                  <span>চূড়ান্ত প্রাপক: <strong>{preview.total}</strong></span>
                </div>
                {preview.costEstimate ? (
                  <p className="rounded bg-white px-2 py-1 text-xs text-slate-600">💰 আনুমানিক খরচ: {preview.costEstimate.totalMinor !== undefined ? <strong>৳{(preview.costEstimate.totalMinor / 100).toFixed(2)}</strong> : null}{preview.costEstimate.smsParts ? ` · SMS পার্ট: ${preview.costEstimate.smsParts}টি/বার্তা` : ""} · <span className="text-slate-500">{preview.costEstimate.basis}</span></p>
                ) : (
                  <p className="text-[11px] text-slate-400">খরচের আনুমানিক হিসাব দেখানো যাচ্ছে না — এই Channel-এর হার সেট করা নেই। প্রেরক সেটিংসে নিজের হার বসালে এখানে হিসাব দেখাবে (কোনো হার অনুমান করে দেখানো হয় না)।</p>
                )}
                {preview.sample.length ? (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {preview.sample.map((s, i) => (
                      <li key={i} className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-slate-500">{s.address} · {s.type === "customer" ? "Customer" : s.type === "lead" ? "Lead" : "CSV তালিকা"}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-slate-500">কোনো প্রাপক নেই।</p>}
                <p className="text-[11px] text-slate-400">নমুনায় ঠিকানা আড়াল (mask) করা — পুরো ঠিকানা কখনো প্রিভিউতে আসে না। সর্বোচ্চ ২০ জন নমুনা দেখানো হয়।</p>
              </div>
            ) : null}
          </div>
          <button className="self-end btn-primary disabled:opacity-50" disabled={busy !== ""}>Draft তৈরি করুন</button>
        </form>
        <p className="text-xs text-slate-400">প্রতি Send এ সর্বোচ্চ ১০০০ জন (Environment এ বদলানো যায়)। তার বেশি হলে সার্ভার আটকে দেবে, নিজে থেকে কাউকে বাদ দেবে না।</p>
      </div>

      <div className="space-y-3 card p-5">
        <div className="font-semibold">🧭 Journey Presets (তৈরি অটোমেশন যাত্রা)</div>
        <p className="text-sm text-slate-500">এক ক্লিকে তৈরি Customer Journey: প্রতিটি Preset একটি আসল Message Template ও একটি Workflow তৈরি করে। Workflow-টি <strong>বন্ধ (disabled)</strong> অবস্থায় থাকে — Workflows পেজে পর্যালোচনা করে Enable না করলে কিছুই চলবে না। Template-গুলো Templates তালিকায় গিয়ে নিজের মতো বদলে নেওয়া যায়। প্রতিটি Journey-র পাঠানো একই সম্মতি (Opt-out) নিয়ম মানে — অপ্ট-আউট করা প্রাপকের কাছে কোনো Journey বার্তাও যাবে না।</p>
        {journeyPresets.length === 0 ? <p className="text-sm text-slate-400">Preset লোড হচ্ছে...</p> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {journeyPresets.map((p) => (
              <div key={p.key} className="rounded-lg bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.flow} · Template: {p.templateName} ({p.channel === "email" ? "Email" : "SMS"})</div>
                  </div>
                  <button type="button" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => installJourney(p)}>{busy === `journey-${p.key}` ? "ইনস্টল হচ্ছে..." : "ইনস্টল করুন"}</button>
                </div>
                <p className="mt-1 text-sm text-slate-600">{p.descriptionBn}</p>
                {journeyResults[p.key] ? <p className="mt-2 rounded bg-white px-2 py-1 text-xs text-slate-700">{journeyResults[p.key]} <a className="font-semibold text-blue-700 underline" href="/dashboard/workflows">Workflows পেজে যান →</a></p> : null}
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-slate-400">দ্রষ্টব্য: &quot;অনেকদিন ধরে নিষ্ক্রিয় কাস্টমারদের Winback&quot; জাতীয় সময়-ভিত্তিক (Schedule) Journey ইচ্ছা করেই রাখা হয়নি — Schedule Workflow-এর Context-এ কোনো প্রাপক থাকে না, তাই তার Send ধাপ কখনোই চলতে পারত না।</p>
      </div>

      <div className="space-y-3 card p-5">
        <div className="font-semibold">💬 WhatsApp Templates (Meta)</div>
        <p className="text-sm text-slate-500">WhatsApp Broadcast শুধু Meta-অনুমোদিত Template দিয়েই যায়। এখান থেকে Meta-র Template গুলো Sync করে আনুন, নতুন Template Meta-তে জমা দিন (Submit), আর প্রতিটির অনুমোদনের অবস্থা দেখুন। Sync/Submit-এর জন্য WABA ID আবশ্যক — না থাকলে সার্ভার সৎভাবে আটকে দেবে।</p>

        <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const res = await wrap("waba-save", () => apiFetch(`/organizations/${orgId}/inbox/whatsapp-waba`, { method: "PATCH", body: JSON.stringify({ wabaId: wabaInput.trim() || null }) }));
          if (res) { setNotice(wabaInput.trim() ? "WABA ID সংরক্ষিত হয়েছে।" : "WABA ID সরানো হয়েছে।"); await load(); }
        }}>
          <label className="block text-sm lg:col-span-2">WhatsApp Business Account ID (WABA ID)
            <input className={inputCls} value={wabaInput} onChange={(e) => setWabaInput(e.target.value)} placeholder="যেমন: 123456789012345" />
          </label>
          <button className="self-end rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""}>সংরক্ষণ করুন</button>
          <p className="text-[11px] text-slate-400 lg:col-span-3">কোথায় পাবেন: Meta Business Settings → WhatsApp Accounts, অথবা WhatsApp Manager-এর Account Settings-এ WhatsApp Business Account ID দেখানো হয়। {waIntegrations.some((r) => r.provider === "whatsapp") ? "" : "সতর্কতা: এখনো কোনো WhatsApp Integration যুক্ত নেই — আগে Inbox পেজে WhatsApp যুক্ত করুন, নাহলে সংরক্ষণ ব্যর্থ হবে।"}</p>
        </form>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <button className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("wa-sync", () => apiFetch<{ synced: number; created: number; updated: number; notOnMeta: number; truncated: boolean }>(`/organizations/${o}/inbox/whatsapp-templates/sync`, { method: "POST" })); if (r) { setSyncResult(r); setNotice(`Sync সম্পন্ন: মোট ${r.synced}টি Template — নতুন ${r.created}টি, হালনাগাদ ${r.updated}টি।`); await load(); } }}>{busy === "wa-sync" ? "Sync হচ্ছে..." : "🔄 Meta থেকে Sync করুন"}</button>
          {syncResult ? <span className="text-xs text-slate-500">শেষ Sync: মোট {syncResult.synced} · নতুন {syncResult.created} · হালনাগাদ {syncResult.updated} · Meta-তে নেই এমন চিহ্নিত {syncResult.notOnMeta}{syncResult.truncated ? " · ⚠️ তালিকা অসম্পূর্ণ ছিল (পেজ সীমা) — তাই কোনোটিকেই 'Meta-তে নেই' বলা হয়নি" : ""}</span> : null}
        </div>

        {waTemplates.length === 0 ? <p className="text-sm text-slate-400">কোনো WhatsApp Template নেই — Sync করুন, অথবা নিচের ফর্মে নতুন Template Meta-তে জমা দিন।</p> : waTemplates.map((t) => (
          <div key={t.id} className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{t.name} <span className="text-xs text-slate-400">({t.language}{t.category ? ` · ${t.category}` : ""})</span></span>
              <span className="flex flex-wrap gap-1">{waStatusBadge(t)}{t.qualityRating ? <span className="rounded bg-slate-200 px-2 py-0.5 text-xs">মান: {t.qualityRating}</span> : null}</span>
            </div>
            {t.bodyText ? <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{t.bodyText}</p> : null}
            {t.lastSyncedAt ? <div className="text-[11px] text-slate-400">শেষ Sync: {new Date(t.lastSyncedAt).toLocaleString()}</div> : null}
          </div>
        ))}

        <form className="grid gap-3 border-t pt-3 lg:grid-cols-2" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const buttons = waButtons.filter((b) => b.text.trim()).map((b) => b.subType === "url" ? { type: "url" as const, text: b.text.trim(), url: b.payload.trim() } : { type: "quick_reply" as const, text: b.text.trim() });
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
            }),
          }));
          if (res) { setNotice(`Template "${res.name}" Meta-তে জমা হয়েছে — অবস্থা: ${res.status ?? "PENDING"}। অনুমোদন Meta-র সিদ্ধান্ত; Sync করে অবস্থা হালনাগাদ করুন।`); setWaSubmit({ name: "", language: "bn", category: "MARKETING", bodyText: "", exampleValues: "", headerType: "none", headerText: "", headerExample: "", headerHandle: "" }); setWaButtons([]); await load(); }
        }}>
          <div className="text-sm font-medium lg:col-span-2">নতুন Template Meta-তে জমা দিন (Submit) — Meta গ্রহণ করলেই কেবল এখানে সংরক্ষিত হয়; প্রত্যাখ্যান হলে Meta-র কারণ হুবহু দেখানো হয়।</div>
          <label className="block text-sm">নাম (ছোট হাতের ইংরেজি, সংখ্যা ও _ — যেমন eid_offer_2026)<input className={inputCls} value={waSubmit.name} onChange={(e) => setWaSubmit({ ...waSubmit, name: e.target.value })} required /></label>
          <label className="block text-sm">ভাষা (Language Code)
            <select className={inputCls} value={waSubmit.language} onChange={(e) => setWaSubmit({ ...waSubmit, language: e.target.value })}>
              <option value="bn">বাংলা (bn)</option><option value="en">English (en)</option><option value="en_US">English US (en_US)</option>
            </select>
          </label>
          <label className="block text-sm">Category
            <select className={inputCls} value={waSubmit.category} onChange={(e) => setWaSubmit({ ...waSubmit, category: e.target.value })}>
              <option value="MARKETING">MARKETING (প্রচারণা)</option><option value="UTILITY">UTILITY (লেনদেন/সেবা)</option><option value="AUTHENTICATION">AUTHENTICATION (OTP)</option>
            </select>
          </label>
          <label className="block text-sm">Header
            <select className={inputCls} value={waSubmit.headerType} onChange={(e) => setWaSubmit({ ...waSubmit, headerType: e.target.value })}>
              <option value="none">নেই</option><option value="text">Text</option><option value="image">ছবি (Image)</option>
            </select>
          </label>
          {waSubmit.headerType === "text" ? (<>
            <label className="block text-sm">Header Text (&#123;&#123;1&#125;&#125; একটি মাত্র Variable চলবে)<input className={inputCls} value={waSubmit.headerText} onChange={(e) => setWaSubmit({ ...waSubmit, headerText: e.target.value })} required /></label>
            <label className="block text-sm">Header উদাহরণ (&#123;&#123;1&#125;&#125; থাকলে আবশ্যক)<input className={inputCls} value={waSubmit.headerExample} onChange={(e) => setWaSubmit({ ...waSubmit, headerExample: e.target.value })} placeholder="যেমন: ঈদ অফার" /></label>
          </>) : null}
          {waSubmit.headerType === "image" ? <label className="block text-sm lg:col-span-2">ছবির Upload Handle (Resumable Upload) — Meta-তে ছবি আপলোডের পর পাওয়া Handle লাগবে; এই অ্যাপ থেকে এখনো ছবি আপলোড করা যায় না, তাই Handle ছাড়া ছবির Header জমা দেওয়া যাবে না<input className={inputCls} value={waSubmit.headerHandle} onChange={(e) => setWaSubmit({ ...waSubmit, headerHandle: e.target.value })} required /></label> : null}
          <label className="block text-sm lg:col-span-2">Body Text — &#123;&#123;1&#125;&#125;, &#123;&#123;2&#125;&#125; আকারে Variable<textarea className={inputCls} rows={3} value={waSubmit.bodyText} onChange={(e) => setWaSubmit({ ...waSubmit, bodyText: e.target.value })} required placeholder="হ্যালো {{1}}, আপনার অর্ডার {{2}} পথে আছে।" /></label>
          <label className="block text-sm lg:col-span-2">উদাহরণ মান (কমা দিয়ে — Body-তে Variable থাকলে প্রতিটির জন্য আসল-জাতীয় উদাহরণ আবশ্যক)<input className={inputCls} value={waSubmit.exampleValues} onChange={(e) => setWaSubmit({ ...waSubmit, exampleValues: e.target.value })} placeholder="যেমন: রহিম, ORD-1024" /></label>
          <div className="space-y-2 lg:col-span-2 rounded-lg bg-slate-50 p-3">
            <div className="text-sm font-medium">বাটন (ঐচ্ছিক, সর্বোচ্চ ১০টি; লেখা সর্বোচ্চ ২৫ অক্ষর)</div>
            {waButtons.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <select className="input w-auto" value={b.subType} onChange={(e) => setWaButtons(waButtons.map((x, j) => j === i ? { ...x, subType: e.target.value as WaButtonRow["subType"] } : x))}>
                  <option value="url">URL বাটন</option><option value="quick_reply">Quick Reply</option>
                </select>
                <input className="input w-48" maxLength={25} value={b.text} onChange={(e) => setWaButtons(waButtons.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} placeholder="বাটনের লেখা" />
                {b.subType === "url" ? <input className="input w-64" value={b.payload} onChange={(e) => setWaButtons(waButtons.map((x, j) => j === i ? { ...x, payload: e.target.value } : x))} placeholder="https://... (শেষে {{1}} থাকতে পারে)" /> : null}
                <button type="button" className="rounded-lg border px-2 py-1 text-xs" onClick={() => setWaButtons(waButtons.filter((_, j) => j !== i))}>সরান</button>
              </div>
            ))}
            <button type="button" className="rounded-lg border px-3 py-1 text-xs font-semibold disabled:opacity-40" disabled={waButtons.length >= 10} onClick={() => setWaButtons([...waButtons, { subType: "quick_reply", text: "", payload: "" }])}>+ বাটন যোগ করুন</button>
          </div>
          <button className="self-end btn-primary disabled:opacity-50" disabled={busy !== ""}>{busy === "wa-submit" ? "জমা হচ্ছে..." : "Meta-তে জমা দিন"}</button>
        </form>
      </div>

      <div className="space-y-3 card p-5">
        <div className="font-semibold">✉️ প্রেরক (Sender) সেটিংস</div>
        <p className="text-sm text-slate-500">নিজের SMTP ও SMS Gateway বসালে Broadcast আপনার নিজের অ্যাকাউন্ট দিয়েই যাবে; না বসালে প্ল্যাটফর্মেরটি ব্যবহৃত হবে। SMTP সংরক্ষণের আগে সার্ভার সত্যিকারের যাচাই (Handshake) করে — যাচাই ব্যর্থ হলে কিছুই সংরক্ষিত হয় না। পাসওয়ার্ড/API Key শুধু &quot;সেট করা আছে কিনা&quot; দেখানো হয়, কখনো দেখানো বা ফেরত পাঠানো হয় না।</p>

        <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const res = await wrap("smtp-save", () => apiFetch<SenderSettings>(`/organizations/${orgId}/messaging/senders/email`, {
            method: "PUT",
            body: JSON.stringify({ smtpHost: smtpForm.smtpHost, smtpPort: Number(smtpForm.smtpPort), smtpUser: smtpForm.smtpUser || undefined, smtpPass: smtpForm.smtpPass || undefined, fromAddress: smtpForm.fromAddress, fromName: smtpForm.fromName || undefined, dkimSelector: smtpForm.dkimSelector || undefined }),
          }));
          if (res) { setSenderSettings(res); setSmtpForm({ ...smtpForm, smtpPass: "" }); setNotice("SMTP যাচাই সফল হয়েছে — আপনার প্রেরক সেটিংস সংরক্ষিত হয়েছে।"); await load(); }
        }}>
          <div className="text-sm font-medium lg:col-span-3">নিজের SMTP {senderSettings?.email.tenantConfigured ? <span className="badge-green">সক্রিয় — এই পথেই ইমেইল যাবে</span> : senderSettings?.email.platformConfigured ? <span className="badge-slate">এখন প্ল্যাটফর্ম SMTP ব্যবহৃত হচ্ছে</span> : <span className="badge-amber">কোনো ইমেইল পথ নেই</span>}</div>
          <label className="block text-sm">SMTP Host<input className={inputCls} value={smtpForm.smtpHost} onChange={(e) => setSmtpForm({ ...smtpForm, smtpHost: e.target.value })} placeholder="mail.example.com" /></label>
          <label className="block text-sm">Port<input type="number" className={inputCls} value={smtpForm.smtpPort} onChange={(e) => setSmtpForm({ ...smtpForm, smtpPort: e.target.value })} /></label>
          <label className="block text-sm">Username<input className={inputCls} value={smtpForm.smtpUser} onChange={(e) => setSmtpForm({ ...smtpForm, smtpUser: e.target.value })} /></label>
          <label className="block text-sm">Password<input type="password" className={inputCls} value={smtpForm.smtpPass} onChange={(e) => setSmtpForm({ ...smtpForm, smtpPass: e.target.value })} placeholder={senderSettings?.email.smtpPassConfigured ? "সংরক্ষিত আছে — বদলাতে চাইলে নতুন পাসওয়ার্ড দিন" : "SMTP পাসওয়ার্ড"} autoComplete="new-password" /></label>
          <label className="block text-sm">From ঠিকানা<input className={inputCls} value={smtpForm.fromAddress} onChange={(e) => setSmtpForm({ ...smtpForm, fromAddress: e.target.value })} placeholder="hello@example.com" /></label>
          <label className="block text-sm">From নাম<input className={inputCls} value={smtpForm.fromName} onChange={(e) => setSmtpForm({ ...smtpForm, fromName: e.target.value })} placeholder="আমার দোকান" /></label>
          <label className="block text-sm">DKIM Selector (ঐচ্ছিক)<input className={inputCls} value={smtpForm.dkimSelector} onChange={(e) => setSmtpForm({ ...smtpForm, dkimSelector: e.target.value })} placeholder="যেমন: mail, default, google" /></label>
          <div className="flex flex-wrap items-end gap-2">
            <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{busy === "smtp-save" ? "যাচাই হচ্ছে..." : "যাচাই করে সংরক্ষণ করুন"}</button>
            {senderSettings?.email.tenantConfigured ? <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("smtp-clear", () => apiFetch<SenderSettings>(`/organizations/${o}/messaging/senders/email`, { method: "PUT", body: JSON.stringify({ clear: true }) })); if (r) { setSenderSettings(r); setNotice("নিজের SMTP সরানো হয়েছে — এখন থেকে প্ল্যাটফর্ম SMTP ব্যবহৃত হবে (যদি কনফিগার থাকে)।"); await load(); } }}>নিজের SMTP সরান</button> : null}
          </div>
        </form>

        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <label className="block text-sm">টেস্ট ইমেইল পাঠান<input className={inputCls} value={testEmailTo} onChange={(e) => setTestEmailTo(e.target.value)} placeholder="আপনার ইমেইল ঠিকানা" /></label>
          <button className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== "" || !testEmailTo} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("smtp-test", () => apiFetch<{ sent: boolean; path: string; providerMessageId: string }>(`/organizations/${o}/messaging/senders/email/test`, { method: "POST", body: JSON.stringify({ to: testEmailTo }) })); if (r) setNotice(`টেস্ট ইমেইল পাঠানো হয়েছে — পথ: ${r.path === "tenant" ? "আপনার নিজের SMTP" : "প্ল্যাটফর্ম SMTP"} (Provider ID: ${r.providerMessageId})।`); }}>{busy === "smtp-test" ? "পাঠানো হচ্ছে..." : "টেস্ট ইমেইল পাঠান"}</button>
          <button className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("domain-health", () => apiFetch<DomainHealth>(`/organizations/${o}/messaging/senders/email/domain-health`)); if (r) setDomainHealth(r); }}>ডোমেইন হেলথ (SPF/DKIM) দেখুন</button>
        </div>
        {domainHealth ? (
          <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
            {domainHealth.domain ? <>
              <div>ডোমেইন: <strong>{domainHealth.domain}</strong> ({domainHealth.source === "tenant" ? "আপনার From" : "প্ল্যাটফর্ম From"})</div>
              <div>SPF: {domainHealth.spf.status === "found" ? <span className="text-green-700">✅ পাওয়া গেছে — <span className="break-all text-xs">{domainHealth.spf.record}</span></span> : domainHealth.spf.status === "missing" ? <span className="text-red-600">❌ নেই — {domainHealth.spf.reason}</span> : <span className="text-amber-600">❔ জানা যায়নি — {domainHealth.spf.reason}</span>}</div>
              <div>DKIM: {domainHealth.dkim.status === "found" ? <span className="text-green-700">✅ পাওয়া গেছে (Selector: {domainHealth.dkim.selector})</span> : domainHealth.dkim.status === "missing" ? <span className="text-red-600">❌ নেই — {domainHealth.dkim.reason}</span> : domainHealth.dkim.status === "not_checked" ? <span className="text-slate-500">পরীক্ষা করা হয়নি — {domainHealth.dkim.reason}</span> : <span className="text-amber-600">❔ জানা যায়নি — {domainHealth.dkim.reason}</span>}</div>
            </> : <div className="text-amber-600">{domainHealth.spf.reason}</div>}
          </div>
        ) : null}

        <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const res = await wrap("sms-save", () => apiFetch<SenderSettings & { note?: string }>(`/organizations/${orgId}/messaging/senders/sms`, {
            method: "PUT",
            body: JSON.stringify({ smsGateway: smsForm.smsGateway, smsApiKey: smsForm.smsApiKey || undefined, smsSenderId: smsForm.smsSenderId, smsApiUrl: smsForm.smsApiUrl || undefined }),
          }));
          if (res) { setSenderSettings(res); setSmsForm({ ...smsForm, smsApiKey: "" }); setNotice(res.note ? `SMS Gateway সংরক্ষিত হয়েছে। ${res.note}` : "SMS Gateway সংরক্ষিত হয়েছে।"); await load(); }
        }}>
          <div className="text-sm font-medium lg:col-span-3">নিজের SMS Gateway {senderSettings?.sms.tenantConfigured ? <span className="badge-green">সক্রিয় — এই Gateway দিয়েই SMS যাবে</span> : senderSettings?.sms.platformConfigured ? <span className="badge-slate">এখন প্ল্যাটফর্ম Gateway ব্যবহৃত হচ্ছে</span> : <span className="badge-amber">কোনো SMS পথ নেই</span>}</div>
          <label className="block text-sm">Gateway
            <select className={inputCls} value={smsForm.smsGateway} onChange={(e) => setSmsForm({ ...smsForm, smsGateway: e.target.value })}>
              {SMS_GATEWAY_OPTIONS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">API Key<input type="password" className={inputCls} value={smsForm.smsApiKey} onChange={(e) => setSmsForm({ ...smsForm, smsApiKey: e.target.value })} placeholder={senderSettings?.sms.smsApiKeyConfigured ? "সংরক্ষিত আছে — বদলাতে চাইলে নতুন Key দিন" : "Gateway API Key"} autoComplete="new-password" /></label>
          <label className="block text-sm">Sender ID<input className={inputCls} value={smsForm.smsSenderId} onChange={(e) => setSmsForm({ ...smsForm, smsSenderId: e.target.value })} placeholder="অনুমোদিত Sender ID / Masking নাম" /></label>
          <label className="block text-sm">API URL (ঐচ্ছিক Override)<input className={inputCls} value={smsForm.smsApiUrl} onChange={(e) => setSmsForm({ ...smsForm, smsApiUrl: e.target.value })} placeholder="ফাঁকা রাখলে Gateway-এর ডিফল্ট ঠিকানা" /></label>
          <div className="flex flex-wrap items-end gap-2">
            <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>সংরক্ষণ করুন</button>
            {senderSettings?.sms.tenantConfigured ? <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap("sms-clear", () => apiFetch<SenderSettings>(`/organizations/${o}/messaging/senders/sms`, { method: "PUT", body: JSON.stringify({ clear: true }) })); if (r) { setSenderSettings(r); setNotice("নিজের SMS Gateway সরানো হয়েছে — এখন থেকে প্ল্যাটফর্ম Gateway ব্যবহৃত হবে (যদি কনফিগার থাকে)।"); await load(); } }}>নিজের Gateway সরান</button> : null}
          </div>
          <p className="text-[11px] text-slate-400 lg:col-span-3">SMS Gateway-এর জন্য আগে থেকে যাচাইয়ের সুযোগ নেই — প্রথম আসল পাঠানোই প্রমাণ। Gateway অস্বীকার করলে সেই বার্তা হুবহু Send ফলাফলে দেখা যাবে।</p>
        </form>

        <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const toMinor = (v: string) => v.trim() === "" ? null : Math.round(Number(v) * 100);
          const res = await wrap("rates-save", () => apiFetch<SenderSettings>(`/organizations/${orgId}/messaging/senders/rates`, {
            method: "PATCH",
            body: JSON.stringify({ smsCostPerPartMinor: toMinor(rateForm.sms), whatsappCostPerMessageMinor: toMinor(rateForm.whatsapp), emailCostPerMessageMinor: toMinor(rateForm.email) }),
          }));
          if (res) { setSenderSettings(res); setNotice("খরচের হার সংরক্ষিত হয়েছে — প্রিভিউতে এখন আনুমানিক খরচ দেখা যাবে।"); await load(); }
        }}>
          <div className="text-sm font-medium lg:col-span-3">খরচের হার (শুধু প্রিভিউর আনুমানিক হিসাবের জন্য)</div>
          <label className="block text-sm">SMS — প্রতি পার্ট (৳)<input type="number" step="0.01" min="0" className={inputCls} value={rateForm.sms} onChange={(e) => setRateForm({ ...rateForm, sms: e.target.value })} placeholder="ফাঁকা = হার জানা নেই" /></label>
          <label className="block text-sm">WhatsApp — প্রতি বার্তা (৳)<input type="number" step="0.01" min="0" className={inputCls} value={rateForm.whatsapp} onChange={(e) => setRateForm({ ...rateForm, whatsapp: e.target.value })} placeholder="ফাঁকা = হার জানা নেই" /></label>
          <label className="block text-sm">Email — প্রতি বার্তা (৳)<input type="number" step="0.01" min="0" className={inputCls} value={rateForm.email} onChange={(e) => setRateForm({ ...rateForm, email: e.target.value })} placeholder="ফাঁকা = হার জানা নেই" /></label>
          <button className="self-end rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""}>হার সংরক্ষণ করুন</button>
          <p className="text-[11px] text-slate-400 lg:col-span-3">এই হার আপনার নিজের দেওয়া — Gateway/Meta-র আসল চার্জ এর থেকে আলাদা হতে পারে। হার না বসালে প্রিভিউতে কোনো খরচ দেখানো হয় না।</p>
        </form>
      </div>

      <div className="space-y-3 card p-5">
        <div className="font-semibold">🚫 সম্মতি ও অপ্ট-আউট</div>
        <p className="text-sm text-slate-500">যে ঠিকানা অপ্ট-আউট করা, সেখানে Broadcast ও Workflow — কোনো পথেই বার্তা যাবে না (Delivery-তে Skipped হিসেবে রেকর্ড থাকবে)। ইমেইলের আনসাবস্ক্রাইব লিংক, WhatsApp-এ STOP লিখে পাঠানো, কিংবা এখানে হাতে যোগ করা — সব একই তালিকায় জমা হয়।</p>
        <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
          const res = await wrap("msg-setting", () => apiFetch<MessagingSetting>(`/organizations/${orgId}/messaging/settings`, { method: "PATCH", body: JSON.stringify(msgSetting) }));
          if (res) { setMsgSetting(res); setNotice("সম্মতির সেটিংস সংরক্ষিত হয়েছে।"); }
        }}>
          <label className="block text-sm">প্রতি প্রাপকের দৈনিক Broadcast সীমা (২৪ ঘণ্টায়, ০ = সীমা নেই)<input type="number" min={0} max={20} className={inputCls} value={msgSetting.frequencyCapPerDay} onChange={(e) => setMsgSetting({ ...msgSetting, frequencyCapPerDay: Number(e.target.value) })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={msgSetting.whatsappOptInRequired} onChange={(e) => setMsgSetting({ ...msgSetting, whatsappOptInRequired: e.target.checked })} /> WhatsApp Broadcast-এ শুধু সম্মতি (Opt-in) দেওয়া নম্বরেই পাঠানো হবে</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={msgSetting.linkTrackingEnabled} onChange={(e) => setMsgSetting({ ...msgSetting, linkTrackingEnabled: e.target.checked })} /> 🔗 লিংক ট্র্যাকিং (Broadcast-এর লিংকে UTM + Click গণনা)</label>
          <button className="self-end rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""}>সেটিংস সংরক্ষণ করুন</button>
          <p className="text-[11px] text-slate-400 lg:col-span-3">লিংক ট্র্যাকিং চালু থাকলে Broadcast (শুধু Broadcast — Workflow নয়, WhatsApp নয়) ইমেইল/SMS-এর লিংকে UTM যোগ হয় ও লিংকগুলো স্বাক্ষরিত Redirect লিংকে বদলে যায়, যাতে কে ক্লিক করল গণনা করা যায়। <strong>বন্ধ থাকলে লিংক হুবহু যেমন লিখেছেন তেমনই যায়</strong> — কোনো UTM বা Redirect নয়। SMS-এ Redirect লিংক মূল লিংকের চেয়ে লম্বা/ছোট হতে পারে — তাতে SMS পার্ট বাড়তে পারে।</p>
        </form>

        <div className="border-t pt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">সম্মতির তালিকা ({preferences.length})</span>
            <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={exportPreferences}>অপ্ট-আউট তালিকা Export (CSV)</button>
          </div>
          {preferences.length === 0 ? <p className="text-sm text-slate-400">কোনো রেকর্ড নেই — কেউ এখনো অপ্ট-আউট করেনি।</p> : preferences.map((p) => (
            <div key={p.id} className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 px-3 py-2 text-sm">
              <span><span className="rounded bg-slate-200 px-2 py-0.5 text-xs capitalize">{p.channel}</span> <span className="font-medium">{p.address}</span> <span className={p.status === "opted_out" ? "text-red-600" : "text-green-600"}>{p.status === "opted_out" ? "অপ্ট-আউট" : "অপ্ট-ইন"}</span> <span className="text-xs text-slate-400">· {p.source} · {new Date(p.updatedAt).toLocaleString()}</span></span>
              <button className="rounded-lg border px-2 py-1 text-xs disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (!o) return; const r = await wrap(`pref-del-${p.id}`, () => apiFetch(`/organizations/${o}/messaging/preferences/${p.id}`, { method: "DELETE" })); if (r) { setNotice("সম্মতির রেকর্ড সরানো হয়েছে।"); await load(); } }}>সরান</button>
            </div>
          ))}
          <form className="mt-3 grid gap-3 lg:grid-cols-4" onSubmit={async (e) => {
            e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
            const res = await wrap("pref-add", () => apiFetch(`/organizations/${orgId}/messaging/preferences`, { method: "POST", body: JSON.stringify(prefForm) }));
            if (res) { setPrefForm({ channel: "email", address: "", status: "opted_out" }); setNotice("সম্মতির রেকর্ড যোগ হয়েছে।"); await load(); }
          }}>
            <label className="block text-sm">Channel
              <select className={inputCls} value={prefForm.channel} onChange={(e) => setPrefForm({ ...prefForm, channel: e.target.value })}>
                <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
              </select>
            </label>
            <label className="block text-sm">ঠিকানা (ইমেইল বা ফোন)<input className={inputCls} value={prefForm.address} onChange={(e) => setPrefForm({ ...prefForm, address: e.target.value })} required placeholder="name@example.com বা 017..." /></label>
            <label className="block text-sm">অবস্থা
              <select className={inputCls} value={prefForm.status} onChange={(e) => setPrefForm({ ...prefForm, status: e.target.value })}>
                <option value="opted_out">অপ্ট-আউট</option><option value="opted_in">অপ্ট-ইন</option>
              </select>
            </label>
            <button className="self-end rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""}>যোগ করুন</button>
          </form>
          <form className="mt-3 grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={async (e) => {
            e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
            const addresses = importForm.text.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
            if (!addresses.length) { setError("Import-এর জন্য অন্তত একটি ঠিকানা লিখুন"); return; }
            const res = await wrap("pref-import", () => apiFetch<{ imported: number; errors: { address: string; error: string }[] }>(`/organizations/${orgId}/messaging/preferences/import`, { method: "POST", body: JSON.stringify({ channel: importForm.channel, addresses }) }));
            if (res) { setImportResult(res); setImportForm({ channel: "email", text: "" }); setNotice(`Import সম্পন্ন: ${res.imported}টি অপ্ট-আউট যোগ হয়েছে, ${res.errors.length}টি ব্যর্থ।`); await load(); }
          }}>
            <label className="block text-sm">Import Channel
              <select className={inputCls} value={importForm.channel} onChange={(e) => setImportForm({ ...importForm, channel: e.target.value })}>
                <option value="email">Email</option><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option>
              </select>
            </label>
            <label className="block text-sm lg:col-span-2">অপ্ট-আউট তালিকা Import (এক লাইনে একটি ঠিকানা, সর্বোচ্চ ১০০০)<textarea className={inputCls} rows={3} value={importForm.text} onChange={(e) => setImportForm({ ...importForm, text: e.target.value })} placeholder={"one@example.com\ntwo@example.com"} /></label>
            <button className="self-end rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""}>Import করুন</button>
            {importResult && importResult.errors.length ? (
              <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 lg:col-span-3">
                ব্যর্থ ঠিকানা: {importResult.errors.map((x) => `${x.address} (${x.error})`).join("; ")}
              </div>
            ) : null}
          </form>
          <p className="mt-2 text-[11px] text-slate-400">দৈনিক সীমা শুধু Broadcast-এর ক্ষেত্রে প্রযোজ্য — Workflow/লেনদেনের বার্তা সীমায় আটকায় না, তবে অপ্ট-আউট সেখানেও প্রযোজ্য।</p>
        </div>
      </div>
    </div>
  );
}
