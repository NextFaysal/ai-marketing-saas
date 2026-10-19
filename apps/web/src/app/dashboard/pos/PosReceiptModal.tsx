"use client";
import React from "react";
import {
  generateBarcodeSvg,
  type ReceiptCustomizationSettings,
} from "@/lib/pos-receipt";

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
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">🧾 POS থার্মাল রসিদ কাস্টমাইজেশন</h2>
            <p className="text-xs text-slate-500">আপনার ব্র্যান্ড অনুযায়ী মেমোর হেডার, ফুটার, পলিসি এবং বারকোড সেট করুন</p>
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
              <label className="block text-xs font-semibold text-slate-700">প্রিন্টার পেপার সাইজ</label>
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
                  ৮০ মিমি (80mm - স্ট্যান্ডার্ড POS)
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
                  ৫৮ মিমি (58mm - পোর্টেবল/ব্লুটুথ)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">দোকান / ব্র্যান্ডের নাম</label>
              <input
                type="text"
                value={receiptSettings.storeName}
                onChange={(e) => setReceiptSettings((s) => ({ ...s, storeName: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="যেমন: ফ্যাশন গ্যাজেটস বিডি"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">ট্যাগলাইন (স্লোগান)</label>
              <input
                type="text"
                value={receiptSettings.tagline}
                onChange={(e) => setReceiptSettings((s) => ({ ...s, tagline: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="যেমন: প্রিমিয়াম কোয়ালিটি ও নির্ভরযোগ্য সেবা"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700">হটলাইন / মোবাইল নং</label>
                <input
                  type="text"
                  value={receiptSettings.phone}
                  onChange={(e) => setReceiptSettings((s) => ({ ...s, phone: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="017XXXXXXXX"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700">ঠিকানা / আউটলেট লোকেশন</label>
                <input
                  type="text"
                  value={receiptSettings.address}
                  onChange={(e) => setReceiptSettings((s) => ({ ...s, address: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="মিরপুর-১০, ঢাকা-১২১৬"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">পণ্য ফেরত / এক্সচেঞ্জ পলিসি</label>
              <textarea
                rows={2}
                value={receiptSettings.returnPolicy}
                onChange={(e) => setReceiptSettings((s) => ({ ...s, returnPolicy: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                placeholder="পণ্য ক্রয়ের ৭ দিনের মধ্যে মেমোসহ পরিবর্তনযোগ্য..."
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">ফুটার শুভেচ্ছা বার্তা</label>
              <input
                type="text"
                value={receiptSettings.footerGreeting}
                onChange={(e) => setReceiptSettings((s) => ({ ...s, footerGreeting: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="আমাদের সাথে থাকার জন্য ধন্যবাদ! আবার আসবেন 🙏"
              />
            </div>

            <label className="flex items-center gap-2 pt-1 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={receiptSettings.showBarcode}
                onChange={(e) => setReceiptSettings((s) => ({ ...s, showBarcode: e.target.checked }))}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              রসিদের নিচে অর্ডারের Code128 বারকোড প্রিন্ট করুন
            </label>
          </div>

          {/* Live Preview Column */}
          <div className="flex flex-col items-center justify-start rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <span className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              লাইভ প্রিভিউ ({receiptSettings.paperWidth})
            </span>
            <div
              className="rounded bg-white p-3 text-slate-900 shadow-md transition-all font-mono"
              style={{ width: receiptSettings.paperWidth === "58mm" ? "220px" : "280px" }}
            >
              <div className="border-b border-dashed border-slate-400 pb-2 text-center">
                <div className="text-sm font-bold">{receiptSettings.storeName || "দোকানের নাম"}</div>
                {receiptSettings.tagline ? <div className="text-[10px] text-slate-500">{receiptSettings.tagline}</div> : null}
                {receiptSettings.address ? <div className="text-[10px] text-slate-600">{receiptSettings.address}</div> : null}
                {receiptSettings.phone ? <div className="text-[10px] text-slate-600">ফোন: {receiptSettings.phone}</div> : null}
                <div className="mt-1 text-[10px] text-slate-500">রসিদ নং: POS-SAMPLE-2026</div>
              </div>

              <div className="my-2 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span>কটন পোলো শার্ট × ১</span>
                  <span>৳১,২৫০.০০</span>
                </div>
                <div className="flex justify-between">
                  <span>ক্যাজুয়াল জিন্স × ১</span>
                  <span>৳২,১০০.০০</span>
                </div>
              </div>

              <div className="border-t border-dashed border-slate-400 pt-1.5 text-[11px] space-y-0.5">
                <div className="flex justify-between"><span>সাবটোটাল</span><span>৳৩,৩৫০.০০</span></div>
                <div className="flex justify-between"><span>ছাড়</span><span>-৳১৫০.০০</span></div>
                <div className="flex justify-between font-bold border-t border-dashed pt-1">
                  <span>সর্বমোট</span><span>৳৩,২০০.০০</span>
                </div>
                <div className="flex justify-between"><span>পরিশোধিত (নগদ)</span><span>৳৩,২০০.০০</span></div>
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
                ✓ সেটিংস সফলভাবে সংরক্ষিত হয়েছে!
              </span>
            ) : (
              <span className="text-xs text-slate-500">সব কাউন্টার সেলস ও ইনভয়েস প্রিন্টে এই তথ্য প্রযোজ্য হবে</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              onClick={onClose}
            >
              বন্ধ করুন
            </button>
            <button
              type="button"
              className="btn-primary px-5 py-2 text-xs font-semibold"
              onClick={() => onSave(receiptSettings)}
            >
              💾 সংরক্ষণ করুন
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
