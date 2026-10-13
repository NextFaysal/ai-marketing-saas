"use client";
import React, { useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  buildEmailConnectBody, buildMessagingConnectBody, emailResultText, initialAppSource,
  telegramResultText, type EmailChannelForm, type MessagingConnectForm,
} from "@/lib/connect-forms";

/**
 * CC7 (Connect Center B3) — Messaging channel connect panel for
 * the Connect Center. Every form posts the EXACT request shape
 * the Inbox page posts, to the SAME inbox endpoints:
 *  - Meta (WhatsApp/Messenger/Instagram): POST inbox/connect
 *    (ConnectMessagingDto, verify-before-save, CC4 appSource
 *    select included — "own" uses the tenant's Meta app saved in
 *    the নিজের অ্যাপ section above, never a silent downgrade).
 *  - Telegram bot: POST inbox/connect/telegram (getMe verify;
 *    the webhook outcome is reported as the API states it).
 *  - Email mailbox: POST inbox/connect/email (IMAP login + SMTP
 *    verify both) and the manual POST inbox/email/sync.
 * Telegram/Email connects are keyed server-side by their
 * verified external id (CC7), so reconnecting the same bot or
 * mailbox refreshes its row instead of duplicating it — the
 * result line says when that happened.
 */
export function MessagingConnectPanel({ onChanged }: { onChanged?: () => void }) {
  const [form, setForm] = useState<MessagingConnectForm>(() => ({
    channel: "whatsapp", accessToken: "", appSecret: "", verifyToken: "", phoneNumberId: "", pageId: "",
    appSource: typeof window !== "undefined" ? initialAppSource(window.location.search) : "platform",
  }));
  const [tgToken, setTgToken] = useState("");
  const [tgResult, setTgResult] = useState("");
  const [emailForm, setEmailForm] = useState<EmailChannelForm>({ imapHost: "", imapPort: 993, smtpHost: "", smtpPort: 587, user: "", password: "" });
  const [emailResult, setEmailResult] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const inputCls = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400";

  async function connectMeta(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("connect"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/connect`, { method: "POST", body: JSON.stringify(buildMessagingConnectBody(form)) });
      setNotice("কানেক্ট হয়েছে (Token যাচাই সফল)। এখন Webhook সেট করলেই বার্তা আসবে।");
      onChanged?.();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function connectTelegram() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("tg"); setTgResult("");
    try {
      const r = await apiFetch<{ bot?: string; webhook?: { registered?: boolean; error?: string }; reconnected?: boolean }>(`/organizations/${orgId}/inbox/connect/telegram`, { method: "POST", body: JSON.stringify({ botToken: tgToken }) });
      setTgResult(telegramResultText(r));
      setTgToken("");
      onChanged?.();
    } catch (e) { setTgResult(e instanceof Error ? e.message : "কানেক্ট ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function connectEmail() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("email"); setEmailResult("");
    try {
      const r = await apiFetch<{ mailbox?: string; reconnected?: boolean }>(`/organizations/${orgId}/inbox/connect/email`, { method: "POST", body: JSON.stringify(buildEmailConnectBody(emailForm)) });
      setEmailResult(emailResultText(r));
      onChanged?.();
    } catch (e) { setEmailResult(e instanceof Error ? e.message : "কানেক্ট ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function syncEmail() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("emailsync");
    try {
      const r = await apiFetch<{ stored: number; duplicates: number }>(`/organizations/${orgId}/inbox/email/sync`, { method: "POST" });
      setEmailResult(`Sync: ${r.stored}টি নতুন, ${r.duplicates}টি আগের`);
    } catch (e) { setEmailResult(e instanceof Error ? e.message : "Sync ব্যর্থ"); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <form onSubmit={connectMeta} className="card space-y-3 p-5">
        <div className="font-semibold text-slate-800">WhatsApp / Messenger / Instagram কানেক্ট করুন</div>
        <p className="text-sm text-slate-500">
          Meta App থেকে Page/System-User Access Token, App Secret ও নিজের পছন্দের Verify Token লাগবে। Token যাচাই ব্যর্থ হলে কিছুই সেভ হয় না।
          কানেক্টের পর Meta App-এর Webhook সেটিংসে Callback URL দিন: <code className="rounded bg-slate-100 px-1">https://আপনার-ডোমেইন/webhooks/meta/ইন্টিগ্রেশন-ID</code>, একই Verify Token ব্যবহার করুন এবং <span className="font-medium">messages</span> ফিল্ড সাবস্ক্রাইব করুন।
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <label className="block text-sm">চ্যানেল
            <select className={inputCls} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              <option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option><option value="instagram">Instagram</option>
            </select>
          </label>
          <label className="block text-sm">Access Token<input className={inputCls} type="password" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} required /></label>
          <label className="block text-sm">App Secret (প্ল্যাটফর্ম অ্যাপ ব্যবহার করলে খালি রাখুন)<input className={inputCls} type="password" value={form.appSecret} onChange={(e) => setForm({ ...form, appSecret: e.target.value })} placeholder="নিজের Meta অ্যাপ থাকলে দিন" /></label>
          <label className="block text-sm">কোন অ্যাপ দিয়ে কানেক্ট?
            <select className={inputCls} value={form.appSource} onChange={(e) => setForm({ ...form, appSource: e.target.value })}>
              <option value="platform">আমাদের (প্ল্যাটফর্মের) Meta অ্যাপ</option>
              <option value="own">নিজের Meta অ্যাপ (কানেক্ট সেন্টারে কনফিগার করা)</option>
            </select>
            {form.appSource === "own" ? <span className="mt-1 block text-xs text-slate-400">নিজের অ্যাপ বেছে নিলে App Secret লাগবে না — এই পেজের উপরে সেভ করা আপনার অ্যাপের Secret-ই ব্যবহৃত হবে। সেখানে অ্যাপ কনফিগার করা না থাকলে কানেক্ট ব্যর্থ হবে।</span> : null}
          </label>
          <label className="block text-sm">Verify Token (নিজে ঠিক করুন)<input className={inputCls} value={form.verifyToken} onChange={(e) => setForm({ ...form, verifyToken: e.target.value })} required /></label>
          <label className="block text-sm">Phone Number ID (WhatsApp)<input className={inputCls} value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} /></label>
          <label className="block text-sm">Page ID (Messenger/Instagram)<input className={inputCls} value={form.pageId} onChange={(e) => setForm({ ...form, pageId: e.target.value })} /></label>
        </div>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{busy === "connect" ? "যাচাই হচ্ছে..." : "যাচাই করে কানেক্ট করুন"}</button>
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-2 p-5">
          <div className="text-sm font-semibold text-slate-800">✈️ Telegram Bot Channel</div>
          <p className="text-xs text-slate-500">BotFather থেকে পাওয়া Bot Token দিন — যাচাই (getMe) সফল হলেই কানেক্ট হবে। Message এই Inbox এই আসবে, একই Assignment/Autopilot চলবে। একই বট আবার কানেক্ট করলে নতুন রো তৈরি না হয়ে পুরনো রোটিই হালনাগাদ হয়; আলাদা বট আলাদা রোতে থাকে।</p>
          <input className="input w-full" type="password" placeholder="Bot Token (123456:ABC...)" value={tgToken} onChange={(e) => setTgToken(e.target.value)} />
          <button type="button" className="btn-primary btn-sm" disabled={!tgToken || busy !== ""} onClick={() => void connectTelegram()}>{busy === "tg" ? "যাচাই হচ্ছে..." : "যাচাই করে কানেক্ট"}</button>
          {tgResult ? <p className="text-xs text-slate-600">{tgResult}</p> : null}
        </div>
        <div className="card space-y-2 p-5">
          <div className="text-sm font-semibold text-slate-800">📧 Email Mailbox Lane</div>
          <p className="text-xs text-slate-500">নিজের Mailbox-এর IMAP + SMTP দিন — দুই দিকই যাচাই সফল হলেই কানেক্ট হবে। অপঠিত মেইল Sync হয়ে Inbox-এ আসবে (Automation-এ "email_sync" Job চালু করুন)। একই মেইলবক্স আবার কানেক্ট করলে রো হালনাগাদ হয়; আলাদা মেইলবক্স আলাদা রোতে থাকে।</p>
          <div className="grid grid-cols-2 gap-1.5">
            <input className="input !text-xs" placeholder="IMAP Host" value={emailForm.imapHost} onChange={(e) => setEmailForm({ ...emailForm, imapHost: e.target.value })} />
            <input className="input !text-xs" type="number" placeholder="IMAP Port" value={emailForm.imapPort} onChange={(e) => setEmailForm({ ...emailForm, imapPort: Number(e.target.value) || 993 })} />
            <input className="input !text-xs" placeholder="SMTP Host" value={emailForm.smtpHost} onChange={(e) => setEmailForm({ ...emailForm, smtpHost: e.target.value })} />
            <input className="input !text-xs" type="number" placeholder="SMTP Port" value={emailForm.smtpPort} onChange={(e) => setEmailForm({ ...emailForm, smtpPort: Number(e.target.value) || 587 })} />
          </div>
          <input className="input w-full" placeholder="ইমেইল ঠিকানা" value={emailForm.user} onChange={(e) => setEmailForm({ ...emailForm, user: e.target.value })} />
          <input className="input w-full" type="password" placeholder="Password / App Password" value={emailForm.password} onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary btn-sm" disabled={!emailForm.imapHost || !emailForm.user || busy !== ""} onClick={() => void connectEmail()}>{busy === "email" ? "যাচাই হচ্ছে..." : "যাচাই করে কানেক্ট"}</button>
            <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => void syncEmail()}>এখন Sync</button>
          </div>
          {emailResult ? <p className="text-xs text-slate-600">{emailResult}</p> : null}
        </div>
      </div>
    </div>
  );
}
