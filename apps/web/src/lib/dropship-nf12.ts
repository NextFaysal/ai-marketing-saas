/**
 * NF12 (FB4) — Supplier portal + Dropship web helpers + payload
 * types. Money is minor-unit STRINGS from the API. The payout
 * note below must stay byte-identical to the API's
 * DROPSHIP_PAYOUT_NOTE (apps/api/src/dropship/dropship.service.ts)
 * — pinned by the vitest suite. The ledger is RECORDS ONLY:
 * no payout is executed anywhere; payouts remain behind the
 * OU11 legal gate.
 */

export const DROPSHIP_PAYOUT_NOTE =
  "এই লেজারটি শুধুমাত্র একটি রেকর্ড — এর মাধ্যমে কোনো পেআউট সম্পন্ন হয় না। পেআউট OU11 আইনি গেটের (legal gate) পেছনে রয়েছে। (Records only — no payout is executed; payouts remain behind the OU11 legal gate.)";

import type { UiLocale } from "@repo/contracts";
import { billingBn, billingEn } from "./i18n/billing";
import { interpolate } from "./i18n/lookup";

const D = (locale?: string) => (locale === "en" ? billingEn : billingBn);

export const PARTNER_STOCK_LABEL = billingBn.zzDropPartnerStock;

export function agreementStatusLabel(v: string | null | undefined, locale: UiLocale = "bn"): string {
  const d = D(locale);
  switch (v) {
    case "pending": return d.zzDropAgreePending;
    case "accepted": return d.zzDropAgreeAccepted;
    case "declined": return d.zzDropAgreeDeclined;
    case "revoked": return d.zzDropAgreeRevoked;
    default: return v ?? "—";
  }
}

export function poStatusLabel(v: string | null | undefined, locale: UiLocale = "bn"): string {
  const d = D(locale);
  switch (v) {
    case "draft": return d.zzDropPoDraft;
    case "ordered": return d.zzDropPoOrdered;
    case "partially_received": return d.zzDropPoPartial;
    case "received": return d.zzDropPoReceived;
    case "cancelled": return d.zzDropPoCancelled;
    default: return v ?? "—";
  }
}

export function orderStatusLabel(v: string | null | undefined, locale: UiLocale = "bn"): string {
  const d = D(locale);
  switch (v) {
    case "pending": return d.zzDropOrderPending;
    case "processing": return d.zzDropOrderProcessing;
    case "completed": return d.zzDropOrderCompleted;
    case "delivered": return d.zzDropOrderDelivered;
    case "cancelled": return d.zzDropOrderCancelled;
    default: return v ?? "—";
  }
}

/** Partner stock display: a real count, "অসীম/ট্র্যাক হয়নি"
 * when the source product is untracked (null) — never a
 * fabricated number, and always labelled partner stock. */
export function partnerStockLabel(stock: number | null | undefined, locale: UiLocale = "bn"): string {
  const d = D(locale);
  const label = d.zzDropPartnerStock;
  if (stock == null) return interpolate(d.zzDropPartnerUntracked, { label });
  return interpolate(d.zzDropPartnerCount, { label, count: stock });
}

/** Seller price must be >= floor — the same rule the API
 * enforces server-side; the UI checks first for a fast, honest
 * message (the API remains the authority). */
export function priceBelowFloor(priceMinor: string, floorMinor: string): boolean {
  try {
    return BigInt(priceMinor) < BigInt(floorMinor);
  } catch {
    return true;
  }
}

export interface DropshipAgreementView {
  id: string;
  status: string;
  myRole: "supplier" | "seller";
  invitedByMe: boolean;
  counterpartyName: string | null;
  supplierOrg: { id: string; name: string | null; slug: string | null };
  sellerOrg: { id: string; name: string | null; slug: string | null };
  createdAt: string;
  respondedAt: string | null;
}

export interface DropshipOfferView {
  id: string;
  agreementId: string;
  productId: string;
  productName: string | null;
  floorPriceMinor: string;
  active: boolean;
  partnerStock: number | null;
  partnerStockLabel: string;
}

export interface DropshipListingView {
  id: string;
  agreementId: string;
  sourceProductId: string;
  sourceProductName: string | null;
  sellerProductId: string;
  priceMinor: string;
  active: boolean;
  partnerStock: number | null;
  partnerStockLabel: string;
  suppliedBy: string | null;
}

export interface DropshipOrderLinkView {
  id: string;
  agreementId: string;
  sellerOrderId: string;
  supplierOrderId: string | null;
  supplierStatus: string | null;
  cancelNote: string | null;
  myRole: "seller" | "supplier";
  items: { listingId: string; sourceProductId: string; qty: number; wholesaleUnitMinor: string; retailUnitMinor?: string }[];
  ledger: { id: string; retailTotalMinor: string; wholesaleTotalMinor: string; marginMinor: string; payoutNote: string } | null;
  createdAt: string;
}

export interface DropshipLedgerView {
  id: string;
  agreementId: string;
  dropshipOrderLinkId: string;
  sellerOrgId: string;
  supplierOrgId: string;
  retailTotalMinor: string;
  wholesaleTotalMinor: string;
  marginMinor: string;
  createdAt: string;
}

export interface SupplierPortalHome {
  organizationName: string | null;
  supplier: { id: string; name: string; leadTimeDays: number | null; leadTimeNote: string | null };
  purchaseOrders: {
    id: string;
    status: string;
    expectedDate: string | null;
    note: string | null;
    createdAt: string;
    supplierConfirmedAt: string | null;
    supplierShippedAt: string | null;
    supplierShipNote: string | null;
    totalMinor: string;
    items: { id: string; productName: string | null; sku: string | null; qtyOrdered: number; qtyReceived: number; unitCostMinor: string; lineTotalMinor: string }[];
  }[];
  linkExpiresAt: string;
}
