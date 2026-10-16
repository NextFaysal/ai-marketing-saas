"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_LABEL,
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_LABEL,
  DEFAULT_TEMPLATES,
  TEMPLATE_VARIABLES,
  calculateSmsSegments,
  renderNotificationTemplate,
  generateWhatsAppTrackingShareUrl,
  type NotificationChannelKey,
  type NotificationEventKey,
} from "@/lib/orders-on5";

interface EventConfig {
  enabled: boolean;
  channels: NotificationChannelKey[];
  templates: {
    sms: string | null;
    whatsapp: string | null;
    email: string | null;
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

const DEFAULT_SAMPLE_DATA: SampleOrderData = {
  customerName: "তানভীর আহমেদ",
  orderNumber: "ORD-9421",
  total: "৳1,850",
  due: "৳1,850",
  trackingUrl: "https://shop.com/track/tk_982ab1",
  shopName: "স্মার্ট লাইফস্টাইল",
  courierName: "Steadfast",
  trackingCode: "ST-8829104",
  rescheduleDate: "২০২৬-১০-১৮",
  phone: "01712345678",
};

export default function OrderNotificationsPage() {
  const [config, setConfig] = useState<NotificationConfig | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<NotificationEventKey>("handed_to_courier");
  const [activeChannel, setActiveChannel] = useState<NotificationChannelKey>("whatsapp");
  const [sampleData, setSampleData] = useState<SampleOrderData>(DEFAULT_SAMPLE_DATA);
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
      setError(err instanceof Error ? err.message : "নোটিফিকেশন সেটিংস লোড করা সম্ভব হয়নি");
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
    return DEFAULT_TEMPLATES[selectedEvent] ?? "";
  }, [currentEventConfig, selectedEvent, activeChannel]);

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

    setConfig({
      ...config,
      [selectedEvent]: {
        ...ev,
        templates: {
          ...ev.templates,
          [activeChannel]: text === "" ? null : text,
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
      setNotice("✅ নোটিফিকেশন টেমপ্লেট ও সেটিংস সফলভাবে সংরক্ষিত হয়েছে!");
      setTimeout(() => setNotice(""), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "সেটিংস সংরক্ষণ ব্যর্থ হয়েছে");
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
              SMS ও কুরিয়ার ট্র্যাকিং নোটিফিকেশন ইঞ্জিন
            </h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            অর্ডারের প্রতিটি ধাপে (কনফার্মেশন, প্যাকিং, কুরিয়ার হ্যান্ডওভার, আউট ফর ডেলিভারি ও রিসিভ) স্বয়ংক্রিয় SMS ও WhatsApp ট্র্যাকিং নোটিফিকেশন পাঠান।
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600">
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-800 border border-emerald-200">
              ✓ Steadfast, Pathao, RedX সাপোর্টেড
            </span>
            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-indigo-800 border border-indigo-200">
              ⚡ অটো-ফলব্যাক: SMS ➔ WhatsApp ➔ Email
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-900 border border-amber-200">
              🔒 ডুপ্লিকেট সেন্ট প্রোটেকশন
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/orders"
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
          >
            অর্ডার ড্যাশবোর্ড ↗
          </Link>

          <button
            type="button"
            onClick={handleSaveSettings}
            disabled={saving || loading || !config}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-extrabold text-white shadow-md shadow-indigo-600/25 hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {saving ? "সংরক্ষণ হচ্ছে..." : "💾 কনফিগারেশন সংরক্ষণ করুন"}
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
              <span>১. কুরিয়ার ও ডেলিভারি লাইফসাইকেল ইভেন্ট নির্বাচন করুন</span>
              {currentEventConfig && (
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold">
                  <span className={currentEventConfig.enabled ? "text-emerald-700" : "text-slate-400"}>
                    {currentEventConfig.enabled ? "সক্রিয় (Active)" : "নিষ্ক্রিয় (Disabled)"}
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
                      <span className="text-xs truncate">{NOTIFICATION_EVENT_LABEL[eventKey]}</span>
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${
                          isEnabled ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                        title={isEnabled ? "এই ইভেন্টে নোটিফিকেশন চালু" : "বন্ধ"}
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
                  ২. {NOTIFICATION_EVENT_LABEL[selectedEvent]} — মেসেজ টেমপ্লেট
                </h3>
                <p className="text-[11px] text-slate-500">
                  গ্রাহকের কাছে পাঠানোর জন্য চ্যানেলভিত্তিক বার্তা কাস্টমাইজ করুন
                </p>
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
                      <span>{NOTIFICATION_CHANNEL_LABEL[ch]}</span>
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
                  ডেলিভারি চেষ্টা করার ক্রম (Fallback Priority):
                </span>
                <span className="text-[11px] text-slate-500">
                  প্রথমটি ব্যর্থ হলে পরেরটি চেষ্টা করা হবে
                </span>
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
                      <span>{NOTIFICATION_CHANNEL_LABEL[ch]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dynamic Token Pill Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">
                  ডায়নামিক ভ্যারিয়েবল (ক্লিক করে টেমপ্লেটে যোগ করুন):
                </label>
                <button
                  type="button"
                  onClick={handleResetToDefault}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 underline"
                >
                  ডিফল্ট টেমপ্লেটে ফিরুন
                </button>
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
                placeholder="মেসেজ টেমপ্লেট লিখুন..."
                className="w-full rounded-2xl border border-slate-300 p-3.5 text-xs text-slate-900 leading-relaxed focus:border-indigo-500 focus:outline-hidden"
              />
            </div>

            {/* SMS Realtime Cost & Segment Counter */}
            {activeChannel === "sms" && (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5 space-y-1 text-xs">
                <div className="flex items-center justify-between font-bold text-indigo-950">
                  <span>📊 SMS সেগমেন্ট ও ক্রেডিট হিসাব:</span>
                  <span className="font-mono text-indigo-700">
                    {smsStats.segments} টি SMS ({smsStats.chars} অক্ষর)
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                  <span>
                    ধরন: <strong>{smsStats.isUnicode ? "বাংলা (Unicode 70 char/part)" : "ইংরেজি (GSM-7 160 char/part)"}</strong>
                  </span>
                  <span>
                    আনুমানিক খরচ: ~৳{(smsStats.segments * 0.35).toFixed(2)} / বার্তা
                  </span>
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
                <span>📱 লাইভ কাস্টমার মেসেজ প্রিভিউ</span>
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
                  <span className="text-emerald-700 font-normal">এখনই</span>
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
                  <span>💬 SMS বার্তা</span>
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
                <span>WhatsApp-এ টেস্ট ↗</span>
              </a>

              <button
                type="button"
                onClick={handleCopyMessage}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white p-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
              >
                <span>{copied ? "✓ কপি হয়েছে!" : "📋 টেক্সট কপি"}</span>
              </button>
            </div>
          </div>

          {/* Test Receiver Phone & Sample Variables Customizer */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <h4 className="text-xs font-bold text-slate-900">
              🛠️ টেস্ট ডাটা কাস্টমাইজার (প্রিভিউয়ের জন্য):
            </h4>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  গ্রাহকের নাম:
                </label>
                <input
                  type="text"
                  value={sampleData.customerName}
                  onChange={(e) => setSampleData({ ...sampleData, customerName: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-1.5 text-xs"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  অর্ডার নম্বর:
                </label>
                <input
                  type="text"
                  value={sampleData.orderNumber}
                  onChange={(e) => setSampleData({ ...sampleData, orderNumber: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  কুরিয়ারের নাম:
                </label>
                <input
                  type="text"
                  value={sampleData.courierName}
                  onChange={(e) => setSampleData({ ...sampleData, courierName: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-1.5 text-xs"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  ট্র্যাকিং কোড:
                </label>
                <input
                  type="text"
                  value={sampleData.trackingCode}
                  onChange={(e) => setSampleData({ ...sampleData, trackingCode: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-1.5 text-xs font-mono"
                />
              </div>

              <div className="col-span-2">
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                  টেস্ট ফোন নম্বর (১১ ডিজিট):
                </label>
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
