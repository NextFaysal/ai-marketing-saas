"use client";
import React from "react";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { COD_CALL_OUTCOMES, codCallOutcomeLabel } from "@/lib/orders-on4";
import type { PanelOrder } from "./types";

/** ON4: COD confirmation-call chip row. Renders the "কল করেছি:"
 * outcome buttons (small, so the dense table stays intact) plus
 * the recorded attempt history when there is any. The parent
 * decides WHERE it shows (needs_confirmation rows / the detail
 * panel for awaiting COD orders); this only renders the row. */
export function CodCallChips({ order, busy, onCall }: {
  order: PanelOrder;
  busy: boolean;
  onCall: (order: PanelOrder, outcome: string) => void;
}) {
  const { dict, t, locale } = useLocale();
  const attempts = order.codCallAttempts ?? 0;
  return (
    <span className="mt-1.5 block space-y-1">
      <span className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] font-semibold text-slate-500">{dict.orders.called}</span>
        {COD_CALL_OUTCOMES.map((oc) => (
          <button key={oc.key} type="button" disabled={busy}
            className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => onCall(order, oc.key)}>
            {oc.label}
          </button>
        ))}
        {busy ? <span className="text-[11px] text-slate-400">{dict.orders.recording}</span> : null}
      </span>
      {attempts > 0 ? (
        <span className="block text-[11px] text-slate-500">
          {dict.orders.call}{attempts}{dict.orders.times}{order.codLastCallOutcome ? t("orders.last", { codCallOutcomeLabel: codCallOutcomeLabel(order.codLastCallOutcome, locale) }) : ""}
          {order.codLastCallAt ? ` · ${fmtDateTime(locale, new Date(order.codLastCallAt))}` : ""}
        </span>
      ) : null}
    </span>
  );
}
