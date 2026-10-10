"use client";
import React, { useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

interface ImportResult {
  id: string; totalRows: number; successRows: number; failedRows: number; skippedRows: number;
  errors?: { row: number; message: string }[] | null;
}

export default function ProductImportPage() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    setLoading(true); setError(""); setResult(null); setFileName(file.name);
    try {
      const csvText = await file.text();
      const data = await apiFetch<ImportResult>(`/organizations/${orgId}/imports/products`, {
        method: "POST", body: JSON.stringify({ fileName: file.name, csvText }),
      });
      setResult(data);
    } catch (err) { setError(err instanceof Error ? err.message : "Import failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">CSV দিয়ে পণ্য ইমপোর্ট</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          কলাম: name (আবশ্যক), price (আবশ্যক), sku, cost, stock, category, description, image_url, currency।
          একই SKU আবার আপলোড হলে সেটি Skip হবে, পুরনো ডেটা ওভাররাইট হবে না। সর্বোচ্চ ফাইল ২ MB।
          নমুনা: <code>docs/examples/products-sample.csv</code>
        </p>
      </div>
      <div className="card p-6">
        <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
        {fileName ? <span className="ml-3 text-sm text-slate-500">{fileName}</span> : null}
        {loading ? <p className="mt-3 text-sm text-slate-500">ইমপোর্ট হচ্ছে...</p> : null}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </div>
      {result ? (
        <div className="space-y-4 card p-6">
          <div className="grid grid-cols-4 gap-4 text-center">
            <div><div className="page-title">{result.totalRows}</div><div className="text-xs text-slate-500">মোট Row</div></div>
            <div><div className="text-2xl font-bold text-green-600">{result.successRows}</div><div className="text-xs text-slate-500">সফল</div></div>
            <div><div className="text-2xl font-bold text-amber-600">{result.skippedRows}</div><div className="text-xs text-slate-500">Skip (Duplicate SKU)</div></div>
            <div><div className="text-2xl font-bold text-red-600">{result.failedRows}</div><div className="text-xs text-slate-500">ব্যর্থ</div></div>
          </div>
          {result.errors && result.errors.length > 0 ? (
            <div>
              <div className="font-semibold">Row অনুযায়ী এরর</div>
              <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-sm text-red-600">
                {result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
              </ul>
            </div>
          ) : null}
          <a href="/dashboard/products" className="inline-block text-sm font-semibold text-blue-600">পণ্যের তালিকায় যান →</a>
        </div>
      ) : null}
    </div>
  );
}
