"use client";
import React, { useCallback, useEffect, useState } from "react";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMinor } from "@repo/contracts";
import { API_URL } from "@/lib/api";
import {
  clearCartToken,
  lastOrderKey,
  requestQuote,
  type Quote,
} from "@/lib/storefront-cart";
import {
  fetchAddresses,
  fetchMe,
  fetchMyOrders,
  getShopSession,
  type ShopAddress,
} from "@/lib/storefront-account";
import { normalizeCheckoutFields, buildFieldAnswers, missingRequiredFields, type CheckoutFieldDef, type FieldAnswers } from "@/lib/checkout-fields";
import { CheckoutFieldsSection } from "@/components/CheckoutFieldsSection";
import { paymentMethodLabelBn, placeExpressCheckout, preselectPaymentMethod } from "@/lib/express-checkout";
import { depositKindForPaymentMethod, depositSummaryLines } from "@/lib/checkout-gc10";
import { getDeviceHashForCheckout } from "@/lib/device-hash";
import { useIdempotencyKey } from "@/components/TurnstileWidget";

function money(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

interface ShopPublicLite {
  checkoutFields?: unknown;
  checkoutTrust?: { termsRequired?: boolean };
}

/**
 * AB4 (AX5c) — express checkout for logged-in shoppers.
 *
 * Visible ONLY with a live shop session. Opens a confirmation
 * sheet: default address, quote totals for the CURRENT cart,
 * the most recent order's payment method (preselected, display
 * only), the org's custom fields, then one confirm POST. On
 * success it performs the exact sessionStorage handoff + success
 * navigation the normal checkout uses.
 */
/** ML8: locale-aware payment-method label (the lib helper
 * paymentMethodLabelBn stays the bn fallback for unknown ids). */
function paymentLabel(t: ReturnType<typeof shopT>, method: string | null | undefined): string {
  if (method === "bkash") return t.express.payBkash;
  if (method === "nagad") return t.express.payNagad;
  if (method === "cod" || method == null) return t.express.payCod;
  if (method) return t.express.payOnline;
  return paymentMethodLabelBn(method);
}

export function ExpressCheckout({
  orgSlug,
  ensureCart,
  locale = "bn",
}: {
  orgSlug: string;
  /** Returns a usable open-cart token for this surface (cart page:
   * the existing cart; PDP: build/ensure a cart for the product). */
  ensureCart: () => Promise<string>;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const router = useRouter();
  const idempotency = useIdempotencyKey();
  const [sessionPresent, setSessionPresent] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [address, setAddress] = useState<ShopAddress | null>(null);
  const [noAddress, setNoAddress] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [fields, setFields] = useState<CheckoutFieldDef[]>([]);
  const [answers, setAnswers] = useState<FieldAnswers>({});
  const [payMethod, setPayMethod] = useState<"cod" | "bkash" | "nagad" | undefined>(undefined);
  const [termsRequired, setTermsRequired] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [cartToken, setCartToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSessionPresent(!!getShopSession(orgSlug));
  }, [orgSlug]);

  const loadSheet = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await ensureCart();
      setCartToken(token);
      const [me, addrRes, ordersRes, shopRes] = await Promise.all([
        fetchMe(orgSlug).catch(() => null),
        fetchAddresses(orgSlug).catch(() => ({ items: [] as ShopAddress[] })),
        fetchMyOrders(orgSlug, 1, 1).catch(() => null),
        fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}`)
          .then((r) => (r.ok ? (r.json() as Promise<ShopPublicLite>) : null))
          .catch(() => null),
      ]);
      const items = addrRes.items ?? [];
      const def = items.find((a) => a.isDefault) ?? me?.defaultAddress ?? items[0] ?? null;
      setAddress(def);
      setNoAddress(!def);
      setPayMethod(preselectPaymentMethod(ordersRes?.items));
      if (shopRes) {
        setFields(normalizeCheckoutFields(shopRes.checkoutFields));
        setTermsRequired(!!shopRes.checkoutTrust?.termsRequired);
      }
      if (def && token) {
        try {
          const q = await requestQuote(orgSlug, { cartToken: token, district: def.district });
          setQuote(q);
        } catch {
          setQuote(null);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t.express.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [orgSlug, ensureCart]);

  function openSheet() {
    setOpen(true);
    void loadSheet();
  }

  async function confirm() {
    if (!cartToken || !address) return;
    const missing = missingRequiredFields(fields, answers);
    if (missing.length > 0) {
      setError(`${t.express.requiredFieldsPrefix}${missing.join(", ")}`);
      return;
    }
    if (termsRequired && !termsAccepted) {
      setError(t.express.termsRequired);
      return;
    }
    setBusy(true);
    setError("");
    try {
      // AB8 (AX27): express posts through its own payload
      // builder — the device hash rides there too.
      const deviceHash = await getDeviceHashForCheckout();
      const out = await placeExpressCheckout(orgSlug, {
        cartToken,
        addressId: address.id,
        ...(payMethod ? { paymentMethod: payMethod } : {}),
        fieldAnswers: buildFieldAnswers(fields, answers),
        termsAccepted,
        idempotencyKey: idempotency.key,
        ...(deviceHash ? { deviceHash } : {}),
      });
      idempotency.reset();
      try {
        sessionStorage.setItem(lastOrderKey(orgSlug), JSON.stringify(out));
      } catch { /* success page falls back to the query param */ }
      clearCartToken(orgSlug);
      router.push(`/shop/${orgSlug}/success?order=${encodeURIComponent(out.orderNumber)}`);
    } catch (e) {
      // Server 400s carry Bengali text — shown verbatim in the sheet.
      setError(e instanceof Error ? e.message : t.express.orderFailed);
      setBusy(false);
    }
  }

  if (!sessionPresent) return null;

  const depKind = depositKindForPaymentMethod(payMethod ?? "cod");
  const depLines = quote ? depositSummaryLines({ totalMinor: quote.totalMinor, deposit: quote.deposit, kind: depKind }) : null;

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className="w-full rounded-2xl bg-emerald-600 py-3 text-sm font-extrabold text-white shadow hover:bg-emerald-700"
      >
        {t.express.title}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
          {/* ED9: token polish only — surface/radius/ink via the
              EB1 CSS vars (values equal the hard-coded ones at
              the defaults). The emerald confirm + trigger buttons
              are emerald BY DESIGN and are NOT touched. */}
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[var(--radius-xl)] bg-[var(--surface)] p-5 shadow-xl sm:rounded-[var(--radius-xl)]">
            <div className="mb-3 flex items-start justify-between gap-2">
              <h2 className="text-base font-black text-[var(--ink-strong)]">{t.express.title}</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-600" aria-label={t.express.close}>✕</button>
            </div>

            {loading ? (
              <p className="py-6 text-center text-sm font-semibold text-slate-500">{t.express.loading}</p>
            ) : noAddress ? (
              <div className="space-y-3">
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                  {t.express.noAddress}
                </p>
                {/* ED9: this no-address CTA was the sheet's one
                    hard-coded indigo primary — .btn-brand at the
                    shop root resolves to the org colour, falling
                    back to #4f46e5 (indigo-600) exactly as before. */}
                <Link href={`/shop/${orgSlug}/account`} className="btn-brand block rounded-xl py-2.5 text-center text-sm font-bold">
                  {t.express.addAddress}
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {address ? (
                  <div className="rounded-[var(--radius-lg)] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3 text-sm">
                    <p className="font-bold text-[var(--ink-strong)]">{t.express.deliveryAddress}{address.label ? ` (${address.label})` : ""}</p>
                    <p className="text-slate-700">{address.recipientName} · <span className="font-mono">{address.phone}</span></p>
                    <p className="text-slate-600">{address.addressLine}, {address.district}</p>
                  </div>
                ) : null}

                <div className="rounded-[var(--radius-lg)] border border-[var(--border-soft)] bg-[var(--surface-muted)] p-3 text-sm">
                  <p className="font-bold text-[var(--ink-strong)]">{t.express.paymentPrefix}{paymentLabel(t, payMethod)}</p>
                  <p className="text-[11px] text-slate-500">{t.express.paymentNote}</p>
                </div>

                {quote ? (
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-slate-600"><span>{t.express.itemsPrice}</span><span className="font-semibold text-slate-900">{money(quote.itemsSubtotalMinor)}</span></div>
                    {BigInt(quote.discountMinor) > 0n ? (
                      <div className="flex justify-between text-emerald-700"><span>{t.express.discount}</span><span className="font-semibold">− {money(quote.discountMinor)}</span></div>
                    ) : null}
                    <div className="flex justify-between text-slate-600"><span>{t.express.delivery}</span><span className="font-semibold text-slate-900">{BigInt(quote.deliveryMinor) === 0n ? t.express.free : money(quote.deliveryMinor)}</span></div>
                    <div className="flex justify-between border-t pt-1.5 font-black text-slate-900"><span>{t.express.total}</span><span className="text-indigo-700">{money(quote.totalMinor)}</span></div>
                    {depLines ? (
                      <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                        <div className="flex justify-between"><span>{t.express.payNowDeposit}</span><span className="font-bold">{money(depLines.depositMinor)}</span></div>
                        <div className="flex justify-between"><span>{t.express.dueAtDelivery}</span><span className="font-bold">{money(depLines.dueAfterMinor)}</span></div>
                        {depLines.note ? <p>{depLines.note}</p> : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-slate-500">{t.express.quoteLoadFailed}</p>
                )}

                <CheckoutFieldsSection
                  defs={fields}
                  answers={answers}
                  onChange={(k, v) => setAnswers((prev) => ({ ...prev, [k]: v }))}
                  dense
                />

                {termsRequired ? (
                  <label className="flex cursor-pointer items-start gap-2 text-sm font-semibold text-slate-800">
                    <input type="checkbox" className="mt-0.5" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
                    <span>{t.express.termsLabel}</span>
                  </label>
                ) : null}

                {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}

                <button
                  type="button"
                  onClick={confirm}
                  disabled={busy || !address}
                  className="w-full rounded-2xl bg-emerald-600 py-3 text-sm font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? t.express.ordering : t.express.confirmOrder}
                </button>
                <p className="text-center text-[11px] text-slate-400">{t.express.regularCheckoutNote}</p>
              </div>
            )}
            {!loading && error && noAddress ? (
              <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
