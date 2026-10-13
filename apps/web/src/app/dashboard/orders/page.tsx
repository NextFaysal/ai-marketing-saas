"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { EmptyState, KpiCard } from "@repo/ui";
import { extractedSummary, type LabelScanResultView, type LabelMatchView } from "@/lib/cx8";

interface OrderItem {
  id: string; name: string; quantity: number; totalMinor: string;
  // EC29: free-gift lines + bundle membership markers.
  isGift?: boolean; bundleId?: string | null; bundleName?: string | null;
}
// EC31: installment plan as serialized by InstallmentsService
// (direct object, no envelope; collect/cancel/create return the same shape).
interface InstallmentItemRow {
  id: string; seq: number; dueDate: string | null; dueDay: string;
  amountMinor: string; paidMinor: string; remainingMinor: string;
  paidAt: string | null; fullyPaid: boolean; overdue: boolean;
}
interface InstallmentPlan {
  id: string; orderId: string; totalMinor: string; installmentCount: number;
  intervalDays: number; startDate: string | null; status: string; note: string | null;
  paidMinor: string; remainingMinor: string; items: InstallmentItemRow[];
  orderAmountDueMinor?: string;
}
// EC18/EC19 (B8): staff order-detail payment verification rows.
interface PaymentVerificationRow {
  id: string; provider: string | null; trxId: string | null; amountMinor: string | number | null;
  status: string; source: string | null; note: string | null; createdAt: string; reviewedById: string | null;
}
interface Order {
  id: string; externalNumber?: string | null; status: string; isCod: boolean;
  paymentMethod?: string | null; totalMinor: string; refundedMinor?: string; internalNote?: string | null; placedAt?: string | null;
  // EC18 (B8): list rows carry { label, date }; the detail carries
  // the full slot + payment-verification enrichment.
  deliverySlot?: { id?: string; label: string; startTime?: string; endTime?: string; date: string } | null;
  // EC30: delivery method + chosen pickup point (list + detail).
  deliveryMethod?: string;
  pickupPoint?: { id: string; name: string; address: string; district: string; phone: string | null; feeMinor: string } | null;
  paymentVerifications?: PaymentVerificationRow[];
  advancePaidMinor?: string;
  amountDueMinor?: string;
  // EC16: promotion / referral discounts recorded on the order.
  promotionDiscountMinor?: string;
  referralDiscountMinor?: string;
  referralCode?: string | null;
  promotionsApplied?: { promotionId: string; name: string; type: string; amountMinor: string }[] | null;
  // EC24d: wholesale tier snapshot stamped at shop checkout.
  wholesaleBreakdown?: { productId: string; minQty: number; priceMinor: string }[] | null;
  // EC29: gift wrap + gift promotion outcome on the order.
  giftWrapMinor?: string;
  giftMessage?: string | null;
  giftPromotionId?: string | null;
  giftSkipped?: boolean;
  // EC5: rows come from pubOrder (the raw order row), so these
  // store-identity fields are present at runtime.
  source?: string | null; externalId?: string | null; storeId?: string | null;
  storeDraftId?: string | null; storeInvoiceUrl?: string | null;
  customer?: { firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null } | null;
  items?: OrderItem[];
  risk?: { band: string; score: number | null } | null;
}
// EC5: GET commerce/orders/:orderId/push-state — what the
// "স্টোর সিঙ্ক" panel renders. Errors from the store platform are
// shown verbatim, never paraphrased as success.
interface PushState {
  orderId: string;
  store: { id: string; name: string; platform: string; syncMode: string; refundPushEnabled: boolean; courierTrackingMetaKey: string | null } | null;
  storeSyncStatus: string | null; storeSyncError: string | null;
  storeDraftId: string | null; storeInvoiceUrl: string | null;
  recentPushes: { id: string; operation: string; status: string; lastError: string | null; createdAt: string }[];
}
interface RiskDetail { band: string; score: number | null; decided: number; reasons: string[]; suggestion: string | null; phone?: string | null }
const RISK_LABEL: Record<string, { text: string; cls: string }> = {
  high: { text: "ঝুঁকি: উচ্চ", cls: "bg-red-100 text-red-700" },
  medium: { text: "ঝুঁকি: মাঝারি", cls: "bg-amber-100 text-amber-700" },
  low: { text: "ঝুঁকি: কম", cls: "bg-emerald-100 text-emerald-700" },
  unknown: { text: "ঝুঁকি: তথ্য নেই", cls: "bg-slate-100 text-slate-500" },
};
interface Stats { totalOrders: number; codOrders: number; codSharePercent: number; deliveredRevenueMinor: string; byStatus: { status: string; count: number }[] }
interface Shipment { id: string; orderId: string; trackingCode?: string | null; status: string; provider: string; trackingUrl?: string | null; courierRuleId?: string | null }
// EC22: courier auto-select rules + tracking templates, riders.
interface CourierRule { id: string; name: string; conditions: { districts?: string[]; minWeightGrams?: number; maxWeightGrams?: number; minOrderMinor?: string | number; maxOrderMinor?: string | number; paymentType?: string }; courierAccountId: string; provider: string; priority: number; active: boolean }
interface CourierSuggestion { ruleId: string | null; ruleName?: string | null; provider?: string | null; reason?: string | null }
interface RiderRow { id: string; name: string; phone?: string | null; active: boolean }
interface DeliveryAssignmentRow { id: string; orderId: string; orderNumber?: string | null; orderStatus?: string | null; orderTotalMinor?: string; orderAddress?: string | null; riderId: string; riderName?: string | null; status: string; assignedAt?: string; note?: string | null }
// Sales & Data S5: row shape from GET organizations/:id/courier/performance.
interface ProviderPerformance { provider: string; booked: number; delivered: number; returned: number; cancelled: number; inFlight: number; decided: number; deliveryRate: number | null; returnRate: number | null; avgDeliveryHours: null }
interface CourierPerformance { days: number; deliveryTimeAvailable: boolean; providers: ProviderPerformance[]; totals: ProviderPerformance }
const PERF_PROVIDER_LABEL: Record<string, string> = { steadfast: "Steadfast", pathao: "Pathao", redx: "RedX", total: "মোট" };

const STATUSES = ["", "pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"];

// Sales & Data S2: client-side mirror of the PATCH transition
// table (apps/api OrdersService). The server stays the
// authority — a 400 shows its Bengali message verbatim.
// "returned" is a merchant-set, internal-only status.
const PATCH_STATUSES = ["pending", "on-hold", "processing", "completed", "cancelled", "refunded", "failed", "returned"];
const ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: PATCH_STATUSES, "on-hold": PATCH_STATUSES, processing: PATCH_STATUSES,
  completed: ["refunded", "returned"],
  cancelled: ["pending", "on-hold", "processing"],
  failed: ["pending", "on-hold", "processing"],
  refunded: [], returned: [],
};
function transitionAllowed(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = ORDER_TRANSITIONS[from];
  // Stored status outside the vocabulary (legacy platform
  // string): the server's escape hatch allows any target.
  if (!allowed) return true;
  return allowed.includes(to);
}

export default function OrdersPage() {
  const [items, setItems] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState("");
  const [codOnly, setCodOnly] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [courier, setCourier] = useState<{ connected: boolean } | null>(null);
  const [courierForm, setCourierForm] = useState({ apiKey: "", secretKey: "" });
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [bookingFor, setBookingFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkProvider, setBulkProvider] = useState("steadfast");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResults, setBulkResults] = useState<{ requested: number; booked: number; skipped: number; failed: number; results: { orderId: string; ok: boolean; skipped?: boolean; trackingCode?: string; error?: string }[] } | null>(null);
  const [bookForm, setBookForm] = useState({ name: "", phone: "", address: "", note: "", provider: "steadfast", pStoreId: "", pCityId: "", pZoneId: "", pAreaId: "", weightKg: "0.5", rAreaId: "", rAreaName: "", rStoreId: "" });
  const [conns, setConns] = useState<{ provider: string; connected: boolean; id?: string; trackingUrlTemplate?: string | null }[]>([]);
  // EC22: rules / tracking templates / booking suggestion / rider panel.
  const [courierRules, setCourierRules] = useState<CourierRule[]>([]);
  const [ruleForm, setRuleForm] = useState({ name: "", provider: "", courierAccountId: "", priority: "10", districts: "", minWeightGrams: "", maxWeightGrams: "", minOrderTaka: "", maxOrderTaka: "", paymentType: "", active: true });
  const [editingRule, setEditingRule] = useState<CourierRule | null>(null);
  const [ruleBusy, setRuleBusy] = useState("");
  const [ruleNotice, setRuleNotice] = useState("");
  const [trackingTemplates, setTrackingTemplates] = useState<Record<string, string>>({});
  const [bookSuggestion, setBookSuggestion] = useState<CourierSuggestion | null>(null);
  const [riders, setRiders] = useState<RiderRow[]>([]);
  const [orderAssignments, setOrderAssignments] = useState<DeliveryAssignmentRow[]>([]);
  const [assignRiderId, setAssignRiderId] = useState("");
  const [riderBusy, setRiderBusy] = useState("");
  const [pathaoForm, setPathaoForm] = useState({ clientId: "", clientSecret: "", username: "", password: "", sandbox: false });
  const [redxForm, setRedxForm] = useState({ accessToken: "", baseUrl: "" });
  const [pStores, setPStores] = useState<any[]>([]);
  const [pCities, setPCities] = useState<any[]>([]);
  const [pZones, setPZones] = useState<any[]>([]);
  const [pAreas, setPAreas] = useState<any[]>([]);
  const [rAreas, setRAreas] = useState<any[]>([]);
  const [rStores, setRStores] = useState<any[]>([]);
  const [courierBusy, setCourierBusy] = useState("");
  const [courierNotice, setCourierNotice] = useState("");
  const [quoteOut, setQuoteOut] = useState<any>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [riskDetail, setRiskDetail] = useState<(RiskDetail & { orderLabel: string }) | null>(null);
  // Sales & Data S2: order actions panel (status / refund / note).
  const [actOrder, setActOrder] = useState<Order | null>(null);
  const [actStatus, setActStatus] = useState("");
  const [actRefundTaka, setActRefundTaka] = useState("");
  const [actRefundReason, setActRefundReason] = useState("");
  const [actNote, setActNote] = useState("");
  const [actBusy, setActBusy] = useState("");
  const [actNotice, setActNotice] = useState("");
  // EC19 (B8): staff-recorded advance payment form.
  const [advAmount, setAdvAmount] = useState("");
  const [advMethod, setAdvMethod] = useState("bkash");
  const [advRef, setAdvRef] = useState("");
  const [advNote, setAdvNote] = useState("");
  const [advBusy, setAdvBusy] = useState(false);
  const [advError, setAdvError] = useState("");
  const [advNotice, setAdvNotice] = useState("");
  // EC31: installment plan for the opened order.
  const [instPlan, setInstPlan] = useState<InstallmentPlan | null>(null);
  const [instLoaded, setInstLoaded] = useState(false);
  const [instError, setInstError] = useState("");
  const [instBusy, setInstBusy] = useState("");
  const [instCount, setInstCount] = useState("3");
  const [instInterval, setInstInterval] = useState("30");
  const [instStart, setInstStart] = useState("");
  const [instNote, setInstNote] = useState("");
  const [collectForms, setCollectForms] = useState<Record<string, { amount: string; method: string; reference: string; note: string }>>({});
  // EC5: store sync panel (push-state, store note, draft, return link).
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [pushStateError, setPushStateError] = useState("");
  const [storeNoteText, setStoreNoteText] = useState("");
  const [syncBusy, setSyncBusy] = useState("");
  const [syncNotice, setSyncNotice] = useState("");
  const [syncError, setSyncError] = useState("");
  const [returnUrl, setReturnUrl] = useState("");
  const [copiedKey, setCopiedKey] = useState("");
  // Sales & Data S5: courier performance panel.
  const [perfDays, setPerfDays] = useState(30);
  const [perf, setPerf] = useState<CourierPerformance | null>(null);

  // CX8: packing label scan + plain identifier search. A scan result
  // NEVER auto-opens anything by itself: an exact match shows its
  // order with an explicit button; phone-last4 results are a pick
  // list; no-match shows the extracted values for a manual search.
  const [labelQuery, setLabelQuery] = useState("");
  const [labelScan, setLabelScan] = useState<LabelScanResultView | null>(null);
  const [labelBusy, setLabelBusy] = useState("");
  const [labelError, setLabelError] = useState("");

  async function runLabelScan(file: File) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setLabelBusy("scan"); setLabelError(""); setLabelScan(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_URL}/organizations/${orgId}/courier/label-scan`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: form,
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
      setLabelScan(body as LabelScanResultView);
    } catch (err) { setLabelError(err instanceof Error ? err.message : "স্ক্যান ব্যর্থ"); }
    finally { setLabelBusy(""); }
  }

  async function runLabelLookup() {
    const orgId = getOrganizationId(); if (!orgId || !labelQuery.trim()) return;
    setLabelBusy("lookup"); setLabelError(""); setLabelScan(null);
    try {
      const out = await apiFetch<LabelScanResultView>(`/organizations/${orgId}/courier/label-lookup`, {
        method: "POST", body: JSON.stringify({ query: labelQuery.trim() }),
      });
      setLabelScan(out);
    } catch (err) { setLabelError(err instanceof Error ? err.message : "খোঁজ ব্যর্থ"); }
    finally { setLabelBusy(""); }
  }

  function openScannedOrder(m: LabelMatchView) {
    const found = items.find((o) => o.id === m.orderId);
    if (found) { openActions(found); return; }
    setLabelError("অর্ডারটি পাওয়া গেছে, কিন্তু বর্তমান ফিল্টারের তালিকায় নেই — স্ট্যাটাস ফিল্টার 'সব স্ট্যাটাস' করে আবার দেখুন।");
  }

  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<CourierPerformance>(`/organizations/${orgId}/courier/performance?days=${perfDays}`)
      .then(setPerf).catch(() => setPerf(null));
  }, [perfDays]);

  // CX12b: post-delivery reviews (list + per-order block). A row in
  // pending_send was never sent — the UI says so, never dresses it
  // up as requested.
  interface ReviewRow { id: string; orderId: string; customerId?: string | null; rating: number | null; comment: string | null; source: string | null; status: string; requestedAt: string | null; receivedAt: string | null; createdAt: string; orderNumber: string | null; customerName: string | null }
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [reviewFilter, setReviewFilter] = useState("");
  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<ReviewRow[]>(`/organizations/${orgId}/reviews`).then(setReviews).catch(() => setReviews([]));
  }, []);
  const reviewForOrder = (orderId: string) => reviews.find((r) => r.orderId === orderId) ?? null;
  const stars = (n: number) => "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
  const reviewStatusBn = (r: ReviewRow) => r.status === "received" ? "রিভিউ পাওয়া গেছে" : r.status === "requested" ? "রিভিউ চাওয়া হয়েছে" : "এখনো পাঠানো হয়নি";

  // CX7: "To Chase" — chase records for stalled order-bot
  // sessions. Only sessions the sweep has actually considered
  // have a record; a failed send shows as such (lastFailedAt)
  // and never counts as an attempt.
  interface ChaseRow { id: string; sessionId: string; conversationId: string; attempts: number; lastChasedAt: string | null; lastFailedAt: string | null; stoppedReason: string | null; lastEvent: string | null; createdAt: string; updatedAt: string; sessionState: string | null; sessionStatus: string | null; productName: string | null }
  const [chases, setChases] = useState<ChaseRow[]>([]);
  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<ChaseRow[]>(`/organizations/${orgId}/order-chases`).then(setChases).catch(() => setChases([]));
  }, []);
  const chaseStopBn = (reason: string) => reason === "completed" ? "অর্ডার সম্পূর্ণ হয়েছে" : reason === "stop_word" ? "গ্রাহক থামতে বলেছেন" : reason === "human_took_over" ? "মানুষ দায়িত্ব নিয়েছেন" : reason === "max_attempts" ? "সর্বোচ্চ চেষ্টা শেষ" : reason === "session_ended" ? "সেশন শেষ হয়েছে" : reason;
  const chaseStatusBn = (c: ChaseRow) => c.stoppedReason ? chaseStopBn(c.stoppedReason) : c.attempts > 0 ? `${c.attempts} বার মনে করানো হয়েছে` : c.lastEvent === "customer_replied" ? "গ্রাহক উত্তর দিয়েছেন — অপেক্ষায়" : "অনুস্মারকের অপেক্ষায়";

  function openActions(o: Order) {
    if (actOrder?.id === o.id) { setActOrder(null); return; }
    setActOrder(o); setActStatus(o.status); setActNote(o.internalNote ?? "");
    setActRefundTaka(""); setActRefundReason(""); setActNotice("");
  }

  const loadPushState = useCallback(async (orderId: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const ps = await apiFetch<PushState>(`/organizations/${orgId}/commerce/orders/${orderId}/push-state`);
      setPushState(ps); setPushStateError("");
    } catch (err) {
      // A failed load must never render as "no store / no pushes".
      setPushState(null);
      setPushStateError(err instanceof Error ? err.message : "স্টোর সিঙ্কের তথ্য লোড ব্যর্থ হয়েছে");
    }
  }, []);

  // Load the store-sync panel whenever a (different) order is opened.
  const actOrderId = actOrder?.id ?? null;
  useEffect(() => {
    setPushState(null); setPushStateError(""); setStoreNoteText("");
    setSyncNotice(""); setSyncError(""); setReturnUrl(""); setCopiedKey("");
    setAdvAmount(""); setAdvRef(""); setAdvNote(""); setAdvError(""); setAdvNotice("");
    if (actOrderId) void loadPushState(actOrderId);
  }, [actOrderId, loadPushState]);

  // EC18/EC19 (B8): enrich the opened order with the staff detail
  // payload (delivery slot + payment verifications + advance/due).
  // A failed load leaves the row data as-is — never renders as
  // "no payments".
  useEffect(() => {
    if (!actOrderId) return;
    const orgId = getOrganizationId(); if (!orgId) return;
    let alive = true;
    apiFetch<Order>(`/organizations/${orgId}/orders/${actOrderId}`)
      .then((detail) => {
        if (!alive || !detail) return;
        setActOrder((prev) => (prev && prev.id === detail.id ? { ...prev, ...detail } : prev));
      })
      .catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actOrderId]);

  // EC31: load the installment plan for the opened order. A 404
  // (no plan) is treated as "no plan", never as an error banner.
  useEffect(() => {
    setInstPlan(null); setInstLoaded(false); setInstError(""); setCollectForms({});
    setInstCount("3"); setInstInterval("30"); setInstNote("");
    setInstStart(() => { const d = new Date(); const mm = String(d.getMonth() + 1).padStart(2, "0"); const dd = String(d.getDate()).padStart(2, "0"); return `${d.getFullYear()}-${mm}-${dd}`; });
    if (!actOrderId) return;
    const orgId = getOrganizationId(); if (!orgId) { setInstLoaded(true); return; }
    let alive = true;
    apiFetch<InstallmentPlan>(`/organizations/${orgId}/orders/${actOrderId}/installment-plan`)
      .then((plan) => { if (alive) { setInstPlan(plan ?? null); setInstLoaded(true); } })
      .catch(() => { if (alive) { setInstPlan(null); setInstLoaded(true); } });
    return () => { alive = false; };
  }, [actOrderId]);

  // Prefill per-item collect forms with each item's remaining amount.
  useEffect(() => {
    if (!instPlan) return;
    setCollectForms((prev) => {
      const next = { ...prev };
      for (const item of instPlan.items) {
        if (!next[item.id]) {
          // Exact minor→taka string conversion (no floats).
          let amount = "";
          try {
            const v = BigInt(item.remainingMinor); const whole = v / 100n; const frac = v % 100n;
            amount = frac === 0n ? whole.toString() : `${whole.toString()}.${String(frac).padStart(2, "0")}`;
          } catch { amount = ""; }
          next[item.id] = { amount, method: "bkash", reference: "", note: "" };
        }
      }
      return next;
    });
  }, [instPlan]);

  function applyInstPlan(plan: InstallmentPlan) {
    setInstPlan(plan);
    if (plan.orderAmountDueMinor !== undefined) {
      setActOrder((prev) => (prev && prev.id === plan.orderId ? { ...prev, amountDueMinor: plan.orderAmountDueMinor } : prev));
    }
  }

  async function createInstPlan() {
    const orgId = getOrganizationId(); if (!orgId || !actOrder) return;
    setInstBusy("create"); setInstError("");
    try {
      const plan = await apiFetch<InstallmentPlan>(`/organizations/${orgId}/orders/${actOrder.id}/installment-plan`, {
        method: "POST",
        body: JSON.stringify({
          installmentCount: Number(instCount),
          intervalDays: Number(instInterval),
          startDate: instStart,
          ...(instNote.trim() ? { note: instNote.trim() } : {}),
        }),
      });
      applyInstPlan(plan);
      await load();
    } catch (err) { setInstError(err instanceof Error ? err.message : "কিস্তি প্ল্যান তৈরি ব্যর্থ"); }
    finally { setInstBusy(""); }
  }

  async function collectInstItem(item: InstallmentItemRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const form = collectForms[item.id];
    if (!form) return;
    const raw = form.amount.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) { setInstError("টাকার পরিমাণ ঠিকভাবে লিখুন (যেমন: 200 বা 200.50)।"); return; }
    const minor = BigInt(Math.round(Number(raw) * 100));
    if (minor <= 0n) { setInstError("সংগ্রহের পরিমাণ ০-এর বেশি হতে হবে।"); return; }
    setInstBusy(`collect-${item.id}`); setInstError("");
    try {
      const plan = await apiFetch<InstallmentPlan>(`/organizations/${orgId}/installment-items/${item.id}/collect`, {
        method: "POST",
        body: JSON.stringify({
          amountMinor: minor.toString(),
          method: form.method,
          reference: form.reference.trim() || undefined,
          note: form.note.trim() || undefined,
        }),
      });
      applyInstPlan(plan);
      await load();
    } catch (err) { setInstError(err instanceof Error ? err.message : "সংগ্রহ রেকর্ড ব্যর্থ"); }
    finally { setInstBusy(""); }
  }

  async function cancelInstPlan() {
    const orgId = getOrganizationId(); if (!orgId || !instPlan) return;
    if (!window.confirm("এই কিস্তি প্ল্যানটি বাতিল করবেন? ইতিমধ্যে সংগ্রহ করা টাকা সংগ্রহ হিসেবেই থাকবে।")) return;
    setInstBusy("cancel"); setInstError("");
    try {
      const plan = await apiFetch<InstallmentPlan>(`/organizations/${orgId}/installments/${instPlan.id}/cancel`, { method: "POST" });
      applyInstPlan(plan);
      await load();
    } catch (err) { setInstError(err instanceof Error ? err.message : "প্ল্যান বাতিল ব্যর্থ"); }
    finally { setInstBusy(""); }
  }

  // EC22: rider assignments for the opened order.
  const loadOrderAssignments = useCallback(async (orderId: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try { setOrderAssignments(await apiFetch<DeliveryAssignmentRow[]>(`/organizations/${orgId}/delivery/assignments?orderId=${encodeURIComponent(orderId)}`)); }
    catch { setOrderAssignments([]); }
  }, []);
  useEffect(() => {
    setOrderAssignments([]); setAssignRiderId("");
    if (actOrderId) void loadOrderAssignments(actOrderId);
  }, [actOrderId, loadOrderAssignments]);

  async function recordAdvance() {
    const orgId = getOrganizationId(); if (!orgId || !actOrder) return;
    const raw = advAmount.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) { setAdvError("টাকার পরিমাণ ঠিকভাবে লিখুন (যেমন: 200 বা 200.50)।"); return; }
    const minor = BigInt(Math.round(Number(raw) * 100));
    if (minor <= 0n) { setAdvError("অগ্রিমের পরিমাণ ০-এর বেশি হতে হবে।"); return; }
    setAdvBusy(true); setAdvError(""); setAdvNotice("");
    try {
      const updated = await apiFetch<Order>(`/organizations/${orgId}/orders/${actOrder.id}/advance-verification`, {
        method: "POST",
        body: JSON.stringify({
          amountMinor: minor.toString(),
          method: advMethod,
          reference: advRef.trim() || undefined,
          note: advNote.trim() || undefined,
        }),
      });
      // The endpoint returns the enriched order detail.
      setActOrder((prev) => (prev ? { ...prev, ...updated } : updated));
      setAdvAmount(""); setAdvRef(""); setAdvNote("");
      setAdvNotice("অগ্রিম পেমেন্ট রেকর্ড হয়েছে।");
      await load();
    } catch (err) { setAdvError(err instanceof Error ? err.message : "অগ্রিম রেকর্ড ব্যর্থ"); }
    finally { setAdvBusy(false); }
  }

  async function copyText(key: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopiedKey(key); }
    catch { setSyncError("কপি করা যায়নি — লিংকটি হাতে কপি করুন।"); }
  }

  async function sendStoreNote() {
    const orgId = getOrganizationId(); if (!orgId || !actOrder || !storeNoteText.trim()) return;
    setSyncBusy("store-note"); setSyncNotice(""); setSyncError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/${actOrder.id}/store-note`, {
        method: "POST", body: JSON.stringify({ note: storeNoteText.trim() }),
      });
      setSyncNotice("নোট স্টোরে পাঠানোর জন্য queue-তে দেওয়া হয়েছে");
      setStoreNoteText("");
      await loadPushState(actOrder.id);
    } catch (err) { setSyncError(err instanceof Error ? err.message : "স্টোরে নোট পাঠানো ব্যর্থ"); }
    finally { setSyncBusy(""); }
  }

  async function createStoreDraft() {
    const orgId = getOrganizationId(); if (!orgId || !actOrder) return;
    setSyncBusy("draft"); setSyncNotice(""); setSyncError("");
    try {
      const updated = await apiFetch<Order>(`/organizations/${orgId}/orders/${actOrder.id}/create-store-draft`, {
        method: "POST", body: JSON.stringify({}),
      });
      setActOrder(updated);
      setSyncNotice("স্টোরে Draft Order তৈরি হয়েছে।");
      await loadPushState(actOrder.id);
      await load();
    } catch (err) { setSyncError(err instanceof Error ? err.message : "Draft Order তৈরি ব্যর্থ"); }
    finally { setSyncBusy(""); }
  }

  async function createReturnLink() {
    const orgId = getOrganizationId(); if (!orgId || !actOrder) return;
    setSyncBusy("return-link"); setSyncNotice(""); setSyncError("");
    try {
      const out = await apiFetch<{ token: string }>(`/organizations/${orgId}/orders/${actOrder.id}/return-link`, {
        method: "POST", body: JSON.stringify({}),
      });
      setReturnUrl(`${window.location.origin}/returns/${out.token}`);
    } catch (err) { setSyncError(err instanceof Error ? err.message : "রিটার্ন লিংক তৈরি ব্যর্থ"); }
    finally { setSyncBusy(""); }
  }

  async function patchOrder(body: Record<string, unknown>, okMessage: string) {
    const orgId = getOrganizationId(); if (!orgId || !actOrder) return;
    setActBusy("save"); setActNotice("");
    try {
      const updated = await apiFetch<Order>(`/organizations/${orgId}/orders/${actOrder.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setActOrder(updated); setActStatus(updated.status); setActNote(updated.internalNote ?? "");
      setActNotice(okMessage);
      await load();
    } catch (err) { setActNotice(err instanceof Error ? err.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setActBusy(""); }
  }

  async function saveStatus() { if (actOrder) await patchOrder({ status: actStatus }, "স্ট্যাটাস সংরক্ষণ হয়েছে।"); }

  async function saveRefund() {
    if (!actOrder) return;
    const raw = actRefundTaka.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) { setActNotice("টাকার পরিমাণ ঠিকভাবে লিখুন — পয়সা ভগ্নাংশে দেওয়া যাবে না (সর্বোচ্চ ২ ঘর দশমিক)।"); return; }
    const minor = BigInt(Math.round(Number(raw) * 100));
    if (minor <= 0n) { setActNotice("Refund-এর পরিমাণ ০-এর বেশি হতে হবে।"); return; }
    await patchOrder({ refund: { amountMinor: minor.toString(), reason: actRefundReason.trim() || undefined } }, "Refund রেকর্ড হয়েছে।");
    setActRefundTaka(""); setActRefundReason("");
  }

  async function saveNote() { await patchOrder({ internalNote: actNote }, "নোট সংরক্ষণ হয়েছে।"); }
  async function clearNote() { await patchOrder({ internalNote: null }, "নোট মুছে ফেলা হয়েছে।"); }

  async function showRisk(o: Order) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const r = await apiFetch<RiskDetail>(`/organizations/${orgId}/orders/${o.id}/risk`);
      setRiskDetail({ ...r, orderLabel: `#${o.externalNumber ?? o.id.slice(0, 8)}` });
    } catch { /* endpoint is advisory */ }
  }

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "50" });
      if (status) params.set("status", status);
      if (codOnly) params.set("cod", "true");
      const [list, st] = await Promise.all([
        apiFetch<{ total: number; items: Order[] }>(`/organizations/${orgId}/orders?${params}`),
        apiFetch<Stats>(`/organizations/${orgId}/orders/stats`),
      ]);
      setItems(list.items); setTotal(list.total); setStats(st); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load orders"); }
    finally { setLoading(false); }
  }, [status, codOnly]);

  useEffect(() => { load(); }, [load]);

  const loadCourier = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const [conn, ships, allConns] = await Promise.all([
        apiFetch<{ connected: boolean }>(`/organizations/${orgId}/courier/connection`),
        apiFetch<Shipment[]>(`/organizations/${orgId}/courier/shipments`),
        apiFetch<{ provider: string; connected: boolean; id?: string; trackingUrlTemplate?: string | null }[]>(`/organizations/${orgId}/courier/connections`).catch(() => []),
      ]);
      setCourier(conn); setShipments(ships); setConns(allConns as any);
      setTrackingTemplates((prev) => {
        const next = { ...prev };
        for (const c of allConns as { provider: string; trackingUrlTemplate?: string | null }[]) {
          if (next[c.provider] === undefined) next[c.provider] = c.trackingUrlTemplate ?? "";
        }
        return next;
      });
      apiFetch<CourierRule[]>(`/organizations/${orgId}/courier/rules`).then(setCourierRules).catch(() => setCourierRules([]));
      apiFetch<RiderRow[]>(`/organizations/${orgId}/delivery/riders`).then(setRiders).catch(() => setRiders([]));
    } catch { /* courier is optional */ }
  }, []);
  useEffect(() => { loadCourier(); }, [loadCourier]);
  const shipmentFor = (orderId: string) => shipments.find((s) => s.orderId === orderId);

  // EC22: rule CRUD + tracking template + suggestion + rider assignment helpers.
  function ruleConditionsSummary(r: CourierRule): string {
    const c = r.conditions ?? {};
    const parts: string[] = [];
    if (c.districts?.length) parts.push(`জেলা: ${c.districts.join(", ")}`);
    if (c.minWeightGrams != null || c.maxWeightGrams != null) parts.push(`ওজন: ${c.minWeightGrams ?? "—"}–${c.maxWeightGrams ?? "—"} গ্রাম`);
    if (c.minOrderMinor != null || c.maxOrderMinor != null) parts.push(`অর্ডার মূল্য: ${c.minOrderMinor != null ? formatMinor(BigInt(c.minOrderMinor)) : "—"} – ${c.maxOrderMinor != null ? formatMinor(BigInt(c.maxOrderMinor)) : "—"}`);
    if (c.paymentType) parts.push(`পেমেন্ট: ${c.paymentType}`);
    return parts.length ? parts.join(" · ") : "সব অর্ডারে প্রযোজ্য";
  }
  async function saveRule(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    const conditions: CourierRule["conditions"] = {};
    if (ruleForm.districts.trim()) conditions.districts = ruleForm.districts.split(",").map((s) => s.trim()).filter(Boolean);
    if (ruleForm.minWeightGrams) conditions.minWeightGrams = Number(ruleForm.minWeightGrams);
    if (ruleForm.maxWeightGrams) conditions.maxWeightGrams = Number(ruleForm.maxWeightGrams);
    if (ruleForm.minOrderTaka.trim()) { const m = BigInt(Math.round(Number(ruleForm.minOrderTaka) * 100)); conditions.minOrderMinor = m.toString(); }
    if (ruleForm.maxOrderTaka.trim()) { const m = BigInt(Math.round(Number(ruleForm.maxOrderTaka) * 100)); conditions.maxOrderMinor = m.toString(); }
    if (ruleForm.paymentType) conditions.paymentType = ruleForm.paymentType;
    setRuleBusy("save"); setRuleNotice("");
    try {
      const body = { name: ruleForm.name.trim(), conditions, courierAccountId: ruleForm.courierAccountId, provider: ruleForm.provider, priority: Number(ruleForm.priority) || 0, active: ruleForm.active };
      if (editingRule) await apiFetch(`/organizations/${orgId}/courier/rules/${editingRule.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await apiFetch(`/organizations/${orgId}/courier/rules`, { method: "POST", body: JSON.stringify(body) });
      setRuleNotice("নিয়ম সংরক্ষণ হয়েছে।");
      setEditingRule(null);
      setRuleForm({ name: "", provider: "", courierAccountId: "", priority: "10", districts: "", minWeightGrams: "", maxWeightGrams: "", minOrderTaka: "", maxOrderTaka: "", paymentType: "", active: true });
      setCourierRules(await apiFetch<CourierRule[]>(`/organizations/${orgId}/courier/rules`));
    } catch (err) { setRuleNotice(err instanceof Error ? err.message : "নিয়ম সংরক্ষণ ব্যর্থ"); }
    finally { setRuleBusy(""); }
  }
  async function deleteRule(r: CourierRule) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setRuleBusy(`del-${r.id}`);
    try { await apiFetch(`/organizations/${orgId}/courier/rules/${r.id}`, { method: "DELETE" }); setCourierRules(await apiFetch<CourierRule[]>(`/organizations/${orgId}/courier/rules`)); }
    catch (err) { setRuleNotice(err instanceof Error ? err.message : "মুছতে ব্যর্থ"); }
    finally { setRuleBusy(""); }
  }
  async function saveTrackingTemplate(provider: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setRuleBusy(`tpl-${provider}`); setRuleNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/tracking-template`, { method: "PATCH", body: JSON.stringify({ provider, trackingUrlTemplate: trackingTemplates[provider]?.trim() ? trackingTemplates[provider].trim() : null }) });
      setRuleNotice("ট্র্যাকিং টেমপ্লেট সংরক্ষণ হয়েছে।");
      await loadCourier();
    } catch (err) { setRuleNotice(err instanceof Error ? err.message : "টেমপ্লেট সংরক্ষণ ব্যর্থ"); }
    finally { setRuleBusy(""); }
  }
  async function loadSuggestion(orderId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const s = await apiFetch<CourierSuggestion>(`/organizations/${orgId}/courier/suggestion/${orderId}`);
      setBookSuggestion(s);
      if (s && s.ruleId && s.provider) {
        setBookForm((prev) => ({ ...prev, provider: s.provider as string }));
        void loadProviderLists(s.provider);
      }
    } catch { setBookSuggestion(null); /* suggestion is advisory — never break the booking form */ }
  }
  async function assignRider() {
    const orgId = getOrganizationId(); if (!orgId || !actOrder || !assignRiderId) return;
    setRiderBusy("assign");
    try {
      await apiFetch(`/organizations/${orgId}/delivery/assignments`, { method: "POST", body: JSON.stringify({ orderId: actOrder.id, riderId: assignRiderId }) });
      await loadOrderAssignments(actOrder.id);
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "রাইডার বরাদ্দ ব্যর্থ"); }
    finally { setRiderBusy(""); }
  }
  async function transitionAssignment(a: DeliveryAssignmentRow, status: string) {
    const orgId = getOrganizationId(); if (!orgId || !actOrder) return;
    setRiderBusy(`tr-${a.id}`);
    try { await apiFetch(`/organizations/${orgId}/delivery/assignments/${a.id}/transition`, { method: "POST", body: JSON.stringify({ status }) }); await loadOrderAssignments(actOrder.id); }
    catch (err) { setCourierNotice(err instanceof Error ? err.message : "অবস্থা বদল ব্যর্থ"); }
    finally { setRiderBusy(""); }
  }

  async function connectCourier(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setCourierBusy("connect"); setCourierNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connect`, { method: "POST", body: JSON.stringify(courierForm) });
      setCourierNotice("Steadfast যুক্ত হয়েছে (আসল API দিয়ে যাচাই করা)।");
      setCourierForm({ apiKey: "", secretKey: "" });
      await loadCourier();
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "Connect ব্যর্থ"); }
    finally { setCourierBusy(""); }
  }
  async function loadProviderLists(provider: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      if (provider === "pathao") {
        const [stores, cities] = await Promise.all([
          apiFetch<any[]>(`/organizations/${orgId}/courier/pathao/stores`).catch(() => []),
          apiFetch<any[]>(`/organizations/${orgId}/courier/pathao/cities`).catch(() => []),
        ]);
        setPStores(stores); setPCities(cities);
      } else if (provider === "redx") {
        const [areas, stores] = await Promise.all([
          apiFetch<any[]>(`/organizations/${orgId}/courier/redx/areas`).catch(() => []),
          apiFetch<any[]>(`/organizations/${orgId}/courier/redx/stores`).catch(() => []),
        ]);
        setRAreas(areas); setRStores(stores);
      }
    } catch { /* pickers stay empty; booking explains via API errors */ }
  }

  async function connectPathao(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setCourierBusy("pathao"); setCourierNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connect`, { method: "POST", body: JSON.stringify({ provider: "pathao", clientId: pathaoForm.clientId, clientSecret: pathaoForm.clientSecret, username: pathaoForm.username, password: pathaoForm.password, baseUrl: pathaoForm.sandbox ? "https://courier-api-sandbox.pathao.com" : undefined }) });
      setCourierNotice("Pathao যুক্ত হয়েছে (আসল API দিয়ে Token ও Store যাচাই করা)।");
      setPathaoForm({ clientId: "", clientSecret: "", username: "", password: "", sandbox: false });
      await loadCourier();
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "Pathao connect ব্যর্থ"); }
    finally { setCourierBusy(""); }
  }

  async function connectRedx(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setCourierBusy("redx"); setCourierNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connect`, { method: "POST", body: JSON.stringify({ provider: "redx", accessToken: redxForm.accessToken, baseUrl: redxForm.baseUrl || undefined }) });
      setCourierNotice("RedX যুক্ত হয়েছে (আসল API দিয়ে Area তালিকা যাচাই করা)।");
      setRedxForm({ accessToken: "", baseUrl: "" });
      await loadCourier();
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "RedX connect ব্যর্থ"); }
    finally { setCourierBusy(""); }
  }

  async function disconnectProvider(provider: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/courier/connection?provider=${provider}`, { method: "DELETE" }).catch(() => undefined);
    await loadCourier();
  }

  async function fetchQuote(order: Order) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setQuoteBusy(true); setQuoteOut(null);
    try {
      const q = await apiFetch<any>(`/organizations/${orgId}/courier/quote`, {
        method: "POST",
        body: JSON.stringify({
          provider: bookForm.provider, orderId: order.id,
          weightKg: Number(bookForm.weightKg) || 0.5,
          pathao: bookForm.provider === "pathao" ? {
            storeId: bookForm.pStoreId ? Number(bookForm.pStoreId) : undefined,
            cityId: bookForm.pCityId ? Number(bookForm.pCityId) : undefined,
            zoneId: bookForm.pZoneId ? Number(bookForm.pZoneId) : undefined,
            itemWeightKg: Number(bookForm.weightKg) || 0.5,
          } : undefined,
          redx: bookForm.provider === "redx" ? {
            deliveryAreaId: bookForm.rAreaId ? Number(bookForm.rAreaId) : undefined,
            parcelWeightKg: Number(bookForm.weightKg) || 0.5,
          } : undefined,
        }),
      });
      setQuoteOut(q);
    } catch (err) { setQuoteOut({ quotable: false, reason: err instanceof Error ? err.message : "চার্জ জানা যায়নি" }); }
    finally { setQuoteBusy(false); }
  }

  async function bookShipment(order: Order) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setCourierBusy("book"); setCourierNotice("");
    try {
      const s = await apiFetch<Shipment>(`/organizations/${orgId}/courier/shipments`, {
        method: "POST",
        body: JSON.stringify({
          orderId: order.id, provider: bookForm.provider,
          recipientName: bookForm.name || undefined, recipientPhone: bookForm.phone || undefined,
          recipientAddress: bookForm.address, note: bookForm.note || undefined,
          pathao: bookForm.provider === "pathao" ? {
            storeId: bookForm.pStoreId ? Number(bookForm.pStoreId) : undefined,
            cityId: bookForm.pCityId ? Number(bookForm.pCityId) : undefined,
            zoneId: bookForm.pZoneId ? Number(bookForm.pZoneId) : undefined,
            areaId: bookForm.pAreaId ? Number(bookForm.pAreaId) : undefined,
            itemWeightKg: Number(bookForm.weightKg) || 0.5,
          } : undefined,
          redx: bookForm.provider === "redx" ? {
            deliveryAreaId: bookForm.rAreaId ? Number(bookForm.rAreaId) : undefined,
            deliveryArea: bookForm.rAreaName || undefined,
            pickupStoreId: bookForm.rStoreId ? Number(bookForm.rStoreId) : undefined,
            parcelWeightKg: Number(bookForm.weightKg) || 0.5,
          } : undefined,
        }),
      });
      setCourierNotice(`পার্সেল বুক হয়েছে — Tracking: ${s.trackingCode} (স্ট্যাটাস: ${s.status})`);
      setBookingFor(null);
      await loadCourier();
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "Booking ব্যর্থ"); }
    finally { setCourierBusy(""); }
  }
  // Milestone 53: binary PDF download (apiFetch is JSON-only, so fetch the blob directly).
  async function downloadPdf(path: string, filename: string) {
    try {
      const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) { const body: any = await res.json().catch(() => ({})); throw new Error(body?.message ?? `HTTP ${res.status}`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "PDF ডাউনলোড ব্যর্থ"); }
  }

  // Sales & Data S3: CSV export — binary download, so fetch the
  // blob directly with the auth header (leads page pattern).
  // Carries the page's current status / COD filters only.
  async function downloadExport() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setExportBusy(true); setError("");
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (codOnly) params.set("cod", "true");
      const qs = params.toString();
      const res = await fetch(`${API_URL}/organizations/${orgId}/orders/export${qs ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) { const body: any = await res.json().catch(() => ({})); throw new Error(body?.message ?? `HTTP ${res.status}`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "orders-export.csv"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) { setError(err instanceof Error ? err.message : "এক্সপোর্ট ব্যর্থ"); }
    finally { setExportBusy(false); }
  }

  function toggleSelect(orderId: string, on: boolean) {
    setSelected((prev) => {
      if (on) return prev.includes(orderId) || prev.length >= 50 ? prev : [...prev, orderId];
      return prev.filter((x) => x !== orderId);
    });
  }

  async function bulkBook() {
    const orgId = getOrganizationId(); if (!orgId || selected.length === 0) return;
    setBulkBusy(true); setBulkResults(null);
    try {
      const out = await apiFetch<any>(`/organizations/${orgId}/courier/shipments/bulk`, {
        method: "POST",
        body: JSON.stringify({
          provider: bulkProvider, orderIds: selected,
          pathao: bulkProvider === "pathao" ? {} : undefined,
          redx: bulkProvider === "redx" ? {
            deliveryAreaId: bookForm.rAreaId ? Number(bookForm.rAreaId) : undefined,
            deliveryArea: bookForm.rAreaName || undefined,
            parcelWeightKg: 0.5,
          } : undefined,
        }),
      });
      setBulkResults(out);
      setCourierNotice(`বাল্ক বুকিং শেষ: ${out.booked}টি বুক হয়েছে, ${out.skipped}টি আগে থেকেই বুক ছিল, ${out.failed}টি ব্যর্থ${out.failed || out.skipped ? " (আংশিক সফল)" : ""}`);
      await loadCourier();
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "বাল্ক বুকিং ব্যর্থ"); }
    finally { setBulkBusy(false); }
  }

  async function bulkLabels() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const ids = selected.map((oid) => shipmentFor(oid)?.id).filter(Boolean) as string[];
    if (ids.length === 0) { setCourierNotice("বেছে নেওয়া অর্ডারগুলোর কোনো পার্সেল এখনো বুক হয়নি"); return; }
    await downloadPdf(`/organizations/${orgId}/courier/labels.pdf?ids=${ids.join(",")}`, "labels.pdf");
  }

  async function syncShipment(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setCourierBusy("sync");
    try { const s = await apiFetch<Shipment>(`/organizations/${orgId}/courier/shipments/${id}/sync`, { method: "POST" }); setCourierNotice(`স্ট্যাটাস আপডেট: ${s.status}`); await loadCourier(); }
    catch (err) { setCourierNotice(err instanceof Error ? err.message : "Sync ব্যর্থ"); }
    finally { setCourierBusy(""); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Orders</h1>
        <p className="text-sm text-slate-500">মোট {total}টি অর্ডার (বর্তমান ফিল্টারে)। Delivered Revenue শুধুমাত্র completed অর্ডার থেকে হিসাব হয়।</p>
        <a href="/dashboard/orders/manual" className="mt-2 inline-block text-sm font-semibold text-blue-600">+ ম্যানুয়াল অর্ডার / CSV ইমপোর্ট →</a>
      </div>
      {stats ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="মোট অর্ডার" value={String(stats.totalOrders)} />
          <KpiCard label="COD অর্ডার" value={String(stats.codOrders)} hint={`মোটের ${stats.codSharePercent}%`} />
          <KpiCard label="Delivered Revenue" value={formatMinor(BigInt(stats.deliveredRevenueMinor))} hint="শুধু completed" />
          <KpiCard label="স্ট্যাটাস" value={stats.byStatus.map((s) => `${s.status}: ${s.count}`).join(" · ") || "—"} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === "" ? "সব স্ট্যাটাস" : s}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={codOnly} onChange={(e) => setCodOnly(e.target.checked)} /> শুধু COD</label>
        <button className="btn-secondary btn-sm" disabled={exportBusy} onClick={downloadExport}>{exportBusy ? "ডাউনলোড হচ্ছে..." : "এক্সপোর্ট (CSV)"}</button>
      </div>
      <div className="card space-y-3">
        <h2 className="font-semibold">📷 প্যাকিং — লেবেল স্ক্যান</h2>
        <p className="text-xs text-slate-500">পার্সেলের লেবেলের ছবি দিলে AI ছবি থেকে ট্র্যাকিং কোড / অর্ডার নম্বর পড়ে সংশ্লিষ্ট অর্ডারটি খুঁজে দেয়। AI শুধু ছবিতে ছাপা মানই পড়ে — মিল না পেলে যা পড়েছে তা-ই দেখানো হবে, কিছু বানিয়ে বলা হবে না।</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`btn-primary btn-sm ${labelBusy ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
            {labelBusy === "scan" ? "ছবি পড়া হচ্ছে..." : "📷 Label Scan"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={labelBusy !== ""}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void runLabelScan(f); }} />
          </label>
          <input className="input w-64" placeholder="ট্র্যাকিং কোড, অর্ডার নম্বর বা ফোনের শেষ ৪ ডিজিট" aria-label="🔢 নম্বর দিয়ে খুঁজুন" value={labelQuery}
            onChange={(e) => setLabelQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runLabelLookup(); } }} />
          <button className="btn-secondary btn-sm" disabled={labelBusy !== "" || !labelQuery.trim()} onClick={() => void runLabelLookup()}>{labelBusy === "lookup" ? "খোঁজা হচ্ছে..." : "🔢 নম্বর দিয়ে খুঁজুন"}</button>
          <span className="text-[11px] text-slate-400">কীবোর্ডের মাইক (🎤) দিয়ে নম্বর বলেও লেখা যায় — এই বক্সে বললেই সংখ্যা বসবে, আলাদা কোনো ভয়েস-চেনা ফিচার নয়।</span>
        </div>
        {labelError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{labelError}</p> : null}
        {labelScan && !labelScan.available ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">AI ছবি পড়া এখন সেটআপ করা নেই — উপরের বক্সে নম্বর দিয়ে খুঁজুন।</p>
        ) : null}
        {labelScan && labelScan.matched ? (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <span className="font-semibold">✓ মিলেছে:</span> অর্ডার #{labelScan.matched.orderNumber ?? labelScan.matched.orderId.slice(0, 8)}
            {labelScan.matched.trackingCode ? ` · Tracking: ${labelScan.matched.trackingCode}` : ""}
            {labelScan.matched.provider ? ` · ${labelScan.matched.provider}` : ""}
            {labelScan.matched.shipmentStatus ? ` · শিপমেন্ট: ${labelScan.matched.shipmentStatus}` : ""}
            <button className="ml-2 font-semibold text-emerald-900 underline" onClick={() => openScannedOrder(labelScan.matched!)}>অর্ডারটি খুলুন</button>
          </div>
        ) : null}
        {labelScan && !labelScan.matched && labelScan.candidates.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-600">ফোনের শেষ ৪ ডিজিট মিলিয়ে সম্ভাব্য পার্সেল — সঠিকটি বেছে নিন (এভাবে কখনোই নিজে থেকে কোনো অর্ডার খোলে না):</p>
            {labelScan.candidates.map((c) => (
              <div key={c.shipmentId ?? c.orderId} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                <span className="font-medium">#{c.orderNumber ?? c.orderId.slice(0, 8)}</span>
                {c.trackingCode ? <span className="text-slate-500">Tracking: {c.trackingCode}</span> : null}
                {c.provider ? <span className="text-slate-500">{c.provider}</span> : null}
                {c.shipmentStatus ? <span className="badge-slate">{c.shipmentStatus}</span> : null}
                <button className="font-semibold text-brand-600 hover:underline" onClick={() => openScannedOrder(c)}>খুলুন</button>
              </div>
            ))}
          </div>
        ) : null}
        {labelScan && labelScan.available && !labelScan.matched && labelScan.candidates.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            কোনো মিল পাওয়া যায়নি।{extractedSummary(labelScan) ? ` ছবি/খোঁজ থেকে পড়া হয়েছে: ${extractedSummary(labelScan)} — এই মান দিয়ে হাতে খুঁজে দেখুন।` : " ছবি থেকে কোনো নম্বর পড়া যায়নি — ছবিটি আরও পরিষ্কার করে আবার চেষ্টা করুন, অথবা নম্বর দিয়ে খুঁজুন।"}
          </p>
        ) : null}
      </div>
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">🚚 কুরিয়ার — Steadfast</h2>
          <span className={courier?.connected ? "badge-green" : "badge-slate"}>{courier?.connected ? "যুক্ত আছে" : "যুক্ত নেই"}</span>
        </div>
        {courierNotice ? <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">{courierNotice}</p> : null}
        {courier?.connected ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary btn-sm" disabled={courierBusy !== ""} onClick={async () => {
              const orgId = getOrganizationId(); if (!orgId) return;
              setCourierBusy("syncall");
              try { const r = await apiFetch<{ checked: number; changed: number; errors: string[] }>(`/organizations/${orgId}/courier/sync-all`, { method: "POST" }); setCourierNotice(`Sync সম্পন্ন: ${r.checked}টি যাচাই, ${r.changed}টি স্ট্যাটাস বদলেছে${r.errors.length ? ` · ত্রুটি: ${r.errors[0]}` : ""}`); await loadCourier(); }
              catch (err) { setCourierNotice(err instanceof Error ? err.message : "Sync ব্যর্থ"); }
              finally { setCourierBusy(""); }
            }}>সব পার্সেলের স্ট্যাটাস Sync</button>
            <button className="btn-ghost btn-sm text-red-600" onClick={async () => {
              const orgId = getOrganizationId(); if (!orgId) return;
              await apiFetch(`/organizations/${orgId}/courier/connection`, { method: "DELETE" }).catch(() => undefined);
              await loadCourier();
            }}>সংযোগ বিচ্ছিন্ন</button>
          </div>
        ) : (
          <form onSubmit={connectCourier} className="grid gap-2 sm:grid-cols-3">
            <input className="input" placeholder="Steadfast API Key" value={courierForm.apiKey} onChange={(e) => setCourierForm({ ...courierForm, apiKey: e.target.value })} required />
            <input className="input" placeholder="Secret Key" value={courierForm.secretKey} onChange={(e) => setCourierForm({ ...courierForm, secretKey: e.target.value })} required />
            <button className="btn-primary" disabled={courierBusy !== ""}>{courierBusy === "connect" ? "যাচাই হচ্ছে..." : "যাচাই করে যুক্ত করুন"}</button>
            <p className="text-xs text-slate-400 sm:col-span-3">Key Steadfast Portal থেকে পাবেন। যুক্ত করার আগে আসল API দিয়ে Balance যাচাই করা হয়; ভুল Key হলে Steadfast এর নিজের ত্রুটিই দেখাবে।</p>
          </form>
        )}
      </div>
      <div className="card space-y-4">
        <h2 className="font-semibold">🚚 আরও কুরিয়ার — Pathao / RedX</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-xl bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">Pathao Courier</span>
              <span className={conns.find((c) => c.provider === "pathao")?.connected ? "badge-green" : "badge-slate"}>{conns.find((c) => c.provider === "pathao")?.connected ? "যুক্ত আছে" : "যুক্ত নেই"}</span>
            </div>
            {conns.find((c) => c.provider === "pathao")?.connected ? (
              <button className="btn-ghost btn-sm text-red-600" onClick={() => disconnectProvider("pathao")}>সংযোগ বিচ্ছিন্ন</button>
            ) : (
              <form onSubmit={connectPathao} className="grid gap-2">
                <input className="input" placeholder="Client ID" value={pathaoForm.clientId} onChange={(e) => setPathaoForm({ ...pathaoForm, clientId: e.target.value })} required />
                <input className="input" placeholder="Client Secret" value={pathaoForm.clientSecret} onChange={(e) => setPathaoForm({ ...pathaoForm, clientSecret: e.target.value })} required />
                <input className="input" placeholder="Merchant ইমেইল (Username)" value={pathaoForm.username} onChange={(e) => setPathaoForm({ ...pathaoForm, username: e.target.value })} required />
                <input className="input" type="password" placeholder="Merchant পাসওয়ার্ড" value={pathaoForm.password} onChange={(e) => setPathaoForm({ ...pathaoForm, password: e.target.value })} required />
                <label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={pathaoForm.sandbox} onChange={(e) => setPathaoForm({ ...pathaoForm, sandbox: e.target.checked })} /> Sandbox (টেস্ট) পরিবেশ</label>
                <button className="btn-primary btn-sm" disabled={courierBusy !== ""}>{courierBusy === "pathao" ? "যাচাই হচ্ছে..." : "যাচাই করে যুক্ত করুন"}</button>
                <p className="text-xs text-slate-400">Client ID/Secret Pathao Merchant Panel এর Developer API অংশে পাবেন। যুক্ত করার আগে আসল API তে Token নিয়ে Store তালিকা যাচাই করা হয়। পাসওয়ার্ড Token নবায়নের জন্য এনক্রিপ্ট করে রাখা হয়।</p>
              </form>
            )}
          </div>
          <div className="space-y-2 rounded-xl bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">RedX</span>
              <span className={conns.find((c) => c.provider === "redx")?.connected ? "badge-green" : "badge-slate"}>{conns.find((c) => c.provider === "redx")?.connected ? "যুক্ত আছে" : "যুক্ত নেই"}</span>
            </div>
            {conns.find((c) => c.provider === "redx")?.connected ? (
              <button className="btn-ghost btn-sm text-red-600" onClick={() => disconnectProvider("redx")}>সংযোগ বিচ্ছিন্ন</button>
            ) : (
              <form onSubmit={connectRedx} className="grid gap-2">
                <input className="input" placeholder="API Access Token" value={redxForm.accessToken} onChange={(e) => setRedxForm({ ...redxForm, accessToken: e.target.value })} required />
                <input className="input" placeholder="Base URL (ঐচ্ছিক — Legacy অ্যাকাউন্টের জন্য)" value={redxForm.baseUrl} onChange={(e) => setRedxForm({ ...redxForm, baseUrl: e.target.value })} />
                <button className="btn-primary btn-sm" disabled={courierBusy !== ""}>{courierBusy === "redx" ? "যাচাই হচ্ছে..." : "যাচাই করে যুক্ত করুন"}</button>
                <p className="text-xs text-slate-400">Token RedX Merchant Panel এর API Settings থেকে পাবেন। যুক্ত করার আগে আসল API থেকে Delivery Area তালিকা এনে যাচাই করা হয়।</p>
              </form>
            )}
          </div>
        </div>
      </div>
      <div className="card space-y-3">
        <h2 className="font-semibold">⚙️ কুরিয়ার অটো-সিলেক্ট নিয়ম</h2>
        <p className="text-xs text-slate-500">শর্ত মিললে বুকিংয়ের সময় কুরিয়ার নিজে থেকে সাজেস্ট হবে — স্টাফ চাইলে বদলাতে পারবেন। Priority বেশি হলে সেই নিয়ম আগে যাচাই হয়।</p>
        {ruleNotice ? <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">{ruleNotice}</p> : null}
        {courierRules.length === 0 ? <p className="text-sm text-slate-400">কোনো নিয়ম নেই।</p> : (
          <ul className="space-y-1.5">
            {[...courierRules].sort((a, b) => b.priority - a.priority).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span><span className="font-medium">{r.name}</span> <span className="text-slate-500">→ {r.provider}</span> <span className="badge-slate ml-1">Priority {r.priority}</span> <span className={r.active ? "badge-green ml-1" : "badge-slate ml-1"}>{r.active ? "সক্রিয়" : "নিষ্ক্রিয়"}</span>
                  <span className="block text-xs text-slate-500">{ruleConditionsSummary(r)}</span></span>
                <span className="flex gap-2">
                  <button type="button" className="text-xs font-semibold text-blue-700" onClick={() => { setEditingRule(r); setRuleForm({ name: r.name, provider: r.provider, courierAccountId: r.courierAccountId, priority: String(r.priority), districts: (r.conditions.districts ?? []).join(", "), minWeightGrams: r.conditions.minWeightGrams != null ? String(r.conditions.minWeightGrams) : "", maxWeightGrams: r.conditions.maxWeightGrams != null ? String(r.conditions.maxWeightGrams) : "", minOrderTaka: r.conditions.minOrderMinor != null ? String(Number(r.conditions.minOrderMinor) / 100) : "", maxOrderTaka: r.conditions.maxOrderMinor != null ? String(Number(r.conditions.maxOrderMinor) / 100) : "", paymentType: r.conditions.paymentType ?? "", active: r.active }); }}>সম্পাদনা</button>
                  <button type="button" className="text-xs font-semibold text-red-600 disabled:opacity-50" disabled={ruleBusy !== ""} onClick={() => deleteRule(r)}>মুছুন</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={saveRule} className="grid gap-2 border-t pt-3 sm:grid-cols-3">
          <input className="input" placeholder="নিয়মের নাম *" value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} required />
          <select className="input" value={ruleForm.courierAccountId} onChange={(e) => { const c = conns.find((x) => (x.id ?? x.provider) === e.target.value); setRuleForm({ ...ruleForm, courierAccountId: e.target.value, provider: c?.provider ?? ruleForm.provider }); }} required>
            <option value="">কুরিয়ার অ্যাকাউন্ট বেছে নিন</option>
            {conns.filter((c) => c.connected).map((c) => <option key={c.provider} value={c.id ?? c.provider}>{c.provider}</option>)}
            {courierRules.map((r) => <option key={`rule-${r.id}`} value={r.courierAccountId}>{r.provider} (বিদ্যমান নিয়ম থেকে)</option>)}
          </select>
          <input className="input" type="number" placeholder="Priority" value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })} />
          <input className="input" placeholder="জেলা (কমা দিয়ে, ঐচ্ছিক)" value={ruleForm.districts} onChange={(e) => setRuleForm({ ...ruleForm, districts: e.target.value })} />
          <input className="input" type="number" placeholder="সর্বনিম্ন ওজন (গ্রাম)" value={ruleForm.minWeightGrams} onChange={(e) => setRuleForm({ ...ruleForm, minWeightGrams: e.target.value })} />
          <input className="input" type="number" placeholder="সর্বোচ্চ ওজন (গ্রাম)" value={ruleForm.maxWeightGrams} onChange={(e) => setRuleForm({ ...ruleForm, maxWeightGrams: e.target.value })} />
          <input className="input" inputMode="decimal" placeholder="সর্বনিম্ন অর্ডার মূল্য (৳)" value={ruleForm.minOrderTaka} onChange={(e) => setRuleForm({ ...ruleForm, minOrderTaka: e.target.value })} />
          <input className="input" inputMode="decimal" placeholder="সর্বোচ্চ অর্ডার মূল্য (৳)" value={ruleForm.maxOrderTaka} onChange={(e) => setRuleForm({ ...ruleForm, maxOrderTaka: e.target.value })} />
          <select className="input" value={ruleForm.paymentType} onChange={(e) => setRuleForm({ ...ruleForm, paymentType: e.target.value })}>
            <option value="">পেমেন্ট টাইপ: যেকোনো</option>
            <option value="cod">COD</option>
            <option value="prepaid">Prepaid</option>
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ruleForm.active} onChange={(e) => setRuleForm({ ...ruleForm, active: e.target.checked })} /> সক্রিয়</label>
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary btn-sm" disabled={ruleBusy !== ""}>{ruleBusy === "save" ? "হচ্ছে…" : editingRule ? "নিয়ম আপডেট করুন" : "নিয়ম যোগ করুন"}</button>
            {editingRule ? <button type="button" className="btn-secondary btn-sm" onClick={() => { setEditingRule(null); setRuleForm({ name: "", provider: "", courierAccountId: "", priority: "10", districts: "", minWeightGrams: "", maxWeightGrams: "", minOrderTaka: "", maxOrderTaka: "", paymentType: "", active: true }); }}>বাতিল</button> : null}
          </div>
        </form>
        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">ট্র্যাকিং URL টেমপ্লেট</p>
          {conns.filter((c) => c.connected).length === 0 ? <p className="text-xs text-slate-400">কোনো কুরিয়ার যুক্ত নেই।</p> : conns.filter((c) => c.connected).map((c) => (
            <div key={c.provider} className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-sm font-medium">{c.provider}</span>
              <input className="input flex-1" placeholder="https://…/track/{trackingId}" value={trackingTemplates[c.provider] ?? ""} onChange={(e) => setTrackingTemplates({ ...trackingTemplates, [c.provider]: e.target.value })} />
              <button type="button" className="btn-secondary btn-sm" disabled={ruleBusy !== ""} onClick={() => saveTrackingTemplate(c.provider)}>{ruleBusy === `tpl-${c.provider}` ? "হচ্ছে…" : "সংরক্ষণ"}</button>
            </div>
          ))}
          <p className="text-xs text-slate-400">{"{trackingId}"} জায়গায় আসল ট্র্যাকিং কোড বসবে। খালি রাখলে আগের মতোই শুধু নম্বর দেখাবে।</p>
        </div>
      </div>
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">🚚 কুরিয়ার পারফরম্যান্স</h2>
          <label className="flex items-center gap-2 text-sm text-slate-500">সময়কাল
            <select className="rounded-lg border bg-white px-2 py-1.5 text-sm" value={perfDays} onChange={(e) => setPerfDays(Number(e.target.value))}>
              <option value={7}>শেষ ৭ দিন</option>
              <option value={30}>শেষ ৩০ দিন</option>
              <option value={90}>শেষ ৯০ দিন</option>
            </select>
          </label>
        </div>
        {!perf ? (
          <p className="text-sm text-slate-400">পারফরম্যান্সের তথ্য পাওয়া যায়নি।</p>
        ) : perf.providers.length === 0 ? (
          <p className="text-sm text-slate-400">এই সময়ে কোনো shipment বুক হয়নি।</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-2 font-semibold">কুরিয়ার</th>
                  <th className="py-2 pr-2 font-semibold">বুকিং</th>
                  <th className="py-2 pr-2 font-semibold">ডেলিভার্ড</th>
                  <th className="py-2 pr-2 font-semibold">রিটার্ন</th>
                  <th className="py-2 pr-2 font-semibold">বাতিল</th>
                  <th className="py-2 pr-2 font-semibold">পথে আছে</th>
                  <th className="py-2 pr-2 font-semibold">ডেলিভারি হার</th>
                  <th className="py-2 font-semibold">রিটার্ন হার</th>
                </tr>
              </thead>
              <tbody>
                {[...perf.providers, perf.totals].map((row) => {
                  const isTotal = row.provider === "total";
                  const rate = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);
                  return (
                    <tr key={row.provider} className={isTotal ? "border-t-2 bg-slate-50 font-semibold" : "border-b last:border-0"}>
                      <td className="py-2 pr-2">{PERF_PROVIDER_LABEL[row.provider] ?? row.provider}</td>
                      <td className="py-2 pr-2">{row.booked}</td>
                      <td className="py-2 pr-2">{row.delivered}</td>
                      <td className="py-2 pr-2">{row.returned}</td>
                      <td className="py-2 pr-2">{row.cancelled}</td>
                      <td className="py-2 pr-2">{row.inFlight}</td>
                      <td className="py-2 pr-2">{rate(row.deliveryRate)}</td>
                      <td className="py-2">{rate(row.returnRate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-400">হিসাবের নিয়ম: শুধু এই সময়ে বুক করা shipment। ডেলিভার্ড = delivered + partial delivery; decided = ডেলিভার্ড + রিটার্ন + বাতিল; হার = decided-এর মধ্যে অংশ — decided 0 হলে হার দেখানো হয় না। গড় ডেলিভারি সময় এখন দেখানো যাচ্ছে না, কারণ shipment রেকর্ডে ডেলিভারির মুহূর্তের timestamp সংরক্ষিত হয় না।</p>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {riskDetail ? (
        <div className="card space-y-2 border-amber-200 bg-amber-50/60">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">↩️ রিটার্ন ঝুঁকি — অর্ডার {riskDetail.orderLabel} <span className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${RISK_LABEL[riskDetail.band]?.cls ?? ""}`}>{RISK_LABEL[riskDetail.band]?.text ?? riskDetail.band}{riskDetail.score != null ? ` · স্কোর ${riskDetail.score}/১০০` : ""}</span></h3>
            <button className="btn-ghost btn-sm" onClick={() => setRiskDetail(null)}>বন্ধ করুন</button>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {riskDetail.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          {riskDetail.suggestion ? <p className="text-sm font-medium text-amber-800">{riskDetail.suggestion}</p> : null}
          <p className="text-xs text-slate-400">স্কোরটি শুধু এই দোকানের নিজের অর্ডার ইতিহাস থেকে হিসাব করা (ফোন নম্বর মিলিয়ে)। এটি কোনো অর্ডার আটকায় না — সিদ্ধান্ত সবসময় আপনার।</p>
        </div>
      ) : null}
      {reviews.length > 0 ? (
        <div className="card space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">⭐ গ্রাহক রিভিউ</h2>
            <select className="input w-auto" value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)}>
              <option value="">সব রিভিউ</option>
              <option value="5">৫ ★</option>
              <option value="4">৪ ★</option>
              <option value="3">৩ ★</option>
              <option value="2">২ ★</option>
              <option value="1">১ ★</option>
              <option value="pending">এখনো পাঠানো হয়নি</option>
              <option value="requested">রিভিউ চাওয়া হয়েছে</option>
            </select>
          </div>
          {reviews.filter((r) => reviewFilter === "" ? true : reviewFilter === "pending" ? r.status === "pending_send" : reviewFilter === "requested" ? r.status === "requested" : r.rating === Number(reviewFilter)).slice(0, 50).map((r) => (
            <div key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b py-1.5 text-sm last:border-0">
              <span className="font-medium">#{r.orderNumber ?? r.orderId.slice(0, 8)}</span>
              {r.customerName ? <span className="text-slate-600">{r.customerName}</span> : null}
              {r.rating != null ? <span className="text-amber-500">{stars(r.rating)}</span> : <span className="badge-slate">{reviewStatusBn(r)}</span>}
              {r.comment ? <span className="text-slate-700">“{r.comment}”</span> : null}
              <span className="text-xs text-slate-400">{r.receivedAt ? new Date(r.receivedAt).toLocaleString("bn-BD") : r.requestedAt ? `চাওয়া: ${new Date(r.requestedAt).toLocaleString("bn-BD")}` : "চ্যানেল নেই — পাঠানো হয়নি"}</span>
            </div>
          ))}
          {reviews.filter((r) => reviewFilter === "" ? true : reviewFilter === "pending" ? r.status === "pending_send" : reviewFilter === "requested" ? r.status === "requested" : r.rating === Number(reviewFilter)).length === 0 ? <p className="text-sm text-slate-400">এই ফিল্টারে কোনো রিভিউ নেই</p> : null}
        </div>
      ) : null}
      {chases.length > 0 ? (
        <div className="card space-y-2">
          <h2 className="font-semibold">🎯 To Chase — থেমে যাওয়া অর্ডার সেশন</h2>
          <p className="text-xs text-slate-400">অর্ডার বটে শুরু করে মাঝপথে থেমে যাওয়া সেশনগুলোর অনুস্মারকের অবস্থা। শুধু যেসব সেশন Sweep ইতিমধ্যে বিবেচনা করেছে সেগুলোই এখানে আছে।</p>
          {chases.slice(0, 50).map((c) => (
            <div key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b py-1.5 text-sm last:border-0">
              <span className="font-medium">{c.productName ?? "পণ্য অজানা"}</span>
              <span className="badge-slate">{chaseStatusBn(c)}</span>
              {c.sessionStatus ? <span className="text-slate-500">সেশন: {c.sessionStatus}{c.sessionState ? ` (${c.sessionState})` : ""}</span> : null}
              {c.lastChasedAt ? <span className="text-xs text-slate-400">সর্বশেষ অনুস্মারক: {new Date(c.lastChasedAt).toLocaleString("bn-BD")}</span> : null}
              {c.lastFailedAt && (!c.lastChasedAt || c.lastFailedAt > c.lastChasedAt) ? <span className="text-xs text-red-500">সর্বশেষ পাঠানো ব্যর্থ হয়েছে — আবার চেষ্টা হবে</span> : null}
              {!c.stoppedReason && c.lastEvent === "customer_replied" ? <span className="text-xs text-slate-400">গ্রাহক উত্তর দিয়েছেন</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে...</p> : items.length === 0 ? (
        <EmptyState title="কোনো অর্ডার নেই" description="Stores & Integrations থেকে WooCommerce কানেক্ট করে Sync Orders চালান। অর্ডার Sync হলে এখানে দেখা যাবে।" />
      ) : (
        <>
        {selected.length > 0 ? (
          <div className="card space-y-3 border-indigo-200 bg-indigo-50/60">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{selected.length}টি অর্ডার বেছে নেওয়া হয়েছে (সর্বোচ্চ ৫০)</span>
              <select className="input w-auto" value={bulkProvider} onChange={async (e) => { setBulkProvider(e.target.value); await loadProviderLists(e.target.value); }}>
                {(["steadfast", "pathao", "redx"] as const).map((p) => {
                  const c = conns.find((x) => x.provider === p);
                  const connected = c ? c.connected : p === "steadfast" ? !!courier?.connected : false;
                  return <option key={p} value={p} disabled={!connected}>{p === "steadfast" ? "Steadfast" : p === "pathao" ? "Pathao" : "RedX"}{connected ? "" : " (যুক্ত নেই)"}</option>;
                })}
              </select>
              {bulkProvider === "redx" ? (
                <select className="input w-auto" value={bookForm.rAreaId} onChange={(e) => { const area = rAreas.find((a: any) => String(a.id) === e.target.value); setBookForm({ ...bookForm, rAreaId: e.target.value, rAreaName: area?.name ?? "" }); }}>
                  <option value="">RedX ডেলিভারি এলাকা বেছে নিন</option>
                  {rAreas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              ) : null}
              <button className="btn-primary btn-sm" disabled={bulkBusy} onClick={bulkBook}>{bulkBusy ? "বুক হচ্ছে..." : `🚚 একসাথে বুক করুন (${selected.length}টি)`}</button>
              <button className="btn-secondary btn-sm" onClick={bulkLabels}>🏷️ সব লেবেল এক PDF এ</button>
              <button className="btn-ghost btn-sm" onClick={() => { setSelected([]); setBulkResults(null); }}>সিলেকশন মুছুন</button>
            </div>
            <p className="text-xs text-slate-500">ঠিকানা প্রতিটি অর্ডারের নিজের সংরক্ষিত ঠিকানা থেকে নেওয়া হয়। যেটি আগে থেকেই বুক করা, সেটি আবার বুক হবে না — ফলাফলে আলাদা করে দেখানো হবে। একটি ব্যর্থ হলেও বাকিগুলো চলতে থাকবে।</p>
            {bulkResults ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">ফলাফল: {bulkResults.booked}টি বুক হয়েছে · {bulkResults.skipped}টি আগে থেকেই বুক ছিল · {bulkResults.failed}টি ব্যর্থ</p>
                <ul className="space-y-0.5">
                  {bulkResults.results.map((r) => { const o = items.find((x) => x.id === r.orderId); return (
                    <li key={r.orderId} className={r.ok ? "text-emerald-700" : r.skipped ? "text-amber-700" : "text-red-600"}>
                      {r.ok ? "✓" : r.skipped ? "⏭" : "✗"} #{o?.externalNumber ?? r.orderId.slice(0, 8)} — {r.ok ? `Tracking: ${r.trackingCode}` : r.error}
                    </li> ); })}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="overflow-hidden card">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr>
              <th className="px-4 py-3"><input type="checkbox" checked={items.length > 0 && items.every((o) => selected.includes(o.id))} onChange={(e) => setSelected(e.target.checked ? items.slice(0, 50).map((o) => o.id) : [])} /></th>
              <th className="px-4 py-3">অর্ডার</th><th className="px-4 py-3">কাস্টমার</th><th className="px-4 py-3">আইটেম</th>
              <th className="px-4 py-3">স্ট্যাটাস</th><th className="px-4 py-3">পেমেন্ট</th><th className="px-4 py-3">মোট</th><th className="px-4 py-3">তারিখ</th><th className="px-4 py-3">কুরিয়ার</th>
            </tr></thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="px-4 py-3"><input type="checkbox" checked={selected.includes(o.id)} disabled={!selected.includes(o.id) && selected.length >= 50} onChange={(e) => toggleSelect(o.id, e.target.checked)} /></td>
                  <td className="px-4 py-3 font-medium">#{o.externalNumber ?? o.id.slice(0, 8)}<button className="block text-[11px] font-semibold text-brand-600 hover:underline" onClick={() => { const orgId = getOrganizationId(); if (orgId) void downloadPdf(`/organizations/${orgId}/courier/orders/${o.id}/invoice.pdf`, `invoice-${o.externalNumber ?? o.id}.pdf`); }}>🧾 ইনভয়েস PDF</button>
                    {o.deliverySlot ? <span className="mt-1 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">🕐 {o.deliverySlot.label} · {o.deliverySlot.date}</span> : null}
                    {o.deliveryMethod === "pickup" && o.pickupPoint ? <span className="mt-1 ml-1 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">📍 পিকআপ: {o.pickupPoint.name}</span> : null}
                  </td>
                  <td className="px-4 py-3">{[o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") || "—"}<div className="text-xs text-slate-400">{o.customer?.phone ?? o.customer?.email ?? ""}</div></td>
                  <td className="px-4 py-3">{o.items?.map((i) => `${i.name} ×${i.quantity}`).join(", ") ?? "—"}</td>
                  <td className="px-4 py-3"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">{o.status}</span>
                    {o.risk ? (
                      <button className={`mt-1 block rounded px-2 py-0.5 text-[11px] font-semibold ${RISK_LABEL[o.risk.band]?.cls ?? RISK_LABEL.unknown.cls}`}
                        title="রিটার্ন ঝুঁকির কারণ দেখুন" onClick={() => showRisk(o)}>
                        {RISK_LABEL[o.risk.band]?.text ?? "ঝুঁকি"}{o.risk.score != null ? ` · ${o.risk.score}` : ""}
                      </button>
                    ) : null}
                    <button className="mt-1 block text-[11px] font-semibold text-brand-600 hover:underline" onClick={() => openActions(o)}>⚙️ অ্যাকশন</button>
                  </td>
                  <td className="px-4 py-3">{o.isCod ? <span className="font-semibold text-amber-600">COD</span> : (o.paymentMethod ?? "—")}</td>
                  <td className="px-4 py-3">{formatMinor(BigInt(o.totalMinor))}</td>
                  <td className="px-4 py-3">{o.placedAt ? new Date(o.placedAt).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3">
                    {(() => { const sh = shipmentFor(o.id); return sh ? (
                      <span className="inline-flex flex-wrap items-center gap-1" title={sh.provider}>
                        <span className="badge-indigo" title={sh.trackingCode ?? ""}>🚚 {sh.status}</span>
                        {sh.trackingUrl ? (
                          <a className="text-xs font-semibold text-brand-600 hover:underline" href={sh.trackingUrl} target="_blank" rel="noreferrer">🔗 ট্র্যাক করুন{sh.trackingCode ? ` (${sh.trackingCode})` : ""}</a>
                        ) : sh.trackingCode ? <span className="text-xs text-slate-500">{sh.trackingCode}</span> : null}
                        {sh.courierRuleId ? (
                          <span className="badge-slate" title={sh.courierRuleId}>নিয়ম অনুযায়ী নির্বাচিত{courierRules.find((r) => r.id === sh.courierRuleId) ? `: ${courierRules.find((r) => r.id === sh.courierRuleId)?.name}` : ""}</span>
                        ) : null}
                        <button className="text-xs font-semibold text-brand-600 hover:underline" disabled={courierBusy !== ""} onClick={() => syncShipment(sh.id)}>স্ট্যাটাস যাচাই</button>
                        <button className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => { const orgId = getOrganizationId(); if (orgId) void downloadPdf(`/organizations/${orgId}/courier/shipments/${sh.id}/label.pdf`, `label-${sh.trackingCode ?? sh.id}.pdf`); }}>🏷️ লেবেল</button>
                      </span>
                    ) : courier?.connected ? (
                      <button className="text-xs font-semibold text-brand-600 hover:underline" onClick={async () => {
                        const opening = bookingFor !== o.id;
                        setBookingFor(opening ? o.id : null);
                        setQuoteOut(null);
                        const firstConnected = conns.find((c) => c.connected)?.provider ?? "steadfast";
                        setBookForm({ name: [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" "), phone: o.customer?.phone ?? "", address: "", note: "", provider: firstConnected, pStoreId: "", pCityId: "", pZoneId: "", pAreaId: "", weightKg: "0.5", rAreaId: "", rAreaName: "", rStoreId: "" });
                        setBookSuggestion(null);
                        if (opening) { await loadProviderLists(firstConnected); void loadSuggestion(o.id); }
                      }}>পার্সেল বুক করুন</button>
                    ) : <span className="text-xs text-slate-400">—</span>; })()}
                  </td>
                </tr>
              ))}
              {bookingFor ? (() => { const order = items.find((x) => x.id === bookingFor); if (!order) return null; return (
                <tr className="border-t bg-indigo-50/60"><td colSpan={9} className="px-4 py-3">
                  {bookSuggestion?.ruleId ? (
                    <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">নিয়ম অনুযায়ী সাজেশন: {bookSuggestion.ruleName ?? "নিয়ম"} — {bookSuggestion.reason ?? ""} (কুরিয়ার আগেই বেছে দেওয়া হয়েছে; চাইলে বদলাতে পারবেন)</p>
                  ) : null}
                  <div className="grid gap-2 sm:grid-cols-4">
                    <select className="input" value={bookForm.provider} onChange={async (e) => { setBookForm({ ...bookForm, provider: e.target.value }); setQuoteOut(null); await loadProviderLists(e.target.value); }}>
                      {(["steadfast", "pathao", "redx"] as const).map((p) => {
                        const c = conns.find((x) => x.provider === p);
                        return <option key={p} value={p} disabled={c ? !c.connected : p !== "steadfast" ? true : !(courier?.connected)}>{p === "steadfast" ? "Steadfast" : p === "pathao" ? "Pathao" : "RedX"}{c && !c.connected ? " (যুক্ত নেই)" : ""}</option>;
                      })}
                    </select>
                    <input className="input" placeholder="প্রাপকের নাম" value={bookForm.name} onChange={(e) => setBookForm({ ...bookForm, name: e.target.value })} />
                    <input className="input" placeholder="ফোন" value={bookForm.phone} onChange={(e) => setBookForm({ ...bookForm, phone: e.target.value })} />
                    <input className="input" placeholder="ওজন (কেজি)" type="number" step="0.5" min="0.5" value={bookForm.weightKg} onChange={(e) => setBookForm({ ...bookForm, weightKg: e.target.value })} />
                    <input className="input sm:col-span-2" placeholder="পূর্ণ ঠিকানা (বাসা, রোড, এলাকা, জেলা)" value={bookForm.address} onChange={(e) => setBookForm({ ...bookForm, address: e.target.value })} />
                    <input className="input sm:col-span-2" placeholder="নোট (ঐচ্ছিক)" value={bookForm.note} onChange={(e) => setBookForm({ ...bookForm, note: e.target.value })} />
                    {bookForm.provider === "pathao" ? (<>
                      <select className="input" value={bookForm.pStoreId} onChange={(e) => setBookForm({ ...bookForm, pStoreId: e.target.value })}>
                        <option value="">স্টোর: স্বয়ংক্রিয় (প্রথম সক্রিয়)</option>
                        {pStores.map((s: any) => <option key={s.store_id} value={s.store_id}>{s.store_name}</option>)}
                      </select>
                      <select className="input" value={bookForm.pCityId} onChange={async (e) => {
                        const cityId = e.target.value;
                        setBookForm({ ...bookForm, pCityId: cityId, pZoneId: "", pAreaId: "" }); setPZones([]); setPAreas([]);
                        if (cityId) { const orgId = getOrganizationId(); if (orgId) setPZones(await apiFetch<any[]>(`/organizations/${orgId}/courier/pathao/zones/${cityId}`).catch(() => [])); }
                      }}>
                        <option value="">শহর: ঠিকানা থেকে অনুমান (ঐচ্ছিক)</option>
                        {pCities.map((c: any) => <option key={c.city_id} value={c.city_id}>{c.city_name}</option>)}
                      </select>
                      <select className="input" value={bookForm.pZoneId} onChange={async (e) => {
                        const zoneId = e.target.value;
                        setBookForm({ ...bookForm, pZoneId: zoneId, pAreaId: "" }); setPAreas([]);
                        if (zoneId) { const orgId = getOrganizationId(); if (orgId) setPAreas(await apiFetch<any[]>(`/organizations/${orgId}/courier/pathao/areas/${zoneId}`).catch(() => [])); }
                      }}>
                        <option value="">জোন (ঐচ্ছিক)</option>
                        {pZones.map((z: any) => <option key={z.zone_id} value={z.zone_id}>{z.zone_name}</option>)}
                      </select>
                      <select className="input" value={bookForm.pAreaId} onChange={(e) => setBookForm({ ...bookForm, pAreaId: e.target.value })}>
                        <option value="">এলাকা (ঐচ্ছিক)</option>
                        {pAreas.map((a: any) => <option key={a.area_id} value={a.area_id}>{a.area_name}</option>)}
                      </select>
                    </>) : null}
                    {bookForm.provider === "redx" ? (<>
                      <select className="input sm:col-span-2" value={bookForm.rAreaId} onChange={(e) => {
                        const area = rAreas.find((a: any) => String(a.id) === e.target.value);
                        setBookForm({ ...bookForm, rAreaId: e.target.value, rAreaName: area?.name ?? "" });
                      }}>
                        <option value="">ডেলিভারি এলাকা বেছে নিন (আবশ্যক)</option>
                        {rAreas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <select className="input" value={bookForm.rStoreId} onChange={(e) => setBookForm({ ...bookForm, rStoreId: e.target.value })}>
                        <option value="">পিকআপ স্টোর: ডিফল্ট</option>
                        {rStores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </>) : null}
                    <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
                      <button className="btn-secondary btn-sm" disabled={quoteBusy} onClick={() => fetchQuote(order)}>{quoteBusy ? "হিসাব হচ্ছে..." : "💰 ডেলিভারি চার্জ দেখুন"}</button>
                      {quoteOut ? (quoteOut.quotable ? (
                        <span className="text-xs font-semibold text-emerald-700">ডেলিভারি চার্জ: {formatMinor(BigInt(quoteOut.chargeMinor ?? 0))} <span className="font-normal text-slate-500">({quoteOut.provider === "pathao" ? "Pathao" : "RedX"} এর নিজের প্রাইস API থেকে — বুকিংয়ের আগে)</span></span>
                      ) : (
                        <span className="text-xs text-amber-700">{quoteOut.reason}</span>
                      )) : null}
                    </div>
                    <button className="btn-primary" disabled={courierBusy !== "" || bookForm.address.trim().length < 8 || (bookForm.provider === "redx" && !bookForm.rAreaId)} onClick={() => bookShipment(order)}>{courierBusy === "book" ? "বুক হচ্ছে..." : `${bookForm.provider === "pathao" ? "Pathao" : bookForm.provider === "redx" ? "RedX" : "Steadfast"} এ বুক করুন${order.isCod ? ` (COD ${formatMinor(BigInt(order.totalMinor))})` : ""}`}</button>
                  </div>
                </td></tr>
              ); })() : null}
              {actOrder ? (() => { const o = actOrder; const refunded = BigInt(o.refundedMinor ?? "0"); const totalAmt = BigInt(o.totalMinor); return (
                <tr className="border-t bg-slate-50"><td colSpan={9} className="px-4 py-3">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">⚙️ অর্ডার অ্যাকশন — #{o.externalNumber ?? o.id.slice(0, 8)}</h3>
                      <button className="btn-ghost btn-sm" onClick={() => setActOrder(null)}>বন্ধ করুন</button>
                    </div>
                    {actNotice ? <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">{actNotice}</p> : null}
                    <div className="grid gap-4 lg:grid-cols-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">স্ট্যাটাস</label>
                        <select className="input" value={actStatus} onChange={(e) => setActStatus(e.target.value)}>
                          {!PATCH_STATUSES.includes(o.status) ? <option value={o.status}>{o.status} (বর্তমান)</option> : null}
                          {PATCH_STATUSES.map((s) => (
                            <option key={s} value={s} disabled={!transitionAllowed(o.status, s)}>
                              {s}{s === o.status ? " (বর্তমান)" : ""}{!transitionAllowed(o.status, s) ? " — যাওয়া যাবে না" : ""}
                            </option>
                          ))}
                        </select>
                        <button className="btn-primary btn-sm" disabled={actBusy !== "" || actStatus === o.status} onClick={saveStatus}>স্ট্যাটাস সংরক্ষণ</button>
                        <p className="text-xs text-slate-400">Cancelled/Failed হলে স্টক ফেরত যোগ হয়, Returned হলেও তাই; Completed হলে order.delivered ইভেন্ট যায়। যেসব স্ট্যাটাসে যাওয়া যাবে না সেগুলো নিষ্ক্রিয় — সার্ভারই চূড়ান্ত authority।</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Refund রেকর্ড (টাকায়)</label>
                        <input className="input" placeholder="পরিমাণ (টাকা, যেমন 250 বা 250.50)" value={actRefundTaka} onChange={(e) => setActRefundTaka(e.target.value)} />
                        <input className="input" placeholder="কারণ (ঐচ্ছিক)" value={actRefundReason} onChange={(e) => setActRefundReason(e.target.value)} />
                        <button className="btn-primary btn-sm" disabled={actBusy !== "" || actRefundTaka.trim() === ""} onClick={saveRefund}>Refund রেকর্ড করুন</button>
                        <p className="text-xs text-slate-500">মোট ফেরত: {formatMinor(refunded)} / {formatMinor(totalAmt)} · আরও ফেরতযোগ্য: {formatMinor(totalAmt - refunded)}</p>
                        <p className="text-xs text-slate-400">Refund শুধু টাকার হিসাব রাখে — স্টক ফেরত চাইলে স্ট্যাটাস Cancelled/Returned করুন। পুরো টাকা ফেরত হলে খোলা অর্ডার নিজে থেকেই refunded হয়ে যায়।</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">অভ্যন্তরীণ নোট (শুধু টিমের জন্য)</label>
                        <textarea className="input" rows={3} maxLength={2000} placeholder="যেমন: কাস্টমার ফোনে ঠিকানা বদলেছেন…" value={actNote} onChange={(e) => setActNote(e.target.value)} />
                        <div className="flex gap-2">
                          <button className="btn-primary btn-sm" disabled={actBusy !== ""} onClick={saveNote}>নোট সংরক্ষণ</button>
                          <button className="btn-ghost btn-sm text-red-600" disabled={actBusy !== ""} onClick={clearNote}>নোট মুছুন</button>
                        </div>
                        <p className="text-xs text-slate-400">এই নোট কাস্টমার বা কোনো প্ল্যাটফর্মে যায় না।</p>
                      </div>
                    </div>
                    {/* EC18/EC19 (B8): delivery slot + payments / advances */}
                    <div className="space-y-3 rounded-xl border bg-white p-3">
                      <h4 className="text-sm font-semibold">💳 পেমেন্ট ও ডেলিভারি স্লট</h4>
                      {o.deliverySlot ? (
                        <p className="text-sm">🕐 ডেলিভারি স্লট: <b>{o.deliverySlot.label}</b>{o.deliverySlot.startTime && o.deliverySlot.endTime ? ` (${o.deliverySlot.startTime} – ${o.deliverySlot.endTime})` : ""} · তারিখ: <b>{o.deliverySlot.date}</b></p>
                      ) : (
                        <p className="text-xs text-slate-400">এই অর্ডারে কোনো ডেলিভারি স্লট বেছে নেওয়া হয়নি।</p>
                      )}
                      {o.deliveryMethod === "pickup" && o.pickupPoint ? (
                        <p className="text-sm">📍 পিকআপ: <b>{o.pickupPoint.name}</b> — {o.pickupPoint.address}, {o.pickupPoint.district}{o.pickupPoint.phone ? <> · ফোন: <span className="font-mono">{o.pickupPoint.phone}</span></> : null} · ফি: <b>{(() => { try { return formatMinor(BigInt(o.pickupPoint.feeMinor)); } catch { return o.pickupPoint.feeMinor; } })()}</b></p>
                      ) : null}
                      {o.advancePaidMinor !== undefined || o.amountDueMinor !== undefined ? (
                        <div className="flex flex-wrap gap-4 text-sm">
                          {o.advancePaidMinor !== undefined ? <span>অগ্রিম পরিশোধিত: <b className="text-emerald-700">{(() => { try { return formatMinor(BigInt(o.advancePaidMinor)); } catch { return o.advancePaidMinor; } })()}</b></span> : null}
                          {o.amountDueMinor !== undefined ? <span>বকেয়া: <b>{(() => { try { return formatMinor(BigInt(o.amountDueMinor)); } catch { return o.amountDueMinor; } })()}</b></span> : null}
                        </div>
                      ) : null}
                      {(o.promotionsApplied ?? []).length > 0 || o.referralCode ? (
                        <div className="space-y-1 text-sm">
                          {(o.promotionsApplied ?? []).map((pa) => (
                            <p key={pa.promotionId}>🎁 প্রমোশন: <b>{pa.name}</b> — ছাড়: <b className="text-emerald-700">{(() => { try { return formatMinor(BigInt(pa.amountMinor)); } catch { return pa.amountMinor; } })()}</b></p>
                          ))}
                          {o.referralCode ? (
                            <p>🤝 রেফারেল কোড: <b className="font-mono">{o.referralCode}</b>
                              {o.referralDiscountMinor !== undefined && Number(o.referralDiscountMinor) > 0 ? (
                                <> — ছাড়: <b className="text-emerald-700">{(() => { try { return formatMinor(BigInt(o.referralDiscountMinor)); } catch { return o.referralDiscountMinor; } })()}</b></>
                              ) : null}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {(o.wholesaleBreakdown ?? []).length > 0 ? (
                        <div className="space-y-1 text-sm">
                          <p className="font-semibold text-amber-800">🏷️ পাইকারি মূল্য প্রযোজ্য</p>
                          {(o.wholesaleBreakdown ?? []).map((w) => (
                            <p key={w.productId} className="text-xs text-slate-600">
                              পণ্য {w.productId} — কমপক্ষে {w.minQty}টির স্তর: একক দাম {(() => { try { return formatMinor(BigInt(w.priceMinor)); } catch { return w.priceMinor; } })()}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      {/* EC29: order items with gift / bundle markers + wrap + gift message */}
                      {(o.items ?? []).length > 0 ? (
                        <div className="space-y-1 border-t pt-3">
                          <p className="text-xs font-semibold text-slate-600">অর্ডারের পণ্য</p>
                          {(o.items ?? []).map((it) => (
                            <div key={it.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                              <span className="font-medium">{it.name} × {it.quantity}</span>
                              {it.isGift ? <span className="rounded bg-pink-100 px-1.5 py-0.5 font-bold text-pink-700">🎁 উপহার</span> : null}
                              {it.bundleName ? <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">বান্ডল: {it.bundleName}</span> : null}
                              <span className="ml-auto font-semibold">{it.isGift ? "৳০" : (() => { try { return formatMinor(BigInt(it.totalMinor)); } catch { return it.totalMinor; } })()}</span>
                            </div>
                          ))}
                          {o.giftWrapMinor !== undefined && Number(o.giftWrapMinor) > 0 ? (
                            <div className="flex justify-between rounded-lg bg-pink-50 px-3 py-1.5 text-xs">
                              <span className="font-medium text-pink-900">🎁 গিফট র‍্যাপ ফি</span>
                              <span className="font-semibold">{(() => { try { return formatMinor(BigInt(o.giftWrapMinor)); } catch { return o.giftWrapMinor; } })()}</span>
                            </div>
                          ) : null}
                          {o.giftSkipped ? (
                            <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">উপহার পণ্যের স্টক শেষ থাকায় এই অর্ডারে উপহার যোগ করা যায়নি।</p>
                          ) : null}
                          {o.giftMessage ? (
                            <div className="rounded-lg border-2 border-pink-300 bg-pink-50 px-3 py-2 text-sm font-semibold text-pink-900">
                              🎁 গিফট বার্তা: {o.giftMessage}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {(o.paymentVerifications ?? []).length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-slate-600">পেমেন্ট যাচাই / অগ্রিমের রেকর্ড</p>
                          {(o.paymentVerifications ?? []).map((pv) => (
                            <div key={pv.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                              <span className="font-medium">{pv.provider ?? "—"}</span>
                              <span className="font-semibold">{(() => { try { return pv.amountMinor != null ? formatMinor(BigInt(pv.amountMinor)) : "—"; } catch { return String(pv.amountMinor ?? "—"); } })()}</span>
                              {pv.trxId ? <span className="font-mono">TrxID: {pv.trxId}</span> : null}
                              <span className="rounded bg-slate-200 px-1.5 py-0.5 font-medium">{pv.status}</span>
                              <span className="text-slate-500">{pv.source === "manual_advance" ? "স্টাফ রেকর্ড" : pv.source ?? ""}</span>
                              <span className="text-slate-400">{new Date(pv.createdAt).toLocaleString("bn-BD")}</span>
                              {pv.note ? <span className="text-slate-500">· {pv.note}</span> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="space-y-2 border-t pt-3">
                        <label className="text-sm font-medium">অগ্রিম পেমেন্ট রেকর্ড করুন</label>
                        {advError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{advError}</p> : null}
                        {advNotice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{advNotice}</p> : null}
                        <div className="grid gap-2 sm:grid-cols-4">
                          <input className="input" placeholder="পরিমাণ (টাকা)" inputMode="decimal" value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} />
                          <select className="input" value={advMethod} onChange={(e) => setAdvMethod(e.target.value)}>
                            <option value="bkash">বিকাশ</option>
                            <option value="nagad">নগদ</option>
                            <option value="rocket">রকেট</option>
                            <option value="cash">ক্যাশ</option>
                            <option value="bank">ব্যাংক</option>
                            <option value="other">অন্যান্য</option>
                          </select>
                          <input className="input" placeholder="রেফারেন্স / TrxID (ঐচ্ছিক)" value={advRef} onChange={(e) => setAdvRef(e.target.value)} />
                          <input className="input" placeholder="নোট (ঐচ্ছিক)" value={advNote} onChange={(e) => setAdvNote(e.target.value)} />
                        </div>
                        <button className="btn-primary btn-sm" disabled={advBusy || advAmount.trim() === ""} onClick={recordAdvance}>
                          {advBusy ? "রেকর্ড হচ্ছে..." : "অগ্রিম রেকর্ড করুন"}
                        </button>
                        <p className="text-xs text-slate-400">স্টাফের রেকর্ড করা অগ্রিম যাচাইকৃত (approved) হিসেবেই ধরা হয় — রেকর্ডকারীই যাচাইকারী।</p>
                      </div>
                    </div>
                    {/* EC31: installment plan for this order */}
                    <div className="space-y-3 rounded-xl border bg-white p-3">
                      <h4 className="text-sm font-semibold">💰 কিস্তি প্ল্যান</h4>
                      {instError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{instError}</p> : null}
                      {!instLoaded ? (
                        <p className="text-xs text-slate-400">লোড হচ্ছে…</p>
                      ) : !instPlan ? (
                        (() => { let due = 0n; try { due = BigInt(o.amountDueMinor ?? "0"); } catch { due = 0n; } return due > 0n ? (
                          <div className="space-y-2">
                            <p className="text-xs text-slate-500">এই অর্ডারে বকেয়া {(() => { try { return formatMinor(BigInt(o.amountDueMinor ?? "0")); } catch { return o.amountDueMinor; } })()} — তা কিস্তিতে ভাগ করে একটি প্ল্যান তৈরি করুন। প্ল্যানের মোট হবে আজকের বকেয়ার স্ন্যাপশট।</p>
                            <div className="grid gap-2 sm:grid-cols-4">
                              <label className="block text-xs font-medium text-slate-600">কিস্তির সংখ্যা (২–২৪)
                                <input className="input mt-1" type="number" min={2} max={24} value={instCount} onChange={(e) => setInstCount(e.target.value)} />
                              </label>
                              <label className="block text-xs font-medium text-slate-600">ব্যবধান দিন (১–৯০)
                                <input className="input mt-1" type="number" min={1} max={90} value={instInterval} onChange={(e) => setInstInterval(e.target.value)} />
                              </label>
                              <label className="block text-xs font-medium text-slate-600">শুরুর তারিখ
                                <input className="input mt-1" type="date" value={instStart} onChange={(e) => setInstStart(e.target.value)} />
                              </label>
                              <label className="block text-xs font-medium text-slate-600">নোট (ঐচ্ছিক)
                                <input className="input mt-1" value={instNote} onChange={(e) => setInstNote(e.target.value)} />
                              </label>
                            </div>
                            <button className="btn-primary btn-sm" disabled={instBusy !== "" || !instStart} onClick={createInstPlan}>
                              {instBusy === "create" ? "তৈরি হচ্ছে..." : "কিস্তি প্ল্যান তৈরি করুন"}
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400">এই অর্ডারে বকেয়া নেই — কিস্তি প্ল্যান দরকার নেই।</p>
                        ); })()
                      ) : (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            <span>মোট: <b>{(() => { try { return formatMinor(BigInt(instPlan.totalMinor)); } catch { return instPlan.totalMinor; } })()}</b></span>
                            <span>পরিশোধিত: <b className="text-emerald-700">{(() => { try { return formatMinor(BigInt(instPlan.paidMinor)); } catch { return instPlan.paidMinor; } })()}</b></span>
                            <span>বাকি: <b>{(() => { try { return formatMinor(BigInt(instPlan.remainingMinor)); } catch { return instPlan.remainingMinor; } })()}</b></span>
                            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${instPlan.status === "active" ? "bg-emerald-100 text-emerald-700" : instPlan.status === "completed" ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-600"}`}>{instPlan.status === "active" ? "সক্রিয়" : instPlan.status === "completed" ? "সম্পূর্ণ" : instPlan.status === "cancelled" ? "বাতিল" : instPlan.status}</span>
                            {instPlan.note ? <span className="text-xs text-slate-500">নোট: {instPlan.note}</span> : null}
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead><tr className="border-b text-slate-500"><th className="py-1.5 pr-2">ক্রম</th><th className="py-1.5 pr-2">তারিখ</th><th className="py-1.5 pr-2">পরিমাণ</th><th className="py-1.5 pr-2">পরিশোধিত</th><th className="py-1.5 pr-2">অবস্থা</th>{instPlan.status === "active" ? <th className="py-1.5">সংগ্রহ</th> : null}</tr></thead>
                              <tbody>
                                {instPlan.items.map((item) => {
                                  const remaining = (() => { try { return BigInt(item.remainingMinor); } catch { return 0n; } })();
                                  const paid = (() => { try { return BigInt(item.paidMinor); } catch { return 0n; } })();
                                  const pill = item.fullyPaid
                                    ? { text: "সম্পূর্ণ পরিশোধিত", cls: "bg-emerald-100 text-emerald-700" }
                                    : item.overdue
                                      ? { text: "অতিবাহিত", cls: "bg-red-100 text-red-700" }
                                      : paid > 0n
                                        ? { text: "আংশিক", cls: "bg-amber-100 text-amber-700" }
                                        : { text: "বাকি", cls: "bg-slate-100 text-slate-600" };
                                  const form = collectForms[item.id];
                                  return (
                                    <tr key={item.id} className="border-b last:border-0 align-top">
                                      <td className="py-2 pr-2 font-medium">{item.seq}</td>
                                      <td className="py-2 pr-2">{item.dueDay}</td>
                                      <td className="py-2 pr-2">{(() => { try { return formatMinor(BigInt(item.amountMinor)); } catch { return item.amountMinor; } })()}</td>
                                      <td className="py-2 pr-2">{(() => { try { return formatMinor(BigInt(item.paidMinor)); } catch { return item.paidMinor; } })()}</td>
                                      <td className="py-2 pr-2"><span className={`rounded px-1.5 py-0.5 font-semibold ${pill.cls}`}>{pill.text}</span></td>
                                      {instPlan.status === "active" ? (
                                        <td className="py-2">
                                          {remaining > 0n && form ? (
                                            <div className="flex flex-wrap items-center gap-1.5">
                                              <input className="input w-24" placeholder="টাকা" inputMode="decimal" value={form.amount} onChange={(e) => setCollectForms((prev) => ({ ...prev, [item.id]: { ...form, amount: e.target.value } }))} />
                                              <select className="input w-auto" value={form.method} onChange={(e) => setCollectForms((prev) => ({ ...prev, [item.id]: { ...form, method: e.target.value } }))}>
                                                <option value="bkash">বিকাশ</option>
                                                <option value="nagad">নগদ</option>
                                                <option value="rocket">রকেট</option>
                                                <option value="cash">ক্যাশ</option>
                                                <option value="bank">ব্যাংক</option>
                                                <option value="other">অন্যান্য</option>
                                              </select>
                                              <input className="input w-32" placeholder="রেফারেন্স (ঐচ্ছিক)" value={form.reference} onChange={(e) => setCollectForms((prev) => ({ ...prev, [item.id]: { ...form, reference: e.target.value } }))} />
                                              <input className="input w-32" placeholder="নোট (ঐচ্ছিক)" value={form.note} onChange={(e) => setCollectForms((prev) => ({ ...prev, [item.id]: { ...form, note: e.target.value } }))} />
                                              <button className="btn-primary btn-sm" disabled={instBusy !== "" || form.amount.trim() === ""} onClick={() => collectInstItem(item)}>
                                                {instBusy === `collect-${item.id}` ? "হচ্ছে..." : "সংগ্রহ করুন"}
                                              </button>
                                            </div>
                                          ) : <span className="text-slate-400">—</span>}
                                        </td>
                                      ) : null}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          {instPlan.status === "active" ? (
                            <button className="btn-ghost btn-sm text-red-600" disabled={instBusy !== ""} onClick={cancelInstPlan}>
                              {instBusy === "cancel" ? "বাতিল হচ্ছে..." : "প্ল্যান বাতিল করুন"}
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <div className="space-y-3 rounded-xl border bg-white p-3">
                      <h4 className="text-sm font-semibold">🏬 স্টোর সিঙ্ক</h4>
                      {syncNotice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{syncNotice}</p> : null}
                      {syncError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{syncError}</p> : null}
                      {pushStateError ? (
                        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">স্টোর সিঙ্কের তথ্য লোড করা যায়নি: {pushStateError}</p>
                      ) : !pushState ? (
                        <p className="text-xs text-slate-400">লোড হচ্ছে…</p>
                      ) : !pushState.store ? (
                        <p className="text-xs text-slate-400">এই অর্ডারের কোনো স্টোর নেই</p>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-sm">
                            <span className="font-medium">{pushState.store.name}</span>
                            <span className="text-slate-500"> ({pushState.store.platform})</span>
                            <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">Sync মোড: {pushState.store.syncMode}</span>
                          </p>
                          {pushState.store.syncMode === "mirror" ? (
                            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">এই স্টোরটি Mirror মোডে আছে — এই মোডে এখানকার কোনো পরিবর্তন স্টোরে Push হবে না। Push চালু করতে Sync Center থেকে মোড co-manage বা full-manage করুন।</p>
                          ) : null}
                          <p className="text-xs text-slate-600">
                            সর্বশেষ Push অবস্থা: <span className="font-medium">{pushState.storeSyncStatus ?? "—"}</span>
                            {pushState.storeDraftId ? <span> · Draft ID: {pushState.storeDraftId}</span> : null}
                          </p>
                          {pushState.storeSyncError ? (
                            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{pushState.storeSyncError}</p>
                          ) : null}
                          {pushState.store.refundPushEnabled ? (
                            <p className="text-xs text-emerald-700">স্টোরে refund push চালু আছে — refund রেকর্ড হলে স্টোরেও পাঠানো হবে।</p>
                          ) : (
                            <p className="text-xs text-amber-700">স্টোরে refund push বন্ধ আছে — শুধু লোকাল রেকর্ড হবে (OWNER চালু করতে পারেন Sync Center থেকে)</p>
                          )}
                          <div className="space-y-1">
                            <p className="text-xs font-semibold text-slate-600">সাম্প্রতিক Push</p>
                            {pushState.recentPushes.length === 0 ? (
                              <p className="text-xs text-slate-400">এখনো কোনো Push হয়নি।</p>
                            ) : pushState.recentPushes.map((p) => (
                              <div key={p.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                                <span className="font-medium">{p.operation}</span>
                                <span className="rounded bg-slate-200 px-1.5 py-0.5 font-medium">{p.status}</span>
                                <span className="text-slate-400">{new Date(p.createdAt).toLocaleString("bn-BD")}</span>
                                {p.lastError ? <span className="text-red-600">{p.lastError}</span> : null}
                              </div>
                            ))}
                          </div>
                          <div className="space-y-2 border-t pt-3">
                            <label className="text-sm font-medium">স্টোরে কাস্টমার-নোট</label>
                            <p className="text-xs text-slate-400">এই নোটটি গ্রাহক স্টোরে দেখতে পাবেন — উপরের অভ্যন্তরীণ নোটের থেকে আলাদা, সেটি কখনো স্টোরে যায় না।</p>
                            <textarea className="input" rows={2} maxLength={2000} placeholder="যেমন: আপনার অর্ডারটি প্যাক করা হয়েছে…" value={storeNoteText} onChange={(e) => setStoreNoteText(e.target.value)} />
                            <button className="btn-primary btn-sm" disabled={syncBusy !== "" || !storeNoteText.trim()} onClick={sendStoreNote}>{syncBusy === "store-note" ? "পাঠানো হচ্ছে..." : "স্টোরে নোট পাঠান"}</button>
                          </div>
                          {pushState.storeInvoiceUrl ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                              <span className="font-medium">ইনভয়েস লিংক:</span>
                              <a className="break-all text-brand-600 hover:underline" href={pushState.storeInvoiceUrl} target="_blank" rel="noreferrer">{pushState.storeInvoiceUrl}</a>
                              <button className="btn-secondary btn-sm" onClick={() => copyText("invoice", pushState.storeInvoiceUrl!)}>{copiedKey === "invoice" ? "কপি হয়েছে ✓" : "ইনভয়েস লিংক কপি করুন"}</button>
                            </div>
                          ) : null}
                          {!pushState.storeDraftId && o.source !== "woocommerce" && o.source !== "shopify" && (pushState.store !== null || !o.storeId) ? (
                            <div className="border-t pt-3">
                              <button className="btn-secondary btn-sm" disabled={syncBusy !== ""} onClick={createStoreDraft}>{syncBusy === "draft" ? "তৈরি হচ্ছে..." : "স্টোরে Draft Order তৈরি করুন"}</button>
                              <p className="mt-1 text-xs text-slate-400">এই অর্ডারটি এখনো স্টোরে তৈরি হয়নি — Draft হিসেবে স্টোরে তৈরি করা হবে।</p>
                            </div>
                          ) : null}
                        </div>
                      )}
                      {pushState && !pushState.store && !pushState.storeDraftId && o.source !== "woocommerce" && o.source !== "shopify" && !o.storeId ? (
                        <div className="border-t pt-3">
                          <button className="btn-secondary btn-sm" disabled={syncBusy !== ""} onClick={createStoreDraft}>{syncBusy === "draft" ? "তৈরি হচ্ছে..." : "স্টোরে Draft Order তৈরি করুন"}</button>
                          <p className="mt-1 text-xs text-slate-400">এই অর্ডারের নিজের কোনো স্টোর নেই — একটিমাত্র co-manage/full-manage স্টোর থাকলে সেখানেই Draft তৈরি হবে, না হলে সার্ভারের কারণটি দেখানো হবে।</p>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                        <button className="btn-secondary btn-sm" disabled={syncBusy !== ""} onClick={createReturnLink}>{syncBusy === "return-link" ? "তৈরি হচ্ছে..." : "রিটার্ন লিংক তৈরি করুন"}</button>
                        <a className="btn-secondary btn-sm" href={`/dashboard/commerce/print?orderId=${o.id}&kind=invoice`} target="_blank" rel="noreferrer">🧾 ইনভয়েস প্রিন্ট</a>
                        <a className="btn-secondary btn-sm" href={`/dashboard/commerce/print?orderId=${o.id}&kind=slip`} target="_blank" rel="noreferrer">🏷️ প্যাকিং স্লিপ প্রিন্ট</a>
                      </div>
                      {returnUrl ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                          <span className="font-medium">রিটার্ন লিংক:</span>
                          <a className="break-all text-brand-600 hover:underline" href={returnUrl} target="_blank" rel="noreferrer">{returnUrl}</a>
                          <button className="btn-secondary btn-sm" onClick={() => copyText("return", returnUrl)}>{copiedKey === "return" ? "কপি হয়েছে ✓" : "লিংক কপি করুন"}</button>
                        </div>
                      ) : null}
                    </div>
                    <div className="space-y-2 rounded-xl border bg-white p-3">
                      <h4 className="text-sm font-semibold">🛵 রাইডার ডেলিভারি (নিজস্ব)</h4>
                      {(() => { const active = orderAssignments.find((a) => a.status === "assigned" || a.status === "picked_up") ?? orderAssignments[0]; return active ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium">{active.riderName ?? active.riderId}</span>
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${active.status === "delivered" ? "bg-green-100 text-green-700" : active.status === "returned" ? "bg-red-100 text-red-700" : active.status === "picked_up" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{active.status === "assigned" ? "বরাদ্দ হয়েছে" : active.status === "picked_up" ? "তোলা হয়েছে" : active.status === "delivered" ? "ডেলিভারি সম্পন্ন" : active.status === "returned" ? "ফেরত" : active.status}</span>
                          {active.status === "assigned" ? <button type="button" className="btn-secondary btn-sm" disabled={riderBusy !== ""} onClick={() => transitionAssignment(active, "picked_up")}>তোলা হয়েছে</button> : null}
                          {active.status === "picked_up" ? <>
                            <button type="button" className="btn-primary btn-sm" disabled={riderBusy !== ""} onClick={() => transitionAssignment(active, "delivered")}>ডেলিভারি সম্পন্ন</button>
                            <button type="button" className="btn-secondary btn-sm text-red-600" disabled={riderBusy !== ""} onClick={() => transitionAssignment(active, "returned")}>ফেরত</button>
                          </> : null}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <select className="input w-auto" value={assignRiderId} onChange={(e) => setAssignRiderId(e.target.value)}>
                            <option value="">রাইডার বেছে নিন</option>
                            {riders.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                          <button type="button" className="btn-primary btn-sm" disabled={riderBusy !== "" || !assignRiderId} onClick={assignRider}>{riderBusy === "assign" ? "হচ্ছে…" : "রাইডার বরাদ্দ করুন"}</button>
                          {riders.filter((r) => r.active).length === 0 ? <span className="text-xs text-slate-400">সক্রিয় রাইডার নেই — গুদাম পেজের রাইডার ট্যাব থেকে যোগ করুন।</span> : null}
                        </div>
                      ); })()}
                    </div>
                    {(() => { const rv = reviewForOrder(o.id); return rv ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                        <div className="text-sm font-semibold">⭐ গ্রাহক রিভিউ — {reviewStatusBn(rv)}</div>
                        {rv.rating != null ? <div className="mt-1 text-base text-amber-500">{stars(rv.rating)} <span className="text-sm text-slate-600">({rv.rating}/৫)</span></div> : null}
                        {rv.comment ? <p className="mt-1 text-sm text-slate-700">“{rv.comment}”</p> : null}
                        <p className="mt-1 text-xs text-slate-400">{rv.receivedAt ? `পাওয়া গেছে: ${new Date(rv.receivedAt).toLocaleString("bn-BD")}` : rv.requestedAt ? `চাওয়া হয়েছে: ${new Date(rv.requestedAt).toLocaleString("bn-BD")}` : "কোনো চ্যানেল পাওয়া যায়নি বলে এখনো পাঠানো হয়নি"}{rv.source ? ` · মাধ্যম: ${rv.source === "chat" ? "চ্যাট" : "লিংক"}` : ""}</p>
                      </div>
                    ) : null; })()}
                  </div>
                </td></tr>
              ); })() : null}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
