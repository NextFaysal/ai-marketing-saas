"use client";
import React, { useState } from "react";
import type { ShopBundle } from "@/lib/storefront-server";
import { fetchCart, patchBundleLine } from "@/lib/storefront-cart";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { priceText } from "./ProductCard";

/**
 * EC29 — bundle card for the shop home strip. One click adds ONE
 * bundle unit (the cart page adjusts quantity afterwards). Prices
 * are the server's bundle payload values — nothing is computed
 * client-side except the savings badge visibility.
 */
export function BundleCard({
  orgSlug,
  bundle,
  locale = "bn",
}: {
  orgSlug: string;
  bundle: ShopBundle;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");
  // AB5 (AX8): per-slot picks (slotId -> chosen productIds).
  // A slotted bundle can only be added when EVERY slot is
  // satisfied exactly (chooseQty picks, no duplicates).
  const slots = bundle.slots ?? [];
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const slotSatisfied = (slotId: string | null, chooseQty: number) =>
    !!slotId && (picks[slotId]?.length ?? 0) === chooseQty;
  const allSlotsSatisfied = slots.every((s) => slotSatisfied(s.id, s.chooseQty));

  function togglePick(slotId: string | null, chooseQty: number, productId: string) {
    if (!slotId) return;
    setAdded(false);
    setPicks((cur) => {
      const chosen = cur[slotId] ?? [];
      if (chosen.includes(productId)) {
        return { ...cur, [slotId]: chosen.filter((x) => x !== productId) };
      }
      if (chosen.length >= chooseQty) return cur; // slot full — deselect first
      return { ...cur, [slotId]: [...chosen, productId] };
    });
  }

  const savings = (() => {
    if (!bundle.savingsMinor) return null;
    try {
      return BigInt(bundle.savingsMinor) > 0n ? bundle.savingsMinor : null;
    } catch {
      return null;
    }
  })();

  async function add() {
    setBusy(true);
    setError("");
    setAdded(false);
    try {
      // POST cart/bundle sets the line's quantity — read the
      // current cart first so repeated clicks add up, mirroring
      // the product detail page's merge behaviour.
      const cart = await fetchCart(orgSlug);
      const existing = (cart?.bundleItems ?? []).find((i) => i.bundleId === bundle.id);
      await patchBundleLine(orgSlug, {
        bundleId: bundle.id,
        quantity: Math.min(99, (existing?.quantity ?? 0) + 1),
        // AB5 (AX8): slotted bundles send the buyer's picks;
        // slotless bundles send no picks field at all (unchanged).
        ...(slots.length > 0
          ? { picks: slots.flatMap((s) => (picks[s.id ?? ""] ?? []).map((productId) => ({ slotId: s.id as string, productId }))) }
          : {}),
      });
      setAdded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.product.addToCartError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm">
      <div className="relative">
        {bundle.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bundle.imageUrl} alt={bundle.name} className="aspect-[4/3] w-full object-cover" />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-amber-50 text-5xl">🎁</div>
        )}
        {savings ? (
          <span className="absolute left-3 top-3 rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white">
            {t.home.bundleSavingsPrefix} {priceText(savings)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col space-y-2 p-4">
        <h3 className="text-sm font-bold text-slate-900">{bundle.name}</h3>
        {bundle.description ? <p className="line-clamp-2 text-xs text-slate-500">{bundle.description}</p> : null}
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-700">{t.home.bundleContents}</summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            {bundle.components.map((c) => (
              <li key={`${c.productId}-${c.variantSku ?? ""}`}>
                {c.name}{c.variantSku ? ` (${c.variantSku})` : ""} × {c.qty}
              </li>
            ))}
          </ul>
        </details>
        {/* AB5 (AX8): slot pickers — one grid per slot; a pick
            toggles, capped at the slot's chooseQty. */}
        {slots.length > 0 ? (
          <div className="space-y-3">
            {slots.map((slot) => {
              const chosen = slot.id ? (picks[slot.id] ?? []) : [];
              return (
                <div key={slot.id ?? slot.label} className="space-y-1.5">
                  <p className="text-xs font-bold text-slate-800">
                    {slot.label} — {slot.chooseQty}টি বেছে নিন
                    <span className={`ml-1 font-semibold ${slotSatisfied(slot.id, slot.chooseQty) ? "text-emerald-600" : "text-slate-400"}`}>
                      ({chosen.length}/{slot.chooseQty})
                    </span>
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {slot.options.map((o) => {
                      const on = chosen.includes(o.productId);
                      return (
                        <button
                          key={o.productId}
                          type="button"
                          aria-pressed={on}
                          onClick={() => togglePick(slot.id, slot.chooseQty, o.productId)}
                          className={`overflow-hidden rounded-lg border text-left transition ${on ? "border-indigo-600 ring-2 ring-indigo-300" : "border-slate-200 hover:border-slate-300"}`}
                        >
                          {o.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={o.imageUrl} alt={o.name ?? ""} className="aspect-square w-full object-cover" />
                          ) : (
                            <span className="flex aspect-square w-full items-center justify-center bg-slate-50 text-xl">📦</span>
                          )}
                          <span className={`block truncate px-1.5 py-1 text-[10px] font-semibold ${on ? "bg-indigo-600 text-white" : "text-slate-700"}`}>
                            {on ? "✓ " : ""}{o.name ?? o.productId}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {slot.options.length === 0 ? (
                    <p className="text-[11px] text-slate-400">এই স্লটে এখন বেছে নেওয়ার মতো পণ্য নেই।</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="mt-auto space-y-2 pt-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-extrabold text-indigo-700">{priceText(bundle.bundlePriceMinor)}</span>
            <span className="text-xs text-slate-400">
              {t.home.bundleRegularLabel} <span className="line-through">{priceText(bundle.regularTotalMinor)}</span>
            </span>
          </div>
          {error ? <p className="rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700">{error}</p> : null}
          {slots.length > 0 && !allSlotsSatisfied ? (
            <p className="text-[11px] font-medium text-slate-500">কার্টে যোগ করতে প্রতিটি স্লট থেকে ঠিক নির্দিষ্ট সংখ্যক পণ্য বেছে নিন।</p>
          ) : null}
          <button
            type="button"
            onClick={add}
            disabled={busy || (slots.length > 0 && !allSlotsSatisfied)}
            className="w-full rounded-xl bg-amber-500 py-2.5 text-sm font-extrabold text-white shadow hover:bg-amber-600 disabled:opacity-50"
          >
            {busy ? t.home.bundleAdding : added ? t.home.bundleAdded : t.home.bundleAddToCart}
          </button>
        </div>
      </div>
    </div>
  );
}
