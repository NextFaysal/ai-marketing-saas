"use client";
// ADX3: Attention Bell — the operator's "what needs me" total in the
// topbar. Renders NOTHING when nav-counts failed or returned no
// fields (unknown is not "all clear"). When every count was really
// returned and all are 0, the dropdown honestly says so.
import React from "react";
import { NavIcon, type NavCounts } from "./nav";
import { presentCounts } from "./useNavCounts";
import { useAdminLocale } from "./AdminLocale";
import { fmtNumber } from "@repo/contracts";

const ROWS: Record<keyof NavCounts, { labelKey: string; href: string }> = {
  pendingPayouts: { labelKey: "bell.pendingPayouts", href: "/payouts" },
  openTickets: { labelKey: "bell.openTickets", href: "/tickets" },
  failedJobs24h: { labelKey: "bell.failedJobs", href: "/health" },
  activeAlerts: { labelKey: "bell.activeAlerts", href: "/alerts" },
  overdueSubscriptions: { labelKey: "bell.overdueSubscriptions", href: "/billing" },
};

export default function AttentionBell({ counts }: { counts: NavCounts | null }) {
  const { dict, locale, t } = useAdminLocale();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const present = presentCounts(counts);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open ]);

  if (present.length === 0) return null; // unknown — render nothing, claim nothing
  const total = present.reduce((s, [, v]) => s + v, 0);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={total > 0 ? t("bell.attentionNeeded", { count: fmtNumber(locale, total) }) : dict.bell.todoList}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="abtn-secondary relative !px-2.5"
      >
        <NavIcon name="bell" size={17} />
        {total > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{fmtNumber(locale, total)}</span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="border-b border-slate-800 px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{dict.bell.todayTodo}</div>
          {total === 0 ? (
            <p className="px-3.5 py-3 text-sm text-slate-300">{dict.bell.nothingTodo}</p>
          ) : (
            <ul>
              {present.filter(([, v]) => v > 0).map(([k, v]) => (
                <li key={k}>
                  <a href={ROWS[k].href} className="flex items-center gap-2 px-3.5 py-2.5 text-sm text-slate-200 transition hover:bg-slate-800" onClick={() => setOpen(false)}>
                    <span className="truncate">{t(ROWS[k].labelKey)}</span>
                    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500/90 px-1.5 text-[11px] font-bold text-white">{fmtNumber(locale, v)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
