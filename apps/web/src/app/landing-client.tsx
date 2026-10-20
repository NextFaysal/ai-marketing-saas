"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  MessageSquare,
  ShieldAlert,
  Truck,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  TrendingUp,
  GitFork,
  Bot,
  Zap,
  Lock,
  ShieldCheck,
  ChevronDown,
  Layers,
  ArrowUpRight,
  Sliders,
  Check,
  HelpCircle,
  AlertTriangle,
  Menu,
  X,
} from "lucide-react";
import { publicApiBase, API_URL, getToken } from "@/lib/api";
import { fmtMoney, fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { pubT, publicDicts } from "@/lib/i18n/public";
import { tr } from "@/lib/i18n/lookup";

const t = pubT();

/**
 * Milestone 58 — public marketing landing (the app's root "/").
 *
 * Honesty rules baked in:
 *  - Only capabilities that exist in the product TODAY are named.
 *  - No testimonials, no customer logos, no invented statistics.
 *    The showcase frames below are simplified CSS presentations in
 *    the style of the real screens, captioned as such — they are
 *    not screenshots and claim nothing a screenshot would.
 *  - Prices come from the SAME operator-settings source as /pricing
 *    (GET /public/pricing); nothing is hardcoded here.
 *  - The ROI calculator computes only from the visitor's own inputs
 *    and shows its formula on the page, labelled an estimate.
 *  - Signup state honours /public/system-status exactly like the
 *    register page does.
 */

interface Plan {
  tier: string;
  priceMinor: number;
  limits: { aiDaily: number; broadcastCap: number; seats: number };
}
interface Pricing {
  currency: string;
  trialDays: number;
  plans: Plan[];
}
interface SysStatus {
  signupOpen: boolean;
  maintenanceMode: boolean;
  announcement: { title: string; body: string } | null;
}

const TIER_BN: Record<string, string> = { FREE: t.landing.tierFREE, STARTER: t.landing.tierSTARTER, GROWTH: t.landing.tierGROWTH, AGENCY: t.landing.tierAGENCY };

interface FaqItem {
  q: string;
  a: string;
  cat: "general" | "courier" | "ai" | "billing";
}

const FAQS: FaqItem[] = [
  {
    cat: "general",
    q: t.landing.q1,
    a: t.landing.faqA1V2,
  },
  {
    cat: "courier",
    q: t.landing.q2,
    a: t.landing.faqA2V2,
  },
  {
    cat: "courier",
    q: t.landing.faqRiskQ,
    a: t.landing.faqRiskA,
  },
  {
    cat: "courier",
    q: t.landing.faqBulkQ,
    a: t.landing.faqBulkA,
  },
  {
    cat: "ai",
    q: t.landing.faqAiWrongQ,
    a: t.landing.faqAiWrongA,
  },
  {
    cat: "ai",
    q: t.landing.faqAutoReplyQ,
    a: t.landing.faqAutoReplyA,
  },
  {
    cat: "billing",
    q: t.landing.q3,
    a: t.landing.faqPriceAV2,
  },
  {
    cat: "billing",
    q: t.landing.faqTrialQV2,
    a: t.landing.faqTrialAV2,
  },
  {
    cat: "billing",
    q: t.landing.faqDataQV2,
    a: t.landing.faqDataAV2,
  },
  {
    cat: "general",
    q: t.landing.faqBanglaQV2,
    a: t.landing.faqBanglaAV2,
  },
  {
    cat: "general",
    q: t.landing.faqAgencyQV2,
    a: t.landing.faqAgencyAV2,
  },
];

/* -------------------------------------------------------------------------- */
/* Dynamic Interactive Hero Showcase Frames                                   */
/* -------------------------------------------------------------------------- */

function CompetitorSpyHeroFrame() {
  return (
    <div className="space-y-3.5 text-left text-xs">
      <div className="flex items-center justify-between border-b border-slate-700/80 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold text-slate-100">{t.landing.spyFrameTitle}</span>
        </div>
        <div className="flex gap-1.5 text-[10px] font-semibold">
          <span className="rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5">Meta</span>
          <span className="rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5">Google</span>
          <span className="rounded bg-pink-500/20 text-pink-300 border border-pink-500/30 px-2 py-0.5">TikTok</span>
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="rounded-full bg-amber-500 text-slate-950 px-2 py-0.5 text-[10px] font-bold">
            {tr(publicDicts, "bn", "landing.winningAdBadge", { days: fmtNumber("bn", 28) })}
          </span>
          <span className="text-[10px] text-slate-400">Facebook • Instagram</span>
        </div>
        <p className="text-slate-200 line-clamp-2 leading-relaxed">
          "প্রিমিয়াম লেদার ওয়ালেট — সীমিত সময়ের জন্য বিশেষ ছাড়! ক্যাশ অন ডেলিভারি সুবিধা।"
        </p>
        <div className="rounded-lg bg-slate-900 border border-slate-800 p-2 text-[11px] text-slate-300">
          <span className="font-bold text-indigo-400">{t.landing.aiCounterLabel}</span> প্রতিদ্বন্দীর অফারে ফ্রি ডেলিভারি নেই। আমাদের ক্যাম্পেইনে "১ বছরের ওয়ারেন্টি + ফ্রি ডেলিভারি" অফার সেট করুন।
        </div>
      </div>

      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-[11px] text-slate-300 flex items-center justify-between">
        <div>
          <span className="font-bold text-rose-400">🚨 STOCKOUT DETECTED:</span> প্রতিদ্বন্দী "Rival Store"-এর ব্লুটুথ হেডফোন আউট-অব-স্টক!
        </div>
        <button className="rounded bg-indigo-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-indigo-500">
          অ্যাড ড্রাফট
        </button>
      </div>
    </div>
  );
}

function UnifiedInboxHeroFrame() {
  const [selectedChat, setSelectedChat] = useState<number>(0);

  const chats = [
    {
      ch: "FB",
      n: "Rahim Uddin",
      m: "দাম কত?",
      q: "আসসালামু আলাইকুম, এই সিল্ক শাড়িটার দাম কত?",
      a: "ওয়ালাইকুমুস সালাম! এই শাড়িটির মূল্য ৳১,৯৫০। ঢাকার বাইরে ডেলিভারি চার্জ ৳১৩০ এবং ক্যাশ অন ডেলিভারি আছে।",
      badge: "✓ AI আসল ইনভেন্টরি ও ডেলিভারি পলিসি থেকে উত্তর সাজিয়েছে",
    },
    {
      ch: "WA",
      n: "Fatima Begum",
      m: "ঢাকার বাইরে ডেলিভারি?",
      q: "চট্টগ্রামে কতদিনে ডেলিভারি পাবো? কুরিয়ার চার্জ কত?",
      a: "চট্টগ্রামে ৪৮ ঘণ্টার মধ্যে Steadfast বা Pathao কুরিয়ারে হোম ডেলিভারি হবে। চার্জ মাত্র ৳১৩০।",
      badge: "✓ লাইভ কুরিয়ার রেট ও SLA থেকে ভেরিফাইড উত্তর",
    },
    {
      ch: "IG",
      n: "Tanvir Hasan",
      m: "অর্ডার কনফার্ম করুন",
      q: "আমার ঠিকানা: মিরপুর-১০, ঢাকা। সাইজ XL কনফার্ম করে দিন।",
      a: "আপনার অর্ডার কনফার্ম করা হয়েছে! ইনভয়েস #INV-9281 প্রস্তুত। ডেলিভারি ট্র্যাকিং কোড শীঘ্রই SMS-এ পাবেন।",
      badge: "✓ ১-ক্লিকে ইনবক্স থেকে সরাসরি অর্ডার ও কুরিয়ার পার্সেল তৈরি হয়েছে",
    },
  ];

  const current = chats[selectedChat] ?? chats[0];

  return (
    <div className="space-y-3 text-left text-xs">
      <div className="flex items-center justify-between border-b border-slate-700/80 pb-2.5">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-indigo-400" />
          <span className="font-bold text-slate-100">{t.landing.inboxFrameTitle}</span>
        </div>
        <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold">
          {t.landing.inboxGroundingBadge}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.6fr] gap-3">
        <div className="space-y-1.5 border-b sm:border-b-0 sm:border-r border-slate-800 pb-2 sm:pb-0 sm:pr-3">
          <div className="text-[10px] font-semibold text-slate-500 mb-1">{t.landing.inboxSelectCustomer}</div>
          {chats.map((item, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSelectedChat(i)}
              className={`w-full text-left rounded-lg p-2 transition ${
                selectedChat === i
                  ? "bg-indigo-600/20 border border-indigo-500/40 text-white shadow-sm"
                  : "bg-slate-900/60 text-slate-400 hover:bg-slate-800/60"
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                <span className="text-[9px] rounded bg-slate-800 px-1 py-0.5">{item.ch}</span>
                <span className="truncate">{item.n}</span>
              </div>
              <div className="truncate text-[10px] mt-0.5">{item.m}</div>
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <div className="max-w-[95%] rounded-xl rounded-bl-sm bg-slate-800 p-2.5 text-slate-200 text-[11px] leading-relaxed">
            {current.q}
          </div>
          <div className="ml-auto max-w-[95%] rounded-xl rounded-br-sm bg-indigo-600 p-2.5 text-white text-[11px] leading-relaxed">
            {current.a}
          </div>
          <div className="rounded bg-emerald-950/40 border border-emerald-500/30 px-2.5 py-1 text-[9px] text-emerald-300 font-medium">
            {current.badge}
          </div>
        </div>
      </div>
    </div>
  );
}

function CodFraudHeroFrame() {
  const [profile, setProfile] = useState<"risky" | "safe">("risky");

  return (
    <div className="space-y-3.5 text-left text-xs">
      <div className="flex items-center justify-between border-b border-slate-700/80 pb-2.5">
        <div className="flex items-center gap-2">
          <ShieldAlert className={`h-3.5 w-3.5 ${profile === "risky" ? "text-rose-400" : "text-emerald-400"}`} />
          <span className="font-bold text-slate-100">{t.landing.fraudFrameTitle}</span>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setProfile("risky")}
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold transition ${
              profile === "risky"
                ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                : "bg-slate-900 text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.landing.fraudTestRisky}
          </button>
          <button
            type="button"
            onClick={() => setProfile("safe")}
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold transition ${
              profile === "safe"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                : "bg-slate-900 text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.landing.fraudTestSafe}
          </button>
        </div>
      </div>

      {profile === "risky" ? (
        <>
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-3.5 space-y-2">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-slate-400">গ্রাহক নম্বর: 01711-XXXXXX</span>
              <span className="font-bold text-rose-400">ঝুঁকি স্কোর: ৮২% (High Risk)</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-amber-500 to-rose-600 w-[82%]" />
            </div>
            <p className="text-[11px] text-slate-300">
              গত ৬০ দিনে বিভিন্ন মার্চেন্ট থেকে ৩টি পার্সেল রিজেক্ট/রিটার্ন করেছে। সফল ডেলিভারি রেট ৩৮%।
            </p>
          </div>

          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-[11px] flex items-center justify-between">
            <div>
              <span className="font-bold text-rose-300">সিস্টেম সতর্কতা ও সুপারিশ:</span>
              <div className="text-slate-300 text-[10px]">পার্সেল বুক করার আগে ৳১৩০ কুরিয়ার চার্জ অগ্রিম গ্রহণ করুন।</div>
            </div>
            <button className="rounded bg-indigo-600 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-indigo-500">
              Send bKash Link
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-3.5 space-y-2">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-slate-400">গ্রাহক নম্বর: 01822-XXXXXX</span>
              <span className="font-bold text-emerald-400">ঝুঁকি স্কোর: ১২% (Safe Customer)</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-emerald-500 w-[12%]" />
            </div>
            <p className="text-[11px] text-slate-300">
              গত ৯০ দিনে ৮টি পার্সেল সফলভাবে রিসিভ করেছে। কোনো রিটার্ন বা রিজেকশন নেই।
            </p>
          </div>

          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[11px] flex items-center justify-between">
            <div>
              <span className="font-bold text-emerald-300">সিস্টেম সুপারিশ:</span>
              <div className="text-slate-300 text-[10px]">১০০% বিশ্বস্ত কাস্টমার। সরাসরি ক্যাশ অন ডেলিভারিতে পার্সেল বুক করুন।</div>
            </div>
            <button className="rounded bg-emerald-600 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-500">
              1-Click Book Courier
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CourierHubHeroFrame() {
  return (
    <div className="space-y-3 text-left text-xs">
      <div className="flex items-center justify-between border-b border-slate-700/80 pb-2.5">
        <div className="flex items-center gap-2">
          <Truck className="h-3.5 w-3.5 text-indigo-400" />
          <span className="font-bold text-slate-100">{t.landing.courierFrameTitle}</span>
        </div>
        <span className="text-[10px] text-slate-400">{t.landing.courierLiveSync}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-center">
          <div className="text-[10px] font-bold text-emerald-300">Steadfast</div>
          <div className="text-sm font-bold text-white mt-1">৳১১০</div>
          <div className="text-[9px] text-emerald-400 mt-0.5">সবচেয়ে সাশ্রয়ী</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 text-center">
          <div className="text-[10px] font-bold text-slate-300">Pathao</div>
          <div className="text-sm font-bold text-white mt-1">৳১৩০</div>
          <div className="text-[9px] text-slate-400 mt-0.5">ফাস্টেস্ট পিকআপ</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-2.5 text-center">
          <div className="text-[10px] font-bold text-slate-300">RedX</div>
          <div className="text-sm font-bold text-white mt-1">৳১২৫</div>
          <div className="text-[9px] text-slate-400 mt-0.5">স্ট্যান্ডার্ড</div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-2.5 flex items-center justify-between text-[11px]">
        <div>
          <span className="font-bold text-white">Bulk Label Ready (২৮ পার্সেল)</span>
          <div className="text-[10px] text-slate-400">এক ক্লিকে প্রিন্ট-রেডি বারকোড স্টিকার</div>
        </div>
        <button className="rounded bg-indigo-600 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-indigo-500">
          Print PDF
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Interactive ROI Calculator                                                 */
/* -------------------------------------------------------------------------- */

function RoiCalculator() {
  const [orders, setOrders] = useState(1200);
  const [returnCost, setReturnCost] = useState(130);
  const [currentPct, setCurrentPct] = useState(24);
  const [targetPct, setTargetPct] = useState(12);

  const result = useMemo(() => {
    const savedReturns = Math.max(0, (orders * (currentPct - targetPct)) / 100);
    return { savedReturns, saving: savedReturns * returnCost };
  }, [orders, returnCost, currentPct, targetPct]);

  const num = (v: number) => fmtNumber("bn", v);

  return (
    <div className="mx-auto max-w-4xl rounded-3xl border border-slate-800 bg-slate-900/70 p-6 sm:p-10 shadow-2xl backdrop-blur-md text-left">
      {/* Quick business presets */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400 font-semibold mr-1">{t.landing.roiPresetLabel}</span>
        <button
          type="button"
          onClick={() => { setOrders(300); setReturnCost(120); setCurrentPct(25); setTargetPct(12); }}
          className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1 text-[11px] font-semibold text-slate-200 hover:border-indigo-500 hover:text-white transition"
        >
          {t.landing.roiPresetSmall}
        </button>
        <button
          type="button"
          onClick={() => { setOrders(1200); setReturnCost(130); setCurrentPct(24); setTargetPct(10); }}
          className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold text-indigo-300 hover:border-indigo-500 transition"
        >
          {t.landing.roiPresetGrowth}
        </button>
        <button
          type="button"
          onClick={() => { setOrders(4500); setReturnCost(130); setCurrentPct(22); setTargetPct(8); }}
          className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1 text-[11px] font-semibold text-slate-200 hover:border-indigo-500 hover:text-white transition"
        >
          {t.landing.roiPresetLarge}
        </button>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-semibold text-slate-300">
            <span>{t.landing.roiOrdersLabel}</span>
            <span className="text-indigo-400 font-bold">{num(orders)} {t.landing.roiOrdersUnit}</span>
          </div>
          <input
            type="range"
            min={100}
            max={10000}
            step={50}
            value={orders}
            onChange={(e) => setOrders(Number(e.target.value))}
            className="w-full accent-indigo-500 cursor-pointer"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs font-semibold text-slate-300">
            <span>{t.landing.roiReturnCostShort}</span>
            <span className="text-indigo-400 font-bold">৳{num(returnCost)}</span>
          </div>
          <input
            type="range"
            min={80}
            max={300}
            step={5}
            value={returnCost}
            onChange={(e) => setReturnCost(Number(e.target.value))}
            className="w-full accent-indigo-500 cursor-pointer"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs font-semibold text-slate-300">
            <span>{t.landing.roiCurrentShort}</span>
            <span className="text-rose-400 font-bold">{currentPct}%</span>
          </div>
          <input
            type="range"
            min={5}
            max={50}
            value={currentPct}
            onChange={(e) => setCurrentPct(Number(e.target.value))}
            className="w-full accent-rose-500 cursor-pointer"
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs font-semibold text-slate-300">
            <span>{t.landing.roiTargetShort}</span>
            <span className="text-emerald-400 font-bold">{targetPct}%</span>
          </div>
          <input
            type="range"
            min={2}
            max={30}
            value={targetPct}
            onChange={(e) => setTargetPct(Number(e.target.value))}
            className="w-full accent-emerald-500 cursor-pointer"
          />
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">
            {t.landing.roiSavingTitleV2}
          </div>
          <div className="mt-1 text-3xl sm:text-4xl font-black text-emerald-400">
            {fmtMoney("bn", Math.round(result.saving))}
          </div>
          <div className="mt-1 text-xs text-slate-300">
            {t.landing.roiSavingLinePrefix}<b className="text-white">{num(Math.round(result.savedReturns))}{t.landing.roiCountUnit}</b>{t.landing.roiSavingLineSuffix}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-xs text-slate-300 max-w-xs">
          <div className="font-semibold text-white mb-1 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span>{t.landing.roiHowTitle}</span>
          </div>
          {t.landing.roiHowBody}
        </div>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
        <b>{t.landing.roiFormulaPrefix}</b>{t.landing.roiFormulaBody}<b>{t.landing.roiEstimateBold}</b>{t.landing.roiFormulaSuffix}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main Landing Component                                                     */
/* -------------------------------------------------------------------------- */

const DEFAULT_PRICING: Pricing = {
  currency: "BDT",
  trialDays: 14,
  plans: [
    { tier: "FREE", priceMinor: 0, limits: { aiDaily: 50, broadcastCap: 100, seats: 1 } },
    { tier: "STARTER", priceMinor: 150000, limits: { aiDaily: 300, broadcastCap: 1000, seats: 3 } },
    { tier: "GROWTH", priceMinor: 350000, limits: { aiDaily: 1500, broadcastCap: 10000, seats: 10 } },
    { tier: "AGENCY", priceMinor: 950000, limits: { aiDaily: 10000, broadcastCap: 50000, seats: 999 } },
  ],
};

export default function Landing() {
  const router = useRouter();
  const [pricing, setPricing] = useState<Pricing | null>(DEFAULT_PRICING);
  const [status, setStatus] = useState<SysStatus | null>(null);
  const [heroTab, setHeroTab] = useState<"spy" | "inbox" | "fraud" | "courier">("spy");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [faqCategory, setFaqCategory] = useState<string>("all");
  const [faqSearch, setFaqSearch] = useState<string>("");

  const filteredFaqs = useMemo(() => {
    return FAQS.filter((f) => {
      const matchCat = faqCategory === "all" || f.cat === faqCategory;
      const matchSearch =
        !faqSearch.trim() ||
        f.q.toLowerCase().includes(faqSearch.toLowerCase()) ||
        f.a.toLowerCase().includes(faqSearch.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [faqCategory, faqSearch]);

  useEffect(() => {
    if (getToken()) {
      router.replace("/dashboard");
      return;
    }
    const controller = new AbortController();
    fetch(`${publicApiBase()}/public/pricing`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.plans) setPricing(data);
      })
      .catch(() => undefined);
    fetch(`${API_URL}/public/system-status`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => undefined);
    return () => controller.abort();
  }, [router]);

  const signupClosed = status?.signupOpen === false;
  const RegisterCta = ({
    className,
    label = t.landing.startFree,
  }: {
    className: string;
    label?: string;
  }) =>
    signupClosed ? (
      <span
        className={`${className} cursor-not-allowed opacity-60`}
        title={t.landing.signupClosedTitle}
      >
        {t.landing.signupClosedCta}
      </span>
    ) : (
      <a href="/register" className={className}>
        {label}
      </a>
    );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500 selection:text-white">
      {/* Background ambient lighting - GPU accelerated */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden transform-gpu">
        <div className="absolute -top-40 left-1/2 h-[600px] w-[1000px] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-[140px] will-change-transform" />
        <div className="absolute top-[45%] right-[-150px] h-[500px] w-[500px] rounded-full bg-violet-600/10 blur-[130px] will-change-transform" />
        <div className="absolute top-[75%] left-[-150px] h-[500px] w-[500px] rounded-full bg-fuchsia-600/10 blur-[140px] will-change-transform" />
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-20" />
      </div>

      {status?.maintenanceMode ? (
        <div className="relative z-50 bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950">
          {t.landing.maintenanceBanner}
        </div>
      ) : null}
      {status?.announcement ? (
        <div className="relative z-50 bg-indigo-600 px-4 py-2 text-center text-sm text-white">
          📣 <b>{status.announcement.title}</b> — {status.announcement.body}
        </div>
      ) : null}

      {/* Modern Sticky Navigation */}
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3 group">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 via-violet-500 to-fuchsia-500 text-lg font-black text-white shadow-lg shadow-indigo-500/25 transition group-hover:scale-105">
              Q
            </span>
            <div>
              <div className="text-base font-bold leading-tight text-white flex items-center gap-1.5">
                AI Marketing OS
                <span className="rounded-full bg-indigo-500/20 border border-indigo-500/30 px-1.5 py-0.2 text-[9px] font-semibold text-indigo-300">
                  v2.4
                </span>
              </div>
              <div className="text-xs text-slate-400">by Qosprey</div>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-300 md:flex">
            <Link href="/features" className="text-indigo-400 font-semibold hover:text-indigo-300 flex items-center gap-1">
              {t.landing.navFeaturesFull} <span className="rounded bg-indigo-500/20 px-1 text-[10px]">{t.landing.navNewBadge}</span>
            </Link>
            <a href="#how" className="transition hover:text-white">{t.landing.navHow}</a>
            <a href="#calculator" className="transition hover:text-white">{t.landing.navCalculator}</a>
            <a href="#pricing" className="transition hover:text-white">{t.landing.navPricing}</a>
            <a href="#faq" className="transition hover:text-white">{t.landing.navFaq}</a>
          </nav>

          <div className="hidden sm:flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white"
            >
              {t.landing.login}
            </Link>
            <RegisterCta className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:brightness-110 active:scale-[0.98]" />
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden rounded-xl border border-slate-800 p-2 text-slate-400 hover:bg-slate-900 hover:text-white"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-b border-slate-800 bg-slate-950 px-6 py-4 space-y-3 text-sm">
            <Link
              href="/features"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-1 text-indigo-400 font-semibold"
            >
              {t.landing.mobileFeaturesFull}
            </Link>
            <a
              href="#how"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-1 text-slate-300 hover:text-white"
            >
              {t.landing.navHow}
            </a>
            <a
              href="#calculator"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-1 text-slate-300 hover:text-white"
            >
              {t.landing.navCalculator}
            </a>
            <Link
              href="/pricing"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-1 text-slate-300 hover:text-white"
            >
              {t.landing.mobilePricingFull}
            </Link>
            <a
              href="#faq"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-1 text-slate-300 hover:text-white"
            >
              {t.landing.mobileFaqFull}
            </a>
            <div className="pt-2 flex gap-2">
              <Link
                href="/login"
                className="flex-1 text-center py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-semibold text-white"
              >
                {t.landing.login}
              </Link>
              <RegisterCta className="flex-1 text-center py-2.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold" />
            </div>
          </div>
        )}
      </header>

      {/* HERO SECTION */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-16 pb-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1.5 text-xs font-semibold text-indigo-300 shadow-inner">
          <Sparkles className="h-3.5 w-3.5 text-indigo-400 animate-pulse" />
          <span>{t.landing.heroBadge}</span>
        </div>

        <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
          {t.landing.heroTitlePrefix}
          <span className="bg-gradient-to-r from-indigo-400 via-violet-300 to-fuchsia-400 bg-clip-text text-transparent">
            {t.landing.heroTitleAccentV2}
          </span>
          {t.landing.heroTitleSuffix}
        </h1>

        <p className="mx-auto mt-5 max-w-3xl text-base sm:text-lg leading-relaxed text-slate-400">
          {t.landing.heroBodyV2}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <RegisterCta
            label={t.landing.heroTrialCta}
            className="rounded-2xl bg-gradient-to-r from-indigo-500 via-violet-600 to-fuchsia-600 px-8 py-4 text-base font-bold text-white shadow-xl shadow-indigo-500/25 transition hover:brightness-110 active:scale-[0.98]"
          />
          <Link
            href="/features"
            className="rounded-2xl border border-slate-800 bg-slate-900/80 px-8 py-4 text-base font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white flex items-center gap-2"
          >
            <span>{t.landing.heroExploreFeatures}</span>
            <ArrowRight className="h-4 w-4 text-indigo-400" />
          </Link>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          {t.landing.heroNoCardNote}
        </p>

        {/* Dynamic Interactive Hero Showcase Console */}
        <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 p-2 shadow-2xl backdrop-blur-md">
          {/* Tabs */}
          <div className="flex overflow-x-auto border-b border-slate-800/80 bg-slate-900/60 p-1.5 rounded-2xl gap-1">
            {[
              { id: "spy", label: t.landing.tabSpyLabel, short: t.landing.tabSpyShort, icon: Search },
              { id: "inbox", label: t.landing.tabInboxLabel, short: t.landing.tabInboxShort, icon: MessageSquare },
              { id: "fraud", label: t.landing.tabFraudLabel, short: t.landing.tabFraudShort, icon: ShieldAlert },
              { id: "courier", label: t.landing.tabCourierLabel, short: t.landing.tabCourierShort, icon: Truck },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = heroTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setHeroTab(tab.id as typeof heroTab)}
                  className={`flex-1 min-w-[65px] sm:min-w-0 flex items-center justify-center gap-1.5 sm:gap-2 rounded-xl py-2 px-1 sm:px-3 text-xs sm:text-sm font-semibold transition ${
                    isActive
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden text-[11px] font-medium">{tab.short}</span>
                </button>
              );
            })}
          </div>

          {/* Active Frame Body */}
          <div className="p-4 sm:p-6">
            {heroTab === "spy" && <CompetitorSpyHeroFrame />}
            {heroTab === "inbox" && <UnifiedInboxHeroFrame />}
            {heroTab === "fraud" && <CodFraudHeroFrame />}
            {heroTab === "courier" && <CourierHubHeroFrame />}
          </div>
        </div>
      </section>

      {/* INTEGRATIONS MARQUEE BAR */}
      <section className="relative z-10 border-y border-slate-800/80 bg-slate-900/40 py-10">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {t.landing.marqueeTitle}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-slate-300 font-semibold text-sm">
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">{t.landing.marqueeMeta}</span>
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">{t.landing.marqueeWhatsApp}</span>
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">{t.landing.marqueeInstagram}</span>
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">{t.landing.marqueeGoogleTikTok}</span>
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">{t.landing.marqueeSteadfast}</span>
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">{t.landing.marqueePathao}</span>
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">{t.landing.marqueeStores}</span>
          </div>
        </div>
      </section>

      {/* THE BROKEN WAY VS MARKETING OS WAY */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-20 text-center">
        <h2 className="text-3xl font-black text-white sm:text-4xl">
          {t.landing.cmpTitlePrefix}<span className="text-indigo-400">{t.landing.cmpTitleAccent}</span>{t.landing.cmpTitleSuffix}
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-base text-slate-400">
          {t.landing.comparisonSubtitle}
        </p>

        <div className="mt-12 grid gap-8 md:grid-cols-2 text-left">
          {/* Old way */}
          <div className="rounded-3xl border border-rose-500/20 bg-rose-500/5 p-8 space-y-4">
            <div className="flex items-center gap-2 text-rose-400 font-bold text-lg">
              <span>✕</span>
              <h3>{t.landing.oldWayTitle}</h3>
            </div>
            <ul className="space-y-3.5 text-sm text-slate-300">
              <li className="flex gap-2.5">
                <span className="text-rose-400 shrink-0 font-bold">✕</span>
                <span>{t.landing.oldWay1}</span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-rose-400 shrink-0 font-bold">✕</span>
                <span>{t.landing.oldWay2}</span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-rose-400 shrink-0 font-bold">✕</span>
                <span>{t.landing.oldWay3}</span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-rose-400 shrink-0 font-bold">✕</span>
                <span>{t.landing.oldWay4}</span>
              </li>
            </ul>
          </div>

          {/* New way */}
          <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/5 p-8 space-y-4">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-lg">
              <CheckCircle2 className="h-5 w-5" />
              <h3>{t.landing.newWayTitle}</h3>
            </div>
            <ul className="space-y-3.5 text-sm text-slate-300">
              <li className="flex gap-2.5">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <span>{t.landing.newWay1}</span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <span>{t.landing.newWay2}</span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <span>{t.landing.newWay3}</span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <span>{t.landing.newWay4}</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* INTERACTIVE BENTO-GRID FEATURE HIGHLIGHTS */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-semibold text-indigo-300">
          <Layers className="h-3.5 w-3.5 text-indigo-400" />
          <span>{t.landing.bentoBadge}</span>
        </div>

        <h2 className="mt-4 text-3xl font-black text-white sm:text-4xl">
          {t.landing.bentoTitle}
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-slate-400 text-sm">
          {t.landing.bentoSubtitle}
        </p>

        {/* Bento Grid */}
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 text-left">
          {/* Card 1 */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-7 space-y-4 hover:border-slate-700 transition">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Search className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-white">{t.landing.bento1Title}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.landing.bento1Body}
            </p>
            <Link href="/features#spy" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300">
              {t.landing.bentoDetailLink} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Card 2 */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-7 space-y-4 hover:border-slate-700 transition">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-white">{t.landing.bento2Title}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.landing.bento2Body}
            </p>
            <Link href="/features#inbox" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300">
              {t.landing.bentoDetailLink} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Card 3 */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-7 space-y-4 hover:border-slate-700 transition">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-white">{t.landing.bento3Title}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.landing.bento3Body}
            </p>
            <Link href="/features#fraud" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300">
              {t.landing.bentoDetailLink} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Card 4 */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-7 space-y-4 hover:border-slate-700 transition">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Truck className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-white">{t.landing.bento4Title}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.landing.bento4Body}
            </p>
            <Link href="/features#courier" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300">
              {t.landing.bentoDetailLink} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Card 5 */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-7 space-y-4 hover:border-slate-700 transition">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
              <GitFork className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-white">{t.landing.bento5Title}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.landing.bento5Body}
            </p>
            <Link href="/features#workflows" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300">
              {t.landing.bentoDetailLink} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Card 6 */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-7 space-y-4 hover:border-slate-700 transition">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <TrendingUp className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-white">{t.landing.bento6Title}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.landing.bento6Body}
            </p>
            <Link href="/features#profit" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300">
              {t.landing.bentoDetailLink} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Feature Banner CTA */}
        <div className="mt-10 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="text-left">
            <div className="font-bold text-white text-base">{t.landing.bentoBannerTitle}</div>
            <div className="text-xs text-slate-400 mt-0.5">{t.landing.bentoBannerBody}</div>
          </div>
          <Link
            href="/features"
            className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-xs font-bold text-white flex items-center gap-2"
          >
            <span>{t.landing.bentoBannerCta}</span>
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* HOW IT WORKS SECTION */}
      <section id="how" className="relative z-10 border-y border-slate-800/80 bg-slate-900/40 py-20">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h2 className="text-3xl font-black text-white sm:text-4xl">{t.landing.howTitleV2}</h2>
          <p className="mx-auto mt-2 max-w-xl text-slate-400 text-sm">
            {t.landing.howSubtitle}
          </p>

          <div className="mt-12 grid gap-8 md:grid-cols-3 text-left">
            {[
              {
                n: "০১",
                t: t.landing.step1Title,
                b: t.landing.step1BodyV2,
              },
              {
                n: "০২",
                t: t.landing.step2TitleV2,
                b: t.landing.step2BodyV2,
              },
              {
                n: "০৩",
                t: t.landing.step3TitleV2,
                b: t.landing.step3BodyV2,
              },
            ].map((step) => (
              <div key={step.n} className="rounded-3xl border border-slate-800 bg-slate-950 p-7 space-y-3">
                <span className="text-2xl font-black text-indigo-400">{step.n}</span>
                <h3 className="text-lg font-bold text-white">{step.t}</h3>
                <p className="text-xs leading-relaxed text-slate-400">{step.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ROI CALCULATOR SECTION */}
      <section id="calculator" className="relative z-10 mx-auto max-w-6xl px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-semibold text-emerald-300">
          <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
          <span>{t.landing.roiBadge}</span>
        </div>
        <h2 className="mt-4 text-3xl font-black text-white sm:text-4xl">
          {t.landing.roiTitleV2}
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-slate-400 text-sm">
          {t.landing.roiSubtitleV2}
        </p>

        <div className="mt-10">
          <RoiCalculator />
        </div>
      </section>

      {/* PRICING SECTION */}
      <section id="pricing" className="relative z-10 border-y border-slate-800/80 bg-slate-900/40 py-20">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-semibold text-indigo-300">
            <Zap className="h-3.5 w-3.5 text-indigo-400" />
            <span>{t.landing.pricingBadge}</span>
          </div>
          <h2 className="mt-4 text-3xl font-black text-white sm:text-4xl">{t.landing.pricingTitleV2}</h2>
          <p className="mx-auto mt-2 max-w-xl text-slate-400 text-sm">
            {t.landing.pricingSubtitlePrefixV2}{fmtNumber("bn", pricing?.trialDays ?? 14)}{t.landing.pricingSubtitleSuffixV2}
          </p>

          {!pricing ? (
            <p className="mt-10 text-center text-slate-500 text-sm">{t.landing.pricingLoadingV2}</p>
          ) : (
            <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-4 text-left">
              {pricing.plans.map((p) => {
                const isGrowth = p.tier === "GROWTH";
                return (
                  <div
                    key={p.tier}
                    className={`rounded-3xl border p-7 transition ${
                      isGrowth
                        ? "border-indigo-500 bg-indigo-950/20 shadow-xl shadow-indigo-500/10"
                        : "border-slate-800 bg-slate-950"
                    }`}
                  >
                    {isGrowth ? (
                      <span className="rounded-full bg-indigo-500 px-2.5 py-0.5 text-[10px] font-bold text-white">
                        {t.landing.pricingPopularBadge}
                      </span>
                    ) : null}
                    <div className="text-xs font-bold uppercase tracking-wider text-indigo-400 mt-2">
                      {TIER_BN[p.tier] ?? p.tier}
                    </div>
                    <div className="mt-3 text-3xl font-black text-white">
                      {fmtMoneyMinor("bn", p.priceMinor)}
                      <span className="text-xs font-normal text-slate-400">{t.landing.perMonth}</span>
                    </div>

                    <ul className="mt-6 space-y-2.5 text-xs text-slate-300">
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span>{fmtNumber("bn", p.limits.seats)}{t.landing.pricingSeatsSuffix}</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span>{t.landing.pricingAiDailyPrefix}{fmtNumber("bn", p.limits.aiDaily)}{t.landing.pricingAiDailySuffix}</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span>{t.landing.pricingBroadcastPrefix}{fmtNumber("bn", p.limits.broadcastCap)}{t.landing.pricingBroadcastSuffix}</span>
                      </li>
                    </ul>

                    <RegisterCta
                      className={`mt-7 block rounded-xl py-2.5 text-center text-xs font-bold transition ${
                        isGrowth
                          ? "bg-indigo-600 text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/30"
                          : "border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white"
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {signupClosed ? (
            <p className="mt-6 text-center text-xs font-semibold text-amber-400">
              {t.landing.signupClosedNoteV2}
            </p>
          ) : null}
        </div>
      </section>

      {/* FAQ SECTION */}
      <section id="faq" className="relative z-10 mx-auto max-w-4xl px-6 py-20">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-semibold text-indigo-300">
            <HelpCircle className="h-3.5 w-3.5 text-indigo-400" />
            <span>{t.landing.faqBadge}</span>
          </div>
          <h2 className="mt-4 text-3xl font-black text-white sm:text-4xl">{t.landing.faqTitle}</h2>
          <p className="mx-auto mt-2 max-w-lg text-slate-400 text-xs sm:text-sm">
            {t.landing.faqSubtitle}
          </p>
        </div>

        {/* FAQ Search and Filter Controls */}
        <div className="mt-8 space-y-4">
          <div className="relative max-w-md mx-auto">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder={t.landing.faqSearchPlaceholder}
              value={faqSearch}
              onChange={(e) => setFaqSearch(e.target.value)}
              className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 pl-10 pr-10 py-2.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {faqSearch ? (
              <button
                type="button"
                onClick={() => setFaqSearch("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            ) : null}
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
            {[
              { id: "all", label: t.landing.faqCatAll },
              { id: "courier", label: t.landing.faqCatCourier },
              { id: "ai", label: t.landing.faqCatAi },
              { id: "billing", label: t.landing.faqCatBilling },
              { id: "general", label: t.landing.faqCatGeneral },
            ].map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setFaqCategory(cat.id)}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                  faqCategory === cat.id
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "bg-slate-900/80 border border-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* FAQ Accordion List */}
        <div className="mt-8 space-y-3.5 text-left">
          {filteredFaqs.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center text-slate-400 text-xs">
              {t.landing.faqNoResults}
            </div>
          ) : (
            filteredFaqs.map((f, i) => (
              <details
                key={i}
                className="group rounded-2xl border border-slate-800 bg-slate-950 p-5 transition open:border-slate-700"
              >
                <summary className="flex cursor-pointer items-center justify-between font-semibold text-white text-sm">
                  <span>{f.q}</span>
                  <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-xs leading-relaxed text-slate-400 border-t border-slate-800/80 pt-3">
                  {f.a}
                </p>
              </details>
            ))
          )}
        </div>
      </section>

      {/* TRUST & GUARANTEE BANNER */}
      <section className="relative z-10 border-t border-slate-800/80 bg-slate-900/40 py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 text-left">
            <div className="flex items-center gap-3.5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-black">
                14
              </span>
              <div>
                <div className="text-xs font-bold text-white">{t.landing.trustTrialTitle}</div>
                <div className="text-[11px] text-slate-400">{t.landing.trustTrialBody}</div>
              </div>
            </div>

            <div className="flex items-center gap-3.5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div>
                <div className="text-xs font-bold text-white">{t.landing.trustNoCardTitle}</div>
                <div className="text-[11px] text-slate-400">{t.landing.trustNoCardBody}</div>
              </div>
            </div>

            <div className="flex items-center gap-3.5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <div className="text-xs font-bold text-white">{t.landing.trustIsolationTitle}</div>
                <div className="text-[11px] text-slate-400">{t.landing.trustIsolationBody}</div>
              </div>
            </div>

            <div className="flex items-center gap-3.5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
                <Zap className="h-5 w-5" />
              </span>
              <div>
                <div className="text-xs font-bold text-white">{t.landing.trustSetupTitle}</div>
                <div className="text-[11px] text-slate-400">{t.landing.trustSetupBody}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL HIGH-CONVERSION CTA */}
      <section className="relative overflow-hidden border-t border-slate-800 bg-gradient-to-br from-indigo-950 via-slate-950 to-violet-950 py-20 text-center">
        <div className="mx-auto max-w-4xl px-6 relative z-10 space-y-6">
          <h2 className="text-3xl font-black text-white sm:text-5xl">
            {t.landing.ctaTitleV2}
          </h2>
          <p className="mx-auto max-w-2xl text-base text-slate-300">
            {fmtNumber("bn", pricing?.trialDays ?? 14)}{t.landing.ctaBodySuffixV2}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <RegisterCta
              label={t.landing.ctaTrialCta}
              className="rounded-2xl bg-gradient-to-r from-indigo-500 via-violet-600 to-fuchsia-600 px-9 py-4 text-base font-bold text-white shadow-xl shadow-indigo-500/30 transition hover:brightness-110 active:scale-[0.98]"
            />
            <Link
              href="/features"
              className="rounded-2xl border border-slate-700 bg-slate-900/80 px-8 py-4 text-base font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white"
            >
              {t.landing.ctaFeaturesLink}
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-slate-800 bg-slate-950 py-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 text-xs text-slate-500">
          <div>© {new Date().getFullYear()} Qosprey — AI Marketing OS.{t.landing.footerRightsSuffix}</div>
          <div className="flex flex-wrap gap-5 sm:gap-6">
            <Link href="/features" className="hover:text-slate-300">{t.landing.navFeaturesFull}</Link>
            <Link href="/pricing" className="hover:text-slate-300">{t.landing.footerPricing}</Link>
            <Link href="/privacy" className="hover:text-slate-300">{t.landing.footerPrivacy}</Link>
            <Link href="/terms" className="hover:text-slate-300">{t.landing.footerTerms}</Link>
            <Link href="/login" className="hover:text-slate-300">{t.landing.footerLogin}</Link>
            <Link href="/register" className="hover:text-slate-300">{t.landing.footerRegister}</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
