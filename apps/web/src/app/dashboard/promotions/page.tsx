"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
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
  const { dict, t, locale } = useLocale();
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
    { label: dict.commerce.text12lifg8, weight: 20, prizeKind: "percent", prizeValue: 10 },
    { label: dict.commerce.nothing, weight: 80, prizeKind: "none", prizeValue: 0 },
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
      toast({ title: e instanceof Error ? e.message : dict.commerce.loadingFailed2, tone: "error" });
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
      toast({ title: dict.commerce.giveTheCampaignAName, tone: "error" });
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
        toast({ title: dict.commerce.anEndTimeIsRequired, tone: "error" });
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
      toast({ title: dict.commerce.campaignCreated });
      setName("");
      await load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : dict.commerce.creationFailed2, tone: "error" });
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
      toast({ title: e instanceof Error ? e.message : dict.commerce.failed2, tone: "error" });
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
      toast({ title: e instanceof Error ? e.message : dict.commerce.detailsLoadingFailed, tone: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      <header>
        <h1 className="text-xl font-bold">{dict.commerce.promotionsGamified}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {dict.commerce.spinWheelProductFinderQuiz}{GROUP_BUY_NO_PREPAYMENT_NOTE}
        </p>
      </header>

      {/* ---------- Create ---------- */}
      <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="mb-3 font-semibold">{dict.commerce.newCampaign}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>{dict.commerce.type}</label>
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as PromoKind)}>
              <option value="spin_wheel">{dict.commerce.spinWheel}</option>
              <option value="quiz">{dict.commerce.productFinderQuiz}</option>
              <option value="group_buy">{dict.commerce.groupBuy}</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>{dict.commerce.name}</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={dict.commerce.eidSpinOffer} />
          </div>
          <div>
            <label className={labelCls}>{dict.commerce.popupTrigger}</label>
            <select className={inputCls} value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              <option value="delay_seconds">{dict.commerce.afterAWhileDelay}</option>
              <option value="scroll_percent">{dict.commerce.onScroll2}</option>
              <option value="exit_intent">{dict.commerce.onExitIntent2}</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>{dict.commerce.delaySeconds2}</label>
            <input className={inputCls} type="number" min={0} value={delaySeconds}
              onChange={(e) => setDelaySeconds(Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>{dict.commerce.couponValidityHours}</label>
            <input className={inputCls} type="number" min={1} value={expiryHours}
              onChange={(e) => setExpiryHours(Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>{kind === "group_buy" ? dict.commerce.windowEndRequired : dict.commerce.endTimeOptional}</label>
            <input className={inputCls} type="datetime-local" value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>

        {kind === "spin_wheel" && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-slate-500">
              {dict.commerce.weightTheProbabilityAccountStays}</p>
            {segments.map((s, i) => (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-5">
                <div className="sm:col-span-2">
                  <label className={labelCls}>{dict.commerce.label}</label>
                  <input className={inputCls} value={s.label}
                    onChange={(e) => setSegments(segments.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                </div>
                <div>
                  <label className={labelCls}>{dict.commerce.weight3}{segmentSharePercent(segments, i)}%)</label>
                  <input className={inputCls} type="number" min={0} value={s.weight}
                    onChange={(e) => setSegments(segments.map((x, j) => j === i ? { ...x, weight: Number(e.target.value) } : x))} />
                </div>
                <div>
                  <label className={labelCls}>{dict.commerce.reward}</label>
                  <select className={inputCls} value={s.prizeKind}
                    onChange={(e) => setSegments(segments.map((x, j) => j === i ? { ...x, prizeKind: e.target.value as WheelSegmentForm["prizeKind"] } : x))}>
                    <option value="none">{dict.commerce.nothing}</option>
                    <option value="percent">{dict.commerce.off}</option>
                    <option value="fixed">{dict.commerce.fixedAmountOffInPoisha}</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{dict.commerce.quantity}</label>
                  <input className={inputCls} type="number" min={0} value={s.prizeValue} disabled={s.prizeKind === "none"}
                    onChange={(e) => setSegments(segments.map((x, j) => j === i ? { ...x, prizeValue: Number(e.target.value) } : x))} />
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <button type="button" className="rounded-md border px-3 py-1.5 text-sm"
                onClick={() => setSegments([...segments, { label: "", weight: 10, prizeKind: "none", prizeValue: 0 }])}>
                {dict.commerce.segment}</button>
              {segments.length > 2 && (
                <button type="button" className="rounded-md border px-3 py-1.5 text-sm"
                  onClick={() => setSegments(segments.slice(0, -1))}>
                  {dict.commerce.removeLast}</button>
              )}
            </div>
          </div>
        )}

        {kind === "quiz" && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-slate-500">
              {dict.commerce.oneQuestionCanBeSet}</p>
            <div>
              <label className={labelCls}>{dict.commerce.question}</label>
              <input className={inputCls} value={quizText} onChange={(e) => setQuizText(e.target.value)}
                placeholder={dict.commerce.whatKindOfProductAre} />
            </div>
            {quizOptions.map((o, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <input className={inputCls} value={o.text} placeholder={t("commerce.textForOption", { p0: i + 1 })}
                  onChange={(e) => setQuizOptions(quizOptions.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
                <select className={inputCls} value={o.target}
                  onChange={(e) => setQuizOptions(quizOptions.map((x, j) => j === i ? { ...x, target: e.target.value } : x))}>
                  <option value="">{dict.commerce.selectACategory}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
            ))}
            <button type="button" className="rounded-md border px-3 py-1.5 text-sm"
              onClick={() => setQuizOptions([...quizOptions, { text: "", target: "" }])}>
              {dict.commerce.option}</button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={completionCoupon} onChange={(e) => setCompletionCoupon(e.target.checked)} />
              {dict.commerce.giveACouponWhenThe}{completionCoupon && (
                <input className="w-20 rounded-md border px-2 py-1" type="number" min={1} max={90}
                  value={completionValue} onChange={(e) => setCompletionValue(Number(e.target.value))} />
              )}
              {completionCoupon && <span>{dict.commerce.off}</span>}
            </label>
          </div>
        )}

        {kind === "group_buy" && (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className={labelCls}>{dict.commerce.product}</label>
              <select className={inputCls} value={gbProductId} onChange={(e) => setGbProductId(e.target.value)}>
                <option value="">{dict.commerce.selectAProduct}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>{dict.commerce.howManyBuyersAreNeeded}</label>
              <input className={inputCls} type="number" min={2} value={gbBuyers}
                onChange={(e) => setGbBuyers(Number(e.target.value))} />
            </div>
            <div>
              <label className={labelCls}>{dict.commerce.discount}</label>
              <div className="flex gap-2">
                <select className={inputCls} value={gbKind} onChange={(e) => setGbKind(e.target.value as "percent" | "fixed")}>
                  <option value="percent">%</option>
                  <option value="fixed">{dict.commerce.poisha}</option>
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
          {busy === "create" ? dict.commerce.creating : dict.commerce.createCampaign}
        </button>
      </section>

      {/* ---------- List + stats ---------- */}
      <section className="space-y-3">
        <h2 className="font-semibold">{dict.commerce.campaigns}</h2>
        {loading ? (
          <p className="text-sm text-slate-500">{dict.common.loading}</p>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.commerce.noCampaignsYet}</p>
        ) : (
          campaigns.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
                  {PROMO_KIND_LABELS[c.kind] ?? c.kind}
                </span>
                <span className="font-medium">{c.name}</span>
                <span className={`rounded px-2 py-0.5 text-xs ${c.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                  {c.active ? dict.commerce.active : dict.commerce.closed}
                </span>
                <span className="ml-auto flex gap-2">
                  <button type="button" className="rounded-md border px-3 py-1 text-sm" onClick={() => openDetail(c)}>
                    {detail?.id === c.id ? dict.commerce.close : dict.commerce.details}
                  </button>
                  <button type="button" disabled={busy === c.id} className="rounded-md border px-3 py-1 text-sm"
                    onClick={() => toggleActive(c)}>
                    {c.active ? dict.commerce.close : dict.commerce.enable}
                  </button>
                </span>
              </div>
              {c.stats && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
                  {c.kind === "group_buy" ? (
                    <>
                      <span>{dict.commerce.joined}{c.stats.joins ?? 0}</span>
                      <span>{dict.commerce.discountOn}{c.stats.unlocked ?? 0}</span>
                      <span>{dict.commerce.expired4}{c.stats.expired ?? 0}</span>
                    </>
                  ) : (
                    <>
                      <span>{dict.commerce.played}{c.stats.plays ?? 0}</span>
                      <span>{dict.commerce.won}{c.stats.wins ?? 0}</span>
                      <span>{dict.commerce.completed2}{c.stats.completions ?? 0}</span>
                    </>
                  )}
                  <span>{dict.commerce.couponsIssued}{c.stats.couponsIssued ?? 0}</span>
                  <span>{dict.commerce.couponsUsed}{c.stats.couponsRedeemed ?? 0}</span>
                </div>
              )}
              {detail?.id === c.id && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {c.kind === "group_buy" ? (
                    detail.joins.length === 0 ? (
                      <p className="text-sm text-slate-500">{dict.commerce.nobodyHasJoinedYet}</p>
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
                    <p className="text-sm text-slate-500">{dict.commerce.nobodyHasParticipatedYet}</p>
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
