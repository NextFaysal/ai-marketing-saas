"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { fmtDate, fmtDateTime, fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { ResponsiveTable } from "@repo/ui";

// AB2 (AX3) — gift cards staff page: settings, liability,
// manual issue, card list + ledger detail with void / adjust.
// Shapes mirror apps/api/src/commerce/gift-cards.service.ts
// (serializeCard / serializeLedgerEntry / liabilityReport).
// Money arrives as minor-unit STRINGS. SECURITY RULE of the
// whole surface: a full code is NEVER shown here — staff see
// codePrefix + codeLast4 only; a manually issued code goes
// only to the recipient's email/phone.

interface GiftCardSetting {
  redemptionEnabled: boolean;
  defaultExpiryDays: number | null;
}

interface GiftCardRow {
  id: string;
  codePrefix: string;
  codeLast4: string | null;
  initialAmountMinor: string;
  balanceMinor: string;
  status: string;
  source: string | null;
  issuedOrderId: string | null;
  recipientName: string | null;
  expiresAt: string | null;
  createdAt: string | null;
}

interface LedgerEntry {
  id: string;
  kind: string;
  deltaMinor: string;
  balanceAfter: string;
  orderId: string | null;
  note: string | null;
  createdAt: string | null;
}

interface GiftCardDetail extends GiftCardRow {
  recipientEmail: string | null;
  recipientPhone: string | null;
  recipientMessage: string | null;
  note: string | null;
  ledger: LedgerEntry[];
}

interface Liability {
  outstandingMinor: string;
  outstandingCount: number;
  issuedMinor: string;
  redeemedMinor: string;
  restoredMinor: string;
  expiredMinor: string;
  voidedMinor: string;
  adjustedNetMinor: string;
  from: string;
  to: string;
  truncated: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  active: "active",
  depleted: "balanceFinished",
  expired: "expired",
  void: "cancel",
};

const STATUS_FILTERS: { value: string; labelKey: string }[] = [
  { value: "", labelKey: "allStatuses" },
  { value: "active", labelKey: "active" },
  { value: "depleted", labelKey: "balanceFinished" },
  { value: "expired", labelKey: "expired" },
  { value: "void", labelKey: "cancel" },
];

const KIND_LABELS: Record<string, string> = {
  issue: "issue",
  redeem: "redeem",
  restore: "refund",
  adjust: "adjustment",
  void: "cancel",
  expire: "expired",
};

// Internal notes the API itself writes on ledger rows.
const NOTE_LABELS: Record<string, string> = {
  redeem_restore: "returnedOnRefund",
  purchase_refund_void: "voidedOnPurchaseOrderCancellation",
  card_expired: "voidedOnExpiry",
};

function money(minor: string, locale: "bn" | "en" = "bn"): string {
  try {
    return fmtMoneyMinor(locale, BigInt(minor));
  } catch {
    return minor;
  }
}

function signedMoney(minor: string, locale: "bn" | "en" = "bn"): string {
  try {
    const v = BigInt(minor);
    return `${v < 0n ? "−" : "+"} ${money(String(v < 0n ? -v : v), locale)}`;
  } catch {
    return minor;
  }
}

/** Taka input → minor-unit string (null when not a usable number). */
function takaToMinorString(raw: string): string | null {
  const n = Number(raw);
  if (!raw.trim() || !Number.isFinite(n)) return null;
  return String(Math.round(n * 100));
}

const PAGE_SIZE = 20;

export default function GiftCardsPage() {
  const { dict, t, locale } = useLocale();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // --- settings ---
  const [redemptionEnabled, setRedemptionEnabled] = useState(true);
  const [defaultExpiryDays, setDefaultExpiryDays] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);

  // --- liability ---
  const [liability, setLiability] = useState<Liability | null>(null);

  // --- manual issue ---
  const [issueAmount, setIssueAmount] = useState("");
  const [issueName, setIssueName] = useState("");
  const [issueEmail, setIssueEmail] = useState("");
  const [issuePhone, setIssuePhone] = useState("");
  const [issueNote, setIssueNote] = useState("");
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueWarning, setIssueWarning] = useState("");

  // --- list ---
  const [items, setItems] = useState<GiftCardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [listBusy, setListBusy] = useState(false);

  // --- detail ---
  const [detail, setDetail] = useState<GiftCardDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [voidNote, setVoidNote] = useState("");
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [confirming, setConfirming] = useState<"void" | "adjust" | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const loadSettings = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const out = await apiFetch<{ setting: GiftCardSetting }>(
        `/organizations/${orgId}/commerce/gift-cards/settings`,
      );
      setRedemptionEnabled(out.setting.redemptionEnabled !== false);
      setDefaultExpiryDays(out.setting.defaultExpiryDays != null ? String(out.setting.defaultExpiryDays) : "");
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.settingsLoadingFailed); }
  }, []);

  const loadLiability = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      setLiability(await apiFetch<Liability>(`/organizations/${orgId}/commerce/gift-cards/liability`));
    } catch { /* the card simply stays unloaded — issuing/listing still work */ }
  }, []);

  const loadList = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setListBusy(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter) params.set("status", statusFilter);
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      const out = await apiFetch<{ items: GiftCardRow[]; total: number }>(
        `/organizations/${orgId}/commerce/gift-cards?${params.toString()}`,
      );
      setItems(out.items ?? []);
      setTotal(out.total ?? 0);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.listLoadingFailed); }
    finally { setListBusy(false); }
  }, [search, statusFilter, page]);

  useEffect(() => { void loadSettings(); void loadLiability(); }, [loadSettings, loadLiability]);
  useEffect(() => { void loadList(); }, [loadList]);

  async function saveSettings() {
    const orgId = getOrganizationId(); if (!orgId) return;
    let expiry: number | null = null;
    if (defaultExpiryDays.trim()) {
      const n = Number(defaultExpiryDays);
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        setError(dict.commerce.giveTheDefaultValidityAs);
        return;
      }
      expiry = n;
    }
    setSettingsBusy(true); setError(""); setNotice("");
    try {
      await apiFetch<{ setting: GiftCardSetting }>(
        `/organizations/${orgId}/commerce/gift-cards/settings`,
        { method: "PUT", body: JSON.stringify({ redemptionEnabled, defaultExpiryDays: expiry }) },
      );
      setNotice(dict.commerce.giftCardSettingsSaved);
      await loadSettings();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.saveFailed); }
    finally { setSettingsBusy(false); }
  }

  const issueReady = !!takaToMinorString(issueAmount) && Number(issueAmount) > 0
    && !!issueNote.trim() && (!!issueEmail.trim() || !!issuePhone.trim());

  async function manualIssue(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    const amountMinor = takaToMinorString(issueAmount);
    if (!amountMinor) return;
    setIssueBusy(true); setError(""); setNotice(""); setIssueWarning("");
    try {
      const out = await apiFetch<{ card: GiftCardRow; sentVia: string }>(
        `/organizations/${orgId}/commerce/gift-cards/issue`,
        {
          method: "POST",
          body: JSON.stringify({
            amountMinor,
            recipientName: issueName.trim() || undefined,
            recipientEmail: issueEmail.trim() || undefined,
            recipientPhone: issuePhone.trim() || undefined,
            note: issueNote.trim(),
          }),
        },
      );
      if (out.sentVia === "email" || out.sentVia === "sms") {
        setNotice(t("commerce.cardIssuedTheCodeHas", { out: out.sentVia === "email" ? dict.commerce.email : dict.commerce.sMS }));
      } else {
        // Honest failure: the card exists but NO send happened.
        setIssueWarning(
          t("commerce.theCardWasCreatedBut", { out: out.card.codeLast4 ?? "" }),
        );
      }
      setIssueAmount(""); setIssueName(""); setIssueEmail(""); setIssuePhone(""); setIssueNote("");
      setPage(1);
      await Promise.all([loadList(), loadLiability()]);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.issueFailed); }
    finally { setIssueBusy(false); }
  }

  async function openDetail(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setDetailBusy(true); setError("");
    setVoidNote(""); setAdjustDelta(""); setAdjustNote(""); setConfirming(null);
    try {
      setDetail(await apiFetch<GiftCardDetail>(`/organizations/${orgId}/commerce/gift-cards/${id}`));
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.detailsLoadingFailed2); }
    finally { setDetailBusy(false); }
  }

  async function reloadDetail(id: string) {
    await Promise.all([loadList(), loadLiability()]);
    await openDetail(id);
  }

  async function doVoid() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    if (confirming !== "void") { setConfirming("void"); return; }
    setActionBusy(true); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/gift-cards/${detail.id}/void`, {
        method: "POST", body: JSON.stringify({ note: voidNote.trim() }),
      });
      setNotice(dict.commerce.theCardHasBeenVoided);
      setConfirming(null);
      await reloadDetail(detail.id);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.cancellationFailed); }
    finally { setActionBusy(false); }
  }

  async function doAdjust() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    if (confirming !== "adjust") { setConfirming("adjust"); return; }
    const deltaMinor = takaToMinorString(adjustDelta);
    if (!deltaMinor || deltaMinor === "0") { setError(dict.commerce.writeTheAdjustmentAmountIn); return; }
    setActionBusy(true); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/gift-cards/${detail.id}/adjust`, {
        method: "POST", body: JSON.stringify({ deltaMinor, note: adjustNote.trim() }),
      });
      setNotice(dict.commerce.cardBalanceAdjusted);
      setConfirming(null);
      await reloadDetail(detail.id);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.adjustmentFailed); }
    finally { setActionBusy(false); }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const dateFmt = (iso: string | null) => (iso ? fmtDate(locale, new Date(iso)) : "—");
  const detailActionable = detail && detail.status !== "void" && detail.status !== "expired";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{dict.commerce.giftCards}</h1>
          <p className="text-sm text-slate-500">
            {dict.commerce.giftCardLiabilityManualIssue}</p>
        </div>
        <Link href="/dashboard/commerce" className="btn-primary">Commerce Hub →</Link>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
      {issueWarning ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{issueWarning}</p> : null}

      {/* ---------- settings ---------- */}
      <div className="card p-5 space-y-4">
        <div>
          <div className="font-semibold">{dict.commerce.giftCardSettings}</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {dict.commerce.theDefaultValidityAppliesTo}</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={redemptionEnabled} onChange={(e) => setRedemptionEnabled(e.target.checked)} />
          {dict.commerce.keepGiftCardShoppingRedeem}</label>
        <p className="text-xs text-slate-500">{dict.commerce.ifTurnedOffExistingCards}</p>
        <label className="block max-w-xs text-sm">{dict.commerce.defaultValidityDaysEmptyNo}<input className="input mt-1" type="number" min="1" max="3650" value={defaultExpiryDays} onChange={(e) => setDefaultExpiryDays(e.target.value)} placeholder={dict.commerce.emptyNoExpiry} />
        </label>
        <button type="button" className="btn-primary" disabled={settingsBusy} onClick={() => void saveSettings()}>
          {settingsBusy ? dict.commerce.saving2 : dict.commerce.saveSettings2}
        </button>
      </div>

      {/* ---------- liability ---------- */}
      <div className="card p-5 space-y-3">
        <div className="font-semibold">{dict.commerce.giftCardLiability}</div>
        {liability ? (
          <>
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-3xl font-bold">{money(liability.outstandingMinor, locale)}</span>
              <span className="text-sm text-slate-500">{dict.commerce.outstandingBalanceActiveCards}{liability.outstandingCount}{dict.commerce.text1ou8}</span>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <p>{dict.commerce.issuedInPeriod}<b>{money(liability.issuedMinor, locale)}</b></p>
              <p>{dict.commerce.redeemedInPeriod}<b>{money(liability.redeemedMinor, locale)}</b></p>
              <p>{dict.commerce.restoredInPeriod}<b>{money(liability.restoredMinor, locale)}</b></p>
              <p>{dict.commerce.expiredInPeriod}<b>{money(liability.expiredMinor, locale)}</b></p>
              <p>{dict.commerce.voidedInPeriod}<b>{money(liability.voidedMinor, locale)}</b></p>
              <p>{dict.commerce.adjustedInPeriodNet}<b>{signedMoney(liability.adjustedNetMinor, locale)}</b></p>
            </div>
            <p className="text-xs text-slate-500">
              {dict.commerce.period2}{dateFmt(liability.from)} — {dateFmt(liability.to)}
              {liability.truncated ? dict.commerce.theCountMayBePartial : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-500">{dict.common.loading}</p>
        )}
        <p className="text-xs text-slate-500">{dict.commerce.theseAreSumsOfThe}</p>
      </div>

      {/* ---------- manual issue ---------- */}
      <form onSubmit={manualIssue} className="card p-5 space-y-4">
        <div>
          <div className="font-semibold">{dict.commerce.issueAGiftCardManually}</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {dict.commerce.forSecurityTheFullCode}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">{dict.commerce.amount}<input className="input mt-1" type="number" min="0" step="0.01" value={issueAmount} onChange={(e) => setIssueAmount(e.target.value)} placeholder={dict.commerce.eG10002} />
          </label>
          <label className="block text-sm">{dict.commerce.recipientName}<input className="input mt-1" value={issueName} onChange={(e) => setIssueName(e.target.value)} />
          </label>
          <label className="block text-sm">{dict.commerce.recipientEmail}<input className="input mt-1" type="email" value={issueEmail} onChange={(e) => setIssueEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label className="block text-sm">{dict.commerce.recipientPhone}<input className="input mt-1" type="tel" value={issuePhone} onChange={(e) => setIssuePhone(e.target.value)} placeholder="01XXXXXXXXX" />
          </label>
          <label className="block text-sm md:col-span-2">{dict.commerce.noteWhyItIsBeing}<input className="input mt-1" value={issueNote} onChange={(e) => setIssueNote(e.target.value)} placeholder={dict.commerce.eGCampaignWinnerS} />
          </label>
        </div>
        {!issueNote.trim() ? <p className="text-xs text-slate-500">{dict.commerce.aNoteIsMandatoryEvery}</p> : null}
        {!issueEmail.trim() && !issuePhone.trim() ? <p className="text-xs text-slate-500">{dict.commerce.giveAtLeastOneOf}</p> : null}
        <button type="submit" className="btn-primary" disabled={issueBusy || !issueReady}>
          {issueBusy ? dict.commerce.issuing : dict.commerce.issueGiftCard}
        </button>
      </form>

      {/* ---------- list + detail ---------- */}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="card p-5 space-y-4">
          <div className="font-semibold">{dict.commerce.cardList}</div>
          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={dict.commerce.searchByLast4Digits} aria-label={dict.commerce.searchByLast4Digits}
              className="w-56 rounded-lg border px-3 py-2 font-mono text-sm"
            />
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-lg border px-3 py-2 text-sm">
              {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{dict.commerce[s.labelKey as keyof typeof dict.commerce]}</option>)}
            </select>
          </div>
          {listBusy ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : items.length === 0 ? (
            <p className="text-sm text-slate-500">{dict.commerce.noGiftCardsFound}</p>
          ) : (
            <ResponsiveTable
              table={
                <div>
                  <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-slate-500">
                    <th className="py-2 pr-2">{dict.commerce.code}</th>
                    <th className="py-2 pr-2">{dict.commerce.initial}</th>
                    <th className="py-2 pr-2">{dict.commerce.balance}</th>
                    <th className="py-2 pr-2">{dict.commerce.status}</th>
                    <th className="py-2 pr-2">{dict.commerce.source}</th>
                    <th className="py-2">{dict.commerce.validity}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => void openDetail(c.id)}
                      className={`cursor-pointer border-b hover:bg-slate-50 ${detail?.id === c.id ? "bg-pink-50/60" : ""}`}
                    >
                      <td className="py-2 pr-2 font-mono font-semibold">{c.codePrefix} ••••{c.codeLast4 ?? ""}</td>
                      <td className="py-2 pr-2">{money(c.initialAmountMinor, locale)}</td>
                      <td className="py-2 pr-2 font-semibold">{money(c.balanceMinor, locale)}</td>
                      <td className="py-2 pr-2">{STATUS_LABELS[c.status] ? dict.commerce[STATUS_LABELS[c.status] as keyof typeof dict.commerce] : c.status}</td>
                      <td className="py-2 pr-2">{c.source === "manual" ? dict.commerce.manual : c.source === "purchase" ? dict.commerce.order : (c.source ?? "—")}</td>
                      <td className="py-2">{c.expiresAt ? dateFmt(c.expiresAt) : dict.commerce.noExpiry}</td>
                    </tr>
                  ))}
                  </tbody>
                  </table>
                </div>
              }
              cards={items.map((c) => (
                <div
                  key={c.id}
                  onClick={() => void openDetail(c.id)}
                  className={`cursor-pointer rounded-lg border p-3 hover:bg-slate-50 ${detail?.id === c.id ? "bg-pink-50/60" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono font-semibold">{c.codePrefix} ••••{c.codeLast4 ?? ""}</span>
                    <span>{STATUS_LABELS[c.status] ? dict.commerce[STATUS_LABELS[c.status] as keyof typeof dict.commerce] : c.status}</span>
                  </div>
                  <dl className="mt-2 space-y-1.5 text-sm">
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.initial}</dt>
                      <dd>{money(c.initialAmountMinor, locale)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.balance}</dt>
                      <dd className="font-semibold">{money(c.balanceMinor, locale)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.source}</dt>
                      <dd>{c.source === "manual" ? dict.commerce.manual : c.source === "purchase" ? dict.commerce.order : (c.source ?? "—")}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-xs font-semibold text-slate-500">{dict.commerce.validity}</dt>
                      <dd>{c.expiresAt ? dateFmt(c.expiresAt) : dict.commerce.noExpiry}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            />
          )}
          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="inline-flex min-h-[44px] items-center rounded-lg border bg-white px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">{dict.commerce.previousPage}</button>
              <span className="text-xs font-semibold text-slate-500">{dict.commerce.page}{page} / {totalPages} {dict.commerce.total2}{total}{dict.commerce.text1ou8}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="inline-flex min-h-[44px] items-center rounded-lg border bg-white px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">{dict.commerce.nextPage}</button>
            </div>
          ) : null}
        </div>

        {/* detail panel */}
        <div className="card h-fit p-5 space-y-4">
          <div className="font-semibold">{dict.commerce.cardDetails}</div>
          {detailBusy ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : !detail ? (
            <p className="text-sm text-slate-500">{dict.commerce.clickingACardInThe}</p>
          ) : (
            <>
              <div className="space-y-1 text-sm">
                <p className="font-mono text-base font-bold">{detail.codePrefix} ••••{detail.codeLast4 ?? ""}</p>
                <p>{dict.commerce.initial2}<b>{money(detail.initialAmountMinor, locale)}</b> {dict.commerce.balance2}<b>{money(detail.balanceMinor, locale)}</b></p>
                <p>{dict.commerce.status3}<b>{STATUS_LABELS[detail.status] ? dict.commerce[STATUS_LABELS[detail.status] as keyof typeof dict.commerce] : detail.status}</b> {dict.commerce.source3}<b>{detail.source === "manual" ? dict.commerce.manual : detail.source === "purchase" ? dict.commerce.order : (detail.source ?? "—")}</b></p>
                {detail.recipientName ? <p>{dict.commerce.recipient}{detail.recipientName}</p> : null}
                {detail.recipientEmail ? <p>{dict.commerce.recipientEmail2}<span className="font-mono">{detail.recipientEmail}</span></p> : null}
                {detail.recipientPhone ? <p>{dict.commerce.recipientPhone2}<span className="font-mono">{detail.recipientPhone}</span></p> : null}
                {detail.issuedOrderId ? <p>{dict.commerce.issueOrder}<span className="font-mono text-xs">{detail.issuedOrderId}</span></p> : null}
                <p>{dict.commerce.created}{detail.createdAt ? fmtDateTime(locale, new Date(detail.createdAt)) : "—"} {dict.commerce.expiry}{detail.expiresAt ? dateFmt(detail.expiresAt) : dict.commerce.none2}</p>
                {detail.note ? <p className="text-slate-500">{dict.commerce.note2}{detail.note}</p> : null}
              </div>

              <div className="border-t pt-3">
                <p className="mb-2 text-sm font-semibold">{dict.commerce.ledger}</p>
                {detail.ledger.length === 0 ? (
                  <p className="text-sm text-slate-500">{dict.commerce.noLedgerEntries}</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.ledger.map((e) => (
                      <li key={e.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{KIND_LABELS[e.kind] ? dict.commerce[KIND_LABELS[e.kind] as keyof typeof dict.commerce] : e.kind}</span>
                          <span className={`font-bold ${e.deltaMinor.startsWith("-") ? "text-rose-600" : "text-emerald-700"}`}>{signedMoney(e.deltaMinor, locale)}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {dict.commerce.balanceAfterEntry}{money(e.balanceAfter, locale)} · {e.createdAt ? fmtDateTime(locale, new Date(e.createdAt)) : ""}
                        </p>
                        {e.note ? <p className="mt-0.5 text-xs text-slate-500">{NOTE_LABELS[e.note] ? dict.commerce[NOTE_LABELS[e.note] as keyof typeof dict.commerce] : e.note}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {detailActionable ? (
                <div className="space-y-4 border-t pt-3">
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-rose-700">{dict.commerce.voidCard}</p>
                    <input value={voidNote} onChange={(e) => { setVoidNote(e.target.value); setConfirming(null); }} placeholder={dict.commerce.voidReasonNote} aria-label={dict.commerce.voidReasonNote2} className="w-full rounded-lg border px-3 py-2 text-sm" />
                    <button
                      type="button"
                      disabled={actionBusy || !voidNote.trim()}
                      onClick={() => void doVoid()}
                      className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {confirming === "void" ? dict.commerce.confirmTheCardWillBe : dict.commerce.cancel2}
                    </button>
                    {confirming === "void" ? <p className="text-xs text-rose-600">{dict.commerce.clickingAgainWillPermanentlyVoid}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">{dict.commerce.adjustBalance}</p>
                    <input value={adjustDelta} onChange={(e) => { setAdjustDelta(e.target.value); setConfirming(null); }} type="number" step="0.01" placeholder={dict.commerce.amountToIncreaseToDecrease} aria-label={dict.commerce.adjustmentAmountTakaToIncrease} className="w-full rounded-lg border px-3 py-2 text-sm" />
                    <input value={adjustNote} onChange={(e) => { setAdjustNote(e.target.value); setConfirming(null); }} placeholder={dict.commerce.adjustmentReasonNote} aria-label={dict.commerce.adjustmentReasonNote2} className="w-full rounded-lg border px-3 py-2 text-sm" />
                    <button
                      type="button"
                      disabled={actionBusy || !adjustNote.trim() || !adjustDelta.trim()}
                      onClick={() => void doAdjust()}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {confirming === "adjust" ? dict.commerce.confirmTheAdjustmentWillApply : dict.commerce.adjust}
                    </button>
                    {confirming === "adjust" ? <p className="text-xs text-slate-500">{dict.commerce.clickingAgainWillWriteThe}</p> : null}
                  </div>
                </div>
              ) : (
                <p className="border-t pt-3 text-xs text-slate-500">{dict.commerce.voidedExpiredCardsCannotBe}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
