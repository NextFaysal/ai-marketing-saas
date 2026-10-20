import React from "react";
import Link from "next/link";
import { FileText, ArrowLeft, CheckCircle2 } from "lucide-react";

export const metadata = {
  title: "ব্যবহারের শর্তাবলি (Terms of Service) — AI Marketing OS",
  description: "AI Marketing OS প্ল্যাটফর্ম ব্যবহারের শর্তাবলি ও নিয়মকানুন।",
};

export default function TermsPage() {
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
            <span>হোমে ফিরে যান</span>
          </Link>
          <div className="text-xs text-slate-400">সর্বশেষ আপডেট: অক্টোবর ২০২৬</div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-4xl px-6 py-14">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-semibold text-indigo-300">
          <FileText className="h-3.5 w-3.5 text-indigo-400" />
          <span>Platform Terms & Service Agreement</span>
        </div>

        <h1 className="mt-4 text-3xl font-black text-white sm:text-4xl">ব্যবহারের শর্তাবলি (Terms of Service)</h1>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          AI Marketing OS প্ল্যাটফর্ম ব্যবহারের মাধ্যমে আপনি নিচের শর্তাবলি মেনে নিতে সম্মত হচ্ছেন।
          অনুগ্রহ করে শর্তগুলো মনোযোগ সহকারে পড়ুন।
        </p>

        <div className="mt-10 space-y-8 rounded-3xl border border-slate-800 bg-slate-900/60 p-8 sm:p-10 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white">১. সার্ভিস পরিচিতি</h2>
            <p>
              AI Marketing OS একটি অল-ইন-ওয়ান মার্কেটিং ও কমার্স অটোমেশন সফটওয়্যার (SaaS)।
              এটি অনলাইন মার্চেন্টদের জন্য ইউনিফাইড ইনবক্স, এআই অ্যাসিস্ট্যান্ট, কুরিয়ার বুকিং, সিওডি রিটার্ন রিস্ক স্কোরিং এবং প্রফিট অ্যানালিটিক্স সুবিধা প্রদান করে।
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white">২. অ্যাকাউন্ট ও দায়বদ্ধতা</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-400">
              <li>অ্যাকাউন্ট রেজিস্ট্রেশনের সময় সঠিক ও হালনাগাদ তথ্য প্রদান করতে হবে।</li>
              <li>আপনার পাসওয়ার্ড ও এপিআই ক্রেডেনশিয়ালের নিরাপত্তা রক্ষার সম্পূর্ণ দায়িত্ব আপনার নিজের।</li>
              <li>আইনবিরোধী, ক্ষতিকারক বা প্রতারণামূলক কাজে প্ল্যাটফর্মের অটোমেশন বা মেসেজিং ব্যবহার করা সম্পূর্ণ নিষিদ্ধ।</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white">৩. নিজস্ব অ্যাকাউন্ট সংযোগ (Integrations)</h2>
            <p>
              প্ল্যাটফর্মে ব্যবহৃত Meta পেজ, WhatsApp Business API এবং কুরিয়ার অ্যাকাউন্ট (Steadfast, Pathao, RedX ইত্যাদি) আপনার নিজস্ব ব্যবসায়িক অ্যাকাউন্ট।
              আমরা কোনো তৃতীয় পক্ষের ফেক অ্যাকাউন্ট সরবরাহ করি না। সংশ্লিষ্ট কুরিয়ার বা সোশ্যাল মিডিয়ার পলিসি ভঙ্গের দায় ব্যবহারকারীর।
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white">৪. এআই সহায়তা ও সীমাবদ্ধতা (Strict Grounding AI)</h2>
            <p>
              আমাদের এআই ইঞ্জিন আপনার ডাটাবেজের প্রোডাক্ট ও পলিসি অনুযায়ী উত্তর প্রস্তুত করে।
              তবুও কাস্টমার কমিউনিকেশন ও বিজ্ঞাপনের ফাইনাল দায়িত্ব মার্চেন্টের।
              সিওডি রিটার্ন রিস্ক স্কোর একটি সতর্কতামূলক অনুমান — কোনো অর্ডার কনফার্ম বা ক্যান্সেল করার চূড়ান্ত সিদ্ধান্ত সম্পূর্ণ আপনার।
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white">৫. সাবস্ক্রিপশন, বিলিং ও ট্রায়াল</h2>
            <p>
              পেইড প্ল্যানগুলোতে বিনামূল্যে নির্ধারিত ট্রায়াল পিরিয়ড থাকে।
              ট্রায়াল শেষে সাবস্ক্রিপশন চালু রাখতে নির্বাচিত প্ল্যানের ফি পরিশোধ করতে হবে।
              আপনি যেকোনো সময় আপনার সাবস্ক্রিপশন বাতিল করতে পারেন।
            </p>
          </section>

          <section className="space-y-3 border-t border-slate-800/80 pt-6">
            <h2 className="text-base font-bold text-white">আইনি বিচারব্যবস্থা</h2>
            <p className="text-slate-400">
              এই শর্তাবলি গণপ্রজাতন্ত্রী বাংলাদেশের প্রচলিত আইন অনুযায়ী পরিচালিত ও নিয়ন্ত্রিত হবে।
            </p>
          </section>
        </div>
      </div>

      <footer className="border-t border-slate-800 bg-slate-950 py-8 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} Qosprey — AI Marketing OS. সর্বস্বত্ব সংরক্ষিত।
      </footer>
    </main>
  );
}
