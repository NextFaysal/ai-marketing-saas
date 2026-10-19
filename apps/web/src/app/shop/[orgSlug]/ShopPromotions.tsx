"use client";
import React, { useEffect, useRef, useState } from "react";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { fmtMoney, fmtNumber } from "@repo/contracts";
import { usePathname } from "next/navigation";
import { useOverlayGrant } from "@/lib/shop-overlay-queue";
import {
  fetchPublicPromotions, publicGroupBuyJoin, publicQuizComplete, publicSpinPlay,
  type PublicPromoCampaign,
} from "@/lib/gamified-promotions";

/**
 * NF6 (FB3) — storefront gamified promotions overlay.
 *
 * This EXTENDS the OU8 popup engine's surface rather than
 * building a second one: campaigns arrive with StorePopup's
 * exact placement vocabulary (trigger / delaySeconds /
 * scrollPercent / frequencyDays / showOn) and are presented
 * with the same trigger + frequency machinery ShopPopup uses
 * (delay timer / scroll listener / exit-intent, a per-campaign
 * frequency cookie, and a slot request to the ED9 overlay
 * queue so it never stacks over the shop popup).
 *
 * The shopper can NEVER influence an outcome here: the spin
 * result and any coupon come back from the server; this
 * component only sends a phone number (and quiz answers).
 */

function frequencyKey(campaignId: string) {
  return `qosprey_promo_${campaignId}`;
}

function hasFrequencyMarker(campaignId: string, frequencyDays: number): boolean {
  try {
    if (frequencyDays <= 0) {
      return sessionStorage.getItem(frequencyKey(campaignId)) != null;
    }
    const needle = `${frequencyKey(campaignId)}=`;
    return document.cookie.split(";").some((c) => c.trim().startsWith(needle));
  } catch {
    return false;
  }
}

function setFrequencyMarker(campaignId: string, frequencyDays: number) {
  try {
    const value = String(Date.now());
    if (frequencyDays <= 0) {
      sessionStorage.setItem(frequencyKey(campaignId), value);
    } else {
      const maxAge = Math.floor(frequencyDays * 24 * 60 * 60);
      document.cookie = `${frequencyKey(campaignId)}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`;
    }
  } catch {
    /* ignore */
  }
}

function moneyLabel(priceMinor: string, locale: ShopLocale = "bn"): string {
  const n = Number(priceMinor);
  if (!Number.isFinite(n)) return "";
  return fmtMoney(locale, n / 100);
}

export function ShopPromotions({ orgSlug, locale = "bn" }: { orgSlug: string; locale?: ShopLocale | string }) {
  const t = shopT(locale);
  const pathname = usePathname();
  const [campaign, setCampaign] = useState<PublicPromoCampaign | null>(null);
  const [wantsShow, setWantsShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const granted = useOverlayGrant("promo", wantsShow && !dismissed && campaign != null);
  const campaignRef = useRef<PublicPromoCampaign | null>(null);

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [spinResult, setSpinResult] = useState<{ outcome: string; segmentLabel: string | null; couponCode: string | null } | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [quizResult, setQuizResult] = useState<{
    couponCode: string | null;
    products: Array<{ id: string; name: string; slug: string | null; priceMinor: string; imageUrl: string | null }>;
  } | null>(null);
  const [gbState, setGbState] = useState<{ status: string; joinedCount: number; couponCode: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let onScroll: (() => void) | null = null;
    let onLeave: ((e: MouseEvent) => void) | null = null;

    void (async () => {
      let campaigns: PublicPromoCampaign[] = [];
      try {
        campaigns = await fetchPublicPromotions(orgSlug);
      } catch {
        return; // no promotions surface — never an error to the shopper
      }
      if (cancelled) return;
      const isHome = pathname === `/shop/${orgSlug}` || pathname === `/shop/${orgSlug}/`;
      const pick = campaigns.find((c) => {
        if (c.placement.showOn === "home" && !isHome) return false;
        return !hasFrequencyMarker(c.id, c.placement.frequencyDays);
      });
      if (!pick) return;
      campaignRef.current = pick;
      setCampaign(pick);
      setGbState(pick.kind === "group_buy"
        ? { status: pick.groupStatus ?? "open", joinedCount: pick.joinedCount ?? 0, couponCode: null }
        : null);

      const fire = () => {
        if (!cancelled) setWantsShow(true);
      };
      const p = pick.placement;
      if (p.trigger === "scroll_percent") {
        onScroll = () => {
          const max = document.documentElement.scrollHeight - window.innerHeight;
          const pct = max > 0 ? (window.scrollY / max) * 100 : 100;
          if (pct >= p.scrollPercent) fire();
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
      } else if (p.trigger === "exit_intent") {
        onLeave = (e: MouseEvent) => {
          if (e.clientY <= 0) fire();
        };
        document.documentElement.addEventListener("mouseleave", onLeave);
      } else {
        timer = setTimeout(fire, Math.max(0, p.delaySeconds) * 1000);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (onScroll) window.removeEventListener("scroll", onScroll);
      if (onLeave) document.documentElement.removeEventListener("mouseleave", onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgSlug, pathname]);

  if (!campaign || !granted) return null;

  const close = () => {
    setFrequencyMarker(campaign.id, campaign.placement.frequencyDays);
    setDismissed(true);
  };

  const wrap = (children: React.ReactNode) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold">{campaign.name}</h3>
          <button type="button" onClick={close} aria-label={t.promotions.close} className="text-xl leading-none">×</button>
        </div>
        {children}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );

  const phoneFields = (
    <div className="space-y-2">
      <input
        className="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-800"
        placeholder={t.promotions.namePlaceholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-800"
        placeholder={t.promotions.phonePlaceholder}
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <p className="text-xs text-slate-500">{t.promotions.oncePerNumber}</p>
    </div>
  );

  if (campaign.kind === "spin_wheel") {
    return wrap(
      spinResult ? (
        <div className="space-y-3 text-center">
          <p className="text-3xl">{spinResult.outcome === "won" ? "🎉" : "😔"}</p>
          <p className="font-semibold">{spinResult.segmentLabel}</p>
          {spinResult.couponCode ? (
            <p className="text-sm">
              {t.promotions.yourCouponPrefix}<span className="rounded bg-amber-100 px-2 py-1 font-mono font-bold">{spinResult.couponCode}</span>
              <br />{t.promotions.useAtCheckout}
            </p>
          ) : (
            <p className="text-sm text-slate-500">{t.promotions.noWin}</p>
          )}
          <button type="button" onClick={close} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
              {t.promotions.ok}
            </button>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="flex flex-wrap gap-2">
            {(campaign.segments ?? []).map((s, i) => (
              <li key={i} className="rounded-full bg-amber-50 px-3 py-1 text-sm dark:bg-slate-800">🎁 {s.label}</li>
            ))}
          </ul>
          {phoneFields}
          <button
            type="button"
            disabled={busy}
            className="w-full rounded-md bg-amber-500 px-4 py-2 font-semibold text-white disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const res = await publicSpinPlay(orgSlug, campaign.id, phone, name);
                setSpinResult(res.play);
                setFrequencyMarker(campaign.id, campaign.placement.frequencyDays);
              } catch (e) {
                setError(e instanceof Error ? e.message : t.promotions.tryAgain);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t.promotions.spinning : t.promotions.spin}
          </button>
        </div>
      ),
    );
  }

  if (campaign.kind === "quiz") {
    const questions = campaign.questions ?? [];
    return wrap(
      quizResult ? (
        <div className="space-y-3">
          <p className="font-semibold">{t.promotions.pickedForYou}</p>
          {quizResult.products.length === 0 ? (
            <p className="text-sm text-slate-500">{t.promotions.noMatch}</p>
          ) : (
            <ul className="space-y-2">
              {quizResult.products.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-sm">{moneyLabel(p.priceMinor, locale === "en" ? "en" : "bn")}</span>
                  {p.slug && (
                    <a className="text-sm font-semibold text-emerald-700" href={`/shop/${orgSlug}/products/${p.slug}`}>
              {t.promotions.view}
            </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {quizResult.couponCode && (
            <p className="text-sm">
              {t.promotions.quizCouponPrefix}<span className="rounded bg-amber-100 px-2 py-1 font-mono font-bold">{quizResult.couponCode}</span>
            </p>
          )}
          <button type="button" onClick={close} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
              {t.promotions.ok}
            </button>
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q, qi) => (
            <fieldset key={qi}>
              <legend className="mb-1 text-sm font-semibold">{q.text}</legend>
              <div className="space-y-1">
                {q.options.map((o, oi) => (
                  <label key={oi} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <input
                      type="radio"
                      name={`promo-q-${qi}`}
                      checked={answers[qi] === oi}
                      onChange={() => {
                        const next = [...answers];
                        next[qi] = oi;
                        setAnswers(next);
                      }}
                    />
                    {o.text}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {phoneFields}
          <button
            type="button"
            disabled={busy}
            className="w-full rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const res = await publicQuizComplete(orgSlug, campaign.id, phone, answers, name);
                setQuizResult({ couponCode: res.play.couponCode, products: res.products });
                setFrequencyMarker(campaign.id, campaign.placement.frequencyDays);
              } catch (e) {
                setError(e instanceof Error ? e.message : t.promotions.tryAgain);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t.promotions.sending : t.promotions.seeResult}
          </button>
        </div>
      ),
    );
  }

  // group_buy
  const gb = gbState ?? { status: campaign.groupStatus ?? "open", joinedCount: campaign.joinedCount ?? 0, couponCode: null };
  return wrap(
    <div className="space-y-3">
      {campaign.product && (
        <p className="text-sm">
          <span className="font-semibold">{campaign.product.name}</span> — {moneyLabel(campaign.product.priceMinor, locale === "en" ? "en" : "bn")}
        </p>
      )}
      <p className="text-sm">
        {t.promotions.discountLabel}<span className="font-semibold">{campaign.discountLabel}</span>{t.promotions.joinedMid}{" "}
        <span className="font-semibold">{fmtNumber(locale === "en" ? "en" : "bn", gb.joinedCount)}</span> / {campaign.requiredBuyers != null ? fmtNumber(locale === "en" ? "en" : "bn", campaign.requiredBuyers) : ""}{t.promotions.joinedSuffix}
      </p>
      <div className="h-2 w-full rounded bg-slate-200">
        <div
          className="h-2 rounded bg-emerald-500"
          style={{ width: `${Math.min(100, ((gb.joinedCount ?? 0) / Math.max(1, campaign.requiredBuyers ?? 1)) * 100)}%` }}
        />
      </div>
      <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-slate-800 dark:text-amber-200">
        {campaign.noPrepaymentNote}
      </p>
      {gb.status === "unlocked" && gb.couponCode ? (
        <p className="text-sm">
          {t.promotions.groupCompletePrefix}{" "}
          <span className="rounded bg-amber-100 px-2 py-1 font-mono font-bold">{gb.couponCode}</span>
          <br />{t.promotions.groupCompleteSuffix}
        </p>
      ) : gb.status === "expired_unmet" ? (
        <p className="text-sm text-slate-500">{t.promotions.groupFailed}</p>
      ) : (
        <>
          {phoneFields}
          <button
            type="button"
            disabled={busy}
            className="w-full rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const res = await publicGroupBuyJoin(orgSlug, campaign.id, phone, name);
                setGbState({
                  status: res.status,
                  joinedCount: res.joinedCount,
                  couponCode: res.join.couponCode,
                });
                if (res.join.alreadyJoined) {
                  setError(t.promotions.alreadyJoined);
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : t.promotions.tryAgain);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t.promotions.joining : t.promotions.joinGroupBuy}
          </button>
        </>
      )}
    </div>,
  );
}
