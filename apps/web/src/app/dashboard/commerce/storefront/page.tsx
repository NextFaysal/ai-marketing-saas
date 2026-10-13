"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BD_DISTRICTS } from "@repo/contracts";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka, minorToTakaString, takaToMinorString } from "@/lib/storefront-money";

// EC8 staff storefront administration. Consumes
// GET /organizations/:id/storefront (staffState):
//   setting { exists, id?, shopEnabled, shopName, announcementText,
//             showFeatured, showCategories, showSearch, metaDescription,
//             featuredProductIds, domainVerifiedAt, hasDomainVerifyToken }
//   zones[] { id, name, kind, districts, chargeMinor, deliveryDays,
//             freeAboveMinor, active, position }   (money = minor strings)
//   organization { id, slug, customDomain }
//   domain { customDomain, verifiedAt, verifyHost }
//   districts (64, BD_DISTRICTS)

interface Setting {
  exists: boolean;
  shopEnabled: boolean;
  shopName: string | null;
  announcementText: string | null;
  showFeatured: boolean;
  showCategories: boolean;
  showSearch: boolean;
  metaDescription: string | null;
  featuredProductIds: string[];
  domainVerifiedAt: string | null;
  hasDomainVerifyToken: boolean;
}
interface Zone {
  id: string;
  name: string;
  kind: string;
  districts: string[];
  chargeMinor: string;
  deliveryDays: number | null;
  freeAboveMinor: string | null;
  active: boolean;
  position: number;
}
interface StaffState {
  setting: Setting;
  zones: Zone[];
  organization: { id: string; slug: string; customDomain: string | null };
  domain: { customDomain: string | null; verifiedAt: string | null; verifyHost: string | null };
  districts: string[];
}
interface ProductOpt { id: string; name: string }
interface VerifyTokenOut { domain: string; recordHost: string; recordType: string; recordValue: string; token: string }
interface RoutingOut { routingActive: boolean; checkedUrl: string | null; status?: number; evidence?: string; reason?: string }

const KIND_LABEL: Record<string, string> = {
  inside_dhaka: "ঢাকার ভিতরে",
  outside_dhaka: "ঢাকার বাইরে",
  district_list: "নির্দিষ্ট জেলা তালিকা",
  all: "সব এলাকা",
};
const KINDS = Object.keys(KIND_LABEL);

export default function StorefrontStaffPage() {
  const [state, setState] = useState<StaffState | null>(null);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // settings form
  const [shopEnabled, setShopEnabled] = useState(false);
  const [shopName, setShopName] = useState("");
  const [announcementText, setAnnouncementText] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [showFeatured, setShowFeatured] = useState(true);
  const [showCategories, setShowCategories] = useState(true);
  const [showSearch, setShowSearch] = useState(true);
  const [featuredIds, setFeaturedIds] = useState<string[]>([]);

  // zone form
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [zName, setZName] = useState("");
  const [zKind, setZKind] = useState("district_list");
  const [zDistricts, setZDistricts] = useState<string[]>([]);
  const [zCharge, setZCharge] = useState("");
  const [zFreeAbove, setZFreeAbove] = useState("");
  const [zDays, setZDays] = useState("");
  const [zActive, setZActive] = useState(true);
  const [zPosition, setZPosition] = useState("0");
  const [zoneError, setZoneError] = useState("");

  // domain
  const [tokenOut, setTokenOut] = useState<VerifyTokenOut | null>(null);
  const [domainError, setDomainError] = useState("");
  const [domainNotice, setDomainNotice] = useState("");
  const [routing, setRouting] = useState<RoutingOut | null>(null);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setLoading(false); setError("কোনো Organization নির্বাচিত নেই।"); return; }
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        apiFetch<StaffState>(`/organizations/${orgId}/storefront`),
        apiFetch<{ items: ProductOpt[] }>(`/organizations/${orgId}/products?pageSize=100`).catch(() => ({ items: [] as ProductOpt[] })),
      ]);
      setState(s);
      setProducts(p.items ?? []);
      const st = s.setting;
      setShopEnabled(st.shopEnabled);
      setShopName(st.shopName ?? "");
      setAnnouncementText(st.announcementText ?? "");
      setMetaDescription(st.metaDescription ?? "");
      setShowFeatured(st.showFeatured);
      setShowCategories(st.showCategories);
      setShowSearch(st.showSearch);
      setFeaturedIds(st.featuredProductIds ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "লোড ব্যর্থ");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const orgSlug = state?.organization.slug ?? "";
  const shopPath = orgSlug ? `/shop/${orgSlug}` : "";
  const districts: readonly string[] = state?.districts?.length ? state.districts : BD_DISTRICTS;

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label} কপি হয়েছে।`);
    } catch {
      setError("কপি করা যায়নি — লেখাটি হাতে কপি করুন।");
    }
  }

  async function saveSettings() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (featuredIds.length > 50) { setError("Featured পণ্য সর্বোচ্চ ৫০টি হতে পারবে।"); return; }
    setBusy("settings"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          shopEnabled,
          shopName: shopName.trim() || null,
          announcementText: announcementText.trim() || null,
          metaDescription: metaDescription.trim() || null,
          showFeatured,
          showCategories,
          showSearch,
          featuredProductIds: featuredIds,
        }),
      });
      setNotice("দোকানের সেটিংস সংরক্ষণ হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  function toggleFeatured(id: string) {
    setFeaturedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 50) { setError("Featured পণ্য সর্বোচ্চ ৫০টি হতে পারবে।"); return prev; }
      return [...prev, id];
    });
  }

  function resetZoneForm() {
    setEditingZoneId(null); setZName(""); setZKind("district_list"); setZDistricts([]);
    setZCharge(""); setZFreeAbove(""); setZDays(""); setZActive(true); setZPosition("0"); setZoneError("");
  }

  function startEditZone(z: Zone) {
    setEditingZoneId(z.id); setZName(z.name); setZKind(z.kind); setZDistricts(z.districts ?? []);
    setZCharge(minorToTakaString(z.chargeMinor));
    setZFreeAbove(minorToTakaString(z.freeAboveMinor));
    setZDays(z.deliveryDays != null ? String(z.deliveryDays) : "");
    setZActive(z.active); setZPosition(String(z.position ?? 0)); setZoneError("");
  }

  async function saveZone() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const chargeMinor = takaToMinorString(zCharge);
    if (chargeMinor === null) { setZoneError("ডেলিভারি চার্জ টাকায় সঠিক সংখ্যা দিন (যেমন: 60 অথবা 60.50)।"); return; }
    let freeAboveMinor: string | null = null;
    if (zFreeAbove.trim()) {
      freeAboveMinor = takaToMinorString(zFreeAbove);
      if (freeAboveMinor === null) { setZoneError("ফ্রি ডেলিভারির সীমা টাকায় সঠিক সংখ্যা দিন (যেমন: 1000)।"); return; }
    }
    if (zKind === "district_list" && zDistricts.length === 0) {
      setZoneError("জেলা-তালিকা জোনের জন্য অন্তত একটি জেলা বেছে নিন।");
      return;
    }
    setBusy("zone"); setZoneError(""); setError(""); setNotice("");
    const body = {
      name: zName.trim(),
      kind: zKind,
      districts: zKind === "district_list" ? zDistricts : null,
      chargeMinor,
      freeAboveMinor,
      deliveryDays: zDays.trim() ? parseInt(zDays, 10) : null,
      active: zActive,
      position: parseInt(zPosition || "0", 10) || 0,
    };
    try {
      if (editingZoneId) {
        await apiFetch(`/organizations/${orgId}/storefront/zones/${editingZoneId}`, { method: "PATCH", body: JSON.stringify(body) });
        setNotice("শিপিং জোন আপডেট হয়েছে।");
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/zones`, { method: "POST", body: JSON.stringify(body) });
        setNotice("নতুন শিপিং জোন তৈরি হয়েছে।");
      }
      resetZoneForm();
      await load();
    } catch (e) { setZoneError(e instanceof Error ? e.message : "জোন সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function deleteZone(z: Zone) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`"${z.name}" জোনটি মুছে ফেলবেন? এটি আর ডেলিভারি হিসেবে ব্যবহৃত হবে না।`)) return;
    setBusy(`zone-del-${z.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/zones/${z.id}`, { method: "DELETE" });
      setNotice("জোন মুছে ফেলা হয়েছে।");
      if (editingZoneId === z.id) resetZoneForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function createDefaults() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("defaults"); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ created: Zone[]; zones: Zone[] }>(`/organizations/${orgId}/storefront/zones/defaults`, { method: "POST" });
      setNotice(
        out.created.length
          ? `ডিফল্ট জোন তৈরি হয়েছে: ${out.created.map((z) => z.name).join(", ")}।`
          : "ঢাকার ভিতরে/বাইরে জোন আগেই ছিল — নতুন কিছু তৈরি হয়নি।",
      );
      await load();
    } catch (e) {
      // Server refusal (e.g. BusinessProfile charges unset) verbatim.
      setError(e instanceof Error ? e.message : "ডিফল্ট জোন তৈরি ব্যর্থ");
    } finally { setBusy(""); }
  }

  async function issueToken() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("token"); setDomainError(""); setDomainNotice(""); setRouting(null);
    try {
      const out = await apiFetch<VerifyTokenOut>(`/organizations/${orgId}/storefront/domain/verify-token`, { method: "POST" });
      setTokenOut(out);
      setDomainNotice("নতুন যাচাই টোকেন তৈরি হয়েছে। নিচের TXT রেকর্ডটি DNS-এ যোগ করুন — আগের যাচাই থাকলে তা নতুন করে প্রমাণ করতে হবে।");
    } catch (e) { setDomainError(e instanceof Error ? e.message : "টোকেন তৈরি ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function verifyDomain() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("verify"); setDomainError(""); setDomainNotice("");
    try {
      const out = await apiFetch<{ verified: boolean; domain: string; verifiedAt: string }>(`/organizations/${orgId}/storefront/domain/verify`, { method: "POST" });
      setDomainNotice(`ডোমেইন যাচাই হয়েছে: ${out.domain} (${new Date(out.verifiedAt).toLocaleString("bn-BD")})`);
      await load();
    } catch (e) { setDomainError(e instanceof Error ? e.message : "যাচাই ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function checkRouting() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("routing"); setDomainError(""); setDomainNotice("");
    try {
      const out = await apiFetch<RoutingOut>(`/organizations/${orgId}/storefront/domain/check-routing`, { method: "POST" });
      setRouting(out);
    } catch (e) { setDomainError(e instanceof Error ? e.message : "Routing পরীক্ষা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  if (loading) return <p className="text-sm text-slate-500">লোড হচ্ছে…</p>;
  if (!state) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error || "Storefront state পাওয়া যায়নি।"}</p>;

  const domain = state.domain;
  const customDomain = domain.customDomain;
  const verified = !!domain.verifiedAt;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Storefront / দোকান — নেটিভ অনলাইন শপ</h1>
          <p className="text-sm text-slate-500">
            WooCommerce/Shopify ছাড়াই নিজের দোকান: পণ্য, কার্ট, ক্যাশ-অন-ডেলিভারি চেকআউট, শিপিং জোন ও কাস্টম ডোমেইন — সব এখান থেকে।
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/commerce/sync" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">← Sync Center</Link>
          <Link href="/dashboard/commerce/discounts" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🏷️ Discounts / কুপন</Link>
          <Link href="/dashboard/commerce/abandoned" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🛒 Abandoned Carts</Link>
        </div>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {/* Live shop link */}
      <div className="card flex flex-wrap items-center gap-3 p-5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">আপনার দোকানের লিংক</div>
          {shopEnabled ? (
            <p className="truncate font-mono text-sm text-indigo-700">{typeof window !== "undefined" ? `${window.location.origin}${shopPath}` : shopPath}</p>
          ) : (
            <p className="text-sm text-slate-500">দোকান এখন বন্ধ আছে — নিচে &ldquo;দোকান চালু করুন&rdquo; অন করে সেভ করলে লিংকটি live হবে। বন্ধ থাকলে লিংকে গেলে 404 দেখাবে।</p>
          )}
        </div>
        {shopPath ? (
          <>
            <button type="button" onClick={() => copyText(typeof window !== "undefined" ? `${window.location.origin}${shopPath}` : shopPath, "দোকানের লিংক")} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">কপি করুন</button>
            <Link href={shopPath} target="_blank" className="btn-primary">দোকান দেখুন ↗</Link>
          </>
        ) : null}
      </div>

      {/* Settings */}
      <section className="card space-y-4 p-5">
        <div className="font-semibold">দোকানের সেটিংস</div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={shopEnabled} onChange={(e) => setShopEnabled(e.target.checked)} />
          দোকান চালু করুন (shopEnabled) {!state.setting.exists ? <span className="text-xs font-normal text-slate-400">— এখনো কোনো সেটিংস সেভ হয়নি</span> : null}
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">দোকানের নাম (খালি = ব্র্যান্ড/সংস্থার নাম)
            <input className="input mt-1" value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="যেমন: আমার ফ্যাশন শপ" />
          </label>
          <label className="block text-sm">ঘোষণা / অ্যানাউন্সমেন্ট (দোকানের উপরে ব্যানার)
            <input className="input mt-1" value={announcementText} onChange={(e) => setAnnouncementText(e.target.value)} placeholder="যেমন: ঈদ অফার — সব পণ্যে ডেলিভারি ফ্রি!" />
          </label>
          <label className="block text-sm md:col-span-2">Meta description (SEO)
            <input className="input mt-1" value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} placeholder="সার্চে দেখানোর জন্য দোকানের সংক্ষিপ্ত বর্ণনা" />
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={showFeatured} onChange={(e) => setShowFeatured(e.target.checked)} /> ফিচার্ড সেকশন</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={showCategories} onChange={(e) => setShowCategories(e.target.checked)} /> ক্যাটাগরি</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={showSearch} onChange={(e) => setShowSearch(e.target.checked)} /> সার্চ</label>
        </div>
        <div>
          <div className="text-sm font-medium">ফিচার্ড পণ্য ({featuredIds.length}/৫০) — ক্রম অনুযায়ী দেখাবে</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {products.length === 0 ? <span className="text-xs text-slate-400">কোনো পণ্য পাওয়া যায়নি</span> : products.map((p) => {
              const on = featuredIds.includes(p.id);
              const order = on ? featuredIds.indexOf(p.id) + 1 : null;
              return (
                <button key={p.id} type="button" onClick={() => toggleFeatured(p.id)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {order ? `${order}. ` : ""}{p.name}
                </button>
              );
            })}
          </div>
        </div>
        <button type="button" onClick={saveSettings} disabled={busy === "settings"} className="btn-primary disabled:opacity-50">
          {busy === "settings" ? "সংরক্ষণ হচ্ছে…" : "সেটিংস সংরক্ষণ করুন"}
        </button>
      </section>

      {/* Shipping zones */}
      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">শিপিং জোন ও ডেলিভারি চার্জ</div>
          <button type="button" onClick={createDefaults} disabled={busy === "defaults"} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
            {busy === "defaults" ? "তৈরি হচ্ছে…" : "ঢাকার ভিতরে/বাইরে ডিফল্ট zone তৈরি করুন"}
          </button>
        </div>
        <p className="text-xs text-slate-500">ডিফল্ট জোন Business Profile-এর ডেলিভারি চার্জ থেকে তৈরি হয়। সব টাকার ঘর টাকায় লিখুন — সিস্টেম নিজে পয়সায় (minor) রূপান্তর করে পাঠাবে।</p>

        {state.zones.length === 0 ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">এখনো কোনো শিপিং জোন নেই — জোন ছাড়া চেকআউটে অর্ডার নেওয়া যাবে না। ডিফল্ট জোন তৈরি করুন অথবা নিচে নিজে বানান।</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {state.zones.map((z) => (
              <div key={z.id} className={`rounded-xl border p-4 ${z.active ? "bg-white" : "bg-slate-50 opacity-70"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{z.name}</div>
                    <div className="text-xs text-slate-500">{KIND_LABEL[z.kind] ?? z.kind} · অবস্থান {z.position} · {z.active ? "সক্রিয়" : "বন্ধ"}</div>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => startEditZone(z)} className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">সম্পাদনা</button>
                    <button type="button" onClick={() => deleteZone(z)} disabled={busy === `zone-del-${z.id}`} className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">মুছুন</button>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <div>ডেলিভারি চার্জ: <b>{formatMinorTaka(z.chargeMinor)}</b></div>
                  <div>ফ্রি ডেলিভারি: {z.freeAboveMinor ? <>{formatMinorTaka(z.freeAboveMinor)} বা তার বেশি অর্ডারে</> : "—"}</div>
                  <div>সময়: {z.deliveryDays != null ? `${z.deliveryDays} দিন` : "—"}</div>
                  {z.kind === "district_list" ? (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {z.districts.map((d) => <span key={d} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{d}</span>)}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{editingZoneId ? "জোন সম্পাদনা" : "নতুন জোন"}</div>
          {zoneError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{zoneError}</p> : null}
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">জোনের নাম
              <input className="input mt-1" value={zName} onChange={(e) => setZName(e.target.value)} placeholder="যেমন: ঢাকার ভিতরে" />
            </label>
            <label className="block text-sm">ধরন
              <select className="input mt-1" value={zKind} onChange={(e) => setZKind(e.target.value)}>
                {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="block text-sm">অবস্থান (ছোট = আগে মিলবে)
              <input className="input mt-1" type="number" value={zPosition} onChange={(e) => setZPosition(e.target.value)} />
            </label>
            <label className="block text-sm">ডেলিভারি চার্জ (টাকা)
              <input className="input mt-1" inputMode="decimal" value={zCharge} onChange={(e) => setZCharge(e.target.value)} placeholder="60" />
            </label>
            <label className="block text-sm">এর উপরে ফ্রি ডেলিভারি (টাকা, খালি = নেই)
              <input className="input mt-1" inputMode="decimal" value={zFreeAbove} onChange={(e) => setZFreeAbove(e.target.value)} placeholder="1000" />
            </label>
            <label className="block text-sm">ডেলিভারি সময় (দিন, খালি = নেই)
              <input className="input mt-1" type="number" value={zDays} onChange={(e) => setZDays(e.target.value)} placeholder="2" />
            </label>
          </div>
          {zKind === "district_list" ? (
            <div>
              <div className="text-sm font-medium">জেলা বেছে নিন ({zDistricts.length}টি)</div>
              <div className="mt-2 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                {districts.map((d) => {
                  const on = zDistricts.includes(d);
                  return (
                    <button key={d} type="button" onClick={() => setZDistricts(on ? zDistricts.filter((x) => x !== d) : [...zDistricts, d])}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={zActive} onChange={(e) => setZActive(e.target.checked)} /> জোন সক্রিয়</label>
          <div className="flex gap-2">
            <button type="button" onClick={saveZone} disabled={busy === "zone" || !zName.trim()} className="btn-primary disabled:opacity-50">
              {busy === "zone" ? "সংরক্ষণ হচ্ছে…" : editingZoneId ? "জোন আপডেট করুন" : "জোন তৈরি করুন"}
            </button>
            {editingZoneId ? <button type="button" onClick={resetZoneForm} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">বাতিল</button> : null}
          </div>
        </div>
      </section>

      {/* Custom domain */}
      <section className="card space-y-4 p-5">
        <div className="font-semibold">কাস্টম ডোমেইন</div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${customDomain ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>১</span>
            <span className="font-semibold">ডোমেইন দেওয়া হয়েছে</span>
            {customDomain ? <span className="font-mono font-bold">{customDomain}</span> : <span className="text-slate-500">— কোনো কাস্টম ডোমেইন সেট করা নেই</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${verified ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>২</span>
            <span className="font-semibold">DNS যাচাই</span>
            {verified ? <span className="text-emerald-700">যাচাই হয়েছে ({domain.verifiedAt ? new Date(domain.verifiedAt).toLocaleString("bn-BD") : ""})</span> : <span className="text-slate-500">এখনো যাচাই হয়নি</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${routing?.routingActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>৩</span>
            <span className="font-semibold">Routing সক্রিয়</span>
            {routing?.routingActive ? (
              <span className="text-emerald-700">সক্রিয় — {routing.evidence ?? routing.checkedUrl}</span>
            ) : routing ? (
              <span className="text-amber-700">সক্রিয় পাওয়া যায়নি: {routing.reason ?? routing.checkedUrl}</span>
            ) : verified ? (
              <span className="text-slate-500">Routing: প্ল্যাটফর্মে ডোমেইন পয়েন্ট + SSL সেটআপ বাকি থাকতে পারে — Check now দিয়ে যাচাই করুন</span>
            ) : (
              <span className="text-slate-500">আগে DNS যাচাই করুন</span>
            )}
          </div>
        </div>

        {!customDomain ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            কাস্টম ডোমেইন ব্যবহার করতে আগে সংস্থার ব্র্যান্ডিং/সেটিংসে Custom Domain সেট করুন, তারপর এখানে এসে যাচাই করুন।{" "}
            <Link href="/dashboard/settings" className="font-bold underline">Organization Settings →</Link>
          </p>
        ) : (
          <>
            {domainError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{domainError}</p> : null}
            {domainNotice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{domainNotice}</p> : null}

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={issueToken} disabled={busy === "token"} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
                {busy === "token" ? "তৈরি হচ্ছে…" : "যাচাই টোকেন তৈরি করুন (TXT)"}
              </button>
              <button type="button" onClick={verifyDomain} disabled={busy === "verify"} className="btn-primary disabled:opacity-50">
                {busy === "verify" ? "যাচাই হচ্ছে…" : "এখন যাচাই করুন"}
              </button>
              <button type="button" onClick={checkRouting} disabled={busy === "routing" || !verified} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
                {busy === "routing" ? "পরীক্ষা হচ্ছে…" : "Routing Check now"}
              </button>
            </div>

            {tokenOut ? (
              <div className="space-y-2 rounded-xl bg-slate-900 p-4 text-xs text-green-300">
                <p className="font-sans font-bold text-white">DNS-এ এই TXT রেকর্ডটি যোগ করুন:</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-sans text-slate-300">Host:</span>
                  <code className="rounded bg-slate-800 px-2 py-1">{tokenOut.recordHost}</code>
                  <button type="button" onClick={() => copyText(tokenOut.recordHost, "TXT Host")} className="rounded bg-white px-2 py-1 font-sans font-bold text-slate-900">কপি</button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-sans text-slate-300">Type: {tokenOut.recordType} · Value:</span>
                  <code className="break-all rounded bg-slate-800 px-2 py-1">{tokenOut.recordValue}</code>
                  <button type="button" onClick={() => copyText(tokenOut.recordValue, "TXT Value")} className="rounded bg-white px-2 py-1 font-sans font-bold text-slate-900">কপি</button>
                </div>
                <p className="font-sans text-slate-400">রেকর্ড যোগ করার পর DNS propagate হতে কিছু সময় লাগতে পারে — তারপর &ldquo;এখন যাচাই করুন&rdquo; চাপুন।</p>
              </div>
            ) : domain.verifyHost ? (
              <p className="text-xs text-slate-500">TXT রেকর্ডের Host হবে: <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{domain.verifyHost}</code> — টোকেন তৈরি করলে এর Value এখানে দেখাবে।</p>
            ) : null}

            <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              মনে রাখবেন: ডোমেইনটি এই প্ল্যাটফর্মের দিকে পয়েন্ট করা (DNS A/CNAME) এবং SSL সার্টিফিকেট সেটআপ (Dokploy/Traefik) একটি
              প্ল্যাটফর্ম-স্তরের কাজ — এই অ্যাপ থেকে করা যায় না। DNS যাচাই সফল হলেও routing সক্রিয় হতে ওই সেটআপ লাগবে; উপরে
              &ldquo;Routing Check now&rdquo; দিয়ে আসল অবস্থা যাচাই করুন — প্রমাণ ছাড়া routing সক্রিয় বলা হবে না।
            </p>
          </>
        )}
      </section>
    </div>
  );
}
