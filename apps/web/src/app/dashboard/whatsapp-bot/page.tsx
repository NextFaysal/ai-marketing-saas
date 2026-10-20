"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka } from "@/lib/storefront-money";
import {
  DEFAULT_BOT_CONFIG,
  type WhatsAppBotConfig,
  type WhatsAppProductItem,
  formatWhatsAppProductSnippet,
  generateWhatsAppClickToChatUrl,
  parseCustomerOrderDetails,
  generateWhatsAppOrderSummaryReceipt,
  normalizeBdPhoneNumber,
} from "@/lib/whatsapp-catalog-bot";
import { useLocale } from "@/lib/i18n/provider";
import { fmtTime, fmtNumber } from "@repo/contracts";

interface ProductRow {
  id: string;
  name: string;
  priceMinor: string;
  compareAtMinor?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  slug?: string | null;
}

interface ChatMessage {
  id: string;
  sender: "bot" | "user";
  text: string;
  time: string;
  isReceipt?: boolean;
}

export default function WhatsAppBotPage() {
  const { t, locale } = useLocale();
  const [config, setConfig] = useState<WhatsAppBotConfig>(DEFAULT_BOT_CONFIG);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"bot" | "catalog" | "ctwa" | "parser">("bot");

  // CTWA Link Generator
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [customCtwaText, setCustomCtwaText] = useState("");
  const [copiedCtwa, setCopiedCtwa] = useState(false);
  const [copiedSnippetId, setCopiedSnippetId] = useState<string | null>(null);

  // Address Parser Interactive Test
  const [rawCustomerMsg, setRawCustomerMsg] = useState(() => t("messaging.waSampleMsg"));
  const [parserProductId, setParserProductId] = useState<string>("");
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<any>(null);
  const [orderError, setOrderError] = useState("");

  // Settings Save State
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState("");
  const [saveErrorMsg, setSaveErrorMsg] = useState("");

  // Phone Simulator State
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [simInput, setSimInput] = useState("");
  const [orderCount, setOrderCount] = useState(1);

  // Load products and shop settings
  const loadProducts = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoading(true);
    try {
      const [res, sf] = await Promise.all([
        apiFetch<{ items: ProductRow[] }>(
          `/organizations/${orgId}/products?pageSize=50`
        ).catch(() => ({ items: [] as ProductRow[] })),
        apiFetch<{ setting?: { whatsappNumber?: string | null } }>(
          `/organizations/${orgId}/storefront`
        ).catch(() => null),
      ]);
      const items = res.items || [];
      setProducts(items);
      if (items.length > 0) {
        setSelectedProductId(items[0].id);
        setParserProductId(items[0].id);
        setCustomCtwaText(t("messaging.waCtwaText", { name: items[0].name }));
      }

      // Restore saved bot config or phone number
      try {
        const cached = localStorage.getItem(`wa_bot_config_${orgId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          setConfig((prev) => ({ ...prev, ...parsed }));
        }
      } catch {
        // ignore JSON parse error
      }

      if (sf?.setting?.whatsappNumber) {
        setConfig((prev) => ({ ...prev, businessPhone: sf.setting?.whatsappNumber || prev.businessPhone }));
      }
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  // Save Settings handler
  async function handleSaveSettings() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSavingSettings(true);
    setSaveSuccessMsg("");
    setSaveErrorMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          whatsappNumber: config.businessPhone.trim() || null,
        }),
      });
      try {
        localStorage.setItem(`wa_bot_config_${orgId}`, JSON.stringify(config));
      } catch {
        // ignore
      }
      setSaveSuccessMsg(t("messaging.waSaved"));
      setTimeout(() => setSaveSuccessMsg(""), 4000);
    } catch (err) {
      setSaveErrorMsg(err instanceof Error ? err.message : t("messaging.waSaveFailed"));
    } finally {
      setSavingSettings(false);
    }
  }

  // Real Order Creation handler from Parsed Chat
  async function handleCreateRealOrder(parsed: { customerName?: string | null; phone?: string | null; address?: string | null }) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!parsed.phone) {
      setOrderError(t("messaging.waNoPhone"));
      return;
    }

    const targetProduct = products.find((p) => p.id === (parserProductId || selectedProductId)) || products[0];
    if (!targetProduct) {
      setOrderError(t("messaging.waNoProduct"));
      return;
    }

    setCreatingOrder(true);
    setOrderError("");
    setOrderSuccess(null);
    try {
      const res = await apiFetch<any>(`/organizations/${orgId}/orders`, {
        method: "POST",
        body: JSON.stringify({
          customerPhone: parsed.phone,
          customerName: parsed.customerName || "WhatsApp Customer",
          address: parsed.address || undefined,
          externalRef: `WA-${Date.now().toString(36).toUpperCase()}`,
          isCod: true,
          currency: "BDT",
          items: [
            {
              name: targetProduct.name,
              quantity: 1,
              unitPriceMinor: Number(targetProduct.priceMinor) || 0,
              sku: targetProduct.slug || undefined,
            },
          ],
        }),
      });
      setOrderSuccess(res);
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : t("messaging.waOrderFailed"));
    } finally {
      setCreatingOrder(false);
    }
  }

  // Initialize Simulator Chat
  useEffect(() => {
    const now = fmtTime(locale, new Date());
    setChatLog([
      {
        id: "msg-1",
        sender: "bot",
        text: `${config.welcomeMessage}\n\n1️⃣ ${config.menuOptions[0]?.label || ""}\n2️⃣ ${config.menuOptions[1]?.label || ""}\n3️⃣ ${config.menuOptions[2]?.label || ""}\n4️⃣ ${config.menuOptions[3]?.label || ""}`,
        time: now,
      },
    ]);
  }, [config.welcomeMessage, config.menuOptions]);

  // Handle Simulator Send
  function handleSimulatorSend(customText?: string) {
    const msg = customText || simInput.trim();
    if (!msg) return;

    const now = fmtTime(locale, new Date());
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: msg,
      time: now,
    };

    setChatLog((prev) => [...prev, userMsg]);
    if (!customText) setSimInput("");

    // Simulate Bot Intelligence
    setTimeout(() => {
      const botTime = fmtTime(locale, new Date());
      let botResponse = "";
      let isReceipt = false;

      const lower = msg.toLowerCase();

      // Check for catalog request
      if (lower.includes("1") || lower.includes("ক্যাটালগ") || lower.includes("প্রডাক্ট")) {
        const topProd = products[0];
        if (topProd) {
          botResponse = formatWhatsAppProductSnippet(topProd, t("messaging.waDemoStore"), topProd.slug || undefined, locale);
        } else {
          botResponse = t("messaging.waCatalogFallback");
        }
      } else if (lower.includes("2") || lower.includes("অফার") || lower.includes("ধামাকা")) {
        botResponse = `${t("messaging.waOfferResponse")}\n\n${config.orderPromptMessage}`;
      } else if (lower.includes("3") || lower.includes("ট্র্যাক") || lower.includes("অবস্থা")) {
        botResponse = t("messaging.waTrackResponse");
      } else if (lower.includes("4") || lower.includes("প্রতিনিধি") || lower.includes("কথা")) {
        botResponse = t("messaging.waHumanResponse");
      } else {
        // Attempt to parse order details
        const parsed = parseCustomerOrderDetails(msg);
        if (parsed.phone) {
          isReceipt = true;
          const targetProd = products[0] || { name: t("messaging.waFallbackProduct"), priceMinor: "125000" };
          botResponse = generateWhatsAppOrderSummaryReceipt({
            orderNumber: `WA-${1000 + orderCount}`,
            customerName: parsed.customerName || t("messaging.waFallbackCustomer"),
            phone: parsed.phone,
            address: parsed.address || t("messaging.waFallbackAddress"),
            productName: targetProd.name,
            quantity: 1,
            totalMinor: Number(targetProd.priceMinor) + 6000,
            deliveryChargeMinor: 6000,
          }, locale);
          setOrderCount((c) => c + 1);
        } else {
          botResponse = `${t("messaging.waThanksPrefix")}\n\n${config.orderPromptMessage}`;
        }
      }

      setChatLog((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: "bot",
          text: botResponse,
          time: botTime,
          isReceipt,
        },
      ]);
    }, 600);
  }

  // Copy helpers
  async function copyToClipboard(text: string, setter: (val: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text);
      setter(true);
      setTimeout(() => setter(false), 2000);
    } catch {
      // fallback
    }
  }

  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const ctwaUrl = generateWhatsAppClickToChatUrl(config.businessPhone, customCtwaText);
  const parsedPreview = parseCustomerOrderDetails(rawCustomerMsg);

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-emerald-500/10 p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-600 text-white font-bold text-lg shadow-xs">
                💬
              </span>
              <h1 className="text-xl font-black text-slate-900">
                {t("messaging.waTitle")}
              </h1>
            </div>
            <p className="mt-1 text-xs text-slate-600 max-w-2xl">
              {t("messaging.waIntro")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/inbox"
              className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
            >
              {t("messaging.waLiveInbox")}
            </Link>
            <Link
              href="/dashboard/messaging"
              className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
            >
              {t("messaging.waBroadcast")}
            </Link>
          </div>
        </div>
      </div>

      {/* Main Studio Grid: Left Studio Tabs & Right WhatsApp Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (7 cols): Studio Tabs */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          {/* Navigation Bar */}
          <div className="flex border-b border-slate-200 bg-slate-50/80 px-4 pt-3 gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab("bot")}
              className={`border-b-2 pb-2.5 px-3 text-xs font-bold transition ${
                activeTab === "bot"
                  ? "border-emerald-600 text-emerald-900"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {t("messaging.waTabBot")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("catalog")}
              className={`border-b-2 pb-2.5 px-3 text-xs font-bold transition ${
                activeTab === "catalog"
                  ? "border-emerald-600 text-emerald-900"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {t("messaging.waTabCatalog")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("ctwa")}
              className={`border-b-2 pb-2.5 px-3 text-xs font-bold transition ${
                activeTab === "ctwa"
                  ? "border-emerald-600 text-emerald-900"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {t("messaging.waTabCtwa")}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("parser")}
              className={`border-b-2 pb-2.5 px-3 text-xs font-bold transition ${
                activeTab === "parser"
                  ? "border-emerald-600 text-emerald-900"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {t("messaging.waTabParser")}
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Tab 1: Bot Setup */}
            {activeTab === "bot" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {t("messaging.waBusinessNumber")}
                    </label>
                    <input
                      type="text"
                      value={config.businessPhone}
                      onChange={(e) => setConfig({ ...config, businessPhone: e.target.value })}
                      placeholder="017XXXXXXXX"
                      className="w-full rounded-xl border border-slate-300 p-2 text-xs font-mono font-bold text-slate-800"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      {t("messaging.waNumberNote")}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {t("messaging.waBotNameLabel")}
                    </label>
                    <input
                      type="text"
                      value={config.botName}
                      onChange={(e) => setConfig({ ...config, botName: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 p-2 text-xs font-bold text-slate-800"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t("messaging.waWelcomeLabel")}
                  </label>
                  <textarea
                    rows={3}
                    value={config.welcomeMessage}
                    onChange={(e) => setConfig({ ...config, welcomeMessage: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-2">
                    {t("messaging.waMenuLabel")}
                  </label>
                  <div className="space-y-2">
                    {config.menuOptions.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-700">
                          {i + 1}
                        </span>
                        <input
                          type="text"
                          value={opt.label}
                          onChange={(e) => {
                            const next = [...config.menuOptions];
                            next[i] = { ...next[i], label: e.target.value };
                            setConfig({ ...config, menuOptions: next });
                          }}
                          className="flex-1 rounded-lg border border-slate-300 p-1.5 text-xs font-semibold text-slate-800"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t("messaging.waCodPromptLabel")}
                  </label>
                  <textarea
                    rows={3}
                    value={config.orderPromptMessage}
                    onChange={(e) => setConfig({ ...config, orderPromptMessage: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-800"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    {t("messaging.waCodPromptNote")}
                  </p>
                </div>

                {/* Save Bot Settings CTA Button */}
                <div className="pt-2 border-t border-slate-200 space-y-2">
                  {saveSuccessMsg ? (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-300 p-2.5 text-xs font-bold text-emerald-800">
                      {saveSuccessMsg}
                    </div>
                  ) : null}
                  {saveErrorMsg ? (
                    <div className="rounded-xl bg-rose-50 border border-rose-300 p-2.5 text-xs font-bold text-rose-800">
                      {saveErrorMsg}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={handleSaveSettings}
                    disabled={savingSettings}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white shadow-md hover:bg-black transition disabled:opacity-50"
                  >
                    {savingSettings ? t("messaging.waSavingSettings") : t("messaging.waSaveSettings")}
                  </button>
                </div>
              </div>
            )}

            {/* Tab 2: Catalog Fast Share */}
            {activeTab === "catalog" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-700">
                    {t("messaging.waCatalogTitle", { count: fmtNumber(locale, products.length) })}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    {t("messaging.waCatalogHint")}
                  </span>
                </div>

                {loading ? (
                  <div className="space-y-2">
                    <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
                    <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
                  </div>
                ) : products.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">{t("messaging.waNoProducts")}</p>
                ) : (
                  <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
                    {products.map((p) => {
                      const snippet = formatWhatsAppProductSnippet(p, t("messaging.waDemoStore"), p.slug || undefined, locale);
                      return (
                        <div
                          key={p.id}
                          className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {p.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={p.imageUrl}
                                alt={p.name}
                                className="h-12 w-12 rounded-lg object-cover border border-slate-200"
                              />
                            ) : (
                              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-200 text-lg">
                                🛍️
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-slate-900 truncate">{p.name}</p>
                              <p className="text-xs font-black text-emerald-700">
                                {formatMinorTaka(p.priceMinor)}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                handleSimulatorSend(t("messaging.waViewDetailsMsg", { name: p.name }));
                              }}
                              className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
                            >
                              {t("messaging.waTestInChat")}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await copyToClipboard(snippet, () => setCopiedSnippetId(p.id));
                                setTimeout(() => setCopiedSnippetId(null), 2000);
                              }}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                            >
                              {copiedSnippetId === p.id ? t("messaging.waCopied") : t("messaging.waCopySnippet")}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: Click-to-WhatsApp Link Generator */}
            {activeTab === "ctwa" && (
              <div className="space-y-4">
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 leading-relaxed">
                  {t("messaging.waCtwaNote")}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t("messaging.waSelectProduct")}
                  </label>
                  <select
                    value={selectedProductId}
                    onChange={(e) => {
                      setSelectedProductId(e.target.value);
                      const p = products.find((x) => x.id === e.target.value);
                      if (p) {
                        setCustomCtwaText(t("messaging.waCtwaText", { name: p.name }));
                      }
                    }}
                    className="w-full rounded-xl border border-slate-300 p-2 text-xs font-semibold text-slate-800"
                  >
                    <option value="">{t("messaging.waGeneralEnquiry")}</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t("messaging.waPrefilledLabel")}
                  </label>
                  <textarea
                    rows={2}
                    value={customCtwaText}
                    onChange={(e) => setCustomCtwaText(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t("messaging.waCtwaLinkLabel")}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={ctwaUrl}
                      className="w-full rounded-xl border border-slate-300 p-2 text-xs font-mono text-slate-800 bg-slate-50"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(ctwaUrl, setCopiedCtwa)}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shrink-0"
                    >
                      {copiedCtwa ? t("messaging.waCopied") : t("messaging.waCopyLink")}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <a
                    href={ctwaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:underline"
                  >
                    <span>💬</span> {t("messaging.waTestDirectly")}
                  </a>
                </div>
              </div>
            )}

            {/* Tab 4: Address & Order Parser */}
            {activeTab === "parser" && (
              <div className="space-y-4">
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 leading-relaxed">
                  {t("messaging.waParserNote")}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t("messaging.waRawMsgLabel")}
                  </label>
                  <textarea
                    rows={3}
                    value={rawCustomerMsg}
                    onChange={(e) => setRawCustomerMsg(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-800"
                  />
                </div>

                {/* Parsed Output Card */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700">{t("messaging.waExtractedTitle")}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        parsedPreview.confidence === "high"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {t("messaging.waConfidence")}: {parsedPreview.confidence === "high" ? t("messaging.waConfidenceHigh") : t("messaging.waConfidencePartial")}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-slate-400 block text-[10px]">{t("messaging.waCustomerNameLabel")}</span>
                      <strong className="text-slate-900">{parsedPreview.customerName || t("messaging.waNotDetected")}</strong>
                    </div>

                    <div className="bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-slate-400 block text-[10px]">{t("messaging.waPhoneLabel")}</span>
                      <strong className="text-slate-900 font-mono">{parsedPreview.phone || t("messaging.waNotDetected")}</strong>
                    </div>

                    <div className="sm:col-span-2 bg-white p-2 rounded-lg border border-slate-200">
                      <span className="text-slate-400 block text-[10px]">{t("messaging.waAddressLabel")}</span>
                      <strong className="text-slate-900">{parsedPreview.address || t("messaging.waNotDetected")}</strong>
                    </div>
                  </div>

                  {/* Product Picker for Real Order */}
                  <div className="pt-2 border-t border-slate-200 space-y-1.5">
                    <label className="block text-xs font-bold text-slate-700">
                      {t("messaging.waOrderProductLabel")}
                    </label>
                    <select
                      value={parserProductId}
                      onChange={(e) => setParserProductId(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 p-2 text-xs bg-white text-slate-800"
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({formatMinorTaka(p.priceMinor)})
                        </option>
                      ))}
                    </select>
                  </div>

                  {orderSuccess ? (
                    <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 space-y-1.5">
                      <div className="font-bold flex items-center gap-1.5 text-emerald-800">
                        <span>🎉</span>
                        <span>{t("messaging.waOrderCreated")}</span>
                      </div>
                      <p>
                        {t("messaging.waTrackingRef")}{" "}
                        <strong className="font-mono">{orderSuccess.orderNumber || orderSuccess.id?.slice(0, 8)}</strong>
                      </p>
                      <Link
                        href="/dashboard/orders"
                        className="inline-block mt-1 font-bold text-emerald-700 underline hover:text-emerald-900"
                      >
                        {t("messaging.waViewOrders")}
                      </Link>
                    </div>
                  ) : null}

                  {orderError ? (
                    <div className="rounded-xl border border-rose-300 bg-rose-50 p-2.5 text-xs font-bold text-rose-800">
                      {orderError}
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => handleCreateRealOrder(parsedPreview)}
                      disabled={creatingOrder}
                      className="rounded-xl bg-emerald-600 p-2.5 text-xs font-extrabold text-white hover:bg-emerald-700 shadow-md transition disabled:opacity-50 text-center"
                    >
                      {creatingOrder ? t("messaging.waCreatingOrder") : t("messaging.waCreateOrder")}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSimulatorSend(rawCustomerMsg)}
                      className="rounded-xl border border-slate-300 bg-white p-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition text-center"
                    >
                      {t("messaging.waTestInSimulator")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (5 cols): Authentic Realtime WhatsApp Phone Simulator */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <p className="text-xs font-bold text-slate-600 mb-2">
            {t("messaging.waSimulatorTitle")}
          </p>

          <div className="w-[360px] rounded-[36px] border-4 border-slate-800 bg-slate-900 p-2 shadow-2xl overflow-hidden">
            {/* Phone Screen */}
            <div className="rounded-[26px] bg-[#efeae2] h-[600px] flex flex-col overflow-hidden relative">
              {/* WhatsApp Header */}
              <div className="bg-[#075e54] text-white p-3 flex items-center justify-between shrink-0 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-700 text-white font-bold text-sm">
                    🛍️
                  </div>
                  <div>
                    <h4 className="text-xs font-bold leading-none">{config.botName}</h4>
                    <span className="text-[10px] text-emerald-200 flex items-center gap-1 mt-0.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 inline-block" />
                      {t("messaging.waOnline")}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-sm text-emerald-100">
                  <span>📞</span>
                  <span>⋮</span>
                </div>
              </div>

              {/* Chat Message Scroll Area */}
              <div className="flex-1 p-3 overflow-y-auto space-y-2.5 scrollbar-thin">
                {chatLog.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl p-2.5 text-xs shadow-xs leading-relaxed whitespace-pre-line ${
                        msg.sender === "user"
                          ? "bg-[#d9fdd3] text-slate-900 rounded-tr-xs"
                          : msg.isReceipt
                          ? "bg-white border-2 border-emerald-400 text-slate-900 rounded-tl-xs"
                          : "bg-white text-slate-900 rounded-tl-xs"
                      }`}
                    >
                      {msg.text}
                      <span className="text-[9px] text-slate-400 block text-right mt-1">
                        {msg.time} {msg.sender === "user" ? "✓✓" : ""}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick Reply Pills */}
              <div className="p-1.5 bg-[#f0f2f5]/90 border-t border-slate-200 flex items-center gap-1.5 overflow-x-auto text-[11px] shrink-0">
                <button
                  type="button"
                  onClick={() => handleSimulatorSend("1")}
                  className="rounded-full bg-white px-2.5 py-1 font-semibold text-emerald-800 border border-slate-200 shadow-2xs shrink-0"
                >
                  {t("messaging.waQuickCatalog")}
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulatorSend("2")}
                  className="rounded-full bg-white px-2.5 py-1 font-semibold text-emerald-800 border border-slate-200 shadow-2xs shrink-0"
                >
                  {t("messaging.waQuickOffer")}
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulatorSend("3")}
                  className="rounded-full bg-white px-2.5 py-1 font-semibold text-emerald-800 border border-slate-200 shadow-2xs shrink-0"
                >
                  {t("messaging.waQuickTrack")}
                </button>
              </div>

              {/* Chat Input Bar */}
              <div className="bg-[#f0f2f5] p-2 flex items-center gap-1.5 shrink-0 border-t border-slate-200">
                <input
                  type="text"
                  value={simInput}
                  onChange={(e) => setSimInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSimulatorSend();
                  }}
                  placeholder={t("messaging.waMessagePlaceholder")}
                  className="flex-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => handleSimulatorSend()}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#00a884] text-white text-sm shadow-xs hover:bg-[#008f6f]"
                >
                  ➤
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
