"use client";
// ADX4 (Design System v3) — shared page patterns for the admin
// console. Pure presentational components on top of globals.css
// v3 classes; no data fetching, no invented state. Pages adopt
// these one by one (DB2: overview/users/orgs/billing/payouts;
// DB3: the rest). Legacy v2 classes keep working everywhere.
import React from "react";
import { fmtNumber } from "@repo/contracts";
import { getAdminDict, resolveAdminLocale } from "@/lib/i18n";
import { useAdminLocale } from "./AdminLocale";

// ---------------------------------------------------------------- PageHead
export function PageHead({ title, sub, breadcrumb, children }: { title?: string; sub?: string; breadcrumb?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="apage-head">
      <div className="apage-head-main">
        {breadcrumb ?? null}
        {title ? <div className="apage-head-title">{title}</div> : null}
        {sub ? <div className="apage-head-sub">{sub}</div> : null}
      </div>
      {children ? <div className="apage-head-actions">{children}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- FilterBar
/**
 * ADX12: with `collapsible`, narrow screens get a "ফিল্টার" toggle
 * and the controls start hidden (they would otherwise stack into a
 * very tall block above the table); on `sm:` and up the children lay
 * out exactly as before via `sm:contents`. Default (no prop) is the
 * original always-visible bar — existing usages are unchanged.
 */
export function FilterBar({ children, className = "", collapsible = false, activeCount = 0 }: { children: React.ReactNode; className?: string; collapsible?: boolean; activeCount?: number }) {
  const { dict, locale } = useAdminLocale();
  const [open, setOpen] = React.useState(false);
  if (!collapsible) return <div className={`afilter ${className}`}>{children}</div>;
  return (
    <div className={`afilter ${className}`}>
      <button
        type="button"
        className="abtn-secondary !px-2.5 !py-1.5 text-xs sm:hidden"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        🔎 {dict.ui.filter} {activeCount > 0 ? <span className="abadge-count">{fmtNumber(locale, activeCount)}</span> : null} {open ? "▲" : "▼"}
      </button>
      <div className={`${open ? "flex" : "hidden"} flex-col gap-2 sm:contents`}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Tabs
export interface TabDef { id: string; label: string; badge?: number }
export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  const { locale } = useAdminLocale();
  return (
    <div className="atabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={`atab ${active === t.id ? "atab-active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {typeof t.badge === "number" && t.badge > 0 ? <span className="abadge-count">{fmtNumber(locale, t.badge)}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- DetailDrawer
/** Right-side quick-view drawer. ESC closes, scrim click closes,
 *  and focus lands on the close button on open (operator-console
 *  grade focus handling; full focus-trap is an ADX12 polish item). */
export function DetailDrawer({ open, title, sub, onClose, children, footer }: {
  open: boolean; title: string; sub?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const { dict } = useAdminLocale();
  const closeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!open) return;
    // ADNX17: return focus to the invoking element on close
    // (previously focus was lost to <body>).
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="adrawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="adrawer-detail" role="dialog" aria-modal="true" aria-label={title}>
        <div className="adrawer-head">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{title}</div>
            {sub ? <div className="truncate text-xs text-slate-400">{sub}</div> : null}
          </div>
          <button ref={closeRef} type="button" className="abtn-secondary !px-2.5" aria-label={dict.common.close} onClick={onClose}>✕</button>
        </div>
        <div className="adrawer-body">{children}</div>
        {footer ? <div className="adrawer-foot">{footer}</div> : null}
      </aside>
    </>
  );
}

// ---------------------------------------------------------------- States
export function EmptyState({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="aempty">
      <div className="aempty-title">{title}</div>
      {sub ? <div className="aempty-sub">{sub}</div> : null}
      {children}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { dict } = useAdminLocale();
  return (
    <div className="aerror" role="alert">
      <span>{message}</span>
      {onRetry ? <button type="button" className="abtn-secondary ml-3 !px-2 !py-1 text-xs" onClick={onRetry}>{dict.common.retry}</button> : null}
    </div>
  );
}

// ---------------------------------------------------------------- SavedViews (ADX14)
/**
 * ADX14 saved views: the current filter/search combination of a
 * list page, named and re-appliable later. localStorage only,
 * keyed per page (`admin_saved_views_<page>`); the state shape is
 * the page's OWN existing filter state (Record<string,string>) —
 * no new filter semantics. Every read/write is guarded: blocked
 * or corrupt storage degrades to "no saved views", never an error.
 */
export interface SavedView { name: string; state: Record<string, string> }

const savedViewsKey = (page: string) => `admin_saved_views_${page}`;

export function loadSavedViews(page: string): SavedView[] {
  try {
    const v = JSON.parse(localStorage.getItem(savedViewsKey(page)) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && typeof x.name === "string" && x.state && typeof x.state === "object")
      .map((x) => ({
        name: x.name as string,
        state: Object.fromEntries(Object.entries(x.state as Record<string, unknown>).filter(([, val]) => typeof val === "string")) as Record<string, string>,
      }));
  } catch { return []; }
}

export function storeSavedViews(page: string, views: SavedView[]) {
  try { localStorage.setItem(savedViewsKey(page), JSON.stringify(views)); } catch { /* private mode etc. */ }
}

export function SavedViewsBar({ page, current, onApply }: {
  page: string;
  current: Record<string, string>;
  onApply: (state: Record<string, string>) => void;
}) {
  const { dict, t } = useAdminLocale();
  const [views, setViews] = React.useState<SavedView[]>([]);
  const [name, setName] = React.useState("");
  React.useEffect(() => { setViews(loadSavedViews(page)); }, [page]);
  function save() {
    const n = name.trim();
    if (!n) return;
    setViews((prev) => {
      const next = [...prev.filter((v) => v.name !== n), { name: n, state: { ...current } }];
      storeSavedViews(page, next);
      return next;
    });
    setName("");
  }
  function remove(n: string) {
    setViews((prev) => {
      const next = prev.filter((v) => v.name !== n);
      storeSavedViews(page, next);
      return next;
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{dict.ui.savedView}</span>
      {views.map((v) => (
        <span key={v.name} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 py-0.5 pl-2.5 pr-1 text-xs text-slate-200">
          <button type="button" className="hover:text-white" title={dict.ui.savedViewApplyTitle} onClick={() => onApply(v.state)}>{v.name}</button>
          <button type="button" className="rounded-full px-1 text-slate-400 hover:text-red-300" aria-label={t("ui.savedViewDelete", { name: v.name })} onClick={() => remove(v.name)}>✕</button>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <input className="ainput !w-36 !py-1 text-xs" placeholder={dict.ui.savedViewNamePlaceholder} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        <button type="button" className="abtn-secondary !px-2 !py-1 text-xs" disabled={!name.trim()} onClick={save}>{dict.ui.savedViewSave}</button>
      </span>
      {views.length === 0 ? <span className="text-[11px] text-slate-400">{dict.ui.savedViewHint}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Last-used filters (ADNX15)
/**
 * ADNX15: last-used filter persistence — the companion to saved
 * views above. A list page's CURRENT filter state is stored on
 * every change (`admin_last_filters_<page>`, same guarded
 * localStorage pattern as saved views) and restored once on
 * mount, so an operator who returns to a page finds the filters
 * they last used. Applying a saved view or clearing the filters
 * simply overwrites the stored state on the next change — there
 * is one source of truth (the page's own filter state) and no
 * new filter semantics. Blocked/corrupt storage degrades to the
 * page's defaults, never an error.
 */
const lastFiltersKey = (page: string) => `admin_last_filters_${page}`;

export function loadLastFilters(page: string): Record<string, string> | null {
  try {
    const v = JSON.parse(localStorage.getItem(lastFiltersKey(page)) ?? "null");
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, val]) => typeof val === "string")) as Record<string, string>;
  } catch { return null; }
}

export function storeLastFilters(page: string, state: Record<string, string>) {
  try { localStorage.setItem(lastFiltersKey(page), JSON.stringify(state)); } catch { /* private mode etc. */ }
}

export function useLastFilters(page: string, current: Record<string, string>, onApply: (state: Record<string, string>) => void) {
  const [ready, setReady] = React.useState(false);
  const applyRef = React.useRef(onApply);
  applyRef.current = onApply;
  React.useEffect(() => {
    const stored = loadLastFilters(page);
    if (stored) applyRef.current(stored);
    setReady(true);
    // Restore runs once per page mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
  const currentJson = JSON.stringify(current);
  React.useEffect(() => {
    if (ready) storeLastFilters(page, JSON.parse(currentJson) as Record<string, string>);
  }, [page, ready, currentJson]);
}

// ---------------------------------------------------------------- DataTable v3 (ADNX2)
/**
 * ADNX2 DataTable v3 — the one table pattern for list pages.
 * Wraps the table in .atable-wrap (its own horizontal scroll
 * container, never page-level) and applies:
 *  - .atable-cards (mobile card form) unless cards={false} — card
 *    form only works when every cell carries a data-label equal
 *    to its column header; adopting pages add those labels.
 *  - .atable-sticky (sticky header) unless sticky={false};
 *    SortableTh drops in as a normal child of the thead row.
 *  - .atable-v3 marker for v4 card alignment tweaks.
 * Density is inherited from the shell's data-admin-density.
 * `empty` renders after the table (the page's EmptyState) so a
 * zero-row table and its empty state are one pattern.
 */
export function DataTable({ children, cards = true, sticky = true, className = "", empty }: {
  children: React.ReactNode; cards?: boolean; sticky?: boolean; className?: string; empty?: React.ReactNode;
}) {
  const cls = ["atable", "atable-v3", cards ? "atable-cards" : "", sticky ? "atable-sticky" : "", className].filter(Boolean).join(" ");
  return (
    <>
      <div className="atable-wrap">
        <table className={cls}>{children}</table>
      </div>
      {empty ?? null}
    </>
  );
}

// ---------------------------------------------------------------- SortableTh
export type SortDir = "asc" | "desc";
export function SortableTh({ label, sortKey, current, dir, onSort, className = "" }: {
  label: string; sortKey: string; current: string; dir: SortDir; onSort: (key: string) => void; className?: string;
}) {
  const active = current === sortKey;
  return (
    <th className={`ath ${className}`}>
      <button type="button" className="ath-sort" onClick={() => onSort(sortKey)} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
        {label}
        <span className="ath-sort-ind">{active ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

// ---------------------------------------------------------------- ConfirmModal
/**
 * The modal for reason-required and destructive actions (the
 * ADNX3 replacement for browser dialogs across the console).
 * Contract: a reason of ≥3 chars is mandatory when
 * `inputRequired` — e.g. audit-logged actions — and the modal
 * itself blocks submission until the input is valid.
 */
export function ConfirmModal({ open, title, description, inputLabel, inputPlaceholder, inputRequired = false, inputOptional = false, initialValue = "", confirmLabel, cancelLabel, danger = false, busy = false, onCancel, onConfirm }: {
  open: boolean;
  title: string;
  description?: string;
  /** When set, a text input is shown (note / reference / reason). */
  inputLabel?: string;
  inputPlaceholder?: string;
  /** Input must be ≥3 chars (the reason contract). */
  inputRequired?: boolean;
  /** Input may be left empty (e.g. an optional approval note). */
  inputOptional?: boolean;
  /** Pre-filled input value (ADNX3, e.g. a default tier). */
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const { dict } = useAdminLocale();
  const confirmText = confirmLabel ?? dict.common.confirm;
  const cancelText = cancelLabel ?? dict.common.cancel;
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!open) return;
    setValue(initialValue); setError("");
    // ADNX17: focus always lands inside the dialog — the input
    // when one exists, otherwise the confirm button (previously
    // a no-input modal left focus on the page behind it) — and
    // focus returns to the invoking element on close/unmount.
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
      else confirmRef.current?.focus();
    }, 30);
    return () => {
      clearTimeout(t);
      if (prev && document.contains(prev)) prev.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  const showInput = Boolean(inputLabel);
  function submit() {
    const v = value.trim();
    if (showInput && inputRequired && v.length < 3) { setError(dict.common.reasonMinError); return; }
    onConfirm(v);
  }
  return (
    <>
      <div className="adrawer-scrim" onClick={onCancel} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
        <div className="acard w-full max-w-md !bg-slate-900">
          <div className="font-semibold">{title}</div>
          {description ? <p className="mt-1.5 text-sm text-slate-400">{description}</p> : null}
          {showInput ? (
            <label className="mt-3 block text-sm">{inputLabel}{inputOptional ? <span className="text-slate-400"> ({dict.common.optional})</span> : null}
              <input ref={inputRef} className="ainput mt-1" value={value} placeholder={inputPlaceholder} onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
            </label>
          ) : null}
          {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="abtn-secondary" onClick={onCancel} disabled={busy}>{cancelText}</button>
            <button ref={confirmRef} type="button" className={danger ? "abtn-danger" : "abtn"} onClick={submit} disabled={busy}>{busy ? dict.common.busy : confirmText}</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Chart (ADNX5)
/**
 * ADNX5: the ONE lightweight chart for the console — hand-rolled
 * SVG, NO chart dependency (owner decision, plan §১১/৪). Two
 * variants: "bar" (vertical columns) and "line" (polyline +
 * points). Values come only from data the caller already loaded;
 * the component never fetches or invents.
 * - Hover/tap (and keyboard focus) on a bar/point selects it and
 *   the readout line under the chart shows its EXACT value,
 *   formatted by the caller's formatValue; each mark also carries
 *   a native <title> tooltip.
 * - Colours come from the v4 tokens (--a-status-info for the
 *   series, --a-status-warning for the selected mark).
 * - Accessible fallback: the "ডেটা টেবিল" toggle renders the same
 *   numbers as a real table (DataTable card pattern), and the SVG
 *   itself is role="img" with a summary label — screen-reader and
 *   small-screen users are never dependent on the drawing.
 */
export interface ChartPoint { label: string; value: number }

export function Chart({ variant = "bar", points, formatValue, seriesLabel, defaultShowTable = false }: {
  variant?: "bar" | "line";
  points: ChartPoint[];
  formatValue: (v: number) => string;
  seriesLabel: string;
  /** ADNX17: initial state of the data-table fallback (default
   *  false = exactly the pre-ADNX17 behaviour; exists so tests
   *  can render the fallback table directly). */
  defaultShowTable?: boolean;
}) {
  const { dict, locale, t } = useAdminLocale();
  const [active, setActive] = React.useState<number | null>(null);
  const [showTable, setShowTable] = React.useState(defaultShowTable);
  if (points.length === 0) return <EmptyState title={dict.ui.chartEmpty} />;
  const W = 640, H = 240, PADX = 10, TOP = 18, BOTTOM = 30;
  const innerW = W - PADX * 2, innerH = H - TOP - BOTTOM;
  const max = Math.max(0, ...points.map((p) => p.value));
  const slot = innerW / points.length;
  const x = (i: number) => PADX + slot * i + slot / 2;
  const y = (v: number) => TOP + innerH - (max > 0 ? (v / max) * innerH : 0);
  const activeIdx = active ?? points.length - 1;
  const ap = points[activeIdx];
  const linePts = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={t("ui.chartAria", { label: seriesLabel, count: fmtNumber(locale, points.length) })}
        onMouseLeave={() => setActive(null)}>
        <line x1={PADX} y1={TOP + innerH} x2={W - PADX} y2={TOP + innerH} stroke="#334155" strokeWidth="1" />
        {variant === "line" && points.length > 1 ? (
          <polyline points={linePts} fill="none" stroke="var(--a-status-info)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ) : null}
        {points.map((p, i) => variant === "bar" ? (
          <g key={p.label}>
            <rect
              x={x(i) - Math.min(48, slot * 0.6) / 2} y={y(p.value)}
              width={Math.min(48, slot * 0.6)} height={Math.max(0, TOP + innerH - y(p.value))}
              rx="4" tabIndex={0} role="button" aria-label={`${p.label}: ${formatValue(p.value)}`}
              fill={i === activeIdx ? "var(--a-status-warning)" : "var(--a-status-info)"}
              className="cursor-pointer outline-none focus-visible:opacity-80 hover:opacity-80"
              onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} onFocus={() => setActive(i)}
            ><title>{`${p.label}: ${formatValue(p.value)}`}</title></rect>
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#94a3b8">{p.label}</text>
          </g>
        ) : (
          <g key={p.label}>
            <circle
              cx={x(i)} cy={y(p.value)} r={i === activeIdx ? 5.5 : 4} tabIndex={0} role="button"
              aria-label={`${p.label}: ${formatValue(p.value)}`}
              fill={i === activeIdx ? "var(--a-status-warning)" : "var(--a-status-info)"}
              className="cursor-pointer outline-none hover:opacity-80"
              onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} onFocus={() => setActive(i)}
            ><title>{`${p.label}: ${formatValue(p.value)}`}</title></circle>
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#94a3b8">{p.label}</text>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
        <span className="font-medium text-slate-200">{ap.label}: {formatValue(ap.value)}</span>
        <span className="text-slate-400">{dict.ui.chartHint}</span>
        <button type="button" className="abtn-secondary ml-auto !px-2 !py-1 text-xs" aria-expanded={showTable} onClick={() => setShowTable((s) => !s)}>
          {showTable ? dict.ui.chartHideTable : dict.ui.chartShowTable}
        </button>
      </div>
      {showTable ? (
        <div className="mt-2">
          <DataTable>
            <thead><tr><th className="ath">{seriesLabel}</th><th className="ath">{dict.ui.chartValueHeader}</th></tr></thead>
            <tbody>{points.map((p) => (
              <tr key={p.label} className="border-t border-slate-800">
                <td data-label={seriesLabel} className="atd">{p.label}</td>
                <td data-label={dict.ui.chartValueHeader} className="atd">{formatValue(p.value)}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Toast (ADNX3)
/**
 * ADNX3: the ONE toast system for the console. A tiny module-level
 * store (same pattern as the dialog store below) so any page can
 * call `toast(...)` without prop drilling; <ToastHost/> is mounted
 * once by AdminShell. Auto-dismisses after 6s; an optional action
 * button (e.g. retry) runs the caller's own callback — the toast
 * itself never invents behaviour. Pages that already show inline
 * result banners keep them; toast is the pattern for NEW feedback
 * and for the feedback that used to ride browser dialogs.
 */
export type ToastKind = "success" | "error" | "info";
export interface ToastItem { id: number; kind: ToastKind; message: string; actionLabel?: string; onAction?: () => void }

let toastSeq = 0;
let toastItems: ToastItem[] = [];
const toastListeners = new Set<(items: ToastItem[]) => void>();
function emitToasts() { for (const l of toastListeners) l([...toastItems]); }

export function dismissToast(id: number) {
  toastItems = toastItems.filter((t) => t.id !== id);
  emitToasts();
}

export function toast(message: string, kind: ToastKind = "success", action?: { label: string; run: () => void }): number {
  const id = ++toastSeq;
  toastItems = [...toastItems, { id, kind, message, actionLabel: action?.label, onAction: action?.run }];
  emitToasts();
  setTimeout(() => dismissToast(id), 6000);
  return id;
}

/** Hook form of the same single implementation. */
export function useToast() { return toast; }

export function ToastHost() {
  const { dict } = useAdminLocale();
  // ADNX17: initialise from the store's current snapshot so a host
  // mounted after a toast was pushed still shows it (the shell
  // mounts the host once, before any toast, so live behaviour is
  // unchanged; this also makes the store honestly testable).
  const [items, setItems] = React.useState<ToastItem[]>(() => [...toastItems]);
  React.useEffect(() => {
    const l = (v: ToastItem[]) => setItems(v);
    toastListeners.add(l);
    return () => { toastListeners.delete(l); };
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="atoast-wrap" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`atoast atoast-${t.kind}`} role="status">
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.actionLabel ? (
            <button type="button" className="atoast-action" onClick={() => { t.onAction?.(); dismissToast(t.id); }}>{t.actionLabel}</button>
          ) : null}
          <button type="button" className="atoast-action" aria-label={dict.common.close} onClick={() => dismissToast(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Global dialogs (ADNX3)
/**
 * ADNX3: promise-based modal dialogs over the ONE ConfirmModal
 * above, mounted once by AdminShell as <DialogHost/>. They replace
 * every browser dialog in the console:
 *   askConfirm(...) → Promise<boolean>  (dismiss = false; callers
 *     that must distinguish "chose the negative option" from
 *     "aborted" use explicit button labels — see billing refund)
 *   askInput(...)   → Promise<string|null> (null = cancelled; with
 *     inputRequired the modal blocks until ≥3 chars, so a returned
 *     string is always valid — the old "short reason, then an
 *     error popup" step no longer exists)
 *   askReason(action) → Promise<string|null> — the audit-reason
 *     dialog: same wording contract as before ("কারণ লিখুন (Audit
 *     এ থাকবে)"), rendered as a modal instead of a browser prompt.
 * One dialog at a time: callers await each before opening the
 * next (the converted flows already do — they were sequential
 * browser dialogs before).
 */
interface DialogRequest {
  title: string; description?: string;
  inputLabel?: string; inputPlaceholder?: string; inputRequired?: boolean; inputOptional?: boolean; initialValue?: string;
  confirmLabel: string; cancelLabel?: string; danger?: boolean;
  resolve: (v: string | boolean | null) => void;
}
let dialogCurrent: DialogRequest | null = null;
const dialogListeners = new Set<(d: DialogRequest | null) => void>();
function emitDialog() { for (const l of dialogListeners) l(dialogCurrent); }

function openDialog(req: Omit<DialogRequest, "resolve">): Promise<string | boolean | null> {
  return new Promise((resolve) => { dialogCurrent = { ...req, resolve }; emitDialog(); });
}

export function askConfirm(opts: { title: string; description?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }): Promise<boolean> {
  return openDialog({ title: opts.title, description: opts.description, confirmLabel: opts.confirmLabel ?? getAdminDict(resolveAdminLocale()).common.confirm, cancelLabel: opts.cancelLabel, danger: opts.danger })
    .then((v) => v === true);
}

export function askInput(opts: { title: string; description?: string; inputLabel: string; inputPlaceholder?: string; inputRequired?: boolean; inputOptional?: boolean; initialValue?: string; confirmLabel?: string; danger?: boolean }): Promise<string | null> {
  return openDialog({ ...opts, confirmLabel: opts.confirmLabel ?? getAdminDict(resolveAdminLocale()).common.confirm })
    .then((v) => (typeof v === "string" ? v : null));
}

export function askReason(action: string): Promise<string | null> {
  const dict = getAdminDict(resolveAdminLocale());
  return askInput({
    title: action,
    description: dict.common.reasonAuditNote,
    inputLabel: dict.common.reason,
    inputRequired: true,
    confirmLabel: dict.common.proceed,
  });
}

export function DialogHost() {
  const [req, setReq] = React.useState<DialogRequest | null>(null);
  React.useEffect(() => {
    const l = (d: DialogRequest | null) => setReq(d);
    dialogListeners.add(l);
    return () => { dialogListeners.delete(l); };
  }, []);
  if (!req) return null;
  const finish = (v: string | boolean | null) => { dialogCurrent = null; emitDialog(); req.resolve(v); };
  return (
    <ConfirmModal
      open
      title={req.title}
      description={req.description}
      inputLabel={req.inputLabel}
      inputPlaceholder={req.inputPlaceholder}
      inputRequired={req.inputRequired}
      inputOptional={req.inputOptional}
      initialValue={req.initialValue}
      confirmLabel={req.confirmLabel}
      cancelLabel={req.cancelLabel}
      danger={req.danger}
      onCancel={() => finish(req.inputLabel ? null : false)}
      onConfirm={(v) => finish(req.inputLabel ? v : true)}
    />
  );
}
