"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { publicApiBase, API_URL, getToken } from "@/lib/api";

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

interface Plan { tier: string; priceMinor: number; limits: { aiDaily: number; broadcastCap: number; seats: number } }
interface Pricing { currency: string; trialDays: number; plans: Plan[] }
interface SysStatus { signupOpen: boolean; maintenanceMode: boolean; announcement: { title: string; body: string } | null }

const TIER_BN: Record<string, string> = { FREE: "ফ্রি", STARTER: "স্টার্টার", GROWTH: "গ্রোথ", AGENCY: "এজেন্সি" };

const FEATURES: { icon: string; title: string; body: string }[] = [
  { icon: "🕵️", title: "Omnichannel Competitor Spy", body: "Meta (Facebook), Google, TikTok ও Bing — প্রতিদ্বন্দীর সক্রিয় ও Winning বিজ্ঞাপন, তাদের স্টক ও দামের ওঠানামা লাইভ ট্র্যাক করুন। AI কাউন্টার-কপিসহ এক ক্লিকে Campaign Draft।" },
  { icon: "💬", title: "Unified Inbox", body: "Facebook Page, Messenger, WhatsApp, Instagram, Telegram, Email আর নিজের ওয়েবসাইটের Live Chat — সব চ্যানেলের মেসেজ এক ইনবক্সে। টিম অ্যাসাইনমেন্ট, SLA আর অটো-রিপ্লাইসহ।" },
  { icon: "🤖", title: "AI Assistant ও Autopilot", body: "আপনার আসল প্রোডাক্ট, দাম, স্টক আর পলিসি থেকে উত্তর খুঁজে দেয় AI। Strict Grounding মোডে যাচাই করা তথ্য ছাড়া AI কিছু বানিয়ে বলতে পারে না।" },
  { icon: "📣", title: "বিজ্ঞাপন অটোমেশন", body: "Meta, Google ও TikTok — ক্যাম্পেইন তৈরি, বাজেট নিয়ম, দিনের সময় অনুযায়ী চালু/বন্ধ (Dayparting), আর পলিসি প্রি-ফ্লাইট চেক এক জায়গা থেকে।" },
  { icon: "🎨", title: "AI Creative Studio", body: "আসল প্রোডাক্টের তথ্য থেকে বিজ্ঞাপনের কপি সাজেশন — প্রতিটি ভ্যারিয়েন্টে অটো পলিসি চেক, পছন্দ হলে এক ক্লিকে Campaign Draft।" },
  { icon: "🚚", title: "কুরিয়ার ও COD ম্যানেজমেন্ট", body: "Steadfast, Pathao ও RedX — বুকিংয়ের আগেই চার্জ কোট, Bulk Booking, Barcode-সহ Label ও Invoice PDF, লাইভ স্ট্যাটাস সিঙ্ক।" },
  { icon: "🛡️", title: "COD Return Risk Score", body: "একই ফোন নম্বরের আগের অর্ডার ইতিহাস থেকে রিটার্ন ঝুঁকির স্কোর ও কারণ — অর্ডার আটকায় না, শুধু সতর্ক করে যাতে অগ্রিম ডেলিভারি চার্জের সিদ্ধান্ত আপনি নিতে পারেন।" },
  { icon: "🔀", title: "Workflow ও ফ্লো বিল্ডার", body: "Wait ও Branch ধাপসহ অটোমেশন ওয়ার্কফ্লো — ফর্ম এডিটর অথবা Drag-and-drop ভিজ্যুয়াল ক্যানভাস, দুটোতেই একই ইঞ্জিন।" },
  { icon: "📊", title: "Analytics, Cohort ও Profit", body: "Revenue, Ad Spend ও Profit একসাথে; Cohort রিটেনশন, গ্রাহকপ্রতি LTV, Churn ঝুঁকি (লেবেলযুক্ত আনুমানিক হিসাব) আর Attribution রিপোর্ট।" },
  { icon: "👥", title: "Leads, CRM ও Customer 360", body: "পাইপলাইন বোর্ড (Drag-and-drop), গ্রাহকের পুরো ইতিহাস এক পেজে, RFM সেগমেন্ট আর Broadcast ক্যাম্পেইন।" },
];


const FAQS: { q: string; a: string }[] = [
  { q: "শুরু করতে কী কী লাগবে?", a: "শুধু একটি ইমেইল দিয়ে রেজিস্টার করলেই Organization তৈরি হয়ে যাবে। এরপর যেসব চ্যানেল ব্যবহার করতে চান (Facebook Page, WooCommerce স্টোর, কুরিয়ার অ্যাকাউন্ট) সেগুলো আপনার নিজের অ্যাকাউন্ট দিয়ে সংযোগ করতে হবে।" },
  { q: "Facebook বা কুরিয়ার অ্যাকাউন্ট কি আপনারা দেন?", a: "না। সব ইন্টিগ্রেশন আপনার নিজের ব্যবসায়িক অ্যাকাউন্ট দিয়ে চলে — Meta অ্যাপ/পেজ, WooCommerce স্টোর, Steadfast/Pathao/RedX মার্চেন্ট অ্যাকাউন্ট আপনার নিজের নামেই থাকে। আমরা কোনো তৃতীয় পক্ষের অ্যাকাউন্ট বা ক্রেডেনশিয়াল সরবরাহ করি না।" },
  { q: "দাম কি এখানে যা দেখছি সেটাই?", a: "হ্যাঁ। এই পেজের মূল্য সরাসরি প্ল্যাটফর্ম অপারেটরের লাইভ সেটিংস থেকে আসে — /pricing পেজেও হুবহু একই উৎস থেকে একই দাম দেখানো হয়। লুকানো চার্জ নেই।" },
  { q: "ট্রায়াল আছে কি?", a: "সব পেইড প্ল্যানে অপারেটর-নির্ধারিত ট্রায়াল পিরিয়ড থাকে (বর্তমান সেটিং অনুযায়ী নিচের প্রাইসিং অংশে দেখানো হয়েছে)। ট্রায়াল চলাকালে কার্ড বা পেমেন্ট তথ্য লাগে না।" },
  { q: "আমার ডেটা কি অন্য দোকান দেখতে পাবে?", a: "না। প্রতিটি Organization-এর ডেটা সম্পূর্ণ আলাদা (Tenant Isolation) — প্রোডাক্ট, অর্ডার, গ্রাহক, মেসেজ সবকিছু শুধু আপনার টিমই দেখতে পারে।" },
  { q: "বাংলা ভাষায় ব্যবহার করা যাবে?", a: "হ্যাঁ। পুরো ইন্টারফেস বাংলা-প্রথম, আর AI বাংলা ও ইংরেজি দুই ভাষাতেই গ্রাহকের মেসেজ বুঝে উত্তর দিতে পারে।" },
  { q: "এজেন্সি হিসেবে একাধিক ক্লায়েন্ট চালাতে পারব?", a: "AGENCY প্ল্যানে পোর্টফোলিও ভিউতে সব ক্লায়েন্টের ফলাফল একসাথে দেখা যায়, হোয়াইট-লেবেল ব্র্যান্ডিং আর পাসওয়ার্ড-ছাড়া Read-only ক্লায়েন্ট রিপোর্ট লিংক শেয়ার করা যায়।" },
];

/** Simplified CSS presentation in the style of the real inbox screen. */
function InboxFrame() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center gap-1.5 border-b bg-slate-50 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="ml-2 text-[11px] font-medium text-slate-500">Unified Inbox</span>
      </div>
      <div className="grid grid-cols-[1fr_1.4fr] text-left text-[11px] sm:grid-cols-[1fr_1.6fr_1fr]">
        <div className="space-y-1 border-r p-2">
          {[["🟦", "Rahim Uddin", "দাম কত?"], ["🟩", "Fatima Begum", "অর্ডার করেছি"], ["🟪", "Tanvir Hasan", "ডেলিভারি কবে?"]].map(([i, n, m]) => (
            <div key={n} className="rounded-lg bg-slate-50 p-2">
              <div className="font-semibold text-slate-700">{i} {n}</div>
              <div className="truncate text-slate-400">{m}</div>
            </div>
          ))}
        </div>
        <div className="space-y-2 p-3">
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-slate-700">আসসালামু আলাইকুম, এই শাড়িটার দাম কত?</div>
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-white">ওয়ালাইকুমুস সালাম! এই শাড়িটির দাম ৳১,২৫০। সারাদেশে ক্যাশ অন ডেলিভারি আছে।</div>
          <div className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">🤖 AI যাচাই করা প্রোডাক্ট তথ্য থেকে উত্তর দিয়েছে</div>
        </div>
        <div className="hidden space-y-1 border-l p-2 sm:block">
          <div className="font-semibold text-slate-600">Customer 360</div>
          <div className="text-slate-500">আগের অর্ডার: ৩টি</div>
          <div className="text-slate-500">ডেলিভারি সফল: ৩টি</div>
          <div className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">রিটার্ন ঝুঁকি: কম</div>
        </div>
      </div>
    </div>
  );
}

/** Simplified CSS presentation of Omnichannel Competitor Spy screen. */
function CompetitorSpyFrame() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl text-left">
      <div className="flex items-center justify-between border-b bg-slate-900 px-4 py-2.5 text-white">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-xs font-bold">Omnichannel Competitor Spy & Intelligence</span>
        </div>
        <div className="flex gap-1.5 text-[10px] font-semibold">
          <span className="rounded bg-indigo-500/30 px-2 py-0.5">Meta Ads</span>
          <span className="rounded bg-blue-500/30 px-2 py-0.5">Google Ads</span>
          <span className="rounded bg-pink-500/30 px-2 py-0.5">TikTok</span>
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        {/* Card 1: Winning ad */}
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
              🔥 WINNING AD (২৮ দিন ধরে চলছে)
            </span>
            <span className="text-[10px] text-slate-500">Facebook • Instagram</span>
          </div>
          <p className="text-xs text-slate-800 line-clamp-2">
            "প্রিমিয়াম পাঞ্জাবি কালেকশন — সীমিত সময়ের জন্য বিশেষ ছাড়! ক্যাশ অন ডেলিভারি সুবিধা।"
          </p>
          <div className="rounded bg-white p-2 border border-amber-200/80 text-[11px] text-slate-700">
            <span className="font-bold text-indigo-700">⚡ AI Counter Strategy:</span> প্রতিযোগীর অফারে ফ্রি ডেলিভারি নেই। আমাদের ক্যাম্পেইনে ফ্রি হোম ডেলিভারি ও দ্রুত শিপিং অফার দিন।
          </div>
        </div>

        {/* Card 2: Stock-out Opportunity */}
        <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
              🚨 STOCK-OUT OPPORTUNITY
            </span>
            <span className="text-[10px] text-slate-500">লাইভ স্টক স্ক্যান</span>
          </div>
          <p className="text-xs font-semibold text-slate-900">
            প্রতিযোগী "Rival Shop" এর ওয়্যারলেস হেডফোন বর্তমানে <span className="text-rose-600 font-bold">আউট-অব-স্টক!</span>
          </p>
          <div className="rounded bg-white p-2 border border-rose-200/80 text-[11px] text-slate-700">
            💡 এআই পরামর্শ: আপনার ইনভেন্টরির হেডফোনে বিজ্ঞাপন বাজেট বাড়িয়ে প্রতিদ্বন্দীর ক্রেতাদের নিজের স্টোরে আনুন।
          </div>
        </div>
      </div>
    </div>
  );
}


function RoiCalculator() {
  const [orders, setOrders] = useState(1000);
  const [returnCost, setReturnCost] = useState(120);
  const [currentPct, setCurrentPct] = useState(20);
  const [targetPct, setTargetPct] = useState(12);
  const result = useMemo(() => {
    const savedReturns = Math.max(0, orders * (currentPct - targetPct) / 100);
    return { savedReturns, saving: savedReturns * returnCost };
  }, [orders, returnCost, currentPct, targetPct]);
  const num = (v: number) => v.toLocaleString("bn-BD");
  const field = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
  return (
    <div className="card mx-auto max-w-3xl p-6 text-left">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">মাসে মোট অর্ডার সংখ্যা
          <input type="number" min={0} className={field + " mt-1"} value={orders} onChange={(e) => setOrders(Number(e.target.value) || 0)} /></label>
        <label className="block text-sm font-medium text-slate-700">প্রতিটি রিটার্নে মোট কুরিয়ার খরচ (আসা-যাওয়া, ৳)
          <input type="number" min={0} className={field + " mt-1"} value={returnCost} onChange={(e) => setReturnCost(Number(e.target.value) || 0)} /></label>
        <label className="block text-sm font-medium text-slate-700">বর্তমান রিটার্ন হার (%)
          <input type="number" min={0} max={100} className={field + " mt-1"} value={currentPct} onChange={(e) => setCurrentPct(Number(e.target.value) || 0)} /></label>
        <label className="block text-sm font-medium text-slate-700">আপনার লক্ষ্য রিটার্ন হার (%)
          <input type="number" min={0} max={100} className={field + " mt-1"} value={targetPct} onChange={(e) => setTargetPct(Number(e.target.value) || 0)} /></label>
      </div>
      <div className="mt-5 rounded-2xl bg-indigo-50 p-5">
        <div className="text-sm text-indigo-900">মাসে আনুমানিক সাশ্রয়</div>
        <div className="mt-1 text-3xl font-black text-indigo-700">৳{num(Math.round(result.saving))}</div>
        <div className="mt-1 text-sm text-indigo-900">মাসে প্রায় {num(Math.round(result.savedReturns))}টি রিটার্ন কমলে</div>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        <b>হিসাবের সূত্র:</b> মাসিক সাশ্রয় = মাসিক অর্ডার × (বর্তমান রিটার্ন % − লক্ষ্য রিটার্ন %) ÷ ১০০ × প্রতি রিটার্নের কুরিয়ার খরচ।
        এটি <b>আনুমানিক হিসাব</b> — শুধু আপনার দেওয়া সংখ্যা দিয়েই হিসাব করা, কোনো প্রতিশ্রুত সাশ্রয় নয়।
        COD কনফার্মেশন কল ও রিটার্ন-ঝুঁকি স্কোর রিটার্ন কমাতে সাহায্য করার জন্যই তৈরি, তবে প্রকৃত ফল আপনার ব্যবসা ও গ্রাহকের ওপর নির্ভর করে।
      </p>
    </div>
  );
}

export default function Landing() {
  const router = useRouter();
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [status, setStatus] = useState<SysStatus | null>(null);

  useEffect(() => {
    // Preserve the pre-M58 behaviour for signed-in users: "/" used to
    // redirect straight to /dashboard, and it still does for them.
    if (getToken()) { router.replace("/dashboard"); return; }
    fetch(`${publicApiBase()}/public/pricing`).then((r) => (r.ok ? r.json() : null)).then(setPricing).catch(() => undefined);
    fetch(`${API_URL}/public/system-status`).then((r) => (r.ok ? r.json() : null)).then(setStatus).catch(() => undefined);
  }, [router]);

  const signupClosed = status?.signupOpen === false;
  const RegisterCta = ({ className }: { className: string }) => signupClosed
    ? <span className={className + " cursor-not-allowed opacity-60"} title="নতুন সাইনআপ আপাতত বন্ধ আছে">সাইনআপ সাময়িক বন্ধ</span>
    : <a href="/register" className={className}>ফ্রি শুরু করুন</a>;

  return (
    <main className="min-h-screen">
      {status?.maintenanceMode ? (
        <div className="bg-amber-400 px-4 py-2 text-center text-sm font-medium text-amber-950">🔧 রক্ষণাবেক্ষণ চলছে — কিছু ফিচার সাময়িকভাবে ধীর বা অনুপলব্ধ থাকতে পারে।</div>
      ) : null}
      {status?.announcement ? (
        <div className="bg-indigo-600 px-4 py-2 text-center text-sm text-white">📣 <b>{status.announcement.title}</b> — {status.announcement.body}</div>
      ) : null}

      <header className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-[17px] font-black text-white">Q</span>
        <div>
          <div className="text-[15px] font-bold leading-tight">AI Marketing OS</div>
          <div className="text-[11px] text-slate-500">by Qosprey</div>
        </div>
        <nav className="ml-auto hidden items-center gap-5 text-sm font-medium text-slate-600 md:flex">
          <a href="#features" className="hover:text-indigo-600">ফিচার</a>
          <a href="#how" className="hover:text-indigo-600">কীভাবে কাজ করে</a>
          <a href="#pricing" className="hover:text-indigo-600">মূল্য</a>
          <a href="#faq" className="hover:text-indigo-600">জিজ্ঞাসা</a>
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-6">
          <a href="/login" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">লগইন</a>
          <RegisterCta className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500" />
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-8 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-black leading-tight tracking-tight text-slate-900 sm:text-5xl">
          আপনার ই-কমার্স ব্যবসার <span className="bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text text-transparent">সব মেসেজ, বিজ্ঞাপন আর ডেলিভারি</span> — এক ড্যাশবোর্ডে
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
          Facebook, WhatsApp, Instagram-এর সব গ্রাহক মেসেজ এক ইনবক্সে; যাচাই করা তথ্য থেকে AI উত্তর; Meta/Google/TikTok বিজ্ঞাপন অটোমেশন;
          Steadfast/Pathao/RedX কুরিয়ার বুকিং আর COD রিটার্ন-ঝুঁকির সতর্কতা — বাংলাদেশের অনলাইন বিক্রেতাদের জন্য তৈরি অল-ইন-ওয়ান মার্কেটিং অপারেটিং সিস্টেম।
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <RegisterCta className="rounded-2xl bg-indigo-600 px-7 py-3.5 text-base font-bold text-white shadow-lg hover:bg-indigo-500" />
          <a href="#pricing" className="rounded-2xl border border-slate-300 bg-white px-7 py-3.5 text-base font-bold text-slate-700 hover:bg-slate-50">মূল্য দেখুন</a>
        </div>
        <p className="mt-3 text-xs text-slate-400">সব প্ল্যানে {pricing?.trialDays ?? 14} দিনের ট্রায়াল · নিজের চ্যানেল ও কুরিয়ার অ্যাকাউন্ট দিয়েই চলে</p>
        <div className="mx-auto mt-10 max-w-4xl">
          <InboxFrame />
          <p className="mt-2 text-[11px] text-slate-400">চিত্রটি প্রোডাক্টের আসল ইনবক্স স্ক্রিনের ধাঁচে তৈরি একটি সরল উপস্থাপনা।</p>
        </div>
      </section>

      {/* Problem / solution */}
      <section className="border-y bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-14 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">প্রতিদিনের ঝামেলা</h2>
            <ul className="mt-4 space-y-3 text-[15px] leading-relaxed text-slate-600">
              <li>😩 পেজ, WhatsApp, Instagram — তিন জায়গায় মেসেজ দেখতে গিয়ে গ্রাহকের উত্তর পেতে দেরি</li>
              <li>📦 কোন অর্ডার কোন কুরিয়ারে গেল, কোনটা রিটার্ন এলো — স্প্রেডশিটে খুঁজে হয়রানি</li>
              <li>💸 রিটার্ন আর Fake অর্ডারে প্রতি মাসে কুরিয়ার চার্জের নীরব ক্ষতি</li>
              <li>📉 কোন বিজ্ঞাপনে আসলে লাভ হচ্ছে, কোনটায় লস — পরিষ্কার হিসাব নেই</li>
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">এক প্ল্যাটফর্মে সমাধান</h2>
            <ul className="mt-4 space-y-3 text-[15px] leading-relaxed text-slate-600">
              <li>✅ সব চ্যানেলের মেসেজ এক ইনবক্সে — AI খসড়া উত্তর সাজিয়ে দেয়, টিম একসাথে কাজ করে</li>
              <li>✅ ইনবক্স থেকেই অর্ডার, এক ক্লিকে কুরিয়ার বুকিং, Label PDF আর লাইভ ট্র্যাকিং</li>
              <li>✅ অর্ডারের আগেই COD রিটার্ন-ঝুঁকির স্কোর ও কারণ — সিদ্ধান্ত আপনার, সতর্কতা সিস্টেমের</li>
              <li>✅ Revenue, Ad Spend ও Profit পাশাপাশি — কোন ক্যাম্পেইন লাভ দিচ্ছে পরিষ্কার দেখা যায়</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Competitor Spy Showcase Section */}
      <section className="bg-slate-50 border-b py-16">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">
            🔥 হাই-ইমপ্যাক্ট ইন্টেলিজেন্স
          </span>
          <h2 className="mt-3 text-3xl font-black text-slate-900 sm:text-4xl">
            প্রতিযোগীদের সেরা বিজ্ঞাপন ও অফার স্পাই করুন — এক ক্লিকে পাল্টা ক্যাম্পেইন
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-base text-slate-600">
            Meta, Google, TikTok ও Bing থেকে প্রতিদ্বন্দীর সবচেয়ে সফল (Winning) বিজ্ঞাপনগুলো ট্র্যাক করুন। তাদের দুর্বলতা বিশ্লেষণ করে এআই তৈরি করে দেবে আপনার জন্য বিজয়ী অ্যাড কপি।
          </p>
          <div className="mx-auto mt-8 max-w-4xl">
            <CompetitorSpyFrame />
            <p className="mt-2 text-[11px] text-slate-400">চিত্রটি প্রোডাক্টের আসল Competitor Spy ইন্টারফেসের ধাঁচে তৈরি একটি সরল উপস্থাপনা।</p>
          </div>
        </div>
      </section>

      {/* Features */}

      <section id="features" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center text-3xl font-bold text-slate-900">যা যা পাচ্ছেন</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-slate-500">নিচের প্রতিটি ফিচার আজকের প্রোডাক্টেই চালু আছে — ভবিষ্যতের প্রতিশ্রুতি নয়।</p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card card-hover p-6">
              <div className="text-3xl">{f.icon}</div>
              <h3 className="mt-3 font-bold text-slate-900">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-center text-3xl font-bold text-slate-900">শুরু করা মাত্র ৩ ধাপে</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              ["১", "রেজিস্টার করুন", "ইমেইল দিয়ে অ্যাকাউন্ট খুলুন, আপনার ব্যবসার Organization তৈরি করুন — ট্রায়াল সাথে সাথেই শুরু।"],
              ["২", "নিজের অ্যাকাউন্টগুলো সংযোগ করুন", "Facebook Page, WooCommerce/Shopify স্টোর আর কুরিয়ার মার্চেন্ট অ্যাকাউন্ট — সব আপনার নিজের অ্যাকাউন্ট, যাচাই করেই সংযোগ সেভ হয়।"],
              ["৩", "এক জায়গা থেকে চালান", "ইনবক্সে মেসেজের উত্তর, বিজ্ঞাপন অটোমেশন, অর্ডার ও কুরিয়ার — টিমের সবাই একই ড্যাশবোর্ডে।"],
            ].map(([n, t, b]) => (
              <div key={n} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-xl font-black text-white">{n}</div>
                <h3 className="mt-3 font-bold text-slate-900">{t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ROI calculator */}
      <section className="mx-auto max-w-6xl px-6 py-16 text-center">
        <h2 className="text-3xl font-bold text-slate-900">রিটার্ন কমলে কত সাশ্রয় হতে পারে?</h2>
        <p className="mx-auto mt-2 max-w-xl text-slate-500">নিজের ব্যবসার সংখ্যা বসিয়ে নিজেই হিসাব করে দেখুন।</p>
        <div className="mt-8"><RoiCalculator /></div>
      </section>

      {/* Pricing — same source as /pricing */}
      <section id="pricing" className="border-y bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-center text-3xl font-bold text-slate-900">সহজ ও স্বচ্ছ মূল্য</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-slate-500">সব প্ল্যানে {pricing?.trialDays ?? 14} দিনের ট্রায়াল। এই দামগুলো প্ল্যাটফর্ম অপারেটরের লাইভ সেটিংস থেকে সরাসরি আসে — <a className="text-indigo-600 underline" href="/pricing">প্রাইসিং পেজেও</a> একই দাম দেখবেন।</p>
          {!pricing ? <p className="mt-10 text-center text-slate-400">মূল্য লোড হচ্ছে…</p> : (
            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {pricing.plans.map((p) => (
                <div key={p.tier} className="rounded-3xl border bg-white p-6 shadow-sm">
                  <div className="text-sm font-semibold uppercase tracking-wide text-indigo-600">{TIER_BN[p.tier] ?? p.tier}</div>
                  <div className="mt-3 text-3xl font-bold">
                    {p.priceMinor === 0 ? "৳০" : `৳${(p.priceMinor / 100).toLocaleString("bn-BD")}`}
                    <span className="text-sm font-normal text-slate-400"> /মাস</span>
                  </div>
                  <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
                    <li>👥 {p.limits.seats} জন টিম মেম্বার</li>
                    <li>🤖 প্রতিদিন {p.limits.aiDaily} টি AI মেসেজ</li>
                    <li>📣 ব্রডকাস্ট সীমা {p.limits.broadcastCap.toLocaleString()} জন</li>
                  </ul>
                  <RegisterCta className="mt-5 block rounded-xl bg-indigo-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-indigo-500" />
                </div>
              ))}
            </div>
          )}
          {signupClosed ? <p className="mt-6 text-center text-sm font-medium text-amber-700">নতুন সাইনআপ আপাতত বন্ধ আছে — প্ল্যাটফর্ম টিম সাময়িকভাবে রেজিস্ট্রেশন বন্ধ রেখেছে।</p> : null}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-6 py-16">
        <h2 className="text-center text-3xl font-bold text-slate-900">সাধারণ জিজ্ঞাসা</h2>
        <div className="mt-8 space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="card group p-5">
              <summary className="cursor-pointer font-semibold text-slate-900">{f.q}</summary>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center text-white">
          <h2 className="text-3xl font-black">আজই আপনার ব্যবসার সবকিছু এক জায়গায় আনুন</h2>
          <p className="mx-auto mt-3 max-w-xl text-indigo-100">{pricing?.trialDays ?? 14} দিনের ফ্রি ট্রায়াল দিয়ে শুরু করুন — পছন্দ না হলে চালিয়ে যাওয়ার কোনো বাধ্যবাধকতা নেই।</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <RegisterCta className="rounded-2xl bg-white px-7 py-3.5 text-base font-bold text-indigo-700 shadow-lg hover:bg-indigo-50" />
            <a href="/login" className="rounded-2xl border border-white/50 px-7 py-3.5 text-base font-bold text-white hover:bg-white/10">লগইন করুন</a>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-8 text-sm text-slate-400">
        <span>© {new Date().getFullYear()} Qosprey — AI Marketing OS</span>
        <span className="ml-auto flex gap-4">
          <a className="hover:text-indigo-600" href="/pricing">মূল্য</a>
          <a className="hover:text-indigo-600" href="/login">লগইন</a>
          <a className="hover:text-indigo-600" href="/register">রেজিস্টার</a>
        </span>
      </footer>
    </main>
  );
}
