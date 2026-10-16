"use client";
import React from "react";
import type { CheckoutFieldDef, FieldAnswers } from "@/lib/checkout-fields";

/**
 * AB4 (AX5) — the org's custom checkout fields, rendered identically
 * on every public surface (shop / single / landing / express).
 * Renders NOTHING when the org defines no fields, so surfaces
 * without fields behave exactly as before.
 */
export function CheckoutFieldsSection({
  defs,
  answers,
  onChange,
  dense = false,
}: {
  defs: CheckoutFieldDef[];
  answers: FieldAnswers;
  onChange: (key: string, value: string | boolean) => void;
  dense?: boolean;
}) {
  if (!defs || defs.length === 0) return null;
  const inputCls = dense
    ? "w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-indigo-600 focus:outline-none"
    : "w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none";
  const labelCls = dense
    ? "mb-1 block text-xs font-bold text-slate-700"
    : "mb-1 block text-xs font-bold text-slate-700";
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-xs font-bold text-slate-800">অতিরিক্ত তথ্য</p>
      {defs.map((def) => {
        const requiredMark = def.required ? <span className="text-rose-600"> *</span> : null;
        if (def.type === "checkbox") {
          return (
            <label key={def.key} className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
              <input
                type="checkbox"
                checked={answers[def.key] === true}
                onChange={(e) => onChange(def.key, e.target.checked)}
              />
              <span>{def.label}{requiredMark}</span>
            </label>
          );
        }
        if (def.type === "select") {
          return (
            <div key={def.key}>
              <label className={labelCls}>{def.label}{requiredMark}</label>
              <select
                value={typeof answers[def.key] === "string" ? (answers[def.key] as string) : ""}
                onChange={(e) => onChange(def.key, e.target.value)}
                required={def.required}
                className={inputCls}
              >
                <option value="">— বেছে নিন —</option>
                {def.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
          );
        }
        if (def.type === "textarea") {
          return (
            <div key={def.key}>
              <label className={labelCls}>{def.label}{requiredMark}</label>
              <textarea
                rows={2}
                value={typeof answers[def.key] === "string" ? (answers[def.key] as string) : ""}
                onChange={(e) => onChange(def.key, e.target.value)}
                required={def.required}
                className={inputCls}
              />
            </div>
          );
        }
        return (
          <div key={def.key}>
            <label className={labelCls}>{def.label}{requiredMark}</label>
            <input
              type="text"
              value={typeof answers[def.key] === "string" ? (answers[def.key] as string) : ""}
              onChange={(e) => onChange(def.key, e.target.value)}
              required={def.required}
              className={inputCls}
            />
          </div>
        );
      })}
    </div>
  );
}
