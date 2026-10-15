"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { ErrorState } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface Alert { kind: string; severity: string; organizationId: string; organizationName: string; detail: string; at: string }

const KIND_LABEL: Record<string, string> = {
  integration_error: "🔌 Integration Error",
  sync_failing: "🔄 Sync ব্যর্থ হচ্ছে",
  past_due: "💳 Past Due",
  trial_expiring: "⏳ Trial শেষ হচ্ছে",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  // ADX12: a failed board load used to be indistinguishable from
  // "no alerts" (the 🎉 empty card showed on an outage). Load
  // failure now gets its own error state + retry; the empty card
  // renders only after a successful load.
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try { setAlerts(await apiFetch<Alert[]>("/admin/alerts")); setLoadError(""); }
    catch (e) { setLoadError(e instanceof Error ? e.message : "Alert লোড ব্যর্থ হয়েছে"); }
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  const nudge = async (a: Alert) => {
    setError(""); setNote("");
    try {
      const res = await apiFetch<{ sent: number }>(`/admin/alerts/nudge`, { method: "POST", body: JSON.stringify({ organizationId: a.organizationId, kind: a.kind }) });
      setNote(`${a.organizationName} — ${res.sent} জনকে Nudge ইমেইল পাঠানো হয়েছে।`);
    } catch (e) { setError(e instanceof Error ? e.message : "Nudge পাঠানো যায়নি (SMTP কনফিগ চেক করুন)"); }
  };

  const nudgeOnboarding = async (a: Alert) => {
    setError(""); setNote("");
    try {
      const res = await apiFetch<{ sent: number }>(`/admin/alerts/nudge`, { method: "POST", body: JSON.stringify({ organizationId: a.organizationId, kind: "onboarding" }) });
      setNote(`${a.organizationName} — Onboarding Nudge ${res.sent} জনকে পাঠানো হয়েছে।`);
    } catch (e) { setError(e instanceof Error ? e.message : "Nudge পাঠানো যায়নি"); }
  };

  return (
    <AdminShell title="Proactive Alerts">
      <p className="amut" style={{ marginBottom: 12 }}>সব Alert আসল ডেটা থেকে এই মুহূর্তে হিসাব করা — ভাঙা Integration, বারবার ব্যর্থ Sync, Past Due, শেষের পথে Trial। Nudge ইমেইল শুধু Gateway নিশ্চিত করলেই "পাঠানো হয়েছে" বলা হয়।</p>
      {error ? <p className="anote" style={{ borderColor: "#fecaca", color: "#991b1b" }}>{error}</p> : null}
      {note ? <p className="anote">{note}</p> : null}
      {!loaded ? <div className="askel-table" /> : null}
      {loaded && loadError ? <ErrorState message={`Alert লোড হয়নি: ${loadError}`} onRetry={load} /> : null}
      {loaded && !loadError && alerts.length === 0 ? <div className="acard"><p className="amut">🎉 এই মুহূর্তে কোনো Alert নেই।</p></div> : null}
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
            <div className="mb-2 flex items-center gap-2">
              <span className="abadge" style={sev === "high" ? { background: "#fee2e2", color: "#991b1b" } : { background: "#fef3c7", color: "#92400e" }}>{sev === "high" ? "HIGH" : "MEDIUM"}</span>
              <span className="text-sm text-slate-400">{group.length}টি Alert</span>
            </div>
            <div className="space-y-2">
              {group.map((a, i) => (
          <div key={`${a.organizationId}-${a.kind}-${i}`} className="acard flex-col sm:flex-row" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span className="abadge" style={a.severity === "high" ? { background: "#fee2e2", color: "#991b1b" } : { background: "#fef3c7", color: "#92400e" }}>{a.severity === "high" ? "HIGH" : "MEDIUM"}</span>
            <div style={{ flex: 1, minWidth: 220 }}>
              <b style={{ fontSize: 14 }}>{KIND_LABEL[a.kind] ?? a.kind} — {a.organizationName}</b>
              <p className="amut">{a.detail}</p>
            </div>
            <a className="abtn w-full sm:w-auto" href={`/orgs/${a.organizationId}`}>Org দেখুন</a>
            <button className="abtn abtn-primary w-full sm:w-auto" onClick={() => nudge(a)}>📧 Nudge পাঠান</button>
            <button className="abtn w-full sm:w-auto" onClick={() => nudgeOnboarding(a)}>Onboarding Nudge</button>
          </div>
              ))}
            </div>
          </div>
        );
      })}
    </AdminShell>
  );
}
