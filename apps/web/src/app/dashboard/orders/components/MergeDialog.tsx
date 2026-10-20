"use client";
import React from "react";
import { useLocale } from "@/lib/i18n/provider";
import type { PanelOrder } from "./types";

export interface MergeDialogProps {
  mergeOpen: boolean;
  setMergeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  mergeError: string;
  items: PanelOrder[];
  selected: string[];
  mergeSurvivor: string;
  setMergeSurvivor: React.Dispatch<React.SetStateAction<string>>;
  fmtM: (minor?: string | null) => string;
  mergeBusy: boolean;
  doMerge: () => Promise<void>;
}

export function MergeDialog({ mergeOpen, setMergeOpen, mergeError, items, selected, mergeSurvivor, setMergeSurvivor, fmtM, mergeBusy, doMerge }: MergeDialogProps) {
  const { dict, t, locale } = useLocale();
  return (
    <>
      {/* ON3: bulk merge dialog — the survivor is picked by
          radio; the delivery-charge warning is shown BEFORE
          confirm, with the exact summed figure. */}
      {mergeOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={dict.orders.orderMerge}>
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{dict.orders.mergeOrders}</h2>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setMergeOpen(false)}>{dict.orders.close}</button>
            </div>
            <p className="mt-1 text-xs text-slate-500">{dict.orders.chooseWhichOrderStaysSurvivor2}</p>
            {mergeError ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{mergeError}</p> : null}
            <div className="mt-4 space-y-2">
              {items.filter((x) => selected.includes(x.id)).map((x) => (
                <label key={x.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <input type="radio" name="merge-survivor" checked={mergeSurvivor === x.id} onChange={() => setMergeSurvivor(x.id)} />
                  <span className="font-medium">#{x.externalNumber ?? x.id.slice(0, 8)}</span>
                  <span className="text-slate-600">{[x.customer?.firstName, x.customer?.lastName].filter(Boolean).join(" ") || "—"}</span>
                  <span className="ml-auto text-xs text-slate-500">{dict.orders.total}{fmtM(x.totalMinor)} {dict.orders.delivery2}{fmtM(x.shippingMinor ?? "0")}</span>
                  {mergeSurvivor === x.id ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700">Survivor</span> : null}
                </label>
              ))}
            </div>
            {(() => { const dropped = items.filter((x) => selected.includes(x.id) && x.id !== mergeSurvivor)
              .reduce((acc, x) => { try { return acc + BigInt(x.shippingMinor ?? "0"); } catch { return acc; } }, 0n); return (
              <div className="mt-4 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
                <p>{dict.orders.otherOrdersDeliveryChargesTotal}{fmtM(dropped.toString())}{dict.orders.willBeDroppedOnlyThe}</p>
                <p>{dict.orders.theMergedOrdersWillBe}</p>
              </div>
            ); })()}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-primary btn-sm" disabled={mergeBusy || !mergeSurvivor} onClick={() => void doMerge()}>
                {mergeBusy ? dict.orders.merging2 : dict.orders.confirmMerge}
              </button>
              <button type="button" className="btn-ghost btn-sm" disabled={mergeBusy} onClick={() => setMergeOpen(false)}>{dict.common.cancel}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
