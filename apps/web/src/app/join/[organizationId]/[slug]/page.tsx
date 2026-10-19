"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

interface PublicForm {
  name: string; slug: string; headline?: string | null; description?: string | null;
  channels: string[]; topic?: string | null; doubleOptIn: boolean; organizationName: string | null;
  popup?: { enabled?: boolean; delaySeconds?: number; headline?: string } | null;
}

/**
 * MX10 — the public opt-in (join) page for a messaging-native
 * signup form: the target of the form's QR code, embed iframe
 * and shared links. Renders the org's form config from the
 * public API (config only — no subscriber data) and submits to
 * the public submit endpoint. With double opt-in the visitor
 * is told plainly that confirmation is still required.
 */
export default function PublicJoinPage() {
  const params = useParams();
  const organizationId = String(params.organizationId ?? "");
  const slug = String(params.slug ?? "");
  const [form, setForm] = useState<PublicForm | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/public/messaging/forms/${organizationId}/${slug}`);
        if (!res.ok) throw new Error(t.optinForm.notFound);
        setForm(await res.json());
      } catch (e) { setError(e instanceof Error ? e.message : t.optinForm.notFound); }
    })();
  }, [organizationId, slug]);

  async function submit() {
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/public/messaging/forms/${organizationId}/${slug}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || undefined, email: email.trim() || undefined, phone: phone.trim() || undefined }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? t.optinForm.submitFailed);
      setDone(j?.message ?? t.optinForm.thanks);
    } catch (e) { setError(e instanceof Error ? e.message : t.optinForm.submitFailed); }
    finally { setBusy(false); }
  }

  const needsEmail = form?.channels.includes("email");
  const needsPhone = form?.channels.some((c) => c === "sms" || c === "whatsapp");

  return (
    <main className="mx-auto max-w-xl space-y-5 p-6">
      {!form && !error ? <p className="text-sm text-slate-500">{t.optinForm.loading}</p> : null}
      {error && !done ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {form && !done ? (
        <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm">
          <header>
            {form.organizationName ? <p className="text-xs uppercase tracking-wide text-slate-400">{form.organizationName}</p> : null}
            <h1 className="mt-1 text-2xl font-bold">{form.headline || form.name}</h1>
            {form.description ? <p className="mt-1 text-sm text-slate-600">{form.description}</p> : null}
          </header>
          <label className="block text-sm">{t.optinForm.nameLabel}
            <input className="input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.optinForm.namePlaceholder} />
          </label>
          {needsEmail ? (
            <label className="block text-sm">{t.optinForm.emailLabel}
              <input className="input mt-1 w-full" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
          ) : null}
          {needsPhone ? (
            <label className="block text-sm">{t.optinForm.phoneLabel}
              <input className="input mt-1 w-full" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" />
            </label>
          ) : null}
          <button className="btn-primary w-full" disabled={busy} onClick={submit}>{busy ? t.optinForm.working : t.optinForm.subscribe}</button>
          <p className="text-xs text-slate-400">
            {form.doubleOptIn
              ? t.optinForm.doubleOptInNote
              : t.optinForm.singleOptInNote}

          </p>
        </section>
      ) : null}
      {done ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-sm font-semibold text-emerald-800">✅ {done}</p>
        </section>
      ) : null}
    </main>
  );
}
