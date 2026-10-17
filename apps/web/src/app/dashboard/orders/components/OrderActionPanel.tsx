"use client";
import React from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { ResponsiveTable } from "@repo/ui";
import { FRAUD_BAND_LABEL, codCallOutcomeLabel } from "@/lib/orders-on4";
import { minorToTaka, takaToMinor } from "@/lib/orders-on1";
import { refundToCreditOffered } from "@/lib/membership";
import { networkSignalBody, networkSignalHeading } from "@/lib/fraud-network-nf13";
import { surgeryAvailability, surgeryMoneySummary, type DraftLine, type PreviewResult } from "@/lib/orders-on3";
import { deliveryCoverageCaption, marginTone, overpaidMinorOf, type OrderProfit } from "@/lib/orders-on7";
import { OrderAllocationsSection, OrderDetailOn2, type MemberRow } from "../on2-detail";
import { CodCallChips } from "./CodCallChips";
import { PATCH_STATUSES, transitionAllowed, type DeliveryAssignmentRow, type InstallmentItemRow, type InstallmentPlan, type PanelOrder, type ProductPick, type ProductVariantPick, type PushState, type ReviewRow, type RiderRow } from "./types";

export interface OrderActionPanelProps {
  actOrder: PanelOrder;
  surgery: boolean;
  actNotice: string;
  surgeryNotice: string;
  overpaidNotice: string;
  surgeryError: string;
  fraudNotice: string;
  fraudBusy: string;
  codBusy: string;
  actStatus: string;
  setActStatus: React.Dispatch<React.SetStateAction<string>>;
  actRefundTaka: string;
  setActRefundTaka: React.Dispatch<React.SetStateAction<string>>;
  actRefundReason: string;
  setActRefundReason: React.Dispatch<React.SetStateAction<string>>;
  actNote: string;
  setActNote: React.Dispatch<React.SetStateAction<string>>;
  actBusy: string;
  members: MemberRow[];
  setActOrder: React.Dispatch<React.SetStateAction<PanelOrder | null>>;
  setItems: React.Dispatch<React.SetStateAction<PanelOrder[]>>;
  drafts: DraftLine[];
  setDrafts: React.Dispatch<React.SetStateAction<DraftLine[]>>;
  draftErrors: string[];
  recalcDelivery: boolean;
  setRecalcDelivery: React.Dispatch<React.SetStateAction<boolean>>;
  preview: PreviewResult | null;
  previewBusy: boolean;
  previewError: string;
  surgeryBusy: boolean;
  pickQuery: string;
  setPickQuery: React.Dispatch<React.SetStateAction<string>>;
  pickResults: ProductPick[];
  pickBusy: boolean;
  pendingProduct: (ProductPick & { variants: ProductVariantPick[] }) | null;
  setPendingProduct: React.Dispatch<React.SetStateAction<(ProductPick & { variants: ProductVariantPick[] }) | null>>;
  pushState: PushState | null;
  pushStateError: string;
  storeNoteText: string;
  setStoreNoteText: React.Dispatch<React.SetStateAction<string>>;
  syncBusy: string;
  syncNotice: string;
  syncError: string;
  returnUrl: string;
  copiedKey: string;
  advAmount: string;
  setAdvAmount: React.Dispatch<React.SetStateAction<string>>;
  advMethod: string;
  setAdvMethod: React.Dispatch<React.SetStateAction<string>>;
  advRef: string;
  setAdvRef: React.Dispatch<React.SetStateAction<string>>;
  advNote: string;
  setAdvNote: React.Dispatch<React.SetStateAction<string>>;
  advBusy: boolean;
  advError: string;
  advNotice: string;
  instPlan: InstallmentPlan | null;
  instLoaded: boolean;
  instError: string;
  instBusy: string;
  instCount: string;
  setInstCount: React.Dispatch<React.SetStateAction<string>>;
  instInterval: string;
  setInstInterval: React.Dispatch<React.SetStateAction<string>>;
  instStart: string;
  setInstStart: React.Dispatch<React.SetStateAction<string>>;
  instNote: string;
  setInstNote: React.Dispatch<React.SetStateAction<string>>;
  collectForms: Record<string, { amount: string; method: string; reference: string; note: string }>;
  setCollectForms: React.Dispatch<React.SetStateAction<Record<string, { amount: string; method: string; reference: string; note: string }>>>;
  profit: OrderProfit | null;
  profitError: string;
  orderAssignments: DeliveryAssignmentRow[];
  riders: RiderRow[];
  assignRiderId: string;
  setAssignRiderId: React.Dispatch<React.SetStateAction<string>>;
  riderBusy: string;
  enterSurgery: () => void;
  exitSurgery: () => void;
  releaseFraud: (o: PanelOrder) => Promise<void>;
  openFraudDetail: (o: PanelOrder) => void;
  recordCodCall: (o: PanelOrder, outcome: string) => Promise<void>;
  saveStatus: () => Promise<void>;
  saveRefund: () => Promise<void>;
  saveNote: () => Promise<void>;
  clearNote: () => Promise<void>;
  patchDraft: (idx: number, patch: Partial<DraftLine>) => void;
  patchDraftPrice: (idx: number, takaText: string) => void;
  searchProducts: () => Promise<void>;
  chooseProduct: (p: ProductPick) => Promise<void>;
  addProductDraft: (p: ProductPick, v?: ProductVariantPick) => void;
  saveSurgery: () => Promise<void>;
  openSplit: () => void;
  sendStoreNote: () => Promise<void>;
  createStoreDraft: () => Promise<void>;
  createReturnLink: () => Promise<void>;
  copyText: (key: string, text: string) => Promise<void>;
  recordAdvance: () => Promise<void>;
  createInstPlan: () => Promise<void>;
  collectInstItem: (item: InstallmentItemRow) => Promise<void>;
  cancelInstPlan: () => Promise<void>;
  assignRider: () => Promise<void>;
  transitionAssignment: (a: DeliveryAssignmentRow, status: string) => Promise<void>;
  openOrderById: (orderId: string) => Promise<void>;
  fmtM: (minor?: string | null) => string;
  reviewForOrder: (orderId: string) => ReviewRow | null;
  reviewStatusBn: (r: ReviewRow) => string;
  stars: (n: number) => string;
}

export function OrderActionPanel({ actOrder, surgery, actNotice, surgeryNotice, overpaidNotice, surgeryError, fraudNotice, fraudBusy, codBusy, actStatus, setActStatus, actRefundTaka, setActRefundTaka, actRefundReason, setActRefundReason, actNote, setActNote, actBusy, members, setActOrder, setItems, drafts, setDrafts, draftErrors, recalcDelivery, setRecalcDelivery, preview, previewBusy, previewError, surgeryBusy, pickQuery, setPickQuery, pickResults, pickBusy, pendingProduct, setPendingProduct, pushState, pushStateError, storeNoteText, setStoreNoteText, syncBusy, syncNotice, syncError, returnUrl, copiedKey, advAmount, setAdvAmount, advMethod, setAdvMethod, advRef, setAdvRef, advNote, setAdvNote, advBusy, advError, advNotice, instPlan, instLoaded, instError, instBusy, instCount, setInstCount, instInterval, setInstInterval, instStart, setInstStart, instNote, setInstNote, collectForms, setCollectForms, profit, profitError, orderAssignments, riders, assignRiderId, setAssignRiderId, riderBusy, enterSurgery, exitSurgery, releaseFraud, openFraudDetail, recordCodCall, saveStatus, saveRefund, saveNote, clearNote, patchDraft, patchDraftPrice, searchProducts, chooseProduct, addProductDraft, saveSurgery, openSplit, sendStoreNote, createStoreDraft, createReturnLink, copyText, recordAdvance, createInstPlan, collectInstItem, cancelInstPlan, assignRider, transitionAssignment, openOrderById, fmtM, reviewForOrder, reviewStatusBn, stars }: OrderActionPanelProps) {
  const o = actOrder;
  const refunded = BigInt(o.refundedMinor ?? "0");
  const totalAmt = BigInt(o.totalMinor);
  // NF7 (FB3): refund-to-store-credit — local panel state. The
  // whole block below renders ONLY when pushState says the
  // per-store setting is ON (default OFF — then the option
  // does not exist in this UI at all, and the API refuses it
  // too). The refundKey is minted once per panel open so a
  // retried submit replays the SAME refund server-side.
  const [creditTaka, setCreditTaka] = React.useState("");
  const [creditBusy, setCreditBusy] = React.useState(false);
  const [creditNotice, setCreditNotice] = React.useState("");
  const [creditError, setCreditError] = React.useState("");
  const [creditKey] = React.useState(() => `ui-${o.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  async function refundToCredit() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const minor = (() => { try { return takaToMinor(creditTaka.trim()); } catch { return null; } })();
    if (!minor) { setCreditError("সঠিক পরিমাণ (টাকায়) দিন।"); return; }
    setCreditBusy(true); setCreditError(""); setCreditNotice("");
    try {
      const out = await apiFetch<{ balanceMinor: string; replayed: boolean }>(`/organizations/${orgId}/orders/${o.id}/refund-to-credit`, {
        method: "POST",
        body: JSON.stringify({ amountMinor: minor, refundKey: creditKey, note: actRefundReason.trim() || undefined }),
      });
      setCreditNotice(out.replayed
        ? "এই রিফান্ডটি আগেই ক্রেডিটে দেওয়া হয়েছে — দ্বিতীয়বার যোগ হয়নি।"
        : `ক্রেডিটে রিফান্ড সম্পন্ন — কাস্টমারের ক্রেডিট ব্যালেন্স এখন ${formatMinor(BigInt(out.balanceMinor))}।`);
      setCreditTaka("");
    } catch (e) {
      setCreditError(e instanceof Error ? e.message : "ক্রেডিটে রিফান্ড ব্যর্থ");
    } finally { setCreditBusy(false); }
  }
  // EB6/ED15: the installment collect cell is shared verbatim by the
  // desktop table and the ResponsiveTable mobile card — same handlers,
  // same order (products-page row-action discipline).
  const renderInstCollect = (item: InstallmentItemRow) => {
    const remaining = (() => { try { return BigInt(item.remainingMinor); } catch { return 0n; } })();
    const form = collectForms[item.id];
    return remaining > 0n && form ? (
      <div className="flex flex-wrap items-center gap-1.5">
        <input className="input w-24" placeholder="টাকা" aria-label="সংগ্রহের পরিমাণ (টাকা)" inputMode="decimal" value={form.amount} onChange={(e) => setCollectForms((prev) => ({ ...prev, [item.id]: { ...form, amount: e.target.value } }))} />
        <select className="input w-auto" aria-label="সংগ্রহের মাধ্যম" value={form.method} onChange={(e) => setCollectForms((prev) => ({ ...prev, [item.id]: { ...form, method: e.target.value } }))}>
          <option value="bkash">বিকাশ</option>
          <option value="nagad">নগদ</option>
          <option value="rocket">রকেট</option>
          <option value="cash">ক্যাশ</option>
          <option value="bank">ব্যাংক</option>
          <option value="other">অন্যান্য</option>
        </select>
        <input className="input w-32" placeholder="রেফারেন্স (ঐচ্ছিক)" aria-label="রেফারেন্স (ঐচ্ছিক)" value={form.reference} onChange={(e) => setCollectForms((prev) => ({ ...prev, [item.id]: { ...form, reference: e.target.value } }))} />
        <input className="input w-32" placeholder="নোট (ঐচ্ছিক)" aria-label="নোট (ঐচ্ছিক)" value={form.note} onChange={(e) => setCollectForms((prev) => ({ ...prev, [item.id]: { ...form, note: e.target.value } }))} />
        <button className="btn-primary btn-sm" disabled={instBusy !== "" || form.amount.trim() === ""} onClick={() => collectInstItem(item)}>
          {instBusy === `collect-${item.id}` ? "হচ্ছে..." : "সংগ্রহ করুন"}
        </button>
      </div>
    ) : <span className="text-slate-400">—</span>;
  };
  return (
                <tr className="border-t bg-slate-50"><td colSpan={13} className="px-4 py-3">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">⚙️ অর্ডার অ্যাকশন — #{o.externalNumber ?? o.id.slice(0, 8)}</h3>
                      <span className="flex items-center gap-2">
                        <Link href={`/dashboard/orders/${o.id}`} className="text-xs font-semibold text-brand-600 hover:underline">সম্পূর্ণ বিবরণ →</Link>
                        {/* ON3: surgery toggle — offered only for
                            pending / on-hold / processing orders
                            the server could accept; store-source
                            orders get the reason as a title note
                            instead of a dead button. */}
                        {(() => { const av = surgeryAvailability(o); return av.allowed ? (
                          <button type="button" className={surgery ? "btn-secondary btn-sm" : "btn-primary btn-sm"} onClick={() => (surgery ? exitSurgery() : enterSurgery())}>
                            {surgery ? "সম্পাদনা বন্ধ করুন" : "✏️ সম্পাদনা"}
                          </button>
                        ) : (o.source === "woocommerce" || o.source === "shopify") && ["pending", "on-hold", "processing"].includes(o.status) ? (
                          <span className="text-[11px] text-slate-500" title={av.note}>✏️ সম্পাদনা — {av.note}</span>
                        ) : null; })()}
                        <button className="btn-ghost btn-sm" onClick={() => setActOrder(null)}>বন্ধ করুন</button>
                      </span>
                    </div>
                    {actNotice ? <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">{actNotice}</p> : null}
                    {surgeryNotice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{surgeryNotice}</p> : null}
                    {overpaidNotice ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">⚠️ {overpaidNotice}</p> : null}
                    {!surgery && surgeryError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{surgeryError}</p> : null}
                    {/* ON4: review-hold banner — a held order says
                        so loudly, with its reason and a release
                        action, before anything else in the panel. */}
                    {o.reviewHold ? (
                      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5">
                        <span className="text-sm font-bold text-rose-800">⛔ পর্যালোচনার জন্য আটকানো আছে</span>
                        {o.reviewHoldReason ? <span className="text-sm text-rose-700">কারণ: {o.reviewHoldReason}</span> : null}
                        {o.reviewHeldAt ? <span className="text-xs text-rose-500">আটকানো হয়েছে: {new Date(o.reviewHeldAt).toLocaleString("bn-BD")}</span> : null}
                        <button type="button" className="btn-primary btn-sm ml-auto" disabled={fraudBusy !== ""} onClick={() => void releaseFraud(o)}>
                          {fraudBusy === "release" ? "ছাড় হচ্ছে…" : "ছাড় দিন"}
                        </button>
                        {fraudNotice ? <span className="w-full text-xs text-indigo-700">{fraudNotice}</span> : null}
                      </div>
                    ) : null}
                    {/* ON4: fraud summary + COD call recording for
                        COD orders still awaiting confirmation. */}
                    {(o.riskBand || (o.codCallAttempts ?? 0) > 0 || (o.isCod && o.codConfirmationStatus === "awaiting") || (o.networkSignal && networkSignalBody(o.networkSignal))) ? (
                      <div className="space-y-2 rounded-xl border bg-white p-3">
                        <h4 className="text-sm font-semibold">🛡️ জালিয়াতি ও COD নিশ্চিতকরণ</h4>
                        {o.riskBand ? (
                          <p className="flex flex-wrap items-center gap-2 text-sm">
                            <button type="button" className={`rounded px-2 py-0.5 text-[11px] font-semibold ${FRAUD_BAND_LABEL[o.riskBand]?.cls ?? ""}`}
                              title="জালিয়াতি ঝুঁকি (Fraud Shield)" onClick={() => openFraudDetail(o)}>
                              🛡️ {FRAUD_BAND_LABEL[o.riskBand]?.text ?? o.riskBand}{o.riskScore != null ? ` · ${o.riskScore}` : ""}
                            </button>
                            <span className="text-xs text-slate-500">চিপে ক্লিক করলে কারণসহ বিস্তারিত ও আটকানো/ছাড়ের অ্যাকশন পাবেন।</span>
                          </p>
                        ) : <p className="text-xs text-slate-500">এই অর্ডারের জালিয়াতি ঝুঁকি এখনো যাচাই হয়নি।</p>}
                        {/* NF13: network sibling signal — only when
                            present (opted-in orgs), labelled as
                            combined multi-shop data. */}
                        {o.networkSignal && networkSignalBody(o.networkSignal) ? (
                          <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-2.5 py-2">
                            <p className="text-xs font-semibold text-indigo-900">{networkSignalHeading(o.networkSignal)}</p>
                            <p className="text-xs text-slate-700">{networkSignalBody(o.networkSignal)}</p>
                            <p className="text-[11px] text-slate-500">এটি এই দোকানের নিজের স্কোর নয় — সব দোকানের সম্মিলিত তথ্য।</p>
                          </div>
                        ) : null}
                        {o.isCod && o.codConfirmationStatus === "awaiting" ? (
                          <CodCallChips order={o} busy={codBusy === o.id} onCall={(ord, outcome) => void recordCodCall(ord, outcome)} />
                        ) : (o.codCallAttempts ?? 0) > 0 ? (
                          <p className="text-[11px] text-slate-500">কল: {o.codCallAttempts}বার{o.codLastCallOutcome ? ` · সর্বশেষ: ${codCallOutcomeLabel(o.codLastCallOutcome)}` : ""}{o.codLastCallAt ? ` · ${new Date(o.codLastCallAt).toLocaleString("bn-BD")}` : ""}</p>
                        ) : null}
                      </div>
                    ) : null}
                    {/* ON2: Timeline 360 + Customer 360 + assignee +
                        tags + internal comments (on2-detail.tsx). */}
                    <OrderDetailOn2
                      orderId={o.id}
                      orderLabel={`#${o.externalNumber ?? o.id.slice(0, 8)}`}
                      assigneeId={o.assigneeId ?? null}
                      tags={o.tags ?? null}
                      members={members}
                      onPatch={(patch) => {
                        setActOrder((prev) => (prev && prev.id === o.id ? { ...prev, ...patch } : prev));
                        setItems((prev) => prev.map((x) => (x.id === o.id ? { ...x, ...patch } : x)));
                      }}
                      onOpenOrder={(id) => void openOrderById(id)}
                    />
                    {/* AB3: per-item stock allocations + staff
                        re-allocation (warehouse picker). The
                        reallocate response rows carry no labels,
                        so a successful move refetches the detail. */}
                    {/* AB4 (AX5): custom checkout-field answers
                        (labels resolved via checkoutFieldDefs, key
                        fallback) + the order's deposit block. */}
                    {((o.checkoutFields && Object.keys(o.checkoutFields).length > 0) || o.deposit) ? (
                      <div className="space-y-3 rounded-xl border bg-white p-3">
                        {o.checkoutFields && Object.keys(o.checkoutFields).length > 0 ? (
                          <div className="space-y-1.5">
                            <h4 className="text-sm font-semibold">📝 চেকআউট ফিল্ড — ক্রেতার দেওয়া উত্তর</h4>
                            {Object.entries(o.checkoutFields).map(([key, value]) => {
                              const label = (o.checkoutFieldDefs ?? []).find((d) => d.key === key)?.label ?? key;
                              const display = value === true ? "হ্যাঁ" : value === false ? "না" : String(value);
                              return (
                                <p key={key} className="flex flex-wrap justify-between gap-2 text-sm">
                                  <span className="text-slate-500">{label}</span>
                                  <span className="font-medium text-slate-800">{display}</span>
                                </p>
                              );
                            })}
                          </div>
                        ) : null}
                        {o.deposit ? (
                          <div className={`space-y-1 text-sm ${o.checkoutFields && Object.keys(o.checkoutFields).length > 0 ? "border-t pt-2" : ""}`}>
                            <h4 className="font-semibold">💰 ডিপোজিট</h4>
                            <p className="flex flex-wrap gap-x-4">
                              <span>মোট ডিপোজিট: <b>{fmtM(o.deposit.dueMinor)}</b></span>
                              <span>পরিশোধিত: <b className="text-emerald-700">{fmtM(o.deposit.paidMinor)}</b></span>
                              <span>বাকি: <b className={o.deposit.outstandingMinor !== "0" ? "text-amber-700" : "text-emerald-700"}>{fmtM(o.deposit.outstandingMinor)}</b></span>
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <OrderAllocationsSection
                      orderId={o.id}
                      allocations={o.allocations ?? null}
                      items={o.items ?? null}
                      onRefresh={async () => {
                        const orgId = getOrganizationId(); if (!orgId) return;
                        try {
                          const detail = await apiFetch<PanelOrder>(`/organizations/${orgId}/orders/${o.id}`);
                          if (detail) setActOrder((prev) => (prev && prev.id === detail.id ? { ...prev, ...detail } : prev));
                        } catch { /* the section already showed its success notice */ }
                      }}
                    />
                    <div className="grid gap-4 lg:grid-cols-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">স্ট্যাটাস</label>
                        <select className="input" value={actStatus} onChange={(e) => setActStatus(e.target.value)}>
                          {!PATCH_STATUSES.includes(o.status) ? <option value={o.status}>{o.status} (বর্তমান)</option> : null}
                          {PATCH_STATUSES.map((s) => (
                            <option key={s} value={s} disabled={!transitionAllowed(o.status, s)}>
                              {s}{s === o.status ? " (বর্তমান)" : ""}{!transitionAllowed(o.status, s) ? " — যাওয়া যাবে না" : ""}
                            </option>
                          ))}
                        </select>
                        <button className="btn-primary btn-sm" disabled={actBusy !== "" || actStatus === o.status} onClick={saveStatus}>স্ট্যাটাস সংরক্ষণ</button>
                        <p className="text-xs text-slate-500">Cancelled/Failed হলে স্টক ফেরত যোগ হয়, Returned হলেও তাই; Completed হলে order.delivered ইভেন্ট যায়। যেসব স্ট্যাটাসে যাওয়া যাবে না সেগুলো নিষ্ক্রিয় — সার্ভারই চূড়ান্ত authority।</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Refund রেকর্ড (টাকায়)</label>
                        <input className="input" placeholder="পরিমাণ (টাকা, যেমন 250 বা 250.50)" value={actRefundTaka} onChange={(e) => setActRefundTaka(e.target.value)} />
                        <input className="input" placeholder="কারণ (ঐচ্ছিক)" value={actRefundReason} onChange={(e) => setActRefundReason(e.target.value)} />
                        <button className="btn-primary btn-sm" disabled={actBusy !== "" || actRefundTaka.trim() === ""} onClick={saveRefund}>Refund রেকর্ড করুন</button>
                        <p className="text-xs text-slate-500">মোট ফেরত: {formatMinor(refunded)} / {formatMinor(totalAmt)} · আরও ফেরতযোগ্য: {formatMinor(totalAmt - refunded)}</p>
                        <p className="text-xs text-slate-500">Refund শুধু টাকার হিসাব রাখে — স্টক ফেরত চাইলে স্ট্যাটাস Cancelled/Returned করুন। পুরো টাকা ফেরত হলে খোলা অর্ডার নিজে থেকেই refunded হয়ে যায়।</p>
                        {/* NF7 (FB3): refund-to-credit — rendered
                            ONLY when the per-store setting is ON
                            (pushState.refundToCreditEnabled,
                            computed server-side; default OFF ⇒
                            this block does not exist in the UI). */}
                        {refundToCreditOffered(pushState) ? (
                          <div className="space-y-2 border-t pt-2">
                            <label className="text-sm font-medium">স্টোর ক্রেডিটে Refund (টাকায়)</label>
                            <input className="input" placeholder="পরিমাণ (টাকা)" value={creditTaka} onChange={(e) => setCreditTaka(e.target.value)} />
                            <button className="btn-primary btn-sm" disabled={creditBusy || creditTaka.trim() === ""} onClick={() => void refundToCredit()}>
                              {creditBusy ? "হচ্ছে…" : "ক্রেডিটে রিফান্ড করুন"}
                            </button>
                            <p className="text-xs text-slate-500">টাকাটা নগদ ফেরত না গিয়ে কাস্টমারের স্টোর ক্রেডিট লেজারে জমা হবে — পরের অর্ডারে তিনি এটি খরচ করতে পারবেন। একই চেষ্টা আবার পাঠালে দ্বিতীয়বার যোগ হবে না।</p>
                            {creditNotice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{creditNotice}</p> : null}
                            {creditError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{creditError}</p> : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">অভ্যন্তরীণ নোট (শুধু টিমের জন্য)</label>
                        <textarea className="input" rows={3} maxLength={2000} placeholder="যেমন: কাস্টমার ফোনে ঠিকানা বদলেছেন…" value={actNote} onChange={(e) => setActNote(e.target.value)} />
                        <div className="flex gap-2">
                          <button className="btn-primary btn-sm" disabled={actBusy !== ""} onClick={saveNote}>নোট সংরক্ষণ</button>
                          <button className="btn-ghost btn-sm text-red-600" disabled={actBusy !== ""} onClick={clearNote}>নোট মুছুন</button>
                        </div>
                        <p className="text-xs text-slate-500">এই নোট কাস্টমার বা কোনো প্ল্যাটফর্মে যায় না।</p>
                      </div>
                    </div>
                    {/* EC18/EC19 (B8): delivery slot + payments / advances */}
                    <div className="space-y-3 rounded-xl border bg-white p-3">
                      <h4 className="text-sm font-semibold">💳 পেমেন্ট ও ডেলিভারি স্লট</h4>
                      {o.deliverySlot ? (
                        <p className="text-sm">🕐 ডেলিভারি স্লট: <b>{o.deliverySlot.label}</b>{o.deliverySlot.startTime && o.deliverySlot.endTime ? ` (${o.deliverySlot.startTime} – ${o.deliverySlot.endTime})` : ""} · তারিখ: <b>{o.deliverySlot.date}</b></p>
                      ) : (
                        <p className="text-xs text-slate-500">এই অর্ডারে কোনো ডেলিভারি স্লট বেছে নেওয়া হয়নি।</p>
                      )}
                      {o.deliveryMethod === "pickup" && o.pickupPoint ? (
                        <p className="text-sm">📍 পিকআপ: <b>{o.pickupPoint.name}</b> — {o.pickupPoint.address}, {o.pickupPoint.district}{o.pickupPoint.phone ? <> · ফোন: <span className="font-mono">{o.pickupPoint.phone}</span></> : null} · ফি: <b>{(() => { try { return formatMinor(BigInt(o.pickupPoint.feeMinor)); } catch { return o.pickupPoint.feeMinor; } })()}</b></p>
                      ) : null}
                      {o.advancePaidMinor !== undefined || o.amountDueMinor !== undefined ? (
                        <div className="flex flex-wrap gap-4 text-sm">
                          {o.advancePaidMinor !== undefined ? <span>অগ্রিম পরিশোধিত: <b className="text-emerald-700">{(() => { try { return formatMinor(BigInt(o.advancePaidMinor)); } catch { return o.advancePaidMinor; } })()}</b></span> : null}
                          {o.amountDueMinor !== undefined ? <span>বকেয়া: <b>{(() => { try { return formatMinor(BigInt(o.amountDueMinor)); } catch { return o.amountDueMinor; } })()}</b></span> : null}
                        </div>
                      ) : null}
                      {/* ON7: overpaid flag, computed client-side
                          from the order's own advance/total fields. */}
                      {(() => { const over = overpaidMinorOf(o.advancePaidMinor, o.totalMinor); return over ? (
                        <p><span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800" title="অগ্রিম পরিশোধ অর্ডারের মোটের চেয়ে বেশি">⚠️ অতিরিক্ত পরিশোধ: {fmtM(over)}</span></p>
                      ) : null; })()}
                      {(o.promotionsApplied ?? []).length > 0 || o.referralCode ? (
                        <div className="space-y-1 text-sm">
                          {(o.promotionsApplied ?? []).map((pa) => (
                            <p key={pa.promotionId}>🎁 প্রমোশন: <b>{pa.name}</b> — ছাড়: <b className="text-emerald-700">{(() => { try { return formatMinor(BigInt(pa.amountMinor)); } catch { return pa.amountMinor; } })()}</b></p>
                          ))}
                          {o.referralCode ? (
                            <p>🤝 রেফারেল কোড: <b className="font-mono">{o.referralCode}</b>
                              {o.referralDiscountMinor !== undefined && Number(o.referralDiscountMinor) > 0 ? (
                                <> — ছাড়: <b className="text-emerald-700">{(() => { try { return formatMinor(BigInt(o.referralDiscountMinor)); } catch { return o.referralDiscountMinor; } })()}</b></>
                              ) : null}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      {(o.wholesaleBreakdown ?? []).length > 0 ? (
                        <div className="space-y-1 text-sm">
                          <p className="font-semibold text-amber-800">🏷️ পাইকারি মূল্য প্রযোজ্য</p>
                          {(o.wholesaleBreakdown ?? []).map((w) => (
                            <p key={w.productId} className="text-xs text-slate-600">
                              পণ্য {w.productId} — কমপক্ষে {w.minQty}টির স্তর: একক দাম {(() => { try { return formatMinor(BigInt(w.priceMinor)); } catch { return w.priceMinor; } })()}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      {/* EC29: order items with gift / bundle markers + wrap + gift message */}
                      {(o.items ?? []).length > 0 ? (
                        <div className="space-y-1 border-t pt-3">
                          <p className="text-xs font-semibold text-slate-600">অর্ডারের পণ্য{surgery ? " — ✏️ সম্পাদনা মোড" : ""}</p>
                          {surgery ? (
                            <div className="space-y-2">
                              {drafts.map((d, idx) => d.kind === "bundle" ? (
                                <div key={`bundle-${d.bundleId ?? idx}`} className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs ring-1 ring-amber-200">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-amber-900">🎁 বান্ডল: {d.bundleName ?? d.name}</span>
                                    {d.lineTotalMinor ? <span className="ml-auto font-semibold">{fmtM(d.lineTotalMinor)}</span> : null}
                                  </div>
                                  {(d.components ?? []).map((c, ci) => (
                                    <p key={ci} className="text-slate-600">• {c.name} × {c.quantity} <span className="text-slate-400">(বান্ডলের অংশ — দাম/পরিমাণ আলাদা করে বদলানো যায় না)</span></p>
                                  ))}
                                  <div className="flex flex-wrap items-center gap-2 pt-1">
                                    <span className="text-slate-500">গ্রুপের পরিমাণ:</span>
                                    <button type="button" className="btn-secondary btn-sm px-2" onClick={() => patchDraft(idx, { quantity: Math.max(1, (d.quantity || 1) - 1) })}>−</button>
                                    <input className="input w-16 text-center" type="number" min={1} value={Number.isNaN(d.quantity) ? "" : d.quantity} onChange={(e) => patchDraft(idx, { quantity: Number(e.target.value) })} />
                                    <button type="button" className="btn-secondary btn-sm px-2" onClick={() => patchDraft(idx, { quantity: (d.quantity || 0) + 1 })}>+</button>
                                    <button type="button" className="ml-auto font-semibold text-red-600 hover:underline" onClick={() => setDrafts((prev) => prev.filter((_, i) => i !== idx))}>পুরো গ্রুপ সরান</button>
                                  </div>
                                </div>
                              ) : (
                                <div key={d.orderItemId ?? `new-${idx}`} className="space-y-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs ring-1 ring-slate-200">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium">{d.name}</span>
                                    {d.isGift ? <span className="rounded bg-pink-100 px-1.5 py-0.5 font-bold text-pink-700">🎁 উপহার</span> : null}
                                    {!d.orderItemId ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-700">নতুন</span> : null}
                                    <button type="button" className="ml-auto font-semibold text-red-600 hover:underline" onClick={() => setDrafts((prev) => prev.filter((_, i) => i !== idx))}>সরান</button>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                    <span className="inline-flex items-center gap-1">
                                      <span className="text-slate-500">পরিমাণ:</span>
                                      <button type="button" className="btn-secondary btn-sm px-2" disabled={d.isGift} onClick={() => patchDraft(idx, { quantity: Math.max(1, (d.quantity || 1) - 1) })}>−</button>
                                      <input className="input w-16 text-center" type="number" min={1} disabled={d.isGift} value={Number.isNaN(d.quantity) ? "" : d.quantity} onChange={(e) => patchDraft(idx, { quantity: Number(e.target.value) })} />
                                      <button type="button" className="btn-secondary btn-sm px-2" disabled={d.isGift} onClick={() => patchDraft(idx, { quantity: (d.quantity || 0) + 1 })}>+</button>
                                      {d.isGift ? <span className="text-slate-400">উপহারের পরিমাণ বদলানো যায় না — শুধু সরানো যায়</span> : null}
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                      <span className="text-slate-500">একক দাম (৳):</span>
                                      <input className="input w-24" inputMode="decimal" disabled={d.isGift} value={d.isGift ? "০" : (d.priceText ?? minorToTaka(d.unitPriceMinor))} onChange={(e) => patchDraftPrice(idx, e.target.value)} />
                                      {d.isGift ? <span className="text-slate-400">উপহারের দাম বদলানো যায় না</span> : null}
                                    </span>
                                  </div>
                                </div>
                              ))}
                              {/* ON3: add a new line via the products API (search + variant chips). */}
                              <div className="space-y-1.5 border-t pt-2">
                                <p className="font-semibold text-slate-600">নতুন আইটেম যোগ</p>
                                <div className="flex flex-wrap gap-2">
                                  <input className="input min-w-[180px] flex-1" placeholder="পণ্যের নাম বা SKU দিয়ে খুঁজুন" value={pickQuery}
                                    onChange={(e) => setPickQuery(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchProducts(); } }} />
                                  <button type="button" className="btn-secondary btn-sm" disabled={pickBusy} onClick={() => void searchProducts()}>{pickBusy ? "খোঁজা হচ্ছে…" : "খুঁজুন"}</button>
                                </div>
                                {pendingProduct ? (
                                  <div className="space-y-1 rounded-lg bg-indigo-50 px-3 py-2">
                                    <p className="font-medium text-indigo-900">{pendingProduct.name} — ভ্যারিয়েন্ট বেছে নিন:</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {pendingProduct.variants.map((v) => (
                                        <button key={v.id} type="button" className="btn-secondary btn-sm" onClick={() => addProductDraft(pendingProduct, v)}>
                                          {v.name}{v.priceMinor ? ` · ${fmtM(v.priceMinor)}` : ""}
                                        </button>
                                      ))}
                                      <button type="button" className="btn-ghost btn-sm" onClick={() => setPendingProduct(null)}>বাতিল</button>
                                    </div>
                                  </div>
                                ) : pickResults.length > 0 ? (
                                  <ul className="divide-y rounded-lg bg-white ring-1 ring-slate-200">
                                    {pickResults.map((p) => (
                                      <li key={p.id}>
                                        <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => void chooseProduct(p)}>
                                          <span className="font-medium">{p.name}{p.sku ? <span className="ml-2 text-slate-400">SKU: {p.sku}</span> : null}</span>
                                          <span className="font-semibold">{fmtM(p.priceMinor)}</span>
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                              {/* ON3: live preview totals (debounced server preview). */}
                              <div className="space-y-1 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                                {previewError ? <p className="text-xs text-red-600">{previewError}</p> : null}
                                {preview ? (
                                  <>
                                    {surgeryMoneySummary(preview).map((r) => (
                                      <div key={r.key} className={`flex flex-wrap items-baseline justify-between gap-2 text-xs ${r.isTotal ? "border-t pt-1.5 text-sm font-bold" : ""}`}>
                                        <span>{r.label}{r.note ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">{r.note}{r.key === "coupon" && preview.couponPinnedMinor && (() => { try { return BigInt(preview.couponPinnedMinor) > 0n; } catch { return false; } })() ? ` (${fmtM(preview.couponPinnedMinor)})` : ""}</span> : null}</span>
                                        <span>{r.negative ? "−" : ""}{fmtM(r.amountMinor)}</span>
                                      </div>
                                    ))}
                                    {previewBusy ? <p className="text-[11px] text-slate-500">হিসাব হচ্ছে…</p> : null}
                                    {(preview.warnings ?? []).length > 0 ? (
                                      <ul className="list-disc space-y-0.5 rounded-lg bg-amber-50 px-3 py-1.5 pl-6 text-[11px] text-amber-800">
                                        {preview.warnings.map((w, wi) => <li key={wi}>{w}</li>)}
                                      </ul>
                                    ) : null}
                                  </>
                                ) : previewBusy ? (
                                  <p className="text-xs text-slate-500">হিসাব হচ্ছে…</p>
                                ) : !previewError ? (
                                  <p className="text-[11px] text-slate-500">আইটেম বদলালেই সার্ভারের নতুন হিসাব এখানে দেখা যাবে।</p>
                                ) : null}
                              </div>
                              <label className="flex items-center gap-2 text-xs">
                                <input type="checkbox" checked={recalcDelivery} onChange={(e) => setRecalcDelivery(e.target.checked)} />
                                ডেলিভারি চার্জ আবার হিসাব করুন
                              </label>
                              {draftErrors.length > 0 ? (
                                <ul className="list-disc space-y-0.5 rounded-lg bg-red-50 px-3 py-1.5 pl-6 text-[11px] text-red-600">
                                  {draftErrors.map((e, i) => <li key={i}>{e}</li>)}
                                </ul>
                              ) : null}
                              {surgeryError ? <p className="rounded-lg bg-red-50 px-3 py-1.5 text-[11px] text-red-600">{surgeryError}</p> : null}
                              <div className="flex flex-wrap gap-2 pt-1">
                                <button type="button" className="btn-primary btn-sm" disabled={surgeryBusy} onClick={() => void saveSurgery()}>{surgeryBusy ? "সংরক্ষণ হচ্ছে…" : "সংরক্ষণ করুন"}</button>
                                <button type="button" className="btn-secondary btn-sm" disabled={surgeryBusy} onClick={openSplit}>Split করুন</button>
                                <button type="button" className="btn-ghost btn-sm" disabled={surgeryBusy} onClick={exitSurgery}>বাতিল</button>
                              </div>
                            </div>
                          ) : (o.items ?? []).map((it) => (
                            <div key={it.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                              <span className="font-medium">{it.name} × {it.quantity}</span>
                              {it.isGift ? <span className="rounded bg-pink-100 px-1.5 py-0.5 font-bold text-pink-700">🎁 উপহার</span> : null}
                              {it.bundleName ? <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">বান্ডল: {it.bundleName}</span> : null}
                              <span className="ml-auto font-semibold">{it.isGift ? "৳০" : (() => { try { return formatMinor(BigInt(it.totalMinor)); } catch { return it.totalMinor; } })()}</span>
                            </div>
                          ))}
                          {o.giftWrapMinor !== undefined && Number(o.giftWrapMinor) > 0 ? (
                            <div className="flex justify-between rounded-lg bg-pink-50 px-3 py-1.5 text-xs">
                              <span className="font-medium text-pink-900">🎁 গিফট র‍্যাপ ফি</span>
                              <span className="font-semibold">{(() => { try { return formatMinor(BigInt(o.giftWrapMinor)); } catch { return o.giftWrapMinor; } })()}</span>
                            </div>
                          ) : null}
                          {o.giftSkipped ? (
                            <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">উপহার পণ্যের স্টক শেষ থাকায় এই অর্ডারে উপহার যোগ করা যায়নি।</p>
                          ) : null}
                          {o.giftMessage ? (
                            <div className="rounded-lg border-2 border-pink-300 bg-pink-50 px-3 py-2 text-sm font-semibold text-pink-900">
                              🎁 গিফট বার্তা: {o.giftMessage}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {(o.paymentVerifications ?? []).length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-slate-600">পেমেন্ট যাচাই / অগ্রিমের রেকর্ড</p>
                          {(o.paymentVerifications ?? []).map((pv) => (
                            <div key={pv.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                              <span className="font-medium">{pv.provider ?? "—"}</span>
                              <span className="font-semibold">{(() => { try { return pv.amountMinor != null ? formatMinor(BigInt(pv.amountMinor)) : "—"; } catch { return String(pv.amountMinor ?? "—"); } })()}</span>
                              {pv.trxId ? <span className="font-mono">TrxID: {pv.trxId}</span> : null}
                              <span className="rounded bg-slate-200 px-1.5 py-0.5 font-medium">{pv.status}</span>
                              <span className="text-slate-500">{pv.source === "manual_advance" ? "স্টাফ রেকর্ড" : pv.source ?? ""}</span>
                              <span className="text-slate-500">{new Date(pv.createdAt).toLocaleString("bn-BD")}</span>
                              {pv.note ? <span className="text-slate-500">· {pv.note}</span> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="space-y-2 border-t pt-3">
                        <label className="text-sm font-medium">অগ্রিম পেমেন্ট রেকর্ড করুন</label>
                        {advError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{advError}</p> : null}
                        {advNotice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{advNotice}</p> : null}
                        <div className="grid gap-2 sm:grid-cols-4">
                          <input className="input" placeholder="পরিমাণ (টাকা)" inputMode="decimal" value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} />
                          <select className="input" value={advMethod} onChange={(e) => setAdvMethod(e.target.value)}>
                            <option value="bkash">বিকাশ</option>
                            <option value="nagad">নগদ</option>
                            <option value="rocket">রকেট</option>
                            <option value="cash">ক্যাশ</option>
                            <option value="bank">ব্যাংক</option>
                            <option value="other">অন্যান্য</option>
                          </select>
                          <input className="input" placeholder="রেফারেন্স / TrxID (ঐচ্ছিক)" value={advRef} onChange={(e) => setAdvRef(e.target.value)} />
                          <input className="input" placeholder="নোট (ঐচ্ছিক)" value={advNote} onChange={(e) => setAdvNote(e.target.value)} />
                        </div>
                        <button className="btn-primary btn-sm" disabled={advBusy || advAmount.trim() === ""} onClick={recordAdvance}>
                          {advBusy ? "রেকর্ড হচ্ছে..." : "অগ্রিম রেকর্ড করুন"}
                        </button>
                        <p className="text-xs text-slate-500">স্টাফের রেকর্ড করা অগ্রিম যাচাইকৃত (approved) হিসেবেই ধরা হয় — রেকর্ডকারীই যাচাইকারী।</p>
                      </div>
                    </div>
                    {/* ON7: per-order profit card. Null money from
                        the server means "unknown" and is SAID so —
                        never rendered as 0. */}
                    <div className="space-y-2 rounded-xl border bg-white p-3">
                      <h4 className="text-sm font-semibold">📊 লাভের হিসাব</h4>
                      {profitError ? (
                        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{profitError}</p>
                      ) : !profit ? (
                        <p className="text-xs text-slate-500">লোড হচ্ছে…</p>
                      ) : (
                        <div className="space-y-1.5 text-sm">
                          <div className="flex flex-wrap justify-between gap-2"><span className="text-slate-500">আয়</span><b>{fmtM(profit.revenueMinor)}</b></div>
                          {(() => { try { return BigInt(profit.discountMinor) > 0n; } catch { return false; } })() ? (
                            <div className="flex flex-wrap justify-between gap-2"><span className="text-slate-500">ছাড়</span><b className="text-rose-600">−{fmtM(profit.discountMinor)}</b></div>
                          ) : null}
                          <div className="flex flex-wrap justify-between gap-2"><span className="text-slate-500">ডেলিভারি চার্জ (গ্রাহকের থেকে)</span><b>{fmtM(profit.deliveryChargedMinor)}</b></div>
                          {profit.productCostMinor != null ? (
                            <div className="flex flex-wrap justify-between gap-2"><span className="text-slate-500">পণ্যের খরচ</span><b>{fmtM(profit.productCostMinor)}</b></div>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex flex-wrap justify-between gap-2"><span className="text-slate-500">পণ্যের খরচ</span><b className="text-amber-700">খরচ জানা নেই</b></div>
                              {(profit.uncostedLines ?? []).map((u, ui) => (
                                <p key={ui} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                                  {u.name}{u.sku ? ` (SKU: ${u.sku})` : ""} × {u.quantity} — আয় {fmtM(u.revenueMinor)}, খরচ জানা নেই
                                </p>
                              ))}
                            </div>
                          )}
                          {profit.grossMarginMinor != null ? (
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-1.5">
                              <span className="text-slate-500">মোট লাভ (গ্রস মার্জিন)</span>
                              <span className={`rounded px-2 py-0.5 font-bold ${marginTone(profit.grossMarginMinor) === "negative" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{fmtM(profit.grossMarginMinor)}</span>
                            </div>
                          ) : (
                            <p className="border-t pt-1.5 text-xs text-slate-500">সব লাইনের খরচ জানা না থাকায় মোট লাভ হিসাব করা যায়নি।</p>
                          )}
                          <div className="flex flex-wrap justify-between gap-2">
                            <span className="text-slate-500">আসল ডেলিভারি খরচ (courier)</span>
                            {profit.deliveryActualMinor != null ? <b>{fmtM(profit.deliveryActualMinor)}</b> : <b className="text-slate-400">জানা নেই</b>}
                          </div>
                          {deliveryCoverageCaption(profit.deliveryActualCoverage) ? (
                            <p className="text-[11px] text-slate-500">{deliveryCoverageCaption(profit.deliveryActualCoverage)}</p>
                          ) : null}
                          {profit.netMarginMinor != null ? (
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-1.5">
                              <span className="font-medium text-slate-600">নিট লাভ</span>
                              <span className={`rounded px-2 py-0.5 font-bold ${marginTone(profit.netMarginMinor) === "negative" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{fmtM(profit.netMarginMinor)}</span>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                    {/* EC31: installment plan for this order */}
                    <div className="space-y-3 rounded-xl border bg-white p-3">
                      <h4 className="text-sm font-semibold">💰 কিস্তি প্ল্যান</h4>
                      {instError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{instError}</p> : null}
                      {!instLoaded ? (
                        <p className="text-xs text-slate-500">লোড হচ্ছে…</p>
                      ) : !instPlan ? (
                        (() => { let due = 0n; try { due = BigInt(o.amountDueMinor ?? "0"); } catch { due = 0n; } return due > 0n ? (
                          <div className="space-y-2">
                            <p className="text-xs text-slate-500">এই অর্ডারে বকেয়া {(() => { try { return formatMinor(BigInt(o.amountDueMinor ?? "0")); } catch { return o.amountDueMinor; } })()} — তা কিস্তিতে ভাগ করে একটি প্ল্যান তৈরি করুন। প্ল্যানের মোট হবে আজকের বকেয়ার স্ন্যাপশট।</p>
                            <div className="grid gap-2 sm:grid-cols-4">
                              <label className="block text-xs font-medium text-slate-600">কিস্তির সংখ্যা (২–২৪)
                                <input className="input mt-1" type="number" min={2} max={24} value={instCount} onChange={(e) => setInstCount(e.target.value)} />
                              </label>
                              <label className="block text-xs font-medium text-slate-600">ব্যবধান দিন (১–৯০)
                                <input className="input mt-1" type="number" min={1} max={90} value={instInterval} onChange={(e) => setInstInterval(e.target.value)} />
                              </label>
                              <label className="block text-xs font-medium text-slate-600">শুরুর তারিখ
                                <input className="input mt-1" type="date" value={instStart} onChange={(e) => setInstStart(e.target.value)} />
                              </label>
                              <label className="block text-xs font-medium text-slate-600">নোট (ঐচ্ছিক)
                                <input className="input mt-1" value={instNote} onChange={(e) => setInstNote(e.target.value)} />
                              </label>
                            </div>
                            <button className="btn-primary btn-sm" disabled={instBusy !== "" || !instStart} onClick={createInstPlan}>
                              {instBusy === "create" ? "তৈরি হচ্ছে..." : "কিস্তি প্ল্যান তৈরি করুন"}
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">এই অর্ডারে বকেয়া নেই — কিস্তি প্ল্যান দরকার নেই।</p>
                        ); })()
                      ) : (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            <span>মোট: <b>{(() => { try { return formatMinor(BigInt(instPlan.totalMinor)); } catch { return instPlan.totalMinor; } })()}</b></span>
                            <span>পরিশোধিত: <b className="text-emerald-700">{(() => { try { return formatMinor(BigInt(instPlan.paidMinor)); } catch { return instPlan.paidMinor; } })()}</b></span>
                            <span>বাকি: <b>{(() => { try { return formatMinor(BigInt(instPlan.remainingMinor)); } catch { return instPlan.remainingMinor; } })()}</b></span>
                            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${instPlan.status === "active" ? "bg-emerald-100 text-emerald-700" : instPlan.status === "completed" ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-600"}`}>{instPlan.status === "active" ? "সক্রিয়" : instPlan.status === "completed" ? "সম্পূর্ণ" : instPlan.status === "cancelled" ? "বাতিল" : instPlan.status}</span>
                            {instPlan.note ? <span className="text-xs text-slate-500">নোট: {instPlan.note}</span> : null}
                          </div>
                          <ResponsiveTable
                            table={
                              <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead><tr className="border-b text-slate-500"><th className="py-1.5 pr-2">ক্রম</th><th className="py-1.5 pr-2">তারিখ</th><th className="py-1.5 pr-2">পরিমাণ</th><th className="py-1.5 pr-2">পরিশোধিত</th><th className="py-1.5 pr-2">অবস্থা</th>{instPlan.status === "active" ? <th className="py-1.5">সংগ্রহ</th> : null}</tr></thead>
                              <tbody>
                                {instPlan.items.map((item) => {
                                  const paid = (() => { try { return BigInt(item.paidMinor); } catch { return 0n; } })();
                                  const pill = item.fullyPaid
                                    ? { text: "সম্পূর্ণ পরিশোধিত", cls: "bg-emerald-100 text-emerald-700" }
                                    : item.overdue
                                      ? { text: "অতিবাহিত", cls: "bg-red-100 text-red-700" }
                                      : paid > 0n
                                        ? { text: "আংশিক", cls: "bg-amber-100 text-amber-700" }
                                        : { text: "বাকি", cls: "bg-slate-100 text-slate-600" };
                                  return (
                                    <tr key={item.id} className="border-b last:border-0 align-top">
                                      <td className="py-2 pr-2 font-medium">{item.seq}</td>
                                      <td className="py-2 pr-2">{item.dueDay}</td>
                                      <td className="py-2 pr-2">{(() => { try { return formatMinor(BigInt(item.amountMinor)); } catch { return item.amountMinor; } })()}</td>
                                      <td className="py-2 pr-2">{(() => { try { return formatMinor(BigInt(item.paidMinor)); } catch { return item.paidMinor; } })()}</td>
                                      <td className="py-2 pr-2"><span className={`rounded px-1.5 py-0.5 font-semibold ${pill.cls}`}>{pill.text}</span></td>
                                      {instPlan.status === "active" ? (
                                        <td className="py-2">
                                          {renderInstCollect(item)}
                                        </td>
                                      ) : null}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                              </div>
                            }
                            cards={instPlan.items.map((item) => {
                              const paid = (() => { try { return BigInt(item.paidMinor); } catch { return 0n; } })();
                              const pill = item.fullyPaid
                                ? { text: "সম্পূর্ণ পরিশোধিত", cls: "bg-emerald-100 text-emerald-700" }
                                : item.overdue
                                  ? { text: "অতিবাহিত", cls: "bg-red-100 text-red-700" }
                                  : paid > 0n
                                    ? { text: "আংশিক", cls: "bg-amber-100 text-amber-700" }
                                    : { text: "বাকি", cls: "bg-slate-100 text-slate-600" };
                              return (
                                <div key={item.id} className="rounded-xl border bg-white p-3 shadow-sm">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-bold text-slate-900">ক্রম {item.seq}</span>
                                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${pill.cls}`}>{pill.text}</span>
                                  </div>
                                  <dl className="mt-2 space-y-1 text-xs">
                                    <div className="flex justify-between gap-2"><dt className="text-slate-500">তারিখ</dt><dd className="font-medium">{item.dueDay}</dd></div>
                                    <div className="flex justify-between gap-2"><dt className="text-slate-500">পরিমাণ</dt><dd className="font-medium">{(() => { try { return formatMinor(BigInt(item.amountMinor)); } catch { return item.amountMinor; } })()}</dd></div>
                                    <div className="flex justify-between gap-2"><dt className="text-slate-500">পরিশোধিত</dt><dd className="font-medium">{(() => { try { return formatMinor(BigInt(item.paidMinor)); } catch { return item.paidMinor; } })()}</dd></div>
                                  </dl>
                                  {instPlan.status === "active" ? (
                                    <div className="mt-2 border-t pt-2">
                                      <div className="mb-1 text-xs font-semibold text-slate-500">সংগ্রহ</div>
                                      {renderInstCollect(item)}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          />
                          {instPlan.status === "active" ? (
                            <button className="btn-ghost btn-sm text-red-600" disabled={instBusy !== ""} onClick={cancelInstPlan}>
                              {instBusy === "cancel" ? "বাতিল হচ্ছে..." : "প্ল্যান বাতিল করুন"}
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <div className="space-y-3 rounded-xl border bg-white p-3">
                      <h4 className="text-sm font-semibold">🏬 স্টোর সিঙ্ক</h4>
                      {syncNotice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{syncNotice}</p> : null}
                      {syncError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{syncError}</p> : null}
                      {pushStateError ? (
                        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">স্টোর সিঙ্কের তথ্য লোড করা যায়নি: {pushStateError}</p>
                      ) : !pushState ? (
                        <p className="text-xs text-slate-500">লোড হচ্ছে…</p>
                      ) : !pushState.store ? (
                        <p className="text-xs text-slate-500">এই অর্ডারের কোনো স্টোর নেই</p>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-sm">
                            <span className="font-medium">{pushState.store.name}</span>
                            <span className="text-slate-500"> ({pushState.store.platform})</span>
                            <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium">Sync মোড: {pushState.store.syncMode}</span>
                          </p>
                          {pushState.store.syncMode === "mirror" ? (
                            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">এই স্টোরটি Mirror মোডে আছে — এই মোডে এখানকার কোনো পরিবর্তন স্টোরে Push হবে না। Push চালু করতে Sync Center থেকে মোড co-manage বা full-manage করুন।</p>
                          ) : null}
                          <p className="text-xs text-slate-600">
                            সর্বশেষ Push অবস্থা: <span className="font-medium">{pushState.storeSyncStatus ?? "—"}</span>
                            {pushState.storeDraftId ? <span> · Draft ID: {pushState.storeDraftId}</span> : null}
                          </p>
                          {pushState.storeSyncError ? (
                            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{pushState.storeSyncError}</p>
                          ) : null}
                          {pushState.store.refundPushEnabled ? (
                            <p className="text-xs text-emerald-700">স্টোরে refund push চালু আছে — refund রেকর্ড হলে স্টোরেও পাঠানো হবে।</p>
                          ) : (
                            <p className="text-xs text-amber-700">স্টোরে refund push বন্ধ আছে — শুধু লোকাল রেকর্ড হবে (OWNER চালু করতে পারেন Sync Center থেকে)</p>
                          )}
                          <div className="space-y-1">
                            <p className="text-xs font-semibold text-slate-600">সাম্প্রতিক Push</p>
                            {pushState.recentPushes.length === 0 ? (
                              <p className="text-xs text-slate-500">এখনো কোনো Push হয়নি।</p>
                            ) : pushState.recentPushes.map((p) => (
                              <div key={p.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                                <span className="font-medium">{p.operation}</span>
                                <span className="rounded bg-slate-200 px-1.5 py-0.5 font-medium">{p.status}</span>
                                <span className="text-slate-500">{new Date(p.createdAt).toLocaleString("bn-BD")}</span>
                                {p.lastError ? <span className="text-red-600">{p.lastError}</span> : null}
                              </div>
                            ))}
                          </div>
                          <div className="space-y-2 border-t pt-3">
                            <label className="text-sm font-medium">স্টোরে কাস্টমার-নোট</label>
                            <p className="text-xs text-slate-500">এই নোটটি গ্রাহক স্টোরে দেখতে পাবেন — উপরের অভ্যন্তরীণ নোটের থেকে আলাদা, সেটি কখনো স্টোরে যায় না।</p>
                            <textarea className="input" rows={2} maxLength={2000} placeholder="যেমন: আপনার অর্ডারটি প্যাক করা হয়েছে…" value={storeNoteText} onChange={(e) => setStoreNoteText(e.target.value)} />
                            <button className="btn-primary btn-sm" disabled={syncBusy !== "" || !storeNoteText.trim()} onClick={sendStoreNote}>{syncBusy === "store-note" ? "পাঠানো হচ্ছে..." : "স্টোরে নোট পাঠান"}</button>
                          </div>
                          {pushState.storeInvoiceUrl ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                              <span className="font-medium">ইনভয়েস লিংক:</span>
                              <a className="break-all text-brand-600 hover:underline" href={pushState.storeInvoiceUrl} target="_blank" rel="noreferrer">{pushState.storeInvoiceUrl}</a>
                              <button className="btn-secondary btn-sm" onClick={() => copyText("invoice", pushState.storeInvoiceUrl!)}>{copiedKey === "invoice" ? "কপি হয়েছে ✓" : "ইনভয়েস লিংক কপি করুন"}</button>
                            </div>
                          ) : null}
                          {!pushState.storeDraftId && o.source !== "woocommerce" && o.source !== "shopify" && (pushState.store !== null || !o.storeId) ? (
                            <div className="border-t pt-3">
                              <button className="btn-secondary btn-sm" disabled={syncBusy !== ""} onClick={createStoreDraft}>{syncBusy === "draft" ? "তৈরি হচ্ছে..." : "স্টোরে Draft Order তৈরি করুন"}</button>
                              <p className="mt-1 text-xs text-slate-500">এই অর্ডারটি এখনো স্টোরে তৈরি হয়নি — Draft হিসেবে স্টোরে তৈরি করা হবে।</p>
                            </div>
                          ) : null}
                        </div>
                      )}
                      {pushState && !pushState.store && !pushState.storeDraftId && o.source !== "woocommerce" && o.source !== "shopify" && !o.storeId ? (
                        <div className="border-t pt-3">
                          <button className="btn-secondary btn-sm" disabled={syncBusy !== ""} onClick={createStoreDraft}>{syncBusy === "draft" ? "তৈরি হচ্ছে..." : "স্টোরে Draft Order তৈরি করুন"}</button>
                          <p className="mt-1 text-xs text-slate-500">এই অর্ডারের নিজের কোনো স্টোর নেই — একটিমাত্র co-manage/full-manage স্টোর থাকলে সেখানেই Draft তৈরি হবে, না হলে সার্ভারের কারণটি দেখানো হবে।</p>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                        <button className="btn-secondary btn-sm" disabled={syncBusy !== ""} onClick={createReturnLink}>{syncBusy === "return-link" ? "তৈরি হচ্ছে..." : "রিটার্ন লিংক তৈরি করুন"}</button>
                        <a className="btn-secondary btn-sm" href={`/dashboard/commerce/print?orderId=${o.id}&kind=invoice`} target="_blank" rel="noreferrer">🧾 ইনভয়েস প্রিন্ট</a>
                        <a className="btn-secondary btn-sm" href={`/dashboard/commerce/print?orderId=${o.id}&kind=slip`} target="_blank" rel="noreferrer">🏷️ প্যাকিং স্লিপ প্রিন্ট</a>
                      </div>
                      {returnUrl ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                          <span className="font-medium">রিটার্ন লিংক:</span>
                          <a className="break-all text-brand-600 hover:underline" href={returnUrl} target="_blank" rel="noreferrer">{returnUrl}</a>
                          <button className="btn-secondary btn-sm" onClick={() => copyText("return", returnUrl)}>{copiedKey === "return" ? "কপি হয়েছে ✓" : "লিংক কপি করুন"}</button>
                        </div>
                      ) : null}
                    </div>
                    <div className="space-y-2 rounded-xl border bg-white p-3">
                      <h4 className="text-sm font-semibold">🛵 রাইডার ডেলিভারি (নিজস্ব)</h4>
                      {(() => { const active = orderAssignments.find((a) => a.status === "assigned" || a.status === "picked_up") ?? orderAssignments[0]; return active ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium">{active.riderName ?? active.riderId}</span>
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${active.status === "delivered" ? "bg-green-100 text-green-700" : active.status === "returned" ? "bg-red-100 text-red-700" : active.status === "picked_up" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{active.status === "assigned" ? "বরাদ্দ হয়েছে" : active.status === "picked_up" ? "তোলা হয়েছে" : active.status === "delivered" ? "ডেলিভারি সম্পন্ন" : active.status === "returned" ? "ফেরত" : active.status}</span>
                          {active.status === "assigned" ? <button type="button" className="btn-secondary btn-sm" disabled={riderBusy !== ""} onClick={() => transitionAssignment(active, "picked_up")}>তোলা হয়েছে</button> : null}
                          {active.status === "picked_up" ? <>
                            <button type="button" className="btn-primary btn-sm" disabled={riderBusy !== ""} onClick={() => transitionAssignment(active, "delivered")}>ডেলিভারি সম্পন্ন</button>
                            <button type="button" className="btn-secondary btn-sm text-red-600" disabled={riderBusy !== ""} onClick={() => transitionAssignment(active, "returned")}>ফেরত</button>
                          </> : null}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <select className="input w-auto" value={assignRiderId} onChange={(e) => setAssignRiderId(e.target.value)}>
                            <option value="">রাইডার বেছে নিন</option>
                            {riders.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                          <button type="button" className="btn-primary btn-sm" disabled={riderBusy !== "" || !assignRiderId} onClick={assignRider}>{riderBusy === "assign" ? "হচ্ছে…" : "রাইডার বরাদ্দ করুন"}</button>
                          {riders.filter((r) => r.active).length === 0 ? <span className="text-xs text-slate-500">সক্রিয় রাইডার নেই — গুদাম পেজের রাইডার ট্যাব থেকে যোগ করুন।</span> : null}
                        </div>
                      ); })()}
                    </div>
                    {(() => { const rv = reviewForOrder(o.id); return rv ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                        <div className="text-sm font-semibold">⭐ গ্রাহক রিভিউ — {reviewStatusBn(rv)}</div>
                        {rv.rating != null ? <div className="mt-1 text-base text-amber-500">{stars(rv.rating)} <span className="text-sm text-slate-600">({rv.rating}/৫)</span></div> : null}
                        {rv.comment ? <p className="mt-1 text-sm text-slate-700">“{rv.comment}”</p> : null}
                        <p className="mt-1 text-xs text-slate-500">{rv.receivedAt ? `পাওয়া গেছে: ${new Date(rv.receivedAt).toLocaleString("bn-BD")}` : rv.requestedAt ? `চাওয়া হয়েছে: ${new Date(rv.requestedAt).toLocaleString("bn-BD")}` : "কোনো চ্যানেল পাওয়া যায়নি বলে এখনো পাঠানো হয়নি"}{rv.source ? ` · মাধ্যম: ${rv.source === "chat" ? "চ্যাট" : "লিংক"}` : ""}</p>
                      </div>
                    ) : null; })()}
                  </div>
                </td></tr>
  );
}
