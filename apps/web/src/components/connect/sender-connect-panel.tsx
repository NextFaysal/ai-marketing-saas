"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { buildSenderEmailBody, buildSenderSmsBody, type SenderEmailForm, type SenderSmsForm } from "@/lib/connect-forms";

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
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "কাজটি সম্পন্ন হয়নি"); } finally { setBusy(""); }
  };

  return (
    <div className="card space-y-3 p-5">
      <p className="text-sm text-slate-500">
        নিজের SMTP ও SMS Gateway বসালে Broadcast আপনার নিজের অ্যাকাউন্ট দিয়েই যাবে; না বসালে প্ল্যাটফর্মেরটি ব্যবহৃত হবে।
        SMTP সংরক্ষণের আগে সার্ভার সত্যিকারের যাচাই (Handshake) করে — যাচাই ব্যর্থ হলে কিছুই সংরক্ষিত হয় না।
        পাসওয়ার্ড/API Key কখনো দেখানো বা ফেরত পাঠানো হয় না।
      </p>
      {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{error}</div> : null}
      {notice ? <div className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{notice}</div> : null}

      <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={(e) => {
        e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
        void wrap("smtp-save", async () => {
          const res = await apiFetch<SenderSettings>(`organizations/${orgId}/messaging/senders/email`, { method: "PUT", body: JSON.stringify(buildSenderEmailBody(smtpForm)) });
          setSettings(res); setSmtpForm((f) => ({ ...f, smtpPass: "" }));
          setNotice("SMTP যাচাই সফল হয়েছে — আপনার প্রেরক সেটিংস সংরক্ষিত হয়েছে।");
          await load(); onChanged?.();
        });
      }}>
        <div className="text-sm font-medium lg:col-span-3">নিজের SMTP {settings?.email.tenantConfigured ? <span className="badge-green">সক্রিয় — এই পথেই ইমেইল যাবে</span> : settings?.email.platformConfigured ? <span className="badge-slate">এখন প্ল্যাটফর্ম SMTP ব্যবহৃত হচ্ছে</span> : <span className="badge-amber">কোনো ইমেইল পথ নেই</span>}</div>
        <label className="block text-sm">SMTP Host<input className={inputCls} value={smtpForm.smtpHost} onChange={(e) => setSmtpForm({ ...smtpForm, smtpHost: e.target.value })} placeholder="mail.example.com" /></label>
        <label className="block text-sm">Port<input type="number" className={inputCls} value={smtpForm.smtpPort} onChange={(e) => setSmtpForm({ ...smtpForm, smtpPort: e.target.value })} /></label>
        <label className="block text-sm">Username<input className={inputCls} value={smtpForm.smtpUser} onChange={(e) => setSmtpForm({ ...smtpForm, smtpUser: e.target.value })} /></label>
        <label className="block text-sm">Password<input type="password" className={inputCls} value={smtpForm.smtpPass} onChange={(e) => setSmtpForm({ ...smtpForm, smtpPass: e.target.value })} placeholder={settings?.email.smtpPassConfigured ? "সংরক্ষিত আছে — বদলাতে চাইলে নতুন পাসওয়ার্ড দিন" : "SMTP পাসওয়ার্ড"} autoComplete="new-password" /></label>
        <label className="block text-sm">From ঠিকানা<input className={inputCls} value={smtpForm.fromAddress} onChange={(e) => setSmtpForm({ ...smtpForm, fromAddress: e.target.value })} placeholder="hello@example.com" /></label>
        <label className="block text-sm">From নাম<input className={inputCls} value={smtpForm.fromName} onChange={(e) => setSmtpForm({ ...smtpForm, fromName: e.target.value })} placeholder="আমার দোকান" /></label>
        <label className="block text-sm">DKIM Selector (ঐচ্ছিক)<input className={inputCls} value={smtpForm.dkimSelector} onChange={(e) => setSmtpForm({ ...smtpForm, dkimSelector: e.target.value })} placeholder="যেমন: mail, default, google" /></label>
        <div className="flex flex-wrap items-end gap-2">
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{busy === "smtp-save" ? "যাচাই হচ্ছে..." : "যাচাই করে সংরক্ষণ করুন"}</button>
          {settings?.email.tenantConfigured ? (
            <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => { const orgId = getOrganizationId(); if (!orgId) return; void wrap("smtp-clear", async () => { const res = await apiFetch<SenderSettings>(`organizations/${orgId}/messaging/senders/email`, { method: "PUT", body: JSON.stringify({ clear: true }) }); setSettings(res); setNotice("নিজের SMTP সরানো হয়েছে — এখন থেকে প্ল্যাটফর্ম SMTP ব্যবহৃত হবে (যদি কনফিগার থাকে)।"); await load(); onChanged?.(); }); }}>নিজের SMTP সরান</button>
          ) : null}
        </div>
      </form>

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <label className="block text-sm">টেস্ট ইমেইল পাঠান<input className={inputCls} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="আপনার ইমেইল ঠিকানা" /></label>
        <button className="rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:opacity-50" disabled={busy !== "" || !testTo} onClick={() => { const orgId = getOrganizationId(); if (!orgId) return; void wrap("smtp-test", async () => { const r = await apiFetch<{ sent: boolean; path: string; providerMessageId: string }>(`organizations/${orgId}/messaging/senders/email/test`, { method: "POST", body: JSON.stringify({ to: testTo }) }); setNotice(`টেস্ট ইমেইল পাঠানো হয়েছে — পথ: ${r.path === "tenant" ? "আপনার নিজের SMTP" : "প্ল্যাটফর্ম SMTP"} (Provider ID: ${r.providerMessageId})।`); }); }}>{busy === "smtp-test" ? "পাঠানো হচ্ছে..." : "টেস্ট ইমেইল পাঠান"}</button>
      </div>

      <form className="grid gap-3 border-t pt-3 lg:grid-cols-3" onSubmit={(e) => {
        e.preventDefault(); const orgId = getOrganizationId(); if (!orgId) return;
        void wrap("sms-save", async () => {
          const res = await apiFetch<SenderSettings & { note?: string }>(`organizations/${orgId}/messaging/senders/sms`, { method: "PUT", body: JSON.stringify(buildSenderSmsBody(smsForm)) });
          setSettings(res); setSmsForm((f) => ({ ...f, smsApiKey: "" }));
          setNotice(res.note ? `SMS Gateway সংরক্ষিত হয়েছে। ${res.note}` : "SMS Gateway সংরক্ষিত হয়েছে।");
          await load(); onChanged?.();
        });
      }}>
        <div className="text-sm font-medium lg:col-span-3">নিজের SMS Gateway {settings?.sms.tenantConfigured ? <span className="badge-green">সক্রিয় — এই Gateway দিয়েই SMS যাবে</span> : settings?.sms.platformConfigured ? <span className="badge-slate">এখন প্ল্যাটফর্ম Gateway ব্যবহৃত হচ্ছে</span> : <span className="badge-amber">কোনো SMS পথ নেই</span>}</div>
        <label className="block text-sm">Gateway
          <select className={inputCls} value={smsForm.smsGateway} onChange={(e) => setSmsForm({ ...smsForm, smsGateway: e.target.value })}>
            {SMS_GATEWAY_OPTIONS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">API Key<input type="password" className={inputCls} value={smsForm.smsApiKey} onChange={(e) => setSmsForm({ ...smsForm, smsApiKey: e.target.value })} placeholder={settings?.sms.smsApiKeyConfigured ? "সংরক্ষিত আছে — বদলাতে চাইলে নতুন Key দিন" : "Gateway API Key"} autoComplete="new-password" /></label>
        <label className="block text-sm">Sender ID<input className={inputCls} value={smsForm.smsSenderId} onChange={(e) => setSmsForm({ ...smsForm, smsSenderId: e.target.value })} placeholder="অনুমোদিত Sender ID / Masking নাম" /></label>
        <label className="block text-sm">API URL (ঐচ্ছিক Override)<input className={inputCls} value={smsForm.smsApiUrl} onChange={(e) => setSmsForm({ ...smsForm, smsApiUrl: e.target.value })} placeholder="ফাঁকা রাখলে Gateway-এর ডিফল্ট ঠিকানা" /></label>
        <div className="flex flex-wrap items-end gap-2">
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{busy === "sms-save" ? "সংরক্ষণ হচ্ছে..." : "সংরক্ষণ করুন"}</button>
          {settings?.sms.tenantConfigured ? (
            <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={busy !== ""} onClick={() => { const orgId = getOrganizationId(); if (!orgId) return; void wrap("sms-clear", async () => { const res = await apiFetch<SenderSettings>(`organizations/${orgId}/messaging/senders/sms`, { method: "PUT", body: JSON.stringify({ clear: true }) }); setSettings(res); setNotice("নিজের SMS Gateway সরানো হয়েছে — এখন থেকে প্ল্যাটফর্ম Gateway ব্যবহৃত হবে (যদি কনফিগার থাকে)।"); await load(); onChanged?.(); }); }}>নিজের Gateway সরান</button>
          ) : null}
        </div>
        <p className="text-[11px] text-slate-400 lg:col-span-3">SMS Gateway-এর জন্য আগে থেকে যাচাইয়ের সুযোগ নেই — প্রথম আসল পাঠানোই প্রমাণ। Gateway অস্বীকার করলে সেই বার্তা হুবহু Send ফলাফলে দেখা যাবে।</p>
      </form>
    </div>
  );
}
