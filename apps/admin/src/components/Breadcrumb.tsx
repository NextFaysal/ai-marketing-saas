"use client";
// ADX3: Breadcrumb — wired into the org and user detail pages.
// Labels come only from data the page already loaded; callers fall
// back to a short id when a name is unavailable (never invented).
import React from "react";
import { NavIcon } from "./nav";

export interface Crumb { label: string; href?: string }

export default function Breadcrumb({ items, className = "" }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="breadcrumb" className={`flex flex-wrap items-center gap-1.5 text-sm text-slate-400 ${className}`}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 ? <span className="text-slate-600"><NavIcon name="chevron" size={12} /></span> : null}
            {item.href && !last ? (
              <a href={item.href} className="transition hover:text-indigo-300">{item.label}</a>
            ) : (
              <span aria-current={last ? "page" : undefined} className={last ? "font-medium text-slate-200" : ""}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
