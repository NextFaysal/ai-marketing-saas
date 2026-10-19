"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { fmtDateTime, fmtMoney, fmtNumber, fmtTime } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  enqueue as enqueueOfflineSale, generateLocalReceiptNo, loadQueue, removeEntry,
  type PosOfflineEntry, type PosOfflineSalePayload,
} from "@/lib/pos-offline";
import {
  ScanDebouncer, barcodeDetectorSupported, normalizeScanCode,
} from "@/lib/pos-scan";
import {
  DEFAULT_RECEIPT_SETTINGS,
  getStoredReceiptSettings,
  saveStoredReceiptSettings,
  generateBarcodeSvg,
  calculateLabelGrid,
  type ReceiptCustomizationSettings,
  type BarcodeLabelData,
} from "@/lib/pos-receipt";
import {
  calculateDrawerReconciliation,
  buildZReportText,
  type DrawerReconciliationResult,
} from "@/lib/pos-closing";

// AB4: lib/api.ts surfaces a network failure (non-GET) as this
// exact message; an HTTP error carries the server's message
// instead. Only the network shape queues a sale offline.
const NETWORK_ERROR_MESSAGE = "নেটওয়ার্কে সমস্যা হচ্ছে। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।";
const TERMINAL_SYNC_STATUSES = new Set(["synced", "conflict", "rejected", "discarded"]);

function isNetworkFailure(e: unknown): boolean {
  return e instanceof Error && e.message === NETWORK_ERROR_MESSAGE;
}

function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return `pos-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

// EC34 — POS / কাউন্টার বিক্রি। বামে পণ্য খোঁজা (Enter-এ exact
// SKU/barcode মিললে সরাসরি কার্টে), ডানে কার্ট + পেমেন্ট।
// দাম এখানে শুধু API-র search payload থেকে দেখানো হয়; বিক্রির
// চূড়ান্ত হিসাব (প্রমোশন/কুপন/কর) সার্ভারেই হয় — কার্টের
// মোটটি তাই "আনুমানিক" লেবেলযুক্ত।

interface PosVariant {
  id: string; name: string; sku?: string | null;
  priceMinor: string | null; stockQuantity: number | null;
}
interface PosProduct {
  productId: string; name: string; sku?: string | null; barcode?: string | null;
  imageUrl?: string | null; priceMinor: string; stockQuantity: number | null;
  stockState: string; preorderEnabled?: boolean; variants: PosVariant[];
}
interface PosExact extends PosProduct {
  variantId: string | null; variant: PosVariant | null;
  unitPriceMinor: string; effectiveStockQuantity: number | null;
}
interface SearchResponse { exact: PosExact | null; results: PosProduct[] }

interface CartLine {
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  sku: string | null;
  unitPriceMinor: number;
  quantity: number;
  /** Tracked stock for the chosen variant/product; null = untracked. */
  stockQuantity: number | null;
  variants: PosVariant[];
  productPriceMinor: number;
  productStockQuantity: number | null;
}

interface ReceiptData {
  shopName: string | null; orderNumber: string | null;
  lines: Array<{ name: string; quantity: number; unitPriceMinor: string; totalMinor: string }>;
  subtotalMinor: string; discountMinor: string; taxMinor: string; taxAddedMinor: string;
  totalMinor: string; paidMinor: string; dueMinor: string;
  paymentMode: string; paymentMethod: string | null;
  // AB1: loyalty slice of the sale (inside the receipt payload;
  // points used is 0 and the discount "0" when nothing redeemed).
  loyaltyPointsUsed?: number;
  loyaltyDiscountMinor?: string;
  // AB2: gift-card slice of the sale, present only when a card
  // was applied (last4 + discount only, never the full code).
  giftCard?: { codeLast4: string; discountMinor: string };
}
interface SaleResponse {
  id: string; externalNumber?: string | null; receipt: ReceiptData;
  // AB1: some responses also carry the loyalty fields at the top
  // level — the receipt view checks both places.
  loyaltyPointsUsed?: number;
  loyaltyDiscountMinor?: string;
}

interface TodayOrder {
  id: string; externalNumber: string | null; totalMinor: string;
  dueMinor: string; createdAt: string; itemCount: number;
}
interface TodayResponse { orders: TodayOrder[]; totalSalesMinor: string; orderCount: number }

// AB4: one server ledger row for an offline sale's sync journey.
interface OfflineSyncRow {
  id: string; idempotencyKey: string; cashierId?: string | null;
  localReceiptNo: string | null; localTotalMinor: string | null;
  status: string; reason: string | null;
  serverOrderId: string | null; serverTotalMinor: string | null;
  varianceMinor: string | null; discardNote: string | null;
  attempts: number; createdAt: string; syncedAt: string | null;
  sale?: SaleResponse | null;
}
interface OfflineSyncListResponse { rows: OfflineSyncRow[] }

interface OfflineReceiptCard {
  entry: PosOfflineEntry;
  lines: Array<{ name: string; quantity: number; totalMinor: number }>;
}

// ML5 i18n: label holds a dict.pos key, resolved at render.
const SYNC_STATUS_CHIP = {
  synced: { label: "synced", cls: "bg-emerald-100 text-emerald-700" },
  conflict: { label: "conflict", cls: "bg-amber-100 text-amber-700" },
  rejected: { label: "cancel", cls: "bg-red-100 text-red-700" },
  discarded: { label: "skipped", cls: "bg-slate-200 text-slate-600" },
  pending: { label: "pending", cls: "bg-sky-100 text-sky-700" },
} as const satisfies Record<string, { label: string; cls: string }>;

function fmt(locale: "bn" | "en", v: string | number | null | undefined): string {
  const n = v == null ? 0 : Number(v);
  return fmtMoney(locale, Number.isFinite(n) ? n / 100 : 0, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ML5 i18n: labelKey holds a dict.pos key, resolved at render.
const STOCK_BADGE = {
  in_stock: { labelKey: "inStock", cls: "bg-emerald-100 text-emerald-700" },
  out_of_stock: { labelKey: "outOfStock", cls: "bg-red-100 text-red-700" },
  untracked: { labelKey: "stockIsNotTracked", cls: "bg-slate-100 text-slate-600" },
  preorder: { labelKey: "preOrder", cls: "bg-indigo-100 text-indigo-700" },
} as const satisfies Record<string, { labelKey: string; cls: string }>;

export default function PosPage() {
  const { dict, t, locale } = useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [resultVariant, setResultVariant] = useState<Record<string, string>>({});

  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [couponCode, setCouponCode] = useState("");
  // AB1: optional loyalty points to redeem for this customer
  // (only meaningful with a phone that resolves to a customer).
  const [loyaltyPoints, setLoyaltyPoints] = useState("");
  // AB2: optional gift-card code to redeem for this sale.
  const [giftCardCode, setGiftCardCode] = useState("");
  const [payMode, setPayMode] = useState<"paid" | "due">("paid");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [selling, setSelling] = useState(false);
  const [saleError, setSaleError] = useState("");
  const [lastSale, setLastSale] = useState<SaleResponse | null>(null);

  const [today, setToday] = useState<TodayResponse | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // AB4: connection state + local outbox + server sync ledger.
  const [online, setOnline] = useState<boolean>(
    () => (typeof navigator !== "undefined" ? navigator.onLine : true),
  );
  const [outbox, setOutbox] = useState<PosOfflineEntry[]>([]);
  const [offlineReceipt, setOfflineReceipt] = useState<OfflineReceiptCard | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [ledger, setLedger] = useState<OfflineSyncRow[] | null>(null);
  const [ledgerBusy, setLedgerBusy] = useState<string | null>(null);

  // POS Receipt Customizer State
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptCustomizationSettings>(DEFAULT_RECEIPT_SETTINGS);
  const [receiptSavedFeedback, setReceiptSavedFeedback] = useState(false);

  // Barcode & Price Tag Label Printing State
  const [barcodeModalOpen, setBarcodeModalOpen] = useState(false);
  const [barcodeLabelData, setBarcodeLabelData] = useState<BarcodeLabelData>({
    productName: dict.pos.premiumCasualShirt,
    skuOrBarcode: "SHIRT-BLK-L",
    priceFormatted: dict.pos.text1agmws,
    category: dict.pos.clothing,
  });
  const [barcodeLayout, setBarcodeLayout] = useState<"single_sticker" | "a4_sheet_24">("single_sticker");
  const [barcodeQty, setBarcodeQty] = useState(1);

  // Shift Closing & Cash Drawer (Z-Report) State
  const [zReportModalOpen, setZReportModalOpen] = useState(false);
  const [openingFloat, setOpeningFloat] = useState("2000");
  const [cashierName, setCashierName] = useState(dict.pos.counter1);
  const [shiftName, setShiftName] = useState(dict.pos.morningShift);
  const [cashPayouts, setCashPayouts] = useState("0");
  const [actualCashCounted, setActualCashCounted] = useState("");
  const [shiftStartTime] = useState(() => fmtTime(locale, new Date()));

  useEffect(() => {
    const orgId = getOrganizationId();
    if (orgId) {
      setReceiptSettings(getStoredReceiptSettings(orgId));
    }
  }, []);

  const handleSaveReceiptSettings = (updated: ReceiptCustomizationSettings) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const saved = saveStoredReceiptSettings(orgId, updated);
    setReceiptSettings(saved);
    setReceiptSavedFeedback(true);
    setTimeout(() => setReceiptSavedFeedback(false), 2500);
  };

  const openBarcodePrint = (
    productName: string,
    skuOrBarcode: string,
    price: string,
    count: number,
    layout: "single_sticker" | "a4_sheet_24"
  ) => {
    const svg = generateBarcodeSvg(skuOrBarcode || "12345678", 36);
    const w = window.open("", "_blank");
    if (!w) return;
    const itemsHtml = Array.from({ length: count })
      .map(() => {
        if (layout === "single_sticker") {
          return t("pos.divClassStickerSingleDiv", { receiptSettings: receiptSettings.storeName || dict.pos.ourShop, productName: productName, svg: svg, skuOrBarcode: skuOrBarcode, price: price });
        }
        return t("pos.divClassStickerGridItem", { receiptSettings: receiptSettings.storeName || dict.pos.ourShop, productName: productName, svg: svg, skuOrBarcode: skuOrBarcode, price: price });
      })
      .join("");

    const pageCss =
      layout === "single_sticker"
        ? `@page { size: 50mm 30mm; margin: 0; }
           body { margin: 0; padding: 2mm; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: system-ui, sans-serif; }
           .sticker.single { width: 46mm; height: 26mm; text-align: center; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; }
           .store-name { font-size: 8px; font-weight: bold; color: #475569; text-transform: uppercase; }
           .name { font-size: 10px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
           .barcode svg { width: 100%; max-height: 12mm; }
           .sku { font-size: 8px; font-family: monospace; }
           .price { font-size: 11px; font-weight: 800; }`
        : `@page { size: A4; margin: 10mm; }
           body { margin: 0; font-family: system-ui, sans-serif; }
           .grid-container { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; }
           .sticker.grid-item { border: 1px dashed #cbd5e1; padding: 4mm; text-align: center; border-radius: 4px; box-sizing: border-box; page-break-inside: avoid; }
           .store-name { font-size: 9px; font-weight: bold; color: #475569; text-transform: uppercase; }
           .name { font-size: 11px; font-weight: 700; margin: 1mm 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
           .barcode svg { width: 100%; max-height: 14mm; }
           .sku { font-size: 9px; font-family: monospace; color: #64748b; }
           .price { font-size: 13px; font-weight: 800; color: #0f172a; margin-top: 1mm; }`;

    const html = t("pos.dOCTYPEHtmlHtmlHeadMeta", { productName: productName, pageCss: pageCss, p2: layout === "a4_sheet_24" ? `<div class="grid-container">${itemsHtml}</div>` : itemsHtml });
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const openZReportPrint = (slipText: string) => {
    const w = window.open("", "_blank");
    if (!w) return;
    const html = t("pos.dOCTYPEHtmlHtmlHeadMeta2", { paperWidth: receiptSettings.paperWidth, receiptSettings: receiptSettings.paperWidth === "58mm" ? "48mm" : "72mm", slipText: slipText });
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  // AB4: camera scanning.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanNote, setScanNote] = useState("");
  const [scanFeedback, setScanFeedback] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanStreamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanDebouncerRef = useRef(new ScanDebouncer());

  const loadToday = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      setToday(await apiFetch<TodayResponse>(`/organizations/${orgId}/pos/today`));
    } catch { /* strip is advisory — the sale flow must not depend on it */ }
  }, []);

  const refreshOutbox = useCallback(() => {
    const orgId = getOrganizationId();
    setOutbox(orgId ? loadQueue(orgId) : []);
  }, []);

  const loadLedger = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<OfflineSyncListResponse>(`/organizations/${orgId}/pos/offline-sync`);
      setLedger(res.rows ?? []);
    } catch { /* ledger is advisory — the sale flow must not depend on it */ }
  }, []);

  useEffect(() => { loadToday(); }, [loadToday]);
  useEffect(() => { refreshOutbox(); loadLedger(); }, [refreshOutbox, loadLedger]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  // Connection badge: navigator.onLine + online/offline events.
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const addLine = useCallback((product: PosProduct, variant: PosVariant | null) => {
    const unit = variant?.priceMinor != null ? Number(variant.priceMinor) : Number(product.priceMinor);
    const stock = variant ? variant.stockQuantity : product.stockQuantity;
    const key = `${product.productId}::${variant?.id ?? ""}`;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => l.key === key ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...prev, {
        key,
        productId: product.productId,
        variantId: variant?.id ?? null,
        name: variant ? `${product.name} — ${variant.name}` : product.name,
        sku: variant?.sku ?? product.sku ?? null,
        unitPriceMinor: unit,
        quantity: 1,
        stockQuantity: stock,
        variants: product.variants ?? [],
        productPriceMinor: Number(product.priceMinor),
        productStockQuantity: product.stockQuantity,
      }];
    });
  }, []);

  const runSearchFor = useCallback(async (raw: string) => {
    const orgId = getOrganizationId();
    const q = raw.trim();
    if (!orgId || !q) return;
    setSearching(true); setSearchError("");
    try {
      const res = await apiFetch<SearchResponse>(`/organizations/${orgId}/pos/search?q=${encodeURIComponent(q)}`);
      if (res.exact) {
        // Exact SKU/barcode — straight into the cart (scan flow).
        addLine(res.exact, res.exact.variant);
        setQuery(""); setResults([]);
        searchRef.current?.focus();
      } else if (res.results.length === 1) {
        addLine(res.results[0], null);
        setQuery(""); setResults([]);
        searchRef.current?.focus();
      } else {
        setResults(res.results);
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : dict.pos.searchFailed);
    } finally { setSearching(false); }
  }, [addLine]);

  const runSearch = useCallback(() => runSearchFor(query), [runSearchFor, query]);

  // ---------- AB4: camera scanning ----------
  const stopScanner = useCallback(() => {
    if (scanTimerRef.current) { clearInterval(scanTimerRef.current); scanTimerRef.current = null; }
    if (scanStreamRef.current) {
      for (const track of scanStreamRef.current.getTracks()) {
        try { track.stop(); } catch { /* already stopped */ }
      }
      scanStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const closeScanner = useCallback(() => {
    stopScanner();
    setScanOpen(false);
    searchRef.current?.focus();
  }, [stopScanner]);

  const openScanner = useCallback(() => {
    if (!barcodeDetectorSupported(window)) {
      setScanNote(dict.pos.thisBrowserHasNoCamera);
      searchRef.current?.focus();
      return;
    }
    setScanNote("");
    setScanFeedback("");
    scanDebouncerRef.current.reset();
    setScanOpen(true);
  }, []);

  // Start the camera once the overlay (and its <video>) exists;
  // every failure degrades to the manual-entry note.
  useEffect(() => {
    if (!scanOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const Detector = (window as any).BarcodeDetector;
        const detector = new Detector();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        scanStreamRef.current = stream;
        const video = videoRef.current;
        if (!video) { stopScanner(); return; }
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        scanTimerRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const raw = codes?.[0]?.rawValue;
            if (!raw) return;
            const code = normalizeScanCode(raw);
            if (!code || !scanDebouncerRef.current.accept(code)) return;
            setScanFeedback(t("pos.scanned", { code: code }));
            setQuery(code);
            await runSearchFor(code);
          } catch { /* a bad frame is not an error — keep scanning */ }
        }, 300);
      } catch {
        if (!cancelled) {
          setScanNote(dict.pos.couldNotUseTheCamera);
          setScanOpen(false);
        }
      }
    })();
    return () => { cancelled = true; stopScanner(); };
  }, [scanOpen, runSearchFor, stopScanner]);

  const changeLineVariant = (line: CartLine, variantId: string) => {
    const variant = line.variants.find((v) => v.id === variantId) ?? null;
    const baseName = line.name.includes(" — ") ? line.name.split(" — ")[0] : line.name;
    setCart((prev) => prev.map((l) => l.key !== line.key ? l : {
      ...l,
      key: `${l.productId}::${variant?.id ?? ""}`,
      variantId: variant?.id ?? null,
      name: variant ? `${baseName} — ${variant.name}` : baseName,
      sku: variant?.sku ?? l.sku,
      unitPriceMinor: variant?.priceMinor != null ? Number(variant.priceMinor) : l.productPriceMinor,
      stockQuantity: variant ? variant.stockQuantity : l.productStockQuantity,
    }));
  };

  const estimate = cart.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0);

  // AB4: queue a sale locally (offline). The cart snapshot +
  // client total ride the card so staff see exactly what was
  // queued — labelled local/আনুমানিক, because the server's
  // totals at sync time are the truth.
  const queueOfflineSale = (salePayload: PosOfflineSalePayload, idempotencyKey: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const entry: PosOfflineEntry = {
      idempotencyKey,
      localReceiptNo: generateLocalReceiptNo(),
      localTotalMinor: String(estimate),
      sale: salePayload,
      queuedAt: new Date().toISOString(),
    };
    setOutbox(enqueueOfflineSale(orgId, entry));
    setOfflineReceipt({
      entry,
      lines: cart.map((l) => ({
        name: l.name, quantity: l.quantity, totalMinor: l.unitPriceMinor * l.quantity,
      })),
    });
    setLastSale(null);
    setCart([]); setCouponCode(""); setReference(""); setLoyaltyPoints(""); setGiftCardCode("");
    searchRef.current?.focus();
  };

  const completeSale = async () => {
    const orgId = getOrganizationId();
    if (!orgId || cart.length === 0 || selling) return;
    // AB4: EVERY sale attempt carries a fresh idempotency key,
    // so a retry (manual or offline-sync) can never double-sell.
    const idempotencyKey = newIdempotencyKey();
    const salePayload: PosOfflineSalePayload = {
      items: cart.map((l) => ({ productId: l.productId, variantId: l.variantId ?? undefined, quantity: l.quantity })),
      customerPhone: customerPhone.trim() || undefined,
      customerName: customerName.trim() || undefined,
      couponCode: couponCode.trim() || undefined,
      // AB1: sent only when a positive whole number is entered.
      loyaltyPoints: (() => { const n = parseInt(loyaltyPoints, 10); return Number.isFinite(n) && n > 0 ? n : undefined; })(),
      // AB2: sent only when a code was entered; a refusal
      // comes back as a sale error like any other.
      giftCardCode: giftCardCode.trim() || undefined,
      idempotencyKey,
      payment: payMode === "paid"
        ? { mode: "paid", method, reference: reference.trim() || undefined }
        : { mode: "due" },
    };
    setSelling(true); setSaleError("");
    // Known-offline before submit: queue without even trying.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      queueOfflineSale(salePayload, idempotencyKey);
      setSelling(false);
      return;
    }
    try {
      const res = await apiFetch<SaleResponse>(`/organizations/${orgId}/pos/sale`, {
        method: "POST",
        body: JSON.stringify(salePayload),
      });
      setLastSale(res);
      setOfflineReceipt(null);
      setCart([]); setCouponCode(""); setReference(""); setLoyaltyPoints(""); setGiftCardCode("");
      await loadToday();
      searchRef.current?.focus();
    } catch (e) {
      // AB4: a NETWORK failure queues the sale for sync; an
      // HTTP error (4xx/5xx from the server) surfaces as today
      // and is NEVER queued.
      if (isNetworkFailure(e)) {
        queueOfflineSale(salePayload, idempotencyKey);
      } else {
        setSaleError(e instanceof Error ? e.message : dict.pos.couldNotCompleteTheSale);
      }
    } finally { setSelling(false); }
  };

  // AB4: post each queued entry to the server ledger, in
  // order. A terminal server status hands the record over to
  // the ledger (local entry removed); a network failure stops
  // the run and keeps the rest queued.
  const syncOutbox = async () => {
    const orgId = getOrganizationId();
    if (!orgId || syncing) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    setSyncing(true); setSyncError("");
    let queue = loadQueue(orgId);
    for (const entry of [...queue]) {
      try {
        const row = await apiFetch<OfflineSyncRow>(`/organizations/${orgId}/pos/offline-sync`, {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: entry.idempotencyKey,
            localReceiptNo: entry.localReceiptNo,
            localTotalMinor: (() => {
              const n = parseInt(entry.localTotalMinor, 10);
              return Number.isFinite(n) && n >= 0 ? n : undefined;
            })(),
            sale: entry.sale,
          }),
        });
        if (TERMINAL_SYNC_STATUSES.has(row.status)) {
          queue = removeEntry(orgId, entry.idempotencyKey);
          setOutbox(queue);
        } else {
          break;
        }
      } catch (e) {
        if (isNetworkFailure(e)) {
          setSyncError(dict.pos.connectionLostDuringSyncThe);
        } else {
          setSyncError(e instanceof Error ? e.message : dict.pos.couldNotSync);
        }
        break;
      }
    }
    setSyncing(false);
    await loadLedger();
    await loadToday();
  };

  const repostLedgerRow = async (row: OfflineSyncRow, force: boolean) => {
    const orgId = getOrganizationId();
    if (!orgId || ledgerBusy) return;
    setLedgerBusy(row.id); setSyncError("");
    try {
      await apiFetch(`/organizations/${orgId}/pos/offline-sync/${row.id}/repost`, {
        method: "POST",
        body: JSON.stringify({ force }),
      });
      await loadLedger();
      await loadToday();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : dict.pos.couldNotRePost);
    } finally { setLedgerBusy(null); }
  };

  const discardLedgerRow = async (row: OfflineSyncRow) => {
    const orgId = getOrganizationId();
    if (!orgId || ledgerBusy) return;
    const note = window.prompt(dict.pos.skipNoteOptional, "");
    if (note === null) return; // cancelled — do nothing
    setLedgerBusy(row.id); setSyncError("");
    try {
      await apiFetch(`/organizations/${orgId}/pos/offline-sync/${row.id}/discard`, {
        method: "POST",
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      await loadLedger();
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : dict.pos.couldNotSkip);
    } finally { setLedgerBusy(null); }
  };

  const resetSale = () => {
    setLastSale(null); setOfflineReceipt(null); setSaleError("");
    setCustomerPhone(""); setCustomerName(""); setLoyaltyPoints(""); setGiftCardCode("");
    searchRef.current?.focus();
  };

  const printReceipt = (orderId: string) => {
    window.open(`/dashboard/commerce/print?kind=receipt&orderId=${orderId}`, "_blank");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">{dict.pos.pOSCounterSales}</h1>
          <p className="text-xs text-slate-500">
            {dict.pos.quickCashMemosThermalReceipts}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setReceiptModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            {dict.pos.customizeReceipt}{receiptSettings.paperWidth})
          </button>
          <button
            type="button"
            onClick={() => setBarcodeModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            {dict.pos.barcodeStickerPrint}</button>
          <button
            type="button"
            onClick={() => setZReportModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 shadow-sm"
          >
            {dict.pos.shiftCloseZReport}</button>
        </div>
      </div>

      {/* AB4: connection + outbox strip */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-2.5 text-sm">
        {online ? (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{dict.pos.online}</span>
        ) : (
          <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">{dict.pos.offline}</span>
        )}
        <span className="text-slate-600">{dict.pos.pendingSync}<strong>{outbox.length}{dict.pos.items}</strong> {dict.pos.offlineSales}</span>
        <button
          type="button"
          className="btn-primary ml-auto px-3 py-1.5 text-xs"
          disabled={!online || syncing || outbox.length === 0}
          onClick={syncOutbox}
        >
          {syncing ? dict.pos.syncing : dict.pos.sync}
        </button>
      </div>
      {syncError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{syncError}</p> : null}

      {/* AB4: connection + outbox strip */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-2.5 text-sm">
        {online ? (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{dict.pos.online}</span>
        ) : (
          <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">{dict.pos.offline}</span>
        )}
        <span className="text-slate-600">{dict.pos.pendingSync}<strong>{outbox.length}{dict.pos.items}</strong> {dict.pos.offlineSales}</span>
        <button
          type="button"
          className="btn-primary ml-auto px-3 py-1.5 text-xs"
          disabled={!online || syncing || outbox.length === 0}
          onClick={syncOutbox}
        >
          {syncing ? dict.pos.syncing : dict.pos.sync}
        </button>
      </div>
      {syncError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{syncError}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* ---------- left: search + results ---------- */}
        <section className="space-y-4">
          <form
            onSubmit={(e) => { e.preventDefault(); runSearch(); }}
            className="flex gap-2"
          >
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={dict.pos.typeAProductNameSKU}
              className="w-full rounded-lg border px-3 py-2.5 text-sm"
            />
            <button type="submit" className="btn-primary whitespace-nowrap" disabled={searching}>
              {searching ? dict.pos.searching : dict.pos.search}
            </button>
            <button
              type="button"
              className="whitespace-nowrap rounded-lg border px-3 py-2.5 text-sm font-semibold"
              onClick={openScanner}
            >
              {dict.pos.scan}</button>
          </form>
          {scanNote ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">{scanNote}</p> : null}
          {searchError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{searchError}</p> : null}

          {results.length > 0 ? (
            <ul className="divide-y rounded-xl border bg-white">
              {results.map((p) => {
                const badge = STOCK_BADGE[p.stockState as keyof typeof STOCK_BADGE] ?? STOCK_BADGE.untracked;
                const chosenVariantId = resultVariant[p.productId] ?? "";
                const chosenVariant = p.variants.find((v) => v.id === chosenVariantId) ?? null;
                return (
                  <li key={p.productId} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-slate-500">
                        {p.sku ? `SKU: ${p.sku}` : ""}{p.barcode ? t("pos.barcode", { barcode: p.barcode }) : ""}
                      </div>
                    </div>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}>{badge.labelKey === "inStock" ? t("pos.inStock", { stockQuantity: p.stockQuantity ?? 0 }) : dict.pos[badge.labelKey]}</span>
                    <span className="text-sm font-semibold">{fmt(locale, chosenVariant?.priceMinor ?? p.priceMinor)}</span>
                    {p.variants.length > 0 ? (
                      <select
                        value={chosenVariantId}
                        onChange={(e) => setResultVariant((prev) => ({ ...prev, [p.productId]: e.target.value }))}
                        className="rounded-lg border px-2 py-1.5 text-xs"
                      >
                        <option value="">{dict.pos.general}</option>
                        {p.variants.map((v) => (
                          <option key={v.id} value={v.id}>{v.name}{v.priceMinor != null ? ` — ${fmt(locale, v.priceMinor)}` : ""}</option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => {
                        const price = ((Number(chosenVariant?.priceMinor ?? p.priceMinor) || 0) / 100).toFixed(0);
                        const code = chosenVariant?.sku || p.barcode || p.sku || p.productId.slice(0, 8);
                        setBarcodeLabelData({
                          productName: p.name + (chosenVariant ? ` (${chosenVariant.name})` : ""),
                          skuOrBarcode: code,
                          priceFormatted: price,
                          category: dict.pos.product,
                        });
                        setBarcodeModalOpen(true);
                      }}
                    >
                      {dict.pos.barcode2}</button>
                    <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => addLine(p, chosenVariant)}>
                      {dict.pos.add}</button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">
              {dict.pos.scanOrTypeAnSKU}</p>
          )}

          {/* ---------- recent sales ---------- */}
          <section className="rounded-xl border bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{dict.pos.todaySSales}</h2>
              {today ? <span className="text-sm text-slate-600">{dict.pos.total}{today.orderCount}{dict.pos.text1949v8}{fmt(locale, today.totalSalesMinor)}</span> : null}
            </div>
            {!today ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : today.orders.length === 0 ? (
              <p className="text-sm text-slate-500">{dict.pos.noCounterSalesYetToday}</p>
            ) : (
              <ul className="divide-y">
                {today.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className="font-medium">{o.externalNumber ?? o.id}</span>
                    <span className="text-slate-500">{fmtTime(locale, new Date(o.createdAt))}</span>
                    <span className="text-slate-500">{o.itemCount}{dict.pos.items2}</span>
                    <span className="font-semibold">{fmt(locale, o.totalMinor)}</span>
                    {Number(o.dueMinor) > 0 ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{dict.pos.due}{fmt(locale, o.dueMinor)}</span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{dict.pos.paid}</span>
                    )}
                    <button type="button" className="ml-auto text-xs font-semibold text-indigo-600 hover:underline" onClick={() => printReceipt(o.id)}>
                      {dict.pos.reprintReceipt}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---------- AB4: offline sync ledger ---------- */}
          <section className="rounded-xl border bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{dict.pos.offlineSync}</h2>
              <button type="button" className="text-xs font-semibold text-indigo-600 hover:underline" onClick={loadLedger}>
                {dict.pos.refresh}</button>
            </div>
            {outbox.length > 0 ? (
              <p className="mb-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700">
                {dict.pos.inThisBrowserSQueue}{outbox.length}{dict.pos.offlineSalesAreWaitingTo}</p>
            ) : null}
            {!ledger ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : ledger.length === 0 ? (
              <p className="text-sm text-slate-500">{dict.pos.noOfflineSalesHaveSynced}</p>
            ) : (
              <ul className="divide-y">
                {ledger.map((row) => {
                  const chip = SYNC_STATUS_CHIP[row.status as keyof typeof SYNC_STATUS_CHIP] ?? SYNC_STATUS_CHIP.pending;
                  const busy = ledgerBusy === row.id;
                  return (
                    <li key={row.id} className="space-y-1.5 py-2.5 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{row.localReceiptNo ?? row.id}</span>
                        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}>{dict.pos[chip.label]}</span>
                        <span className="text-xs text-slate-500">{fmtDateTime(locale, new Date(row.createdAt))}</span>
                        <span className="text-xs text-slate-500">{dict.pos.attempts}{row.attempts}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 text-xs text-slate-600">
                        <span>{dict.pos.localTotalEstimated}{row.localTotalMinor != null ? fmt(locale, row.localTotalMinor) : "—"}</span>
                        {row.status === "synced" ? (
                          <>
                            <span>{dict.pos.serverTotal}{row.serverTotalMinor != null ? fmt(locale, row.serverTotalMinor) : "—"}</span>
                            <span>{dict.pos.difference}{row.varianceMinor != null ? fmt(locale, row.varianceMinor) : "—"}</span>
                          </>
                        ) : null}
                      </div>
                      {(row.status === "conflict" || row.status === "rejected") && row.reason ? (
                        <p className="text-xs font-medium text-red-600">{row.reason}</p>
                      ) : null}
                      {row.status === "discarded" && row.discardNote ? (
                        <p className="text-xs text-slate-500">{dict.pos.note}{row.discardNote}</p>
                      ) : null}
                      {row.status === "conflict" ? (
                        <div className="flex gap-2 pt-0.5">
                          <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => repostLedgerRow(row, true)}>
                            {dict.pos.postAnyway}</button>
                          <button type="button" className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600" disabled={busy} onClick={() => discardLedgerRow(row)}>
                            {dict.pos.skip}</button>
                        </div>
                      ) : row.status === "rejected" ? (
                        <div className="flex gap-2 pt-0.5">
                          <button type="button" className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600" disabled={busy} onClick={() => discardLedgerRow(row)}>
                            {dict.pos.skip}</button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </section>

        {/* ---------- right: cart ---------- */}
        <aside className="h-fit space-y-4 rounded-xl border bg-white p-4 lg:sticky lg:top-4">
          <h2 className="text-sm font-semibold">{dict.pos.cart}</h2>

          {lastSale ? (
            <div className="space-y-3 rounded-lg bg-emerald-50 p-3">
              <p className="text-sm font-semibold text-emerald-800">{dict.pos.saleComplete}{lastSale.receipt.orderNumber ?? ""}</p>
              <div className="space-y-1 text-sm text-emerald-900">
                <div className="flex justify-between"><span>{dict.pos.subtotal}</span><span>{fmt(locale, lastSale.receipt.subtotalMinor)}</span></div>
                <div className="flex justify-between"><span>{dict.pos.discount}</span><span>-{fmt(locale, lastSale.receipt.discountMinor)}</span></div>
                {(() => {
                  const used = lastSale.receipt.loyaltyPointsUsed ?? lastSale.loyaltyPointsUsed ?? 0;
                  const disc = lastSale.receipt.loyaltyDiscountMinor ?? lastSale.loyaltyDiscountMinor;
                  return used > 0 ? (
                    <>
                      <div className="flex justify-between"><span>{dict.pos.useLoyaltyPoints}</span><span>{used} {dict.pos.points}</span></div>
                      <div className="flex justify-between"><span>{dict.pos.loyaltyDiscountPartOfThe}</span><span>-{fmt(locale, disc)}</span></div>
                    </>
                  ) : null;
                })()}
                {lastSale.receipt.giftCard ? (
                  <div className="flex justify-between"><span>{dict.pos.giftCardDiscount}{lastSale.receipt.giftCard.codeLast4}{dict.pos.partOfTheDiscountAbove}</span><span>-{fmt(locale, lastSale.receipt.giftCard.discountMinor)}</span></div>
                ) : null}
                {Number(lastSale.receipt.taxAddedMinor) > 0 ? (
                  <div className="flex justify-between"><span>{dict.pos.tax}</span><span>{fmt(locale, lastSale.receipt.taxAddedMinor)}</span></div>
                ) : null}
                <div className="flex justify-between border-t border-emerald-200 pt-1 font-bold"><span>{dict.pos.total}</span><span>{fmt(locale, lastSale.receipt.totalMinor)}</span></div>
                <div className="flex justify-between"><span>{dict.pos.paid}</span><span>{fmt(locale, lastSale.receipt.paidMinor)}</span></div>
                <div className="flex justify-between"><span>{dict.pos.due}</span><span>{fmt(locale, lastSale.receipt.dueMinor)}</span></div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-primary flex-1" onClick={() => printReceipt(lastSale.id)}>{dict.pos.printReceipt}</button>
                <button type="button" className="flex-1 rounded-lg border px-3 py-2 text-sm font-semibold" onClick={resetSale}>{dict.pos.newSale}</button>
              </div>
            </div>
          ) : null}

          {/* AB4: local-only receipt for a sale queued offline.
              Clearly labelled local/আনুমানিক — the server total
              at sync time is the truth. */}
          {offlineReceipt ? (
            <div className="space-y-3 rounded-lg bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-800">{dict.pos.offlineSaleSyncPending}</p>
              <p className="text-xs text-amber-700">
                {dict.pos.localReceiptNo}{offlineReceipt.entry.localReceiptNo} {dict.pos.thisIsALocalEstimate}</p>
              <div className="space-y-1 text-sm text-amber-900">
                {offlineReceipt.lines.map((l, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{l.name} × {l.quantity}</span><span>{fmt(locale, l.totalMinor)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-amber-200 pt-1 font-bold">
                  <span>{dict.pos.localTotalEstimated2}</span><span>{fmt(locale, offlineReceipt.entry.localTotalMinor)}</span>
                </div>
              </div>
              <button type="button" className="w-full rounded-lg border px-3 py-2 text-sm font-semibold" onClick={resetSale}>{dict.pos.newSale}</button>
            </div>
          ) : null}

          {cart.length === 0 ? (
            <p className="text-sm text-slate-500">{dict.pos.cartIsEmptyAddProducts}</p>
          ) : (
            <ul className="space-y-3">
              {cart.map((l) => (
                <li key={l.key} className="rounded-lg border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{l.name}</div>
                      <div className="text-xs text-slate-500">{fmt(locale, l.unitPriceMinor)} × {l.quantity}</div>
                    </div>
                    <div className="text-sm font-semibold">{fmt(locale, l.unitPriceMinor * l.quantity)}</div>
                  </div>
                  {l.variants.length > 0 ? (
                    <select
                      value={l.variantId ?? ""}
                      onChange={(e) => changeLineVariant(l, e.target.value)}
                      className="mt-2 w-full rounded-lg border px-2 py-1.5 text-xs"
                    >
                      <option value="">{dict.pos.general}</option>
                      {l.variants.map((v) => (
                        <option key={v.id} value={v.id}>{v.name}{v.priceMinor != null ? ` — ${fmt(locale, v.priceMinor)}` : ""}</option>
                      ))}
                    </select>
                  ) : null}
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" className="rounded border px-2 py-0.5 text-sm" onClick={() => setCart((prev) => prev.map((x) => x.key === l.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}>−</button>
                    <span className="w-8 text-center text-sm font-medium">{l.quantity}</span>
                    <button type="button" className="rounded border px-2 py-0.5 text-sm" onClick={() => setCart((prev) => prev.map((x) => x.key === l.key ? { ...x, quantity: x.quantity + 1 } : x))}>+</button>
                    <button type="button" className="ml-auto text-xs font-semibold text-red-600 hover:underline" onClick={() => setCart((prev) => prev.filter((x) => x.key !== l.key))}>{dict.pos.remove}</button>
                  </div>
                  {l.stockQuantity != null && l.quantity > l.stockQuantity ? (
                    <p className="mt-1.5 text-xs font-medium text-red-600">{dict.pos.only}{l.stockQuantity}{dict.pos.leftInStockTheServer}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 border-t pt-3">
            <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder={dict.pos.customerPhoneOptional} className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={dict.pos.customerNameOptional} className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder={dict.pos.couponCodeOptional} className="w-full rounded-lg border px-3 py-2 text-sm" />
            <input value={giftCardCode} onChange={(e) => setGiftCardCode(e.target.value)} placeholder={dict.pos.giftCardCodeOptional} className="w-full rounded-lg border px-3 py-2 font-mono text-sm" />
            {customerPhone.trim() ? (
              <label className="block text-sm">{dict.pos.useLoyaltyPointsOptional}<input value={loyaltyPoints} onChange={(e) => setLoyaltyPoints(e.target.value)} type="number" min="0" step="1" placeholder={dict.pos.howManyPointsDoYou} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
                <span className="mt-1 block text-xs font-normal text-slate-400">{dict.pos.itWillBeDeductedFrom}</span>
              </label>
            ) : null}
          </div>

          <div className="space-y-2 border-t pt-3">
            <div className="flex gap-2">
              <button type="button" onClick={() => setPayMode("paid")} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${payMode === "paid" ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "text-slate-600"}`}>{dict.pos.cashPaid}</button>
              <button type="button" onClick={() => setPayMode("due")} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${payMode === "due" ? "border-amber-600 bg-amber-50 text-amber-700" : "text-slate-600"}`}>{dict.pos.dueLedger}</button>
            </div>
            {payMode === "paid" ? (
              <div className="flex gap-2">
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-lg border px-2 py-2 text-sm">
                  <option value="cash">{dict.pos.cash}</option>
                  <option value="bkash">{dict.pos.bKash}</option>
                  <option value="nagad">{dict.pos.nagad}</option>
                  <option value="card">{dict.pos.card}</option>
                  <option value="other">{dict.pos.other}</option>
                </select>
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={dict.pos.trxIDReferenceOptional} className="w-full rounded-lg border px-3 py-2 text-sm" />
              </div>
            ) : (
              <p className="text-xs text-slate-500">{dict.pos.forDueSalesTheFull}</p>
            )}
          </div>

          <div className="space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between"><span>{dict.pos.estimatedSubtotal}</span><span className="font-semibold">{fmt(locale, estimate)}</span></div>
            <p className="text-[11px] text-slate-400">{dict.pos.estimatedTheFinalTotalWith}</p>
          </div>

          {saleError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{saleError}</p> : null}
          <button
            type="button"
            className="btn-primary w-full py-3 text-base"
            disabled={cart.length === 0 || selling}
            onClick={completeSale}
          >
            {selling ? dict.pos.selling : dict.pos.completeSale}
          </button>
        </aside>
      </div>

      {/* AB4: camera scan overlay — stays open (debounced) so
          staff can scan a whole basket; tracks stop on close. */}
      {scanOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{dict.pos.scanBarcode}</h2>
              <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={closeScanner}>
                {dict.pos.close}</button>
            </div>
            <video ref={videoRef} className="aspect-[4/3] w-full rounded-xl bg-black object-cover" playsInline muted />
            {scanFeedback ? (
              <p className="rounded-lg bg-emerald-50 p-2.5 text-sm font-medium text-emerald-700">{scanFeedback}</p>
            ) : (
              <p className="text-sm text-slate-500">{dict.pos.holdTheBarcodeInFront}</p>
            )}
          </div>
        </div>
      ) : null}

      {/* POS Receipt Customizer Modal */}
      {receiptModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-800">{dict.pos.thermalReceiptCustomization}</h2>
                <p className="text-xs text-slate-500">{dict.pos.arrangeTheShopNameAddress}</p>
              </div>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                onClick={() => setReceiptModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="grid flex-1 gap-6 overflow-y-auto p-6 md:grid-cols-2">
              {/* Form Controls */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">{dict.pos.printerPaperSize}</label>
                  <div className="mt-1.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setReceiptSettings((s) => ({ ...s, paperWidth: "80mm" }))}
                      className={`flex-1 rounded-lg border py-2 text-xs font-semibold ${
                        receiptSettings.paperWidth === "80mm"
                          ? "border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {dict.pos.text9o2aum}</button>
                    <button
                      type="button"
                      onClick={() => setReceiptSettings((s) => ({ ...s, paperWidth: "58mm" }))}
                      className={`flex-1 rounded-lg border py-2 text-xs font-semibold ${
                        receiptSettings.paperWidth === "58mm"
                          ? "border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {dict.pos.text74ts1c}</button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">{dict.pos.shopBrandName}</label>
                  <input
                    type="text"
                    value={receiptSettings.storeName}
                    onChange={(e) => setReceiptSettings((s) => ({ ...s, storeName: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    placeholder={dict.pos.eGFashionGadgetsBD}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">{dict.pos.taglineSlogan}</label>
                  <input
                    type="text"
                    value={receiptSettings.tagline}
                    onChange={(e) => setReceiptSettings((s) => ({ ...s, tagline: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    placeholder={dict.pos.eGPremiumQualityAnd}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">{dict.pos.hotlineMobileNo}</label>
                    <input
                      type="text"
                      value={receiptSettings.phone}
                      onChange={(e) => setReceiptSettings((s) => ({ ...s, phone: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      placeholder="017XXXXXXXX"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">{dict.pos.addressOutletLocation}</label>
                    <input
                      type="text"
                      value={receiptSettings.address}
                      onChange={(e) => setReceiptSettings((s) => ({ ...s, address: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      placeholder={dict.pos.mirpur10Dhaka1216}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">{dict.pos.productReturnExchangePolicy}</label>
                  <textarea
                    rows={2}
                    value={receiptSettings.returnPolicy}
                    onChange={(e) => setReceiptSettings((s) => ({ ...s, returnPolicy: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    placeholder={dict.pos.exchangeableWithin7DaysOf}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">{dict.pos.footerGreetingMessage}</label>
                  <input
                    type="text"
                    value={receiptSettings.footerGreeting}
                    onChange={(e) => setReceiptSettings((s) => ({ ...s, footerGreeting: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    placeholder={dict.pos.thankYouForBeingWith}
                  />
                </div>

                <label className="flex items-center gap-2 pt-1 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={receiptSettings.showBarcode}
                    onChange={(e) => setReceiptSettings((s) => ({ ...s, showBarcode: e.target.checked }))}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  {dict.pos.printTheOrderSCode128}</label>
              </div>

              {/* Live Preview Column */}
              <div className="flex flex-col items-center justify-start rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
                <span className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {dict.pos.livePreview}{receiptSettings.paperWidth})
                </span>
                <div
                  className="rounded bg-white p-3 text-slate-900 shadow-md transition-all font-mono"
                  style={{ width: receiptSettings.paperWidth === "58mm" ? "220px" : "280px" }}
                >
                  <div className="border-b border-dashed border-slate-400 pb-2 text-center">
                    <div className="text-sm font-bold">{receiptSettings.storeName || dict.pos.shopName}</div>
                    {receiptSettings.tagline ? <div className="text-[10px] text-slate-500">{receiptSettings.tagline}</div> : null}
                    {receiptSettings.address ? <div className="text-[10px] text-slate-600">{receiptSettings.address}</div> : null}
                    {receiptSettings.phone ? <div className="text-[10px] text-slate-600">{dict.pos.phone}{receiptSettings.phone}</div> : null}
                    <div className="mt-1 text-[10px] text-slate-500">{dict.pos.receiptNoPOSSAMPLE2026}</div>
                  </div>

                  <div className="my-2 space-y-1 text-[11px]">
                    <div className="flex justify-between">
                      <span>{dict.pos.cottonPoloShirt1}</span>
                      <span>{dict.pos.textp8oucj}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{dict.pos.casualJeans1}</span>
                      <span>{dict.pos.text1hiiq1q}</span>
                    </div>
                  </div>

                  <div className="border-t border-dashed border-slate-400 pt-1.5 text-[11px] space-y-0.5">
                    <div className="flex justify-between"><span>{dict.pos.subtotal}</span><span>{dict.pos.textcbvcw0}</span></div>
                    <div className="flex justify-between"><span>{dict.pos.discount}</span><span>{dict.pos.text20o13m}</span></div>
                    <div className="flex justify-between font-bold border-t border-dashed pt-1">
                      <span>{dict.pos.grandTotal}</span><span>{dict.pos.textbs2rj0}</span>
                    </div>
                    <div className="flex justify-between"><span>{dict.pos.paidCash}</span><span>{dict.pos.textbs2rj0}</span></div>
                  </div>

                  {receiptSettings.returnPolicy ? (
                    <div className="mt-2 border-t border-dotted border-slate-300 pt-1.5 text-center text-[9px] text-slate-500">
                      {receiptSettings.returnPolicy}
                    </div>
                  ) : null}

                  {receiptSettings.showBarcode ? (
                    <div className="mt-2 flex flex-col items-center border-t border-dashed border-slate-300 pt-1">
                      <div
                        className="[&>svg]:max-w-full [&>svg]:h-7"
                        dangerouslySetInnerHTML={{ __html: generateBarcodeSvg("POS-SAMPLE-2026", 28) }}
                      />
                      <span className="text-[9px] text-slate-500 font-mono">POS-SAMPLE-2026</span>
                    </div>
                  ) : null}

                  <div className="mt-2 border-t border-dashed border-slate-400 pt-1 text-center text-[10px] font-semibold">
                    {receiptSettings.footerGreeting}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t bg-slate-50 px-6 py-3.5">
              <div>
                {receiptSavedFeedback ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                    {dict.pos.settingsSavedSuccessfully}</span>
                ) : (
                  <span className="text-xs text-slate-500">{dict.pos.thisInformationWillApplyTo}</span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  onClick={() => setReceiptModalOpen(false)}
                >
                  {dict.pos.close}</button>
                <button
                  type="button"
                  className="btn-primary px-5 py-2 text-xs font-semibold"
                  onClick={() => handleSaveReceiptSettings(receiptSettings)}
                >
                  {dict.pos.save}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Barcode & Price Tag Label Printing Modal */}
      {barcodeModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-800">{dict.pos.barcodeStickerPriceTagPrinting}</h2>
                <p className="text-xs text-slate-500">{dict.pos.printOnASingleThermal}</p>
              </div>
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                onClick={() => setBarcodeModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="grid flex-1 gap-6 overflow-y-auto p-6 md:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">{dict.pos.printLayout}</label>
                  <div className="mt-1.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setBarcodeLayout("single_sticker"); if (barcodeQty > 24) setBarcodeQty(1); }}
                      className={`flex-1 rounded-lg border py-2 text-xs font-semibold ${
                        barcodeLayout === "single_sticker"
                          ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {dict.pos.singleThermalSticker5030mm}</button>
                    <button
                      type="button"
                      onClick={() => { setBarcodeLayout("a4_sheet_24"); setBarcodeQty(24); }}
                      className={`flex-1 rounded-lg border py-2 text-xs font-semibold ${
                        barcodeLayout === "a4_sheet_24"
                          ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {dict.pos.a4Sheet24Labels3}</button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">{dict.pos.productName}</label>
                  <input
                    type="text"
                    value={barcodeLabelData.productName}
                    onChange={(e) => setBarcodeLabelData((d) => ({ ...d, productName: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium"
                    placeholder={dict.pos.productName}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">{dict.pos.sKUBarcodeCode}</label>
                    <input
                      type="text"
                      value={barcodeLabelData.skuOrBarcode}
                      onChange={(e) => setBarcodeLabelData((d) => ({ ...d, skuOrBarcode: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                      placeholder={dict.pos.eGPRD1002}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">{dict.pos.price}</label>
                    <input
                      type="text"
                      value={barcodeLabelData.priceFormatted}
                      onChange={(e) => setBarcodeLabelData((d) => ({ ...d, priceFormatted: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"
                      placeholder={dict.pos.text1agmws}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">{dict.pos.numberOfLabelsQuantity}</label>
                  <div className="mt-1.5 flex items-center gap-2">
                    {[1, 6, 12, 24, 48].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setBarcodeQty(q)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                          barcodeQty === q
                            ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {q} {dict.pos.items}</button>
                    ))}
                    <input
                      type="number"
                      min="1"
                      max="240"
                      value={barcodeQty}
                      onChange={(e) => setBarcodeQty(Math.max(1, Number(e.target.value) || 1))}
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-center text-xs font-semibold"
                    />
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6">
                <span className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {dict.pos.stickerPreviewActualSizeScale}</span>
                <div className="flex flex-col items-center justify-between rounded-lg border-2 border-slate-800 bg-white p-3 text-center shadow-lg" style={{ width: "220px", height: "135px" }}>
                  <div className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                    {receiptSettings.storeName || dict.pos.ourShop}
                  </div>
                  <div className="text-xs font-bold text-slate-900 truncate w-full">
                    {barcodeLabelData.productName || dict.pos.product}
                  </div>
                  <div
                    className="w-full flex justify-center [&>svg]:max-w-[180px] [&>svg]:h-8"
                    dangerouslySetInnerHTML={{ __html: generateBarcodeSvg(barcodeLabelData.skuOrBarcode || "SAMPLE", 28) }}
                  />
                  <div className="text-[10px] font-mono tracking-widest text-slate-600">
                    {barcodeLabelData.skuOrBarcode || "SAMPLE"}
                  </div>
                  <div className="text-sm font-extrabold text-slate-900">
                    {dict.pos.price2}{barcodeLabelData.priceFormatted || dict.pos.text1ye}
                  </div>
                </div>
                <p className="mt-3 text-center text-xs text-slate-500">
                  {barcodeLayout === "single_sticker"
                    ? t("pos.textcfm04n", { barcodeQty: barcodeQty })
                    : t("pos.text1x0vx0p", { totalPages: calculateLabelGrid(barcodeQty).totalPages })}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between border-t bg-slate-50 px-6 py-3.5">
              <span className="text-xs text-slate-500">
                {dict.pos.printsDirectlyOnAnyStandard}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  onClick={() => setBarcodeModalOpen(false)}
                >
                  {dict.pos.close}</button>
                <button
                  type="button"
                  className="btn-primary flex items-center gap-1.5 px-5 py-2 text-xs font-semibold"
                  onClick={() => openBarcodePrint(
                    barcodeLabelData.productName,
                    barcodeLabelData.skuOrBarcode,
                    barcodeLabelData.priceFormatted,
                    barcodeQty,
                    barcodeLayout
                  )}
                >
                  {dict.pos.print}{barcodeQty}{dict.pos.labels}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Cash Drawer Reconciliation & Shift Close (Z-Report) Modal */}
      {zReportModalOpen ? (() => {
        const todayTotalSalesMinor = today?.totalSalesMinor ? BigInt(today.totalSalesMinor) : 0n;
        const openingFloatMinor = BigInt(Math.round((Number(openingFloat) || 0) * 100));
        const cashPayoutsMinor = BigInt(Math.round((Number(cashPayouts) || 0) * 100));
        const actualCashMinor = BigInt(Math.round((Number(actualCashCounted) || 0) * 100));

        const cashSalesFromOrders = (today?.orders ?? []).reduce((acc, o) => {
          return acc + BigInt(Number(o.totalMinor) - Number(o.dueMinor));
        }, 0n);

        const cashSalesMinor = cashSalesFromOrders > 0n ? cashSalesFromOrders : todayTotalSalesMinor;
        const digitalSalesMinor = todayTotalSalesMinor > cashSalesMinor ? todayTotalSalesMinor - cashSalesMinor : 0n;

        const reconciliation = calculateDrawerReconciliation({
          openingFloatMinor,
          cashSalesMinor,
          digitalSalesMinor,
          cashPayoutsMinor,
          actualCashCountedMinor: actualCashMinor,
        });

        const shiftSlipData = {
          shopName: receiptSettings.storeName || dict.pos.ourShop,
          cashierName,
          shiftStartTime,
          shiftEndTime: fmtTime(locale, new Date()),
          orderCount: today?.orderCount ?? 0,
          totalSalesMinor: todayTotalSalesMinor,
          reconciliation,
        };

        const zReportText = buildZReportText(shiftSlipData);

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b px-6 py-4">
                <div>
                  <h2 className="text-base font-bold text-slate-800">{dict.pos.cashDrawerReconciliationShiftClose}</h2>
                  <p className="text-xs text-slate-500">{dict.pos.reconcileTheCounterSOpening}</p>
                </div>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  onClick={() => setZReportModalOpen(false)}
                >
                  ✕
                </button>
              </div>

              <div className="grid flex-1 gap-6 overflow-y-auto p-6 md:grid-cols-2">
                <div className="space-y-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">{dict.pos.cashierName}</label>
                      <input
                        type="text"
                        value={cashierName}
                        onChange={(e) => setCashierName(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">{dict.pos.shiftName}</label>
                      <input
                        type="text"
                        value={shiftName}
                        onChange={(e) => setShiftName(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">{dict.pos.openingCashFloat}</label>
                      <input
                        type="number"
                        min="0"
                        value={openingFloat}
                        onChange={(e) => setOpeningFloat(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"
                        placeholder="2000"
                      />
                      <span className="text-[10px] text-slate-400">{dict.pos.theChangeMoneyKeptIn}</span>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">{dict.pos.cashExpensesVouchers}</label>
                      <input
                        type="number"
                        min="0"
                        value={cashPayouts}
                        onChange={(e) => setCashPayouts(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"
                        placeholder="0"
                      />
                      <span className="text-[10px] text-slate-400">{dict.pos.expensesPaidFromTheDrawer}</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      {dict.pos.actualCashCountedInHand}<span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={actualCashCounted}
                      onChange={(e) => setActualCashCounted(e.target.value)}
                      className="mt-1 w-full rounded-lg border-2 border-indigo-500 px-3 py-2.5 text-base font-bold text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder={dict.pos.countAndEnterTheTotal}
                      autoFocus
                    />
                    <span className="text-[10px] text-slate-500">{dict.pos.openTheDrawerPhysicallyCount}</span>
                  </div>

                  {/* Discrepancy Alert */}
                  <div
                    className={`rounded-xl border p-3.5 ${
                      reconciliation.status === "balanced"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : reconciliation.status === "over"
                        ? "border-blue-200 bg-blue-50 text-blue-800"
                        : "border-red-200 bg-red-50 text-red-800"
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold text-sm">
                      <span>{dict.pos.calculationResult}</span>
                      <span className="font-mono text-base">{reconciliation.discrepancyFormatted}</span>
                    </div>
                    <p className="mt-1 text-xs font-medium">{reconciliation.summaryBangla}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-200/60 pt-2 text-xs">
                      <div>
                        {dict.pos.expectedCash}<strong>{dict.pos.text1yr}{(Number(reconciliation.expectedCashInDrawerMinor) / 100).toFixed(2)}</strong>
                      </div>
                      <div>
                        {dict.pos.cashCountedInHand}<strong>{dict.pos.text1yr}{(Number(reconciliation.actualCashCountedMinor) / 100).toFixed(2)}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Thermal Z-Report Slip Preview */}
                <div className="flex flex-col items-center justify-start rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
                  <span className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {dict.pos.textuakx2m}</span>
                  <div className="w-full max-w-[280px] rounded bg-white p-3 font-mono text-[11px] text-slate-800 shadow-md">
                    <pre className="whitespace-pre-wrap font-mono leading-tight">{zReportText}</pre>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t bg-slate-50 px-6 py-3.5">
                <span className="text-xs text-slate-500">
                  {dict.pos.atTheEndOfThe}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                    onClick={() => setZReportModalOpen(false)}
                  >
                    {dict.pos.close}</button>
                  <button
                    type="button"
                    className="btn-primary flex items-center gap-1.5 px-5 py-2 text-xs font-semibold"
                    onClick={() => openZReportPrint(zReportText)}
                  >
                    {dict.pos.printThermalZReportSlip}</button>
                </div>
              </div>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
