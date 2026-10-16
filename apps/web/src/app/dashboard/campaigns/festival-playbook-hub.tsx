"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  FESTIVAL_PLAYBOOKS,
  type FestivalKey,
  type FestivalPlaybook,
  calculateCourierCutoff,
} from "@/lib/festival-playbook";

interface AdAccount {
  id: string;
  name: string;
  platform: string;
}

interface FestivalPlaybookHubProps {
  accounts: AdAccount[];
  onCampaignCreated?: () => void;
}

export function FestivalPlaybookHub({ accounts, onCampaignCreated }: FestivalPlaybookHubProps) {
  const router = useRouter();
  const [selectedFestivalKey, setSelectedFestivalKey] = useState<FestivalKey>("eid_ul_fitr");
  const playbook: FestivalPlaybook = FESTIVAL_PLAYBOOKS[selectedFestivalKey];

  // Courier Cutoff Interactive State
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 14);
  const [targetDateStr, setTargetDateStr] = useState<string>(
    defaultDate.toISOString().slice(0, 10)
  );

  // Campaign Creation State
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id || "");
  const [dailyBudget, setDailyBudget] = useState<number>(playbook.suggestedDailyBudgetBDT);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedCutoff, setCopiedCutoff] = useState(false);

  // Recalculate cutoff
  const targetDate = new Date(targetDateStr);
  const cutoffResult = calculateCourierCutoff(
    playbook.name,
    targetDate,
    playbook.courierLeadDaysOutsideDhaka,
    playbook.courierLeadDaysInsideDhaka
  );

  // Handle switching festival
  function handleSelectFestival(key: FestivalKey) {
    setSelectedFestivalKey(key);
    setDailyBudget(FESTIVAL_PLAYBOOKS[key].suggestedDailyBudgetBDT);
    setNotice("");
    setError("");
  }

  // Copy ad copy
  async function copyText(text: string, index?: number) {
    try {
      await navigator.clipboard.writeText(text);
      if (typeof index === "number") {
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
      } else {
        setCopiedCutoff(true);
        setTimeout(() => setCopiedCutoff(false), 2000);
      }
    } catch {
      // fallback
    }
  }

  // 1-Click Launch Campaign Draft
  async function handleLaunchDraft() {
    const orgId = getOrganizationId();
    if (!orgId) {
      setError("সংগঠন শনাক্ত করা যায়নি");
      return;
    }
    if (!selectedAccountId) {
      setError("অনুগ্রহ করে একটি Meta Ad Account নির্বাচন করুন");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const planName = `${playbook.icon} ${playbook.name} — ${new Date().getFullYear()}`;
      const res = await apiFetch<{ id: string; name: string }>(
        `/organizations/${orgId}/campaign-plans`,
        {
          method: "POST",
          body: JSON.stringify({
            name: planName,
            objective: "OUTCOME_SALES",
            adAccountId: selectedAccountId,
            budgetMode: "cbo",
            campaignDailyBudget: String(dailyBudget),
          }),
        }
      );

      setNotice(`ক্যাম্পেইন ড্রাফট তৈরি হয়েছে: "${res.name}"। বিল্ডারে রিডাইরেক্ট করা হচ্ছে...`);
      onCampaignCreated?.();
      setTimeout(() => {
        router.push(`/dashboard/campaign-builder?planId=${res.id}`);
      }, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ড্রাফট তৈরি ব্যর্থ হয়েছে");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-500/10 via-rose-500/10 to-amber-500/10 p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-rose-500 text-white font-bold text-lg shadow-xs">
                🎉
              </span>
              <h2 className="text-xl font-black text-slate-900">
                উৎসব ও ফ্ল্যাশ-সেল ক্যাম্পেইন প্লেবুক (BD Special)
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-600 max-w-2xl">
              বাংলাদেশি ই-কমার্সের ৭টি শীর্ষ উৎসবের সম্পূর্ণ মিডিয়া বাইং স্ট্র্যাটেজি, পর্যায়ভিত্তিক বাজেট বণ্টন, কুরিয়ার কাট-অফ ডেডলাইন এবং রেডিমেড বাংলা অ্যাড কপি।
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-700 border border-amber-200 shadow-xs">
              🇧🇩 ৭টি স্থানীয় উৎসব
            </span>
            <span className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-slate-700 border border-amber-200 shadow-xs">
              🚚 কুরিয়ার কাট-অফ রেডি
            </span>
          </div>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs font-bold text-emerald-800">
          ✓ {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-xs font-bold text-rose-800">
          ❌ {error}
        </div>
      )}

      {/* Festival Selector Grid */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2.5">
          ১. উৎসব বা বিশেষ ক্যাম্পেইন বেছে নিন:
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {(Object.keys(FESTIVAL_PLAYBOOKS) as FestivalKey[]).map((key) => {
            const p = FESTIVAL_PLAYBOOKS[key];
            const isSelected = selectedFestivalKey === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleSelectFestival(key)}
                className={`flex flex-col text-left p-3.5 rounded-2xl border transition-all ${
                  isSelected
                    ? "border-amber-500 bg-amber-50/70 ring-2 ring-amber-400 shadow-sm"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-xl">{p.icon}</span>
                  <span className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded-md px-1.5 py-0.5">
                    {p.seasonBangla.split("(")[0].trim()}
                  </span>
                </div>
                <h4 className="mt-2 text-xs font-black text-slate-900 line-clamp-1">{p.name}</h4>
                <p className="mt-0.5 text-[11px] text-slate-500">AOV: {p.targetAovRange}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Festival Strategy Details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (8 cols): Phases & Budget Split & Copies */}
        <div className="lg:col-span-8 space-y-6">
          {/* Festival Overview Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{playbook.icon}</span>
                  <h3 className="text-lg font-black text-slate-900">{playbook.name}</h3>
                </div>
                <p className="text-xs text-slate-600 mt-1">{playbook.tagline}</p>
              </div>

              <div className="text-right">
                <span className="text-[11px] font-bold text-slate-400 block">প্রত্যাশিত AOV</span>
                <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                  {playbook.targetAovRange}
                </span>
              </div>
            </div>

            {/* Target Niches */}
            <div>
              <p className="text-xs font-bold text-slate-700 mb-1.5">সেরা ক্যাটাগরি ও প্রোডাক্ট:</p>
              <div className="flex flex-wrap gap-1.5">
                {playbook.targetNiches.map((n, i) => (
                  <span
                    key={i}
                    className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700"
                  >
                    🏷️ {n}
                  </span>
                ))}
              </div>
            </div>

            {/* Budget Allocation Strategy Bar */}
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>📊 প্রস্তাবিত মিডিয়া বাইং বাজেট বণ্টন:</span>
                <span className="text-amber-700">দৈনিক ৳{dailyBudget.toLocaleString()}</span>
              </div>

              <div className="h-4 w-full rounded-full overflow-hidden flex bg-slate-100 border border-slate-200">
                <div
                  style={{ width: `${playbook.budgetSplit.prospectingPercent}%` }}
                  className="bg-indigo-500 text-white text-[9px] font-bold flex items-center justify-center"
                  title="Prospecting"
                >
                  {playbook.budgetSplit.prospectingPercent}%
                </div>
                <div
                  style={{ width: `${playbook.budgetSplit.engagementPercent}%` }}
                  className="bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center"
                  title="Video / Reels Engagement"
                >
                  {playbook.budgetSplit.engagementPercent}%
                </div>
                <div
                  style={{ width: `${playbook.budgetSplit.retargetingPercent}%` }}
                  className="bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center"
                  title="Retargeting / Cart Recovery"
                >
                  {playbook.budgetSplit.retargetingPercent}%
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-1">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 inline-block" />
                  নতুন ট্র্যাফিক ও কনভার্সন ({playbook.budgetSplit.prospectingPercent}%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500 inline-block" />
                  ভিডিও ও রিলস এঙ্গেজমেন্ট ({playbook.budgetSplit.engagementPercent}%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" />
                  রিটার্গেটিং ও কাট-অফ পুশ ({playbook.budgetSplit.retargetingPercent}%)
                </span>
              </div>
            </div>
          </div>

          {/* Phased Roadmap Timeline */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <span>📅</span> ক্যাম্পেইন এক্সিকিউশন টাইমলাইন ও ধাপসমূহ ({playbook.phases.length}টি ফেজ)
            </h4>

            <div className="space-y-3">
              {playbook.phases.map((phase) => (
                <div
                  key={phase.phaseNumber}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="rounded-md bg-amber-100 text-amber-900 px-2 py-0.5 text-xs font-black">
                      ফেজ {phase.phaseNumber}: {phase.name}
                    </span>
                    <span className="text-[11px] font-bold text-slate-500">
                      ⏱️ {phase.durationLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-800 font-semibold">{phase.strategy}</p>
                  <div className="rounded-lg bg-white p-2 border border-slate-200 text-[11px] text-slate-600">
                    <strong className="text-slate-900">বিজ্ঞাপনের মেসেজ/হুক:</strong> &ldquo;{phase.adAngle}&rdquo;
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pre-tested High CTR Bengali Copy Formulas */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <span>✍️</span> রেডিমেড হাই-কনভার্সন বাংলা অ্যাড কপি ও ফর্মুলা
            </h4>

            <div className="space-y-4">
              {playbook.adCopies.map((copy, idx) => (
                <div key={idx} className="rounded-xl border border-slate-200 p-4 space-y-2.5 bg-slate-50/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-slate-800">{copy.hook}</span>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          `Headline: ${copy.headline}\n\nPrimary Text:\n${copy.primaryText}\n\nCTA: ${copy.callToAction}`,
                          idx
                        )
                      }
                      className="rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-slate-700 border border-slate-300 shadow-xs hover:bg-slate-100 transition"
                    >
                      {copiedIndex === idx ? "✓ কপি হয়েছে!" : "📋 কপি করুন"}
                    </button>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[11px] font-bold text-slate-500">হেডলাইন (Headline):</p>
                    <p className="text-xs font-bold text-slate-900 bg-white p-2 rounded-lg border border-slate-200">
                      {copy.headline}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[11px] font-bold text-slate-500">প্রাইমারি টেক্সট (Primary Text):</p>
                    <p className="text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200 whitespace-pre-line leading-relaxed">
                      {copy.primaryText}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-[11px] pt-1">
                    <span className="text-slate-500">
                      অফার টাইপ: <strong className="text-amber-800">{copy.offerFormula}</strong>
                    </span>
                    <span className="rounded bg-indigo-50 px-2 py-0.5 font-mono text-indigo-700 font-bold">
                      CTA: {copy.callToAction}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column (4 cols): Courier Cutoff Calculator & 1-Click Launch */}
        <div className="lg:col-span-4 space-y-5">
          {/* BD Courier Cutoff Calculator */}
          <div className="rounded-2xl border-2 border-rose-200 bg-gradient-to-b from-rose-50/50 to-white p-4 shadow-xs space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">🚚</span>
              <div>
                <h4 className="text-xs font-black text-rose-950 uppercase tracking-wider">
                  কুরিয়ার কাট-অফ ক্যালকুলেটর
                </h4>
                <p className="text-[11px] text-rose-800">
                  উৎসবের আগে পার্সেল পৌঁছানোর সঠিক ডেডলাইন
                </p>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                উৎসবের আনুমানিক মূল তারিখ:
              </label>
              <input
                type="date"
                value={targetDateStr}
                onChange={(e) => setTargetDateStr(e.target.value)}
                className="w-full rounded-xl border border-slate-300 p-2 text-xs font-bold text-slate-800 bg-white"
              />
            </div>

            {/* Cutoff Deadlines summary */}
            <div className="space-y-2 pt-1">
              <div className="rounded-xl border border-rose-200 bg-white p-3 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">📦 ঢাকার বাইরে শেষ বুকিং:</span>
                  <span
                    className={`font-black ${
                      cutoffResult.isOutsideDeadlinePassed ? "text-rose-600" : "text-emerald-700"
                    }`}
                  >
                    {cutoffResult.isOutsideDeadlinePassed
                      ? "সময় শেষ!"
                      : `${cutoffResult.daysRemainingOutside} দিন বাকি`}
                  </span>
                </div>
                <p className="text-[11px] font-mono text-slate-500">
                  {cutoffResult.outsideDhakaDeadline.toLocaleDateString("bn-BD", {
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">🛵 ঢাকা সিটি শেষ বুকিং:</span>
                  <span
                    className={`font-black ${
                      cutoffResult.isInsideDeadlinePassed ? "text-rose-600" : "text-emerald-700"
                    }`}
                  >
                    {cutoffResult.isInsideDeadlinePassed
                      ? "সময় শেষ!"
                      : `${cutoffResult.daysRemainingInside} দিন বাকি`}
                  </span>
                </div>
                <p className="text-[11px] font-mono text-slate-500">
                  {cutoffResult.insideDhakaDeadline.toLocaleDateString("bn-BD", {
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>

            {/* Generated Urgency Ad Copy */}
            <div className="rounded-xl bg-rose-100/60 p-3 space-y-1.5 border border-rose-200">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-rose-900">
                  উৎসবের আর্জেন্সি বিজ্ঞাপন টেক্সট:
                </span>
                <button
                  type="button"
                  onClick={() => copyText(cutoffResult.urgencyAdCopy)}
                  className="text-[11px] font-bold text-rose-800 underline"
                >
                  {copiedCutoff ? "কপি হয়েছে!" : "কপি"}
                </button>
              </div>
              <p className="text-[11px] text-rose-950 font-medium leading-relaxed">
                {cutoffResult.urgencyAdCopy}
              </p>
            </div>
          </div>

          {/* 1-Click Launch Campaign Draft */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
            <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <span>🚀</span> ১-ক্লিকে ক্যাম্পেইন ড্রাফট শুরু
            </h4>
            <p className="text-[11px] text-slate-500">
              এই উৎসবের স্ট্র্যাটেজি অনুযায়ী সরাসরি ক্যাম্পেইন তৈরি করে বিল্ডারে নিয়ে যাবে।
            </p>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Meta Ad Account নির্বাচন করুন
              </label>
              {accounts.length === 0 ? (
                <p className="text-[11px] text-amber-800 bg-amber-50 p-2 rounded-lg">
                  কোনো Meta Ad Account যুক্ত নেই।
                </p>
              ) : (
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-2 text-xs font-semibold text-slate-800 bg-white"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.platform})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                দৈনিক ক্যাম্পেইন বাজেট (BDT ৳)
              </label>
              <input
                type="number"
                min={500}
                step={100}
                value={dailyBudget}
                onChange={(e) => setDailyBudget(Number(e.target.value) || 1000)}
                className="w-full rounded-xl border border-slate-300 p-2 text-xs font-bold text-slate-800"
              />
            </div>

            <button
              type="button"
              disabled={busy || !selectedAccountId}
              onClick={handleLaunchDraft}
              className="w-full rounded-xl bg-gradient-to-r from-amber-600 via-rose-600 to-amber-600 p-3 text-xs font-black text-white shadow-md hover:opacity-95 transition disabled:opacity-50"
            >
              {busy ? "প্ল্যান তৈরি হচ্ছে..." : "🚀 ক্যাম্পেইন ড্রাফট তৈরি ও শুরু করুন"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
