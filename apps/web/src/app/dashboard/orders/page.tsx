"use client";
import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  EMPTY_ORDER_FILTERS, buildOrderListParams, feedAdvance, filtersToViewPayload, minorToTaka, takaToMinor, viewToFilters,
  type OrderFilters, type QueueRow, type SavedView, type FeedItem,
} from "@/lib/orders-on1";
import {
  FRAUD_BAND_LABEL, codCallOutcomeLabel, type RiskReason,
} from "@/lib/orders-on4";
import {
  EMPTY_FRAUD_RULE_DRAFT, buildFraudRulePayload,
  normalizeIdentifierValue, validateIdentifierInput, type FraudRuleDraft,
} from "@/lib/orders-gb3";
import {
  NOTIFICATION_CHANNELS,
} from "@/lib/orders-on5";
import {
  buildEditItemsBody, draftsFromOrderItems,
  validateDraft, type DraftLine, type PatchItemsResult, type PreviewResult,
} from "@/lib/orders-on3";
import {
  type CodBoard, type OrderProfit,
} from "@/lib/orders-on7";
import dynamic from "next/dynamic";
import { memberName, type MemberRow, type OrderAllocation } from "./on2-detail";
import { CodCallChips } from "./components/CodCallChips";
import { SplitDialog } from "./components/SplitDialog";
import { MergeDialog } from "./components/MergeDialog";
import { FraudSettingsPanel } from "./components/FraudSettingsPanel";
import { NotificationSettingsPanel } from "./components/NotificationSettingsPanel";
import { OrderActionPanel } from "./components/OrderActionPanel";

const DuplicatesModal = dynamic(() => import("./components/DuplicatesModal").then((m) => m.DuplicatesModal), { ssr: false });
const OrderAutomationPanel = dynamic(() => import("./on8-automation").then((m) => m.OrderAutomationPanel), { ssr: false });
const OrderAnalyticsPanel = dynamic(() => import("./on9-analytics").then((m) => m.OrderAnalyticsPanel), { ssr: false });
const OrderPrintPanel = dynamic(() => import("./on10-print").then((m) => m.OrderPrintPanel), { ssr: false });
const OrderTeamPanel = dynamic(() => import("./on12-team").then((m) => m.OrderTeamPanel), { ssr: false });
import { formatMinor } from "@repo/contracts";
import { EmptyState, KpiCard, ResponsiveTable } from "@repo/ui";
import { useConfirm, usePrompt, useToast } from "@repo/ui/client";
import { extractedSummary, type LabelScanResultView, type LabelMatchView } from "@/lib/cx8";
import { networkSignalBody, networkSignalHeading, type FraudNetworkSignal } from "@/lib/fraud-network-nf13";

interface OrderItem {
  id: string; name: string; quantity: number; totalMinor: string;
  // ON3: unit price + product link ride the pubOrder spread
  // (priceMinor is the serialized unit price of the line).
  priceMinor?: string; productId?: string | null; sku?: string | null;
  // EC29: free-gift lines + bundle membership markers.
  isGift?: boolean; bundleId?: string | null; bundleName?: string | null;
}
// ON3: product-picker row (products API list shape) + the split
// / merge result shapes (fixed API contract, OB4).
interface ProductPick { id: string; name: string; sku?: string | null; priceMinor: string }
interface ProductVariantPick { id: string; name: string; priceMinor?: string | null }
interface SplitResult { original: Order; created: Order; movedDeliveryMinor: string; verificationsStayedOnOriginal: boolean }
interface MergeResult { survivor: Order; cancelledOrderIds: string[]; droppedDeliveryMinor: string; reassignedVerifications: number; overpaidMinor: string }
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
  // ON3: delivery charge on the row (pubOrder spread) — the
  // merge dialog sums the NON-survivor charges as its warning.
  shippingMinor?: string;
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
  // AB3 (AX4): stock allocations on the staff detail payload
  // (orders getOne) — list rows do not carry them.
  allocations?: OrderAllocation[];
  risk?: { band: string; score: number | null } | null;
  // ON1: command-center row enrichments (list rows additionally
  // carry tags / assigneeId / advancePaidMinor / amountDueMinor).
  // conversationId / codConversationId / codConfirmationStatus are
  // raw order columns already present on pubOrder rows — the quick
  // actions below render ONLY when they are actually present.
  tags?: string[] | null; assigneeId?: string | null;
  codConfirmationStatus?: string | null;
  conversationId?: string | null; codConversationId?: string | null;
  // ON4: Fraud Shield v2 — the PERSISTED fraud assessment on the
  // row (distinct from the M50 advisory `risk` object above).
  riskScore?: number | null;
  riskBand?: "low" | "medium" | "high" | null;
  // NF13: sibling network signal — present only for opted-in
  // orgs (from the reassess response); never the shop's score.
  networkSignal?: FraudNetworkSignal | null;
  riskReasons?: RiskReason[] | null;
  riskAssessedAt?: string | null;
  reviewHold?: boolean;
  reviewHoldReason?: string | null;
  reviewHeldAt?: string | null;
  codCallAttempts?: number;
  codLastCallAt?: string | null;
  codLastCallOutcome?: "confirmed" | "rejected" | "unreachable" | "callback_requested" | null;
  // AB4 (AX5): custom checkout-field answers on the detail
  // payload (map + label defs) and the order's deposit block.
  checkoutFields?: Record<string, string | boolean> | null;
  checkoutFieldDefs?: { key: string; label: string }[] | null;
  deposit?: { dueMinor: string; paidMinor: string; outstandingMinor: string } | null;
  // AB8 (AX27): device-hash PREFIX only (never the full hash)
  // on the staff detail payload; null = no device signal.
  deviceHashPrefix?: string | null;
}
// ON4: GET/PUT /orders/fraud-settings (highValueMinor is a
// minor-unit string; the form edits it in taka).
interface FraudSettings {
  enabled: boolean; autoHoldEnabled: boolean; autoHoldBand: string;
  highValueMinor: string; burstCount: number; burstWindowHours: number;
  // GB3 (GC8/GC9): checkout gate policy + rate limits + CAPTCHA.
  openOrderPolicy: string; openOrderWindowHours: number;
  waitingPeriodMinutes: number; maxOrdersPerPhonePerDay: number;
  captchaEnabled: boolean; captchaOnCheckout: boolean; captchaOnOtp: boolean;
  turnstileSiteKey: string | null; turnstileSecretSet: boolean;
}
interface BlockedPhoneRow { id: string; phone: string; phoneKey: string; reason: string | null; createdAt: string }
// GB3: blocked/trusted identifier rows + fraud attempts + rules.
interface IdentifierRow { id: string; kind: string; value: string; reason: string | null; createdAt: string }
interface FraudAttemptRow { id: string; channel: string; kind: string; identifierSummary: string; ruleId: string | null; createdAt: string }
interface FraudRuleRow {
  id: string; name: string; enabled: boolean;
  conditions: Record<string, unknown>; action: string; tagValue: string | null;
  hitCount: number; createdAt: string;
}
// ON5: GET/PUT /orders/notification-settings — the full merged
// config; a null template means "use the built-in default".
interface NotifEventConfig {
  enabled: boolean; channels: string[];
  templates: { sms: string | null; whatsapp: string | null; email: string | null };
}
type NotifConfig = Record<string, NotifEventConfig>;
// EC5: GET commerce/orders/:orderId/push-state — what the
// "স্টোর সিঙ্ক" panel renders. Errors from the store platform are
// shown verbatim, never paraphrased as success.
interface PushState {
  orderId: string;
  store: { id: string; name: string; platform: string; syncMode: string; refundPushEnabled: boolean; refundToCreditEnabled?: boolean; courierTrackingMetaKey: string | null } | null;
  refundToCreditEnabled?: boolean;
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
interface Shipment { id: string; orderId: string; trackingCode?: string | null; status: string; provider: string; trackingUrl?: string | null; courierRuleId?: string | null; chargeMinor?: string | null }
// EC22: courier auto-select rules + tracking templates, riders.
interface CourierRule { id: string; name: string; conditions: { districts?: string[]; minWeightGrams?: number; maxWeightGrams?: number; minOrderMinor?: string | number; maxOrderMinor?: string | number; paymentType?: string }; courierAccountId: string; provider: string; priority: number; active: boolean }
interface CourierSuggestion { ruleId: string | null; ruleName?: string | null; provider?: string | null; reason?: string | null }
interface RiderRow { id: string; name: string; phone?: string | null; active: boolean }
interface DeliveryAssignmentRow { id: string; orderId: string; orderNumber?: string | null; orderStatus?: string | null; orderTotalMinor?: string; orderAddress?: string | null; riderId: string; riderName?: string | null; status: string; assignedAt?: string; note?: string | null }
// Sales & Data S5: row shape from GET organizations/:id/courier/performance.
interface ProviderPerformance { provider: string; booked: number; delivered: number; returned: number; cancelled: number; inFlight: number; decided: number; deliveryRate: number | null; returnRate: number | null; avgDeliveryHours: null }
interface CourierPerformance { days: number; deliveryTimeAvailable: boolean; providers: ProviderPerformance[]; totals: ProviderPerformance }
const PERF_PROVIDER_LABEL: Record<string, string> = { steadfast: "Steadfast", pathao: "Pathao", redx: "RedX", ecourier: "eCourier", total: "মোট" };

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

function OrdersPageInner() {
  // ED12 (EB5): URL-driven list state — queue / status / committed
  // search are read from the query string on mount (see the mirror
  // effect near patchFilters). Absent params = today's defaults.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQueue = searchParams.get("queue") ?? "";
  const urlStatus = searchParams.get("status") ?? "";
  const urlSearch = searchParams.get("search") ?? "";
  // ED14 (EB5): native dialogs replaced by the shared kit hooks.
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { toast } = useToast();
  const [items, setItems] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState(urlStatus);
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
  const [bookForm, setBookForm] = useState({ name: "", phone: "", address: "", note: "", provider: "steadfast", pStoreId: "", pCityId: "", pZoneId: "", pAreaId: "", weightKg: "0.5", rAreaId: "", rAreaName: "", rStoreId: "", eCity: "", eThana: "", eArea: "", eZip: "", ePackage: "", ePayMethod: "" });
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
  const [ecourierForm, setEcourierForm] = useState({ apiKey: "", apiSecret: "", userId: "", baseUrl: "" });
  const [pStores, setPStores] = useState<any[]>([]);
  const [pCities, setPCities] = useState<any[]>([]);
  const [pZones, setPZones] = useState<any[]>([]);
  const [pAreas, setPAreas] = useState<any[]>([]);
  const [rAreas, setRAreas] = useState<any[]>([]);
  const [rStores, setRStores] = useState<any[]>([]);
  const [eCities, setECities] = useState<any[]>([]);
  const [eThanas, setEThanas] = useState<any[]>([]);
  const [ePackages, setEPackages] = useState<any[]>([]);
  // GB5 (GC14): shipment detail (event history + manual status).
  const [detailShipmentId, setDetailShipmentId] = useState<string | null>(null);
  const [shipmentEvents, setShipmentEvents] = useState<any[]>([]);
  const [manualStatus, setManualStatus] = useState("delivered");
  const [manualNote, setManualNote] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [courierBusy, setCourierBusy] = useState("");
  const [courierNotice, setCourierNotice] = useState("");
  const [quoteOut, setQuoteOut] = useState<any>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [riskDetail, setRiskDetail] = useState<(RiskDetail & { orderLabel: string }) | null>(null);
  // ---- ON4: Fraud Shield v2 state ----
  // The fraud detail panel holds a snapshot of the order row
  // (mirrors the riskDetail pattern); every action replaces it
  // with the server's updated order, never a local guess.
  const [fraudOrder, setFraudOrder] = useState<Order | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [fraudBusy, setFraudBusy] = useState("");
  const [fraudNotice, setFraudNotice] = useState("");
  const [codBusy, setCodBusy] = useState("");
  // ON8: Orders Automation Studio panel (modal).
  const [automationPanelOpen, setAutomationPanelOpen] = useState(false);
  const [analyticsPanelOpen, setAnalyticsPanelOpen] = useState(false);
  const [printPanelOpen, setPrintPanelOpen] = useState(false);
  const [teamPanelOpen, setTeamPanelOpen] = useState(false);
  // Fraud settings + blocklist panel (modal).
  const [fraudPanelOpen, setFraudPanelOpen] = useState(false);
  const [fraudSettings, setFraudSettings] = useState<FraudSettings | null>(null);
  const [fraudHighTaka, setFraudHighTaka] = useState("");
  const [blockedPhones, setBlockedPhones] = useState<BlockedPhoneRow[]>([]);
  const [blockForm, setBlockForm] = useState({ phone: "", reason: "" });
  const [fraudPanelBusy, setFraudPanelBusy] = useState("");
  const [fraudPanelNotice, setFraudPanelNotice] = useState("");
  const [fraudPanelError, setFraudPanelError] = useState("");
  // GB3 (GC9): identifier lists / attempts / rules + Turnstile secret.
  const [turnstileSecret, setTurnstileSecret] = useState("");
  const [identTab, setIdentTab] = useState<"phone" | "blocked" | "trusted">("phone");
  const [blockedIdents, setBlockedIdents] = useState<IdentifierRow[]>([]);
  const [trustedIdents, setTrustedIdents] = useState<IdentifierRow[]>([]);
  const [blockedIdentForm, setBlockedIdentForm] = useState({ kind: "email", value: "", reason: "" });
  const [trustedForm, setTrustedForm] = useState({ kind: "phone", value: "", reason: "" });
  const [fraudAttempts, setFraudAttempts] = useState<FraudAttemptRow[]>([]);
  const [fraudRules, setFraudRules] = useState<FraudRuleRow[]>([]);
  const [ruleDraft, setRuleDraft] = useState<FraudRuleDraft>(EMPTY_FRAUD_RULE_DRAFT);
  // ON5: notification settings panel (modal, mirrors the fraud panel).
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const [notifConfig, setNotifConfig] = useState<NotifConfig | null>(null);
  const [notifPanelBusy, setNotifPanelBusy] = useState("");
  const [notifPanelNotice, setNotifPanelNotice] = useState("");
  const [notifPanelError, setNotifPanelError] = useState("");
  // ON6: bulk "ওয়েভে যোগ" result (POST /pick-waves per-order results).
  const [waveResult, setWaveResult] = useState<{ added: number; failed: { orderId: string; error: string }[] } | null>(null);
  // ---- ON3 / ON7 (OB4): surgery, split, merge, COD strip, profit ----
  const [codBoard, setCodBoard] = useState<CodBoard | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSurvivor, setMergeSurvivor] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  // Main-era (componentized page): duplicate-detection hub —
  // groups of likely-duplicate orders from GET /orders/duplicates,
  // merged in one click via POST /orders/merge. Distinct from the
  // ON3 merge above (which merges the manually selected orders).
  const [duplicateData, setDuplicateData] = useState<{ totalGroups: number; totalDuplicateOrders: number; groups: any[] } | null>(null);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);
  const [dupMergeBusy, setDupMergeBusy] = useState("");
  const [mergeError, setMergeError] = useState("");
  const [surgery, setSurgery] = useState(false);
  const [drafts, setDrafts] = useState<DraftLine[]>([]);
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const [recalcDelivery, setRecalcDelivery] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [surgeryBusy, setSurgeryBusy] = useState(false);
  const [surgeryNotice, setSurgeryNotice] = useState("");
  const [surgeryError, setSurgeryError] = useState("");
  const [overpaidNotice, setOverpaidNotice] = useState("");
  const [pickQuery, setPickQuery] = useState("");
  const [pickResults, setPickResults] = useState<ProductPick[]>([]);
  const [pickBusy, setPickBusy] = useState(false);
  const [pendingProduct, setPendingProduct] = useState<(ProductPick & { variants: ProductVariantPick[] }) | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitQty, setSplitQty] = useState<Record<string, string>>({});
  const [splitBundles, setSplitBundles] = useState<string[]>([]);
  const [splitDeliveryTaka, setSplitDeliveryTaka] = useState("0");
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitNotice, setSplitNotice] = useState("");
  const [splitError, setSplitError] = useState("");
  const [splitCreated, setSplitCreated] = useState<{ id: string; label: string } | null>(null);
  const [profit, setProfit] = useState<OrderProfit | null>(null);
  const [profitError, setProfitError] = useState("");
  const previewSeqRef = useRef(0);
  /** Minor-string display for the ON3/ON7 surfaces (same
   * formatMinor the rest of the page uses; bad input passes
   * through raw instead of crashing the panel). */
  const fmtM = (minor?: string | null): string => {
    if (minor == null) return "—";
    try { return formatMinor(BigInt(minor)); } catch { return minor; }
  };
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

  // ---- ON1: Command Center state ----
  // One filter object drives the list query, the saved-view
  // payload and the reset button (see lib/orders-on1).
  const [filters, setFilters] = useState<OrderFilters>(() => ({
    ...EMPTY_ORDER_FILTERS, queue: urlQueue, status: urlStatus, search: urlSearch,
  }));
  const [searchDraft, setSearchDraft] = useState(urlSearch);
  const [queues, setQueues] = useState<QueueRow[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [viewNotice, setViewNotice] = useState("");
  // Live feed: watermark of the newest feed item seen + how many
  // orders were CREATED after the initial load. The list itself is
  // NEVER replaced silently — the pill asks the user to reload.
  const feedWatermarkRef = useRef<string>(new Date().toISOString());
  const initialLoadRef = useRef<string>(new Date().toISOString());
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [feedToast, setFeedToast] = useState("");
  // ON1 bulk actions (POST /orders/bulk) — separate from the
  // legacy courier bulk-booking card below, which is unchanged.
  const [bulkStatus, setBulkStatus] = useState("processing");
  const [bulkTag, setBulkTag] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkProviderOn1, setBulkProviderOn1] = useState("steadfast");
  const [bulkActionBusy, setBulkActionBusy] = useState("");
  const [bulkActionResult, setBulkActionResult] = useState<{ succeeded: number; failed: number; results: { orderId: string; ok: boolean; error?: string }[] } | null>(null);
  const [rowBusy, setRowBusy] = useState("");
  const [rowNotice, setRowNotice] = useState("");

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

  // ---- ON3 / ON7 (OB4) wiring ----
  // COD strip: org totals for the command center. Failure is
  // isolated by design — a failed call just leaves the strip
  // unrendered, the list below is unaffected.
  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<CodBoard>(`/organizations/${orgId}/orders/reports/cod-board`)
      .then(setCodBoard).catch(() => setCodBoard(null));
  }, []);

  const loadProfit = useCallback(async (orderId: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const p = await apiFetch<OrderProfit>(`/organizations/${orgId}/orders/${orderId}/profit`);
      setProfit(p); setProfitError("");
    } catch (e) {
      setProfit(null);
      setProfitError(e instanceof Error ? e.message : "লাভের হিসাব লোড ব্যর্থ");
    }
  }, []);

  // Opening a (different) order resets every ON3/ON7 surface and
  // loads that order's profit card.
  useEffect(() => {
    setSurgery(false); setDrafts([]); setDraftErrors([]); setPreview(null);
    setPreviewError(""); setSurgeryNotice(""); setSurgeryError(""); setOverpaidNotice("");
    setSplitOpen(false); setSplitCreated(null); setProfit(null); setProfitError("");
    if (actOrderId) void loadProfit(actOrderId);
  }, [actOrderId, loadProfit]);

  // Surgery preview: debounced ~600ms after every draft edit.
  // Invalid drafts never reach the server — the Bengali
  // validation errors show instead and the stale preview clears.
  useEffect(() => {
    if (!surgery || !actOrderId) return;
    const errs = validateDraft(drafts);
    setDraftErrors(errs);
    if (errs.length > 0) { setPreview(null); setPreviewError(""); return; }
    const orgId = getOrganizationId(); if (!orgId) return;
    const seq = ++previewSeqRef.current;
    setPreviewBusy(true);
    const t = setTimeout(() => {
      apiFetch<PreviewResult>(`/organizations/${orgId}/orders/${actOrderId}/items/preview`, {
        method: "POST",
        body: JSON.stringify(buildEditItemsBody(drafts, { recalculateDelivery: recalcDelivery })),
      })
        .then((out) => { if (previewSeqRef.current === seq) { setPreview(out); setPreviewError(""); } })
        .catch((e) => { if (previewSeqRef.current === seq) { setPreview(null); setPreviewError(e instanceof Error ? e.message : "হিসাব ব্যর্থ"); } })
        .finally(() => { if (previewSeqRef.current === seq) setPreviewBusy(false); });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surgery, drafts, recalcDelivery, actOrderId]);

  function enterSurgery() {
    if (!actOrder) return;
    setSurgeryNotice(""); setSurgeryError(""); setOverpaidNotice("");
    if (!actOrder.items) {
      setSurgeryError("এই অর্ডারের আইটেম এখনো লোড হয়নি — অর্ডারটি বন্ধ করে আবার খুলুন।");
      return;
    }
    setDrafts(draftsFromOrderItems(actOrder.items));
    setRecalcDelivery(false);
    setPreview(null); setPreviewError("");
    setSurgery(true);
  }

  function exitSurgery() {
    setSurgery(false); setPreview(null); setPreviewError(""); setDraftErrors([]);
    setPendingProduct(null); setPickResults([]); setPickQuery("");
  }

  function patchDraft(idx: number, patch: Partial<DraftLine>) {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  /** Price input is in TAKA; the draft stores minor strings via
   * the shared orders-on1 converter. Unparseable text is kept
   * raw so validateDraft can refuse it in Bengali. */
  function patchDraftPrice(idx: number, takaText: string) {
    const minor = takaToMinor(takaText);
    patchDraft(idx, { priceText: takaText, unitPriceMinor: minor ?? takaText });
  }

  async function searchProducts() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setPickBusy(true); setPendingProduct(null);
    try {
      const q = pickQuery.trim();
      const out = await apiFetch<{ items: ProductPick[] }>(
        `/organizations/${orgId}/products?pageSize=20${q ? `&search=${encodeURIComponent(q)}` : ""}`,
      );
      setPickResults(out.items ?? []);
    } catch { setPickResults([]); }
    finally { setPickBusy(false); }
  }

  /** Product picker: fetch the product detail for variants
   * (same pattern as the purchasing page); variants get a chip
   * row, a variant-less product is added directly. */
  async function chooseProduct(p: ProductPick) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const d = await apiFetch<{ variants?: ProductVariantPick[] }>(`/organizations/${orgId}/products/${p.id}`);
      const vs = d.variants ?? [];
      if (vs.length > 0) { setPendingProduct({ ...p, variants: vs }); return; }
    } catch { /* no variant info — add the base product */ }
    addProductDraft(p);
  }

  function addProductDraft(p: ProductPick, v?: ProductVariantPick) {
    setDrafts((prev) => [...prev, {
      productId: p.id,
      variantId: v?.id,
      name: v ? `${p.name} — ${v.name}` : p.name,
      quantity: 1,
      unitPriceMinor: v?.priceMinor ?? p.priceMinor ?? "0",
      isGift: false,
      kind: "line",
    }]);
    setPendingProduct(null); setPickResults([]); setPickQuery("");
  }

  async function saveSurgery() {
    const orgId = getOrganizationId(); if (!orgId || !actOrder) return;
    const errs = validateDraft(drafts);
    setDraftErrors(errs);
    if (errs.length > 0) return;
    setSurgeryBusy(true); setSurgeryError(""); setSurgeryNotice(""); setOverpaidNotice("");
    try {
      const out = await apiFetch<PatchItemsResult & { order: Order }>(
        `/organizations/${orgId}/orders/${actOrder.id}/items`,
        { method: "PATCH", body: JSON.stringify(buildEditItemsBody(drafts, { recalculateDelivery: recalcDelivery })) },
      );
      const updated = out.order as Order | undefined;
      if (updated) {
        setActOrder((prev) => (prev ? { ...prev, ...updated } : updated));
        setItems((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
      }
      // Server warnings surface VERBATIM — money refusals are
      // never paraphrased. The overpaid excess gets its own
      // amber notice pointing at the return/refund process.
      const notes = [...(out.warnings ?? [])];
      if (out.couponDropped) notes.push("কুপন বাতিল হয়েছে।");
      if (out.referralDropped) notes.push("রেফারেল ছাড় বাতিল হয়েছে।");
      setSurgeryNotice(["আইটেম সংরক্ষণ হয়েছে।", ...notes].join(" "));
      let over: string | null = null;
      try { if (BigInt(out.overpaidMinor ?? "0") > 0n) over = out.overpaidMinor; } catch { over = null; }
      if (over) setOverpaidNotice(`অতিরিক্ত পরিশোধ হয়েছে ${fmtM(over)} — রিফান্ডের জন্য রিটার্ন/রিফান্ড প্রক্রিয়া ব্যবহার করুন`);
      exitSurgery();
      await load();
      void loadProfit(actOrder.id);
    } catch (e) { setSurgeryError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setSurgeryBusy(false); }
  }

  // ---- ON3: split ----
  function openSplit() {
    setSplitQty({}); setSplitBundles([]); setSplitDeliveryTaka("0");
    setSplitError(""); setSplitNotice(""); setSplitCreated(null);
    setSplitOpen(true);
  }

  async function doSplit() {
    const orgId = getOrganizationId(); if (!orgId || !actOrder) return;
    const lines: { orderItemId: string; quantity: number }[] = [];
    for (const it of actOrder.items ?? []) {
      if (it.isGift) continue; // gift lines are not movable
      if (it.bundleId) {
        // Bundle groups move whole — every component at full qty.
        if (splitBundles.includes(it.bundleId)) lines.push({ orderItemId: it.id, quantity: it.quantity });
        continue;
      }
      const q = Number(splitQty[it.id] ?? 0);
      if (Number.isInteger(q) && q > 0) lines.push({ orderItemId: it.id, quantity: Math.min(q, it.quantity) });
    }
    if (lines.length === 0) { setSplitError("কমপক্ষে একটি আইটেম বা একটি বান্ডল গ্রুপ বেছে নিন।"); return; }
    const delMinor = takaToMinor(splitDeliveryTaka.trim() || "0");
    if (delMinor === null) { setSplitError("নতুন অর্ডারের ডেলিভারি চার্জ টাকায় ঠিকভাবে লিখুন (যেমন: 60 বা 60.50)।"); return; }
    setSplitBusy(true); setSplitError(""); setSplitNotice("");
    try {
      const out = await apiFetch<SplitResult>(`/organizations/${orgId}/orders/${actOrder.id}/split`, {
        method: "POST", body: JSON.stringify({ lines, deliveryChargeMinor: delMinor }),
      });
      if (out.original) {
        setActOrder((prev) => (prev ? { ...prev, ...out.original } : out.original));
        setItems((prev) => prev.map((x) => (x.id === out.original.id ? { ...x, ...out.original } : x)));
      }
      const label = `#${out.created.externalNumber ?? out.created.id.slice(0, 8)}`;
      setSplitCreated({ id: out.created.id, label });
      setSplitNotice(`অর্ডার ভাগ হয়েছে — নতুন অর্ডার ${label} তৈরি হয়েছে।${out.verificationsStayedOnOriginal ? " পেমেন্ট যাচাইগুলো মূল অর্ডারেই থাকলো।" : ""}`);
      setSurgery(false);
      await load();
    } catch (e) { setSplitError(e instanceof Error ? e.message : "Split ব্যর্থ"); }
    finally { setSplitBusy(false); }
  }

  // ---- ON3: bulk merge ----
  function openMerge() {
    setMergeSurvivor(selected[0] ?? "");
    setMergeError("");
    setMergeOpen(true);
  }

  const loadDuplicates = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const d = await apiFetch<{ totalGroups: number; totalDuplicateOrders: number; groups: any[] }>(
        `/organizations/${orgId}/orders/duplicates`,
      );
      setDuplicateData(d);
    } catch {
      setDuplicateData(null);
    }
  }, []);

  useEffect(() => { void loadDuplicates(); }, [loadDuplicates]);

  // 1-click merge of one detected duplicate group.
  async function mergeGroup(primaryOrderId: string, duplicateOrderIds: string[]) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setDupMergeBusy(primaryOrderId);
    try {
      await apiFetch(`/organizations/${orgId}/orders/merge`, {
        method: "POST",
        body: JSON.stringify({ primaryOrderId, duplicateOrderIds, mergeReason: "Dashboard 1-click merge" }),
      });
      await loadDuplicates();
      await load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "মার্জ করতে সমস্যা হয়েছে", tone: "error" });
    } finally {
      setDupMergeBusy("");
    }
  }

  async function doMerge() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!mergeSurvivor || !selected.includes(mergeSurvivor)) { setMergeError("আগে কোন অর্ডারটি থাকবে (survivor) বেছে নিন।"); return; }
    const others = selected.filter((id) => id !== mergeSurvivor);
    if (others.length === 0) { setMergeError("মার্জ করতে কমপক্ষে ২টি অর্ডার লাগবে।"); return; }
    setMergeBusy(true); setMergeError("");
    try {
      const out = await apiFetch<MergeResult>(`/organizations/${orgId}/orders/${mergeSurvivor}/merge`, {
        method: "POST", body: JSON.stringify({ orderIds: others }),
      });
      const survivorLabel = `#${out.survivor?.externalNumber ?? mergeSurvivor.slice(0, 8)}`;
      setMergeOpen(false);
      setSelected([]);
      setBulkActionResult(null);
      toast({ title: `মার্জ সম্পন্ন হয়েছে — survivor ${survivorLabel}; ${(out.cancelledOrderIds ?? others).length}টি অর্ডার বাতিল হয়েছে${out.reassignedVerifications ? `; ${out.reassignedVerifications}টি পেমেন্ট যাচাই survivor-এ সরে গেছে` : ""}।`, tone: "success" });
      await load();
      void loadQueues();
    } catch (e) { setMergeError(e instanceof Error ? e.message : "মার্জ ব্যর্থ"); }
    finally { setMergeBusy(false); }
  }

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
    if (!(await confirm({ title: "এই কিস্তি প্ল্যানটি বাতিল করবেন? ইতিমধ্যে সংগ্রহ করা টাকা সংগ্রহ হিসেবেই থাকবে।", danger: true, confirmLabel: "বাতিল করুন" }))) return;
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

  // ---- ON4: Fraud Shield v2 actions ----
  /** Merge a server-returned order into every place the page
   * holds it (list row, detail panel, fraud panel). */
  function syncOrderRow(updated: Order) {
    setItems((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
    setActOrder((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
    setFraudOrder((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
  }

  function openFraudDetail(o: Order) {
    setFraudOrder(o); setHoldReason(""); setFraudNotice("");
  }

  async function reassessFraud(o: Order) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setFraudBusy("reassess"); setFraudNotice("");
    try {
      const out = await apiFetch<{ score: number | null; band: string | null; reasons: RiskReason[] | null; reviewHold: boolean; networkSignal?: FraudNetworkSignal | null; order: Order }>(
        `/organizations/${orgId}/orders/${o.id}/reassess`, { method: "POST", body: JSON.stringify({}) },
      );
      const updated: Order = {
        ...(out.order ?? o),
        riskScore: out.score ?? out.order?.riskScore ?? o.riskScore ?? null,
        riskBand: (out.band as Order["riskBand"]) ?? out.order?.riskBand ?? o.riskBand ?? null,
        networkSignal: out.networkSignal ?? o.networkSignal ?? null,
        riskReasons: out.reasons ?? out.order?.riskReasons ?? null,
        reviewHold: out.reviewHold ?? out.order?.reviewHold ?? o.reviewHold,
      };
      syncOrderRow(updated);
      setFraudNotice("ঝুঁকি আবার যাচাই হয়েছে।");
      void loadQueues();
    } catch (e) { setFraudNotice(e instanceof Error ? e.message : "আবার যাচাই ব্যর্থ"); }
    finally { setFraudBusy(""); }
  }

  async function holdFraud(o: Order) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setFraudBusy("hold"); setFraudNotice("");
    try {
      const updated = await apiFetch<Order>(`/organizations/${orgId}/orders/${o.id}/hold`, {
        method: "POST", body: JSON.stringify({ reason: holdReason.trim() }),
      });
      syncOrderRow(updated);
      setHoldReason("");
      setFraudNotice("অর্ডারটি পর্যালোচনার জন্য আটকানো হয়েছে।");
      void loadQueues();
    } catch (e) { setFraudNotice(e instanceof Error ? e.message : "আটকানো ব্যর্থ"); }
    finally { setFraudBusy(""); }
  }

  async function releaseFraud(o: Order) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: `#${o.externalNumber ?? o.id.slice(0, 8)} অর্ডারের আটকানো ছেড়ে দেবেন?` }))) return;
    setFraudBusy("release"); setFraudNotice("");
    try {
      const updated = await apiFetch<Order>(`/organizations/${orgId}/orders/${o.id}/release`, {
        method: "POST", body: JSON.stringify({}),
      });
      syncOrderRow(updated);
      setFraudNotice("আটকানো ছেড়ে দেওয়া হয়েছে।");
      void loadQueues();
    } catch (e) { setFraudNotice(e instanceof Error ? e.message : "ছাড় দেওয়া ব্যর্থ"); }
    finally { setFraudBusy(""); }
  }

  /** Record a staff COD confirmation call. The server is the
   * authority for the status mapping (confirmed -> confirmed,
   * rejected -> declined); the returned order refreshes the
   * row / detail and the queue counts are reloaded. */
  async function recordCodCall(o: Order, outcome: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setCodBusy(`${o.id}`); setRowNotice("");
    try {
      const updated = await apiFetch<Order>(`/organizations/${orgId}/orders/${o.id}/cod-call`, {
        method: "POST", body: JSON.stringify({ outcome }),
      });
      syncOrderRow(updated);
      toast({ title: `#${o.externalNumber ?? o.id.slice(0, 8)} — কল রেকর্ড হয়েছে: ${codCallOutcomeLabel(outcome)}`, tone: "success" });
      void loadQueues();
    } catch (e) { setRowNotice(e instanceof Error ? e.message : "কল রেকর্ড ব্যর্থ"); }
    finally { setCodBusy(""); }
  }

  // ---- ON4: fraud settings + blocklist panel ----
  async function loadBlockedIdents(orgId: string) {
    const [byEmail, byIp, byDevice] = await Promise.all([
      apiFetch<IdentifierRow[]>(`/organizations/${orgId}/orders/blocked-identifiers?kind=email`).catch(() => [] as IdentifierRow[]),
      apiFetch<IdentifierRow[]>(`/organizations/${orgId}/orders/blocked-identifiers?kind=ip`).catch(() => [] as IdentifierRow[]),
      // AB8 (AX27): blocked device hashes ride the same list.
      apiFetch<IdentifierRow[]>(`/organizations/${orgId}/orders/blocked-identifiers?kind=device`).catch(() => [] as IdentifierRow[]),
    ]);
    setBlockedIdents([...(byEmail ?? []), ...(byIp ?? []), ...(byDevice ?? [])]);
  }

  async function loadFraudPanel() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setFraudPanelError("");
    try {
      const [s, blocked, trusted, attempts, rules] = await Promise.all([
        apiFetch<FraudSettings>(`/organizations/${orgId}/orders/fraud-settings`),
        apiFetch<BlockedPhoneRow[]>(`/organizations/${orgId}/orders/blocked-phones`),
        apiFetch<IdentifierRow[]>(`/organizations/${orgId}/orders/trusted-identifiers`).catch(() => [] as IdentifierRow[]),
        apiFetch<FraudAttemptRow[]>(`/organizations/${orgId}/orders/fraud-attempts`).catch(() => [] as FraudAttemptRow[]),
        apiFetch<FraudRuleRow[]>(`/organizations/${orgId}/orders/fraud-rules`).catch(() => [] as FraudRuleRow[]),
      ]);
      setFraudSettings(s);
      setFraudHighTaka(s?.highValueMinor ? minorToTaka(s.highValueMinor) : "");
      setTurnstileSecret("");
      setBlockedPhones(blocked ?? []);
      setTrustedIdents(trusted ?? []);
      setFraudAttempts(attempts ?? []);
      setFraudRules(rules ?? []);
      await loadBlockedIdents(orgId);
    } catch (e) { setFraudPanelError(e instanceof Error ? e.message : "জালিয়াতি সুরক্ষার তথ্য লোড ব্যর্থ"); }
  }

  function openFraudPanel() {
    setFraudPanelOpen(true); setFraudPanelNotice(""); setFraudPanelError("");
    void loadFraudPanel();
  }

  async function saveFraudSettings() {
    const orgId = getOrganizationId(); if (!orgId || !fraudSettings) return;
    const highMinor = fraudHighTaka.trim() ? takaToMinor(fraudHighTaka) : "0";
    if (highMinor === null) { setFraudPanelError("বড় অর্ডারের সীমা টাকায় ঠিকভাবে লিখুন (যেমন: 5000 বা 5000.50)।"); return; }
    setFraudPanelBusy("save"); setFraudPanelNotice(""); setFraudPanelError("");
    try {
      const updated = await apiFetch<FraudSettings>(`/organizations/${orgId}/orders/fraud-settings`, {
        method: "PUT",
        body: JSON.stringify({
          enabled: fraudSettings.enabled,
          autoHoldEnabled: fraudSettings.autoHoldEnabled,
          autoHoldBand: fraudSettings.autoHoldBand,
          highValueMinor: highMinor,
          burstCount: Number(fraudSettings.burstCount) || 0,
          burstWindowHours: Number(fraudSettings.burstWindowHours) || 0,
          // GB3: gate policy + rate limits + CAPTCHA. The secret is
          // omitted when the input is empty (= unchanged); a typed
          // value replaces it (the server seals it).
          openOrderPolicy: fraudSettings.openOrderPolicy || "off",
          openOrderWindowHours: Number(fraudSettings.openOrderWindowHours) || 0,
          waitingPeriodMinutes: Number(fraudSettings.waitingPeriodMinutes) || 0,
          maxOrdersPerPhonePerDay: Number(fraudSettings.maxOrdersPerPhonePerDay) || 0,
          captchaEnabled: !!fraudSettings.captchaEnabled,
          captchaOnCheckout: !!fraudSettings.captchaOnCheckout,
          captchaOnOtp: !!fraudSettings.captchaOnOtp,
          turnstileSiteKey: fraudSettings.turnstileSiteKey?.trim() ? fraudSettings.turnstileSiteKey.trim() : null,
          ...(turnstileSecret.trim() ? { turnstileSecret: turnstileSecret.trim() } : {}),
        }),
      });
      setFraudSettings(updated);
      setTurnstileSecret("");
      setFraudHighTaka(updated?.highValueMinor ? minorToTaka(updated.highValueMinor) : "");
      setFraudPanelNotice("জালিয়াতি সুরক্ষার সেটিংস সংরক্ষণ হয়েছে।");
    } catch (e) { setFraudPanelError(e instanceof Error ? e.message : "সেটিংস সংরক্ষণ ব্যর্থ"); }
    finally { setFraudPanelBusy(""); }
  }

  async function addBlockedPhone() {
    const orgId = getOrganizationId(); if (!orgId || !blockForm.phone.trim()) return;
    setFraudPanelBusy("block-add"); setFraudPanelNotice(""); setFraudPanelError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/blocked-phones`, {
        method: "POST",
        body: JSON.stringify({ phone: blockForm.phone.trim(), ...(blockForm.reason.trim() ? { reason: blockForm.reason.trim() } : {}) }),
      });
      setBlockForm({ phone: "", reason: "" });
      setFraudPanelNotice("নম্বরটি ব্লক তালিকায় যোগ হয়েছে।");
      setBlockedPhones(await apiFetch<BlockedPhoneRow[]>(`/organizations/${orgId}/orders/blocked-phones`));
    } catch (e) { setFraudPanelError(e instanceof Error ? e.message : "নম্বর ব্লক করা ব্যর্থ"); }
    finally { setFraudPanelBusy(""); }
  }

  async function deleteBlockedPhone(row: BlockedPhoneRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: `${row.phone} নম্বরটি ব্লক তালিকা থেকে সরাবেন?`, danger: true, confirmLabel: "সরিয়ে দিন" }))) return;
    setFraudPanelBusy(`block-del-${row.id}`); setFraudPanelNotice(""); setFraudPanelError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/blocked-phones/${row.id}`, { method: "DELETE" });
      setBlockedPhones((prev) => prev.filter((x) => x.id !== row.id));
      setFraudPanelNotice("নম্বরটি ব্লক তালিকা থেকে সরানো হয়েছে।");
    } catch (e) { setFraudPanelError(e instanceof Error ? e.message : "নম্বর সরানো ব্যর্থ"); }
    finally { setFraudPanelBusy(""); }
  }

  // ---- GB3: identifier lists (blocked email/IP + trusted) ----
  async function addBlockedIdent() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const err = validateIdentifierInput(blockedIdentForm.kind, blockedIdentForm.value, ["email", "ip", "device"]);
    if (err) { setFraudPanelError(err); return; }
    setFraudPanelBusy("ident-add"); setFraudPanelNotice(""); setFraudPanelError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/blocked-identifiers`, {
        method: "POST",
        body: JSON.stringify({
          kind: blockedIdentForm.kind,
          value: normalizeIdentifierValue(blockedIdentForm.kind, blockedIdentForm.value),
          ...(blockedIdentForm.reason.trim() ? { reason: blockedIdentForm.reason.trim() } : {}),
        }),
      });
      setBlockedIdentForm({ kind: blockedIdentForm.kind, value: "", reason: "" });
      setFraudPanelNotice("শনাক্তকারীটি ব্লক তালিকায় যোগ হয়েছে।");
      await loadBlockedIdents(orgId);
    } catch (e) { setFraudPanelError(e instanceof Error ? e.message : "ব্লক করা ব্যর্থ"); }
    finally { setFraudPanelBusy(""); }
  }

  async function deleteBlockedIdent(row: IdentifierRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setFraudPanelBusy(`ident-del-${row.id}`); setFraudPanelNotice(""); setFraudPanelError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/blocked-identifiers/${row.id}`, { method: "DELETE" });
      setBlockedIdents((prev) => prev.filter((x) => x.id !== row.id));
      setFraudPanelNotice("শনাক্তকারীটি ব্লক তালিকা থেকে সরানো হয়েছে।");
    } catch (e) { setFraudPanelError(e instanceof Error ? e.message : "সরানো ব্যর্থ"); }
    finally { setFraudPanelBusy(""); }
  }

  async function addTrustedIdent() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const err = validateIdentifierInput(trustedForm.kind, trustedForm.value, ["phone", "email", "ip"]);
    if (err) { setFraudPanelError(err); return; }
    setFraudPanelBusy("trusted-add"); setFraudPanelNotice(""); setFraudPanelError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/trusted-identifiers`, {
        method: "POST",
        body: JSON.stringify({
          kind: trustedForm.kind,
          value: normalizeIdentifierValue(trustedForm.kind, trustedForm.value),
          ...(trustedForm.reason.trim() ? { reason: trustedForm.reason.trim() } : {}),
        }),
      });
      setTrustedForm({ kind: trustedForm.kind, value: "", reason: "" });
      setFraudPanelNotice("শনাক্তকারীটি বিশ্বস্ত তালিকায় যোগ হয়েছে।");
      setTrustedIdents(await apiFetch<IdentifierRow[]>(`/organizations/${orgId}/orders/trusted-identifiers`));
    } catch (e) { setFraudPanelError(e instanceof Error ? e.message : "যোগ করা ব্যর্থ"); }
    finally { setFraudPanelBusy(""); }
  }

  async function deleteTrustedIdent(row: IdentifierRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setFraudPanelBusy(`trusted-del-${row.id}`); setFraudPanelNotice(""); setFraudPanelError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/trusted-identifiers/${row.id}`, { method: "DELETE" });
      setTrustedIdents((prev) => prev.filter((x) => x.id !== row.id));
      setFraudPanelNotice("শনাক্তকারীটি বিশ্বস্ত তালিকা থেকে সরানো হয়েছে।");
    } catch (e) { setFraudPanelError(e instanceof Error ? e.message : "সরানো ব্যর্থ"); }
    finally { setFraudPanelBusy(""); }
  }

  // ---- GB3: fraud rules ----
  async function createFraudRule() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const { payload, errors } = buildFraudRulePayload(ruleDraft);
    if (!payload) { setFraudPanelError(errors.join(" ")); return; }
    setFraudPanelBusy("rule-add"); setFraudPanelNotice(""); setFraudPanelError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/fraud-rules`, {
        method: "POST", body: JSON.stringify(payload),
      });
      setRuleDraft(EMPTY_FRAUD_RULE_DRAFT);
      setFraudPanelNotice("নিয়মটি তৈরি হয়েছে।");
      setFraudRules(await apiFetch<FraudRuleRow[]>(`/organizations/${orgId}/orders/fraud-rules`));
    } catch (e) { setFraudPanelError(e instanceof Error ? e.message : "নিয়ম তৈরি ব্যর্থ"); }
    finally { setFraudPanelBusy(""); }
  }

  async function toggleFraudRule(row: FraudRuleRow, enabled: boolean) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setFraudPanelBusy(`rule-toggle-${row.id}`); setFraudPanelNotice(""); setFraudPanelError("");
    try {
      const updated = await apiFetch<FraudRuleRow>(`/organizations/${orgId}/orders/fraud-rules/${row.id}`, {
        method: "PATCH", body: JSON.stringify({ enabled }),
      });
      setFraudRules((prev) => prev.map((x) => (x.id === row.id ? { ...x, ...(updated ?? {}), enabled } : x)));
    } catch (e) { setFraudPanelError(e instanceof Error ? e.message : "নিয়ম বদলানো ব্যর্থ"); }
    finally { setFraudPanelBusy(""); }
  }

  async function deleteFraudRule(row: FraudRuleRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: `"${row.name}" নিয়মটি মুছে ফেলবেন?`, danger: true, confirmLabel: "মুছে ফেলুন" }))) return;
    setFraudPanelBusy(`rule-del-${row.id}`); setFraudPanelNotice(""); setFraudPanelError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/fraud-rules/${row.id}`, { method: "DELETE" });
      setFraudRules((prev) => prev.filter((x) => x.id !== row.id));
      setFraudPanelNotice("নিয়মটি মুছে ফেলা হয়েছে।");
    } catch (e) { setFraudPanelError(e instanceof Error ? e.message : "নিয়ম মোছা ব্যর্থ"); }
    finally { setFraudPanelBusy(""); }
  }

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
    setLoading(true);
    try {
      // ON1: queue and the legacy status filter are alternatives —
      // buildOrderListParams sends queue INSTEAD of status when a
      // queue is selected (documented in lib/orders-on1).
      const params = buildOrderListParams({ ...filters, status, codOnly });
      const [list, st] = await Promise.all([
        apiFetch<{ total: number; items: Order[] }>(`/organizations/${orgId}/orders?${params}`),
        apiFetch<Stats>(`/organizations/${orgId}/orders/stats`),
      ]);
      setItems(list.items); setTotal(list.total); setStats(st); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load orders"); }
    finally { setLoading(false); }
  }, [filters, status, codOnly]);

  useEffect(() => { load(); }, [load]);

  // ---- ON1 helpers ----
  const patchFilters = useCallback((p: Partial<OrderFilters>) => {
    setFilters((prev) => ({ ...prev, ...p }));
  }, []);

  // Debounced search: the draft updates instantly, the query only
  // after the user pauses typing.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((prev) => (prev.search === searchDraft ? prev : { ...prev, search: searchDraft }));
    }, 350);
    return () => clearTimeout(t);
  }, [searchDraft]);

  // ED12 (EB5): mirror queue / status / committed search back into
  // the URL (replace, scroll preserved; params at their default
  // values are omitted, so the bare URL stays bare). Saved views
  // flow through applyFiltersObject -> these same states, so
  // applying a view updates the URL through this same path.
  // Pagination is deliberately NOT in the URL: the list has no
  // page state — buildOrderListParams always requests pageSize 50.
  useEffect(() => {
    const next = new URLSearchParams();
    if (filters.queue) next.set("queue", filters.queue);
    if (status) next.set("status", status);
    if (filters.search) next.set("search", filters.search);
    const qs = next.toString();
    if (qs === searchParams.toString()) return;
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters.queue, filters.search, status, pathname, router, searchParams]);

  const loadQueues = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try { setQueues(await apiFetch<QueueRow[]>(`/organizations/${orgId}/orders/queues`)); }
    catch { /* queues are an accelerator; the plain list still works */ }
  }, []);
  useEffect(() => { void loadQueues(); }, [loadQueues]);

  const loadSavedViews = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try { setSavedViews(await apiFetch<SavedView[]>(`/organizations/${orgId}/orders/saved-views`)); }
    catch { setSavedViews([]); }
  }, []);
  useEffect(() => { void loadSavedViews(); }, [loadSavedViews]);

  // Org staff for the assignee selects — same endpoint the inbox /
  // team pages use; cached in state for the page's lifetime.
  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<MemberRow[]>(`/organizations/${orgId}/members`).then(setMembers).catch(() => undefined);
  }, []);

  // Live feed poll (~25s, visible tab only). Refreshes the queue
  // counts on the same cycle. NEVER touches the list itself.
  const pollFeed = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    try {
      const feed = await apiFetch<FeedItem[]>(`/organizations/${orgId}/orders/feed?since=${encodeURIComponent(feedWatermarkRef.current)}`);
      if (feed && feed.length > 0) {
        const adv = feedAdvance(feed, feedWatermarkRef.current, initialLoadRef.current);
        feedWatermarkRef.current = adv.nextWatermark;
        if (adv.newCreated > 0) {
          setNewOrdersCount((prev) => prev + adv.newCreated);
          setFeedToast(`${adv.newCreated}টি নতুন অর্ডার এসেছে`);
        }
      }
    } catch { /* feed is advisory — a failed poll changes nothing */ }
    void loadQueues();
  }, [loadQueues]);
  useEffect(() => {
    const t = setInterval(() => { void pollFeed(); }, 25000);
    return () => clearInterval(t);
  }, [pollFeed]);
  useEffect(() => {
    if (!feedToast) return;
    const t = setTimeout(() => setFeedToast(""), 6000);
    return () => clearTimeout(t);
  }, [feedToast]);

  function applyFiltersObject(next: OrderFilters) {
    setFilters(next);
    setStatus(next.status);
    setCodOnly(next.codOnly);
    setSearchDraft(next.search);
  }

  /** Queue and the plain status filter are alternatives:
   * selecting a queue clears the status filter (and picking a
   * status clears the queue), so the UI never shows two active
   * alternatives at once. buildOrderListParams already lets
   * the queue win at the param level; this keeps the visible
   * state honest too. */
  function selectQueue(key: string) {
    setFilters((prev) => ({ ...prev, queue: key, status: key ? "" : prev.status }));
    if (key) setStatus("");
  }
  function resetFilters() { applyFiltersObject(EMPTY_ORDER_FILTERS); }

  async function saveCurrentView() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const name = await prompt({ title: "ভিউয়ের নাম লিখুন" });
    if (!name || !name.trim()) return;
    setViewNotice("");
    try {
      const payload = filtersToViewPayload({ ...filters, status, codOnly });
      await apiFetch(`/organizations/${orgId}/orders/saved-views`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), ...(payload.queue ? { queue: payload.queue } : {}), filters: payload.filters }),
      });
      toast({ title: "ভিউ সংরক্ষণ হয়েছে।", tone: "success" });
      await loadSavedViews();
    } catch (e) { setViewNotice(e instanceof Error ? e.message : "ভিউ সংরক্ষণ ব্যর্থ"); }
  }
  async function deleteView(v: SavedView) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setViewNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/saved-views/${v.id}`, { method: "DELETE" });
      await loadSavedViews();
    } catch (e) { setViewNotice(e instanceof Error ? e.message : "ভিউ মোছা ব্যর্থ"); }
  }

  /** ON1 bulk action via POST /orders/bulk. set_status and
   * book_courier ask for confirmation first. The per-order result
   * summary (incl. the server's verbatim errors) stays visible
   * until the next action. */
  async function runBulkAction(action: string) {
    const orgId = getOrganizationId(); if (!orgId || selected.length === 0) return;
    if (action === "set_status" && !(await confirm({ title: `${selected.length}টি অর্ডারের অবস্থা "${bulkStatus}" করবেন?` }))) return;
    if (action === "book_courier" && !(await confirm({ title: `${selected.length}টি অর্ডারের জন্য ${bulkProviderOn1} কুরিয়ার বুক করবেন?`, danger: true, confirmLabel: "বুক করুন" }))) return;
    if ((action === "add_tag" || action === "remove_tag") && !bulkTag.trim()) { setRowNotice("আগে ট্যাগ লিখুন।"); return; }
    if (action === "assign" && !bulkAssignee) { setRowNotice("আগে দায়িত্বপ্রাপ্ত সদস্য বেছে নিন।"); return; }
    setBulkActionBusy(action); setBulkActionResult(null); setRowNotice("");
    try {
      const params: Record<string, unknown> =
        action === "set_status" ? { status: bulkStatus }
        : action === "add_tag" || action === "remove_tag" ? { tag: bulkTag.trim() }
        : action === "assign" ? { assigneeId: bulkAssignee === "__none__" ? null : bulkAssignee }
        : action === "book_courier" ? { provider: bulkProviderOn1 }
        : {};
      const out = await apiFetch<{ results: { orderId: string; ok: boolean; error?: string }[]; succeeded: number; failed: number; print?: { labelShipmentIds?: string[]; invoiceOrderIds?: string[] } }>(
        `/organizations/${orgId}/orders/bulk`,
        { method: "POST", body: JSON.stringify({ orderIds: selected, action, params }) },
      );
      setBulkActionResult(out);
      // Bulk print: the bulk endpoint resolves WHICH shipments /
      // orders are printable; the PDFs themselves come from the
      // existing courier PDF routes (labels.pdf takes shipment
      // ids; the new invoices.pdf mirrors it taking order ids).
      if (out.print?.labelShipmentIds?.length) {
        void downloadPdf(`/organizations/${orgId}/courier/labels.pdf?ids=${out.print.labelShipmentIds.join(",")}`, "labels.pdf");
      }
      if (out.print?.invoiceOrderIds?.length) {
        void downloadPdf(`/organizations/${orgId}/courier/invoices.pdf?ids=${out.print.invoiceOrderIds.join(",")}`, "invoices.pdf");
      }
      if (out.succeeded > 0) setSelected([]);
      await load();
      void loadQueues();
    } catch (e) { setRowNotice(e instanceof Error ? e.message : "বাল্ক অ্যাকশন ব্যর্থ"); }
    finally { setBulkActionBusy(""); }
  }

  // ---- ON5: notification settings panel ----
  async function loadNotifPanel() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setNotifPanelError("");
    try {
      const cfg = await apiFetch<NotifConfig>(`/organizations/${orgId}/orders/notification-settings`);
      setNotifConfig(cfg);
    } catch (e) { setNotifPanelError(e instanceof Error ? e.message : "বিজ্ঞপ্তি সেটিংস লোড ব্যর্থ"); }
  }

  function openNotifPanel() {
    setNotifPanelOpen(true); setNotifPanelNotice(""); setNotifPanelError("");
    void loadNotifPanel();
  }

  /** Channel membership toggle. The stored order is ALWAYS the
   * canonical sms → whatsapp → email order (the order channels are
   * tried in), so toggling only changes membership. */
  function toggleNotifChannel(eventKey: string, channel: string) {
    setNotifConfig((prev) => {
      if (!prev?.[eventKey]) return prev;
      const has = prev[eventKey].channels.includes(channel);
      const next = new Set(prev[eventKey].channels);
      if (has) next.delete(channel); else next.add(channel);
      const channels = NOTIFICATION_CHANNELS.filter((c) => next.has(c));
      return { ...prev, [eventKey]: { ...prev[eventKey], channels } };
    });
  }

  async function saveNotifSettings() {
    const orgId = getOrganizationId(); if (!orgId || !notifConfig) return;
    setNotifPanelBusy("save"); setNotifPanelNotice(""); setNotifPanelError("");
    try {
      // Server validation errors (e.g. an unknown template
      // variable) come back as a 400 — shown verbatim below.
      const updated = await apiFetch<NotifConfig>(`/organizations/${orgId}/orders/notification-settings`, {
        method: "PUT", body: JSON.stringify(notifConfig),
      });
      setNotifConfig(updated);
      setNotifPanelNotice("বিজ্ঞপ্তি সেটিংস সংরক্ষণ হয়েছে।");
    } catch (e) { setNotifPanelError(e instanceof Error ? e.message : "সেটিংস সংরক্ষণ ব্যর্থ"); }
    finally { setNotifPanelBusy(""); }
  }

  /** ON6 bulk action: add the selected orders to a new pick wave
   * (POST /pick-waves). Per-order failures stay visible verbatim,
   * like the other bulk actions; when NO order can be added the
   * server's 400 message is shown verbatim via rowNotice. */
  async function addSelectedToWave() {
    const orgId = getOrganizationId(); if (!orgId || selected.length === 0) return;
    setBulkActionBusy("wave"); setWaveResult(null); setRowNotice("");
    try {
      const out = await apiFetch<{ wave: { id: string }; results: { orderId: string; ok: boolean; error?: string }[] }>(
        `/organizations/${orgId}/pick-waves`,
        { method: "POST", body: JSON.stringify({ orderIds: selected }) },
      );
      const failed = out.results.filter((r) => !r.ok)
        .map((r) => ({ orderId: r.orderId, error: r.error ?? "অজানা ত্রুটি" }));
      setWaveResult({ added: out.results.length - failed.length, failed });
      if (failed.length < out.results.length) setSelected([]);
    } catch (e) { setRowNotice(e instanceof Error ? e.message : "ওয়েভে যোগ ব্যর্থ"); }
    finally { setBulkActionBusy(""); }
  }

  /** Open any order in the detail panel — used by Customer 360's
   * recent-orders list: in-page rows open directly, others are
   * fetched by id first (a failed fetch says so, never fakes). */
  async function openOrderById(orderId: string) {
    const found = items.find((o) => o.id === orderId);
    if (found) { if (actOrder?.id !== orderId) openActions(found); return; }
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const detail = await apiFetch<Order>(`/organizations/${orgId}/orders/${orderId}`);
      setActOrder(detail); setActStatus(detail.status); setActNote(detail.internalNote ?? "");
    } catch (e) { setRowNotice(e instanceof Error ? e.message : "অর্ডার খোলা ব্যর্থ"); }
  }

  /** COD confirmation quick action. The inbox contract is
   * POST /inbox/conversations/:conversationId/cod-confirmation
   * { orderId } and it SENDS the confirmation request — the
   * server refuses (verbatim) when a request is already awaiting
   * or already confirmed. So: when the order has a conversation
   * and no request is outstanding, this page calls that endpoint
   * directly; when codConfirmationStatus is "awaiting" the button
   * instead deep-links to the inbox (the request is already out;
   * there is nothing to send). The inbox has no per-conversation
   * deep-link parameter, so the link lands on the inbox itself. */
  async function requestCodForRow(o: Order) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const conversationId = o.codConversationId ?? o.conversationId;
    if (!conversationId) { setRowNotice("এই অর্ডারের সাথে কোনো কথোপকথন যুক্ত নেই — COD কনফার্মেশন পাঠানো যাবে না।"); return; }
    setRowBusy(`cod-${o.id}`); setRowNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/conversations/${conversationId}/cod-confirmation`, {
        method: "POST", body: JSON.stringify({ orderId: o.id }),
      });
      toast({ title: `#${o.externalNumber ?? o.id.slice(0, 8)} — COD কনফার্মেশন বার্তা পাঠানো হয়েছে। গ্রাহকের উত্তরের অপেক্ষায়।`, tone: "success" });
      await load();
    } catch (e) { setRowNotice(e instanceof Error ? e.message : "COD কনফার্মেশন পাঠানো ব্যর্থ"); }
    finally { setRowBusy(""); }
  }

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
      } else if (provider === "ecourier") {
        const [cities, packages] = await Promise.all([
          apiFetch<any[]>(`/organizations/${orgId}/courier/ecourier/cities`).catch(() => []),
          apiFetch<any[]>(`/organizations/${orgId}/courier/ecourier/packages`).catch(() => []),
        ]);
        setECities(cities); setEPackages(packages); setEThanas([]);
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

  async function connectEcourier(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setCourierBusy("ecourier"); setCourierNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connect`, { method: "POST", body: JSON.stringify({ provider: "ecourier", apiKey: ecourierForm.apiKey, apiSecret: ecourierForm.apiSecret, userId: ecourierForm.userId, baseUrl: ecourierForm.baseUrl || undefined }) });
      setCourierNotice("eCourier যুক্ত হয়েছে (আসল API দিয়ে Package তালিকা যাচাই করা)।");
      setEcourierForm({ apiKey: "", apiSecret: "", userId: "", baseUrl: "" });
      await loadCourier();
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "eCourier connect ব্যর্থ"); }
    finally { setCourierBusy(""); }
  }

  // GB5 (GC14): shipment event history + manual status.
  async function loadShipmentEvents(shipmentId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const out = await apiFetch<any>(`/organizations/${orgId}/courier/shipments/${shipmentId}/events`);
      setShipmentEvents(out.events ?? []);
    } catch { setShipmentEvents([]); }
  }
  async function toggleShipmentDetail(shipmentId: string) {
    if (detailShipmentId === shipmentId) { setDetailShipmentId(null); return; }
    setDetailShipmentId(shipmentId);
    setManualNote("");
    await loadShipmentEvents(shipmentId);
  }
  async function submitManualStatus(shipmentId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setManualBusy(true); setCourierNotice("");
    try {
      const out = await apiFetch<any>(`/organizations/${orgId}/courier/shipments/${shipmentId}/manual-status`, {
        method: "POST", body: JSON.stringify({ status: manualStatus, note: manualNote || undefined }),
      });
      setCourierNotice(out.changed ? `ম্যানুয়াল স্ট্যাটাস হালনাগাদ: ${manualStatus}` : "স্ট্যাটাস একই আছে — নোট ইতিহাসে যোগ হয়েছে।");
      setManualNote("");
      await loadShipmentEvents(shipmentId);
      await loadCourier();
    } catch (err) { setCourierNotice(err instanceof Error ? err.message : "ম্যানুয়াল হালনাগাদ ব্যর্থ"); }
    finally { setManualBusy(false); }
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
          ecourier: bookForm.provider === "ecourier" ? {
            city: bookForm.eCity || undefined,
            thana: bookForm.eThana || undefined,
            area: bookForm.eArea || undefined,
            zip: bookForm.eZip || undefined,
            packageCode: bookForm.ePackage || undefined,
            paymentMethod: bookForm.ePayMethod || undefined,
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
          ecourier: bulkProvider === "ecourier" ? {
            city: bookForm.eCity || undefined,
            thana: bookForm.eThana || undefined,
            area: bookForm.eArea || undefined,
            zip: bookForm.eZip || undefined,
            packageCode: bookForm.ePackage || undefined,
            paymentMethod: bookForm.ePayMethod || undefined,
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
        <button type="button" className="btn-secondary btn-sm ml-3 mt-2" onClick={openFraudPanel}>🛡️ জালিয়াতি সুরক্ষা</button>
        <button type="button" className="btn-secondary btn-sm ml-3 mt-2" onClick={openNotifPanel}>🔔 বিজ্ঞপ্তি সেটিংস</button>
        <button type="button" className="btn-secondary btn-sm ml-3 mt-2" onClick={() => setAutomationPanelOpen(true)}>🤖 অটোমেশন</button>
        <button type="button" className="btn-secondary btn-sm ml-3 mt-2" onClick={() => setAnalyticsPanelOpen(true)}>📊 অ্যানালিটিক্স</button>
        <button type="button" className="btn-secondary btn-sm ml-3 mt-2" onClick={() => setPrintPanelOpen(true)}>🖨️ প্রিন্ট সেন্টার</button>
        <button type="button" className="btn-secondary btn-sm ml-3 mt-2" onClick={() => setTeamPanelOpen(true)}>👥 টিম পারফরম্যান্স</button>
        <button type="button" className="btn-secondary btn-sm ml-3 mt-2" onClick={() => setShowDuplicatesModal(true)}>⚠️ ডুপ্লিকেট অর্ডার{(duplicateData?.totalDuplicateOrders ?? 0) > 0 ? ` (${duplicateData?.totalDuplicateOrders})` : ""}</button>
      </div>
      {stats ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="মোট অর্ডার" value={String(stats.totalOrders)} />
          <KpiCard label="COD অর্ডার" value={String(stats.codOrders)} hint={`মোটের ${stats.codSharePercent}%`} />
          <KpiCard label="Delivered Revenue" value={formatMinor(BigInt(stats.deliveredRevenueMinor))} hint="শুধু completed" />
          <KpiCard label="স্ট্যাটাস" value={stats.byStatus.map((s) => `${s.status}: ${s.count}`).join(" · ") || "—"} />
        </div>
      ) : null}
      {/* ON1: Filter bar v2 — the legacy status / COD / practice
          controls stay and map to the same legacy params; the rest
          are the new list params. Queue (in the rail below) and
          status are alternatives: picking a queue ignores status. */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input w-56" placeholder="🔍 খুঁজুন — নাম, ফোন, অর্ডার নম্বর…" aria-label="খুঁজুন" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} />
          <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); if (e.target.value) patchFilters({ queue: "" }); }} aria-label="স্ট্যাটাস">
            {STATUSES.map((s) => <option key={s} value={s}>{s === "" ? "সব স্ট্যাটাস" : s}</option>)}
          </select>
          <select className="input w-auto" value={filters.sort} onChange={(e) => patchFilters({ sort: e.target.value })} aria-label="সাজান">
            <option value="placedAt_desc">নতুন আগে</option>
            <option value="placedAt_asc">পুরনো আগে</option>
            <option value="total_desc">মোট: বেশি থেকে কম</option>
            <option value="total_asc">মোট: কম থেকে বেশি</option>
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={codOnly} onChange={(e) => setCodOnly(e.target.checked)} /> শুধু COD</label>
          <label className="flex items-center gap-2 text-sm" title="CX12a প্র্যাক্টিস অর্ডার — আসল তালিকায় এগুলো ডিফল্টে থাকে না"><input type="checkbox" checked={filters.practice} onChange={(e) => patchFilters({ practice: e.target.checked })} /> প্র্যাক্টিস অর্ডার দেখান</label>
          <button className="btn-secondary btn-sm" disabled={exportBusy} onClick={downloadExport}>{exportBusy ? "ডাউনলোড হচ্ছে..." : "এক্সপোর্ট (CSV)"}</button>
          <span className="ml-auto text-xs text-slate-500" title="তালিকা নিজে থেকে বদলায় না — নতুন অর্ডার এলে উপরে জানানো হয়, আপনি চাইলে তালিকা রিলোড হয়">স্বয়ংক্রিয় হালনাগাদ: চালু (২৫ সেকেন্ডে যাচাই)</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">থেকে <input type="date" className="input w-auto" value={filters.dateFrom} onChange={(e) => patchFilters({ dateFrom: e.target.value })} /></label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">পর্যন্ত <input type="date" className="input w-auto" value={filters.dateTo} onChange={(e) => patchFilters({ dateTo: e.target.value })} /></label>
          <input className="input w-36" placeholder="জেলা" aria-label="জেলা" value={filters.district} onChange={(e) => patchFilters({ district: e.target.value })} />
          <select className="input w-auto" value={filters.provider} onChange={(e) => patchFilters({ provider: e.target.value })} aria-label="কুরিয়ার">
            <option value="">কুরিয়ার: সব</option>
            <option value="steadfast">Steadfast</option>
            <option value="pathao">Pathao</option>
            <option value="redx">RedX</option>
            <option value="ecourier">eCourier</option>
          </select>
          <select className="input w-auto" value={filters.source} onChange={(e) => patchFilters({ source: e.target.value })} aria-label="উৎস">
            <option value="">উৎস: সব</option>
            <option value="woocommerce">WooCommerce</option>
            <option value="shopify">Shopify</option>
            <option value="native">নিজস্ব স্টোর</option>
            <option value="manual">ম্যানুয়াল</option>
            <option value="landing">ল্যান্ডিং পেজ</option>
            <option value="pos">POS</option>
            <option value="subscription">সাবস্ক্রিপশন</option>
            <option value="chat">চ্যাট</option>
          </select>
          <select className="input w-auto" value={filters.paymentState} onChange={(e) => patchFilters({ paymentState: e.target.value })} aria-label="পেমেন্ট অবস্থা">
            <option value="">পেমেন্ট: সব</option>
            <option value="paid">পরিশোধিত</option>
            <option value="partial">আংশিক</option>
            <option value="due">বকেয়া</option>
          </select>
          <select className="input w-auto" value={filters.riskBand} onChange={(e) => patchFilters({ riskBand: e.target.value })} aria-label="জালিয়াতি ঝুঁকি" title="জালিয়াতি ঝুঁকি (Fraud Shield)">
            <option value="">সব ঝুঁকি</option>
            <option value="low">কম ঝুঁকি</option>
            <option value="medium">মাঝারি ঝুঁকি</option>
            <option value="high">উচ্চ ঝুঁকি</option>
          </select>
          <input className="input w-28" placeholder="কমপক্ষে ৳" inputMode="decimal" aria-label="কমপক্ষে মোট (টাকা)" value={filters.minTotalTaka} onChange={(e) => patchFilters({ minTotalTaka: e.target.value })} />
          <input className="input w-28" placeholder="সর্বোচ্চ ৳" inputMode="decimal" aria-label="সর্বোচ্চ মোট (টাকা)" value={filters.maxTotalTaka} onChange={(e) => patchFilters({ maxTotalTaka: e.target.value })} />
          <select className="input w-auto" value={filters.assigneeId} onChange={(e) => patchFilters({ assigneeId: e.target.value })} aria-label="দায়িত্বপ্রাপ্ত">
            <option value="">দায়িত্ব: সবাই</option>
            {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name ?? m.user.email}</option>)}
          </select>
          <input className="input w-32" placeholder="ট্যাগ" aria-label="ট্যাগ" value={filters.tag} onChange={(e) => patchFilters({ tag: e.target.value })} />
          <button className="btn-ghost btn-sm" onClick={resetFilters}>ফিল্টার সাফ করুন</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <span className="text-xs font-semibold text-slate-500">সংরক্ষিত ভিউ:</span>
          {savedViews.length === 0 ? <span className="text-xs text-slate-500">কোনো ভিউ নেই</span> : savedViews.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-3 pr-1.5 text-xs font-medium">
              <button type="button" className="hover:underline" onClick={() => applyFiltersObject(viewToFilters(v))}>{v.name}</button>
              <button type="button" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full px-1 text-slate-400 hover:text-red-600" title="ভিউ মুছুন" aria-label="ভিউ মুছুন" onClick={() => void deleteView(v)}>✕</button>
            </span>
          ))}
          <button className="btn-secondary btn-sm" onClick={() => void saveCurrentView()}>ভিউ সংরক্ষণ</button>
          {viewNotice ? <span className="text-xs text-indigo-700">{viewNotice}</span> : null}
          {rowNotice ? <span className="text-xs font-medium text-indigo-700">{rowNotice}</span> : null}
        </div>
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
          <span className="text-[11px] text-slate-500">কীবোর্ডের মাইক (🎤) দিয়ে নম্বর বলেও লেখা যায় — এই বক্সে বললেই সংখ্যা বসবে, আলাদা কোনো ভয়েস-চেনা ফিচার নয়।</span>
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
            <p className="text-xs text-slate-500 sm:col-span-3">Key Steadfast Portal থেকে পাবেন। যুক্ত করার আগে আসল API দিয়ে Balance যাচাই করা হয়; ভুল Key হলে Steadfast এর নিজের ত্রুটিই দেখাবে।</p>
          </form>
        )}
      </div>
      <div className="card space-y-4">
        <h2 className="font-semibold">🚚 আরও কুরিয়ার — Pathao / RedX / eCourier</h2>
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
                <p className="text-xs text-slate-500">Client ID/Secret Pathao Merchant Panel এর Developer API অংশে পাবেন। যুক্ত করার আগে আসল API তে Token নিয়ে Store তালিকা যাচাই করা হয়। পাসওয়ার্ড Token নবায়নের জন্য এনক্রিপ্ট করে রাখা হয়।</p>
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
                <p className="text-xs text-slate-500">Token RedX Merchant Panel এর API Settings থেকে পাবেন। যুক্ত করার আগে আসল API থেকে Delivery Area তালিকা এনে যাচাই করা হয়।</p>
              </form>
            )}
          </div>
          <div className="space-y-2 rounded-xl bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">eCourier</span>
              <span className={conns.find((c) => c.provider === "ecourier")?.connected ? "badge-green" : "badge-slate"}>{conns.find((c) => c.provider === "ecourier")?.connected ? "যুক্ত আছে" : "যুক্ত নেই"}</span>
            </div>
            {conns.find((c) => c.provider === "ecourier")?.connected ? (
              <button className="btn-ghost btn-sm text-red-600" onClick={() => disconnectProvider("ecourier")}>সংযোগ বিচ্ছিন্ন</button>
            ) : (
              <form onSubmit={connectEcourier} className="grid gap-2">
                <input className="input" placeholder="API Key" value={ecourierForm.apiKey} onChange={(e) => setEcourierForm({ ...ecourierForm, apiKey: e.target.value })} required />
                <input className="input" placeholder="API Secret" value={ecourierForm.apiSecret} onChange={(e) => setEcourierForm({ ...ecourierForm, apiSecret: e.target.value })} required />
                <input className="input" placeholder="User ID" value={ecourierForm.userId} onChange={(e) => setEcourierForm({ ...ecourierForm, userId: e.target.value })} required />
                <input className="input" placeholder="Base URL (ঐচ্ছিক — Partner অ্যাকাউন্টের জন্য)" value={ecourierForm.baseUrl} onChange={(e) => setEcourierForm({ ...ecourierForm, baseUrl: e.target.value })} />
                <button className="btn-primary btn-sm" disabled={courierBusy !== ""}>{courierBusy === "ecourier" ? "যাচাই হচ্ছে..." : "যাচাই করে যুক্ত করুন"}</button>
                <p className="text-xs text-slate-500">তিনটি তথ্য eCourier আপনার মার্চেন্ট অ্যাকাউন্টের জন্য ইস্যু করে দেয় — তাদের কাছ থেকে সংগ্রহ করুন। যুক্ত করার আগে আসল API থেকে নির্ধারিত Package তালিকা এনে যাচাই করা হয়।</p>
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
          {conns.filter((c) => c.connected).length === 0 ? <p className="text-xs text-slate-500">কোনো কুরিয়ার যুক্ত নেই।</p> : conns.filter((c) => c.connected).map((c) => (
            <div key={c.provider} className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-sm font-medium">{c.provider}</span>
              <input className="input flex-1" placeholder="https://…/track/{trackingId}" value={trackingTemplates[c.provider] ?? ""} onChange={(e) => setTrackingTemplates({ ...trackingTemplates, [c.provider]: e.target.value })} />
              <button type="button" className="btn-secondary btn-sm" disabled={ruleBusy !== ""} onClick={() => saveTrackingTemplate(c.provider)}>{ruleBusy === `tpl-${c.provider}` ? "হচ্ছে…" : "সংরক্ষণ"}</button>
            </div>
          ))}
          <p className="text-xs text-slate-500">{"{trackingId}"} জায়গায় আসল ট্র্যাকিং কোড বসবে। খালি রাখলে আগের মতোই শুধু নম্বর দেখাবে।</p>
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
          <ResponsiveTable
            table={
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
            }
            cards={[...perf.providers, perf.totals].map((row) => {
              const isTotal = row.provider === "total";
              const rate = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);
              return (
                <div key={row.provider} className={`rounded-xl border bg-white p-3 shadow-sm ${isTotal ? "bg-slate-50 font-semibold" : ""}`}>
                  <div className="font-bold text-slate-900">{PERF_PROVIDER_LABEL[row.provider] ?? row.provider}</div>
                  <dl className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">বুকিং</dt><dd className="font-medium">{row.booked}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">ডেলিভার্ড</dt><dd className="font-medium">{row.delivered}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">রিটার্ন</dt><dd className="font-medium">{row.returned}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">বাতিল</dt><dd className="font-medium">{row.cancelled}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">পথে আছে</dt><dd className="font-medium">{row.inFlight}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">ডেলিভারি হার</dt><dd className="font-medium">{rate(row.deliveryRate)}</dd></div>
                    <div className="flex justify-between gap-2"><dt className="text-slate-500">রিটার্ন হার</dt><dd className="font-medium">{rate(row.returnRate)}</dd></div>
                  </dl>
                </div>
              );
            })}
          />
        )}
        <p className="text-[11px] text-slate-500">হিসাবের নিয়ম: শুধু এই সময়ে বুক করা shipment। ডেলিভার্ড = delivered + partial delivery; decided = ডেলিভার্ড + রিটার্ন + বাতিল; হার = decided-এর মধ্যে অংশ — decided 0 হলে হার দেখানো হয় না। গড় ডেলিভারি সময় এখন দেখানো যাচ্ছে না, কারণ shipment রেকর্ডে ডেলিভারির মুহূর্তের timestamp সংরক্ষিত হয় না।</p>
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
          <p className="text-xs text-slate-500">স্কোরটি শুধু এই দোকানের নিজের অর্ডার ইতিহাস থেকে হিসাব করা (ফোন নম্বর মিলিয়ে)। এটি কোনো অর্ডার আটকায় না — সিদ্ধান্ত সবসময় আপনার।</p>
        </div>
      ) : null}
      {/* ON4: Fraud Shield detail — the PERSISTED fraud
          assessment (score / band / reasons with points), the
          review-hold state and its actions. Distinct from the
          M50 return-risk panel above. */}
      {fraudOrder ? (
        <div className="card space-y-2 border-rose-200 bg-rose-50/50">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">🛡️ জালিয়াতি ঝুঁকি (Fraud Shield) — অর্ডার #{fraudOrder.externalNumber ?? fraudOrder.id.slice(0, 8)}
              {fraudOrder.riskBand ? (
                <span className={`ml-2 rounded px-2 py-0.5 text-xs font-semibold ${FRAUD_BAND_LABEL[fraudOrder.riskBand]?.cls ?? ""}`} title="জালিয়াতি ঝুঁকি (Fraud Shield)">
                  {FRAUD_BAND_LABEL[fraudOrder.riskBand]?.text ?? fraudOrder.riskBand}{fraudOrder.riskScore != null ? ` · ${fraudOrder.riskScore}` : ""}
                </span>
              ) : <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">এখনো যাচাই হয়নি</span>}
            </h3>
            <button className="btn-ghost btn-sm" onClick={() => setFraudOrder(null)}>বন্ধ করুন</button>
          </div>
          {fraudOrder.riskScore != null ? <p className="text-sm text-slate-700">স্কোর: <b>{fraudOrder.riskScore}</b>{fraudOrder.riskAssessedAt ? <span className="text-xs text-slate-500"> · যাচাই: {new Date(fraudOrder.riskAssessedAt).toLocaleString("bn-BD")}</span> : null}</p> : null}
          {fraudOrder.deviceHashPrefix ? <p className="text-sm text-slate-700">ডিভাইস: <span className="font-mono">{fraudOrder.deviceHashPrefix}…</span> <span className="text-xs text-slate-500">(শুধু হ্যাশের শুরুটা দেখানো হয়)</span></p> : null}
          {(fraudOrder.riskReasons ?? []).length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {(fraudOrder.riskReasons ?? []).map((r, i) => <li key={r.key ?? i}>{r.label} <span className="font-semibold text-rose-700">(+{r.points})</span></li>)}
            </ul>
          ) : <p className="text-sm text-slate-500">কোনো ঝুঁকির কারণ রেকর্ড নেই।</p>}
          {/* NF13: network sibling signal — rendered ONLY when
              present (opted-in orgs), labelled as combined
              multi-shop data, never as this shop's own score. */}
          {fraudOrder.networkSignal && networkSignalBody(fraudOrder.networkSignal) ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2">
              <p className="text-sm font-semibold text-indigo-900">{networkSignalHeading(fraudOrder.networkSignal)}</p>
              <p className="text-sm text-slate-700">{networkSignalBody(fraudOrder.networkSignal)}</p>
              <p className="text-[11px] text-slate-500">এটি এই দোকানের নিজের স্কোর নয় — সব দোকানের সম্মিলিত তথ্য, শুধু অতিরিক্ত ধারণার জন্য।</p>
            </div>
          ) : null}
          {fraudOrder.reviewHold ? (
            <p className="rounded-lg bg-rose-100 px-3 py-2 text-sm font-medium text-rose-800">
              ⛔ পর্যালোচনার জন্য আটকানো আছে{fraudOrder.reviewHoldReason ? ` — কারণ: ${fraudOrder.reviewHoldReason}` : ""}
              {fraudOrder.reviewHeldAt ? <span className="block text-xs font-normal">আটকানো হয়েছে: {new Date(fraudOrder.reviewHeldAt).toLocaleString("bn-BD")}</span> : null}
            </p>
          ) : <p className="text-xs text-slate-500">এই অর্ডারটি আটকানো নেই।</p>}
          {fraudNotice ? <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">{fraudNotice}</p> : null}
          <div className="flex flex-wrap items-center gap-2 border-t pt-2">
            <button type="button" className="btn-secondary btn-sm" disabled={fraudBusy !== ""} onClick={() => void reassessFraud(fraudOrder)}>
              {fraudBusy === "reassess" ? "যাচাই হচ্ছে…" : "আবার যাচাই করুন"}
            </button>
            {fraudOrder.reviewHold ? (
              <button type="button" className="btn-primary btn-sm" disabled={fraudBusy !== ""} onClick={() => void releaseFraud(fraudOrder)}>
                {fraudBusy === "release" ? "ছাড় হচ্ছে…" : "ছাড় দিন"}
              </button>
            ) : (
              <>
                <input className="input w-56" placeholder="আটকানোর কারণ (ঐচ্ছিক)" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} aria-label="আটকানোর কারণ" />
                <button type="button" className="btn-primary btn-sm" disabled={fraudBusy !== ""} onClick={() => void holdFraud(fraudOrder)}>
                  {fraudBusy === "hold" ? "আটকানো হচ্ছে…" : "আটকে দিন"}
                </button>
              </>
            )}
          </div>
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
              <span className="text-xs text-slate-500">{r.receivedAt ? new Date(r.receivedAt).toLocaleString("bn-BD") : r.requestedAt ? `চাওয়া: ${new Date(r.requestedAt).toLocaleString("bn-BD")}` : "চ্যানেল নেই — পাঠানো হয়নি"}</span>
            </div>
          ))}
          {reviews.filter((r) => reviewFilter === "" ? true : reviewFilter === "pending" ? r.status === "pending_send" : reviewFilter === "requested" ? r.status === "requested" : r.rating === Number(reviewFilter)).length === 0 ? <p className="text-sm text-slate-400">এই ফিল্টারে কোনো রিভিউ নেই</p> : null}
        </div>
      ) : null}
      {chases.length > 0 ? (
        <div className="card space-y-2">
          <h2 className="font-semibold">🎯 To Chase — থেমে যাওয়া অর্ডার সেশন</h2>
          <p className="text-xs text-slate-500">অর্ডার বটে শুরু করে মাঝপথে থেমে যাওয়া সেশনগুলোর অনুস্মারকের অবস্থা। শুধু যেসব সেশন Sweep ইতিমধ্যে বিবেচনা করেছে সেগুলোই এখানে আছে।</p>
          {chases.slice(0, 50).map((c) => (
            <div key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b py-1.5 text-sm last:border-0">
              <span className="font-medium">{c.productName ?? "পণ্য অজানা"}</span>
              <span className="badge-slate">{chaseStatusBn(c)}</span>
              {c.sessionStatus ? <span className="text-slate-500">সেশন: {c.sessionStatus}{c.sessionState ? ` (${c.sessionState})` : ""}</span> : null}
              {c.lastChasedAt ? <span className="text-xs text-slate-500">সর্বশেষ অনুস্মারক: {new Date(c.lastChasedAt).toLocaleString("bn-BD")}</span> : null}
              {c.lastFailedAt && (!c.lastChasedAt || c.lastFailedAt > c.lastChasedAt) ? <span className="text-xs text-red-500">সর্বশেষ পাঠানো ব্যর্থ হয়েছে — আবার চেষ্টা হবে</span> : null}
              {!c.stoppedReason && c.lastEvent === "customer_replied" ? <span className="text-xs text-slate-500">গ্রাহক উত্তর দিয়েছেন</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="lg:flex lg:items-start lg:gap-4">
        {/* ON1: Queue rail — desktop-এ বাম রেল, মোবাইলে অনুভূমিক
            চিপ স্ক্রল। Queue আর legacy status ফিল্টার বিকল্প:
            queue বেছে নিলে status প্যারাম পাঠানো হয় না। */}
        <aside className="mb-3 shrink-0 lg:mb-0 lg:w-56">
          <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {/* The API's "all" queue is this same view (queue
                param cleared); it is not rendered twice — its
                count rides on this button instead. */}
            <button type="button" onClick={() => selectQueue("")}
              className={`flex min-h-[44px] shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium ring-1 ${filters.queue === "" ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"}`}>
              <span>সব অর্ডার</span>
              {queues.find((q) => q.key === "all") ? (
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${filters.queue === "" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>{queues.find((q) => q.key === "all")!.count}</span>
              ) : null}
            </button>
            {queues.filter((q) => q.key !== "all").map((q) => (
              <button key={q.key} type="button" onClick={() => selectQueue(q.key)}
                className={`flex min-h-[44px] shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium ring-1 ${filters.queue === q.key ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"}`}>
                <span>{q.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${filters.queue === q.key ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>{q.count}</span>
              </button>
            ))}
            {queues.length === 0 ? <span className="px-1 text-xs text-slate-500">কিউ লোড হয়নি</span> : null}
          </div>
        </aside>
        <div className="min-w-0 flex-1 space-y-4">
        {feedToast ? <div className="rounded-xl bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">🔔 {feedToast}</div> : null}
        {newOrdersCount > 0 ? (
          <button type="button" className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-indigo-700"
            onClick={() => { setNewOrdersCount(0); void load(); void loadQueues(); }}>
            {newOrdersCount}টি নতুন অর্ডার এসেছে — দেখুন
          </button>
        ) : null}
        {/* ON1: sticky bulk bar (the legacy courier bulk-booking
            card further down is unchanged and coexists). */}
        {selected.length > 0 ? (
          <div className="sticky bottom-2 z-30 space-y-2 rounded-2xl border border-indigo-200 bg-white/95 p-3 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{selected.length}টি বেছে নেওয়া</span>
              <select className="input w-auto" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} aria-label="নতুন অবস্থা">
                {PATCH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="btn-primary btn-sm" disabled={bulkActionBusy !== ""} onClick={() => void runBulkAction("set_status")}>অবস্থা বদল</button>
              <input className="input w-32" placeholder="ট্যাগ" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} aria-label="বাল্ক ট্যাগ" />
              <button className="btn-secondary btn-sm" disabled={bulkActionBusy !== ""} onClick={() => void runBulkAction("add_tag")}>ট্যাগ যোগ</button>
              <button className="btn-secondary btn-sm" disabled={bulkActionBusy !== ""} onClick={() => void runBulkAction("remove_tag")}>ট্যাগ মুছুন</button>
              <select className="input w-auto" value={bulkAssignee} onChange={(e) => setBulkAssignee(e.target.value)} aria-label="বাল্ক দায়িত্ব">
                <option value="">সদস্য বেছে নিন</option>
                <option value="__none__">দায়িত্ব তুলে নিন</option>
                {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name ?? m.user.email}</option>)}
              </select>
              <button className="btn-secondary btn-sm" disabled={bulkActionBusy !== ""} onClick={() => void runBulkAction("assign")}>দায়িত্ব দিন</button>
              <select className="input w-auto" value={bulkProviderOn1} onChange={(e) => setBulkProviderOn1(e.target.value)} aria-label="বাল্ক কুরিয়ার">
                <option value="steadfast">Steadfast</option>
                <option value="pathao">Pathao</option>
                <option value="redx">RedX</option>
                <option value="ecourier">eCourier</option>
              </select>
              <button className="btn-secondary btn-sm" disabled={bulkActionBusy !== ""} onClick={() => void runBulkAction("book_courier")}>কুরিয়ার বুক</button>
              <button className="btn-secondary btn-sm" disabled={bulkActionBusy !== ""} onClick={() => void runBulkAction("print_labels")}>লেবেল প্রিন্ট</button>
              <button className="btn-secondary btn-sm" disabled={bulkActionBusy !== ""} onClick={() => void runBulkAction("print_invoices")}>ইনভয়েস প্রিন্ট</button>
              <button className="btn-secondary btn-sm" onClick={() => setPrintPanelOpen(true)}>🖨️ প্রিন্ট সেন্টার</button>
              <button className="btn-secondary btn-sm" disabled={bulkActionBusy !== ""} onClick={() => void addSelectedToWave()}>ওয়েভে যোগ</button>
              {selected.length >= 2 && selected.length <= 5 ? (
                <button className="btn-secondary btn-sm" disabled={mergeBusy} onClick={openMerge}>মার্জ করুন</button>
              ) : null}
              <button className="btn-ghost btn-sm" onClick={() => { setSelected([]); setBulkActionResult(null); setWaveResult(null); }}>সিলেকশন মুছুন</button>
              {bulkActionBusy ? <span className="text-xs text-slate-500">চলছে… ({bulkActionBusy})</span> : null}
            </div>
            {bulkActionResult ? (
              <div className="text-sm">
                <p className="font-medium">ফলাফল: {bulkActionResult.succeeded}টি সফল · {bulkActionResult.failed}টি ব্যর্থ</p>
                {bulkActionResult.failed > 0 ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-red-600">ব্যর্থগুলোর কারণ দেখুন</summary>
                    <ul className="mt-1 space-y-0.5 text-xs text-red-600">
                      {bulkActionResult.results.filter((r) => !r.ok).map((r) => {
                        const o = items.find((x) => x.id === r.orderId);
                        return <li key={r.orderId}>✗ #{o?.externalNumber ?? r.orderId.slice(0, 8)} — {r.error ?? "অজানা ত্রুটি"}</li>;
                      })}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}
            {waveResult ? (
              <div className="text-sm">
                <p className="font-medium">পিক ওয়েভ: {waveResult.added}টি অর্ডার যোগ হয়েছে{waveResult.failed.length > 0 ? ` · ${waveResult.failed.length}টি যোগ হয়নি` : ""}</p>
                {waveResult.failed.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-xs text-red-600">
                    {waveResult.failed.map((r) => {
                      const o = items.find((x) => x.id === r.orderId);
                      return <li key={r.orderId}>✗ #{o?.externalNumber ?? r.orderId.slice(0, 8)} — {r.error}</li>;
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      {/* ON7: COD strip — org totals of money stuck with
          couriers (reports/cod-board). Failure-isolated: a
          failed call leaves codBoard null and the strip simply
          doesn't render. */}
      {codBoard ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          <span>🚚 courier-এর কাছে আটকে: <b>{fmtM(codBoard.totals.inTransitCodMinor)}</b></span>
          <span aria-hidden="true">·</span>
          <span>ডেলিভারি হয়েছে, টাকা আসেনি: <b>{fmtM(codBoard.totals.deliveredUncollectedMinor)}</b></span>
          {codBoard.unassigned.orders > 0 ? (
            <><span aria-hidden="true">·</span><span>এখনো courier-এ যায়নি: <b>{codBoard.unassigned.orders}টি</b> (বকেয়া {fmtM(codBoard.unassigned.dueMinor)})</span></>
          ) : null}
          <a className="ml-auto font-semibold text-amber-900 underline" href="/dashboard/commerce/accounting">বিস্তারিত</a>
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
                {(["steadfast", "pathao", "redx", "ecourier"] as const).map((p) => {
                  const c = conns.find((x) => x.provider === p);
                  const connected = c ? c.connected : p === "steadfast" ? !!courier?.connected : false;
                  return <option key={p} value={p} disabled={!connected}>{p === "steadfast" ? "Steadfast" : p === "pathao" ? "Pathao" : p === "redx" ? "RedX" : "eCourier"}{connected ? "" : " (যুক্ত নেই)"}</option>;
                })}
              </select>
              {bulkProvider === "redx" ? (
                <select className="input w-auto" value={bookForm.rAreaId} onChange={(e) => { const area = rAreas.find((a: any) => String(a.id) === e.target.value); setBookForm({ ...bookForm, rAreaId: e.target.value, rAreaName: area?.name ?? "" }); }}>
                  <option value="">RedX ডেলিভারি এলাকা বেছে নিন</option>
                  {rAreas.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              ) : null}
              {bulkProvider === "ecourier" ? (
                <>
                  <input className="input w-32" placeholder="শহর (City)" value={bookForm.eCity} onChange={(e) => setBookForm({ ...bookForm, eCity: e.target.value })} />
                  <input className="input w-32" placeholder="থানা" value={bookForm.eThana} onChange={(e) => setBookForm({ ...bookForm, eThana: e.target.value })} />
                  <input className="input w-32" placeholder="এলাকা (Area)" value={bookForm.eArea} onChange={(e) => setBookForm({ ...bookForm, eArea: e.target.value })} />
                  <input className="input w-28" placeholder="পোস্টকোড" value={bookForm.eZip} onChange={(e) => setBookForm({ ...bookForm, eZip: e.target.value })} />
                  <input className="input w-32" placeholder="Package Code" value={bookForm.ePackage} onChange={(e) => setBookForm({ ...bookForm, ePackage: e.target.value })} />
                </>
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
        {/* ON1 mobile: below lg the rows render as cards with the
            same fields + quick actions. Tapping অ্যাকশন opens the
            full detail panel (the table below, which is otherwise
            desktop-only, is revealed while a detail is open). */}
        <div className="space-y-3 lg:hidden">
          {items.map((o) => { const sh = shipmentFor(o.id); let due = 0n; try { due = BigInt(o.amountDueMinor ?? "0"); } catch { due = 0n; } return (
            <div key={o.id} className="card space-y-2">
              <div className="flex items-start justify-between gap-2">
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={selected.includes(o.id)} disabled={!selected.includes(o.id) && selected.length >= 50} onChange={(e) => toggleSelect(o.id, e.target.checked)} />
                  #{o.externalNumber ?? o.id.slice(0, 8)}
                </label>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">{o.status}</span>
              </div>
              <p className="text-sm text-slate-600">{[o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") || "—"}{o.customer?.phone ? <span className="block text-xs text-slate-500">{o.customer.phone}</span> : null}</p>
              <p className="text-xs text-slate-500">{o.items?.map((i) => `${i.name} ×${i.quantity}`).join(", ") ?? "—"}</p>
              {(o.tags ?? []).length > 0 ? <p className="flex flex-wrap gap-1">{(o.tags ?? []).map((t) => <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{t}</span>)}</p> : null}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>{o.isCod ? <b className="text-amber-600">COD</b> : (o.paymentMethod ?? "—")}</span>
                <span className="font-semibold">{formatMinor(BigInt(o.totalMinor))}</span>
                {due > 0n ? <span className="font-semibold text-red-600">বকেয়া {formatMinor(due)}</span> : null}
                <span className="text-xs text-slate-500">দায়িত্ব: {memberName(members, o.assigneeId)}</span>
                <span className="text-xs text-slate-500">{o.placedAt ? new Date(o.placedAt).toLocaleDateString("bn-BD") : "—"}</span>
                {sh ? <span className="badge-indigo">🚚 {sh.status}</span> : null}
                {o.risk ? <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${RISK_LABEL[o.risk.band]?.cls ?? RISK_LABEL.unknown.cls}`}>{RISK_LABEL[o.risk.band]?.text ?? "ঝুঁকি"}</span> : null}
                {o.riskBand ? (
                  <button type="button" className={`rounded px-2 py-0.5 text-[11px] font-semibold ${FRAUD_BAND_LABEL[o.riskBand]?.cls ?? ""}`}
                    title="জালিয়াতি ঝুঁকি (Fraud Shield)" onClick={() => openFraudDetail(o)}>
                    🛡️ {FRAUD_BAND_LABEL[o.riskBand]?.text ?? o.riskBand}{o.riskScore != null ? ` · ${o.riskScore}` : ""}
                  </button>
                ) : null}
                {o.reviewHold ? <span className="rounded bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white" title={o.reviewHoldReason ?? undefined}>⛔ আটকানো</span> : null}
              </div>
              {o.deliverySlot ? <span className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">🕐 {o.deliverySlot.label} · {o.deliverySlot.date}</span> : null}
              {o.deliveryMethod === "pickup" && o.pickupPoint ? <span className="ml-1 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">📍 পিকআপ: {o.pickupPoint.name}</span> : null}
              {filters.queue === "needs_confirmation" && o.isCod && o.codConfirmationStatus === "awaiting" ? (
                <CodCallChips order={o} busy={codBusy === o.id} onCall={(ord, outcome) => void recordCodCall(ord, outcome)} />
              ) : (o.codCallAttempts ?? 0) > 0 ? (
                <p className="text-[11px] text-slate-500">কল: {o.codCallAttempts}বার{o.codLastCallOutcome ? ` · সর্বশেষ: ${codCallOutcomeLabel(o.codLastCallOutcome)}` : ""}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 border-t pt-2 text-base">
                {o.customer?.phone ? <a href={`tel:${o.customer.phone}`} title="কল করুন" aria-label="কল করুন">📞</a> : null}
                {(o.conversationId ?? o.codConversationId) ? <a href="/dashboard/inbox" title="কথোপকথন খুলুন (ইনবক্স)" aria-label="কথোপকথন">💬</a> : null}
                {o.isCod && (o.codConversationId ?? o.conversationId) && o.codConfirmationStatus === "awaiting" ? <a href="/dashboard/inbox" title="COD কনফার্ম অপেক্ষমাণ" aria-label="COD কনফার্ম অপেক্ষমাণ">⏳</a> : null}
                {sh ? <button type="button" title="লেবেল প্রিন্ট" aria-label="লেবেল প্রিন্ট" onClick={() => { const orgId = getOrganizationId(); if (orgId) void downloadPdf(`/organizations/${orgId}/courier/shipments/${sh.id}/label.pdf`, `label-${sh.trackingCode ?? sh.id}.pdf`); }}>🏷️</button> : null}
                <Link href={`/dashboard/orders/${o.id}`} className="ml-auto text-sm font-semibold text-brand-600 hover:underline">বিস্তারিত →</Link>
                <button type="button" className="text-sm font-semibold text-brand-600" onClick={() => { openActions(o); setTimeout(() => document.getElementById("orders-table-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }}>⚙️ অ্যাকশন</button>
              </div>
            </div>
          ); })}
        </div>
        <div id="orders-table-wrap" className={`overflow-x-auto card ${actOrder ? "" : "hidden"} lg:block`}>
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr>
              <th className="px-4 py-3"><input type="checkbox" checked={items.length > 0 && items.every((o) => selected.includes(o.id))} onChange={(e) => setSelected(e.target.checked ? items.slice(0, 50).map((o) => o.id) : [])} /></th>
              <th className="px-4 py-3">অর্ডার</th><th className="px-4 py-3">কাস্টমার</th><th className="px-4 py-3">আইটেম</th>
              <th className="px-4 py-3">স্ট্যাটাস</th><th className="px-4 py-3">ট্যাগ</th><th className="px-4 py-3">পেমেন্ট</th><th className="px-4 py-3">মোট</th><th className="px-4 py-3">বকেয়া</th><th className="px-4 py-3">দায়িত্ব</th><th className="px-4 py-3">তারিখ</th><th className="px-4 py-3">কুরিয়ার</th><th className="px-4 py-3">দ্রুত অ্যাকশন</th>
            </tr></thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="px-4 py-3"><input type="checkbox" checked={selected.includes(o.id)} disabled={!selected.includes(o.id) && selected.length >= 50} onChange={(e) => toggleSelect(o.id, e.target.checked)} /></td>
                  <td className="px-4 py-3 font-medium"><Link href={`/dashboard/orders/${o.id}`} className="hover:underline" title="সম্পূর্ণ বিবরণ">#{o.externalNumber ?? o.id.slice(0, 8)}</Link><button className="block text-[11px] font-semibold text-brand-600 hover:underline" onClick={() => { const orgId = getOrganizationId(); if (orgId) void downloadPdf(`/organizations/${orgId}/courier/orders/${o.id}/invoice.pdf`, `invoice-${o.externalNumber ?? o.id}.pdf`); }}>🧾 ইনভয়েস PDF</button>
                    {o.deliverySlot ? <span className="mt-1 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">🕐 {o.deliverySlot.label} · {o.deliverySlot.date}</span> : null}
                    {o.deliveryMethod === "pickup" && o.pickupPoint ? <span className="mt-1 ml-1 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">📍 পিকআপ: {o.pickupPoint.name}</span> : null}
                  </td>
                  <td className="px-4 py-3">{[o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") || "—"}<div className="text-xs text-slate-500">{o.customer?.phone ?? o.customer?.email ?? ""}</div></td>
                  <td className="px-4 py-3">{o.items?.map((i) => `${i.name} ×${i.quantity}`).join(", ") ?? "—"}</td>
                  <td className="px-4 py-3"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">{o.status}</span>
                    {o.risk ? (
                      <button className={`mt-1 block rounded px-2 py-0.5 text-[11px] font-semibold ${RISK_LABEL[o.risk.band]?.cls ?? RISK_LABEL.unknown.cls}`}
                        title="রিটার্ন ঝুঁকির কারণ দেখুন" onClick={() => showRisk(o)}>
                        {RISK_LABEL[o.risk.band]?.text ?? "ঝুঁকি"}{o.risk.score != null ? ` · ${o.risk.score}` : ""}
                      </button>
                    ) : null}
                    {o.riskBand ? (
                      <button className={`mt-1 block rounded px-2 py-0.5 text-[11px] font-semibold ${FRAUD_BAND_LABEL[o.riskBand]?.cls ?? ""}`}
                        title="জালিয়াতি ঝুঁকি (Fraud Shield)" onClick={() => openFraudDetail(o)}>
                        🛡️ {FRAUD_BAND_LABEL[o.riskBand]?.text ?? o.riskBand}{o.riskScore != null ? ` · ${o.riskScore}` : ""}
                      </button>
                    ) : null}
                    {o.reviewHold ? <span className="mt-1 inline-block rounded bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white" title={o.reviewHoldReason ?? undefined}>⛔ আটকানো</span> : null}
                    <button className="mt-1 block text-[11px] font-semibold text-brand-600 hover:underline" onClick={() => openActions(o)}>⚙️ অ্যাকশন</button>
                    <Link href={`/dashboard/orders/${o.id}`} className="mt-1 block text-[11px] font-semibold text-brand-600 hover:underline">বিস্তারিত →</Link>
                  </td>
                  <td className="px-4 py-3">{(o.tags ?? []).length > 0 ? (
                    <span className="flex flex-wrap gap-1">{(o.tags ?? []).map((t) => <span key={t} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{t}</span>)}</span>
                  ) : <span className="text-xs text-slate-400">—</span>}</td>
                  <td className="px-4 py-3">{o.isCod ? <span className="font-semibold text-amber-600">COD</span> : (o.paymentMethod ?? "—")}</td>
                  <td className="px-4 py-3">{formatMinor(BigInt(o.totalMinor))}</td>
                  <td className="px-4 py-3">{(() => { let due = 0n; try { due = BigInt(o.amountDueMinor ?? "0"); } catch { due = 0n; } return due > 0n
                    ? <span className="rounded bg-red-50 px-2 py-0.5 font-semibold text-red-600">{formatMinor(due)}</span>
                    : <span className="text-xs text-slate-400">—</span>; })()}</td>
                  <td className="px-4 py-3 text-xs">{memberName(members, o.assigneeId)}</td>
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
                        {sh.chargeMinor ? <span className="text-xs text-slate-500" title="বুকিংয়ের সময় কুরিয়ার নিজে যে চার্জ ফেরত দিয়েছিল (আনুমানিক নয়)">বুকিং চার্জ: {(() => { try { return formatMinor(BigInt(sh.chargeMinor)); } catch { return sh.chargeMinor; } })()}</span> : null}
                        <button className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => void toggleShipmentDetail(sh.id)}>📜 ইতিহাস ও ম্যানুয়াল স্ট্যাটাস</button>
                      </span>
                    ) : courier?.connected ? (
                      <button className="text-xs font-semibold text-brand-600 hover:underline" onClick={async () => {
                        const opening = bookingFor !== o.id;
                        setBookingFor(opening ? o.id : null);
                        setQuoteOut(null);
                        const firstConnected = conns.find((c) => c.connected)?.provider ?? "steadfast";
                        setBookForm({ name: [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" "), phone: o.customer?.phone ?? "", address: "", note: "", provider: firstConnected, pStoreId: "", pCityId: "", pZoneId: "", pAreaId: "", weightKg: "0.5", rAreaId: "", rAreaName: "", rStoreId: "", eCity: "", eThana: "", eArea: "", eZip: "", ePackage: "", ePayMethod: "" });
                        setBookSuggestion(null);
                        if (opening) { await loadProviderLists(firstConnected); void loadSuggestion(o.id); }
                      }}>পার্সেল বুক করুন</button>
                    ) : <span className="text-xs text-slate-400">—</span>; })()}
                  </td>
                  {/* ON1 quick actions — each renders ONLY when its
                      precondition is real (phone / conversation /
                      COD state / shipment), never as a dead icon. */}
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-base">
                      {o.customer?.phone ? <a href={`tel:${o.customer.phone}`} title={`কল করুন: ${o.customer.phone}`} aria-label="কল করুন">📞</a> : null}
                      {(o.conversationId ?? o.codConversationId) ? <a href="/dashboard/inbox" title="কথোপকথন খুলুন (ইনবক্স)" aria-label="কথোপকথন">💬</a> : null}
                      {o.isCod && (o.codConversationId ?? o.conversationId) && o.codConfirmationStatus === "awaiting" ? (
                        <a href="/dashboard/inbox" title="COD কনফার্ম অপেক্ষমাণ — ইনবক্সে গ্রাহকের উত্তর দেখুন" aria-label="COD কনফার্ম অপেক্ষমাণ">⏳</a>
                      ) : o.isCod && (o.codConversationId ?? o.conversationId) && o.codConfirmationStatus !== "confirmed" && o.codConfirmationStatus !== "declined" && ["pending", "on-hold", "processing"].includes(o.status) ? (
                        <button type="button" title="COD কনফার্মেশন পাঠান" aria-label="COD কনফার্মেশন পাঠান" disabled={rowBusy !== ""} onClick={() => void requestCodForRow(o)}>✅</button>
                      ) : null}
                      {!shipmentFor(o.id) && courier?.connected ? (
                        <button type="button" title="কুরিয়ার বুক করুন" aria-label="কুরিয়ার বুক করুন" onClick={async () => {
                          const opening = bookingFor !== o.id;
                          setBookingFor(opening ? o.id : null);
                          setQuoteOut(null);
                          const firstConnected = conns.find((c) => c.connected)?.provider ?? "steadfast";
                          setBookForm({ name: [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" "), phone: o.customer?.phone ?? "", address: "", note: "", provider: firstConnected, pStoreId: "", pCityId: "", pZoneId: "", pAreaId: "", weightKg: "0.5", rAreaId: "", rAreaName: "", rStoreId: "", eCity: "", eThana: "", eArea: "", eZip: "", ePackage: "", ePayMethod: "" });
                          setBookSuggestion(null);
                          if (opening) { await loadProviderLists(firstConnected); void loadSuggestion(o.id); }
                        }}>🚚</button>
                      ) : null}
                      {shipmentFor(o.id) ? (
                        <button type="button" title="লেবেল প্রিন্ট" aria-label="লেবেল প্রিন্ট" onClick={() => { const orgId = getOrganizationId(); const sh = shipmentFor(o.id); if (orgId && sh) void downloadPdf(`/organizations/${orgId}/courier/shipments/${sh.id}/label.pdf`, `label-${sh.trackingCode ?? sh.id}.pdf`); }}>🏷️</button>
                      ) : null}
                    </span>
                    {/* ON4: COD call chips live in this same
                        quick-action cell (below the icon row) on
                        the needs_confirmation queue — small
                        buttons, never widening the icon row. */}
                    {filters.queue === "needs_confirmation" && o.isCod && o.codConfirmationStatus === "awaiting" ? (
                      <CodCallChips order={o} busy={codBusy === o.id} onCall={(ord, outcome) => void recordCodCall(ord, outcome)} />
                    ) : (o.codCallAttempts ?? 0) > 0 ? (
                      <span className="mt-1 block text-[11px] text-slate-500">কল: {o.codCallAttempts}বার{o.codLastCallOutcome ? ` · সর্বশেষ: ${codCallOutcomeLabel(o.codLastCallOutcome)}` : ""}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
              {bookingFor ? (() => { const order = items.find((x) => x.id === bookingFor); if (!order) return null; return (
                <tr className="border-t bg-indigo-50/60"><td colSpan={13} className="px-4 py-3">
                  {bookSuggestion?.ruleId ? (
                    <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">নিয়ম অনুযায়ী সাজেশন: {bookSuggestion.ruleName ?? "নিয়ম"} — {bookSuggestion.reason ?? ""} (কুরিয়ার আগেই বেছে দেওয়া হয়েছে; চাইলে বদলাতে পারবেন)</p>
                  ) : null}
                  <div className="grid gap-2 sm:grid-cols-4">
                    <select className="input" value={bookForm.provider} onChange={async (e) => { setBookForm({ ...bookForm, provider: e.target.value }); setQuoteOut(null); await loadProviderLists(e.target.value); }}>
                      {(["steadfast", "pathao", "redx", "ecourier"] as const).map((p) => {
                        const c = conns.find((x) => x.provider === p);
                        return <option key={p} value={p} disabled={c ? !c.connected : p !== "steadfast" ? true : !(courier?.connected)}>{p === "steadfast" ? "Steadfast" : p === "pathao" ? "Pathao" : p === "redx" ? "RedX" : "eCourier"}{c && !c.connected ? " (যুক্ত নেই)" : ""}</option>;
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
                    {bookForm.provider === "ecourier" ? (<>
                      {/* GB5: eCourier-এর ডকুমেন্টেড অর্ডার কলে শহর,
                          থানা, এলাকা, পোস্টকোড, নির্ধারিত Package
                          Code ও পেমেন্ট মেথড — সব আবশ্যক। শহর/থানা/
                          প্যাকেজ তালিকা আসে eCourier-এর নিজের API
                          থেকে; তালিকা না এলে হাতে লেখা যায়। */}
                      {eCities.length > 0 ? (
                        <select className="input" value={bookForm.eCity} onChange={async (e) => {
                          const city = e.target.value;
                          setBookForm({ ...bookForm, eCity: city, eThana: "" }); setEThanas([]);
                          if (city) { const orgId = getOrganizationId(); if (orgId) setEThanas(await apiFetch<any[]>(`/organizations/${orgId}/courier/ecourier/thanas?city=${encodeURIComponent(city)}`).catch(() => [])); }
                        }}>
                          <option value="">শহর (City) বেছে নিন (আবশ্যক)</option>
                          {eCities.map((c: any, i: number) => { const name = typeof c === "string" ? c : (c.city_name ?? c.name ?? c.city ?? ""); return <option key={`${name}-${i}`} value={name}>{name}</option>; })}
                        </select>
                      ) : (
                        <input className="input" placeholder="শহর (City) — যেমন Dhaka (আবশ্যক)" value={bookForm.eCity} onChange={(e) => setBookForm({ ...bookForm, eCity: e.target.value })} />
                      )}
                      {eThanas.length > 0 ? (
                        <select className="input" value={bookForm.eThana} onChange={(e) => setBookForm({ ...bookForm, eThana: e.target.value })}>
                          <option value="">থানা বেছে নিন (আবশ্যক)</option>
                          {eThanas.map((t: any, i: number) => { const name = typeof t === "string" ? t : (t.thana_name ?? t.name ?? t.thana ?? ""); return <option key={`${name}-${i}`} value={name}>{name}</option>; })}
                        </select>
                      ) : (
                        <input className="input" placeholder="থানা — যেমন Dhanmondi (আবশ্যক)" value={bookForm.eThana} onChange={(e) => setBookForm({ ...bookForm, eThana: e.target.value })} />
                      )}
                      <input className="input" placeholder="এলাকা (Area) — যেমন Dhanmondi (আবশ্যক)" value={bookForm.eArea} onChange={(e) => setBookForm({ ...bookForm, eArea: e.target.value })} />
                      <input className="input" placeholder="পোস্টকোড (Zip) — যেমন 1205 (আবশ্যক)" value={bookForm.eZip} onChange={(e) => setBookForm({ ...bookForm, eZip: e.target.value })} />
                      {ePackages.length > 0 ? (
                        <select className="input" value={bookForm.ePackage} onChange={(e) => setBookForm({ ...bookForm, ePackage: e.target.value })}>
                          <option value="">Package বেছে নিন (আবশ্যক — ওজন প্যাকেজেই থাকে)</option>
                          {ePackages.map((pk: any, i: number) => { const code = typeof pk === "string" ? pk : (pk.package_code ?? pk.code ?? ""); const label = typeof pk === "string" ? pk : `${pk.package_name ?? code}${pk.weight ? ` · ${pk.weight}` : ""}${pk.shipping_charge != null ? ` · চার্জ ৳${pk.shipping_charge}` : ""}`; return <option key={`${code}-${i}`} value={code}>{label}</option>; })}
                        </select>
                      ) : (
                        <input className="input" placeholder="Package Code (আবশ্যক)" value={bookForm.ePackage} onChange={(e) => setBookForm({ ...bookForm, ePackage: e.target.value })} />
                      )}
                      <select className="input" value={bookForm.ePayMethod} onChange={(e) => setBookForm({ ...bookForm, ePayMethod: e.target.value })}>
                        <option value="">পেমেন্ট মেথড: {order.isCod ? "স্বয়ংক্রিয় (COD)" : "বেছে নিন (আবশ্যক)"}</option>
                        <option value="COD">COD</option>
                        <option value="POS">POS</option>
                        <option value="MPAY">MPAY</option>
                        <option value="CCRD">CCRD</option>
                      </select>
                    </>) : null}
                    <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
                      <button className="btn-secondary btn-sm" disabled={quoteBusy} onClick={() => fetchQuote(order)}>{quoteBusy ? "হিসাব হচ্ছে..." : "💰 ডেলিভারি চার্জ দেখুন"}</button>
                      {quoteOut ? (quoteOut.quotable ? (
                        <span className="text-xs font-semibold text-emerald-700">ডেলিভারি চার্জ: {formatMinor(BigInt(quoteOut.chargeMinor ?? 0))} <span className="font-normal text-slate-500">({quoteOut.provider === "pathao" ? "Pathao" : quoteOut.provider === "ecourier" ? "eCourier" : "RedX"} এর নিজের প্রাইস API থেকে — বুকিংয়ের আগে)</span></span>
                      ) : (
                        <span className="text-xs text-amber-700">{quoteOut.reason}</span>
                      )) : null}
                    </div>
                    <button className="btn-primary" disabled={courierBusy !== "" || bookForm.address.trim().length < 8 || (bookForm.provider === "redx" && !bookForm.rAreaId) || (bookForm.provider === "ecourier" && (!bookForm.eCity.trim() || !bookForm.eThana.trim() || !bookForm.eArea.trim() || !bookForm.eZip.trim() || !bookForm.ePackage.trim()))} onClick={() => bookShipment(order)}>{courierBusy === "book" ? "বুক হচ্ছে..." : `${bookForm.provider === "pathao" ? "Pathao" : bookForm.provider === "redx" ? "RedX" : bookForm.provider === "ecourier" ? "eCourier" : "Steadfast"} এ বুক করুন${order.isCod ? ` (COD ${formatMinor(BigInt(order.totalMinor))})` : ""}`}</button>
                  </div>
                </td></tr>
              ); })() : null}
              {detailShipmentId ? (() => { const sh = shipments.find((x) => x.id === detailShipmentId); if (!sh) return null; return (
                <tr className="border-t bg-amber-50/50"><td colSpan={13} className="px-4 py-3">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">📦 পার্সেল বিস্তারিত — {sh.provider} · {sh.trackingCode ?? sh.id} · বর্তমান স্ট্যাটাস: {sh.status}</h3>
                      <button className="btn-ghost btn-sm" onClick={() => setDetailShipmentId(null)}>বন্ধ করুন</button>
                    </div>
                    {sh.chargeMinor ? <p className="text-xs text-slate-600">বুকিং চার্জ (কুরিয়ারের ফেরত দেওয়া): <b>{(() => { try { return formatMinor(BigInt(sh.chargeMinor)); } catch { return sh.chargeMinor; } })()}</b></p> : null}
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div>
                        <h4 className="mb-1 text-xs font-semibold text-slate-600">ঘটনার ইতিহাস</h4>
                        {shipmentEvents.length === 0 ? (
                          <p className="text-xs text-slate-500">এই পার্সেলের কোনো ঘটনা লগ হয়নি। ঘটনার লগ GC14 থেকে শুরু হয়েছে — তার আগের পার্সেলের ইতিহাস এখানে দেখানো হয় না (আগের স্ট্যাটাস বানিয়ে দেখানো হয় না)।</p>
                        ) : (
                          <ul className="space-y-1">
                            {shipmentEvents.map((ev: any) => (
                              <li key={ev.id} className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
                                <span className="font-semibold">{ev.kind === "error" ? "⚠️ ত্রুটি" : ev.kind === "note" ? "📝 নোট" : `স্ট্যাটাস: ${ev.status ?? "—"}`}</span>
                                {ev.rawStatus ? <span className="text-slate-500"> (কুরিয়ারের ভাষায়: {ev.rawStatus})</span> : null}
                                <span className="text-slate-500"> · {ev.source === "manual" ? "ম্যানুয়াল" : ev.source === "booking" ? "বুকিং" : ev.source === "api_sync" ? "API সিঙ্ক" : ev.source} · {ev.createdAt ? new Date(ev.createdAt).toLocaleString() : ""}</span>
                                {ev.message ? <span className="block text-slate-500">{ev.message}</span> : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <h4 className="mb-1 text-xs font-semibold text-slate-600">ম্যানুয়াল স্ট্যাটাস হালনাগাদ</h4>
                        <p className="mb-2 text-xs text-slate-500">কুরিয়ারের API বন্ধ থাকলে বা হাতে-কলমে কুরিয়ারের ক্ষেত্রে এখান থেকে স্ট্যাটাস দিন — সিঙ্কের মতোই সব প্রভাব (নোটিফিকেশন, রিটার্নে স্টক ফেরত) কাজ করবে এবং ঘটনাটি &quot;ম্যানুয়াল&quot; হিসেবে লগ হবে।</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <select className="input w-auto" value={manualStatus} onChange={(e) => setManualStatus(e.target.value)}>
                            {["in_review", "pending", "picked_up", "in_transit", "out_for_delivery", "delivered", "partial_delivered", "cancelled", "returned", "delivery_failed"].map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <input className="input w-64" placeholder="নোট (ঐচ্ছিক)" value={manualNote} onChange={(e) => setManualNote(e.target.value)} />
                          <button className="btn-primary btn-sm" disabled={manualBusy} onClick={() => void submitManualStatus(sh.id)}>{manualBusy ? "হচ্ছে..." : "হালনাগাদ করুন"}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </td></tr>
              ); })() : null}
              {actOrder ? (
                <OrderActionPanel
                  actOrder={actOrder}
                  surgery={surgery}
                  actNotice={actNotice}
                  surgeryNotice={surgeryNotice}
                  overpaidNotice={overpaidNotice}
                  surgeryError={surgeryError}
                  fraudNotice={fraudNotice}
                  fraudBusy={fraudBusy}
                  codBusy={codBusy}
                  actStatus={actStatus}
                  setActStatus={setActStatus}
                  actRefundTaka={actRefundTaka}
                  setActRefundTaka={setActRefundTaka}
                  actRefundReason={actRefundReason}
                  setActRefundReason={setActRefundReason}
                  actNote={actNote}
                  setActNote={setActNote}
                  actBusy={actBusy}
                  members={members}
                  setActOrder={setActOrder}
                  setItems={setItems}
                  drafts={drafts}
                  setDrafts={setDrafts}
                  draftErrors={draftErrors}
                  recalcDelivery={recalcDelivery}
                  setRecalcDelivery={setRecalcDelivery}
                  preview={preview}
                  previewBusy={previewBusy}
                  previewError={previewError}
                  surgeryBusy={surgeryBusy}
                  pickQuery={pickQuery}
                  setPickQuery={setPickQuery}
                  pickResults={pickResults}
                  pickBusy={pickBusy}
                  pendingProduct={pendingProduct}
                  setPendingProduct={setPendingProduct}
                  pushState={pushState}
                  pushStateError={pushStateError}
                  storeNoteText={storeNoteText}
                  setStoreNoteText={setStoreNoteText}
                  syncBusy={syncBusy}
                  syncNotice={syncNotice}
                  syncError={syncError}
                  returnUrl={returnUrl}
                  copiedKey={copiedKey}
                  advAmount={advAmount}
                  setAdvAmount={setAdvAmount}
                  advMethod={advMethod}
                  setAdvMethod={setAdvMethod}
                  advRef={advRef}
                  setAdvRef={setAdvRef}
                  advNote={advNote}
                  setAdvNote={setAdvNote}
                  advBusy={advBusy}
                  advError={advError}
                  advNotice={advNotice}
                  instPlan={instPlan}
                  instLoaded={instLoaded}
                  instError={instError}
                  instBusy={instBusy}
                  instCount={instCount}
                  setInstCount={setInstCount}
                  instInterval={instInterval}
                  setInstInterval={setInstInterval}
                  instStart={instStart}
                  setInstStart={setInstStart}
                  instNote={instNote}
                  setInstNote={setInstNote}
                  collectForms={collectForms}
                  setCollectForms={setCollectForms}
                  profit={profit}
                  profitError={profitError}
                  orderAssignments={orderAssignments}
                  riders={riders}
                  assignRiderId={assignRiderId}
                  setAssignRiderId={setAssignRiderId}
                  riderBusy={riderBusy}
                  enterSurgery={enterSurgery}
                  exitSurgery={exitSurgery}
                  releaseFraud={releaseFraud}
                  openFraudDetail={openFraudDetail}
                  recordCodCall={recordCodCall}
                  saveStatus={saveStatus}
                  saveRefund={saveRefund}
                  saveNote={saveNote}
                  clearNote={clearNote}
                  patchDraft={patchDraft}
                  patchDraftPrice={patchDraftPrice}
                  searchProducts={searchProducts}
                  chooseProduct={chooseProduct}
                  addProductDraft={addProductDraft}
                  saveSurgery={saveSurgery}
                  openSplit={openSplit}
                  sendStoreNote={sendStoreNote}
                  createStoreDraft={createStoreDraft}
                  createReturnLink={createReturnLink}
                  copyText={copyText}
                  recordAdvance={recordAdvance}
                  createInstPlan={createInstPlan}
                  collectInstItem={collectInstItem}
                  cancelInstPlan={cancelInstPlan}
                  assignRider={assignRider}
                  transitionAssignment={transitionAssignment}
                  openOrderById={openOrderById}
                  fmtM={fmtM}
                  reviewForOrder={reviewForOrder}
                  reviewStatusBn={reviewStatusBn}
                  stars={stars}
                />
              ) : null}
            </tbody>
          </table>
        </div>
        </>
      )}
        </div>
      </div>
      <SplitDialog
        splitOpen={splitOpen}
        actOrder={actOrder}
        splitError={splitError}
        splitNotice={splitNotice}
        splitCreated={splitCreated}
        splitQty={splitQty}
        setSplitQty={setSplitQty}
        splitBundles={splitBundles}
        setSplitBundles={setSplitBundles}
        splitDeliveryTaka={splitDeliveryTaka}
        setSplitDeliveryTaka={setSplitDeliveryTaka}
        splitBusy={splitBusy}
        setSplitOpen={setSplitOpen}
        doSplit={doSplit}
        openOrderById={openOrderById}
      />
      <MergeDialog
        mergeOpen={mergeOpen}
        setMergeOpen={setMergeOpen}
        mergeError={mergeError}
        items={items}
        selected={selected}
        mergeSurvivor={mergeSurvivor}
        setMergeSurvivor={setMergeSurvivor}
        fmtM={fmtM}
        mergeBusy={mergeBusy}
        doMerge={doMerge}
      />
      <DuplicatesModal
        isOpen={showDuplicatesModal}
        onClose={() => setShowDuplicatesModal(false)}
        duplicateData={duplicateData}
        mergeBusy={dupMergeBusy}
        onMergeGroup={(primaryOrderId, duplicateOrderIds) => void mergeGroup(primaryOrderId, duplicateOrderIds)}
      />
      {/* ON4: Fraud Shield settings + blocked-phones panel. */}
      {analyticsPanelOpen ? (
        <OrderAnalyticsPanel onClose={() => setAnalyticsPanelOpen(false)} />
      ) : null}
      {printPanelOpen ? (
        <OrderPrintPanel initialOrderIds={selected} onClose={() => setPrintPanelOpen(false)} />
      ) : null}
      {teamPanelOpen ? (
        <OrderTeamPanel
          onClose={() => setTeamPanelOpen(false)}
          onViewAssignee={(userId) => { patchFilters({ assigneeId: userId, queue: "" }); setTeamPanelOpen(false); }}
        />
      ) : null}
      {automationPanelOpen ? (
        <OrderAutomationPanel
          members={members}
          statusOptions={STATUSES.filter(Boolean)}
          onClose={() => setAutomationPanelOpen(false)}
        />
      ) : null}
      <FraudSettingsPanel
        fraudPanelOpen={fraudPanelOpen}
        setFraudPanelOpen={setFraudPanelOpen}
        fraudPanelError={fraudPanelError}
        fraudPanelNotice={fraudPanelNotice}
        fraudSettings={fraudSettings}
        setFraudSettings={setFraudSettings}
        fraudHighTaka={fraudHighTaka}
        setFraudHighTaka={setFraudHighTaka}
        fraudPanelBusy={fraudPanelBusy}
        saveFraudSettings={saveFraudSettings}
        blockForm={blockForm}
        setBlockForm={setBlockForm}
        blockedPhones={blockedPhones}
        addBlockedPhone={addBlockedPhone}
        deleteBlockedPhone={deleteBlockedPhone}
        identTab={identTab}
        setIdentTab={setIdentTab}
        blockedIdents={blockedIdents}
        trustedIdents={trustedIdents}
        blockedIdentForm={blockedIdentForm}
        setBlockedIdentForm={setBlockedIdentForm}
        trustedForm={trustedForm}
        setTrustedForm={setTrustedForm}
        addBlockedIdent={addBlockedIdent}
        deleteBlockedIdent={deleteBlockedIdent}
        addTrustedIdent={addTrustedIdent}
        deleteTrustedIdent={deleteTrustedIdent}
        turnstileSecret={turnstileSecret}
        setTurnstileSecret={setTurnstileSecret}
        fraudAttempts={fraudAttempts}
        fraudRules={fraudRules}
        ruleDraft={ruleDraft}
        setRuleDraft={setRuleDraft}
        createFraudRule={createFraudRule}
        toggleFraudRule={toggleFraudRule}
        deleteFraudRule={deleteFraudRule}
      />
      <NotificationSettingsPanel
        notifPanelOpen={notifPanelOpen}
        setNotifPanelOpen={setNotifPanelOpen}
        notifPanelError={notifPanelError}
        notifPanelNotice={notifPanelNotice}
        notifConfig={notifConfig}
        setNotifConfig={setNotifConfig}
        notifPanelBusy={notifPanelBusy}
        toggleNotifChannel={toggleNotifChannel}
        saveNotifSettings={saveNotifSettings}
      />
    </div>
  );
}

// ED12 (EB5): useSearchParams (URL-driven list state above) needs a
// Suspense boundary in Next 15 — same wrapper pattern as
// dashboard/commerce/print and dashboard/commerce/warehouse/labels.
export default function OrdersPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-slate-500">লোড হচ্ছে…</p>}>
      <OrdersPageInner />
    </Suspense>
  );
}
