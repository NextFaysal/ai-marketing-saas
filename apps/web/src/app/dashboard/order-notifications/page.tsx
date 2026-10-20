"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  TEMPLATE_VARIABLES,
  notificationEventLabel,
  notificationChannelLabel,
  defaultTemplates,
  calculateSmsSegments,
  renderNotificationTemplate,
  generateWhatsAppTrackingShareUrl,
  type NotificationChannelKey,
  type NotificationEventKey,
} from "@/lib/orders-on5";

/**
 * MB5 (ML14): a channel template override is either a plain
 * string (one generic override for every recipient locale) or
 * the merchant's own per-locale variants { bn?, en? } — the API
 * config shape since ML14. The editor edits the variant for the
 * CURRENT UI locale and preserves the other locale's entry
 * untouched; it never flattens an object into a string.
 */
type TemplateOverride =
  | string
  | Partial<Record<"bn" | "en", string | null>>
  | null;

interface EventConfig {
  enabled: boolean;
  channels: NotificationChannelKey[];
  templates: {
    sms: TemplateOverride;
    whatsapp: TemplateOverride;
    email: TemplateOverride;
  };
}

type NotificationConfig = Record<NotificationEventKey, EventConfig>;

interface SampleOrderData {
  customerName: string;
  orderNumber: string;
  total: string;
  due: string;
  trackingUrl: string;
  shopName: string;
  courierName: string;
  trackingCode: string;
  rescheduleDate: string;
  phone: string;
}

// ML5 i18n: the localized sample fields come from dict.orders at
// state init; the rest are locale-neutral sample identifiers.
const DEFAULT_SAMPLE_DATA: Omit<
  SampleOrderData,
  "customerName" | "total" | "due" | "shopName" | "rescheduleDate"
> = {
  orderNumber: "ORD-9421",
  trackingUrl: "https://shop.com/track/tk_982ab1",
  courierName: "Steadfast",
  trackingCode: "ST-8829104",
  phone: "01712345678",
};

export default function OrderNotificationsPage() {
  const { dict, t, locale } = useLocale();
  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<NotificationEventKey>("handed_to_courier");
  const [activeChannel, setActiveChannel] = useState<NotificationChannelKey>("whatsapp");
  const [sampleData, setSampleData] = useState<SampleOrderData>(() => ({
    ...DEFAULT_SAMPLE_DATA,
    customerName: dict.orders.tanvirAhmed,
    total: dict.orders.text1y7ppz9,
    due: dict.orders.text1y7ppz9,
    shopName: dict.orders.smartLifestyle,
    rescheduleDate: dict.orders.textpq8gwa,
  }));
  const [previewChannel, setPreviewChannel] = useState<"whatsapp" | "sms">("whatsapp");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  // Load notification settings from backend
  const loadSettings = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<NotificationConfig>(
        `/organizations/${orgId}/orders/notification-settings`
      );
      setConfig(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.orders.couldNotLoadNotificationSettings);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Current event config
  const currentEventConfig = useMemo(() => {
    if (!config) return null;
    return config[selectedEvent] ?? null;
  }, [config, selectedEvent]);

  // Current template text
  const currentTemplate = useMemo(() => {
    if (!currentEventConfig) return "";
    const override = currentEventConfig.templates[activeChannel];
    if (typeof override === "string" && override.trim()) {
      return override;
    }
    if (override && typeof override === "object") {
      // MB5 (ML14): per-locale variant object — show THIS UI
      // locale's variant; when the merchant has not written one
      // for this locale, the platform default for the locale
      // shows (the other locale's variant stays untouched in
      // state and is never displayed as this locale's text).
      const variant = override[locale];
      if (typeof variant === "string" && variant.trim()) {
        return variant;
      }
    }
    return defaultTemplates(locale)[selectedEvent] ?? "";
  }, [currentEventConfig, selectedEvent, activeChannel, locale]);

  // Rendered preview text with sample variables
  const renderedMessage = useMemo(() => {
    return renderNotificationTemplate(currentTemplate, {
      customerName: sampleData.customerName,
      orderNumber: sampleData.orderNumber,
      total: sampleData.total,
      due: sampleData.due,
      trackingUrl: sampleData.trackingUrl,
      shopName: sampleData.shopName,
      courierName: sampleData.courierName,
      trackingCode: sampleData.trackingCode,
      rescheduleDate: sampleData.rescheduleDate,
    });
  }, [currentTemplate, sampleData]);

  // SMS character & segment calculation
  const smsStats = useMemo(() => {
    return calculateSmsSegments(renderedMessage);
  }, [renderedMessage]);

  // WhatsApp click-to-chat preview link
  const waShareUrl = useMemo(() => {
    return generateWhatsAppTrackingShareUrl(sampleData.phone, renderedMessage);
  }, [sampleData.phone, renderedMessage]);

  // Handle template text change
  function handleTemplateChange(text: string) {
    if (!config) return;
    const ev = config[selectedEvent];
    if (!ev) return;

    // MB5 (ML14): when the stored override is a per-locale
    // variant object, the edit lands on the CURRENT UI locale's
    // entry only — the other locale's variant is preserved
    // verbatim (never silently flattened into a plain string).
    const existing = ev.templates[activeChannel];
    const nextOverride: TemplateOverride =
      existing && typeof existing === "object"
        ? { ...existing, [locale]: text === "" ? null : text }
        : text === ""
          ? null
          : text;

    setConfig({
      ...config,
      [selectedEvent]: {
        ...ev,
        templates: {
          ...ev.templates,
          [activeChannel]: nextOverride,
        },
      },
    });
  }

  // Handle insert variable token at cursor or append
  function handleInsertToken(token: string) {
    const next = `${currentTemplate} {{${token}}}`.trim();
    handleTemplateChange(next);
  }

  // Toggle event enabled
  function handleToggleEvent(enabled: boolean) {
    if (!config) return;
    const ev = config[selectedEvent];
    if (!ev) return;
    setConfig({
      ...config,
      [selectedEvent]: {
        ...ev,
        enabled,
      },
    });
  }

  // Toggle channel in order priority list
  function handleToggleChannel(channel: NotificationChannelKey) {
    if (!config) return;
    const ev = config[selectedEvent];
    if (!ev) return;

    let nextChannels: NotificationChannelKey[];
    if (ev.channels.includes(channel)) {
      nextChannels = ev.channels.filter((c) => c !== channel);
    } else {
      nextChannels = [...ev.channels, channel];
    }

    setConfig({
      ...config,
      [selectedEvent]: {
        ...ev,
        channels: nextChannels,
      },
    });
  }

  // Reset current template to system default
  function handleResetToDefault() {
    handleTemplateChange("");
  }

  // Save settings to backend API
  async function handleSaveSettings() {
    const orgId = getOrganizationId();
    if (!orgId || !config) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiFetch<NotificationConfig>(
        `/organizations/${orgId}/orders/notification-settings`,
        {
          method: "PUT",
          body: JSON.stringify({ config }),
        }
      );
      setNotice(dict.orders.notificationTemplatesSettingsSavedSuccessfully);
      setTimeout(() => setNotice(""), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.orders.settingsSaveFailed2);
    } finally {
      setSaving(false);
    }
  }

  // Copy rendered message
  async function handleCopyMessage() {
    try {
      await navigator.clipboard.writeText(renderedMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Overview */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700 text-lg">
              🔔
            </span>
            <h1 className="text-xl font-black text-slate-900 sm:text-2xl">
              {dict.orders.sMSCourierTrackingNotificationEngine}</h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {dict.orders.sendAutomaticSMSWhatsAppTracking}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600">
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-800 border border-emerald-200">
              {dict.orders.steadfastPathaoRedXSupported}</span>
            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-indigo-800 border border-indigo-200">
              {dict.orders.autoFallbackSMSWhatsAppEmail}</span>
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-900 border border-amber-200">
              {dict.orders.duplicateSendProtection}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/orders"
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
          >
            {dict.orders.orderDashboard}</Link>

          <button
            type="button"
            onClick={handleSaveSettings}
            disabled={saving || loading || !config}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-extrabold text-white shadow-md shadow-indigo-600/25 hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {saving ? dict.orders.saving2 : dict.orders.saveConfiguration}
          </button>
        </div>
      </div>

      {notice ? (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-xs font-bold text-emerald-800 shadow-sm animate-fade-in">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-xs font-bold text-rose-800 shadow-sm animate-fade-in">
          {error}
        </div>
      ) : null}

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (7 cols): Event Selector & Template Studio */}
        <div className="lg:col-span-7 space-y-6">
          {/* 1. Courier Lifecycle Event Selector */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center justify-between">
              <span>{dict.orders.text8z5j17}</span>
              {currentEventConfig && (
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold">
                  <span className={currentEventConfig.enabled ? "text-emerald-700" : "text-slate-400"}>
                    {currentEventConfig.enabled ? dict.orders.active3 : dict.orders.disabled}
                  </span>
                  <input
                    type="checkbox"
                    checked={currentEventConfig.enabled}
                    onChange={(e) => handleToggleEvent(e.target.checked)}
                    className="h-4 w-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                </label>
              )}
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {NOTIFICATION_EVENTS.map((eventKey) => {
                const isSelected = selectedEvent === eventKey;
                const isEnabled = config?.[eventKey]?.enabled ?? false;
                return (
                  <button
                    key={eventKey}
                    type="button"
                    onClick={() => setSelectedEvent(eventKey)}
                    className={`p-2.5 rounded-2xl border text-left transition relative ${
                      isSelected
                        ? "border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-600 text-indigo-950 font-bold shadow-xs"
                        : "border-slate-200 bg-white hover:border-slate-300 text-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs truncate">{notificationEventLabel(eventKey, locale)}</span>
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${
                          isEnabled ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                        title={isEnabled ? dict.orders.notificationOnForThisEvent : dict.orders.off}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Channel Prioritization & Template Editor */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {dict.orders.text1op2}{notificationEventLabel(selectedEvent, locale)} {dict.orders.messageTemplate}</h3>
                <p className="text-[11px] text-slate-500">
                  {dict.orders.customizeChannelWiseMessagesTo}</p>
              </div>

              {/* Channel Selector Tabs */}
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                {NOTIFICATION_CHANNELS.map((ch) => {
                  const active = activeChannel === ch;
                  const isConfiguredInPriority = currentEventConfig?.channels.includes(ch) ?? false;
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setActiveChannel(ch)}
                      className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                        active
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      <span>{notificationChannelLabel(ch, locale)}</span>
                      {isConfiguredInPriority && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Delivery Sequence Priority Toggles */}
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">
                  {dict.orders.deliveryFallbackOrderFallbackPriority}</span>
                <span className="text-[11px] text-slate-500">
                  {dict.orders.ifTheFirstFailsThe}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {NOTIFICATION_CHANNELS.map((ch) => {
                  const on = currentEventConfig?.channels.includes(ch) ?? false;
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => handleToggleChannel(ch)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition ${
                        on
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "bg-white text-slate-500 border border-slate-300 hover:border-slate-400"
                      }`}
                    >
                      <span>{on ? "✓" : "+"}</span>
                      <span>{notificationChannelLabel(ch, locale)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dynamic Token Pill Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">
                  {dict.orders.dynamicVariablesClickToAdd}</label>
                <button
                  type="button"
                  onClick={handleResetToDefault}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline"
                >
                  {dict.orders.backToDefaultTemplate}</button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_VARIABLES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => handleInsertToken(v)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-800 transition"
                  >
                    +{`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Textarea Template Editor */}
            <div>
              <textarea
                rows={5}
                value={currentTemplate}
                onChange={(e) => handleTemplateChange(e.target.value)}
                placeholder={dict.orders.writeTheMessageTemplate}
                className="w-full rounded-2xl border border-slate-300 p-3.5 text-xs text-slate-900 leading-relaxed focus:border-indigo-500 focus:outline-hidden"
              />
            </div>

            {/* SMS Realtime Cost & Segment Counter */}
            {activeChannel === "sms" && (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5 space-y-1 text-xs">
                <div className="flex items-center justify-between font-bold text-indigo-950">
                  <span>{dict.orders.sMSSegmentCreditCalculation}</span>
                  <span className="font-mono text-indigo-700">
                    {smsStats.segments} {dict.orders.sMS}{smsStats.chars} {dict.orders.characters}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                  <span>
                    {dict.orders.type2}<strong>{smsStats.isUnicode ? dict.orders.bengaliUnicode70CharPart : dict.orders.englishGSM7160Char}</strong>
                  </span>
                  <span>
                    {dict.orders.estimatedCost}{(smsStats.segments * 0.35).toFixed(2)} {dict.orders.message}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (5 cols): Live Phone Simulator & Quick Send Test */}
        <div className="lg:col-span-5 space-y-6">
          {/* Preview Channel Toggle */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <span>{dict.orders.liveCustomerMessagePreview}</span>
              </h3>
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setPreviewChannel("whatsapp")}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    previewChannel === "whatsapp"
                      ? "bg-emerald-600 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewChannel("sms")}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    previewChannel === "sms"
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  SMS
                </button>
              </div>
            </div>

            {/* Mock Phone Bubble Display */}
            {previewChannel === "whatsapp" ? (
              <div className="rounded-2xl bg-[#efeae2] p-4 border border-emerald-200 space-y-2">
                <div className="flex items-center justify-between border-b border-emerald-900/10 pb-2 text-[11px] text-emerald-950 font-semibold">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#00a884] text-white text-xs">
                      🟢
                    </span>
                    <span>{sampleData.shopName}</span>
                  </div>
                  <span className="text-emerald-700 font-normal">{dict.orders.now}</span>
                </div>

                <div className="rounded-2xl rounded-tl-xs bg-white p-3 text-xs leading-relaxed text-slate-900 shadow-xs whitespace-pre-line">
                  {renderedMessage}
                  <span className="mt-1 block text-right text-[9px] text-slate-400">
                    10:45 AM ✓✓
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-100 p-4 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2 text-[11px] text-slate-700 font-semibold">
                  <span>{dict.orders.sMSMessage}</span>
                  <span className="text-slate-500 font-mono text-[10px]">{sampleData.phone}</span>
                </div>

                <div className="rounded-2xl rounded-tl-xs bg-indigo-600 p-3 text-xs leading-relaxed text-white shadow-xs whitespace-pre-line">
                  {renderedMessage}
                </div>
              </div>
            )}

            {/* Test Send & Copy Action Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <a
                href={waShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-xl bg-[#25D366] p-2.5 text-xs font-extrabold text-white shadow-md hover:bg-[#20ba5a] transition text-center"
              >
                <span>{dict.orders.testOnWhatsApp}</span>
              </a>

              <button
                type="button"
                onClick={handleCopyMessage}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white p-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
              >
                <span>{copied ? dict.orders.copied2 : dict.orders.copyText}</span>
              </button>
            </div>
          </div>

          {/* Test Receiver Phone & Sample Variables Customizer */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <h4 className="text-xs font-bold text-slate-900">
              {dict.orders.testDataCustomizerForPreview}</h4>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  {dict.orders.customerName}</label>
                <input
                  type="text"
                  value={sampleData.customerName}
                  onChange={(e) => setSampleData({ ...sampleData, customerName: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-1.5 text-xs"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  {dict.orders.orderNumber}</label>
                <input
                  type="text"
                  value={sampleData.orderNumber}
                  onChange={(e) => setSampleData({ ...sampleData, orderNumber: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  {dict.orders.courierName}</label>
                <input
                  type="text"
                  value={sampleData.courierName}
                  onChange={(e) => setSampleData({ ...sampleData, courierName: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-1.5 text-xs"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  {dict.orders.trackingCode2}</label>
                <input
                  type="text"
                  value={sampleData.trackingCode}
                  onChange={(e) => setSampleData({ ...sampleData, trackingCode: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-1.5 text-xs font-mono"
                />
              </div>

              <div className="col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  {dict.orders.testPhoneNumber11Digits}</label>
                <input
                  type="text"
                  value={sampleData.phone}
                  onChange={(e) => setSampleData({ ...sampleData, phone: e.target.value })}
                  placeholder="017XXXXXXXX"
                  className="w-full rounded-lg border border-slate-300 p-1.5 text-xs font-mono"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
