"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useConfirm, useToast } from "@repo/ui/client";

// EC28 — staff product Q&A moderation. Consumes
// organizations/:orgId/product-questions:
//   GET    ?status=pending|published|hidden -> { items, total }
//   POST   :id/answer { answer }            -> answering PUBLISHES
//   POST   :id/visibility { hidden }        -> hide / unhide
//   DELETE :id
// Questions land as "pending" from the public product page and
// are invisible to shoppers until answered here. The asker's
// phone is staff-only context (it is never in the public payload).

interface StaffQuestion {
  id: string;
  productId: string;
  productName: string | null;
  customerName: string;
  phone: string | null;
  question: string;
  answer: string | null;
  status: string;
  createdAt: string | null;
  answeredAt: string | null;
}

const STATUS_FILTERS = [
  { value: "", labelKey: "all" },
  { value: "pending", labelKey: "pending" },
  { value: "published", labelKey: "published" },
  { value: "hidden", labelKey: "hidden" },
];

function statusBadge(status: string): string {
  switch (status) {
    case "pending": return "bg-amber-100 text-amber-700";
    case "published": return "bg-green-100 text-green-700";
    case "hidden": return "bg-slate-200 text-slate-600";
    default: return "bg-slate-200 text-slate-600";
  }
}

export default function ProductQuestionsPage() {
  const { dict, t, locale } = useLocale();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [items, setItems] = useState<StaffQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError(dict.commerce.noOrganizationSelected); setLoading(false); return; }
    setLoading(true);
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      const data = await apiFetch<{ items: StaffQuestion[]; total: number }>(`/organizations/${orgId}/product-questions${qs}`);
      setItems(data.items ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.couldNotLoadTheQuestion);
    } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function act(id: string, key: string, run: () => Promise<unknown>, okMessage: string) {
    setError(""); setBusy(`${key}-${id}`);
    try {
      await run();
      toast({ title: okMessage, tone: "success" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.theActionCouldNotBe);
    } finally { setBusy(""); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900">{dict.commerce.productQA2}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {dict.commerce.buyersQuestionsComeHereAnswering}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-full px-4 py-1.5 text-xs font-bold ${statusFilter === f.value ? "bg-indigo-600 text-white" : "bg-white text-slate-700 border border-slate-200"}`}
          >
            {dict.commerce[f.labelKey as keyof typeof dict.commerce]}
          </button>
        ))}
      </div>

      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-slate-500">{dict.common.loading}</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm font-semibold text-slate-500">
          {dict.commerce.noQuestionsInThisState}</div>
      ) : (
        <div className="space-y-3">
          {items.map((q) => (
            <article key={q.id} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusBadge(q.status)}`}>{q.status}</span>
                <span className="text-sm font-bold text-slate-800">{q.productName ?? q.productId}</span>
                <span className="text-xs text-slate-400">
                  {q.customerName}
                  {q.phone ? ` · ${q.phone}` : ""}
                  {q.createdAt ? ` · ${fmtDateTime(locale, new Date(q.createdAt))}` : ""}
                </span>
              </div>
              <p className="text-sm text-slate-700">❓ {q.question}</p>
              {q.answer ? <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">💬 {q.answer}</p> : null}
              <div className="flex flex-wrap items-start gap-2">
                <textarea
                  value={answerDrafts[q.id] ?? q.answer ?? ""}
                  onChange={(e) => setAnswerDrafts({ ...answerDrafts, [q.id]: e.target.value })}
                  placeholder={dict.commerce.writeAnAnswerItWill}
                  rows={2}
                  className="min-w-64 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-600 focus:outline-none"
                />
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={busy === `answer-${q.id}`}
                    onClick={() => {
                      const orgId = getOrganizationId(); if (!orgId) return;
                      void act(q.id, "answer", () => apiFetch(`/organizations/${orgId}/product-questions/${q.id}/answer`, {
                        method: "POST",
                        body: JSON.stringify({ answer: (answerDrafts[q.id] ?? "").trim() }),
                      }), dict.commerce.answerPublished);
                    }}
                    className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {dict.commerce.answerPublish}</button>
                  <button
                    type="button"
                    disabled={busy === `vis-${q.id}`}
                    onClick={() => {
                      const orgId = getOrganizationId(); if (!orgId) return;
                      const hidden = q.status !== "hidden";
                      void act(q.id, "vis", () => apiFetch(`/organizations/${orgId}/product-questions/${q.id}/visibility`, {
                        method: "POST",
                        body: JSON.stringify({ hidden }),
                      }), hidden ? dict.commerce.questionHidden : dict.commerce.questionShownAgain);
                    }}
                    className="rounded-lg border px-4 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50"
                  >
                    {q.status === "hidden" ? dict.commerce.unhide : dict.commerce.hide}
                  </button>
                  <button
                    type="button"
                    disabled={busy === `del-${q.id}`}
                    onClick={async () => {
                      if (!(await confirm({ title: dict.commerce.deleteThisQuestion, danger: true, confirmLabel: dict.commerce.delete2 }))) return;
                      const orgId = getOrganizationId(); if (!orgId) return;
                      void act(q.id, "del", () => apiFetch(`/organizations/${orgId}/product-questions/${q.id}`, {
                        method: "DELETE",
                      }), dict.commerce.questionDeleted);
                    }}
                    className="rounded-lg border border-rose-200 px-4 py-1.5 text-xs font-bold text-rose-600 disabled:opacity-50"
                  >
                    {dict.commerce.delete}</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
