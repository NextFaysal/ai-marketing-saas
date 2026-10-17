"use client";
import React, { useState, useMemo } from "react";
import {
  BROADCAST_SEGMENTS,
  FESTIVAL_BROADCAST_TEMPLATES,
  BroadcastSegmentKey,
  FestivalBroadcastTemplate,
  simulateBroadcastBlast,
  calculateSmsParts,
  hasOptOutStopWord,
  appendOptOutNotice,
  interpolateFestivalTemplate,
} from "@/lib/festival-broadcast";
import { FestivalKey } from "@/lib/festival-playbook";

interface FestivalBlastHubProps {
  storeName?: string;
  storeUrl?: string;
  onApplyTemplate: (data: {
    name: string;
    channel: "sms" | "whatsapp";
    body: string;
    audienceType: string;
    audienceSegment?: string;
  }) => void;
}

export function FestivalBlastHub({
  storeName = "আমাদের শপ",
  storeUrl = "https://yourshop.com",
  onApplyTemplate,
}: FestivalBlastHubProps) {
  const [selectedFestival, setSelectedFestival] = useState<FestivalKey>("eid_ul_fitr");
  const [selectedSegment, setSelectedSegment] = useState<BroadcastSegmentKey>("vip_champions");
  const [selectedChannel, setSelectedChannel] = useState<"sms" | "whatsapp">("sms");
  const [audienceSize, setAudienceSize] = useState<number>(3000);
  const [expectedAov, setExpectedAov] = useState<number>(1800);
  const [activeTemplateId, setActiveTemplateId] = useState<string>("eid_early_bird");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [customCoupon, setCustomCoupon] = useState<string>("");

  // Filter templates for current festival
  const festivalTemplates = useMemo(() => {
    return FESTIVAL_BROADCAST_TEMPLATES.filter((t) => t.festivalKey === selectedFestival);
  }, [selectedFestival]);

  // Active template
  const currentTemplate = useMemo(() => {
    return (
      festivalTemplates.find((t) => t.id === activeTemplateId) ||
      festivalTemplates[0] ||
      FESTIVAL_BROADCAST_TEMPLATES[0]
    );
  }, [festivalTemplates, activeTemplateId]);

  // Interpolated text
  const messageBody = useMemo(() => {
    if (!currentTemplate) return "";
    return interpolateFestivalTemplate(currentTemplate.bodyBn, {
      storeName,
      shopUrl: storeUrl,
      discountCode: customCoupon || currentTemplate.suggestedCoupon,
    });
  }, [currentTemplate, storeName, storeUrl, customCoupon]);

  // Simulation
  const simulation = useMemo(() => {
    return simulateBroadcastBlast({
      channel: selectedChannel,
      audienceSize,
      messageText: messageBody,
      expectedAovBdt: expectedAov,
      estimatedConversionRatePercent: selectedSegment === "vip_champions" ? 4.5 : 2.5,
    });
  }, [selectedChannel, audienceSize, messageBody, expectedAov, selectedSegment]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleApply = () => {
    if (!currentTemplate) return;

    let segmentMapping = "at_risk";
    if (selectedSegment === "vip_champions") segmentMapping = "champions";
    else if (selectedSegment === "inactive_60_days") segmentMapping = "lost";
    else if (selectedSegment === "repeat_cod") segmentMapping = "loyal";

    onApplyTemplate({
      name: `🎉 [${currentTemplate.festivalName}] ${currentTemplate.title}`,
      channel: selectedChannel,
      body: messageBody,
      audienceType: "customers",
      audienceSegment: segmentMapping,
    });
  };

  return (
    <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/60 via-orange-50/40 to-pink-50/30 p-5 shadow-sm space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-amber-200/70 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 text-white font-bold text-lg shadow-sm">
              📢
            </span>
            <h2 className="text-lg font-bold text-slate-900">
              উৎসব ও মেগা সেল ক্যাম্পেইন ব্লাস্ট ইঞ্জিন (Festival Broadcast Engine)
            </h2>
          </div>
          <p className="text-xs text-slate-600 max-w-2xl">
            ঈদ, বৈশাখ, ১১.১১ ও শীতের মেগা সেলে টার্গেটেড গ্রাহকদের কাছে হাই-কনভার্সন WhatsApp ও SMS ক্যাম্পেইন ব্লাস্ট পাঠান।
            BTRC রেগুলেশন মান্য করে তাৎক্ষণিক বাজেট, সম্ভাব্য সেলস ও ROAS সিমুলেট করুন।
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-100 border border-amber-300 px-3 py-1 text-[11px] font-bold text-amber-900">
            🇧🇩 BD স্পেশাল প্লেবুক
          </span>
          <span className="rounded-full bg-emerald-100 border border-emerald-300 px-3 py-1 text-[11px] font-bold text-emerald-900">
            ⚡ 1-ক্লিক কম্পোজার
          </span>
        </div>
      </div>

      {/* Festival Selector Tabs */}
      <div className="flex flex-wrap gap-2 text-xs font-semibold">
        {[
          { key: "eid_ul_fitr", label: "🌙 ঈদ-উল-ফিতর", count: 4 },
          { key: "eid_ul_adha", label: "🥩 কোরবানি ঈদ", count: 1 },
          { key: "pohela_boishakh", label: "🪕 পহেলা বৈশাখ", count: 1 },
          { key: "black_friday_11_11", label: "🔥 ১১.১১ ও ব্ল্যাক ফ্রাইডে", count: 1 },
          { key: "winter_clearance", label: "❄️ উইন্টার ক্লিয়ারেন্স", count: 1 },
        ].map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setSelectedFestival(f.key as FestivalKey);
              const first = FESTIVAL_BROADCAST_TEMPLATES.find((t) => t.festivalKey === f.key);
              if (first) {
                setActiveTemplateId(first.id);
                setSelectedChannel(first.channel === "whatsapp" ? "whatsapp" : "sms");
              }
            }}
            className={`rounded-xl px-3.5 py-2 transition ${
              selectedFestival === f.key
                ? "bg-amber-600 text-white shadow-sm"
                : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Main Grid: Templates & Audience Segment on Left, Simulation on Right */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Templates & Target Segments (7 cols) */}
        <div className="space-y-4 lg:col-span-7">
          {/* Target Customer Segments */}
          <div className="card p-4 space-y-2.5 border border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900">🎯 টার্গেটেড কাস্টমার সেগমেন্ট বেছে নিন:</span>
              <span className="text-[11px] text-slate-400">সর্বোচ্চ আরওআই পেতে অডিয়েন্স ভাগ করুন</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {BROADCAST_SEGMENTS.map((seg) => (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => setSelectedSegment(seg.id)}
                  className={`text-left p-2.5 rounded-xl border transition ${
                    selectedSegment === seg.id
                      ? "border-amber-500 bg-amber-50/60 shadow-xs"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="font-bold text-slate-900">{seg.label}</div>
                  <div className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">{seg.description}</div>
                  <div className="text-[10px] text-indigo-600 font-semibold mt-1">
                    পরামর্শ: {seg.suggestedDiscount}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Template Cards */}
          <div className="space-y-3">
            <span className="text-xs font-bold text-slate-900">
              📝 উৎসবের রেডিমেড কপি ও টেমপ্লেট ({festivalTemplates.length}টি উপলব্ধ):
            </span>

            <div className="space-y-2.5">
              {festivalTemplates.map((t) => (
                <div
                  key={t.id}
                  onClick={() => {
                    setActiveTemplateId(t.id);
                    setSelectedChannel(t.channel === "whatsapp" ? "whatsapp" : "sms");
                  }}
                  className={`cursor-pointer rounded-xl border p-3.5 transition space-y-2 ${
                    activeTemplateId === t.id
                      ? "border-amber-500 bg-amber-50/50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{t.title}</span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 uppercase">
                        {t.channel === "whatsapp" ? "🟢 WhatsApp" : "📱 SMS"}
                      </span>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                      ~{t.estimatedRoas}x ROAS
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-2 font-mono whitespace-pre-wrap">
                    {t.bodyBn}
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-100">
                    <span>পর্যায়: <strong className="text-slate-600">{t.phaseLabel}</strong></span>
                    <span>সুপারিশকৃত কুপন: <code className="font-bold text-amber-800">{t.suggestedCoupon}</code></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Live Blast Simulator & Message Preview (5 cols) */}
        <div className="space-y-4 lg:col-span-5">
          <div className="card p-5 border border-slate-200 bg-slate-900 text-white space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] uppercase font-bold text-amber-400">ক্যাম্পেইন বাজেট ও আরওআই সিমুলেটর</span>
                <h3 className="text-sm font-bold text-white">লাইভ ডেলিভারি প্রজেকশন</h3>
              </div>
              <span className="rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2.5 py-0.5 text-[11px] font-bold">
                {simulation.projectedRoas}x প্রজেক্টেড ROAS
              </span>
            </div>

            {/* Inputs */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  চ্যানেল নির্বাচন:
                </label>
                <select
                  value={selectedChannel}
                  onChange={(e) => setSelectedChannel(e.target.value as "sms" | "whatsapp")}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white focus:outline-none"
                >
                  <option value="sms">📱 SMS (SSL / BulkSMS)</option>
                  <option value="whatsapp">🟢 WhatsApp Cloud API</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  গ্রাহক সংখ্যা (Audience):
                </label>
                <input
                  type="number"
                  step={500}
                  min={100}
                  value={audienceSize}
                  onChange={(e) => setAudienceSize(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white focus:outline-none font-bold"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  গড় অর্ডার মূল্য (AOV ৳):
                </label>
                <input
                  type="number"
                  step={100}
                  min={200}
                  value={expectedAov}
                  onChange={(e) => setExpectedAov(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white focus:outline-none font-bold"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  কুপন কোড (ঐচ্ছিক):
                </label>
                <input
                  type="text"
                  placeholder={currentTemplate?.suggestedCoupon || "EIDSPECIAL"}
                  value={customCoupon}
                  onChange={(e) => setCustomCoupon(e.target.value.toUpperCase())}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-xs text-white uppercase focus:outline-none font-bold"
                />
              </div>
            </div>

            {/* Live Metrics Grid */}
            <div className="grid grid-cols-2 gap-2.5 text-xs pt-1">
              <div className="rounded-xl bg-slate-800/80 p-2.5 border border-slate-700/60">
                <div className="text-[10px] text-slate-400">বার্তা পার্টস / খরচ</div>
                <div className="text-sm font-bold text-amber-300">
                  {selectedChannel === "sms" ? `${simulation.smsPartsPerMessage} পার্ট (৳${simulation.costPerRecipientBdt})` : `১ মেসেজ (৳০.৮৫)`}
                </div>
              </div>

              <div className="rounded-xl bg-slate-800/80 p-2.5 border border-slate-700/60">
                <div className="text-[10px] text-slate-400">মোট ব্লাস্ট বাজেট</div>
                <div className="text-sm font-bold text-white">৳{simulation.totalCampaignCostBdt.toLocaleString()}</div>
              </div>

              <div className="rounded-xl bg-slate-800/80 p-2.5 border border-slate-700/60">
                <div className="text-[10px] text-slate-400">প্রত্যাশিত অর্ডার সংখ্যা</div>
                <div className="text-sm font-bold text-indigo-400">{simulation.expectedConversions} টি অর্ডার</div>
              </div>

              <div className="rounded-xl bg-slate-800/80 p-2.5 border border-slate-700/60">
                <div className="text-[10px] text-slate-400">প্রত্যাশিত গ্রস রেভিনিউ</div>
                <div className="text-sm font-bold text-emerald-400">৳{simulation.expectedRevenueBdt.toLocaleString()}</div>
              </div>
            </div>

            {/* BTRC Opt-out Badge */}
            <div className="flex items-center justify-between rounded-lg bg-slate-800/50 p-2 text-[11px] border border-slate-700/50">
              <span className="text-slate-400">BTRC অপ্ট-আউট চেক:</span>
              <span className={`font-semibold ${simulation.hasOptOutStopWord ? "text-emerald-400" : "text-amber-400"}`}>
                {simulation.hasOptOutStopWord ? "✓ STOP শব্দ অন্তর্ভুক্ত (Compliant)" : "⚠️ STOP নির্দেশিকা নেই"}
              </span>
            </div>

            {/* Message Preview */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>প্রিভিউ ({simulation.charCount} অক্ষর):</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(messageBody, "preview-copy")}
                  className="text-amber-400 hover:underline font-semibold"
                >
                  {copiedId === "preview-copy" ? "✓ কপি হয়েছে!" : "📋 কপি করুন"}
                </button>
              </div>
              <textarea
                readOnly
                rows={5}
                value={messageBody}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs font-mono text-slate-200 focus:outline-none"
              />
            </div>

            {/* Launch / Apply into Composer Button */}
            <button
              type="button"
              onClick={handleApply}
              className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 py-3 text-xs font-bold text-white shadow-md hover:opacity-95 transition flex items-center justify-center gap-2"
            >
              <span>🚀</span>
              <span>এই ক্যাম্পেইনটি ব্রডকাস্ট কম্পোজারে লোড করুন</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
