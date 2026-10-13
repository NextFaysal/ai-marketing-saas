"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";

// EC3/EC4 (Batch B2): product channel / gallery / bundle / category dialogs.
// All error messages are the API's verbatim message (apiFetch throws
// Error(body.message)) — never replaced with a fake success.

export interface EcCategory {
  id: string; name: string; slug: string; parentId: string | null;
  description?: string | null; productCount?: number;
}
export interface EcTag { id: string; name: string; slug: string }
export interface EcProductImage { id: string; url: string; altText?: string | null; position: number }

interface EcProductRef { id: string; name: string }

function Overlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className={`card w-full ${wide ? "max-w-2xl" : "max-w-lg"} p-5 space-y-4`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function DialogHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-semibold">{title}</h2>
      <button className="text-slate-500" onClick={onClose}>✕</button>
    </div>
  );
}

/** Current user's role in the active org — same pattern as team /
 * ai-instructions pages: GET /organizations → find by id → myRole. */
function useMyRole(): string {
  const [myRole, setMyRole] = useState("");
  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<{ id: string; myRole: string }[]>(`/organizations`)
      .then((orgs) => {
        const mine = orgs.find((o) => o.id === orgId);
        if (mine) setMyRole(mine.myRole);
      })
      .catch(() => { /* role stays "" — OWNER-only actions stay hidden */ });
  }, []);
  return myRole;
}

/* ---------------- Channels (EC4) ---------------- */

export interface EcChannelListing {
  id: string; storeId: string; storeName: string; platform: string; syncMode: string;
  externalId: string | null; publishState: string; syncStatus: string;
  lastSyncError: string | null; channelPriceMinor: string | null; channelStock: number | null;
  saleStartsAt: string | null; saleEndsAt: string | null; saleActive: boolean; stockDiverged: boolean;
}
interface EcChannelsResponse { productId: string; productStock: number | null; listings: EcChannelListing[] }

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // datetime-local expects local time without timezone suffix.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function EcChannelsDialog({ product, onClose }: { product: EcProductRef; onClose: () => void }) {
  const myRole = useMyRole();
  const [data, setData] = useState<EcChannelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [saleDraft, setSaleDraft] = useState<Record<string, { start: string; end: string }>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setLoading(true);
    try {
      const res = await apiFetch<EcChannelsResponse>(`/organizations/${orgId}/products/${product.id}/channels`);
      setData(res);
      setPriceDraft(Object.fromEntries(res.listings.map((l) => [l.id, l.channelPriceMinor ?? ""])));
      setSaleDraft(Object.fromEntries(res.listings.map((l) => [l.id, { start: toLocalInput(l.saleStartsAt), end: toLocalInput(l.saleEndsAt) }])));
      setMsg("");
    } catch (e) { setMsg(e instanceof Error ? e.message : "চ্যানেল লোড ব্যর্থ হয়েছে"); }
    finally { setLoading(false); }
  }, [product.id]);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  async function act(key: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(key); setMsg("");
    try { await fn(); setMsg(okMsg); await loadChannels(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "অ্যাকশন ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  const orgId = getOrganizationId();

  return (
    <Overlay onClose={onClose} wide>
      <DialogHeader title={`চ্যানেল — ${product.name}`} onClose={onClose} />
      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
      {!loading && data && data.listings.length === 0 ? (
        <p className="text-sm text-slate-500">এই পণ্যটি এখনো কোনো স্টোরে Listing হয়নি।</p>
      ) : null}
      {data?.listings.map((l) => (
        <div key={l.id} className="rounded-xl border p-3.5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm">{l.storeName}</span>
            <span className="text-xs text-slate-400">({l.platform})</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{l.syncMode}</span>
            <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{l.publishState}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">sync: {l.syncStatus}</span>
            {l.saleActive ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">সেল চলছে</span> : null}
          </div>
          {l.syncMode !== "full-manage" ? (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
              এই স্টোরটি full-manage মোডে নেই — পরিবর্তন স্টোরে পাঠানো হবে না।
            </p>
          ) : null}
          {l.lastSyncError ? <p className="text-xs text-red-600">শেষ Sync এরর: {l.lastSyncError}</p> : null}
          {l.stockDiverged ? (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
              সতর্কতা: স্টোরের স্টক ({l.channelStock ?? "—"}) আর এখানকার স্টক ({data.productStock ?? "—"}) মিলছে না — এটি একটি সংকেত, চূড়ান্ত প্রমাণ নয়।
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {l.publishState !== "published" ? (
              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-50" disabled={busy !== ""}
                onClick={() => act(`pub-${l.id}`, () => apiFetch(`/organizations/${orgId}/commerce/listings/${l.id}/publish`, { method: "POST" }), "প্রকাশের অনুরোধ পাঠানো হয়েছে।")}>
                প্রকাশ করুন
              </button>
            ) : (
              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-50" disabled={busy !== ""}
                onClick={() => act(`unpub-${l.id}`, () => apiFetch(`/organizations/${orgId}/commerce/listings/${l.id}/unpublish`, { method: "POST" }), "অপ্রকাশের অনুরোধ পাঠানো হয়েছে।")}>
                অপ্রকাশ করুন
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-2.5 space-y-2">
              <div className="text-xs font-semibold text-slate-700">
                চ্যানেল প্রাইস ওভাররাইড {l.channelPriceMinor ? `(বর্তমান: ${formatMinor(BigInt(l.channelPriceMinor))})` : "(নেই — মূল দামই চলছে)"}
              </div>
              <div className="flex gap-2">
                <input className="w-full rounded-lg border px-2 py-1.5 text-xs" placeholder="পয়সায় (minor unit), যেমন 125000"
                  value={priceDraft[l.id] ?? ""} onChange={(e) => setPriceDraft({ ...priceDraft, [l.id]: e.target.value })} />
                <button className="whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""}
                  onClick={() => act(`price-${l.id}`, () => apiFetch(`/organizations/${orgId}/commerce/listings/${l.id}/channel-price`, {
                    method: "PATCH", body: JSON.stringify({ channelPriceMinor: (priceDraft[l.id] ?? "").trim() || null }),
                  }), "চ্যানেল প্রাইস সংরক্ষণ হয়েছে।")}>
                  সংরক্ষণ
                </button>
                <button className="whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs text-slate-500 disabled:opacity-50" disabled={busy !== ""}
                  onClick={() => act(`price-clear-${l.id}`, () => apiFetch(`/organizations/${orgId}/commerce/listings/${l.id}/channel-price`, {
                    method: "PATCH", body: JSON.stringify({ channelPriceMinor: null }),
                  }), "চ্যানেল প্রাইস ওভাররাইড সরানো হয়েছে।")}>
                  মুছুন
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-2.5 space-y-2">
              <div className="text-xs font-semibold text-slate-700">সেলের সময়সূচি</div>
              <label className="block text-[11px] text-slate-500">শুরু
                <input type="datetime-local" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs"
                  value={saleDraft[l.id]?.start ?? ""} onChange={(e) => setSaleDraft({ ...saleDraft, [l.id]: { start: e.target.value, end: saleDraft[l.id]?.end ?? "" } })} />
              </label>
              <label className="block text-[11px] text-slate-500">শেষ
                <input type="datetime-local" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs"
                  value={saleDraft[l.id]?.end ?? ""} onChange={(e) => setSaleDraft({ ...saleDraft, [l.id]: { start: saleDraft[l.id]?.start ?? "", end: e.target.value } })} />
              </label>
              <button className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""}
                onClick={() => act(`sale-${l.id}`, () => apiFetch(`/organizations/${orgId}/commerce/listings/${l.id}/sale-schedule`, {
                  method: "PATCH",
                  body: JSON.stringify({ saleStartsAt: fromLocalInput(saleDraft[l.id]?.start ?? ""), saleEndsAt: fromLocalInput(saleDraft[l.id]?.end ?? "") }),
                }), "সেলের সময়সূচি সংরক্ষণ হয়েছে।")}>
                সময়সূচি সংরক্ষণ
              </button>
            </div>
          </div>

          {myRole === "OWNER" ? (
            confirmDeleteId === l.id ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                <p className="text-xs text-red-800">
                  এটি <b>স্টোর থেকে</b> পণ্যটি মুছে ফেলবে। এখানকার (লোকাল) পণ্যটি থেকে যাবে। এই কাজটি ফেরানো যাবে না।
                </p>
                <div className="flex gap-2">
                  <button className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""}
                    onClick={() => act(`del-${l.id}`, async () => {
                      await apiFetch(`/organizations/${orgId}/commerce/listings/${l.id}/remote`, { method: "DELETE" });
                      setConfirmDeleteId(null);
                    }, "স্টোর থেকে মোছার অনুরোধ পাঠানো হয়েছে।")}>
                    {busy === `del-${l.id}` ? "মোছা হচ্ছে…" : "হ্যাঁ, স্টোর থেকে মুছুন"}
                  </button>
                  <button className="rounded-lg border px-3 py-1.5 text-xs" onClick={() => setConfirmDeleteId(null)}>বাতিল</button>
                </div>
              </div>
            ) : (
              <button className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""}
                onClick={() => setConfirmDeleteId(l.id)}>
                🗑️ স্টোর থেকে মুছুন (শুধু Owner)
              </button>
            )
          ) : null}
        </div>
      ))}
      {msg ? <p className="text-sm text-slate-600">{msg}</p> : null}
    </Overlay>
  );
}

/* ---------------- Gallery (EC3) ---------------- */

export function EcGalleryDialog({ product, onClose }: { product: EcProductRef; onClose: () => void }) {
  const [images, setImages] = useState<EcProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newAlt, setNewAlt] = useState("");

  const loadImages = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setLoading(true);
    try {
      const detail = await apiFetch<{ images?: EcProductImage[] }>(`/organizations/${orgId}/products/${product.id}`);
      setImages([...(detail.images ?? [])].sort((a, b) => a.position - b.position));
      setMsg("");
    } catch (e) { setMsg(e instanceof Error ? e.message : "ছবি লোড ব্যর্থ হয়েছে"); }
    finally { setLoading(false); }
  }, [product.id]);

  useEffect(() => { loadImages(); }, [loadImages]);

  async function addImage(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId || !newUrl.trim()) return;
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/products/${product.id}/images`, {
        method: "POST", body: JSON.stringify({ url: newUrl.trim(), altText: newAlt.trim() || undefined }),
      });
      setNewUrl(""); setNewAlt("");
      setMsg("ছবি যোগ হয়েছে।");
      await loadImages();
    } catch (e) { setMsg(e instanceof Error ? e.message : "ছবি যোগ ব্যর্থ হয়েছে"); }
    finally { setBusy(false); }
  }

  async function deleteImage(img: EcProductImage) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm("এই ছবিটি মুছে ফেলবেন?")) return;
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/products/${product.id}/images/${img.id}`, { method: "DELETE" });
      setMsg("ছবি মোছা হয়েছে।");
      await loadImages();
    } catch (e) { setMsg(e instanceof Error ? e.message : "ছবি মোছা ব্যর্থ হয়েছে"); }
    finally { setBusy(false); }
  }

  async function move(idx: number, dir: -1 | 1) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const next = [...images];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/products/${product.id}/images/reorder`, {
        method: "PATCH", body: JSON.stringify({ imageIds: next.map((i) => i.id) }),
      });
      setImages(next.map((img, i) => ({ ...img, position: i })));
    } catch (e) { setMsg(e instanceof Error ? e.message : "ক্রম বদলানো ব্যর্থ হয়েছে"); await loadImages(); }
    finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose} wide>
      <DialogHeader title={`ছবির গ্যালারি — ${product.name}`} onClose={onClose} />
      <p className="text-xs text-slate-400">প্রথম ছবিটিই কভার ছবি হিসেবে ব্যবহৃত হয়।</p>
      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : images.length === 0 ? (
        <p className="text-sm text-slate-500">এখনো কোনো গ্যালারি ছবি নেই।</p>
      ) : (
        <ul className="space-y-2">
          {images.map((img, idx) => (
            <li key={img.id} className="flex items-center gap-3 rounded-lg border p-2">
              <img src={img.url} alt={img.altText ?? ""} className="h-12 w-12 rounded-lg object-cover border" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-slate-600" title={img.url}>{img.url}</div>
                <div className="text-[11px] text-slate-400">ক্রম: {img.position}{idx === 0 ? " · কভার" : ""}{img.altText ? ` · Alt: ${img.altText}` : ""}</div>
              </div>
              <button className="rounded border px-2 py-1 text-xs disabled:opacity-40" disabled={busy || idx === 0} onClick={() => move(idx, -1)} title="উপরে নিন">↑</button>
              <button className="rounded border px-2 py-1 text-xs disabled:opacity-40" disabled={busy || idx === images.length - 1} onClick={() => move(idx, 1)} title="নিচে নিন">↓</button>
              <button className="rounded border px-2 py-1 text-xs text-red-600 disabled:opacity-50" disabled={busy} onClick={() => deleteImage(img)}>মুছুন</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={addImage} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] border-t pt-3">
        <input className="rounded-lg border px-3 py-2 text-sm" type="url" required placeholder="ছবির URL (https://…)" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
        <input className="rounded-lg border px-3 py-2 text-sm" placeholder="Alt টেক্সট (ঐচ্ছিক)" value={newAlt} onChange={(e) => setNewAlt(e.target.value)} />
        <button className="btn-primary disabled:opacity-50" disabled={busy}>ছবি যোগ করুন</button>
      </form>
      {msg ? <p className="text-sm text-slate-600">{msg}</p> : null}
    </Overlay>
  );
}

/* ---------------- Bundle (EC4) ---------------- */

interface EcBundleItem {
  id: string; componentProductId: string; componentName: string;
  componentSku: string | null; componentVariantId: string | null; quantity: number;
}
interface EcProductOption { id: string; name: string; sku?: string | null }
interface EcVariantOption { id: string; name: string; sku?: string | null }

export function EcBundleDialog({ product, onClose }: { product: EcProductRef; onClose: () => void }) {
  const [bundle, setBundle] = useState<EcBundleItem[]>([]);
  const [options, setOptions] = useState<EcProductOption[]>([]);
  const [variants, setVariants] = useState<EcVariantOption[]>([]);
  const [componentId, setComponentId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const loadBundle = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setLoading(true);
    try {
      const [b, list] = await Promise.all([
        apiFetch<EcBundleItem[]>(`/organizations/${orgId}/products/${product.id}/bundle`),
        apiFetch<{ items: EcProductOption[] }>(`/organizations/${orgId}/products?pageSize=100`),
      ]);
      setBundle(b);
      setOptions(list.items.filter((p) => p.id !== product.id));
      setMsg("");
    } catch (e) { setMsg(e instanceof Error ? e.message : "বান্ডল লোড ব্যর্থ হয়েছে"); }
    finally { setLoading(false); }
  }, [product.id]);

  useEffect(() => { loadBundle(); }, [loadBundle]);

  useEffect(() => {
    setVariantId(""); setVariants([]);
    if (!componentId) return;
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<{ variants?: EcVariantOption[] }>(`/organizations/${orgId}/products/${componentId}`)
      .then((d) => setVariants(d.variants ?? []))
      .catch(() => setVariants([]));
  }, [componentId]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId || !componentId) return;
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/products/${product.id}/bundle`, {
        method: "POST",
        body: JSON.stringify({
          componentProductId: componentId,
          componentVariantId: variantId || undefined,
          quantity: Math.max(1, Number(quantity) || 1),
        }),
      });
      setComponentId(""); setQuantity("1");
      setMsg("কম্পোনেন্ট যোগ হয়েছে।");
      await loadBundle();
    } catch (e) { setMsg(e instanceof Error ? e.message : "যোগ ব্যর্থ হয়েছে"); }
    finally { setBusy(false); }
  }

  async function removeItem(item: EcBundleItem) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/products/${product.id}/bundle/${item.id}`, { method: "DELETE" });
      setMsg("কম্পোনেন্ট সরানো হয়েছে।");
      await loadBundle();
    } catch (e) { setMsg(e instanceof Error ? e.message : "সরানো ব্যর্থ হয়েছে"); }
    finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose}>
      <DialogHeader title={`বান্ডল — ${product.name}`} onClose={onClose} />
      <p className="text-xs text-slate-400">এই পণ্যটি বিক্রি হলে যেসব পণ্য একসাথে যায়, সেগুলো এখানে কম্পোনেন্ট হিসেবে যোগ করুন।</p>
      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : bundle.length === 0 ? (
        <p className="text-sm text-slate-500">এখনো কোনো বান্ডল কম্পোনেন্ট নেই।</p>
      ) : (
        <ul className="space-y-2">
          {bundle.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm">
              <span>
                <span className="font-medium">{b.componentName}</span>
                {b.componentSku ? <span className="text-slate-400"> · {b.componentSku}</span> : null}
                <span className="block text-xs text-slate-500">পরিমাণ: {b.quantity}টি</span>
              </span>
              <button className="text-red-600 text-sm disabled:opacity-50" disabled={busy} onClick={() => removeItem(b)}>সরান</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={addItem} className="space-y-2 border-t pt-3">
        <select className="w-full rounded-lg border px-3 py-2 text-sm" value={componentId} onChange={(e) => setComponentId(e.target.value)} required>
          <option value="">কম্পোনেন্ট পণ্য বেছে নিন…</option>
          {options.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
        </select>
        {variants.length > 0 ? (
          <select className="w-full rounded-lg border px-3 py-2 text-sm" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            <option value="">পুরো পণ্য (ভ্যারিয়েন্ট নয়)</option>
            {variants.map((v) => <option key={v.id} value={v.id}>{v.name}{v.sku ? ` (${v.sku})` : ""}</option>)}
          </select>
        ) : null}
        <div className="flex gap-2">
          <input className="w-28 rounded-lg border px-3 py-2 text-sm" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <button className="btn-primary disabled:opacity-50" disabled={busy || !componentId}>যোগ করুন</button>
        </div>
      </form>
      {msg ? <p className="text-sm text-slate-600">{msg}</p> : null}
    </Overlay>
  );
}

/* ---------------- Category manager (EC3) ---------------- */

export function EcCategoryManagerDialog({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [categories, setCategories] = useState<EcCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", parentId: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", parentId: "" });

  const loadCategories = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setLoading(true);
    try {
      const rows = await apiFetch<EcCategory[]>(`/organizations/${orgId}/products/categories`);
      setCategories(rows);
    } catch (e) { setMsg(e instanceof Error ? e.message : "ক্যাটাগরি লোড ব্যর্থ হয়েছে"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId || !form.name.trim()) return;
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/products/categories`, {
        method: "POST",
        body: JSON.stringify({ name: form.name.trim(), description: form.description.trim() || undefined, parentId: form.parentId || undefined }),
      });
      setForm({ name: "", description: "", parentId: "" });
      setMsg("ক্যাটাগরি তৈরি হয়েছে।");
      await loadCategories();
      onChanged?.();
    } catch (e) { setMsg(e instanceof Error ? e.message : "তৈরি ব্যর্থ হয়েছে"); }
    finally { setBusy(false); }
  }

  async function saveEdit(id: string) {
    const orgId = getOrganizationId(); if (!orgId || !editForm.name.trim()) return;
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/products/categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editForm.name.trim(), description: editForm.description.trim() || undefined, parentId: editForm.parentId || null }),
      });
      setEditId(null);
      setMsg("ক্যাটাগরি হালনাগাদ হয়েছে।");
      await loadCategories();
      onChanged?.();
    } catch (e) { setMsg(e instanceof Error ? e.message : "হালনাগাদ ব্যর্থ হয়েছে"); }
    finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose} wide>
      <DialogHeader title="ক্যাটাগরি পরিচালনা" onClose={onClose} />
      {loading ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : categories.length === 0 ? (
        <p className="text-sm text-slate-500">এখনো কোনো ক্যাটাগরি নেই।</p>
      ) : (
        <ul className="space-y-2">
          {categories.map((c) => (
            <li key={c.id} className="rounded-lg border p-2.5 text-sm">
              {editId === c.id ? (
                <div className="space-y-2">
                  <input className="w-full rounded-lg border px-3 py-2 text-sm" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="নাম *" />
                  <input className="w-full rounded-lg border px-3 py-2 text-sm" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder="বিবরণ (ঐচ্ছিক)" />
                  <select className="w-full rounded-lg border px-3 py-2 text-sm" value={editForm.parentId} onChange={(e) => setEditForm({ ...editForm, parentId: e.target.value })}>
                    <option value="">প্যারেন্ট নেই</option>
                    {categories.filter((p) => p.id !== c.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button className="btn-primary disabled:opacity-50" disabled={busy} onClick={() => saveEdit(c.id)}>সংরক্ষণ</button>
                    <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setEditId(null)}>বাতিল</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{c.name}</span>
                    <span className="block text-xs text-slate-400">
                      {c.slug}{typeof c.productCount === "number" ? ` · ${c.productCount}টি পণ্য` : ""}
                      {c.parentId ? ` · প্যারেন্ট: ${categories.find((p) => p.id === c.parentId)?.name ?? c.parentId}` : ""}
                    </span>
                  </span>
                  <button className="text-sky-700 text-sm" onClick={() => { setEditId(c.id); setEditForm({ name: c.name, description: c.description ?? "", parentId: c.parentId ?? "" }); }}>নাম বদলান</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={createCategory} className="space-y-2 border-t pt-3">
        <div className="text-sm font-semibold">নতুন ক্যাটাগরি</div>
        <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="নাম *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="বিবরণ (ঐচ্ছিক)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <select className="w-full rounded-lg border px-3 py-2 text-sm" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
          <option value="">প্যারেন্ট নেই</option>
          {categories.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn-primary disabled:opacity-50" disabled={busy}>ক্যাটাগরি তৈরি করুন</button>
      </form>
      {msg ? <p className="text-sm text-slate-600">{msg}</p> : null}
    </Overlay>
  );
}
