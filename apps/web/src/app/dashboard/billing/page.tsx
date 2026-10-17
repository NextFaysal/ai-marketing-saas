"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { API_URL, apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";

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

function taka(minor: string): string {
  const v = Number(minor) / 100;
  return `৳${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Design v2 usage meter. The fill width is ALWAYS the real
 * usage/limit ratio from the billing payload (capped at 100% for
 * display); the tone turns amber at >=80% and red at >=100% so the
 * bar's colour is state, not decoration.
 */
function UsageMeter({ label, used, limit, detail }: { label: string; used: number; limit: number | null; detail?: string }) {
  const pct = limit !== null && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null;
  const tone = pct === null ? "" : pct >= 100 ? "meter-fill-danger" : pct >= 80 ? "meter-fill-warn" : "meter-fill-ok";
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-slate-700">{label}</div>
        <div className="text-sm text-slate-500">
          <b className="text-base text-slate-900">{used.toLocaleString("bn-BD")}</b>
          {limit === null ? " · সীমাহীন" : ` / ${limit.toLocaleString("bn-BD")}`}
          {pct !== null ? <span className="ml-1.5 text-xs text-slate-400">({pct}%)</span> : null}
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
  const pct = limit !== null && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null;
  const tone = pct === null ? "" : pct >= 100 ? "meter-fill-danger" : pct >= 80 ? "meter-fill-warn" : "meter-fill-ok";
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-slate-700">{label}</div>
        <div className="text-sm text-slate-500">
          <b className="text-base text-slate-900">{used.toLocaleString("bn-BD")}</b>
          {limit === null ? " · সীমা নেই" : ` / ${limit.toLocaleString("bn-BD")}`}
          {pct !== null ? <span className="ml-1.5 text-xs text-slate-400">({pct}%)</span> : null}
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
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      setData(await apiFetch<Billing>(`/organizations/${orgId}/billing`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "লোড করা যায়নি");
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
      ? "সাবস্ক্রিপশন Pause করলে নতুন পণ্য, অর্ডার ও মিডিয়া আপলোড বন্ধ হয়ে যাবে। নিশ্চিত তো?"
      : "সাবস্ক্রিপশন আবার চালু করবেন? পণ্য, অর্ডার ও আপলোড আবার চালু হয়ে যাবে।");
    if (!ok) return;
    setBusy(pause ? "pause" : "resume"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/billing/${pause ? "pause" : "resume"}`, { method: "POST", body: "{}" });
      setNotice(pause ? "⏸️ সাবস্ক্রিপশন Pause করা হয়েছে — Resume না করা পর্যন্ত নতুন পণ্য/অর্ডার/আপলোড বন্ধ থাকবে।" : "▶️ সাবস্ক্রিপশন আবার চালু হয়েছে।");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "করা যায়নি");
    } finally { setBusy(""); }
  }

  async function downloadInvoicePdf(paymentId: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const token = localStorage.getItem("accessToken");
    const res = await fetch(`${API_URL}/organizations/${orgId}/billing/payments/${paymentId}/invoice.pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { setError("Invoice PDF ডাউনলোড করা যায়নি"); return; }
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
      setNotice(`${tier} প্ল্যানের অনুরোধ পাঠানো হয়েছে। প্ল্যাটফর্ম টিম যাচাই করে Admin Console থেকে পরিবর্তন করে দেবে।`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "অনুরোধ পাঠানো যায়নি");
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
      setNotice(`📅 নির্ধারণ সম্পন্ন — ${new Date(out.effectiveAt).toLocaleDateString("bn-BD")} থেকে প্ল্যান হবে ${tier}। তার আগে বর্তমান প্ল্যানই চলবে।`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "নির্ধারণ করা যায়নি");
    } finally { setBusy(""); }
  }

  // Billing Package B4: bKash auto-renew consent + cancel.
  async function startAutoRenew() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const phone = (document.getElementById("pay-phone") as HTMLInputElement | null)?.value.trim() ?? "";
    if (!/^01\d{9}$/.test(phone.replace(/[\s-]/g, ""))) { setError("Auto-Renew এর জন্য উপরের মোবাইল নম্বর ঘরে সঠিক bKash নম্বর (01XXXXXXXXX) দিন।"); return; }
    setBusy("autorenew"); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ bkashURL: string }>(`/organizations/${orgId}/billing/auto-renew/start`, {
        method: "POST", body: JSON.stringify({ phone }),
      });
      if (!out.bkashURL) throw new Error("bKash URL পাওয়া যায়নি");
      setNotice("bKash এ পাঠানো হচ্ছে — সেখানে সম্মতি দিলেই Auto-Renew চালু হবে…");
      window.location.href = out.bkashURL;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auto-Renew শুরু করা যায়নি");
      setBusy("");
    }
  }

  async function cancelAutoRenew() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy("autorenew-cancel"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/billing/auto-renew/cancel`, { method: "POST", body: "{}" });
      setNotice("Auto-Renew বন্ধ করা হয়েছে — এরপর থেকে ম্যানুয়ালি নবায়ন করতে হবে।");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "বন্ধ করা যায়নি");
    } finally { setBusy(""); }
  }

  async function cancelSchedule() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy("sched-cancel"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/billing/schedule-change`, { method: "DELETE" });
      setNotice("নির্ধারিত প্ল্যান বদল বাতিল হয়েছে — বর্তমান প্ল্যানই চলতে থাকবে।");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "বাতিল করা যায়নি");
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
        const pro = out.prorationMinor && Number(out.prorationMinor) > 0 ? ` আগের প্ল্যানের অব্যবহৃত ${taka(out.prorationMinor)} প্রোরেশন হিসেবে ধরা হয়েছে।` : "";
        setNotice(`🎉 কুপন/ক্রেডিট দিয়েই পুরো মূল্য পরিশোধ হয়েছে — প্ল্যান সক্রিয় করা হয়েছে।${pro}`);
        setBusy("");
        await load();
        return;
      }
      if (!out.gatewayUrl) throw new Error("Gateway URL পাওয়া যায়নি");
      setNotice(out.sandbox ? "Sandbox Gateway এ পাঠানো হচ্ছে…" : "Payment Gateway এ পাঠানো হচ্ছে…");
      window.location.href = out.gatewayUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout শুরু করা যায়নি");
      setBusy("");
    }
  }

  async function previewCoupon() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const code = (document.getElementById("pay-coupon") as HTMLInputElement | null)?.value.trim() ?? "";
    const tier = (document.getElementById("pay-coupon-plan") as HTMLSelectElement | null)?.value ?? "";
    if (!code || !tier) { setError("কুপন কোড ও প্ল্যান বেছে নিন।"); return; }
    setError(""); setNotice("");
    try {
      const out = await apiFetch<{ discountMinor: string; creditAppliedMinor: string; dueMinor: string }>(`/organizations/${orgId}/billing/coupon-preview`, {
        method: "POST",
        body: JSON.stringify({ code, plan: tier }),
      });
      setNotice(`কুপন প্রযোজ্য: ছাড় ${taka(out.discountMinor)} · ক্রেডিট ${taka(out.creditAppliedMinor)} · দিতে হবে ${taka(out.dueMinor)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "কুপন যাচাই করা যায়নি");
    }
  }

  async function openInvoice(paymentId: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const token = localStorage.getItem("accessToken");
    const res = await fetch(`${API_URL}/organizations/${orgId}/billing/payments/${paymentId}/invoice`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { setError("Invoice খোলা যায়নি"); return; }
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  }

  if (error && !data) return <EmptyState title="বিলিং লোড করা যায়নি" description={error} />;
  if (!data) {
    return (
      <div className="space-y-4" aria-label="লোড হচ্ছে">
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
        <h1 className="page-title">সাবস্ক্রিপশন ও বিলিং</h1>
        <p className="page-sub mt-1">প্ল্যান, ব্যবহারের সীমা, অনলাইন পেমেন্ট ও পেমেন্ট ইতিহাস — সব এক জায়গায়।</p>
      </div>

      {error ? <div className="alert alert-red"><span>⚠️</span><span>{error}</span></div> : null}
      {notice ? <div className="alert alert-green"><span>✅</span><span>{notice}</span></div> : null}
      {gatewayReturn === "received" ? (
        <div className="alert alert-amber">
          <span>💳</span>
          <span>পেমেন্ট Gateway গ্রহণ করেছে। চূড়ান্ত যাচাই সম্পন্ন হলেই প্ল্যান সক্রিয় হবে — সাধারণত কয়েক সেকেন্ড লাগে। একটু পরে পেজটি রিফ্রেশ করে দেখুন; নিচের পেমেন্ট ইতিহাসে নতুন এন্ট্রি এলেই নিশ্চিত।</span>
        </div>
      ) : null}
      {gatewayReturn === "failed" ? <div className="alert alert-red"><span>❌</span><span>পেমেন্ট ব্যর্থ হয়েছে — কোনো টাকা কাটা হলে Gateway ফেরত প্রক্রিয়া করবে। আবার চেষ্টা করুন বা অনুরোধ পাঠান।</span></div> : null}
      {gatewayReturn === "cancelled" ? <div className="alert alert-slate"><span>ℹ️</span><span>পেমেন্ট বাতিল করা হয়েছে — প্ল্যান বদলায়নি।</span></div> : null}
      {autoRenewReturn === "active" ? <div className="alert alert-green"><span>✅</span><span>bKash Auto-Renew চালু হয়েছে — মেয়াদ শেষের আগে স্বয়ংক্রিয়ভাবে নবায়ন হবে।</span></div> : null}
      {autoRenewReturn === "failed" ? <div className="alert alert-red"><span>❌</span><span>Auto-Renew সম্মতি সম্পূর্ণ হয়নি — আবার চেষ্টা করুন। কোনো চার্জ হয়নি।</span></div> : null}

      {data.paused ? (
        <div className="alert alert-red">
          <span>⏸️</span>
          <span>সাবস্ক্রিপশন <strong>Paused</strong> আছে{sub?.pausedAt ? <> ({new Date(sub.pausedAt).toLocaleDateString("bn-BD")} থেকে)</> : null} — নতুন পণ্য, অর্ডার ও মিডিয়া আপলোড বন্ধ আছে।{myRole === "OWNER" ? " আবার চালু করতে নিচের Resume বোতাম চাপুন।" : ""}</span>
        </div>
      ) : null}
      {sub?.status === "PAST_DUE" && data.pastDueGraceEndsAt ? (
        <div className="alert alert-amber">
          <span>⏳</span>
          <span>পেমেন্ট বকেয়া আছে — গ্রেস পিরিয়ড চলছে, শেষ হবে <strong>{new Date(data.pastDueGraceEndsAt).toLocaleDateString("bn-BD")}</strong>। এর মধ্যে পরিশোধ না করলে নতুন পণ্য/অর্ডার/আপলোড বন্ধ হয়ে যাবে।</span>
        </div>
      ) : null}

      {/* Current plan hero */}
      <section className="hero-panel p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-white/80">বর্তমান প্ল্যান</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
              <span className="text-3xl font-bold tracking-tight sm:text-4xl">{sub ? sub.plan : "—"}</span>
              {sub ? <span className={statusBadge(sub.status)}>{sub.status}</span> : null}
            </div>
            <div className="mt-2 text-sm text-white/85">
              {sub ? <>মূল্য: <b>{taka(sub.priceMinor)}</b>/{sub.billingCycle === "yearly" ? "বছর" : "মাস"}</> : "কোনো সাবস্ক্রিপশন পাওয়া যায়নি"}
              {sub?.currentPeriodEnd ? <> · মেয়াদ শেষ: {new Date(sub.currentPeriodEnd).toLocaleDateString("bn-BD")}</> : null}
            </div>
          </div>
          {sub?.currentPeriodEnd && daysLeft !== null ? (
            <div className="rounded-2xl bg-white/10 px-4 py-3 text-center ring-1 ring-inset ring-white/20 backdrop-blur-sm">
              <div className="text-2xl font-bold leading-none">{daysLeft < 0 ? "০" : daysLeft.toLocaleString("bn-BD")}</div>
              <div className="mt-1 text-[11px] font-medium text-white/80">
                {daysLeft < 0 ? "দিন পেরিয়ে গেছে" : daysLeft === 0 ? "আজই মেয়াদ শেষ" : "দিন বাকি আছে"}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Usage meters — every number from the billing payload */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">ব্যবহার ও সীমা</h2>
          {/* ORG6: the standalone usage page — same numbers, watchable without the payment surfaces */}
          <Link href="/dashboard/settings/usage" className="text-sm font-semibold text-indigo-700 hover:underline">আলাদা ব্যবহারের পেজে দেখুন →</Link>
        </div>
        <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-3">
          <UsageMeter label="টিম সদস্য (সিট)" used={data.usage.seatsUsed} limit={data.limits.seats} />
          <UsageMeter label="আজকের AI ব্যবহার" used={data.usage.aiCallsToday} limit={data.limits.aiDaily} detail="প্রতিদিনের সীমা — রাত ১২টায় আবার শুরু হয়।" />
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-medium text-slate-700">ব্রডকাস্ট (৩০ দিন)</div>
              <div className="text-sm text-slate-500"><b className="text-base text-slate-900">{data.usage.broadcasts30d.toLocaleString("bn-BD")}</b>টি পাঠানো হয়েছে</div>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              ব্রডকাস্টের সীমা মাসিক কোটা নয় — প্রতি পাঠানোতে সর্বোচ্চ <b className="text-slate-600">{data.limits.broadcastCap.toLocaleString("bn-BD")} জন</b> করে পাঠানো যায়, তাই এখানে শতাংশের বার দেখানো হয় না।
            </p>
          </div>
        </div>
      </section>

      {/* GC22: plan resource usage + pause/resume */}
      {data.resourceUsage ? (
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="section-title">প্ল্যান রিসোর্স ব্যবহার</h2>
            {myRole === "OWNER" && sub ? (
              data.paused ? (
                <button className="btn-primary min-h-[40px]" disabled={busy === "resume"} onClick={() => setPaused(false)}>
                  {busy === "resume" ? "চালু হচ্ছে…" : "▶️ Resume করুন"}
                </button>
              ) : (
                <button className="btn-secondary min-h-[40px]" disabled={busy === "pause"} onClick={() => setPaused(true)}>
                  {busy === "pause" ? "Pause হচ্ছে…" : "⏸️ Pause করুন"}
                </button>
              )
            ) : null}
          </div>
          <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
            <ResourceMeter label="পণ্য" used={data.resourceUsage.products.used} limit={data.resourceUsage.products.limit} detail="Archive করা পণ্য সীমায় ধরা হয় না।" />
            <ResourceMeter label="এই মাসের অর্ডার" used={data.resourceUsage.ordersThisMonth.used} limit={data.resourceUsage.ordersThisMonth.limit} detail="প্রতি ক্যালেন্ডার মাসে (ঢাকা সময়) তৈরি অর্ডার।" />
            <ResourceMeter
              label="স্টোরেজ (MB)"
              used={Math.round((Number(data.resourceUsage.storage.usedBytes) / (1024 * 1024)) * 10) / 10}
              limit={data.resourceUsage.storage.limitMb}
              detail={`মিডিয়া লাইব্রেরিতে রেকর্ডকৃত আপলোড থেকে হিসাব — ${data.resourceUsage.storage.assetCount.toLocaleString("bn-BD")}টি ফাইল।`}
            />
            <ResourceMeter label="আজকের API ব্যবহার" used={data.resourceUsage.apiToday.used} limit={data.resourceUsage.apiToday.limit} detail="Public API (/v1) আজকের কল সংখ্যা।" />
          </div>
        </section>
      ) : null}

      {data.nextInvoice ? (
        <section className="card p-5">
          <h2 className="section-title flex items-center gap-2">
            <span className="stat-icon stat-icon-green !h-9 !w-9 !rounded-xl text-base">🔮</span>
            পরের বিল
          </h2>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
            <div><div className="text-slate-400">প্ল্যান</div><div className="mt-0.5 font-semibold text-slate-800">{data.nextInvoice.plan} · {data.nextInvoice.cycle === "yearly" ? "বার্ষিক" : "মাসিক"}</div></div>
            <div><div className="text-slate-400">তারিখ</div><div className="mt-0.5 font-semibold text-slate-800">{new Date(data.nextInvoice.dueDate).toLocaleDateString("bn-BD")}</div></div>
            <div><div className="text-slate-400">মোট / ক্রেডিট বাদ</div><div className="mt-0.5 font-semibold text-slate-800">{taka(data.nextInvoice.amountMinor)}{Number(data.nextInvoice.creditAppliedMinor) > 0 ? <> − {taka(data.nextInvoice.creditAppliedMinor)}</> : null}</div></div>
            <div><div className="text-slate-400">দিতে হবে</div><div className="mt-0.5 text-base font-bold text-slate-900">{taka(data.nextInvoice.dueMinor)}</div></div>
          </div>
          {data.nextInvoice.scheduledChange ? <p className="mt-2 text-xs text-amber-600">📅 নির্ধারিত প্ল্যান বদল ধরে হিসাব করা হয়েছে — পরের বিলটি {data.nextInvoice.plan} প্ল্যানের হবে।</p> : null}
          <p className="mt-2 text-xs text-slate-400">এটি একটি পূর্বাভাস — Checkout এর সময় কুপন/প্রোরেশন থাকলে চূড়ান্ত অঙ্ক বদলাতে পারে।</p>
        </section>
      ) : null}

      {data.creditMinor && data.creditMinor !== "0" ? (
        <div className="alert alert-green">
          <span>💰</span>
          <span>আপনার অ্যাকাউন্টে <strong>{taka(data.creditMinor)}</strong> ক্রেডিট জমা আছে — পরের অনলাইন পেমেন্টে স্বয়ংক্রিয়ভাবে বাদ যাবে।</span>
        </div>
      ) : null}

      <ReferralCard taka={taka} />

      {/* Plan catalogue + checkout */}
      <section className="card p-5 sm:p-6">
        <h2 className="section-title">প্ল্যান কিনুন / বদলান</h2>
        <p className="mt-1 text-sm text-slate-500">অনলাইন পেমেন্টে প্ল্যান সঙ্গে সঙ্গে সক্রিয় হয় — যাচাইকৃত পেমেন্ট ছাড়া কখনোই নয়। অথবা অনুরোধ পাঠালে প্ল্যাটফর্ম টিম ম্যানুয়ালি পেমেন্ট নিশ্চিত করে বদলে দেয়।</p>

        <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50/80 p-4 ring-1 ring-inset ring-slate-200/70 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-600">পেমেন্ট রসিদের মোবাইল নম্বর (অনলাইন পেমেন্টের জন্য)
              <input id="pay-phone" className="input mt-1 min-h-[44px]" placeholder="01XXXXXXXXX" defaultValue="" />
            </label>
            <label className="block text-sm text-slate-600">কুপন কোড (যদি থাকে)
              <input id="pay-coupon" className="input mt-1 min-h-[44px]" placeholder="যেমন: LAUNCH20" />
            </label>
            {data.gateways.bkash || data.gateways.stripe ? (
              <label className="block text-sm text-slate-600">Gateway
                <select id="pay-gateway" className="input mt-1 min-h-[44px]">
                  {data.gateways.sslcommerz ? <option value="sslcommerz">SSLCommerz (কার্ড/ব্যাংক)</option> : null}
                  {data.gateways.bkash ? <option value="bkash">bKash</option> : null}
                  {data.gateways.stripe ? <option value="stripe">Stripe (আন্তর্জাতিক কার্ড)</option> : null}
                </select>
              </label>
            ) : null}
            <label className="block text-sm text-slate-600">কুপন যাচাইয়ের প্ল্যান
              <select id="pay-coupon-plan" className="input mt-1 min-h-[44px]">
                {data.plans.filter((p) => Number(p.priceMinor) > 0).map((p) => <option key={p.tier} value={p.tier}>{p.tier}</option>)}
              </select>
            </label>
          </div>
          <button className="btn-secondary min-h-[44px] w-full lg:w-auto" onClick={previewCoupon}>কুপন যাচাই</button>
        </div>

        {!data.gateways.sslcommerz && !data.gateways.bkash && !data.gateways.stripe ? (
          <p className="alert alert-amber mt-3"><span>ℹ️</span><span>অনলাইন পেমেন্ট এখনো চালু হয়নি — "অনুরোধ পাঠান" ব্যবহার করুন, প্ল্যাটফর্ম টিম ম্যানুয়ালি নিশ্চিত করবে।</span></p>
        ) : null}
        <input id="plan-note" className="input mt-3 min-h-[44px]" placeholder="অনুরোধের নোট (ঐচ্ছিক) — যেমন: bKash এ পেমেন্ট করেছি, TrxID …" />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full bg-slate-100 p-1 ring-1 ring-inset ring-slate-200">
            <button className={`min-h-[40px] rounded-full px-4 text-sm font-medium ${cycle === "monthly" ? "bg-white shadow-sm ring-1 ring-slate-200" : "text-slate-500"}`} onClick={() => setCycle("monthly")}>মাসিক</button>
            <button className={`min-h-[40px] rounded-full px-4 text-sm font-medium ${cycle === "yearly" ? "bg-white shadow-sm ring-1 ring-slate-200" : "text-slate-500"}`} onClick={() => setCycle("yearly")}>বার্ষিক</button>
          </div>
          {cycle === "yearly" ? <span className="text-sm text-emerald-600">বার্ষিক দামে সাধারণত ২ মাস ফ্রি — প্রতিটি প্ল্যানে আসল সাশ্রয় কার্ডেই দেখানো হয়েছে।</span> : null}
        </div>

        {sub?.pendingPlan ? (
          <p className="alert alert-amber mt-4 flex flex-wrap items-center gap-2">
            <span>📅</span>
            <span className="flex-1">নির্ধারিত বদল: <strong>{sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString("bn-BD") : ""}</strong> থেকে প্ল্যান হবে <strong>{sub.pendingPlan}</strong>{sub.pendingPlan === "FREE" ? " (সাবস্ক্রিপশন বাতিল)" : ""}। তার আগে বর্তমান প্ল্যানই চলবে।</span>
            <button className="btn-secondary min-h-[40px]" disabled={busy === "sched-cancel"} onClick={cancelSchedule}>নির্ধারণ বাতিল করুন</button>
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
                  {current ? <span className="badge-brand">বর্তমান প্ল্যান</span> : null}
                </div>
                <div className="mt-2 text-[28px] font-bold leading-none tracking-tight text-slate-900">
                  {taka(cycle === "yearly" ? p.yearlyPriceMinor : p.priceMinor)}<span className="text-sm font-normal text-slate-500">/{cycle === "yearly" ? "বছর" : "মাস"}</span>
                </div>
                {cycle === "yearly" && Number(p.priceMinor) > 0 ? (
                  <p className="mt-1 text-xs text-emerald-600">মাসিক হিসেবে বছরে {taka(String(Number(p.priceMinor) * 12))} — সাশ্রয় {taka(String(Math.max(0, Number(p.priceMinor) * 12 - Number(p.yearlyPriceMinor))))}</p>
                ) : null}
                <ul className="mt-4 space-y-2 text-[13px] text-slate-600">
                  <li className="flex gap-2"><span className="text-emerald-500">✓</span>AI প্রতিদিন: {p.limits.aiDaily.toLocaleString("bn-BD")} বার</li>
                  <li className="flex gap-2"><span className="text-emerald-500">✓</span>ব্রডকাস্ট ক্যাপ: {p.limits.broadcastCap.toLocaleString("bn-BD")} জন/পাঠানো</li>
                  <li className="flex gap-2"><span className="text-emerald-500">✓</span>টিম সিট: {p.limits.seats.toLocaleString("bn-BD")}টি</li>
                </ul>
                <div className="mt-auto pt-5">
                  {current ? (
                    <button className="btn-secondary min-h-[44px] w-full" disabled>✓ এটি আপনার বর্তমান প্ল্যান</button>
                  ) : schedulable ? (
                    <div className="space-y-2">
                      <button className="btn-primary min-h-[44px] w-full" disabled={busy === `sched-${p.tier}`} onClick={() => scheduleChange(p.tier)}>
                        {busy === `sched-${p.tier}` ? "নির্ধারণ হচ্ছে…" : p.tier === "FREE" ? "📅 মেয়াদ শেষে বাতিল করুন" : "📅 মেয়াদ শেষে কার্যকর করুন"}
                      </button>
                      <p className="text-xs text-slate-500">এখনই বদলাবে না — বর্তমান মেয়াদের শেষ দিন থেকে কার্যকর হবে, যাতে পরিশোধিত দিন নষ্ট না হয়।</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {Number(p.priceMinor) > 0 && (data.gateways.sslcommerz || data.gateways.bkash || data.gateways.stripe) ? (
                        <button className="btn-primary min-h-[44px] w-full" disabled={busy === `buy-${p.tier}`} onClick={() => buyOnline(p.tier)}>
                          {busy === `buy-${p.tier}` ? "Gateway এ যাচ্ছে…" : "💳 অনলাইনে কিনুন"}
                        </button>
                      ) : null}
                      <button className="btn-secondary min-h-[44px] w-full" disabled={busy === p.tier} onClick={() => requestPlan(p.tier)}>
                        {busy === p.tier ? "পাঠানো হচ্ছে…" : "অনুরোধ পাঠান"}
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
            bKash Auto-Renew
          </h2>
          {data.autoRenew?.status === "active" ? (
            <div className="mt-3 space-y-3">
              <p className="alert alert-green"><span>✅</span><span>চালু আছে — নম্বর <strong>{data.autoRenew.payerReference}</strong>। মেয়াদ শেষের ২৪ ঘণ্টা আগে থেকে স্বয়ংক্রিয় চার্জের চেষ্টা হবে; ব্যর্থ হলে স্বাভাবিক Dunning প্রক্রিয়া চলবে।{data.autoRenew.lastChargeAt ? <> সর্বশেষ সফল চার্জ: {new Date(data.autoRenew.lastChargeAt).toLocaleDateString("bn-BD")}।</> : null}</span></p>
              {data.autoRenew.lastError ? <p className="text-sm text-red-500">সর্বশেষ ত্রুটি: {data.autoRenew.lastError}</p> : null}
              <button className="btn-secondary min-h-[44px]" disabled={busy === "autorenew-cancel"} onClick={cancelAutoRenew}>Auto-Renew বন্ধ করুন</button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-500">
                একবার bKash এ সম্মতি দিলে প্রতি {sub?.billingCycle === "yearly" ? "বছর" : "মাসে"} মেয়াদ শেষের আগে স্বয়ংক্রিয়ভাবে প্ল্যানের দাম কেটে নবায়ন হবে — ম্যানুয়ালি পেমেন্ট করার ঝামেলা থাকবে না।
                চার্জ কেবল bKash এর নিজের নিশ্চিতকরণেই সফল ধরা হয়। যেকোনো সময় এখান থেকেই বন্ধ করা যায়।
                {data.autoRenew?.status === "pending" ? " (আগের সম্মতি অসম্পূর্ণ আছে — আবার শুরু করলে নতুন করে যাবে।)" : ""}
              </p>
              <button className="btn-primary min-h-[44px]" disabled={busy === "autorenew"} onClick={startAutoRenew}>
                {busy === "autorenew" ? "bKash এ যাচ্ছে…" : "🔁 bKash দিয়ে Auto-Renew চালু করুন"}
              </button>
              <p className="text-xs text-slate-400">উপরের "পেমেন্ট রসিদের মোবাইল নম্বর" ঘরের নম্বরটিই bKash নম্বর হিসেবে ব্যবহৃত হবে।</p>
            </div>
          )}
        </section>
      ) : null}

      <BillingInfoCard />

      {/* Payment history — table on wide screens, cards under 720px */}
      <section>
        <h2 className="section-title mb-3 px-1">পেমেন্ট ইতিহাস</h2>
        {data.payments.length === 0 ? (
          <div className="card p-5">
            <p className="text-sm text-slate-500">এখনো কোনো পেমেন্ট রেকর্ড নেই। পেমেন্ট করলে প্ল্যাটফর্ম টিম এখানে এন্ট্রি করে দেয়।</p>
          </div>
        ) : (
          <>
            <div className="table-wrap hidden min-[720px]:block">
              <table>
                <thead>
                  <tr>
                    <th>তারিখ</th><th>পরিমাণ</th><th>মাধ্যম</th><th>রেফারেন্স</th><th>মেয়াদ শেষ</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap">{new Date(p.createdAt).toLocaleDateString("bn-BD")}</td>
                      <td className="whitespace-nowrap font-medium text-slate-800">{taka(p.amountMinor)}
                        {p.refundedMinor && p.refundedMinor !== "0" ? <div className="text-xs font-normal text-amber-600">ফেরত {taka(p.refundedMinor)}</div> : null}
                      </td>
                      <td><span className="badge-slate">{p.method}</span></td>
                      <td className="max-w-[220px] truncate" title={p.reference ?? undefined}>{p.reference ?? "—"}</td>
                      <td className="whitespace-nowrap">{p.periodEnd ? new Date(p.periodEnd).toLocaleDateString("bn-BD") : "—"}</td>
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
                      <div className="mt-0.5 text-xs text-slate-400">{new Date(p.createdAt).toLocaleDateString("bn-BD")}</div>
                    </div>
                    <span className="badge-slate">{p.method}</span>
                  </div>
                  {p.refundedMinor && p.refundedMinor !== "0" ? <div className="mt-1.5 text-xs text-amber-600">ফেরত {taka(p.refundedMinor)}</div> : null}
                  <dl className="mt-2.5 space-y-1 text-[13px] text-slate-600">
                    <div className="flex justify-between gap-3"><dt className="text-slate-400">রেফারেন্স</dt><dd className="min-w-0 truncate font-medium" title={p.reference ?? undefined}>{p.reference ?? "—"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-400">মেয়াদ শেষ</dt><dd className="font-medium">{p.periodEnd ? new Date(p.periodEnd).toLocaleDateString("bn-BD") : "—"}</dd></div>
                  </dl>
                  <div className="mt-3 flex gap-2">
                    <button className="btn-secondary min-h-[44px] flex-1" onClick={() => openInvoice(p.id)}>🧾 Invoice দেখুন</button>
                    <button className="btn-secondary min-h-[44px] flex-1" onClick={() => downloadInvoicePdf(p.id)}>📄 PDF ডাউনলোড</button>
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
        রেফারেল প্রোগ্রাম
      </h2>
      {ref.programEnabled ? (
        <p className="mt-2 text-sm text-slate-500">
          আপনার লিংক দিয়ে কেউ সাইন আপ করে প্রথম পেমেন্ট করলেই আপনি পাবেন <strong>{tk(ref.rewardMinor)}</strong> বিলিং ক্রেডিট।
          এখন পর্যন্ত: {ref.stats.signups} জন সাইন আপ · {ref.stats.rewarded} জন পেমেন্ট করেছেন · অর্জিত ক্রেডিট {tk(ref.stats.earnedMinor)}।
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-500">রেফারেল প্রোগ্রামটি আপাতত বন্ধ আছে — চালু হলে আপনার লিংক দিয়ে সাইন আপ করা বন্ধুর প্রথম পেমেন্টে আপনি ক্রেডিট পাবেন। আপনার লিংকটি এখনই সংরক্ষণ করে রাখতে পারেন।</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-h-[44px] flex-1 truncate rounded-xl bg-slate-100 px-3 py-3 text-sm ring-1 ring-inset ring-slate-200/70">{link}</code>
        <button
          className="btn-secondary min-h-[44px]"
          onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ } }}
        >{copied ? "✅ কপি হয়েছে" : "কপি করুন"}</button>
      </div>
      {ref.referrals.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
          {ref.referrals.slice(0, 5).map((r) => (
            <li key={r.id} className="flex justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200/60">
              <span className="min-w-0 truncate">{r.referredEmail ?? "—"}</span>
              <span className="shrink-0">{r.status === "rewarded" ? `✅ পুরস্কার ${tk(r.rewardMinor ?? 0)}` : "⏳ অপেক্ষায়"}</span>
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
      setMsg("✅ বিলিং তথ্য সেভ হয়েছে — এখন থেকে ইনভয়েস ও রিমাইন্ডার এই ঠিকানাগুলোতেও যাবে।");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "সেভ করা যায়নি");
    } finally { setBusyState(false); }
  }

  if (!loaded) return null;
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="section-title flex items-center gap-2">
        <span className="stat-icon stat-icon-sky !h-9 !w-9 !rounded-xl text-base">🧾</span>
        বিলিং তথ্য
      </h2>
      <p className="mt-1 text-sm text-slate-500">ইনভয়েস ও বিলিং রিমাইন্ডার কোন ইমেইলে যাবে (যেমন Accountant এর), আর ইনভয়েসে ছাপা হবে এমন ব্যবসার ঠিকানা ও BIN।</p>
      {msg ? <p className="alert alert-green mt-3"><span>{msg}</span></p> : null}
      {err ? <p className="alert alert-red mt-3"><span>{err}</span></p> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-slate-600 sm:col-span-2">বিলিং ইমেইল (সর্বোচ্চ ৩টি, কমা দিয়ে)
          <input className="input mt-1 min-h-[44px]" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="accounts@example.com, finance@example.com" />
        </label>
        <label className="block text-sm text-slate-600">বিলিং ঠিকানা (ইনভয়েসে ছাপা হবে)
          <input className="input mt-1 min-h-[44px]" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="বাড়ি/রোড, এলাকা, শহর" />
        </label>
        <label className="block text-sm text-slate-600">BIN / VAT নম্বর (যদি থাকে)
          <input className="input mt-1 min-h-[44px]" value={bin} onChange={(e) => setBin(e.target.value)} placeholder="যেমন: 000000000-0000" />
        </label>
      </div>
      <button className="btn-primary mt-4 min-h-[44px]" disabled={busy} onClick={save}>{busy ? "সেভ হচ্ছে…" : "বিলিং তথ্য সেভ করুন"}</button>
    </section>
  );
}
