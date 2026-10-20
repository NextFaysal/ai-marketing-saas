"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { EmptyState, ErrorState, PageHead, toast } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

interface Alert { kind: string; severity: string; organizationId: string; organizationName: string; detail: string; at: string }

const KIND_LABEL_KEY: Record<string, string> = {
  integration_error: "alerts.kindIntegrationError",
  sync_failing: "alerts.kindSyncFailing",
  past_due: "alerts.kindPastDue",
  trial_expiring: "alerts.kindTrialExpiring",
};

export default function AlertsPage() {
  const { dict, locale, t } = useAdminLocale();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  // ADNX11: severity groups can be collapsed on mobile (desktop
  // always shows them); default is expanded, as before.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  // ADX12: a failed board load used to be indistinguishable from
  // "no alerts" (the 🎉 empty card showed on an outage). Load
  // failure now gets its own error state + retry; the empty card
  // renders only after a successful load.
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try { setAlerts(await apiFetch<Alert[]>("/admin/alerts")); setLoadError(""); }
    catch (e) { setLoadError(e instanceof Error ? e.message : dict.alerts.loadFailedFallback); }
    setLoaded(true);
  }, [dict]);
  useEffect(() => { load(); }, [load]);

  // ADNX11: nudge feedback moves to toast (the old note/error
  // banners carried only transient action results). The ADX12
  // load-error honesty below is UNCHANGED — verified in this
  // batch: a failed load still renders ErrorState + retry and
  // the 🎉 empty card still renders only after a successful load.
  const nudge = async (a: Alert) => {
    try {
      const res = await apiFetch<{ sent: number }>(`/admin/alerts/nudge`, { method: "POST", body: JSON.stringify({ organizationId: a.organizationId, kind: a.kind }) });
      toast(t("alerts.nudgeSent", { org: a.organizationName, count: fmtNumber(locale, res.sent) }));
    } catch (e) { toast(e instanceof Error ? e.message : dict.alerts.nudgeFailed, "error"); }
  };

  const nudgeOnboarding = async (a: Alert) => {
    try {
      const res = await apiFetch<{ sent: number }>(`/admin/alerts/nudge`, { method: "POST", body: JSON.stringify({ organizationId: a.organizationId, kind: "onboarding" }) });
      toast(t("alerts.onboardingNudgeSent", { org: a.organizationName, count: fmtNumber(locale, res.sent) }));
    } catch (e) { toast(e instanceof Error ? e.message : dict.alerts.nudgeFailedShort, "error"); }
  };

  return (
    <AdminShell title={dict.alerts.title}>
      <PageHead sub={dict.alerts.sub} />
      <p className="amut" style={{ marginBottom: 12 }}>{dict.alerts.intro}</p>
      {!loaded ? <div className="askel-table" /> : null}
      {loaded && loadError ? <ErrorState message={t("alerts.loadError", { message: loadError })} onRetry={load} /> : null}
      {loaded && !loadError && alerts.length === 0 ? <div className="acard"><EmptyState title={dict.alerts.emptyTitle} /></div> : null}
      {/* ADX8: severity অনুযায়ী group — severity payload-এর নিজের
          field; আজকের badge-ধাঁচই (high → HIGH, বাকি সব → MEDIUM)।
          Alert computed (stored নয়), তাই কোনো acknowledge অবস্থা
          ডেটাতেই নেই — এখানে শুধু group করা হয়েছে, ack অবস্থা
          বানানো হয়নি। */}
      {(["high", "medium"] as const).map((sev) => {
        const group = alerts.filter((a) => (a.severity === "high" ? "high" : "medium") === sev);
        if (group.length === 0) return null;
        return (
          <div key={sev} className="mb-4">
            {/* ADNX11: severity badges now use the ONE v4 status
                mapping (high → astatus-danger, medium →
                astatus-warning) instead of one-off inline colours;
                the group header doubles as the mobile collapse
                toggle (sm+ always shows the group). */}
            <div className="mb-2 flex items-center gap-2">
              <span className={sev === "high" ? "astatus-danger" : "astatus-warning"}>{sev === "high" ? "HIGH" : "MEDIUM"}</span>
              <span className="text-sm text-slate-400">{t("alerts.groupCount", { count: fmtNumber(locale, group.length) })}</span>
              <button type="button" className="abtn-secondary ml-auto !px-2 !py-1 text-xs sm:hidden" aria-expanded={!collapsed[sev]} onClick={() => setCollapsed((c) => ({ ...c, [sev]: !c[sev] }))}>{collapsed[sev] ? dict.alerts.show : dict.alerts.hide}</button>
            </div>
            <div className={`space-y-2 ${collapsed[sev] ? "hidden sm:block" : ""}`}>
              {group.map((a, i) => (
          <div key={`${a.organizationId}-${a.kind}-${i}`} className="acard flex-col sm:flex-row" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span className={a.severity === "high" ? "astatus-danger" : "astatus-warning"}>{a.severity === "high" ? "HIGH" : "MEDIUM"}</span>
            <div style={{ flex: 1, minWidth: 220 }}>
              <b style={{ fontSize: 14 }}>{KIND_LABEL_KEY[a.kind] ? t(KIND_LABEL_KEY[a.kind]) : a.kind} — {a.organizationName}</b>
              <p className="amut">{a.detail}</p>
            </div>
            <a className="abtn w-full sm:w-auto" href={`/orgs/${a.organizationId}`}>{dict.alerts.viewOrg}</a>
            <button className="abtn abtn-primary w-full sm:w-auto" onClick={() => nudge(a)}>{dict.alerts.nudge}</button>
            <button className="abtn w-full sm:w-auto" onClick={() => nudgeOnboarding(a)}>{dict.alerts.onboardingNudge}</button>
          </div>
              ))}
            </div>
          </div>
        );
      })}
    </AdminShell>
  );
}
