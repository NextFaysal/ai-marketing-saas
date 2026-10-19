"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDate, fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka, takaToMinorString } from "@/lib/storefront-money";
import { ResponsiveTable } from "@repo/ui";

// EC32 — অ্যাফিলিয়েট প্রোগ্রাম: পার্টনার তালিকা, কমিশন
// এন্ট্রি, ব্যালেন্স আর পেআউট রেকর্ড। পেআউট এখানে শুধু রেকর্ড
// করা হয় — টাকা মার্চেন্ট নিজে বিকাশ/নগদ/ব্যাংক/নগদে পাঠান,
// সিস্টেম কোনো টাকা পাঠায় না। সব সংখ্যা AffiliatesService
// থেকে আসে; এই পেজে কোনো হিসাব বানানো হয় না (outstanding
// সারাংশ সার্ভারের FIFO সূত্রেই সাজানো aggregates থেকে)।

interface PartnerAggregates {
  entries: {
    total: number;
    pending: { count: number; commissionMinor: string };
    approved: { count: number; commissionMinor: string };
    paid: { count: number; commissionMinor: string };
    voided: { count: number; commissionMinor: string };
  };
  payoutsTotalMinor: string;
  payoutsCount: number;
}
interface Partner {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  code: string;
  commissionPercent: number;
  status: string;
  note: string | null;
  aggregates?: PartnerAggregates;
}
interface Balances {
  pendingMinor: string;
  approvedMinor: string;
  paidMinor: string;
  paidOutMinor: string;
  outstandingApprovedMinor: string;
}
interface Payout {
  id: string;
  amountMinor: string;
  method: string;
  reference: string | null;
  note: string | null;
  createdAt: string | null;
}
interface PartnerDetail extends Partner {
  balances: Balances;
  payouts: Payout[];
  paidOnRefundedOrders: number;
}
interface Entry {
  id: string;
  partnerId: string;
  partnerName: string | null;
  orderId: string;
  orderNumber: string | null;
  baseMinor: string;
  percentSnapshot: number;
  commissionMinor: string;
  status: string;
  voidReason: string | null;
  createdAt: string | null;
}
interface StaffStateLite {
  setting: {
    affiliateEnabled?: boolean;
    affiliateDefaultPercent?: number | null;
    affiliateAttributionDays?: number;
  };
  organization: { id: string; slug: string; customDomain: string | null };
}

const STATUS_LABEL: Record<string, string> = {
  active: "active",
  paused: "suspended",
  pending: "pending",
  approved: "approved",
  paid: "paid",
  voided: "cancel",
};
const STATUS_CLS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-slate-200 text-slate-600",
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-sky-100 text-sky-700",
  paid: "bg-emerald-100 text-emerald-700",
  voided: "bg-rose-100 text-rose-700",
};
const METHOD_LABEL: Record<string, string> = {
  bkash: "bKash",
  nagad: "cash",
  bank: "bank",
  cash: "cash2",
  other: "other",
};

/** Outstanding summary from the list aggregates, using the
 * server's FIFO definition: stored approved − unapplied payouts
 * (payouts total − stored paid), floored at 0. */
function outstandingOf(p: Partner): string {
  if (!p.aggregates) return "0";
  const approved = BigInt(p.aggregates.entries.approved.commissionMinor || "0");
  const paid = BigInt(p.aggregates.entries.paid.commissionMinor || "0");
  const payouts = BigInt(p.aggregates.payoutsTotalMinor || "0");
  const unapplied = payouts - paid > 0n ? payouts - paid : 0n;
  const out = approved - unapplied;
  return (out > 0n ? out : 0n).toString();
}

export default function AffiliatesPage() {
  const { dict, t, locale } = useLocale();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [shopSlug, setShopSlug] = useState<string | null>(null);
  const [affiliateEnabled, setAffiliateEnabled] = useState(false);
  const [defaultPercent, setDefaultPercent] = useState("");
  const [attributionDays, setAttributionDays] = useState("30");

  // Partner form (create + edit share it).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fName, setFName] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fCode, setFCode] = useState("");
  const [fPercent, setFPercent] = useState("");
  const [fNote, setFNote] = useState("");

  // Selected partner detail.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entryStatus, setEntryStatus] = useState("");

  // Payout form (amount in taka).
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("bkash");
  const [payReference, setPayReference] = useState("");
  const [payNote, setPayNote] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError(dict.commerce.noOrganizationSelected); setLoading(false); return; }
    setLoading(true);
    try {
      const [list, state] = await Promise.all([
        apiFetch<{ total: number; items: Partner[] }>(`/organizations/${orgId}/affiliates/partners`),
        apiFetch<StaffStateLite>(`/organizations/${orgId}/storefront`).catch(() => null),
      ]);
      setPartners(list.items ?? []);
      if (state) {
        setShopSlug(state.organization?.slug ?? null);
        setAffiliateEnabled(state.setting?.affiliateEnabled === true);
        setDefaultPercent(
          state.setting?.affiliateDefaultPercent != null ? String(state.setting.affiliateDefaultPercent) : "",
        );
        setAttributionDays(String(state.setting?.affiliateAttributionDays ?? 30));
      }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadAffiliateInformation);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadDetail = useCallback(async (partnerId: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setDetailLoading(true);
    try {
      const [d, es] = await Promise.all([
        apiFetch<PartnerDetail>(`/organizations/${orgId}/affiliates/partners/${partnerId}/balance`),
        apiFetch<{ total: number; items: Entry[] }>(
          `/organizations/${orgId}/affiliates/entries?partnerId=${partnerId}&pageSize=50${entryStatus ? `&status=${entryStatus}` : ""}`,
        ),
      ]);
      setDetail(d);
      setEntries(es.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadPartnerDetails);
    } finally { setDetailLoading(false); }
  }, [entryStatus]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  async function saveSettings() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const pct = defaultPercent.trim() ? Number(defaultPercent) : null;
    if (pct !== null && (!Number.isInteger(pct) || pct < 0 || pct > 50)) {
      setError(dict.commerce.defaultCommissionRateMustBe); return;
    }
    const days = Number(attributionDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setError(dict.commerce.attributionWindowMustBeBetween); return;
    }
    setBusy("settings"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          affiliateEnabled,
          affiliateDefaultPercent: pct,
          affiliateAttributionDays: days,
        }),
      });
      setNotice(dict.commerce.affiliateSettingsSaved);
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotSaveSettings);
    } finally { setBusy(""); }
  }

  function resetForm() {
    setEditingId(null);
    setFName(""); setFPhone(""); setFEmail(""); setFCode(""); setFPercent(""); setFNote("");
  }

  async function submitPartner(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    const pct = fPercent.trim() ? Number(fPercent) : undefined;
    if (pct !== undefined && (!Number.isInteger(pct) || pct < 0 || pct > 50)) {
      setError(dict.commerce.commissionRateMustBeBetween); return;
    }
    setBusy("partner"); setError(""); setNotice("");
    try {
      if (editingId) {
        await apiFetch(`/organizations/${orgId}/affiliates/partners/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: fName.trim(), phone: fPhone.trim(),
            email: fEmail.trim() || null,
            ...(fCode.trim() ? { code: fCode.trim() } : {}),
            ...(pct !== undefined ? { commissionPercent: pct } : {}),
            note: fNote.trim() || null,
          }),
        });
        setNotice(dict.commerce.partnerUpdated);
      } else {
        await apiFetch(`/organizations/${orgId}/affiliates/partners`, {
          method: "POST",
          body: JSON.stringify({
            name: fName.trim(), phone: fPhone.trim(),
            email: fEmail.trim() || undefined,
            ...(fCode.trim() ? { code: fCode.trim() } : {}),
            ...(pct !== undefined ? { commissionPercent: pct } : {}),
            ...(fNote.trim() ? { note: fNote.trim() } : {}),
          }),
        });
        setNotice(dict.commerce.newPartnerAdded);
      }
      resetForm();
      await load();
      if (selectedId) void loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.commerce.couldNotSavePartner);
    } finally { setBusy(""); }
  }

  function startEdit(p: Partner) {
    setEditingId(p.id);
    setFName(p.name); setFPhone(p.phone); setFEmail(p.email ?? "");
    setFCode(p.code); setFPercent(String(p.commissionPercent)); setFNote(p.note ?? "");
  }

  async function toggleStatus(p: Partner) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`status-${p.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/affiliates/partners/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: p.status === "active" ? "paused" : "active" }),
      });
      await load();
      if (selectedId === p.id) void loadDetail(p.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.commerce.couldNotChangeStatus);
    } finally { setBusy(""); }
  }

  async function copyLink(p: Partner) {
    const path = shopSlug ? `/shop/${shopSlug}?ref=${p.code}` : `/shop/?ref=${p.code}`;
    const link = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
    try {
      await navigator.clipboard.writeText(link);
      setNotice(t("commerce.shareLinkCopied", { link: link }));
      setError("");
    } catch {
      setError(t("commerce.couldNotCopyCopyThe2", { link: link }));
    }
  }

  async function submitPayout(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId || !selectedId) return;
    const amountMinor = takaToMinorString(payAmount);
    if (!amountMinor || amountMinor === "0") {
      setError(dict.commerce.giveThePayoutAmountIn); return;
    }
    setBusy("payout"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/affiliates/partners/${selectedId}/payouts`, {
        method: "POST",
        body: JSON.stringify({
          amountMinor, method: payMethod,
          reference: payReference.trim() || undefined,
          note: payNote.trim() || undefined,
        }),
      });
      // Language discipline: the payout was RECORDED here; the
      // money itself is paid by the merchant outside the system.
      setNotice(dict.commerce.payoutRecordedTheMerchantSent);
      setPayAmount(""); setPayReference(""); setPayNote("");
      await load();
      void loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.commerce.couldNotRecordPayout);
    } finally { setBusy(""); }
  }

  async function approveEntry(entry: Entry) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`approve-${entry.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/affiliates/entries/${entry.id}/approve`, { method: "POST" });
      setNotice(dict.commerce.commissionApproved);
      await load();
      if (selectedId) void loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.commerce.couldNotApprove);
    } finally { setBusy(""); }
  }

  // ED15/ED16 (EB6): row controls shared verbatim by the desktop
  // tables and the ResponsiveTable mobile cards — same handlers.
  const renderCopyLink = (p: Partner) => (
    <button type="button" onClick={() => void copyLink(p)} className="mt-1 inline-flex min-h-[44px] items-center rounded-md border bg-white px-2 py-1 text-xs font-semibold text-indigo-700">
      {dict.commerce.copyLink2}</button>
  );
  const renderPartnerActions = (p: Partner) => (
    <div className="flex flex-wrap gap-1">
      <button type="button" onClick={() => setSelectedId(p.id)} className="inline-flex min-h-[44px] items-center justify-center rounded-md border bg-white px-2 py-1 text-xs font-semibold">{dict.commerce.details}</button>
      <button type="button" onClick={() => startEdit(p)} className="inline-flex min-h-[44px] items-center justify-center rounded-md border bg-white px-2 py-1 text-xs font-semibold">{dict.commerce.edit}</button>
      <button type="button" onClick={() => void toggleStatus(p)} disabled={busy === `status-${p.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-md border bg-white px-2 py-1 text-xs font-semibold disabled:opacity-50">
        {p.status === "active" ? dict.commerce.suspend : dict.commerce.activate}
      </button>
    </div>
  );
  const renderEntryAction = (en: Entry) => (
    en.status === "pending" ? (
      <button
        type="button"
        onClick={() => void approveEntry(en)}
        disabled={busy === `approve-${en.id}`}
        className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-emerald-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
      >
        {dict.commerce.approve}</button>
    ) : null
  );

  const inputCls = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">{dict.commerce.affiliateProgram}</h1>
          <p className="text-sm text-slate-500">
            {dict.commerce.partnerSShareLink}<span className="font-mono">{dict.commerce.shopRefCode}</span>{dict.commerce.generatesACommissionEntryWhen}<b>{dict.commerce.isRecorded}</b> {dict.commerce.theSystemDoesNotSend}</p>
        </div>
        <Link href="/dashboard/commerce" className="text-sm font-semibold text-indigo-700 hover:underline">← Commerce Hub</Link>
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p> : null}

      {/* Settings */}
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-bold text-slate-900">{dict.commerce.programSettings}</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={affiliateEnabled} onChange={(e) => setAffiliateEnabled(e.target.checked)} />
            {dict.commerce.affiliateProgramOn}</label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{dict.commerce.defaultCommission}<span className="text-slate-400">{dict.commerce.empty10}</span></span>
            <input value={defaultPercent} onChange={(e) => setDefaultPercent(e.target.value)} inputMode="numeric" placeholder="10" className={inputCls} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{dict.commerce.attributionWindowDays}</span>
            <input value={attributionDays} onChange={(e) => setAttributionDays(e.target.value)} inputMode="numeric" className={inputCls} />
          </label>
        </div>
        <button type="button" onClick={saveSettings} disabled={busy === "settings"} className="btn-primary mt-4 disabled:opacity-50">
          {busy === "settings" ? dict.commerce.saving : dict.commerce.saveSettings}
        </button>
        {!affiliateEnabled ? (
          <p className="mt-3 text-sm text-amber-700">{dict.commerce.whenTheProgramIsOff}</p>
        ) : null}
      </section>

      {/* Partner form */}
      <section className="rounded-2xl border bg-white p-5">
        <h2 className="font-bold text-slate-900">{editingId ? dict.commerce.editPartner : dict.commerce.newPartner}</h2>
        <form onSubmit={submitPartner} className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{dict.commerce.name2}</span>
            <input value={fName} onChange={(e) => setFName(e.target.value)} required className={inputCls} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{dict.commerce.phone3}</span>
            <input value={fPhone} onChange={(e) => setFPhone(e.target.value)} required className={inputCls} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{dict.commerce.email}</span>
            <input value={fEmail} onChange={(e) => setFEmail(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{dict.commerce.code}<span className="text-slate-400">{dict.commerce.leaveEmptyToAutoGenerate}</span></span>
            <input value={fCode} onChange={(e) => setFCode(e.target.value)} className={`${inputCls} font-mono`} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{dict.commerce.commission2}<span className="text-slate-400">{dict.commerce.text1pq8fzt}</span></span>
            <input value={fPercent} onChange={(e) => setFPercent(e.target.value)} inputMode="numeric" className={inputCls} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">{dict.commerce.note}</span>
            <input value={fNote} onChange={(e) => setFNote(e.target.value)} className={inputCls} />
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" disabled={busy === "partner"} className="btn-primary disabled:opacity-50">
              {busy === "partner" ? dict.commerce.saving : editingId ? dict.commerce.update2 : dict.commerce.addPartner}
            </button>
            {editingId ? (
              <button type="button" onClick={resetForm} className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold">{dict.common.cancel}</button>
            ) : null}
          </div>
        </form>
      </section>

      {/* Partners table */}
      <ResponsiveTable
        table={
          <section className="rounded-2xl border bg-white">
            <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-xs text-slate-600">
              <th className="p-3">{dict.commerce.partner}</th>
              <th className="p-3">{dict.commerce.codeShareLink}</th>
              <th className="p-3">{dict.commerce.commission}</th>
              <th className="p-3">{dict.commerce.status}</th>
              <th className="p-3">{dict.commerce.pending}</th>
              <th className="p-3">{dict.commerce.approved}</th>
              <th className="p-3">{dict.commerce.paid}</th>
              <th className="p-3">{dict.commerce.dueApproved}</th>
              <th className="p-3">{dict.commerce.action}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="p-4 text-slate-500">{dict.common.loading}</td></tr>
            ) : partners.length === 0 ? (
              <tr><td colSpan={9} className="p-4 text-slate-500">{dict.commerce.noPartnersYetAddThe}</td></tr>
            ) : partners.map((p) => (
              <tr key={p.id} className={`border-b last:border-0 ${selectedId === p.id ? "bg-indigo-50/50" : ""}`}>
                <td className="p-3">
                  <div className="font-semibold text-slate-900">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.phone}</div>
                </td>
                <td className="p-3">
                  <div className="font-mono text-xs font-bold">{p.code}</div>
                  {renderCopyLink(p)}
                </td>
                <td className="p-3">{p.commissionPercent}%</td>
                <td className="p-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_CLS[p.status] ?? "bg-slate-200 text-slate-600"}`}>
                    {STATUS_LABEL[p.status] ? dict.commerce[STATUS_LABEL[p.status] as keyof typeof dict.commerce] : p.status}
                  </span>
                </td>
                <td className="p-3">{formatMinorTaka(p.aggregates?.entries.pending.commissionMinor ?? "0")}</td>
                <td className="p-3">{formatMinorTaka(p.aggregates?.entries.approved.commissionMinor ?? "0")}</td>
                <td className="p-3">{formatMinorTaka(p.aggregates?.entries.paid.commissionMinor ?? "0")}</td>
                <td className="p-3 font-semibold">{formatMinorTaka(outstandingOf(p))}</td>
                <td className="p-3">
                  {renderPartnerActions(p)}
                </td>
              </tr>
            ))}
            </tbody>
            </table>
          </section>
        }
        cards={loading ? (
          <p className="rounded-2xl border bg-white p-4 text-slate-500">{dict.common.loading}</p>
        ) : partners.length === 0 ? (
          <p className="rounded-2xl border bg-white p-4 text-slate-500">{dict.commerce.noPartnersYetAddThe}</p>
        ) : partners.map((p) => (
          <div key={p.id} className={`rounded-2xl border bg-white p-3 ${selectedId === p.id ? "bg-indigo-50/50" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-slate-900">{p.name}</div>
                <div className="text-xs text-slate-500">{p.phone}</div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_CLS[p.status] ?? "bg-slate-200 text-slate-600"}`}>
                {STATUS_LABEL[p.status] ? dict.commerce[STATUS_LABEL[p.status] as keyof typeof dict.commerce] : p.status}
              </span>
            </div>
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.codeShareLink}</dt>
                <dd>
                  <div className="font-mono text-xs font-bold">{p.code}</div>
                  {renderCopyLink(p)}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.commission}</dt>
                <dd>{p.commissionPercent}%</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.pending}</dt>
                <dd>{formatMinorTaka(p.aggregates?.entries.pending.commissionMinor ?? "0")}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.approved}</dt>
                <dd>{formatMinorTaka(p.aggregates?.entries.approved.commissionMinor ?? "0")}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.paid}</dt>
                <dd>{formatMinorTaka(p.aggregates?.entries.paid.commissionMinor ?? "0")}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-32 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.dueApproved}</dt>
                <dd className="font-semibold">{formatMinorTaka(outstandingOf(p))}</dd>
              </div>
            </dl>
            <div className="mt-2">{renderPartnerActions(p)}</div>
          </div>
        ))}
      />

      {/* Selected partner detail */}
      {selectedId ? (
        <section className="rounded-2xl border bg-white p-5">
          <h2 className="font-bold text-slate-900">
            {dict.commerce.partnerDetails}{detail ? `— ${detail.name}` : ""}
          </h2>
          {detailLoading || !detail ? (
            <p className="mt-3 text-sm text-slate-500">{dict.common.loading}</p>
          ) : (
            <div className="mt-4 space-y-5">
              <div className="grid gap-3 sm:grid-cols-5">
                {[
                  [dict.commerce.pendingCommission, detail.balances.pendingMinor],
                  [dict.commerce.approvedCommission, detail.balances.approvedMinor],
                  [dict.commerce.paidCommission, detail.balances.paidMinor],
                  [dict.commerce.totalPayoutRecords, detail.balances.paidOutMinor],
                  [dict.commerce.dueApproved, detail.balances.outstandingApprovedMinor],
                ].map(([label, v]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-3">
                    <div className="text-xs font-medium text-slate-500">{label}</div>
                    <div className="mt-1 text-lg font-black text-slate-900">{formatMinorTaka(v)}</div>
                  </div>
                ))}
              </div>

              {detail.paidOnRefundedOrders > 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                  ⚠️ {detail.paidOnRefundedOrders}{dict.commerce.paidCommissionsOrdersWereLater}</p>
              ) : null}

              {/* Payout record form */}
              <form onSubmit={submitPayout} className="grid gap-3 rounded-xl border border-dashed p-4 sm:grid-cols-5">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">{dict.commerce.payoutAmountTaka}</span>
                  <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" placeholder="1500" className={inputCls} />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">{dict.commerce.method2}</span>
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className={inputCls}>
                    {Object.entries(METHOD_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>{dict.commerce[v as keyof typeof dict.commerce]}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">{dict.commerce.referenceTrxID}</span>
                  <input value={payReference} onChange={(e) => setPayReference(e.target.value)} className={inputCls} />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">{dict.commerce.note}</span>
                  <input value={payNote} onChange={(e) => setPayNote(e.target.value)} className={inputCls} />
                </label>
                <div className="flex items-end">
                  <button type="submit" disabled={busy === "payout"} className="btn-primary disabled:opacity-50">
                    {busy === "payout" ? dict.commerce.recording : dict.commerce.recordPayout}
                  </button>
                </div>
                <p className="text-xs text-slate-500 sm:col-span-5">
                  {dict.commerce.thisRecordOnlyKeepsAccounts}</p>
              </form>

              {/* Payout history */}
              <div>
                <h3 className="text-sm font-bold text-slate-800">{dict.commerce.payoutHistory}</h3>
                {detail.payouts.length === 0 ? (
                  <p className="mt-1 text-sm text-slate-500">{dict.commerce.noPayoutRecordsYet}</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {detail.payouts.map((po) => (
                      <li key={po.id} className="flex flex-wrap gap-x-3 rounded-lg bg-slate-50 px-3 py-2">
                        <span className="font-bold">{formatMinorTaka(po.amountMinor)}</span>
                        <span>{METHOD_LABEL[po.method] ? dict.commerce[METHOD_LABEL[po.method] as keyof typeof dict.commerce] : po.method}</span>
                        {po.reference ? <span className="font-mono text-xs">{po.reference}</span> : null}
                        <span className="text-slate-500">
                          {po.createdAt ? fmtDateTime(locale, new Date(po.createdAt)) : ""}
                        </span>
                        {po.note ? <span className="text-slate-500">{po.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Entries */}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-800">{dict.commerce.commissionEntries}</h3>
                  <select value={entryStatus} onChange={(e) => setEntryStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
                    <option value="">{dict.commerce.allStatuses}</option>
                    <option value="pending">{dict.commerce.pending}</option>
                    <option value="approved">{dict.commerce.approved}</option>
                    <option value="paid">{dict.commerce.paid}</option>
                    <option value="voided">{dict.common.cancel}</option>
                  </select>
                </div>
                <ResponsiveTable
                  className="mt-2"
                  table={
                    <div className="rounded-xl border">
                      <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50 text-xs text-slate-600">
                        <th className="p-3">{dict.commerce.order}</th>
                        <th className="p-3">{dict.commerce.base}</th>
                        <th className="p-3">{dict.commerce.rate}</th>
                        <th className="p-3">{dict.commerce.commission}</th>
                        <th className="p-3">{dict.commerce.status}</th>
                        <th className="p-3">{dict.commerce.date}</th>
                        <th className="p-3">{dict.commerce.action}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.length === 0 ? (
                        <tr><td colSpan={7} className="p-4 text-slate-500">{dict.commerce.noEntries}</td></tr>
                      ) : entries.map((en) => (
                        <tr key={en.id} className="border-b last:border-0">
                          <td className="p-3 font-mono text-xs">{en.orderNumber ?? en.orderId}</td>
                          <td className="p-3">{formatMinorTaka(en.baseMinor)}</td>
                          <td className="p-3">{en.percentSnapshot}%</td>
                          <td className="p-3 font-semibold">{formatMinorTaka(en.commissionMinor)}</td>
                          <td className="p-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_CLS[en.status] ?? "bg-slate-200 text-slate-600"}`}>
                              {STATUS_LABEL[en.status] ? dict.commerce[STATUS_LABEL[en.status] as keyof typeof dict.commerce] : en.status}
                            </span>
                            {en.status === "voided" && en.voidReason ? (
                              <span className="ml-1 text-xs text-slate-500">({en.voidReason})</span>
                            ) : null}
                          </td>
                          <td className="p-3 text-slate-500">
                            {en.createdAt ? fmtDate(locale, new Date(en.createdAt)) : ""}
                          </td>
                          <td className="p-3">
                            {renderEntryAction(en)}
                          </td>
                        </tr>
                      ))}
                      </tbody>
                      </table>
                    </div>
                  }
                  cards={entries.length === 0 ? (
                    <p className="rounded-xl border p-4 text-slate-500">{dict.commerce.noEntries}</p>
                  ) : entries.map((en) => (
                    <div key={en.id} className="rounded-xl border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-xs">{en.orderNumber ?? en.orderId}</span>
                        <span className="font-semibold">{formatMinorTaka(en.commissionMinor)}</span>
                      </div>
                      <dl className="mt-2 space-y-1.5 text-sm">
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.base}</dt>
                          <dd>{formatMinorTaka(en.baseMinor)}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.rate}</dt>
                          <dd>{en.percentSnapshot}%</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.status}</dt>
                          <dd>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_CLS[en.status] ?? "bg-slate-200 text-slate-600"}`}>
                              {STATUS_LABEL[en.status] ? dict.commerce[STATUS_LABEL[en.status] as keyof typeof dict.commerce] : en.status}
                            </span>
                            {en.status === "voided" && en.voidReason ? (
                              <span className="ml-1 text-xs text-slate-500">({en.voidReason})</span>
                            ) : null}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.date}</dt>
                          <dd className="text-slate-500">
                            {en.createdAt ? fmtDate(locale, new Date(en.createdAt)) : ""}
                          </dd>
                        </div>
                      </dl>
                      {renderEntryAction(en) ? <div className="mt-2">{renderEntryAction(en)}</div> : null}
                    </div>
                  ))}
                />
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
