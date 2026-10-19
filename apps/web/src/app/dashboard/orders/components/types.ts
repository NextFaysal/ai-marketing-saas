import type { LabelScanResultView, LabelMatchView } from "@/lib/cx8";
import type { OrderAllocation } from "../on2-detail";
import type { RiskReason } from "@/lib/orders-on4";
import type { FraudNetworkSignal } from "@/lib/fraud-network-nf13";

export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  totalMinor: string;
  // EC29: free-gift lines + bundle membership markers.
  isGift?: boolean;
  bundleId?: string | null;
  bundleName?: string | null;
}

// EC31: installment plan as serialized by InstallmentsService
export interface InstallmentItemRow {
  id: string;
  seq: number;
  dueDate: string | null;
  dueDay: string;
  amountMinor: string;
  paidMinor: string;
  remainingMinor: string;
  paidAt: string | null;
  fullyPaid: boolean;
  overdue: boolean;
}

export interface InstallmentPlan {
  id: string;
  orderId: string;
  totalMinor: string;
  installmentCount: number;
  intervalDays: number;
  startDate: string | null;
  status: string;
  note: string | null;
  paidMinor: string;
  remainingMinor: string;
  items: InstallmentItemRow[];
  orderAmountDueMinor?: string;
}

// EC18/EC19 (B8): staff order-detail payment verification rows.
export interface PaymentVerificationRow {
  id: string;
  provider: string | null;
  trxId: string | null;
  amountMinor: string | number | null;
  status: string;
  source: string | null;
  note: string | null;
  createdAt: string;
  reviewedById: string | null;
}

export interface Order {
  id: string;
  externalNumber?: string | null;
  status: string;
  isCod: boolean;
  paymentMethod?: string | null;
  totalMinor: string;
  refundedMinor?: string;
  internalNote?: string | null;
  placedAt?: string | null;
  // EC18 (B8): list rows carry { label, date }; the detail carries the full slot
  deliverySlot?: { id?: string; label: string; startTime?: string; endTime?: string; date: string } | null;
  // EC30: delivery method + chosen pickup point
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
  // EC5: store identity fields
  source?: string | null;
  externalId?: string | null;
  storeId?: string | null;
  storeDraftId?: string | null;
  storeInvoiceUrl?: string | null;
  customer?: { firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null } | null;
  items?: OrderItem[];
  risk?: { band: string; score: number | null } | null;
  riskBand?: string | null;
  // NF13: sibling network signal (opted-in orgs only) — never
  // merged into this order's own risk fields.
  networkSignal?: FraudNetworkSignal | null;
  riskScore?: number | null;
  duplicate?: { isDuplicate: boolean; count: number };
  assigneeId?: string | null;
  tags?: string[] | null;
  codCallOutcome?: string | null;
  codCallAttempts?: number;
  codCallNote?: string | null;
  codConfirmationStatus?: string | null;
  codLastCallAt?: string | null;
  codLastCallOutcome?: string | null;
  deliveryChargeMinor?: string;
  currency?: string;
}

// EC5: GET commerce/orders/:orderId/push-state
export interface PushState {
  orderId: string;
  store: { id: string; name: string; platform: string; syncMode: string; refundPushEnabled: boolean; refundToCreditEnabled?: boolean; courierTrackingMetaKey: string | null } | null;
  /** NF7: server-computed refund-to-credit gate for this order
   * (per-store setting, default OFF). The credit refund option
   * renders ONLY when this is true. */
  refundToCreditEnabled?: boolean;
  storeSyncStatus: string | null;
  storeSyncError: string | null;
  storeDraftId: string | null;
  storeInvoiceUrl: string | null;
  recentPushes: { id: string; operation: string; status: string; lastError: string | null; createdAt: string }[];
}

export interface RiskDetail {
  band: string;
  score: number | null;
  decided: number;
  reasons: string[];
  suggestion: string | null;
  phone?: string | null;
  // NF13: sibling network signal when the API returns one.
  networkSignal?: FraudNetworkSignal | null;
}

export const RISK_LABEL = {
  high: { textKey: "riskHigh", cls: "bg-red-50 text-red-700", borderCls: "border-red-200", dotCls: "bg-red-500" },
  medium: { textKey: "riskMedium", cls: "bg-amber-50 text-amber-700", borderCls: "border-amber-200", dotCls: "bg-amber-500" },
  low: { textKey: "riskLow", cls: "bg-emerald-50 text-emerald-700", borderCls: "border-emerald-200", dotCls: "bg-emerald-500" },
  unknown: { textKey: "riskNoData", cls: "bg-slate-50 text-slate-500", borderCls: "border-slate-200", dotCls: "bg-slate-400" },
} as const satisfies Record<string, { textKey: string; cls: string; borderCls: string; dotCls: string }>;

export interface Stats {
  totalOrders: number;
  codOrders: number;
  codSharePercent: number;
  deliveredRevenueMinor: string;
  byStatus: { status: string; count: number }[];
}

export interface Shipment {
  id: string;
  orderId: string;
  trackingCode?: string | null;
  status: string;
  provider: string;
  trackingUrl?: string | null;
  courierRuleId?: string | null;
}

// EC22: courier auto-select rules + tracking templates, riders.
export interface CourierRule {
  id: string;
  name: string;
  conditions: {
    districts?: string[];
    minWeightGrams?: number;
    maxWeightGrams?: number;
    minOrderMinor?: string | number;
    maxOrderMinor?: string | number;
    paymentType?: string;
  };
  courierAccountId: string;
  provider: string;
  priority: number;
  active: boolean;
}

export interface CourierSuggestion {
  ruleId: string | null;
  ruleName?: string | null;
  provider?: string | null;
  reason?: string | null;
}

export interface RiderRow {
  id: string;
  name: string;
  phone?: string | null;
  active: boolean;
}

export interface DeliveryAssignmentRow {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  orderStatus?: string | null;
  orderTotalMinor?: string;
  orderAddress?: string | null;
  riderId: string;
  riderName?: string | null;
  status: string;
  assignedAt?: string;
  note?: string | null;
}

// Sales & Data S5: row shape from GET organizations/:id/courier/performance.
export interface ProviderPerformance {
  provider: string;
  booked: number;
  delivered: number;
  returned: number;
  cancelled: number;
  inFlight: number;
  decided: number;
  deliveryRate: number | null;
  returnRate: number | null;
  avgDeliveryHours: null;
}

export interface CourierPerformance {
  days: number;
  deliveryTimeAvailable: boolean;
  providers: ProviderPerformance[];
  totals: ProviderPerformance;
}

export const PERF_PROVIDER_LABEL: Record<string, string> = {
  steadfast: "Steadfast",
  pathao: "Pathao",
  redx: "RedX",
  total: "total",
};
// PERF_PROVIDER_LABEL.total holds the dict.orders key "total";
// other values are courier brand names shown as-is.

// CX12b: post-delivery reviews
export interface ReviewRow {
  id: string;
  orderId: string;
  customerId?: string | null;
  rating: number | null;
  comment: string | null;
  source: string | null;
  status: string;
  requestedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  orderNumber: string | null;
  customerName: string | null;
}

// CX7: "To Chase" — chase records for stalled order-bot sessions.
export interface ChaseRow {
  id: string;
  sessionId: string;
  conversationId: string;
  attempts: number;
  lastChasedAt: string | null;
  lastFailedAt: string | null;
  stoppedReason: string | null;
  lastEvent: string | null;
  createdAt: string;
  updatedAt: string;
  sessionState: string | null;
  sessionStatus: string | null;
  productName: string | null;
}

export const STATUSES = ["", "pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"];

// Sales & Data S2: client-side mirror of the PATCH transition table
export const PATCH_STATUSES = ["pending", "on-hold", "processing", "completed", "cancelled", "refunded", "failed", "returned"];

export const ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: PATCH_STATUSES,
  "on-hold": PATCH_STATUSES,
  processing: PATCH_STATUSES,
  completed: ["refunded", "returned"],
  cancelled: ["pending", "on-hold", "processing"],
  failed: ["pending", "on-hold", "processing"],
  refunded: [],
  returned: [],
};

export function transitionAllowed(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = ORDER_TRANSITIONS[from];
  if (!allowed) return true;
  return allowed.includes(to);
}

// EB5 ED13: panel contracts for the orders decomposition — exact
// copies of the shapes page.tsx defines locally for its action /
// split / merge / fraud / notification panels (the page keeps its
// own local copies; these are the extracted components' contracts).
export interface PanelOrderItem {
  id: string; name: string; quantity: number; totalMinor: string;
  priceMinor?: string; productId?: string | null; sku?: string | null;
  isGift?: boolean; bundleId?: string | null; bundleName?: string | null;
}

export interface PanelOrder {
  id: string; externalNumber?: string | null; status: string; isCod: boolean;
  paymentMethod?: string | null; totalMinor: string; refundedMinor?: string; internalNote?: string | null; placedAt?: string | null;
  deliverySlot?: { id?: string; label: string; startTime?: string; endTime?: string; date: string } | null;
  deliveryMethod?: string;
  pickupPoint?: { id: string; name: string; address: string; district: string; phone: string | null; feeMinor: string } | null;
  paymentVerifications?: PaymentVerificationRow[];
  advancePaidMinor?: string;
  amountDueMinor?: string;
  shippingMinor?: string;
  promotionDiscountMinor?: string;
  referralDiscountMinor?: string;
  referralCode?: string | null;
  promotionsApplied?: { promotionId: string; name: string; type: string; amountMinor: string }[] | null;
  wholesaleBreakdown?: { productId: string; minQty: number; priceMinor: string }[] | null;
  giftWrapMinor?: string;
  giftMessage?: string | null;
  giftPromotionId?: string | null;
  giftSkipped?: boolean;
  source?: string | null; externalId?: string | null; storeId?: string | null;
  storeDraftId?: string | null; storeInvoiceUrl?: string | null;
  customer?: { firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null } | null;
  items?: PanelOrderItem[];
  allocations?: OrderAllocation[];
  risk?: { band: string; score: number | null } | null;
  tags?: string[] | null; assigneeId?: string | null;
  codConfirmationStatus?: string | null;
  conversationId?: string | null; codConversationId?: string | null;
  riskScore?: number | null;
  riskBand?: "low" | "medium" | "high" | null;
  // NF13: sibling network signal (opted-in orgs only).
  networkSignal?: FraudNetworkSignal | null;
  riskReasons?: RiskReason[] | null;
  riskAssessedAt?: string | null;
  reviewHold?: boolean;
  reviewHoldReason?: string | null;
  reviewHeldAt?: string | null;
  codCallAttempts?: number;
  codLastCallAt?: string | null;
  codLastCallOutcome?: "confirmed" | "rejected" | "unreachable" | "callback_requested" | null;
  checkoutFields?: Record<string, string | boolean> | null;
  checkoutFieldDefs?: { key: string; label: string }[] | null;
  deposit?: { dueMinor: string; paidMinor: string; outstandingMinor: string } | null;
  deviceHashPrefix?: string | null;
}

export interface ProductPick { id: string; name: string; sku?: string | null; priceMinor: string }
export interface ProductVariantPick { id: string; name: string; priceMinor?: string | null }

export interface FraudSettings {
  enabled: boolean; autoHoldEnabled: boolean; autoHoldBand: string;
  highValueMinor: string; burstCount: number; burstWindowHours: number;
  openOrderPolicy: string; openOrderWindowHours: number;
  waitingPeriodMinutes: number; maxOrdersPerPhonePerDay: number;
  captchaEnabled: boolean; captchaOnCheckout: boolean; captchaOnOtp: boolean;
  turnstileSiteKey: string | null; turnstileSecretSet: boolean;
}
export interface BlockedPhoneRow { id: string; phone: string; phoneKey: string; reason: string | null; createdAt: string }
export interface IdentifierRow { id: string; kind: string; value: string; reason: string | null; createdAt: string }
export interface FraudAttemptRow { id: string; channel: string; kind: string; identifierSummary: string; ruleId: string | null; createdAt: string }
export interface FraudRuleRow {
  id: string; name: string; enabled: boolean;
  conditions: Record<string, unknown>; action: string; tagValue: string | null;
  hitCount: number; createdAt: string;
}

export interface NotifEventConfig {
  enabled: boolean; channels: string[];
  templates: { sms: string | null; whatsapp: string | null; email: string | null };
}
export type NotifConfig = Record<string, NotifEventConfig>;
