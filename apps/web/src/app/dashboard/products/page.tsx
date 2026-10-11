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
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
}

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
    description: "",
    imageUrl: "",
    status: "ACTIVE" as "ACTIVE" | "DRAFT" | "ARCHIVED",
  });
  const [saving, setSaving] = useState(false);

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
      description: "",
      imageUrl: "",
      status: "ACTIVE",
    });
    setIsModalOpen(true);
  }

  function openEditModal(p: ProductItem) {
    setEditingProduct(p);
    const unitPrice = (Number(p.priceMinor) / 100).toString();
    const compPrice = p.compareAtMinor ? (Number(p.compareAtMinor) / 100).toString() : "";
    const unitCost = p.currentCostMinor ? (Number(p.currentCostMinor) / 100).toString() : "";
    setForm({
      name: p.name,
      sku: p.sku || "",
      price: unitPrice,
      compareAtPrice: compPrice,
      cost: unitCost,
      category: p.category || "",
      stockQuantity: p.stockQuantity?.toString() || "",
      description: p.description || "",
      imageUrl: p.imageUrl || "",
      status: p.status,
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
            imageUrl: form.imageUrl.trim() || undefined,
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
            description: form.description.trim() || undefined,
            imageUrl: form.imageUrl.trim() || undefined,
            status: form.status,
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
                          <a
                            href={`/checkout/${p.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                            title="১-ক্লিক পাবলিক চেকআউট পেজ দেখুন"
                          >
                            🔗 চেকআউট লিংক
                          </a>
                        ) : null}
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
    </div>
  );
}
