"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  formatTakaMinor, txnStatusMeta,
  type PaymentTransactionView, type PlatformPaymentsView, type TenantPaymentGatewayView,
} from "@/lib/connections";

/**
 * CC19 (CC9 UI follow-up) — staff "Collect payment" on the
 * order detail. Offers ONLY payment paths that really exist for
 * this org: an enabled own LIVE gateway, or a platform provider
 * the tenant enabled AND the platform offers. Starting a payment
 * calls the SAME initiation APIs as everywhere else and shows
 * the REAL gateway URL to share with the customer; the order's
 * existing transactions (real TenantPaymentTransaction rows)
 * show their live status. Nothing here marks anything paid —
 * that stays with the gateway's server-side verification (IPN),
 * exactly as the note under the buttons says.
 */
export function CollectPayment({ orderId, customerName, customerPhone, customerEmail }: {
  orderId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
}) {
  const [ownGateways, setOwnGateways] = useState<TenantPaymentGatewayView[]>([]);
  const [platform, setPlatform] = useState<PlatformPaymentsView | null>(null);
  const [txns, setTxns] = useState<PaymentTransactionView[]>([]);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const [gw, pp, tx] = await Promise.all([
        apiFetch<{ gateways: TenantPaymentGatewayView[] }>(`organizations/${orgId}/connections/payment-gateways`),
        apiFetch<PlatformPaymentsView>(`organizations/${orgId}/connections/platform-payments`),
        apiFetch<{ transactions: PaymentTransactionView[] }>(`organizations/${orgId}/connections/payment-transactions?limit=100`),
      ]);
      setOwnGateways(gw.gateways ?? []);
      setPlatform(pp);
      setTxns((tx.transactions ?? []).filter((t) => t.orderId === orderId));
    } catch { /* no payment paths render — nothing is invented */ }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  const ownOptions = ownGateways.filter(
    (g) => g.isEnabled && (g.environment ?? "live") === "live" && (g.provider === "sslcommerz" || g.provider === "bkash" || g.provider === "stripe"),
  );
  const providerLabel = (provider: string) => provider === "bkash" ? "বিকাশ" : provider === "stripe" ? "Stripe (কার্ড)" : "SSLCommerz";
  const platformOptions = (platform?.providers ?? []).filter((p) => p.offered && p.enabled);

  async function initiate(source: "own" | "platform", provider: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(`${source}:${provider}`); setError(""); setLink(""); setCopied(false);
    try {
      const path = source === "own"
        ? `organizations/${orgId}/connections/payment-gateways/${provider}/initiate-payment`
        : `organizations/${orgId}/connections/platform-payments/${provider}/initiate-payment`;
      const res = await apiFetch<{ redirectUrl?: string; bkashURL?: string }>(path, {
        method: "POST",
        body: JSON.stringify({
          orderId,
          customerName: customerName ?? undefined,
          customerPhone: customerPhone ?? undefined,
          customerEmail: customerEmail ?? undefined,
        }),
      });
      const url = res.redirectUrl ?? res.bkashURL ?? "";
      if (!url) throw new Error("গেটওয়ে কোনো পেমেন্ট লিংক দেয়নি — পেমেন্ট শুরু হয়নি।");
      setLink(url);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "পেমেন্ট শুরু করা যায়নি");
    } finally { setBusy(""); }
  }

  if (ownOptions.length === 0 && platformOptions.length === 0 && txns.length === 0) return null;

  return (
    <div className="space-y-2 border-t pt-3">
      <label className="text-sm font-medium">💳 অনলাইন পেমেন্ট সংগ্রহ করুন</label>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {ownOptions.map((g) => (
          <button
            key={`own:${g.provider}`}
            type="button"
            disabled={busy !== ""}
            onClick={() => void initiate("own", g.provider)}
            className="btn-primary btn-sm"
          >
            {busy === `own:${g.provider}` ? "লিংক তৈরি হচ্ছে..." : `${providerLabel(g.provider)} — নিজের গেটওয়ে`}
          </button>
        ))}
        {platformOptions.map((p) => (
          <button
            key={`platform:${p.provider}`}
            type="button"
            disabled={busy !== ""}
            onClick={() => void initiate("platform", p.provider)}
            className="btn-primary btn-sm"
          >
            {busy === `platform:${p.provider}` ? "লিংক তৈরি হচ্ছে..." : `${p.provider === "bkash" ? "বিকাশ" : "SSLCommerz"} — প্ল্যাটফর্ম গেটওয়ে`}
          </button>
        ))}
      </div>
      {link ? (
        <div className="space-y-1 rounded-lg bg-indigo-50 px-3 py-2">
          <p className="text-xs font-semibold text-indigo-800">পেমেন্ট লিংক তৈরি হয়েছে — কাস্টমারকে পাঠান:</p>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={link} className="input min-w-52 flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => undefined); }}
            >
              {copied ? "কপি হয়েছে ✓" : "কপি করুন"}
            </button>
            <a href={link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-700 underline">লিংক খুলুন ↗</a>
          </div>
        </div>
      ) : null}
      {txns.length > 0 ? (
        <div className="space-y-1">
          {txns.map((t) => {
            const meta = txnStatusMeta(t.status);
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${meta.cls}`}>{meta.label}</span>
                <span className="font-semibold">{formatTakaMinor(t.amountMinor)}</span>
                <span className="text-slate-500">{providerLabel(t.provider)} · {t.source === "platform" ? "প্ল্যাটফর্ম" : "নিজের গেটওয়ে"}</span>
                <span className="text-slate-400">{new Date(t.createdAt).toLocaleString("bn-BD")}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      <p className="text-xs text-slate-400">
        লিংক পাঠালেই পেমেন্ট ধরা হয় না — কাস্টমার পেমেন্ট শেষ করে গেটওয়ের সার্ভার-যাচাই (IPN) এলেই কেবল অর্ডারটি paid হবে। অবস্থা এখানেই হালনাগাদ দেখা যাবে।
      </p>
    </div>
  );
}
