"use client";
import React, { useState } from "react";
import Link from "next/link";
import { Drawer } from "@repo/ui/client";
import { SlidersHorizontal } from "lucide-react";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";

export interface ListingFilterLink {
  label: string;
  href: string;
  active: boolean;
}

export interface ListingFilterSection {
  heading: string;
  links: ListingFilterLink[];
}

/**
 * ED8 — listing v2 mobile filter drawer.
 *
 * A pure presentation shell: the server page precomputes every
 * link (label / href / active) with the same shopHref helper the
 * inline chips use, so applying a filter is exactly today's chip
 * behaviour — tap a link, the page reloads with the new params.
 * No data fetching, no filter state, no new navigation logic.
 * Rendered by the home page ONLY for the v2 theme; the trigger is
 * additionally lg:hidden (desktop keeps chips + SortSelect).
 */
export function ListingFilterDrawer({
  locale = "bn",
  activeCount,
  sections,
}: {
  locale?: ShopLocale | string;
  activeCount: number;
  sections: ListingFilterSection[];
}) {
  const t = shopT(locale);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-2.5 text-xs font-bold text-[var(--ink-body)] lg:hidden"
        aria-label={t.chrome.filter}
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
        {t.chrome.filter}
        {activeCount > 0 ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--brand)] px-1.5 text-[10px] font-bold text-white">
            {activeCount}
          </span>
        ) : null}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={t.chrome.filter} side="left">
        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.heading} className="space-y-2">
              <h3 className="text-xs font-black uppercase tracking-wide text-[var(--ink-muted)]">{section.heading}</h3>
              <ul className="space-y-1">
                {section.links.map((link) => (
                  <li key={`${section.heading}-${link.href}-${link.label}`}>
                    <Link
                      href={link.href}
                      onClick={() => setOpen(false)}
                      aria-current={link.active ? "true" : undefined}
                      className={`flex min-h-11 items-center rounded-xl px-3 py-2.5 text-sm font-semibold ${
                        link.active
                          ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                          : "text-[var(--ink-body)] hover:bg-[var(--surface-sunken)]"
                      }`}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Drawer>
    </>
  );
}
