"use client";
import React from "react";
import { createOrganizationSchema } from "@repo/contracts";
import { apiFetch } from "@/lib/api";
import { slugifyShopName, localSlugProblem, SHOP_ADDRESS_SUFFIX } from "@/lib/shop-slug";

/**
 * OU1 item 2: the "নতুন Organization তৈরি" form inside the
 * dashboard switcher. It posts ONLY the fields the real
 * POST /organizations DTO accepts and requires — name + slug
 * (country/timezone/currency keep their server defaults BD /
 * Asia/Dhaka / BDT; the service then creates the OWNER membership,
 * BusinessProfile and FREE/TRIALING subscription).
 *
 * Slug discipline mirrors onboarding (TD2): local format/reserved
 * verdict instantly, then the authoritative slug-available API
 * verdict (taken / reserved / cooldown). Any other API refusal is
 * shown verbatim — the server's message is the honest error state.
 * On success the parent switches into the new org.
 */
export default function OrgCreateForm({ onBack, onCreated }: { onBack: () => void; onCreated: (orgId: string) => void }) {
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [slugState, setSlugState] = React.useState<"idle" | "checking" | "ok" | "bad" | "unknown">("idle");
  const [slugMsg, setSlugMsg] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState("");
  const slugSeq = React.useRef(0);

  React.useEffect(() => {
    if (!slug) { setSlugState("idle"); setSlugMsg(""); return; }
    const problem = localSlugProblem(slug);
    if (problem) {
      setSlugState("bad");
      setSlugMsg(problem === "reserved"
        ? "এই নামটি সংরক্ষিত — প্ল্যাটফর্মের নিজের বা বিভ্রান্তিকর নাম হওয়ায় ব্যবহার করা যাবে না।"
        : "নামের আকার ঠিক নেই — ছোট হাতের ইংরেজি অক্ষর, সংখ্যা ও একক হাইফেন, ৩–৬০ অক্ষর।");
      return;
    }
    setSlugState("checking"); setSlugMsg("");
    const seq = ++slugSeq.current;
    const t = setTimeout(async () => {
      try {
        const out = await apiFetch<{ available: boolean; message: string }>(`/organizations/slug-available?slug=${encodeURIComponent(slug)}`);
        if (slugSeq.current !== seq) return;
        setSlugState(out.available ? "ok" : "bad");
        setSlugMsg(out.message);
      } catch {
        if (slugSeq.current !== seq) return;
        setSlugState("unknown");
        setSlugMsg("এই মুহূর্তে নামটি যাচাই করা যাচ্ছে না — তৈরি করার সময় সার্ভার আবার যাচাই করবে।");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [slug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const parsed = createOrganizationSchema.safeParse({ name: name.trim(), slug });
    if (!parsed.success) {
      setError(name.trim().length < 2 ? "ব্যবসার নাম কমপক্ষে ২ অক্ষরের হতে হবে।" : "দোকানের ঠিকানার নামটি ঠিক করুন (ছোট হাতের অক্ষর, সংখ্যা ও একক হাইফেন, ৩–৬০ অক্ষর)।");
      return;
    }
    if (slugState === "bad") { setError(slugMsg || "এই দোকানের ঠিকানাটি ব্যবহার করা যাবে না।"); return; }
    setCreating(true);
    try {
      const org = await apiFetch<{ id: string }>("/organizations", {
        method: "POST",
        body: JSON.stringify({ name: parsed.data.name, slug: parsed.data.slug }),
      });
      onCreated(org.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Organization তৈরি করা যায়নি। আবার চেষ্টা করুন।");
      setCreating(false);
    }
  };

  return (
    <form onSubmit={submit} className="p-1.5">
      <div className="pb-2 text-[13px] font-bold text-slate-800">নতুন Organization তৈরি</div>
      <label className="block text-xs font-medium text-slate-600">ব্যবসার নাম
        <input
          className="input mt-1"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugifyShopName(e.target.value));
          }}
          placeholder="যেমন: Dhaka Fashion House"
          required
          autoFocus
        />
      </label>
      <label className="mt-3 block text-xs font-medium text-slate-600">দোকানের ঠিকানা
        <span className="mt-1 flex items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-indigo-500">
          <input
            className="min-w-0 flex-1 px-2.5 py-2 text-[13px] outline-none"
            value={slug}
            onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
            placeholder="dhaka-fashion-house"
            aria-label="দোকানের ঠিকানার নাম"
          />
          <span className="flex items-center bg-slate-50 px-2 text-[11px] text-slate-500">{SHOP_ADDRESS_SUFFIX}</span>
        </span>
      </label>
      {slugState === "checking" ? <p className="mt-1 text-[11px] text-slate-500">নামটি খালি আছে কিনা যাচাই হচ্ছে…</p> : null}
      {slugState === "ok" ? <p className="mt-1 text-[11px] text-emerald-600">✓ {slugMsg}</p> : null}
      {slugState === "bad" ? <p className="mt-1 text-[11px] text-red-600">{slugMsg}</p> : null}
      {slugState === "unknown" ? <p className="mt-1 text-[11px] text-amber-600">{slugMsg}</p> : null}
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">এই ঠিকানা পরে বদলানো যাবে না। তৈরি করলেই আপনি নতুন Organization-এর মালিক (Owner) হবেন এবং সরাসরি সেটিতে চলে যাবেন।</p>
      {error ? <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-[12px] text-red-700">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={onBack} disabled={creating}>ফিরে যান</button>
        <button type="submit" className="btn-primary flex-1" disabled={creating || slugState === "bad"}>{creating ? "তৈরি হচ্ছে…" : "তৈরি করুন"}</button>
      </div>
    </form>
  );
}
