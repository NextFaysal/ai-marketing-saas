"use client";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka } from "@/lib/storefront-money";
import { code128Svg } from "@/lib/code128";

// EC21 — Bin / product labels. Barcode value is ONLY the product's
// real barcode, else its real SKU — never an invented number.
// Products with neither are listed as skipped, with no fake barcode.
// Non-CODE128-B values (outside ASCII 32–126) are also skipped honestly.

interface ProductDetail { id: string; name: string; sku?: string | null; barcode?: string | null; priceMinor?: string }
interface Assignment { id: string; productId: string; productName?: string | null; binLocationId: string; binCode?: string | null }

interface Label { key: string; name: string; priceMinor?: string; value: string; kind: "Barcode" | "SKU" }

function LabelsInner() {
  const params = useSearchParams();
  const productIdsCsv = params.get("productIds") ?? "";
  const warehouseId = params.get("warehouseId") ?? "";
  const binId = params.get("binId") ?? "";
  const [labels, setLabels] = useState<Label[]>([]);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const orgId = getOrganizationId();
      if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); setLoading(false); return; }
      try {
        let ids: string[] = productIdsCsv ? productIdsCsv.split(",").map((s) => s.trim()).filter(Boolean) : [];
        if (ids.length === 0 && warehouseId && binId) {
          const all = (await apiFetch<{ items: Assignment[] }>(`/organizations/${orgId}/commerce/bin-assignments?warehouseId=${encodeURIComponent(warehouseId)}`))?.items ?? [];
          ids = [...new Set((all ?? []).filter((a) => a.binLocationId === binId).map((a) => a.productId))];
        }
        if (ids.length === 0) { setError("কোনো পণ্য পাওয়া যায়নি — productIds অথবা warehouseId+binId দরকার।"); setLoading(false); return; }
        const details = await Promise.allSettled(ids.map((id) => apiFetch<ProductDetail>(`/organizations/${orgId}/products/${id}`)));
        const ok: Label[] = []; const skip: { name: string; reason: string }[] = [];
        details.forEach((r, i) => {
          if (r.status !== "fulfilled") { skip.push({ name: ids[i], reason: "পণ্যের তথ্য লোড করা যায়নি" }); return; }
          const p = r.value;
          const value = p.barcode ?? p.sku ?? null;
          if (!value) { skip.push({ name: p.name, reason: "Barcode বা SKU কোনোটিই নেই — নম্বর বানিয়ে লেবেল ছাপা হয়নি" }); return; }
          try { code128Svg(value); } catch { skip.push({ name: p.name, reason: "Barcode/SKU-তে CODE128-B-তে ছাপা যায় না এমন অক্ষর আছে" }); return; }
          ok.push({ key: `${p.id}-${value}`, name: p.name, priceMinor: p.priceMinor, value, kind: p.barcode ? "Barcode" : "SKU" });
        });
        setLabels(ok); setSkipped(skip);
      } catch (e) {
        setError(e instanceof Error ? e.message : "লেবেল লোড করা যায়নি");
      } finally { setLoading(false); }
    })();
  }, [productIdsCsv, warehouseId, binId]);

  const rendered = useMemo(() => labels.map((l) => {
    try { return { label: l, bar: code128Svg(l.value, 40) }; } catch { return { label: l, bar: null }; }
  }).filter((x) => x.bar !== null), [labels]);

  return (
    <div className="mx-auto max-w-5xl bg-white p-6 text-slate-900">
      <style>{`@page { size: A4; margin: 10mm; } @media print { body { background: #fff; } }`}</style>
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div>
          <h1 className="page-title">🏷️ লেবেল প্রিন্ট</h1>
          <p className="text-sm text-slate-500">প্রতিটি লেবেলে আসল Barcode অথবা SKU-র CODE128 বারকোড — কোনোটিই না থাকলে লেবেল ছাপা হয় না।</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => window.print()} disabled={labels.length === 0}>প্রিন্ট করুন</button>
      </div>
      {loading ? <p className="text-sm text-slate-500 print:hidden">লোড হচ্ছে…</p> : null}
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 print:hidden">{error}</p> : null}
      {skipped.length > 0 ? (
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 print:hidden">
          <p className="font-semibold">বাদ গেছে ({skipped.length}টি):</p>
          <ul className="mt-1 list-disc pl-5">{skipped.map((s, i) => <li key={i}>{s.name} — {s.reason}</li>)}</ul>
        </div>
      ) : null}
      <div className="label-sheet grid grid-cols-3 gap-3">
        {rendered.map(({ label, bar }) => (
          <div key={label.key} className="flex flex-col items-center rounded border p-3 text-center print:break-inside-avoid">
            <div className="line-clamp-2 text-sm font-semibold">{label.name}</div>
            <div className="mt-1 text-base font-bold">{formatMinorTaka(label.priceMinor)}</div>
            {bar ? (
              <svg viewBox={bar.viewBox} className="mt-2 h-12 w-full" preserveAspectRatio="none" role="img" aria-label={label.value}>
                {bar.rects.map((r, i) => <rect key={i} x={r.x} y={0} width={r.w} height={bar.height} fill="#000" />)}
              </svg>
            ) : null}
            <div className="mt-1 font-mono text-xs tracking-wider">{label.value}</div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{label.kind}</div>
          </div>
        ))}
      </div>
      {!loading && labels.length === 0 && !error ? <p className="text-sm text-slate-500 print:hidden">ছাপার মতো কোনো লেবেল নেই।</p> : null}
    </div>
  );
}

export default function WarehouseLabelsPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-slate-500">লোড হচ্ছে…</p>}>
      <LabelsInner />
    </Suspense>
  );
}
