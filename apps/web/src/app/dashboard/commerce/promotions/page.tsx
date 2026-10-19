"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDateTime, fmtMoney, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useConfirm, useToast } from "@repo/ui/client";
import { ResponsiveTable } from "@repo/ui";

// EC16 — promotions engine UI: BOGO / tiered / flash-sale rules plus
// referrals (referral settings live on the storefront page). The
// cart simulator renders ONLY the server's preview response — no
// client-side price math anywhere on this page.

interface Promotion {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  startsAt?: string | null;
  endsAt?: string | null;
  active: boolean;
  priority: number;
  createdAt: string;
}
// GB7 (GC17): promotions report payload.
interface PromotionsReport {
  from: string;
  to: string;
  coupons: { code: string; redemptions: number; discountTotalMinor: string; revenueMinor: string }[];
  promotions: { promotionId: string; name: string; applications: number; discountTotalMinor: string }[];
  coverage: { ordersScanned: number; truncated: boolean; note: string };
}
interface ProductOpt { id: string; name: string }
interface CategoryOpt { id: string; name: string }
interface TierRow { thresholdKind: "amount" | "qty"; threshold: string; percentOff: string }
interface PreviewResult {
  items: unknown[];
  subtotalMinor: string;
  promotionDiscountMinor: string;
  promotionsApplied: { promotionId: string; name: string; type: string; amountMinor: string }[];
  coupon: { code: string; discountMinor: string; freeShipping: boolean } | null;
  referral: { code: string; discountMinor: string } | null;
  referralDiscountMinor: string;
  totalDiscountMinor: string;
  merchandiseTotalMinor: string;
  currency: string;
  // EC29: free-gift outcome of the preview (null when no gift applies).
  gift?: { promotionName: string; productName: string; quantity: number } | null;
}

const TYPE_LABEL: Record<string, string> = {
  bogo: "bOGOBuyGetFreeDiscount",
  tiered: "tieredQuantityValueBased",
  flash: "flashSaleTimeLimited",
  gift: "gift2",
};

const money = (minor?: string | null, locale: "bn" | "en" = "bn") =>
  minor == null ? "—" : fmtMoney(locale, Number(minor) / 100, { maximumFractionDigits: 2 });

const toMinorString = (taka: string): string => String(Math.round(parseFloat(taka || "0") * 100));
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function ChipPicker({ options, selected, onToggle }: {
  options: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const { dict, t, locale } = useLocale();
  if (options.length === 0) return <span className="text-xs text-slate-500">{dict.commerce.noOptions}</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button key={o.id} type="button" onClick={() => onToggle(o.id)}
            className={`inline-flex min-h-[44px] items-center justify-center rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
            {o.name}
          </button>
        );
      })}
    </div>
  );
}

export default function PromotionsPage() {
  const { dict, t, locale } = useLocale();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [categories, setCategories] = useState<CategoryOpt[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  // create/edit form (common)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("bogo");
  const [priority, setPriority] = useState("0");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [active, setActive] = useState(true);
  // GB7 (GC17): shared config field — minimum prior orders.
  const [minPriorOrders, setMinPriorOrders] = useState("");

  // BOGO config
  const [buyScope, setBuyScope] = useState<"product" | "category">("product");
  const [buyId, setBuyId] = useState("");
  const [buyQty, setBuyQty] = useState("1");
  const [getScope, setGetScope] = useState<"product" | "category">("product");
  const [getId, setGetId] = useState("");
  const [getQty, setGetQty] = useState("1");
  const [getDiscountPercent, setGetDiscountPercent] = useState("100");

  // Tiered config
  const [tierScope, setTierScope] = useState<"subtotal" | "category">("subtotal");
  const [tierCategoryId, setTierCategoryId] = useState("");
  const [tiers, setTiers] = useState<TierRow[]>([{ thresholdKind: "amount", threshold: "1000", percentOff: "10" }]);

  // Flash config
  const [flashPercentOff, setFlashPercentOff] = useState("20");
  const [flashProductIds, setFlashProductIds] = useState<string[]>([]);
  const [flashCategoryIds, setFlashCategoryIds] = useState<string[]>([]);

  // EC29: Gift config — free product over a minimum subtotal.
  const [giftMinSubtotal, setGiftMinSubtotal] = useState("1000");
  const [giftProductId, setGiftProductId] = useState("");
  const [giftVariantSku, setGiftVariantSku] = useState("");
  const [giftQty, setGiftQty] = useState("1");

  // Cart simulator
  const [simRows, setSimRows] = useState<{ productId: string; qty: string }[]>([{ productId: "", qty: "1" }]);
  const [simCoupon, setSimCoupon] = useState("");
  const [simReferral, setSimReferral] = useState("");
  const [simPhone, setSimPhone] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState("");

  // GB7 (GC17): report section (default range: last 30 days).
  const [reportFrom, setReportFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [reportTo, setReportTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<PromotionsReport | null>(null);
  const [reportError, setReportError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [list, p, c] = await Promise.all([
        apiFetch<{ items: Promotion[] }>(`/organizations/${orgId}/commerce/promotions`),
        apiFetch<{ items: ProductOpt[] }>(`/organizations/${orgId}/products?pageSize=100`).catch(() => ({ items: [] as ProductOpt[] })),
        apiFetch<CategoryOpt[]>(`/organizations/${orgId}/products/categories`).catch(() => [] as CategoryOpt[]),
      ]);
      setPromotions(list.items ?? []);
      setProducts(p.items ?? []);
      setCategories(c ?? []);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.loadingFailed); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setEditingId(null); setName(""); setType("bogo"); setPriority("0");
    setStartsAt(""); setEndsAt(""); setActive(true); setMinPriorOrders("");
    setBuyScope("product"); setBuyId(""); setBuyQty("1");
    setGetScope("product"); setGetId(""); setGetQty("1"); setGetDiscountPercent("100");
    setTierScope("subtotal"); setTierCategoryId("");
    setTiers([{ thresholdKind: "amount", threshold: "1000", percentOff: "10" }]);
    setFlashPercentOff("20"); setFlashProductIds([]); setFlashCategoryIds([]);
    setGiftMinSubtotal("1000"); setGiftProductId(""); setGiftVariantSku(""); setGiftQty("1");
  }

  function startEdit(p: Promotion) {
    resetForm();
    setEditingId(p.id); setName(p.name); setType(p.type);
    setPriority(String(p.priority)); setActive(p.active);
    setStartsAt(p.startsAt ? p.startsAt.slice(0, 16) : "");
    setEndsAt(p.endsAt ? p.endsAt.slice(0, 16) : "");
    const cfg = p.config ?? {};
    setMinPriorOrders(typeof cfg.minPriorOrders === "number" ? String(cfg.minPriorOrders) : "");
    if (p.type === "bogo") {
      if (str(cfg.buyCategoryId)) { setBuyScope("category"); setBuyId(str(cfg.buyCategoryId)); }
      else if (str(cfg.buyProductId)) { setBuyScope("product"); setBuyId(str(cfg.buyProductId)); }
      if (str(cfg.getCategoryId)) { setGetScope("category"); setGetId(str(cfg.getCategoryId)); }
      else if (str(cfg.getProductId)) { setGetScope("product"); setGetId(str(cfg.getProductId)); }
      setBuyQty(String(num(cfg.buyQty, 1)));
      setGetQty(String(num(cfg.getQty, 1)));
      setGetDiscountPercent(String(num(cfg.getDiscountPercent, 100)));
    } else if (p.type === "tiered") {
      setTierScope(cfg.scope === "category" ? "category" : "subtotal");
      setTierCategoryId(str(cfg.categoryId));
      const rows = Array.isArray(cfg.tiers) ? cfg.tiers : [];
      if (rows.length > 0) {
        setTiers(rows.map((t) => {
          const row = (t ?? {}) as Record<string, unknown>;
          if (typeof row.minAmountMinor === "string") {
            return { thresholdKind: "amount" as const, threshold: String(Number(row.minAmountMinor) / 100), percentOff: String(num(row.percentOff, 0)) };
          }
          return { thresholdKind: "qty" as const, threshold: String(num(row.minQty, 0)), percentOff: String(num(row.percentOff, 0)) };
        }));
      }
    } else if (p.type === "flash") {
      setFlashPercentOff(String(num(cfg.percentOff, 0)));
      setFlashProductIds(strArr(cfg.productIds));
      setFlashCategoryIds(strArr(cfg.categoryIds));
    } else if (p.type === "gift") {
      setGiftMinSubtotal(typeof cfg.minSubtotalMinor === "string" ? String(Number(cfg.minSubtotalMinor) / 100) : "1000");
      setGiftProductId(str(cfg.giftProductId));
      setGiftVariantSku(str(cfg.giftVariantSku));
      setGiftQty(String(num(cfg.giftQty, 1)));
    }
  }

  function buildConfig(): Record<string, unknown> {
    if (type === "bogo") {
      return {
        ...(buyScope === "product" ? { buyProductId: buyId || undefined } : { buyCategoryId: buyId || undefined }),
        buyQty: Math.max(1, parseInt(buyQty || "1", 10) || 1),
        ...(getScope === "product" ? { getProductId: getId || undefined } : { getCategoryId: getId || undefined }),
        getQty: Math.max(1, parseInt(getQty || "1", 10) || 1),
        getDiscountPercent: Math.min(100, Math.max(0, parseInt(getDiscountPercent || "0", 10) || 0)),
      };
    }
    if (type === "tiered") {
      return {
        scope: tierScope,
        ...(tierScope === "category" ? { categoryId: tierCategoryId || undefined } : {}),
        tiers: tiers.map((t) => ({
          ...(t.thresholdKind === "amount"
            ? { minAmountMinor: toMinorString(t.threshold) }
            : { minQty: Math.max(0, parseInt(t.threshold || "0", 10) || 0) }),
          percentOff: Math.min(100, Math.max(0, parseInt(t.percentOff || "0", 10) || 0)),
        })),
      };
    }
    if (type === "gift") {
      return {
        minSubtotalMinor: toMinorString(giftMinSubtotal),
        giftProductId: giftProductId || undefined,
        ...(giftVariantSku.trim() ? { giftVariantSku: giftVariantSku.trim() } : {}),
        giftQty: Math.min(3, Math.max(1, parseInt(giftQty || "1", 10) || 1)),
      };
    }
    return {
      percentOff: Math.min(100, Math.max(0, parseInt(flashPercentOff || "0", 10) || 0)),
      ...(flashProductIds.length ? { productIds: flashProductIds } : {}),
      ...(flashCategoryIds.length ? { categoryIds: flashCategoryIds } : {}),
    };
  }

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (type === "flash" && (!startsAt || !endsAt)) {
      setError(dict.commerce.flashSalesRequireAStart);
      return;
    }
    if (type === "gift" && !giftProductId) {
      setError(dict.commerce.selectAGiftProductFor);
      return;
    }
    setBusy("save"); setError("");
    const priorOrders = minPriorOrders.trim() ? Math.max(0, parseInt(minPriorOrders, 10) || 0) : null;
    const body = {
      name: name.trim(),
      type,
      config: {
        ...buildConfig(),
        // GB7: shared optional field — included only when set.
        ...(priorOrders != null ? { minPriorOrders: priorOrders } : {}),
      },
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      active,
      priority: parseInt(priority || "0", 10) || 0,
    };
    try {
      if (editingId) {
        await apiFetch<{ promotion: Promotion }>(`/organizations/${orgId}/commerce/promotions/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
        toast({ title: dict.commerce.promotionUpdated, tone: "success" });
      } else {
        await apiFetch<{ promotion: Promotion }>(`/organizations/${orgId}/commerce/promotions`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: dict.commerce.promotionCreated, tone: "success" });
      }
      resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.saveFailed3); }
    finally { setBusy(""); }
  }

  async function toggleActive(p: Promotion) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`active-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/promotions/${p.id}/active`, {
        method: "POST", body: JSON.stringify({ active: !p.active }),
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.failed); }
    finally { setBusy(""); }
  }

  async function remove(p: Promotion) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: t("commerce.deleteThePromotion", { name: p.name }), danger: true, confirmLabel: dict.commerce.delete2 }))) return;
    setBusy(`del-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/promotions/${p.id}`, { method: "DELETE" });
      if (editingId === p.id) resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.deleteFailed); }
    finally { setBusy(""); }
  }

  async function runPreview() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const items = simRows
      .filter((r) => r.productId)
      .map((r) => ({ productId: r.productId, quantity: Math.max(1, parseInt(r.qty || "1", 10) || 1) }));
    if (items.length === 0) { setPreviewError(dict.commerce.selectAtLeastOneProduct2); setPreview(null); return; }
    setBusy("preview"); setPreviewError(""); setPreview(null);
    try {
      const out = await apiFetch<PreviewResult>(`/organizations/${orgId}/commerce/promotions/preview`, {
        method: "POST",
        body: JSON.stringify({
          items,
          couponCode: simCoupon.trim() || undefined,
          referralCode: simReferral.trim() || undefined,
          buyerPhone: simPhone.trim() || undefined,
        }),
      });
      setPreview(out);
    } catch (e) { setPreviewError(e instanceof Error ? e.message : dict.commerce.calculationFailed); }
    finally { setBusy(""); }
  }

  async function runReport() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("report"); setReportError(""); setReport(null);
    try {
      const qs = new URLSearchParams();
      if (reportFrom) qs.set("from", reportFrom);
      if (reportTo) qs.set("to", reportTo);
      const out = await apiFetch<PromotionsReport>(`/organizations/${orgId}/commerce/promotions/report?${qs.toString()}`);
      setReport(out);
    } catch (e) { setReportError(e instanceof Error ? e.message : dict.commerce.reportFailed); }
    finally { setBusy(""); }
  }

  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  // ED15/ED16 (EB6): promotion row actions + status shared verbatim
  // by the desktop table and the ResponsiveTable mobile card.
  const renderPromotionStatus = (p: Promotion) => (
    p.active ? <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">{dict.commerce.active}</span> : <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{dict.commerce.closed}</span>
  );
  const renderPromotionActions = (p: Promotion) => (
    <div className="flex gap-2">
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold" onClick={() => startEdit(p)}>{dict.commerce.edit}</button>
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleActive(p)}>{p.active ? dict.commerce.close : dict.commerce.enable}</button>
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => remove(p)}>{dict.commerce.delete}</button>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{dict.commerce.promotions2}</h1>
          <p className="text-sm text-slate-500">
            {dict.commerce.bOGOTieredFlashSaleOffers}</p>
        </div>
        <Link href="/dashboard/commerce" className="btn-primary">← Commerce Hub</Link>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <div className="card p-5 space-y-4">
        <div className="font-semibold">{editingId ? dict.commerce.editPromotion : dict.commerce.newPromotion}</div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">{dict.commerce.name}<input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={dict.commerce.eGBuy2Get} />
          </label>
          <label className="block text-sm">{dict.commerce.type}<select className="input mt-1" value={type} disabled={!!editingId} onChange={(e) => setType(e.target.value)}>
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{dict.commerce[l as keyof typeof dict.commerce]}</option>)}
            </select>
          </label>
          <label className="block text-sm">{dict.commerce.priorityBiggerEarlier}<input className="input mt-1" type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </label>
          <label className="block text-sm">{dict.commerce.start}{type === "flash" ? dict.commerce.required : dict.commerce.emptyNow}
            <input className="input mt-1" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label className="block text-sm">{dict.commerce.end}{type === "flash" ? dict.commerce.required : dict.commerce.emptyUnlimited}
            <input className="input mt-1" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {dict.commerce.active}</label>
          <label className="block text-sm">{dict.commerce.minimumPreviousOrdersEmptyNo}<input className="input mt-1" type="number" min="0" value={minPriorOrders} onChange={(e) => setMinPriorOrders(e.target.value)} placeholder={dict.commerce.eG1} />
            <span className="mt-1 block text-xs font-normal text-slate-500">{dict.commerce.appliesToAllPromotionTypes}</span>
          </label>
        </div>

        {type === "bogo" ? (
          <div className="space-y-3 border-t pt-4">
            <div className="font-semibold">{dict.commerce.bOGOSettings}</div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="block text-sm">{dict.commerce.buyBasis}<select className="input mt-1" value={buyScope} onChange={(e) => { setBuyScope(e.target.value as "product" | "category"); setBuyId(""); }}>
                  <option value="product">{dict.commerce.product}</option>
                  <option value="category">{dict.commerce.category}</option>
                </select>
              </label>
              <label className="block text-sm">{buyScope === "product" ? dict.commerce.selectAProduct : dict.commerce.selectACategory}
                <select className="input mt-1" value={buyId} onChange={(e) => setBuyId(e.target.value)}>
                  <option value="">{dict.commerce.select}</option>
                  {(buyScope === "product" ? products : categories).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">{dict.commerce.howManyToBuy}<input className="input mt-1" type="number" min="1" value={buyQty} onChange={(e) => setBuyQty(e.target.value)} />
              </label>
              <label className="block text-sm">{dict.commerce.getDiscountRate}<input className="input mt-1" type="number" min="0" max="100" value={getDiscountPercent} onChange={(e) => setGetDiscountPercent(e.target.value)} />
              </label>
              <label className="block text-sm">{dict.commerce.getBasis}<select className="input mt-1" value={getScope} onChange={(e) => { setGetScope(e.target.value as "product" | "category"); setGetId(""); }}>
                  <option value="product">{dict.commerce.product}</option>
                  <option value="category">{dict.commerce.category}</option>
                </select>
              </label>
              <label className="block text-sm">{getScope === "product" ? dict.commerce.selectAProduct : dict.commerce.selectACategory}
                <select className="input mt-1" value={getId} onChange={(e) => setGetId(e.target.value)}>
                  <option value="">{dict.commerce.select}</option>
                  {(getScope === "product" ? products : categories).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">{dict.commerce.howManyYouGet}<input className="input mt-1" type="number" min="1" value={getQty} onChange={(e) => setGetQty(e.target.value)} />
              </label>
            </div>
            <p className="text-xs text-slate-500">{dict.commerce.a100DiscountRateCompletely}</p>
          </div>
        ) : null}

        {type === "tiered" ? (
          <div className="space-y-3 border-t pt-4">
            <div className="font-semibold">{dict.commerce.tieredSettings}</div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">{dict.commerce.basisScope}<select className="input mt-1" value={tierScope} onChange={(e) => setTierScope(e.target.value as "subtotal" | "category")}>
                  <option value="subtotal">{dict.commerce.wholeCartSubtotal}</option>
                  <option value="category">{dict.commerce.specificCategory}</option>
                </select>
              </label>
              {tierScope === "category" ? (
                <label className="block text-sm">{dict.commerce.selectACategory}<select className="input mt-1" value={tierCategoryId} onChange={(e) => setTierCategoryId(e.target.value)}>
                    <option value="">{dict.commerce.select}</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="space-y-2">
              {tiers.map((t, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <label className="block text-sm">{dict.commerce.conditionType}<select className="input mt-1" value={t.thresholdKind} onChange={(e) => {
                      const next = [...tiers]; next[i] = { ...t, thresholdKind: e.target.value as "amount" | "qty" }; setTiers(next);
                    }}>
                      <option value="amount">{dict.commerce.minimumPriceTaka}</option>
                      <option value="qty">{dict.commerce.minimumQuantity}</option>
                    </select>
                  </label>
                  <label className="block text-sm">{t.thresholdKind === "amount" ? dict.commerce.minimumPriceTaka : dict.commerce.minimumQuantity2}
                    <input className="input mt-1 w-36" type="number" value={t.threshold} onChange={(e) => {
                      const next = [...tiers]; next[i] = { ...t, threshold: e.target.value }; setTiers(next);
                    }} />
                  </label>
                  <label className="block text-sm">{dict.commerce.discount2}<input className="input mt-1 w-24" type="number" min="0" max="100" value={t.percentOff} onChange={(e) => {
                      const next = [...tiers]; next[i] = { ...t, percentOff: e.target.value }; setTiers(next);
                    }} />
                  </label>
                  <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-2 text-xs font-semibold text-rose-600 disabled:opacity-50"
                    disabled={tiers.length <= 1}
                    onClick={() => setTiers(tiers.filter((_, x) => x !== i))}>{dict.commerce.deleteRow}</button>
                </div>
              ))}
              <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold"
                onClick={() => setTiers([...tiers, { thresholdKind: "amount", threshold: "", percentOff: "" }])}>
                {dict.commerce.addAnotherTier}</button>
            </div>
          </div>
        ) : null}

        {type === "flash" ? (
          <div className="space-y-3 border-t pt-4">
            <div className="font-semibold">{dict.commerce.flashSaleSettings}</div>
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{dict.commerce.aTimeRangeIsRequired}</p>
            <label className="block max-w-xs text-sm">{dict.commerce.discountRate}<input className="input mt-1" type="number" min="0" max="100" value={flashPercentOff} onChange={(e) => setFlashPercentOff(e.target.value)} />
            </label>
            <div>
              <div className="text-sm font-medium">{dict.commerce.applicableProductsSelectNoneAll}</div>
              <div className="mt-2">
                <ChipPicker options={products} selected={flashProductIds} onToggle={(id) => setFlashProductIds(toggleIn(flashProductIds, id))} />
              </div>
            </div>
            <div>
              <div className="text-sm font-medium">{dict.commerce.applicableCategoriesOptional}</div>
              <div className="mt-2">
                <ChipPicker options={categories} selected={flashCategoryIds} onToggle={(id) => setFlashCategoryIds(toggleIn(flashCategoryIds, id))} />
              </div>
            </div>
          </div>
        ) : null}

        {type === "gift" ? (
          <div className="space-y-3 border-t pt-4">
            <div className="font-semibold">{dict.commerce.giftSettings}</div>
            <p className="text-xs text-slate-500">
              {dict.commerce.whenTheCartSubtotalReaches}</p>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="block text-sm">{dict.commerce.minimumSubtotalTaka}<input className="input mt-1" inputMode="decimal" value={giftMinSubtotal} onChange={(e) => setGiftMinSubtotal(e.target.value)} placeholder={dict.commerce.eG1000} />
              </label>
              <label className="block text-sm">{dict.commerce.giftProduct}<select className="input mt-1" value={giftProductId} onChange={(e) => setGiftProductId(e.target.value)}>
                  <option value="">{dict.commerce.select}</option>
                  {products.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">{dict.commerce.variantSKUOptional}<input className="input mt-1" value={giftVariantSku} onChange={(e) => setGiftVariantSku(e.target.value)} placeholder={dict.commerce.eGREDL} />
              </label>
              <label className="block text-sm">{dict.commerce.giftQuantity13}<input className="input mt-1" type="number" min="1" max="3" value={giftQty} onChange={(e) => setGiftQty(e.target.value)} />
              </label>
            </div>
          </div>
        ) : null}

        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy !== "" || !name.trim()} onClick={save}>
            {busy === "save" ? dict.commerce.saving2 : editingId ? dict.commerce.update : dict.commerce.create}
          </button>
          {editingId ? <button className="rounded-lg border px-3 py-2 text-sm" onClick={resetForm}>{dict.common.cancel}</button> : null}
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <div className="font-semibold">{dict.commerce.allPromotions}{promotions.length})</div>
        {loading ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : promotions.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.commerce.noPromotionsYet}</p>
        ) : (
          <ResponsiveTable
            table={
              <div>
                <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 font-medium">{dict.commerce.name}</th><th className="py-2 font-medium">{dict.commerce.type}</th>
                  <th className="py-2 font-medium">{dict.commerce.priority}</th><th className="py-2 font-medium">{dict.commerce.deadline}</th>
                  <th className="py-2 font-medium">{dict.commerce.status}</th><th className="py-2 font-medium">{dict.commerce.action}</th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 align-top">
                    <td className="py-2 font-semibold">{p.name}
                      {typeof p.config?.minPriorOrders === "number" ? (
                        <div className="text-[11px] font-normal text-slate-500">{dict.commerce.atLeast}{p.config.minPriorOrders}{dict.commerce.previousOrders}</div>
                      ) : null}
                    </td>
                    <td className="py-2"><span className="rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{TYPE_LABEL[p.type] ? dict.commerce[TYPE_LABEL[p.type] as keyof typeof dict.commerce] : p.type}</span></td>
                    <td className="py-2">{p.priority}</td>
                    <td className="py-2 text-xs text-slate-500">{p.startsAt ? fmtDateTime(locale, new Date(p.startsAt)) : "—"} → {p.endsAt ? fmtDateTime(locale, new Date(p.endsAt)) : dict.commerce.unlimited}</td>
                    <td className="py-2">{renderPromotionStatus(p)}</td>
                    <td className="py-2">
                      {renderPromotionActions(p)}
                    </td>
                  </tr>
                ))}
                </tbody>
                </table>
              </div>
            }
            cards={promotions.map((p) => (
              <div key={p.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{p.name}</span>
                  {renderPromotionStatus(p)}
                </div>
                {typeof p.config?.minPriorOrders === "number" ? (
                  <div className="mt-0.5 text-[11px] font-normal text-slate-500">{dict.commerce.atLeast}{p.config.minPriorOrders}{dict.commerce.previousOrders}</div>
                ) : null}
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.type}</dt>
                    <dd><span className="rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{TYPE_LABEL[p.type] ? dict.commerce[TYPE_LABEL[p.type] as keyof typeof dict.commerce] : p.type}</span></dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.priority}</dt>
                    <dd>{p.priority}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.deadline}</dt>
                    <dd className="text-xs text-slate-500">{p.startsAt ? fmtDateTime(locale, new Date(p.startsAt)) : "—"} → {p.endsAt ? fmtDateTime(locale, new Date(p.endsAt)) : dict.commerce.unlimited}</dd>
                  </div>
                </dl>
                <div className="mt-2">{renderPromotionActions(p)}</div>
              </div>
            ))}
          />
        )}
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <div className="font-semibold">{dict.commerce.cartSimulator}</div>
          <p className="text-xs text-slate-500">{dict.commerce.selectProductsQuantitiesCalculateAll}</p>
        </div>
        <div className="space-y-2">
          {simRows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="block flex-1 text-sm">{dict.commerce.product}<select className="input mt-1" value={r.productId} onChange={(e) => {
                  const next = [...simRows]; next[i] = { ...r, productId: e.target.value }; setSimRows(next);
                }}>
                  <option value="">{dict.commerce.select}</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">{dict.commerce.quantity}<input className="input mt-1 w-24" type="number" min="1" value={r.qty} onChange={(e) => {
                  const next = [...simRows]; next[i] = { ...r, qty: e.target.value }; setSimRows(next);
                }} />
              </label>
              <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-2 text-xs font-semibold text-rose-600 disabled:opacity-50"
                disabled={simRows.length <= 1}
                onClick={() => setSimRows(simRows.filter((_, x) => x !== i))}>{dict.commerce.remove}</button>
            </div>
          ))}
          <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold"
            onClick={() => setSimRows([...simRows, { productId: "", qty: "1" }])}>{dict.commerce.addProduct}</button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">{dict.commerce.couponCodeOptional}<input className="input mt-1" value={simCoupon} onChange={(e) => setSimCoupon(e.target.value.toUpperCase())} placeholder={dict.commerce.eGEID10} />
          </label>
          <label className="block text-sm">{dict.commerce.referralCodeOptional}<input className="input mt-1" value={simReferral} onChange={(e) => setSimReferral(e.target.value)} placeholder={dict.commerce.friendSCode} />
          </label>
          <label className="block text-sm">{dict.commerce.buyerPhoneMayBeNeeded}<input className="input mt-1" value={simPhone} onChange={(e) => setSimPhone(e.target.value)} placeholder="01XXXXXXXXX" />
          </label>
        </div>
        <button className="btn-primary" disabled={busy !== ""} onClick={runPreview}>
          {busy === "preview" ? dict.commerce.calculating : dict.commerce.calculate}
        </button>
        {previewError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{previewError}</p> : null}
        {preview ? (
          <div className="space-y-2 rounded-xl border bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><span className="text-slate-600">{dict.commerce.subtotal2}</span><span className="font-semibold">{money(preview.subtotalMinor, locale)}</span></div>
            {preview.promotionsApplied.map((a) => (
              <div key={a.promotionId} className="flex justify-between text-emerald-700">
                <span>🎁 {a.name} ({TYPE_LABEL[a.type] ? dict.commerce[TYPE_LABEL[a.type] as keyof typeof dict.commerce] : a.type}):</span><span className="font-semibold">− {money(a.amountMinor, locale)}</span>
              </div>
            ))}
            {preview.gift ? (
              <div className="flex justify-between text-pink-700">
                <span>{dict.commerce.gift3}{preview.gift.productName} × {preview.gift.quantity} ({preview.gift.promotionName}):</span>
                <span className="font-semibold">{money("0")}</span>
              </div>
            ) : null}
            {Number(preview.promotionDiscountMinor) === 0 && preview.promotionsApplied.length === 0 ? (
              <div className="flex justify-between text-slate-500"><span>{dict.commerce.promotionDiscount}</span><span>{money(preview.promotionDiscountMinor, locale)}</span></div>
            ) : null}
            {preview.coupon ? (
              <div className="flex justify-between text-emerald-700">
                <span>{dict.commerce.coupon}{preview.coupon.code}):</span>
                <span className="font-semibold">− {money(preview.coupon.discountMinor, locale)}{preview.coupon.freeShipping ? dict.commerce.freeDelivery2 : ""}</span>
              </div>
            ) : null}
            {preview.referral ? (
              <div className="flex justify-between text-emerald-700">
                <span>{dict.commerce.referral}{preview.referral.code}):</span><span className="font-semibold">− {money(preview.referral.discountMinor, locale)}</span>
              </div>
            ) : Number(preview.referralDiscountMinor) > 0 ? (
              <div className="flex justify-between text-emerald-700"><span>{dict.commerce.referralDiscount2}</span><span className="font-semibold">− {money(preview.referralDiscountMinor, locale)}</span></div>
            ) : null}
            <div className="flex justify-between border-t pt-2"><span className="font-semibold">{dict.commerce.totalDiscount2}</span><span className="font-semibold text-emerald-700">− {money(preview.totalDiscountMinor, locale)}</span></div>
            <div className="flex justify-between text-base font-black"><span>{dict.commerce.productTotalAfterDiscount}</span><span className="text-indigo-700">{money(preview.merchandiseTotalMinor, locale)}</span></div>
            <p className="text-xs text-slate-500">{dict.commerce.deliveryChargesAreNotIn}{preview.currency}</p>
          </div>
        ) : null}
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <div className="font-semibold">{dict.commerce.promotionReport}</div>
          <p className="text-xs text-slate-500">{dict.commerce.selectAPeriodViewThe}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">{dict.commerce.startFrom}<input className="input mt-1" type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
          </label>
          <label className="block text-sm">{dict.commerce.endTo}<input className="input mt-1" type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
          </label>
          <button className="btn-primary" disabled={busy !== ""} onClick={runReport}>
            {busy === "report" ? dict.commerce.reportLoading : dict.commerce.viewReport}
          </button>
        </div>
        {reportError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{reportError}</p> : null}
        {report ? (
          <div className="space-y-5">
            <p className="text-xs text-slate-500">{report.coverage.note}</p>
            {report.coverage.truncated ? (
              <p className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                {dict.commerce.thisReportIsPartialOrders}{report.coverage.ordersScanned}{dict.commerce.notAllOrdersCountedBecause}</p>
            ) : (
              <p className="text-xs text-slate-500">{dict.commerce.ordersScanned}{report.coverage.ordersScanned}{dict.commerce.text1ou8}</p>
            )}
            <div>
              <div className="mb-2 text-sm font-semibold">{dict.commerce.coupon2}</div>
              {report.coupons.length === 0 ? (
                <p className="text-sm text-slate-500">{dict.commerce.noCouponRedemptionsInThis}</p>
              ) : (
                <ResponsiveTable
                  table={
                    <div>
                      <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-slate-500">
                        <th className="py-2 font-medium">{dict.commerce.code}</th><th className="py-2 font-medium">{dict.commerce.redemption}</th>
                        <th className="py-2 font-medium">{dict.commerce.totalDiscount}</th><th className="py-2 font-medium">{dict.commerce.revenue}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.coupons.map((c) => (
                        <tr key={c.code} className="border-b last:border-0">
                          <td className="py-2 font-mono font-semibold">{c.code}</td>
                          <td className="py-2">{c.redemptions}</td>
                          <td className="py-2 text-emerald-700">− {money(c.discountTotalMinor, locale)}</td>
                          <td className="py-2 font-semibold">{money(c.revenueMinor, locale)}</td>
                        </tr>
                      ))}
                      </tbody>
                      </table>
                    </div>
                  }
                  cards={report.coupons.map((c) => (
                    <div key={c.code} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono font-semibold">{c.code}</span>
                        <span className="font-semibold">{money(c.revenueMinor, locale)}</span>
                      </div>
                      <dl className="mt-2 space-y-1.5 text-sm">
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.redemption}</dt>
                          <dd>{c.redemptions}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.totalDiscount}</dt>
                          <dd className="text-emerald-700">− {money(c.discountTotalMinor, locale)}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                />
              )}
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold">{dict.commerce.automaticPromotions}</div>
              {report.promotions.length === 0 ? (
                <p className="text-sm text-slate-500">{dict.commerce.noAutomaticPromotionsAppliedIn}</p>
              ) : (
                <ResponsiveTable
                  table={
                    <div>
                      <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-slate-500">
                        <th className="py-2 font-medium">{dict.commerce.name}</th><th className="py-2 font-medium">{dict.commerce.apply}</th>
                        <th className="py-2 font-medium">{dict.commerce.totalDiscount}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.promotions.map((pr) => (
                        <tr key={pr.promotionId} className="border-b last:border-0">
                          <td className="py-2 font-semibold">{pr.name}</td>
                          <td className="py-2">{pr.applications}</td>
                          <td className="py-2 text-emerald-700">− {money(pr.discountTotalMinor, locale)}</td>
                        </tr>
                      ))}
                      </tbody>
                      </table>
                    </div>
                  }
                  cards={report.promotions.map((pr) => (
                    <div key={pr.promotionId} className="rounded-lg border p-3">
                      <div className="font-semibold">{pr.name}</div>
                      <dl className="mt-2 space-y-1.5 text-sm">
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.apply}</dt>
                          <dd>{pr.applications}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.totalDiscount}</dt>
                          <dd className="text-emerald-700">− {money(pr.discountTotalMinor, locale)}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
