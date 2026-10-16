"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatMinor } from "@repo/contracts";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

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
  active: "সক্রিয়",
  depleted: "ব্যালেন্স শেষ",
  expired: "মেয়াদোত্তীর্ণ",
  void: "বাতিল",
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "সব অবস্থা" },
  { value: "active", label: "সক্রিয়" },
  { value: "depleted", label: "ব্যালেন্স শেষ" },
  { value: "expired", label: "মেয়াদোত্তীর্ণ" },
  { value: "void", label: "বাতিল" },
];

const KIND_LABELS: Record<string, string> = {
  issue: "ইস্যু",
  redeem: "রিডিম",
  restore: "ফেরত",
  adjust: "সংশোধন",
  void: "বাতিল",
  expire: "মেয়াদোত্তীর্ণ",
};

// Internal notes the API itself writes on ledger rows.
const NOTE_LABELS: Record<string, string> = {
  redeem_restore: "রিফান্ডে ফেরত",
  purchase_refund_void: "ক্রয়ের অর্ডার বাতিল/রিফান্ডে বাতিল",
  card_expired: "মেয়াদ শেষে বাতিল",
};

function money(minor: string): string {
  try {
    return formatMinor(BigInt(minor));
  } catch {
    return minor;
  }
}

function signedMoney(minor: string): string {
  try {
    const v = BigInt(minor);
    return `${v < 0n ? "−" : "+"} ${money(String(v < 0n ? -v : v))}`;
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
    } catch (e) { setError(e instanceof Error ? e.message : "সেটিংস লোড ব্যর্থ"); }
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
    } catch (e) { setError(e instanceof Error ? e.message : "তালিকা লোড ব্যর্থ"); }
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
        setError("ডিফল্ট মেয়াদ ১–৩৬৫০ দিনের মধ্যে পূর্ণ সংখ্যায় দিন, অথবা খালি রাখুন (মেয়াদ নেই)।");
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
      setNotice("গিফট কার্ড সেটিংস সংরক্ষণ হয়েছে।");
      await loadSettings();
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ"); }
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
        setNotice(`✅ কার্ড ইস্যু হয়েছে — কোডটি প্রাপকের কাছে পাঠানো হয়েছে (${out.sentVia === "email" ? "ইমেইল" : "এসএমএস"})।`);
      } else {
        // Honest failure: the card exists but NO send happened.
        setIssueWarning(
          `⚠️ কার্ড তৈরি হয়েছে (••••${out.card.codeLast4 ?? ""}), কিন্তু কোডটি প্রাপকের কাছে পাঠানো যায়নি — পাঠানোর মাধ্যম সেটআপ করা নেই বা পাঠাতে ব্যর্থ হয়েছে। প্রাপকের সাথে যোগাযোগ করে বিকল্প ব্যবস্থা নিন; পূর্ণ কোড এখানে দেখা যায় না।`,
        );
      }
      setIssueAmount(""); setIssueName(""); setIssueEmail(""); setIssuePhone(""); setIssueNote("");
      setPage(1);
      await Promise.all([loadList(), loadLiability()]);
    } catch (e) { setError(e instanceof Error ? e.message : "ইস্যু ব্যর্থ"); }
    finally { setIssueBusy(false); }
  }

  async function openDetail(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setDetailBusy(true); setError("");
    setVoidNote(""); setAdjustDelta(""); setAdjustNote(""); setConfirming(null);
    try {
      setDetail(await apiFetch<GiftCardDetail>(`/organizations/${orgId}/commerce/gift-cards/${id}`));
    } catch (e) { setError(e instanceof Error ? e.message : "বিবরণ লোড ব্যর্থ"); }
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
      setNotice("কার্ডটি বাতিল করা হয়েছে।");
      setConfirming(null);
      await reloadDetail(detail.id);
    } catch (e) { setError(e instanceof Error ? e.message : "বাতিল ব্যর্থ"); }
    finally { setActionBusy(false); }
  }

  async function doAdjust() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    if (confirming !== "adjust") { setConfirming("adjust"); return; }
    const deltaMinor = takaToMinorString(adjustDelta);
    if (!deltaMinor || deltaMinor === "0") { setError("সংশোধনের পরিমাণ শূন্য ছাড়া টাকায় লিখুন (+ বা − চিহ্নসহ)।"); return; }
    setActionBusy(true); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/gift-cards/${detail.id}/adjust`, {
        method: "POST", body: JSON.stringify({ deltaMinor, note: adjustNote.trim() }),
      });
      setNotice("কার্ডের ব্যালেন্স সংশোধন করা হয়েছে।");
      setConfirming(null);
      await reloadDetail(detail.id);
    } catch (e) { setError(e instanceof Error ? e.message : "সংশোধন ব্যর্থ"); }
    finally { setActionBusy(false); }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const dateFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("bn-BD") : "—");
  const detailActionable = detail && detail.status !== "void" && detail.status !== "expired";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">🎁 গিফট কার্ড</h1>
          <p className="text-sm text-slate-500">
            গিফট কার্ডের দায় (liability), ম্যানুয়াল ইস্যু, কার্ডের তালিকা ও লেজার — সব এখানে।
            পূর্ণ কোড এখানে কখনো দেখানো হয় না; স্টাফ শুধু কার্ডের শেষ ৪ সংখ্যা দেখতে পান।
          </p>
        </div>
        <Link href="/dashboard/commerce" className="btn-primary">Commerce Hub →</Link>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
      {issueWarning ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{issueWarning}</p> : null}

      {/* ---------- settings ---------- */}
      <div className="card p-5 space-y-4">
        <div>
          <div className="font-semibold">⚙️ গিফট কার্ড সেটিংস</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            ডিফল্ট মেয়াদ নতুন ইস্যু হওয়া কার্ডের ক্ষেত্রে প্রযোজ্য — আগের কার্ডের মেয়াদ এতে বদলায় না।
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={redemptionEnabled} onChange={(e) => setRedemptionEnabled(e.target.checked)} />
          গিফট কার্ডে কেনাকাটা (রিডিম) চালু রাখুন
        </label>
        <p className="text-xs text-slate-500">বন্ধ করলে বিদ্যমান কার্ড দিয়ে আর কেনাকাটা করা যাবে না — ব্যালেন্স থেকে যাবে।</p>
        <label className="block max-w-xs text-sm">ডিফল্ট মেয়াদ (দিন) — খালি = মেয়াদ নেই
          <input className="input mt-1" type="number" min="1" max="3650" value={defaultExpiryDays} onChange={(e) => setDefaultExpiryDays(e.target.value)} placeholder="খালি = মেয়াদ নেই" />
        </label>
        <button type="button" className="btn-primary" disabled={settingsBusy} onClick={() => void saveSettings()}>
          {settingsBusy ? "সেভ হচ্ছে…" : "সেটিংস সেভ করুন"}
        </button>
      </div>

      {/* ---------- liability ---------- */}
      <div className="card p-5 space-y-3">
        <div className="font-semibold">📊 গিফট কার্ডের দায় (Liability)</div>
        {liability ? (
          <>
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-3xl font-bold">{money(liability.outstandingMinor)}</span>
              <span className="text-sm text-slate-500">বকেয়া ব্যালেন্স · সক্রিয় কার্ড {liability.outstandingCount}টি</span>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <p>সময়কালে ইস্যু: <b>{money(liability.issuedMinor)}</b></p>
              <p>সময়কালে রিডিম: <b>{money(liability.redeemedMinor)}</b></p>
              <p>সময়কালে ফেরত (restore): <b>{money(liability.restoredMinor)}</b></p>
              <p>সময়কালে মেয়াদোত্তীর্ণ: <b>{money(liability.expiredMinor)}</b></p>
              <p>সময়কালে বাতিল: <b>{money(liability.voidedMinor)}</b></p>
              <p>সময়কালে সংশোধন (নিট): <b>{signedMoney(liability.adjustedNetMinor)}</b></p>
            </div>
            <p className="text-xs text-slate-400">
              সময়কাল: {dateFmt(liability.from)} — {dateFmt(liability.to)}
              {liability.truncated ? " · কার্ডের সংখ্যা অনেক বেশি হওয়ায় হিসাব আংশিক হতে পারে" : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-500">লোড হচ্ছে…</p>
        )}
        <p className="text-xs text-slate-500">এগুলো সিস্টেমের রেকর্ডের যোগফল।</p>
      </div>

      {/* ---------- manual issue ---------- */}
      <form onSubmit={manualIssue} className="card p-5 space-y-4">
        <div>
          <div className="font-semibold">➕ ম্যানুয়ালি গিফট কার্ড ইস্যু করুন</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            নিরাপত্তার জন্য পূর্ণ কোড এখানে কখনো দেখানো হয় না — কোড শুধু প্রাপকের ইমেইল/ফোনে যায়।
            তাই প্রাপকের ইমেইল বা ফোন যেকোনো একটি দেওয়া বাধ্যতামূলক।
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">পরিমাণ (৳) *
            <input className="input mt-1" type="number" min="0" step="0.01" value={issueAmount} onChange={(e) => setIssueAmount(e.target.value)} placeholder="যেমন: ১০০০" />
          </label>
          <label className="block text-sm">প্রাপকের নাম
            <input className="input mt-1" value={issueName} onChange={(e) => setIssueName(e.target.value)} />
          </label>
          <label className="block text-sm">প্রাপকের ইমেইল
            <input className="input mt-1" type="email" value={issueEmail} onChange={(e) => setIssueEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label className="block text-sm">প্রাপকের ফোন
            <input className="input mt-1" type="tel" value={issuePhone} onChange={(e) => setIssuePhone(e.target.value)} placeholder="01XXXXXXXXX" />
          </label>
          <label className="block text-sm md:col-span-2">নোট (কেন ইস্যু করা হচ্ছে) *
            <input className="input mt-1" value={issueNote} onChange={(e) => setIssueNote(e.target.value)} placeholder="যেমন: ক্যাম্পেইন বিজয়ীর পুরস্কার" />
          </label>
        </div>
        {!issueNote.trim() ? <p className="text-xs text-slate-400">নোট দেওয়া বাধ্যতামূলক — প্রতিটি ম্যানুয়াল ইস্যু লেজারে কারণসহ লেখা থাকে।</p> : null}
        {!issueEmail.trim() && !issuePhone.trim() ? <p className="text-xs text-slate-400">প্রাপকের ইমেইল বা ফোন অন্তত একটি দিন — নইলে কোড কারো কাছে পৌঁছাবে না।</p> : null}
        <button type="submit" className="btn-primary" disabled={issueBusy || !issueReady}>
          {issueBusy ? "ইস্যু হচ্ছে…" : "গিফট কার্ড ইস্যু করুন"}
        </button>
      </form>

      {/* ---------- list + detail ---------- */}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="card p-5 space-y-4">
          <div className="font-semibold">🧾 কার্ডের তালিকা</div>
          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="শেষ ৪ সংখ্যা দিয়ে খুঁজুন"
              className="w-56 rounded-lg border px-3 py-2 font-mono text-sm"
            />
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="rounded-lg border px-3 py-2 text-sm">
              {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {listBusy ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : items.length === 0 ? (
            <p className="text-sm text-slate-500">কোনো গিফট কার্ড পাওয়া যায়নি।</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-slate-500">
                    <th className="py-2 pr-2">কোড</th>
                    <th className="py-2 pr-2">প্রাথমিক</th>
                    <th className="py-2 pr-2">ব্যালেন্স</th>
                    <th className="py-2 pr-2">অবস্থা</th>
                    <th className="py-2 pr-2">উৎস</th>
                    <th className="py-2">মেয়াদ</th>
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
                      <td className="py-2 pr-2">{money(c.initialAmountMinor)}</td>
                      <td className="py-2 pr-2 font-semibold">{money(c.balanceMinor)}</td>
                      <td className="py-2 pr-2">{STATUS_LABELS[c.status] ?? c.status}</td>
                      <td className="py-2 pr-2">{c.source === "manual" ? "ম্যানুয়াল" : c.source === "purchase" ? "অর্ডার" : (c.source ?? "—")}</td>
                      <td className="py-2">{c.expiresAt ? dateFmt(c.expiresAt) : "মেয়াদ নেই"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-lg border bg-white px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">আগের পেজ</button>
              <span className="text-xs font-semibold text-slate-500">পেজ {page} / {totalPages} · মোট {total}টি</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="rounded-lg border bg-white px-4 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">পরের পেজ</button>
            </div>
          ) : null}
        </div>

        {/* detail panel */}
        <div className="card h-fit p-5 space-y-4">
          <div className="font-semibold">কার্ডের বিবরণ</div>
          {detailBusy ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : !detail ? (
            <p className="text-sm text-slate-500">তালিকা থেকে একটি কার্ডে ক্লিক করলে তার লেজার ও বিবরণ এখানে দেখা যাবে।</p>
          ) : (
            <>
              <div className="space-y-1 text-sm">
                <p className="font-mono text-base font-bold">{detail.codePrefix} ••••{detail.codeLast4 ?? ""}</p>
                <p>প্রাথমিক: <b>{money(detail.initialAmountMinor)}</b> · ব্যালেন্স: <b>{money(detail.balanceMinor)}</b></p>
                <p>অবস্থা: <b>{STATUS_LABELS[detail.status] ?? detail.status}</b> · উৎস: <b>{detail.source === "manual" ? "ম্যানুয়াল" : detail.source === "purchase" ? "অর্ডার" : (detail.source ?? "—")}</b></p>
                {detail.recipientName ? <p>প্রাপক: {detail.recipientName}</p> : null}
                {detail.recipientEmail ? <p>প্রাপকের ইমেইল: <span className="font-mono">{detail.recipientEmail}</span></p> : null}
                {detail.recipientPhone ? <p>প্রাপকের ফোন: <span className="font-mono">{detail.recipientPhone}</span></p> : null}
                {detail.issuedOrderId ? <p>ইস্যুর অর্ডার: <span className="font-mono text-xs">{detail.issuedOrderId}</span></p> : null}
                <p>তৈরি: {detail.createdAt ? new Date(detail.createdAt).toLocaleString("bn-BD") : "—"} · মেয়াদ: {detail.expiresAt ? dateFmt(detail.expiresAt) : "নেই"}</p>
                {detail.note ? <p className="text-slate-500">নোট: {detail.note}</p> : null}
              </div>

              <div className="border-t pt-3">
                <p className="mb-2 text-sm font-semibold">লেজার</p>
                {detail.ledger.length === 0 ? (
                  <p className="text-sm text-slate-500">কোনো লেজার এন্ট্রি নেই।</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.ledger.map((e) => (
                      <li key={e.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{KIND_LABELS[e.kind] ?? e.kind}</span>
                          <span className={`font-bold ${e.deltaMinor.startsWith("-") ? "text-rose-600" : "text-emerald-700"}`}>{signedMoney(e.deltaMinor)}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          এন্ট্রির পর ব্যালেন্স: {money(e.balanceAfter)} · {e.createdAt ? new Date(e.createdAt).toLocaleString("bn-BD") : ""}
                        </p>
                        {e.note ? <p className="mt-0.5 text-xs text-slate-500">{NOTE_LABELS[e.note] ?? e.note}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {detailActionable ? (
                <div className="space-y-4 border-t pt-3">
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-rose-700">কার্ড বাতিল করুন</p>
                    <input value={voidNote} onChange={(e) => { setVoidNote(e.target.value); setConfirming(null); }} placeholder="বাতিলের কারণ (নোট) *" className="w-full rounded-lg border px-3 py-2 text-sm" />
                    <button
                      type="button"
                      disabled={actionBusy || !voidNote.trim()}
                      onClick={() => void doVoid()}
                      className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {confirming === "void" ? "নিশ্চিত করুন — কার্ডটি বাতিল হবে" : "বাতিল করুন"}
                    </button>
                    {confirming === "void" ? <p className="text-xs text-rose-600">আবার ক্লিক করলে কার্ডটি স্থায়ীভাবে বাতিল হবে ও অবশিষ্ট ব্যালেন্স শূন্য হয়ে যাবে।</p> : null}
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">ব্যালেন্স সংশোধন করুন</p>
                    <input value={adjustDelta} onChange={(e) => { setAdjustDelta(e.target.value); setConfirming(null); }} type="number" step="0.01" placeholder="পরিমাণ (৳) — বাড়াতে +, কমাতে −" className="w-full rounded-lg border px-3 py-2 text-sm" />
                    <input value={adjustNote} onChange={(e) => { setAdjustNote(e.target.value); setConfirming(null); }} placeholder="সংশোধনের কারণ (নোট) *" className="w-full rounded-lg border px-3 py-2 text-sm" />
                    <button
                      type="button"
                      disabled={actionBusy || !adjustNote.trim() || !adjustDelta.trim()}
                      onClick={() => void doAdjust()}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {confirming === "adjust" ? "নিশ্চিত করুন — সংশোধন প্রয়োগ হবে" : "সংশোধন করুন"}
                    </button>
                    {confirming === "adjust" ? <p className="text-xs text-slate-500">আবার ক্লিক করলে সংশোধনটি লেজারে লেখা হবে। সংশোধনের পর ব্যালেন্স ঋণাত্মক হতে পারবে না।</p> : null}
                  </div>
                </div>
              ) : (
                <p className="border-t pt-3 text-xs text-slate-500">বাতিল/মেয়াদোত্তীর্ণ কার্ডে বাতিল বা সংশোধন করা যায় না।</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
