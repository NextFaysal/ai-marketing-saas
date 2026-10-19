"use client";
import React from "react";
import { useLocale } from "@/lib/i18n/provider";
import { fmtDate, fmtDateTime, fmtNumber, formatMinor } from "@repo/contracts";
import type { Order, Shipment, CourierRule } from "./types";
import { RISK_LABEL } from "./types";

interface OrdersTableProps {
  orders: Order[];
  selected: string[];
  onToggleSelect: (orderId: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  shipments: Shipment[];
  courierRules: CourierRule[];
  courierConnected: boolean;
  courierBusy: string;
  onOpenOrderDrawer: (order: Order, defaultTab?: "overview" | "courier" | "payment" | "store") => void;
  onShowRisk: (order: Order) => void;
  onSyncShipment: (shipmentId: string) => void;
  onDownloadPdf: (path: string, filename: string) => void;
  orgId: string;
}

const STATUS_TONES: Record<string, { bg: string; text: string; dot: string }> = {
  pending: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  processing: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  "on-hold": { bg: "bg-purple-50", text: "text-purple-700", dot: "bg-purple-500" },
  completed: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  cancelled: { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500" },
  refunded: { bg: "bg-slate-100", text: "text-slate-700", dot: "bg-slate-500" },
  failed: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
  returned: { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" },
};

export function OrdersTable({
  orders,
  selected,
  onToggleSelect,
  onSelectAll,
  shipments,
  courierRules,
  courierConnected,
  courierBusy,
  onOpenOrderDrawer,
  onShowRisk,
  onSyncShipment,
  onDownloadPdf,
  orgId,
}: OrdersTableProps) {
  const { dict, t, locale } = useLocale();
  const shipmentFor = (orderId: string) => shipments.find((s) => s.orderId === orderId);

  const allSelected = orders.length > 0 && orders.every((o) => selected.includes(o.id));

  return (
    <div className="space-y-4">
      {/* 1. Desktop Table (Hidden on Mobile) */}
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm md:block">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  checked={allSelected}
                  onChange={(e) => onSelectAll(e.target.checked)}
                />
              </th>
              <th className="px-4 py-3">{dict.orders.orderIDDate}</th>
              <th className="px-4 py-3">{dict.orders.customer2}</th>
              <th className="px-4 py-3">{dict.orders.items5}</th>
              <th className="px-4 py-3">{dict.orders.statusRisk}</th>
              <th className="px-4 py-3">{dict.orders.paymentTotal}</th>
              <th className="px-4 py-3">{dict.orders.courierTracking}</th>
              <th className="px-4 py-3 text-right">{dict.orders.action}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => {
              const isChecked = selected.includes(o.id);
              const sh = shipmentFor(o.id);
              const statusTone = STATUS_TONES[o.status] ?? {
                bg: "bg-slate-50",
                text: "text-slate-700",
                dot: "bg-slate-400",
              };

              return (
                <tr
                  key={o.id}
                  className={`transition duration-150 hover:bg-slate-50/80 ${
                    isChecked ? "bg-indigo-50/30" : ""
                  }`}
                >
                  {/* Select Checkbox */}
                  <td className="px-4 py-3.5">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      checked={isChecked}
                      disabled={!isChecked && selected.length >= 50}
                      onChange={(e) => onToggleSelect(o.id, e.target.checked)}
                    />
                  </td>

                  {/* Order ID & Source */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5 font-bold text-slate-900">
                      <span>#{o.externalNumber ?? o.id.slice(0, 8)}</span>
                      {o.source && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-semibold text-slate-500 uppercase">
                          {o.source}
                        </span>
                      )}
                    </div>
                    {o.duplicate?.isDuplicate && (
                      <span
                        className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
                        title={t("orders.ordersOnTheSameNumber", { count: o.duplicate.count })}
                      >
                        {dict.orders.duplicate}{o.duplicate.count})
                      </span>
                    )}
                    <div className="mt-1 text-[11px] text-slate-400">
                      {o.placedAt ? fmtDateTime(locale, new Date(o.placedAt)) : "—"}
                    </div>
                    {o.deliverySlot && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                        🕐 {o.deliverySlot.label} · {o.deliverySlot.date}
                      </span>
                    )}
                    {o.deliveryMethod === "pickup" && o.pickupPoint && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        📍 {o.pickupPoint.name}
                      </span>
                    )}
                  </td>

                  {/* Customer */}
                  <td className="px-4 py-3.5">
                    <div className="font-semibold text-slate-900">
                      {[o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") || "—"}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {o.customer?.phone ?? o.customer?.email ?? "—"}
                    </div>
                  </td>

                  {/* Items */}
                  <td className="max-w-[200px] px-4 py-3.5">
                    <div className="line-clamp-2 text-slate-700">
                      {o.items?.map((i) => `${i.name} ×${i.quantity}`).join(", ") || "—"}
                    </div>
                    {o.giftWrapMinor && Number(o.giftWrapMinor) > 0 && (
                      <span className="mt-1 inline-block rounded bg-pink-50 px-1.5 py-0.2 text-[10px] font-medium text-pink-700">
                        {dict.orders.giftWrap}</span>
                    )}
                  </td>

                  {/* Status & Risk */}
                  <td className="px-4 py-3.5">
                    <div className="flex flex-col items-start gap-1">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${statusTone.bg} ${statusTone.text}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${statusTone.dot}`} />
                        <span>{o.status}</span>
                      </span>

                      {o.risk && (
                        <button
                          type="button"
                          onClick={() => onShowRisk(o)}
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold border ${
                            RISK_LABEL[o.risk.band as keyof typeof RISK_LABEL]?.cls ?? "bg-slate-50 text-slate-600"
                          } ${RISK_LABEL[o.risk.band as keyof typeof RISK_LABEL]?.borderCls ?? "border-slate-200"}`}
                          title={dict.orders.clickToSeeTheRisk}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              RISK_LABEL[o.risk.band as keyof typeof RISK_LABEL]?.dotCls ?? "bg-slate-400"
                            }`}
                          />
                          <span>{RISK_LABEL[o.risk.band as keyof typeof RISK_LABEL] ? dict.orders[RISK_LABEL[o.risk.band as keyof typeof RISK_LABEL]!.textKey] : dict.orders.risk}</span>
                          {o.risk.score !== null && <span>({o.risk.score}%)</span>}
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Payment & Total */}
                  <td className="px-4 py-3.5">
                    <div className="font-bold text-slate-900">{formatMinor(BigInt(o.totalMinor))}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-[11px]">
                      {o.isCod ? (
                        <span className="font-semibold text-amber-600">💵 COD</span>
                      ) : (
                        <span className="text-slate-500">{o.paymentMethod ?? "Prepaid"}</span>
                      )}
                    </div>
                    {o.advancePaidMinor !== undefined && Number(o.advancePaidMinor) > 0 && (
                      <div className="text-[10px] text-emerald-700 font-medium">
                        {dict.orders.advance}{formatMinor(BigInt(o.advancePaidMinor))}
                      </div>
                    )}
                  </td>

                  {/* Courier & Tracking */}
                  <td className="px-4 py-3.5">
                    {sh ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                            🚚 {sh.provider} ({sh.status})
                          </span>
                        </div>
                        {sh.trackingCode && (
                          <div className="font-mono text-[10px] text-slate-500">
                            {sh.trackingUrl ? (
                              <a
                                href={sh.trackingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-indigo-600 hover:underline"
                              >
                                {sh.trackingCode} ↗
                              </a>
                            ) : (
                              sh.trackingCode
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2 pt-0.5 text-[10px]">
                          <button
                            type="button"
                            disabled={courierBusy !== ""}
                            onClick={() => onSyncShipment(sh.id)}
                            className="font-semibold text-indigo-600 hover:underline"
                          >
                            {dict.orders.verify}</button>
                          <span>·</span>
                          <button
                            type="button"
                            onClick={() =>
                              onDownloadPdf(
                                `/organizations/${orgId}/courier/shipments/${sh.id}/label.pdf`,
                                `label-${sh.trackingCode ?? sh.id}.pdf`
                              )
                            }
                            className="font-semibold text-slate-700 hover:underline"
                          >
                            {dict.orders.label}</button>
                        </div>
                      </div>
                    ) : courierConnected ? (
                      <button
                        type="button"
                        onClick={() => onOpenOrderDrawer(o, "courier")}
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/80 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100 active:scale-95"
                      >
                        <span>⚡</span> {dict.orders.bookParcel}</button>
                    ) : (
                      <span className="text-[11px] text-slate-400">{dict.orders.noCourierLinked}</span>
                    )}
                  </td>

                  {/* Right Actions */}
                  <td className="px-4 py-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenOrderDrawer(o, "overview")}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 active:scale-95"
                    >
                      <span>{dict.orders.details}</span>
                      <span>→</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 2. Mobile Responsive Cards (Hidden on Desktop) */}
      <div className="space-y-3 md:hidden">
        {orders.map((o) => {
          const isChecked = selected.includes(o.id);
          const sh = shipmentFor(o.id);
          const statusTone = STATUS_TONES[o.status] ?? {
            bg: "bg-slate-50",
            text: "text-slate-700",
            dot: "bg-slate-400",
          };

          return (
            <div
              key={o.id}
              className={`rounded-2xl border p-4 shadow-sm transition ${
                isChecked
                  ? "border-indigo-300 bg-indigo-50/40"
                  : "border-slate-200/90 bg-white"
              }`}
            >
              {/* Card Header */}
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    checked={isChecked}
                    disabled={!isChecked && selected.length >= 50}
                    onChange={(e) => onToggleSelect(o.id, e.target.checked)}
                  />
                  <div>
                    <span className="text-sm font-bold text-slate-900">
                      #{o.externalNumber ?? o.id.slice(0, 8)}
                    </span>
                    <div className="text-[10px] text-slate-400">
                      {o.placedAt ? fmtDate(locale, new Date(o.placedAt)) : "—"}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${statusTone.bg} ${statusTone.text}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${statusTone.dot}`} />
                    <span>{o.status}</span>
                  </span>
                  <span className="text-sm font-bold text-slate-900">
                    {formatMinor(BigInt(o.totalMinor))}
                  </span>
                </div>
              </div>

              {/* Customer Info */}
              <div className="mt-2.5 flex items-center justify-between text-xs">
                <div>
                  <div className="font-semibold text-slate-900">
                    {[o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") || "—"}
                  </div>
                  {o.customer?.phone && (
                    <a
                      href={`tel:${o.customer.phone}`}
                      className="text-[11px] font-mono text-indigo-600 hover:underline"
                    >
                      📞 {o.customer.phone}
                    </a>
                  )}
                </div>

                <div className="text-right">
                  {o.isCod ? (
                    <span className="font-semibold text-amber-600 text-[11px]">💵 COD</span>
                  ) : (
                    <span className="text-slate-500 text-[11px]">{o.paymentMethod ?? "Prepaid"}</span>
                  )}
                </div>
              </div>

              {/* Items summary */}
              <div className="mt-2 text-xs text-slate-600 line-clamp-1">
                {dict.orders.items3}{o.items?.map((i) => `${i.name} ×${i.quantity}`).join(", ") || "—"}
              </div>

              {/* Logistics & Action Buttons */}
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
                <div>
                  {sh ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                      🚚 {sh.provider} ({sh.status})
                    </span>
                  ) : courierConnected ? (
                    <button
                      type="button"
                      onClick={() => onOpenOrderDrawer(o, "courier")}
                      className="text-[11px] font-semibold text-indigo-600 hover:underline"
                    >
                      {dict.orders.book}</button>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => onOpenOrderDrawer(o, "overview")}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
                >
                  <span>{dict.orders.detailsActions}</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
