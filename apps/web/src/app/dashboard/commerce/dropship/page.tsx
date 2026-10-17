"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka, takaToMinorString } from "@/lib/storefront-money";
import {
  DROPSHIP_PAYOUT_NOTE, agreementStatusLabel, orderStatusLabel, partnerStockLabel,
  priceBelowFloor, type DropshipAgreementView, type DropshipLedgerView,
  type DropshipListingView, type DropshipOfferView, type DropshipOrderLinkView,
} from "@/lib/dropship-nf12";

// NF12 (FB4) — Dropship + supplier portal management.
// Minimisation rules visible in this UI: offers/listings exist
// only on ACCEPTED agreements; partner stock is labelled and
// never shown as own stock; the ledger carries the
// records-only banner (no payout — OU11 legal gate).

interface SupplierRow { id: string; name: string; active: boolean }
interface ProductRow { id: string; name: string; sku?: string | null }

export default function DropshipPage() {
  const orgId = getOrganizationId();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [portalLink, setPortalLink] = useState("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [agreements, setAgreements] = useState<DropshipAgreementView[]>([]);
  const [offers, setOffers] = useState<Record<string, DropshipOfferView[]>>({});
  const [listings, setListings] = useState<DropshipListingView[]>([]);
  const [orders, setOrders] = useState<DropshipOrderLinkView[]>([]);
  const [ledger, setLedger] = useState<DropshipLedgerView[]>([]);

  const [inviteForm, setInviteForm] = useState({ slug: "", role: "supplier" });
  const [offerForm, setOfferForm] = useState<Record<string, { productId: string; floorTaka: string }>>({});
  const [listingPrice, setListingPrice] = useState<Record<string, string>>({});
  const [processOrderId, setProcessOrderId] = useState("");

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(""); setNotice("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "কিছু ভুল হয়েছে"); }
    finally { setBusy(""); }
  };

  const loadOffers = useCallback(async (agreementId: string) => {
    if (!orgId) return;
    const res = await apiFetch<{ items: DropshipOfferView[] }>(`/organizations/${orgId}/dropship/agreements/${agreementId}/offers`).catch(() => ({ items: [] }));
    setOffers((prev) => ({ ...prev, [agreementId]: res.items }));
  }, [orgId]);

  const loadAll = useCallback(async () => {
    if (!orgId) return;
    const [sup, prods, ags, lis, ords, led] = await Promise.all([
      apiFetch<{ items: SupplierRow[] }>(`/organizations/${orgId}/commerce/suppliers`).catch(() => ({ items: [] })),
      apiFetch<{ items: ProductRow[] }>(`/organizations/${orgId}/products?pageSize=100`).catch(() => ({ items: [] })),
      apiFetch<{ items: DropshipAgreementView[] }>(`/organizations/${orgId}/dropship/agreements`).catch(() => ({ items: [] })),
      apiFetch<{ items: DropshipListingView[] }>(`/organizations/${orgId}/dropship/listings`).catch(() => ({ items: [] })),
      apiFetch<{ items: DropshipOrderLinkView[] }>(`/organizations/${orgId}/dropship/orders`).catch(() => ({ items: [] })),
      apiFetch<{ items: DropshipLedgerView[] }>(`/organizations/${orgId}/dropship/ledger`).catch(() => ({ items: [] })),
    ]);
    setSuppliers(sup.items); setProducts(prods.items); setAgreements(ags.items);
    setListings(lis.items); setOrders(ords.items); setLedger(led.items);
    for (const a of ags.items) if (a.status === "accepted") void loadOffers(a.id);
  }, [orgId, loadOffers]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  if (!orgId) return <div className="p-6">প্রতিষ্ঠান নির্বাচন করুন।</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-bold">ড্রপশিপ ও সরবরাহকারী পোর্টাল</h1>
        <p className="mt-1 text-sm text-slate-600">
          চুক্তি গ্রহণ (accepted) না হওয়া পর্যন্ত দুই প্রতিষ্ঠানের মধ্যে কিছুই শেয়ার হয় না। Supplier শুধু নিজের
          ক্রয় অর্ডার দেখেন; seller শুধু অফার করা পণ্য, ফ্লোর মূল্য আর {`পার্টনার স্টক`} দেখেন।
        </p>
      </header>
      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded bg-green-50 p-3 text-sm text-green-700">{notice}</div>}

      {/* ---------- Supplier portal links ---------- */}
      <section className="rounded border p-4">
        <h2 className="font-semibold">সরবরাহকারী পোর্টাল লিংক</h2>
        <p className="text-sm text-slate-600">লিংকটি একবারই দেখানো হয় — সরবরাহকারীকে নিরাপদে পাঠান। নতুন লিংক দিলে পুরনোটি সঙ্গে সঙ্গে বাতিল হয়ে যায়।</p>
        {portalLink && (
          <div className="mt-2 break-all rounded bg-amber-50 p-3 text-sm">
            <div className="font-medium">একবারের লিংক (কপি করে রাখুন):</div>
            <div>{portalLink}</div>
          </div>
        )}
        <ul className="mt-3 space-y-2">
          {suppliers.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 border-b pb-2 text-sm">
              <span className="font-medium">{s.name}</span>
              <button disabled={busy === s.id} className="rounded bg-blue-600 px-2 py-1 text-white"
                onClick={() => void act(s.id, async () => {
                  const r = await apiFetch<{ link: string }>(`/organizations/${orgId}/commerce/suppliers/${s.id}/portal-link`, { method: "POST" });
                  setPortalLink(r.link); setNotice("পোর্টাল লিংক তৈরি হয়েছে — নিচের বাক্স থেকে কপি করুন।");
                })}>লিংক দিন / রোটেট করুন</button>
              <button disabled={busy === s.id} className="rounded bg-slate-200 px-2 py-1"
                onClick={() => void act(s.id, async () => {
                  await apiFetch(`/organizations/${orgId}/commerce/suppliers/${s.id}/portal-link/revoke`, { method: "POST" });
                  setNotice("পোর্টাল লিংক বাতিল হয়েছে।");
                })}>লিংক বাতিল</button>
            </li>
          ))}
          {suppliers.length === 0 && <li className="text-sm text-slate-500">কোনো সরবরাহকারী নেই — ক্রয় (Purchasing) পেজ থেকে আগে সরবরাহকারী যোগ করুন।</li>}
        </ul>
      </section>

      {/* ---------- Invite + agreements ---------- */}
      <section className="rounded border p-4">
        <h2 className="font-semibold">নতুন আমন্ত্রণ (slug দিয়ে)</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <input className="rounded border px-2 py-1" placeholder="অন্য প্রতিষ্ঠানের slug" value={inviteForm.slug}
            onChange={(e) => setInviteForm({ ...inviteForm, slug: e.target.value })} />
          <select className="rounded border px-2 py-1" value={inviteForm.role}
            onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}>
            <option value="supplier">ওরা আমার supplier</option>
            <option value="seller">ওরা আমার seller</option>
          </select>
          <button disabled={busy === "invite" || !inviteForm.slug.trim()} className="rounded bg-blue-600 px-3 py-1 text-white"
            onClick={() => void act("invite", async () => {
              await apiFetch(`/organizations/${orgId}/dropship/invite`, {
                method: "POST", body: JSON.stringify(inviteForm), headers: { "Content-Type": "application/json" },
              });
              setInviteForm({ slug: "", role: "supplier" }); setNotice("আমন্ত্রণ পাঠানো হয়েছে।"); await loadAll();
            })}>আমন্ত্রণ পাঠান</button>
        </div>

        <h3 className="mt-5 font-medium">চুক্তিসমূহ</h3>
        <ul className="mt-2 space-y-3">
          {agreements.map((a) => (
            <li key={a.id} className="rounded border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.counterpartyName ?? "—"}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5">{agreementStatusLabel(a.status)}</span>
                <span className="text-slate-500">আমার ভূমিকা: {a.myRole === "supplier" ? "Supplier (source)" : "Seller"}</span>
                {a.status === "pending" && !a.invitedByMe && (
                  <>
                    <button className="rounded bg-green-600 px-2 py-1 text-white" disabled={busy === a.id}
                      onClick={() => void act(a.id, async () => {
                        await apiFetch(`/organizations/${orgId}/dropship/agreements/${a.id}/respond`, { method: "POST", body: JSON.stringify({ accept: true }), headers: { "Content-Type": "application/json" } });
                        setNotice("চুক্তি গ্রহণ করা হয়েছে।"); await loadAll();
                      })}>গ্রহণ করুন</button>
                    <button className="rounded bg-red-100 px-2 py-1 text-red-700" disabled={busy === a.id}
                      onClick={() => void act(a.id, async () => {
                        await apiFetch(`/organizations/${orgId}/dropship/agreements/${a.id}/respond`, { method: "POST", body: JSON.stringify({ accept: false }), headers: { "Content-Type": "application/json" } });
                        setNotice("আমন্ত্রণ প্রত্যাখ্যান করা হয়েছে।"); await loadAll();
                      })}>প্রত্যাখ্যান</button>
                  </>
                )}
                {(a.status === "accepted" || a.status === "pending") && (
                  <button className="rounded bg-slate-200 px-2 py-1" disabled={busy === a.id}
                    onClick={() => void act(a.id, async () => {
                      await apiFetch(`/organizations/${orgId}/dropship/agreements/${a.id}/revoke`, { method: "POST" });
                      setNotice("চুক্তি বাতিল হয়েছে — নতুন লিস্টিং/অর্ডার বন্ধ; আগের অর্ডারের স্ট্যাটাস আগের মতোই দেখা যাবে।"); await loadAll();
                    })}>চুক্তি বাতিল (Revoke)</button>
                )}
              </div>

              {a.status === "accepted" && a.myRole === "supplier" && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="text-xs">পণ্য
                    <select className="ml-1 rounded border px-2 py-1"
                      value={offerForm[a.id]?.productId ?? ""}
                      onChange={(e) => setOfferForm({ ...offerForm, [a.id]: { productId: e.target.value, floorTaka: offerForm[a.id]?.floorTaka ?? "" } })}>
                      <option value="">— বেছে নিন —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
                    </select></label>
                  <label className="text-xs">ফ্লোর মূল্য (৳)
                    <input className="ml-1 w-28 rounded border px-2 py-1" value={offerForm[a.id]?.floorTaka ?? ""}
                      onChange={(e) => setOfferForm({ ...offerForm, [a.id]: { productId: offerForm[a.id]?.productId ?? "", floorTaka: e.target.value } })} /></label>
                  <button className="rounded bg-blue-600 px-2 py-1 text-white" disabled={busy === `offer-${a.id}`}
                    onClick={() => void act(`offer-${a.id}`, async () => {
                      const f = offerForm[a.id];
                      if (!f?.productId || !f.floorTaka) throw new Error("পণ্য ও ফ্লোর মূল্য দিন");
                      await apiFetch(`/organizations/${orgId}/dropship/agreements/${a.id}/offers`, {
                        method: "POST",
                        body: JSON.stringify({ productId: f.productId, floorPriceMinor: takaToMinorString(f.floorTaka) }),
                        headers: { "Content-Type": "application/json" },
                      });
                      setNotice("অফার সংরক্ষণ হয়েছে।"); await loadOffers(a.id);
                    })}>অফার দিন / হালনাগাদ</button>
                </div>
              )}

              {a.status === "accepted" && (
                <ul className="mt-2 space-y-1">
                  {(offers[a.id] ?? []).map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span>{o.productName ?? o.productId}</span>
                      <span>ফ্লোর: {formatMinorTaka(o.floorPriceMinor)}</span>
                      <span className="rounded bg-cyan-50 px-2 py-0.5 text-cyan-800">{partnerStockLabel(o.partnerStock)}</span>
                      {a.myRole === "seller" && (
                        <>
                          <input className="w-28 rounded border px-2 py-1" placeholder="বিক্রয় মূল্য (৳)"
                            value={listingPrice[o.id] ?? ""}
                            onChange={(e) => setListingPrice({ ...listingPrice, [o.id]: e.target.value })} />
                          <button className="rounded bg-green-600 px-2 py-1 text-white" disabled={busy === `listing-${o.id}`}
                            onClick={() => void act(`listing-${o.id}`, async () => {
                              const taka = listingPrice[o.id];
                              if (!taka) throw new Error("বিক্রয় মূল্য দিন");
                              const minor = takaToMinorString(taka);
                              if (!minor) throw new Error("সঠিক বিক্রয় মূল্য দিন (টাকায়)");
                              if (priceBelowFloor(minor, o.floorPriceMinor)) {
                                throw new Error(`বিক্রয় মূল্য ফ্লোর মূল্যের (${formatMinorTaka(o.floorPriceMinor)}) চেয়ে কম হতে পারবে না`);
                              }
                              await apiFetch(`/organizations/${orgId}/dropship/listings`, {
                                method: "POST",
                                body: JSON.stringify({ agreementId: a.id, offerId: o.id, priceMinor: minor }),
                                headers: { "Content-Type": "application/json" },
                              });
                              setNotice("লিস্টিং তৈরি হয়েছে।"); await loadAll();
                            })}>লিস্টিং তৈরি করুন</button>
                        </>
                      )}
                    </li>
                  ))}
                  {(offers[a.id] ?? []).length === 0 && <li className="text-sm text-slate-500">এখনো কোনো অফার নেই।</li>}
                </ul>
              )}
            </li>
          ))}
          {agreements.length === 0 && <li className="text-sm text-slate-500">কোনো চুক্তি নেই।</li>}
        </ul>
      </section>

      {/* ---------- Listings ---------- */}
      <section className="rounded border p-4">
        <h2 className="font-semibold">আমার ড্রপশিপ লিস্টিং (seller হিসেবে)</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {listings.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 border-b pb-2">
              <span className="font-medium">{l.sourceProductName ?? l.sourceProductId}</span>
              <span>{formatMinorTaka(l.priceMinor)}</span>
              <span className="rounded bg-cyan-50 px-2 py-0.5 text-cyan-800">{partnerStockLabel(l.partnerStock)}</span>
              <span className="text-slate-500">সরবরাহকারী: {l.suppliedBy ?? "—"}</span>
              <span>{l.active ? "সক্রিয়" : "বন্ধ"}</span>
              <button className="rounded bg-slate-200 px-2 py-1" disabled={busy === l.id}
                onClick={() => void act(l.id, async () => {
                  await apiFetch(`/organizations/${orgId}/dropship/listings/${l.id}/active`, {
                    method: "PATCH", body: JSON.stringify({ active: !l.active }), headers: { "Content-Type": "application/json" },
                  });
                  await loadAll();
                })}>{l.active ? "বন্ধ করুন" : "চালু করুন"}</button>
            </li>
          ))}
          {listings.length === 0 && <li className="text-slate-500">কোনো লিস্টিং নেই।</li>}
        </ul>
      </section>

      {/* ---------- Dropship orders ---------- */}
      <section className="rounded border p-4">
        <h2 className="font-semibold">ড্রপশিপ অর্ডার</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <input className="rounded border px-2 py-1" placeholder="Seller অর্ডার আইডি" value={processOrderId}
            onChange={(e) => setProcessOrderId(e.target.value)} />
          <button className="rounded bg-blue-600 px-3 py-1 text-white" disabled={busy === "process" || !processOrderId.trim()}
            onClick={() => void act("process", async () => {
              const r = await apiFetch<{ results: unknown[] }>(`/organizations/${orgId}/dropship/orders/process`, {
                method: "POST", body: JSON.stringify({ sellerOrderId: processOrderId.trim() }), headers: { "Content-Type": "application/json" },
              });
              setNotice(`প্রসেস সম্পন্ন — ${r.results.length}টি চুক্তি-গ্রুপ পরীক্ষা করা হয়েছে (আগে তৈরি থাকলে পুনরায় তৈরি হয় না)।`);
              await loadAll();
            })}>Supplier অর্ডার তৈরি / সিঙ্ক</button>
        </div>
        <ul className="mt-3 space-y-2 text-sm">
          {orders.map((o) => (
            <li key={o.id} className="rounded border p-3">
              <div className="flex flex-wrap gap-2">
                <span>ভূমিকা: {o.myRole === "seller" ? "Seller" : "Supplier"}</span>
                <span>Supplier স্ট্যাটাস: <b>{orderStatusLabel(o.supplierStatus)}</b></span>
                <span className="text-slate-500">Seller অর্ডার: {o.sellerOrderId}</span>
                <span className="text-slate-500">Supplier অর্ডার: {o.supplierOrderId ?? "—"}</span>
                {o.supplierStatus !== "cancelled" && (
                  <button className="rounded bg-red-100 px-2 py-1 text-red-700" disabled={busy === o.id}
                    onClick={() => void act(o.id, async () => {
                      await apiFetch(`/organizations/${orgId}/dropship/orders/${o.id}/cancel`, { method: "POST" });
                      setNotice("Supplier ফুলফিলমেন্ট বাতিল হয়েছে।"); await loadAll();
                    })}>ফুলফিলমেন্ট বাতিল</button>
                )}
              </div>
              {o.cancelNote && <div className="mt-1 text-amber-700">{o.cancelNote}</div>}
              <ul className="mt-1 text-slate-600">
                {o.items.map((i, idx) => (
                  <li key={idx}>পরিমাণ {i.qty} · পাইকারি {formatMinorTaka(i.wholesaleUnitMinor)}{i.retailUnitMinor ? ` · খুচরা ${formatMinorTaka(i.retailUnitMinor)}` : ""}</li>
                ))}
              </ul>
            </li>
          ))}
          {orders.length === 0 && <li className="text-slate-500">কোনো ড্রপশিপ অর্ডার নেই।</li>}
        </ul>
      </section>

      {/* ---------- Ledger (records only) ---------- */}
      <section className="rounded border p-4">
        <h2 className="font-semibold">কমিশন / মার্জিন লেজার</h2>
        <div className="mt-2 rounded bg-amber-50 p-3 text-sm text-amber-800">{DROPSHIP_PAYOUT_NOTE}</div>
        <ul className="mt-3 space-y-2 text-sm">
          {ledger.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-3 border-b pb-2">
              <span>খুচরা মোট: {formatMinorTaka(e.retailTotalMinor)}</span>
              <span>পাইকারি মোট: {formatMinorTaka(e.wholesaleTotalMinor)}</span>
              <span>মার্জিন: <b>{formatMinorTaka(e.marginMinor)}</b></span>
              <span className="text-slate-500">{new Date(e.createdAt).toLocaleString()}</span>
            </li>
          ))}
          {ledger.length === 0 && <li className="text-slate-500">এখনো কোনো লেজার এন্ট্রি নেই — supplier অর্ডার সম্পন্ন হলে এন্ট্রি তৈরি হয়।</li>}
        </ul>
      </section>
    </div>
  );
}
