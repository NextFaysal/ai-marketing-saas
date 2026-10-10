import React from "react";

export function EmptyState({ title, description, actionLabel }: { title: string; description: string; actionLabel?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/15 to-violet-500/15 text-lg">✦</div>
      <div className="font-semibold text-slate-900">{title}</div>
      <div className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</div>
      {actionLabel ? <div className="mt-3 text-sm font-semibold text-indigo-600">{actionLabel}</div> : null}
    </div>
  );
}

export function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_4px_16px_-4px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-px hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_12px_32px_-8px_rgba(15,23,42,0.16)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-indigo-500/70 via-violet-500/70 to-fuchsia-500/60 opacity-0 transition group-hover:opacity-100" />
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1.5 text-[26px] font-bold leading-none tracking-tight text-slate-900">{value}</div>
      {hint ? <div className="mt-2 text-xs text-slate-400">{hint}</div> : null}
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
  return <div className={`animate-pulse rounded-xl bg-slate-200/70 ${className}`} />;
}
