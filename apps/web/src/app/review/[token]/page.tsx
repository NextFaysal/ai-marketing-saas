"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { mediaSrc } from "@/lib/media-src";

interface RewardCoupon {
  code: string;
  discount: string;
  desc: string;
}

interface ReviewPageData {
  status: string;
  rating: number | null;
  comment: string | null;
  receivedAt: string | null;
  orderNumber: string | null;
  business: string;
  branding?: { name: string; logoUrl: string | null; primaryColor: string | null };
  rewardCoupon?: RewardCoupon;
  // NF8: count of media already attached to this review, and
  // the org's Google offer (non-null only for a submitted 4–5
  // star review when the org configured its Google link).
  mediaCount?: number;
  googleReviewOffer?: { url: string } | null;
}

interface UploadedMedia {
  kind: "image" | "video";
  previewUrl: string;
  name: string;
}

/**
 * NF8 — the Google offer card. A plain external link the
 * customer may CHOOSE to open (target _blank); nothing on this
 * page ever navigates automatically, and no reward is tied to
 * it. Rendered only when the API returned a non-null offer
 * (submitted rating 4–5 AND the org configured its own link).
 */
function GoogleOfferCard({ url, storeName }: { url: string; storeName: string }) {
  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-center shadow-sm">
      <p className="text-sm font-bold text-slate-800">আপনার অভিজ্ঞতা Google-এও শেয়ার করতে চান?</p>
      <p className="mt-1 text-xs text-slate-600">
        চাইলে {storeName}-এর Google পেজেও একটি রিভিউ দিতে পারেন — এটি সম্পূর্ণ আপনার ইচ্ছা, না দিলেও কোনো অসুবিধা নেই।
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white shadow transition hover:bg-sky-700"
      >
        ⭐ {storeName}-এর Google পেজে রিভিউ দিন
      </a>
    </div>
  );
}

const QUICK_TAGS = [
  "⚡ দ্রুত ডেলিভারি",
  "💯 ১০০% আসল পণ্য",
  "👌 চমৎকার প্যাকেজিং",
  "🤝 আন্তরিক কাস্টমার সার্ভিস",
  "❤️ কাপড়ের কোয়ালিটি দারুণ",
  "📦 সাইজ একদম নিখুঁত",
];

/**
 * CX12b + Step 8 — Enhanced Public Review & UGC Collection Studio.
 * Allows customer to rate 1-5 stars, tap quick experience chips,
 * attach unboxing photos, and instantly earn a discount reward coupon.
 *
 * NF8: the photo picker is now a REAL upload — presign -> direct
 * PUT -> complete through the API's existing storage machinery
 * (the file is attached to the review server-side; the old
 * preview-only behaviour sent nothing). Photo AND video are
 * accepted, with the server's guards enforced. After a 4–5 star
 * submit, an org-configured Google review link is OFFERED as a
 * plain link (never an auto-redirect, never tied to a reward).
 */
export default function PublicReviewPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [data, setData] = useState<ReviewPageData | null>(null);
  const [error, setError] = useState("");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [uploads, setUploads] = useState<UploadedMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [googleOffer, setGoogleOffer] = useState<{ url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [copiedCoupon, setCopiedCoupon] = useState(false);
  const [reward, setReward] = useState<RewardCoupon | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/review/${token}`);
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.message ?? "Review unavailable");
        }
        const json = await res.json();
        setData(json);
        if (json.rewardCoupon) setReward(json.rewardCoupon);
        if (json.googleReviewOffer) setGoogleOffer(json.googleReviewOffer);
      } catch (e) {
        setError(e instanceof Error ? e.message : "রিভিউ লিংকটি কার্যকর নেই বা মেয়াদ উত্তীর্ণ হয়েছে");
      }
    })();
  }, [token]);

  const toggleTag = (tag: string) => {
    let nextTags: string[];
    if (selectedTags.includes(tag)) {
      nextTags = selectedTags.filter((t) => t !== tag);
    } else {
      nextTags = [...selectedTags, tag];
    }
    setSelectedTags(nextTags);

    // Auto append or refresh tags inside comment
    const baseText = comment.split("\n\nট্যাগ: ")[0].trim();
    if (nextTags.length > 0) {
      setComment(baseText ? `${baseText}\n\nট্যাগ: ${nextTags.join(", ")}` : `ট্যাগ: ${nextTags.join(", ")}`);
    } else {
      setComment(baseText);
    }
  };

  // NF8: real upload through the existing machinery —
  // presign (server guards: type + size) -> PUT the bytes
  // straight to storage -> complete (server verifies size +
  // magic bytes, then attaches to this review). A failure at
  // any step shows the server's own message and attaches
  // nothing.
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const kind: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";
    setUploading(true);
    setUploadError("");
    try {
      const preRes = await fetch(`${API_URL}/public/review/${token}/media/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, contentType: file.type, sizeBytes: file.size }),
      });
      const pre = await preRes.json().catch(() => null);
      if (!preRes.ok) throw new Error(pre?.message ?? "আপলোড শুরু করা যায়নি");
      const putRes = await fetch(pre.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!putRes.ok) throw new Error("ফাইল আপলোড করা যায়নি — আবার চেষ্টা করুন");
      const doneRes = await fetch(`${API_URL}/public/review/${token}/media/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: pre.key, kind, contentType: file.type, sizeBytes: file.size }),
      });
      const doneJson = await doneRes.json().catch(() => null);
      if (!doneRes.ok) throw new Error(doneJson?.message ?? "আপলোড সম্পূর্ণ করা যায়নি");
      setUploads((u) => [...u, { kind, previewUrl: URL.createObjectURL(file), name: file.name }]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "আপলোড ব্যর্থ হয়েছে");
    } finally {
      setUploading(false);
    }
  };

  async function submit() {
    if (!rating) {
      setError("অনুগ্রহ করে ১–৫ তারার মধ্যে একটি রেটিং বেছে নিন");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/public/review/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? "পাঠানো যায়নি");
      if (j.rewardCoupon) setReward(j.rewardCoupon);
      // NF8: the Google offer is computed from the STORED review
      // (rating 4–5 + the org's configured link) — re-read the
      // page data so the thank-you screen can offer it. A failed
      // re-read simply means no offer is shown.
      try {
        const again = await fetch(`${API_URL}/public/review/${token}`);
        if (again.ok) {
          const fresh = await again.json();
          setData(fresh);
          setGoogleOffer(fresh.googleReviewOffer ?? null);
        }
      } catch { /* no offer shown */ }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "পাঠানো যায়নি");
    } finally {
      setBusy(false);
    }
  }

  const copyCouponCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCoupon(true);
    setTimeout(() => setCopiedCoupon(false), 3000);
  };

  const accent = data?.branding?.primaryColor ?? undefined;
  const already = data?.rating != null;
  const storeName = data?.branding?.name ?? data?.business ?? "আমাদের স্টোর";

  return (
    <main className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
      {/* Brand Header */}
      <header className="text-center">
        {data?.branding?.logoUrl ? (
          <img
            src={mediaSrc(API_URL, data.branding.logoUrl) ?? ""}
            alt={storeName}
            className="mx-auto h-16 w-16 rounded-2xl border bg-white object-contain p-1 shadow-sm"
          />
        ) : null}
        <p className="mt-2 text-xs font-bold uppercase tracking-wider text-slate-500" style={accent ? { color: accent } : undefined}>
          {storeName}
        </p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">⭐ আপনার কেনাকাটার অভিজ্ঞতা</h1>
        {data?.orderNumber ? (
          <p className="mt-0.5 text-xs font-medium text-slate-500">অর্ডার নম্বর: #{data.orderNumber}</p>
        ) : null}
      </header>

      {!data && !error ? (
        <div className="card p-8 text-center text-sm text-slate-400">
          <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          রিভিউ ফরম লোড হচ্ছে...
        </div>
      ) : null}

      {error && !done ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      ) : null}

      {/* Already Submitted View */}
      {data && already && !done ? (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-center">
            <p className="text-3xl text-amber-400">
              {"★★★★★".slice(0, data.rating ?? 0)}
              <span className="text-slate-200">{"★★★★★".slice(data.rating ?? 0)}</span>
            </p>
            <h2 className="mt-2 text-base font-bold text-slate-800">আপনার রিভিউ ইতিমধ্যে জমা হয়েছে — ধন্যবাদ!</h2>
            {data.receivedAt && (
              <p className="mt-1 text-xs text-slate-400">
                জমা দেওয়ার তারিখ: {new Date(data.receivedAt).toLocaleDateString("bn-BD")}
              </p>
            )}
          </div>

          {data.comment && (
            <div className="rounded-xl bg-slate-50 p-3.5 text-sm text-slate-700 italic border border-slate-100">
              “{data.comment}”
            </div>
          )}

          {googleOffer ? <GoogleOfferCard url={googleOffer.url} storeName={storeName} /> : null}

          {/* Reward Voucher Card */}
          {reward && (
            <div className="rounded-2xl border-2 border-dashed border-emerald-400 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/50 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                    🎁 লয়ালটি গিফট ভাউচার
                  </span>
                  <h3 className="mt-1.5 text-base font-black text-slate-900">{reward.discount} কুপন কোড</h3>
                  <p className="text-xs text-slate-600">{reward.desc}</p>
                </div>
                <div className="text-right">
                  <div className="rounded-xl border border-emerald-300 bg-white px-3 py-1.5 font-mono text-sm font-black text-emerald-700 shadow-sm">
                    {reward.code}
                  </div>
                  <button
                    onClick={() => copyCouponCode(reward.code)}
                    className="mt-1.5 text-[11px] font-bold text-emerald-700 hover:underline"
                  >
                    {copiedCoupon ? "✓ কপি হয়েছে!" : "📋 কোড কপি করুন"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* Active Submission Form */}
      {data && !already && !done ? (
        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
          {/* Star Rating Selector */}
          <div className="text-center">
            <p className="mb-2 text-sm font-bold text-slate-700">পণ্য ও ডেলিভারি সেবা কেমন ছিল?</p>
            <div className="flex justify-center gap-2" role="radiogroup" aria-label="রেটিং">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} তারা`}
                  className={`text-4xl sm:text-5xl leading-none transition-transform hover:scale-110 active:scale-95 ${
                    (hover || rating) >= n ? "text-amber-400" : "text-slate-200"
                  }`}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => setRating(n)}
                >
                  ★
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {rating === 5
                ? "🌟 অসাধারণ! দারুণ অভিজ্ঞতা"
                : rating === 4
                ? "👍 ভালো"
                : rating === 3
                ? "😐 মোটামুটি"
                : rating > 0
                ? "👎 সন্তুষ্ট নই"
                : "রেটিং দিতে তারায় ক্লিক করুন"}
            </p>
          </div>

          {/* Quick Experience Chips */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">
              💡 এক ক্লিকে হাইলাইট যোগ করুন:
            </label>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_TAGS.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      isSelected
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Freeform Comment */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              আপনার মতামত ও পরামর্শ (ঐচ্ছিক)
            </label>
            <textarea
              className="input w-full text-xs"
              rows={3}
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="পণ্য বা প্যাকেজিং সম্পর্কে আপনার অনুভূতি লিখুন..."
            />
          </div>

          {/* NF8: UGC photo/video upload — REAL upload through the
              existing storage machinery (see handleFileChange).
              Server guards: ছবি PNG/JPEG/WebP সর্বোচ্চ ১০ MB,
              ভিডিও MP4/MOV/WebM সর্বোচ্চ ৫০ MB, সর্বোচ্চ ৪টি ফাইল।
              Media stays private until the shop approves the
              review (staff moderation) — it is never public
              before that. */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              📸 আনবক্সিং বা পণ্যের ছবি/ভিডিও আপলোড (ঐচ্ছিক)
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <label className={`inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition ${uploading ? "opacity-50" : "cursor-pointer hover:bg-slate-100"}`}>
                <span>{uploading ? "আপলোড হচ্ছে…" : "📁 ছবি/ভিডিও বেছে নিন"}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
                  onChange={handleFileChange}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
              {uploads.map((u, i) => (
                <div key={`${u.name}-${i}`} className="relative">
                  {u.kind === "image" ? (
                    <img
                      src={u.previewUrl}
                      alt="আপলোড করা ছবি"
                      className="h-12 w-12 rounded-lg object-cover border border-indigo-200 shadow-sm"
                    />
                  ) : (
                    <video
                      src={u.previewUrl}
                      className="h-12 w-12 rounded-lg object-cover border border-indigo-200 shadow-sm"
                      muted
                      playsInline
                    />
                  )}
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white">✓</span>
                </div>
              ))}
            </div>
            {uploads.length > 0 ? (
              <p className="mt-1.5 text-[11px] font-medium text-emerald-700">✓ {uploads.length}টি ফাইল আপলোড হয়েছে — রিভিউয়ের সঙ্গে যুক্ত হয়েছে। দোকান অনুমোদন করার পরই এগুলো পাবলিক পেজে দেখা যাবে।</p>
            ) : null}
            {uploadError ? (
              <p className="mt-1.5 text-[11px] font-medium text-red-600">{uploadError}</p>
            ) : null}
          </div>

          {/* Submit Button */}
          <button
            type="button"
            className="btn-primary w-full py-3 text-sm font-bold shadow-md"
            disabled={busy || rating === 0 || uploading}
            onClick={submit}
          >
            {busy ? "জমা হচ্ছে..." : uploading ? "আপলোড শেষ হওয়ার অপেক্ষা করুন…" : "⭐ রিভিউ জমা দিন ও পুরস্কার জিতুন"}
          </button>
        </section>
      ) : null}

      {/* Thank you + Instant Reward Modal Card */}
      {done ? (
        <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 text-center shadow-md animate-fade-in">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl">
            🎉
          </div>
          <h2 className="text-xl font-black text-emerald-900">রিভিউ সফলভাবে জমা হয়েছে!</h2>
          <p className="text-xs text-emerald-700">
            আপনার মতামত আমাদের সার্ভিসকে আরও উন্নত করতে সাহায্য করবে। রিভিউ দেওয়ার জন্য আপনার জন্য বিশেষ উপহার:
          </p>

          {reward && (
            <div className="mx-auto max-w-sm rounded-2xl border-2 border-dashed border-emerald-400 bg-white p-5 shadow-sm">
              <span className="rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-bold text-emerald-800">
                🎁 {reward.discount} ডিসকাউন্ট উপহার
              </span>
              <p className="mt-2 text-xs text-slate-600">{reward.desc}</p>

              <div className="mt-3 flex items-center justify-center gap-2">
                <span className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 font-mono text-base font-black text-emerald-800">
                  {reward.code}
                </span>
                <button
                  type="button"
                  onClick={() => copyCouponCode(reward.code)}
                  className="rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow transition hover:bg-emerald-700"
                >
                  {copiedCoupon ? "✓ কপিড!" : "কপি"}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">পরবর্তী যেকোনো অর্ডারে চেকআউটে এই কোডটি ব্যবহার করুন</p>
            </div>
          )}

          {googleOffer ? <GoogleOfferCard url={googleOffer.url} storeName={storeName} /> : null}
        </section>
      ) : null}
    </main>
  );
}
