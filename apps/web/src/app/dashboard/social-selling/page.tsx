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
import { fmtMoney, fmtMoneyMinor, fmtNumber, fmtTime } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

export default function SocialSellingPage() {
  const { t, locale } = useLocale();
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
    return fmtMoneyMinor(locale, totalMinor);
  }, [capturedOrders, locale]);

  const handleSimulate = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!simComment.trim()) return;

    const parsed = parseLiveComment(simComment, rules, "আমাদের শপ", undefined, locale);
    setSimResult(parsed);

    if (parsed) {
      setSimFeedback(t("social.ssSimOk"));
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
      setSimFeedback(t("social.ssSimFail"));
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
      alert(t("social.ssNoPhoneAlert"));
      return;
    }
    const clean = convertBnDigitsToEn(order.customerPhone).replace(/[^0-9]/g, "");
    const msg = order.whatsappReplyMessage || t("social.ssWaFallback", { product: order.rule.productName, url: order.checkoutUrl });
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
            <h1 className="page-title">{t("social.ssTitle")}</h1>
            {isLiveActive ? (
              <span className="flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-0.5 text-xs font-bold text-red-700 animate-pulse">
                <span className="h-2 w-2 rounded-full bg-red-600" /> {t("social.ssLiveActive", { time: formatTimer(liveDurationSeconds) })}
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                {t("social.ssLiveEnded")}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">{t("social.ssSub")}</p>
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
            {isLiveActive ? t("social.ssEndLive") : t("social.ssStartLive")}
          </button>
        </div>
      </div>

      {/* Realtime Live KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card border-l-4 border-l-red-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("social.ssKpiSalesLabel")}</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{totalGmv}</p>
          <p className="mt-1 text-xs text-emerald-600 font-medium">{t("social.ssKpiSalesSub")}</p>
        </div>

        <div className="card border-l-4 border-l-blue-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("social.ssKpiOrdersLabel")}</p>
          <p className="mt-1 text-2xl font-black text-blue-700">{t("social.ssCountItems", { count: fmtNumber(locale, capturedOrders.length) })}</p>
          <p className="mt-1 text-xs text-slate-500">{t("social.ssKpiOrdersSub")}</p>
        </div>

        <div className="card border-l-4 border-l-emerald-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("social.ssKpiKeywordsLabel")}</p>
          <p className="mt-1 text-2xl font-black text-emerald-700">{t("social.ssCountItems", { count: fmtNumber(locale, rules.filter((r) => r.isActive).length) })}</p>
          <p className="mt-1 text-xs text-slate-500">{t("social.ssKpiKeywordsSub")}</p>
        </div>

        <div className="card border-l-4 border-l-purple-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("social.ssKpiConvLabel")}</p>
          <p className="mt-1 text-2xl font-black text-purple-700">{fmtNumber(locale, 84.2, { maximumFractionDigits: 1 })}%</p>
          <p className="mt-1 text-xs text-purple-600 font-medium">{t("social.ssKpiConvSub")}</p>
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
                <h3 className="text-sm font-bold text-slate-900">{t("social.ssKwTitle")}</h3>
                <p className="text-xs text-slate-500">{t("social.ssKwSub")}</p>
              </div>
              <button
                onClick={() => setShowAddRuleModal(true)}
                className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
              >
                {t("social.ssAddKeyword")}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {rules.map((rule) => {
                const priceTaka = fmtMoney(locale, Number(rule.priceMinor) / 100);
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
                          {t("social.ssStock", { count: fmtNumber(locale, rule.stockQuantity) })}
                        </span>
                      </div>
                      <h4 className="mt-2 text-xs font-bold text-slate-800 truncate">{rule.productName}</h4>
                      <p className="text-[11px] text-slate-500">SKU: {rule.sku}</p>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                      <span className="font-extrabold text-slate-900">{priceTaka}</span>
                      <span className="text-[10px] text-indigo-600">
                        {t("social.ssExample", { kw: rule.keyword })}
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
                <h3 className="text-sm font-bold text-slate-900">{t("social.ssOrdersTitle", { count: fmtNumber(locale, capturedOrders.length) })}</h3>
                <p className="text-xs text-slate-500">{t("social.ssOrdersSub")}</p>
              </div>
              <button
                onClick={() => {
                  const csv = capturedOrders
                    .map(
                      (o) =>
                        `"${o.rule.productName}",${o.quantity},"${o.customerPhone || ""}",${fmtMoney(locale, Number(o.totalPriceMinor) / 100)},"${o.rawComment}"`
                    )
                    .join("\n");
                  const blob = new Blob([`${t("social.ssCsvHeader")}\n${csv}`], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `live-orders-${Date.now()}.csv`;
                  a.click();
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
              >
                {t("social.ssCsvDownload")}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50 font-semibold text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3">{t("social.ssThComment")}</th>
                    <th className="py-2.5 px-3">{t("social.ssThProduct")}</th>
                    <th className="py-2.5 px-3">{t("social.ssThQty")}</th>
                    <th className="py-2.5 px-3">{t("social.ssThPhone")}</th>
                    <th className="py-2.5 px-3">{t("social.ssThTotal")}</th>
                    <th className="py-2.5 px-3 text-right">{t("social.ssThAction")}</th>
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
                          {fmtTime(locale, ord.createdAt)}
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
                        <span className="font-bold text-slate-800">{t("social.ssQtyValue", { count: fmtNumber(locale, ord.quantity) })}</span>
                        {ord.extractedSize ? (
                          <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-bold">
                            {t("social.ssSizePrefix", { size: ord.extractedSize })}
                          </span>
                        ) : null}
                      </td>

                      <td className="py-3 px-3">
                        {ord.customerPhone ? (
                          <span className="font-mono text-emerald-700 font-semibold">{ord.customerPhone}</span>
                        ) : (
                          <span className="text-[10px] text-amber-600 italic">{t("social.ssWaitingPhone")}</span>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <span className="font-bold text-slate-900">
                          {fmtMoney(locale, (Number(ord.totalPriceMinor) || 0) / 100)}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {ord.customerPhone ? (
                            <button
                              onClick={() => openWhatsAppLink(ord)}
                              title={t("social.ssWaTitle")}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                            >
                              <span>💬</span> WhatsApp
                            </button>
                          ) : null}
                          <button
                            onClick={() => copyCheckoutUrl(ord.checkoutUrl)}
                            title={t("social.ssCopyTitle")}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            {copiedLink === ord.checkoutUrl ? t("social.ssLinkCopied") : t("social.ssLink")}
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
                <h3 className="text-sm font-bold text-slate-900">{t("social.ssSimTitle")}</h3>
                <p className="text-[11px] text-slate-500">{t("social.ssSimSub")}</p>
              </div>
            </div>

            <form onSubmit={handleSimulate} className="mt-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700">{t("social.ssAuthorLabel")}</label>
                <input
                  type="text"
                  value={simAuthor}
                  onChange={(e) => setSimAuthor(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700">{t("social.ssCommentLabel")}</label>
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
                {t("social.ssParseBtn")}
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
                  <span className="font-bold text-xs text-slate-800">{t("social.ssResultTitle")}</span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800">
                    {t("social.ssConfirmed", { kw: simResult.keywordMatched })}
                  </span>
                </div>

                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t("social.ssProductLabel")}</span>
                    <span className="font-semibold text-slate-800">{simResult.rule.productName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t("social.ssQtyLabel")}</span>
                    <span className="font-bold">{t("social.ssQtyValue", { count: fmtNumber(locale, simResult.quantity) })}</span>
                  </div>
                  {simResult.extractedSize ? (
                    <div className="flex justify-between">
                      <span className="text-slate-500">{t("social.ssSizeLabel")}</span>
                      <span className="font-bold text-indigo-600">{simResult.extractedSize}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t("social.ssPhoneLabel")}</span>
                    <span className="font-mono font-bold text-emerald-700">{simResult.customerPhone || t("social.ssNone")}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1 font-bold">
                    <span>{t("social.ssTotalDue")}</span>
                    <span className="text-indigo-700">
                      {fmtMoney(locale, (Number(simResult.totalPriceMinor) || 0) / 100)}
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
                      {t("social.ssSendWa")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => copyCheckoutUrl(simResult.checkoutUrl)}
                    className="flex-1 rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {copiedLink === simResult.checkoutUrl ? t("social.ssCopiedBang") : t("social.ssCopyLink")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Quick Setup Guide Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs space-y-2">
            <h4 className="font-bold text-slate-800">{t("social.ssTipsTitle")}</h4>
            <ul className="list-disc pl-4 space-y-1 text-slate-600 text-[11px]">
              <li>{t("social.ssTip1")}</li>
              <li>{t("social.ssTip2")}</li>
              <li>{t("social.ssTip3")}</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Add Keyword Rule Modal */}
      {showAddRuleModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-bold text-slate-900">{t("social.ssModalTitle")}</h3>
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
                <label className="block font-semibold text-slate-700">{t("social.ssKwLabel")}</label>
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder={t("social.ssKwPlaceholder")}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 uppercase font-mono font-bold"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700">{t("social.ssProductNameLabel")}</label>
                <input
                  type="text"
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  placeholder={t("social.ssProductNamePlaceholder")}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-medium"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700">{t("social.ssPriceLabel")}</label>
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
                  <label className="block font-semibold text-slate-700">{t("social.ssStockLabel")}</label>
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
                <label className="block font-semibold text-slate-700">{t("social.ssSkuLabel")}</label>
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
                  {t("common.cancel")}
                </button>
                <button type="submit" className="btn-primary flex-1 py-2 text-xs font-semibold">
                  {t("common.add")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
