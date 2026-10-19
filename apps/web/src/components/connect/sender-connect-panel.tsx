"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { buildSenderEmailBody, buildSenderSmsBody, type SenderEmailForm, type SenderSmsForm } from "@/lib/connect-forms";
import { useLocale } from "@/lib/i18n/provider";

/**
 * CC8 (Connect Center B4) — Messaging sender forms inside the
 * Connect Center. These call the EXISTING MS4 endpoints
 * (organizations/:id/messaging/senders…) with exactly the bodies
 * the Messaging page sends — no backend logic is duplicated:
 * tenant SMTP is verified by a real handshake before saving,
 * SMS saves as-is (no pre-verification exists — the first real
 * send is the proof, and the panel says so).
 */

interface SenderSettings {
  email: { path: string; tenantConfigured: boolean; platformConfigured: boolean; smtpHost: string | null; smtpPort: number | null; smtpUser: string | null; smtpPassConfigured: boolean; fromAddress: string | null; fromName: string | null; dkimSelector: string | null };
  sms: { path: string; tenantConfigured: boolean; platformConfigured: boolean; gateway: string | null; smsApiKeyConfigured: boolean; smsSenderId: string | null; smsApiUrl: string | null };
  rates: { smsCostPerPartMinor: number | null; whatsappCostPerMessageMinor: number | null; emailCostPerMessageMinor: number | null };
}

const SMS_GATEWAY_OPTIONS = [
  { id: "sslwireless", label: "SSL Wireless (BD)" },
  { id: "bulksmsbd", label: "BulkSMS BD" },
  { id: "alphasms", label: "Alpha SMS (sms.net.bd)" },
];

const inputCls = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400";

export function SenderConnectPanel({ onChanged }: { onChanged?: () => void }) {
  const { dict, t } = useLocale();
  const D = dict.connections;
  const [settings, setSettings] = useState<SenderSettings | null>(null);
  const [smtpForm, setSmtpForm] = useState<SenderEmailForm>({ smtpHost: "", smtpPort: "587", smtpUser: "", smtpPass: "", fromAddress: "", fromName: "", dkimSelector: "" });
  const [smsForm, setSmsForm] = useState<SenderSmsForm>({ smsGateway: "sslwireless", smsApiKey: "", smsSenderId: "", smsApiUrl: "" });
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<SenderSettings>(`organizations/${orgId}/messaging/senders`);
      setSettings(res);
      setSmtpForm((f) => ({
        ...f,
        smtpHost: res.email.smtpHost ?? f.smtpHost,
        smtpPort: res.email.smtpPort ? String(res.email.smtpPort) : f.smtpPort,
        smtpUser: res.email.smtpUser ?? f.smtpUser,
        fromAddress: res.email.fromAddress ?? f.fromAddress,
        fromName: res.email.fromName ?? f.fromName,
        dkimSelector: res.email.dkimSelector ?? f.dkimSelector,
      }));
      setSmsForm((f) => ({
        ...f,
        smsGateway: res.sms.gateway ?? f.smsGateway,
        smsSenderId: res.sms.smsSenderId ?? f.smsSenderId,
        smsApiUrl: res.sms.smsApiUrl ?? f.smsApiUrl,
      }));
    } catch { /* the panel simply shows its empty state */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const wrap = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(""); setNotice("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : D.sndActionFailed); } finally { setBusy(""); }
  };

  return (
    <div className="card space-y-3 p-5">
      <p className="text-sm text-slate-500">{D.sndIntro}</p>
      {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{error}</div> : null}
      {notice ? <div className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{notice}</div> : null}

      <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={(e) => {
        e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
        void wrap("smtp-save", async () => {
          const res = await apiFetch<SenderSettings>(`organizations/${orgId}/messaging/senders/email`, { method: "PUT", body: JSON.stringify(buildSenderEmailBody(smtpForm)) });
          setSettings(res); setSmtpForm((f) => ({ ...f, smtpPass: "" }));
          setNotice(D.sndSmtpSaved);
          await load(); onChanged?.();
        });
      }}>
        <div className="text-sm font-medium lg:col-span-3">{D.sndOwnSmtp} {settings?.email.tenantConfigured ? <span className="badge-green">{D.sndActiveEmailPath}</span> : settings?.email.platformConfigured ? <span className="badge-slate">{D.sndPlatformSmtpNow}</span> : <span className="badge-amber">{D.sndNoEmailPath}</span>}</div>
        <label className="block text-sm">SMTP Host<input className={inputCls} value={smtpForm.smtpHost} onChange={(e) => setSmtpForm({ ...smtpForm, smtpHost: e.target.value })} placeholder="mail.example.com" /></label>
        <label className="block text-sm">Port<input type="number" className={inputCls} value={smtpForm.smtpPort} onChange={(e) => setSmtpForm({ ...smtpForm, smtpPort: e.target.value })} /></label>
        <label className="block text-sm">Username<input className={inputCls} value={smtpForm.smtpUser} onChange={(e) => setSmtpForm({ ...smtpForm, smtpUser: e.target.value })} /></label>
        <label className="block text-sm">Password<input type="password" className={inputCls} value={smtpForm.smtpPass} onChange={(e) => setSmtpForm({ ...smtpForm, smtpPass: e.target.value })} placeholder={settings?.email.smtpPassConfigured ? D.sndPassSavedPlaceholder : D.sndSmtpPassword} autoComplete="new-password" /></label>
        <label className="block text-sm">{D.sndFromAddress}<input className={inputCls} value={smtpForm.fromAddress} onChange={(e) => setSmtpForm({ ...smtpForm, fromAddress: e.target.value })} placeholder="hello@example.com" /></label>
        <label className="block text-sm">{D.sndFromName}<input className={inputCls} value={smtpForm.fromName} onChange={(e) => setSmtpForm({ ...smtpForm, fromName: e.target.value })} placeholder={D.sndFromNamePlaceholder} /></label>
        <label className="block text-sm">{D.sndDkimLabel}<input className={inputCls} value={smtpForm.dkimSelector} onChange={(e) => setSmtpForm({ ...smtpForm, dkimSelector: e.target.value })} placeholder={D.sndDkimPlaceholder} /></label>
        <div className="flex flex-wrap items-end gap-2">
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{busy === "smtp-save" ? D.verifyingDots : D.sndVerifySaveBtn}</button>
          {settings?.email.tenantConfigured ? (
            <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => { const orgId = getOrganizationId(); if (!orgId) return; void wrap("smtp-clear", async () => { const res = await apiFetch<SenderSettings>(`organizations/${orgId}/messaging/senders/email`, { method: "PUT", body: JSON.stringify({ clear: true }) }); setSettings(res); setNotice(D.sndSmtpRemoved); await load(); onChanged?.(); }); }}>{D.sndRemoveSmtpBtn}</button>
          ) : null}
        </div>
      </form>

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <label className="block text-sm">{D.sndTestEmailLabel}<input className={inputCls} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={D.sndTestEmailPlaceholder} /></label>
        <button className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== "" || !testTo} onClick={() => { const orgId = getOrganizationId(); if (!orgId) return; void wrap("smtp-test", async () => { const r = await apiFetch<{ sent: boolean; path: string; providerMessageId: string }>(`organizations/${orgId}/messaging/senders/email/test`, { method: "POST", body: JSON.stringify({ to: testTo }) }); setNotice(t("connections.sndTestSent", { path: r.path === "tenant" ? D.sndPathOwn : D.sndPathPlatform, id: r.providerMessageId })); }); }}>{busy === "smtp-test" ? D.sendingDots : D.sndTestEmailLabel}</button>
      </div>

      <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={(e) => {
        e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
        void wrap("sms-save", async () => {
          const res = await apiFetch<SenderSettings & { note?: string }>(`organizations/${orgId}/messaging/senders/sms`, { method: "PUT", body: JSON.stringify(buildSenderSmsBody(smsForm)) });
          setSettings(res); setSmsForm((f) => ({ ...f, smsApiKey: "" }));
          setNotice(res.note ? t("connections.sndSmsSavedNote", { note: res.note }) : D.sndSmsSaved);
          await load(); onChanged?.();
        });
      }}>
        <div className="text-sm font-medium lg:col-span-3">{D.sndOwnSms} {settings?.sms.tenantConfigured ? <span className="badge-green">{D.sndActiveSmsPath}</span> : settings?.sms.platformConfigured ? <span className="badge-slate">{D.sndPlatformGatewayNow}</span> : <span className="badge-amber">{D.sndNoSmsPath}</span>}</div>
        <label className="block text-sm">Gateway
          <select className={inputCls} value={smsForm.smsGateway} onChange={(e) => setSmsForm({ ...smsForm, smsGateway: e.target.value })}>
            {SMS_GATEWAY_OPTIONS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">API Key<input type="password" className={inputCls} value={smsForm.smsApiKey} onChange={(e) => setSmsForm({ ...smsForm, smsApiKey: e.target.value })} placeholder={settings?.sms.smsApiKeyConfigured ? D.sndKeySavedPlaceholder : "Gateway API Key"} autoComplete="new-password" /></label>
        <label className="block text-sm">Sender ID<input className={inputCls} value={smsForm.smsSenderId} onChange={(e) => setSmsForm({ ...smsForm, smsSenderId: e.target.value })} placeholder={D.sndSenderIdPlaceholder} /></label>
        <label className="block text-sm">{D.sndApiUrlLabel}<input className={inputCls} value={smsForm.smsApiUrl} onChange={(e) => setSmsForm({ ...smsForm, smsApiUrl: e.target.value })} placeholder={D.sndApiUrlPlaceholder} /></label>
        <div className="flex flex-wrap items-end gap-2">
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{busy === "sms-save" ? D.savingDots : dict.common.save}</button>
          {settings?.sms.tenantConfigured ? (
            <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => { const orgId = getOrganizationId(); if (!orgId) return; void wrap("sms-clear", async () => { const res = await apiFetch<SenderSettings>(`organizations/${orgId}/messaging/senders/sms`, { method: "PUT", body: JSON.stringify({ clear: true }) }); setSettings(res); setNotice(D.sndSmsRemoved); await load(); onChanged?.(); }); }}>{D.sndRemoveGatewayBtn}</button>
          ) : null}
        </div>
        <p className="text-[11px] text-slate-400 lg:col-span-3">{D.sndSmsNote}</p>
      </form>
    </div>
  );
}
