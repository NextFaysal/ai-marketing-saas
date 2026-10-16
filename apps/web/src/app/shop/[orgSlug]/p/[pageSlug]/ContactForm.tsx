"use client";
import React, { useState } from "react";
import { API_URL } from "@/lib/api";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";

export function ContactForm({ orgSlug, locale = "bn" }: { orgSlug: string; locale?: ShopLocale | string }) {
  const t = shopT(locale);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    setSent(null);
    try {
      const res = await fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, message }),
      });
      if (!res.ok) throw new Error("failed");
      const data = (await res.json().catch(() => ({}))) as { deliveredVia?: string };
      setSent(data.deliveredVia === "stored_only" ? t.pages.sentStored : t.pages.sentDelivered);
      setName("");
      setPhone("");
      setMessage("");
    } catch {
      setError(t.pages.sendError);
    } finally {
      setSending(false);
    }
  }

  const inputCls = "w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-indigo-600 focus:outline-none";
  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-700">{t.pages.nameLabel}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-700">{t.pages.phoneLabel}</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} required className={inputCls} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-700">{t.pages.messageLabel}</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} required rows={4} className={inputCls} />
      </div>
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}
      {sent ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{sent}</p> : null}
      <button type="submit" disabled={sending} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
        {sending ? t.pages.sending : t.pages.sendButton}
      </button>
    </form>
  );
}
