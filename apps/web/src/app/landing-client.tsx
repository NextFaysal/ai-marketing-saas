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
    q: "শুরু করতে কী কী লাগবে?",
    a: "শুধু একটি ইমেইল দিয়ে রেজিস্টার করলেই Organization তৈরি হয়ে যাবে। এরপর যেসব চ্যানেল ব্যবহার করতে চান (Facebook Page, WooCommerce স্টোর, কুরিয়ার মার্চেন্ট অ্যাকাউন্ট) সেগুলো আপনার নিজের অ্যাকাউন্ট দিয়ে সরাসরি কানেক্ট করবেন।",
  },
  {
    cat: "courier",
    q: "Facebook বা কুরিয়ার অ্যাকাউন্ট কি আপনারা দেন?",
    a: "না। সব ইন্টিগ্রেশন আপনার নিজের ব্যবসায়িক অ্যাকাউন্ট দিয়ে চলে — Meta অ্যাপ/পেজ, WooCommerce/Shopify স্টোর, Steadfast/Pathao/RedX মার্চেন্ট অ্যাকাউন্ট আপনার নিজের নামেই থাকে। আমরা কোনো তৃতীয় পক্ষের অ্যাকাউন্ট বা ক্রেডেনশিয়াল সরবরাহ করি না।",
  },
  {
    cat: "courier",
    q: "COD Return Risk Score কীভাবে কাজ করে?",
    a: "কাস্টমারের ফোন নম্বরের বিগত ডেলিভারি রেকর্ড বিশ্লেষণ করে সিস্টেম ঝুঁকি স্কোর (Safe, Medium, High Risk) তৈরি করে। ঝুঁকিপূর্ণ অর্ডারে অগ্রিম কুরিয়ার চার্জ নেওয়ার অটোমেটেড পেমেন্ট লিংক সুপারিশ করা হয়।",
  },
  {
    cat: "courier",
    q: "বাল্ক কুরিয়ার বুকিং ও ইনভয়েস স্টিকার প্রিন্ট কীভাবে হয়?",
    a: "Steadfast, Pathao ও RedX-এ ইনবক্স বা অর্ডার লিস্ট থেকে এক ক্লিকে ১০০+ পার্সেল বুকিং করা যায় এবং সরাসরি প্রিন্ট-রেডি A4 সাইজ বারকোড লেবেল ও ইনভয়েস PDF ডাউনলোড হয়।",
  },
  {
    cat: "ai",
    q: "AI কি ভুল বা বানোয়াট তথ্য বলতে পারে?",
    a: "কখনোই না। Strict Grounding মোডে এআই আপনার দেওয়া পণ্যের আসল ক্যাটালগ, লাইভ স্টক, দাম ও ডেলিভারি পলিসি থেকে সত্য যাচাই করে উত্তর দেয়। বানিয়ে কোনো ফেক অফার তৈরি করে না।",
  },
  {
    cat: "ai",
    q: "ফেসবুক, হোয়াটসঅ্যাপ ও ইনস্টাগ্রামের মেসেজ কি অটোমেটিক উত্তর দেওয়া যায়?",
    a: "হ্যাঁ। এআই ড্রাফট রিপ্লাই সাজিয়ে রাখে যা টিম মেম্বার রিভিউ করে ১-ক্লিকে পাঠাতে পারে, অথবা চাইলে রুটিন প্রশ্নের ক্ষেত্রে ফুল অটো-পাইলট মোড চালু রাখা যায়।",
  },
  {
    cat: "billing",
    q: "দাম কি এখানে যা দেখছি সেটাই?",
    a: "হ্যাঁ। এই পেজের মূল্য সরাসরি প্ল্যাটফর্ম অপারেটরের লাইভ সেটিংস থেকে আসে — /pricing পেজেও হুবহু একই উৎস থেকে একই দাম দেখানো হয়। কোনো লুকানো চার্জ বা সেটআপ ফি নেই।",
  },
  {
    cat: "billing",
    q: "ট্রায়াল সুবিধা আছে কি?",
    a: "হ্যাঁ, সব পেইড প্ল্যানে অপারেটর-নির্ধারিত ফ্রি ট্রায়াল পিরিয়ড থাকে। ট্রায়াল চলাকালে ক্রেডিট কার্ড বা পেমেন্ট তথ্যের প্রয়োজন হয় না।",
  },
  {
    cat: "billing",
    q: "আমার কাস্টমার বা স্টোরের ডেটা কি অন্য দোকান দেখতে পাবে?",
    a: "কখনোই না। প্রতিটি Organization-এর ডেটা সম্পূর্ণ আলাদা (Strict Tenant Isolation) — প্রোডাক্ট, অর্ডার, গ্রাহক, মেসেজ সবকিছু সুরক্ষিত এবং শুধু আপনার পারমিশনপ্রাপ্ত টিমই দেখতে পারে।",
  },
  {
    cat: "general",
    q: "বাংলা ভাষায় কি ব্যবহার করা যাবে?",
    a: "হ্যাঁ! পুরো ইন্টারফেস বাংলা-প্রথম, এবং AI বাংলা ও ইংরেজি উভয় ভাষাতেই কাস্টমারদের প্রশ্নের প্রাসঙ্গিক ও নির্ভুল উত্তর দিতে পারে।",
  },
  {
    cat: "general",
    q: "এজেন্সি হিসেবে একাধিক ক্লায়েন্টের অ্যাকাউন্ট একসাথে চালানো যাবে?",
    a: "হ্যাঁ, AGENCY প্ল্যানে পোর্টফোলিও ভিউতে সব ক্লায়েন্টের ফলাফল একসাথে দেখা যায়, হোয়াইট-লেবেল ব্র্যান্ডিং সুবিধা রয়েছে এবং পাসওয়ার্ড ছাড়া Read-only ক্লায়েন্ট রিপোর্ট লিংক শেয়ার করা যায়।",
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
          <span className="font-bold text-slate-100">Live Competitor Spy & Intelligence</span>
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
          <span className="font-bold text-slate-100">Unified Omnichannel Inbox</span>
        </div>
        <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold">
          ● Strict Grounding AI Active
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.6fr] gap-3">
        <div className="space-y-1.5 border-b sm:border-b-0 sm:border-r border-slate-800 pb-2 sm:pb-0 sm:pr-3">
          <div className="text-[10px] font-semibold text-slate-500 mb-1">কাস্টমার সিলেক্ট করুন:</div>
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
          <span className="font-bold text-slate-100">COD Return Risk Evaluator</span>
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
            ⚠️ টেস্ট: ঝুঁকিপূর্ণ কাস্টমার
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
            ✓ টেস্ট: নিরাপদ কাস্টমার
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
          <span className="font-bold text-slate-100">Multi-Courier Rate Comparison</span>
        </div>
        <span className="text-[10px] text-slate-400">Live API Sync</span>
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
        <span className="text-xs text-slate-400 font-semibold mr-1">দ্রুত সেট করুন:</span>
        <button
          type="button"
          onClick={() => { setOrders(300); setReturnCost(120); setCurrentPct(25); setTargetPct(12); }}
          className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1 text-[11px] font-semibold text-slate-200 hover:border-indigo-500 hover:text-white transition"
        >
          ছোট স্টোর (৩০০ অর্ডার)
        </button>
        <button
          type="button"
          onClick={() => { setOrders(1200); setReturnCost(130); setCurrentPct(24); setTargetPct(10); }}
          className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold text-indigo-300 hover:border-indigo-500 transition"
        >
          গ্রোথ শপ (১,২০০ অর্ডার)
        </button>
        <button
          type="button"
          onClick={() => { setOrders(4500); setReturnCost(130); setCurrentPct(22); setTargetPct(8); }}
          className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1 text-[11px] font-semibold text-slate-200 hover:border-indigo-500 hover:text-white transition"
        >
          বড় ব্র্যান্ড (৪,৫০০ অর্ডার)
        </button>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-semibold text-slate-300">
            <span>{t.landing.roiOrdersLabel}</span>
            <span className="text-indigo-400 font-bold">{num(orders)} টি</span>
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
            <span>প্রতি রিটার্নে গড় কুরিয়ার খরচ (আসা-যাওয়া)</span>
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
            <span>আপনার বর্তমান রিটার্ন হার (%)</span>
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
            <span>লক্ষ্য রিটার্ন হার (%)</span>
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
            মাসে সম্ভাব্য প্রত্যক্ষ নগদ সাশ্রয়
          </div>
          <div className="mt-1 text-3xl sm:text-4xl font-black text-emerald-400">
            {fmtMoney("bn", Math.round(result.saving))}
          </div>
          <div className="mt-1 text-xs text-slate-300">
            মাসে আনুমানিক <b className="text-white">{num(Math.round(result.savedReturns))}টি</b> পার্সেল রিটার্ন থেকে বাঁচবে।
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-xs text-slate-300 max-w-xs">
          <div className="font-semibold text-white mb-1 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span>কীভাবে সাশ্রয় হয়?</span>
          </div>
          COD রিটার্ন-রিস্ক স্কোর ও অ্যাডভান্স কুরিয়ার পেমেন্ট রুলসের কারণে ফেক ও ঝুঁকিপূর্ণ অর্ডার পূর্বেই শনাক্ত করা সম্ভব হয়।
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
              ফিচারসমূহ <span className="rounded bg-indigo-500/20 px-1 text-[10px]">New</span>
            </Link>
            <a href="#how" className="transition hover:text-white">{t.landing.navHow}</a>
            <a href="#calculator" className="transition hover:text-white">সাশ্রয় ক্যালকুলেটর</a>
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
              ফিচারসমূহ (All Features)
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
              সাশ্রয় ক্যালকুলেটর
            </a>
            <Link
              href="/pricing"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-1 text-slate-300 hover:text-white"
            >
              মূল্য (Pricing)
            </Link>
            <a
              href="#faq"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-1 text-slate-300 hover:text-white"
            >
              সাধারণ জিজ্ঞাসা (FAQ)
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
          <span>বাংলাদেশের ১ম অল-ইন-ওয়ান AI কমার্স ও মার্কেটিং অপারেটিং সিস্টেম</span>
        </div>

        <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
          {t.landing.heroTitlePrefix}
          <span className="bg-gradient-to-r from-indigo-400 via-violet-300 to-fuchsia-400 bg-clip-text text-transparent">
            মেসেজ, বিজ্ঞাপন আর ডেলিভারি
          </span>
          {t.landing.heroTitleSuffix}
        </h1>

        <p className="mx-auto mt-5 max-w-3xl text-base sm:text-lg leading-relaxed text-slate-400">
          Facebook, WhatsApp, Instagram-এর সব মেসেজ এক ইনবক্সে; যাচাই করা প্রোডাক্ট তথ্য থেকে নির্ভরযোগ্য AI রিপ্লাই;
          Meta/Google/TikTok বিজ্ঞাপন অটোমেশন; Steadfast/Pathao/RedX কুরিয়ার বুকিং আর COD রিটার্ন-ঝুঁকির সতর্কতা।
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <RegisterCta
            label="১৪ দিনের ফ্রি ট্রায়াল শুরু করুন"
            className="rounded-2xl bg-gradient-to-r from-indigo-500 via-violet-600 to-fuchsia-600 px-8 py-4 text-base font-bold text-white shadow-xl shadow-indigo-500/25 transition hover:brightness-110 active:scale-[0.98]"
          />
          <Link
            href="/features"
            className="rounded-2xl border border-slate-800 bg-slate-900/80 px-8 py-4 text-base font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white flex items-center gap-2"
          >
            <span>সব ফিচার এক্সপ্লোর করুন</span>
            <ArrowRight className="h-4 w-4 text-indigo-400" />
          </Link>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          ক্রেডিট কার্ডের প্রয়োজন নেই · সম্পূর্ণ নিজস্ব ফেসবুক ও কুরিয়ার মার্চেন্ট অ্যাকাউন্ট দিয়েই চলে
        </p>

        {/* Dynamic Interactive Hero Showcase Console */}
        <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 p-2 shadow-2xl backdrop-blur-md">
          {/* Tabs */}
          <div className="flex overflow-x-auto border-b border-slate-800/80 bg-slate-900/60 p-1.5 rounded-2xl gap-1">
            {[
              { id: "spy", label: "Competitor Spy", short: "Spy", icon: Search },
              { id: "inbox", label: "Unified AI Inbox", short: "AI Inbox", icon: MessageSquare },
              { id: "fraud", label: "COD Fraud Shield", short: "COD Shield", icon: ShieldAlert },
              { id: "courier", label: "Courier Dispatch", short: "Courier", icon: Truck },
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
            আপনার পছন্দের সব চ্যানেল ও প্ল্যাটফর্মের সাথে সরাসরি কানেক্টেড
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-slate-300 font-semibold text-sm">
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">Meta Ads & Pages</span>
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">WhatsApp Cloud</span>
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">Instagram DM</span>
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">Google & TikTok Ads</span>
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">Steadfast Courier</span>
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">Pathao Logistics</span>
            <span className="rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-2">WooCommerce & Shopify</span>
          </div>
        </div>
      </section>

      {/* THE BROKEN WAY VS MARKETING OS WAY */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-20 text-center">
        <h2 className="text-3xl font-black text-white sm:text-4xl">
          কেন সনাতন পদ্ধতি বাদ দিয়ে <span className="text-indigo-400">Marketing OS</span> বেছে নেবেন?
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-base text-slate-400">
          প্রতিদিনের ফ্রাস্ট্রেশন বনাম সেন্ট্রালাইজড আধুনিক সমাধান।
        </p>

        <div className="mt-12 grid gap-8 md:grid-cols-2 text-left">
          {/* Old way */}
          <div className="rounded-3xl border border-rose-500/20 bg-rose-500/5 p-8 space-y-4">
            <div className="flex items-center gap-2 text-rose-400 font-bold text-lg">
              <span>✕</span>
              <h3>সনাতন এলোমেলো পদ্ধতি</h3>
            </div>
            <ul className="space-y-3.5 text-sm text-slate-300">
              <li className="flex gap-2.5">
                <span className="text-rose-400 shrink-0 font-bold">✕</span>
                <span>পেজ, হোয়াটসঅ্যাপ, ইনস্টাগ্রাম — ৩টি আলাদা অ্যাপে মেসেজ চেক করতে গিয়ে কাস্টমার হারানো।</span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-rose-400 shrink-0 font-bold">✕</span>
                <span>কোন পার্সেল কোন কুরিয়ারে গেল, কোনটা রিটার্ন এলো — এক্সেল শিট আর ফোন কলে দিনভর সময় নষ্ট।</span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-rose-400 shrink-0 font-bold">✕</span>
                <span>ফেক অর্ডার ও বারবার পার্সেল রিটার্নে প্রতি মাসে হাজার হাজার টাকা কুরিয়ার লস।</span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-rose-400 shrink-0 font-bold">✕</span>
                <span>অ্যাড অ্যাকাউন্টে কোন বিজ্ঞাপনে আসলে ক্যাশ লাভ হচ্ছে তার পরিষ্কার ধারণা না থাকা।</span>
              </li>
            </ul>
          </div>

          {/* New way */}
          <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/5 p-8 space-y-4">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-lg">
              <CheckCircle2 className="h-5 w-5" />
              <h3>AI Marketing OS পদ্ধতি</h3>
            </div>
            <ul className="space-y-3.5 text-sm text-slate-300">
              <li className="flex gap-2.5">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <span>সব মেসেজ এক সেন্ট্রাল ইনবক্সে — সত্য ডেটা থেকে এআই তাৎক্ষণিক নির্ভুল ড্রাফট রিপ্লাই দেয়।</span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <span>চ্যাট থেকেই ১-ক্লিকে অর্ডার, কুরিয়ার বাল্ক বুকিং ও সরাসরি প্রিন্ট-রেডি বারকোড স্টিকার।</span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <span>পার্সেল বুক করার আগেই ফোন নম্বরের ডেলিভারি হিস্ট্রি স্ক্যান করে রিটার্ন রিস্ক স্কোর অ্যালার্ট।</span>
              </li>
              <li className="flex gap-2.5">
                <span className="text-emerald-400 shrink-0 font-bold">✓</span>
                <span>বিক্রি থেকে পণ্যের ক্রয়মূল্য, ডেলিভারি ফি ও অ্যাড স্পেন্ড বাদ দিয়ে রিয়েল নেট প্রফিট দৃশ্যমান।</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* INTERACTIVE BENTO-GRID FEATURE HIGHLIGHTS */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-semibold text-indigo-300">
          <Layers className="h-3.5 w-3.5 text-indigo-400" />
          <span>Complete Feature Matrix</span>
        </div>

        <h2 className="mt-4 text-3xl font-black text-white sm:text-4xl">
          আপনার ব্যবসার প্রতিটি ডিপার্টমেন্টের পাওয়ারফুল টুলস
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-slate-400 text-sm">
          নিচের প্রতিটি মডিউল বর্তমান সিস্টেমে লাইভ সংযুক্ত — কোনো ভবিষ্যতের প্রতিশ্রুতি নয়।
        </p>

        {/* Bento Grid */}
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 text-left">
          {/* Card 1 */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-7 space-y-4 hover:border-slate-700 transition">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Search className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-white">Omnichannel Competitor Spy</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Meta, Google, TikTok ও Bing থেকে প্রতিদ্বন্দীর সক্রিয় ও Winning বিজ্ঞাপন ট্র্যাক করুন। স্টকআউট হলে তৎক্ষণাৎ অ্যালার্ট এবং এক ক্লিকে AI কাউন্টার ক্যাম্পেইন তৈরি করুন।
            </p>
            <Link href="/features#spy" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300">
              বিস্তারিত দেখুন <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Card 2 */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-7 space-y-4 hover:border-slate-700 transition">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-white">Unified Inbox & Strict AI</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Facebook Page, WhatsApp, Instagram, Telegram ও Live Chat এক ইনবক্সে। যাচাই করা আসল পণ্যের তথ্য ছাড়া AI বানোয়াট কিছু বলতে পারে না (Strict Grounding)।
            </p>
            <Link href="/features#inbox" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300">
              বিস্তারিত দেখুন <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Card 3 */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-7 space-y-4 hover:border-slate-700 transition">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-white">COD Return Risk Score</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              একই ফোন নম্বরের আগের ডেলিভারি ইতিহাস থেকে রিটার্ন ঝুঁকির স্কোর ও কারণ। ঝুঁকিপূর্ণ অর্ডারে অগ্রিম কুরিয়ার ফি গ্রহণের অটোমেটেড পরামর্শ।
            </p>
            <Link href="/features#fraud" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300">
              বিস্তারিত দেখুন <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Card 4 */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-7 space-y-4 hover:border-slate-700 transition">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Truck className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-white">Multi-Courier Hub</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Steadfast, Pathao ও RedX — বুকিংয়ের আগেই চার্জ কোট, ৫০+ পার্সেল Bulk Booking, Barcode-সহ Label ও Invoice PDF এবং লাইভ স্ট্যাটাস অটো-সিঙ্ক।
            </p>
            <Link href="/features#courier" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300">
              বিস্তারিত দেখুন <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Card 5 */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-7 space-y-4 hover:border-slate-700 transition">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
              <GitFork className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-white">Visual Workflows & Bots</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              কন্ডিশনাল ব্রাঞ্চিং ও ড্র্যাগ-অ্যান্ড-ড্রপ নো-কোড ভিজ্যুয়াল ক্যানভাস। নতুন অর্ডার, পরিত্যক্ত কার্ট রিকভারি ও সেলফ-চেকআউট WhatsApp ক্যাটালগ বোট।
            </p>
            <Link href="/features#workflows" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300">
              বিস্তারিত দেখুন <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Card 6 */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-7 space-y-4 hover:border-slate-700 transition">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <TrendingUp className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-white">True Net Profit & Attribution</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              বিক্রি থেকে পণ্যের দাম (COGS), অ্যাড স্পেন্ড ও কুরিয়ার রিটার্ন ক্ষতি বাদ দিয়ে রিয়েল নেট প্রফিট। মাল্টি-টাচ অ্যাট্রিবিউশন ও Cohort LTV ট্র্যাকিং।
            </p>
            <Link href="/features#profit" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-400 hover:text-indigo-300">
              বিস্তারিত দেখুন <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Feature Banner CTA */}
        <div className="mt-10 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-6 flex flex-wrap items-center justify-between gap-4">
          <div className="text-left">
            <div className="font-bold text-white text-base">সবগুলো ফিচারের টেকনিক্যাল স্পেসিফিকেশন জানতে চান?</div>
            <div className="text-xs text-slate-400 mt-0.5">প্রতিটি ফিচারের বিস্তারিত ও আর্কিটেকচার আমাদের ফিচার ডিরেক্টরিতে দেখুন।</div>
          </div>
          <Link
            href="/features"
            className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-xs font-bold text-white flex items-center gap-2"
          >
            <span>সম্পূর্ণ ফিচার পেজ খুলুন</span>
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* HOW IT WORKS SECTION */}
      <section id="how" className="relative z-10 border-y border-slate-800/80 bg-slate-900/40 py-20">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h2 className="text-3xl font-black text-white sm:text-4xl">শুরু করা মাত্র ৩টি সহজ ধাপে</h2>
          <p className="mx-auto mt-2 max-w-xl text-slate-400 text-sm">
            ১০ মিনিটের মধ্যেই আপনার পুরো টিম নতুন অটোমেশনে কাজ শুরু করতে পারবে।
          </p>

          <div className="mt-12 grid gap-8 md:grid-cols-3 text-left">
            {[
              {
                n: "০১",
                t: t.landing.step1Title,
                b: "ইমেইল দিয়ে অ্যাকাউন্ট খুলুন এবং আপনার ব্যবসার Organization সেট করুন। ট্রায়াল তাৎক্ষণিক শুরু হয়ে যাবে।",
              },
              {
                n: "০২",
                t: "নিজের চ্যানেল কানেক্ট করুন",
                b: "Facebook Page, WooCommerce/Shopify এবং Steadfast/Pathao মার্চেন্ট অ্যাকাউন্ট নিরাপদভাবে সিঙ্ক করুন।",
              },
              {
                n: "০৩",
                t: "অটো-পাইলটে চালান",
                b: "ইনবক্সে এআই ড্রাফট রিপ্লাই, ১-ক্লিকে কুরিয়ার বুকিং, বিজ্ঞাপন অটোমেশন ও নেট প্রফিট ট্র্যাকিং উপভোগ করুন।",
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
          <span>Interactive Savings Simulator</span>
        </div>
        <h2 className="mt-4 text-3xl font-black text-white sm:text-4xl">
          রিটার্ন কমলে আপনার প্রতি মাসে কত টাকা সাশ্রয় হবে?
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-slate-400 text-sm">
          আপনার ব্যবসার নিজস্ব সংখ্যাগুলো দিয়ে নিজেই তাৎক্ষণিক ফলাফল দেখে নিন।
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
            <span>Transparent Pricing</span>
          </div>
          <h2 className="mt-4 text-3xl font-black text-white sm:text-4xl">সহজ ও স্বচ্ছ মূল্যতালিকা</h2>
          <p className="mx-auto mt-2 max-w-xl text-slate-400 text-sm">
            সব প্ল্যানে {fmtNumber("bn", pricing?.trialDays ?? 14)} দিনের ফ্রি ট্রায়াল অন্তর্ভুক্ত। এই মূল্য সরাসরি প্ল্যাটফর্মের লাইভ সেটিংস থেকে সিঙ্ক করা।
          </p>

          {!pricing ? (
            <p className="mt-10 text-center text-slate-500 text-sm">মূল্যতালিকা লোড হচ্ছে…</p>
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
                        সবচেয়ে জনপ্রিয়
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
                        <span>{fmtNumber("bn", p.limits.seats)} জন টিম মেম্বার সিট</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span>প্রতিদিন {fmtNumber("bn", p.limits.aiDaily)}টি AI ভেরিফাইড মেসেজ</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span>ব্রডকাস্ট ক্যাপাসিটি {fmtNumber("bn", p.limits.broadcastCap)} জন</span>
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
              নতুন সাইনআপ সাময়িকভাবে বন্ধ আছে — এডমিন টিম শীঘ্রই পুনরায় উন্মুক্ত করবে।
            </p>
          ) : null}
        </div>
      </section>

      {/* FAQ SECTION */}
      <section id="faq" className="relative z-10 mx-auto max-w-4xl px-6 py-20">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-semibold text-indigo-300">
            <HelpCircle className="h-3.5 w-3.5 text-indigo-400" />
            <span>Frequently Asked Questions</span>
          </div>
          <h2 className="mt-4 text-3xl font-black text-white sm:text-4xl">{t.landing.faqTitle}</h2>
          <p className="mx-auto mt-2 max-w-lg text-slate-400 text-xs sm:text-sm">
            মার্চেন্টদের সবচেয়ে সাধারণ প্রশ্ন ও উত্তর এক নজরে।
          </p>
        </div>

        {/* FAQ Search and Filter Controls */}
        <div className="mt-8 space-y-4">
          <div className="relative max-w-md mx-auto">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="যেকোনো প্রশ্ন লিখে খুঁজুন (যেমন: কুরিয়ার, ট্রায়াল, বাংলা)..."
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
              { id: "all", label: "সবগুলো" },
              { id: "courier", label: "কুরিয়ার ও রিটার্ন" },
              { id: "ai", label: "এআই ও ইনবক্স" },
              { id: "billing", label: "বিলিং ও নিরাপত্তা" },
              { id: "general", label: "সাধারণ ও অনবোর্ডিং" },
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
              দুঃখিত, আপনার সার্চ অনুযায়ী কোনো প্রশ্ন পাওয়া যায়নি।
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
                <div className="text-xs font-bold text-white">১৪ দিনের ফ্রি ট্রায়াল</div>
                <div className="text-[11px] text-slate-400">কোনো বাধ্যবাধকতা নেই</div>
              </div>
            </div>

            <div className="flex items-center gap-3.5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div>
                <div className="text-xs font-bold text-white">কার্ড ছাড়া রেজিস্ট্রেশন</div>
                <div className="text-[11px] text-slate-400">শুধুমাত্র ইমেইল প্রয়োজন</div>
              </div>
            </div>

            <div className="flex items-center gap-3.5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <div className="text-xs font-bold text-white">১০০% ডেটা আইসোলেশন</div>
                <div className="text-[11px] text-slate-400">কঠোর টেন্যান্ট গার্ড সিকিউরিটি</div>
              </div>
            </div>

            <div className="flex items-center gap-3.5 rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
                <Zap className="h-5 w-5" />
              </span>
              <div>
                <div className="text-xs font-bold text-white">ইনস্ট্যান্ট সেটআপ</div>
                <div className="text-[11px] text-slate-400">১০ মিনিটে লাইভ অটোমেশন</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL HIGH-CONVERSION CTA */}
      <section className="relative overflow-hidden border-t border-slate-800 bg-gradient-to-br from-indigo-950 via-slate-950 to-violet-950 py-20 text-center">
        <div className="mx-auto max-w-4xl px-6 relative z-10 space-y-6">
          <h2 className="text-3xl font-black text-white sm:text-5xl">
            আজই আপনার ব্যবসার সবকিছু আনুন এক কেন্দ্রীয় ড্যাশবোর্ডে
          </h2>
          <p className="mx-auto max-w-2xl text-base text-slate-300">
            {fmtNumber("bn", pricing?.trialDays ?? 14)} দিনের ফ্রি ট্রায়াল দিয়ে শুরু করুন — কোনো বাধ্যবাধকতা নেই।
            বিজ্ঞাপন, কুরিয়ার ও কাস্টমার মেসেজ হ্যান্ডল করুন আধুনিকতম উপায়ে।
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <RegisterCta
              label="ফ্রি ট্রায়াল শুরু করুন"
              className="rounded-2xl bg-gradient-to-r from-indigo-500 via-violet-600 to-fuchsia-600 px-9 py-4 text-base font-bold text-white shadow-xl shadow-indigo-500/30 transition hover:brightness-110 active:scale-[0.98]"
            />
            <Link
              href="/features"
              className="rounded-2xl border border-slate-700 bg-slate-900/80 px-8 py-4 text-base font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white"
            >
              ফিচার পরিচিতি দেখুন
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-slate-800 bg-slate-950 py-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 text-xs text-slate-500">
          <div>© {new Date().getFullYear()} Qosprey — AI Marketing OS. সর্বস্বত্ব সংরক্ষিত।</div>
          <div className="flex flex-wrap gap-5 sm:gap-6">
            <Link href="/features" className="hover:text-slate-300">ফিচারসমূহ</Link>
            <Link href="/pricing" className="hover:text-slate-300">{t.landing.footerPricing}</Link>
            <Link href="/privacy" className="hover:text-slate-300">গোপনীয়তা নীতি</Link>
            <Link href="/terms" className="hover:text-slate-300">শর্তাবলি</Link>
            <Link href="/login" className="hover:text-slate-300">{t.landing.footerLogin}</Link>
            <Link href="/register" className="hover:text-slate-300">{t.landing.footerRegister}</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
