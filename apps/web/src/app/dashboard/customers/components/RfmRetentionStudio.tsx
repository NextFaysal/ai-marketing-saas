"use client";
import React, { useState, useEffect, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import Link from "next/link";

export interface RfmCustomerRow {
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  recencyDays: number;
  frequency: number;
  monetaryMinor: string;
  r: number;
  f: number;
  m: number;
  segment: string;
}

interface SegmentStat {
  count: number;
  totalSpendMinor: string;
  avgRecencyDays: number;
  avgFrequency: number;
}

interface RfmReportResponse {
  totalCustomers: number;
  segments: Record<string, number>;
  segmentStats?: Record<string, SegmentStat>;
  rows: RfmCustomerRow[];
}

interface RfmStudioProps {
  onSelectCustomer?: (customerId: string) => void;
}

const SEGMENT_META: Record<
  string,
  {
    title: string;
    bengaliTitle: string;
    desc: string;
    icon: string;
    badgeCls: string;
    borderCls: string;
    bgCls: string;
    strategy: string;
    recommendedPromo: string;
    promoCode: string;
  }
> = {
  champions: {
    title: "Champions",
    bengaliTitle: "চ্যাম্পিয়ন (VIP)",
    desc: "সর্বোচ্চ অর্ডার এবং সাম্প্রতিক কেনাকাটা। সবচেয়ে মূল্যবান বিশ্বস্ত গ্রাহক।",
    icon: "👑",
    badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300",
    borderCls: "border-emerald-300 hover:border-emerald-500",
    bgCls: "bg-emerald-50/50",
    strategy: "ভিআইপি রিওয়ার্ড, নতুন পণ্যের আর্লি এক্সেস ও ফ্রি গিফট দিন।",
    recommendedPromo: "২০% ভিআইপি ক্যাশব্যাক ও ফ্রি ডেলিভারি",
    promoCode: "VIP20",
  },
  loyal: {
    title: "Loyal Customers",
    bengaliTitle: "বিশ্বস্ত গ্রাহক",
    desc: "নিয়মিত কেনাকাটা করেন এবং ব্র্যান্ডের প্রতি বিশ্বস্ত।",
    icon: "💖",
    badgeCls: "bg-blue-100 text-blue-800 border-blue-300",
    borderCls: "border-blue-300 hover:border-blue-500",
    bgCls: "bg-blue-50/50",
    strategy: "লয়ালটি পয়েন্ট ও বান্ডেল অফার দিয়ে এভারেজ অর্ডার ভ্যালু বৃদ্ধি করুন।",
    recommendedPromo: "১৫% বিশ্বস্ত কাস্টমার ভাউচার",
    promoCode: "LOYAL15",
  },
  big_spenders: {
    title: "Big Spenders",
    bengaliTitle: "বিগ স্পেন্ডার",
    desc: "একবারে বড় অঙ্কের প্রিমিয়াম কেনাকাটা করেন।",
    icon: "💰",
    badgeCls: "bg-purple-100 text-purple-800 border-purple-300",
    borderCls: "border-purple-300 hover:border-purple-500",
    bgCls: "bg-purple-50/50",
    strategy: "প্রিমিয়াম হাই-টিকিট প্রোডাক্ট এবং এক্সক্লুসিভ কম্বো সুপারিশ করুন।",
    recommendedPromo: "৳৫০০ ফ্ল্যাট ক্যাশ ডিসকাউন্ট",
    promoCode: "BIGSPEND500",
  },
  at_risk: {
    title: "At Risk",
    bengaliTitle: "ঝুঁকিপূর্ণ (উইন-ব্যাক প্রয়োজন)",
    desc: "পূর্বে প্রচুর কেনাকাটা করলেও অনেক দিন ধরে কোনো অর্ডার করেননি। কাস্টমার চূর্ণ রোধ করুন!",
    icon: "⚠️",
    badgeCls: "bg-amber-100 text-amber-800 border-amber-300",
    borderCls: "border-amber-300 hover:border-amber-500",
    bgCls: "bg-amber-50/50",
    strategy: "উইন-ব্যাক ক্যাম্পেইন: বিশেষ ডিসকাউন্ট ও মিসিং-ইউ মেসেজ পাঠিয়ে ফিরিয়ে আনুন।",
    recommendedPromo: "১৫% উইন-ব্যাক স্পেশাল ডিসকাউন্ট",
    promoCode: "COMEBACK15",
  },
  lost: {
    title: "Lost / Inactive",
    bengaliTitle: "নিষ্ক্রিয় বা হারিয়ে যাওয়া",
    desc: "দীর্ঘদিন কোনো তৎপরতা নেই। কম ফ্রিকোয়েন্সি ও পুরোনো অর্ডার।",
    icon: "💤",
    badgeCls: "bg-rose-100 text-rose-800 border-rose-300",
    borderCls: "border-rose-300 hover:border-rose-500",
    bgCls: "bg-rose-50/50",
    strategy: "রি-অ্যাক্টিভেশন সেল বা ক্লিয়ারেন্স মেগা ডিসকাউন্ট অফার করুন।",
    recommendedPromo: "২০% ক্লিয়ারেন্স রি-অ্যাক্টিভেশন",
    promoCode: "REACTIVATE20",
  },
  new: {
    title: "New Customers",
    bengaliTitle: "নতুন ক্রেতা",
    desc: "সম্প্রতি প্রথম অর্ডার সম্পন্ন করেছেন। দ্বিতীয় অর্ডারে রূপান্তর করার সুবর্ণ সুযোগ।",
    icon: "🌱",
    badgeCls: "bg-cyan-100 text-cyan-800 border-cyan-300",
    borderCls: "border-cyan-300 hover:border-cyan-500",
    bgCls: "bg-cyan-50/50",
    strategy: "প্রথম অভিজ্ঞতার ফিডব্যাক ও দ্বিতীয় অর্ডারের জন্য ইনস্ট্যান্ট কুপন দিন।",
    recommendedPromo: "১০% দ্বিতীয় অর্ডার স্বাগতম ছাড়",
    promoCode: "NEXT10",
  },
  regular: {
    title: "Regular Customers",
    bengaliTitle: "সাধারণ ক্রেতা",
    desc: "মাঝারি ফ্রিকোয়েন্সি ও স্পেন্ডের সক্রিয় কাস্টমার।",
    icon: "📦",
    badgeCls: "bg-slate-100 text-slate-800 border-slate-300",
    borderCls: "border-slate-300 hover:border-slate-400",
    bgCls: "bg-slate-50/50",
    strategy: "সিজনাল ক্যাম্পেইন ও নতুন কালেকশন আপডেট পাঠিয়ে সম্পৃক্ত রাখুন।",
    recommendedPromo: "৳১০০ ইনস্ট্যান্ট কুপন",
    promoCode: "SAVE100",
  },
};

const formatBDT = (minorStr?: string | number | null) => {
  if (minorStr == null) return "৳০";
  const num = Number(minorStr) / 100;
  return `৳${num.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

export default function RfmRetentionStudio({ onSelectCustomer }: RfmStudioProps) {
  const [data, setData] = useState<RfmReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeSegment, setActiveSegment] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch<RfmReportResponse>(`/organizations/${orgId}/messaging/rfm`)
      .then((res) => {
        setData(res);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "RFM রিপোর্ট লোড করতে ব্যর্থ"))
      .finally(() => setLoading(false));
  }, []);

  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    let list = data.rows;
    if (activeSegment !== "all") {
      list = list.filter((r) => r.segment === activeSegment);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.phone && r.phone.includes(q)) ||
          (r.email && r.email.toLowerCase().includes(q))
      );
    }
    return list;
  }, [data?.rows, activeSegment, searchQuery]);

  // Overall KPI sums
  const stats = useMemo(() => {
    if (!data?.rows) {
      return { totalRevenue: "0", championsCount: 0, atRiskCount: 0, atRiskRevenue: "0" };
    }
    let totalRev = 0n;
    let atRiskRev = 0n;
    let champs = 0;
    let atRisk = 0;

    for (const r of data.rows) {
      const val = BigInt(r.monetaryMinor || 0);
      totalRev += val;
      if (r.segment === "champions") champs++;
      if (r.segment === "at_risk" || r.segment === "lost") {
        atRisk++;
        atRiskRev += val;
      }
    }

    return {
      totalRevenue: String(totalRev),
      championsCount: champs,
      atRiskCount: atRisk,
      atRiskRevenue: String(atRiskRev),
    };
  }, [data?.rows]);

  const copyPromo = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 3000);
  };

  const openWhatsApp = (customer: RfmCustomerRow) => {
    if (!customer.phone) {
      alert("এই কাস্টমারের কোনো ফোন নম্বর নেই।");
      return;
    }
    let cleaned = customer.phone.replace(/[^0-9]/g, "");
    if (cleaned.startsWith("0")) cleaned = "88" + cleaned;
    else if (!cleaned.startsWith("880") && cleaned.length === 10) cleaned = "880" + cleaned;

    const meta = SEGMENT_META[customer.segment] || SEGMENT_META.regular;
    const name = customer.name || "সম্মানিত গ্রাহক";

    let message = "";
    if (customer.segment === "at_risk") {
      message = `আসসালামু আলাইকুম ${name}! আমরা লক্ষ্য করেছি অনেক দিন আপনার সাথে যোগাযোগ হয়নি। আপনাকে মিস করছি! আপনার জন্য বিশেষ ১৫% ডিসকাউন্ট ভাউচার কোড: *${meta.promoCode}*। আপনার পরবর্তী অর্ডারে এটি ব্যবহার করতে পারবেন। কোন সহায়তা লাগলে জানাবেন!`;
    } else if (customer.segment === "champions") {
      message = `আসসালামু আলাইকুম ${name}! আমাদের শপের সবচেয়ে সম্মানিত VIP কাস্টমার হিসেবে আপনার জন্য বিশেষ উপহার: *${meta.promoCode}* কোড ব্যবহারে ২০% অতিরিক্ত ছাড় ও ফ্রি ডেলিভারি উপভোগ করুন। ধন্যবাদ আমাদের সাথে থাকার জন্য!`;
    } else if (customer.segment === "new") {
      message = `আসসালামু আলাইকুম ${name}! আমাদের শপ থেকে কেনাকাটা করার জন্য ধন্যবাদ। পণ্যটি আপনার কেমন লেগেছে জানাবেন। আপনার ২য় অর্ডারে ১০% ছাড়ের জন্য কোড: *${meta.promoCode}*।`;
    } else {
      message = `আসসালামু আলাইকুম ${name}! আমাদের শপে আপনার জন্য বিশেষ উপহার কুপন: *${meta.promoCode}* (${meta.recommendedPromo})। নতুন কালেকশন দেখতে যোগাযোগ করুন।`;
    }

    window.open(`https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`, "_blank");
  };

  if (loading) {
    return (
      <div className="card p-8 text-center text-slate-500">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        <p className="font-medium">RFM কাস্টমার সেগমেন্টেশন ও LTV অ্যানালিটিক্স লোড হচ্ছে...</p>
        <p className="mt-1 text-xs text-slate-400">প্রতিটি গ্রাহকের Recency, Frequency এবং Monetary মেট্রিক্স হিসাব করা হচ্ছে</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-red-200 bg-red-50 p-6 text-red-700">
        <p className="font-bold">ডাটা লোড ত্রুটি:</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & KPI Highlights */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card border-l-4 border-l-indigo-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">মোট সেগমেন্টেড গ্রাহক</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{data?.totalCustomers ?? 0} জন</p>
          <p className="mt-1 text-xs text-slate-500">অনন্য অর্ডারিং কাস্টমার বেস</p>
        </div>

        <div className="card border-l-4 border-l-emerald-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">মোট লাইফটাইম সেলস (LTV)</p>
          <p className="mt-1 text-2xl font-black text-emerald-700">{formatBDT(stats.totalRevenue)}</p>
          <p className="mt-1 text-xs text-emerald-600 font-medium">কাস্টমারদের মোট অর্জিত রেভিনিউ</p>
        </div>

        <div className="card border-l-4 border-l-purple-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">👑 Champions (VIP বেস)</p>
          <p className="mt-1 text-2xl font-black text-purple-700">{stats.championsCount} জন</p>
          <p className="mt-1 text-xs text-slate-500">সর্বোচ্চ ক্রয় ক্ষমতা ও সন্তুষ্টি</p>
        </div>

        <div className="card border-l-4 border-l-amber-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">⚠️ ঝুঁকিপূর্ণ রেভিনিউ (At-Risk)</p>
          <p className="mt-1 text-2xl font-black text-amber-700">{formatBDT(stats.atRiskRevenue)}</p>
          <p className="mt-1 text-xs text-amber-600 font-medium">{stats.atRiskCount} জন কাস্টমার হারানোর ঝুঁকিতে</p>
        </div>
      </div>

      {/* Retention Studio Guide Banner */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50/80 via-white to-purple-50/60 p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-700">
              💎 AI Retention & LTV Copilot
            </span>
            <h2 className="mt-2 text-lg font-bold text-slate-900">
              গ্রাহক ধরে রাখার (Retention) বিজ্ঞানসম্মত আরএফএম মেট্রিক্স
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-slate-600">
              নতুন কাস্টমার আনার চেয়ে বিদ্যমান কাস্টমারদের রিটেনশন করা ৫-৭ গুণ বেশি লাভজনক। নিচের যেকোনো সেগমেন্টে ক্লিক করে
              এক ক্লিকে হোয়াটসঅ্যাপে পার্সোনালাইজড অফার পাঠান অথবা এসএমএস ব্রডকাস্ট চালু করুন।
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/messaging"
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-indigo-700"
            >
              📢 ব্রডকাস্ট ক্যাম্পেইন
            </Link>
            <Link
              href="/dashboard/audiences"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              🎯 মেটা কাস্টম অডিয়েন্স
            </Link>
          </div>
        </div>
      </div>

      {/* Segment Cards Grid */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">📊 আরএফএম সেগমেন্টসমূহ (ফিল্টার করতে ক্লিক করুন)</h3>
          {activeSegment !== "all" && (
            <button
              onClick={() => setActiveSegment("all")}
              className="text-xs font-bold text-indigo-600 hover:underline"
            >
              সব সেগমেন্ট দেখুন ✕
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Object.entries(SEGMENT_META).map(([key, meta]) => {
            const count = data?.segments[key] ?? 0;
            const stat = data?.segmentStats?.[key];
            const isSelected = activeSegment === key;
            const pct = data?.totalCustomers ? Math.round((count / data.totalCustomers) * 100) : 0;

            return (
              <div
                key={key}
                onClick={() => setActiveSegment(isSelected ? "all" : key)}
                className={`cursor-pointer rounded-2xl border-2 p-4 transition duration-150 ${meta.borderCls} ${
                  isSelected ? "ring-2 ring-indigo-500 shadow-md " + meta.bgCls : "bg-white hover:shadow-sm"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{meta.icon}</span>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">{meta.bengaliTitle}</h4>
                      <p className="text-[11px] text-slate-500">{meta.title}</p>
                    </div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${meta.badgeCls}`}>
                    {count} জন ({pct}%)
                  </span>
                </div>

                <p className="mt-2.5 text-xs text-slate-600 line-clamp-2">{meta.desc}</p>

                {stat && (
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-[11px]">
                    <div>
                      <span className="text-slate-400">মোট সেলস: </span>
                      <span className="font-bold text-slate-800">{formatBDT(stat.totalSpendMinor)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">গড় দিন: </span>
                      <span className="font-bold text-slate-800">{stat.avgRecencyDays} দিন আগে</span>
                    </div>
                  </div>
                )}

                <div className="mt-3 rounded-xl bg-slate-50 p-2 text-[11px]">
                  <span className="font-semibold text-slate-700">💡 সুপারিশকৃত কৌশল: </span>
                  <span className="text-slate-600">{meta.strategy}</span>
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[10px]">
                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 font-bold">
                      কোড: {meta.promoCode}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyPromo(meta.promoCode);
                      }}
                      className="text-indigo-600 hover:underline"
                    >
                      {copiedCode === meta.promoCode ? "✓ কপিড" : "কপি কোড"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Customer List & Retention Action Table */}
      <div className="card space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              👥 গ্রাহক তালিকা ও রিটেনশন অ্যাকশন{" "}
              {activeSegment !== "all" && (
                <span className="text-xs font-normal text-indigo-600">
                  (ফিল্টার: {SEGMENT_META[activeSegment]?.bengaliTitle})
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-500">
              মোট প্রদর্শিত: {filteredRows.length} জন কাস্টমার · সরাসরি হোয়াটসঅ্যাপ ও কলে রিটেনশন অফার দিন
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="নাম, ফোন বা ইমেইল খুঁজুন..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-64 text-xs"
            />
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
            এই সেগমেন্ট বা সার্চ কোয়েরিতে কোনো কাস্টমার পাওয়া যায়নি।
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-slate-50 font-semibold text-slate-600">
                <tr>
                  <th className="py-2.5 px-3">গ্রাহকের নাম ও ফোন</th>
                  <th className="py-2.5 px-3">সেগমেন্ট</th>
                  <th className="py-2.5 px-3">সাম্প্রতিক (Recency)</th>
                  <th className="py-2.5 px-3">অর্ডার সংখ্যা (Freq)</th>
                  <th className="py-2.5 px-3">মোট স্পেন্ড (Monetary)</th>
                  <th className="py-2.5 px-3">আর-এফ-এম স্কোর</th>
                  <th className="py-2.5 px-3 text-right">উইন-ব্যাক অ্যাকশন</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((c) => {
                  const meta = SEGMENT_META[c.segment] || SEGMENT_META.regular;
                  return (
                    <tr key={c.customerId} className="hover:bg-slate-50/70 transition">
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900">{c.name || "নাম নেই"}</div>
                        <div className="text-[11px] text-slate-500">{c.phone || c.email || "যোগাযোগ নেই"}</div>
                      </td>

                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${meta.badgeCls}`}>
                          <span>{meta.icon}</span>
                          <span>{meta.bengaliTitle.split(" ")[0]}</span>
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-800">{c.recencyDays} দিন আগে</div>
                        <div className="text-[10px] text-slate-400">
                          {c.recencyDays <= 30 ? "খুব সাম্প্রতিক" : c.recencyDays <= 90 ? "মাঝারি" : "দীর্ঘদিন আগে"}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-800">{c.frequency} টি অর্ডার</div>
                        <div className="text-[10px] text-slate-400">
                          {c.frequency >= 4 ? "হাই ফ্রিকোয়েন্সি" : c.frequency === 1 ? "প্রথম ক্রয়" : "নিয়মিত"}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900">{formatBDT(c.monetaryMinor)}</div>
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex gap-1">
                          <span
                            title="Recency স্কোর (১-৫)"
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              c.r >= 4 ? "bg-emerald-100 text-emerald-800" : c.r <= 2 ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            R:{c.r}
                          </span>
                          <span
                            title="Frequency স্কোর (১-৫)"
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              c.f >= 4 ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            F:{c.f}
                          </span>
                          <span
                            title="Monetary স্কোর (১-৫)"
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              c.m >= 4 ? "bg-purple-100 text-purple-800" : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            M:{c.m}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {c.phone && (
                            <>
                              <button
                                onClick={() => openWhatsApp(c)}
                                title="হোয়াটসঅ্যাপে পার্সোনালাইজড উইন-ব্যাক অফার পাঠান"
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100"
                              >
                                <span>💬</span> WhatsApp
                              </button>
                              <a
                                href={`tel:${c.phone}`}
                                title="সরাসরি ফোন কল করুন"
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
                              >
                                📞
                              </a>
                            </>
                          )}
                          {onSelectCustomer && (
                            <button
                              onClick={() => onSelectCustomer(c.customerId)}
                              title="গ্রাহকের সম্পূর্ণ 360 হিস্ট্রি ও খাতা দেখুন"
                              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100"
                            >
                              খাতা
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
