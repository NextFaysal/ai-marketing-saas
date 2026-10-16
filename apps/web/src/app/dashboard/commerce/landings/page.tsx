"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useConfirm, useToast } from "@repo/ui/client";
import { formatMinorTaka } from "@/lib/storefront-money";
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
  hero: "Hero (ছবি, হেডলাইন, দাম, CTA)",
  description: "বিবরণ",
  benefits: "সুবিধা / Benefits",
  gallery: "ছবির গ্যালারি",
  reviews: "রিভিউ",
  faq: "প্রশ্নোত্তর (FAQ)",
  offer: "অফার (বাম্প)",
  trust: "আস্থা (COD / ডেলিভারি / রিটার্ন)",
};
const STATUS_LABEL: Record<string, string> = { draft: "খসড়া", published: "প্রকাশিত", archived: "আর্কাইভ" };

function defaultSections(): Section[] {
  return SECTION_TYPES.map((type, i) => ({ type, enabled: true, order: i, data: {} }));
}
function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
function statusPill(status: string) {
  const cls = status === "published" ? "bg-green-100 text-green-700"
    : status === "archived" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-700";
  return <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export default function LandingsPage() {
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
    } catch (e) { setError(e instanceof Error ? e.message : "লোড ব্যর্থ"); }
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
    } catch (e) { setError(e instanceof Error ? e.message : "বিস্তারিত লোড ব্যর্থ"); }
    finally { setBusy(""); }
  }, []);

  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [selectedId, loadDetail]);

  function publicLink(slug: string) {
    return typeof window !== "undefined" ? `${window.location.origin}/l/${slug}` : `/l/${slug}`;
  }
  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); toast({ title: "লিংক কপি হয়েছে।", tone: "success" }); }
    catch { setError("কপি করা যায়নি — লিংকটি হাতে কপি করুন।"); }
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
      setNotice(`ল্যান্ডিং পেজ তৈরি হয়েছে: /l/${out.slug}`);
      setCTitle(""); setCSlug(""); setCSlugTouched(false); setCUpsellId(""); setCStatus("draft");
      await load();
      setSelectedId(out.id);
    } catch (e) { setError(e instanceof Error ? e.message : "তৈরি ব্যর্থ"); }
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
      toast({ title: "ল্যান্ডিং পেজ সংরক্ষণ হয়েছে।", tone: "success" });
      await load();
      await loadDetail(selectedId);
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function archive(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: "ল্যান্ডিং পেজটি আর্কাইভ করবেন?", body: "পাবলিক লিংকটি বন্ধ হয়ে যাবে, তবে অর্ডারের ইতিহাস থেকে যাবে।", danger: true, confirmLabel: "আর্কাইভ করুন" }))) return;
    setBusy(`archive-${id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/landings/${id}`, { method: "DELETE" });
      toast({ title: "ল্যান্ডিং পেজ আর্কাইভ হয়েছে।", tone: "success" });
      if (selectedId === id) { setSelectedId(null); setDetail(null); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "আর্কাইভ ব্যর্থ"); }
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
        toast({ title: "ভ্যারিয়েন্ট আপডেট হয়েছে।", tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/landings/${selectedId}/variants`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: "নতুন ভ্যারিয়েন্ট যোগ হয়েছে।", tone: "success" });
      }
      resetVariantForm();
      await loadDetail(selectedId);
    } catch (e) { setError(e instanceof Error ? e.message : "ভ্যারিয়েন্ট সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function deleteVariant(v: LandingVariant) {
    const orgId = getOrganizationId(); if (!orgId || !selectedId) return;
    if (!(await confirm({ title: `"${v.name}" ভ্যারিয়েন্টটি মুছে ফেলবেন?`, danger: true, confirmLabel: "মুছে ফেলুন" }))) return;
    setBusy(`vdel-${v.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/landings/${selectedId}/variants/${v.id}`, { method: "DELETE" });
      toast({ title: "ভ্যারিয়েন্ট মুছে ফেলা হয়েছে।", tone: "success" });
      if (editingVariantId === v.id) resetVariantForm();
      await loadDetail(selectedId);
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  function sectionContentEditor(section: Section, idx: number) {
    const items: any[] = Array.isArray(section.data?.items) ? section.data.items : [];
    switch (section.type) {
      case "benefits":
        return (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <input className="input w-16" placeholder="আইকন" value={it.icon ?? ""} onChange={(e) => {
                  const next = items.map((x, j) => (j === i ? { ...x, icon: e.target.value } : x));
                  patchSectionData(idx, { items: next });
                }} />
                <input className="input flex-1" placeholder="শিরোনাম" value={it.title ?? ""} onChange={(e) => {
                  const next = items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x));
                  patchSectionData(idx, { items: next });
                }} />
                <input className="input flex-[2]" placeholder="বর্ণনা" value={it.text ?? ""} onChange={(e) => {
                  const next = items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x));
                  patchSectionData(idx, { items: next });
                }} />
                <button type="button" className="rounded-lg border px-2 py-2 text-xs font-semibold text-rose-600" onClick={() => patchSectionData(idx, { items: items.filter((_, j) => j !== i) })}>মুছুন</button>
              </div>
            ))}
            <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={items.length >= 8}
              onClick={() => patchSectionData(idx, { items: [...items, { icon: "✅", title: "", text: "" }] })}>
              + আইটেম যোগ করুন (সর্বোচ্চ ৮)
            </button>
          </div>
        );
      case "faq":
        return (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <input className="input flex-1" placeholder="প্রশ্ন" value={it.q ?? ""} onChange={(e) => {
                  const next = items.map((x, j) => (j === i ? { ...x, q: e.target.value } : x));
                  patchSectionData(idx, { items: next });
                }} />
                <input className="input flex-[2]" placeholder="উত্তর" value={it.a ?? ""} onChange={(e) => {
                  const next = items.map((x, j) => (j === i ? { ...x, a: e.target.value } : x));
                  patchSectionData(idx, { items: next });
                }} />
                <button type="button" className="rounded-lg border px-2 py-2 text-xs font-semibold text-rose-600" onClick={() => patchSectionData(idx, { items: items.filter((_, j) => j !== i) })}>মুছুন</button>
              </div>
            ))}
            <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={items.length >= 10}
              onClick={() => patchSectionData(idx, { items: [...items, { q: "", a: "" }] })}>
              + প্রশ্ন যোগ করুন (সর্বোচ্চ ১০)
            </button>
          </div>
        );
      case "trust":
        return (
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">COD লেখা
              <input className="input mt-1" value={section.data?.codText ?? ""} placeholder="ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন" onChange={(e) => patchSectionData(idx, { codText: e.target.value })} />
            </label>
            <label className="block text-sm">ডেলিভারির লেখা
              <input className="input mt-1" value={section.data?.deliveryText ?? ""} placeholder="সারা দেশে হোম ডেলিভারি" onChange={(e) => patchSectionData(idx, { deliveryText: e.target.value })} />
            </label>
            <label className="block text-sm">রিটার্নের লেখা
              <input className="input mt-1" value={section.data?.returnText ?? ""} placeholder="ত্রুটি থাকলে সহজ রিটার্ন" onChange={(e) => patchSectionData(idx, { returnText: e.target.value })} />
            </label>
          </div>
        );
      case "offer":
        return (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={section.data?.showBump !== false} onChange={(e) => patchSectionData(idx, { showBump: e.target.checked })} />
            এই সেকশনে পণ্যের বাম্প অফার দেখান (পণ্যে বাম্প সেট থাকলে)
          </label>
        );
      case "description":
        return (
          <label className="block text-sm">কাস্টম বর্ণনা (খালি রাখলে পণ্যের বিবরণই দেখাবে)
            <textarea className="input mt-1" rows={3} value={section.data?.text ?? ""} onChange={(e) => patchSectionData(idx, { text: e.target.value })} />
          </label>
        );
      default:
        return <p className="text-xs text-slate-400">এই সেকশনের কনটেন্ট পণ্যের তথ্য থেকে স্বয়ংক্রিয়ভাবে আসে — আলাদা করে লেখার কিছু নেই।</p>;
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">ল্যান্ডিং পেজ — ফানেল বিল্ডার</h1>
          <p className="text-sm text-slate-500">
            এক পণ্যের জন্য হাই-কনভার্টিং ল্যান্ডিং পেজ: সেকশন সাজান, A/B ভ্যারিয়েন্ট চালান, পোস্ট-অর্ডার আপসেল যোগ করুন।
            পেজ শুধু <b>প্রকাশিত</b> অবস্থায় পাবলিক লিংকে দেখা যাবে।
          </p>
        </div>
        <Link href="/dashboard/commerce" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">← Commerce Hub</Link>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {/* Create */}
      <div className="card space-y-4 p-5">
        <div className="font-semibold">নতুন ল্যান্ডিং পেজ</div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">পণ্য *
            <select className="input mt-1" value={cProductId} onChange={(e) => setCProductId(e.target.value)}>
              <option value="">— পণ্য বেছে নিন —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">শিরোনাম *
            <input className="input mt-1" value={cTitle} onChange={(e) => {
              setCTitle(e.target.value);
              if (!cSlugTouched) setCSlug(slugify(e.target.value));
            }} placeholder="যেমন: ঈদ স্পেশাল অফার" />
          </label>
          <label className="block text-sm">স্লাগ (URL)
            <input className="input mt-1 font-mono" value={cSlug} onChange={(e) => { setCSlug(e.target.value); setCSlugTouched(true); }} placeholder="eid-special" />
          </label>
          <label className="block text-sm">আপসেল পণ্য (ঐচ্ছিক)
            <select className="input mt-1" value={cUpsellId} onChange={(e) => setCUpsellId(e.target.value)}>
              <option value="">— নেই —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">অবস্থা
            <select className="input mt-1" value={cStatus} onChange={(e) => setCStatus(e.target.value)}>
              <option value="draft">খসড়া</option>
              <option value="published">প্রকাশিত</option>
            </select>
          </label>
        </div>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== "" || !cProductId || !cTitle.trim()} onClick={create}>
          {busy === "create" ? "তৈরি হচ্ছে…" : "ল্যান্ডিং পেজ তৈরি করুন"}
        </button>
      </div>

      {/* List */}
      <div className="card space-y-3 p-5">
        <div className="font-semibold">সব ল্যান্ডিং পেজ ({landings.length})</div>
        {loading ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : landings.length === 0 ? (
          <p className="text-sm text-slate-500">এখনো কোনো ল্যান্ডিং পেজ নেই।</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-400">
                  <th className="py-2 font-medium">শিরোনাম / পণ্য</th>
                  <th className="py-2 font-medium">অবস্থা</th>
                  <th className="py-2 font-medium">পাবলিক লিংক</th>
                  <th className="py-2 font-medium">অর্ডার</th>
                  <th className="py-2 font-medium">রেভিনিউ</th>
                  <th className="py-2 font-medium">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {landings.map((l) => (
                  <tr key={l.id} className={`border-b last:border-0 align-top ${selectedId === l.id ? "bg-indigo-50/50" : ""}`}>
                    <td className="py-2">
                      <div className="font-semibold">{l.title}</div>
                      <div className="text-xs text-slate-400">{l.productName ?? l.productId}</div>
                    </td>
                    <td className="py-2">{statusPill(l.status)}</td>
                    <td className="py-2">
                      <span className="font-mono text-xs text-indigo-700">/l/{l.slug}</span>
                      <button type="button" className="ml-2 rounded border bg-white px-2 py-0.5 text-[11px] font-semibold" onClick={() => copyText(publicLink(l.slug))}>কপি</button>
                      {l.status === "published" ? (
                        <Link href={`/l/${l.slug}`} target="_blank" className="ml-2 text-[11px] font-semibold text-indigo-700">খুলুন ↗</Link>
                      ) : null}
                    </td>
                    <td className="py-2">{l.orderCount ?? l.orders ?? 0}টি</td>
                    <td className="py-2 font-medium">{formatMinorTaka(l.revenueMinor)}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold" onClick={() => setSelectedId(selectedId === l.id ? null : l.id)}>
                          {selectedId === l.id ? "বন্ধ করুন" : "সম্পাদনা"}
                        </button>
                        <button className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => archive(l.id)}>আর্কাইভ</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Editor */}
      {selectedId && detail ? (
        <div className="space-y-6">
          <div className="card space-y-4 p-5">
            <div className="font-semibold">সম্পাদনা — {detail.title}</div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block text-sm">শিরোনাম
                <input className="input mt-1" value={eTitle} onChange={(e) => setETitle(e.target.value)} />
              </label>
              <label className="block text-sm">স্লাগ
                <input className="input mt-1 font-mono" value={eSlug} onChange={(e) => setESlug(e.target.value)} />
              </label>
              <label className="block text-sm">অবস্থা
                <select className="input mt-1" value={eStatus} onChange={(e) => setEStatus(e.target.value)}>
                  <option value="draft">খসড়া</option>
                  <option value="published">প্রকাশিত</option>
                  <option value="archived">আর্কাইভ</option>
                </select>
              </label>
              <label className="block text-sm">আপসেল পণ্য
                <select className="input mt-1" value={eUpsellId} onChange={(e) => setEUpsellId(e.target.value)}>
                  <option value="">— নেই —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>

            <div className="space-y-3 border-t pt-4">
              <div className="font-semibold">সেকশনসমূহ (ক্রম অনুযায়ী পেজে দেখাবে — ⠿ ধরে টেনে অথবা ↑/↓ দিয়ে সাজান)</div>
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
                      <span className="cursor-grab select-none text-slate-400" title="টেনে সাজান" aria-label="টেনে সাজান">⠿</span>
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        <input type="checkbox" checked={s.enabled} onChange={(e) => patchSection(idx, { enabled: e.target.checked })} />
                        {SECTION_LABEL[s.type] ?? s.type}
                      </label>
                    </div>
                    <div className="flex gap-1.5">
                      <button type="button" className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold disabled:opacity-40" disabled={idx === 0} onClick={() => moveSection(idx, -1)}>↑ উপরে</button>
                      <button type="button" className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold disabled:opacity-40" disabled={idx === sections.length - 1} onClick={() => moveSection(idx, 1)}>↓ নিচে</button>
                    </div>
                  </div>
                  {s.enabled ? <div className="mt-3">{sectionContentEditor(s, idx)}</div> : null}
                </div>
              ))}
            </div>

            <button className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={saveEditor}>
              {busy === "save" ? "সংরক্ষণ হচ্ছে…" : "সব সংরক্ষণ করুন"}
            </button>
          </div>

          {/* Stats */}
          <div className="card space-y-3 p-5">
            <div className="font-semibold">পরিসংখ্যান</div>
            {stats ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <div className="rounded-lg bg-slate-50 p-3 text-center"><div className="text-xl font-bold">{stats.views}</div><div className="text-[11px] text-slate-500">ভিউ</div></div>
                  <div className="rounded-lg bg-slate-50 p-3 text-center"><div className="text-xl font-bold">{stats.checkoutStarted}</div><div className="text-[11px] text-slate-500">চেকআউট শুরু</div></div>
                  <div className="rounded-lg bg-slate-50 p-3 text-center"><div className="text-xl font-bold">{stats.orders}</div><div className="text-[11px] text-slate-500">অর্ডার</div></div>
                  <div className="rounded-lg bg-slate-50 p-3 text-center"><div className="text-xl font-bold">{formatMinorTaka(stats.revenueMinor)}</div><div className="text-[11px] text-slate-500">রেভিনিউ</div></div>
                  <div className="rounded-lg bg-slate-50 p-3 text-center"><div className="text-xl font-bold">{stats.conversionPct != null ? `${stats.conversionPct}%` : "—"}</div><div className="text-[11px] text-slate-500">কনভার্সন (অর্ডার/ভিউ)</div></div>
                </div>
                {stats.variants.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-slate-400">
                          <th className="py-2 font-medium">ভ্যারিয়েন্ট</th><th className="py-2 font-medium">ভিউ</th>
                          <th className="py-2 font-medium">অর্ডার</th><th className="py-2 font-medium">রেভিনিউ</th>
                          <th className="py-2 font-medium">কনভার্সন</th><th className="py-2 font-medium">কনভার্সন রেট</th>
                          <th className="py-2 font-medium">কন্ট্রোলের সাথে তুলনা</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.variants.map((v) => {
                          const sig = variantSignificance(v.vsControl);
                          const isWinner = !!stats.winnerId && stats.winnerId === v.variantId;
                          return (
                          <tr key={v.variantId} className="border-b last:border-0">
                            <td className="py-2 font-medium">
                              {v.name}
                              {isWinner ? (
                                <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">🏆 বিজয়ী</span>
                              ) : null}
                            </td>
                            <td className="py-2">{v.views}</td>
                            <td className="py-2">{v.orders}</td>
                            <td className="py-2">{formatMinorTaka(v.revenueMinor)}</td>
                            <td className="py-2">{v.conversionPct != null ? `${v.conversionPct}%` : "—"}</td>
                            <td className="py-2">{formatConversionRate(v.conversionRate)}</td>
                            <td className="py-2">
                              {sig.kind === "significant" ? (
                                <span
                                  className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700"
                                  title={`p-value: ${formatPValue(v.vsControl?.pValue)}`}
                                >
                                  তাৎপর্যপূর্ণ (p = {formatPValue(v.vsControl?.pValue)})
                                </span>
                              ) : sig.kind === "insufficient" ? (
                                <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">পর্যাপ্ত ডেটা নেই</span>
                              ) : v.vsControl ? (
                                <span className="text-xs text-slate-500" title={`p-value: ${formatPValue(v.vsControl.pValue)}`}>
                                  তাৎপর্যপূর্ণ নয় (p = {formatPValue(v.vsControl.pValue)})
                                </span>
                              ) : "—"}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-xs text-slate-400">কোনো A/B ভ্যারিয়েন্ট নেই — সব ট্রাফিক ডিফল্ট রূপে যাচ্ছে।</p>}
                {stats.variants.length > 0 ? (
                  <p className="text-xs text-slate-400">
                    "বিজয়ী" ও "তাৎপর্যপূর্ণ" চিহ্ন শুধু তথ্যের জন্য — কোনো ভ্যারিয়েন্টে ট্রাফিক এখান থেকে
                    স্বয়ংক্রিয়ভাবে বদলায় না; ওজন বদলাতে চাইলে নিচের ভ্যারিয়েন্ট তালিকা থেকে নিজে করুন।
                  </p>
                ) : null}
              </>
            ) : <p className="text-sm text-slate-400">পরিসংখ্যান লোড হয়নি।</p>}
          </div>

          {/* Variants */}
          <div className="card space-y-4 p-5">
            <div className="font-semibold">A/B ভ্যারিয়েন্ট ({detail.variants.length})</div>
            <p className="text-xs text-slate-500">
              ভিজিটরকে ওজন (weight) অনুযায়ী স্থিরভাবে একটি ভ্যারিয়েন্ট দেওয়া হয়। ওজন ০ মানে কখনোই নয়;
              সব ওজনের বাইরে পড়লে কন্ট্রোল ভ্যারিয়েন্টটি দেখায়। কন্ট্রোল একটিই থাকে — নতুন কন্ট্রোল সেভ করলে আগেরটি সাধারণ হয়ে যায়।
            </p>
            {detail.variants.length > 0 ? (
              <ul className="space-y-2">
                {detail.variants.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span>
                      <span className="font-semibold">{v.name}</span>
                      {v.isControl ? <span className="ml-2 rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">কন্ট্রোল</span> : null}
                      <span className="ml-2 text-xs text-slate-500">ওজন {v.weight}</span>
                      {v.headline ? <span className="block text-xs text-slate-500">হেডলাইন: {v.headline}</span> : null}
                      {v.ctaText ? <span className="block text-xs text-slate-500">CTA: {v.ctaText}</span> : null}
                    </span>
                    <span className="flex gap-2">
                      <button className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold" onClick={() => startEditVariant(v)}>সম্পাদনা</button>
                      <button className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deleteVariant(v)}>মুছুন</button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">এখনো কোনো ভ্যারিয়েন্ট নেই।</p>}

            <div className="space-y-3 border-t pt-4">
              <div className="font-semibold">{editingVariantId ? "ভ্যারিয়েন্ট সম্পাদনা" : "নতুন ভ্যারিয়েন্ট"}</div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="block text-sm">নাম *
                  <input className="input mt-1" value={vName} onChange={(e) => setVName(e.target.value)} placeholder="যেমন: লাল হেডলাইন" />
                </label>
                <label className="block text-sm">ওজন (০–১০০)
                  <input className="input mt-1" type="number" min={0} max={100} value={vWeight} onChange={(e) => setVWeight(e.target.value)} />
                </label>
                <label className="block text-sm">CTA লেখা
                  <input className="input mt-1" value={vCta} onChange={(e) => setVCta(e.target.value)} placeholder="এখনই অর্ডার করুন" />
                </label>
                <label className="block text-sm md:col-span-2">হেডলাইন
                  <input className="input mt-1" value={vHeadline} onChange={(e) => setVHeadline(e.target.value)} placeholder="খালি রাখলে পণ্যের নামই হেডলাইন হবে" />
                </label>
                <label className="block text-sm">Hero ছবির URL
                  <input className="input mt-1" value={vHero} onChange={(e) => setVHero(e.target.value)} placeholder="https://…" />
                </label>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={vShowCompareAt} onChange={(e) => setVShowCompareAt(e.target.checked)} /> তুলনামূলক দাম (compare-at) দেখান</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={vIsControl} onChange={(e) => setVIsControl(e.target.checked)} /> এটি কন্ট্রোল ভ্যারিয়েন্ট</label>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary disabled:opacity-50" disabled={busy !== "" || !vName.trim()} onClick={saveVariant}>
                  {busy === "variant" ? "সংরক্ষণ হচ্ছে…" : editingVariantId ? "ভ্যারিয়েন্ট আপডেট করুন" : "ভ্যারিয়েন্ট যোগ করুন"}
                </button>
                {editingVariantId ? <button className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold" onClick={resetVariantForm}>বাতিল</button> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
