"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { EmptyState, FilterBar, PageHeader, ResponsiveTable } from "@repo/ui";
import { useConfirm, useToast } from "@repo/ui/client";
import { MediaImage } from "@/components/MediaImage";
import dynamic from "next/dynamic";
import { type EcCategory, type EcTag } from "@/components/ec-product-dialogs";

const ProductTranslationsPanel = dynamic(
  () => import("@/components/product-translations").then((m) => m.ProductTranslationsPanel),
  { ssr: false }
);
const EcChannelsDialog = dynamic(() => import("@/components/ec-product-dialogs").then((m) => m.EcChannelsDialog), { ssr: false });
const EcGalleryDialog = dynamic(() => import("@/components/ec-product-dialogs").then((m) => m.EcGalleryDialog), { ssr: false });
const EcBundleDialog = dynamic(() => import("@/components/ec-product-dialogs").then((m) => m.EcBundleDialog), { ssr: false });
const EcCategoryManagerDialog = dynamic(() => import("@/components/ec-product-dialogs").then((m) => m.EcCategoryManagerDialog), { ssr: false });

interface ProductDetailExtra {
  categoryId?: string | null;
  weightGrams?: number | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  barcode?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  taxRateBps?: number | null;
  tags?: EcTag[];
  // EC24: product-model expansion fields (detail = full product row).
  // AB6 (AX13): English content (detail = full product row).
  nameEn?: string | null;
  descriptionEn?: string | null;
  preorderEnabled?: boolean;
  preorderReleaseDate?: string | null;
  preorderLimit?: number | null;
  digital?: boolean;
  digitalFileUrl?: string | null;
  digitalAccessLimit?: number | null;
  // AB5 (AX9): delivery type + signed-link lifetime.
  digitalDeliveryType?: string | null;
  digitalLinkExpiryHours?: number | null;
  subscriptionEnabled?: boolean;
  subscriptionIntervalDays?: number | null;
  subscriptionDiscountPercent?: number | null;
  wholesaleTiers?: { minQty: number; priceMinor: string }[] | null;
  // AB2 (AX3): gift-card product flag + face-value config (minor
  // units as NUMBERS in the Json, per the API validator).
  isGiftCard?: boolean;
  giftCardConfig?: {
    presetAmountsMinor: number[];
    allowCustomAmount: boolean;
    minAmountMinor?: number | null;
    maxAmountMinor?: number | null;
  } | null;
  // GC1: product video (link only — no upload).
  videoUrl?: string | null;
  videoPosterUrl?: string | null;
  // GC6: brand + free shipping.
  brandId?: string | null;
  freeShipping?: boolean;
}

interface BrandItem {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
  description?: string | null;
  productCount: number;
}

interface HistoryItem {
  at: string;
  action: string;
  title: string;
  detail: string | null;
  actorName: string | null;
}

interface BulkDeleteResult {
  results: { id: string; outcome: "deleted" | "archived" | "not_found" }[];
  deleted: number;
  archived: number;
  notFound: number;
}

type BulkAction = "price_percent" | "price_fixed" | "stock_set" | "category_set";
interface BulkPreviewItem { productId: string; name: string; field: string; before: string; after: string }
interface BulkPreview { affected: number; missing: number; items: BulkPreviewItem[] }
interface BulkApplyResult { updated: number; failed: number; results: { productId: string; ok: boolean; error?: string }[] }

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
  taxRateBps?: number | null;
  // GC6: brand + free shipping on the list payload.
  brandId?: string | null;
  freeShipping?: boolean;
  // AB6 (AX13): English content on the list payload.
  nameEn?: string | null;
  descriptionEn?: string | null;
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
  const confirmDialog = useConfirm();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ProductItem[]>([]);
  const [total, setTotal] = useState(0);
  // ED12: search text + category filter are committed to the URL
  // (searchParams: ?q= / ?category=). Initial state is read from the
  // URL, so a bare URL renders exactly as before ("" / "all") and a
  // shared link restores the committed filters. The input keeps its
  // local draft state; the URL is written at the same commit points
  // where the old code called load(search) / setSelectedCategory.
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const searchCommitRef = useRef(searchParams.get("q") ?? "");
  const [selectedCategory, setSelectedCategory] = useState(() => searchParams.get("category") ?? "all");
  const commitUrlFilters = useCallback((q: string, category: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (q) params.set("q", q); else params.delete("q");
    if (category && category !== "all") params.set("category", category); else params.delete("category");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  // GC6: brands + brand filter + bulk delete + export + history.
  const [brands, setBrands] = useState<BrandItem[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState("all");
  const [brandMgrOpen, setBrandMgrOpen] = useState(false);
  const [brandForm, setBrandForm] = useState({ name: "", logoUrl: "", description: "" });
  const [editingBrandId, setEditingBrandId] = useState<string | null>(null);
  const [brandBusy, setBrandBusy] = useState(false);
  const [brandMsg, setBrandMsg] = useState("");
  const [bulkDeleteResult, setBulkDeleteResult] = useState<BulkDeleteResult | null>(null);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [historyFor, setHistoryFor] = useState<ProductItem | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyMsg, setHistoryMsg] = useState("");

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
    categoryId: "",
    weightGrams: "",
    lengthCm: "",
    widthCm: "",
    heightCm: "",
    barcode: "",
    seoTitle: "",
    seoDescription: "",
    taxRatePercent: "",
    tagIds: [] as string[],
    brandId: "",
    freeShipping: false,
    nameEn: "",
    descriptionEn: "",
  });
  const [saving, setSaving] = useState(false);
  // EC24: compact product-model expansion section state.
  const [ec24, setEc24] = useState({
    preorderEnabled: false, preorderReleaseDate: "", preorderLimit: "",
    digital: false, digitalFileUrl: "", digitalAccessLimit: "",
    // AB5 (AX9): delivery type + link expiry (empty = default 72h).
    digitalDeliveryType: "file", digitalLinkExpiryHours: "",
    subscriptionEnabled: false, subscriptionIntervalDays: "", subscriptionDiscountPercent: "",
    tiers: [] as { minQty: string; price: string }[],
    videoUrl: "", videoPosterUrl: "",
  });
  // AB5 (AX9): license-key pool panel (edit view, digital
  // products whose delivery type includes license keys).
  interface LicenseKeyRow { id: string; keyLast4: string; status: string; importBatch?: string | null; assignedAt?: string | null }
  const [lkSummary, setLkSummary] = useState<{ available: number; assigned: number; revoked: number } | null>(null);
  const [lkKeys, setLkKeys] = useState<LicenseKeyRow[]>([]);
  const [lkText, setLkText] = useState("");
  const [lkBatch, setLkBatch] = useState("");
  const [lkReport, setLkReport] = useState("");
  const [lkError, setLkError] = useState("");
  const [lkBusy, setLkBusy] = useState(false);
  // AB2 (AX3): gift-card form state — presets are entered as
  // comma-separated TAKA amounts and converted to minor numbers
  // on save (the form's taka↔minor convention, like bumpPrice).
  const [giftCard, setGiftCard] = useState({
    enabled: false, presetsTaka: "", allowCustomAmount: false, minTaka: "", maxTaka: "",
  });
  // EC3: categories / tags for the form + manager dialog.
  const [ecCategories, setEcCategories] = useState<EcCategory[]>([]);
  const [ecTags, setEcTags] = useState<EcTag[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [tagBusy, setTagBusy] = useState(false);
  const [categoryMgrOpen, setCategoryMgrOpen] = useState(false);
  // EC3/EC4 dialogs.
  const [channelsFor, setChannelsFor] = useState<ProductItem | null>(null);
  const [galleryFor, setGalleryFor] = useState<ProductItem | null>(null);
  const [bundleFor, setBundleFor] = useState<ProductItem | null>(null);
  // EC3: bulk selection + edit.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction>("price_percent");
  const [bulkPercent, setBulkPercent] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkQuantity, setBulkQuantity] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkPreview, setBulkPreview] = useState<BulkPreview | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkApplyResult | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState("");
  // CP5: batch store push summary.
  const [pushBatchResult, setPushBatchResult] = useState<{ results: { productId: string; ok: boolean; error?: string; enqueued?: number; skipped?: number }[]; enqueued: number } | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  // RM4: external product-image mirror run state.
  const [mirrorBusy, setMirrorBusy] = useState(false);
  // RB6b (plan D3): auto-mirror opt-out toggle (null = not loaded yet).
  const [autoMirror, setAutoMirror] = useState<boolean | null>(null);
  const [autoMirrorBusy, setAutoMirrorBusy] = useState(false);
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

  const load = useCallback(async (q = "", brandId: string = selectedBrandId) => {
    const orgId = getOrganizationId();
    if (!orgId) {
      setError("কোনো Organization নির্বাচিত নেই। আবার লগইন করে Onboarding শেষ করুন।");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("pageSize", "100");
      if (q) params.set("search", q);
      if (brandId && brandId !== "all") params.set("brandId", brandId);
      const data = await apiFetch<{ total: number; items: ProductItem[] }>(
        `/organizations/${orgId}/products?${params.toString()}`
      );
      setItems(data.items);
      setTotal(data.total);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "পণ্য লোড করতে ব্যর্থ হয়েছে");
    } finally {
      setLoading(false);
    }
  }, [selectedBrandId]);

  useEffect(() => {
    // ED12: on mount the committed URL search (?q=) is the query —
    // identical to the old load() when the URL is bare ("").
    load(searchCommitRef.current);
  }, [load]);

  const loadBrands = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const rows = await apiFetch<BrandItem[]>(`/organizations/${orgId}/products/brands`);
      setBrands(Array.isArray(rows) ? rows : []);
    } catch { setBrands([]); }
  }, []);

  useEffect(() => { loadBrands(); }, [loadBrands]);

  async function onSaveBrand(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId || !brandForm.name.trim()) return;
    setBrandBusy(true); setBrandMsg("");
    try {
      const body = {
        name: brandForm.name.trim(),
        logoUrl: brandForm.logoUrl.trim() || undefined,
        description: brandForm.description.trim() || undefined,
      };
      if (editingBrandId) {
        await apiFetch(`/organizations/${orgId}/products/brands/${editingBrandId}`, {
          method: "PATCH", body: JSON.stringify(body),
        });
        setBrandMsg("ব্র্যান্ড আপডেট হয়েছে।");
      } else {
        await apiFetch(`/organizations/${orgId}/products/brands`, {
          method: "POST", body: JSON.stringify(body),
        });
        setBrandMsg("ব্র্যান্ড তৈরি হয়েছে।");
      }
      setBrandForm({ name: "", logoUrl: "", description: "" });
      setEditingBrandId(null);
      await loadBrands();
    } catch (e) { setBrandMsg(e instanceof Error ? e.message : "ব্র্যান্ড সংরক্ষণ ব্যর্থ হয়েছে"); }
    finally { setBrandBusy(false); }
  }

  async function onDeleteBrand(b: BrandItem) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!(await confirmDialog({
      title: `ব্র্যান্ড "${b.name}" মুছে ফেলবেন?`,
      body: `এই ব্র্যান্ডের ${b.productCount}টি পণ্য ব্র্যান্ডবিহীন হয়ে যাবে — পণ্যগুলো মোছা হবে না, শুধু ব্র্যান্ডের লিংক সরিয়ে দেওয়া হবে।`,
      confirmLabel: "মুছে ফেলুন",
      danger: true,
    }))) return;
    setBrandBusy(true); setBrandMsg("");
    try {
      const res = await apiFetch<{ ok: true; unlinkedProducts: number }>(
        `/organizations/${orgId}/products/brands/${b.id}`, { method: "DELETE" });
      setBrandMsg(`ব্র্যান্ড মোছা হয়েছে — ${res.unlinkedProducts}টি পণ্য থেকে ব্র্যান্ড সরিয়ে দেওয়া হয়েছে (পণ্যগুলো মোছা হয়নি)।`);
      if (editingBrandId === b.id) { setEditingBrandId(null); setBrandForm({ name: "", logoUrl: "", description: "" }); }
      await loadBrands();
      await load(search);
    } catch (e) { setBrandMsg(e instanceof Error ? e.message : "ব্র্যান্ড মুছতে ব্যর্থ হয়েছে"); }
    finally { setBrandBusy(false); }
  }

  async function onBulkDelete() {
    const orgId = getOrganizationId();
    if (!orgId || selectedIds.size === 0) return;
    if (!(await confirmDialog({
      title: `${selectedIds.size}টি পণ্য মুছতে/আর্কাইভ করতে চান?`,
      body: (
        <>
          <p>• যেসব পণ্যে অর্ডার আছে — সেগুলো আর্কাইভ হবে (স্থায়ীভাবে মোছা হবে না)।</p>
          <p>• যেসব পণ্যে কখনো অর্ডার হয়নি — সেগুলো স্থায়ীভাবে মুছে যাবে।</p>
          <p>এই কাজটি ফেরত নেওয়া যাবে না।</p>
        </>
      ),
      confirmLabel: "মুছুন/আর্কাইভ করুন",
      danger: true,
    }))) return;
    setBulkDeleteBusy(true); setBulkDeleteResult(null); setError(""); setNotice("");
    try {
      const res = await apiFetch<BulkDeleteResult>(`/organizations/${orgId}/products/bulk-delete`, {
        method: "POST", body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      setBulkDeleteResult(res);
      setSelectedIds(new Set());
      await load(search);
      await loadBrands();
    } catch (e) { setError(e instanceof Error ? e.message : "বাল্ক মুছতে ব্যর্থ হয়েছে"); }
    finally { setBulkDeleteBusy(false); }
  }

  async function onExportCsv() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setExportBusy(true); setError("");
    try {
      // CSV download mirrors the inventory page: raw fetch + blob (apiFetch parses JSON).
      const res = await fetch(`${API_URL}/organizations/${orgId}/products/export`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? `এক্সপোর্ট ব্যর্থ (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "products-export.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast({ title: "✅ পণ্যের CSV এক্সপোর্ট ডাউনলোড হয়েছে।", tone: "success" });
    } catch (e) { setError(e instanceof Error ? e.message : "এক্সপোর্ট ব্যর্থ হয়েছে"); }
    finally { setExportBusy(false); }
  }

  async function openHistory(p: ProductItem) {
    setHistoryFor(p); setHistoryItems([]); setHistoryTruncated(false); setHistoryMsg("");
    setHistoryBusy(true);
    const orgId = getOrganizationId();
    if (!orgId) { setHistoryBusy(false); return; }
    try {
      const data = await apiFetch<{ items: HistoryItem[]; truncated: boolean }>(
        `/organizations/${orgId}/products/${p.id}/history`);
      setHistoryItems(data.items ?? []);
      setHistoryTruncated(!!data.truncated);
    } catch (e) { setHistoryMsg(e instanceof Error ? e.message : "ইতিহাস লোড ব্যর্থ হয়েছে"); }
    finally { setHistoryBusy(false); }
  }

  const loadEcMeta = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const [cats, tags] = await Promise.all([
      apiFetch<EcCategory[]>(`/organizations/${orgId}/products/categories`).catch(() => [] as EcCategory[]),
      apiFetch<EcTag[]>(`/organizations/${orgId}/products/tags`).catch(() => [] as EcTag[]),
    ]);
    setEcCategories(cats);
    setEcTags(tags);
  }, []);

  useEffect(() => { loadEcMeta(); }, [loadEcMeta]);

  // RB6b: read the auto-mirror opt-out (default ON server-side).
  const loadMirrorSetting = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const s = await apiFetch<{ productImageAutoMirror: boolean }>(`/organizations/${orgId}/products/images/mirror-setting`);
      setAutoMirror(s.productImageAutoMirror);
    } catch { /* the toggle simply stays hidden if the read fails */ }
  }, []);

  useEffect(() => { loadMirrorSetting(); }, [loadMirrorSetting]);

  async function onDuplicate(p: ProductItem) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!(await confirmDialog({
      title: `"${p.name}" এর একটি কপি তৈরি করবেন?`,
      confirmLabel: "কপি তৈরি করুন",
    }))) return;
    setError(""); setNotice("");
    try {
      const copy = await apiFetch<ProductItem>(`/organizations/${orgId}/products/${p.id}/duplicate`, { method: "POST" });
      toast({ title: `📄 "${p.name}" এর কপি তৈরি হয়েছে: "${copy.name}"`, tone: "success" });
      await load(search);
    } catch (e) {
      setError(e instanceof Error ? e.message : "কপি তৈরি ব্যর্থ হয়েছে");
    }
  }

  async function onQuickAddTag() {
    const orgId = getOrganizationId();
    if (!orgId || !newTagName.trim()) return;
    setTagBusy(true);
    try {
      const tag = await apiFetch<EcTag>(`/organizations/${orgId}/products/tags`, {
        method: "POST", body: JSON.stringify({ name: newTagName.trim() }),
      });
      setNewTagName("");
      await loadEcMeta();
      setForm((f) => ({ ...f, tagIds: f.tagIds.includes(tag.id) ? f.tagIds : [...f.tagIds, tag.id] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "ট্যাগ তৈরি ব্যর্থ হয়েছে");
    } finally { setTagBusy(false); }
  }

  function bulkBody() {
    return {
      productIds: Array.from(selectedIds),
      action: bulkAction,
      percent: bulkAction === "price_percent" && bulkPercent.trim() ? Number(bulkPercent) : undefined,
      price: bulkAction === "price_fixed" && bulkPrice.trim() ? bulkPrice.trim() : undefined,
      quantity: bulkAction === "stock_set" && bulkQuantity.trim() ? Number(bulkQuantity) : undefined,
      categoryId: bulkAction === "category_set" ? (bulkCategoryId || undefined) : undefined,
    };
  }

  async function onBulkPreview() {
    const orgId = getOrganizationId();
    if (!orgId || selectedIds.size === 0) return;
    setBulkBusy(true); setBulkMsg(""); setBulkResult(null);
    try {
      const preview = await apiFetch<BulkPreview>(`/organizations/${orgId}/products/bulk-edit/preview`, {
        method: "POST", body: JSON.stringify(bulkBody()),
      });
      setBulkPreview(preview);
    } catch (e) { setBulkMsg(e instanceof Error ? e.message : "প্রিভিউ ব্যর্থ হয়েছে"); }
    finally { setBulkBusy(false); }
  }

  async function onBulkApply() {
    const orgId = getOrganizationId();
    if (!orgId || !bulkPreview) return; // প্রিভিউ ছাড়া প্রয়োগ নয়
    setBulkBusy(true); setBulkMsg("");
    try {
      const result = await apiFetch<BulkApplyResult>(`/organizations/${orgId}/products/bulk-edit/apply`, {
        method: "POST", body: JSON.stringify(bulkBody()),
      });
      setBulkResult(result);
      setBulkPreview(null);
      setSelectedIds(new Set());
      await load(search);
    } catch (e) { setBulkMsg(e instanceof Error ? e.message : "প্রয়োগ ব্যর্থ হয়েছে"); }
    finally { setBulkBusy(false); }
  }

  async function onPushBatch() {
    const orgId = getOrganizationId();
    if (!orgId || selectedIds.size === 0) return;
    setPushBusy(true); setPushMsg(""); setPushBatchResult(null);
    try {
      const result = await apiFetch<{ results: { productId: string; ok: boolean; error?: string; enqueued?: number; skipped?: number }[]; enqueued: number }>(
        `/organizations/${orgId}/products/push-batch`,
        { method: "POST", body: JSON.stringify({ productIds: Array.from(selectedIds) }) },
      );
      setPushBatchResult(result);
    } catch (e) { setPushMsg(e instanceof Error ? e.message : "স্টোরে পাঠানো ব্যর্থ হয়েছে"); }
    finally { setPushBusy(false); }
  }

  // RM4: copy external product-image URLs into the org's own
  // storage. The summary (incl. failed hosts) goes through the
  // page's existing notice/error banners.
  async function onMirrorExternalImages() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setMirrorBusy(true); setError(""); setNotice("বাইরের ছবি নিজের স্টোরেজে কপি করা হচ্ছে…");
    try {
      const r = await apiFetch<{ scanned: number; mirrored: number; deduped: number; failed: { productId: string; host: string; reason: string }[]; reviews?: { scanned: number; mirrored: number; failed: number } }>(
        `/organizations/${orgId}/products/images/mirror-external`,
        { method: "POST" },
      );
      const hosts = Array.from(new Set(r.failed.map((f) => f.host).filter(Boolean)));
      setNotice(
        `ছবি মিরর শেষ: ${r.scanned}টি যাচাই, ${r.mirrored}টি নতুন কপি, ${r.deduped}টি আগের কপিই পুনঃব্যবহৃত` +
        (r.failed.length ? `, ${r.failed.length}টি ব্যর্থ${hosts.length ? ` (host: ${hosts.join(", ")})` : ""} — কারণ: ${r.failed[0].reason}` : "") +
        (r.reviews && r.reviews.scanned ? ` রিভিউ ছবি: ${r.reviews.scanned}টি যাচাই, ${r.reviews.mirrored}টি কপি, ${r.reviews.failed}টি ব্যর্থ।` : "।"),
      );
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ছবি মিরর ব্যর্থ হয়েছে"); }
    finally { setMirrorBusy(false); }
  }

  // RB6b (plan D3): flip the auto-mirror opt-out. The scheduled
  // sweep honours this; the manual button above does not.
  async function onToggleAutoMirror(next: boolean) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setAutoMirrorBusy(true); setError("");
    try {
      const s = await apiFetch<{ productImageAutoMirror: boolean }>(
        `/organizations/${orgId}/products/images/mirror-setting`,
        { method: "PATCH", body: JSON.stringify({ productImageAutoMirror: next }) },
      );
      setAutoMirror(s.productImageAutoMirror);
      toast({
        title: s.productImageAutoMirror
          ? "অটো-মিরর চালু করা হয়েছে — শিডিউল করা Job চললে বাইরের পণ্য ও রিভিউ ছবি নিজে থেকেই নিজের স্টোরেজে কপি হবে।"
          : "অটো-মিরর বন্ধ করা হয়েছে — শিডিউল করা Job আর ছবি কপি করবে না (হাতে চালানো মিরর বোতাম আগের মতোই কাজ করবে)।",
        tone: "success",
      });
    } catch (e) { setError(e instanceof Error ? e.message : "অটো-মিরর সেটিং বদলানো যায়নি"); }
    finally { setAutoMirrorBusy(false); }
  }

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
    if (!(await confirmDialog({
      title: `ভ্যারিয়েন্ট "${v.name}" মুছে ফেলবেন?`,
      confirmLabel: "মুছে ফেলুন",
      danger: true,
    }))) return;
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
      categoryId: "",
      weightGrams: "",
      lengthCm: "",
      widthCm: "",
      heightCm: "",
      barcode: "",
      seoTitle: "",
      seoDescription: "",
      taxRatePercent: "",
      tagIds: [],
      brandId: "",
      freeShipping: false,
      nameEn: "",
      descriptionEn: "",
    });
    setEc24({
      preorderEnabled: false, preorderReleaseDate: "", preorderLimit: "",
      digital: false, digitalFileUrl: "", digitalAccessLimit: "",
      digitalDeliveryType: "file", digitalLinkExpiryHours: "",
      subscriptionEnabled: false, subscriptionIntervalDays: "", subscriptionDiscountPercent: "",
      tiers: [],
      videoUrl: "", videoPosterUrl: "",
    });
    setGiftCard({ enabled: false, presetsTaka: "", allowCustomAmount: false, minTaka: "", maxTaka: "" });
    setIsModalOpen(true);
  }

  async function openEditModal(p: ProductItem) {
    setEditingProduct(p);
    const unitPrice = (Number(p.priceMinor) / 100).toString();
    const compPrice = p.compareAtMinor ? (Number(p.compareAtMinor) / 100).toString() : "";
    const unitCost = p.currentCostMinor ? (Number(p.currentCostMinor) / 100).toString() : "";
    const bPrice = p.bumpPriceMinor ? (Number(p.bumpPriceMinor) / 100).toString() : "";
    // EC3: detail carries the extended fields (weight/dimensions/SEO/tags).
    let extra: ProductDetailExtra = {};
    const orgId = getOrganizationId();
    if (orgId) {
      try {
        extra = await apiFetch<ProductDetailExtra>(`/organizations/${orgId}/products/${p.id}`);
      } catch { /* fall back to the list row */ }
    }
    // If the detail's categoryId has no matching loaded category, fall back
    // to the legacy free-text category already on the row.
    const categoryId = extra.categoryId && ecCategories.some((c) => c.id === extra.categoryId) ? extra.categoryId : "";
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
      categoryId,
      weightGrams: extra.weightGrams != null ? String(extra.weightGrams) : "",
      lengthCm: extra.lengthCm != null ? String(extra.lengthCm) : "",
      widthCm: extra.widthCm != null ? String(extra.widthCm) : "",
      heightCm: extra.heightCm != null ? String(extra.heightCm) : "",
      barcode: extra.barcode || "",
      seoTitle: extra.seoTitle || "",
      seoDescription: extra.seoDescription || "",
      // EC23: bps → percent for the form (750 → "7.5"); the detail
      // wins, the list row is the fallback.
      taxRatePercent: (() => {
        const bps = extra.taxRateBps ?? p.taxRateBps ?? null;
        return bps == null ? "" : String(bps / 100);
      })(),
      tagIds: (extra.tags ?? []).map((t) => t.id),
      brandId: extra.brandId ?? p.brandId ?? "",
      freeShipping: !!(extra.freeShipping ?? p.freeShipping ?? false),
      nameEn: extra.nameEn ?? p.nameEn ?? "",
      descriptionEn: extra.descriptionEn ?? p.descriptionEn ?? "",
    });
    setEc24({
      preorderEnabled: !!extra.preorderEnabled,
      preorderReleaseDate: extra.preorderReleaseDate ? String(extra.preorderReleaseDate).slice(0, 10) : "",
      preorderLimit: extra.preorderLimit != null ? String(extra.preorderLimit) : "",
      digital: !!extra.digital,
      digitalFileUrl: extra.digitalFileUrl ?? "",
      digitalAccessLimit: extra.digitalAccessLimit != null ? String(extra.digitalAccessLimit) : "",
      digitalDeliveryType: extra.digitalDeliveryType ?? "file",
      digitalLinkExpiryHours: extra.digitalLinkExpiryHours != null ? String(extra.digitalLinkExpiryHours) : "",
      subscriptionEnabled: !!extra.subscriptionEnabled,
      subscriptionIntervalDays: extra.subscriptionIntervalDays != null ? String(extra.subscriptionIntervalDays) : "",
      subscriptionDiscountPercent: extra.subscriptionDiscountPercent != null ? String(extra.subscriptionDiscountPercent) : "",
      tiers: (extra.wholesaleTiers ?? []).map((t) => ({
        minQty: String(t.minQty),
        price: (() => { try { return minorToDecimal(String(t.priceMinor)); } catch { return ""; } })(),
      })),
      videoUrl: extra.videoUrl ?? "",
      videoPosterUrl: extra.videoPosterUrl ?? "",
    });
    setGiftCard({
      enabled: !!extra.isGiftCard,
      presetsTaka: (extra.giftCardConfig?.presetAmountsMinor ?? []).map((m) => String(m / 100)).join(", "),
      allowCustomAmount: !!extra.giftCardConfig?.allowCustomAmount,
      minTaka: extra.giftCardConfig?.minAmountMinor != null ? String(extra.giftCardConfig.minAmountMinor / 100) : "",
      maxTaka: extra.giftCardConfig?.maxAmountMinor != null ? String(extra.giftCardConfig.maxAmountMinor / 100) : "",
    });
    // AB5 (AX9): license pool for digital products (masked list).
    setLkSummary(null); setLkKeys([]); setLkText(""); setLkBatch(""); setLkReport(""); setLkError("");
    if (extra.digital) void loadLicensePool(p.id);
    setIsModalOpen(true);
  }

  // AB5 (AX9): license pool — counts + masked list for the
  // product being edited. Keys are NEVER shown in full here;
  // staff see only the last 4 characters (the API masks them).
  const loadLicensePool = useCallback(async (productId: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const [summary, list] = await Promise.all([
        apiFetch<{ available: number; assigned: number; revoked: number }>(
          `/organizations/${orgId}/commerce/license-keys/pool-summary?productId=${encodeURIComponent(productId)}`),
        apiFetch<{ keys: LicenseKeyRow[] }>(
          `/organizations/${orgId}/commerce/license-keys?productId=${encodeURIComponent(productId)}`),
      ]);
      setLkSummary(summary);
      setLkKeys(list.keys ?? []);
    } catch { setLkSummary(null); setLkKeys([]); }
  }, []);

  async function importLicenseKeys() {
    const orgId = getOrganizationId(); if (!orgId || !editingProduct) return;
    if (!lkText.trim()) { setLkError("ইমপোর্ট করতে কী লিখুন — এক লাইনে একটি কী।"); return; }
    setLkBusy(true); setLkError(""); setLkReport("");
    try {
      const out = await apiFetch<{ imported: number; duplicateCount: number; invalidCount: number; batch: string }>(
        `/organizations/${orgId}/commerce/license-keys/import`, {
          method: "POST",
          body: JSON.stringify({ productId: editingProduct.id, text: lkText, batch: lkBatch.trim() || undefined }),
        });
      setLkReport(`ইমপোর্ট সম্পন্ন (ব্যাচ: ${out.batch}) — নতুন যোগ হয়েছে ${out.imported}টি · ডুপ্লিকেট ${out.duplicateCount}টি · অবৈধ লাইন ${out.invalidCount}টি।`);
      setLkText(""); setLkBatch("");
      await loadLicensePool(editingProduct.id);
    } catch (e) { setLkError(e instanceof Error ? e.message : "ইমপোর্ট ব্যর্থ হয়েছে"); }
    finally { setLkBusy(false); }
  }

  async function revokeLicenseKey(key: LicenseKeyRow) {
    const orgId = getOrganizationId(); if (!orgId || !editingProduct) return;
    if (!(await confirmDialog({
      title: "এই লাইসেন্স কীটি বাতিল (revoke) করবেন?",
      body: `শেষ ৪ অক্ষর “…${key.keyLast4}” — বাতিল কী আর কোনো ক্রেতাকে দেওয়া হবে না।`,
      confirmLabel: "বাতিল করুন",
      danger: true,
    }))) return;
    setLkBusy(true); setLkError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/license-keys/${key.id}/revoke`, { method: "POST" });
      await loadLicensePool(editingProduct.id);
    } catch (e) { setLkError(e instanceof Error ? e.message : "বাতিল ব্যর্থ হয়েছে"); }
    finally { setLkBusy(false); }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSaving(true);
    setError("");
    setNotice("");

    // EC3 extended fields shared by create + update. When the category
    // select is used it wins (and also writes the legacy text for the
    // existing list filter); with no categories loaded the text input rules.
    // EC23: VAT percent (decimals allowed) → basis points.
    // Empty = null (fall back to the shop default at checkout).
    let taxRateBps: number | null = null;
    if (form.taxRatePercent.trim()) {
      const pct = Number(form.taxRatePercent);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        setError("VAT হার 0–100% এর মধ্যে হতে হবে");
        setSaving(false);
        return;
      }
      taxRateBps = Math.round(pct * 100);
    }

    // EC24: expansion fields — taka inputs become minor-unit
    // strings for tiers; empty optional numbers become null
    // (explicit clear), so toggles off really turn features off.
    const ec24Fields = {
      preorderEnabled: ec24.preorderEnabled,
      preorderReleaseDate: ec24.preorderReleaseDate ? new Date(`${ec24.preorderReleaseDate}T00:00:00`).toISOString() : null,
      preorderLimit: ec24.preorderLimit.trim() ? Number(ec24.preorderLimit) : null,
      digital: ec24.digital,
      digitalFileUrl: ec24.digitalFileUrl.trim() || null,
      digitalAccessLimit: ec24.digitalAccessLimit.trim() ? Number(ec24.digitalAccessLimit) : null,
      // AB5 (AX9): delivery type + link expiry (empty = null = default 72h).
      digitalDeliveryType: ec24.digitalDeliveryType,
      digitalLinkExpiryHours: ec24.digitalLinkExpiryHours.trim() ? Number(ec24.digitalLinkExpiryHours) : null,
      subscriptionEnabled: ec24.subscriptionEnabled,
      subscriptionIntervalDays: ec24.subscriptionIntervalDays.trim() ? Number(ec24.subscriptionIntervalDays) : null,
      subscriptionDiscountPercent: ec24.subscriptionDiscountPercent.trim() ? Number(ec24.subscriptionDiscountPercent) : null,
      wholesaleTiers: ec24.tiers
        .filter((t) => t.minQty.trim() && t.price.trim())
        .map((t) => ({ minQty: Number(t.minQty), priceMinor: String(Math.round(Number(t.price) * 100)) })),
      // GC1: product video links (empty = null, i.e. explicitly cleared).
      videoUrl: ec24.videoUrl.trim() || null,
      videoPosterUrl: ec24.videoPosterUrl.trim() || null,
    };

    // GC6: brand (empty select = null, i.e. explicitly cleared) + free shipping.
    const gc6Fields = {
      brandId: form.brandId || null,
      freeShipping: form.freeShipping,
    };

    // AB2 (AX3): gift-card fields — preset taka amounts become
    // minor-unit NUMBERS; empty min/max become null. Toggling
    // off clears the config (the API treats an explicit null as
    // a clear). Deeper rules (at least one amount source, min ≤
    // max, presets inside the range) are the API validator's —
    // its Bengali message surfaces via the save error below.
    const presetMinors = giftCard.presetsTaka
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Math.round(Number(s) * 100));
    if (giftCard.enabled && presetMinors.some((n) => !Number.isFinite(n) || n <= 0)) {
      setError("গিফট কার্ডের preset পরিমাণগুলো সঠিক টাকার সংখ্যায় লিখুন (কমা দিয়ে আলাদা করে)।");
      setSaving(false);
      return;
    }
    const giftCardFields = {
      isGiftCard: giftCard.enabled,
      giftCardConfig: giftCard.enabled
        ? {
            presetAmountsMinor: presetMinors,
            allowCustomAmount: giftCard.allowCustomAmount,
            minAmountMinor: giftCard.minTaka.trim() ? Math.round(Number(giftCard.minTaka) * 100) : null,
            maxAmountMinor: giftCard.maxTaka.trim() ? Math.round(Number(giftCard.maxTaka) * 100) : null,
          }
        : null,
    };

    const selectedEcCategory = ecCategories.find((c) => c.id === form.categoryId);
    const ecFields = {
      taxRateBps,
      categoryId: form.categoryId || undefined,
      category: selectedEcCategory ? selectedEcCategory.name : (form.category.trim() || undefined),
      weightGrams: form.weightGrams.trim() ? Number(form.weightGrams) : undefined,
      lengthCm: form.lengthCm.trim() ? Number(form.lengthCm) : undefined,
      widthCm: form.widthCm.trim() ? Number(form.widthCm) : undefined,
      heightCm: form.heightCm.trim() ? Number(form.heightCm) : undefined,
      barcode: form.barcode.trim() || undefined,
      seoTitle: form.seoTitle.trim() || undefined,
      seoDescription: form.seoDescription.trim() || undefined,
      tagIds: form.tagIds,
      // AB6 (AX13): English content — sent trimmed (empty string
      // clears back to falling back to the main name/description).
      nameEn: form.nameEn.trim(),
      descriptionEn: form.descriptionEn.trim(),
    };

    try {
      if (editingProduct) {
        // Update product
        await apiFetch(`/organizations/${orgId}/products/${editingProduct.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            status: form.status,
            price: form.price,
            stockQuantity: form.stockQuantity ? Number(form.stockQuantity) : undefined,
            lowStockThreshold: form.lowStockThreshold ? Number(form.lowStockThreshold) : undefined,
            imageUrl: form.imageUrl.trim() || undefined,
            bumpTitle: form.bumpTitle.trim() || undefined,
            bumpPrice: form.bumpPrice.trim() || undefined,
            bumpImageUrl: form.bumpImageUrl.trim() || undefined,
            ...ecFields,
            ...ec24Fields,
            ...gc6Fields,
            ...giftCardFields,
          }),
        });

        if (form.cost) {
          await apiFetch(`/organizations/${orgId}/products/${editingProduct.id}/costs`, {
            method: "POST",
            body: JSON.stringify({ cost: form.cost }),
          });
        }
        toast({ title: `✅ "${form.name}" সফলভাবে আপডেট হয়েছে!`, tone: "success" });
      } else {
        // Create product
        const created = await apiFetch<ProductItem>(`/organizations/${orgId}/products`, {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            sku: form.sku.trim() || undefined,
            price: form.price,
            compareAtPrice: form.compareAtPrice.trim() || undefined,
            stockQuantity: form.stockQuantity ? Number(form.stockQuantity) : undefined,
            lowStockThreshold: form.lowStockThreshold ? Number(form.lowStockThreshold) : undefined,
            description: form.description.trim() || undefined,
            imageUrl: form.imageUrl.trim() || undefined,
            status: form.status,
            bumpTitle: form.bumpTitle.trim() || undefined,
            bumpPrice: form.bumpPrice.trim() || undefined,
            bumpImageUrl: form.bumpImageUrl.trim() || undefined,
            ...ecFields,
            ...ec24Fields,
            ...gc6Fields,
            ...giftCardFields,
          }),
        });

        if (form.cost) {
          await apiFetch(`/organizations/${orgId}/products/${created.id}/costs`, {
            method: "POST",
            body: JSON.stringify({ cost: form.cost }),
          });
        }
        toast({ title: `🎉 নতুন পণ্য "${form.name}" সফলভাবে তৈরি হয়েছে!`, tone: "success" });
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
    if (!(await confirmDialog({
      title: `আপনি কি নিশ্চিত যে "${name}" আর্কাইভ করতে চান?`,
      confirmLabel: "আর্কাইভ করুন",
      danger: true,
    }))) return;
    try {
      await apiFetch(`/organizations/${orgId}/products/${id}`, { method: "DELETE" });
      toast({ title: `"${name}" আর্কাইভ করা হয়েছে।`, tone: "success" });
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

  // ED13: row actions are shared verbatim by the desktop table cell
  // and the ResponsiveTable mobile card — same handlers, same order.
  const renderProductActions = (p: ProductItem) => (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {p.slug ? (
        <>
          <button
            type="button"
            onClick={() => {
              const fullUrl = `${window.location.origin}/checkout/${p.slug}`;
              navigator.clipboard.writeText(fullUrl);
              toast({ title: `📋 "${p.name}" এর চেকআউট লিংক কপি করা হয়েছে: ${fullUrl}`, tone: "success" });
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
        onClick={() => setChannelsFor(p)}
        className="rounded border px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-50"
      >
        🔀 চ্যানেল
      </button>
      <button
        onClick={() => setGalleryFor(p)}
        className="rounded border px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-50"
      >
        🖼️ গ্যালারি
      </button>
      <button
        onClick={() => setBundleFor(p)}
        className="rounded border px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-50"
      >
        🎁 বান্ডল
      </button>
      <button
        onClick={() => onDuplicate(p)}
        className="rounded border px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
      >
        📄 কপি
      </button>
      <button
        onClick={() => openHistory(p)}
        className="rounded border px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
      >
        📜 ইতিহাস
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
  );

  return (
    <div className="space-y-6 p-6">
      {/* Page Header (ED13: kit PageHeader — same title/subtitle and
          the same action buttons as the old hand-rolled header; the
          Live Catalog badge rides along as the first action item). */}
      <PageHeader
        title="🛍️ Products & E-Commerce Inventory"
        subtitle="আপনার পণ্যের তালিকা, স্টক, ভ্যারিয়্যান্ট এবং ১-ক্লিক ইনস্ট্যান্ট চেকআউট ও সোশ্যাল ইনবক্স লিংক।"
        actions={
          <>
            <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
              Live Catalog
            </span>
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
                toast({ title: "✨ ৩টি জনপ্রিয় ডেমো পণ্য সফলভাবে তৈরি হয়েছে! এখন সরাসরি ১-ক্লিক চেকআউট টেস্ট করতে পারবেন।", tone: "success" });
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
            onClick={() => setCategoryMgrOpen(true)}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            🗂️ ক্যাটাগরি
          </button>
          <button
            onClick={onMirrorExternalImages}
            disabled={mirrorBusy}
            title="বাইরের হোস্টে থাকা পণ্যের ছবি নিজের স্টোরেজে (R2) কপি করুন"
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-50"
          >
            {mirrorBusy ? "🪞 মিরর চলছে…" : "🪞 ছবি নিজের স্টোরেজে নিন"}
          </button>
          {autoMirror !== null ? (
            <label
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm"
              title="চালু থাকলে শিডিউল করা Job বাইরের পণ্য ও রিভিউ ছবি নিজে থেকেই নিজের স্টোরেজে কপি করে"
            >
              <input
                type="checkbox"
                checked={autoMirror}
                disabled={autoMirrorBusy}
                onChange={(e) => onToggleAutoMirror(e.target.checked)}
                className="h-3.5 w-3.5 accent-indigo-600"
              />
              অটো-মিরর
            </label>
          ) : null}
          <button
            onClick={() => { setBrandMgrOpen(true); setBrandMsg(""); setEditingBrandId(null); setBrandForm({ name: "", logoUrl: "", description: "" }); }}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            🏷️ ব্র্যান্ড
          </button>
          <button
            onClick={onExportCsv}
            disabled={exportBusy}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm disabled:opacity-50"
          >
            {exportBusy ? "তৈরি হচ্ছে…" : "⬇️ CSV Export"}
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 shadow-sm transition-all"
          >
            <span>➕ নতুন প্রোডাক্ট যোগ করুন</span>
          </button>
          </>
        }
      />

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

      {/* Filter and Search Bar (ED13: kit FilterBar; ED12: the search
          commit points — Enter / খুঁজুন button — also write ?q= to the
          URL, and a category change writes ?category=, exactly where
          the old code committed the state). */}
      <FilterBar className="justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="w-72 rounded-lg border px-3 py-1.5 text-xs"
            placeholder="পণ্যের নাম বা SKU দিয়ে খুঁজুন..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                searchCommitRef.current = search;
                commitUrlFilters(search, selectedCategory);
                load(search);
              }
            }}
          />
          <button
            className="rounded-lg border bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            onClick={() => {
              searchCommitRef.current = search;
              commitUrlFilters(search, selectedCategory);
              load(search);
            }}
          >
            🔍 খুঁজুন
          </button>

          <select
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              commitUrlFilters(searchCommitRef.current, e.target.value);
            }}
            className="rounded-lg border px-3 py-1.5 text-xs text-slate-700 font-medium"
          >
            <option value="all">সব ক্যাটাগরি ({items.length})</option>
            {categories.map((c) => (
              <option key={c} value={c!}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={selectedBrandId}
            onChange={(e) => { setSelectedBrandId(e.target.value); load(search, e.target.value); }}
            className="rounded-lg border px-3 py-1.5 text-xs text-slate-700 font-medium"
            aria-label="ব্র্যান্ড দিয়ে ফিল্টার"
          >
            <option value="all">সব ব্র্যান্ড</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.productCount})
              </option>
            ))}
          </select>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          মোট প্রদর্শিত পণ্য: <b>{filteredItems.length}</b> টি
        </div>
      </FilterBar>

      {/* EC3: bulk edit bar — প্রিভিউ ছাড়া প্রয়োগ করা যায় না */}
      {selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 shadow-sm">
          <span className="text-xs font-bold text-indigo-900">{selectedIds.size}টি পণ্য নির্বাচিত</span>
          <select className="rounded-lg border px-2 py-1.5 text-xs" value={bulkAction} onChange={(e) => { setBulkAction(e.target.value as BulkAction); setBulkPreview(null); }}>
            <option value="price_percent">দাম — শতাংশ বদল</option>
            <option value="price_fixed">দাম — নির্দিষ্ট দাম</option>
            <option value="stock_set">স্টক বসান</option>
            <option value="category_set">ক্যাটাগরি বসান</option>
          </select>
          {bulkAction === "price_percent" ? (
            <input className="w-28 rounded-lg border px-2 py-1.5 text-xs" type="number" step="0.01" placeholder="শতাংশ (±)" value={bulkPercent} onChange={(e) => { setBulkPercent(e.target.value); setBulkPreview(null); }} />
          ) : null}
          {bulkAction === "price_fixed" ? (
            <input className="w-28 rounded-lg border px-2 py-1.5 text-xs" placeholder="দাম (BDT)" value={bulkPrice} onChange={(e) => { setBulkPrice(e.target.value); setBulkPreview(null); }} />
          ) : null}
          {bulkAction === "stock_set" ? (
            <input className="w-28 rounded-lg border px-2 py-1.5 text-xs" type="number" min="0" placeholder="নতুন স্টক" value={bulkQuantity} onChange={(e) => { setBulkQuantity(e.target.value); setBulkPreview(null); }} />
          ) : null}
          {bulkAction === "category_set" ? (
            <select className="rounded-lg border px-2 py-1.5 text-xs" value={bulkCategoryId} onChange={(e) => { setBulkCategoryId(e.target.value); setBulkPreview(null); }}>
              <option value="">ক্যাটাগরি নেই</option>
              {ecCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : null}
          <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={bulkBusy} onClick={onBulkPreview}>
            {bulkBusy ? "হচ্ছে…" : "প্রিভিউ দেখুন"}
          </button>
          <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={pushBusy} onClick={onPushBatch}>
            {pushBusy ? "পাঠানো হচ্ছে…" : "স্টোরে পাঠান"}
          </button>
          <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={bulkDeleteBusy} onClick={onBulkDelete}>
            {bulkDeleteBusy ? "মোছা হচ্ছে…" : "🗑️ নির্বাচিত মুছুন/আর্কাইভ"}
          </button>
          {pushMsg ? <span className="text-xs text-rose-700">{pushMsg}</span> : null}
          <button className="rounded-lg border px-3 py-1.5 text-xs text-slate-600" onClick={() => { setSelectedIds(new Set()); setBulkPreview(null); setBulkResult(null); }}>
            নির্বাচন সরান
          </button>
          {bulkMsg ? <span className="text-xs text-rose-700">{bulkMsg}</span> : null}
        </div>
      ) : null}
      {pushBatchResult ? (
        <div className="rounded-xl border bg-white p-3 text-xs shadow-sm">
          <span className="font-bold">স্টোরে পাঠানোর ফলাফল:</span> মোট Enqueue হয়েছে {pushBatchResult.enqueued}টি
          <ul className="mt-1 list-disc pl-5">
            {pushBatchResult.results.map((r) => (
              <li key={r.productId} className={r.ok ? "text-emerald-700" : "text-rose-700"}>
                {items.find((i) => i.id === r.productId)?.name ?? r.productId}: {r.ok ? `পাঠানো হয়েছে (enqueued ${r.enqueued ?? 0}${r.skipped ? `, skipped ${r.skipped}` : ""})` : (r.error === "not_found" ? "পণ্যটি পাওয়া যায়নি" : r.error === "no_listings" ? "কোনো স্টোর Listing নেই" : (r.error ?? "অজানা এরর"))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {bulkDeleteResult ? (
        <div className="rounded-xl border bg-white p-3 text-xs shadow-sm">
          <span className="font-bold">বাল্ক মুছার ফলাফল:</span>{" "}
          স্থায়ীভাবে মোছা হয়েছে {bulkDeleteResult.deleted}টি · আর্কাইভ হয়েছে {bulkDeleteResult.archived}টি (অর্ডার থাকায়) · পাওয়া যায়নি {bulkDeleteResult.notFound}টি
          <button className="ml-3 text-slate-500 underline" onClick={() => setBulkDeleteResult(null)}>বন্ধ করুন</button>
        </div>
      ) : null}
      {bulkResult ? (
        <div className="rounded-xl border bg-white p-3 text-xs shadow-sm">
          <span className="font-bold">বাল্ক এডিট ফলাফল:</span> আপডেট হয়েছে {bulkResult.updated}টি · ব্যর্থ {bulkResult.failed}টি
          {bulkResult.results.filter((r) => !r.ok).length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-rose-700">
              {bulkResult.results.filter((r) => !r.ok).map((r) => (
                <li key={r.productId}>{items.find((i) => i.id === r.productId)?.name ?? r.productId}: {r.error ?? "অজানা এরর"}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

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
        <ResponsiveTable
          table={
            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 font-semibold border-b">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="এই পেজের সব পণ্য নির্বাচন করুন"
                    checked={filteredItems.length > 0 && filteredItems.every((p) => selectedIds.has(p.id))}
                    onChange={(e) => {
                      setBulkPreview(null);
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) filteredItems.forEach((p) => next.add(p.id));
                        else filteredItems.forEach((p) => next.delete(p.id));
                        return next;
                      });
                    }}
                  />
                </th>
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
                      <input
                        type="checkbox"
                        aria-label={`${p.name} নির্বাচন করুন`}
                        checked={selectedIds.has(p.id)}
                        onChange={(e) => {
                          setBulkPreview(null);
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(p.id); else next.delete(p.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.imageUrl ? (
                          <MediaImage
                            src={p.imageUrl}
                            alt={p.name}
                            width={80}
                            height={80}
                            sizes="40px"
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
                          {p.brandId ? (
                            <div className="text-[11px] text-indigo-500">
                              🏷️ {brands.find((b) => b.id === p.brandId)?.name ?? "ব্র্যান্ড"}
                              {p.freeShipping ? <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">ফ্রি ডেলিভারি</span> : null}
                            </div>
                          ) : p.freeShipping ? (
                            <div className="text-[11px]"><span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">ফ্রি ডেলিভারি</span></div>
                          ) : null}
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
                      {renderProductActions(p)}
                    </td>
                  </tr>
                );
              })}
              </tbody>
              </table>
            </div>
          }
          cards={filteredItems.map((p) => {
            const isLowStock = p.stockQuantity !== null && p.stockQuantity !== undefined && p.stockQuantity <= 5;
            const isOutOfStock = p.stockQuantity !== null && p.stockQuantity !== undefined && p.stockQuantity === 0;
            return (
              <div key={p.id} className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    aria-label={`${p.name} নির্বাচন করুন`}
                    checked={selectedIds.has(p.id)}
                    onChange={(e) => {
                      setBulkPreview(null);
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(p.id); else next.delete(p.id);
                        return next;
                      });
                    }}
                    className="mt-1"
                  />
                  {p.imageUrl ? (
                    <MediaImage
                      src={p.imageUrl}
                      alt={p.name}
                      width={80}
                      height={80}
                      sizes="40px"
                      className="h-10 w-10 rounded-lg object-cover border border-slate-200"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-500 font-bold text-xs">
                      📦
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900">{p.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {p.category || "সাধারণ ক্যাটাগরি"}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono text-slate-600">{p.sku || "—"}</span>
                      <span className="font-bold text-slate-900">
                        {formatMinor(BigInt(p.priceMinor))}
                      </span>
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
                    </div>
                    <div className="mt-1 text-xs">
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
                    </div>
                  </div>
                </div>
                <div className="mt-2">
                  {renderProductActions(p)}
                </div>
              </div>
            );
          })}
        />
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
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-name">
                  পণ্যের নাম (Product Name) *
                </label>
                <input id="product-form-name"
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-sku">SKU কোড</label>
                  <input id="product-form-sku"
                    type="text"
                    placeholder="WLT-001"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-category">ক্যাটাগরি</label>
                  {ecCategories.length > 0 ? (
                    <select id="product-form-category"
                      value={form.categoryId}
                      onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                      className="w-full rounded-lg border px-3 py-1.5 text-xs"
                    >
                      <option value="">ক্যাটাগরি নেই</option>
                      {ecCategories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input id="product-form-category"
                      type="text"
                      placeholder="Fashion / Electronics"
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      className="w-full rounded-lg border px-3 py-1.5 text-xs"
                    />
                  )}
                </div>
              </div>

              {/* GC6: brand picker + free shipping */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-brand">ব্র্যান্ড</label>
                  <select id="product-form-brand"
                    value={form.brandId}
                    onChange={(e) => setForm({ ...form, brandId: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  >
                    <option value="">কোনো ব্র্যান্ড নয়</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.freeShipping}
                      onChange={(e) => setForm({ ...form, freeShipping: e.target.checked })}
                    />
                    ফ্রি ডেলিভারি (এই পণ্যে ডেলিভারি চার্জ প্রযোজ্য নয়)
                  </label>
                </div>
              </div>

              {/* EC3: tags */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ট্যাগ</label>
                {ecTags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {ecTags.map((t) => (
                      <label key={t.id} className="flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] text-slate-600">
                        <input
                          type="checkbox"
                          checked={form.tagIds.includes(t.id)}
                          onChange={(e) => setForm({
                            ...form,
                            tagIds: e.target.checked ? [...form.tagIds, t.id] : form.tagIds.filter((id) => id !== t.id),
                          })}
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">এখনো কোনো ট্যাগ নেই — নিচে নতুন ট্যাগ তৈরি করুন।</p>
                )}
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    placeholder="নতুন ট্যাগ" aria-label="নতুন ট্যাগ"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onQuickAddTag(); } }}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  />
                  <button type="button" disabled={tagBusy || !newTagName.trim()} onClick={onQuickAddTag}
                    className="whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                    + ট্যাগ যোগ
                  </button>
                </div>
              </div>

              {/* EC3: shipping dimensions / barcode / SEO */}
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-weight">ওজন (গ্রাম)</label>
                  <input id="product-form-weight" type="number" min="0" placeholder="500" value={form.weightGrams}
                    onChange={(e) => setForm({ ...form, weightGrams: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-length">দৈর্ঘ্য (সেমি)</label>
                  <input id="product-form-length" type="number" min="0" step="0.1" placeholder="20" value={form.lengthCm}
                    onChange={(e) => setForm({ ...form, lengthCm: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-width">প্রস্থ (সেমি)</label>
                  <input id="product-form-width" type="number" min="0" step="0.1" placeholder="15" value={form.widthCm}
                    onChange={(e) => setForm({ ...form, widthCm: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-height">উচ্চতা (সেমি)</label>
                  <input id="product-form-height" type="number" min="0" step="0.1" placeholder="10" value={form.heightCm}
                    onChange={(e) => setForm({ ...form, heightCm: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-barcode">বারকোড</label>
                <input id="product-form-barcode" type="text" placeholder="Barcode / EAN" value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs font-mono" />
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-seo-title">SEO টাইটেল</label>
                  <input id="product-form-seo-title" type="text" placeholder="সার্চ ইঞ্জিনের জন্য শিরোনাম" value={form.seoTitle}
                    onChange={(e) => setForm({ ...form, seoTitle: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-seo-description">SEO বিবরণ</label>
                  <textarea id="product-form-seo-description" rows={2} placeholder="সার্চ ইঞ্জিনের জন্য সংক্ষিপ্ত বিবরণ" value={form.seoDescription}
                    onChange={(e) => setForm({ ...form, seoDescription: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-price">
                    বিক্রয়মূল্য (BDT) *
                  </label>
                  <input id="product-form-price"
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-compare-at">
                    আসল দাম (Compare Price)
                  </label>
                  <input id="product-form-compare-at"
                    type="number"
                    step="0.01"
                    placeholder="1500"
                    value={form.compareAtPrice}
                    onChange={(e) => setForm({ ...form, compareAtPrice: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs text-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-cost">
                    ইউনিট কস্ট (Cost BDT)
                  </label>
                  <input id="product-form-cost"
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-stock">
                    স্টক পরিমাণ (Stock Quantity)
                  </label>
                  <input id="product-form-stock"
                    type="number"
                    min="0"
                    placeholder="50"
                    value={form.stockQuantity}
                    onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-status">স্ট্যাটাস</label>
                  <select id="product-form-status"
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
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-low-stock">
                  কম স্টকের সতর্কতা (Low-stock alert, খালি = ৫)
                </label>
                <input id="product-form-low-stock"
                  type="number"
                  min="0"
                  placeholder="5"
                  value={form.lowStockThreshold}
                  onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-tax-rate">
                  VAT হার % (ঐচ্ছিক — ফাঁকা = দোকানের ডিফল্ট)
                </label>
                <input id="product-form-tax-rate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  placeholder="যেমন: 15 বা 7.5"
                  value={form.taxRatePercent}
                  onChange={(e) => setForm({ ...form, taxRatePercent: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-image-url">
                  প্রোডাক্ট ইমেজ ইউআরএল (Image URL)
                </label>
                <input id="product-form-image-url"
                  type="url"
                  placeholder="https://images.unsplash.com/photo-..."
                  value={form.imageUrl}
                  onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-description">
                  বিস্তারিত বর্ণনা (Product Description)
                </label>
                <textarea id="product-form-description"
                  rows={3}
                  placeholder="পণ্যের ফিচার, ওয়ারেন্টি এবং গুণমান সম্পর্কে লিখুন..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                />
              </div>

              {/* AB6 (AX13): English content */}
              <div className="rounded-xl border border-sky-300 bg-sky-50/40 p-3.5 space-y-3">
                <div className="text-xs font-bold text-sky-950">ইংরেজি কনটেন্ট (English)</div>
                <p className="text-[11px] text-slate-500">দোকানের ভাষা English হলে এই লেখা দেখাবে; খালি রাখলে মূল নাম/বিবরণই দেখাবে।</p>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-name-en">ইংরেজি নাম (Name in English)</label>
                  <input id="product-form-name-en"
                    type="text"
                    placeholder="e.g. Premium Leather Wallet"
                    value={form.nameEn}
                    onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="product-form-description-en">ইংরেজি বিবরণ (Description in English)</label>
                  <textarea id="product-form-description-en"
                    rows={3}
                    placeholder="Product features, warranty and quality in English..."
                    value={form.descriptionEn}
                    onChange={(e) => setForm({ ...form, descriptionEn: e.target.value })}
                    className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  />
                </div>
              </div>

              {/* NF5 (FB3): multi-language translations + display currencies.
                  Only for an existing product (translations key off its id);
                  drafts are never public — approval happens in the panel. */}
              {editingProduct ? (
                <ProductTranslationsPanel orgId={getOrganizationId() ?? ""} productId={editingProduct.id} />
              ) : null}

              {/* EC24: প্রি-অর্ডার / ডিজিটাল / সাবস্ক্রিপশন / পাইকারি স্তর */}
              <div className="rounded-xl border border-violet-300 bg-violet-50/40 p-3.5 space-y-3">
                <div className="text-xs font-bold text-violet-950">🧩 পণ্যের ধরন সম্প্রসারণ (প্রি-অর্ডার · ডিজিটাল · সাবস্ক্রিপশন · পাইকারি)</div>

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input type="checkbox" checked={ec24.preorderEnabled} onChange={(e) => setEc24({ ...ec24, preorderEnabled: e.target.checked })} />
                  প্রি-অর্ডার চালু (স্টক না থাকলেও অর্ডার নেওয়া যাবে)
                </label>
                {ec24.preorderEnabled ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px] font-semibold text-slate-600">রিলিজের তারিখ
                      <input type="date" value={ec24.preorderReleaseDate} onChange={(e) => setEc24({ ...ec24, preorderReleaseDate: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" />
                    </label>
                    <label className="block text-[11px] font-semibold text-slate-600">প্রি-অর্ডার সীমা (ঐচ্ছিক)
                      <input type="number" min="1" value={ec24.preorderLimit} onChange={(e) => setEc24({ ...ec24, preorderLimit: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" />
                    </label>
                  </div>
                ) : null}

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input type="checkbox" checked={ec24.digital} onChange={(e) => setEc24({ ...ec24, digital: e.target.checked })} />
                  ডিজিটাল পণ্য (ডেলিভারির পর ডাউনলোড লিংক)
                </label>
                {ec24.digital ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px] font-semibold text-slate-600">ফাইল URL (ফাইল ডেলিভারিতে আবশ্যক)
                      <input type="url" value={ec24.digitalFileUrl} onChange={(e) => setEc24({ ...ec24, digitalFileUrl: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" placeholder="https://…" />
                    </label>
                    <label className="block text-[11px] font-semibold text-slate-600">অ্যাক্সেস সীমা (ঐচ্ছিক)
                      <input type="number" min="1" value={ec24.digitalAccessLimit} onChange={(e) => setEc24({ ...ec24, digitalAccessLimit: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" />
                    </label>
                    {/* AB5 (AX9): delivery type + signed-link expiry. */}
                    <label className="block text-[11px] font-semibold text-slate-600">ডেলিভারির ধরন
                      <select value={ec24.digitalDeliveryType} onChange={(e) => setEc24({ ...ec24, digitalDeliveryType: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs">
                        <option value="file">শুধু ফাইল</option>
                        <option value="license">শুধু লাইসেন্স কী</option>
                        <option value="both">ফাইল + লাইসেন্স কী</option>
                      </select>
                    </label>
                    <label className="block text-[11px] font-semibold text-slate-600">লিংকের মেয়াদ (ঘণ্টা)
                      <input type="number" min="1" max="720" value={ec24.digitalLinkExpiryHours} onChange={(e) => setEc24({ ...ec24, digitalLinkExpiryHours: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" placeholder="খালি = ডিফল্ট ৭২ ঘণ্টা" />
                    </label>
                  </div>
                ) : null}

                {/* AB5 (AX9): license-key pool — edit view only, for
                    digital products delivering license keys. Staff
                    see masked keys (last 4) only. */}
                {editingProduct && ec24.digital && (ec24.digitalDeliveryType === "license" || ec24.digitalDeliveryType === "both") ? (
                  <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
                    <p className="text-[11px] font-bold text-sky-950">🔑 লাইসেন্স কী পুল — {editingProduct.name}</p>
                    {lkSummary ? (
                      <p className="text-[11px] text-slate-600">
                        উপলব্ধ: <b>{lkSummary.available}</b>টি · বরাদ্দ হয়েছে: <b>{lkSummary.assigned}</b>টি · বাতিল: <b>{lkSummary.revoked}</b>টি
                      </p>
                    ) : <p className="text-[11px] text-slate-400">পুলের হিসাব লোড হচ্ছে…</p>}
                    <label className="block text-[11px] font-semibold text-slate-600">কী ইমপোর্ট (এক লাইনে একটি কী, সর্বোচ্চ ৫০০টি)
                      <textarea value={lkText} onChange={(e) => setLkText(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border px-2 py-1.5 font-mono text-xs" placeholder={"XXXX-XXXX-XXXX-1111\nYYYY-YYYY-YYYY-2222"} />
                    </label>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="block text-[11px] font-semibold text-slate-600">ব্যাচ লেবেল (ঐচ্ছিক)
                        <input type="text" value={lkBatch} onChange={(e) => setLkBatch(e.target.value)} className="mt-1 w-44 rounded-lg border px-2 py-1.5 text-xs" placeholder="যেমন: অক্টোবর লট" />
                      </label>
                      <button type="button" disabled={lkBusy || !lkText.trim()} onClick={() => void importLicenseKeys()} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                        {lkBusy ? "হচ্ছে…" : "ইমপোর্ট করুন"}
                      </button>
                    </div>
                    {lkReport ? <p className="rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-700">{lkReport}</p> : null}
                    {lkError ? <p className="rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] font-medium text-rose-700">{lkError}</p> : null}
                    {lkKeys.length === 0 ? (
                      <p className="text-[11px] text-slate-400">পুলে এখনো কোনো কী নেই।</p>
                    ) : (
                      <ul className="max-h-44 space-y-1 overflow-y-auto">
                        {lkKeys.map((k) => (
                          <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-2 py-1 text-[11px]">
                            <span className="font-mono font-bold text-slate-700">••••{k.keyLast4}</span>
                            <span className={`rounded px-1.5 py-0.5 font-bold ${k.status === "available" ? "bg-emerald-100 text-emerald-700" : k.status === "assigned" ? "bg-sky-100 text-sky-700" : "bg-rose-100 text-rose-700"}`}>
                              {k.status === "available" ? "উপলব্ধ" : k.status === "assigned" ? "বরাদ্দ হয়েছে" : k.status === "revoked" ? "বাতিল" : k.status}
                            </span>
                            {k.importBatch ? <span className="text-slate-400">{k.importBatch}</span> : null}
                            {k.status !== "revoked" ? (
                              <button type="button" disabled={lkBusy} onClick={() => void revokeLicenseKey(k)} className="font-bold text-rose-600 disabled:opacity-50">বাতিল করুন</button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-[11px] text-slate-500">সম্পূর্ণ কী স্টাফ প্যানেলে কখনো দেখানো হয় না — শুধু শেষ ৪টি অক্ষর। ক্রেতা ডেলিভারির পর ট্র্যাকিং পেজে নিজের কী দেখতে পাবেন। পণ্যের ডেলিভারির ধরন বদলে সেভ করলে পুলটি ওই ধরন অনুযায়ী ব্যবহৃত হবে।</p>
                  </div>
                ) : null}

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input type="checkbox" checked={ec24.subscriptionEnabled} onChange={(e) => setEc24({ ...ec24, subscriptionEnabled: e.target.checked })} />
                  সাবস্ক্রিপশন চালু (স্টাফ সাবস্ক্রিপশন তৈরি করতে পারবেন)
                </label>
                {ec24.subscriptionEnabled ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px] font-semibold text-slate-600">ইন্টারভাল (দিন, আবশ্যক)
                      <input type="number" min="1" value={ec24.subscriptionIntervalDays} onChange={(e) => setEc24({ ...ec24, subscriptionIntervalDays: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" />
                    </label>
                    <label className="block text-[11px] font-semibold text-slate-600">নবায়ন ছাড় % (ঐচ্ছিক)
                      <input type="number" min="0" max="100" value={ec24.subscriptionDiscountPercent} onChange={(e) => setEc24({ ...ec24, subscriptionDiscountPercent: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" />
                    </label>
                  </div>
                ) : null}

                {/* AB2 (AX3): gift-card product configuration */}
                <div className="space-y-2 border-t border-violet-200 pt-3">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={giftCard.enabled} onChange={(e) => setGiftCard({ ...giftCard, enabled: e.target.checked })} />
                    🎁 গিফট কার্ড হিসেবে বিক্রি
                  </label>
                  {giftCard.enabled ? (
                    <div className="space-y-2">
                      <label className="block text-[11px] font-semibold text-slate-600">Preset পরিমাণ (টাকা, কমা দিয়ে আলাদা করুন)
                        <input type="text" value={giftCard.presetsTaka} onChange={(e) => setGiftCard({ ...giftCard, presetsTaka: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" placeholder="৫০০, ১০০০, ২০০০" />
                      </label>
                      <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                        <input type="checkbox" checked={giftCard.allowCustomAmount} onChange={(e) => setGiftCard({ ...giftCard, allowCustomAmount: e.target.checked })} />
                        ক্রেতা নিজের পছন্দমতো পরিমাণ দিতে পারবেন
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-[11px] font-semibold text-slate-600">সর্বনিম্ন পরিমাণ (৳, ঐচ্ছিক)
                          <input type="number" min="0" step="0.01" value={giftCard.minTaka} onChange={(e) => setGiftCard({ ...giftCard, minTaka: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" />
                        </label>
                        <label className="block text-[11px] font-semibold text-slate-600">সর্বোচ্চ পরিমাণ (৳, ঐচ্ছিক)
                          <input type="number" min="0" step="0.01" value={giftCard.maxTaka} onChange={(e) => setGiftCard({ ...giftCard, maxTaka: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" />
                        </label>
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-500">
                        গিফট কার্ড পণ্যের স্টক থাকে না এবং এটি কখনো স্টক-আউট হয় না। গিফট কার্ড দিয়ে গিফট কার্ড কেনা যায় না। কার্ডের কোড ক্রেতা অর্ডারের ট্র্যাকিং পেজে পাবেন।
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-slate-600">পাইকারি স্তর (কমপক্ষে পরিমাণ → একক দাম ৳) — সর্বোচ্চ ১০টি, পরিমাণ বাড়তে হবে</p>
                  {ec24.tiers.map((t, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="number" min="2" placeholder="পরিমাণ (কমপক্ষে)" aria-label="পাইকারি স্তরের পরিমাণ (কমপক্ষে)" value={t.minQty} onChange={(e) => setEc24({ ...ec24, tiers: ec24.tiers.map((x, xi) => (xi === i ? { ...x, minQty: e.target.value } : x)) })} className="w-32 rounded-lg border px-2 py-1.5 text-xs" />
                      <input type="number" min="0" step="0.01" placeholder="দাম ৳" aria-label="পাইকারি স্তরের দাম (টাকা)" value={t.price} onChange={(e) => setEc24({ ...ec24, tiers: ec24.tiers.map((x, xi) => (xi === i ? { ...x, price: e.target.value } : x)) })} className="w-32 rounded-lg border px-2 py-1.5 text-xs" />
                      <button type="button" onClick={() => setEc24({ ...ec24, tiers: ec24.tiers.filter((_, xi) => xi !== i) })} className="rounded-lg bg-rose-100 px-2 py-1 text-xs font-bold text-rose-700">মুছুন</button>
                    </div>
                  ))}
                  {ec24.tiers.length < 10 ? (
                    <button type="button" onClick={() => setEc24({ ...ec24, tiers: [...ec24.tiers, { minQty: "", price: "" }] })} className="rounded-lg bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-800">+ স্তর যোগ করুন</button>
                  ) : null}
                </div>

                {/* GC1: product video (link only) */}
                <div className="space-y-2 border-t border-violet-200 pt-3">
                  <p className="text-[11px] font-bold text-violet-950">🎬 পণ্যের ভিডিও</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px] font-semibold text-slate-600">ভিডিও URL
                      <input type="url" value={ec24.videoUrl} onChange={(e) => setEc24({ ...ec24, videoUrl: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" placeholder="https://…" />
                    </label>
                    <label className="block text-[11px] font-semibold text-slate-600">ভিডিও পোস্টার URL (ঐচ্ছিক)
                      <input type="url" value={ec24.videoPosterUrl} onChange={(e) => setEc24({ ...ec24, videoPosterUrl: e.target.value })} className="mt-1 w-full rounded-lg border px-2 py-1.5 text-xs" placeholder="https://…" />
                    </label>
                  </div>
                  <p className="text-[11px] text-slate-500">YouTube / Vimeo লিংক অথবা সরাসরি .mp4/.webm ফাইলের লিংক — ভিডিও আপলোডের সুবিধা নেই, লিংক দিতে হবে।</p>
                </div>
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
                    <label className="block text-[11px] font-semibold text-slate-700 mb-0.5" htmlFor="product-form-bump-title">
                      অ্যাড-অন অফার শিরোনাম (Bump Offer Title):
                    </label>
                    <input id="product-form-bump-title"
                      type="text"
                      placeholder="যেমন: মাত্র ১৯০ টাকায় লেদার কি-রিং ও স্পেশাল পলিশ যোগ করুন"
                      value={form.bumpTitle}
                      onChange={(e) => setForm({ ...form, bumpTitle: e.target.value })}
                      className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-0.5" htmlFor="product-form-bump-price">
                        অ্যাড-অন প্রাইস (Bump Price BDT):
                      </label>
                      <input id="product-form-bump-price"
                        type="number"
                        step="0.01"
                        placeholder="190"
                        value={form.bumpPrice}
                        onChange={(e) => setForm({ ...form, bumpPrice: e.target.value })}
                        className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-bold text-amber-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-0.5" htmlFor="product-form-bump-image">
                        অ্যাড-অন ইমেজ লিংক (ঐচ্ছিক):
                      </label>
                      <input id="product-form-bump-image"
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

            {/* ED13: sticky save bar — the form's existing বাতিল /
                সংরক্ষণ করুন buttons (same handlers) stay reachable at
                the bottom of the long scrolling modal form. The -mx-6 /
                px-6 pair lets the bar's background span the form's
                padding so fields scrolling underneath stay covered. */}
            <div className="sticky bottom-0 -mx-6 flex items-center justify-end gap-2 border-t bg-white px-6 pt-3">
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

      {/* EC3: bulk preview — প্রয়োগ এই প্যানেল থেকেই, প্রিভিউ ছাড়া নয় */}
      {bulkPreview ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => setBulkPreview(null)}>
          <div className="card w-full max-w-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">বাল্ক এডিট প্রিভিউ</h2>
              <button className="text-slate-500" onClick={() => setBulkPreview(null)}>✕</button>
            </div>
            <p className="text-sm text-slate-600">
              প্রভাবিত হবে: <b>{bulkPreview.affected}</b>টি পণ্য
              {bulkPreview.missing > 0 ? <> · পাওয়া যায়নি: <b>{bulkPreview.missing}</b>টি</> : null}
            </p>
            {bulkPreview.items.length === 0 ? (
              <p className="text-sm text-slate-500">কোনো পরিবর্তন নেই।</p>
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-lg border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr><th className="px-3 py-2">পণ্য</th><th className="px-3 py-2">ফিল্ড</th><th className="px-3 py-2">আগে</th><th className="px-3 py-2">পরে</th></tr>
                  </thead>
                  <tbody>
                    {bulkPreview.items.slice(0, 50).map((it, i) => (
                      <tr key={`${it.productId}-${it.field}-${i}`} className="border-t">
                        <td className="px-3 py-2 font-medium">{it.name}</td>
                        <td className="px-3 py-2">{it.field}</td>
                        <td className="px-3 py-2 text-slate-500">{String(it.before)}</td>
                        <td className="px-3 py-2 font-semibold">{String(it.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {bulkPreview.items.length > 50 ? <p className="text-xs text-slate-400">প্রথম ৫০টি পরিবর্তন দেখানো হচ্ছে।</p> : null}
            <div className="flex justify-end gap-2">
              <button className="rounded-lg border px-4 py-2 text-xs font-semibold" onClick={() => setBulkPreview(null)}>বাতিল</button>
              <button className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                disabled={bulkBusy || bulkPreview.affected === 0} onClick={onBulkApply}>
                {bulkBusy ? "প্রয়োগ হচ্ছে…" : "প্রয়োগ করুন"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* GC6: brand manager */}
      {brandMgrOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => setBrandMgrOpen(false)}>
          <div className="card w-full max-w-lg p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">🏷️ ব্র্যান্ড ব্যবস্থাপনা</h2>
              <button className="text-slate-500" onClick={() => setBrandMgrOpen(false)}>✕</button>
            </div>
            <p className="text-xs text-slate-500">ব্র্যান্ড মুছলে তার পণ্যগুলো মোছা হয় না — শুধু ব্র্যান্ডের লিংক সরিয়ে দেওয়া হয়।</p>
            <form onSubmit={onSaveBrand} className="space-y-3 border-b pb-4">
              <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="ব্র্যান্ডের নাম *" value={brandForm.name} onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })} required />
              <input className="w-full rounded-lg border px-3 py-2 text-sm" placeholder="লোগো URL (ঐচ্ছিক)" value={brandForm.logoUrl} onChange={(e) => setBrandForm({ ...brandForm, logoUrl: e.target.value })} />
              <textarea className="w-full rounded-lg border px-3 py-2 text-sm" rows={2} placeholder="বিবরণ (ঐচ্ছিক)" value={brandForm.description} onChange={(e) => setBrandForm({ ...brandForm, description: e.target.value })} />
              <div className="flex gap-2">
                <button className="btn-primary disabled:opacity-50" disabled={brandBusy || !brandForm.name.trim()}>
                  {brandBusy ? "সেভ হচ্ছে..." : editingBrandId ? "ব্র্যান্ড আপডেট করুন" : "ব্র্যান্ড যোগ করুন"}
                </button>
                {editingBrandId ? (
                  <button type="button" className="rounded-lg border bg-white px-4 py-2 text-sm" onClick={() => { setEditingBrandId(null); setBrandForm({ name: "", logoUrl: "", description: "" }); }}>
                    বাতিল
                  </button>
                ) : null}
              </div>
            </form>
            {brands.length === 0 ? (
              <p className="text-sm text-slate-400">এখনো কোনো ব্র্যান্ড নেই।</p>
            ) : (
              <ul className="space-y-3">
                {brands.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-b-0">
                    <div className="flex items-center gap-3 text-sm">
                      {b.logoUrl ? (
                        <MediaImage src={b.logoUrl} alt={b.name} width={72} height={72} sizes="36px" className="h-9 w-9 rounded-lg border border-slate-200 object-contain" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-sm">🏷️</div>
                      )}
                      <div>
                        <span className="font-medium">{b.name}</span>
                        <span className="block text-xs text-slate-400">{b.productCount}টি পণ্য · /{b.slug}</span>
                      </div>
                    </div>
                    <div className="whitespace-nowrap">
                      <button className="mr-3 text-sm text-sky-700" disabled={brandBusy} onClick={() => { setEditingBrandId(b.id); setBrandForm({ name: b.name, logoUrl: b.logoUrl ?? "", description: b.description ?? "" }); setBrandMsg(""); }}>
                        সম্পাদনা
                      </button>
                      <button className="text-sm text-red-600" disabled={brandBusy} onClick={() => onDeleteBrand(b)}>মুছুন</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {brandMsg ? <p className="text-sm text-slate-600">{brandMsg}</p> : null}
          </div>
        </div>
      ) : null}

      {/* GC6: product history */}
      {historyFor ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => setHistoryFor(null)}>
          <div className="card w-full max-w-lg p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">📜 ইতিহাস — {historyFor.name}</h2>
              <button className="text-slate-500" onClick={() => setHistoryFor(null)}>✕</button>
            </div>
            {historyTruncated ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">সাম্প্রতিক ২০০টি ঘটনা দেখানো হচ্ছে</p>
            ) : null}
            {historyBusy ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}
            {historyMsg ? <p className="text-sm text-red-600">{historyMsg}</p> : null}
            {!historyBusy && !historyMsg && historyItems.length === 0 ? (
              <p className="text-sm text-slate-400">এখনো কোনো ইতিহাস রেকর্ড নেই।</p>
            ) : (
              <ul className="space-y-3">
                {historyItems.map((h, i) => (
                  <li key={`${h.at}-${i}`} className="border-b pb-3 last:border-b-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-800">{h.title}</span>
                      <span className="text-xs text-slate-400">{new Date(h.at).toLocaleString("bn-BD")}</span>
                    </div>
                    {h.detail ? <p className="mt-0.5 text-sm text-slate-600">{h.detail}</p> : null}
                    <p className="mt-0.5 text-xs text-slate-400">
                      {h.action}{h.actorName ? ` · ${h.actorName}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {channelsFor ? <EcChannelsDialog product={channelsFor} onClose={() => setChannelsFor(null)} /> : null}
      {galleryFor ? <EcGalleryDialog product={galleryFor} onClose={() => setGalleryFor(null)} /> : null}
      {bundleFor ? <EcBundleDialog product={bundleFor} onClose={() => setBundleFor(null)} /> : null}
      {categoryMgrOpen ? (
        <EcCategoryManagerDialog onClose={() => setCategoryMgrOpen(false)} onChanged={loadEcMeta} />
      ) : null}
    </div>
  );
}
