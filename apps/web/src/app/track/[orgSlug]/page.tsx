"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatMinor } from "@repo/contracts";
import { API_URL } from "@/lib/api";
import { MediaImage } from "@/components/media-image";
import { COURIER_STEP_LABELS, courierStatusView } from "@/lib/courier-status";
import { shopLocaleOf, shopT, type ShopDict, type ShopLocale } from "@/lib/shop-i18n";

// EC18 — branded public order-tracking page. Branding + locale +
// the on/off switch come from the public shop home payload; the
// lookup itself is POST /public/shop/:orgSlug/track { phone,
// orderNumber }. The API answers every failure with ONE constant
// safe Bengali message (404) — shown verbatim, never paraphrased.
// Nothing here invents a status step: the order timeline comes
// from the API's `steps`, and the courier block reuses the shared
// lib/courier-status mapping (unknown statuses stay verbatim).

interface ShopHomePublic {
  settings: {
    shopName: string;
    locale?: string;
    trackingPageEnabled?: boolean;
  };
  organization: {
    name: string;
    slug: string;
    brandName: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
  };
}

interface TrackResult {
  orderNumber: string;
  placedAt: string;
  status: string;
  currency: string;
  items: { id?: string; name: string; quantity: number; totalMinor: string }[];
  // EC28: the customer's own return/exchange requests for this order.
  returnRequests?: {
    id: string;
    source: string;
    requestType: string | null;
    status: string;
    reason: string | null;
    items: { orderItemId: string; quantity: number }[] | null;
    createdAt: string | null;
  }[];
  totalMinor: string;
  advancePaidMinor: string;
  codDueMinor: string;
  deliverySlot: { label: string; startTime: string; endTime: string; date: string } | null;
  // EC30: delivery method + pickup point (pickup orders only; the
  // track payload's point carries name/address/district/phone, no fee).
  deliveryMethod?: string;
  pickupPoint?: { name: string; address: string; district: string; phone: string | null } | null;
  // EC31: installment summary (active plans only, else null).
  installmentSummary?: {
    totalInstallments: number;
    paidInstallments: number;
    nextDueDate: string | null;
    nextDueAmountMinor: string | null;
    remainingMinor: string;
  } | null;
  steps: { key: "placed" | "confirmed" | "packed" | "shipped" | "delivered"; reached: boolean }[];
  // EC24b: digital items summary — names + availability, never URLs.
  digitalItems?: { name: string; available: boolean }[];
  digitalNote?: string | null;
  // AB2 (AX3): gift-card items summary — names + issuance ONLY.
  // This payload NEVER carries a code; codes come exclusively
  // from the digital-access reveal response below.
  giftCardItems?: { name: string; issued: boolean }[];
  giftCardNote?: string | null;
  fulfillment: { status: string } | null;
  shipment: { provider: string; trackingCode: string | null; trackingUrl?: string | null; status: string; bookedAt: string } | null;
  shop: {
    name: string;
    logoUrl: string | null;
    primaryColor: string | null;
    supportPhone: string | null;
    returnPolicyText: string | null;
    deliveryPromiseText: string | null;
  };
}

function money(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

function stepLabel(t: ShopDict, key: string): string {
  switch (key) {
    case "placed": return t.track.stepPlaced;
    case "confirmed": return t.track.stepConfirmed;
    case "packed": return t.track.stepPacked;
    case "shipped": return t.track.stepShipped;
    case "delivered": return t.track.stepDelivered;
    default: return key;
  }
}

const TERMINAL_STATUSES = new Set(["cancelled", "canceled", "refunded", "returned"]);

export default function TrackOrderPage() {
  const params = useParams();
  const orgSlug = String(params.orgSlug ?? "");

  const [home, setHome] = useState<ShopHomePublic | null>(null);
  const [homeState, setHomeState] = useState<"loading" | "ready" | "disabled">("loading");
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<TrackResult | null>(null);
  // EC28: self-service return/exchange form state.
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnType, setReturnType] = useState<"return" | "exchange">("return");
  const [returnReason, setReturnReason] = useState("");
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState("");
  const [returnDone, setReturnDone] = useState(false);
  // EC24b: revealed download links (fetched only on button click).
  // AB5 (AX9): links are now signed downloadPaths (no raw URL),
  // and the same reveal carries assigned license keys + shortages.
  const [digitalLinks, setDigitalLinks] = useState<{ productName: string; itemId: string; downloadPath: string; expiresAt: string }[] | null>(null);
  const [revealedLicenseKeys, setRevealedLicenseKeys] = useState<{ itemId: string; productName: string; keys: { key: string; keyLast4: string }[] }[] | null>(null);
  const [licenseShortages, setLicenseShortages] = useState<{ productName: string; needed: number; assigned: number }[] | null>(null);
  const [lkCopied, setLkCopied] = useState("");
  const [digitalBusy, setDigitalBusy] = useState(false);
  const [digitalError, setDigitalError] = useState("");
  // AB2: gift cards revealed by the SAME digital-access call —
  // the only response that ever carries a full code.
  const [revealedGiftCards, setRevealedGiftCards] = useState<{
    code: string; codeLast4: string; initialAmountMinor: string; balanceMinor: string; status: string; expiresAt: string | null;
  }[] | null>(null);
  const [gcCopied, setGcCopied] = useState("");

  // NDR Delivery Recovery Bot state
  const [ndrOpen, setNdrOpen] = useState(false);
  const [ndrAction, setNdrAction] = useState<"reschedule" | "alt_phone" | "update_address" | "instruction">("reschedule");
  const [ndrRescheduleDate, setNdrRescheduleDate] = useState("");
  const [ndrAltPhone, setNdrAltPhone] = useState("");
  const [ndrAddress, setNdrAddress] = useState("");
  const [ndrInstruction, setNdrInstruction] = useState("");
  const [ndrBusy, setNdrBusy] = useState(false);
  const [ndrError, setNdrError] = useState("");
  const [ndrSuccess, setNdrSuccess] = useState("");

  async function submitNdr(e: React.FormEvent) {
    e.preventDefault();
    if (!result) return;
    setNdrBusy(true);
    setNdrError("");
    setNdrSuccess("");
    try {
      const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/track/ndr-recovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          orderNumber: orderNumber.trim(),
          action: ndrAction,
          rescheduleDate: ndrAction === "reschedule" ? ndrRescheduleDate : undefined,
          altPhone: ndrAction === "alt_phone" ? ndrAltPhone.trim() : undefined,
          updatedAddress: ndrAction === "update_address" ? ndrAddress.trim() : undefined,
          instruction: ndrAction === "instruction" ? ndrInstruction.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "ডেলিভারি নির্দেশনা সংরক্ষণ করা যায়নি");
      setNdrSuccess(data.message || "আপনার নির্দেশনা সফলভাবে গ্রহণ করা হয়েছে!");
      setNdrOpen(false);
    } catch (err) {
      setNdrError(err instanceof Error ? err.message : String(err));
    } finally {
      setNdrBusy(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}`);
        if (!res.ok) throw new Error("shop unavailable");
        const json = (await res.json()) as ShopHomePublic;
        if (json?.settings?.trackingPageEnabled === false) {
          setHomeState("disabled");
          return;
        }
        setHome(json);
        setHomeState("ready");
      } catch {
        // No shop payload => no branding promises; tracking is off here.
        setHomeState("disabled");
      }
    })();
  }, [orgSlug]);

  const locale: ShopLocale = shopLocaleOf(home?.settings?.locale);
  const t = shopT(locale);
  const shopName = result?.shop?.name ?? home?.settings?.shopName ?? home?.organization?.brandName ?? home?.organization?.name ?? "";
  const logoUrl = result?.shop?.logoUrl ?? home?.organization?.logoUrl ?? null;
  const accent = result?.shop?.primaryColor ?? home?.organization?.primaryColor ?? "#4f46e5";

  async function revealDigital() {
    setDigitalBusy(true);
    setDigitalError("");
    try {
      const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/track/digital-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), orderNumber: orderNumber.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? "লিংক পাওয়া যায়নি");
      }
      const json = (await res.json()) as {
        links: { productName: string; itemId: string; downloadPath: string; expiresAt: string }[];
        licenseKeys?: { itemId: string; productName: string; keys: { key: string; keyLast4: string }[] }[];
        licenseShortages?: { productName: string; needed: number; assigned: number }[];
        giftCards?: { code: string; codeLast4: string; initialAmountMinor: string; balanceMinor: string; status: string; expiresAt: string | null }[];
      };
      setDigitalLinks(json.links ?? []);
      setRevealedLicenseKeys(json.licenseKeys ?? []);
      setLicenseShortages(json.licenseShortages ?? []);
      setRevealedGiftCards(json.giftCards ?? []);
    } catch (err) {
      setDigitalError(err instanceof Error ? err.message : "লিংক পাওয়া যায়নি");
    } finally {
      setDigitalBusy(false);
    }
  }

  async function copyGiftCardCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setGcCopied(code);
      setTimeout(() => setGcCopied(""), 2000);
    } catch { /* clipboard unavailable — the code stays visible to copy manually */ }
  }

  async function copyLicenseKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setLkCopied(key);
      setTimeout(() => setLkCopied(""), 2000);
    } catch { /* clipboard unavailable — the key stays visible to copy manually */ }
  }

  async function submitReturn(e: React.FormEvent) {
    e.preventDefault();
    if (!result) return;
    setReturnBusy(true);
    setReturnError("");
    try {
      const items = result.items
        .filter((i) => i.id && (returnQty[i.id] ?? 0) > 0)
        .map((i) => ({ orderItemId: i.id as string, quantity: Math.min(returnQty[i.id as string], i.quantity) }));
      const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/track/returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          orderNumber: orderNumber.trim(),
          type: returnType,
          reason: returnReason.trim(),
          items: items.length > 0 ? items : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { message?: string }).message ?? t.track.returnAction);
      const created = body as NonNullable<TrackResult["returnRequests"]>[number];
      setResult({
        ...result,
        returnRequests: [
          { ...created, items: created.items ?? null },
          ...(result.returnRequests ?? []),
        ],
      });
      setReturnDone(true);
      setReturnOpen(false);
    } catch (err) {
      // API errors verbatim (undelivered / qty / duplicate are honest 400s).
      setReturnError(err instanceof Error ? err.message : String(err));
    } finally {
      setReturnBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    setDigitalLinks(null);
    setRevealedLicenseKeys(null);
    setLicenseShortages(null);
    setRevealedGiftCards(null);
    setDigitalError("");
    setReturnOpen(false);
    setReturnDone(false);
    setReturnError("");
    setReturnQty({});
    try {
      const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), orderNumber: orderNumber.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // The API's constant safe message, verbatim.
        throw new Error((body as { message?: string }).message ?? t.track.notFoundFallback);
      }
      setResult((await res.json()) as TrackResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.track.notFoundFallback);
    } finally {
      setBusy(false);
    }
  }

  if (homeState === "loading") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        <p className="mt-3 text-sm font-semibold text-slate-600">{shopT("bn").common.loading}</p>
      </main>
    );
  }

  if (homeState === "disabled") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-4xl">📦</p>
          <p className="mt-3 text-base font-bold text-slate-800">ট্র্যাকিং সুবিধা বন্ধ আছে</p>
        </div>
      </main>
    );
  }

  const courierView = result?.shipment ? courierStatusView(result.shipment.status) : null;
  const terminal = result ? TERMINAL_STATUSES.has(result.status.trim().toLowerCase()) : false;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          {logoUrl ? (
            <MediaImage src={logoUrl} alt={shopName} width={88} height={88} className="h-11 w-11 rounded-2xl border border-slate-200 object-cover" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-lg font-black text-white" style={{ backgroundColor: accent }}>
              {shopName.slice(0, 1) || "📦"}
            </span>
          )}
          <div>
            <p className="text-base font-black text-slate-900">{shopName}</p>
            <p className="text-xs font-semibold" style={{ color: accent }}>📦 {t.track.title}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
        <form onSubmit={submit} className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="track-order-number">{t.track.orderNumberLabel}</label>
            <input
              id="track-order-number"
              required
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder={t.track.orderNumberPlaceholder}
              className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700" htmlFor="track-phone">{t.track.phoneLabel}</label>
            <input
              id="track-phone"
              required
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t.track.phonePlaceholder}
              className="w-full rounded-xl border border-slate-300 p-2.5 font-mono text-sm font-bold focus:border-indigo-600 focus:outline-none"
            />
          </div>
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl py-3.5 text-sm font-extrabold text-white shadow-lg transition disabled:opacity-50"
            style={{ backgroundColor: accent }}
          >
            {busy ? t.track.searching : `🔍 ${t.track.searchButton}`}
          </button>
        </form>

        {result ? (
          <div className="space-y-5">
            {terminal ? (
              <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                {t.track.terminalBannerPrefix} {result.status}
              </p>
            ) : null}

            <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-black text-slate-900">{result.orderNumber}</h2>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                  {t.track.statusLabel}: {result.status}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {t.track.placedAt}: {new Date(result.placedAt).toLocaleString(locale === "en" ? "en-GB" : "bn-BD")}
              </p>

              {/* Timeline from the API's steps — reached = filled. */}
              <div className="flex items-start gap-1 pt-2">
                {result.steps.map((step) => (
                  <div key={step.key} className="flex flex-1 flex-col items-center gap-1.5">
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black ${step.reached ? "text-white" : "bg-slate-100 text-slate-400"}`}
                      style={step.reached ? { backgroundColor: accent } : undefined}
                    >
                      {step.reached ? "✓" : "·"}
                    </div>
                    <span className={`text-center text-[11px] leading-tight ${step.reached ? "font-bold text-slate-800" : "text-slate-400"}`}>
                      {stepLabel(t, step.key)}
                    </span>
                  </div>
                ))}
              </div>

              {result.deliverySlot ? (
                <p className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">
                  🕐 {t.track.deliverySlot}: {result.deliverySlot.label} ({result.deliverySlot.startTime} – {result.deliverySlot.endTime}) · {result.deliverySlot.date}
                </p>
              ) : null}
              {result.deliveryMethod === "pickup" && result.pickupPoint ? (
                <p className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">
                  {t.track.pickupHeading}: {result.pickupPoint.name} — {result.pickupPoint.address}, {result.pickupPoint.district}
                </p>
              ) : null}
              {result.fulfillment ? (
                <p className="text-xs text-slate-500">{t.track.shipmentTitle}: {result.fulfillment.status}</p>
              ) : null}
            </section>

            <section className="space-y-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900">{t.track.items}</h3>
              <ul className="space-y-1.5 text-sm">
                {result.items.map((item, i) => (
                  <li key={`${item.name}-${i}`} className="flex justify-between gap-2">
                    <span className="text-slate-700">{item.name} × {item.quantity}</span>
                    <span className="shrink-0 font-semibold text-slate-900">{money(item.totalMinor)}</span>
                  </li>
                ))}
              </ul>
              <div className="space-y-1 border-t pt-2 text-sm">
                <div className="flex justify-between font-black text-slate-900"><span>{t.track.total}:</span><span>{money(result.totalMinor)}</span></div>
                {(() => { try { return BigInt(result.advancePaidMinor) > 0n; } catch { return false; } })() ? (
                  <div className="flex justify-between text-emerald-700"><span>{t.track.advancePaid}:</span><span className="font-semibold">{money(result.advancePaidMinor)}</span></div>
                ) : null}
                <div className="flex justify-between font-bold text-slate-700"><span>{t.track.codDue}:</span><span>{money(result.codDueMinor)}</span></div>
              </div>
            </section>

            {result.installmentSummary ? (
              <section className="space-y-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900">{t.track.installmentHeading}</h3>
                <p className="text-sm text-slate-700">
                  {result.installmentSummary.paidInstallments} / {result.installmentSummary.totalInstallments} {t.track.installmentProgress}
                </p>
                {result.installmentSummary.nextDueDate ? (
                  <p className="text-sm text-slate-700">
                    {t.track.installmentNextDue}: {result.installmentSummary.nextDueDate}
                    {result.installmentSummary.nextDueAmountMinor ? <> — <span className="font-semibold">{money(result.installmentSummary.nextDueAmountMinor)}</span></> : null}
                  </p>
                ) : null}
                <p className="text-sm font-bold text-slate-700">
                  {t.track.installmentRemaining}: {money(result.installmentSummary.remainingMinor)}
                </p>
              </section>
            ) : null}

            {/* EC28: own return/exchange requests + self-service form
                (delivered orders only — the API enforces it too). */}
            {(() => {
              const delivered = result.steps.some((s) => s.key === "delivered" && s.reached);
              const requests = result.returnRequests ?? [];
              if (!delivered && requests.length === 0) return null;
              return (
                <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-900">{t.track.returnRequestsTitle}</h3>
                  {returnDone ? (
                    <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{t.track.returnSubmitted}</p>
                  ) : null}
                  {requests.length > 0 ? (
                    <ul className="space-y-2">
                      {requests.map((r) => (
                        <li key={r.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                          <span className="font-bold text-slate-800">
                            {r.requestType === "exchange" ? t.track.returnTypeExchange : r.requestType === "return" ? t.track.returnTypeReturn : t.track.returnAction}
                          </span>{" "}
                          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600">{r.status}</span>
                          {r.reason ? <span className="block text-xs text-slate-500">{r.reason}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {delivered && !returnOpen ? (
                    <button
                      type="button"
                      onClick={() => {
                        const initial: Record<string, number> = {};
                        for (const i of result.items) if (i.id) initial[i.id] = i.quantity;
                        setReturnQty(initial);
                        setReturnOpen(true);
                      }}
                      className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-700"
                    >
                      {t.track.returnAction}
                    </button>
                  ) : null}
                  {delivered && returnOpen ? (
                    <form onSubmit={submitReturn} className="space-y-3">
                      <div className="flex gap-2">
                        {(["return", "exchange"] as const).map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => setReturnType(kind)}
                            className={`rounded-full px-4 py-1.5 text-xs font-bold ${returnType === kind ? "text-white" : "bg-white text-slate-700 border border-slate-200"}`}
                            style={returnType === kind ? { backgroundColor: accent } : undefined}
                          >
                            {kind === "return" ? t.track.returnTypeReturn : t.track.returnTypeExchange}
                          </button>
                        ))}
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs font-bold text-slate-600">{t.track.returnSelectItems}</p>
                        {result.items.map((i) =>
                          i.id ? (
                            <label key={i.id} className="flex items-center justify-between gap-2 text-sm">
                              <span className="text-slate-700">{i.name}</span>
                              <input
                                type="number"
                                min={0}
                                max={i.quantity}
                                value={returnQty[i.id] ?? 0}
                                onChange={(e) => setReturnQty({ ...returnQty, [i.id as string]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                                className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                              />
                            </label>
                          ) : null,
                        )}
                      </div>
                      <textarea
                        value={returnReason}
                        onChange={(e) => setReturnReason(e.target.value)}
                        placeholder={t.track.returnReasonPlaceholder}
                        required
                        minLength={3}
                        maxLength={1000}
                        rows={2}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none"
                      />
                      {returnError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{returnError}</p> : null}
                      <button
                        type="submit"
                        disabled={returnBusy}
                        className="rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                        style={{ backgroundColor: accent }}
                      >
                        {returnBusy ? t.track.returnSubmitting : t.track.returnSubmit}
                      </button>
                    </form>
                  ) : null}
                </section>
              );
            })()}

            {(result.digitalItems ?? []).length > 0 ? (
              <section className="space-y-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900">💾 ডিজিটাল পণ্য</h3>
                <ul className="space-y-1 text-sm text-slate-700">
                  {(result.digitalItems ?? []).map((d, i) => (
                    <li key={`${d.name}-${i}`}>{d.name}</li>
                  ))}
                </ul>
                {result.digitalNote ? <p className="text-xs font-semibold text-slate-600">{result.digitalNote}</p> : null}
                {(result.digitalItems ?? []).some((d) => d.available) ? (
                  <button
                    type="button"
                    onClick={revealDigital}
                    disabled={digitalBusy}
                    className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    {digitalBusy ? "অপেক্ষা করুন…" : "লিংক দেখুন"}
                  </button>
                ) : null}
                {digitalError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{digitalError}</p> : null}
                {digitalLinks ? (
                  <ul className="space-y-1.5">
                    {digitalLinks.map((l, i) => (
                      <li key={`${l.productName}-${i}`} className="text-sm">
                        {l.productName}:{" "}
                        <a href={`${API_URL}/${l.downloadPath}`} target="_blank" rel="noreferrer" className="font-semibold text-sky-700 underline">
                          ডাউনলোড
                        </a>
                        {l.expiresAt ? (
                          <span className="block text-xs text-slate-400">এই লিংকের মেয়াদ: {new Date(l.expiresAt).toLocaleString(locale === "en" ? "en-GB" : "bn-BD")} পর্যন্ত</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {/* AB5 (AX9): license keys revealed by the same
                digital-access call (full key — this surface only)
                + an honest shortage notice when the pool ran dry. */}
            {revealedLicenseKeys && revealedLicenseKeys.some((e) => e.keys.length > 0) ? (
              <section className="space-y-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900">🔑 লাইসেন্স কী</h3>
                <p className="text-xs font-semibold text-amber-700">আপনার লাইসেন্স কীগুলো শুধুমাত্র এখানেই দেখানো হয় — নিরাপদে সংরক্ষণ করে রাখুন।</p>
                {revealedLicenseKeys.filter((e) => e.keys.length > 0).map((entry) => (
                  <div key={entry.itemId} className="space-y-1.5">
                    <p className="text-sm font-semibold text-slate-800">{entry.productName}</p>
                    {entry.keys.map((k) => (
                      <div key={k.key} className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm font-bold tracking-wide text-slate-900">{k.key}</code>
                        <button
                          type="button"
                          onClick={() => copyLicenseKey(k.key)}
                          className="shrink-0 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700"
                        >
                          {lkCopied === k.key ? "কপি হয়েছে ✅" : "কপি করুন"}
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            ) : null}
            {licenseShortages && licenseShortages.length > 0 ? (
              <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
                <p className="text-sm font-semibold text-amber-800">কিছু লাইসেন্স কী এখনো দেওয়া যায়নি — বিক্রেতার সঙ্গে যোগাযোগ করুন।</p>
                <ul className="mt-1 space-y-0.5 text-xs text-amber-700">
                  {licenseShortages.map((s, i) => (
                    <li key={`${s.productName}-${i}`}>{s.productName}: প্রয়োজন {s.needed}টি, দেওয়া হয়েছে {s.assigned}টি</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* AB2 (AX3): gift-card summary (names + issuance from
                the track payload — never a code) + the reveal,
                which rides the EC24b digital-access flow. */}
            {(result.giftCardItems ?? []).length > 0 ? (
              <section className="space-y-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900">🎁 গিফট কার্ড</h3>
                <ul className="space-y-1 text-sm text-slate-700">
                  {(result.giftCardItems ?? []).map((g, i) => (
                    <li key={`${g.name}-${i}`} className="flex flex-wrap items-center gap-2">
                      <span>{g.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${g.issued ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {g.issued ? "ইস্যু হয়েছে" : "এখনো ইস্যু হয়নি"}
                      </span>
                    </li>
                  ))}
                </ul>
                {result.giftCardNote ? <p className="text-xs font-semibold text-slate-600">{result.giftCardNote}</p> : null}
                {(result.giftCardItems ?? []).some((g) => g.issued) ? (
                  <button
                    type="button"
                    onClick={revealDigital}
                    disabled={digitalBusy}
                    className="rounded-xl bg-pink-600 px-4 py-2 text-xs font-bold text-white hover:bg-pink-700 disabled:opacity-50"
                  >
                    {digitalBusy ? "অপেক্ষা করুন…" : "লিংক দেখুন"}
                  </button>
                ) : null}
                {digitalError && (result.giftCardItems ?? []).some((g) => g.issued) && (result.digitalItems ?? []).length === 0 ? (
                  <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{digitalError}</p>
                ) : null}
                {revealedGiftCards ? (
                  <div className="space-y-2">
                    {revealedGiftCards.map((c) => (
                      <div key={c.code} className="space-y-1.5 rounded-2xl border border-pink-200 bg-pink-50/60 p-4">
                        <div className="flex items-center gap-2">
                          <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-sm font-bold tracking-wider text-slate-900">{c.code}</code>
                          <button
                            type="button"
                            onClick={() => copyGiftCardCode(c.code)}
                            className="shrink-0 rounded-lg bg-pink-600 px-3 py-2 text-xs font-bold text-white hover:bg-pink-700"
                          >
                            {gcCopied === c.code ? "কপি হয়েছে ✅" : "কপি করুন"}
                          </button>
                        </div>
                        <p className="text-xs text-slate-600">
                          মূল্য: <b className="text-slate-900">{money(c.initialAmountMinor)}</b>
                          {" · "}অবশিষ্ট ব্যালেন্স: <b className="text-slate-900">{money(c.balanceMinor)}</b>
                          {" · "}অবস্থা: <b className="text-slate-900">{{ active: "সক্রিয়", depleted: "ব্যালেন্স শেষ", expired: "মেয়াদোত্তীর্ণ", void: "বাতিল" }[c.status] ?? c.status}</b>
                          {c.expiresAt ? <>{" · "}মেয়াদ: <b className="text-slate-900">{new Date(c.expiresAt).toLocaleDateString(locale === "en" ? "en-GB" : "bn-BD")}</b></> : null}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {result.shipment ? (
              <section className="space-y-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900">🚚 {t.track.shipmentTitle} — {result.shipment.provider}</h3>
                {result.shipment.trackingCode ? (
                  <p className="text-sm text-slate-600">{t.track.trackingCode}: <span className="font-mono font-bold">{result.shipment.trackingCode}</span>{result.shipment.trackingUrl ? (
                    <> — <a href={result.shipment.trackingUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">{locale === "en" ? "Track on courier site" : "কুরিয়ারের সাইটে ট্র্যাক করুন"}</a></>
                  ) : null}</p>
                ) : null}
                {courierView?.kind === "progress" ? (
                  <>
                    <div className="flex items-center gap-1">
                      {COURIER_STEP_LABELS.map((label, i) => (
                        <div key={label} className="flex flex-1 flex-col items-center gap-1">
                          <div className={`h-2 w-full rounded-full ${i <= courierView.step ? "bg-gradient-to-r from-emerald-500 to-teal-400" : "bg-slate-200"}`} />
                          <span className={`text-center text-[11px] leading-tight ${i === courierView.step ? "font-bold text-emerald-700" : "text-slate-400"}`}>{label}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-sm text-slate-600">{t.track.shipmentStatus}: <b>{result.shipment.status}</b>{courierView.partial ? " (partial)" : ""}</p>
                  </>
                ) : courierView?.kind === "returned" ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">↩️ {t.track.shipmentStatus}: {result.shipment.status}</p>
                ) : courierView?.kind === "cancelled" ? (
                  <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">✖️ {t.track.shipmentStatus}: {result.shipment.status}</p>
                ) : (
                  <p className="text-sm text-slate-600">{t.track.shipmentStatus}: <b>{result.shipment.status}</b></p>
                )}
                <p className="text-xs text-slate-400">{t.track.bookedAt}: {new Date(result.shipment.bookedAt).toLocaleString(locale === "en" ? "en-GB" : "bn-BD")}</p>
              </section>
            ) : null}

            {/* NDR Recovery Assistant */}
            {!terminal && !result.steps.some((s) => s.key === "delivered" && s.reached) ? (
              <section className="space-y-3 rounded-3xl border border-amber-200 bg-amber-50/40 p-6 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-black text-amber-950 flex items-center gap-1.5">
                      <span>🤖</span>
                      <span>ডেলিভারি সহায়তা ও রাইডার নির্দেশনা (NDR Assistant)</span>
                    </h3>
                    <p className="mt-1 text-xs text-amber-800">
                      ডেলিভারি নিতে সমস্যা হচ্ছে? সময় বা ফোন নম্বর পরিবর্তন করতে নিচের বাটন ব্যবহার করুন।
                    </p>
                  </div>
                  {!ndrOpen && (
                    <button
                      type="button"
                      onClick={() => setNdrOpen(true)}
                      className="shrink-0 rounded-xl bg-amber-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-amber-700 shadow-sm transition"
                    >
                      নির্দেশনা দিন
                    </button>
                  )}
                </div>

                {ndrSuccess && (
                  <div className="rounded-xl bg-emerald-100 p-3 text-xs font-bold text-emerald-800 border border-emerald-200 flex items-center gap-2">
                    <span>✓</span>
                    <span>{ndrSuccess}</span>
                  </div>
                )}

                {ndrOpen && (
                  <form onSubmit={submitNdr} className="mt-3 space-y-3 rounded-2xl bg-white p-4 border border-amber-200 shadow-xs">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        { id: "reschedule", label: "📅 তারিখ পরিবর্তন" },
                        { id: "alt_phone", label: "📞 বিকল্প ফোন" },
                        { id: "update_address", label: "📍 ঠিকানা সংশোধন" },
                        { id: "instruction", label: "📝 বিশেষ নোট" },
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setNdrAction(item.id as any)}
                          className={`rounded-xl px-2.5 py-2 text-center text-xs font-bold transition ${
                            ndrAction === item.id
                              ? "bg-amber-600 text-white shadow-xs"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>

                    {ndrAction === "reschedule" && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          কোন তারিখে ডেলিভারি নিতে চান?
                        </label>
                        <input
                          type="date"
                          required
                          value={ndrRescheduleDate}
                          onChange={(e) => setNdrRescheduleDate(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-amber-600 focus:outline-none"
                        />
                      </div>
                    )}

                    {ndrAction === "alt_phone" && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          বিকল্প ফোন নম্বর (রাইডার না পেলে এই নম্বরে কল করবে):
                        </label>
                        <input
                          type="tel"
                          required
                          placeholder="যেমন: 018XXXXXXXX"
                          value={ndrAltPhone}
                          onChange={(e) => setNdrAltPhone(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 p-2 text-xs font-mono focus:border-amber-600 focus:outline-none"
                        />
                      </div>
                    )}

                    {ndrAction === "update_address" && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          সংশোধিত ঠিকানা বা পরিচিত ল্যান্ডমার্ক:
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="যেমন: বাসা নং ১২, রোড ৩, মসজিদের পাশে"
                          value={ndrAddress}
                          onChange={(e) => setNdrAddress(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-amber-600 focus:outline-none"
                        />
                      </div>
                    )}

                    {ndrAction === "instruction" && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          রাইডারের জন্য বিশেষ নির্দেশনা:
                        </label>
                        <textarea
                          required
                          rows={2}
                          placeholder="যেমন: কল দিয়ে আসবেন, বা সিকিউরিটির কাছে রেখে যাবেন"
                          value={ndrInstruction}
                          onChange={(e) => setNdrInstruction(e.target.value)}
                          className="w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-amber-600 focus:outline-none"
                        />
                      </div>
                    )}

                    {ndrError && (
                      <p className="rounded-lg bg-rose-50 p-2 text-xs font-medium text-rose-700">
                        {ndrError}
                      </p>
                    )}

                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setNdrOpen(false)}
                        className="rounded-xl px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
                      >
                        বাতিল
                      </button>
                      <button
                        type="submit"
                        disabled={ndrBusy}
                        className="rounded-xl bg-amber-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        {ndrBusy ? "সংরক্ষণ হচ্ছে..." : "নির্দেশনা পাঠান"}
                      </button>
                    </div>
                  </form>
                )}
              </section>
            ) : null}

            {/* Post-Purchase Loyalty & Upsell Card */}
            <section className="space-y-3 rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 via-purple-50/40 to-indigo-50/60 p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-2xl text-white shadow-md shadow-indigo-600/30">
                    🎁
                  </span>
                  <div>
                    <h3 className="text-sm font-black text-indigo-950">
                      আপনার জন্য বিশেষ উপহার — পরবর্তী অর্ডারে ১৫% ছাড়!
                    </h3>
                    <p className="mt-0.5 text-xs text-indigo-700">
                      চেকআউটে কুপন কোড ব্যবহার করুন: <span className="font-mono font-black rounded bg-white px-2 py-0.5 border border-indigo-200 text-indigo-900">VIP15</span>
                    </p>
                  </div>
                </div>
                <Link
                  href={`/shop/${orgSlug}`}
                  className="rounded-2xl bg-indigo-600 px-5 py-2.5 text-xs font-black text-white hover:bg-indigo-700 shadow-md shadow-indigo-600/20 transition"
                >
                  🛍️ নতুন কালেকশন দেখুন →
                </Link>
              </div>
            </section>

            {/* Trust block from the track response — hidden when empty. */}
            {result.shop.supportPhone?.trim() || result.shop.returnPolicyText?.trim() || result.shop.deliveryPromiseText?.trim() ? (
              <section className="space-y-2 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                {result.shop.deliveryPromiseText?.trim() ? (
                  <p className="text-sm font-semibold text-slate-700">🚚 {result.shop.deliveryPromiseText.trim()}</p>
                ) : null}
                {result.shop.supportPhone?.trim() ? (
                  <p className="text-sm text-slate-600">{t.track.supportLabel}: <span className="font-mono font-bold">{result.shop.supportPhone.trim()}</span></p>
                ) : null}
                {result.shop.returnPolicyText?.trim() ? (
                  <div>
                    <p className="text-xs font-bold text-slate-700">{t.track.returnPolicyLabel}</p>
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600">{result.shop.returnPolicyText.trim()}</p>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        ) : null}

        <p className="text-center">
          <Link href={`/shop/${orgSlug}`} className="text-xs font-bold text-indigo-700 hover:underline">← {shopName}</Link>
        </p>
      </main>
    </div>
  );
}
