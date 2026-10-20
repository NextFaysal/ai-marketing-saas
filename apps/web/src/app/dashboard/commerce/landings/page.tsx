"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useConfirm, useToast } from "@repo/ui/client";
import { formatMinorTaka } from "@/lib/storefront-money";
import { ResponsiveTable } from "@repo/ui";
import {
  formatConversionRate, formatPValue, variantSignificance,
  type VariantVsControl,
} from "@/lib/ab7";

// EC13 — staff landing-page builder. Consumes the staff routes in
// apps/api/src/landings/landings.controller.ts:
//   POST   organizations/:orgId/landings
//   GET    organizations/:orgId/landings            -> { total, items[] }
//   GET    organizations/:orgId/landings/:id        -> landing + variants[]
//   PATCH  organizations/:orgId/landings/:id
//   DELETE organizations/:orgId/landings/:id        (archive, not hard delete)
//   GET    organizations/:orgId/landings/:id/stats
//   POST/PATCH/DELETE .../landings/:id/variants[/:variantId]
// Section shapes come from apps/api/src/landings/sections.ts.

interface LandingListItem {
  id: string; productId: string; slug: string; title: string; status: string;
  upsellProductId?: string | null; productName?: string | null;
  orders?: number; orderCount?: number; revenueMinor?: string;
}
interface LandingVariant {
  id: string; name: string; isControl: boolean; weight: number;
  headline?: string | null; heroImageUrl?: string | null; ctaText?: string | null;
  showCompareAt: boolean;
}
interface LandingDetail extends LandingListItem {
  sections?: Section[] | null;
  variants: LandingVariant[];
}
interface Section { type: string; enabled: boolean; order: number; data: Record<string, any> }
interface ProductOpt { id: string; name: string }
interface LandingStats {
  landingId: string; views: number; checkoutStarted: number; orders: number;
  revenueMinor: string; conversionPct: number | null;
  // AB7 (AX20): stats-level winner (display only — nothing here
  // auto-switches traffic to the winner).
  winnerId?: string | null;
  variants: {
    variantId: string; name: string; views: number; orders: number; revenueMinor: string;
    conversionPct: number | null;
    // AB7 (AX20): per-variant conversion rate + vs-control test.
    conversionRate?: number | null;
    vsControl?: VariantVsControl | null;
  }[];
}

const SECTION_TYPES = ["hero", "description", "benefits", "gallery", "reviews", "faq", "offer", "trust"] as const;
const SECTION_LABEL: Record<string, string> = {
  hero: "heroImageHeadlinePriceCTA",
  description: "description",
  benefits: "benefits",
  gallery: "imageGallery",
  reviews: "reviews",
  faq: "fAQ",
  offer: "offerBump",
  trust: "trustCODDeliveryReturn",
};
const STATUS_LABEL: Record<string, string> = { draft: "draft", published: "published", archived: "archive" };

function defaultSections(): Section[] {
  return SECTION_TYPES.map((type, i) => ({ type, enabled: true, order: i, data: {} }));
}
function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
function statusPill(status: string, d: Record<string, string>) {
  const cls = status === "published" ? "bg-green-100 text-green-700"
    : status === "archived" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-700";
  return <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{STATUS_LABEL[status] ? d[STATUS_LABEL[status]] : status}</span>;
}

export default function LandingsPage() {
  const { dict, t, locale } = useLocale();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [landings, setLandings] = useState<LandingListItem[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // create form
  const [cProductId, setCProductId] = useState("");
  const [cTitle, setCTitle] = useState("");
  const [cSlug, setCSlug] = useState("");
  const [cSlugTouched, setCSlugTouched] = useState(false);
  const [cUpsellId, setCUpsellId] = useState("");
  const [cStatus, setCStatus] = useState("draft");

  // editor
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LandingDetail | null>(null);
  const [stats, setStats] = useState<LandingStats | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eSlug, setESlug] = useState("");
  const [eStatus, setEStatus] = useState("draft");
  const [eUpsellId, setEUpsellId] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  // GC5: section drag-reorder state (↑/↓ buttons stay as fallback).
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // variant form
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [vName, setVName] = useState("");
  const [vWeight, setVWeight] = useState("50");
  const [vHeadline, setVHeadline] = useState("");
  const [vHero, setVHero] = useState("");
  const [vCta, setVCta] = useState("");
  const [vShowCompareAt, setVShowCompareAt] = useState(true);
  const [vIsControl, setVIsControl] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [l, p] = await Promise.all([
        apiFetch<{ total: number; items: LandingListItem[] }>(`/organizations/${orgId}/landings`),
        apiFetch<{ items: ProductOpt[] }>(`/organizations/${orgId}/products?pageSize=100`).catch(() => ({ items: [] as ProductOpt[] })),
      ]);
      setLandings(l.items ?? []);
      setProducts(p.items ?? []);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.loadingFailed); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("detail"); setError("");
    try {
      const [d, s] = await Promise.all([
        apiFetch<LandingDetail>(`/organizations/${orgId}/landings/${id}`),
        apiFetch<LandingStats>(`/organizations/${orgId}/landings/${id}/stats`).catch(() => null),
      ]);
      setDetail(d);
      setStats(s);
      setETitle(d.title); setESlug(d.slug); setEStatus(d.status);
      setEUpsellId(d.upsellProductId ?? "");
      setSections(Array.isArray(d.sections) && d.sections.length ? d.sections : defaultSections());
      resetVariantForm();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.detailsLoadingFailed); }
    finally { setBusy(""); }
  }, []);

  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [selectedId, loadDetail]);

  function publicLink(slug: string) {
    return typeof window !== "undefined" ? `${window.location.origin}/l/${slug}` : `/l/${slug}`;
  }
  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); toast({ title: dict.commerce.linkCopied, tone: "success" }); }
    catch { setError(dict.commerce.couldNotCopyCopyThe); }
  }

  async function create() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("create"); setError(""); setNotice("");
    try {
      const out = await apiFetch<LandingListItem>(`/organizations/${orgId}/landings`, {
        method: "POST",
        body: JSON.stringify({
          productId: cProductId,
          title: cTitle.trim(),
          slug: cSlug.trim() || undefined,
          upsellProductId: cUpsellId || null,
          status: cStatus,
        }),
      });
      setNotice(t("commerce.landingPageCreatedL", { slug: out.slug }));
      setCTitle(""); setCSlug(""); setCSlugTouched(false); setCUpsellId(""); setCStatus("draft");
      await load();
      setSelectedId(out.id);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.creationFailed); }
    finally { setBusy(""); }
  }

  async function saveEditor() {
    const orgId = getOrganizationId(); if (!orgId || !selectedId) return;
    setBusy("save"); setError(""); setNotice("");
    try {
      const ordered = sections.map((s, i) => ({ ...s, order: i }));
      await apiFetch(`/organizations/${orgId}/landings/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: eTitle.trim(),
          slug: eSlug.trim(),
          status: eStatus,
          upsellProductId: eUpsellId || null,
          sections: ordered,
        }),
      });
      toast({ title: dict.commerce.landingPageSaved, tone: "success" });
      await load();
      await loadDetail(selectedId);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.saveFailed); }
    finally { setBusy(""); }
  }

  async function archive(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: dict.commerce.archiveThisLandingPage, body: dict.commerce.thePublicLinkWillClose, danger: true, confirmLabel: dict.commerce.archive2 }))) return;
    setBusy(`archive-${id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/landings/${id}`, { method: "DELETE" });
      toast({ title: dict.commerce.landingPageArchived, tone: "success" });
      if (selectedId === id) { setSelectedId(null); setDetail(null); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.archiveFailed); }
    finally { setBusy(""); }
  }

  // ---- sections helpers ----
  function moveSection(idx: number, dir: -1 | 1) {
    setSections((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next.map((s, i) => ({ ...s, order: i }));
    });
  }
  // GC5: drag reorder writes the same local sections state as moveSection,
  // so the existing save (which re-stamps `order` by index) persists it
  // unchanged — no API call or payload shape changes.
  function reorderSection(from: number, to: number) {
    if (from === to) return;
    setSections((prev) => {
      if (from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next.map((s, i) => ({ ...s, order: i }));
    });
  }
  function patchSection(idx: number, patch: Partial<Section>) {
    setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }
  function patchSectionData(idx: number, dataPatch: Record<string, any>) {
    setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, data: { ...s.data, ...dataPatch } } : s)));
  }

  // ---- variants ----
  function resetVariantForm() {
    setEditingVariantId(null); setVName(""); setVWeight("50"); setVHeadline("");
    setVHero(""); setVCta(""); setVShowCompareAt(true); setVIsControl(false);
  }
  function startEditVariant(v: LandingVariant) {
    setEditingVariantId(v.id); setVName(v.name); setVWeight(String(v.weight ?? 100));
    setVHeadline(v.headline ?? ""); setVHero(v.heroImageUrl ?? ""); setVCta(v.ctaText ?? "");
    setVShowCompareAt(v.showCompareAt !== false); setVIsControl(!!v.isControl);
  }
  async function saveVariant() {
    const orgId = getOrganizationId(); if (!orgId || !selectedId) return;
    setBusy("variant"); setError(""); setNotice("");
    const body = {
      name: vName.trim(),
      weight: parseInt(vWeight || "0", 10) || 0,
      headline: vHeadline.trim() || null,
      heroImageUrl: vHero.trim() || null,
      ctaText: vCta.trim() || null,
      showCompareAt: vShowCompareAt,
      isControl: vIsControl,
    };
    try {
      if (editingVariantId) {
        await apiFetch(`/organizations/${orgId}/landings/${selectedId}/variants/${editingVariantId}`, { method: "PATCH", body: JSON.stringify(body) });
        toast({ title: dict.commerce.variantUpdated, tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/landings/${selectedId}/variants`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: dict.commerce.newVariantAdded, tone: "success" });
      }
      resetVariantForm();
      await loadDetail(selectedId);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.variantSaveFailed); }
    finally { setBusy(""); }
  }
  async function deleteVariant(v: LandingVariant) {
    const orgId = getOrganizationId(); if (!orgId || !selectedId) return;
    if (!(await confirm({ title: t("commerce.deleteTheVariant", { name: v.name }), danger: true, confirmLabel: dict.commerce.delete2 }))) return;
    setBusy(`vdel-${v.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/landings/${selectedId}/variants/${v.id}`, { method: "DELETE" });
      toast({ title: dict.commerce.variantDeleted, tone: "success" });
      if (editingVariantId === v.id) resetVariantForm();
      await loadDetail(selectedId);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.deleteFailed); }
    finally { setBusy(""); }
  }

  // ED15/ED16 (EB6): public-link cell, row actions and the stats
  // comparison cell are shared verbatim by the desktop tables and
  // the ResponsiveTable mobile cards — same handlers, same order.
  const renderLandingLink = (l: LandingListItem) => (
    <>
      <span className="font-mono text-xs text-indigo-700">/l/{l.slug}</span>
      <button type="button" className="ml-2 inline-flex min-h-[44px] items-center rounded border bg-white px-2 py-0.5 text-[11px] font-semibold" onClick={() => copyText(publicLink(l.slug))}>{dict.commerce.copy}</button>
      {l.status === "published" ? (
        <Link href={`/l/${l.slug}`} target="_blank" className="ml-2 inline-flex min-h-[44px] items-center px-1 text-[11px] font-semibold text-indigo-700">{dict.commerce.open2}</Link>
      ) : null}
    </>
  );
  const renderLandingActions = (l: LandingListItem) => (
    <div className="flex gap-2">
      <button className="inline-flex min-h-[44px] items-center rounded-lg border bg-white px-2 py-1 text-xs font-semibold" onClick={() => setSelectedId(selectedId === l.id ? null : l.id)}>
        {selectedId === l.id ? dict.commerce.close : dict.commerce.edit}
      </button>
      <button className="inline-flex min-h-[44px] items-center rounded-lg border bg-white px-2 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => archive(l.id)}>{dict.commerce.archive}</button>
    </div>
  );
  const renderVariantComparison = (v: LandingStats["variants"][number]) => {
    const sig = variantSignificance(v.vsControl, locale);
    return sig.kind === "significant" ? (
      <span
        className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700"
        title={`p-value: ${formatPValue(v.vsControl?.pValue)}`}
      >
        {dict.commerce.significantP}{formatPValue(v.vsControl?.pValue)})
      </span>
    ) : sig.kind === "insufficient" ? (
      <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{dict.commerce.notEnoughData}</span>
    ) : v.vsControl ? (
      <span className="text-xs text-slate-500" title={`p-value: ${formatPValue(v.vsControl.pValue)}`}>
        {dict.commerce.notSignificantP}{formatPValue(v.vsControl.pValue)})
      </span>
    ) : "—";
  };

  function sectionContentEditor(section: Section, idx: number) {
    const items: any[] = Array.isArray(section.data?.items) ? section.data.items : [];
    switch (section.type) {
      case "benefits":
        return (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <input className="input w-16" placeholder={dict.commerce.icon} aria-label={dict.commerce.benefitIcon} value={it.icon ?? ""} onChange={(e) => {
                  const next = items.map((x, j) => (j === i ? { ...x, icon: e.target.value } : x));
                  patchSectionData(idx, { items: next });
                }} />
                <input className="input flex-1" placeholder={dict.commerce.title} aria-label={dict.commerce.benefitTitle} value={it.title ?? ""} onChange={(e) => {
                  const next = items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x));
                  patchSectionData(idx, { items: next });
                }} />
                <input className="input flex-[2]" placeholder={dict.commerce.description2} aria-label={dict.commerce.benefitDescription} value={it.text ?? ""} onChange={(e) => {
                  const next = items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x));
                  patchSectionData(idx, { items: next });
                }} />
                <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-2 text-xs font-semibold text-rose-600" onClick={() => patchSectionData(idx, { items: items.filter((_, j) => j !== i) })}>{dict.commerce.delete}</button>
              </div>
            ))}
            <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={items.length >= 8}
              onClick={() => patchSectionData(idx, { items: [...items, { icon: "✅", title: "", text: "" }] })}>
              {dict.commerce.addItemMaximum8}</button>
          </div>
        );
      case "faq":
        return (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <input className="input flex-1" placeholder={dict.commerce.question} aria-label={dict.commerce.question} value={it.q ?? ""} onChange={(e) => {
                  const next = items.map((x, j) => (j === i ? { ...x, q: e.target.value } : x));
                  patchSectionData(idx, { items: next });
                }} />
                <input className="input flex-[2]" placeholder={dict.commerce.answer} aria-label={dict.commerce.answer} value={it.a ?? ""} onChange={(e) => {
                  const next = items.map((x, j) => (j === i ? { ...x, a: e.target.value } : x));
                  patchSectionData(idx, { items: next });
                }} />
                <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-2 py-2 text-xs font-semibold text-rose-600" onClick={() => patchSectionData(idx, { items: items.filter((_, j) => j !== i) })}>{dict.commerce.delete}</button>
              </div>
            ))}
            <button type="button" className="inline-flex min-h-[44px] items-center rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={items.length >= 10}
              onClick={() => patchSectionData(idx, { items: [...items, { q: "", a: "" }] })}>
              {dict.commerce.addQuestionMaximum10}</button>
          </div>
        );
      case "trust":
        return (
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">{dict.commerce.cODText}<input className="input mt-1" value={section.data?.codText ?? ""} placeholder={dict.commerce.cashOnDeliveryPayWhen} onChange={(e) => patchSectionData(idx, { codText: e.target.value })} />
            </label>
            <label className="block text-sm">{dict.commerce.deliveryText}<input className="input mt-1" value={section.data?.deliveryText ?? ""} placeholder={dict.commerce.homeDeliveryAcrossTheCountry} onChange={(e) => patchSectionData(idx, { deliveryText: e.target.value })} />
            </label>
            <label className="block text-sm">{dict.commerce.returnText}<input className="input mt-1" value={section.data?.returnText ?? ""} placeholder={dict.commerce.easyReturnIfThereIs} onChange={(e) => patchSectionData(idx, { returnText: e.target.value })} />
            </label>
          </div>
        );
      case "offer":
        return (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={section.data?.showBump !== false} onChange={(e) => patchSectionData(idx, { showBump: e.target.checked })} />
            {dict.commerce.showThisProductSBump}</label>
        );
      case "description":
        return (
          <label className="block text-sm">{dict.commerce.customDescriptionLeaveEmptyTo}<textarea className="input mt-1" rows={3} value={section.data?.text ?? ""} onChange={(e) => patchSectionData(idx, { text: e.target.value })} />
          </label>
        );
      default:
        return <p className="text-xs text-slate-500">{dict.commerce.thisSectionSContentComes}</p>;
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{dict.commerce.landingPagesFunnelBuilder}</h1>
          <p className="text-sm text-slate-500">
            {dict.commerce.aHighConvertingLandingPage}<b>{dict.commerce.published}</b> {dict.commerce.stateItWillBeVisible}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/funnels"
            className="rounded-lg bg-gradient-to-r from-amber-500 to-rose-500 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:from-amber-600 hover:to-rose-600 transition"
          >
            {dict.commerce.aISalesFunnelStudioBuilt}</Link>
          <Link href="/dashboard/commerce" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">← Commerce Hub</Link>
        </div>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {/* Create */}
      <div className="card space-y-4 p-5">
        <div className="font-semibold">{dict.commerce.newLandingPage}</div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">{dict.commerce.product4}<select className="input mt-1" value={cProductId} onChange={(e) => setCProductId(e.target.value)}>
              <option value="">{dict.commerce.selectAProduct3}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">{dict.commerce.title2}<input className="input mt-1" value={cTitle} onChange={(e) => {
              setCTitle(e.target.value);
              if (!cSlugTouched) setCSlug(slugify(e.target.value));
            }} placeholder={dict.commerce.eGEidSpecialOffer} />
          </label>
          <label className="block text-sm">{dict.commerce.slugURL}<input className="input mt-1 font-mono" value={cSlug} onChange={(e) => { setCSlug(e.target.value); setCSlugTouched(true); }} placeholder="eid-special" />
          </label>
          <label className="block text-sm">{dict.commerce.upsellProductOptional}<select className="input mt-1" value={cUpsellId} onChange={(e) => setCUpsellId(e.target.value)}>
              <option value="">{dict.commerce.none}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">{dict.commerce.status}<select className="input mt-1" value={cStatus} onChange={(e) => setCStatus(e.target.value)}>
              <option value="draft">{dict.commerce.draft}</option>
              <option value="published">{dict.commerce.published}</option>
            </select>
          </label>
        </div>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== "" || !cProductId || !cTitle.trim()} onClick={create}>
          {busy === "create" ? dict.commerce.creating : dict.commerce.createLandingPage}
        </button>
      </div>

      {/* List */}
      <div className="card space-y-3 p-5">
        <div className="font-semibold">{dict.commerce.allLandingPages}{landings.length})</div>
        {loading ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : landings.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.commerce.noLandingPagesYet}</p>
        ) : (
          <ResponsiveTable
            table={
              <div>
                <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 font-medium">{dict.commerce.titleProduct}</th>
                  <th className="py-2 font-medium">{dict.commerce.status}</th>
                  <th className="py-2 font-medium">{dict.commerce.publicLink}</th>
                  <th className="py-2 font-medium">{dict.commerce.order}</th>
                  <th className="py-2 font-medium">{dict.commerce.revenue2}</th>
                  <th className="py-2 font-medium">{dict.commerce.action}</th>
                </tr>
              </thead>
              <tbody>
                {landings.map((l) => (
                  <tr key={l.id} className={`border-b last:border-0 align-top ${selectedId === l.id ? "bg-indigo-50/50" : ""}`}>
                    <td className="py-2">
                      <div className="font-semibold">{l.title}</div>
                      <div className="text-xs text-slate-500">{l.productName ?? l.productId}</div>
                    </td>
                    <td className="py-2">{statusPill(l.status, dict.commerce as unknown as Record<string, string>)}</td>
                    <td className="py-2">
                      {renderLandingLink(l)}
                    </td>
                    <td className="py-2">{l.orderCount ?? l.orders ?? 0}{dict.commerce.text1ou8}</td>
                    <td className="py-2 font-medium">{formatMinorTaka(l.revenueMinor)}</td>
                    <td className="py-2">
                      {renderLandingActions(l)}
                    </td>
                  </tr>
                ))}
                </tbody>
                </table>
              </div>
            }
            cards={landings.map((l) => (
              <div key={l.id} className={`rounded-lg border p-3 ${selectedId === l.id ? "bg-indigo-50/50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{l.title}</div>
                    <div className="text-xs text-slate-500">{l.productName ?? l.productId}</div>
                  </div>
                  {statusPill(l.status, dict.commerce as unknown as Record<string, string>)}
                </div>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.publicLink}</dt>
                    <dd>{renderLandingLink(l)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.order}</dt>
                    <dd>{l.orderCount ?? l.orders ?? 0}{dict.commerce.text1ou8}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.revenue2}</dt>
                    <dd className="font-medium">{formatMinorTaka(l.revenueMinor)}</dd>
                  </div>
                </dl>
                <div className="mt-2">{renderLandingActions(l)}</div>
              </div>
            ))}
          />
        )}
      </div>

      {/* Editor */}
      {selectedId && detail ? (
        <div className="space-y-6">
          <div className="card space-y-4 p-5">
            <div className="font-semibold">{dict.commerce.edit3}{detail.title}</div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block text-sm">{dict.commerce.title}<input className="input mt-1" value={eTitle} onChange={(e) => setETitle(e.target.value)} />
              </label>
              <label className="block text-sm">{dict.commerce.slug}<input className="input mt-1 font-mono" value={eSlug} onChange={(e) => setESlug(e.target.value)} />
              </label>
              <label className="block text-sm">{dict.commerce.status}<select className="input mt-1" value={eStatus} onChange={(e) => setEStatus(e.target.value)}>
                  <option value="draft">{dict.commerce.draft}</option>
                  <option value="published">{dict.commerce.published}</option>
                  <option value="archived">{dict.commerce.archive}</option>
                </select>
              </label>
              <label className="block text-sm">{dict.commerce.upsellProduct}<select className="input mt-1" value={eUpsellId} onChange={(e) => setEUpsellId(e.target.value)}>
                  <option value="">{dict.commerce.none}</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>

            <div className="space-y-3 border-t pt-4">
              <div className="font-semibold">{dict.commerce.sectionsShownOnThePage}</div>
              {sections.map((s, idx) => (
                <div key={`${s.type}-${idx}`}
                  draggable
                  onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOverIdx !== idx) setDragOverIdx(idx); }}
                  onDragLeave={() => { if (dragOverIdx === idx) setDragOverIdx(null); }}
                  onDrop={(e) => { e.preventDefault(); if (dragIdx !== null) reorderSection(dragIdx, idx); setDragIdx(null); setDragOverIdx(null); }}
                  onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                  className={`rounded-xl border p-4 ${s.enabled ? "bg-white" : "bg-slate-50 opacity-70"} ${dragIdx === idx ? "opacity-50" : ""} ${dragOverIdx === idx && dragIdx !== null && dragIdx !== idx ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-300" : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="cursor-grab select-none text-slate-400" title={dict.commerce.dragToReorder} aria-label={dict.commerce.dragToReorder}>⠿</span>
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        <input type="checkbox" checked={s.enabled} onChange={(e) => patchSection(idx, { enabled: e.target.checked })} />
                        {SECTION_LABEL[s.type] ? dict.commerce[SECTION_LABEL[s.type] as keyof typeof dict.commerce] : s.type}
                      </label>
                    </div>
                    <div className="flex gap-1.5">
                      <button type="button" className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2 py-1 text-xs font-semibold disabled:opacity-40" disabled={idx === 0} onClick={() => moveSection(idx, -1)}>{dict.commerce.up}</button>
                      <button type="button" className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2 py-1 text-xs font-semibold disabled:opacity-40" disabled={idx === sections.length - 1} onClick={() => moveSection(idx, 1)}>{dict.commerce.down}</button>
                    </div>
                  </div>
                  {s.enabled ? <div className="mt-3">{sectionContentEditor(s, idx)}</div> : null}
                </div>
              ))}
            </div>

            <button className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={saveEditor}>
              {busy === "save" ? dict.commerce.saving : dict.commerce.saveAll}
            </button>
          </div>

          {/* Stats */}
          <div className="card space-y-3 p-5">
            <div className="font-semibold">{dict.commerce.statistics}</div>
            {stats ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <div className="rounded-lg bg-slate-50 p-3 text-center"><div className="text-xl font-bold">{stats.views}</div><div className="text-[11px] text-slate-500">{dict.commerce.views}</div></div>
                  <div className="rounded-lg bg-slate-50 p-3 text-center"><div className="text-xl font-bold">{stats.checkoutStarted}</div><div className="text-[11px] text-slate-500">{dict.commerce.checkoutStarted}</div></div>
                  <div className="rounded-lg bg-slate-50 p-3 text-center"><div className="text-xl font-bold">{stats.orders}</div><div className="text-[11px] text-slate-500">{dict.commerce.order}</div></div>
                  <div className="rounded-lg bg-slate-50 p-3 text-center"><div className="text-xl font-bold">{formatMinorTaka(stats.revenueMinor)}</div><div className="text-[11px] text-slate-500">{dict.commerce.revenue2}</div></div>
                  <div className="rounded-lg bg-slate-50 p-3 text-center"><div className="text-xl font-bold">{stats.conversionPct != null ? `${stats.conversionPct}%` : "—"}</div><div className="text-[11px] text-slate-500">{dict.commerce.conversionOrdersViews}</div></div>
                </div>
                {stats.variants.length > 0 ? (
                  <ResponsiveTable
                    table={
                      <div>
                        <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-slate-500">
                          <th className="py-2 font-medium">{dict.commerce.variant}</th><th className="py-2 font-medium">{dict.commerce.views}</th>
                          <th className="py-2 font-medium">{dict.commerce.order}</th><th className="py-2 font-medium">{dict.commerce.revenue2}</th>
                          <th className="py-2 font-medium">{dict.commerce.conversion}</th><th className="py-2 font-medium">{dict.commerce.conversionRate}</th>
                          <th className="py-2 font-medium">{dict.commerce.comparedWithControl}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.variants.map((v) => {
                          const isWinner = !!stats.winnerId && stats.winnerId === v.variantId;
                          return (
                          <tr key={v.variantId} className="border-b last:border-0">
                            <td className="py-2 font-medium">
                              {v.name}
                              {isWinner ? (
                                <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">{dict.commerce.winner}</span>
                              ) : null}
                            </td>
                            <td className="py-2">{v.views}</td>
                            <td className="py-2">{v.orders}</td>
                            <td className="py-2">{formatMinorTaka(v.revenueMinor)}</td>
                            <td className="py-2">{v.conversionPct != null ? `${v.conversionPct}%` : "—"}</td>
                            <td className="py-2">{formatConversionRate(v.conversionRate)}</td>
                            <td className="py-2">
                              {renderVariantComparison(v)}
                            </td>
                          </tr>
                          );
                        })}
                        </tbody>
                        </table>
                      </div>
                    }
                    cards={stats.variants.map((v) => {
                      const isWinner = !!stats.winnerId && stats.winnerId === v.variantId;
                      return (
                        <div key={v.variantId} className="rounded-lg border p-3">
                          <div className="font-medium">
                            {v.name}
                            {isWinner ? (
                              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">{dict.commerce.winner}</span>
                            ) : null}
                          </div>
                          <dl className="mt-2 space-y-1.5 text-sm">
                            <div className="flex gap-2">
                              <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.views}</dt>
                              <dd>{v.views}</dd>
                            </div>
                            <div className="flex gap-2">
                              <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.order}</dt>
                              <dd>{v.orders}</dd>
                            </div>
                            <div className="flex gap-2">
                              <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.revenue2}</dt>
                              <dd>{formatMinorTaka(v.revenueMinor)}</dd>
                            </div>
                            <div className="flex gap-2">
                              <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.conversion}</dt>
                              <dd>{v.conversionPct != null ? `${v.conversionPct}%` : "—"}</dd>
                            </div>
                            <div className="flex gap-2">
                              <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.conversionRate}</dt>
                              <dd>{formatConversionRate(v.conversionRate)}</dd>
                            </div>
                            <div className="flex gap-2">
                              <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.comparedWithControl}</dt>
                              <dd>{renderVariantComparison(v)}</dd>
                            </div>
                          </dl>
                        </div>
                      );
                    })}
                  />
                ) : <p className="text-xs text-slate-500">{dict.commerce.noABVariantsAll}</p>}
                {stats.variants.length > 0 ? (
                  <p className="text-xs text-slate-500">
                    {dict.commerce.theWinnerSignificantMarksAre}</p>
                ) : null}
              </>
            ) : <p className="text-sm text-slate-400">{dict.commerce.statisticsDidNotLoad}</p>}
          </div>

          {/* Variants */}
          <div className="card space-y-4 p-5">
            <div className="font-semibold">{dict.commerce.aBVariants}{detail.variants.length})</div>
            <p className="text-xs text-slate-500">
              {dict.commerce.eachVisitorIsSteadilyGiven}</p>
            {detail.variants.length > 0 ? (
              <ul className="space-y-2">
                {detail.variants.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span>
                      <span className="font-semibold">{v.name}</span>
                      {v.isControl ? <span className="ml-2 rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{dict.commerce.control}</span> : null}
                      <span className="ml-2 text-xs text-slate-500">{dict.commerce.weight}{v.weight}</span>
                      {v.headline ? <span className="block text-xs text-slate-500">{dict.commerce.headline}{v.headline}</span> : null}
                      {v.ctaText ? <span className="block text-xs text-slate-500">CTA: {v.ctaText}</span> : null}
                    </span>
                    <span className="flex gap-2">
                      <button className="inline-flex min-h-[44px] items-center rounded-lg border bg-white px-2 py-1 text-xs font-semibold" onClick={() => startEditVariant(v)}>{dict.commerce.edit}</button>
                      <button className="inline-flex min-h-[44px] items-center rounded-lg border bg-white px-2 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deleteVariant(v)}>{dict.commerce.delete}</button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">{dict.commerce.noVariantsYet}</p>}

            <div className="space-y-3 border-t pt-4">
              <div className="font-semibold">{editingVariantId ? dict.commerce.editVariant : dict.commerce.newVariant}</div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="block text-sm">{dict.commerce.name2}<input className="input mt-1" value={vName} onChange={(e) => setVName(e.target.value)} placeholder={dict.commerce.eGRedHeadline} />
                </label>
                <label className="block text-sm">{dict.commerce.weight0100}<input className="input mt-1" type="number" min={0} max={100} value={vWeight} onChange={(e) => setVWeight(e.target.value)} />
                </label>
                <label className="block text-sm">{dict.commerce.cTAText}<input className="input mt-1" value={vCta} onChange={(e) => setVCta(e.target.value)} placeholder={dict.commerce.orderNow} />
                </label>
                <label className="block text-sm md:col-span-2">{dict.commerce.headline2}<input className="input mt-1" value={vHeadline} onChange={(e) => setVHeadline(e.target.value)} placeholder={dict.commerce.leaveEmptyToUseThe} />
                </label>
                <label className="block text-sm">{dict.commerce.heroImageURL}<input className="input mt-1" value={vHero} onChange={(e) => setVHero(e.target.value)} placeholder="https://…" />
                </label>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={vShowCompareAt} onChange={(e) => setVShowCompareAt(e.target.checked)} /> {dict.commerce.showCompareAtPrice}</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={vIsControl} onChange={(e) => setVIsControl(e.target.checked)} /> {dict.commerce.thisIsTheControlVariant}</label>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary disabled:opacity-50" disabled={busy !== "" || !vName.trim()} onClick={saveVariant}>
                  {busy === "variant" ? dict.commerce.saving : editingVariantId ? dict.commerce.updateVariant : dict.commerce.addVariant}
                </button>
                {editingVariantId ? <button className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold" onClick={resetVariantForm}>{dict.common.cancel}</button> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
