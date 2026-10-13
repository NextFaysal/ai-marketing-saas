"use client";
import React, { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";

interface PublicQuestion {
  id: string;
  customerName: string;
  question: string;
  answer: string | null;
  createdAt: string | null;
  answeredAt: string | null;
}

/**
 * EC28 — public product Q&A: shows PUBLISHED questions only (the
 * API never returns pending ones, and never returns the asker's
 * phone). Asking lands as pending — the success note says exactly
 * that; it does not pretend the question is already public.
 */
export function ProductQuestions({
  orgSlug,
  productSlug,
  locale = "bn",
}: {
  orgSlug: string;
  productSlug: string;
  locale?: ShopLocale | string;
}) {
  const t = shopT(locale);
  const [items, setItems] = useState<PublicQuestion[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [received, setReceived] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/products/${encodeURIComponent(productSlug)}/questions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data?.items) setItems(data.items as PublicQuestion[]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [orgSlug, productSlug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setReceived(false);
    try {
      const res = await fetch(
        `${API_URL}/public/shop/${encodeURIComponent(orgSlug)}/products/${encodeURIComponent(productSlug)}/questions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: name.trim(),
            phone: phone.trim() ? phone.trim() : undefined,
            question: question.trim(),
          }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? t.product.questionSubmit);
      setReceived(true);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-black text-slate-900">{t.product.questionsHeading}</h2>
      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((q) => (
            <article key={q.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-slate-800">❓ {q.question}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {q.customerName}
                {q.createdAt ? ` · ${new Date(q.createdAt).toLocaleDateString("bn-BD")}` : ""}
              </p>
              {q.answer ? <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">💬 {q.answer}</p> : null}
            </article>
          ))}
        </div>
      ) : null}
      <form onSubmit={submit} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.product.questionNamePlaceholder}
            required
            minLength={2}
            maxLength={120}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t.product.questionPhonePlaceholder}
            maxLength={30}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none"
          />
        </div>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t.product.questionPlaceholder}
          required
          minLength={5}
          maxLength={1000}
          rows={2}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none"
        />
        {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p> : null}
        {received ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{t.product.questionReceived}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? t.product.questionSubmitting : t.product.questionSubmit}
        </button>
      </form>
    </section>
  );
}
