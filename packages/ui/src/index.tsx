import React from "react";

/**
 * SkipLink (EB6/ED16): keyboard/AT shortcut past repeated navigation to
 * the main content. Server-safe plain anchor; the visually-hidden-until-
 * focus styling lives in globals.css under the `skip-link` class.
 */
export function SkipLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="skip-link">
      {children}
    </a>
  );
}

export function EmptyState({ title, description, actionLabel, onAction, action }: { title: string; description: string; actionLabel?: string; onAction?: () => void; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 text-lg">✦</div>
      <div className="font-semibold text-slate-900">{title}</div>
      <div className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</div>
      {actionLabel ? (onAction ? <button type="button" onClick={onAction} className="mt-3 text-sm font-semibold text-indigo-600 hover:underline">{actionLabel}</button> : <div className="mt-3 text-sm font-semibold text-indigo-600">{actionLabel}</div>) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_4px_16px_-4px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-px hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_12px_32px_-8px_rgba(15,23,42,0.16)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-indigo-500/70 via-violet-500/70 to-fuchsia-500/60 opacity-0 transition group-hover:opacity-100" />
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1.5 text-[26px] font-bold leading-none tracking-tight text-slate-900">{value}</div>
      {hint ? <div className="mt-2 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05),0_4px_16px_-4px_rgba(15,23,42,0.08)] ${className}`}>{children}</div>;
}

export function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "brand" | "green" | "amber" | "red" | "slate" }) {
  const tones: Record<string, string> = {
    brand: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    slate: "bg-slate-100 text-slate-600 ring-slate-200",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className}`} />;
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "dark" | "success" | "warning" | "danger" | "ghost" | "link";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", loading, className, children, type, disabled, ...rest }: ButtonProps) {
  const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
    primary: "btn-primary",
    secondary: "btn-secondary",
    dark: "btn-dark",
    success: "btn-success",
    warning: "btn-warning",
    danger:
      "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-red-600 to-red-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none",
    ghost:
      "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none",
    link: "inline-flex items-center gap-1 px-1 py-1 text-sm font-semibold text-brand-700 underline-offset-2 transition hover:underline disabled:opacity-50 disabled:pointer-events-none",
  };
  const sizeClass = size === "sm" ? "btn-sm" : size === "lg" ? "px-5 py-2.5 text-[15px]" : "";
  return (
    <button type={type ?? "button"} disabled={disabled || loading} className={`${variantClasses[variant]} ${sizeClass} ${className ?? ""}`.trim()} {...rest}>
      {loading ? (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
          <path d="M22 12a10 10 0 0 0-10-10v4a6 6 0 0 1 6 6h4z" fill="currentColor" />
        </svg>
      ) : null}
      {children}
    </button>
  );
}

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
  hint?: string;
  wrapperClassName?: string;
};

export function Input({ label, error, hint, wrapperClassName, className, ...rest }: InputProps) {
  return (
    <label className={`block ${wrapperClassName ?? ""}`.trim()}>
      {label ? <span className="mb-1 block text-[13px] font-semibold text-slate-700">{label}</span> : null}
      <input className={`input ${error ? "border-red-400 focus:border-red-500 focus:ring-red-500/15" : ""} ${className ?? ""}`.trim()} {...rest} />
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </label>
  );
}

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  error?: string;
  hint?: string;
  wrapperClassName?: string;
};

export function Select({ label, error, hint, wrapperClassName, className, children, ...rest }: SelectProps) {
  return (
    <label className={`block ${wrapperClassName ?? ""}`.trim()}>
      {label ? <span className="mb-1 block text-[13px] font-semibold text-slate-700">{label}</span> : null}
      <select className={`input ${error ? "border-red-400 focus:border-red-500 focus:ring-red-500/15" : ""} ${className ?? ""}`.trim()} {...rest}>
        {children}
      </select>
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </label>
  );
}

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  error?: string;
  hint?: string;
  wrapperClassName?: string;
};

export function Textarea({ label, error, hint, wrapperClassName, className, rows, ...rest }: TextareaProps) {
  return (
    <label className={`block ${wrapperClassName ?? ""}`.trim()}>
      {label ? <span className="mb-1 block text-[13px] font-semibold text-slate-700">{label}</span> : null}
      <textarea rows={rows ?? 3} className={`input ${error ? "border-red-400 focus:border-red-500 focus:ring-red-500/15" : ""} ${className ?? ""}`.trim()} {...rest} />
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </label>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
  className = "",
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-5 flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div>
        {breadcrumb}
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function FilterBar({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`card mb-4 flex flex-wrap items-center gap-2 px-3 py-2.5 ${className}`}>{children}</div>;
}

export function Tabs({
  tabs,
  activeId,
  onChange,
  className = "",
}: {
  tabs: { id: string; label: React.ReactNode; count?: number }[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={`view-switch ${className}`} role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`view-switch-btn ${active ? "view-switch-btn-active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="ml-1 rounded-full bg-black/10 px-1.5 py-px text-[10px] font-bold">{tab.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function StatChip({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2.5 rounded-2xl border border-slate-200/80 bg-white px-3 py-2 shadow-card">
      {icon}
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <span className="text-sm font-bold text-slate-900">{value}</span>
      {hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
    </div>
  );
}

/**
 * CSS dual-render responsive table: both trees mount; the `cards` render
 * is the caller's responsibility to keep in sync (EB5 adopts for orders/products).
 */
export function ResponsiveTable({ table, cards, className = "" }: { table: React.ReactNode; cards: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="hidden md:block">{table}</div>
      <div className="space-y-2 md:hidden">{cards}</div>
    </div>
  );
}

/**
 * Breadcrumb (EB5/ED12): kit-consistent trail for dashboard sub-pages.
 * Items render as links except the last (current page, aria-current).
 * Plain anchors keep it server-safe; callers pass Next <Link> output via
 * `href` only when they render it from a client component — hrefs here are
 * plain strings rendered as <a>, matching the dashboard's full reload-free
 * SPA behaviour through Next's anchor handling.
 */
export function Breadcrumb({
  items,
  className = "",
}: {
  items: { label: string; href?: string }[];
  className?: string;
}) {
  return (
    <nav aria-label="breadcrumb" className={`mb-2 flex flex-wrap items-center gap-1 text-xs text-slate-500 ${className}`}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="inline-flex items-center gap-1">
            {i > 0 ? <span aria-hidden="true" className="text-slate-300">/</span> : null}
            {item.href && !last ? (
              <a href={item.href} className="font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">
                {item.label}
              </a>
            ) : (
              <span aria-current={last ? "page" : undefined} className={last ? "font-semibold text-slate-800" : ""}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
