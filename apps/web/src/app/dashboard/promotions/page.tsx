"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getOrganizationId } from "@/lib/org";
import { apiFetch } from "@/lib/api";
import { asList } from "@/lib/as-list";
import {
  GROUP_BUY_NO_PREPAYMENT_NOTE, JOIN_STATUS_LABELS, PLAY_OUTCOME_LABELS, PROMO_KIND_LABELS,
  buildGroupBuyConfig, buildQuizConfig, buildWheelConfig,
  createPromoCampaign, fetchPromoCampaign, fetchPromoCampaigns, segmentSharePercent,
  setPromoCampaignActive,
  type PromoCampaignView, type PromoJoinView, type PromoKind, type PromoPlayView,
  type WheelSegmentForm,
} from "@/lib/gamified-promotions";
import { useToast } from "@repo/ui/client";

// NF6 (FB3) — ONE Promotions page for all three gamified
// mechanics (spin wheel / product-finder quiz / group buy):
// org config CRUD + REAL stats counted server-side from the
// play/join rows and the issued StoreDiscount coupons.
// Honesty notes are shown where they belong: the wheel outcome
// is decided server-side from the weights (the shopper can
// never force a win), and group buy takes NO prepayment — the
// exact note shoppers see is repeated here for staff.

interface ProductItem {
  id: string;
  name: string;
  categoryId?: string | null;
  category?: string | null;
}

const inputCls =
  "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900";
const labelCls = "block text-xs font-medium text-slate-500 mb-1";

export default function PromotionsPage() {
  const { toast } = useToast();
  const orgId = getOrganizationId();
  const [campaigns, setCampaigns] = useState<PromoCampaignView[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [detail, setDetail] = useState<{ id: string; plays: PromoPlayView[]; joins: PromoJoinView[] } | null>(null);

  // Create form
  const [kind, setKind] = useState<PromoKind>("spin_wheel");
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("delay_seconds");
  const [delaySeconds, setDelaySeconds] = useState(5);
  const [endsAt, setEndsAt] = useState("");
  const [expiryHours, setExpiryHours] = useState(72);
  const [segments, setSegments] = useState<WheelSegmentForm[]>([
    { label: "১০% ছাড়", weight: 20, prizeKind: "percent", prizeValue: 10 },
    { label: "কিছু না", weight: 80, prizeKind: "none", prizeValue: 0 },
  ]);
  const [quizText, setQuizText] = useState("");
  const [quizOptions, setQuizOptions] = useState<Array<{ text: string; target: string }>>([
    { text: "", target: "" },
    { text: "", target: "" },
  ]);
  const [completionCoupon, setCompletionCoupon] = useState(false);
  const [completionValue, setCompletionValue] = useState(10);
  const [gbProductId, setGbProductId] = useState("");
  const [gbBuyers, setGbBuyers] = useState(5);
  const [gbKind, setGbKind] = useState<"percent" | "fixed">("percent");
  const [gbValue, setGbValue] = useState(15);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [camps, prods] = await Promise.all([
        fetchPromoCampaigns(orgId),
        apiFetch<unknown>(`/organizations/${orgId}/products?pageSize=100`).catch(() => []),
      ]);
      setCampaigns(camps);
      setProducts(asList<ProductItem>(prods));
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "লোড ব্যর্থ হয়েছে", tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [orgId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of products) {
      if (p.categoryId && !seen.has(p.categoryId)) {
        seen.set(p.categoryId, p.category ?? p.categoryId);
      }
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [products]);

  const create = async () => {
    if (!orgId) return;
    if (!name.trim()) {
      toast({ title: "ক্যাম্পেইনের নাম দিন", tone: "error" });
      return;
    }
    let config: Record<string, unknown>;
    if (kind === "spin_wheel") config = buildWheelConfig(segments, expiryHours);
    else if (kind === "quiz") {
      config = buildQuizConfig(
        [{
          text: quizText,
          options: quizOptions.map((o) => ({ text: o.text, categoryId: o.target || undefined })),
        }],
        completionCoupon ? { kind: "percent", value: completionValue } : null,
        expiryHours,
      );
    } else {
      config = buildGroupBuyConfig({
        productId: gbProductId, requiredBuyers: gbBuyers,
        discountKind: gbKind, discountValue: gbValue, couponExpiryHours: expiryHours,
      });
      if (!endsAt) {
        toast({ title: "গ্রুপ বাইয়ের জন্য শেষের সময় আবশ্যক", tone: "error" });
        return;
      }
    }
    setBusy("create");
    try {
      await createPromoCampaign(orgId, {
        kind,
        name: name.trim(),
        trigger,
        delaySeconds,
        ...(endsAt ? { endsAt: new Date(endsAt).toISOString() } : {}),
        config,
      });
      toast({ title: "ক্যাম্পেইন তৈরি হয়েছে" });
      setName("");
      await load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "তৈরি ব্যর্থ হয়েছে", tone: "error" });
    } finally {
      setBusy("");
    }
  };

  const toggleActive = async (c: PromoCampaignView) => {
    if (!orgId) return;
    setBusy(c.id);
    try {
      await setPromoCampaignActive(orgId, c.id, !c.active);
      await load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "ব্যর্থ হয়েছে", tone: "error" });
    } finally {
      setBusy("");
    }
  };

  const openDetail = async (c: PromoCampaignView) => {
    if (!orgId) return;
    if (detail?.id === c.id) {
      setDetail(null);
      return;
    }
    try {
      const res = await fetchPromoCampaign(orgId, c.id);
      setDetail({ id: c.id, plays: res.plays ?? [], joins: res.joins ?? [] });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "বিস্তারিত লোড ব্যর্থ", tone: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      <header>
        <h1 className="text-xl font-bold">প্রমোশন (গেমিফাইড)</h1>
        <p className="mt-1 text-sm text-slate-500">
          স্পিন হুইল, পণ্য-খোঁজ কুইজ ও গ্রুপ বাই — দোকানের পপআপে দেখানো হয়। জিতলে আসল একবার-ব্যবহারযোগ্য
          কুপন কোড তৈরি হয় (কুপন ইঞ্জিন থেকেই)। স্পিনের ফল সার্ভারেই নির্ধারিত হয় — ক্রেতা জোর করে
          জিততে পারেন না। {GROUP_BUY_NO_PREPAYMENT_NOTE}
        </p>
      </header>

      {/* ---------- Create ---------- */}
      <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="mb-3 font-semibold">নতুন ক্যাম্পেইন</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>ধরন</label>
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as PromoKind)}>
              <option value="spin_wheel">স্পিন হুইল</option>
              <option value="quiz">পণ্য-খোঁজ কুইজ</option>
              <option value="group_buy">গ্রুপ বাই</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>নাম</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="ঈদ স্পিন অফার" />
          </div>
          <div>
            <label className={labelCls}>পপআপ ট্রিগার</label>
            <select className={inputCls} value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              <option value="delay_seconds">কিছুক্ষণ পর (delay)</option>
              <option value="scroll_percent">স্ক্রলে</option>
              <option value="exit_intent">চলে যেতে চাইলে (exit intent)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Delay (সেকেন্ড)</label>
            <input className={inputCls} type="number" min={0} value={delaySeconds}
              onChange={(e) => setDelaySeconds(Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>কুপনের মেয়াদ (ঘণ্টা)</label>
            <input className={inputCls} type="number" min={1} value={expiryHours}
              onChange={(e) => setExpiryHours(Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>{kind === "group_buy" ? "উইন্ডো শেষ (আবশ্যক)" : "শেষের সময় (ঐচ্ছিক)"}</label>
            <input className={inputCls} type="datetime-local" value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>

        {kind === "spin_wheel" && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-slate-500">
              ওজন = সম্ভাবনার হিসাব (শুধু সার্ভারে থাকে, ক্রেতা দেখতে পান না)। মোট ওজনের শেয়ার পাশে দেখানো হয়েছে।
            </p>
            {segments.map((s, i) => (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-5">
                <div className="sm:col-span-2">
                  <label className={labelCls}>লেবেল</label>
                  <input className={inputCls} value={s.label}
                    onChange={(e) => setSegments(segments.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                </div>
                <div>
                  <label className={labelCls}>ওজন ({segmentSharePercent(segments, i)}%)</label>
                  <input className={inputCls} type="number" min={0} value={s.weight}
                    onChange={(e) => setSegments(segments.map((x, j) => j === i ? { ...x, weight: Number(e.target.value) } : x))} />
                </div>
                <div>
                  <label className={labelCls}>পুরস্কার</label>
                  <select className={inputCls} value={s.prizeKind}
                    onChange={(e) => setSegments(segments.map((x, j) => j === i ? { ...x, prizeKind: e.target.value as WheelSegmentForm["prizeKind"] } : x))}>
                    <option value="none">কিছু না</option>
                    <option value="percent">% ছাড়</option>
                    <option value="fixed">নির্দিষ্ট টাকা ছাড় (পয়সায়)</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>পরিমাণ</label>
                  <input className={inputCls} type="number" min={0} value={s.prizeValue} disabled={s.prizeKind === "none"}
                    onChange={(e) => setSegments(segments.map((x, j) => j === i ? { ...x, prizeValue: Number(e.target.value) } : x))} />
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <button type="button" className="rounded-md border px-3 py-1.5 text-sm"
                onClick={() => setSegments([...segments, { label: "", weight: 10, prizeKind: "none", prizeValue: 0 }])}>
                + সেগমেন্ট
              </button>
              {segments.length > 2 && (
                <button type="button" className="rounded-md border px-3 py-1.5 text-sm"
                  onClick={() => setSegments(segments.slice(0, -1))}>
                  − শেষটি বাদ
                </button>
              )}
            </div>
          </div>
        )}

        {kind === "quiz" && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-slate-500">
              v1 ফর্মে একটি প্রশ্ন সেট করা যায় (API ১০টি পর্যন্ত সমর্থন করে)। প্রতিটি অপশন একটি
              ক্যাটাগরির দিকে নির্দেশ করে — ফলাফলের পেজে ওই ক্যাটাগরির আসল পণ্য দেখানো হয়।
            </p>
            <div>
              <label className={labelCls}>প্রশ্ন</label>
              <input className={inputCls} value={quizText} onChange={(e) => setQuizText(e.target.value)}
                placeholder="কোন ধরনের পণ্য খুঁজছেন?" />
            </div>
            {quizOptions.map((o, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <input className={inputCls} value={o.text} placeholder={`অপশন ${i + 1}-এর লেখা`}
                  onChange={(e) => setQuizOptions(quizOptions.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
                <select className={inputCls} value={o.target}
                  onChange={(e) => setQuizOptions(quizOptions.map((x, j) => j === i ? { ...x, target: e.target.value } : x))}>
                  <option value="">ক্যাটাগরি বেছে নিন</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
            ))}
            <button type="button" className="rounded-md border px-3 py-1.5 text-sm"
              onClick={() => setQuizOptions([...quizOptions, { text: "", target: "" }])}>
              + অপশন
            </button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={completionCoupon} onChange={(e) => setCompletionCoupon(e.target.checked)} />
              কুইজ শেষ করলে কুপন দিন
              {completionCoupon && (
                <input className="w-20 rounded-md border px-2 py-1" type="number" min={1} max={90}
                  value={completionValue} onChange={(e) => setCompletionValue(Number(e.target.value))} />
              )}
              {completionCoupon && <span>% ছাড়</span>}
            </label>
          </div>
        )}

        {kind === "group_buy" && (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className={labelCls}>পণ্য</label>
              <select className={inputCls} value={gbProductId} onChange={(e) => setGbProductId(e.target.value)}>
                <option value="">পণ্য বেছে নিন</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>কতজন ক্রেতা লাগবে</label>
              <input className={inputCls} type="number" min={2} value={gbBuyers}
                onChange={(e) => setGbBuyers(Number(e.target.value))} />
            </div>
            <div>
              <label className={labelCls}>ছাড়</label>
              <div className="flex gap-2">
                <select className={inputCls} value={gbKind} onChange={(e) => setGbKind(e.target.value as "percent" | "fixed")}>
                  <option value="percent">%</option>
                  <option value="fixed">পয়সা</option>
                </select>
                <input className={inputCls} type="number" min={1} value={gbValue}
                  onChange={(e) => setGbValue(Number(e.target.value))} />
              </div>
            </div>
            <p className="text-xs text-slate-500 sm:col-span-4">{GROUP_BUY_NO_PREPAYMENT_NOTE}</p>
          </div>
        )}

        <button type="button" disabled={busy === "create"} onClick={create}
          className="mt-4 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy === "create" ? "তৈরি হচ্ছে…" : "ক্যাম্পেইন তৈরি করুন"}
        </button>
      </section>

      {/* ---------- List + stats ---------- */}
      <section className="space-y-3">
        <h2 className="font-semibold">ক্যাম্পেইনসমূহ</h2>
        {loading ? (
          <p className="text-sm text-slate-500">লোড হচ্ছে…</p>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-slate-500">এখনো কোনো ক্যাম্পেইন নেই।</p>
        ) : (
          campaigns.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
                  {PROMO_KIND_LABELS[c.kind] ?? c.kind}
                </span>
                <span className="font-medium">{c.name}</span>
                <span className={`rounded px-2 py-0.5 text-xs ${c.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                  {c.active ? "সক্রিয়" : "বন্ধ"}
                </span>
                <span className="ml-auto flex gap-2">
                  <button type="button" className="rounded-md border px-3 py-1 text-sm" onClick={() => openDetail(c)}>
                    {detail?.id === c.id ? "বন্ধ করুন" : "বিস্তারিত"}
                  </button>
                  <button type="button" disabled={busy === c.id} className="rounded-md border px-3 py-1 text-sm"
                    onClick={() => toggleActive(c)}>
                    {c.active ? "বন্ধ করুন" : "চালু করুন"}
                  </button>
                </span>
              </div>
              {c.stats && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
                  {c.kind === "group_buy" ? (
                    <>
                      <span>যোগ দিয়েছেন: {c.stats.joins ?? 0}</span>
                      <span>ছাড় চালু: {c.stats.unlocked ?? 0}</span>
                      <span>মেয়াদ শেষ: {c.stats.expired ?? 0}</span>
                    </>
                  ) : (
                    <>
                      <span>খেলেছেন: {c.stats.plays ?? 0}</span>
                      <span>জিতেছেন: {c.stats.wins ?? 0}</span>
                      <span>সম্পন্ন: {c.stats.completions ?? 0}</span>
                    </>
                  )}
                  <span>কুপন ইস্যু: {c.stats.couponsIssued ?? 0}</span>
                  <span>কুপন ব্যবহার হয়েছে: {c.stats.couponsRedeemed ?? 0}</span>
                </div>
              )}
              {detail?.id === c.id && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {c.kind === "group_buy" ? (
                    detail.joins.length === 0 ? (
                      <p className="text-sm text-slate-500">কেউ এখনো যোগ দেননি।</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {detail.joins.map((j) => (
                          <li key={j.id} className="flex flex-wrap gap-x-3">
                            <span>{j.customerName ?? "—"}</span>
                            <span>{j.phone}</span>
                            <span>{JOIN_STATUS_LABELS[j.status] ?? j.status}</span>
                            {j.couponCode && <span className="font-mono">{j.couponCode}</span>}
                          </li>
                        ))}
                      </ul>
                    )
                  ) : detail.plays.length === 0 ? (
                    <p className="text-sm text-slate-500">এখনো কেউ অংশ নেননি।</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {detail.plays.map((p) => (
                        <li key={p.id} className="flex flex-wrap gap-x-3">
                          <span>{p.customerName ?? "—"}</span>
                          <span>{p.phone}</span>
                          <span>{PLAY_OUTCOME_LABELS[p.outcome] ?? p.outcome}</span>
                          {p.segmentLabel && <span>{p.segmentLabel}</span>}
                          {p.couponCode && <span className="font-mono">{p.couponCode}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
