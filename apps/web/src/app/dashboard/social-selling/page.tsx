"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  LiveKeywordRule,
  ParsedLiveOrder,
  DEFAULT_SAMPLE_RULES,
  parseLiveComment,
  convertBnDigitsToEn,
} from "@/lib/live-selling";
import { getOrganizationId } from "@/lib/org";

export default function SocialSellingPage() {
  const [isLiveActive, setIsLiveActive] = useState(true);
  const [platform, setPlatform] = useState<"facebook" | "tiktok" | "instagram">("facebook");
  const [liveDurationSeconds, setLiveDurationSeconds] = useState(2054); // ~34 mins

  // Rules state
  const [rules, setRules] = useState<LiveKeywordRule[]>(DEFAULT_SAMPLE_RULES);
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newStock, setNewStock] = useState("20");
  const [newSku, setNewSku] = useState("");

  // Captured orders state
  const [capturedOrders, setCapturedOrders] = useState<ParsedLiveOrder[]>([
    {
      id: "ord-live-01",
      keywordMatched: "101",
      rule: DEFAULT_SAMPLE_RULES[0]!,
      quantity: 2,
      customerPhone: "8801712345678",
      extractedSize: "42",
      extractedColor: null,
      rawComment: "১০১ ২টা নিবো সাইজ ৪২ ০১৭১২৩৪৫৬৭৮",
      totalPriceMinor: "290000",
      checkoutUrl: "https://shop.amarbrand.com/checkout?rule=rule-101&qty=2&phone=8801712345678",
      whatsappReplyMessage: "",
      messengerReplyMessage: "",
      createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    },
    {
      id: "ord-live-02",
      keywordMatched: "102",
      rule: DEFAULT_SAMPLE_RULES[1]!,
      quantity: 1,
      customerPhone: "8801899887766",
      extractedSize: null,
      extractedColor: null,
      rawComment: "102 red jamdani saree lagbe 01899887766",
      totalPriceMinor: "380000",
      checkoutUrl: "https://shop.amarbrand.com/checkout?rule=rule-102&qty=1&phone=8801899887766",
      whatsappReplyMessage: "",
      messengerReplyMessage: "",
      createdAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    },
    {
      id: "ord-live-03",
      keywordMatched: "103",
      rule: DEFAULT_SAMPLE_RULES[2]!,
      quantity: 1,
      customerPhone: null,
      extractedSize: "L",
      extractedColor: null,
      rawComment: "103 size L nibo apu",
      totalPriceMinor: "125000",
      checkoutUrl: "https://shop.amarbrand.com/checkout?rule=rule-103&qty=1",
      whatsappReplyMessage: "",
      messengerReplyMessage: "",
      createdAt: new Date(Date.now() - 1000 * 60 * 1).toISOString(),
    },
  ]);

  // Comment Simulator state
  const [simComment, setSimComment] = useState("101 2 ta nibo 01711223344 size 40");
  const [simAuthor, setSimAuthor] = useState("ফারহানা ইয়াসমিন");
  const [simResult, setSimResult] = useState<ParsedLiveOrder | null>(null);
  const [simFeedback, setSimFeedback] = useState("");
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  // Live timer tick
  useEffect(() => {
    if (!isLiveActive) return;
    const timer = setInterval(() => {
      setLiveDurationSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isLiveActive]);

  const formatTimer = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  };

  const totalGmv = useMemo(() => {
    const totalMinor = capturedOrders.reduce((sum, ord) => sum + BigInt(ord.totalPriceMinor), 0n);
    return `৳${(Number(totalMinor) / 100).toLocaleString("en-IN")}`;
  }, [capturedOrders]);

  const handleSimulate = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!simComment.trim()) return;

    const parsed = parseLiveComment(simComment, rules, "আমাদের শপ");
    setSimResult(parsed);

    if (parsed) {
      setSimFeedback("✓ লাইভ কমেন্ট থেকে সফলভাবে অর্ডার ক্যাপচার করা হয়েছে!");
      // add to captured list
      setCapturedOrders((prev) => [parsed, ...prev]);
      // decrement rule stock
      setRules((prev) =>
        prev.map((r) =>
          r.id === parsed.rule.id
            ? { ...r, stockQuantity: Math.max(0, r.stockQuantity - parsed.quantity) }
            : r
        )
      );
    } else {
      setSimFeedback("⚠️ কোনো নিবন্ধিত পণ্যের কোড বা কি-ওয়ার্ড পাওয়া যায়নি।");
    }
    setTimeout(() => setSimFeedback(""), 4000);
  };

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim() || !newProductName.trim() || !newPrice.trim()) return;

    const minor = String(Math.round(Number(newPrice) * 100));
    const created: LiveKeywordRule = {
      id: `rule-${Date.now().toString(36)}`,
      keyword: newKeyword.trim().toUpperCase(),
      productName: newProductName.trim(),
      priceMinor: minor,
      stockQuantity: Number(newStock) || 10,
      sku: newSku.trim() || `SKU-${newKeyword.trim()}`,
      isActive: true,
    };

    setRules((prev) => [created, ...prev]);
    setShowAddRuleModal(false);
    setNewKeyword("");
    setNewProductName("");
    setNewPrice("");
    setNewSku("");
  };

  const openWhatsAppLink = (order: ParsedLiveOrder) => {
    if (!order.customerPhone) {
      alert("এই কমেন্টে কোনো ফোন নম্বর পাওয়া যায়নি। আপনি মেসেঞ্জারে রিপ্লাই দিতে পারেন।");
      return;
    }
    const clean = convertBnDigitsToEn(order.customerPhone).replace(/[^0-9]/g, "");
    const msg = order.whatsappReplyMessage || `আসসালামু আলাইকুম! লাইভে আপনার অর্ডারকৃত ${order.rule.productName} এর লিংক: ${order.checkoutUrl}`;
    window.open(`https://wa.me/${clean}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const copyCheckoutUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedLink(url);
    setTimeout(() => setCopiedLink(null), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Live Broadcast Status */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">🔴 সোশ্যাল লাইভ সেলিং ও কমেন্ট-টু-অর্ডার</h1>
            {isLiveActive ? (
              <span className="flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-0.5 text-xs font-bold text-red-700 animate-pulse">
                <span className="h-2 w-2 rounded-full bg-red-600" /> লাইভ অ্যাক্টিভ ({formatTimer(liveDurationSeconds)})
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                ⚪ লাইভ শেষ
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            ফেসবুক, টিকটক ও ইনস্টাগ্রাম লাইভ চলার সময় গ্রাহকের কমেন্ট (যেমন: &quot;101 2 ta nibo 017...&quot;) স্বয়ংক্রিয়ভাবে অর্ডারে রূপান্তর করুন
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Platform Selector */}
          <div className="flex rounded-lg border bg-white p-1 text-xs font-semibold">
            <button
              onClick={() => setPlatform("facebook")}
              className={`rounded px-2.5 py-1 transition ${
                platform === "facebook" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Facebook Live
            </button>
            <button
              onClick={() => setPlatform("tiktok")}
              className={`rounded px-2.5 py-1 transition ${
                platform === "tiktok" ? "bg-black text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              TikTok Live
            </button>
            <button
              onClick={() => setPlatform("instagram")}
              className={`rounded px-2.5 py-1 transition ${
                platform === "instagram" ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Instagram Live
            </button>
          </div>

          <button
            onClick={() => setIsLiveActive(!isLiveActive)}
            className={`rounded-lg px-4 py-2 text-xs font-bold shadow-sm transition ${
              isLiveActive
                ? "bg-slate-800 text-white hover:bg-slate-900"
                : "bg-red-600 text-white hover:bg-red-700"
            }`}
          >
            {isLiveActive ? "⏹️ লাইভ শেষ করুন" : "🔴 লাইভ শুরু করুন"}
          </button>
        </div>
      </div>

      {/* Realtime Live KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card border-l-4 border-l-red-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">লাইভ সেশন বুকড সেলস</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{totalGmv}</p>
          <p className="mt-1 text-xs text-emerald-600 font-medium">লাইভ চলাকালীন নিশ্চিত হওয়া অর্ডার</p>
        </div>

        <div className="card border-l-4 border-l-blue-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">মোট ক্যাপচার্ড অর্ডার</p>
          <p className="mt-1 text-2xl font-black text-blue-700">{capturedOrders.length} টি</p>
          <p className="mt-1 text-xs text-slate-500">কমেন্ট পার্স করে সংরক্ষিত অর্ডার</p>
        </div>

        <div className="card border-l-4 border-l-emerald-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">সক্রিয় প্রডাক্ট কি-ওয়ার্ড</p>
          <p className="mt-1 text-2xl font-black text-emerald-700">{rules.filter((r) => r.isActive).length} টি</p>
          <p className="mt-1 text-xs text-slate-500">স্টক রিজার্ভেশন সক্রিয়</p>
        </div>

        <div className="card border-l-4 border-l-purple-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">কমেন্ট কনভার্সন রেট</p>
          <p className="mt-1 text-2xl font-black text-purple-700">৮৪.২%</p>
          <p className="mt-1 text-xs text-purple-600 font-medium">কমেন্ট থেকে সরাসরি চেকআউট রূপান্তর</p>
        </div>
      </div>

      {/* Main Grid: Keywords Catalog & Live Stream Simulator */}
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Left Column: Trigger Keywords & Captured Orders */}
        <div className="space-y-6">
          {/* Trigger Keywords Manager */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">🏷️ লাইভ প্রডাক্ট কি-ওয়ার্ড ও স্টক অ্যালোকেশন</h3>
                <p className="text-xs text-slate-500">গ্রাহকরা লাইভে এই কোড লিখলেই স্বয়ংক্রিয়ভাবে অর্ডার কার্ট তৈরি হবে</p>
              </div>
              <button
                onClick={() => setShowAddRuleModal(true)}
                className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
              >
                + নতুন কি-ওয়ার্ড যোগ করুন
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {rules.map((rule) => {
                const priceTaka = (Number(rule.priceMinor) / 100).toLocaleString("en-IN");
                return (
                  <div
                    key={rule.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm"
                  >
                    <div>
                      <div className="flex items-start justify-between">
                        <span className="rounded-lg bg-indigo-50 px-2.5 py-1 font-mono text-sm font-extrabold text-indigo-700">
                          #{rule.keyword}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                            rule.stockQuantity > 5
                              ? "bg-emerald-100 text-emerald-800"
                              : rule.stockQuantity > 0
                              ? "bg-amber-100 text-amber-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          স্টক: {rule.stockQuantity}টি
                        </span>
                      </div>
                      <h4 className="mt-2 text-xs font-bold text-slate-800 truncate">{rule.productName}</h4>
                      <p className="text-[11px] text-slate-500">SKU: {rule.sku}</p>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                      <span className="font-extrabold text-slate-900">৳{priceTaka}</span>
                      <span className="text-[10px] text-indigo-600">
                        উদাহরণ: &quot;{rule.keyword} 1 ta&quot;
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Captured Orders Stream Table */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">📥 লাইভে ক্যাপচার্ড অর্ডারসমূহ ({capturedOrders.length}টি)</h3>
                <p className="text-xs text-slate-500">সরাসরি হোয়াটসঅ্যাপে ক্লিক করে চেকআউট লিংক পাঠান বা অর্ডার কনফার্ম করুন</p>
              </div>
              <button
                onClick={() => {
                  const csv = capturedOrders
                    .map(
                      (o) =>
                        `"${o.rule.productName}",${o.quantity},"${o.customerPhone || ""}",৳${(Number(o.totalPriceMinor) / 100).toFixed(0)},"${o.rawComment}"`
                    )
                    .join("\n");
                  const blob = new Blob([`পণ্য,পরিমাণ,ফোন,মূল্য,কমেন্ট\n${csv}`], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `live-orders-${Date.now()}.csv`;
                  a.click();
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
              >
                📤 CSV ডাউনলোড
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50 font-semibold text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3">মূল কমেন্ট</th>
                    <th className="py-2.5 px-3">ম্যাচড প্রডাক্ট</th>
                    <th className="py-2.5 px-3">পরিমাণ</th>
                    <th className="py-2.5 px-3">ফোন নম্বর</th>
                    <th className="py-2.5 px-3">মোট টাকা</th>
                    <th className="py-2.5 px-3 text-right">অ্যাকশন</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {capturedOrders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3 px-3">
                        <div className="max-w-[180px] font-medium text-slate-800 truncate" title={ord.rawComment}>
                          &quot;{ord.rawComment}&quot;
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {new Date(ord.createdAt).toLocaleTimeString("bn-BD")}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-indigo-700">
                          #{ord.keywordMatched}
                        </span>
                        <div className="text-[11px] font-medium text-slate-700 truncate max-w-[150px]">
                          {ord.rule.productName}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <span className="font-bold text-slate-800">{ord.quantity} টি</span>
                        {ord.extractedSize ? (
                          <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-bold">
                            সাইজ: {ord.extractedSize}
                          </span>
                        ) : null}
                      </td>

                      <td className="py-3 px-3">
                        {ord.customerPhone ? (
                          <span className="font-mono text-emerald-700 font-semibold">{ord.customerPhone}</span>
                        ) : (
                          <span className="text-[10px] text-amber-600 italic">ফোনের অপেক্ষায়</span>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <span className="font-bold text-slate-900">
                          ৳{((Number(ord.totalPriceMinor) || 0) / 100).toLocaleString("en-IN")}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {ord.customerPhone ? (
                            <button
                              onClick={() => openWhatsAppLink(ord)}
                              title="সরাসরি হোয়াটসঅ্যাপে চেকআউট লিংক পাঠান"
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                            >
                              <span>💬</span> WhatsApp
                            </button>
                          ) : null}
                          <button
                            onClick={() => copyCheckoutUrl(ord.checkoutUrl)}
                            title="ইনস্ট্যান্ট চেকআউট লিংক কপি করুন"
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            {copiedLink === ord.checkoutUrl ? "✓ লিংক কপিড" : "📋 লিংক"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Live Comment Parser Simulator & Playground */}
        <div className="space-y-4">
          <div className="rounded-2xl border-2 border-indigo-500 bg-gradient-to-b from-indigo-50/50 to-white p-5 shadow-md">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚡</span>
              <div>
                <h3 className="text-sm font-bold text-slate-900">লাইভ কমেন্ট পার্সার সিমুলেটর</h3>
                <p className="text-[11px] text-slate-500">কমেন্ট লিখে তাৎক্ষণিক ম্যাচিং ও চেকআউট লিংক পরীক্ষা করুন</p>
              </div>
            </div>

            <form onSubmit={handleSimulate} className="mt-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700">কমেন্টকারীর নাম</label>
                <input
                  type="text"
                  value={simAuthor}
                  onChange={(e) => setSimAuthor(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700">লাইভ কমেন্টের টেক্সট</label>
                <textarea
                  rows={2}
                  value={simComment}
                  onChange={(e) => setSimComment(e.target.value)}
                  placeholder="যেমন: 101 2 ta nibo 017xxxxxxxx size 42"
                  className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 text-xs font-mono"
                />
              </div>

              {/* Quick sample chips */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  "১০১ ২টা নিবো ০১৭xxxxxxxx",
                  "102 red jamdani 018xxxxxxxx",
                  "103 3pcs size XL",
                  "POLO 1 ta nibo",
                ].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => setSimComment(sample)}
                    className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
                  >
                    + {sample}
                  </button>
                ))}
              </div>

              <button type="submit" className="btn-primary w-full py-2.5 text-xs font-bold shadow-sm">
                ⚡ পার্স ও অর্ডার তৈরি করুন
              </button>
            </form>

            {simFeedback ? (
              <p
                className={`mt-3 rounded-lg p-2 text-center text-xs font-bold ${
                  simFeedback.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                }`}
              >
                {simFeedback}
              </p>
            ) : null}

            {/* Parsed Result Preview Card */}
            {simResult ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-3.5 shadow-sm space-y-2.5">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="font-bold text-xs text-slate-800">ম্যাচিং ফলাফল:</span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800">
                    #{simResult.keywordMatched} কনফার্মড
                  </span>
                </div>

                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">পণ্য:</span>
                    <span className="font-semibold text-slate-800">{simResult.rule.productName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">পরিমাণ:</span>
                    <span className="font-bold">{simResult.quantity} টি</span>
                  </div>
                  {simResult.extractedSize ? (
                    <div className="flex justify-between">
                      <span className="text-slate-500">সাইজ:</span>
                      <span className="font-bold text-indigo-600">{simResult.extractedSize}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <span className="text-slate-500">গ্রাহকের ফোন:</span>
                    <span className="font-mono font-bold text-emerald-700">{simResult.customerPhone || "নেই"}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1 font-bold">
                    <span>মোট প্রদেয়:</span>
                    <span className="text-indigo-700">
                      ৳{((Number(simResult.totalPriceMinor) || 0) / 100).toLocaleString("en-IN")}
                    </span>
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 p-2 text-[10px] font-mono break-all text-slate-600">
                  {simResult.checkoutUrl}
                </div>

                <div className="flex gap-2 pt-1">
                  {simResult.customerPhone ? (
                    <button
                      type="button"
                      onClick={() => openWhatsAppLink(simResult)}
                      className="btn-primary flex-1 py-1.5 text-[11px] font-bold"
                    >
                      💬 WhatsApp-এ পাঠান
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => copyCheckoutUrl(simResult.checkoutUrl)}
                    className="flex-1 rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {copiedLink === simResult.checkoutUrl ? "✓ লিংক কপিড!" : "📋 লিংক কপি"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Quick Setup Guide Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs space-y-2">
            <h4 className="font-bold text-slate-800">💡 লাইভ সেলিং সফল করার নিয়মাবলী:</h4>
            <ul className="list-disc pl-4 space-y-1 text-slate-600 text-[11px]">
              <li>লাইভ চলাকালে লাইভ স্ক্রিনে পণ্যের কোড (যেমন: &quot;Code: 101&quot;) লিখে রাখুন।</li>
              <li>গ্রাহকদের বলুন: &quot;অর্ডার করতে কোড, পরিমাণ ও ফোন নম্বর লিখে কমেন্ট করুন&quot;।</li>
              <li>অটো-পার্সার তাৎক্ষণিকভাবে মেসেঞ্জার বা হোয়াটসঅ্যাপে চেকআউট লিংক পাঠিয়ে দেবে।</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Add Keyword Rule Modal */}
      {showAddRuleModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-bold text-slate-900">🏷️ নতুন লাইভ প্রডাক্ট কি-ওয়ার্ড যোগ করুন</h3>
              <button
                type="button"
                onClick={() => setShowAddRuleModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddRule} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700">কি-ওয়ার্ড / ট্রিগার কোড</label>
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder="যেমন: 104, PANJABI, DRESS-RED"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 uppercase font-mono font-bold"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700">পণ্যের নাম</label>
                <input
                  type="text"
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  placeholder="যেমন: ডিজাইনার শিফন শাড়ি"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-medium"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700">লাইভ মূল্য (৳)</label>
                  <input
                    type="number"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    placeholder="1250"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700">লাইভ স্টক সংখ্যা</label>
                  <input
                    type="number"
                    value={newStock}
                    onChange={(e) => setNewStock(e.target.value)}
                    placeholder="20"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-semibold"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700">SKU কোড (ঐচ্ছিক)</label>
                <input
                  type="text"
                  value={newSku}
                  onChange={(e) => setNewSku(e.target.value)}
                  placeholder="SKU-104"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono"
                />
              </div>

              <div className="flex gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddRuleModal(false)}
                  className="flex-1 rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  বাতিল
                </button>
                <button type="submit" className="btn-primary flex-1 py-2 text-xs font-semibold">
                  যোগ করুন
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
