"use client";
import React from "react";
import {
  generateBarcodeSvg,
  type ReceiptCustomizationSettings,
} from "@/lib/pos-receipt";
import { useLocale } from "@/lib/i18n/provider";

export interface PosReceiptModalProps {
  open: boolean;
  onClose: () => void;
  receiptSettings: ReceiptCustomizationSettings;
  setReceiptSettings: React.Dispatch<React.SetStateAction<ReceiptCustomizationSettings>>;
  onSave: (settings: ReceiptCustomizationSettings) => void;
  savedFeedback: boolean;
}

export function PosReceiptModal({
  open,
  onClose,
  receiptSettings,
  setReceiptSettings,
  onSave,
  savedFeedback,
}: PosReceiptModalProps) {
  const { dict } = useLocale();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">{dict.pos.thermalReceiptCustomization}</h2>
            <p className="text-xs text-slate-500">{dict.pos.arrangeTheShopNameAddress}</p>
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
                  {dict.pos.text9o2aum}
                </button>
                <button
                  type="button"
                  onClick={() => setReceiptSettings((s) => ({ ...s, paperWidth: "58mm" }))}
                  className={`flex-1 rounded-lg border py-2 text-xs font-semibold ${
                    receiptSettings.paperWidth === "58mm"
                      ? "border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {dict.pos.text74ts1c}
                </button>
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
              {dict.pos.printTheOrderSCode128}
            </label>
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
            {savedFeedback ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                {dict.pos.settingsSavedSuccessfully}
              </span>
            ) : (
              <span className="text-xs text-slate-500">{dict.pos.thisInformationWillApplyTo}</span>
            )}
          </div>
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
              className="btn-primary px-5 py-2 text-xs font-semibold"
              onClick={() => onSave(receiptSettings)}
            >
              {dict.pos.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
