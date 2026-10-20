"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Search,
  MessageSquare,
  ShieldAlert,
  Megaphone,
  GitFork,
  TrendingUp,
  Bot,
  Truck,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Sliders,
  DollarSign,
  Package,
  Layers,
  ArrowUpRight,
  ShieldCheck,
  Zap,
  Clock,
  ChevronRight,
  Lock,
  Menu,
  X,
} from "lucide-react";
import { API_URL, publicApiBase, getToken } from "@/lib/api";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

interface SysStatus {
  signupOpen: boolean;
  maintenanceMode: boolean;
  announcement: { title: string; body: string } | null;
}

export default function FeaturesClient() {
  const [status, setStatus] = useState<SysStatus | null>(null);
  const [activePillar, setActivePillar] = useState<string>("spy");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/public/system-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  const signupClosed = status?.signupOpen === false;
  const RegisterCta = ({
    className,
    label = t.features.registerCtaDefault,
  }: {
    className: string;
    label?: string;
  }) =>
    signupClosed ? (
      <span
        className={`${className} cursor-not-allowed opacity-60`}
        title={t.features.signupClosedTitle}
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
      {status?.maintenanceMode ? (
        <div className="bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950">
          {t.features.maintenanceBanner}
        </div>
      ) : null}

      {/* Ambient background glow effects - GPU accelerated */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden transform-gpu">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-[130px] will-change-transform" />
        <div className="absolute top-[40%] right-[-100px] h-[450px] w-[500px] rounded-full bg-violet-600/10 blur-[120px] will-change-transform" />
        <div className="absolute top-[70%] left-[-100px] h-[450px] w-[500px] rounded-full bg-fuchsia-600/10 blur-[130px] will-change-transform" />
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-25" />
      </div>

      {/* Sticky Header */}
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3 group">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-500 via-violet-500 to-fuchsia-500 text-lg font-black text-white shadow-lg shadow-indigo-500/25 transition group-hover:scale-105">
              Q
            </span>
            <div>
              <div className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                AI Marketing OS
                <span className="rounded-full bg-indigo-500/20 border border-indigo-500/40 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                  {t.features.headerBadge}
                </span>
              </div>
              <div className="text-xs text-slate-400">by Qosprey</div>
            </div>
          </Link>

          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-300 md:flex">
            <Link href="/" className="transition hover:text-white">
              {t.features.navHome}
            </Link>
            <a href="#spy" className="transition hover:text-indigo-400">
              {t.features.navSpy}
            </a>
            <a href="#inbox" className="transition hover:text-indigo-400">
              {t.features.navInbox}
            </a>
            <a href="#fraud" className="transition hover:text-indigo-400">
              {t.features.navFraud}
            </a>
            <a href="#courier" className="transition hover:text-indigo-400">
              {t.features.navCourier}
            </a>
            <a href="#workflows" className="transition hover:text-indigo-400">
              {t.features.navWorkflows}
            </a>
            <a href="#profit" className="transition hover:text-indigo-400">
              {t.features.navProfit}
            </a>
            <Link href="/pricing" className="transition hover:text-white">
              {t.landing.navPricing}
            </Link>
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
            aria-label={t.features.toggleMenuAria}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-b border-slate-800 bg-slate-950 px-6 py-4 space-y-3 text-sm">
            <Link href="/" onClick={() => setMobileMenuOpen(false)} className="block py-1 text-slate-300 hover:text-white">
              {t.features.mobileNavHome}
            </Link>
            <a href="#spy" onClick={() => setMobileMenuOpen(false)} className="block py-1 text-indigo-400 font-semibold">
              {t.features.navSpy}
            </a>
            <a href="#inbox" onClick={() => setMobileMenuOpen(false)} className="block py-1 text-slate-300 hover:text-white">
              {t.features.navInbox}
            </a>
            <a href="#fraud" onClick={() => setMobileMenuOpen(false)} className="block py-1 text-slate-300 hover:text-white">
              {t.features.navFraud}
            </a>
            <a href="#courier" onClick={() => setMobileMenuOpen(false)} className="block py-1 text-slate-300 hover:text-white">
              {t.features.navCourier}
            </a>
            <a href="#workflows" onClick={() => setMobileMenuOpen(false)} className="block py-1 text-slate-300 hover:text-white">
              {t.features.mobileNavWorkflows}
            </a>
            <a href="#profit" onClick={() => setMobileMenuOpen(false)} className="block py-1 text-slate-300 hover:text-white">
              {t.features.navProfit}
            </a>
            <Link href="/pricing" onClick={() => setMobileMenuOpen(false)} className="block py-1 text-slate-300 hover:text-white">
              {t.features.mobileNavPricing}
            </Link>
            <div className="pt-2 flex gap-2">
              <Link href="/login" className="flex-1 text-center py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-semibold text-white">
                {t.landing.login}
              </Link>
              <RegisterCta className="flex-1 text-center py-2.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold" />
            </div>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-16 pb-12 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1.5 text-xs font-semibold text-indigo-300 shadow-inner">
          <Sparkles className="h-3.5 w-3.5 text-indigo-400 animate-pulse" />
          <span>{t.features.heroBadge}</span>
        </div>

        <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
          {t.features.heroTitlePrefix}{" "}
          <span className="bg-gradient-to-r from-indigo-400 via-violet-300 to-fuchsia-400 bg-clip-text text-transparent">
            {t.features.heroTitleAccent}
          </span>
        </h1>

        <p className="mx-auto mt-5 max-w-3xl text-base sm:text-lg leading-relaxed text-slate-400">
          {t.features.heroBody}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <RegisterCta
            label={t.features.heroTrialCta}
            className="rounded-2xl bg-gradient-to-r from-indigo-500 via-violet-600 to-fuchsia-600 px-8 py-4 text-base font-bold text-white shadow-xl shadow-indigo-500/25 transition hover:brightness-110 active:scale-[0.98]"
          />
          <Link
            href="/#pricing"
            className="rounded-2xl border border-slate-800 bg-slate-900/80 px-8 py-4 text-base font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white"
          >
            {t.features.heroPricingCta}
          </Link>
        </div>

        {/* Quick Anchor Switcher Bar */}
        <div className="mx-auto mt-12 flex max-w-4xl flex-wrap justify-center gap-2 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-2 backdrop-blur-md">
          {[
            { id: "spy", label: t.features.anchorSpy, icon: Search },
            { id: "inbox", label: t.features.anchorInbox, icon: MessageSquare },
            { id: "fraud", label: t.features.anchorFraud, icon: ShieldAlert },
            { id: "courier", label: t.features.anchorCourier, icon: Truck },
            { id: "workflows", label: t.features.anchorWorkflows, icon: GitFork },
            { id: "profit", label: t.features.anchorProfit, icon: TrendingUp },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activePillar === item.id;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={() => setActivePillar(item.id)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition ${
                  isActive
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </div>
      </section>

      {/* MAIN FEATURE DEEP-DIVE SECTIONS */}
      <div className="relative z-10 mx-auto max-w-6xl space-y-24 px-6 pb-24">

        {/* PILLAR 1: Omnichannel Competitor Spy */}
        <section id="spy" className="scroll-mt-24 rounded-3xl border border-slate-800 bg-slate-900/50 p-8 sm:p-12 backdrop-blur-sm">
          <div className="grid gap-10 lg:grid-cols-2 items-center">
            <div className="space-y-5 text-left">
              <div className="inline-flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-1 text-xs font-bold text-amber-400">
                <Search className="h-3.5 w-3.5" />
                <span>{t.features.spyBadge}</span>
              </div>
              <h2 className="text-3xl font-black text-white sm:text-4xl">
                {t.features.spyTitle}
              </h2>
              <p className="text-base text-slate-300 leading-relaxed">
                {t.features.spyBody}
              </p>

              <div className="space-y-3 pt-2">
                {[
                  { title: t.features.spyF1Title, desc: t.features.spyF1Desc },
                  { title: t.features.spyF2Title, desc: t.features.spyF2Desc },
                  { title: t.features.spyF3Title, desc: t.features.spyF3Desc },
                ].map((f, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <CheckCircle2 className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-bold text-white">{f.title}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Visual Frame */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl space-y-3.5 text-left">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-bold text-slate-200">Live Competitor Stream</span>
                </div>
                <div className="flex gap-1.5 text-[10px] font-semibold text-slate-400">
                  <span className="rounded bg-indigo-500/20 text-indigo-300 px-2 py-0.5">Meta</span>
                  <span className="rounded bg-sky-500/20 text-sky-300 px-2 py-0.5">Google</span>
                  <span className="rounded bg-pink-500/20 text-pink-300 px-2 py-0.5">TikTok</span>
                </div>
              </div>

              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 text-[10px] font-bold">
                    🔥 WINNING AD • ৩৪ দিন ধরে চলছে
                  </span>
                  <span className="text-[11px] text-slate-400">ফেসবুক ও ইনস্টাগ্রাম</span>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed font-medium">
                  "প্রিমিয়াম লেদার ওয়ালেট — ১০০% জেনুইন লেদার। আজই অর্ডার করুন ক্যাশ অন ডেলিভারিতে।"
                </p>
                <div className="rounded-lg bg-slate-900 border border-slate-800 p-2.5 text-[11px] text-slate-300">
                  <span className="font-bold text-indigo-400">⚡ AI Counter Analysis:</span> প্রতিদ্বন্দীর বিজ্ঞাপনে কোনো ওয়ারেন্টি বা ফ্রি গিফট নেই। আমাদের ক্যাম্পেইনে "১ বছরের রিপ্লেসমেন্ট ওয়ারেন্টি + ফ্রি কার্ডহোল্ডার" দিয়ে অ্যাড চালান।
                </div>
              </div>

              <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3.5 text-xs text-slate-300 flex items-center justify-between">
                <div>
                  <div className="font-bold text-rose-400">🚨 STOCKOUT DETECTED: "Rival Fashion"</div>
                  <div className="text-[11px] text-slate-400">কালো রঙের পাঞ্জাবি (XL Size) আউট অব স্টক হয়েছে।</div>
                </div>
                <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-500">
                  ক্যাম্পেইন ড্রাফট
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* PILLAR 2: Unified Omnichannel Inbox & Strict Grounding AI */}
        <section id="inbox" className="scroll-mt-24 rounded-3xl border border-slate-800 bg-slate-900/50 p-8 sm:p-12 backdrop-blur-sm">
          <div className="grid gap-10 lg:grid-cols-2 items-center">
            {/* Visual Frame */}
            <div className="order-2 lg:order-1 rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl space-y-3 text-left">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-indigo-400" />
                  <span className="text-xs font-bold text-slate-200">Unified Messenger & WhatsApp Hub</span>
                </div>
                <span className="rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold">
                  ● Strict Grounding Active
                </span>
              </div>

              <div className="space-y-2.5">
                <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-800/90 p-3 text-xs text-slate-200">
                  <div className="text-[10px] text-indigo-400 font-bold mb-1">গ্রাহক (WhatsApp):</div>
                  আপনাদের কি সিল্ক শাড়ির ব্লু কালারটা ইন-স্টক আছে? ডেলিভারি চার্জ কত ঢাকার বাইরে?
                </div>
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-gradient-to-r from-indigo-600 to-violet-600 p-3 text-xs text-white">
                  <div className="text-[10px] text-indigo-200 font-bold mb-1">🤖 AI Verified Assistant:</div>
                  জি! প্রিমিয়াম সিল্ক শাড়ি (রয়্যাল ব্লু) বর্তমানে আমাদের কাছে ৫টি স্টকে আছে, মূল্য ৳১,৯৫০। ঢাকার বাইরে ডেলিভারি চার্জ মাত্র ৳১৩০ এবং ক্যাশ অন ডেলিভারি সুবিধা রয়েছে।
                </div>
                <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/30 p-2 text-[10px] text-emerald-300 font-medium flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>উত্তরটি স্টোরের সরাসরি ডাটাবেজ (SKU: SLK-BL-01) ও ডেলিভারি পলিসি থেকে সত্যতা যাচাইকৃত। কোনো অনুমান নয়।</span>
                </div>
              </div>

              <div className="border-t border-slate-800/80 pt-3 flex items-center justify-between">
                <div className="text-xs text-slate-400">ইনবক্স থেকেই ১-ক্লিকে অর্ডার কনফার্ম করুন:</div>
                <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">
                  + Create Order (৳১,৯৫০)
                </button>
              </div>
            </div>

            <div className="order-1 lg:order-2 space-y-5 text-left">
              <div className="inline-flex items-center gap-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 text-xs font-bold text-indigo-400">
                <MessageSquare className="h-3.5 w-3.5" />
                <span>{t.features.inboxBadge}</span>
              </div>
              <h2 className="text-3xl font-black text-white sm:text-4xl">
                {t.features.inboxTitle}
              </h2>
              <p className="text-base text-slate-300 leading-relaxed">
                {t.features.inboxBody}
              </p>

              <div className="space-y-3 pt-2">
                {[
                  { title: t.features.inboxF1Title, desc: t.features.inboxF1Desc },
                  { title: t.features.inboxF2Title, desc: t.features.inboxF2Desc },
                  { title: t.features.inboxF3Title, desc: t.features.inboxF3Desc },
                ].map((f, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <CheckCircle2 className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-bold text-white">{f.title}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* PILLAR 3: COD Return Fraud Shield */}
        <section id="fraud" className="scroll-mt-24 rounded-3xl border border-slate-800 bg-slate-900/50 p-8 sm:p-12 backdrop-blur-sm">
          <div className="grid gap-10 lg:grid-cols-2 items-center">
            <div className="space-y-5 text-left">
              <div className="inline-flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-1 text-xs font-bold text-rose-400">
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>{t.features.fraudBadge}</span>
              </div>
              <h2 className="text-3xl font-black text-white sm:text-4xl">
                {t.features.fraudTitle}
              </h2>
              <p className="text-base text-slate-300 leading-relaxed">
                {t.features.fraudBody}
              </p>

              <div className="space-y-3 pt-2">
                {[
                  { title: t.features.fraudF1Title, desc: t.features.fraudF1Desc },
                  { title: t.features.fraudF2Title, desc: t.features.fraudF2Desc },
                  { title: t.features.fraudF3Title, desc: t.features.fraudF3Desc },
                ].map((f, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <CheckCircle2 className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-bold text-white">{f.title}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Visual Frame */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl space-y-4 text-left">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-rose-400" />
                  <span className="text-xs font-bold text-slate-200">COD Return Risk Evaluator</span>
                </div>
                <span className="text-[11px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 rounded-full">
                  ⚠️ HIGH RETURN RISK
                </span>
              </div>

              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400">গ্রাহকের ফোন: <b className="text-white">017XXXXXXXX</b></span>
                  <span className="font-bold text-rose-400">ঝুঁকি স্কোর: ৭৮/১০০</span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-amber-500 to-rose-600 w-[78%]" />
                </div>
                <div className="space-y-1 text-xs text-slate-300">
                  <div className="flex items-center gap-1.5 text-rose-300">
                    <span>✕</span> গত ৪৫ দিনে বিভিন্ন দোকানে ৩টি পার্সেল আনডেলিভার্ড/রিটার্ন করেছে।
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <span>ℹ️</span> সফল ডেলিভারির হার মাত্র ৪০%।
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-indigo-950/40 border border-indigo-500/30 p-3.5 text-xs text-indigo-200 space-y-2">
                <div className="font-bold flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-indigo-400" />
                  <span>সিস্টেমের অটোমেশন পরামর্শ:</span>
                </div>
                <p className="text-[11px] text-slate-300">
                  পার্সেল বুক করার পূর্বে ৳১৫০ অগ্রিম কুরিয়ার চার্জ গ্রহণ করুন। নিচে ক্লিক করে কাস্টমারকে bKash/Nagad পেমেন্ট লিংক পাঠান।
                </p>
                <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">
                  Send Advance Payment SMS / WhatsApp
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* PILLAR 4: Multi-Courier Engine & Bulk Logistics */}
        <section id="courier" className="scroll-mt-24 rounded-3xl border border-slate-800 bg-slate-900/50 p-8 sm:p-12 backdrop-blur-sm">
          <div className="grid gap-10 lg:grid-cols-2 items-center">
            {/* Visual Frame */}
            <div className="order-2 lg:order-1 rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl space-y-3.5 text-left">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-indigo-400" />
                  <span className="text-xs font-bold text-slate-200">Unified Courier Dispatch Engine</span>
                </div>
                <span className="text-[10px] text-slate-400">Steadfast • Pathao • RedX</span>
              </div>

              <div className="space-y-2">
                {[
                  { name: "Steadfast Courier", rate: "৳১১০", time: "২৪-৪৮ ঘণ্টা", rec: true },
                  { name: "Pathao Logistics", rate: "৳১৩০", time: "১২-২৪ ঘণ্টা (ফাস্ট)", rec: false },
                  { name: "RedX Courier", rate: "৳১২৫", time: "২৪-৪৮ ঘণ্টা", rec: false },
                ].map((c, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between rounded-xl border p-3 text-xs ${
                      c.rec
                        ? "border-emerald-500/40 bg-emerald-500/5 text-white"
                        : "border-slate-800 bg-slate-900/80 text-slate-300"
                    }`}
                  >
                    <div>
                      <div className="font-bold flex items-center gap-1.5">
                        {c.name}
                        {c.rec ? (
                          <span className="rounded bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 text-[9px] font-semibold">
                            সেরা রেট
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">আনুমানিক সময়: {c.time}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-sm text-emerald-400">{c.rate}</div>
                      <button className="mt-1 rounded bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[10px] font-bold text-slate-200">
                        বুক করুন
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-white">Bulk Print Ready (২৪টি পার্সেল)</div>
                  <div className="text-[11px] text-slate-400">A4 সাইজ বারকোড স্টিকার ও ইনভয়েস</div>
                </div>
                <button className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">
                  Download PDF Label
                </button>
              </div>
            </div>

            <div className="order-1 lg:order-2 space-y-5 text-left">
              <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-400">
                <Truck className="h-3.5 w-3.5" />
                <span>{t.features.courierBadge}</span>
              </div>
              <h2 className="text-3xl font-black text-white sm:text-4xl">
                {t.features.courierTitle}
              </h2>
              <p className="text-base text-slate-300 leading-relaxed">
                {t.features.courierBody}
              </p>

              <div className="space-y-3 pt-2">
                {[
                  { title: t.features.courierF1Title, desc: t.features.courierF1Desc },
                  { title: t.features.courierF2Title, desc: t.features.courierF2Desc },
                  { title: t.features.courierF3Title, desc: t.features.courierF3Desc },
                ].map((f, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <CheckCircle2 className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-bold text-white">{f.title}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* PILLAR 5: Visual Workflows & WhatsApp Bot */}
        <section id="workflows" className="scroll-mt-24 rounded-3xl border border-slate-800 bg-slate-900/50 p-8 sm:p-12 backdrop-blur-sm">
          <div className="grid gap-10 lg:grid-cols-2 items-center">
            <div className="space-y-5 text-left">
              <div className="inline-flex items-center gap-2 rounded-lg bg-violet-500/10 border border-violet-500/20 px-3 py-1 text-xs font-bold text-violet-400">
                <GitFork className="h-3.5 w-3.5" />
                <span>{t.features.workflowsBadge}</span>
              </div>
              <h2 className="text-3xl font-black text-white sm:text-4xl">
                {t.features.workflowsTitle}
              </h2>
              <p className="text-base text-slate-300 leading-relaxed">
                {t.features.workflowsBody}
              </p>

              <div className="space-y-3 pt-2">
                {[
                  { title: t.features.workflowsF1Title, desc: t.features.workflowsF1Desc },
                  { title: t.features.workflowsF2Title, desc: t.features.workflowsF2Desc },
                  { title: t.features.workflowsF3Title, desc: t.features.workflowsF3Desc },
                ].map((f, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <CheckCircle2 className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-bold text-white">{f.title}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Visual Frame */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl space-y-3 text-left">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <GitFork className="h-4 w-4 text-violet-400" />
                  <span className="text-xs font-bold text-slate-200">Active Workflow: COD Return Prevention</span>
                </div>
                <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded">
                  ● Running Live
                </span>
              </div>

              {/* Node graph representation */}
              <div className="space-y-2.5 text-xs">
                <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
                  <div className="font-bold text-indigo-300 flex items-center gap-1.5">
                    <span>⚡ TRIGGER:</span> নতুন অর্ডার তৈরি হয়েছে (Website / Inbox)
                  </div>
                </div>
                <div className="mx-auto w-0.5 h-3 bg-slate-700" />
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                  <div className="font-bold text-amber-300 flex items-center gap-1.5">
                    <span>🔀 CONDITION:</span> রিটার্ন রিস্ক স্কোর কি ৬০%-এর চেয়ে বেশি?
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-2.5">
                    <div className="font-bold text-rose-300 text-[11px]">হ্যাঁ (High Risk) ➔</div>
                    <div className="text-[10px] text-slate-300 mt-1">অগ্রিম ১৫০৳ ডেলিভারি চার্জ চেয়ে WhatsApp পেমেন্ট লিংক পাঠাও।</div>
                  </div>
                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-2.5">
                    <div className="font-bold text-emerald-300 text-[11px]">না (Safe Order) ➔</div>
                    <div className="text-[10px] text-slate-300 mt-1">স্বয়ংক্রিয়ভাবে Steadfast কুরিয়ারে বুকিং করো ও কাস্টমারকে ট্র্যাকিং SMS দাও।</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PILLAR 6: Business Intelligence & True Profit OS */}
        <section id="profit" className="scroll-mt-24 rounded-3xl border border-slate-800 bg-slate-900/50 p-8 sm:p-12 backdrop-blur-sm">
          <div className="grid gap-10 lg:grid-cols-2 items-center">
            {/* Visual Frame */}
            <div className="order-2 lg:order-1 rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl space-y-3.5 text-left">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-bold text-slate-200">True Net Profit Engine (This Month)</span>
                </div>
                <span className="text-[11px] font-bold text-emerald-400">মার্জিন: ২৮.৪%</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                  <span className="text-slate-400 text-[11px]">মোট রেভিনিউ (বিক্রি)</span>
                  <div className="text-lg font-bold text-white mt-1">৳৪,৮৫,০০০</div>
                </div>
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                  <span className="text-slate-400 text-[11px]">প্রোডাক্ট কস্ট (COGS)</span>
                  <div className="text-lg font-bold text-rose-400 mt-1">− ৳২,২০,০০০</div>
                </div>
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                  <span className="text-slate-400 text-[11px]">ফেসবুক ও গুগল অ্যাড খরচ</span>
                  <div className="text-lg font-bold text-rose-400 mt-1">− ৳৮৬,৫০০</div>
                </div>
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                  <span className="text-slate-400 text-[11px]">ডেলিভারি ও রিটার্ন ক্ষতি</span>
                  <div className="text-lg font-bold text-rose-400 mt-1">− ৳৪০,৮০০</div>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-center">
                <div className="text-xs text-emerald-300 font-semibold">আসল ক্যাশ নেট প্রফিট (সব খরচ বাদ দিয়ে)</div>
                <div className="text-2xl font-black text-emerald-400 mt-1">৳১,৩৭,৭০০</div>
                <div className="text-[10px] text-slate-400 mt-1">কোনো ফেক মেট্রিক বা অতিরঞ্জিত ROAS নয় — শতভাগ রিয়েল হিসাব</div>
              </div>
            </div>

            <div className="order-1 lg:order-2 space-y-5 text-left">
              <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-400">
                <TrendingUp className="h-3.5 w-3.5" />
                <span>{t.features.profitBadge}</span>
              </div>
              <h2 className="text-3xl font-black text-white sm:text-4xl">
                {t.features.profitTitle}
              </h2>
              <p className="text-base text-slate-300 leading-relaxed">
                {t.features.profitBody}
              </p>

              <div className="space-y-3 pt-2">
                {[
                  { title: t.features.profitF1Title, desc: t.features.profitF1Desc },
                  { title: t.features.profitF2Title, desc: t.features.profitF2Desc },
                  { title: t.features.profitF3Title, desc: t.features.profitF3Desc },
                ].map((f, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <CheckCircle2 className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-bold text-white">{f.title}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

      </div>

      {/* SECURITY & TENANT ISOLATION ARCHITECTURE */}
      <section className="border-t border-slate-800 bg-slate-900/40 py-16">
        <div className="mx-auto max-w-5xl px-6 text-center space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-semibold text-indigo-300">
            <Lock className="h-3.5 w-3.5 text-indigo-400" />
            <span>{t.features.securityBadge}</span>
          </div>

          <h2 className="text-3xl font-black text-white sm:text-4xl">
            {t.features.securityTitle}
          </h2>

          <div className="grid gap-6 sm:grid-cols-3 text-left">
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 space-y-2">
              <ShieldCheck className="h-7 w-7 text-indigo-400" />
              <h3 className="font-bold text-white text-base">{t.features.securityCard1Title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {t.features.securityCard1Text}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 space-y-2">
              <Bot className="h-7 w-7 text-violet-400" />
              <h3 className="font-bold text-white text-base">{t.features.securityCard2Title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {t.features.securityCard2Text}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 space-y-2">
              <Lock className="h-7 w-7 text-emerald-400" />
              <h3 className="font-bold text-white text-base">{t.features.securityCard3Title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {t.features.securityCard3Text}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section className="relative overflow-hidden border-t border-slate-800 bg-gradient-to-br from-indigo-950 via-slate-950 to-violet-950 py-20 text-center">
        <div className="mx-auto max-w-4xl px-6 relative z-10 space-y-6">
          <h2 className="text-3xl font-black text-white sm:text-5xl">
            {t.features.ctaTitle}
          </h2>
          <p className="mx-auto max-w-2xl text-base text-slate-300">
            {t.features.ctaBody}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <RegisterCta
              label={t.features.ctaTrialLabel}
              className="rounded-2xl bg-gradient-to-r from-indigo-500 via-violet-600 to-fuchsia-600 px-9 py-4 text-base font-bold text-white shadow-xl shadow-indigo-500/30 transition hover:brightness-110 active:scale-[0.98]"
            />
            <Link
              href="/"
              className="rounded-2xl border border-slate-700 bg-slate-900/80 px-8 py-4 text-base font-semibold text-slate-200 transition hover:bg-slate-800 hover:text-white"
            >
              {t.features.ctaHomeLabel}
            </Link>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-slate-800 bg-slate-950 py-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 text-xs text-slate-500">
          <div>© {new Date().getFullYear()} {t.features.footerCopyright}</div>
          <div className="flex flex-wrap gap-5 sm:gap-6">
            <Link href="/" className="hover:text-slate-300">{t.features.navHome}</Link>
            <Link href="/pricing" className="hover:text-slate-300">{t.landing.footerPricing}</Link>
            <Link href="/privacy" className="hover:text-slate-300">{t.features.footerPrivacy}</Link>
            <Link href="/terms" className="hover:text-slate-300">{t.features.footerTerms}</Link>
            <Link href="/login" className="hover:text-slate-300">{t.landing.footerLogin}</Link>
            <Link href="/register" className="hover:text-slate-300">{t.landing.footerRegister}</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
