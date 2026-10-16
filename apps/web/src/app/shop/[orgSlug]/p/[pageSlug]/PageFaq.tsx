import React from "react";

/** GC: FAQ accordion — mirrors landing-client.tsx details/summary classes. */
export function PageFaq({ items }: { items: { q: string; a: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-3">
      {items.map((f, i) => (
        <details key={`${f.q}-${i}`} className="card group p-5">
          <summary className="cursor-pointer font-semibold text-slate-900">{f.q}</summary>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">{f.a}</p>
        </details>
      ))}
    </div>
  );
}
