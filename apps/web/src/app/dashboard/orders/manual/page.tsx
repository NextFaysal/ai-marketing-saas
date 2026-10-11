"use client";
import React, { useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

/**
 * Milestone 65: manual order entry + orders CSV import.
 * Orders recorded here enter through the same pipeline as
 * store orders — automation, COD risk and attribution see
 * them identically.
 */
interface ImportResult {
  id: string; totalRows: number; successRows: number; failedRows: number; skippedRows: number;
  errors?: { row: number; message: string }[] | null;
}
interface Line { name: string; sku: string; quantity: number; unitPrice: string }

export default function ManualOrderPage() {
  const [customer, setCustomer] = useState({ phone: "", name: "", email: "", address: "", externalRef: "" });
  const [lines, setLines] = useState<Line[]>([{ name: "", sku: "", quantity: 1, unitPrice: "" }]);
  const [shipping, setShipping] = useState("60");
  const [discount, setDiscount] = useState("0");
  const [isCod, setIsCod] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");

  const takaToMinor = (v: string) => Math.round((Number(v) || 0) * 100);
  const subtotal = lines.reduce((a, l) => a + (Number(l.unitPrice) || 0) * (l.quantity || 0), 0);
  const total = Math.max(0, subtotal + (Number(shipping) || 0) - (Number(discount) || 0));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const out = await apiFetch<any>(`/organizations/${orgId}/orders`, {
        method: "POST",
        body: JSON.stringify({
          customerPhone: customer.phone.trim(),
          customerName: customer.name.trim() || undefined,
          customerEmail: customer.email.trim() || undefined,
          address: customer.address.trim() || undefined,
          externalRef: customer.externalRef.trim() || undefined,
          items: lines.filter((l) => l.name.trim()).map((l) => ({
            name: l.name.trim(), sku: l.sku.trim() || undefined,
            quantity: l.quantity, unitPriceMinor: takaToMinor(l.unitPrice),
          })),
          shippingMinor: takaToMinor(shipping),
          discountMinor: takaToMinor(discount),
          isCod,
        }),
      });
      setNotice(out.upsertResult === "updated"
        ? "একই রেফারেন্সের অর্ডার আপডেট হয়েছে (ডুপ্লিকেট হয়নি)।"
        : `অর্ডার তৈরি হয়েছে — মোট ৳${(Number(out.totalMinor) / 100).toLocaleString("en-IN")}। এটি এখন অটোমেশন, রিস্ক স্কোর ও রিপোর্টে দেখা যাবে।`);
      setCustomer({ phone: "", name: "", email: "", address: "", externalRef: "" });
      setLines([{ name: "", sku: "", quantity: 1, unitPrice: "" }]);
    } catch (err) { setError(err instanceof Error ? err.message : "অর্ডার তৈরি ব্যর্থ"); }
    finally { setBusy(false); }
  }

  async function onCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const orgId = getOrganizationId();
    if (!orgId) { setImportError("কোনো Organization নির্বাচিত নেই।"); return; }
    setImportBusy(true); setImportError(""); setResult(null);
    try {
      const csvText = await file.text();
      const data = await apiFetch<ImportResult>(`/organizations/${orgId}/imports/orders`, {
        method: "POST", body: JSON.stringify({ fileName: file.name, csvText }),
      });
      setResult(data);
    } catch (err) { setImportError(err instanceof Error ? err.message : "Import failed"); }
    finally { setImportBusy(false); }
  }

  const input = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">ম্যানুয়াল অর্ডার</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          ফোনে বা কাউন্টারে নেওয়া অর্ডার এখানে তুলুন — স্টোর অর্ডারের মতোই এগুলো অটোমেশন,
          COD রিস্ক স্কোর ও রিপোর্টে গণনা হবে। নিজের দোকানের রেফারেন্স নম্বর দিলে একই
          রেফারেন্স আবার সাবমিট করলে ডুপ্লিকেট না হয়ে আপডেট হবে।
        </p>
      </div>

      <form onSubmit={submit} className="card space-y-4 p-6">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">ক্রেতার ফোন (আবশ্যক)
            <input className={input} value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="01XXXXXXXXX" required />
          </label>
          <label className="text-sm">ক্রেতার নাম
            <input className={input} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
          </label>
          <label className="text-sm">অর্ডার রেফারেন্স (ঐচ্ছিক)
            <input className={input} value={customer.externalRef} onChange={(e) => setCustomer({ ...customer, externalRef: e.target.value })} placeholder="যেমন: SHOP-1042" />
          </label>
          <label className="text-sm">ইমেইল (ঐচ্ছিক)
            <input className={input} value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
          </label>
          <label className="text-sm md:col-span-2">ঠিকানা
            <input className={input} value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
          </label>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">পণ্যের লাইন</div>
          {lines.map((l, i) => (
            <div key={i} className="grid gap-2 md:grid-cols-[2fr_1fr_80px_120px_32px]">
              <input className={input} placeholder="পণ্যের নাম" value={l.name} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} required />
              <input className={input} placeholder="SKU (ঐচ্ছিক)" value={l.sku} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, sku: e.target.value } : x))} />
              <input className={input} type="number" min={1} max={999} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))} />
              <input className={input} type="number" min={0} step="0.01" placeholder="একক দাম ৳" value={l.unitPrice} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))} required />
              <button type="button" className="text-slate-400" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}>✕</button>
            </div>
          ))}
          <button type="button" className="text-sm font-semibold text-blue-600" onClick={() => setLines([...lines, { name: "", sku: "", quantity: 1, unitPrice: "" }])}>+ আরেকটি লাইন</button>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">ডেলিভারি চার্জ ৳
            <input className={input} type="number" min={0} step="0.01" value={shipping} onChange={(e) => setShipping(e.target.value)} />
          </label>
          <label className="text-sm">ছাড় ৳
            <input className={input} type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </label>
          <label className="flex items-end gap-2 pb-1 text-sm">
            <input type="checkbox" checked={isCod} onChange={(e) => setIsCod(e.target.checked)} /> Cash on Delivery
          </label>
          <div className="flex items-end pb-1 text-sm font-semibold">মোট: ৳{total.toLocaleString("en-IN")}</div>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {notice ? <p className="text-sm text-green-700">{notice}</p> : null}
        <button disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "তৈরি হচ্ছে..." : "অর্ডার তৈরি করুন"}
        </button>
      </form>

      <div className="card space-y-3 p-6">
        <h2 className="font-semibold">CSV দিয়ে একসাথে অনেক অর্ডার</h2>
        <p className="max-w-2xl text-sm text-slate-500">
          কলাম: order_ref (আবশ্যক), customer_phone (আবশ্যক), item_name (আবশ্যক), unit_price (আবশ্যক),
          quantity, customer_name, customer_email, status, currency, item_sku, shipping, discount, is_cod, placed_at।
          এক Row = এক অর্ডার (একটি পণ্য-লাইন)। একই order_ref আবার ইমপোর্ট করলে আপডেট হবে, ডুপ্লিকেট হবে না।
          নমুনা: <code>docs/examples/orders-sample.csv</code>
        </p>
        <input type="file" accept=".csv,text/csv" onChange={onCsv} className="text-sm" />
        {importBusy ? <p className="text-sm text-slate-500">ইমপোর্ট হচ্ছে...</p> : null}
        {importError ? <p className="text-sm text-red-600">{importError}</p> : null}
        {result ? (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div><div className="page-title">{result.totalRows}</div><div className="text-xs text-slate-500">মোট Row</div></div>
              <div><div className="text-2xl font-bold text-green-600">{result.successRows}</div><div className="text-xs text-slate-500">নতুন অর্ডার</div></div>
              <div><div className="text-2xl font-bold text-amber-600">{result.skippedRows}</div><div className="text-xs text-slate-500">আপডেট হয়েছে</div></div>
              <div><div className="text-2xl font-bold text-red-600">{result.failedRows}</div><div className="text-xs text-slate-500">ব্যর্থ</div></div>
            </div>
            {result.errors && result.errors.length > 0 ? (
              <ul className="max-h-56 space-y-1 overflow-auto text-sm text-red-600">
                {result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
