"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber, type UiLocale } from "@repo/contracts";
import { settingsBn, settingsEn } from "@/lib/i18n/settings";

/**
 * ORG6 (Organization Next OB2): standalone "ব্যবহার ও সীমা" —
 * the usage picture that used to live only inside the billing
 * page, on its own page so it can be watched without the
 * payment surfaces around it.
 *
 * NO new backend: every number comes from endpoints that
 * already exist —
 *   GET /organizations/:id/billing        (OWNER/ADMIN: plan,
 *     effective limits, usage counters, GC22 resource usage)
 *   GET /organizations/:id/members/usage  (any member: the seat
 *     picture incl. pending invitations, which HOLD seats)
 *   GET /organizations/:id/storage-usage  (any member: recorded
 *     storage from the MediaAsset registry)
 * When the billing payload is unavailable to the caller (not
 * OWNER/ADMIN) the page degrades to the member-level figures
 * and says so — it never invents a limit.
 *
 * Honesty note (same as the billing page): the broadcast cap
 * is a PER-SEND recipient cap, not a monthly quota, so the
 * 30-day broadcast count is shown as a plain count, no bar.
 */

interface BillingPayload {
  subscription: { plan: string; status: string } | null;
  limits: { aiDaily: number; broadcastCap: number; seats: number | null; plan: string };
  usage: { seatsUsed: number; aiCallsToday: number; broadcasts30d: number };
  resourceUsage?: {
    products: { used: number; limit: number | null };
    ordersThisMonth: { used: number; limit: number | null };
    storage: { usedBytes: string; assetCount: number; limitMb: number | null };
    apiToday: { used: number; limit: number | null };
  };
}

interface SeatUsage {
  limit: number | null;
  activeMembers: number;
  suspendedMembers: number;
  pendingInvites: number;
  available: number | null;
}

interface StorageUsage {
  storageBytes: string;
  assetCount: number;
  meteredFrom?: string;
}

function formatBytes(locale: UiLocale, bytes: number): string {
  const d = locale === "en" ? settingsEn : settingsBn;
  if (!Number.isFinite(bytes) || bytes <= 0) return d.zeroBytes;
  const units = [d.bytesUnit, "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${fmtNumber(locale, v, { maximumFractionDigits: 2 })} ${units[i]}`;
}

function Meter({ label, used, limit, detail }: { label: string; used: number; limit: number | null; detail?: string }) {
  const { dict, locale } = useLocale();
  const pct = limit !== null && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null;
  const tone = pct === null ? "" : pct >= 100 ? "meter-fill-danger" : pct >= 80 ? "meter-fill-warn" : "meter-fill-ok";
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-slate-700">{label}</div>
        <div className="text-sm text-slate-500">
          <b className="text-base text-slate-900">{fmtNumber(locale, used)}</b>
          {limit === null ? dict.settings.usageUnlimitedSuffix : ` / ${fmtNumber(locale, limit)}`}
          {pct !== null ? <span className="ml-1.5 text-xs text-slate-400">({fmtNumber(locale, pct)}%)</span> : null}
        </div>
      </div>
      {pct !== null ? (
        <div className="meter mt-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {detail ? <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{detail}</p> : null}
    </div>
  );
}

export default function UsagePage() {
  const { dict, t, locale } = useLocale();
  const [billing, setBilling] = useState<BillingPayload | null>(null);
  const [billingBlocked, setBillingBlocked] = useState(false);
  const [seats, setSeats] = useState<SeatUsage | null>(null);
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setLoading(false); setError(dict.settings.usageNoOrg); return; }
    setLoading(true);
    const [b, s, st] = await Promise.allSettled([
      apiFetch<BillingPayload>(`/organizations/${orgId}/billing`),
      apiFetch<SeatUsage>(`/organizations/${orgId}/members/usage`),
      apiFetch<StorageUsage>(`/organizations/${orgId}/storage-usage`),
    ]);
    if (b.status === "fulfilled") setBilling(b.value); else setBillingBlocked(true);
    if (s.status === "fulfilled") setSeats(s.value);
    if (st.status === "fulfilled") setStorage(st.value);
    if (b.status === "rejected" && s.status === "rejected" && st.status === "rejected") {
      setError(dict.settings.usageLoadFailed);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const seatLimit = seats?.limit ?? billing?.limits.seats ?? null;
  const seatUsed = seats ? seats.activeMembers + seats.pendingInvites : (billing?.usage.seatsUsed ?? 0);
  const storageBytes = billing?.resourceUsage ? Number(billing.resourceUsage.storage.usedBytes) : (storage ? Number(storage.storageBytes) : 0);
  const storageLimitMb = billing?.resourceUsage?.storage.limitMb ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{dict.settings.usageTitle}</h1>
          <p className="page-sub mt-1">
            {dict.settings.usageIntro}
            {billing?.subscription ? <> {dict.settings.usageCurrentPlan} <b>{billing.subscription.plan}</b> ({billing.subscription.status})।</> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/settings" className="btn-secondary btn-sm min-h-[40px]">{dict.settings.usageBackToSettings}</Link>
          <Link href="/dashboard/billing" className="btn-secondary btn-sm min-h-[40px]">{dict.settings.usageBillingLink}</Link>
        </div>
      </div>

      {error ? <div className="alert alert-red"><span>⚠️</span><span>{error}</span></div> : null}
      {billingBlocked ? (
        <div className="alert alert-amber">
          <span>ℹ️</span>
          <span>{dict.settings.usageBillingBlocked}</span>
        </div>
      ) : null}
      {loading ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : null}

      {!loading && (seats || billing) ? (
        <section className="card p-5">
          <h2 className="section-title">{dict.settings.usageTeamSeats}</h2>
          <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
            <Meter
              label={dict.settings.usageSeatsUsedLabel}
              used={seatUsed}
              limit={seatLimit}
              detail={seats ? `${t("settings.usageSeatsDetail", { active: fmtNumber(locale, seats.activeMembers), pending: fmtNumber(locale, seats.pendingInvites), suspended: fmtNumber(locale, seats.suspendedMembers) })}${seats.available !== null ? ` · ${t("settings.usageSeatsAvailableSuffix", { available: fmtNumber(locale, seats.available) })}` : ""}` : undefined}
            />
            <p className="text-xs leading-relaxed text-slate-400">
              {dict.settings.usageSeatNoteBefore} <b className="text-slate-600">{dict.settings.usageSeatReserved}</b> {dict.settings.usageSeatNoteAfter}
            </p>
          </div>
        </section>
      ) : null}

      {!loading && billing ? (
        <section className="card p-5">
          <h2 className="section-title">{dict.settings.usageAiBroadcastTitle}</h2>
          <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-3">
            <Meter label={dict.settings.usageAiToday} used={billing.usage.aiCallsToday} limit={billing.limits.aiDaily} detail={dict.settings.usageAiDailyDetail} />
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-medium text-slate-700">{dict.settings.usageBroadcast30}</div>
                <div className="text-sm text-slate-500"><b className="text-base text-slate-900">{fmtNumber(locale, billing.usage.broadcasts30d)}</b>{dict.settings.usageBroadcastSentSuffix}</div>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                {dict.settings.usageBroadcastNoteBefore} <b className="text-slate-600">{fmtNumber(locale, billing.limits.broadcastCap)} {dict.settings.usageBroadcastPeopleUnit}</b> {dict.settings.usageBroadcastNoteAfter}
              </p>
            </div>
            {billing.resourceUsage ? (
              <Meter label={dict.settings.usageApiToday} used={billing.resourceUsage.apiToday.used} limit={billing.resourceUsage.apiToday.limit} />
            ) : null}
          </div>
          {billing.resourceUsage ? (
            <div className="mt-6 grid gap-x-8 gap-y-5 border-t border-slate-100 pt-5 md:grid-cols-3">
              <Meter label={dict.settings.usageProducts} used={billing.resourceUsage.products.used} limit={billing.resourceUsage.products.limit} />
              <Meter label={dict.settings.usageOrdersThisMonth} used={billing.resourceUsage.ordersThisMonth.used} limit={billing.resourceUsage.ordersThisMonth.limit} />
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-medium text-slate-700">{dict.settings.usageStorageMedia}</div>
                  <div className="text-sm text-slate-500">
                    <b className="text-base text-slate-900">{formatBytes(locale, storageBytes)}</b>
                    {storageLimitMb === null ? dict.settings.usageUnlimitedSuffix : ` / ${fmtNumber(locale, storageLimitMb)} MB`}
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {t("settings.usageStorageNote", { count: fmtNumber(locale, billing.resourceUsage.storage.assetCount) })}
                </p>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {!loading && !billing && storage ? (
        <section className="card p-5">
          <h2 className="section-title">{dict.settings.usageStorageMedia}</h2>
          <p className="mt-3 text-sm text-slate-600">
            {dict.settings.usageStorageUsedLine} <b>{formatBytes(locale, Number(storage.storageBytes))}</b> · {t("settings.usageStorageFilesSuffix", { count: fmtNumber(locale, storage.assetCount) })}
          </p>
        </section>
      ) : null}

      <p className="text-xs leading-relaxed text-slate-400">
        {dict.settings.usageFooterBefore} <Link href="/dashboard/billing" className="font-semibold text-indigo-700 hover:underline">{dict.settings.usageFooterLink}</Link> {dict.settings.usageFooterAfter}
      </p>
    </div>
  );
}
