"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { useConfirm } from "@repo/ui/client";
import { MediaImage } from "@/components/MediaImage";
import { CategoryTranslationsPanel } from "@/components/product-translations";

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
  const { dict, t, locale } = useLocale();
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
    } catch (e) { setMsg(e instanceof Error ? e.message : dict.products.failedToLoadChannels); }
    finally { setLoading(false); }
  }, [product.id]);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  async function act(key: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(key); setMsg("");
    try { await fn(); setMsg(okMsg); await loadChannels(); }
    catch (e) { setMsg(e instanceof Error ? e.message : dict.products.actionFailed); }
    finally { setBusy(""); }
  }

  const orgId = getOrganizationId();

  return (
    <Overlay onClose={onClose} wide>
      <DialogHeader title={t("products.channels2", { name: product.name })} onClose={onClose} />
      {loading ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : null}
      {!loading && data && data.listings.length === 0 ? (
        <p className="text-sm text-slate-500">{dict.products.thisProductIsNotListed}</p>
      ) : null}
      {data?.listings.map((l) => (
        <div key={l.id} className="rounded-xl border p-3.5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm">{l.storeName}</span>
            <span className="text-xs text-slate-400">({l.platform})</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{l.syncMode}</span>
            <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{l.publishState}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">sync: {l.syncStatus}</span>
            {l.saleActive ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">{dict.products.saleRunning}</span> : null}
          </div>
          {l.syncMode !== "full-manage" ? (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
              {dict.products.thisStoreIsNotIn}</p>
          ) : null}
          {l.lastSyncError ? <p className="text-xs text-red-600">{dict.products.lastSyncError}{l.lastSyncError}</p> : null}
          {l.stockDiverged ? (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
              {dict.products.warningTheStoreSStock}{l.channelStock ?? "—"}{dict.products.andTheStockHere}{data.productStock ?? "—"}{dict.products.doNotMatchThisIs}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {l.publishState !== "published" ? (
              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-emerald-700 disabled:opacity-50" disabled={busy !== ""}
                onClick={() => act(`pub-${l.id}`, () => apiFetch(`/organizations/${orgId}/commerce/listings/${l.id}/publish`, { method: "POST" }), dict.products.publishRequestSent)}>
                {dict.products.publish}</button>
            ) : (
              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-50" disabled={busy !== ""}
                onClick={() => act(`unpub-${l.id}`, () => apiFetch(`/organizations/${orgId}/commerce/listings/${l.id}/unpublish`, { method: "POST" }), dict.products.unpublishRequestSent)}>
                {dict.products.unpublish}</button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-2.5 space-y-2">
              <div className="text-xs font-semibold text-slate-700">
                {dict.products.channelPriceOverride}{l.channelPriceMinor ? t("products.current", { formatMinor: formatMinor(BigInt(l.channelPriceMinor)) }) : dict.products.noneTheBasePriceApplies}
              </div>
              <div className="flex gap-2">
                <input className="w-full rounded-lg border px-2 py-1.5 text-xs" placeholder={dict.products.inPaisaMinorUnitE}
                  value={priceDraft[l.id] ?? ""} onChange={(e) => setPriceDraft({ ...priceDraft, [l.id]: e.target.value })} />
                <button className="whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""}
                  onClick={() => act(`price-${l.id}`, () => apiFetch(`/organizations/${orgId}/commerce/listings/${l.id}/channel-price`, {
                    method: "PATCH", body: JSON.stringify({ channelPriceMinor: (priceDraft[l.id] ?? "").trim() || null }),
                  }), dict.products.channelPriceSaved)}>
                  {dict.products.save}</button>
                <button className="whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs text-slate-500 disabled:opacity-50" disabled={busy !== ""}
                  onClick={() => act(`price-clear-${l.id}`, () => apiFetch(`/organizations/${orgId}/commerce/listings/${l.id}/channel-price`, {
                    method: "PATCH", body: JSON.stringify({ channelPriceMinor: null }),
                  }), dict.products.channelPriceOverrideRemoved)}>
                  {dict.products.delete}</button>
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-2.5 space-y-2">
              <div className="text-xs font-semibold text-slate-700">{dict.products.saleSchedule}</div>
              <label className="block text-[11px] text-slate-500">{dict.products.start}<input type="datetime-local" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs"
                  value={saleDraft[l.id]?.start ?? ""} onChange={(e) => setSaleDraft({ ...saleDraft, [l.id]: { start: e.target.value, end: saleDraft[l.id]?.end ?? "" } })} />
              </label>
              <label className="block text-[11px] text-slate-500">{dict.products.end}<input type="datetime-local" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs"
                  value={saleDraft[l.id]?.end ?? ""} onChange={(e) => setSaleDraft({ ...saleDraft, [l.id]: { start: saleDraft[l.id]?.start ?? "", end: e.target.value } })} />
              </label>
              <button className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""}
                onClick={() => act(`sale-${l.id}`, () => apiFetch(`/organizations/${orgId}/commerce/listings/${l.id}/sale-schedule`, {
                  method: "PATCH",
                  body: JSON.stringify({ saleStartsAt: fromLocalInput(saleDraft[l.id]?.start ?? ""), saleEndsAt: fromLocalInput(saleDraft[l.id]?.end ?? "") }),
                }), dict.products.saleScheduleSaved)}>
                {dict.products.saveSchedule}</button>
            </div>
          </div>

          {myRole === "OWNER" ? (
            confirmDeleteId === l.id ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                <p className="text-xs text-red-800">
                  {dict.products.this}<b>{dict.products.fromTheStore}</b> {dict.products.willDeleteTheProductFrom}</p>
                <div className="flex gap-2">
                  <button className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""}
                    onClick={() => act(`del-${l.id}`, async () => {
                      await apiFetch(`/organizations/${orgId}/commerce/listings/${l.id}/remote`, { method: "DELETE" });
                      setConfirmDeleteId(null);
                    }, dict.products.storeDeletionRequestSent)}>
                    {busy === `del-${l.id}` ? dict.products.deleting : dict.products.yesDeleteFromStore}
                  </button>
                  <button className="rounded-lg border px-3 py-1.5 text-xs" onClick={() => setConfirmDeleteId(null)}>{dict.common.cancel}</button>
                </div>
              </div>
            ) : (
              <button className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""}
                onClick={() => setConfirmDeleteId(l.id)}>
                {dict.products.deleteFromStoreOwnerOnly}</button>
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
  const { dict, t, locale } = useLocale();
  const confirmDialog = useConfirm();
  const [images, setImages] = useState<EcProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newAlt, setNewAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const loadImages = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setLoading(true);
    try {
      const detail = await apiFetch<{ images?: EcProductImage[] }>(`/organizations/${orgId}/products/${product.id}`);
      setImages([...(detail.images ?? [])].sort((a, b) => a.position - b.position));
      setMsg("");
    } catch (e) { setMsg(e instanceof Error ? e.message : dict.products.failedToLoadImage); }
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
      setMsg(dict.products.imageAdded);
      await loadImages();
    } catch (e) { setMsg(e instanceof Error ? e.message : dict.products.failedToAddImage); }
    finally { setBusy(false); }
  }

  // RM4: real file upload — presign → direct PUT to R2 → complete.
  // Per-file failures are reported by file name (Bengali); the
  // URL-add path below is untouched.
  async function uploadFiles(fileList: FileList | File[]) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const MAX = 10 * 1024 * 1024; // = API PRODUCT_IMAGE_UPLOAD_MAX_BYTES
    const TYPES = ["image/png", "image/jpeg", "image/webp"];
    setUploading(true); setMsg("");
    const problems: string[] = [];
    let okCount = 0;
    for (const file of files) {
      try {
        if (!TYPES.includes(file.type)) throw new Error(dict.products.onlyPNGJPEGOrWebP);
        if (file.size > MAX) throw new Error(dict.products.theImageIsLargerThan);
        const pre = await apiFetch<{ uploadUrl: string; key: string }>(
          `/organizations/${orgId}/products/${product.id}/images/presign`,
          { method: "POST", body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size }) },
        );
        const putRes = await fetch(pre.uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        if (!putRes.ok) throw new Error(t("products.theUploadServerDidNot", { status: putRes.status }));
        await apiFetch(`/organizations/${orgId}/products/${product.id}/images/complete`, {
          method: "POST", body: JSON.stringify({ key: pre.key, contentType: file.type, sizeBytes: file.size }),
        });
        okCount += 1;
      } catch (e) {
        problems.push(`${file.name}: ${e instanceof Error ? e.message : dict.products.uploadFailed}`);
      }
    }
    setUploading(false);
    if (okCount > 0) await loadImages();
    setMsg([
      ...(okCount > 0 ? [t("products.imagesUploaded", { okCount: okCount })] : []),
      ...problems,
    ].join("\n"));
  }

  async function deleteImage(img: EcProductImage) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirmDialog({
      title: dict.products.deleteThisImage,
      confirmLabel: dict.products.delete2,
      danger: true,
    }))) return;
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/products/${product.id}/images/${img.id}`, { method: "DELETE" });
      setMsg(dict.products.imageDeleted);
      await loadImages();
    } catch (e) { setMsg(e instanceof Error ? e.message : dict.products.failedToDeleteImage); }
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
    } catch (e) { setMsg(e instanceof Error ? e.message : dict.products.failedToChangeOrder); await loadImages(); }
    finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose} wide>
      <DialogHeader title={t("products.imageGallery", { name: product.name })} onClose={onClose} />
      <p className="text-xs text-slate-400">{dict.products.theFirstImageIsUsed}</p>
      {loading ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : images.length === 0 ? (
        <p className="text-sm text-slate-500">{dict.products.noGalleryImagesYet}</p>
      ) : (
        <ul className="space-y-2">
          {images.map((img, idx) => (
            <li key={img.id} className="flex items-center gap-3 rounded-lg border p-2">
              <MediaImage src={img.url} alt={img.altText ?? ""} width={96} height={96} className="h-12 w-12 rounded-lg object-cover border" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-slate-600" title={img.url}>{img.url}</div>
                <div className="text-[11px] text-slate-400">{dict.products.order2}{img.position}{idx === 0 ? dict.products.cover : ""}{img.altText ? ` · Alt: ${img.altText}` : ""}</div>
              </div>
              <button className="rounded border px-2 py-1 text-xs disabled:opacity-40" disabled={busy || idx === 0} onClick={() => move(idx, -1)} title={dict.products.moveUp}>↑</button>
              <button className="rounded border px-2 py-1 text-xs disabled:opacity-40" disabled={busy || idx === images.length - 1} onClick={() => move(idx, 1)} title={dict.products.moveDown}>↓</button>
              <button className="rounded border px-2 py-1 text-xs text-red-600 disabled:opacity-50" disabled={busy} onClick={() => deleteImage(img)}>{dict.products.delete}</button>
            </li>
          ))}
        </ul>
      )}
      <div
        className={`rounded-lg border-2 border-dashed p-4 text-center text-sm ${dragOver ? "border-sky-500 bg-sky-50" : "border-slate-300"}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void uploadFiles(e.dataTransfer.files); }}
      >
        <p className="text-slate-600">{dict.products.dragAndDropImageFiles}</p>
        <button type="button" className="btn-primary mt-2 disabled:opacity-50" disabled={uploading || busy} onClick={() => fileInputRef.current?.click()}>
          {uploading ? dict.products.uploading : dict.products.chooseAnImageFromFile}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => { void uploadFiles(e.target.files ?? []); e.target.value = ""; }}
        />
        <p className="mt-1 text-[11px] text-slate-400">{dict.products.pNGJPEGWebPMax10}</p>
      </div>
      <form onSubmit={addImage} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] border-t pt-3">
        <input className="rounded-lg border px-3 py-2 text-sm" type="url" required placeholder={dict.products.imageURLHttps} value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
        <input className="rounded-lg border px-3 py-2 text-sm" placeholder={dict.products.altTextOptional} value={newAlt} onChange={(e) => setNewAlt(e.target.value)} />
        <button className="btn-primary disabled:opacity-50" disabled={busy}>{dict.products.addImage}</button>
      </form>
      {msg ? <p className="whitespace-pre-line text-sm text-slate-600">{msg}</p> : null}
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
  const { dict, t, locale } = useLocale();
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
    } catch (e) { setMsg(e instanceof Error ? e.message : dict.products.bundleLoadFailed); }
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
      setMsg(dict.products.componentAdded);
      await loadBundle();
    } catch (e) { setMsg(e instanceof Error ? e.message : dict.products.failedToAdd); }
    finally { setBusy(false); }
  }

  async function removeItem(item: EcBundleItem) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/products/${product.id}/bundle/${item.id}`, { method: "DELETE" });
      setMsg(dict.products.componentRemoved);
      await loadBundle();
    } catch (e) { setMsg(e instanceof Error ? e.message : dict.products.failedToRemove); }
    finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose}>
      <DialogHeader title={t("products.bundle2", { name: product.name })} onClose={onClose} />
      <p className="text-xs text-slate-400">{dict.products.whenThisProductIsSold}</p>
      {loading ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : bundle.length === 0 ? (
        <p className="text-sm text-slate-500">{dict.products.noBundleComponentsYet}</p>
      ) : (
        <ul className="space-y-2">
          {bundle.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm">
              <span>
                <span className="font-medium">{b.componentName}</span>
                {b.componentSku ? <span className="text-slate-400"> · {b.componentSku}</span> : null}
                <span className="block text-xs text-slate-500">{dict.products.quantity}{b.quantity}{dict.products.items}</span>
              </span>
              <button className="text-red-600 text-sm disabled:opacity-50" disabled={busy} onClick={() => removeItem(b)}>{dict.products.remove}</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={addItem} className="space-y-2 border-t pt-3">
        <select className="w-full rounded-lg border px-3 py-2 text-sm" value={componentId} onChange={(e) => setComponentId(e.target.value)} required>
          <option value="">{dict.products.chooseAComponentProduct}</option>
          {options.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
        </select>
        {variants.length > 0 ? (
          <select className="w-full rounded-lg border px-3 py-2 text-sm" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            <option value="">{dict.products.wholeProductNotAVariant}</option>
            {variants.map((v) => <option key={v.id} value={v.id}>{v.name}{v.sku ? ` (${v.sku})` : ""}</option>)}
          </select>
        ) : null}
        <div className="flex gap-2">
          <input className="w-28 rounded-lg border px-3 py-2 text-sm" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <button className="btn-primary disabled:opacity-50" disabled={busy || !componentId}>{dict.products.add}</button>
        </div>
      </form>
      {msg ? <p className="text-sm text-slate-600">{msg}</p> : null}
    </Overlay>
  );
}

/* ---------------- Category manager (EC3) ---------------- */

export function EcCategoryManagerDialog({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const { dict, t, locale } = useLocale();
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
    } catch (e) { setMsg(e instanceof Error ? e.message : dict.products.failedToLoadCategories); }
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
      setMsg(dict.products.categoryCreated);
      await loadCategories();
      onChanged?.();
    } catch (e) { setMsg(e instanceof Error ? e.message : dict.products.creationFailed); }
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
      setMsg(dict.products.categoryUpdated);
      await loadCategories();
      onChanged?.();
    } catch (e) { setMsg(e instanceof Error ? e.message : dict.products.updateFailed); }
    finally { setBusy(false); }
  }

  return (
    <Overlay onClose={onClose} wide>
      <DialogHeader title={dict.products.manageCategories} onClose={onClose} />
      {loading ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : categories.length === 0 ? (
        <p className="text-sm text-slate-500">{dict.products.noCategoriesYet}</p>
      ) : (
        <ul className="space-y-2">
          {categories.map((c) => (
            <li key={c.id} className="rounded-lg border p-2.5 text-sm">
              {editId === c.id ? (
                <div className="space-y-2">
                  <input className="w-full rounded-lg border px-3 py-2 text-sm" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder={dict.products.name} />
                  <input className="w-full rounded-lg border px-3 py-2 text-sm" value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder={dict.products.descriptionOptional} />
                  <select className="w-full rounded-lg border px-3 py-2 text-sm" value={editForm.parentId} onChange={(e) => setEditForm({ ...editForm, parentId: e.target.value })}>
                    <option value="">{dict.products.noParent}</option>
                    {categories.filter((p) => p.id !== c.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button className="btn-primary disabled:opacity-50" disabled={busy} onClick={() => saveEdit(c.id)}>{dict.products.save}</button>
                    <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setEditId(null)}>{dict.common.cancel}</button>
                  </div>
                  {/* MB5 (ML15): category name/description translations
                      (NF5) — managed beside the category edit form. */}
                  <CategoryTranslationsPanel orgId={getOrganizationId() ?? ""} categoryId={c.id} />
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{c.name}</span>
                    <span className="block text-xs text-slate-400">
                      {c.slug}{typeof c.productCount === "number" ? t("products.products3", { productCount: c.productCount }) : ""}
                      {c.parentId ? t("products.parent", { parentId: categories.find((p) => p.id === c.parentId)?.name ?? c.parentId }) : ""}
                    </span>
                  </span>
                  <button className="text-sky-700 text-sm" onClick={() => { setEditId(c.id); setEditForm({ name: c.name, description: c.description ?? "", parentId: c.parentId ?? "" }); }}>{dict.products.rename}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={createCategory} className="space-y-2 border-t pt-3">
        <div className="text-sm font-semibold">{dict.products.newCategory}</div>
        <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder={dict.products.name} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder={dict.products.descriptionOptional} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <select className="w-full rounded-lg border px-3 py-2 text-sm" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
          <option value="">{dict.products.noParent}</option>
          {categories.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn-primary disabled:opacity-50" disabled={busy}>{dict.products.createCategory}</button>
      </form>
      {msg ? <p className="text-sm text-slate-600">{msg}</p> : null}
    </Overlay>
  );
}
