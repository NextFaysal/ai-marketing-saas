"use client";
import React, { useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { fmtDateTime, fmtNumber, formatMinor } from "@repo/contracts";
import { ResponsiveTable } from "@repo/ui";
import type {
  Order,
  Shipment,
  CourierSuggestion,
  InstallmentPlan,
  InstallmentItemRow,
  PushState,
  DeliveryAssignmentRow,
  RiderRow,
  ReviewRow,
} from "./types";
import { PATCH_STATUSES, transitionAllowed } from "./types";
import { VoiceConfirmationCard } from "./VoiceConfirmationCard";
import { SmartRoutingCard } from "./SmartRoutingCard";

interface OrderDrawerProps {
  order: Order | null;
  onClose: () => void;
  activeTab: "overview" | "courier" | "payment" | "store" | "rider";
  onTabChange: (tab: "overview" | "courier" | "payment" | "store" | "rider") => void;

  // Overview actions
  actStatus: string;
  onActStatusChange: (s: string) => void;
  actRefundTaka: string;
  onActRefundTakaChange: (v: string) => void;
  actRefundReason: string;
  onActRefundReasonChange: (v: string) => void;
  actNote: string;
  onActNoteChange: (v: string) => void;
  actBusy: string;
  actNotice: string;
  onSaveStatus: () => void;
  onSaveRefund: () => void;
  onSaveNote: () => void;
  onClearNote: () => void;

  // Courier booking
  shipments: Shipment[];
  courierConnected: boolean;
  conns: { provider: string; connected: boolean }[];
  bookSuggestion: CourierSuggestion | null;
  bookForm: any;
  onBookFormChange: (form: any) => void;
  pStores: any[];
  pCities: any[];
  pZones: any[];
  pAreas: any[];
  rAreas: any[];
  rStores: any[];
  onLoadProviderLists: (provider: string) => Promise<void>;
  onCityChange: (cityId: string) => Promise<void>;
  onZoneChange: (zoneId: string) => Promise<void>;
  onFetchQuote: (order: Order) => void;
  quoteBusy: boolean;
  quoteOut: any;
  onBookShipment: (order: Order) => void;
  courierBusy: string;
  courierNotice: string;
  onSyncShipment: (id: string) => void;
  onDownloadPdf: (path: string, filename: string) => void;
  orgId: string;

  // Advance Payment
  advAmount: string;
  onAdvAmountChange: (v: string) => void;
  advMethod: string;
  onAdvMethodChange: (v: string) => void;
  advRef: string;
  onAdvRefChange: (v: string) => void;
  advNote: string;
  onAdvNoteChange: (v: string) => void;
  advBusy: boolean;
  advError: string;
  advNotice: string;
  onRecordAdvance: () => void;

  // Installment Plan
  instPlan: InstallmentPlan | null;
  instLoaded: boolean;
  instError: string;
  instBusy: string;
  instCount: string;
  onInstCountChange: (v: string) => void;
  instInterval: string;
  onInstIntervalChange: (v: string) => void;
  instStart: string;
  onInstStartChange: (v: string) => void;
  instNote: string;
  onInstNoteChange: (v: string) => void;
  collectForms: Record<string, { amount: string; method: string; reference: string; note: string }>;
  onCollectFormChange: (itemId: string, field: string, val: string) => void;
  onCreateInstPlan: () => void;
  onCollectInstItem: (item: InstallmentItemRow) => void;
  onCancelInstPlan: () => void;

  // Store Sync
  pushState: PushState | null;
  pushStateError: string;
  storeNoteText: string;
  onStoreNoteTextChange: (v: string) => void;
  syncBusy: string;
  syncNotice: string;
  syncError: string;
  returnUrl: string;
  copiedKey: string;
  onSendStoreNote: () => void;
  onCreateStoreDraft: () => void;
  onCreateReturnLink: () => void;
  onCopyText: (key: string, text: string) => void;

  // Rider Delivery
  orderAssignments: DeliveryAssignmentRow[];
  riders: RiderRow[];
  assignRiderId: string;
  onAssignRiderIdChange: (id: string) => void;
  riderBusy: string;
  onAssignRider: () => void;
  onTransitionAssignment: (a: DeliveryAssignmentRow, status: string) => void;

  // Reviews
  review: ReviewRow | null;
}

export function OrderDrawer({
  order,
  onClose,
  activeTab,
  onTabChange,
  actStatus,
  onActStatusChange,
  actRefundTaka,
  onActRefundTakaChange,
  actRefundReason,
  onActRefundReasonChange,
  actNote,
  onActNoteChange,
  actBusy,
  actNotice,
  onSaveStatus,
  onSaveRefund,
  onSaveNote,
  onClearNote,
  shipments,
  courierConnected,
  conns,
  bookSuggestion,
  bookForm,
  onBookFormChange,
  pStores,
  pCities,
  pZones,
  pAreas,
  rAreas,
  rStores,
  onLoadProviderLists,
  onCityChange,
  onZoneChange,
  onFetchQuote,
  quoteBusy,
  quoteOut,
  onBookShipment,
  courierBusy,
  courierNotice,
  onSyncShipment,
  onDownloadPdf,
  orgId,
  advAmount,
  onAdvAmountChange,
  advMethod,
  onAdvMethodChange,
  advRef,
  onAdvRefChange,
  advNote,
  onAdvNoteChange,
  advBusy,
  advError,
  advNotice,
  onRecordAdvance,
  instPlan,
  instLoaded,
  instError,
  instBusy,
  instCount,
  onInstCountChange,
  instInterval,
  onInstIntervalChange,
  instStart,
  onInstStartChange,
  instNote,
  onInstNoteChange,
  collectForms,
  onCollectFormChange,
  onCreateInstPlan,
  onCollectInstItem,
  onCancelInstPlan,
  pushState,
  pushStateError,
  storeNoteText,
  onStoreNoteTextChange,
  syncBusy,
  syncNotice,
  syncError,
  returnUrl,
  copiedKey,
  onSendStoreNote,
  onCreateStoreDraft,
  onCreateReturnLink,
  onCopyText,
  orderAssignments,
  riders,
  assignRiderId,
  onAssignRiderIdChange,
  riderBusy,
  onAssignRider,
  onTransitionAssignment,
  review,
}: OrderDrawerProps) {
  const { dict, t, locale } = useLocale();
  if (!order) return null;

  const refunded = BigInt(order.refundedMinor ?? "0");
  const totalAmt = BigInt(order.totalMinor);
  const sh = shipments.find((s) => s.orderId === order.id);
  // EB6/ED15: the installment collect cell is shared verbatim by the
  // desktop table and the ResponsiveTable mobile card — same handlers,
  // same order (products-page row-action discipline).
  const renderInstCollect = (item: InstallmentItemRow) => {
    const remaining = (() => {
      try {
        return BigInt(item.remainingMinor);
      } catch {
        return 0n;
      }
    })();
    const form = collectForms[item.id];
    return remaining > 0n && form ? (
      <div className="flex items-center gap-1">
        <input
          className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs"
          aria-label={dict.orders.collectionAmountTaka}
          value={form.amount}
          onChange={(e) =>
            onCollectFormChange(item.id, "amount", e.target.value)
          }
        />
        <button
          type="button"
          disabled={instBusy !== ""}
          onClick={() => onCollectInstItem(item)}
          className="inline-flex min-h-[44px] items-center rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-indigo-700"
        >
          {dict.orders.collect3}</button>
      </div>
    ) : (
      "—"
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs transition-opacity animate-fade">
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-6 sm:pl-10">
        <div className="w-screen max-w-2xl bg-white shadow-2xl animate-slide-left flex flex-col">
          {/* 1. Header */}
          <div className="border-b border-slate-100 bg-slate-50/80 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-slate-900">
                    {dict.orders.order3}{order.externalNumber ?? order.id.slice(0, 8)}
                  </span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">
                    {order.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {dict.orders.customer3}{[order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(" ") || "—"} ·{" "}
                  {order.customer?.phone ?? order.customer?.email ?? "—"}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-400 shadow-sm transition hover:bg-slate-100 hover:text-slate-700 active:scale-95"
                aria-label={dict.orders.close}
              >
                ✕
              </button>
            </div>

            {/* 2. Navigation Tabs */}
            <div className="mt-4 flex items-center gap-2 overflow-x-auto text-xs scrollbar-none">
              <button
                type="button"
                onClick={() => onTabChange("overview")}
                className={`inline-flex min-h-[44px] items-center rounded-xl px-3 py-1.5 font-semibold transition ${
                  activeTab === "overview"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {dict.orders.overviewStatus}</button>
              <button
                type="button"
                onClick={() => onTabChange("courier")}
                className={`inline-flex min-h-[44px] items-center rounded-xl px-3 py-1.5 font-semibold transition ${
                  activeTab === "courier"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {dict.orders.courierBooking}</button>
              <button
                type="button"
                onClick={() => onTabChange("payment")}
                className={`inline-flex min-h-[44px] items-center rounded-xl px-3 py-1.5 font-semibold transition ${
                  activeTab === "payment"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {dict.orders.paymentInstallments}</button>
              <button
                type="button"
                onClick={() => onTabChange("store")}
                className={`inline-flex min-h-[44px] items-center rounded-xl px-3 py-1.5 font-semibold transition ${
                  activeTab === "store"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {dict.orders.storeSync}</button>
              <button
                type="button"
                onClick={() => onTabChange("rider")}
                className={`inline-flex min-h-[44px] items-center rounded-xl px-3 py-1.5 font-semibold transition ${
                  activeTab === "rider"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {dict.orders.riderFleet}</button>
            </div>
          </div>

          {/* 3. Tab Body (Scrollable) */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {actNotice && (
              <div className="rounded-xl bg-indigo-50 px-3.5 py-2.5 text-xs font-semibold text-indigo-700">
                {actNotice}
              </div>
            )}

            {/* TAB 1: OVERVIEW & ACTIONS */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* Status Changer */}
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {dict.orders.updateOrderStatus}</span>
                    <span className="text-xs font-semibold text-indigo-600">{dict.orders.current2}{order.status}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={actStatus}
                      onChange={(e) => onActStatusChange(e.target.value)}
                    >
                      {!PATCH_STATUSES.includes(order.status) && (
                        <option value={order.status}>{order.status} {dict.orders.current}</option>
                      )}
                      {PATCH_STATUSES.map((s) => (
                        <option key={s} value={s} disabled={!transitionAllowed(order.status, s)}>
                          {s} {s === order.status ? dict.orders.current : ""}{" "}
                          {!transitionAllowed(order.status, s) ? dict.orders.cannotGo2 : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={actBusy !== "" || actStatus === order.status}
                      onClick={onSaveStatus}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {actBusy === "save" ? dict.orders.saving2 : dict.orders.statusChange}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {dict.orders.whenCancelledFailedStockIs2}</p>
                </div>

                {/* AI Voice Call Confirmation for COD */}
                <VoiceConfirmationCard
                  orderId={order.id}
                  isCod={order.isCod}
                  codConfirmationStatus={order.codConfirmationStatus}
                  codCallAttempts={order.codCallAttempts}
                  codLastCallAt={order.codLastCallAt}
                  codLastCallOutcome={order.codLastCallOutcome}
                  customerPhone={order.customer?.phone}
                  onOrderUpdated={onSaveStatus}
                />

                {/* Ordered Items */}
                <div className="rounded-2xl border border-slate-200/80 p-4 space-y-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {dict.orders.orderItems2}</span>
                  <div className="divide-y divide-slate-100">
                    {(order.items ?? []).map((it) => (
                      <div key={it.id} className="flex items-center justify-between py-2 text-xs">
                        <div>
                          <div className="font-semibold text-slate-800">
                            {it.name} × <span className="font-bold">{it.quantity}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {it.isGift && (
                              <span className="rounded bg-pink-100 px-1.5 py-0.2 text-[10px] font-bold text-pink-700">
                                {dict.orders.gift}</span>
                            )}
                            {it.bundleName && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-800">
                                {dict.orders.bundle}{it.bundleName}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="font-bold text-slate-900">
                          {it.isGift
                            ? dict.orders.text1qvn
                            : (() => {
                                try {
                                  return formatMinor(BigInt(it.totalMinor));
                                } catch {
                                  return it.totalMinor;
                                }
                              })()}
                        </div>
                      </div>
                    ))}
                  </div>

                  {order.giftWrapMinor && Number(order.giftWrapMinor) > 0 && (
                    <div className="flex justify-between border-t border-slate-100 pt-2 text-xs text-pink-700 font-semibold">
                      <span>{dict.orders.giftWrapFee}</span>
                      <span>{formatMinor(BigInt(order.giftWrapMinor))}</span>
                    </div>
                  )}

                  {order.giftMessage && (
                    <div className="rounded-xl border border-pink-200 bg-pink-50/70 p-3 text-xs font-semibold text-pink-900">
                      {dict.orders.giftMessage2}{order.giftMessage}”
                    </div>
                  )}

                  <div className="flex justify-between border-t border-slate-100 pt-3 text-sm font-bold text-slate-900">
                    <span>{dict.orders.grandTotal}</span>
                    <span>{formatMinor(BigInt(order.totalMinor))}</span>
                  </div>
                </div>

                {/* Refund Record */}
                <div className="rounded-2xl border border-slate-200/80 p-4 space-y-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {dict.orders.recordMoneyRefund}</span>
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>{dict.orders.totalRefunded}{formatMinor(refunded)}</span>
                    <span className="font-semibold text-slate-900">
                      {dict.orders.moreRefundable2}{formatMinor(totalAmt - refunded)}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder={dict.orders.amountInTakaEG}
                      value={actRefundTaka}
                      onChange={(e) => onActRefundTakaChange(e.target.value)}
                    />
                    <input
                      type="text"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder={dict.orders.reasonOptional}
                      value={actRefundReason}
                      onChange={(e) => onActRefundReasonChange(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={actBusy !== "" || actRefundTaka.trim() === ""}
                    onClick={onSaveRefund}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                  >
                    {dict.orders.recordRefund2}</button>
                </div>

                {/* Internal Team Note */}
                <div className="rounded-2xl border border-slate-200/80 p-4 space-y-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {dict.orders.teamInternalNotePrivate}</span>
                  <textarea
                    rows={2}
                    className="w-full rounded-xl border border-slate-200 p-3 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder={dict.orders.eGTheCustomerChanged}
                    value={actNote}
                    onChange={(e) => onActNoteChange(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={actBusy !== ""}
                      onClick={onSaveNote}
                      className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {dict.orders.saveNote}</button>
                    <button
                      type="button"
                      disabled={actBusy !== ""}
                      onClick={onClearNote}
                      className="rounded-xl px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      {dict.orders.delete}</button>
                  </div>
                </div>

                {/* Quick Print links */}
                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                  <button
                    type="button"
                    onClick={() =>
                      onDownloadPdf(
                        `/organizations/${orgId}/courier/orders/${order.id}/invoice.pdf`,
                        `invoice-${order.externalNumber ?? order.id}.pdf`
                      )
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    {dict.orders.invoicePDF}</button>
                  <a
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                    href={`/dashboard/commerce/print?orderId=${order.id}&kind=invoice`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {dict.orders.printInvoice2}</a>
                  <a
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                    href={`/dashboard/commerce/print?orderId=${order.id}&kind=slip`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {dict.orders.printPackingSlip}</a>
                </div>
              </div>
            )}

            {/* TAB 2: COURIER & DISPATCH */}
            {activeTab === "courier" && (
              <div className="space-y-6">
                {courierNotice && (
                  <div className="rounded-xl bg-indigo-50 px-3.5 py-2.5 text-xs font-semibold text-indigo-700">
                    {courierNotice}
                  </div>
                )}

                {/* If Shipment Exists */}
                {sh && (
                  <div className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">
                        {dict.orders.activeParcelTracking}</span>
                      <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-bold text-white">
                        {sh.status}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-slate-800">
                      {dict.orders.courier3}{sh.provider} {dict.orders.tracking}{sh.trackingCode ?? dict.orders.pending}
                    </div>
                    {sh.trackingUrl && (
                      <a
                        href={sh.trackingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block text-xs font-semibold text-indigo-600 hover:underline"
                      >
                        {dict.orders.viewLiveTrackingPage}</a>
                    )}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        type="button"
                        disabled={courierBusy !== ""}
                        onClick={() => onSyncShipment(sh.id)}
                        className="rounded-xl bg-white border border-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50"
                      >
                        {courierBusy === "sync" ? dict.orders.verifying : dict.orders.verifyStatus}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onDownloadPdf(
                            `/organizations/${orgId}/courier/shipments/${sh.id}/label.pdf`,
                            `label-${sh.trackingCode ?? sh.id}.pdf`
                          )
                        }
                        className="rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
                      >
                        {dict.orders.downloadLabel}</button>
                    </div>
                  </div>
                )}

                {/* Booking Form */}
                <div className="rounded-2xl border border-slate-200/80 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {dict.orders.newParcelBooking}</span>
                    {bookSuggestion?.ruleId && (
                      <span className="rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                        {dict.orders.suggestion}{bookSuggestion.ruleName}
                      </span>
                    )}
                  </div>

                  {/* AI Smart Courier Routing Card */}
                  <SmartRoutingCard
                    orderId={order.id}
                    currentProvider={bookForm.provider}
                    onSelectProvider={async (provider) => {
                      onBookFormChange({ ...bookForm, provider });
                      await onLoadProviderLists(provider);
                    }}
                  />

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="text-[11px] font-medium text-slate-500">{dict.orders.courierProvider}</label>
                      <select
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={bookForm.provider}
                        onChange={async (e) => {
                          onBookFormChange({ ...bookForm, provider: e.target.value });
                          await onLoadProviderLists(e.target.value);
                        }}
                      >
                        {(["steadfast", "pathao", "redx"] as const).map((p) => {
                          const c = conns.find((x) => x.provider === p);
                          const connected = c ? c.connected : p === "steadfast" ? courierConnected : false;
                          return (
                            <option key={p} value={p} disabled={!connected}>
                              {p === "steadfast" ? "Steadfast" : p === "pathao" ? "Pathao" : "RedX"}
                              {connected ? "" : dict.orders.notLinked2}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-slate-500">{dict.orders.weightKg}</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={bookForm.weightKg}
                        onChange={(e) => onBookFormChange({ ...bookForm, weightKg: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-slate-500">{dict.orders.recipientName}</label>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={bookForm.name}
                        onChange={(e) => onBookFormChange({ ...bookForm, name: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-slate-500">{dict.orders.phoneNumber}</label>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={bookForm.phone}
                        onChange={(e) => onBookFormChange({ ...bookForm, phone: e.target.value })}
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-[11px] font-medium text-slate-500">
                        {dict.orders.fullDeliveryAddressHouseRoad}</label>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder={dict.orders.atLeast8CharactersRequired}
                        value={bookForm.address}
                        onChange={(e) => onBookFormChange({ ...bookForm, address: e.target.value })}
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-[11px] font-medium text-slate-500">{dict.orders.noteOptional}</label>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={bookForm.note}
                        onChange={(e) => onBookFormChange({ ...bookForm, note: e.target.value })}
                      />
                    </div>

                    {/* Pathao Selectors */}
                    {bookForm.provider === "pathao" && (
                      <>
                        <div>
                          <label className="text-[11px] font-medium text-slate-500">{dict.orders.pathaoPickupStore}</label>
                          <select
                            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                            value={bookForm.pStoreId}
                            onChange={(e) => onBookFormChange({ ...bookForm, pStoreId: e.target.value })}
                          >
                            <option value="">{dict.orders.automaticFirstActive}</option>
                            {pStores.map((s: any) => (
                              <option key={s.store_id} value={s.store_id}>
                                {s.store_name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-slate-500">{dict.orders.city}</label>
                          <select
                            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                            value={bookForm.pCityId}
                            onChange={(e) => onCityChange(e.target.value)}
                          >
                            <option value="">{dict.orders.guessFromAddressOptional}</option>
                            {pCities.map((c: any) => (
                              <option key={c.city_id} value={c.city_id}>
                                {c.city_name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-slate-500">{dict.orders.zone}</label>
                          <select
                            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                            value={bookForm.pZoneId}
                            onChange={(e) => onZoneChange(e.target.value)}
                          >
                            <option value="">{dict.orders.zoneOptional}</option>
                            {pZones.map((z: any) => (
                              <option key={z.zone_id} value={z.zone_id}>
                                {z.zone_name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-slate-500">{dict.orders.area}</label>
                          <select
                            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                            value={bookForm.pAreaId}
                            onChange={(e) => onBookFormChange({ ...bookForm, pAreaId: e.target.value })}
                          >
                            <option value="">{dict.orders.areaOptional}</option>
                            {pAreas.map((a: any) => (
                              <option key={a.area_id} value={a.area_id}>
                                {a.area_name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}

                    {/* RedX Selectors */}
                    {bookForm.provider === "redx" && (
                      <div className="sm:col-span-2">
                        <label className="text-[11px] font-medium text-slate-500">
                          {dict.orders.redXDeliveryAreaRequired}</label>
                        <select
                          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                          value={bookForm.rAreaId}
                          onChange={(e) => {
                            const area = rAreas.find((a: any) => String(a.id) === e.target.value);
                            onBookFormChange({
                              ...bookForm,
                              rAreaId: e.target.value,
                              rAreaName: area?.name ?? "",
                            });
                          }}
                        >
                          <option value="">{dict.orders.selectDeliveryArea}</option>
                          {rAreas.map((a: any) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Delivery Quote preview */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      disabled={quoteBusy}
                      onClick={() => onFetchQuote(order)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                      {quoteBusy ? dict.orders.calculating2 : dict.orders.verifyDeliveryCharge}
                    </button>

                    {quoteOut && (
                      <div className="text-xs font-semibold">
                        {quoteOut.quotable ? (
                          <span className="text-emerald-700">
                            {dict.orders.estimatedCharge}{formatMinor(BigInt(quoteOut.chargeMinor ?? 0))}
                          </span>
                        ) : (
                          <span className="text-amber-700">{quoteOut.reason}</span>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={
                        courierBusy !== "" ||
                        bookForm.address.trim().length < 8 ||
                        (bookForm.provider === "redx" && !bookForm.rAreaId)
                      }
                      onClick={() => onBookShipment(order)}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 active:scale-95 disabled:opacity-50"
                    >
                      {courierBusy === "book"
                        ? dict.orders.booking2
                        : t("orders.bookOn", { bookForm: bookForm.provider === "pathao"
                              ? "Pathao"
                              : bookForm.provider === "redx"
                                ? "RedX"
                                : "Steadfast" })}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: PAYMENTS & INSTALLMENTS */}
            {activeTab === "payment" && (
              <div className="space-y-6">
                {/* Financial Summary */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
                    <span className="text-[11px] font-semibold text-slate-500">{dict.orders.totalPrice}</span>
                    <div className="mt-1 text-base font-bold text-slate-900">
                      {formatMinor(BigInt(order.totalMinor))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
                    <span className="text-[11px] font-semibold text-slate-500">{dict.orders.advancePayment}</span>
                    <div className="mt-1 text-base font-bold text-emerald-700">
                      {order.advancePaidMinor !== undefined
                        ? formatMinor(BigInt(order.advancePaidMinor))
                        : dict.orders.text145goqj}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 col-span-2 sm:col-span-1">
                    <span className="text-[11px] font-semibold text-slate-500">{dict.orders.dueAmountDue}</span>
                    <div className="mt-1 text-base font-bold text-slate-900">
                      {order.amountDueMinor !== undefined
                        ? formatMinor(BigInt(order.amountDueMinor))
                        : formatMinor(BigInt(order.totalMinor))}
                    </div>
                  </div>
                </div>

                {/* Record Advance Payment */}
                <div className="rounded-2xl border border-slate-200/80 p-4 space-y-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {dict.orders.recordAdvancePayment}</span>
                  {advError && <p className="text-xs text-red-600">{advError}</p>}
                  {advNotice && <p className="text-xs text-emerald-700">{advNotice}</p>}

                  <div className="grid gap-2 sm:grid-cols-4">
                    <input
                      type="text"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                      placeholder={dict.orders.amountTaka}
                      value={advAmount}
                      onChange={(e) => onAdvAmountChange(e.target.value)}
                    />
                    <select
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                      value={advMethod}
                      onChange={(e) => onAdvMethodChange(e.target.value)}
                    >
                      <option value="bkash">{dict.orders.bKash}</option>
                      <option value="nagad">{dict.orders.cash}</option>
                      <option value="rocket">{dict.orders.rocket}</option>
                      <option value="cash">{dict.orders.cash2}</option>
                      <option value="bank">{dict.orders.bank}</option>
                      <option value="other">{dict.orders.other}</option>
                    </select>
                    <input
                      type="text"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                      placeholder={dict.orders.trxIDReference}
                      value={advRef}
                      onChange={(e) => onAdvRefChange(e.target.value)}
                    />
                    <input
                      type="text"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                      placeholder={dict.orders.noteOptional}
                      value={advNote}
                      onChange={(e) => onAdvNoteChange(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={advBusy || advAmount.trim() === ""}
                    onClick={onRecordAdvance}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                  >
                    {advBusy ? dict.orders.recording2 : dict.orders.recordAdvanceVerify}
                  </button>
                </div>

                {/* Payment Verifications List */}
                {(order.paymentVerifications ?? []).length > 0 && (
                  <div className="rounded-2xl border border-slate-200/80 p-4 space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {dict.orders.paymentVerificationHistory}</span>
                    <div className="divide-y divide-slate-100">
                      {(order.paymentVerifications ?? []).map((pv) => (
                        <div key={pv.id} className="flex items-center justify-between py-2 text-xs">
                          <div>
                            <span className="font-semibold text-slate-900">{pv.provider ?? "—"}</span>
                            {pv.trxId && (
                              <span className="ml-2 font-mono text-[11px] text-slate-500">
                                TrxID: {pv.trxId}
                              </span>
                            )}
                            <div className="text-[10px] text-slate-400">
                              {fmtDateTime(locale, new Date(pv.createdAt))}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-slate-900">
                              {pv.amountMinor != null ? formatMinor(BigInt(pv.amountMinor)) : "—"}
                            </span>
                            <div className="text-[10px] font-semibold text-emerald-700">{pv.status}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Installment Plan (EC31) */}
                <div className="rounded-2xl border border-slate-200/80 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {dict.orders.installmentPlan2}</span>
                    {instPlan && (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                        {instPlan.status}
                      </span>
                    )}
                  </div>

                  {instError && <p className="text-xs text-red-600">{instError}</p>}

                  {!instLoaded ? (
                    <p className="text-xs text-slate-500">{dict.common.loading}</p>
                  ) : !instPlan ? (
                    (() => {
                      let due = 0n;
                      try {
                        due = BigInt(order.amountDueMinor ?? "0");
                      } catch {
                        due = 0n;
                      }
                      return due > 0n ? (
                        <div className="space-y-3">
                          <p className="text-xs text-slate-600">
                            {dict.orders.due5}{formatMinor(due)} {dict.orders.createAPlanToSplit}</p>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <label className="text-[11px] text-slate-500">
                              {dict.orders.numberOfInstallments}<input
                                type="number"
                                min={2}
                                max={24}
                                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                                value={instCount}
                                onChange={(e) => onInstCountChange(e.target.value)}
                              />
                            </label>
                            <label className="text-[11px] text-slate-500">
                              {dict.orders.intervalDays}<input
                                type="number"
                                min={1}
                                max={90}
                                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                                value={instInterval}
                                onChange={(e) => onInstIntervalChange(e.target.value)}
                              />
                            </label>
                            <label className="text-[11px] text-slate-500">
                              {dict.orders.startDate}<input
                                type="date"
                                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                                value={instStart}
                                onChange={(e) => onInstStartChange(e.target.value)}
                              />
                            </label>
                          </div>
                          <button
                            type="button"
                            disabled={instBusy !== "" || !instStart}
                            onClick={onCreateInstPlan}
                            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {instBusy === "create" ? dict.orders.creating2 : dict.orders.createInstallmentPlan}
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">{dict.orders.noDueOnThisOrder2}</p>
                      );
                    })()
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-3 text-xs">
                        <span>{dict.orders.total3}<b>{formatMinor(BigInt(instPlan.totalMinor))}</b></span>
                        <span className="text-emerald-700">{dict.orders.payment2}<b>{formatMinor(BigInt(instPlan.paidMinor))}</b></span>
                        <span>{dict.orders.due3}<b>{formatMinor(BigInt(instPlan.remainingMinor))}</b></span>
                      </div>

                      <ResponsiveTable
                        table={
                          <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-slate-100 text-slate-500">
                            <tr>
                              <th className="py-1">{dict.orders.order2}</th>
                              <th className="py-1">{dict.orders.date}</th>
                              <th className="py-1">{dict.orders.quantity}</th>
                              <th className="py-1">{dict.orders.paid}</th>
                              <th className="py-1">{dict.orders.condition}</th>
                              {instPlan.status === "active" && <th className="py-1">{dict.orders.collect}</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {instPlan.items.map((item) => {
                              return (
                                <tr key={item.id} className="py-2">
                                  <td className="py-2 font-bold">{item.seq}</td>
                                  <td className="py-2">{item.dueDay}</td>
                                  <td className="py-2 font-semibold">
                                    {formatMinor(BigInt(item.amountMinor))}
                                  </td>
                                  <td className="py-2 text-emerald-700 font-semibold">
                                    {formatMinor(BigInt(item.paidMinor))}
                                  </td>
                                  <td className="py-2">
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                        item.fullyPaid
                                          ? "bg-emerald-100 text-emerald-800"
                                          : item.overdue
                                            ? "bg-red-100 text-red-800"
                                            : "bg-slate-100 text-slate-700"
                                      }`}
                                    >
                                      {item.fullyPaid ? dict.orders.complete : item.overdue ? dict.orders.overdue : dict.orders.due}
                                    </span>
                                  </td>
                                  {instPlan.status === "active" && (
                                    <td className="py-2">
                                      {renderInstCollect(item)}
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                          </div>
                        }
                        cards={instPlan.items.map((item) => (
                          <div key={item.id} className="rounded-xl border bg-white p-3 shadow-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-slate-900">{dict.orders.order2}{item.seq}</span>
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  item.fullyPaid
                                    ? "bg-emerald-100 text-emerald-800"
                                    : item.overdue
                                      ? "bg-red-100 text-red-800"
                                      : "bg-slate-100 text-slate-700"
                                }`}
                              >
                                {item.fullyPaid ? dict.orders.complete : item.overdue ? dict.orders.overdue : dict.orders.due}
                              </span>
                            </div>
                            <dl className="mt-2 space-y-1 text-xs">
                              <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.date}</dt><dd className="font-medium">{item.dueDay}</dd></div>
                              <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.quantity}</dt><dd className="font-semibold">{formatMinor(BigInt(item.amountMinor))}</dd></div>
                              <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.paid}</dt><dd className="font-semibold text-emerald-700">{formatMinor(BigInt(item.paidMinor))}</dd></div>
                            </dl>
                            {instPlan.status === "active" && (
                              <div className="mt-2 border-t pt-2">
                                <div className="mb-1 text-xs font-semibold text-slate-500">{dict.orders.collect}</div>
                                {renderInstCollect(item)}
                              </div>
                            )}
                          </div>
                        ))}
                      />

                      {instPlan.status === "active" && (
                        <button
                          type="button"
                          disabled={instBusy !== ""}
                          onClick={onCancelInstPlan}
                          className="text-xs font-semibold text-rose-600 hover:underline"
                        >
                          {dict.orders.cancelInstallmentPlan}</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: STORE SYNC */}
            {activeTab === "store" && (
              <div className="space-y-6">
                {syncNotice && <p className="text-xs text-emerald-700">{syncNotice}</p>}
                {syncError && <p className="text-xs text-red-600">{syncError}</p>}
                {pushStateError ? (
                  <p className="text-xs text-red-600">{dict.orders.couldNotLoad}{pushStateError}</p>
                ) : !pushState ? (
                  <p className="text-xs text-slate-500">{dict.common.loading}</p>
                ) : !pushState.store ? (
                  <p className="text-xs text-slate-500">{dict.orders.thisOrderHasNoLinked}</p>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200/80 p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">{pushState.store.name}</span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                          {pushState.store.platform} ({pushState.store.syncMode})
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {dict.orders.lastPushStatus}<b>{pushState.storeSyncStatus ?? "—"}</b>
                      </p>
                    </div>

                    {/* Customer note to store */}
                    <div className="rounded-2xl border border-slate-200/80 p-4 space-y-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        {dict.orders.sendCustomerNoteToStore}</span>
                      <textarea
                        rows={2}
                        className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:ring-2 focus:ring-indigo-500"
                        placeholder={dict.orders.noteToSendToThe}
                        value={storeNoteText}
                        onChange={(e) => onStoreNoteTextChange(e.target.value)}
                      />
                      <button
                        type="button"
                        disabled={syncBusy !== "" || !storeNoteText.trim()}
                        onClick={onSendStoreNote}
                        className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {dict.orders.sendNoteToStore}</button>
                    </div>

                    {/* Return link generator */}
                    <div className="rounded-2xl border border-slate-200/80 p-4 space-y-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        {dict.orders.customerReturnLink}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={syncBusy !== ""}
                          onClick={onCreateReturnLink}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          {syncBusy === "return-link" ? dict.orders.creating2 : dict.orders.createReturnLink}
                        </button>
                        {returnUrl && (
                          <button
                            type="button"
                            onClick={() => onCopyText("return", returnUrl)}
                            className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
                          >
                            {copiedKey === "return" ? dict.orders.copied3 : dict.orders.copyLink}
                          </button>
                        )}
                      </div>
                      {returnUrl && (
                        <p className="text-[11px] font-mono text-slate-600 break-all">{returnUrl}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: RIDER FLEET & REVIEWS */}
            {activeTab === "rider" && (
              <div className="space-y-6">
                {/* Rider Assignment */}
                <div className="rounded-2xl border border-slate-200/80 p-4 space-y-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {dict.orders.ownRiderAssignment}</span>

                  {(() => {
                    const active =
                      orderAssignments.find(
                        (a) => a.status === "assigned" || a.status === "picked_up"
                      ) ?? orderAssignments[0];

                    return active ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
                        <div>
                          <div className="font-bold text-slate-900">{active.riderName ?? active.riderId}</div>
                          <span className="text-xs text-indigo-700 font-semibold">{active.status}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {active.status === "assigned" && (
                            <button
                              type="button"
                              disabled={riderBusy !== ""}
                              onClick={() => onTransitionAssignment(active, "picked_up")}
                              className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white"
                            >
                              {dict.orders.collected2}</button>
                          )}
                          {active.status === "picked_up" && (
                            <>
                              <button
                                type="button"
                                disabled={riderBusy !== ""}
                                onClick={() => onTransitionAssignment(active, "delivered")}
                                className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                              >
                                {dict.orders.delivered}</button>
                              <button
                                type="button"
                                disabled={riderBusy !== ""}
                                onClick={() => onTransitionAssignment(active, "returned")}
                                className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white"
                              >
                                {dict.orders.return}</button>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                          value={assignRiderId}
                          onChange={(e) => onAssignRiderIdChange(e.target.value)}
                        >
                          <option value="">{dict.orders.chooseARider}</option>
                          {riders
                            .filter((r) => r.active)
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          disabled={riderBusy !== "" || !assignRiderId}
                          onClick={onAssignRider}
                          className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          {riderBusy === "assign" ? dict.orders.processing : dict.orders.riderAssignment}
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {/* Customer Review (CX12b) */}
                {review && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
                      {dict.orders.customerReview2}</span>
                    <div className="text-base text-amber-500 font-bold">
                      {"★★★★★".slice(0, review.rating ?? 5)}
                      <span className="ml-2 text-xs text-slate-700">({review.rating}{dict.orders.text2nm5}</span>
                    </div>
                    {review.comment && (
                      <p className="text-xs text-slate-700 font-medium italic">“{review.comment}”</p>
                    )}
                    <div className="text-[10px] text-slate-400">
                      {review.receivedAt
                        ? fmtDateTime(locale, new Date(review.receivedAt))
                        : dict.orders.pending}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
