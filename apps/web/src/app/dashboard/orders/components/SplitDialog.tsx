"use client";
import React from "react";
import { useLocale } from "@/lib/i18n/provider";
import type { PanelOrder } from "./types";

export interface SplitDialogProps {
  splitOpen: boolean;
  actOrder: PanelOrder | null;
  splitError: string;
  splitNotice: string;
  splitCreated: { id: string; label: string } | null;
  splitQty: Record<string, string>;
  setSplitQty: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  splitBundles: string[];
  setSplitBundles: React.Dispatch<React.SetStateAction<string[]>>;
  splitDeliveryTaka: string;
  setSplitDeliveryTaka: React.Dispatch<React.SetStateAction<string>>;
  splitBusy: boolean;
  setSplitOpen: React.Dispatch<React.SetStateAction<boolean>>;
  doSplit: () => Promise<void>;
  openOrderById: (orderId: string) => Promise<void>;
}

export function SplitDialog({ splitOpen, actOrder, splitError, splitNotice, splitCreated, splitQty, setSplitQty, splitBundles, setSplitBundles, splitDeliveryTaka, setSplitDeliveryTaka, splitBusy, setSplitOpen, doSplit, openOrderById }: SplitDialogProps) {
  const { dict, t, locale } = useLocale();
  return (
    <>
      {/* ON3: split dialog — movable lines take a quantity,
          bundle groups move whole, gift lines never move. The
          figures here are indicative; the server computes the
          final split. */}
      {splitOpen && actOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={dict.orders.orderSplit}>
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{dict.orders.orderSplit2}{actOrder.externalNumber ?? actOrder.id.slice(0, 8)}</h2>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setSplitOpen(false)}>{dict.orders.close}</button>
            </div>
            <p className="mt-1 text-xs text-slate-500">{dict.orders.chooseTheItemsThatWill}</p>
            {splitError ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{splitError}</p> : null}
            {splitNotice ? (
              <div className="mt-3 space-y-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <p>{splitNotice}</p>
                {splitCreated ? (
                  <button type="button" className="font-semibold underline" onClick={() => { const id = splitCreated.id; setSplitOpen(false); void openOrderById(id); }}>
                    {dict.orders.newOrder}{splitCreated.label} {dict.orders.open2}</button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="mt-4 space-y-2">
                  {(actOrder.items ?? []).filter((it) => !it.bundleId && !it.isGift).map((it) => (
                    <div key={it.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-medium">{it.name}</span>
                      <span className="text-xs text-slate-400">{dict.orders.total}{it.quantity}{dict.orders.items}</span>
                      <span className="ml-auto inline-flex items-center gap-1.5 text-xs">
                        {dict.orders.willGoToTheNew}<input className="input w-20 text-center" type="number" min={0} max={it.quantity}
                          value={splitQty[it.id] ?? "0"}
                          onChange={(e) => setSplitQty((prev) => ({ ...prev, [it.id]: e.target.value }))} />
                        {dict.orders.items}</span>
                    </div>
                  ))}
                  {[...new Set((actOrder.items ?? []).filter((it) => it.bundleId).map((it) => it.bundleId as string))].map((bid) => {
                    const comps = (actOrder.items ?? []).filter((it) => it.bundleId === bid);
                    return (
                      <div key={bid} className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm ring-1 ring-amber-200">
                        <label className="flex flex-wrap items-center gap-2 font-medium text-amber-900">
                          <input type="checkbox" checked={splitBundles.includes(bid)}
                            onChange={(e) => setSplitBundles((prev) => (e.target.checked ? [...prev, bid] : prev.filter((x) => x !== bid)))} />
                          {dict.orders.bundle3}{comps[0]?.bundleName ?? dict.orders.bundle2} {dict.orders.theWholeGroupGoesTogether}</label>
                        {comps.map((c) => <p key={c.id} className="pl-6 text-xs text-slate-600">• {c.name} × {c.quantity}</p>)}
                      </div>
                    );
                  })}
                  {(actOrder.items ?? []).filter((it) => it.isGift).map((it) => (
                    <p key={it.id} className="rounded-lg bg-pink-50 px-3 py-2 text-xs text-pink-800">{dict.orders.gift2}{it.name} × {it.quantity} {dict.orders.theGiftLineCannotBe}</p>
                  ))}
                </div>
                <label className="mt-4 block text-sm font-medium">{dict.orders.newOrderSDeliveryCharge}<input className="input mt-1 w-40" inputMode="decimal" value={splitDeliveryTaka} onChange={(e) => setSplitDeliveryTaka(e.target.value)} />
                </label>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="btn-primary btn-sm" disabled={splitBusy} onClick={() => void doSplit()}>
                    {splitBusy ? dict.orders.splitting : dict.orders.confirmSplit}
                  </button>
                  <button type="button" className="btn-ghost btn-sm" disabled={splitBusy} onClick={() => setSplitOpen(false)}>{dict.common.cancel}</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
