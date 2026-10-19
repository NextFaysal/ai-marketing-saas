"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka, minorToTakaString, takaToMinorString } from "@/lib/storefront-money";
import { useConfirm, useToast } from "@repo/ui/client";
import { ResponsiveTable } from "@repo/ui";

// EC29 — bundle management. A bundle sells 2–10 component
// products together at one bundle price. regularTotalMinor comes
// from the API list response — no client-side price math for
// totals that matter; the form's bundle price is typed in taka
// and converted with the shared string-arithmetic helper.

interface BundleComponent {
  productId: string;
  name?: string;
  variantSku?: string | null;
  qty: number;
  unitPriceMinor?: string;
}
interface Bundle {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  bundlePriceMinor: string;
  regularTotalMinor: string;
  savingsMinor?: string | null;
  sortOrder: number;
  active: boolean;
  // The staff serialize carries the fixed items as `items`
  // ({ productId, variantSku, qty }) — `components` is kept
  // only as a legacy fallback name.
  items?: { productId: string; variantSku?: string | null; qty: number }[];
  components: BundleComponent[];
  // AB5 (AX8): mix-and-match slots with their CURRENT pools.
  slots?: BundleSlot[];
  createdAt?: string;
}
interface BundleSlotOption { productId: string; name: string | null; imageUrl: string | null; regularUnitMinor: string }
interface BundleSlot {
  id: string | null; label: string; chooseQty: number;
  sourceType: "category" | "products";
  sourceRef: { categoryId?: string; productIds?: string[] } | null;
  options: BundleSlotOption[];
}
interface ProductOpt { id: string; name: string }
interface CategoryOpt { id: string; name: string }
interface ComponentRow { productId: string; variantSku: string; qty: string }
interface SlotRow { label: string; chooseQty: string; sourceType: "category" | "products"; categoryId: string; productIds: string[] }

export default function BundlesPage() {
  const { dict, t, locale } = useLocale();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [categories, setCategories] = useState<CategoryOpt[]>([]);
  // AB5 (AX8): slot rows of the form (the form manages the
  // bundle's FULL slot set — saving replaces them wholesale).
  const [slotRows, setSlotRows] = useState<SlotRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [bundlePrice, setBundlePrice] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [active, setActive] = useState(true);
  const [rows, setRows] = useState<ComponentRow[]>([
    { productId: "", variantSku: "", qty: "1" },
    { productId: "", variantSku: "", qty: "1" },
  ]);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [list, p, cats] = await Promise.all([
        apiFetch<{ items: Bundle[] }>(`/organizations/${orgId}/commerce/bundles`),
        apiFetch<{ items: ProductOpt[] }>(`/organizations/${orgId}/products?pageSize=100`).catch(() => ({ items: [] as ProductOpt[] })),
        apiFetch<CategoryOpt[]>(`/organizations/${orgId}/products/categories`).catch(() => [] as CategoryOpt[]),
      ]);
      setBundles(list.items ?? []);
      setProducts(p.items ?? []);
      setCategories(Array.isArray(cats) ? cats : []);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.loadingFailed); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setEditingId(null); setName(""); setDescription(""); setImageUrl("");
    setBundlePrice(""); setSortOrder("0"); setActive(true);
    setRows([
      { productId: "", variantSku: "", qty: "1" },
      { productId: "", variantSku: "", qty: "1" },
    ]);
    setSlotRows([]);
  }

  function startEdit(b: Bundle) {
    resetForm();
    setEditingId(b.id);
    setName(b.name);
    setDescription(b.description ?? "");
    setImageUrl(b.imageUrl ?? "");
    setBundlePrice(minorToTakaString(b.bundlePriceMinor));
    setSortOrder(String(b.sortOrder ?? 0));
    setActive(b.active);
    const fixed = b.items?.length ? b.items : b.components;
    if (fixed?.length) {
      setRows(fixed.map((c) => ({
        productId: c.productId,
        variantSku: c.variantSku ?? "",
        qty: String(c.qty ?? 1),
      })));
    }
    // AB5 (AX8): initialize the slots editor from the serialized slots.
    setSlotRows((b.slots ?? []).map((s) => ({
      label: s.label,
      chooseQty: String(s.chooseQty ?? 1),
      sourceType: s.sourceType,
      categoryId: s.sourceRef?.categoryId ?? "",
      productIds: s.sourceRef?.productIds ?? [],
    })));
  }

  async function save() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const components = rows
      .filter((r) => r.productId)
      .map((r) => ({
        productId: r.productId,
        variantSku: r.variantSku.trim() || null,
        qty: Math.max(1, parseInt(r.qty || "1", 10) || 1),
      }));
    if (components.length < 2 || components.length > 10) {
      setError(dict.commerce.aBundleMustHave2);
      return;
    }
    const bundlePriceMinor = takaToMinorString(bundlePrice);
    if (bundlePriceMinor === null) {
      setError(dict.commerce.giveTheBundlePriceIn);
      return;
    }
    // AB5 (AX8): slots — the form manages the full set, so the
    // array is ALWAYS sent (the API replaces wholesale when the
    // field is present; [] clears all slots).
    const slots: { label: string; chooseQty: number; sourceType: "category" | "products"; sourceRef: { categoryId: string } | { productIds: string[] } }[] = [];
    for (const s of slotRows) {
      const label = s.label.trim();
      if (!label) { setError(dict.commerce.giveALabelForEvery); return; }
      const chooseQty = parseInt(s.chooseQty || "0", 10);
      if (!Number.isInteger(chooseQty) || chooseQty < 1 || chooseQty > 20) {
        setError(t("commerce.thePickCountForThe", { label: label })); return;
      }
      if (s.sourceType === "category") {
        if (!s.categoryId) { setError(t("commerce.selectACategoryForThe", { label: label })); return; }
        slots.push({ label, chooseQty, sourceType: "category", sourceRef: { categoryId: s.categoryId } });
      } else {
        if (s.productIds.length === 0) { setError(t("commerce.selectAtLeastOneProduct", { label: label })); return; }
        slots.push({ label, chooseQty, sourceType: "products", sourceRef: { productIds: s.productIds } });
      }
    }
    setBusy("save"); setError("");
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      imageUrl: imageUrl.trim() || null,
      bundlePriceMinor,
      sortOrder: parseInt(sortOrder || "0", 10) || 0,
      active,
      // The API's BundleDto field is `items` (fixed components).
      items: components,
      slots,
    };
    try {
      if (editingId) {
        await apiFetch(`/organizations/${orgId}/commerce/bundles/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
        toast({ title: dict.commerce.bundleUpdated, tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/commerce/bundles`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: dict.commerce.bundleCreated, tone: "success" });
      }
      resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.saveFailed3); }
    finally { setBusy(""); }
  }

  async function toggleActive(b: Bundle) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`active-${b.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/bundles/${b.id}/active`, {
        method: "POST", body: JSON.stringify({ active: !b.active }),
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.failed); }
    finally { setBusy(""); }
  }

  async function remove(b: Bundle) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: t("commerce.deleteTheBundle", { name: b.name }), danger: true, confirmLabel: dict.commerce.delete2 }))) return;
    setBusy(`del-${b.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/bundles/${b.id}`, { method: "DELETE" });
      if (editingId === b.id) resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.deleteFailed); }
    finally { setBusy(""); }
  }

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id;

  // ED15/ED16 (EB6): bundle cell contents, status and row actions are
  // shared verbatim by the desktop table and the ResponsiveTable
  // mobile card — same handlers, same order.
  const renderBundleContents = (b: Bundle) => (
    <>
      {(b.items ?? b.components ?? []).map((c, i) => (
        <div key={i}>{(c as BundleComponent).name ?? productName(c.productId)}{c.variantSku ? ` (${c.variantSku})` : ""} × {c.qty}</div>
      ))}
      {(b.slots ?? []).map((s) => (
        <div key={s.id ?? s.label} className="mt-0.5 rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700">
          🎛️ {s.label}: {s.chooseQty}{dict.commerce.willPickInThePool}{(s.options ?? []).length}{dict.commerce.products}</div>
      ))}
    </>
  );
  const renderBundleStatus = (b: Bundle) => (
    b.active ? <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">{dict.commerce.active}</span> : <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{dict.commerce.closed}</span>
  );
  const renderBundleActions = (b: Bundle) => (
    <div className="flex gap-2">
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold" onClick={() => startEdit(b)}>{dict.commerce.edit}</button>
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleActive(b)}>{b.active ? dict.commerce.close : dict.commerce.enable}</button>
      <button className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => remove(b)}>{dict.commerce.delete}</button>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{dict.commerce.bundlesBundleOffers}</h1>
          <p className="text-sm text-slate-500">
            {dict.commerce.sell210ProductsTogether}</p>
        </div>
        <Link href="/dashboard/commerce" className="btn-primary">← Commerce Hub</Link>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <div className="card p-5 space-y-4">
        <div className="font-semibold">{editingId ? dict.commerce.editBundle : dict.commerce.newBundle}</div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">{dict.commerce.name}<input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder={dict.commerce.eGEidComboPack} />
          </label>
          <label className="block text-sm">{dict.commerce.imageURLOptional}<input className="input mt-1" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </label>
          <label className="block text-sm md:col-span-2">{dict.commerce.descriptionOptional2}<textarea className="input mt-1" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={dict.commerce.whatIsIncludedInThe} />
          </label>
          <label className="block text-sm">{dict.commerce.bundlePriceTaka}<input className="input mt-1" inputMode="decimal" value={bundlePrice} onChange={(e) => setBundlePrice(e.target.value)} placeholder={dict.commerce.eG999} />
          </label>
          <label className="block text-sm">{dict.commerce.orderSortOrderSmallerEarlier}<input className="input mt-1" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {dict.commerce.activeShownInTheShop}</label>
        </div>

        <div className="space-y-2 border-t pt-4">
          <div className="font-semibold">{dict.commerce.componentProducts}{rows.filter((r) => r.productId).length}{dict.commerce.selectedMustBe210}</div>
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="block flex-1 text-sm">{dict.commerce.product}<select className="input mt-1" value={r.productId} onChange={(e) => {
                  const next = [...rows]; next[i] = { ...r, productId: e.target.value }; setRows(next);
                }}>
                  <option value="">{dict.commerce.select}</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="block text-sm">{dict.commerce.variantSKUOptional}<input className="input mt-1 w-40" value={r.variantSku} onChange={(e) => {
                  const next = [...rows]; next[i] = { ...r, variantSku: e.target.value }; setRows(next);
                }} placeholder={dict.commerce.eGREDL} />
              </label>
              <label className="block text-sm">{dict.commerce.quantity}<input className="input mt-1 w-24" type="number" min="1" value={r.qty} onChange={(e) => {
                  const next = [...rows]; next[i] = { ...r, qty: e.target.value }; setRows(next);
                }} />
              </label>
              <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-2 text-xs font-semibold text-rose-600 disabled:opacity-50"
                disabled={rows.length <= 2}
                onClick={() => setRows(rows.filter((_, x) => x !== i))}>{dict.commerce.deleteRow}</button>
            </div>
          ))}
          <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={rows.length >= 10}
            onClick={() => setRows([...rows, { productId: "", variantSku: "", qty: "1" }])}>
            {dict.commerce.addMoreProducts}</button>
          <p className="text-xs text-slate-500">{dict.commerce.ifAVariantSKUIs}</p>
        </div>

        {/* AB5 (AX8): mix-and-match slots — the buyer picks
            chooseQty products from each slot's pool; the bundle
            price does not change with the picks. */}
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{dict.commerce.slotsMixAndMatchBuyers}{slotRows.length}{dict.commerce.slotsMaximum6}</div>
          <p className="text-xs text-slate-500">{dict.commerce.ifThereAreSlotsThe}</p>
          {slotRows.map((s, i) => (
            <div key={i} className="space-y-2 rounded-xl bg-slate-50 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="block flex-1 text-sm">{dict.commerce.slotLabel}<input className="input mt-1" value={s.label} placeholder={dict.commerce.eGPickADrink}
                    onChange={(e) => { const n = [...slotRows]; n[i] = { ...s, label: e.target.value }; setSlotRows(n); }} />
                </label>
                <label className="block text-sm">{dict.commerce.howManyToPick}<input className="input mt-1 w-28" type="number" min="1" max="20" value={s.chooseQty}
                    onChange={(e) => { const n = [...slotRows]; n[i] = { ...s, chooseQty: e.target.value }; setSlotRows(n); }} />
                </label>
                <label className="block text-sm">{dict.commerce.productSource}<select className="input mt-1 w-44" value={s.sourceType}
                    onChange={(e) => { const n = [...slotRows]; n[i] = { ...s, sourceType: e.target.value as SlotRow["sourceType"] }; setSlotRows(n); }}>
                    <option value="category">{dict.commerce.category}</option>
                    <option value="products">{dict.commerce.specificProducts}</option>
                  </select>
                </label>
                <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-2 text-xs font-semibold text-rose-600"
                  onClick={() => setSlotRows(slotRows.filter((_, x) => x !== i))}>{dict.commerce.deleteSlot}</button>
              </div>
              {s.sourceType === "category" ? (
                <label className="block text-sm">{dict.commerce.category}<select className="input mt-1 w-72" value={s.categoryId}
                    onChange={(e) => { const n = [...slotRows]; n[i] = { ...s, categoryId: e.target.value }; setSlotRows(n); }}>
                    <option value="">{dict.commerce.selectACategory2}</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-500">{dict.commerce.allActiveProductsOfThat}</span>
                </label>
              ) : (
                <div>
                  <div className="mb-1 text-sm">{dict.commerce.selectProducts}{s.productIds.length}{dict.commerce.selected}</div>
                  <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                    {products.map((p) => {
                      const on = s.productIds.includes(p.id);
                      return (
                        <button key={p.id} type="button"
                          className={`inline-flex min-h-[44px] items-center rounded-full px-2.5 py-1 text-xs font-semibold ${on ? "bg-indigo-600 text-white" : "border bg-white text-slate-600"}`}
                          onClick={() => {
                            const n = [...slotRows];
                            n[i] = { ...s, productIds: on ? s.productIds.filter((x) => x !== p.id) : [...s.productIds, p.id] };
                            setSlotRows(n);
                          }}>
                          {on ? "✓ " : ""}{p.name}
                        </button>
                      );
                    })}
                    {products.length === 0 ? <span className="text-xs text-slate-500">{dict.commerce.noProductsLoaded}</span> : null}
                  </div>
                </div>
              )}
            </div>
          ))}
          <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={slotRows.length >= 6}
            onClick={() => setSlotRows([...slotRows, { label: "", chooseQty: "1", sourceType: "category", categoryId: "", productIds: [] }])}>
            {dict.commerce.addSlot}</button>
        </div>

        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy !== "" || !name.trim() || !bundlePrice.trim()} onClick={save}>
            {busy === "save" ? dict.commerce.saving2 : editingId ? dict.commerce.update : dict.commerce.create}
          </button>
          {editingId ? <button className="rounded-lg border px-3 py-2 text-sm" onClick={resetForm}>{dict.common.cancel}</button> : null}
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <div className="font-semibold">{dict.commerce.allBundles}{bundles.length})</div>
        {loading ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : bundles.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.commerce.noBundlesYet}</p>
        ) : (
          <ResponsiveTable
            table={
              <div>
                <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 font-medium">{dict.commerce.name}</th><th className="py-2 font-medium">{dict.commerce.component}</th>
                  <th className="py-2 font-medium">{dict.commerce.bundlePrice}</th><th className="py-2 font-medium">{dict.commerce.separateTotal}</th>
                  <th className="py-2 font-medium">{dict.commerce.savings}</th><th className="py-2 font-medium">{dict.commerce.order2}</th>
                  <th className="py-2 font-medium">{dict.commerce.status}</th><th className="py-2 font-medium">{dict.commerce.action}</th>
                </tr>
              </thead>
              <tbody>
                {bundles.map((b) => (
                  <tr key={b.id} className="border-b last:border-0 align-top">
                    <td className="py-2 font-semibold">{b.name}</td>
                    <td className="py-2 text-xs text-slate-600">
                      {renderBundleContents(b)}
                    </td>
                    <td className="py-2 font-semibold">{formatMinorTaka(b.bundlePriceMinor)}</td>
                    <td className="py-2">{formatMinorTaka(b.regularTotalMinor)}</td>
                    <td className="py-2 text-emerald-700">{b.savingsMinor && Number(b.savingsMinor) > 0 ? formatMinorTaka(b.savingsMinor) : "—"}</td>
                    <td className="py-2">{b.sortOrder}</td>
                    <td className="py-2">{renderBundleStatus(b)}</td>
                    <td className="py-2">
                      {renderBundleActions(b)}
                    </td>
                  </tr>
                ))}
                </tbody>
                </table>
              </div>
            }
            cards={bundles.map((b) => (
              <div key={b.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{b.name}</span>
                  {renderBundleStatus(b)}
                </div>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.component}</dt>
                    <dd className="text-xs text-slate-600">{renderBundleContents(b)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.bundlePrice}</dt>
                    <dd className="font-semibold">{formatMinorTaka(b.bundlePriceMinor)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.separateTotal}</dt>
                    <dd>{formatMinorTaka(b.regularTotalMinor)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.savings}</dt>
                    <dd className="text-emerald-700">{b.savingsMinor && Number(b.savingsMinor) > 0 ? formatMinorTaka(b.savingsMinor) : "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.order2}</dt>
                    <dd>{b.sortOrder}</dd>
                  </div>
                </dl>
                <div className="mt-2">{renderBundleActions(b)}</div>
              </div>
            ))}
          />
        )}
      </div>
    </div>
  );
}
