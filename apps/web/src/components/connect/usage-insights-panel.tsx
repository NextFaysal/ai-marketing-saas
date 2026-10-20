"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  DeliverabilityView,
  UsageView,
  businessVerificationMeta,
  formatTakaMinor,
  formatWhen,
  usageMetricSummary,
} from "@/lib/connections";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber } from "@repo/contracts";

/**
 * CC30 — per-account usage insights + deliverability.
 *
 * Fed ONLY by GET connections/usage and
 * connections/deliverability, which count REAL rows. Facts the
 * schema cannot attribute to one account arrive as null (or in
 * the unattributed list) and render as "তথ্য নেই" — this panel
 * never splits, estimates or invents a number. Cost appears
 * ONLY where the API computed it from the org's own entered
 * rate (labelled as such). Both endpoints are OWNER/ADMIN; for
 * other roles the panels quietly stay hidden.
 */

const WINDOWS = [7, 30, 90] as const;

export function UsageInsightsPanel() {
  const { dict, t, locale } = useLocale();
  const D = dict.connections;
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<UsageView | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (d: number) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<UsageView>(`organizations/${orgId}/connections/usage?days=${d}`);
      setData(res);
    } catch { /* OWNER/ADMIN-only surface — stays hidden otherwise */ }
    setLoaded(true);
  }, []);

  useEffect(() => { void load(days); }, [load, days]);

  if (!loaded || !data) return null;

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-slate-800">{D.uiTitle} <span className="text-xs font-normal text-slate-400">{D.uiSubtitle}</span></div>
        <div className="flex gap-1">
          {WINDOWS.map((d) => (
            <button
              key={d} type="button" onClick={() => setDays(d)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${days === d ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {t("connections.uiDays", { days: fmtNumber(locale, d) })}
            </button>
          ))}
        </div>
      </div>
      {data.accounts.length === 0 ? (
        <p className="text-xs leading-relaxed text-slate-500">{D.uiEmpty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="py-1 pr-2 font-semibold">{D.haColAccount}</th>
                <th className="py-1 pr-2 font-semibold">{t("connections.uiColUsage", { days: fmtNumber(locale, data.days) })}</th>
                <th className="py-1 pr-2 font-semibold">{D.uiColVerified}</th>
                <th className="py-1 font-semibold">{D.uiColCost}</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => {
                const summary = usageMetricSummary(a, locale);
                const volume = a.metrics && "verifiedVolumeMinor" in a.metrics ? a.metrics.verifiedVolumeMinor : null;
                return (
                  <tr key={`${a.targetType}:${a.targetId}`} className="border-t border-slate-100 align-top">
                    <td className="py-1.5 pr-2 font-medium text-slate-700">
                      {a.displayName}
                      <span className="block text-[11px] font-normal text-slate-400">{a.provider} · {a.category}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-slate-600">
                      {summary ?? <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-500">{D.haNoInfo}</span>}
                      {a.attribution === "unavailable" ? (
                        <span className="block text-[11px] text-slate-400">{D.uiAttrUnavailable}</span>
                      ) : null}
                      {a.attribution === "store" ? (
                        <span className="block text-[11px] text-slate-400">{D.uiAttrStore}</span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-2 text-slate-600">
                      {typeof volume === "string" ? formatTakaMinor(volume, locale) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="py-1.5 text-slate-600">
                      {a.estimatedCostMinor !== null ? (
                        <>
                          {formatTakaMinor(a.estimatedCostMinor, locale)}
                          <span className="block text-[11px] text-slate-400">{t("connections.uiCostNote", { rate: formatTakaMinor(String(a.costRateMinor ?? 0), locale) })}</span>
                        </>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.unattributed.length > 0 ? (
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">{D.uiUnattributedTitle}</span>{" "}
          {data.unattributed.map((u, i) => (
            <span key={i}>
              {i > 0 ? " · " : ""}
              {u.kind === "messaging"
                ? `${String(u.channel)} — ${t("connections.usageReceived", { received: fmtNumber(locale, Number(u.messagesReceived ?? 0)), sent: fmtNumber(locale, Number(u.messagesSent ?? 0)) })} ${D.uiUnattrSuffix}`
                : t("connections.uiUnattrShipments", { provider: String(u.provider), count: fmtNumber(locale, Number(u.shipmentsBooked ?? 0)) })}
            </span>
          ))}
          <span className="block text-[11px] text-amber-600">{D.uiUnattrNote}</span>
        </div>
      ) : null}
      <p className="text-[11px] leading-relaxed text-slate-400">{D.uiFooter}</p>
    </div>
  );
}

export function DeliverabilityPanel() {
  const { dict, locale } = useLocale();
  const D = dict.connections;
  const [data, setData] = useState<DeliverabilityView | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<DeliverabilityView>(`organizations/${orgId}/connections/deliverability`);
      setData(res);
    } catch { /* OWNER/ADMIN-only surface — stays hidden otherwise */ }
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!loaded || !data) return null;
  const { email, metaBusiness } = data;

  return (
    <div className="card space-y-3 p-4">
      <div className="font-semibold text-slate-800">{D.uiDelivTitle} <span className="text-xs font-normal text-slate-400">{D.uiDelivSubtitle}</span></div>

      <div className="space-y-1.5 text-xs">
        <p className="font-semibold text-slate-700">{D.uiEmailDomainTitle}</p>
        {email.configured ? (
          <div className="flex flex-wrap items-center gap-1.5 text-slate-600">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold">{email.domain}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold">SPF: {D.uiNotRecorded}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold">
              DKIM: {email.dkim.status === "not_checked" ? D.uiDkimNoSelector : D.uiNotRecorded}
            </span>
            <span className="text-slate-400">DKIM selector {email.dkimSelectorSet ? D.uiSelectorSet : D.uiSelectorUnset}</span>
          </div>
        ) : (
          <p className="text-slate-500">{D.uiNoDomain}</p>
        )}
        <p className="text-[11px] leading-relaxed text-slate-400">{email.note}</p>
      </div>

      <div className="space-y-1.5 text-xs">
        <p className="font-semibold text-slate-700">Meta Business verification</p>
        {metaBusiness.length === 0 ? (
          <p className="text-slate-500">{D.uiMetaBizEmpty}</p>
        ) : (
          <ul className="space-y-1">
            {metaBusiness.map((b) => {
              const meta = businessVerificationMeta(b.verificationStatus, locale);
              return (
                <li key={`${b.targetType}:${b.targetId}`} className="flex flex-wrap items-center gap-2 text-slate-600">
                  <span className="font-medium text-slate-700">{b.displayName}</span>
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${meta.cls}`}>{meta.label}</span>
                  {b.businessId ? <span className="text-slate-400">Business ID: {b.businessId}</span> : null}
                  {b.providerHealthAt ? <span className="text-slate-400">{D.uiFetchedLabel}{formatWhen(b.providerHealthAt, locale)}</span> : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] leading-relaxed text-slate-400">{D.uiMetaFooter}</p>
      </div>
    </div>
  );
}
