import React from "react";
import Link from "next/link";
import { ShieldCheck, Lock, ArrowLeft } from "lucide-react";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

export const metadata = {
  title: "গোপনীয়তা নীতি (Privacy Policy) — AI Marketing OS",
  description: "AI Marketing OS-এ আপনার ব্যবসার ডেটা সুরক্ষা, নিরাপত্তা ও গোপনীয়তা সংক্রান্ত নীতিমালা।",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500 selection:text-white">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-indigo-600/15 blur-[140px]" />
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-25" />
      </div>

      <header className="relative z-10 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            <span>{t.legal.backHome}</span>
          </Link>
          <div className="text-xs text-slate-400">{t.legal.lastUpdatedLabel}অক্টোবর ২০২৬</div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-4xl px-6 py-14">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-semibold text-indigo-300">
          <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
          <span>{t.legal.privacyBadge}</span>
        </div>

        <h1 className="mt-4 text-3xl font-black text-white sm:text-4xl">{t.legal.privacyTitle}</h1>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          {t.legal.privacyIntro}
        </p>

        <div className="mt-10 space-y-8 rounded-3xl border border-slate-800 bg-slate-900/60 p-8 sm:p-10 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <Lock className="h-4 w-4 text-indigo-400" />
              <span>{t.legal.privacyS1Title}</span>
            </h2>
            <p>
              {t.legal.privacyS1Body}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white">{t.legal.privacyS2Title}</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-400">
              <li>{t.legal.privacyS2Item1}</li>
              <li>{t.legal.privacyS2Item2}</li>
              <li>{t.legal.privacyS2Item3}</li>
              <li>{t.legal.privacyS2Item4}</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white">{t.legal.privacyS3Title}</h2>
            <p>
              {t.legal.privacyS3Intro}
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-400">
              <li>{t.legal.privacyS3Item1}</li>
              <li>{t.legal.privacyS3Item2}</li>
              <li>{t.legal.privacyS3Item3}</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white">{t.legal.privacyS4Title}</h2>
            <p>
              {t.legal.privacyS4Body}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white">{t.legal.privacyS5Title}</h2>
            <p>
              {t.legal.privacyS5Body}
            </p>
          </section>

          <section className="space-y-3 border-t border-slate-800/80 pt-6">
            <h2 className="text-base font-bold text-white">{t.legal.privacyContactTitle}</h2>
            <p className="text-slate-400">
              {t.legal.privacyContactTextPrefix}<b className="text-white">support@qosprey.com</b>
            </p>
          </section>
        </div>
      </div>

      <footer className="border-t border-slate-800 bg-slate-950 py-8 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} Qosprey — AI Marketing OS.{t.legal.footerRightsSuffix}
      </footer>
    </main>
  );
}
