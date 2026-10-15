"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

/** ON11: POST /orders/parse-address suggestion shape. */
interface AddressSuggestion {
  district: string | null;
  thana: string | null;
  confidence: string;
  matchedTerms?: string[];
}
interface CreateWarning {
  key: string;
  label: string;
}

interface ImportResult {
  id: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  skippedRows: number;
  errors?: { row: number; message: string }[] | null;
}

interface Line {
  name: string;
  sku: string;
  quantity: number;
  unitPrice: string;
}

export default function ManualOrderPage() {
  const [customer, setCustomer] = useState({ phone: "", name: "", email: "", address: "", externalRef: "" });
  const [lines, setLines] = useState<Line[]>([{ name: "", sku: "", quantity: 1, unitPrice: "" }]);
  const [shipping, setShipping] = useState("60");
  const [discount, setDiscount] = useState("0");
  const [isCod, setIsCod] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // ON11: address -> district suggestion
  const [addrSuggestion, setAddrSuggestion] = useState<AddressSuggestion | null>(null);
  const [confirmedDistrict, setConfirmedDistrict] = useState("");
  const [parseBusy, setParseBusy] = useState(false);
  const lastParsedRef = useRef("");
  const [createWarnings, setCreateWarnings] = useState<CreateWarning[]>([]);
  const [createAddrSuggestion, setCreateAddrSuggestion] = useState<AddressSuggestion | null>(null);

  const [result, setResult] = useState<ImportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");

  const takaToMinor = (v: string) => Math.round((Number(v) || 0) * 100);
  const subtotal = lines.reduce((a, l) => a + (Number(l.unitPrice) || 0) * (l.quantity || 0), 0);
  const total = Math.max(0, subtotal + (Number(shipping) || 0) - (Number(discount) || 0));

  async function parseAddress() {
    const raw = customer.address.trim();
    if (raw.length < 4 || raw === lastParsedRef.current) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    lastParsedRef.current = raw;
    setParseBusy(true);
    try {
      const out = await apiFetch<AddressSuggestion>(`/organizations/${orgId}/orders/parse-address`, {
        method: "POST",
        body: JSON.stringify({ address: raw }),
      });
      setAddrSuggestion(out?.district ? out : null);
    } catch {
      setAddrSuggestion(null);
    } finally {
      setParseBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) {
      setError("কোনো Organization নির্বাচিত নেই।");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setCreateWarnings([]);
    setCreateAddrSuggestion(null);
    try {
      const out = await apiFetch<any>(`/organizations/${orgId}/orders`, {
        method: "POST",
        body: JSON.stringify({
          customerPhone: customer.phone.trim(),
          customerName: customer.name.trim() || undefined,
          customerEmail: customer.email.trim() || undefined,
          address: customer.address.trim() || undefined,
          district: confirmedDistrict || undefined,
          externalRef: customer.externalRef.trim() || undefined,
          items: lines
            .filter((l) => l.name.trim())
            .map((l) => ({
              name: l.name.trim(),
              sku: l.sku.trim() || undefined,
              quantity: l.quantity,
              unitPriceMinor: takaToMinor(l.unitPrice),
            })),
          shippingMinor: takaToMinor(shipping),
          discountMinor: takaToMinor(discount),
          isCod,
        }),
      });
      setNotice(
        out.upsertResult === "updated"
          ? "একই রেফারেন্সের অর্ডার আপডেট হয়েছে (ডুপ্লিকেট হয়নি)।"
          : `অর্ডার সফলভাবে তৈরি হয়েছে — মোট ৳${(Number(out.totalMinor) / 100).toLocaleString("en-IN")}। এটি এখন অর্ডার তালিকা ও অটোমেশনে দেখা যাবে।`
      );
      if (Array.isArray(out.warnings) && out.warnings.length > 0) {
        setCreateWarnings(out.warnings);
      }
      if (out.addressSuggestion?.district) {
        setCreateAddrSuggestion(out.addressSuggestion);
      }
      setCustomer({ phone: "", name: "", email: "", address: "", externalRef: "" });
      setConfirmedDistrict("");
      setAddrSuggestion(null);
      lastParsedRef.current = "";
      setLines([{ name: "", sku: "", quantity: 1, unitPrice: "" }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "অর্ডার তৈরি ব্যর্থ");
    } finally {
      setBusy(false);
    }
  }

  async function handleCsvFile(file: File) {
    const orgId = getOrganizationId();
    if (!orgId) {
      setImportError("কোনো Organization নির্বাচিত নেই।");
      return;
    }
    setImportBusy(true);
    setImportError("");
    setResult(null);
    try {
      const csvText = await file.text();
      const data = await apiFetch<ImportResult>(`/organizations/${orgId}/imports/orders`, {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, csvText }),
      });
      setResult(data);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "ইমপোর্ট ব্যর্থ হয়েছে");
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header & Breadcrumb */}
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-1.5">
          <Link href="/dashboard/orders" className="text-indigo-600 hover:underline">
            ← অর্ডার তালিকা
          </Link>
          <span className="text-slate-300">/</span>
          <span className="text-slate-700">ম্যানুয়াল অর্ডার এন্ট্রি</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          📝 নতুন ম্যানুয়াল অর্ডার ও CSV ইমপোর্ট
        </h1>
        <p className="mt-1 text-xs text-slate-500 max-w-2xl">
          ফোনে বা কাউন্টারে নেওয়া অর্ডার সরাসরি এখানে তুলুন। এগুলো স্বয়ংক্রিয়ভাবে স্টক ম্যানেজমেন্ট, কুরিয়ার বুকিং ও COD রিস্ক রিপোর্টে গণনা হবে।
        </p>
      </div>

      {notice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-800 flex items-center justify-between">
          <span>{notice}</span>
          <Link href="/dashboard/orders" className="text-emerald-700 underline font-bold">
            অর্ডার দেখুন →
          </Link>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800">
          {error}
        </div>
      )}

      {createWarnings.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-1">
          <p className="text-xs font-bold text-amber-800">⚠️ অর্ডার তৈরি হয়েছে, তবে যাচাই করে দেখুন:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">
            {createWarnings.map((w) => (
              <li key={w.key}>{w.label}</li>
            ))}
          </ul>
        </div>
      )}

      {createAddrSuggestion?.district && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
          ঠিকানা থেকে সম্ভাব্য জেলা: <b>{createAddrSuggestion.district}</b>
          {createAddrSuggestion.thana ? ` · থানা: ${createAddrSuggestion.thana}` : ""}
        </div>
      )}

      {/* Main 2-Column Layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left 2 Cols: Form */}
        <form onSubmit={submit} className="space-y-6 lg:col-span-2">
          {/* Customer Details Card */}
          <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              ১. ক্রেতার বিবরণ
            </span>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ক্রেতার ফোন নম্বর <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="01XXXXXXXXX"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                  value={customer.phone}
                  onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ক্রেতার নাম (ঐচ্ছিক)
                </label>
                <input
                  type="text"
                  placeholder="যেমন: তানভীর আহমেদ"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                  value={customer.name}
                  onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  অর্ডার রেফারেন্স (ঐচ্ছিক)
                </label>
                <input
                  type="text"
                  placeholder="যেমন: SHOP-1042"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                  value={customer.externalRef}
                  onChange={(e) => setCustomer({ ...customer, externalRef: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ইমেইল (ঐচ্ছিক)
                </label>
                <input
                  type="email"
                  placeholder="customer@example.com"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                  value={customer.email}
                  onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  পূর্ণ ডেলিভারি ঠিকানা
                </label>
                <textarea
                  rows={2}
                  placeholder="বাসা, রোড, থানা, জেলা..."
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:ring-2 focus:ring-indigo-500"
                  value={customer.address}
                  onChange={(e) => {
                    setCustomer({ ...customer, address: e.target.value });
                    if (confirmedDistrict) setConfirmedDistrict("");
                    setAddrSuggestion(null);
                  }}
                  onBlur={() => void parseAddress()}
                />

                {/* District parser pill */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={parseBusy || customer.address.trim().length < 4}
                    onClick={() => {
                      lastParsedRef.current = "";
                      void parseAddress();
                    }}
                    className="text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-50"
                  >
                    {parseBusy ? "জেলা খোঁজা হচ্ছে…" : "🔍 জেলা খুঁজুন"}
                  </button>

                  {confirmedDistrict ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                      জেলা: {confirmedDistrict} ✓
                      <button
                        type="button"
                        className="text-emerald-600 hover:text-rose-600"
                        title="নিশ্চিত জেলা সরান"
                        onClick={() => setConfirmedDistrict("")}
                      >
                        ✕
                      </button>
                    </span>
                  ) : addrSuggestion?.district ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                      জেলা: {addrSuggestion.district}?{addrSuggestion.thana ? ` · থানা: ${addrSuggestion.thana}` : ""}
                      <button
                        type="button"
                        className="rounded-full bg-amber-600 px-2 py-0.5 text-white hover:bg-amber-700 text-[10px]"
                        onClick={() => {
                          setConfirmedDistrict(addrSuggestion.district!);
                          setAddrSuggestion(null);
                        }}
                      >
                        নিশ্চিত করুন
                      </button>
                      <button
                        type="button"
                        className="text-amber-700 hover:text-rose-600"
                        title="সাজেশন এড়িয়ে যান"
                        onClick={() => setAddrSuggestion(null)}
                      >
                        ✕
                      </button>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Ordered Line Items Card */}
          <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                ২. পণ্যের আইটেম তালিকা
              </span>
              <button
                type="button"
                onClick={() => setLines([...lines, { name: "", sku: "", quantity: 1, unitPrice: "" }])}
                className="text-xs font-bold text-indigo-600 hover:underline"
              >
                + আরেকটি পণ্য যোগ করুন
              </button>
            </div>

            <div className="space-y-2.5">
              {lines.map((l, i) => (
                <div
                  key={i}
                  className="grid gap-2 grid-cols-12 items-center rounded-2xl bg-slate-50/70 p-2.5 border border-slate-100"
                >
                  <div className="col-span-12 sm:col-span-5">
                    <input
                      type="text"
                      required
                      placeholder="পণ্যের নাম *"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs"
                      value={l.name}
                      onChange={(e) =>
                        setLines(lines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                      }
                    />
                  </div>

                  <div className="col-span-5 sm:col-span-3">
                    <input
                      type="text"
                      placeholder="SKU (ঐচ্ছিক)"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono"
                      value={l.sku}
                      onChange={(e) =>
                        setLines(lines.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))
                      }
                    />
                  </div>

                  <div className="col-span-3 sm:col-span-2">
                    <input
                      type="number"
                      min={1}
                      max={999}
                      placeholder="পরিমাণ"
                      className="w-full rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-center"
                      value={l.quantity}
                      onChange={(e) =>
                        setLines(
                          lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) || 1 } : x))
                        )
                      }
                    />
                  </div>

                  <div className="col-span-3 sm:col-span-2 flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      placeholder="একক দাম ৳"
                      className="w-full rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-right font-semibold"
                      value={l.unitPrice}
                      onChange={(e) =>
                        setLines(lines.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))
                      }
                    />
                    <button
                      type="button"
                      disabled={lines.length === 1}
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                      className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </form>

        {/* Right 1 Col: Summary & Actions Card */}
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm space-y-4 sticky top-6">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              অর্ডার সামারি
            </span>

            <div className="space-y-2 text-xs border-b border-slate-100 pb-3">
              <div className="flex justify-between text-slate-600">
                <span>পণ্যের সাবটোটাল</span>
                <span className="font-semibold text-slate-900">৳{subtotal.toLocaleString("en-IN")}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-600">ডেলিভারি চার্জ</span>
                <div className="w-24">
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-xl border border-slate-200 px-2 py-1 text-right text-xs"
                    value={shipping}
                    onChange={(e) => setShipping(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-600">ছাড় / ডিসকাউন্ট</span>
                <div className="w-24">
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-xl border border-slate-200 px-2 py-1 text-right text-xs"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* COD Checkbox */}
            <label className="flex items-center gap-2 select-none cursor-pointer text-xs font-semibold text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                checked={isCod}
                onChange={(e) => setIsCod(e.target.checked)}
              />
              <span>💵 Cash on Delivery (COD)</span>
            </label>

            {/* Total Display */}
            <div className="flex items-baseline justify-between pt-1">
              <span className="text-xs font-bold uppercase text-slate-500">সর্বমোট প্রদেয়</span>
              <span className="text-2xl font-bold text-slate-900">
                ৳{total.toLocaleString("en-IN")}
              </span>
            </div>

            <button
              type="button"
              disabled={busy || !customer.phone.trim() || lines.every((l) => !l.name.trim())}
              onClick={submit}
              className="w-full rounded-2xl bg-indigo-600 py-3 text-xs font-bold text-white shadow-md hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition"
            >
              {busy ? "অর্ডার তৈরি হচ্ছে..." : "অর্ডার নিশ্চিত করুন"}
            </button>
          </div>
        </div>
      </div>

      {/* CSV Bulk Import Card */}
      <div className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            📊 CSV ফাইল দিয়ে একসাথে শত শত অর্ডার ইমপোর্ট
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            ফাইল কলাম: <code>order_ref, customer_phone, item_name, unit_price, quantity, customer_name, address, shipping, discount, is_cod</code>
          </p>
        </div>

        {/* Drag & Drop Zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void handleCsvFile(f);
          }}
          className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center hover:border-indigo-400 bg-slate-50/50 transition cursor-pointer"
        >
          <input
            type="file"
            accept=".csv,text/csv"
            id="orders-csv-input"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleCsvFile(f);
            }}
          />
          <label htmlFor="orders-csv-input" className="cursor-pointer block space-y-1.5">
            <span className="text-3xl">📁</span>
            <div className="text-xs font-bold text-slate-800">
              CSV ফাইল ড্রপ করুন অথবা ব্রাউজ করতে ক্লিক করুন
            </div>
            <div className="text-[11px] text-slate-400">
              একই order_ref পুনরায় ইমপোর্ট করলে আপডেট হবে, ডুপ্লিকেট হবে না
            </div>
          </label>
        </div>

        {importBusy && <p className="text-xs text-slate-500 animate-pulse">ইমপোর্ট হচ্ছে...</p>}
        {importError && <p className="text-xs text-rose-600 font-semibold">{importError}</p>}

        {result && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
              <div className="bg-white rounded-xl p-3 border border-slate-100">
                <div className="text-xl font-bold text-slate-900">{result.totalRows}</div>
                <div className="text-[10px] text-slate-400">মোট Row</div>
              </div>
              <div className="bg-white rounded-xl p-3 border border-slate-100">
                <div className="text-xl font-bold text-emerald-600">{result.successRows}</div>
                <div className="text-[10px] text-slate-400">নতুন অর্ডার</div>
              </div>
              <div className="bg-white rounded-xl p-3 border border-slate-100">
                <div className="text-xl font-bold text-amber-600">{result.skippedRows}</div>
                <div className="text-[10px] text-slate-400">আপডেট হয়েছে</div>
              </div>
              <div className="bg-white rounded-xl p-3 border border-slate-100">
                <div className="text-xl font-bold text-rose-600">{result.failedRows}</div>
                <div className="text-[10px] text-slate-400">ব্যর্থ</div>
              </div>
            </div>

            {result.errors && result.errors.length > 0 && (
              <div className="max-h-40 overflow-y-auto space-y-1 text-xs text-rose-600">
                {result.errors.map((e, i) => (
                  <div key={i}>
                    Row {e.row}: {e.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
