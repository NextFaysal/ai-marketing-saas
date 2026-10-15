"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState, Skeleton } from "@repo/ui";
import type { LabelScanResultView, LabelMatchView } from "@/lib/cx8";

// Sub-components & Types
import {
  type Order,
  type Stats,
  type Shipment,
  type CourierRule,
  type CourierSuggestion,
  type RiderRow,
  type DeliveryAssignmentRow,
  type CourierPerformance,
  type ReviewRow,
  type ChaseRow,
  type RiskDetail,
  type PushState,
  type InstallmentPlan,
  type InstallmentItemRow,
} from "./components/types";
import { OrdersHeader } from "./components/OrdersHeader";
import { OrdersKpiBar } from "./components/OrdersKpiBar";
import { OrdersFilterBar } from "./components/OrdersFilterBar";
import { OrdersTable } from "./components/OrdersTable";
import { OrdersFloatingBulk } from "./components/OrdersFloatingBulk";
import { OrderDrawer } from "./components/OrderDrawer";
import { CourierHubModal } from "./components/CourierHubModal";
import { LabelScannerModal } from "./components/LabelScannerModal";
import { DuplicatesModal } from "./components/DuplicatesModal";
import { RiskModal } from "./components/RiskModal";

export default function OrdersPage() {
  const [items, setItems] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState("");
  const [codOnly, setCodOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Selected orders for bulk operations
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkProvider, setBulkProvider] = useState("steadfast");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResults, setBulkResults] = useState<{
    requested: number;
    booked: number;
    skipped: number;
    failed: number;
    results: { orderId: string; ok: boolean; skipped?: boolean; trackingCode?: string; error?: string }[];
  } | null>(null);

  // Courier connections & shipments
  const [courier, setCourier] = useState<{ connected: boolean } | null>(null);
  const [courierForm, setCourierForm] = useState({ apiKey: "", secretKey: "" });
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [conns, setConns] = useState<{ provider: string; connected: boolean; id?: string; trackingUrlTemplate?: string | null }[]>([]);
  const [pathaoForm, setPathaoForm] = useState({ clientId: "", clientSecret: "", username: "", password: "", sandbox: false });
  const [redxForm, setRedxForm] = useState({ accessToken: "", baseUrl: "" });
  const [courierBusy, setCourierBusy] = useState("");
  const [courierNotice, setCourierNotice] = useState("");

  // Courier booking form
  const [bookForm, setBookForm] = useState({
    name: "",
    phone: "",
    address: "",
    note: "",
    provider: "steadfast",
    pStoreId: "",
    pCityId: "",
    pZoneId: "",
    pAreaId: "",
    weightKg: "0.5",
    rAreaId: "",
    rAreaName: "",
    rStoreId: "",
  });
  const [pStores, setPStores] = useState<any[]>([]);
  const [pCities, setPCities] = useState<any[]>([]);
  const [pZones, setPZones] = useState<any[]>([]);
  const [pAreas, setPAreas] = useState<any[]>([]);
  const [rAreas, setRAreas] = useState<any[]>([]);
  const [rStores, setRStores] = useState<any[]>([]);
  const [quoteOut, setQuoteOut] = useState<any>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [bookSuggestion, setBookSuggestion] = useState<CourierSuggestion | null>(null);

  // Rules & tracking templates
  const [courierRules, setCourierRules] = useState<CourierRule[]>([]);
  const [ruleForm, setRuleForm] = useState({
    name: "",
    provider: "",
    courierAccountId: "",
    priority: "10",
    districts: "",
    minWeightGrams: "",
    maxWeightGrams: "",
    minOrderTaka: "",
    maxOrderTaka: "",
    paymentType: "",
    active: true,
  });
  const [editingRule, setEditingRule] = useState<CourierRule | null>(null);
  const [ruleBusy, setRuleBusy] = useState("");
  const [ruleNotice, setRuleNotice] = useState("");
  const [trackingTemplates, setTrackingTemplates] = useState<Record<string, string>>({});

  // Riders & Assignments
  const [riders, setRiders] = useState<RiderRow[]>([]);
  const [orderAssignments, setOrderAssignments] = useState<DeliveryAssignmentRow[]>([]);
  const [assignRiderId, setAssignRiderId] = useState("");
  const [riderBusy, setRiderBusy] = useState("");

  // Courier performance
  const [perfDays, setPerfDays] = useState(30);
  const [perf, setPerf] = useState<CourierPerformance | null>(null);

  // Reviews & Chases
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [chases, setChases] = useState<ChaseRow[]>([]);

  // Duplicate detection & merge
  const [duplicateData, setDuplicateData] = useState<{ totalGroups: number; totalDuplicateOrders: number; groups: any[] } | null>(null);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  const [mergeBusy, setMergeBusy] = useState("");

  // Label scan (CX8)
  const [isLabelScannerOpen, setIsLabelScannerOpen] = useState(false);
  const [labelQuery, setLabelQuery] = useState("");
  const [labelScan, setLabelScan] = useState<LabelScanResultView | null>(null);
  const [labelBusy, setLabelBusy] = useState("");
  const [labelError, setLabelError] = useState("");

  // Modals & Drawer State
  const [isCourierHubOpen, setIsCourierHubOpen] = useState(false);
  const [riskDetail, setRiskDetail] = useState<(RiskDetail & { orderLabel: string }) | null>(null);
  const [actOrder, setActOrder] = useState<Order | null>(null);
  const [drawerTab, setDrawerTab] = useState<"overview" | "courier" | "payment" | "store" | "rider">("overview");

  // Order Action states
  const [actStatus, setActStatus] = useState("");
  const [actRefundTaka, setActRefundTaka] = useState("");
  const [actRefundReason, setActRefundReason] = useState("");
  const [actNote, setActNote] = useState("");
  const [actBusy, setActBusy] = useState("");
  const [actNotice, setActNotice] = useState("");

  // Advance Payment
  const [advAmount, setAdvAmount] = useState("");
  const [advMethod, setAdvMethod] = useState("bkash");
  const [advRef, setAdvRef] = useState("");
  const [advNote, setAdvNote] = useState("");
  const [advBusy, setAdvBusy] = useState(false);
  const [advError, setAdvError] = useState("");
  const [advNotice, setAdvNotice] = useState("");

  // Installment plan
  const [instPlan, setInstPlan] = useState<InstallmentPlan | null>(null);
  const [instLoaded, setInstLoaded] = useState(false);
  const [instError, setInstError] = useState("");
  const [instBusy, setInstBusy] = useState("");
  const [instCount, setInstCount] = useState("3");
  const [instInterval, setInstInterval] = useState("30");
  const [instStart, setInstStart] = useState("");
  const [instNote, setInstNote] = useState("");
  const [collectForms, setCollectForms] = useState<Record<string, { amount: string; method: string; reference: string; note: string }>>({});

  // Store Sync
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [pushStateError, setPushStateError] = useState("");
  const [storeNoteText, setStoreNoteText] = useState("");
  const [syncBusy, setSyncBusy] = useState("");
  const [syncNotice, setSyncNotice] = useState("");
  const [syncError, setSyncError] = useState("");
  const [returnUrl, setReturnUrl] = useState("");
  const [copiedKey, setCopiedKey] = useState("");

  const orgId = typeof window !== "undefined" ? getOrganizationId() ?? "" : "";

  // 1. Load Orders & Stats
  const load = useCallback(async () => {
    if (!orgId) {
      setError("কোনো Organization নির্বাচিত নেই।");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: "50" });
      if (status) params.set("status", status);
      if (codOnly) params.set("cod", "true");
      const [list, st] = await Promise.all([
        apiFetch<{ total: number; items: Order[] }>(`/organizations/${orgId}/orders?${params}`),
        apiFetch<Stats>(`/organizations/${orgId}/orders/stats`),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setStats(st);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [orgId, status, codOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  // 2. Load Duplicates
  const loadDuplicates = useCallback(async () => {
    if (!orgId) return;
    try {
      const d = await apiFetch<{ totalGroups: number; totalDuplicateOrders: number; groups: any[] }>(
        `/organizations/${orgId}/orders/duplicates`
      );
      setDuplicateData(d);
    } catch {
      setDuplicateData(null);
    }
  }, [orgId]);

  useEffect(() => {
    void loadDuplicates();
  }, [loadDuplicates]);

  // Merge group
  async function mergeGroup(primaryOrderId: string, duplicateOrderIds: string[]) {
    if (!orgId) return;
    setMergeBusy(primaryOrderId);
    try {
      await apiFetch(`/organizations/${orgId}/orders/merge`, {
        method: "POST",
        body: JSON.stringify({ primaryOrderId, duplicateOrderIds, mergeReason: "Dashboard 1-click merge" }),
      });
      await loadDuplicates();
      await load();
    } catch (e: any) {
      alert(e.message || "মার্জ করতে সমস্যা হয়েছে");
    } finally {
      setMergeBusy("");
    }
  }

  // 3. Load Courier data
  const loadCourier = useCallback(async () => {
    if (!orgId) return;
    try {
      const [conn, ships, allConns] = await Promise.all([
        apiFetch<{ connected: boolean }>(`/organizations/${orgId}/courier/connection`),
        apiFetch<Shipment[]>(`/organizations/${orgId}/courier/shipments`),
        apiFetch<{ provider: string; connected: boolean; id?: string; trackingUrlTemplate?: string | null }[]>(
          `/organizations/${orgId}/courier/connections`
        ).catch(() => []),
      ]);
      setCourier(conn);
      setShipments(ships);
      setConns(allConns as any);
      setTrackingTemplates((prev) => {
        const next = { ...prev };
        for (const c of allConns as { provider: string; trackingUrlTemplate?: string | null }[]) {
          if (next[c.provider] === undefined) next[c.provider] = c.trackingUrlTemplate ?? "";
        }
        return next;
      });
      apiFetch<CourierRule[]>(`/organizations/${orgId}/courier/rules`).then(setCourierRules).catch(() => setCourierRules([]));
      apiFetch<RiderRow[]>(`/organizations/${orgId}/delivery/riders`).then(setRiders).catch(() => setRiders([]));
    } catch {
      /* optional */
    }
  }, [orgId]);

  useEffect(() => {
    void loadCourier();
  }, [loadCourier]);

  // 4. Load Performance, Reviews, Chases
  useEffect(() => {
    if (!orgId) return;
    apiFetch<CourierPerformance>(`/organizations/${orgId}/courier/performance?days=${perfDays}`)
      .then(setPerf)
      .catch(() => setPerf(null));
  }, [orgId, perfDays]);

  useEffect(() => {
    if (!orgId) return;
    apiFetch<ReviewRow[]>(`/organizations/${orgId}/reviews`).then(setReviews).catch(() => setReviews([]));
    apiFetch<ChaseRow[]>(`/organizations/${orgId}/order-chases`).then(setChases).catch(() => setChases([]));
  }, [orgId]);

  // Open Drawer handler
  function openOrderDrawer(o: Order, defaultTab: "overview" | "courier" | "payment" | "store" | "rider" = "overview") {
    setActOrder(o);
    setDrawerTab(defaultTab);
    setActStatus(o.status);
    setActNote(o.internalNote ?? "");
    setActRefundTaka("");
    setActRefundReason("");
    setActNotice("");
    setQuoteOut(null);

    const firstConnected = conns.find((c) => c.connected)?.provider ?? "steadfast";
    setBookForm({
      name: [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" "),
      phone: o.customer?.phone ?? "",
      address: "",
      note: "",
      provider: firstConnected,
      pStoreId: "",
      pCityId: "",
      pZoneId: "",
      pAreaId: "",
      weightKg: "0.5",
      rAreaId: "",
      rAreaName: "",
      rStoreId: "",
    });
    setBookSuggestion(null);

    if (defaultTab === "courier") {
      void loadProviderLists(firstConnected);
      void loadSuggestion(o.id);
    }
  }

  // Load push state whenever order drawer changes
  const actOrderId = actOrder?.id ?? null;
  const loadPushState = useCallback(async (orderId: string) => {
    if (!orgId) return;
    try {
      const ps = await apiFetch<PushState>(`/organizations/${orgId}/commerce/orders/${orderId}/push-state`);
      setPushState(ps);
      setPushStateError("");
    } catch (err) {
      setPushState(null);
      setPushStateError(err instanceof Error ? err.message : "স্টোর সিঙ্কের তথ্য লোড ব্যর্থ হয়েছে");
    }
  }, [orgId]);

  useEffect(() => {
    setPushState(null);
    setPushStateError("");
    setStoreNoteText("");
    setSyncNotice("");
    setSyncError("");
    setReturnUrl("");
    setCopiedKey("");
    setAdvAmount("");
    setAdvRef("");
    setAdvNote("");
    setAdvError("");
    setAdvNotice("");
    if (actOrderId) void loadPushState(actOrderId);
  }, [actOrderId, loadPushState]);

  // Enrich order detail
  useEffect(() => {
    if (!actOrderId || !orgId) return;
    let alive = true;
    apiFetch<Order>(`/organizations/${orgId}/orders/${actOrderId}`)
      .then((detail) => {
        if (!alive || !detail) return;
        setActOrder((prev) => (prev && prev.id === detail.id ? { ...prev, ...detail } : prev));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [actOrderId, orgId]);

  // Installment plan loader
  useEffect(() => {
    setInstPlan(null);
    setInstLoaded(false);
    setInstError("");
    setCollectForms({});
    setInstCount("3");
    setInstInterval("30");
    setInstNote("");
    setInstStart(() => {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${d.getFullYear()}-${mm}-${dd}`;
    });
    if (!actOrderId || !orgId) {
      setInstLoaded(true);
      return;
    }
    let alive = true;
    apiFetch<InstallmentPlan>(`/organizations/${orgId}/orders/${actOrderId}/installment-plan`)
      .then((plan) => {
        if (alive) {
          setInstPlan(plan ?? null);
          setInstLoaded(true);
        }
      })
      .catch(() => {
        if (alive) {
          setInstPlan(null);
          setInstLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [actOrderId, orgId]);

  // Prefill installment forms
  useEffect(() => {
    if (!instPlan) return;
    setCollectForms((prev) => {
      const next = { ...prev };
      for (const item of instPlan.items) {
        if (!next[item.id]) {
          let amount = "";
          try {
            const v = BigInt(item.remainingMinor);
            const whole = v / 100n;
            const frac = v % 100n;
            amount = frac === 0n ? whole.toString() : `${whole.toString()}.${String(frac).padStart(2, "0")}`;
          } catch {
            amount = "";
          }
          next[item.id] = { amount, method: "bkash", reference: "", note: "" };
        }
      }
      return next;
    });
  }, [instPlan]);

  // Rider assignments for opened order
  const loadOrderAssignments = useCallback(
    async (orderId: string) => {
      if (!orgId) return;
      try {
        setOrderAssignments(
          await apiFetch<DeliveryAssignmentRow[]>(
            `/organizations/${orgId}/delivery/assignments?orderId=${encodeURIComponent(orderId)}`
          )
        );
      } catch {
        setOrderAssignments([]);
      }
    },
    [orgId]
  );

  useEffect(() => {
    setOrderAssignments([]);
    setAssignRiderId("");
    if (actOrderId) void loadOrderAssignments(actOrderId);
  }, [actOrderId, loadOrderAssignments]);

  // Helper actions
  async function patchOrder(body: Record<string, unknown>, okMessage: string) {
    if (!orgId || !actOrder) return;
    setActBusy("save");
    setActNotice("");
    try {
      const updated = await apiFetch<Order>(`/organizations/${orgId}/orders/${actOrder.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setActOrder(updated);
      setActStatus(updated.status);
      setActNote(updated.internalNote ?? "");
      setActNotice(okMessage);
      await load();
    } catch (err) {
      setActNotice(err instanceof Error ? err.message : "সংরক্ষণ ব্যর্থ");
    } finally {
      setActBusy("");
    }
  }

  async function saveStatus() {
    if (actOrder) await patchOrder({ status: actStatus }, "স্ট্যাটাস সংরক্ষণ হয়েছে।");
  }

  async function saveRefund() {
    if (!actOrder) return;
    const raw = actRefundTaka.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      setActNotice("টাকার পরিমাণ ঠিকভাবে লিখুন (সর্বোচ্চ ২ ঘর দশমিক)।");
      return;
    }
    const minor = BigInt(Math.round(Number(raw) * 100));
    if (minor <= 0n) {
      setActNotice("Refund-এর পরিমাণ ০-এর বেশি হতে হবে।");
      return;
    }
    await patchOrder(
      { refund: { amountMinor: minor.toString(), reason: actRefundReason.trim() || undefined } },
      "Refund রেকর্ড হয়েছে।"
    );
    setActRefundTaka("");
    setActRefundReason("");
  }

  async function saveNote() {
    await patchOrder({ internalNote: actNote }, "নোট সংরক্ষণ হয়েছে।");
  }
  async function clearNote() {
    await patchOrder({ internalNote: null }, "নোট মুছে ফেলা হয়েছে।");
  }

  async function recordAdvance() {
    if (!orgId || !actOrder) return;
    const raw = advAmount.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      setAdvError("টাকার পরিমাণ ঠিকভাবে লিখুন (যেমন: 200 বা 200.50)।");
      return;
    }
    const minor = BigInt(Math.round(Number(raw) * 100));
    if (minor <= 0n) {
      setAdvError("অগ্রিমের পরিমাণ ০-এর বেশি হতে হবে।");
      return;
    }
    setAdvBusy(true);
    setAdvError("");
    setAdvNotice("");
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
      setActOrder((prev) => (prev ? { ...prev, ...updated } : updated));
      setAdvAmount("");
      setAdvRef("");
      setAdvNote("");
      setAdvNotice("অগ্রিম পেমেন্ট রেকর্ড হয়েছে।");
      await load();
    } catch (err) {
      setAdvError(err instanceof Error ? err.message : "অগ্রিম রেকর্ড ব্যর্থ");
    } finally {
      setAdvBusy(false);
    }
  }

  function applyInstPlan(plan: InstallmentPlan) {
    setInstPlan(plan);
    if (plan.orderAmountDueMinor !== undefined) {
      setActOrder((prev) => (prev && prev.id === plan.orderId ? { ...prev, amountDueMinor: plan.orderAmountDueMinor } : prev));
    }
  }

  async function createInstPlan() {
    if (!orgId || !actOrder) return;
    setInstBusy("create");
    setInstError("");
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
    } catch (err) {
      setInstError(err instanceof Error ? err.message : "কিস্তি প্ল্যান তৈরি ব্যর্থ");
    } finally {
      setInstBusy("");
    }
  }

  async function collectInstItem(item: InstallmentItemRow) {
    if (!orgId) return;
    const form = collectForms[item.id];
    if (!form) return;
    const raw = form.amount.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      setInstError("টাকার পরিমাণ ঠিকভাবে লিখুন (যেমন: 200 বা 200.50)।");
      return;
    }
    const minor = BigInt(Math.round(Number(raw) * 100));
    if (minor <= 0n) {
      setInstError("সংগ্রহের পরিমাণ ০-এর বেশি হতে হবে।");
      return;
    }
    setInstBusy(`collect-${item.id}`);
    setInstError("");
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
    } catch (err) {
      setInstError(err instanceof Error ? err.message : "সংগ্রহ রেকর্ড ব্যর্থ");
    } finally {
      setInstBusy("");
    }
  }

  async function cancelInstPlan() {
    if (!orgId || !instPlan) return;
    if (!window.confirm("এই কিস্তি প্ল্যানটি বাতিল করবেন? ইতিমধ্যে সংগ্রহ করা টাকা সংগ্রহ হিসেবেই থাকবে।")) return;
    setInstBusy("cancel");
    setInstError("");
    try {
      const plan = await apiFetch<InstallmentPlan>(`/organizations/${orgId}/installments/${instPlan.id}/cancel`, {
        method: "POST",
      });
      applyInstPlan(plan);
      await load();
    } catch (err) {
      setInstError(err instanceof Error ? err.message : "প্ল্যান বাতিল ব্যর্থ");
    } finally {
      setInstBusy("");
    }
  }

  // Store Sync Helpers
  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
    } catch {
      setSyncError("কপি করা যায়নি — লিংকটি হাতে কপি করুন।");
    }
  }

  async function sendStoreNote() {
    if (!orgId || !actOrder || !storeNoteText.trim()) return;
    setSyncBusy("store-note");
    setSyncNotice("");
    setSyncError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/${actOrder.id}/store-note`, {
        method: "POST",
        body: JSON.stringify({ note: storeNoteText.trim() }),
      });
      setSyncNotice("নোট স্টোরে পাঠানোর জন্য queue-তে দেওয়া হয়েছে");
      setStoreNoteText("");
      await loadPushState(actOrder.id);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "স্টোরে নোট পাঠানো ব্যর্থ");
    } finally {
      setSyncBusy("");
    }
  }

  async function createStoreDraft() {
    if (!orgId || !actOrder) return;
    setSyncBusy("draft");
    setSyncNotice("");
    setSyncError("");
    try {
      const updated = await apiFetch<Order>(`/organizations/${orgId}/orders/${actOrder.id}/create-store-draft`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setActOrder(updated);
      setSyncNotice("স্টোরে Draft Order তৈরি হয়েছে।");
      await loadPushState(actOrder.id);
      await load();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Draft Order তৈরি ব্যর্থ");
    } finally {
      setSyncBusy("");
    }
  }

  async function createReturnLink() {
    if (!orgId || !actOrder) return;
    setSyncBusy("return-link");
    setSyncNotice("");
    setSyncError("");
    try {
      const out = await apiFetch<{ token: string }>(`/organizations/${orgId}/orders/${actOrder.id}/return-link`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setReturnUrl(`${window.location.origin}/returns/${out.token}`);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "রিটার্ন লিংক তৈরি ব্যর্থ");
    } finally {
      setSyncBusy("");
    }
  }

  // Courier booking & list helpers
  async function loadProviderLists(provider: string) {
    if (!orgId) return;
    try {
      if (provider === "pathao") {
        const [stores, cities] = await Promise.all([
          apiFetch<any[]>(`/organizations/${orgId}/courier/pathao/stores`).catch(() => []),
          apiFetch<any[]>(`/organizations/${orgId}/courier/pathao/cities`).catch(() => []),
        ]);
        setPStores(stores);
        setPCities(cities);
      } else if (provider === "redx") {
        const [areas, stores] = await Promise.all([
          apiFetch<any[]>(`/organizations/${orgId}/courier/redx/areas`).catch(() => []),
          apiFetch<any[]>(`/organizations/${orgId}/courier/redx/stores`).catch(() => []),
        ]);
        setRAreas(areas);
        setRStores(stores);
      }
    } catch {
      /* ignore */
    }
  }

  async function loadSuggestion(orderId: string) {
    if (!orgId) return;
    try {
      const s = await apiFetch<CourierSuggestion>(`/organizations/${orgId}/courier/suggestion/${orderId}`);
      setBookSuggestion(s);
      if (s && s.ruleId && s.provider) {
        setBookForm((prev) => ({ ...prev, provider: s.provider as string }));
        void loadProviderLists(s.provider);
      }
    } catch {
      setBookSuggestion(null);
    }
  }

  async function fetchQuote(order: Order) {
    if (!orgId) return;
    setQuoteBusy(true);
    setQuoteOut(null);
    try {
      const q = await apiFetch<any>(`/organizations/${orgId}/courier/quote`, {
        method: "POST",
        body: JSON.stringify({
          provider: bookForm.provider,
          orderId: order.id,
          weightKg: Number(bookForm.weightKg) || 0.5,
          pathao:
            bookForm.provider === "pathao"
              ? {
                  storeId: bookForm.pStoreId ? Number(bookForm.pStoreId) : undefined,
                  cityId: bookForm.pCityId ? Number(bookForm.pCityId) : undefined,
                  zoneId: bookForm.pZoneId ? Number(bookForm.pZoneId) : undefined,
                  itemWeightKg: Number(bookForm.weightKg) || 0.5,
                }
              : undefined,
          redx:
            bookForm.provider === "redx"
              ? {
                  deliveryAreaId: bookForm.rAreaId ? Number(bookForm.rAreaId) : undefined,
                  parcelWeightKg: Number(bookForm.weightKg) || 0.5,
                }
              : undefined,
        }),
      });
      setQuoteOut(q);
    } catch (err) {
      setQuoteOut({ quotable: false, reason: err instanceof Error ? err.message : "চার্জ জানা যায়নি" });
    } finally {
      setQuoteBusy(false);
    }
  }

  async function bookShipment(order: Order) {
    if (!orgId) return;
    setCourierBusy("book");
    setCourierNotice("");
    try {
      const s = await apiFetch<Shipment>(`/organizations/${orgId}/courier/shipments`, {
        method: "POST",
        body: JSON.stringify({
          orderId: order.id,
          provider: bookForm.provider,
          recipientName: bookForm.name || undefined,
          recipientPhone: bookForm.phone || undefined,
          recipientAddress: bookForm.address,
          note: bookForm.note || undefined,
          pathao:
            bookForm.provider === "pathao"
              ? {
                  storeId: bookForm.pStoreId ? Number(bookForm.pStoreId) : undefined,
                  cityId: bookForm.pCityId ? Number(bookForm.pCityId) : undefined,
                  zoneId: bookForm.pZoneId ? Number(bookForm.pZoneId) : undefined,
                  areaId: bookForm.pAreaId ? Number(bookForm.pAreaId) : undefined,
                  itemWeightKg: Number(bookForm.weightKg) || 0.5,
                }
              : undefined,
          redx:
            bookForm.provider === "redx"
              ? {
                  deliveryAreaId: bookForm.rAreaId ? Number(bookForm.rAreaId) : undefined,
                  deliveryArea: bookForm.rAreaName || undefined,
                  pickupStoreId: bookForm.rStoreId ? Number(bookForm.rStoreId) : undefined,
                  parcelWeightKg: Number(bookForm.weightKg) || 0.5,
                }
              : undefined,
        }),
      });
      setCourierNotice(`পার্সেল বুক হয়েছে — Tracking: ${s.trackingCode} (স্ট্যাটাস: ${s.status})`);
      await loadCourier();
    } catch (err) {
      setCourierNotice(err instanceof Error ? err.message : "Booking ব্যর্থ");
    } finally {
      setCourierBusy("");
    }
  }

  async function syncShipment(id: string) {
    if (!orgId) return;
    setCourierBusy("sync");
    try {
      const s = await apiFetch<Shipment>(`/organizations/${orgId}/courier/shipments/${id}/sync`, { method: "POST" });
      setCourierNotice(`স্ট্যাটাস আপডেট: ${s.status}`);
      await loadCourier();
    } catch (err) {
      setCourierNotice(err instanceof Error ? err.message : "Sync ব্যর্থ");
    } finally {
      setCourierBusy("");
    }
  }

  async function downloadPdf(path: string, filename: string) {
    try {
      const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) {
        const body: any = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setCourierNotice(err instanceof Error ? err.message : "PDF ডাউনলোড ব্যর্থ");
    }
  }

  async function downloadExport() {
    if (!orgId) return;
    setExportBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (codOnly) params.set("cod", "true");
      const qs = params.toString();
      const res = await fetch(`${API_URL}/organizations/${orgId}/orders/export${qs ? `?${qs}` : ""}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) {
        const body: any = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "orders-export.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "এক্সপোর্ট ব্যর্থ");
    } finally {
      setExportBusy(false);
    }
  }

  // Bulk actions
  function toggleSelect(orderId: string, on: boolean) {
    setSelected((prev) => {
      if (on) return prev.includes(orderId) || prev.length >= 50 ? prev : [...prev, orderId];
      return prev.filter((x) => x !== orderId);
    });
  }

  async function bulkBook() {
    if (!orgId || selected.length === 0) return;
    setBulkBusy(true);
    setBulkResults(null);
    try {
      const out = await apiFetch<any>(`/organizations/${orgId}/courier/shipments/bulk`, {
        method: "POST",
        body: JSON.stringify({
          provider: bulkProvider,
          orderIds: selected,
          pathao: bulkProvider === "pathao" ? {} : undefined,
          redx:
            bulkProvider === "redx"
              ? {
                  deliveryAreaId: bookForm.rAreaId ? Number(bookForm.rAreaId) : undefined,
                  deliveryArea: bookForm.rAreaName || undefined,
                  parcelWeightKg: 0.5,
                }
              : undefined,
        }),
      });
      setBulkResults(out);
      setCourierNotice(
        `বাল্ক বুকিং শেষ: ${out.booked}টি বুক হয়েছে, ${out.skipped}টি আগে থেকেই বুক ছিল, ${out.failed}টি ব্যর্থ`
      );
      await loadCourier();
    } catch (err) {
      setCourierNotice(err instanceof Error ? err.message : "বাল্ক বুকিং ব্যর্থ");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkLabels() {
    if (!orgId) return;
    const ids = selected.map((oid) => shipments.find((s) => s.orderId === oid)?.id).filter(Boolean) as string[];
    if (ids.length === 0) {
      setCourierNotice("বেছে নেওয়া অর্ডারগুলোর কোনো পার্সেল এখনো বুক হয়নি");
      return;
    }
    await downloadPdf(`/organizations/${orgId}/courier/labels.pdf?ids=${ids.join(",")}`, "labels.pdf");
  }

  // Rider assignment actions
  async function assignRider() {
    if (!orgId || !actOrder || !assignRiderId) return;
    setRiderBusy("assign");
    try {
      await apiFetch(`/organizations/${orgId}/delivery/assignments`, {
        method: "POST",
        body: JSON.stringify({ orderId: actOrder.id, riderId: assignRiderId }),
      });
      await loadOrderAssignments(actOrder.id);
    } catch (err) {
      setCourierNotice(err instanceof Error ? err.message : "রাইডার বরাদ্দ ব্যর্থ");
    } finally {
      setRiderBusy("");
    }
  }

  async function transitionAssignment(a: DeliveryAssignmentRow, st: string) {
    if (!orgId || !actOrder) return;
    setRiderBusy(`tr-${a.id}`);
    try {
      await apiFetch(`/organizations/${orgId}/delivery/assignments/${a.id}/transition`, {
        method: "POST",
        body: JSON.stringify({ status: st }),
      });
      await loadOrderAssignments(actOrder.id);
    } catch (err) {
      setCourierNotice(err instanceof Error ? err.message : "অবস্থা বদল ব্যর্থ");
    } finally {
      setRiderBusy("");
    }
  }

  // Courier connections connect/disconnect
  async function connectCourier(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setCourierBusy("connect");
    setCourierNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connect`, { method: "POST", body: JSON.stringify(courierForm) });
      setCourierNotice("Steadfast যুক্ত হয়েছে (আসল API দিয়ে যাচাই করা)।");
      setCourierForm({ apiKey: "", secretKey: "" });
      await loadCourier();
    } catch (err) {
      setCourierNotice(err instanceof Error ? err.message : "Connect ব্যর্থ");
    } finally {
      setCourierBusy("");
    }
  }

  async function connectPathao(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setCourierBusy("pathao");
    setCourierNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connect`, {
        method: "POST",
        body: JSON.stringify({
          provider: "pathao",
          clientId: pathaoForm.clientId,
          clientSecret: pathaoForm.clientSecret,
          username: pathaoForm.username,
          password: pathaoForm.password,
          baseUrl: pathaoForm.sandbox ? "https://courier-api-sandbox.pathao.com" : undefined,
        }),
      });
      setCourierNotice("Pathao যুক্ত হয়েছে।");
      setPathaoForm({ clientId: "", clientSecret: "", username: "", password: "", sandbox: false });
      await loadCourier();
    } catch (err) {
      setCourierNotice(err instanceof Error ? err.message : "Pathao connect ব্যর্থ");
    } finally {
      setCourierBusy("");
    }
  }

  async function connectRedx(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setCourierBusy("redx");
    setCourierNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connect`, {
        method: "POST",
        body: JSON.stringify({ provider: "redx", accessToken: redxForm.accessToken, baseUrl: redxForm.baseUrl || undefined }),
      });
      setCourierNotice("RedX যুক্ত হয়েছে।");
      setRedxForm({ accessToken: "", baseUrl: "" });
      await loadCourier();
    } catch (err) {
      setCourierNotice(err instanceof Error ? err.message : "RedX connect ব্যর্থ");
    } finally {
      setCourierBusy("");
    }
  }

  async function disconnectProvider(provider: string) {
    if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/courier/connection?provider=${provider}`, { method: "DELETE" }).catch(() => undefined);
    await loadCourier();
  }

  // Rules CRUD
  function ruleConditionsSummary(r: CourierRule): string {
    const c = r.conditions ?? {};
    const parts: string[] = [];
    if (c.districts?.length) parts.push(`জেলা: ${c.districts.join(", ")}`);
    if (c.minWeightGrams != null || c.maxWeightGrams != null) parts.push(`ওজন: ${c.minWeightGrams ?? "—"}–${c.maxWeightGrams ?? "—"} গ্রাম`);
    if (c.paymentType) parts.push(`পেমেন্ট: ${c.paymentType}`);
    return parts.length ? parts.join(" · ") : "সব অর্ডারে প্রযোজ্য";
  }

  async function saveRule(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    const conditions: CourierRule["conditions"] = {};
    if (ruleForm.districts.trim()) conditions.districts = ruleForm.districts.split(",").map((s) => s.trim()).filter(Boolean);
    if (ruleForm.minWeightGrams) conditions.minWeightGrams = Number(ruleForm.minWeightGrams);
    if (ruleForm.maxWeightGrams) conditions.maxWeightGrams = Number(ruleForm.maxWeightGrams);
    if (ruleForm.paymentType) conditions.paymentType = ruleForm.paymentType;
    setRuleBusy("save");
    setRuleNotice("");
    try {
      const body = {
        name: ruleForm.name.trim(),
        conditions,
        courierAccountId: ruleForm.courierAccountId,
        provider: ruleForm.provider,
        priority: Number(ruleForm.priority) || 0,
        active: ruleForm.active,
      };
      if (editingRule) await apiFetch(`/organizations/${orgId}/courier/rules/${editingRule.id}`, { method: "PATCH", body: JSON.stringify(body) });
      else await apiFetch(`/organizations/${orgId}/courier/rules`, { method: "POST", body: JSON.stringify(body) });
      setRuleNotice("নিয়ম সংরক্ষণ হয়েছে।");
      setEditingRule(null);
      setRuleForm({ name: "", provider: "", courierAccountId: "", priority: "10", districts: "", minWeightGrams: "", maxWeightGrams: "", minOrderTaka: "", maxOrderTaka: "", paymentType: "", active: true });
      setCourierRules(await apiFetch<CourierRule[]>(`/organizations/${orgId}/courier/rules`));
    } catch (err) {
      setRuleNotice(err instanceof Error ? err.message : "নিয়ম সংরক্ষণ ব্যর্থ");
    } finally {
      setRuleBusy("");
    }
  }

  async function deleteRule(r: CourierRule) {
    if (!orgId) return;
    setRuleBusy(`del-${r.id}`);
    try {
      await apiFetch(`/organizations/${orgId}/courier/rules/${r.id}`, { method: "DELETE" });
      setCourierRules(await apiFetch<CourierRule[]>(`/organizations/${orgId}/courier/rules`));
    } catch (err) {
      setRuleNotice(err instanceof Error ? err.message : "মুছতে ব্যর্থ");
    } finally {
      setRuleBusy("");
    }
  }

  async function saveTrackingTemplate(provider: string) {
    if (!orgId) return;
    setRuleBusy(`tpl-${provider}`);
    setRuleNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/tracking-template`, {
        method: "PATCH",
        body: JSON.stringify({
          provider,
          trackingUrlTemplate: trackingTemplates[provider]?.trim() ? trackingTemplates[provider].trim() : null,
        }),
      });
      setRuleNotice("ট্র্যাকিং টেমপ্লেট সংরক্ষণ হয়েছে।");
      await loadCourier();
    } catch (err) {
      setRuleNotice(err instanceof Error ? err.message : "টেমপ্লেট সংরক্ষণ ব্যর্থ");
    } finally {
      setRuleBusy("");
    }
  }

  // Label scan (CX8)
  async function runLabelScan(file: File) {
    if (!orgId) return;
    setLabelBusy("scan");
    setLabelError("");
    setLabelScan(null);
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
    } catch (err) {
      setLabelError(err instanceof Error ? err.message : "স্ক্যান ব্যর্থ");
    } finally {
      setLabelBusy("");
    }
  }

  async function runLabelLookup() {
    if (!orgId || !labelQuery.trim()) return;
    setLabelBusy("lookup");
    setLabelError("");
    setLabelScan(null);
    try {
      const out = await apiFetch<LabelScanResultView>(`/organizations/${orgId}/courier/label-lookup`, {
        method: "POST",
        body: JSON.stringify({ query: labelQuery.trim() }),
      });
      setLabelScan(out);
    } catch (err) {
      setLabelError(err instanceof Error ? err.message : "খোঁজ ব্যর্থ");
    } finally {
      setLabelBusy("");
    }
  }

  function openScannedOrder(m: LabelMatchView) {
    const found = items.find((o) => o.id === m.orderId);
    if (found) {
      openOrderDrawer(found, "overview");
      return;
    }
    setLabelError("অর্ডারটি পাওয়া গেছে, কিন্তু বর্তমান ফিল্টারের তালিকায় নেই — স্ট্যাটাস ফিল্টার 'সব অর্ডার' করে দেখুন।");
  }

  // Risk display
  async function showRisk(o: Order) {
    if (!orgId) return;
    try {
      const r = await apiFetch<RiskDetail>(`/organizations/${orgId}/orders/${o.id}/risk`);
      setRiskDetail({ ...r, orderLabel: `#${o.externalNumber ?? o.id.slice(0, 8)}` });
    } catch {
      /* advisory */
    }
  }

  // In-memory search filtering
  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase().trim();
    return items.filter((o) => {
      const idMatch = (o.externalNumber ?? "").toLowerCase().includes(q) || o.id.toLowerCase().includes(q);
      const nameMatch = `${o.customer?.firstName ?? ""} ${o.customer?.lastName ?? ""}`.toLowerCase().includes(q);
      const phoneMatch = (o.customer?.phone ?? "").toLowerCase().includes(q);
      const itemMatch = (o.items ?? []).some((i) => i.name.toLowerCase().includes(q));
      return idMatch || nameMatch || phoneMatch || itemMatch;
    });
  }, [items, searchQuery]);

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <OrdersHeader
        total={total}
        duplicateCount={duplicateData?.totalDuplicateOrders}
        exportBusy={exportBusy}
        onOpenDuplicates={() => setShowDuplicatesModal(true)}
        onOpenLabelScanner={() => setIsLabelScannerOpen(true)}
        onOpenCourierHub={() => setIsCourierHubOpen(true)}
        onDownloadExport={downloadExport}
      />

      {/* 2. KPI Metrics Bar */}
      <OrdersKpiBar stats={stats} />

      {/* 3. Filter Bar (Search + Status Tabs + COD toggle) */}
      <OrdersFilterBar
        status={status}
        onStatusChange={setStatus}
        codOnly={codOnly}
        onCodOnlyChange={setCodOnly}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        stats={stats}
      />

      {/* Error alert */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* 4. Orders Table or Loading/Empty state */}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          title={searchQuery ? "কোনো মিল পাওয়া যায়নি" : "কোনো অর্ডার নেই"}
          description={
            searchQuery
              ? `"${searchQuery}" এর সাথে কোনো অর্ডার মেলেনি। অন্য শব্দ দিয়ে খুঁজে দেখুন।`
              : "Stores & Integrations থেকে WooCommerce বা Shopify কানেক্ট করে Sync Orders চালান।"
          }
        />
      ) : (
        <OrdersTable
          orders={filteredOrders}
          selected={selected}
          onToggleSelect={toggleSelect}
          onSelectAll={(checked) => setSelected(checked ? filteredOrders.slice(0, 50).map((o) => o.id) : [])}
          shipments={shipments}
          courierRules={courierRules}
          courierConnected={!!courier?.connected || conns.some((c) => c.connected)}
          courierBusy={courierBusy}
          onOpenOrderDrawer={openOrderDrawer}
          onShowRisk={showRisk}
          onSyncShipment={syncShipment}
          onDownloadPdf={downloadPdf}
          orgId={orgId}
        />
      )}

      {/* 5. Floating Bulk Actions Bar */}
      <OrdersFloatingBulk
        selected={selected}
        items={items}
        bulkProvider={bulkProvider}
        onBulkProviderChange={async (p) => {
          setBulkProvider(p);
          await loadProviderLists(p);
        }}
        conns={conns}
        courierConnected={!!courier?.connected}
        rAreas={rAreas}
        rAreaId={bookForm.rAreaId}
        onRAreaChange={(areaId, areaName) => setBookForm({ ...bookForm, rAreaId: areaId, rAreaName: areaName })}
        bulkBusy={bulkBusy}
        bulkResults={bulkResults}
        onBulkBook={bulkBook}
        onBulkLabels={bulkLabels}
        onClearSelection={() => {
          setSelected([]);
          setBulkResults(null);
        }}
      />

      {/* 6. Order Detail & Actions Drawer (Slide-Over) */}
      <OrderDrawer
        order={actOrder}
        onClose={() => setActOrder(null)}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        actStatus={actStatus}
        onActStatusChange={setActStatus}
        actRefundTaka={actRefundTaka}
        onActRefundTakaChange={setActRefundTaka}
        actRefundReason={actRefundReason}
        onActRefundReasonChange={setActRefundReason}
        actNote={actNote}
        onActNoteChange={setActNote}
        actBusy={actBusy}
        actNotice={actNotice}
        onSaveStatus={saveStatus}
        onSaveRefund={saveRefund}
        onSaveNote={saveNote}
        onClearNote={clearNote}
        shipments={shipments}
        courierConnected={!!courier?.connected || conns.some((c) => c.connected)}
        conns={conns}
        bookSuggestion={bookSuggestion}
        bookForm={bookForm}
        onBookFormChange={setBookForm}
        pStores={pStores}
        pCities={pCities}
        pZones={pZones}
        pAreas={pAreas}
        rAreas={rAreas}
        rStores={rStores}
        onLoadProviderLists={loadProviderLists}
        onCityChange={async (cityId) => {
          setBookForm({ ...bookForm, pCityId: cityId, pZoneId: "", pAreaId: "" });
          setPZones([]);
          setPAreas([]);
          if (cityId && orgId) setPZones(await apiFetch<any[]>(`/organizations/${orgId}/courier/pathao/zones/${cityId}`).catch(() => []));
        }}
        onZoneChange={async (zoneId) => {
          setBookForm({ ...bookForm, pZoneId: zoneId, pAreaId: "" });
          setPAreas([]);
          if (zoneId && orgId) setPAreas(await apiFetch<any[]>(`/organizations/${orgId}/courier/pathao/areas/${zoneId}`).catch(() => []));
        }}
        onFetchQuote={fetchQuote}
        quoteBusy={quoteBusy}
        quoteOut={quoteOut}
        onBookShipment={bookShipment}
        courierBusy={courierBusy}
        courierNotice={courierNotice}
        onSyncShipment={syncShipment}
        onDownloadPdf={downloadPdf}
        orgId={orgId}
        advAmount={advAmount}
        onAdvAmountChange={setAdvAmount}
        advMethod={advMethod}
        onAdvMethodChange={setAdvMethod}
        advRef={advRef}
        onAdvRefChange={setAdvRef}
        advNote={advNote}
        onAdvNoteChange={setAdvNote}
        advBusy={advBusy}
        advError={advError}
        advNotice={advNotice}
        onRecordAdvance={recordAdvance}
        instPlan={instPlan}
        instLoaded={instLoaded}
        instError={instError}
        instBusy={instBusy}
        instCount={instCount}
        onInstCountChange={setInstCount}
        instInterval={instInterval}
        onInstIntervalChange={setInstInterval}
        instStart={instStart}
        onInstStartChange={setInstStart}
        instNote={instNote}
        onInstNoteChange={setInstNote}
        collectForms={collectForms}
        onCollectFormChange={(itemId, field, val) =>
          setCollectForms((prev) => ({
            ...prev,
            [itemId]: { ...(prev[itemId] || { amount: "", method: "bkash", reference: "", note: "" }), [field]: val },
          }))
        }
        onCreateInstPlan={createInstPlan}
        onCollectInstItem={collectInstItem}
        onCancelInstPlan={cancelInstPlan}
        pushState={pushState}
        pushStateError={pushStateError}
        storeNoteText={storeNoteText}
        onStoreNoteTextChange={setStoreNoteText}
        syncBusy={syncBusy}
        syncNotice={syncNotice}
        syncError={syncError}
        returnUrl={returnUrl}
        copiedKey={copiedKey}
        onSendStoreNote={sendStoreNote}
        onCreateStoreDraft={createStoreDraft}
        onCreateReturnLink={createReturnLink}
        onCopyText={copyText}
        orderAssignments={orderAssignments}
        riders={riders}
        assignRiderId={assignRiderId}
        onAssignRiderIdChange={setAssignRiderId}
        riderBusy={riderBusy}
        onAssignRider={assignRider}
        onTransitionAssignment={transitionAssignment}
        review={actOrder ? reviews.find((r) => r.orderId === actOrder.id) ?? null : null}
      />

      {/* 7. Courier & Automation Hub Modal */}
      <CourierHubModal
        isOpen={isCourierHubOpen}
        onClose={() => setIsCourierHubOpen(false)}
        courier={courier}
        courierForm={courierForm}
        onCourierFormChange={setCourierForm}
        onConnectCourier={connectCourier}
        onDisconnectSteadfast={async () => {
          if (!orgId) return;
          await apiFetch(`/organizations/${orgId}/courier/connection`, { method: "DELETE" }).catch(() => undefined);
          await loadCourier();
        }}
        onSyncAllCourier={async () => {
          if (!orgId) return;
          setCourierBusy("syncall");
          try {
            const r = await apiFetch<{ checked: number; changed: number; errors: string[] }>(
              `/organizations/${orgId}/courier/sync-all`,
              { method: "POST" }
            );
            setCourierNotice(`Sync সম্পন্ন: ${r.checked}টি যাচাই, ${r.changed}টি স্ট্যাটাস বদলেছে`);
            await loadCourier();
          } catch (err) {
            setCourierNotice(err instanceof Error ? err.message : "Sync ব্যর্থ");
          } finally {
            setCourierBusy("");
          }
        }}
        conns={conns}
        pathaoForm={pathaoForm}
        onPathaoFormChange={setPathaoForm}
        onConnectPathao={connectPathao}
        redxForm={redxForm}
        onRedxFormChange={setRedxForm}
        onConnectRedx={connectRedx}
        onDisconnectProvider={disconnectProvider}
        courierBusy={courierBusy}
        courierNotice={courierNotice}
        courierRules={courierRules}
        ruleForm={ruleForm}
        onRuleFormChange={setRuleForm}
        editingRule={editingRule}
        onEditRule={(r) => {
          setEditingRule(r);
          setRuleForm({
            name: r.name,
            provider: r.provider,
            courierAccountId: r.courierAccountId,
            priority: String(r.priority),
            districts: (r.conditions.districts ?? []).join(", "),
            minWeightGrams: r.conditions.minWeightGrams != null ? String(r.conditions.minWeightGrams) : "",
            maxWeightGrams: r.conditions.maxWeightGrams != null ? String(r.conditions.maxWeightGrams) : "",
            minOrderTaka: r.conditions.minOrderMinor != null ? String(Number(r.conditions.minOrderMinor) / 100) : "",
            maxOrderTaka: r.conditions.maxOrderMinor != null ? String(Number(r.conditions.maxOrderMinor) / 100) : "",
            paymentType: r.conditions.paymentType ?? "",
            active: r.active,
          });
        }}
        onCancelEditRule={() => {
          setEditingRule(null);
          setRuleForm({
            name: "",
            provider: "",
            courierAccountId: "",
            priority: "10",
            districts: "",
            minWeightGrams: "",
            maxWeightGrams: "",
            minOrderTaka: "",
            maxOrderTaka: "",
            paymentType: "",
            active: true,
          });
        }}
        onSaveRule={saveRule}
        onDeleteRule={deleteRule}
        ruleBusy={ruleBusy}
        ruleNotice={ruleNotice}
        ruleConditionsSummary={ruleConditionsSummary}
        trackingTemplates={trackingTemplates}
        onTrackingTemplateChange={(provider, val) => setTrackingTemplates({ ...trackingTemplates, [provider]: val })}
        onSaveTrackingTemplate={saveTrackingTemplate}
        perfDays={perfDays}
        onPerfDaysChange={setPerfDays}
        perf={perf}
        reviews={reviews}
        chases={chases}
      />

      {/* 8. Label Scanner Modal */}
      <LabelScannerModal
        isOpen={isLabelScannerOpen}
        onClose={() => setIsLabelScannerOpen(false)}
        labelQuery={labelQuery}
        onLabelQueryChange={setLabelQuery}
        labelScan={labelScan}
        labelBusy={labelBusy}
        labelError={labelError}
        onRunLabelScan={runLabelScan}
        onRunLabelLookup={runLabelLookup}
        onOpenScannedOrder={openScannedOrder}
      />

      {/* 9. Duplicates Modal */}
      <DuplicatesModal
        isOpen={showDuplicatesModal}
        onClose={() => setShowDuplicatesModal(false)}
        duplicateData={duplicateData}
        mergeBusy={mergeBusy}
        onMergeGroup={mergeGroup}
      />

      {/* 10. Risk Modal */}
      <RiskModal riskDetail={riskDetail} onClose={() => setRiskDetail(null)} />
    </div>
  );
}
