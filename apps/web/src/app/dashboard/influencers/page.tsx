"use client";
import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import {
  generateInfluencerTrackingUrl,
  calculateInfluencerRoi,
  getPlatformMeta,
  SOCIAL_PLATFORMS,
  SocialPlatform,
} from "@/lib/influencer-campaign";

interface PartnerAggregates {
  entries: {
    total: number;
    pending: { count: number; commissionMinor: string };
    approved: { count: number; commissionMinor: string };
    paid: { count: number; commissionMinor: string };
    voided: { count: number; commissionMinor: string };
  };
  payoutsTotalMinor: string;
  payoutsCount: number;
}

interface CreatorPartner {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  code: string;
  commissionPercent: number;
  status: string;
  note: string | null;
  aggregates?: PartnerAggregates;
}

export default function InfluencerMarketingPage() {
  const [creators, setCreators] = useState<CreatorPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Store domain for tracking links
  const [storeDomain, setStoreDomain] = useState("https://yourstore.com");

  // Create Modal
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    code: "",
    commissionPercent: 10,
    platform: "instagram" as SocialPlatform,
    note: "",
  });

  const loadCreators = async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoading(true);
    setError("");
    try {
      const [partnersData, orgData] = await Promise.all([
        apiFetch<CreatorPartner[]>(`/organizations/${orgId}/affiliates/partners`).catch(() => []),
        apiFetch<{ slug: string; customDomain?: string | null }>(`/organizations/${orgId}`).catch(() => null),
      ]);
      setCreators(Array.isArray(partnersData) ? partnersData : []);

      if (orgData) {
        if (orgData.customDomain) {
          setStoreDomain(`https://${orgData.customDomain}`);
        } else if (orgData.slug) {
          const origin = typeof window !== "undefined" ? window.location.origin : "https://app.nextcommerce.com";
          setStoreDomain(`${origin}/shop/${orgData.slug}`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "ইনফ্লুয়েন্সার তালিকা লোড করা যায়নি");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCreators();
  }, []);

  const handleCreateCreator = async (e: React.FormEvent) => {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const noteWithPlatform = `[Platform: ${formData.platform}] ${formData.note}`.trim();
      await apiFetch(`/organizations/${orgId}/affiliates/partners`, {
        method: "POST",
        body: JSON.stringify({
          name: formData.name.trim(),
          phone: formData.phone.trim(),
          email: formData.email.trim() ? formData.email.trim() : null,
          code: formData.code.trim().toUpperCase(),
          commissionPercent: Number(formData.commissionPercent),
          note: noteWithPlatform,
        }),
      });
      setNotice(`✅ ইনফ্লুয়েন্সার "${formData.name}" সফলভাবে যুক্ত করা হয়েছে!`);
      setShowModal(false);
      setFormData({
        name: "",
        phone: "",
        email: "",
        code: "",
        commissionPercent: 10,
        platform: "instagram",
        note: "",
      });
      await loadCreators();
    } catch (e) {
      setError(e instanceof Error ? e.message : "তৈরি ব্যর্থ হয়েছে");
    } finally {
      setSubmitting(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const formatMoney = (minor: string | bigint | number | null | undefined) => {
    if (!minor || minor === "0") return "৳০";
    try {
      return formatMinor(BigInt(minor), "BDT");
    } catch {
      return `${minor} BDT`;
    }
  };

  // Aggregated Stats
  const stats = useMemo(() => {
    let totalOrders = 0;
    let totalRevenueMinor = 0n;
    let totalCommissionMinor = 0n;

    for (const c of creators) {
      const agg = c.aggregates?.entries;
      if (agg) {
        totalOrders += agg.total;
        const appComm = BigInt(agg.approved.commissionMinor || 0);
        const paidComm = BigInt(agg.paid.commissionMinor || 0);
        totalCommissionMinor += appComm + paidComm;

        // Estimate revenue from commission percent if base isn't directly summed
        if (c.commissionPercent > 0) {
          const rev = ((appComm + paidComm) * 100n) / BigInt(c.commissionPercent);
          totalRevenueMinor += rev;
        }
      }
    }

    const roi = calculateInfluencerRoi(totalRevenueMinor, totalCommissionMinor, totalOrders);

    return {
      creatorsCount: creators.length,
      totalOrders,
      totalRevenueFormatted: formatMoney(totalRevenueMinor),
      totalCommissionFormatted: formatMoney(totalCommissionMinor),
      roiMultiplier: roi.roiMultiplier,
    };
  }, [creators]);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-pink-50 p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-xl text-white shadow-sm">
                🌟
              </span>
              <h1 className="text-xl font-bold text-slate-900">
                ইনফ্লুয়েন্সার ও অ্যাফিলিয়েট ক্যাম্পেইন পোর্টাল
              </h1>
            </div>
            <p className="text-xs text-slate-600 max-w-2xl">
              ইউটিউবার, ইনস্টাগ্রাম ও টিকটক ক্রিয়েটরদের ইউনিক রেফারেল ট্র্যাকিং লিঙ্ক ও কুপন কোড দিন। কার ক্যাম্পেইন থেকে কত সেলস ও আরওআই (ROI) আসলো তা রিয়েল-টাইমে ট্র্যাক করুন।
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 px-4 py-2.5 text-xs font-semibold text-white shadow hover:opacity-95 transition"
          >
            <span>➕</span>
            <span>নতুন ইনফ্লুয়েন্সার যুক্ত করুন</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase text-slate-400">মোট পার্টনার ক্রিয়েটর</div>
          <div className="text-2xl font-bold text-slate-900">{stats.creatorsCount} জন</div>
          <div className="text-[11px] text-slate-500">অ্যাক্টিভ ক্যাম্পেইন</div>
        </div>

        <div className="card p-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase text-slate-400">অ্যাট্রিবিউটেড অর্ডার</div>
          <div className="text-2xl font-bold text-indigo-600">{stats.totalOrders} টি</div>
          <div className="text-[11px] text-slate-500">ক্রিয়েটর সেলস ভলিউম</div>
        </div>

        <div className="card p-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase text-slate-400">ইনফ্লুয়েন্সার রেভিনিউ</div>
          <div className="text-2xl font-bold text-emerald-600">{stats.totalRevenueFormatted}</div>
          <div className="text-[11px] text-slate-500">গ্রস বিক্রয় মূল্য</div>
        </div>

        <div className="card p-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase text-slate-400">গড় ক্যাম্পেইন ROI</div>
          <div className="text-2xl font-bold text-amber-600">
            {stats.roiMultiplier ? `${stats.roiMultiplier}x` : "—"}
          </div>
          <div className="text-[11px] text-slate-500">কমিশন ব্যয়ের বিপরীতে আয়</div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button type="button" onClick={() => setError("")} className="font-bold text-red-500">✕</button>
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 flex items-center justify-between">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="font-bold text-emerald-600">✕</button>
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm">নতুন ইনফ্লুয়েন্সার / পার্টনার যুক্ত করুন</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCreator} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  ইনফ্লুয়েন্সারের নাম:
                </label>
                <input
                  type="text"
                  required
                  placeholder="যেমন: তানিয়া ইসলাম (Fashion Creator)"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    মোবাইল নম্বর:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="017XXXXXXXX"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    সোশ্যাল প্ল্যাটফর্ম:
                  </label>
                  <select
                    value={formData.platform}
                    onChange={(e) => setFormData({ ...formData, platform: e.target.value as SocialPlatform })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                  >
                    {SOCIAL_PLATFORMS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.icon} {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    ইউনিক কুপন / রেফ কোড:
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="যেমন: TANIA10"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs uppercase font-bold focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    কমিশন হার (%):
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    required
                    value={formData.commissionPercent}
                    onChange={(e) => setFormData({ ...formData, commissionPercent: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  নোট বা সোশ্যাল প্রোফাইল লিঙ্ক (ঐচ্ছিক):
                </label>
                <input
                  type="text"
                  placeholder="যেমন: instagram.com/tania_fashion"
                  value={formData.note}
                  onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs text-slate-700 hover:bg-slate-50"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {submitting ? "যুক্ত হচ্ছে..." : "ইনফ্লুয়েন্সার সেভ করুন"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Creators List */}
      {loading ? (
        <div className="card p-12 text-center text-xs text-slate-500">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-amber-600 border-t-transparent mb-2" />
          <p>ইনফ্লুয়েন্সার ক্যাম্পেইন ডেটা লোড হচ্ছে...</p>
        </div>
      ) : creators.length === 0 ? (
        <div className="card p-12 text-center space-y-3">
          <div className="text-4xl">🌟</div>
          <h3 className="font-bold text-slate-800">কোনো ইনফ্লুয়েন্সার ক্যাম্পেইন এখনো শুরু হয়নি</h3>
          <p className="max-w-md mx-auto text-xs text-slate-500">
            আপনার প্রথম ইনফ্লুয়েন্সার বা অ্যাফিলিয়েট পার্টনারকে যুক্ত করুন এবং তাদের ইউনিক প্রোমো কোড ও ট্র্যাকিং লিঙ্ক দিন।
          </p>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-amber-700 transition"
          >
            প্রথম ইনফ্লুয়েন্সার যুক্ত করুন
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {creators.map((c) => {
              const agg = c.aggregates?.entries;
              const totalOrders = agg?.total ?? 0;
              const earnedMinor = BigInt(agg?.approved.commissionMinor || 0) + BigInt(agg?.paid.commissionMinor || 0);

              // Estimate revenue
              let revMinor = 0n;
              if (c.commissionPercent > 0) {
                revMinor = (earnedMinor * 100n) / BigInt(c.commissionPercent);
              }
              const roi = calculateInfluencerRoi(revMinor, earnedMinor, totalOrders);

              // Extract platform from note or fallback
              let platform: SocialPlatform = "instagram";
              if (c.note?.includes("[Platform: youtube]")) platform = "youtube";
              else if (c.note?.includes("[Platform: tiktok]")) platform = "tiktok";
              else if (c.note?.includes("[Platform: facebook]")) platform = "facebook";
              else if (c.note?.includes("[Platform: other]")) platform = "other";

              const platformMeta = getPlatformMeta(platform);
              const trackingUrl = generateInfluencerTrackingUrl({
                baseUrl: storeDomain,
                code: c.code,
                platform,
                campaignName: c.name,
              });

              return (
                <div
                  key={c.id}
                  className="card p-5 border border-slate-200 space-y-4 hover:shadow-md transition"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {platformMeta.icon} {platformMeta.label}
                        </span>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                          {c.commissionPercent}% কমিশন
                        </span>
                      </div>
                      <h3 className="font-bold text-slate-900 text-base">{c.name}</h3>
                      <p className="text-[11px] text-slate-500">ফোন: {c.phone}</p>
                    </div>

                    <div className="text-right">
                      <div className="text-xs font-semibold uppercase text-slate-400">ক্যাম্পেইন ROI</div>
                      <div className={`text-base font-bold ${roi.profitable ? "text-emerald-600" : "text-amber-600"}`}>
                        {roi.roiMultiplier ? `${roi.roiMultiplier}x` : "—"}
                      </div>
                    </div>
                  </div>

                  {/* Promo Code & Tracking Link Box */}
                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-semibold text-slate-400">কুপন কোড:</span>
                        <code className="rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-900">
                          {c.code}
                        </code>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(c.code, `code-${c.id}`)}
                        className="text-[11px] font-semibold text-indigo-600 hover:underline"
                      >
                        {copiedCode === `code-${c.id}` ? "✓ কপি হয়েছে!" : "কপি কোড"}
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                      <div className="truncate max-w-[240px] text-[11px] text-slate-500">
                        {trackingUrl}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(trackingUrl, `url-${c.id}`)}
                        className="text-[11px] font-semibold text-amber-700 hover:underline shrink-0 ml-2"
                      >
                        {copiedCode === `url-${c.id}` ? "✓ লিঙ্ক কপি হয়েছে!" : "📋 ট্র্যাকিং লিঙ্ক কপি"}
                      </button>
                    </div>
                  </div>

                  {/* Performance Matrix */}
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                      <div className="text-[10px] text-slate-400 font-semibold uppercase">অর্ডার</div>
                      <div className="font-bold text-slate-800">{totalOrders} টি</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                      <div className="text-[10px] text-slate-400 font-semibold uppercase">মোট সেলস</div>
                      <div className="font-bold text-emerald-600">{formatMoney(revMinor)}</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
                      <div className="text-[10px] text-slate-400 font-semibold uppercase">অর্জিত কমিশন</div>
                      <div className="font-bold text-indigo-600">{formatMoney(earnedMinor)}</div>
                    </div>
                  </div>

                  {/* Footer link to Commerce Ledger */}
                  <div className="pt-1 flex items-center justify-between text-xs">
                    <Link
                      href="/dashboard/commerce/affiliates"
                      className="font-medium text-slate-500 hover:text-slate-800 hover:underline"
                    >
                      কমিশন হিস্ট্রি ও পেআউট রেকর্ড →
                    </Link>

                    <span className="text-[11px] text-slate-400">
                      স্ট্যাটাস: <strong className="text-emerald-700 capitalize">{c.status}</strong>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
