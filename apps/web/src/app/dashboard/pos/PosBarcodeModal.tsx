"use client";
import React from "react";
import {
  generateBarcodeSvg,
  type BarcodeLabelData,
} from "@/lib/pos-receipt";
import { useLocale } from "@/lib/i18n/provider";
import { dicts, getDict } from "@/lib/i18n/dict";
import { tr, type TrParams } from "@/lib/i18n/lookup";
import type { UiLocale } from "@repo/contracts";

export interface PosBarcodeModalProps {
  open: boolean;
  onClose: () => void;
  barcodeLabelData: BarcodeLabelData;
  setBarcodeLabelData: React.Dispatch<React.SetStateAction<BarcodeLabelData>>;
  barcodeLayout: "single_sticker" | "a4_sheet_24";
  setBarcodeLayout: React.Dispatch<React.SetStateAction<"single_sticker" | "a4_sheet_24">>;
  barcodeQty: number;
  setBarcodeQty: React.Dispatch<React.SetStateAction<number>>;
  storeName?: string | null;
}

export function openBarcodePrint(
  productName: string,
  skuOrBarcode: string,
  price: string,
  count: number,
  layout: "single_sticker" | "a4_sheet_24",
  storeName?: string | null,
  locale: UiLocale = "bn"
) {
  const dict = getDict(locale);
  const tt = (path: string, params?: TrParams) => tr(dicts, locale, path, params) ?? path;
  const svg = generateBarcodeSvg(skuOrBarcode || "12345678", 36);
  const w = window.open("", "_blank");
  if (!w) return;
  const itemsHtml = Array.from({ length: count })
    .map(() => {
      if (layout === "single_sticker") {
        return tt("pos.divClassStickerSingleDiv", { receiptSettings: storeName || dict.pos.ourShop, productName: productName, svg: svg, skuOrBarcode: skuOrBarcode, price: price });
      }
      return tt("pos.divClassStickerGridItem", { receiptSettings: storeName || dict.pos.ourShop, productName: productName, svg: svg, skuOrBarcode: skuOrBarcode, price: price });
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

  const html = tt("pos.dOCTYPEHtmlHtmlHeadMeta", { productName: productName, pageCss: pageCss, p2: layout === "a4_sheet_24" ? `<div class="grid-container">${itemsHtml}</div>` : itemsHtml });
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export function PosBarcodeModal({
  open,
  onClose,
  barcodeLabelData,
  setBarcodeLabelData,
  barcodeLayout,
  setBarcodeLayout,
  barcodeQty,
  setBarcodeQty,
  storeName,
}: PosBarcodeModalProps) {
  const { dict, locale } = useLocale();
  if (!open) return null;

  return (
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
            onClick={onClose}
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
                  {dict.pos.singleThermalSticker5030mm}
                </button>
                <button
                  type="button"
                  onClick={() => { setBarcodeLayout("a4_sheet_24"); setBarcodeQty(24); }}
                  className={`flex-1 rounded-lg border py-2 text-xs font-semibold ${
                    barcodeLayout === "a4_sheet_24"
                      ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {dict.pos.a4Sheet24Labels3}
                </button>
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
              <label className="block text-xs font-semibold text-slate-700">{dict.common.category} ({dict.common.optional})</label>
              <input
                type="text"
                value={barcodeLabelData.category || ""}
                onChange={(e) => setBarcodeLabelData((d) => ({ ...d, category: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder={dict.pos.categoryPlaceholder}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">{dict.pos.numberOfLabelsQuantity}</label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={barcodeQty}
                  onChange={(e) => setBarcodeQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-center"
                />
                <span className="text-xs text-slate-500">
                  {barcodeLayout === "a4_sheet_24" ? dict.pos.a4GridNote : dict.pos.stickerSuffix}
                </span>
              </div>
            </div>
          </div>

          {/* Barcode Sticker Preview */}
          <div className="flex flex-col items-center justify-start rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <span className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {dict.pos.stickerPreviewActualSizeScale}
            </span>
            <div className="flex flex-col items-center justify-between rounded-lg border border-slate-300 bg-white p-3 text-center shadow-md" style={{ width: "220px", minHeight: "135px" }}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {storeName || dict.pos.ourShop}
              </div>
              <div className="text-xs font-bold text-slate-900 truncate max-w-full">
                {barcodeLabelData.productName || dict.pos.product}
              </div>
              <div
                className="my-1.5 [&>svg]:max-w-full [&>svg]:h-9"
                dangerouslySetInnerHTML={{ __html: generateBarcodeSvg(barcodeLabelData.skuOrBarcode || "12345678", 36) }}
              />
              <div className="text-[10px] font-mono text-slate-500">
                {barcodeLabelData.skuOrBarcode || "12345678"}
              </div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">
                {dict.pos.text1yr}{barcodeLabelData.priceFormatted || dict.pos.text1ye}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t bg-slate-50 px-6 py-3.5">
          <span className="text-xs text-slate-500">
            {dict.pos.printsDirectlyOnAnyStandard}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              onClick={onClose}
            >
              {dict.pos.close}
            </button>
            <button
              type="button"
              className="btn-primary flex items-center gap-1.5 px-5 py-2 text-xs font-semibold"
              onClick={() => openBarcodePrint(
                barcodeLabelData.productName,
                barcodeLabelData.skuOrBarcode,
                barcodeLabelData.priceFormatted,
                barcodeQty,
                barcodeLayout,
                storeName,
                locale
              )}
            >
              {dict.pos.print}{barcodeQty}{dict.pos.labels}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
