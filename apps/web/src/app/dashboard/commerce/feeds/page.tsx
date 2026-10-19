"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useConfirm, useToast } from "@repo/ui/client";
import { ResponsiveTable } from "@repo/ui";

// EC14 — product feeds (Meta catalog / Google Merchant / generic CSV).
// Every number (itemCount / skippedCount / preview rows) comes from
// the server; nothing is estimated client-side.

interface Feed {
  id: string;
  channel: string;
  format: string;
  token: string;
  url: string;
  includeOutOfStock: boolean;
  defaultGoogleCategory?: string | null;
  active: boolean;
  lastGeneratedAt?: string | null;
  itemCount?: number | null;
  skippedCount?: number | null;
}
interface PreviewItem {
  id: string; title: string; link: string; imageLink?: string | null;
  availability: string; price: string; salePrice?: string | null;
  brand?: string | null; gtin?: string | null; itemGroupId?: string | null;
}
interface Preview {
  feed: Feed;
  itemCount: number;
  skippedCount: number;
  items: PreviewItem[];
  skipped: { productId: string; name: string; reason: string; reasonMessage: string }[];
  warnings: string[];
}

const CHANNEL_LABEL: Record<string, string> = {
  meta: "Meta (Facebook/Instagram Catalog)",
  google: "Google Merchant Center",
  tiktok: "tikTokGenericCSVNotAn",
  daraz: "darazCSVExportNotAn",
};

export default function FeedsPage() {
  const { dict, t, locale } = useLocale();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  // create form
  const [channel, setChannel] = useState("meta");
  const [format, setFormat] = useState("xml");
  const [includeOutOfStock, setIncludeOutOfStock] = useState(false);
  const [defaultGoogleCategory, setDefaultGoogleCategory] = useState("");

  // preview
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const out = await apiFetch<{ items: Feed[] }>(`/organizations/${orgId}/commerce/feeds`);
      setFeeds(out.items ?? []);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.loadingFailed); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("create"); setError(""); setNotice("");
    try {
      await apiFetch<{ feed: Feed }>(`/organizations/${orgId}/commerce/feeds`, {
        method: "POST",
        body: JSON.stringify({
          channel,
          format,
          includeOutOfStock,
          defaultGoogleCategory: defaultGoogleCategory.trim() || undefined,
        }),
      });
      setNotice(dict.commerce.feedCreatedPutTheURL);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.creationFailed); }
    finally { setBusy(""); }
  }

  async function toggleActive(f: Feed) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`active-${f.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/feeds/${f.id}/active`, {
        method: "POST", body: JSON.stringify({ active: !f.active }),
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.failed); }
    finally { setBusy(""); }
  }

  async function rotateToken(f: Feed) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: dict.commerce.rotateTheToken, body: dict.commerce.rotatingTheTokenWillStop, danger: true, confirmLabel: dict.commerce.rotate }))) return;
    setBusy(`rotate-${f.id}`); setError(""); setNotice("");
    try {
      await apiFetch<{ feed: Feed }>(`/organizations/${orgId}/commerce/feeds/${f.id}/rotate-token`, { method: "POST" });
      setNotice(dict.commerce.tokenRotatedPutTheNew);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.rotationFailed); }
    finally { setBusy(""); }
  }

  async function remove(f: Feed) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: dict.commerce.deleteThisFeed, body: dict.commerce.itsURLWillNoLonger, danger: true, confirmLabel: dict.commerce.delete2 }))) return;
    setBusy(`del-${f.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/feeds/${f.id}`, { method: "DELETE" });
      if (previewId === f.id) { setPreviewId(null); setPreview(null); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.deleteFailed); }
    finally { setBusy(""); }
  }

  async function showPreview(f: Feed) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (previewId === f.id) { setPreviewId(null); setPreview(null); return; }
    setBusy(`preview-${f.id}`); setPreviewError(""); setPreview(null); setPreviewId(f.id);
    try {
      const out = await apiFetch<Preview>(`/organizations/${orgId}/commerce/feeds/${f.id}/preview`);
      setPreview(out);
    } catch (e) { setPreviewError(e instanceof Error ? e.message : dict.commerce.previewFailed); }
    finally { setBusy(""); }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: dict.commerce.feedURLCopied, tone: "success" });
    } catch {
      setError(dict.commerce.couldNotCopyCopyThe3);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{dict.commerce.productFeedsProductFeeds}</h1>
          <p className="text-sm text-slate-500">
            {dict.commerce.createLiveFeedURLsFor}</p>
        </div>
        <Link href="/dashboard/commerce" className="btn-primary">← Commerce Hub</Link>
      </div>

      <p className="rounded-lg bg-amber-50 p-3 text-sm leading-relaxed text-amber-800">
        <b>{dict.commerce.honestStatusResearch13October}</b> {dict.commerce.metaGoogleFeedsCanBe}{" "}
        <b>{dict.commerce.tikTokShopIsNotLaunched}</b>{" "}
        <b>{dict.commerce.theDarazCSVIsAn}</b> {dict.commerce.theAPIAdapterIsIn}</p>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="card p-5 space-y-4">
        <div className="font-semibold">{dict.commerce.newFeed}</div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">{dict.commerce.channel}<select className="input mt-1" value={channel} onChange={(e) => { setChannel(e.target.value); if (e.target.value === "daraz" || e.target.value === "tiktok") setFormat("csv"); }}>
              {Object.entries(CHANNEL_LABEL).map(([v, l]) => <option key={v} value={v}>{dict.commerce[l as keyof typeof dict.commerce]}</option>)}
            </select>
          </label>
          <label className="block text-sm">{dict.commerce.format}<select className="input mt-1" value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="xml">XML</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <label className="block text-sm">{dict.commerce.defaultGoogleCategoryOptional}<input className="input mt-1" value={defaultGoogleCategory} onChange={(e) => setDefaultGoogleCategory(e.target.value)} placeholder={dict.commerce.eGApparelAccessoriesClothing} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeOutOfStock} onChange={(e) => setIncludeOutOfStock(e.target.checked)} />
          {dict.commerce.keepOutOfStockProducts}</label>
        <button className="btn-primary" disabled={busy !== ""} onClick={create}>
          {busy === "create" ? dict.commerce.creating : dict.commerce.createFeed}
        </button>
      </div>

      <div className="space-y-4">
        <div className="font-semibold">{dict.commerce.allFeeds}{feeds.length})</div>
        {loading ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : feeds.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.commerce.noFeedsYetCreateThe}</p>
        ) : feeds.map((f) => (
          <div key={f.id} className="card p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{CHANNEL_LABEL[f.channel] ? dict.commerce[CHANNEL_LABEL[f.channel] as keyof typeof dict.commerce] : f.channel}</span>
              <span className="rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{f.format.toUpperCase()}</span>
              <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${f.active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{f.active ? dict.commerce.active : dict.commerce.closed}</span>
              <span className="text-xs text-slate-500">{dict.commerce.items}{f.itemCount ?? "—"} {dict.commerce.skipped}{f.skippedCount ?? "—"}</span>
              <span className="text-xs text-slate-500">{dict.commerce.lastGenerated}{f.lastGeneratedAt ? fmtDateTime(locale, new Date(f.lastGeneratedAt)) : dict.commerce.notYet}</span>
            </div>
            <div className="flex gap-2">
              <input aria-label={dict.commerce.feedURL} className="input flex-1 font-mono text-xs" readOnly value={f.url} onFocus={(e) => e.target.select()} />
              <button className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => copyUrl(f.url)}>{dict.commerce.copy}</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleActive(f)}>
                {busy === `active-${f.id}` ? "…" : f.active ? dict.commerce.close : dict.commerce.activate}
              </button>
              <button className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => showPreview(f)}>
                {busy === `preview-${f.id}` ? dict.commerce.previewLoading : previewId === f.id ? dict.commerce.closePreview : dict.commerce.preview}
              </button>
              <button className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => rotateToken(f)}>{dict.commerce.rotateToken}</button>
              <button className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold text-rose-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => remove(f)}>{dict.commerce.delete}</button>
            </div>

            {previewId === f.id ? (
              <div className="space-y-3 border-t pt-3">
                {previewError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{previewError}</p> : null}
                {!preview && !previewError ? <p className="text-sm text-slate-400">{dict.commerce.previewLoading2}</p> : null}
                {preview ? (
                  <>
                    <p className="text-sm text-slate-600">
                      {dict.commerce.totalItems2}<b>{preview.itemCount}</b> {dict.commerce.skipped}<b>{preview.skippedCount}</b>
                      <span className="text-xs text-slate-500"> {dict.commerce.first}{preview.items.length}{dict.commerce.itemsShownBelow}</span>
                    </p>
                    {preview.warnings.length > 0 ? (
                      <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                        {preview.warnings.map((w, i) => <p key={i}>⚠️ {w}</p>)}
                      </div>
                    ) : null}
                    {preview.items.length > 0 ? (
                      <ResponsiveTable
                        table={
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs text-slate-400">
                              <th className="py-2 font-medium">ID</th><th className="py-2 font-medium">{dict.commerce.title}</th>
                              <th className="py-2 font-medium">{dict.commerce.price2}</th><th className="py-2 font-medium">{dict.commerce.salePrice}</th>
                              <th className="py-2 font-medium">{dict.commerce.availability}</th><th className="py-2 font-medium">{dict.commerce.link}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.items.map((it) => (
                              <tr key={it.id} className="border-b last:border-0 align-top">
                                <td className="py-2 font-mono text-xs">{it.id}</td>
                                <td className="py-2">{it.title}</td>
                                <td className="py-2">{it.price}</td>
                                <td className="py-2">{it.salePrice ?? "—"}</td>
                                <td className="py-2">{it.availability}</td>
                                <td className="py-2"><a href={it.link} target="_blank" rel="noreferrer" className="text-indigo-700 underline">{dict.commerce.open}</a></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                        }
                        cards={preview.items.map((it) => (
                          <div key={it.id} className="rounded-xl border bg-white p-3 text-sm shadow-sm">
                            <dl className="space-y-1.5">
                              <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ID</dt><dd className="text-right font-mono text-xs">{it.id}</dd></div>
                              <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.title}</dt><dd className="text-right">{it.title}</dd></div>
                              <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.price2}</dt><dd className="text-right">{it.price}</dd></div>
                              <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.salePrice}</dt><dd className="text-right">{it.salePrice ?? "—"}</dd></div>
                              <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.availability}</dt><dd className="text-right">{it.availability}</dd></div>
                            </dl>
                            <a href={it.link} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-[44px] items-center text-indigo-700 underline">{dict.commerce.open}</a>
                          </div>
                        ))}
                      />
                    ) : <p className="text-sm text-slate-500">{dict.commerce.noItemsInThePreview}</p>}
                    {preview.skipped.length > 0 ? (
                      <div>
                        <div className="text-sm font-medium">{dict.commerce.skippedProducts}{preview.skipped.length})</div>
                        <ul className="mt-1 space-y-1 text-sm text-slate-600">
                          {preview.skipped.map((s) => (
                            <li key={s.productId}>• {s.name} — <span className="text-rose-600">{s.reasonMessage}</span> <span className="text-xs text-slate-500">({s.reason})</span></li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
