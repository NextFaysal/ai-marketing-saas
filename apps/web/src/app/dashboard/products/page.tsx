"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { EmptyState } from "@repo/ui";

interface ProductItem {
  id: string;
  name: string;
  slug?: string | null;
  sku?: string | null;
  category?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  priceMinor: string;
  compareAtMinor?: string | null;
  currentCostMinor?: string | null;
  marginPercent?: number | null;
  stockQuantity?: number | null;
  lowStockThreshold?: number | null;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  bumpTitle?: string | null;
  bumpPriceMinor?: string | null;
  bumpImageUrl?: string | null;
}

interface VariantItem { id: string; name: string; sku?: string | null; stockQuantity?: number | null; priceMinor?: string | null }

interface SalesBucket { units: number; orders: number; revenueMinor: string; returnedUnits: number }
interface SalesReport {
  days: number;
  products: ({ productId: string; name: string; category?: string | null } & SalesBucket)[];
  categories: ({ category?: string | null } & SalesBucket)[];
  unlinked: SalesBucket;
  totals: SalesBucket;
}

/** Minor-unit string -> taka decimal string for a form input,
 * via BigInt division/remainder (no float loss). */
function minorToDecimal(minor: string): string {
  const v = BigInt(minor);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
interface MovementItem {
  id: string; delta: number; balanceAfter: number; reason: string;
  variantName?: string | null; note?: string | null; createdAt: string;
}

const MOVEMENT_REASON_LABELS: Record<string, string> = {
  order_placed: "অর্ডারে বিক্রি",
  order_cancelled: "বাতিলে ফেরত",
  order_returned: "রিটার্নে ফেরত",
  manual_adjustment: "হাতে সমন্বয়",
  sync_correction: "স্টোর sync সংশোধন",
};

export default function ProductsPage() {
  const [items, setItems] = useState<ProductItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);

  // Form State
  const [form, setForm] = useState({
    name: "",
    sku: "",
    price: "",
    compareAtPrice: "",
    cost: "",
    category: "",
    stockQuantity: "",
    lowStockThreshold: "",
    description: "",
    imageUrl: "",
    status: "ACTIVE" as "ACTIVE" | "DRAFT" | "ARCHIVED",
    bumpTitle: "",
    bumpPrice: "",
    bumpImageUrl: "",
  });
  const [saving, setSaving] = useState(false);
  // Sales & Data S1: stock adjustment dialog (adjustment form + movement history).
  const [stockFor, setStockFor] = useState<ProductItem | null>(null);
  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [variantId, setVariantId] = useState("");
  const [adjDelta, setAdjDelta] = useState("");
  const [adjSetTo, setAdjSetTo] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const [adjThreshold, setAdjThreshold] = useState("");
  const [adjBusy, setAdjBusy] = useState(false);
  const [adjMsg, setAdjMsg] = useState("");
  const [movements, setMovements] = useState<MovementItem[]>([]);
  // Sales & Data S6: product sales report panel.
  const [reportDays, setReportDays] = useState(30);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  // Sales & Data S6: variant manager dialog (separate from the stock dialog).
  const [variantFor, setVariantFor] = useState<ProductItem | null>(null);
  const [mgrVariants, setMgrVariants] = useState<VariantItem[]>([]);
  const [vForm, setVForm] = useState({ name: "", sku: "", price: "", stock: "" });
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [evForm, setEvForm] = useState({ name: "", sku: "", price: "", stock: "" });
  const [vBusy, setVBusy] = useState(false);
  const [vMsg, setVMsg] = useState("");

  const load = useCallback(async (q = "") => {
    const orgId = getOrganizationId();
    if (!orgId) {
      setError("কোনো Organization নির্বাচিত নেই। আবার লগইন করে Onboarding শেষ করুন।");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{ total: number; items: ProductItem[] }>(
        `/organizations/${orgId}/products?pageSize=100${q ? `&search=${encodeURIComponent(q)}` : ""}`
      );
      setItems(data.items);
      setTotal(data.total);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "পণ্য লোড করতে ব্যর্থ হয়েছে");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadReport = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setReportLoading(true);
    try {
      const data = await apiFetch<SalesReport>(`/organizations/${orgId}/products/sales-report?days=${reportDays}`);
      setReport(data); setReportError("");
    } catch (e) { setReportError(e instanceof Error ? e.message : "রিপোর্ট লোড ব্যর্থ হয়েছে"); }
    finally { setReportLoading(false); }
  }, [reportDays]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const refreshMgrVariants = useCallback(async (productId: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    const detail = await apiFetch<ProductItem & { variants?: VariantItem[] }>(
      `/organizations/${orgId}/products/${productId}`);
    setMgrVariants(detail.variants ?? []);
  }, []);

  async function openVariantDialog(p: ProductItem) {
    setVariantFor(p); setMgrVariants([]);
    setVForm({ name: "", sku: "", price: "", stock: "" });
    setEditingVariantId(null); setEvForm({ name: "", sku: "", price: "", stock: "" });
    setVMsg("");
    try { await refreshMgrVariants(p.id); } catch { setVMsg("ভ্যারিয়েন্ট লোড ব্যর্থ হয়েছে।"); }
  }

  async function onCreateVariant(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId || !variantFor) return;
    setVBusy(true); setVMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/products/${variantFor.id}/variants`, {
        method: "POST",
        body: JSON.stringify({
          name: vForm.name, sku: vForm.sku || undefined, price: vForm.price || undefined,
          stockQuantity: vForm.stock ? Number(vForm.stock) : undefined,
        }),
      });
      setVForm({ name: "", sku: "", price: "", stock: "" });
      setVMsg("ভ্যারিয়েন্ট যোগ হয়েছে।");
      await refreshMgrVariants(variantFor.id);
      await load(search);
    } catch (e) { setVMsg(e instanceof Error ? e.message : "ভ্যারিয়েন্ট যোগ ব্যর্থ হয়েছে"); }
    finally { setVBusy(false); }
  }

  function startEditVariant(v: VariantItem) {
    setEditingVariantId(v.id);
    setEvForm({
      name: v.name, sku: v.sku ?? "",
      price: v.priceMinor ? minorToDecimal(v.priceMinor) : "",
      stock: v.stockQuantity != null ? String(v.stockQuantity) : "",
    });
    setVMsg("");
  }

  async function onSaveVariant(v: VariantItem) {
    const orgId = getOrganizationId(); if (!orgId || !variantFor) return;
    setVBusy(true); setVMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/products/${variantFor.id}/variants/${v.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: evForm.name, sku: evForm.sku, price: evForm.price,
          stockQuantity: evForm.stock.trim() ? Number(evForm.stock) : undefined,
        }),
      });
      setEditingVariantId(null);
      setVMsg("ভ্যারিয়েন্ট সংরক্ষণ হয়েছে।");
      await refreshMgrVariants(variantFor.id);
      await load(search);
    } catch (e) { setVMsg(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ হয়েছে"); }
    finally { setVBusy(false); }
  }

  async function onDeleteVariant(v: VariantItem) {
    const orgId = getOrganizationId(); if (!orgId || !variantFor) return;
    if (!window.confirm(`ভ্যারিয়েন্ট "${v.name}" মুছে ফেলবেন?`)) return;
    setVBusy(true); setVMsg("");
    try {
      await apiFetch(`/organizations/${orgId}/products/${variantFor.id}/variants/${v.id}`, { method: "DELETE" });
      if (editingVariantId === v.id) setEditingVariantId(null);
      setVMsg("ভ্যারিয়েন্ট মোছা হয়েছে।");
      await refreshMgrVariants(variantFor.id);
      await load(search);
    } catch (e) { setVMsg(e instanceof Error ? e.message : "মুছতে ব্যর্থ হয়েছে"); }
    finally { setVBusy(false); }
  }

  const loadMovements = useCallback(async (productId: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const data = await apiFetch<{ items: MovementItem[] }>(
        `/organizations/${orgId}/products/${productId}/movements?pageSize=20`);
      setMovements(data.items);
    } catch { setMovements([]); }
  }, []);

  async function openStockDialog(p: ProductItem) {
    setStockFor(p); setVariants([]); setVariantId("");
    setAdjDelta(""); setAdjSetTo(""); setAdjNote(""); setAdjMsg("");
    setAdjThreshold(p.lowStockThreshold != null ? String(p.lowStockThreshold) : "");
    setMovements([]);
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const detail = await apiFetch<ProductItem & { variants?: VariantItem[] }>(
        `/organizations/${orgId}/products/${p.id}`);
      setVariants(detail.variants ?? []);
    } catch { /* variants are optional in the dialog */ }
    await loadMovements(p.id);
  }

  const selectedVariant = variants.find((v) => v.id === variantId) ?? null;
  const currentStock = stockFor ? (selectedVariant ? selectedVariant.stockQuantity : stockFor.stockQuantity) : null;

  async function onAdjust(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId || !stockFor) return;
    setAdjBusy(true); setAdjMsg("");
    try {
      const thresholdNum = adjThreshold.trim() ? Number(adjThreshold) : null;
      if (thresholdNum !== (stockFor.lowStockThreshold ?? null) && thresholdNum !== null) {
        await apiFetch(`/organizations/${orgId}/products/${stockFor.id}`, {
          method: "PATCH", body: JSON.stringify({ lowStockThreshold: thresholdNum }),
        });
      }
      if (adjDelta.trim() || adjSetTo.trim()) {
        const out = await apiFetch<{ stockQuantity: number }>(
          `/organizations/${orgId}/products/${stockFor.id}/stock-adjustment`, {
            method: "POST",
            body: JSON.stringify({
              variantId: variantId || undefined,
              delta: adjDelta.trim() ? Number(adjDelta) : undefined,
              setTo: adjSetTo.trim() ? Number(adjSetTo) : undefined,
              note: adjNote.trim() || undefined,
            }),
          });
        setAdjMsg(`সমন্বয় হয়েছে — নতুন স্টক: ${out.stockQuantity}`);
        setAdjDelta(""); setAdjSetTo(""); setAdjNote("");
        await loadMovements(stockFor.id);
      } else {
        setAdjMsg("সংরক্ষণ হয়েছে।");
      }
      await load(search);
    } catch (e) { setAdjMsg(e instanceof Error ? e.message : "সমন্বয় ব্যর্থ হয়েছে"); }
    finally { setAdjBusy(false); }
  }

  function openCreateModal() {
    setEditingProduct(null);
    setForm({
      name: "",
      sku: "",
      price: "",
      compareAtPrice: "",
      cost: "",
      category: "",
      stockQuantity: "100",
      lowStockThreshold: "",
      description: "",
      imageUrl: "",
      status: "ACTIVE",
      bumpTitle: "",
      bumpPrice: "",
      bumpImageUrl: "",
    });
    setIsModalOpen(true);
  }

  function openEditModal(p: ProductItem) {
    setEditingProduct(p);
    const unitPrice = (Number(p.priceMinor) / 100).toString();
    const compPrice = p.compareAtMinor ? (Number(p.compareAtMinor) / 100).toString() : "";
    const unitCost = p.currentCostMinor ? (Number(p.currentCostMinor) / 100).toString() : "";
    const bPrice = p.bumpPriceMinor ? (Number(p.bumpPriceMinor) / 100).toString() : "";
    setForm({
      name: p.name,
      sku: p.sku || "",
      price: unitPrice,
      compareAtPrice: compPrice,
      cost: unitCost,
      category: p.category || "",
      stockQuantity: p.stockQuantity?.toString() || "",
      lowStockThreshold: p.lowStockThreshold?.toString() || "",
      description: p.description || "",
      imageUrl: p.imageUrl || "",
      status: p.status,
      bumpTitle: p.bumpTitle || "",
      bumpPrice: bPrice,
      bumpImageUrl: p.bumpImageUrl || "",
    });
    setIsModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSaving(true);
    setError("");
    setNotice("");

    try {
      if (editingProduct) {
        // Update product
        await apiFetch(`/organizations/${orgId}/products/${editingProduct.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            category: form.category.trim() || undefined,
            status: form.status,
            price: form.price,
            stockQuantity: form.stockQuantity ? Number(form.stockQuantity) : undefined,
            lowStockThreshold: form.lowStockThreshold ? Number(form.lowStockThreshold) : undefined,
            imageUrl: form.imageUrl.trim() || undefined,
            bumpTitle: form.bumpTitle.trim() || undefined,
            bumpPrice: form.bumpPrice.trim() || undefined,
            bumpImageUrl: form.bumpImageUrl.trim() || undefined,
          }),
        });

        if (form.cost) {
          await apiFetch(`/organizations/${orgId}/products/${editingProduct.id}/costs`, {
            method: "POST",
            body: JSON.stringify({ cost: form.cost }),
          });
        }
        setNotice(`✅ "${form.name}" সফলভাবে আপডেট হয়েছে!`);
      } else {
        // Create product
        const created = await apiFetch<ProductItem>(`/organizations/${orgId}/products`, {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            sku: form.sku.trim() || undefined,
            price: form.price,
            compareAtPrice: form.compareAtPrice.trim() || undefined,
            category: form.category.trim() || undefined,
            stockQuantity: form.stockQuantity ? Number(form.stockQuantity) : undefined,
            lowStockThreshold: form.lowStockThreshold ? Number(form.lowStockThreshold) : undefined,
            description: form.description.trim() || undefined,
            imageUrl: form.imageUrl.trim() || undefined,
            status: form.status,
            bumpTitle: form.bumpTitle.trim() || undefined,
            bumpPrice: form.bumpPrice.trim() || undefined,
            bumpImageUrl: form.bumpImageUrl.trim() || undefined,
          }),
        });

        if (form.cost) {
          await apiFetch(`/organizations/${orgId}/products/${created.id}/costs`, {
            method: "POST",
            body: JSON.stringify({ cost: form.cost }),
          });
        }
        setNotice(`🎉 নতুন পণ্য "${form.name}" সফলভাবে তৈরি হয়েছে!`);
      }

      setIsModalOpen(false);
      await load(search);
    } catch (e) {
      setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ হয়েছে");
    } finally {
      setSaving(false);
    }
  }

  async function onArchive(id: string, name: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!confirm(`আপনি কি নিশ্চিত যে "${name}" আর্কাইভ করতে চান?`)) return;
    try {
      await apiFetch(`/organizations/${orgId}/products/${id}`, { method: "DELETE" });
      setNotice(`"${name}" আর্কাইভ করা হয়েছে।`);
      await load(search);
    } catch (e) {
      setError(e instanceof Error ? e.message : "আর্কাইভ ব্যর্থ হয়েছে");
    }
  }

  // Filter categories
  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean)));
  const filteredItems = items.filter((p) => {
    if (selectedCategory !== "all" && p.category !== selectedCategory) return false;
    return true;
  });

  return (
    <div className="space-y-6 p-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              🛍️ Products & E-Commerce Inventory
            </h1>
            <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
              Live Catalog
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            আপনার পণ্যের তালিকা, স্টক, ভ্যারিয়্যান্ট এবং ১-ক্লিক ইনস্ট্যান্ট চেকআউট ও সোশ্যাল ইনবক্স লিংক।
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              const orgId = getOrganizationId();
              if (!orgId) return;
              try {
                setNotice("ডেমো প্রোডাক্ট তৈরি হচ্ছে...");
                const demoItems = [
                  {
                    name: "অরিজিনাল লেদার ওয়ালেট ও বেল্ট প্রিমিয়াম কম্বো",
                    sku: "WLT-BLT-01",
                    price: "1450",
                    compareAtPrice: "1850",
                    category: "Fashion Accessories",
                    stockQuantity: 45,
                    description: "১০০% অরিজিনাল জেনুইন লেদার ওয়ালেট ও প্রিমিয়াম অটো-লক বেল্ট কম্বো। ৫ বছরের লেদার গ্যারান্টি।",
                    imageUrl: "https://images.unsplash.com/photo-1627123424574-724758594e93?w=500&q=80",
                  },
                  {
                    name: "স্মার্ট ওয়্যারলেস নয়েজ ক্যান্সেলিং ইয়ারবাডস",
                    sku: "EBD-PRO-02",
                    price: "1250",
                    compareAtPrice: "1600",
                    category: "Electronics",
                    stockQuantity: 30,
                    description: "ক্রিস্টাল ক্লিয়ার সাউন্ড, অ্যাক্টিভ নয়েজ ক্যান্সেলেশন ও ৪০ ঘণ্টার ব্যাটারি ব্যাকআপ।",
                    imageUrl: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500&q=80",
                  },
                  {
                    name: "ড্রাই স্কিন ময়েশ্চারাইজিং ডে ক্রিম",
                    sku: "CRM-GLW-03",
                    price: "850",
                    compareAtPrice: "1100",
                    category: "Beauty & Skin Care",
                    stockQuantity: 60,
                    description: "ন্যাচারাল উপাদান সমৃদ্ধ ডিপ হাইড্রেটিং ময়েশ্চারাইজার। সব ধরণের স্কিনের উপযোগী।",
                    imageUrl: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=500&q=80",
                  },
                ];

                for (const item of demoItems) {
                  await apiFetch(`/organizations/${orgId}/products`, {
                    method: "POST",
                    body: JSON.stringify(item),
                  });
                }
                setNotice("✨ ৩টি জনপ্রিয় ডেমো পণ্য সফলভাবে তৈরি হয়েছে! এখন সরাসরি ১-ক্লিক চেকআউট টেস্ট করতে পারবেন।");
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "ডেমো পণ্য তৈরি ব্যর্থ হয়েছে");
              }
            }}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 shadow-sm"
          >
            🧪 ৩টি ডেমো পণ্য যোগ করুন
          </button>
          <a
            href="/dashboard/products/import"
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            📥 CSV Import
          </a>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 shadow-sm transition-all"
          >
            <span>➕ নতুন প্রোডাক্ট যোগ করুন</span>
          </button>
        </div>
      </div>

      {notice ? (
        <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200">
          {error}
        </div>
      ) : null}

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="w-72 rounded-lg border px-3 py-1.5 text-xs"
            placeholder="পণ্যের নাম বা SKU দিয়ে খুঁজুন..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(search)}
          />
          <button
            className="rounded-lg border bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            onClick={() => load(search)}
          >
            🔍 খুঁজুন
          </button>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-xs text-slate-700 font-medium"
          >
            <option value="all">সব ক্যাটাগরি ({items.length})</option>
            {categories.map((c) => (
              <option key={c} value={c!}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          মোট প্রদর্শিত পণ্য: <b>{filteredItems.length}</b> টি
        </div>
      </div>

      {/* Product List */}
      {loading ? (
        <div className="rounded-xl border bg-white p-12 text-center text-sm text-slate-500">
          পণ্য লোড হচ্ছে...
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title="কোনো পণ্য পাওয়া যায়নি"
          description="নতুন পণ্য যোগ করুন অথবা CSV Import দিয়ে একসাথে অনেক পণ্য আনুন।"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b">
              <tr>
                <th className="px-4 py-3">প্রোডাক্ট</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">বিক্রয়মূল্য</th>
                <th className="px-4 py-3">ইউনিট কস্ট</th>
                <th className="px-4 py-3">প্রফিট মার্জিন</th>
                <th className="px-4 py-3">স্টক স্ট্যাটাস</th>
                <th className="px-4 py-3">স্ট্যাটাস</th>
                <th className="px-4 py-3 text-right">অ্যাকশন</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.map((p) => {
                const isLowStock = p.stockQuantity !== null && p.stockQuantity !== undefined && p.stockQuantity <= 5;
                const isOutOfStock = p.stockQuantity !== null && p.stockQuantity !== undefined && p.stockQuantity === 0;

                return (
                  <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.imageUrl ? (
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            className="h-10 w-10 rounded-lg object-cover border border-slate-200"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-500 font-bold text-xs">
                            📦
                          </div>
                        )}
                        <div>
                          <div className="font-bold text-slate-900 line-clamp-1">{p.name}</div>
                          <div className="text-[11px] text-slate-400">
                            {p.category || "সাধারণ ক্যাটাগরি"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">{p.sku || "—"}</td>
                    <td className="px-4 py-3 font-bold text-slate-900">
                      {formatMinor(BigInt(p.priceMinor))}
                      {p.compareAtMinor ? (
                        <div className="text-[10px] text-slate-400 line-through font-normal">
                          {formatMinor(BigInt(p.compareAtMinor))}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {p.currentCostMinor ? (
                        formatMinor(BigInt(p.currentCostMinor))
                      ) : (
                        <span className="text-amber-600 font-medium">কস্ট দেওয়া নেই</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.marginPercent === null || p.marginPercent === undefined ? (
                        "—"
                      ) : (
                        <span className="rounded bg-emerald-50 text-emerald-700 px-2 py-0.5 font-bold">
                          {p.marginPercent}%
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isOutOfStock ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                          🔴 স্টক শেষ (0)
                        </span>
                      ) : isLowStock ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                          ⚠️ লো-স্টক ({p.stockQuantity})
                        </span>
                      ) : (
                        <span className="text-slate-700 font-medium">
                          {p.stockQuantity ?? "আনলিমিটেড"} টি
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                          p.status === "ACTIVE"
                            ? "bg-emerald-100 text-emerald-800"
                            : p.status === "DRAFT"
                            ? "bg-slate-100 text-slate-600"
                            : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {p.slug ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                const fullUrl = `${window.location.origin}/checkout/${p.slug}`;
                                navigator.clipboard.writeText(fullUrl);
                                setNotice(`📋 "${p.name}" এর চেকআউট লিংক কপি করা হয়েছে: ${fullUrl}`);
                              }}
                              className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-1"
                              title="ফেসবুক/ইনবক্সে পাঠানোর জন্য লিংক কপি করুন"
                            >
                              📋 লিংক কপি
                            </button>
                            <a
                              href={`/checkout/${p.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                              title="১-ক্লিক পাবলিক চেকআউট পেজ দেখুন"
                            >
                              🔗 চেকআউট পেজ
                            </a>
                          </>
                        ) : null}
                        <button
                          onClick={() => openStockDialog(p)}
                          className="rounded border px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-50"
                        >
                          📦 স্টক
                        </button>
                        <button
                          onClick={() => openVariantDialog(p)}
                          className="rounded border px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-50"
                        >
                          🧩 ভ্যারিয়েন্ট
                        </button>
                        <button
                          onClick={() => openEditModal(p)}
                          className="rounded border px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                        >
                          ✏️ এডিট
                        </button>
                        <button
                          onClick={() => onArchive(p.id, p.name)}
                          className="rounded border px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">📊 পণ্য বিক্রি</h2>
          <select className="rounded-lg border px-3 py-2 text-sm" value={reportDays} onChange={(e) => setReportDays(Number(e.target.value))}>
            <option value={7}>শেষ ৭ দিন</option>
            <option value={30}>শেষ ৩০ দিন</option>
            <option value={90}>শেষ ৯০ দিন</option>
          </select>
        </div>
        {reportLoading ? <p className="text-sm text-slate-500">লোড হচ্ছে...</p> : reportError ? (
          <p className="text-sm text-slate-500">{reportError}</p>
        ) : !report || report.totals.units === 0 ? (
          <p className="text-sm text-slate-500">এই সময়ে কোনো বিক্রি নেই।</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500"><tr>
                  <th className="px-4 py-3">পণ্য</th><th className="px-4 py-3">ক্যাটাগরি</th><th className="px-4 py-3">ইউনিট</th>
                  <th className="px-4 py-3">অর্ডার</th><th className="px-4 py-3">রিটার্ন (ইউনিট)</th><th className="px-4 py-3">আয়</th>
                </tr></thead>
                <tbody>
                  {report.products.map((r) => (
                    <tr key={r.productId} className="border-t">
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3">{r.category ?? "ক্যাটাগরি নেই"}</td>
                      <td className="px-4 py-3">{r.units}</td>
                      <td className="px-4 py-3">{r.orders}</td>
                      <td className="px-4 py-3">{r.returnedUnits}</td>
                      <td className="px-4 py-3">{formatMinor(BigInt(r.revenueMinor))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm font-medium">
              মোট: {report.totals.units} ইউনিট · {report.totals.orders} অর্ডার · আয় {formatMinor(BigInt(report.totals.revenueMinor))} · রিটার্ন {report.totals.returnedUnits} ইউনিট
            </p>
            {report.categories.length > 0 ? (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500"><tr>
                    <th className="px-4 py-3">ক্যাটাগরি</th><th className="px-4 py-3">ইউনিট</th><th className="px-4 py-3">আয়</th>
                  </tr></thead>
                  <tbody>
                    {report.categories.map((c, i) => (
                      <tr key={`${c.category ?? "none"}-${i}`} className="border-t">
                        <td className="px-4 py-3">{c.category ?? "ক্যাটাগরি নেই"}</td>
                        <td className="px-4 py-3">{c.units}</td>
                        <td className="px-4 py-3">{formatMinor(BigInt(c.revenueMinor))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {report.unlinked.units > 0 ? (
              <p className="text-sm text-slate-600">লিংকহীন আইটেম: {report.unlinked.units} ইউনিট · আয় {formatMinor(BigInt(report.unlinked.revenueMinor))} (এসব আইটেমের পণ্য মেলানো যায়নি)</p>
            ) : null}
          </>
        )}
        <p className="text-xs text-slate-400">হিসাবের নিয়ম: বাতিল, refunded ও failed অর্ডার বাদ (Analytics-এর revenue নিয়ম)। অর্ডারের তারিখ = placedAt, না থাকলে তৈরির সময়। রিটার্ন ইউনিট: যেসব অর্ডারের courier shipment returned হয়েছে অথবা অর্ডারের status returned।</p>
      </section>

      {/* CREATE & EDIT PRODUCT MODAL */}
      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSave}
            className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingProduct ? `✏️ "${editingProduct.name}" এডিট করুন` : "➕ নতুন পণ্য যোগ করুন"}
                </h3>
                <p className="text-xs text-slate-500">
                  প্রোডাক্টের বিবরণ, মূল্য এবং স্টক কনফিগার করুন
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  পণ্যের নাম (Product Name) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="যেমন: প্রিমিয়াম লেদার ওয়ালেট"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">SKU কোড</label>
                  <input
                    type="text"
                    placeholder="WLT-001"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">ক্যাটাগরি</label>
                  <input
                    type="text"
                    placeholder="Fashion / Electronics"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    বিক্রয়মূল্য (BDT) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="1250"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs font-bold text-indigo-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    আসল দাম (Compare Price)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="1500"
                    value={form.compareAtPrice}
                    onChange={(e) => setForm({ ...form, compareAtPrice: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs text-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ইউনিট কস্ট (Cost BDT)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="750"
                    value={form.cost}
                    onChange={(e) => setForm({ ...form, cost: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs text-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    স্টক পরিমাণ (Stock Quantity)
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="50"
                    value={form.stockQuantity}
                    onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">স্ট্যাটাস</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as any })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  >
                    <option value="ACTIVE">ACTIVE (সক্রিয়)</option>
                    <option value="DRAFT">DRAFT (খসড়া)</option>
                    <option value="ARCHIVED">ARCHIVED (আর্কাইভ)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  কম স্টকের সতর্কতা (Low-stock alert, খালি = ৫)
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="5"
                  value={form.lowStockThreshold}
                  onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  প্রোডাক্ট ইমেজ ইউআরএল (Image URL)
                </label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/photo-..."
                  value={form.imageUrl}
                  onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  বিস্তারিত বর্ণনা (Product Description)
                </label>
                <textarea
                  rows={3}
                  placeholder="পণ্যের ফিচার, ওয়ারেন্টি এবং গুণমান সম্পর্কে লিখুন..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                />
              </div>

              {/* ⚡ SaaS Super-Feature: 1-Click Order Bump / Upsell Offer */}
              <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-3.5 space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950">
                  <span>⚡ ১-ক্লিক অর্ডার বাম্প ও আপসেল (1-Click Order Bump Offer)</span>
                  <span className="rounded bg-amber-200 text-amber-800 text-[10px] px-1.5 py-0.2">SaaS Booster</span>
                </div>
                <p className="text-[11px] text-amber-800">
                  চেকআউট পেজে গ্রাহককে এই পণ্যের সাথে আকর্ষণীয় অ্যাড-অন অফার দেখান (যেমন: ওয়ালেটের সাথে লেদার পলিশ বা কম্বো উপহার)।
                </p>

                <div className="space-y-2 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                      অ্যাড-অন অফার শিরোনাম (Bump Offer Title):
                    </label>
                    <input
                      type="text"
                      placeholder="যেমন: মাত্র ১৯০ টাকায় লেদার কি-রিং ও স্পেশাল পলিশ যোগ করুন"
                      value={form.bumpTitle}
                      onChange={(e) => setForm({ ...form, bumpTitle: e.target.value })}
                      className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                        অ্যাড-অন প্রাইস (Bump Price BDT):
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="190"
                        value={form.bumpPrice}
                        onChange={(e) => setForm({ ...form, bumpPrice: e.target.value })}
                        className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-bold text-amber-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                        অ্যাড-অন ইমেজ লিংক (ঐচ্ছিক):
                      </label>
                      <input
                        type="url"
                        placeholder="https://..."
                        value={form.bumpImageUrl}
                        onChange={(e) => setForm({ ...form, bumpImageUrl: e.target.value })}
                        className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg border px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                বাতিল
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? "সংরক্ষণ হচ্ছে..." : "সংরক্ষণ করুন"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {stockFor ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => setStockFor(null)}>
          <div className="card w-full max-w-lg p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">স্টক সমন্বয় — {stockFor.name}</h2>
              <button className="text-slate-500" onClick={() => setStockFor(null)}>✕</button>
            </div>
            <p className="text-sm text-slate-600">
              বর্তমান স্টক: {currentStock == null ? <span className="text-slate-400">ট্র্যাক হয় না</span> : <strong>{currentStock}</strong>}
              {selectedVariant ? ` (ভ্যারিয়েন্ট: ${selectedVariant.name})` : ""}
            </p>
            <form onSubmit={onAdjust} className="space-y-3">
              {variants.length > 0 ? (
                <select className="w-full rounded-lg border px-3 py-2 text-sm" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                  <option value="">পুরো পণ্য (ভ্যারিয়েন্ট নয়)</option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}{v.sku ? ` (${v.sku})` : ""} — স্টক: {v.stockQuantity ?? "ট্র্যাক হয় না"}</option>
                  ))}
                </select>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">পরিবর্তন (+/-)
                  <input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" type="number" placeholder="যেমন +10 বা -2" value={adjDelta} onChange={(e) => { setAdjDelta(e.target.value); if (e.target.value) setAdjSetTo(""); }} />
                </label>
                <label className="text-sm">অথবা সরাসরি স্টক বসান
                  <input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" type="number" min="0" placeholder="নতুন মোট স্টক" value={adjSetTo} onChange={(e) => { setAdjSetTo(e.target.value); if (e.target.value) setAdjDelta(""); }} />
                </label>
              </div>
              <label className="block text-sm">নোট
                <input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" maxLength={300} placeholder="কেন সমন্বয় করছেন (ঐচ্ছিক)" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} />
              </label>
              <label className="block text-sm">কম স্টকের সতর্কতা (খালি = ৫)
                <input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" type="number" min="0" value={adjThreshold} onChange={(e) => setAdjThreshold(e.target.value)} />
              </label>
              {adjMsg ? <p className="text-sm text-slate-600">{adjMsg}</p> : null}
              <button className="btn-primary disabled:opacity-50" disabled={adjBusy}>{adjBusy ? "সেভ হচ্ছে..." : "সমন্বয় করুন"}</button>
            </form>

            <div className="border-t pt-3">
              <h3 className="mb-2 text-sm font-semibold">স্টক ইতিহাস</h3>
              {movements.length === 0 ? (
                <p className="text-sm text-slate-400">এখনো কোনো স্টক পরিবর্তনের রেকর্ড নেই।</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {movements.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-slate-400">{new Date(m.createdAt).toLocaleString("bn-BD")}</span>
                      <span>{MOVEMENT_REASON_LABELS[m.reason] ?? m.reason}{m.variantName ? ` · ${m.variantName}` : ""}</span>
                      <span className={m.delta >= 0 ? "text-emerald-600" : "text-red-600"}>{m.delta >= 0 ? `+${m.delta}` : m.delta}</span>
                      <span className="text-slate-500">→ বাকি {m.balanceAfter}</span>
                      {m.note ? <span className="text-slate-400">({m.note})</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {variantFor ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => setVariantFor(null)}>
          <div className="card w-full max-w-lg p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">ভ্যারিয়েন্ট — {variantFor.name}</h2>
              <button className="text-slate-500" onClick={() => setVariantFor(null)}>✕</button>
            </div>

            <form onSubmit={onCreateVariant} className="space-y-3 border-b pb-4">
              <div className="grid grid-cols-2 gap-3">
                <input className="rounded-lg border px-3 py-2 text-sm" placeholder="ভ্যারিয়েন্টের নাম *" value={vForm.name} onChange={(e) => setVForm({ ...vForm, name: e.target.value })} required />
                <input className="rounded-lg border px-3 py-2 text-sm" placeholder="SKU" value={vForm.sku} onChange={(e) => setVForm({ ...vForm, sku: e.target.value })} />
                <input className="rounded-lg border px-3 py-2 text-sm" placeholder="দাম (BDT, ঐচ্ছিক)" value={vForm.price} onChange={(e) => setVForm({ ...vForm, price: e.target.value })} />
                <input className="rounded-lg border px-3 py-2 text-sm" placeholder="স্টক (ঐচ্ছিক)" type="number" min="0" value={vForm.stock} onChange={(e) => setVForm({ ...vForm, stock: e.target.value })} />
              </div>
              <button className="btn-primary disabled:opacity-50" disabled={vBusy}>{vBusy ? "সেভ হচ্ছে..." : "ভ্যারিয়েন্ট যোগ করুন"}</button>
            </form>

            {mgrVariants.length === 0 ? (
              <p className="text-sm text-slate-400">এখনো কোনো ভ্যারিয়েন্ট নেই।</p>
            ) : (
              <ul className="space-y-3">
                {mgrVariants.map((v) => (
                  <li key={v.id} className="border-b pb-3 last:border-b-0">
                    {editingVariantId === v.id ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="নাম *" value={evForm.name} onChange={(e) => setEvForm({ ...evForm, name: e.target.value })} required />
                          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="SKU" value={evForm.sku} onChange={(e) => setEvForm({ ...evForm, sku: e.target.value })} />
                          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="দাম (BDT, খালি = পণ্যের দাম)" value={evForm.price} onChange={(e) => setEvForm({ ...evForm, price: e.target.value })} />
                          <input className="rounded-lg border px-3 py-2 text-sm" placeholder="স্টক" type="number" min="0" value={evForm.stock} onChange={(e) => setEvForm({ ...evForm, stock: e.target.value })} />
                        </div>
                        <div className="flex gap-3">
                          <button className="btn-primary disabled:opacity-50" disabled={vBusy} onClick={() => onSaveVariant(v)}>সংরক্ষণ</button>
                          <button className="rounded-lg border bg-white px-4 py-2 text-sm" onClick={() => setEditingVariantId(null)}>বাতিল</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="text-sm">
                          <span className="font-medium">{v.name}</span>
                          {v.sku ? <span className="text-slate-400"> · {v.sku}</span> : null}
                          <div className="text-xs text-slate-500">
                            দাম: {v.priceMinor ? formatMinor(BigInt(v.priceMinor)) : "পণ্যের দামই প্রযোজ্য"} · স্টক: {v.stockQuantity == null ? "ট্র্যাক হয় না" : v.stockQuantity}
                          </div>
                        </div>
                        <div className="whitespace-nowrap">
                          <button className="mr-3 text-sky-700 text-sm" disabled={vBusy} onClick={() => startEditVariant(v)}>সম্পাদনা</button>
                          <button className="text-red-600 text-sm" disabled={vBusy} onClick={() => onDeleteVariant(v)}>মুছুন</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {vMsg ? <p className="text-sm text-slate-600">{vMsg}</p> : null}
            <p className="text-xs text-slate-400">ট্র্যাক করা ভ্যারিয়েন্টের স্টক বদলালে পরিবর্তনটি স্টক ইতিহাসে (ledger-এ) রেকর্ড হবে। ভ্যারিয়েন্ট মুছলে আগের স্টক ইতিহাস থেকে যায়।</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
