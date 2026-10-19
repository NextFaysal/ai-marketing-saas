"use client";
import React, { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { BD_DISTRICTS, formatMinor } from "@repo/contracts";
import { API_URL } from "@/lib/api";
import { fetchCart, patchCartLine } from "@/lib/storefront-cart";
import {
  createAddress,
  deleteAddress,
  fetchAccountLoyalty,
  fetchAccountStoreCredit,
  fetchAddresses,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  fetchMe,
  fetchMyOrder,
  fetchMyOrders,
  fetchWishlist,
  getShopSession,
  logout,
  removeWishlist,
  reorderOrder,
  requestOtp,
  updateAddress,
  updateProfile,
  verifyOtp,
  type AccountLoyalty,
  type AccountStoreCredit,
  type MyOrder,
  type MyOrderDetail,
  type ReferralRewardCoupon,
  type ShopAddress,
  type ShopCustomer,
  type ShopNotification,
  type WishlistItem,
} from "@/lib/storefront-account";
import { shopLocaleOf, shopT, type ShopLocale } from "@/lib/shop-i18n";
import { fmtDate, fmtDateTime, fmtNumber } from "@repo/contracts";
import { creditReasonLabel } from "@/lib/membership";
import { captchaSiteKeyFor, type CheckoutTrust } from "@/lib/orders-gb3";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { priceText, stockBadge } from "../ProductCard";
import { MediaImage } from "@/components/MediaImage";

function money(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

// AB1: loyalty ledger presentation (Bengali-first, like the
// rest of this surface's newer blocks).
function loyaltyReasonLabels(locale: ShopLocale): Record<string, string> {
  const x = shopT(locale).accountExtra;
  return {
    earn: x.reasonEarn,
    redeem: x.reasonRedeem,
    expire: x.reasonExpire,
    adjust: x.reasonAdjust,
    referral_reward: x.reasonReferral,
  };
}

function loyaltyNoteLabels(locale: ShopLocale): Record<string, string> {
  const x = shopT(locale).accountExtra;
  return {
    redeem_reversal: x.reasonRedeemReversal,
    earn_clawback: x.reasonEarnClawback,
    referral_reward_clawback: x.reasonReferralClawback,
  };
}

function loyaltyNoteText(note: string | null, locale: ShopLocale): string | null {
  if (!note) return null;
  return loyaltyNoteLabels(locale)[note] ?? note;
}

function referralCouponState(c: ReferralRewardCoupon, locale: ShopLocale): { label: string; cls: string } {
  const x = shopT(locale).accountExtra;
  if (c.usedCount > 0) return { label: x.couponUsed, cls: "bg-slate-100 text-slate-600" };
  if (!c.active) return { label: x.couponExpired, cls: "bg-rose-50 text-rose-600" };
  return { label: x.couponActive, cls: "bg-emerald-100 text-emerald-700" };
}

type Tab = "orders" | "wishlist" | "addresses" | "profile" | "notifications";

function AccountInner() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const orgSlug = String(params.orgSlug ?? "");
  const [locale, setLocale] = useState<ShopLocale>("bn");
  const t = shopT(locale);

  const [ready, setReady] = useState(false);
  const [customer, setCustomer] = useState<ShopCustomer | null>(null);
  const [tab, setTab] = useState<Tab>(search.get("wishlist") ? "wishlist" : "orders");
  const [mergeNote, setMergeNote] = useState("");

  // OTP login form
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  // GB3 (GC9): OTP CAPTCHA — trust block from the shop home payload;
  // the epoch remounts the widget so a resend gets a fresh token.
  const [checkoutTrust, setCheckoutTrust] = useState<CheckoutTrust | null>(null);
  const [otpCaptchaToken, setOtpCaptchaToken] = useState<string | null>(null);
  const [otpCaptchaEpoch, setOtpCaptchaEpoch] = useState(0);

  // orders
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [detail, setDetail] = useState<MyOrderDetail | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [reorderNote, setReorderNote] = useState("");
  const [unavailable, setUnavailable] = useState<{ name: string; reason: string }[]>([]);

  // wishlist
  const [wishItems, setWishItems] = useState<WishlistItem[]>([]);
  const [wishBusy, setWishBusy] = useState("");

  // addresses
  const [addresses, setAddresses] = useState<ShopAddress[]>([]);
  const [addrForm, setAddrForm] = useState<{ id: string | null; label: string; recipientName: string; phone: string; addressLine: string; district: string; isDefault: boolean } | null>(null);
  const [addrBusy, setAddrBusy] = useState(false);

  // profile
  const [profName, setProfName] = useState("");
  const [profEmail, setProfEmail] = useState("");
  const [profSaved, setProfSaved] = useState(false);
  const [profBusy, setProfBusy] = useState(false);

  // AB1: loyalty + referral surface (null = not loaded / failed
  // / signed out — the page then renders exactly as before).
  const [loyalty, setLoyalty] = useState<AccountLoyalty | null>(null);
  const [refCopied, setRefCopied] = useState(false);
  // NF7: own store credit + tier (best-effort like loyalty —
  // a failed load just hides the card).
  const [storeCredit, setStoreCredit] = useState<AccountStoreCredit | null>(null);

  // MX14: on-site notification center (best-effort like loyalty —
  // a failed fetch hides the tab's contents, never the page).
  const [notifications, setNotifications] = useState<ShopNotification[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);

  const [error, setError] = useState("");

  // Shop locale (default bn).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}`);
        if (!res.ok) return;
        const json = await res.json();
        setLocale(shopLocaleOf(json?.settings?.locale));
        setCheckoutTrust((json?.checkoutTrust as CheckoutTrust | undefined) ?? null);
      } catch { /* locale stays bn */ }
    })();
  }, [orgSlug]);

  // Resend countdown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const loadOrders = useCallback(async (page: number) => {
    setOrdersLoading(true);
    try {
      const out = await fetchMyOrders(orgSlug, page, 10);
      setOrders(out.items);
      setOrdersPage(out.pagination.page);
      setOrdersTotalPages(out.pagination.totalPages);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
    } finally {
      setOrdersLoading(false);
    }
  }, [orgSlug, t.account.genericError]);

  const loadWishlist = useCallback(async () => {
    try {
      const out = await fetchWishlist(orgSlug);
      setWishItems(out.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
    }
  }, [orgSlug, t.account.genericError]);

  const loadAddresses = useCallback(async () => {
    try {
      const out = await fetchAddresses(orgSlug);
      setAddresses(out.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
    }
  }, [orgSlug, t.account.genericError]);

  // AB1: loyalty is best-effort — a failed fetch must never
  // break the account page, it just hides the loyalty surface.
  const loadLoyalty = useCallback(async () => {
    try {
      setLoyalty(await fetchAccountLoyalty(orgSlug));
    } catch {
      setLoyalty(null);
    }
  }, [orgSlug]);

  const loadNotifications = useCallback(async () => {
    try {
      const out = await fetchNotifications(orgSlug);
      setNotifications(out.items);
      setNotifUnread(out.unreadCount);
    } catch {
      setNotifications([]);
      setNotifUnread(0);
    }
  }, [orgSlug]);

  const loadStoreCredit = useCallback(async () => {
    try {
      setStoreCredit(await fetchAccountStoreCredit(orgSlug));
    } catch {
      setStoreCredit(null);
    }
  }, [orgSlug]);

  const loadAccount = useCallback(async () => {
    if (!getShopSession(orgSlug)) {
      setCustomer(null);
      setReady(true);
      return;
    }
    try {
      const me = await fetchMe(orgSlug);
      setCustomer(me.customer);
      setProfName(me.customer.name ?? "");
      setProfEmail(me.customer.email ?? "");
      await Promise.all([loadOrders(1), loadWishlist(), loadAddresses(), loadLoyalty(), loadNotifications(), loadStoreCredit()]);
    } catch {
      setCustomer(null);
    } finally {
      setReady(true);
    }
  }, [orgSlug, loadOrders, loadWishlist, loadAddresses, loadLoyalty, loadNotifications, loadStoreCredit]);

  useEffect(() => { loadAccount(); }, [loadAccount]);

  async function sendCode() {
    if (captchaSiteKeyFor(checkoutTrust, "otp") && !otpCaptchaToken) {
      setAuthError(t.checkout.captchaRequiredError);
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    try {
      await requestOtp(orgSlug, phone.trim(), otpCaptchaToken ?? undefined);
      // Turnstile tokens are single-use — drop it and remount the
      // widget so a resend produces a fresh one.
      setOtpCaptchaToken(null);
      setOtpCaptchaEpoch((n) => n + 1);
      setCodeSent(true);
      setResendIn(60);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : t.account.genericError);
    } finally {
      setAuthBusy(false);
    }
  }

  async function doVerify() {
    setAuthBusy(true);
    setAuthError("");
    try {
      const out = await verifyOtp(orgSlug, phone.trim(), code.trim());
      setCustomer(out.customer);
      if (out.merge && out.merge.added > 0) {
        setMergeNote(`${t.account.mergedPrefix}${out.merge.added}${t.account.mergedSuffix}`);
      }
      setCode("");
      setCodeSent(false);
      await loadAccount();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : t.account.genericError);
    } finally {
      setAuthBusy(false);
    }
  }

  async function doLogout() {
    await logout(orgSlug);
    setCustomer(null);
    setDetail(null);
    setOrders([]);
    setWishItems([]);
    setAddresses([]);
    setLoyalty(null);
    setNotifications([]);
    setNotifUnread(0);
  }

  // MX14: opening a notification stamps it read (the real read
  // signal the broadcast report counts), then follows its
  // shop-relative URL verbatim when one was set.
  async function openNotification(n: ShopNotification) {
    if (!n.isRead) {
      try {
        const saved = await markNotificationRead(orgSlug, n.id);
        setNotifications((prev) => prev.map((x) => (x.id === n.id ? saved : x)));
        setNotifUnread((c) => Math.max(0, c - 1));
      } catch (e) {
        setError(e instanceof Error ? e.message : t.account.genericError);
        return;
      }
    }
    if (n.url) router.push(n.url);
  }

  async function markAllRead() {
    try {
      await markAllNotificationsRead(orgSlug);
      setNotifications((prev) => prev.map((x) => (x.isRead ? x : { ...x, isRead: true, readAt: new Date().toISOString() })));
      setNotifUnread(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
    }
  }

  async function copyReferralCode() {
    if (!loyalty?.referralCode) return;
    try {
      await navigator.clipboard.writeText(loyalty.referralCode);
      setRefCopied(true);
      setTimeout(() => setRefCopied(false), 2000);
    } catch { /* clipboard unavailable — the code stays visible to copy manually */ }
  }

  async function openDetail(orderId: string) {
    setError("");
    try {
      setDetail(await fetchMyOrder(orgSlug, orderId));
      setUnavailable([]);
      setReorderNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
    }
  }

  async function doReorder(orderId: string) {
    setReorderBusy(true);
    setError("");
    setReorderNote("");
    setUnavailable([]);
    try {
      const out = await reorderOrder(orgSlug, orderId);
      setUnavailable(out.unavailable);
      // Load available lines into the cart (PATCH sets absolute
      // quantity — merge with any existing line first).
      const cart = await fetchCart(orgSlug);
      let loaded = 0;
      for (const item of out.items) {
        const existing = cart?.items.find(
          (i) => i.productId === item.productId && (i.variantId ?? null) === (item.variantId ?? null),
        );
        await patchCartLine(orgSlug, {
          productId: item.productId,
          variantId: item.variantId ?? null,
          quantity: Math.min(99, (existing?.quantity ?? 0) + item.quantity),
        });
        loaded += 1;
      }
      if (loaded > 0) {
        router.push(`/shop/${orgSlug}/cart?reordered=${loaded}`);
        return;
      }
      setReorderNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
    } finally {
      setReorderBusy(false);
    }
  }

  async function wishAddToCart(item: WishlistItem) {
    setWishBusy(item.productId);
    setError("");
    try {
      const cart = await fetchCart(orgSlug);
      const existing = cart?.items.find((i) => i.productId === item.productId && (i.variantId ?? null) === null);
      await patchCartLine(orgSlug, {
        productId: item.productId,
        variantId: null,
        quantity: Math.min(99, (existing?.quantity ?? 0) + 1),
      });
      setWishBusy(`added-${item.productId}`);
      setTimeout(() => setWishBusy(""), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
      setWishBusy("");
    }
  }

  async function wishRemove(item: WishlistItem) {
    setWishBusy(item.productId);
    try {
      await removeWishlist(orgSlug, item.productId);
      setWishItems((prev) => prev.filter((x) => x.productId !== item.productId));
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
    } finally {
      setWishBusy("");
    }
  }

  async function saveAddress() {
    if (!addrForm) return;
    setAddrBusy(true);
    setError("");
    try {
      const body = {
        label: addrForm.label.trim() || undefined,
        recipientName: addrForm.recipientName.trim(),
        phone: addrForm.phone.trim(),
        addressLine: addrForm.addressLine.trim(),
        district: addrForm.district,
        isDefault: addrForm.isDefault,
      };
      if (addrForm.id) await updateAddress(orgSlug, addrForm.id, body);
      else await createAddress(orgSlug, body);
      setAddrForm(null);
      await loadAddresses();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
    } finally {
      setAddrBusy(false);
    }
  }

  async function removeAddress(a: ShopAddress) {
    if (!window.confirm(t.account.deleteConfirm)) return;
    setError("");
    try {
      await deleteAddress(orgSlug, a.id);
      await loadAddresses();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
    }
  }

  async function makeDefault(a: ShopAddress) {
    setError("");
    try {
      await updateAddress(orgSlug, a.id, { isDefault: true });
      await loadAddresses();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
    }
  }

  async function saveProfile() {
    setProfBusy(true);
    setError("");
    setProfSaved(false);
    try {
      const out = await updateProfile(orgSlug, {
        name: profName.trim() || undefined,
        email: profEmail.trim() || undefined,
      });
      setCustomer(out.customer);
      setProfSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.genericError);
    } finally {
      setProfBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        <p className="mt-3 text-sm font-semibold text-slate-600">{t.account.loading}</p>
      </div>
    );
  }

  // --- Guest: OTP login card (this IS the loginRequired state) ---
  if (!customer) {
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-black text-slate-900">👤 {t.account.loginTitle}</h1>
          <p className="text-xs leading-relaxed text-slate-500">{t.account.loginHelp}</p>
          {authError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{authError}</p> : null}
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">{t.account.phoneLabel}</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t.account.phonePlaceholder}
              disabled={codeSent}
              className="w-full rounded-xl border border-slate-300 p-2.5 font-mono text-sm font-bold focus:border-indigo-600 focus:outline-none disabled:bg-slate-50"
            />
          </div>
          {captchaSiteKeyFor(checkoutTrust, "otp") ? (
            <TurnstileWidget key={otpCaptchaEpoch} siteKey={captchaSiteKeyFor(checkoutTrust, "otp") ?? ""} onToken={setOtpCaptchaToken} />
          ) : null}
          {!codeSent ? (
            <button
              type="button"
              onClick={sendCode}
              disabled={authBusy || phone.trim().length < 11}
              className="w-full rounded-2xl bg-indigo-600 py-3 text-sm font-extrabold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
            >
              {authBusy ? t.account.sendingCode : t.account.sendCode}
            </button>
          ) : (
            <>
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{t.account.codeSentNote}</p>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">{t.account.codeLabel}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t.account.codePlaceholder}
                  className="w-full rounded-xl border border-slate-300 p-2.5 font-mono text-sm font-bold tracking-widest focus:border-indigo-600 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={doVerify}
                disabled={authBusy || !code.trim()}
                className="w-full rounded-2xl bg-indigo-600 py-3 text-sm font-extrabold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
              >
                {authBusy ? t.account.verifying : t.account.verify}
              </button>
              <button
                type="button"
                onClick={sendCode}
                disabled={authBusy || resendIn > 0}
                className="w-full text-center text-xs font-bold text-indigo-700 hover:underline disabled:text-slate-400 disabled:no-underline"
              >
                {resendIn > 0 ? `${t.account.resendInPrefix}${resendIn}${t.account.resendInSuffix}` : t.account.resend}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // AB1: the points card shows only for an enabled program or
  // a non-zero balance; the referral block shows when there is
  // a code or earned coupons to display.
  const showLoyaltyCard = !!loyalty && (loyalty.enabled || loyalty.balance !== 0);
  const referralCoupons = loyalty?.referralRewards?.coupons ?? [];
  const showReferral = !!loyalty && (!!loyalty.referralCode || referralCoupons.length > 0);
  const dateFmt = (iso: string) => fmtDate(locale, iso);

  const tabs: { key: Tab; label: string }[] = [
    { key: "orders", label: t.account.tabsOrders },
    { key: "wishlist", label: t.account.tabsWishlist },
    { key: "addresses", label: t.account.tabsAddresses },
    { key: "profile", label: t.account.tabsProfile },
    { key: "notifications", label: notifUnread > 0 ? `${t.accountExtra.notifTabPrefix}${fmtNumber(locale, notifUnread)})` : t.accountExtra.notifTab },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">👤 {customer.name || t.common.account}</h1>
          <p className="font-mono text-sm text-slate-500">{customer.phone}{customer.email ? ` · ${customer.email}` : ""}</p>
        </div>
        <button type="button" onClick={doLogout} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
          {t.account.logout}
        </button>
      </div>

      {mergeNote ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">❤️ {mergeNote}</p> : null}
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}

      {/* --- AB1: loyalty points card + history --- */}
      {showLoyaltyCard && loyalty ? (
        <div className="space-y-4 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-black text-slate-900">{t.accountExtra.loyaltyTitle}</h2>
              <p className="text-xs text-slate-500">{t.accountExtra.loyaltySub}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-violet-700">{fmtNumber(locale, loyalty.balance)} <span className="text-sm font-bold text-slate-600">{t.accountExtra.pointsSuffix}</span></p>
              <p className="text-xs font-semibold text-slate-500">{t.accountExtra.valuePrefix}{money(String(loyalty.balanceValueMinor))}</p>
            </div>
          </div>
          {loyalty.entries.length > 0 ? (
            <ul className="divide-y border-t">
              {loyalty.entries.map((e) => {
                const noteText = loyaltyNoteText(e.note, locale);
                return (
                  <li key={e.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800">{loyaltyReasonLabels(locale)[e.reason] ?? e.reason}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                        <span>{dateFmt(e.createdAt)}</span>
                        {e.orderNumber ? <span>{t.accountExtra.orderPrefix}<span className="font-mono font-semibold">{e.orderNumber}</span></span> : null}
                        <span>{t.accountExtra.balancePrefix}{fmtNumber(locale, e.balanceAfter)}</span>
                        {e.reason === "earn" && e.expiresAt ? <span>{t.accountExtra.expiryPrefix}{dateFmt(e.expiresAt)}</span> : null}
                        {e.reason === "earn" && e.remainingPoints != null ? <span>{t.accountExtra.remainingPrefix}{fmtNumber(locale, e.remainingPoints)}</span> : null}
                      </p>
                      {noteText ? <p className="mt-0.5 text-xs text-slate-500">{noteText}</p> : null}
                    </div>
                    <span className={`shrink-0 font-black ${e.deltaPoints >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {e.deltaPoints >= 0 ? `+${e.deltaPoints}` : `−${Math.abs(e.deltaPoints)}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="border-t pt-3 text-sm font-semibold text-slate-500">{t.accountExtra.noPointsYet}</p>
          )}
        </div>
      ) : null}

      {/* --- NF7: store credit + membership tier card --- */}
      {storeCredit && (storeCredit.balanceMinor !== "0" || storeCredit.entries.length > 0 || storeCredit.tier?.tierName) ? (
        <div className="space-y-4 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-black text-slate-900">{t.accountExtra.creditTitle}</h2>
              <p className="text-xs text-slate-500">{t.accountExtra.creditSub}</p>
              {storeCredit.tier?.tierName ? (
                <p className="mt-1 text-xs font-bold text-amber-700">{t.accountExtra.tierPrefix}{storeCredit.tier.tierName}{t.accountExtra.tierLifetimeMid}{money(storeCredit.tier.lifetimeSpendMinor)}</p>
              ) : null}
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-amber-700">{money(storeCredit.balanceMinor)}</p>
              <p className="text-xs font-semibold text-slate-500">{t.accountExtra.currentBalance}</p>
            </div>
          </div>
          {storeCredit.entries.length > 0 ? (
            <ul className="divide-y border-t">
              {storeCredit.entries.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800">{creditReasonLabel(e.reason)}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                      {e.createdAt ? <span>{dateFmt(e.createdAt)}</span> : null}
                      <span>{t.accountExtra.balancePrefix}{money(e.balanceAfter)}</span>
                    </p>
                    {e.note ? <p className="mt-0.5 text-xs text-slate-500">{e.note}</p> : null}
                  </div>
                  <span className={`shrink-0 font-black ${e.deltaMinor.startsWith("-") ? "text-rose-600" : "text-emerald-600"}`}>
                    {e.deltaMinor.startsWith("-") ? `−${money(e.deltaMinor.slice(1))}` : `+${money(e.deltaMinor)}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t pt-3 text-sm font-semibold text-slate-500">{t.accountExtra.noCreditYet}</p>
          )}
        </div>
      ) : null}

      {/* --- AB1: your referral (code + earned reward coupons) --- */}
      {showReferral && loyalty ? (
        <div className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5">
          <h2 className="font-black text-slate-900">{t.accountExtra.referralTitle}</h2>
          {loyalty.referralCode ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-xl border border-indigo-200 bg-white px-4 py-2 font-mono text-sm font-black tracking-wider text-indigo-800">{loyalty.referralCode}</span>
              <button
                type="button"
                onClick={copyReferralCode}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700"
              >
                {refCopied ? t.accountExtra.copied : t.accountExtra.copyCode}
              </button>
              <p className="w-full text-xs text-slate-500">{t.accountExtra.referralSub}</p>
            </div>
          ) : null}
          {referralCoupons.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-700">{t.accountExtra.referralCouponsTitle}</p>
              <ul className="space-y-2">
                {referralCoupons.map((c) => {
                  const state = referralCouponState(c, locale);
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-white px-4 py-2.5 text-sm">
                      <span className="font-mono font-black text-indigo-800">{c.code}</span>
                      <span className="font-bold text-emerald-700">{fmtNumber(locale, c.value)}{t.accountExtra.discountSuffix}</span>
                      {c.sourceOrderNumber ? <span className="text-xs text-slate-500">{t.accountExtra.fromOrderPrefix}{c.sourceOrderNumber}{t.accountExtra.fromOrderSuffix}</span> : null}
                      <span className="text-xs text-slate-500">{c.endsAt ? `${t.accountExtra.expiryPrefix}${dateFmt(c.endsAt)}` : t.accountExtra.noExpiry}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${state.cls}`}>{state.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* --- AB2: gift-card balance link (the public balance
          page needs only the code — no login). --- */}
      <Link
        href={`/shop/${orgSlug}/gift-cards`}
        className="flex items-center justify-between gap-3 rounded-2xl border border-pink-200 bg-pink-50/50 p-5 transition hover:shadow-sm"
      >
        <span>
          <span className="block font-black text-slate-900">{t.accountExtra.giftCardTitle}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{t.accountExtra.giftCardSub}</span>
        </span>
        <span className="shrink-0 text-lg font-bold text-pink-600">→</span>
      </Link>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={`rounded-full px-4 py-2 text-sm font-bold ${tab === tb.key ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* --- Orders tab --- */}
      {tab === "orders" ? (
        <div className="space-y-4">
          {detail ? (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-black text-slate-900">{t.account.orderDetail} — {detail.orderNumber}</h2>
                <button type="button" onClick={() => setDetail(null)} className="text-xs font-bold text-indigo-700 hover:underline">{t.account.backToOrders}</button>
              </div>
              <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                <p>{t.account.placedAtLabel}: <b className="text-slate-900">{fmtDateTime(locale, detail.placedAt)}</b></p>
                <p>{t.account.statusLabel}: <b className="text-slate-900">{detail.status}</b></p>
                <p>{t.account.totalLabel}: <b className="text-indigo-700">{money(detail.totalMinor)}</b></p>
              </div>
              {detail.address ? <p className="text-sm text-slate-600">{t.account.addressLabel}: {detail.address}</p> : null}
              <ul className="divide-y text-sm">
                {detail.items.map((i, idx) => (
                  <li key={idx} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      {i.name} × {i.quantity}
                      {i.isGift ? <span className="ml-2 rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-bold text-pink-700">{t.account.giftBadge}</span> : null}
                    </span>
                    <span className="font-semibold text-slate-900">{i.isGift ? money("0") : money(i.totalMinor)}</span>
                  </li>
                ))}
              </ul>
              <div className="space-y-1 border-t pt-3 text-sm">
                <div className="flex justify-between text-slate-600"><span>{t.account.subtotalLabel}:</span><span className="font-semibold text-slate-900">{money(detail.subtotalMinor)}</span></div>
                {BigInt(detail.discountMinor || "0") > 0n ? (
                  <div className="flex justify-between text-emerald-700"><span>{t.account.discountLabel}:</span><span className="font-semibold">− {money(detail.discountMinor)}</span></div>
                ) : null}
                <div className="flex justify-between text-slate-600"><span>{t.account.shippingLabel}:</span><span className="font-semibold text-slate-900">{money(detail.shippingMinor)}</span></div>
                <div className="flex justify-between border-t pt-2 font-black text-slate-900"><span>{t.account.totalLabel}:</span><span className="text-indigo-700">{money(detail.totalMinor)}</span></div>
              </div>
              {detail.giftSkipped ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{t.success.giftSkippedNote}</p> : null}
              {unavailable.length > 0 ? (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <p className="font-bold">{t.account.reorderUnavailable}</p>
                  <ul className="mt-1 list-disc pl-4">
                    {unavailable.map((u, i) => <li key={i}>{u.name} — {u.reason}</li>)}
                  </ul>
                </div>
              ) : null}
              {reorderNote ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{reorderNote}</p> : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => doReorder(detail.id)}
                  disabled={reorderBusy}
                  className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {reorderBusy ? t.account.reordering : `🔁 ${t.account.reorder}`}
                </button>
                {detail.hasTracking ? (
                  <Link href={`/track/${orgSlug}`} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-bold text-slate-700">📦 {t.success.trackOrder}</Link>
                ) : null}
              </div>
            </div>
          ) : ordersLoading ? (
            <p className="text-sm font-semibold text-slate-500">{t.account.loading}</p>
          ) : orders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <p className="text-3xl">📦</p>
              <p className="mt-2 text-sm font-semibold text-slate-600">{t.account.ordersEmpty}</p>
              <Link href={`/shop/${orgSlug}`} className="mt-3 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white">{t.cart.startShopping}</Link>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {orders.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => openDetail(o.id)}
                    className="block w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:shadow-md"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900">{o.orderNumber}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">{o.status}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500">
                      <span>{fmtDate(locale, o.placedAt)}</span>
                      <span>{o.itemCount} {t.account.itemsLabel}</span>
                      <span className="font-bold text-indigo-700">{money(o.totalMinor)}</span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-slate-500">{o.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</p>
                  </button>
                ))}
              </div>
              {ordersTotalPages > 1 ? (
                <div className="flex items-center justify-center gap-2">
                  <button type="button" disabled={ordersPage <= 1} onClick={() => loadOrders(ordersPage - 1)} className="rounded-lg border bg-white px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">{t.home.prevPage}</button>
                  <span className="text-xs font-semibold text-slate-500">{t.home.page} {ordersPage} / {ordersTotalPages}</span>
                  <button type="button" disabled={ordersPage >= ordersTotalPages} onClick={() => loadOrders(ordersPage + 1)} className="rounded-lg border bg-white px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">{t.home.nextPage}</button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* --- MX14: Notifications tab --- */}
      {tab === "notifications" ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-black text-slate-900">{t.accountExtra.notifTitle}</h2>
            {notifUnread > 0 ? (
              <button type="button" onClick={markAllRead} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                {t.accountExtra.markAllRead}
              </button>
            ) : null}
          </div>
          {notifications.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <p className="text-3xl">🔔</p>
              <p className="mt-2 text-sm font-semibold text-slate-600">{t.accountExtra.noNotifYet}</p>
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => openNotification(n)}
                className={`block w-full rounded-2xl border p-4 text-left shadow-sm transition hover:shadow-md ${n.isRead ? "border-slate-200 bg-white" : "border-indigo-200 bg-indigo-50/60"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{n.title}</span>
                  {!n.isRead ? <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">{t.accountExtra.newBadge}</span> : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{n.body}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {n.createdAt ? fmtDateTime(locale, n.createdAt) : ""}
                  {n.url ? t.accountExtra.clickToOpen : ""}
                </p>
              </button>
            ))
          )}
        </div>
      ) : null}

      {/* --- Wishlist tab --- */}
      {tab === "wishlist" ? (
        wishItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-3xl">❤️</p>
            <p className="mt-2 text-sm font-semibold text-slate-600">{t.account.wishlistEmpty}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {wishItems.map((item) => {
              const badge = stockBadge(item.stockState, locale);
              const card = (
                <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  {item.imageUrl ? (
                    <MediaImage src={item.imageUrl} alt={item.name} width={640} height={640} sizes="(max-width: 768px) 50vw, 320px" className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-indigo-50 text-4xl">📦</div>
                  )}
                  <div className="flex flex-1 flex-col space-y-1.5 p-3">
                    <h3 className="line-clamp-2 text-sm font-bold text-slate-900">{item.name}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-indigo-700">{priceText(item.currentPriceMinor)}</span>
                      {item.priceDropped ? (
                        <>
                          <span className="text-xs text-slate-400 line-through">{priceText(item.priceAtAddMinor)}</span>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{t.account.priceDropped}</span>
                        </>
                      ) : null}
                      {badge ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.label}</span> : null}
                    </div>
                    <div className="mt-auto flex gap-2 pt-2">
                      <button
                        type="button"
                        disabled={wishBusy === item.productId || item.stockState === "out_of_stock"}
                        onClick={() => wishAddToCart(item)}
                        className="flex-1 rounded-lg bg-indigo-600 px-2 py-2 text-[11px] font-bold text-white disabled:opacity-50"
                      >
                        {wishBusy === `added-${item.productId}` ? t.account.addedToCart : t.account.addToCart}
                      </button>
                      <button
                        type="button"
                        disabled={wishBusy === item.productId}
                        onClick={() => wishRemove(item)}
                        className="rounded-lg border px-2 py-2 text-[11px] font-bold text-rose-600 disabled:opacity-50"
                      >
                        {t.account.remove}
                      </button>
                    </div>
                  </div>
                </div>
              );
              return item.slug ? (
                <div key={item.productId}>{card}</div>
              ) : (
                <div key={item.productId}>{card}</div>
              );
            })}
          </div>
        )
      ) : null}

      {/* --- Addresses tab --- */}
      {tab === "addresses" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-black text-slate-900">{t.account.addressesTitle}</h2>
            {!addrForm ? (
              <button
                type="button"
                onClick={() => setAddrForm({ id: null, label: "", recipientName: customer.name ?? "", phone: customer.phone, addressLine: "", district: "ঢাকা", isDefault: addresses.length === 0 })}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white"
              >
                + {t.account.addAddress}
              </button>
            ) : null}
          </div>
          {addresses.length === 0 && !addrForm ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-semibold text-slate-600">{t.account.addressesEmpty}</p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {addresses.map((a) => (
              <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-slate-900">
                    {a.recipientName}
                    {a.label ? <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">{a.label}</span> : null}
                    {a.isDefault ? <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{t.account.defaultBadge}</span> : null}
                  </p>
                </div>
                <p className="mt-1 text-sm text-slate-600">{a.addressLine}</p>
                <p className="text-xs text-slate-500">{a.district} · <span className="font-mono">{a.phone}</span></p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setAddrForm({ id: a.id, label: a.label ?? "", recipientName: a.recipientName, phone: a.phone, addressLine: a.addressLine, district: a.district, isDefault: a.isDefault })} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-slate-700">{t.account.editAddress}</button>
                  {!a.isDefault ? (
                    <button type="button" onClick={() => makeDefault(a)} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-slate-700">{t.account.setDefault}</button>
                  ) : null}
                  <button type="button" onClick={() => removeAddress(a)} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-rose-600">{t.account.deleteAddress}</button>
                </div>
              </div>
            ))}
          </div>
          {addrForm ? (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="font-bold text-slate-900">{addrForm.id ? t.account.editAddress : t.account.addAddress}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">{t.account.labelLabel}</label>
                  <input value={addrForm.label} onChange={(e) => setAddrForm({ ...addrForm, label: e.target.value })} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">{t.account.nameLabel} *</label>
                  <input required value={addrForm.recipientName} onChange={(e) => setAddrForm({ ...addrForm, recipientName: e.target.value })} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">{t.account.phoneLabel} *</label>
                  <input required type="tel" value={addrForm.phone} onChange={(e) => setAddrForm({ ...addrForm, phone: e.target.value })} className="w-full rounded-xl border border-slate-300 p-2.5 font-mono text-sm focus:border-indigo-600 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">{t.account.districtLabel} *</label>
                  <select value={addrForm.district} onChange={(e) => setAddrForm({ ...addrForm, district: e.target.value })} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none">
                    {BD_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-slate-700">{t.account.addressLabel} *</label>
                  <textarea required rows={2} value={addrForm.addressLine} onChange={(e) => setAddrForm({ ...addrForm, addressLine: e.target.value })} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={addrForm.isDefault} onChange={(e) => setAddrForm({ ...addrForm, isDefault: e.target.checked })} />
                {t.account.setDefault}
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={saveAddress} disabled={addrBusy || !addrForm.recipientName.trim() || !addrForm.phone.trim() || !addrForm.addressLine.trim()} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {addrBusy ? t.account.saving : t.account.save}
                </button>
                <button type="button" onClick={() => setAddrForm(null)} className="rounded-xl border px-5 py-2.5 text-sm font-bold text-slate-700">{t.account.cancel}</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* --- Profile tab --- */}
      {tab === "profile" ? (
        <div className="max-w-lg space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-black text-slate-900">{t.account.profileTitle}</h2>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">{t.account.nameLabel}</label>
            <input value={profName} onChange={(e) => setProfName(e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">{t.account.emailLabel}</label>
            <input type="email" value={profEmail} onChange={(e) => setProfEmail(e.target.value)} className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-indigo-600 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">{t.account.phoneLabel}</label>
            <input value={customer.phone} disabled className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 font-mono text-sm text-slate-500" />
            <p className="mt-1 text-[11px] text-slate-400">{t.account.phoneFixedNote}</p>
          </div>
          {profSaved ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{t.account.savedNote}</p> : null}
          <button type="button" onClick={saveProfile} disabled={profBusy} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {profBusy ? t.account.saving : t.account.save}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function ShopAccountPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl px-4 py-16 text-center text-sm font-semibold text-slate-500">{shopT("bn").account.loading}</div>}>
      <AccountInner />
    </Suspense>
  );
}
