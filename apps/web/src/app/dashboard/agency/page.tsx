"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatMinor } from "@repo/contracts";
import {
  AGENCY_COMMISSION_RECORDS_BN,
  AGENCY_SUMMARY_ERROR_BN,
  agencyOrgChoices,
  bdtToMinor,
  clientOrgChoices,
  roleLabelBn,
  totalsBannerLabel,
  type AgencyCommissionView,
  type AgencyConsoleView,
} from "@/lib/agency-nf15";

// NF15 (FB5) — Agency / reseller console. There is NO agency
// entity: this page renders ONLY the signed-in user's own
// ACTIVE memberships, exactly as GET /agency/console returns
// them (built server-side from OrganizationsService.listMine
// through each org's normal per-org analytics path). Totals are
// labelled sums of the listed orgs ONLY — never consolidated
// cross-org analytics. ORG14 (cross-org team view) was never
// built and is NOT built here. Commissions are RECORDS ONLY.

const fmtM = (minor?: string | null): string => {
  if (minor == null) return "—";
  try { return formatMinor(BigInt(minor)); } catch { return minor; }
};

const inputCls = "w-full rounded-lg border px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-semibold text-slate-700";
const btnCls = "rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50";
const btnGhost = "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50";

interface CreatedOrg { id: string; name: string; slug: string }

export default function AgencyConsolePage() {
  const [consoleData, setConsoleData] = useState<AgencyConsoleView | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // create client org
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [createdOrg, setCreatedOrg] = useState<CreatedOrg | null>(null);
  const [inviteRole, setInviteRole] = useState("VIEWER");
  const [inviteUrl, setInviteUrl] = useState("");

  // commissions
  const [agencyOrgId, setAgencyOrgId] = useState("");
  const [clientOrgId, setClientOrgId] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [amountBdt, setAmountBdt] = useState("");
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<AgencyCommissionView[]>([]);

  const loadConsole = useCallback(async () => {
    try {
      const data = await apiFetch<AgencyConsoleView>("/agency/console");
      setConsoleData(data);
      setAgencyOrgId((prev) => prev || agencyOrgChoices(data.orgs)[0]?.organization.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "কনসোল লোড করা যায়নি");
    }
  }, []);

  useEffect(() => { void loadConsole(); }, [loadConsole]);

  const loadEntries = useCallback(async (agencyId: string) => {
    if (!agencyId) { setEntries([]); return; }
    try {
      setEntries(await apiFetch<AgencyCommissionView[]>(`/organizations/${agencyId}/agency-commissions`));
    } catch { setEntries([]); }
  }, []);

  useEffect(() => { void loadEntries(agencyOrgId); }, [agencyOrgId, loadEntries]);

  async function createClientOrg() {
    setBusy(true); setError(""); setMsg(""); setInviteUrl("");
    try {
      const created = await apiFetch<CreatedOrg>("/agency/client-orgs", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), slug: newSlug.trim() }),
      });
      setCreatedOrg(created);
      setMsg(`নতুন ক্লায়েন্ট প্রতিষ্ঠান তৈরি হয়েছে: ${created.name} (${created.slug}) — আপনি এর মালিক (OWNER)।`);
      setNewName(""); setNewSlug("");
      await loadConsole();
    } catch (e) {
      setError(e instanceof Error ? e.message : "প্রতিষ্ঠান তৈরি করা যায়নি");
    } finally { setBusy(false); }
  }

  async function createInviteLink() {
    if (!createdOrg) return;
    setBusy(true); setError("");
    try {
      const out = await apiFetch<{ inviteUrl: string }>(`/organizations/${createdOrg.id}/invite-links`, {
        method: "POST",
        body: JSON.stringify({ role: inviteRole, maxUses: 10, expiresInDays: 7 }),
      });
      // ORG9 behaviour: the raw link is shown ONCE (server stores only its hash).
      setInviteUrl(out.inviteUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "আমন্ত্রণ লিংক তৈরি করা যায়নি");
    } finally { setBusy(false); }
  }

  async function recordCommission() {
    setBusy(true); setError(""); setMsg("");
    try {
      const amountMinor = bdtToMinor(amountBdt);
      if (!amountMinor) throw new Error("কমিশনের পরিমাণ (৳) সঠিকভাবে লিখুন — শূন্যের বেশি হতে হবে।");
      if (!clientOrgId) throw new Error("ক্লায়েন্ট প্রতিষ্ঠান বেছে নিন।");
      if (!periodLabel.trim()) throw new Error("সময়ের লেবেল লিখুন — যেমন “অক্টোবর ২০২৬”।");
      await apiFetch(`/organizations/${agencyOrgId}/agency-commissions`, {
        method: "POST",
        body: JSON.stringify({
          clientOrganizationId: clientOrgId,
          periodLabel: periodLabel.trim(),
          amountMinor,
          note: note.trim() || undefined,
        }),
      });
      setMsg("কমিশন রেকর্ড সংরক্ষিত হয়েছে।");
      setPeriodLabel(""); setAmountBdt(""); setNote("");
      await loadEntries(agencyOrgId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "কমিশন রেকর্ড করা যায়নি");
    } finally { setBusy(false); }
  }

  const orgs = consoleData?.orgs ?? [];
  const totals = consoleData?.totals;
  const agencyChoices = agencyOrgChoices(orgs);
  const clientChoices = clientOrgChoices(orgs, agencyOrgId);

  return (
    <div className="space-y-5">
      <section className="hero-panel p-5 sm:p-7">
        <div className="text-sm font-medium text-white/80">এজেন্সি / রিসেলার</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">এজেন্সি কনসোল</h1>
        <p className="mt-1 max-w-2xl text-sm text-white/75">
          আপনি যেসব প্রতিষ্ঠানের সদস্য, শুধু সেগুলোই এখানে দেখা যাবে — প্রতিটি প্রতিষ্ঠানের
          সংখ্যা তার নিজের ড্যাশবোর্ডের পথেই হিসাব করা। অন্য কারো প্রতিষ্ঠান এখানে আসে না।
        </p>
      </section>

      {error ? <div className="alert alert-red"><span>⚠️</span><span>{error}</span></div> : null}
      {msg ? <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200">{msg}</div> : null}

      {/* Totals banner — labelled sums of the listed orgs only */}
      {totals ? (
        <div className="card p-5">
          <div className="section-title">{totalsBannerLabel(totals.orgCount)}</div>
          {totals.summariesFailed > 0 ? (
            <p className="mt-1 text-xs text-amber-700">{totals.summariesFailed}টি প্রতিষ্ঠানের তথ্য লোড হয়নি — সেগুলো এই মোটে ধরা হয়নি।</p>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div><div className="stat-label">আজকের অর্ডার</div><div className="stat-value">{totals.ordersToday}</div></div>
            <div><div className="stat-label">আজকের আয়</div><div className="stat-value">{fmtM(totals.revenueTodayMinor)}</div></div>
            <div><div className="stat-label">এই মাসের অর্ডার</div><div className="stat-value">{totals.ordersMonth}</div></div>
            <div><div className="stat-label">এই মাসের আয়</div><div className="stat-value">{fmtM(totals.revenueMonthMinor)}</div></div>
            <div><div className="stat-label">পেন্ডিং অর্ডার</div><div className="stat-value">{totals.pendingOrders}</div></div>
            <div><div className="stat-label">অপঠিত মেসেজ</div><div className="stat-value">{totals.unreadInbox}</div></div>
          </div>
        </div>
      ) : !error ? <p className="py-6 text-center text-sm text-slate-400">লোড হচ্ছে…</p> : null}

      {/* Per-org cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {orgs.map((card) => (
          <div key={card.organization.id} className="card p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-900">{card.organization.name}</div>
                <div className="text-xs text-slate-400">{card.organization.slug}</div>
              </div>
              <span className="badge-slate shrink-0">{roleLabelBn(card.myRole)}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">নিজের ভূমিকা: {roleLabelBn(card.myRole)}</div>
            {card.summary ? (
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">আজকের অর্ডার</dt><dd className="font-medium">{card.summary.ordersToday}টি</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">আজকের আয়</dt><dd className="font-medium">{fmtM(card.summary.revenueTodayMinor)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">এই মাসের অর্ডার</dt><dd className="font-medium">{card.summary.ordersMonth}টি</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">এই মাসের আয়</dt><dd className="font-medium">{fmtM(card.summary.revenueMonthMinor)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">পেন্ডিং অর্ডার</dt><dd className="font-medium">{card.summary.pendingOrders}টি</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">অপঠিত মেসেজ</dt><dd className="font-medium">{card.summary.unreadInbox}টি</dd></div>
              </dl>
            ) : (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{AGENCY_SUMMARY_ERROR_BN} — এই প্রতিষ্ঠানের সংখ্যা এখন পাওয়া যাচ্ছে না।</p>
            )}
          </div>
        ))}
      </div>
      {consoleData && orgs.length === 0 ? (
        <p className="card p-5 text-sm text-slate-500">আপনি এখনো কোনো প্রতিষ্ঠানের সক্রিয় সদস্য নন।</p>
      ) : null}

      {/* Create client org */}
      <div className="card p-5">
        <div className="section-title">নতুন ক্লায়েন্ট প্রতিষ্ঠান তৈরি করুন</div>
        <p className="mt-1 text-sm text-slate-500">
          তৈরি করলে আপনিই এর মালিক (OWNER) হবেন। প্রতিষ্ঠানের সংখ্যার সীমা (থাকলে) ও স্লাগের
          নিয়ম সাধারণ প্রতিষ্ঠান তৈরির মতোই প্রযোজ্য।
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="agency-new-name">নাম</label>
            <input id="agency-new-name" className={inputCls} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ক্লায়েন্টের দোকানের নাম" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="agency-new-slug">স্লাগ</label>
            <input id="agency-new-slug" className={inputCls} value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="client-shop" />
          </div>
        </div>
        <button className={btnCls + " mt-3"} disabled={busy || !newName.trim() || !newSlug.trim()} onClick={createClientOrg}>
          প্রতিষ্ঠান তৈরি করুন
        </button>
        {createdOrg ? (
          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-800">তৈরি হয়েছে: {createdOrg.name} <span className="font-normal text-slate-400">({createdOrg.slug})</span></div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <label className={labelCls} htmlFor="agency-invite-role">আমন্ত্রণের ভূমিকা</label>
                <select id="agency-invite-role" className={inputCls} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="VIEWER">দর্শক (VIEWER)</option>
                  <option value="SUPPORT_AGENT">সাপোর্ট এজেন্ট</option>
                  <option value="MARKETING_MANAGER">মার্কেটিং ম্যানেজার</option>
                  <option value="ADVERTISER">বিজ্ঞাপনদাতা</option>
                  <option value="ANALYST">অ্যানালিস্ট</option>
                  <option value="ADMIN">অ্যাডমিন (ADMIN)</option>
                </select>
              </div>
              <button className={btnGhost} disabled={busy} onClick={createInviteLink}>
                ক্লায়েন্টের টিমের জন্য আমন্ত্রণ লিংক তৈরি করুন
              </button>
            </div>
            {inviteUrl ? (
              <div className="mt-3">
                <p className="text-xs text-amber-700">লিংকটি এখনই কপি করে রাখুন — পরে আর দেখা যাবে না (সার্ভারে শুধু এর hash থাকে)। লিংকটি পেলে ক্লায়েন্ট যোগদানের অনুরোধ পাঠাতে পারবেন; অনুমোদন দিলেই তিনি সদস্য হবেন।</p>
                <code className="mt-1 block break-all rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200">{inviteUrl}</code>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Commissions — records only */}
      <div className="card p-5">
        <div className="section-title">কমিশন রেকর্ড</div>
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          {AGENCY_COMMISSION_RECORDS_BN}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="agency-comm-agency">এজেন্সি প্রতিষ্ঠান (আপনি OWNER/ADMIN)</label>
            <select id="agency-comm-agency" className={inputCls} value={agencyOrgId} onChange={(e) => { setAgencyOrgId(e.target.value); setClientOrgId(""); }}>
              <option value="">বেছে নিন…</option>
              {agencyChoices.map((o) => (
                <option key={o.organization.id} value={o.organization.id}>{o.organization.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="agency-comm-client">ক্লায়েন্ট প্রতিষ্ঠান</label>
            <select id="agency-comm-client" className={inputCls} value={clientOrgId} onChange={(e) => setClientOrgId(e.target.value)}>
              <option value="">বেছে নিন…</option>
              {clientChoices.map((o) => (
                <option key={o.organization.id} value={o.organization.id}>{o.organization.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="agency-comm-period">সময়ের লেবেল</label>
            <input id="agency-comm-period" className={inputCls} value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder="যেমন: অক্টোবর ২০২৬" maxLength={40} />
          </div>
          <div>
            <label className={labelCls} htmlFor="agency-comm-amount">পরিমাণ (৳)</label>
            <input id="agency-comm-amount" className={inputCls} value={amountBdt} onChange={(e) => setAmountBdt(e.target.value)} placeholder="1500" inputMode="decimal" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="agency-comm-note">নোট (ঐচ্ছিক)</label>
            <input id="agency-comm-note" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="যেকোনো মন্তব্য" />
          </div>
        </div>
        <button className={btnCls + " mt-3"} disabled={busy || !agencyOrgId} onClick={recordCommission}>
          কমিশন রেকর্ড করুন
        </button>

        <div className="mt-5">
          <div className="text-sm font-semibold text-slate-800">রেকর্ডসমূহ {agencyOrgId ? "" : "(আগে এজেন্সি প্রতিষ্ঠান বেছে নিন)"}</div>
          {entries.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">এখনো কোনো কমিশন রেকর্ড নেই।</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                  <span className="font-medium text-slate-800">{e.periodLabel}</span>
                  <span className="text-slate-500">ক্লায়েন্ট: {e.clientOrganizationName ?? e.clientOrganizationId}</span>
                  <span className="text-slate-500">পরিমাণ <b className="text-slate-800">{fmtM(e.amountMinor)}</b></span>
                  {e.note ? <span className="text-slate-400">{e.note}</span> : null}
                  <span className="text-xs text-slate-400">{new Date(e.createdAt).toLocaleString("bn-BD")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
