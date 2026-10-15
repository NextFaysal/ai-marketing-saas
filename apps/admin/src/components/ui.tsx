"use client";
// ADX4 (Design System v3) — shared page patterns for the admin
// console. Pure presentational components on top of globals.css
// v3 classes; no data fetching, no invented state. Pages adopt
// these one by one (DB2: overview/users/orgs/billing/payouts;
// DB3: the rest). Legacy v2 classes keep working everywhere.
import React from "react";

// ---------------------------------------------------------------- PageHead
export function PageHead({ title, sub, children }: { title?: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="apage-head">
      <div className="apage-head-main">
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
export function FilterBar({ children, className = "", collapsible = false }: { children: React.ReactNode; className?: string; collapsible?: boolean }) {
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
        🔎 ফিল্টার {open ? "▲" : "▼"}
      </button>
      <div className={`${open ? "flex" : "hidden"} flex-col gap-2 sm:contents`}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Tabs
export interface TabDef { id: string; label: string; badge?: number }
export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
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
          {typeof t.badge === "number" && t.badge > 0 ? <span className="abadge-count">{t.badge}</span> : null}
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
  const closeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="adrawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="adrawer-detail" role="dialog" aria-modal="true" aria-label={title}>
        <div className="adrawer-head">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{title}</div>
            {sub ? <div className="truncate text-xs text-slate-500">{sub}</div> : null}
          </div>
          <button ref={closeRef} type="button" className="abtn-secondary !px-2.5" aria-label="বন্ধ করুন" onClick={onClose}>✕</button>
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
  return (
    <div className="aerror" role="alert">
      <span>{message}</span>
      {onRetry ? <button type="button" className="abtn-secondary ml-3 !px-2 !py-1 text-xs" onClick={onRetry}>আবার চেষ্টা করুন</button> : null}
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

function storeSavedViews(page: string, views: SavedView[]) {
  try { localStorage.setItem(savedViewsKey(page), JSON.stringify(views)); } catch { /* private mode etc. */ }
}

export function SavedViewsBar({ page, current, onApply }: {
  page: string;
  current: Record<string, string>;
  onApply: (state: Record<string, string>) => void;
}) {
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
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Saved View</span>
      {views.map((v) => (
        <span key={v.name} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 py-0.5 pl-2.5 pr-1 text-xs text-slate-200">
          <button type="button" className="hover:text-white" title="এই View প্রয়োগ করুন" onClick={() => onApply(v.state)}>{v.name}</button>
          <button type="button" className="rounded-full px-1 text-slate-500 hover:text-red-300" aria-label={`${v.name} মুছুন`} onClick={() => remove(v.name)}>✕</button>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <input className="ainput !w-36 !py-1 text-xs" placeholder="নতুন View-এর নাম" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        <button type="button" className="abtn-secondary !px-2 !py-1 text-xs" disabled={!name.trim()} onClick={save}>বর্তমান ফিল্টার সেভ করুন</button>
      </span>
      {views.length === 0 ? <span className="text-[11px] text-slate-600">বর্তমান ফিল্টার অবস্থা নাম দিয়ে সেভ করে পরে এক চাপে ফেরত আনুন।</span> : null}
    </div>
  );
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
export function ConfirmModal({ open, title, description, inputLabel, inputPlaceholder, inputRequired = false, inputOptional = false, initialValue = "", confirmLabel = "নিশ্চিত করুন", cancelLabel = "বাতিল", danger = false, busy = false, onCancel, onConfirm }: {
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
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (open) { setValue(initialValue); setError(""); setTimeout(() => inputRef.current?.focus(), 30); }
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
    if (showInput && inputRequired && v.length < 3) { setError("কমপক্ষে ৩ অক্ষর লিখুন — এটি Audit-এ থাকবে।"); return; }
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
            <label className="mt-3 block text-sm">{inputLabel}{inputOptional ? <span className="text-slate-500"> (ঐচ্ছিক)</span> : null}
              <input ref={inputRef} className="ainput mt-1" value={value} placeholder={inputPlaceholder} onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
            </label>
          ) : null}
          {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="abtn-secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
            <button type="button" className={danger ? "abtn-danger" : "abtn"} onClick={submit} disabled={busy}>{busy ? "হচ্ছে…" : confirmLabel}</button>
          </div>
        </div>
      </div>
    </>
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

export function toast(message: string, kind: ToastKind = "success", action?: { label: string; run: () => void }) {
  const id = ++toastSeq;
  toastItems = [...toastItems, { id, kind, message, actionLabel: action?.label, onAction: action?.run }];
  emitToasts();
  setTimeout(() => dismissToast(id), 6000);
}

/** Hook form of the same single implementation. */
export function useToast() { return toast; }

export function ToastHost() {
  const [items, setItems] = React.useState<ToastItem[]>([]);
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
          <button type="button" className="atoast-action" aria-label="বন্ধ করুন" onClick={() => dismissToast(t.id)}>✕</button>
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
  return openDialog({ title: opts.title, description: opts.description, confirmLabel: opts.confirmLabel ?? "নিশ্চিত করুন", cancelLabel: opts.cancelLabel, danger: opts.danger })
    .then((v) => v === true);
}

export function askInput(opts: { title: string; description?: string; inputLabel: string; inputPlaceholder?: string; inputRequired?: boolean; inputOptional?: boolean; initialValue?: string; confirmLabel?: string; danger?: boolean }): Promise<string | null> {
  return openDialog({ ...opts, confirmLabel: opts.confirmLabel ?? "নিশ্চিত করুন" })
    .then((v) => (typeof v === "string" ? v : null));
}

export function askReason(action: string): Promise<string | null> {
  return askInput({
    title: action,
    description: "এই কাজের কারণ লিখুন (Audit এ থাকবে):",
    inputLabel: "কারণ",
    inputRequired: true,
    confirmLabel: "এগিয়ে যান",
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
