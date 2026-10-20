import React from "react";
import Link from "next/link";
import { ShieldCheck, Lock, ArrowLeft } from "lucide-react";

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
            <span>হোমে ফিরে যান</span>
          </Link>
          <div className="text-xs text-slate-400">সর্বশেষ আপডেট: অক্টোবর ২০২৬</div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-4xl px-6 py-14">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-semibold text-indigo-300">
          <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
          <span>Security & Data Privacy Commitment</span>
        </div>

        <h1 className="mt-4 text-3xl font-black text-white sm:text-4xl">গোপনীয়তা নীতি (Privacy Policy)</h1>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          AI Marketing OS (Qosprey) গ্রাহক ও অনলাইন মার্চেন্টদের ডেটা নিরাপত্তা ও গোপনীয়তাকে সর্বোচ্চ অগ্রাধিকার দেয়।
          আমরা কীভাবে আপনার তথ্য সংগ্রহ, সংরক্ষণ ও ব্যবহার করি তা নিচে স্পষ্টভাবে উল্লেখ করা হলো।
        </p>

        <div className="mt-10 space-y-8 rounded-3xl border border-slate-800 bg-slate-900/60 p-8 sm:p-10 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <Lock className="h-4 w-4 text-indigo-400" />
              <span>১. টেন্যান্ট আইসোলেশন ও ডেটা সুরক্ষা (Tenant Isolation)</span>
            </h2>
            <p>
              আমাদের প্ল্যাটফর্মে প্রতিটি Organization সম্পূর্ণ আলাদা ভার্চুয়াল এনভায়রনমেন্টে পরিচালিত হয় (Strict Tenant Guard)।
              আপনার স্টোরের পণ্যতালিকা, বিক্রয় তথ্য, কাস্টমার ফোন নম্বর ও ইনবক্স মেসেজ অন্য কোনো স্টোর বা তৃতীয় পক্ষের সাথে কখনই শেয়ার করা হয় না।
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white">২. আমরা যেসব তথ্য সংগ্রহ করি</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-400">
              <li>অ্যাকাউন্ট খোলার সময় নাম, ব্যবসায়িক ইমেইল ও পাসওয়ার্ড হ্যাশ।</li>
              <li>আপনার অনুমতিক্রমে সংযুক্ত চ্যানেলের ক্রেডেনশিয়াল (যেমন: Meta Page Access Token, Steadfast/Pathao API Key)।</li>
              <li>অর্ডার প্রসেসিং ও কুরিয়ার ট্র্যাকিং সংক্রান্ত তথ্য (গ্রাহকের নাম, ঠিকানা, মোবাইল নম্বর ও পার্সেল স্ট্যাটাস)।</li>
              <li>প্ল্যাটফর্মের পারফরম্যান্স ও সিস্টেম লগ সংক্রান্ত মেট্রিক্স।</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white">৩. তথ্যের ব্যবহার ও AI প্রসেসিং</h2>
            <p>
              সংগৃহীত তথ্য শুধুমাত্র আপনার ব্যবসার কার্যক্রম স্বয়ংক্রিয়ভাবে পরিচালনা করার জন্য ব্যবহৃত হয়:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-400">
              <li>গ্রাহকদের মেসেজের সঠিক উত্তর প্রস্তুত করতে (Strict Grounding AI শুধুমাত্র আপনার দেওয়া ডেটা পড়ে, কোনো অনুমান করে না)।</li>
              <li>কুরিয়ার চার্জের তুলনামূলক কোট ও স্বয়ংক্রিয় পার্সেল বুকিং সম্পন্ন করতে।</li>
              <li>পূর্ববর্তী ডেলিভারি আচরণ বিশ্লেষণের মাধ্যমে COD রিটার্ন রিস্ক স্কোর নির্ধারণ করতে।</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white">৪. তৃতীয় পক্ষ ইন্টিগ্রেশন ও এপিআই (Meta, Google, Couriers)</h2>
            <p>
              আমরা Meta Graph API, WhatsApp Cloud API, Google Ads API এবং সংশ্লিষ্ট কুরিয়ার মার্চেন্ট গেটওয়ের অফিসিয়াল পলিসি মেনে চলি।
              আপনার কোনো ক্রেডেনশিয়াল প্ল্যাটফর্মের অনুমোদিত সার্ভিস ব্যতিরেকে অন্য কোথাও প্রকাশ করা হয় না।
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-bold text-white">৫. ডেটা মুছে ফেলা ও অধিকার (Data Deletion)</h2>
            <p>
              আপনি চাইলে যেকোনো সময় আপনার অর্গানাইজেশন অ্যাকাউন্ট বন্ধ করতে পারেন অথবা আমাদের সাথে যোগাযোগ করে আপনার সংরক্ষিত ডেটা স্থায়ীভাবে মুছে ফেলার (Permanent Deletion) অনুরোধ জানাতে পারেন।
            </p>
          </section>

          <section className="space-y-3 border-t border-slate-800/80 pt-6">
            <h2 className="text-base font-bold text-white">যোগাযোগ</h2>
            <p className="text-slate-400">
              গোপনীয়তা সংক্রান্ত যেকোনো প্রশ্ন বা সহায়তার জন্য আমাদের সাথে যোগাযোগ করতে পারেন: <b className="text-white">support@qosprey.com</b>
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
