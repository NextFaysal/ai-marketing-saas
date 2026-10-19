"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { API_URL, apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import { fmtDate, fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

interface Billing {
  subscription: { plan: string; status: string; currentPeriodEnd: string | null; pendingPlan: string | null; billingCycle: string; priceMinor: string; currency: string; pausedAt?: string | null } | null;
  // GC22 (GB9): pause state + plan resource usage vs limits.
  paused?: boolean;
  pastDueGraceEndsAt?: string | null;
  resourceUsage?: {
    products: { used: number; limit: number | null };
    ordersThisMonth: { used: number; limit: number | null };
    storage: { usedBytes: string; assetCount: number; limitMb: number | null };
    apiToday: { used: number; limit: number | null };
  };
  creditMinor: string;
  gateways: { sslcommerz: boolean; bkash: boolean; stripe?: boolean };
  autoRenew: { status: string; payerReference: string; lastChargeAt: string | null; lastError: string | null } | null;
  nextInvoice: { plan: string; cycle: string; amountMinor: string; creditAppliedMinor: string; dueMinor: string; dueDate: string; scheduledChange: boolean } | null;
  limits: { aiDaily: number; broadcastCap: number; seats: number | null; plan: string };
  usage: { seatsUsed: number; aiCallsToday: number; broadcasts30d: number };
  plans: { tier: string; priceMinor: string; yearlyPriceMinor: string; currency: string; limits: { aiDaily: number; broadcastCap: number; seats: number } }[];
  payments: { id: string; amountMinor: string; refundedMinor: string; currency: string; method: string; reference: string | null; periodEnd: string | null; note: string | null; createdAt: string }[];
}

/** MB2 (ML6): money is formatted with the active locale inside the
 * components below (fmtMoneyMinor); see the `taka` binding in the page. */

/**
 * Design v2 usage meter. The fill width is ALWAYS the real
 * usage/limit ratio from the billing payload (capped at 100% for
 * display); the tone turns amber at >=80% and red at >=100% so the
 * bar's colour is state, not decoration.
 */
function UsageMeter({ label, used, limit, detail }: { label: string; used: number; limit: number | null; detail?: string }) {
  const { t, locale } = useLocale();
  const pct = limit !== null && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null;
  const tone = pct === null ? "" : pct >= 100 ? "meter-fill-danger" : pct >= 80 ? "meter-fill-warn" : "meter-fill-ok";
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-slate-700">{label}</div>
        <div className="text-sm text-slate-500">
          <b className="text-base text-slate-900">{fmtNumber(locale, used)}</b>
          {limit === null ? t("billing.meterUnlimited") : ` / ${fmtNumber(locale, limit)}`}
          {pct !== null ? <span className="ml-1.5 text-xs text-slate-400">({fmtNumber(locale, pct)}%)</span> : null}
        </div>
      </div>
      {pct !== null ? (
        <div className="meter mt-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {detail ? <p className="mt-1.5 text-xs text-slate-400">{detail}</p> : null}
    </div>
  );
}

/** GC22: one plan-resource metric — used vs limit, with
 * "সীমা নেই" when the plan carries no limit for it. */
function ResourceMeter({ label, used, limit, detail }: { label: string; used: number; limit: number | null; detail?: string }) {
  const { t, locale } = useLocale();
  const pct = limit !== null && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null;
  const tone = pct === null ? "" : pct >= 100 ? "meter-fill-danger" : pct >= 80 ? "meter-fill-warn" : "meter-fill-ok";
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-slate-700">{label}</div>
        <div className="text-sm text-slate-500">
          <b className="text-base text-slate-900">{fmtNumber(locale, used)}</b>
          {limit === null ? t("billing.meterNoLimit") : ` / ${fmtNumber(locale, limit)}`}
          {pct !== null ? <span className="ml-1.5 text-xs text-slate-400">({fmtNumber(locale, pct)}%)</span> : null}
        </div>
      </div>
      {pct !== null ? (
        <div className="meter mt-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {detail ? <p className="mt-1.5 text-xs text-slate-400">{detail}</p> : null}
    </div>
  );
}

function statusBadge(status: string): string {
  if (status === "ACTIVE") return "badge-green";
  if (status === "PAST_DUE") return "badge-red";
  if (status === "TRIALING") return "badge-amber";
  return "badge-slate";
}

export default function BillingPage() {
  const { t, locale } = useLocale();
  const taka = (minor: string): string => {
    try { return fmtMoneyMinor(locale, BigInt(minor || "0")); } catch { return minor; }
  };
  const [data, setData] = useState<Billing | null>(null);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [gatewayReturn, setGatewayReturn] = useState("");
  const [autoRenewReturn, setAutoRenewReturn] = useState("");
  const [myRole, setMyRole] = useState("");

  useEffect(() => {
    try { const q = new URLSearchParams(window.location.search); setGatewayReturn(q.get("payment") ?? ""); setAutoRenewReturn(q.get("autorenew") ?? ""); } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError(t("billing.noOrg")); return; }
    try {
      setData(await apiFetch<Billing>(`/organizations/${orgId}/billing`));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("billing.loadError"));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // GC22: pause/resume is OWNER-only — the buttons render only
  // for the owner (the API enforces the same rule server-side).
  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    apiFetch<{ id: string; myRole: string }[]>(`/organizations`)
      .then((orgs) => {
        const mine = (orgs ?? []).find((o) => o.id === orgId);
        if (mine) setMyRole(mine.myRole);
      })
      .catch(() => undefined);
  }, []);

  async function setPaused(pause: boolean) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const ok = window.confirm(pause
      ? t("billing.pauseConfirm")
      : t("billing.resumeConfirm"));
    if (!ok) return;
    setBusy(pause ? "pause" : "resume"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/billing/${pause ? "pause" : "resume"}`, { method: "POST", body: "{}" });
      setNotice(pause ? t("billing.pausedNotice") : t("billing.resumedNotice"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("billing.failed"));
    } finally { setBusy(""); }
  }

  async function downloadInvoicePdf(paymentId: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const token = localStorage.getItem("accessToken");
    const res = await fetch(`${API_URL}/organizations/${orgId}/billing/payments/${paymentId}/invoice.pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { setError(t("billing.invoicePdfError")); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `invoice-${paymentId}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function requestPlan(tier: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const noteEl = document.getElementById("plan-note") as HTMLInputElement | null;
    setBusy(tier); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/billing/plan-request`, {
        method: "POST",
        body: JSON.stringify({ requestedPlan: tier, note: noteEl?.value || undefined }),
      });
      setNotice(t("billing.planRequested", { tier }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("billing.requestError"));
    } finally { setBusy(""); }
  }

  // Billing Package B2: downgrades/cancellation are scheduled
  // for the period end so no paid day is lost.
  const TIER_ORDER = ["FREE", "STARTER", "GROWTH", "AGENCY"];
  async function scheduleChange(tier: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(`sched-${tier}`); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ effectiveAt: string }>(`/organizations/${orgId}/billing/schedule-change`, {
        method: "POST", body: JSON.stringify({ plan: tier }),
      });
      setNotice(t("billing.scheduled", { date: fmtDate(locale, new Date(out.effectiveAt)), tier }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("billing.scheduleError"));
    } finally { setBusy(""); }
  }

  // Billing Package B4: bKash auto-renew consent + cancel.
  async function startAutoRenew() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const phone = (document.getElementById("pay-phone") as HTMLInputElement | null)?.value.trim() ?? "";
    if (!/^01\d{9}$/.test(phone.replace(/[\s-]/g, ""))) { setError(t("billing.phoneError")); return; }
    setBusy("autorenew"); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ bkashURL: string }>(`/organizations/${orgId}/billing/auto-renew/start`, {
        method: "POST", body: JSON.stringify({ phone }),
      });
      if (!out.bkashURL) throw new Error(t("billing.noBkashUrl"));
      setNotice(t("billing.redirectingBkash"));
      window.location.href = out.bkashURL;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("billing.autoRenewStartError"));
      setBusy("");
    }
  }

  async function cancelAutoRenew() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy("autorenew-cancel"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/billing/auto-renew/cancel`, { method: "POST", body: "{}" });
      setNotice(t("billing.autoRenewCancelled"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("billing.cancelError"));
    } finally { setBusy(""); }
  }

  async function cancelSchedule() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy("sched-cancel"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/billing/schedule-change`, { method: "DELETE" });
      setNotice(t("billing.scheduleCancelled"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("billing.cancelScheduleError"));
    } finally { setBusy(""); }
  }

  async function buyOnline(tier: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const phone = (document.getElementById("pay-phone") as HTMLInputElement | null)?.value.trim() ?? "";
    const couponCode = (document.getElementById("pay-coupon") as HTMLInputElement | null)?.value.trim() ?? "";
    const gateway = (document.getElementById("pay-gateway") as HTMLSelectElement | null)?.value ?? "sslcommerz";
    setBusy(`buy-${tier}`); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ gatewayUrl?: string; sandbox?: boolean; viaCredit?: boolean; prorationMinor?: string }>(`/organizations/${orgId}/billing/checkout`, {
        method: "POST",
        body: JSON.stringify({ plan: tier, phone, couponCode: couponCode || undefined, gateway, cycle }),
      });
      if (out.viaCredit) {
        const pro = out.prorationMinor && Number(out.prorationMinor) > 0 ? t("billing.prorationNote", { amount: taka(out.prorationMinor) }) : "";
        setNotice(t("billing.paidViaCredit", { pro }));
        setBusy("");
        await load();
        return;
      }
      if (!out.gatewayUrl) throw new Error(t("billing.noGatewayUrl"));
      setNotice(out.sandbox ? t("billing.redirectingSandbox") : t("billing.redirectingGateway"));
      window.location.href = out.gatewayUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("billing.checkoutError"));
      setBusy("");
    }
  }

  async function previewCoupon() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const code = (document.getElementById("pay-coupon") as HTMLInputElement | null)?.value.trim() ?? "";
    const tier = (document.getElementById("pay-coupon-plan") as HTMLSelectElement | null)?.value ?? "";
    if (!code || !tier) { setError(t("billing.couponPickError")); return; }
    setError(""); setNotice("");
    try {
      const out = await apiFetch<{ discountMinor: string; creditAppliedMinor: string; dueMinor: string }>(`/organizations/${orgId}/billing/coupon-preview`, {
        method: "POST",
        body: JSON.stringify({ code, plan: tier }),
      });
      setNotice(t("billing.couponApplied", { discount: taka(out.discountMinor), credit: taka(out.creditAppliedMinor), due: taka(out.dueMinor) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("billing.couponError"));
    }
  }

  async function openInvoice(paymentId: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const token = localStorage.getItem("accessToken");
    const res = await fetch(`${API_URL}/organizations/${orgId}/billing/payments/${paymentId}/invoice`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { setError(t("billing.invoiceOpenError")); return; }
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  }

  if (error && !data) return <EmptyState title={t("billing.loadFailedTitle")} description={error} />;
  if (!data) {
    return (
      <div className="space-y-4" aria-label={t("billing.loadingAria")}>
        <div className="skeleton h-9 w-64" />
        <div className="skeleton h-36 w-full !rounded-3xl" />
        <div className="skeleton h-28 w-full" />
      </div>
    );
  }

  const sub = data.subscription;
  const daysLeft = sub?.currentPeriodEnd
    ? Math.ceil((new Date(sub.currentPeriodEnd).getTime() - Date.now()) / 86400000)
    : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">{t("billing.title")}</h1>
        <p className="page-sub mt-1">{t("billing.subtitle")}</p>
      </div>

      {error ? <div className="alert alert-red"><span>⚠️</span><span>{error}</span></div> : null}
      {notice ? <div className="alert alert-green"><span>✅</span><span>{notice}</span></div> : null}
      {gatewayReturn === "received" ? (
        <div className="alert alert-amber">
          <span>💳</span>
          <span>{t("billing.gatewayReceived")}</span>
        </div>
      ) : null}
      {gatewayReturn === "failed" ? <div className="alert alert-red"><span>❌</span><span>{t("billing.gatewayFailed")}</span></div> : null}
      {gatewayReturn === "cancelled" ? <div className="alert alert-slate"><span>ℹ️</span><span>{t("billing.gatewayCancelled")}</span></div> : null}
      {autoRenewReturn === "active" ? <div className="alert alert-green"><span>✅</span><span>{t("billing.autoRenewActive")}</span></div> : null}
      {autoRenewReturn === "failed" ? <div className="alert alert-red"><span>❌</span><span>{t("billing.autoRenewFailed")}</span></div> : null}

      {data.paused ? (
        <div className="alert alert-red">
          <span>⏸️</span>
          <span>{t("billing.pausedAlert", { from: sub?.pausedAt ? t("billing.pausedFrom", { date: fmtDate(locale, new Date(sub.pausedAt)) }) : "" })}{myRole === "OWNER" ? t("billing.pausedResumeHint") : ""}</span>
        </div>
      ) : null}
      {sub?.status === "PAST_DUE" && data.pastDueGraceEndsAt ? (
        <div className="alert alert-amber">
          <span>⏳</span>
          <span>{t("billing.pastDueAlert", { date: fmtDate(locale, new Date(data.pastDueGraceEndsAt)) })}</span>
        </div>
      ) : null}

      {/* Current plan hero */}
      <section className="hero-panel p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-white/80">{t("billing.currentPlan")}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
              <span className="text-3xl font-bold tracking-tight sm:text-4xl">{sub ? sub.plan : "—"}</span>
              {sub ? <span className={statusBadge(sub.status)}>{sub.status}</span> : null}
            </div>
            <div className="mt-2 text-sm text-white/85">
              {sub ? <>{t("billing.priceLabel", { amount: taka(sub.priceMinor), cycle: sub.billingCycle === "yearly" ? t("billing.perYear") : t("billing.perMonth") })}</> : t("billing.noSubscription")}
              {sub?.currentPeriodEnd ? <>{t("billing.periodEnd", { date: fmtDate(locale, new Date(sub.currentPeriodEnd)) })}</> : null}
            </div>
          </div>
          {sub?.currentPeriodEnd && daysLeft !== null ? (
            <div className="rounded-2xl bg-white/10 px-4 py-3 text-center ring-1 ring-inset ring-white/20 backdrop-blur-sm">
              <div className="text-2xl font-bold leading-none">{fmtNumber(locale, Math.max(0, daysLeft))}</div>
              <div className="mt-1 text-[11px] font-medium text-white/80">
                {daysLeft < 0 ? t("billing.daysOverdue") : daysLeft === 0 ? t("billing.expiresToday") : t("billing.daysLeft")}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Usage meters — every number from the billing payload */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">{t("billing.usageTitle")}</h2>
          {/* ORG6: the standalone usage page — same numbers, watchable without the payment surfaces */}
          <Link href="/dashboard/settings/usage" className="text-sm font-semibold text-indigo-700 hover:underline">{t("billing.usagePageLink")}</Link>
        </div>
        <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-3">
          <UsageMeter label={t("billing.seatsLabel")} used={data.usage.seatsUsed} limit={data.limits.seats} />
          <UsageMeter label={t("billing.aiTodayLabel")} used={data.usage.aiCallsToday} limit={data.limits.aiDaily} detail={t("billing.aiTodayDetail")} />
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-medium text-slate-700">{t("billing.broadcastLabel")}</div>
              <div className="text-sm text-slate-500">{t("billing.broadcastSent", { count: fmtNumber(locale, data.usage.broadcasts30d) })}</div>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {t("billing.broadcastNote", { cap: t("billing.broadcastCapPeople", { count: fmtNumber(locale, data.limits.broadcastCap) }) })}
            </p>
          </div>
        </div>
      </section>

      {/* GC22: plan resource usage + pause/resume */}
      {data.resourceUsage ? (
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="section-title">{t("billing.resourcesTitle")}</h2>
            {myRole === "OWNER" && sub ? (
              data.paused ? (
                <button className="btn-primary min-h-[40px]" disabled={busy === "resume"} onClick={() => setPaused(false)}>
                  {busy === "resume" ? t("billing.resuming") : t("billing.resume")}
                </button>
              ) : (
                <button className="btn-secondary min-h-[40px]" disabled={busy === "pause"} onClick={() => setPaused(true)}>
                  {busy === "pause" ? t("billing.pausing") : t("billing.pause")}
                </button>
              )
            ) : null}
          </div>
          <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
            <ResourceMeter label={t("billing.productsLabel")} used={data.resourceUsage.products.used} limit={data.resourceUsage.products.limit} detail={t("billing.productsDetail")} />
            <ResourceMeter label={t("billing.ordersMonthLabel")} used={data.resourceUsage.ordersThisMonth.used} limit={data.resourceUsage.ordersThisMonth.limit} detail={t("billing.ordersMonthDetail")} />
            <ResourceMeter
              label={t("billing.storageLabel")}
              used={Math.round((Number(data.resourceUsage.storage.usedBytes) / (1024 * 1024)) * 10) / 10}
              limit={data.resourceUsage.storage.limitMb}
              detail={t("billing.storageDetail", { count: fmtNumber(locale, data.resourceUsage.storage.assetCount) })}
            />
            <ResourceMeter label={t("billing.apiTodayLabel")} used={data.resourceUsage.apiToday.used} limit={data.resourceUsage.apiToday.limit} detail={t("billing.apiTodayDetail")} />
          </div>
        </section>
      ) : null}

      {data.nextInvoice ? (
        <section className="card p-5">
          <h2 className="section-title flex items-center gap-2">
            <span className="stat-icon stat-icon-green !h-9 !w-9 !rounded-xl text-base">🔮</span>
            {t("billing.nextBillTitle")}
          </h2>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
            <div><div className="text-slate-400">{t("billing.planLabel")}</div><div className="mt-0.5 font-semibold text-slate-800">{data.nextInvoice.plan} · {data.nextInvoice.cycle === "yearly" ? t("billing.yearlyWord") : t("billing.monthlyWord")}</div></div>
            <div><div className="text-slate-400">{t("billing.dateLabel")}</div><div className="mt-0.5 font-semibold text-slate-800">{fmtDate(locale, new Date(data.nextInvoice.dueDate))}</div></div>
            <div><div className="text-slate-400">{t("billing.totalCreditLabel")}</div><div className="mt-0.5 font-semibold text-slate-800">{taka(data.nextInvoice.amountMinor)}{Number(data.nextInvoice.creditAppliedMinor) > 0 ? <> − {taka(data.nextInvoice.creditAppliedMinor)}</> : null}</div></div>
            <div><div className="text-slate-400">{t("billing.dueLabel")}</div><div className="mt-0.5 text-base font-bold text-slate-900">{taka(data.nextInvoice.dueMinor)}</div></div>
          </div>
          {data.nextInvoice.scheduledChange ? <p className="mt-2 text-xs text-amber-600">{t("billing.nextBillScheduled", { plan: data.nextInvoice.plan })}</p> : null}
          <p className="mt-2 text-xs text-slate-400">{t("billing.nextBillNote")}</p>
        </section>
      ) : null}

      {data.creditMinor && data.creditMinor !== "0" ? (
        <div className="alert alert-green">
          <span>💰</span>
          <span>{t("billing.creditAlert", { amount: taka(data.creditMinor) })}</span>
        </div>
      ) : null}

      <ReferralCard taka={taka} />

      {/* Plan catalogue + checkout */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title">{t("billing.plansTitle")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("billing.plansIntro")}</p>

        <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50/80 p-4 ring-1 ring-inset ring-slate-200/70 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-600">{t("billing.phoneLabel")}
              <input id="pay-phone" className="input mt-1 min-h-[44px]" placeholder="01XXXXXXXXX" defaultValue="" />
            </label>
            <label className="block text-sm text-slate-600">{t("billing.couponLabel")}
              <input id="pay-coupon" className="input mt-1 min-h-[44px]" placeholder={t("billing.couponPlaceholder")} />
            </label>
            {data.gateways.bkash || data.gateways.stripe ? (
              <label className="block text-sm text-slate-600">Gateway
                <select id="pay-gateway" className="input mt-1 min-h-[44px]">
                  {data.gateways.sslcommerz ? <option value="sslcommerz">{t("billing.gatewaySsl")}</option> : null}
                  {data.gateways.bkash ? <option value="bkash">bKash</option> : null}
                  {data.gateways.stripe ? <option value="stripe">{t("billing.gatewayStripe")}</option> : null}
                </select>
              </label>
            ) : null}
            <label className="block text-sm text-slate-600">{t("billing.couponPlanLabel")}
              <select id="pay-coupon-plan" className="input mt-1 min-h-[44px]">
                {data.plans.filter((p) => Number(p.priceMinor) > 0).map((p) => <option key={p.tier} value={p.tier}>{p.tier}</option>)}
              </select>
            </label>
          </div>
          <button className="btn-secondary min-h-[44px] w-full lg:w-auto" onClick={previewCoupon}>{t("billing.previewCoupon")}</button>
        </div>

        {!data.gateways.sslcommerz && !data.gateways.bkash && !data.gateways.stripe ? (
          <p className="alert alert-amber mt-3"><span>ℹ️</span><span>{t("billing.gatewaysOff")}</span></p>
        ) : null}
        <input id="plan-note" className="input mt-3 min-h-[44px]" placeholder={t("billing.notePlaceholder")} />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full bg-slate-100 p-1 ring-1 ring-inset ring-slate-200">
            <button className={`min-h-[40px] rounded-full px-4 text-sm font-medium ${cycle === "monthly" ? "bg-white shadow-sm ring-1 ring-slate-200" : "text-slate-500"}`} onClick={() => setCycle("monthly")}>{t("billing.monthlyWord")}</button>
            <button className={`min-h-[40px] rounded-full px-4 text-sm font-medium ${cycle === "yearly" ? "bg-white shadow-sm ring-1 ring-slate-200" : "text-slate-500"}`} onClick={() => setCycle("yearly")}>{t("billing.yearlyWord")}</button>
          </div>
          {cycle === "yearly" ? <span className="text-sm text-emerald-600">{t("billing.yearlySavingNote")}</span> : null}
        </div>

        {sub?.pendingPlan ? (
          <p className="alert alert-amber mt-4 flex flex-wrap items-center gap-2">
            <span>📅</span>
            <span className="flex-1">{t("billing.pendingChange", { date: sub.currentPeriodEnd ? fmtDate(locale, new Date(sub.currentPeriodEnd)) : "", plan: sub.pendingPlan, cancelSuffix: sub.pendingPlan === "FREE" ? t("billing.pendingCancelSuffix") : "" })}</span>
            <button className="btn-secondary min-h-[40px]" disabled={busy === "sched-cancel"} onClick={cancelSchedule}>{t("billing.cancelSchedule")}</button>
          </p>
        ) : null}

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.plans.map((p) => {
            const current = sub?.plan === p.tier;
            const schedulable = !!sub && !current && sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() > Date.now()
              && TIER_ORDER.indexOf(p.tier) < TIER_ORDER.indexOf(sub.plan);
            return (
              <div key={p.tier} className={`plan-card ${current ? "plan-card-current" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-slate-900">{p.tier}</div>
                  {current ? <span className="badge-brand">{t("billing.currentPlanBadge")}</span> : null}
                </div>
                <div className="mt-2 text-[28px] font-bold leading-none tracking-tight text-slate-900">
                  {taka(cycle === "yearly" ? p.yearlyPriceMinor : p.priceMinor)}<span className="text-sm font-normal text-slate-500">/{cycle === "yearly" ? t("billing.perYear") : t("billing.perMonth")}</span>
                </div>
                {cycle === "yearly" && Number(p.priceMinor) > 0 ? (
                  <p className="mt-1 text-xs text-emerald-600">{t("billing.yearlySaving", { total: taka(String(Number(p.priceMinor) * 12)), saving: taka(String(Math.max(0, Number(p.priceMinor) * 12 - Number(p.yearlyPriceMinor)))) })}</p>
                ) : null}
                <ul className="mt-4 space-y-2 text-[13px] text-slate-600">
                  <li className="flex gap-2"><span className="text-emerald-500">✓</span>{t("billing.planAiDaily", { count: fmtNumber(locale, p.limits.aiDaily) })}</li>
                  <li className="flex gap-2"><span className="text-emerald-500">✓</span>{t("billing.planBroadcastCap", { count: fmtNumber(locale, p.limits.broadcastCap) })}</li>
                  <li className="flex gap-2"><span className="text-emerald-500">✓</span>{t("billing.planSeats", { count: fmtNumber(locale, p.limits.seats) })}</li>
                </ul>
                <div className="mt-auto pt-5">
                  {current ? (
                    <button className="btn-secondary min-h-[44px] w-full" disabled>{t("billing.currentPlanButton")}</button>
                  ) : schedulable ? (
                    <div className="space-y-2">
                      <button className="btn-primary min-h-[44px] w-full" disabled={busy === `sched-${p.tier}`} onClick={() => scheduleChange(p.tier)}>
                        {busy === `sched-${p.tier}` ? t("billing.scheduling") : p.tier === "FREE" ? t("billing.cancelAtPeriodEnd") : t("billing.applyAtPeriodEnd")}
                      </button>
                      <p className="text-xs text-slate-500">{t("billing.scheduleNote")}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {Number(p.priceMinor) > 0 && (data.gateways.sslcommerz || data.gateways.bkash || data.gateways.stripe) ? (
                        <button className="btn-primary min-h-[44px] w-full" disabled={busy === `buy-${p.tier}`} onClick={() => buyOnline(p.tier)}>
                          {busy === `buy-${p.tier}` ? t("billing.goingGateway") : t("billing.buyOnline")}
                        </button>
                      ) : null}
                      <button className="btn-secondary min-h-[44px] w-full" disabled={busy === p.tier} onClick={() => requestPlan(p.tier)}>
                        {busy === p.tier ? t("billing.sending") : t("billing.sendRequest")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {data.gateways.bkash ? (
        <section className="card p-5 sm:p-6">
          <h2 className="section-title flex items-center gap-2">
            <span className="stat-icon stat-icon-brand !h-9 !w-9 !rounded-xl text-base">🔁</span>
            {t("billing.autoRenewTitle")}
          </h2>
          {data.autoRenew?.status === "active" ? (
            <div className="mt-3 space-y-3">
              <p className="alert alert-green"><span>✅</span><span>{t("billing.autoRenewActiveText", { phone: data.autoRenew.payerReference })}{data.autoRenew.lastChargeAt ? t("billing.autoRenewLastCharge", { date: fmtDate(locale, new Date(data.autoRenew.lastChargeAt)) }) : null}</span></p>
              {data.autoRenew.lastError ? <p className="text-sm text-red-500">{t("billing.autoRenewLastError", { error: data.autoRenew.lastError })}</p> : null}
              <button className="btn-secondary min-h-[44px]" disabled={busy === "autorenew-cancel"} onClick={cancelAutoRenew}>{t("billing.autoRenewCancel")}</button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-500">
                {t("billing.autoRenewIntro", { cycle: sub?.billingCycle === "yearly" ? t("billing.cycleEachYear") : t("billing.cycleEachMonth") })}
                {data.autoRenew?.status === "pending" ? t("billing.autoRenewPendingNote") : ""}
              </p>
              <button className="btn-primary min-h-[44px]" disabled={busy === "autorenew"} onClick={startAutoRenew}>
                {busy === "autorenew" ? t("billing.autoRenewGoing") : t("billing.autoRenewStart")}
              </button>
              <p className="text-xs text-slate-400">{t("billing.autoRenewPhoneNote")}</p>
            </div>
          )}
        </section>
      ) : null}

      <BillingInfoCard />

      {/* Payment history — table on wide screens, cards under 720px */}
      <section>
        <h2 className="section-title mb-3 px-1">{t("billing.historyTitle")}</h2>
        {data.payments.length === 0 ? (
          <div className="card p-5">
            <p className="text-sm text-slate-500">{t("billing.historyEmpty")}</p>
          </div>
        ) : (
          <>
            <div className="table-wrap hidden min-[720px]:block">
              <table>
                <thead>
                  <tr>
                    <th>{t("billing.thDate")}</th><th>{t("billing.thAmount")}</th><th>{t("billing.thMethod")}</th><th>{t("billing.thReference")}</th><th>{t("billing.thPeriodEnd")}</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap">{fmtDate(locale, new Date(p.createdAt))}</td>
                      <td className="whitespace-nowrap font-medium text-slate-800">{taka(p.amountMinor)}
                        {p.refundedMinor && p.refundedMinor !== "0" ? <div className="text-xs font-normal text-amber-600">{t("billing.refunded", { amount: taka(p.refundedMinor) })}</div> : null}
                      </td>
                      <td><span className="badge-slate">{p.method}</span></td>
                      <td className="max-w-[220px] truncate" title={p.reference ?? undefined}>{p.reference ?? "—"}</td>
                      <td className="whitespace-nowrap">{p.periodEnd ? fmtDate(locale, new Date(p.periodEnd)) : "—"}</td>
                      <td className="text-right"><span className="inline-flex gap-1.5"><button className="btn-secondary btn-sm min-h-[40px]" onClick={() => openInvoice(p.id)}>🧾 Invoice</button><button className="btn-secondary btn-sm min-h-[40px]" onClick={() => downloadInvoicePdf(p.id)}>📄 PDF</button></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 min-[720px]:hidden">
              {data.payments.map((p) => (
                <div key={p.id} className="pay-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-bold text-slate-900">{taka(p.amountMinor)}</div>
                      <div className="mt-0.5 text-xs text-slate-400">{fmtDate(locale, new Date(p.createdAt))}</div>
                    </div>
                    <span className="badge-slate">{p.method}</span>
                  </div>
                  {p.refundedMinor && p.refundedMinor !== "0" ? <div className="mt-1.5 text-xs text-amber-600">{t("billing.refunded", { amount: taka(p.refundedMinor) })}</div> : null}
                  <dl className="mt-2.5 space-y-1 text-[13px] text-slate-600">
                    <div className="flex justify-between gap-3"><dt className="text-slate-400">{t("billing.thReference")}</dt><dd className="min-w-0 truncate font-medium" title={p.reference ?? undefined}>{p.reference ?? "—"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-400">{t("billing.thPeriodEnd")}</dt><dd className="font-medium">{p.periodEnd ? fmtDate(locale, new Date(p.periodEnd)) : "—"}</dd></div>
                  </dl>
                  <div className="mt-3 flex gap-2">
                    <button className="btn-secondary min-h-[44px] flex-1" onClick={() => openInvoice(p.id)}>{t("billing.viewInvoice")}</button>
                    <button className="btn-secondary min-h-[44px] flex-1" onClick={() => downloadInvoicePdf(p.id)}>{t("billing.downloadPdf")}</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** Milestone 41: referral program card (code, link, stats). */
function ReferralCard({ taka }: { taka: (minor: string) => string }) {
  const { t, locale } = useLocale();
  const tk = (minor: number) => taka(String(minor));
  const [ref, setRef] = useState<{
    code: string; programEnabled: boolean; rewardMinor: number;
    stats: { signups: number; rewarded: number; earnedMinor: number };
    referrals: { id: string; status: string; referredEmail: string | null; createdAt: string; rewardMinor: number | null }[];
  } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    apiFetch<typeof ref>("/auth/referral").then(setRef).catch(() => setRef(null));
  }, []);
  if (!ref) return null;
  const link = typeof window !== "undefined" ? `${window.location.origin}/register?ref=${ref.code}` : `/register?ref=${ref.code}`;
  return (
    <div className="card p-5">
      <h2 className="section-title flex items-center gap-2">
        <span className="stat-icon stat-icon-amber !h-9 !w-9 !rounded-xl text-base">🎁</span>
        {t("billing.referralTitle")}
      </h2>
      {ref.programEnabled ? (
        <p className="mt-2 text-sm text-slate-500">
          {t("billing.referralEnabled", { reward: tk(ref.rewardMinor), signups: fmtNumber(locale, ref.stats.signups), rewarded: fmtNumber(locale, ref.stats.rewarded), earned: tk(ref.stats.earnedMinor) })}
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-500">{t("billing.referralDisabled")}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-h-[44px] flex-1 truncate rounded-xl bg-slate-100 px-3 py-3 text-sm ring-1 ring-inset ring-slate-200/70">{link}</code>
        <button
          className="btn-secondary min-h-[44px]"
          onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ } }}
        >{copied ? t("billing.copied") : t("billing.copy")}</button>
      </div>
      {ref.referrals.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
          {ref.referrals.slice(0, 5).map((r) => (
            <li key={r.id} className="flex justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200/60">
              <span className="min-w-0 truncate">{r.referredEmail ?? "—"}</span>
              <span className="shrink-0">{r.status === "rewarded" ? t("billing.referralRewarded", { amount: tk(r.rewardMinor ?? 0) }) : t("billing.referralPending")}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Billing Package B5: billing contacts — who receives
 * invoices + reminders, and the buyer block on invoices.
 * Stored on the Business Profile (Command Center data). */
function BillingInfoCard() {
  const { t } = useLocale();
  const [emails, setEmails] = useState("");
  const [address, setAddress] = useState("");
  const [bin, setBin] = useState("");
  const [busy, setBusyState] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    apiFetch<{ billingEmails?: string[] | null; billingAddress?: string | null; billingBin?: string | null }>(`/organizations/${orgId}/business-profile`)
      .then((p) => {
        setEmails(Array.isArray(p.billingEmails) ? p.billingEmails.join(", ") : "");
        setAddress(p.billingAddress ?? "");
        setBin(p.billingBin ?? "");
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusyState(true); setMsg(""); setErr("");
    try {
      const list = emails.split(",").map((e) => e.trim()).filter(Boolean);
      await apiFetch(`/organizations/${orgId}/business-profile`, {
        method: "PATCH",
        body: JSON.stringify({ billingEmails: list, billingAddress: address.trim() || null, billingBin: bin.trim() || null }),
      });
      setMsg(t("billing.infoSaved"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("billing.infoSaveError"));
    } finally { setBusyState(false); }
  }

  if (!loaded) return null;
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title flex items-center gap-2">
        <span className="stat-icon stat-icon-sky !h-9 !w-9 !rounded-xl text-base">🧾</span>
        {t("billing.infoTitle")}
      </h2>
      <p className="mt-1 text-sm text-slate-500">{t("billing.infoIntro")}</p>
      {msg ? <p className="alert alert-green mt-3"><span>{msg}</span></p> : null}
      {err ? <p className="alert alert-red mt-3"><span>{err}</span></p> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-slate-600 sm:col-span-2">{t("billing.emailsLabel")}
          <input className="input mt-1 min-h-[44px]" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="accounts@example.com, finance@example.com" />
        </label>
        <label className="block text-sm text-slate-600">{t("billing.addressLabel")}
          <input className="input mt-1 min-h-[44px]" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("billing.addressPlaceholder")} />
        </label>
        <label className="block text-sm text-slate-600">{t("billing.binLabel")}
          <input className="input mt-1 min-h-[44px]" value={bin} onChange={(e) => setBin(e.target.value)} placeholder={t("billing.binPlaceholder")} />
        </label>
      </div>
      <button className="btn-primary mt-4 min-h-[44px]" disabled={busy} onClick={save}>{busy ? t("billing.saving") : t("billing.saveInfo")}</button>
    </section>
  );
}
