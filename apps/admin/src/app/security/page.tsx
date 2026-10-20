"use client";
import React from "react";
import AdminShell, { reasonDialog } from "@/components/AdminShell";
import { DataTable, EmptyState, ErrorState, PageHead, Tabs, askConfirm, askInput, toast } from "@/components/ui";
import { apiFetch, setAdminToken } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { useRouter } from "next/navigation";
import { fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

interface SecurityData {
  me: { id: string; email: string; tier: string; totpEnabled: boolean };
  ipAllowlistConfigured: boolean;
  admins: { id: string; email: string; name: string; adminTier?: string | null; status: string; totpEnabled: boolean; lastLoginAt?: string | null }[];
}

export default function SecurityPage() {
  const { dict, locale, t } = useAdminLocale();
  const router = useRouter();
  const [data, setData] = React.useState<SecurityData | null>(null);
  const [enroll, setEnroll] = React.useState<{ secret: string; otpauthUrl: string; qrDataUrl?: string } | null>(null);
  const [code, setCode] = React.useState("");
  // ADX12: a failed security load used to sit on "লোড হচ্ছে…"
  // forever; it now gets an error state + retry.
  const [loadFailed, setLoadFailed] = React.useState(false);
  const load = React.useCallback(async () => {
    const d = await apiFetch<SecurityData>("/admin/security").catch(() => null);
    setLoadFailed(d === null);
    setData(d);
  }, []);
  React.useEffect(() => { load(); }, [load]);
  // AP2: view-as sessions (server-side registry).
  // ADNX13: the sessions load gets its own loading/failed states —
  // before, a failed fetch silently read as "কোনো সেশন নেই" (a
  // false empty of the ADX12 class).
  const [vaSessions, setVaSessions] = React.useState<{ id: string; adminEmail: string; organizationId: string; mode: string; active: boolean; expiresAt: string; createdAt: string }[]>([]);
  const [vaLoading, setVaLoading] = React.useState(true);
  const [vaFailed, setVaFailed] = React.useState(false);
  const loadSessions = React.useCallback(async () => {
    setVaLoading(true);
    const out = await apiFetch<{ id: string; adminEmail: string; organizationId: string; mode: string; active: boolean; expiresAt: string; createdAt: string }[]>("/admin/view-as/sessions").catch(() => null);
    setVaFailed(out === null);
    if (out) setVaSessions(out);
    setVaLoading(false);
  }, []);
  React.useEffect(() => { loadSessions(); }, [loadSessions]);
  // ADX10: existing cards regrouped into tabs (content unchanged;
  // the revoke-my-sessions block moves from the TOTP card into the
  // Sessions tab, handler identical).
  const [tab, setTab] = React.useState("totp");
  // ADNX13: every dangerous action on this page confirms through
  // the ONE modal pattern (askConfirm / askInput / reasonDialog)
  // and every result rides the toast system — no page banner.
  async function revokeSession(id: string) {
    if (!(await askConfirm({ title: dict.security.revokeSessionTitle, description: dict.security.revokeSessionDesc, confirmLabel: dict.security.revoke, danger: true }))) return;
    try { await apiFetch(`/admin/view-as/sessions/${id}/revoke`, { method: "POST" }); toast(dict.security.sessionRevoked); await loadSessions(); }
    catch (e) { toast(e instanceof Error ? e.message : dict.common.failed, "error"); }
  }

  async function confirmEnroll() {
    try {
      await apiFetch("/admin/totp/confirm", { method: "POST", body: JSON.stringify({ code }) });
      toast(dict.security.totpEnabledToast);
      setEnroll(null); setCode("");
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : dict.common.failed, "error"); }
  }
  if (!data) return <AdminShell title={dict.security.title}>{loadFailed ? <ErrorState message={dict.security.loadError} onRetry={load} /> : <><div className="askel-card" /><div className="askel-table mt-4" /></>}</AdminShell>;
  return (
    <AdminShell title={dict.security.title}>
      <PageHead sub={dict.security.sub} />
      <div className="sticky top-0 z-20 -mx-1 mb-4 bg-slate-950/90 px-1 py-2 backdrop-blur">
        <Tabs
          tabs={[
            { id: "totp", label: dict.security.tabTotp },
            { id: "sessions", label: dict.security.tabSessions, badge: vaSessions.filter((x) => x.active).length },
            { id: "access", label: dict.security.tabAccess },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>
      {tab === "totp" ? (<>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="acard space-y-3">
          <div className="font-semibold">{dict.security.myTotp}</div>
          <p className="text-sm text-slate-400">{dict.security.statusLabel} {data.me.totpEnabled ? <span className="abadge-green">{dict.security.totpOn}</span> : <span className="abadge-amber">{dict.security.totpOff}</span>} · Tier: {data.me.tier}</p>
          {!data.me.totpEnabled && !enroll ? (
            <>
              <p className="text-sm text-slate-400">{dict.security.totpRequiredNote}</p>
              <button className="abtn" onClick={async () => { setEnroll(await apiFetch("/admin/totp/enroll", { method: "POST" })); }}>{dict.security.totpStart}</button>
            </>
          ) : null}
          {enroll ? (
            <div className="space-y-2 rounded-lg bg-slate-800 p-3 text-sm">
              {enroll.qrDataUrl ? (
                <div className="space-y-1">
                  <div>{dict.security.totpScan}</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={enroll.qrDataUrl} alt="TOTP QR" className="rounded bg-white p-1" width={180} height={180} />
                </div>
              ) : null}
              <div>{dict.security.totpSecret}</div>
              <code className="block break-all rounded bg-slate-900 p-2 text-indigo-300">{enroll.secret}</code>
              <div className="break-all text-xs text-slate-400">{enroll.otpauthUrl}</div>
              <div className="flex gap-2">
                <input className="ainput max-w-[160px]" placeholder={dict.security.codePlaceholder} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
                <button className="abtn" onClick={confirmEnroll}>{dict.security.confirm}</button>
              </div>
            </div>
          ) : null}
          {data.me.totpEnabled ? (
            <div className="flex gap-2">
              <input className="ainput max-w-[160px]" placeholder={dict.security.codeDisablePlaceholder} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
              <button className="abtn-danger" onClick={async () => {
                if (!(await askConfirm({ title: dict.security.totpDisableTitle, description: dict.security.totpDisableDesc, confirmLabel: dict.security.totpDisableConfirm, danger: true }))) return;
                try { await apiFetch("/admin/totp/disable", { method: "POST", body: JSON.stringify({ code }) }); toast(dict.security.totpDisabledToast); setCode(""); await load(); }
                catch (e) { toast(e instanceof Error ? e.message : dict.common.failedShort, "error"); }
              }}>{dict.security.totpDisableConfirm}</button>
            </div>
          ) : null}
        </div>
        <div className="acard space-y-3">
          <div className="font-semibold">{dict.security.adminsTitle}</div>
          <p className="text-sm text-slate-400">{dict.security.ipAllowlistLabel} {data.ipAllowlistConfigured ? <span className="abadge-green">{dict.security.ipSet}</span> : <span className="abadge-slate">{dict.security.ipNotSet}</span>}</p>
          <ul className="space-y-2">
            {data.admins.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-lg bg-slate-800 px-3 py-2 text-sm">
                <span>{a.name}<span className="block text-xs text-slate-400">{a.email} · {a.adminTier ?? "SUPER"} · {t("security.lastLogin", { date: a.lastLoginAt ? fmtDateTime(locale, a.lastLoginAt) : "—" })}</span></span>
                <span className="flex items-center gap-2">
                  {a.totpEnabled ? <span className="abadge-green">2FA</span> : <span className="abadge-amber">{dict.security.no2fa}</span>}
                  {a.status !== "ACTIVE" ? <span className="abadge-red">{a.status}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-400">{dict.security.breakGlassPre}<code>node scripts/grant-admin.mjs &lt;email&gt;</code>{dict.security.breakGlassPost}</p>
        </div>
      </div>
      </>) : null}
      {tab === "sessions" ? (<>
      <div className="acard space-y-3">
        <div className="font-semibold">{dict.security.sessionsTitle} <span className="text-xs font-normal text-slate-400">{dict.security.sessionsTitleNote}</span></div>
        <p className="text-xs text-slate-400">{dict.security.sessionsNote}</p>
        {/* ADNX13: the sessions list is now the ONE DataTable v3
            pattern — mobile card form with data-label per cell
            (the first 15 sessions, exactly as the old list). */}
        {vaLoading && vaSessions.length === 0 ? <div className="askel-table" /> : vaFailed && vaSessions.length === 0 ? (
          <ErrorState message={dict.security.sessionsLoadError} onRetry={loadSessions} />
        ) : vaSessions.length === 0 ? <EmptyState title={dict.security.noSessions} /> : (
          <DataTable>
            <thead className="bg-slate-900"><tr><th className="ath">{dict.security.colAdmin}</th><th className="ath">{dict.security.colOrg}</th><th className="ath">{dict.security.colMode}</th><th className="ath">{dict.security.colStatus}</th><th className="ath">{dict.security.colExpiry}</th><th className="ath">{dict.security.colAction}</th></tr></thead>
            <tbody>
              {vaSessions.slice(0, 15).map((s) => (
                <tr key={s.id} className="border-t border-slate-800">
                  <td data-label={dict.security.colAdmin} className="atd">{s.adminEmail}</td>
                  <td data-label={dict.security.colOrg} className="atd">{s.organizationId.slice(0, 8)}…</td>
                  <td data-label={dict.security.colMode} className="atd">{s.mode}</td>
                  <td data-label={dict.security.colStatus} className="atd">{s.active ? <span className="abadge-green">{dict.security.sessionActive}</span> : <span className="abadge-amber">{dict.security.sessionEnded}</span>}</td>
                  <td data-label={dict.security.colExpiry} className="atd">{fmtDateTime(locale, s.expiresAt)}</td>
                  <td data-label={dict.security.colAction} className="atd">{s.active ? <button className="abtn-danger !px-2 !py-1 text-xs" onClick={() => revokeSession(s.id)}>{dict.security.revoke}</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </div>
      <div className="acard mt-4 space-y-3">
        <div className="font-semibold">{dict.security.revokeMineTitle}</div>
        <p className="text-xs text-slate-400">{dict.security.revokeMineNote}</p>
        <button className="abtn-secondary" onClick={async () => {
          const r = await reasonDialog(dict.security.revokeMineAction);
          if (!r) return;
          await apiFetch("/admin/security/revoke-my-sessions", { method: "POST", body: JSON.stringify({ reason: r }) });
          setAdminToken(null);
          router.replace("/login");
        }}>{dict.security.revokeMineButton}</button>
      </div>
      </>) : null}
      {tab === "access" ? <ApiKeysAndAnomalies /> : null}
    </AdminShell>
  );
}

interface ApiKeyRow { id: string; name: string; keyPrefix: string; scopes?: string[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
const SCOPE_AREAS = ["tenants", "billing", "growth", "admins", "system"] as const;
interface Anomaly { email: string; failures: number; lastAt: string; note: string }

function ApiKeysAndAnomalies() {
  const { dict, locale, t } = useAdminLocale();
  const [keys, setKeys] = React.useState<ApiKeyRow[]>([]);
  const [anomalies, setAnomalies] = React.useState<Anomaly[]>([]);
  const [name, setName] = React.useState("");
  const [scopeSel, setScopeSel] = React.useState<string[]>(["system:read"]);
  const [shownKey, setShownKey] = React.useState("");
  // ADNX13: form validation stays inline with the form (the NB2
  // form pattern); action results ride the toast system. The load
  // gets loading/failed states — before, a failed fetch silently
  // read as "কোনো API Key নেই" / "কোনো Anomaly নেই".
  const [formError, setFormError] = React.useState("");
  const [accessLoading, setAccessLoading] = React.useState(true);
  const [accessFailed, setAccessFailed] = React.useState(false);
  const load = React.useCallback(async () => {
    setAccessLoading(true);
    const k = await apiFetch<ApiKeyRow[]>("/admin/security/api-keys").catch(() => null);
    const a = await apiFetch<Anomaly[]>("/admin/security/login-anomalies").catch(() => null);
    setAccessFailed(k === null || a === null);
    if (k) setKeys(k);
    if (a) setAnomalies(a);
    setAccessLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {accessFailed ? <div className="lg:col-span-2"><ErrorState message={dict.security.accessLoadError} onRetry={load} /></div> : null}
      <div className="acard space-y-3">
        <div className="font-semibold">{dict.security.apiKeysTitle}</div>
        <p className="text-xs text-slate-400">{dict.security.apiKeysNoteA}<code>x-admin-api-key</code>{dict.security.apiKeysNoteB}</p>
        {formError ? <p className="text-sm text-red-300">{formError}</p> : null}
        <div className="flex gap-2">
          <input className="ainput" placeholder={dict.security.keyNamePlaceholder} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="abtn" onClick={async () => {
            if (name.trim().length < 3) { setFormError(dict.security.nameTooShort); return; }
            if (!scopeSel.length) { setFormError(dict.security.scopeRequired); return; }
            setFormError("");
            try {
              const out = await apiFetch<{ key: string }>("/admin/security/api-keys", { method: "POST", body: JSON.stringify({ name, scopes: scopeSel }) });
              setShownKey(out.key); setName(""); toast(dict.security.keyCreated); await load();
            } catch (e) { toast(e instanceof Error ? e.message : dict.common.failedShort, "error"); }
          }}>{dict.security.create}</button>
        </div>
        <div className="space-y-1 text-xs text-slate-400">
          <div>{dict.security.scopeIntro}</div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={scopeSel.includes("*")} onChange={(e) => setScopeSel(e.target.checked ? ["*"] : [])} /> <b>*</b> {dict.security.scopeFull}</label>
          {scopeSel.includes("*") ? null : SCOPE_AREAS.map((a) => (
            <span key={a} className="mr-3 inline-flex items-center gap-2">
              <span className="text-slate-400">{a}:</span>
              {(["read", "write"] as const).map((v) => (
                <label key={v} className="inline-flex items-center gap-1">
                  <input type="checkbox" checked={scopeSel.includes(`${a}:${v}`)} onChange={(e) => setScopeSel((prev) => e.target.checked ? [...prev, `${a}:${v}`] : prev.filter((g) => g !== `${a}:${v}`))} /> {v}
                </label>
              ))}
            </span>
          ))}
        </div>
        {shownKey ? <input className="ainput" readOnly value={shownKey} onFocus={(e) => e.target.select()} /> : null}
        {accessLoading && keys.length === 0 ? <div className="askel-table" /> : null}
        <ul className="space-y-2">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm">
              <span><b>{k.name}</b><span className="block text-xs text-slate-400">{t("security.keyMeta", { prefix: k.keyPrefix, created: fmtDateTime(locale, k.createdAt), lastUsed: k.lastUsedAt ? fmtDateTime(locale, k.lastUsedAt) : dict.security.neverUsed })}</span><span className="block text-xs text-indigo-300">{!k.scopes?.length ? dict.security.scopeLegacy : t("security.scopeList", { scopes: k.scopes.join(", ") })}</span></span>
              {k.revokedAt ? <span className="abadge-red">{dict.security.revokedBadge}</span> : (
                <button className="abtn-danger !px-2 !py-1 text-xs" onClick={async () => {
                  const reason = await askInput({ title: dict.security.keyRevokeReason, inputLabel: dict.common.reason, inputRequired: true, confirmLabel: dict.common.proceed });
                  if (!reason) return;
                  try {
                    await apiFetch(`/admin/security/api-keys/${k.id}/revoke`, { method: "POST", body: JSON.stringify({ reason }) });
                    toast(dict.security.keyRevoked); await load();
                  } catch (e) { toast(e instanceof Error ? e.message : dict.common.failedShort, "error"); }
                }}>{dict.security.revoke}</button>
              )}
            </li>
          ))}
          {keys.length === 0 && !accessLoading && !accessFailed ? <li className="text-sm text-slate-400">{dict.security.noApiKeys}</li> : null}
        </ul>
      </div>
      <div className="acard space-y-3">
        <div className="font-semibold">{dict.security.anomaliesTitle}</div>
        {accessLoading && anomalies.length === 0 ? <div className="askel-table" /> : null}
        {anomalies.length === 0 && !accessLoading && !accessFailed ? <p className="text-sm text-slate-400">{dict.security.noAnomalies}</p> : anomalies.length === 0 ? null : (
          <ul className="space-y-2">
            {anomalies.map((a) => (
              <li key={a.email} className="rounded-lg bg-red-500/10 px-3 py-2 text-sm">
                <b>{a.email}</b> — {t("security.anomalyRow", { failures: fmtNumber(locale, a.failures), date: fmtDateTime(locale, a.lastAt) })}
                <span className="block text-xs text-slate-400">{a.note}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-400">{dict.security.anomalyNote}</p>
      </div>

    </div>
  );
}
