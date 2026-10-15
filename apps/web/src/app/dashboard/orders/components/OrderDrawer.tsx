"use client";
import React, { useState } from "react";
import { formatMinor } from "@repo/contracts";
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
  if (!order) return null;

  const refunded = BigInt(order.refundedMinor ?? "0");
  const totalAmt = BigInt(order.totalMinor);
  const sh = shipments.find((s) => s.orderId === order.id);

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
                    অর্ডার #{order.externalNumber ?? order.id.slice(0, 8)}
                  </span>
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">
                    {order.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  কাস্টমার: {[order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(" ") || "—"} ·{" "}
                  {order.customer?.phone ?? order.customer?.email ?? "—"}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-400 shadow-sm transition hover:bg-slate-100 hover:text-slate-700 active:scale-95"
              >
                ✕
              </button>
            </div>

            {/* 2. Navigation Tabs */}
            <div className="mt-4 flex items-center gap-2 overflow-x-auto text-xs scrollbar-none">
              <button
                type="button"
                onClick={() => onTabChange("overview")}
                className={`rounded-xl px-3 py-1.5 font-semibold transition ${
                  activeTab === "overview"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                📋 ওভারভিউ ও স্ট্যাটাস
              </button>
              <button
                type="button"
                onClick={() => onTabChange("courier")}
                className={`rounded-xl px-3 py-1.5 font-semibold transition ${
                  activeTab === "courier"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                🚚 কুরিয়ার বুকিং
              </button>
              <button
                type="button"
                onClick={() => onTabChange("payment")}
                className={`rounded-xl px-3 py-1.5 font-semibold transition ${
                  activeTab === "payment"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                💳 পেমেন্ট ও কিস্তি
              </button>
              <button
                type="button"
                onClick={() => onTabChange("store")}
                className={`rounded-xl px-3 py-1.5 font-semibold transition ${
                  activeTab === "store"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                🏬 স্টোর সিঙ্ক
              </button>
              <button
                type="button"
                onClick={() => onTabChange("rider")}
                className={`rounded-xl px-3 py-1.5 font-semibold transition ${
                  activeTab === "rider"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                🛵 রাইডার ফ্লিট
              </button>
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
                      অর্ডার স্ট্যাটাস আপডেট
                    </span>
                    <span className="text-xs font-semibold text-indigo-600">বর্তমান: {order.status}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={actStatus}
                      onChange={(e) => onActStatusChange(e.target.value)}
                    >
                      {!PATCH_STATUSES.includes(order.status) && (
                        <option value={order.status}>{order.status} (বর্তমান)</option>
                      )}
                      {PATCH_STATUSES.map((s) => (
                        <option key={s} value={s} disabled={!transitionAllowed(order.status, s)}>
                          {s} {s === order.status ? "(বর্তমান)" : ""}{" "}
                          {!transitionAllowed(order.status, s) ? "— যাওয়া যাবে না" : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={actBusy !== "" || actStatus === order.status}
                      onClick={onSaveStatus}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {actBusy === "save" ? "সংরক্ষণ হচ্ছে..." : "স্ট্যাটাস পরিবর্তন"}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Cancelled/Failed হলে স্টক ফেরত হয়; Completed হলে order.delivered ইভেন্ট পুশ হয়।
                  </p>
                </div>

                {/* Ordered Items */}
                <div className="rounded-2xl border border-slate-200/80 p-4 space-y-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    অর্ডারের আইটেমসমূহ
                  </span>
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
                                🎁 উপহার
                              </span>
                            )}
                            {it.bundleName && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-800">
                                বান্ডল: {it.bundleName}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="font-bold text-slate-900">
                          {it.isGift
                            ? "৳০"
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
                      <span>🎁 গিফট র‍্যাপ ফি</span>
                      <span>{formatMinor(BigInt(order.giftWrapMinor))}</span>
                    </div>
                  )}

                  {order.giftMessage && (
                    <div className="rounded-xl border border-pink-200 bg-pink-50/70 p-3 text-xs font-semibold text-pink-900">
                      🎁 গিফট বার্তা: “{order.giftMessage}”
                    </div>
                  )}

                  <div className="flex justify-between border-t border-slate-100 pt-3 text-sm font-bold text-slate-900">
                    <span>সর্বমোট</span>
                    <span>{formatMinor(BigInt(order.totalMinor))}</span>
                  </div>
                </div>

                {/* Refund Record */}
                <div className="rounded-2xl border border-slate-200/80 p-4 space-y-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    টাকা রিফান্ড রেকর্ড
                  </span>
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>মোট ফেরত: {formatMinor(refunded)}</span>
                    <span className="font-semibold text-slate-900">
                      আরও ফেরতযোগ্য: {formatMinor(totalAmt - refunded)}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="পরিমাণ (টাকায়, যেমন: 250 বা 250.50)"
                      value={actRefundTaka}
                      onChange={(e) => onActRefundTakaChange(e.target.value)}
                    />
                    <input
                      type="text"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="কারণ (ঐচ্ছিক)"
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
                    রিফান্ড রেকর্ড করুন
                  </button>
                </div>

                {/* Internal Team Note */}
                <div className="rounded-2xl border border-slate-200/80 p-4 space-y-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    টিম ইন্টারনাল নোট (গোপনীয়)
                  </span>
                  <textarea
                    rows={2}
                    className="w-full rounded-xl border border-slate-200 p-3 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="যেমন: কাস্টমার ফোনে ঠিকানা বদলেছেন বা বিশেষ ডেলিভারি নির্দেশনা..."
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
                      নোট সংরক্ষণ
                    </button>
                    <button
                      type="button"
                      disabled={actBusy !== ""}
                      onClick={onClearNote}
                      className="rounded-xl px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      মুছুন
                    </button>
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
                    🧾 ইনভয়েস PDF
                  </button>
                  <a
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                    href={`/dashboard/commerce/print?orderId=${order.id}&kind=invoice`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    🖨️ ইনভয়েস প্রিন্ট
                  </a>
                  <a
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                    href={`/dashboard/commerce/print?orderId=${order.id}&kind=slip`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    🏷️ প্যাকিং স্লিপ প্রিন্ট
                  </a>
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
                        সক্রিয় পার্সেল ট্র্যাকিং
                      </span>
                      <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-bold text-white">
                        {sh.status}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-slate-800">
                      কুরিয়ার: {sh.provider} · ট্র্যাকিং: {sh.trackingCode ?? "অপেক্ষমাণ"}
                    </div>
                    {sh.trackingUrl && (
                      <a
                        href={sh.trackingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block text-xs font-semibold text-indigo-600 hover:underline"
                      >
                        🔗 লাইভ ট্র্যাকিং পেজ দেখুন ↗
                      </a>
                    )}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        type="button"
                        disabled={courierBusy !== ""}
                        onClick={() => onSyncShipment(sh.id)}
                        className="rounded-xl bg-white border border-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50"
                      >
                        {courierBusy === "sync" ? "যাচাই হচ্ছে..." : "স্ট্যাটাস যাচাই"}
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
                        🏷️ লেবেল ডাউনলোড
                      </button>
                    </div>
                  </div>
                )}

                {/* Booking Form */}
                <div className="rounded-2xl border border-slate-200/80 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      নতুন পার্সেল বুকিং
                    </span>
                    {bookSuggestion?.ruleId && (
                      <span className="rounded-lg bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                        সাজেশন: {bookSuggestion.ruleName}
                      </span>
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="text-[11px] font-medium text-slate-500">কুরিয়ার প্রোভাইডার</label>
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
                              {connected ? "" : " (যুক্ত নেই)"}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-slate-500">ওজন (কেজি)</label>
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
                      <label className="text-[11px] font-medium text-slate-500">প্রাপকের নাম</label>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={bookForm.name}
                        onChange={(e) => onBookFormChange({ ...bookForm, name: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-slate-500">ফোন নম্বর</label>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={bookForm.phone}
                        onChange={(e) => onBookFormChange({ ...bookForm, phone: e.target.value })}
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-[11px] font-medium text-slate-500">
                        পূর্ণ ডেলিভারি ঠিকানা (বাসা, রোড, থানা, জেলা)
                      </label>
                      <input
                        type="text"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="কমপক্ষে ৮ অক্ষর আবশ্যক"
                        value={bookForm.address}
                        onChange={(e) => onBookFormChange({ ...bookForm, address: e.target.value })}
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-[11px] font-medium text-slate-500">নোট (ঐচ্ছিক)</label>
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
                          <label className="text-[11px] font-medium text-slate-500">Pathao পিকআপ স্টোর</label>
                          <select
                            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                            value={bookForm.pStoreId}
                            onChange={(e) => onBookFormChange({ ...bookForm, pStoreId: e.target.value })}
                          >
                            <option value="">স্বয়ংক্রিয় (প্রথম সক্রিয়)</option>
                            {pStores.map((s: any) => (
                              <option key={s.store_id} value={s.store_id}>
                                {s.store_name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-slate-500">শহর (City)</label>
                          <select
                            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                            value={bookForm.pCityId}
                            onChange={(e) => onCityChange(e.target.value)}
                          >
                            <option value="">ঠিকানা থেকে অনুমান (ঐচ্ছিক)</option>
                            {pCities.map((c: any) => (
                              <option key={c.city_id} value={c.city_id}>
                                {c.city_name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-slate-500">জোন (Zone)</label>
                          <select
                            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                            value={bookForm.pZoneId}
                            onChange={(e) => onZoneChange(e.target.value)}
                          >
                            <option value="">জোন (ঐচ্ছিক)</option>
                            {pZones.map((z: any) => (
                              <option key={z.zone_id} value={z.zone_id}>
                                {z.zone_name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-slate-500">এলাকা (Area)</label>
                          <select
                            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
                            value={bookForm.pAreaId}
                            onChange={(e) => onBookFormChange({ ...bookForm, pAreaId: e.target.value })}
                          >
                            <option value="">এলাকা (ঐচ্ছিক)</option>
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
                          RedX ডেলিভারি এলাকা (আবশ্যক)
                        </label>
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
                          <option value="">ডেলিভারি এলাকা বেছে নিন</option>
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
                      {quoteBusy ? "হিসাব হচ্ছে..." : "💰 ডেলিভারি চার্জ যাচাই"}
                    </button>

                    {quoteOut && (
                      <div className="text-xs font-semibold">
                        {quoteOut.quotable ? (
                          <span className="text-emerald-700">
                            আনুমানিক চার্জ: {formatMinor(BigInt(quoteOut.chargeMinor ?? 0))}
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
                        ? "বুক হচ্ছে..."
                        : `${
                            bookForm.provider === "pathao"
                              ? "Pathao"
                              : bookForm.provider === "redx"
                                ? "RedX"
                                : "Steadfast"
                          } এ বুক করুন`}
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
                    <span className="text-[11px] font-semibold text-slate-500">মোট মূল্য</span>
                    <div className="mt-1 text-base font-bold text-slate-900">
                      {formatMinor(BigInt(order.totalMinor))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
                    <span className="text-[11px] font-semibold text-slate-500">অগ্রিম পরিশোধ</span>
                    <div className="mt-1 text-base font-bold text-emerald-700">
                      {order.advancePaidMinor !== undefined
                        ? formatMinor(BigInt(order.advancePaidMinor))
                        : "৳০.০০"}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 col-span-2 sm:col-span-1">
                    <span className="text-[11px] font-semibold text-slate-500">বকেয়া (Amount Due)</span>
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
                    অগ্রিম পেমেন্ট রেকর্ড করুন
                  </span>
                  {advError && <p className="text-xs text-red-600">{advError}</p>}
                  {advNotice && <p className="text-xs text-emerald-700">{advNotice}</p>}

                  <div className="grid gap-2 sm:grid-cols-4">
                    <input
                      type="text"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                      placeholder="পরিমাণ (টাকা)"
                      value={advAmount}
                      onChange={(e) => onAdvAmountChange(e.target.value)}
                    />
                    <select
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                      value={advMethod}
                      onChange={(e) => onAdvMethodChange(e.target.value)}
                    >
                      <option value="bkash">বিকাশ</option>
                      <option value="nagad">নগদ</option>
                      <option value="rocket">রকেট</option>
                      <option value="cash">ক্যাশ</option>
                      <option value="bank">ব্যাংক</option>
                      <option value="other">অন্যান্য</option>
                    </select>
                    <input
                      type="text"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                      placeholder="TrxID / রেফারেন্স"
                      value={advRef}
                      onChange={(e) => onAdvRefChange(e.target.value)}
                    />
                    <input
                      type="text"
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                      placeholder="নোট (ঐচ্ছিক)"
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
                    {advBusy ? "রেকর্ড হচ্ছে..." : "অগ্রিম রেকর্ড ও ভেরিফাই"}
                  </button>
                </div>

                {/* Payment Verifications List */}
                {(order.paymentVerifications ?? []).length > 0 && (
                  <div className="rounded-2xl border border-slate-200/80 p-4 space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      পেমেন্ট যাচাইয়ের ইতিহাস
                    </span>
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
                              {new Date(pv.createdAt).toLocaleString("bn-BD")}
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
                      💰 কিস্তি প্ল্যান (Installment)
                    </span>
                    {instPlan && (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                        {instPlan.status}
                      </span>
                    )}
                  </div>

                  {instError && <p className="text-xs text-red-600">{instError}</p>}

                  {!instLoaded ? (
                    <p className="text-xs text-slate-400">লোড হচ্ছে...</p>
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
                            বকেয়া {formatMinor(due)} কিস্তিতে ভাগ করার জন্য প্ল্যান তৈরি করুন:
                          </p>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <label className="text-[11px] text-slate-500">
                              কিস্তির সংখ্যা
                              <input
                                type="number"
                                min={2}
                                max={24}
                                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                                value={instCount}
                                onChange={(e) => onInstCountChange(e.target.value)}
                              />
                            </label>
                            <label className="text-[11px] text-slate-500">
                              ব্যবধান (দিন)
                              <input
                                type="number"
                                min={1}
                                max={90}
                                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
                                value={instInterval}
                                onChange={(e) => onInstIntervalChange(e.target.value)}
                              />
                            </label>
                            <label className="text-[11px] text-slate-500">
                              শুরুর তারিখ
                              <input
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
                            {instBusy === "create" ? "তৈরি হচ্ছে..." : "কিস্তি প্ল্যান তৈরি করুন"}
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400">এই অর্ডারে কোনো বকেয়া নেই।</p>
                      );
                    })()
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-3 text-xs">
                        <span>মোট: <b>{formatMinor(BigInt(instPlan.totalMinor))}</b></span>
                        <span className="text-emerald-700">পরিশোধ: <b>{formatMinor(BigInt(instPlan.paidMinor))}</b></span>
                        <span>বাকি: <b>{formatMinor(BigInt(instPlan.remainingMinor))}</b></span>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-slate-100 text-slate-400">
                            <tr>
                              <th className="py-1">ক্রম</th>
                              <th className="py-1">তারিখ</th>
                              <th className="py-1">পরিমাণ</th>
                              <th className="py-1">পরিশোধিত</th>
                              <th className="py-1">অবস্থা</th>
                              {instPlan.status === "active" && <th className="py-1">সংগ্রহ</th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {instPlan.items.map((item) => {
                              const remaining = (() => {
                                try {
                                  return BigInt(item.remainingMinor);
                                } catch {
                                  return 0n;
                                }
                              })();
                              const form = collectForms[item.id];
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
                                      {item.fullyPaid ? "সম্পূর্ণ" : item.overdue ? "অতিবাহিত" : "বাকি"}
                                    </span>
                                  </td>
                                  {instPlan.status === "active" && (
                                    <td className="py-2">
                                      {remaining > 0n && form ? (
                                        <div className="flex items-center gap-1">
                                          <input
                                            className="w-16 rounded border border-slate-200 px-1 py-0.5 text-xs"
                                            value={form.amount}
                                            onChange={(e) =>
                                              onCollectFormChange(item.id, "amount", e.target.value)
                                            }
                                          />
                                          <button
                                            type="button"
                                            disabled={instBusy !== ""}
                                            onClick={() => onCollectInstItem(item)}
                                            className="rounded bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-indigo-700"
                                          >
                                            কালেক্ট
                                          </button>
                                        </div>
                                      ) : (
                                        "—"
                                      )}
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {instPlan.status === "active" && (
                        <button
                          type="button"
                          disabled={instBusy !== ""}
                          onClick={onCancelInstPlan}
                          className="text-xs font-semibold text-rose-600 hover:underline"
                        >
                          কিস্তি প্ল্যান বাতিল করুন
                        </button>
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
                  <p className="text-xs text-red-600">লোড করা যায়নি: {pushStateError}</p>
                ) : !pushState ? (
                  <p className="text-xs text-slate-400">লোড হচ্ছে...</p>
                ) : !pushState.store ? (
                  <p className="text-xs text-slate-400">এই অর্ডারের কোনো সংযুক্ত স্টোর নেই</p>
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
                        সর্বশেষ Push অবস্থা: <b>{pushState.storeSyncStatus ?? "—"}</b>
                      </p>
                    </div>

                    {/* Customer note to store */}
                    <div className="rounded-2xl border border-slate-200/80 p-4 space-y-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        স্টোরে কাস্টমার-নোট পাঠান
                      </span>
                      <textarea
                        rows={2}
                        className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:ring-2 focus:ring-indigo-500"
                        placeholder="গ্রাহকের কাছে পাঠানোর জন্য নোট..."
                        value={storeNoteText}
                        onChange={(e) => onStoreNoteTextChange(e.target.value)}
                      />
                      <button
                        type="button"
                        disabled={syncBusy !== "" || !storeNoteText.trim()}
                        onClick={onSendStoreNote}
                        className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                      >
                        স্টোরে নোট পাঠান
                      </button>
                    </div>

                    {/* Return link generator */}
                    <div className="rounded-2xl border border-slate-200/80 p-4 space-y-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        কাস্টমার রিটার্ন লিংক
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={syncBusy !== ""}
                          onClick={onCreateReturnLink}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                        >
                          {syncBusy === "return-link" ? "তৈরি হচ্ছে..." : "রিটার্ন লিংক তৈরি করুন"}
                        </button>
                        {returnUrl && (
                          <button
                            type="button"
                            onClick={() => onCopyText("return", returnUrl)}
                            className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
                          >
                            {copiedKey === "return" ? "কপি হয়েছে ✓" : "লিংক কপি করুন"}
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
                    🛵 নিজস্ব রাইডার অ্যাসাইনমেন্ট
                  </span>

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
                              তোলা হয়েছে
                            </button>
                          )}
                          {active.status === "picked_up" && (
                            <>
                              <button
                                type="button"
                                disabled={riderBusy !== ""}
                                onClick={() => onTransitionAssignment(active, "delivered")}
                                className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                              >
                                ডেলিভারি সম্পন্ন
                              </button>
                              <button
                                type="button"
                                disabled={riderBusy !== ""}
                                onClick={() => onTransitionAssignment(active, "returned")}
                                className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white"
                              >
                                ফেরত
                              </button>
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
                          <option value="">রাইডার বেছে নিন</option>
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
                          {riderBusy === "assign" ? "হচ্ছে..." : "রাইডার বরাদ্দ"}
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {/* Customer Review (CX12b) */}
                {review && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-800">
                      ⭐ কাস্টমার রিভিউ
                    </span>
                    <div className="text-base text-amber-500 font-bold">
                      {"★★★★★".slice(0, review.rating ?? 5)}
                      <span className="ml-2 text-xs text-slate-700">({review.rating}/৫)</span>
                    </div>
                    {review.comment && (
                      <p className="text-xs text-slate-700 font-medium italic">“{review.comment}”</p>
                    )}
                    <div className="text-[10px] text-slate-400">
                      {review.receivedAt
                        ? new Date(review.receivedAt).toLocaleString("bn-BD")
                        : "অপেক্ষমাণ"}
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
