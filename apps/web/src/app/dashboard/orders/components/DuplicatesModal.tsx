"use client";
import React from "react";
import { formatMinor } from "@repo/contracts";

interface DuplicatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  duplicateData: {
    totalGroups: number;
    totalDuplicateOrders: number;
    groups: any[];
  } | null;
  mergeBusy: string;
  onMergeGroup: (primaryOrderId: string, duplicateOrderIds: string[]) => void;
}

export function DuplicatesModal({
  isOpen,
  onClose,
  duplicateData,
  mergeBusy,
  onMergeGroup,
}: DuplicatesModalProps) {
  if (!isOpen || !duplicateData) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs animate-fade">
      <div className="w-full max-w-2xl max-h-[85vh] rounded-3xl bg-white p-6 shadow-2xl flex flex-col overflow-hidden animate-rise space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              ⚠️ ডুপ্লিকেট অর্ডার শনাক্ত ও ১-ক্লিক মার্জ হাব
            </h3>
            <p className="text-xs text-slate-500">
              একই কাস্টমার কর্তৃক একাধিকবার সাবমিট করা অর্ডার মার্জ করুন, যাতে ডাবল পার্সেল ডেলিভারি ও রিটার্ন ক্ষতি বন্ধ হয়।
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {/* Groups List */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {duplicateData.groups.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">কোনো সক্রিয় ডুপ্লিকেট অর্ডার নেই।</p>
          ) : (
            duplicateData.groups.map((group: any, idx: number) => {
              const primaryOrder = group.orders[0];
              const otherOrderIds = group.orders.slice(1).map((o: any) => o.id);

              return (
                <div
                  key={idx}
                  className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-slate-900 text-xs">{group.customerName}</span>
                      <span className="ml-2 font-mono text-[11px] text-slate-500">📱 {group.phoneKey}</span>
                      <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                        {group.count}টি অর্ডার
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={mergeBusy === primaryOrder.id}
                      onClick={() => onMergeGroup(primaryOrder.id, otherOrderIds)}
                      className="rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                    >
                      {mergeBusy === primaryOrder.id
                        ? "মার্জ হচ্ছে..."
                        : `সবগুলো #${primaryOrder.externalNumber ?? primaryOrder.id.slice(0, 8)}-এ মার্জ করুন`}
                    </button>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.orders.map((ord: any) => (
                      <div
                        key={ord.id}
                        className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-2xs"
                      >
                        <div className="flex items-center justify-between font-semibold">
                          <span>#{ord.externalNumber ?? ord.id.slice(0, 8)}</span>
                          <span className="text-indigo-600 font-bold">
                            {formatMinor(BigInt(ord.totalAmountMinor))}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {new Date(ord.placedAt).toLocaleString("bn-BD")}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-600 line-clamp-1">
                          আইটেম: {ord.items.map((i: any) => `${i.name} ×${i.quantity}`).join(", ")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
