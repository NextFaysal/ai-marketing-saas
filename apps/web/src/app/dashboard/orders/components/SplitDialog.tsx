"use client";
import React from "react";
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
  return (
    <>
      {/* ON3: split dialog — movable lines take a quantity,
          bundle groups move whole, gift lines never move. The
          figures here are indicative; the server computes the
          final split. */}
      {splitOpen && actOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="অর্ডার Split">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">✂️ অর্ডার Split — #{actOrder.externalNumber ?? actOrder.id.slice(0, 8)}</h2>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setSplitOpen(false)}>বন্ধ করুন</button>
            </div>
            <p className="mt-1 text-xs text-slate-500">যে আইটেমগুলো নতুন অর্ডারে যাবে তা বেছে নিন। আনুমানিক — চূড়ান্ত হিসাব সার্ভারে হবে।</p>
            {splitError ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{splitError}</p> : null}
            {splitNotice ? (
              <div className="mt-3 space-y-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <p>{splitNotice}</p>
                {splitCreated ? (
                  <button type="button" className="font-semibold underline" onClick={() => { const id = splitCreated.id; setSplitOpen(false); void openOrderById(id); }}>
                    নতুন অর্ডার {splitCreated.label} খুলুন →
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="mt-4 space-y-2">
                  {(actOrder.items ?? []).filter((it) => !it.bundleId && !it.isGift).map((it) => (
                    <div key={it.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-medium">{it.name}</span>
                      <span className="text-xs text-slate-400">মোট {it.quantity}টি</span>
                      <span className="ml-auto inline-flex items-center gap-1.5 text-xs">
                        নতুন অর্ডারে যাবে:
                        <input className="input w-20 text-center" type="number" min={0} max={it.quantity}
                          value={splitQty[it.id] ?? "0"}
                          onChange={(e) => setSplitQty((prev) => ({ ...prev, [it.id]: e.target.value }))} />
                        টি
                      </span>
                    </div>
                  ))}
                  {[...new Set((actOrder.items ?? []).filter((it) => it.bundleId).map((it) => it.bundleId as string))].map((bid) => {
                    const comps = (actOrder.items ?? []).filter((it) => it.bundleId === bid);
                    return (
                      <div key={bid} className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm ring-1 ring-amber-200">
                        <label className="flex flex-wrap items-center gap-2 font-medium text-amber-900">
                          <input type="checkbox" checked={splitBundles.includes(bid)}
                            onChange={(e) => setSplitBundles((prev) => (e.target.checked ? [...prev, bid] : prev.filter((x) => x !== bid)))} />
                          🎁 বান্ডল: {comps[0]?.bundleName ?? "বান্ডল"} — পুরো গ্রুপ একসাথে যাবে
                        </label>
                        {comps.map((c) => <p key={c.id} className="pl-6 text-xs text-slate-600">• {c.name} × {c.quantity}</p>)}
                      </div>
                    );
                  })}
                  {(actOrder.items ?? []).filter((it) => it.isGift).map((it) => (
                    <p key={it.id} className="rounded-lg bg-pink-50 px-3 py-2 text-xs text-pink-800">🎁 উপহার: {it.name} × {it.quantity} — উপহার লাইন Split-এ সরানো যায় না, মূল অর্ডারেই থাকবে।</p>
                  ))}
                </div>
                <label className="mt-4 block text-sm font-medium">নতুন অর্ডারের ডেলিভারি চার্জ (৳)
                  <input className="input mt-1 w-40" inputMode="decimal" value={splitDeliveryTaka} onChange={(e) => setSplitDeliveryTaka(e.target.value)} />
                </label>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="btn-primary btn-sm" disabled={splitBusy} onClick={() => void doSplit()}>
                    {splitBusy ? "Split হচ্ছে…" : "Split নিশ্চিত করুন"}
                  </button>
                  <button type="button" className="btn-ghost btn-sm" disabled={splitBusy} onClick={() => setSplitOpen(false)}>বাতিল</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
