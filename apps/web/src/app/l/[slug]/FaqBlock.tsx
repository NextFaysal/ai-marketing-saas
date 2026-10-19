"use client";
import React, { useState } from "react";
import { pubT } from "@/lib/i18n/public";

/**
 * ED6 (EB2) — the landing page FAQ accordion, extracted verbatim
 * from LandingClient and loaded via next/dynamic (SSR kept: it is
 * meaningful below-fold content, so the server still renders it —
 * only its JS chunk leaves the route's first load). Behaviour is
 * identical to the in-file version it replaces: first item open by
 * default, click toggles, empty list renders nothing.
 */
export function FaqBlock({ items, locale }: { items: { q: string; a: string }[]; locale?: string }) {
  const t = pubT(locale);
  const [open, setOpen] = useState(0);
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-black text-slate-900">{t.landingPage.faqHeading}</h2>

      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setOpen(open === i ? -1 : i)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-bold text-slate-800"
            >
              <span>{it.q}</span>
              <span className="text-slate-400">{open === i ? "−" : "+"}</span>
            </button>
            {open === i ? <p className="whitespace-pre-line px-4 pb-4 text-sm leading-relaxed text-slate-600">{it.a}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
