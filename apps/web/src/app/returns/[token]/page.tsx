"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { pubT, publicDicts } from "@/lib/i18n/public";
import { tr } from "@/lib/i18n/lookup";

const t = pubT();

interface PublicOrderItem { id: string; name: string; quantity: number }
interface SubmittedItem { orderItemId: string; quantity: number }
interface ReturnView {
  status: string;
  submitted: boolean;
  reason: string | null;
  resolution: string | null;
  order: { number: string | null; placedAt: string | null; items: PublicOrderItem[] };
  items: SubmittedItem[] | null;
}

/**
 * EC9 — public customer return page. The unguessable token in the
 * URL is the only credential (same pattern as the public review
 * page): plain fetch against ${API_URL}/returns/<token>, no auth.
 * Once submitted, the page renders the application read-only and
 * the API refuses a second submit.
 */
export default function PublicReturnPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [data, setData] = useState<ReturnView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function load() {
    try {
      const res = await fetch(`${API_URL}/returns/${token}`);
      if (res.status === 404) { setNotFound(true); return; }
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? t.returnsPublic.loadFailed);
      const view = j as ReturnView;
      setData(view);
      setQuantities((prev) => {
        const next = { ...prev };
        for (const item of view.order?.items ?? []) {
          if (next[item.id] == null) next[item.id] = item.quantity;
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t.returnsPublic.loadFailed);
    }
  }

  useEffect(() => { void load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!data) return;
    const chosen = (data.order.items ?? []).filter((item) => included[item.id]);
    if (chosen.length === 0) { setError(t.returnsPublic.chooseItem); return; }
    for (const item of chosen) {
      const qty = quantities[item.id] ?? 0;
      if (!(qty >= 1) || qty > item.quantity) {
        setError(tr(publicDicts, "bn", "returnsPublic.qtyRange", { name: item.name, max: fmtNumber("bn", item.quantity) }) ?? "");
        return;
      }
    }
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/returns/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reason.trim() || undefined,
          items: chosen.map((item) => ({ orderItemId: item.id, quantity: quantities[item.id] })),
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? t.returnsPublic.submitFailed);
      setDone(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.returnsPublic.submitFailed);
    } finally { setBusy(false); }
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-xl space-y-5 p-6">
        <h1 className="text-2xl font-bold">{t.returnsPublic.notFoundTitle}</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {t.returnsPublic.notFound}
        </div>
      </main>
    );
  }

  const submittedItems = data?.items ?? [];

  return (
    <main className="mx-auto max-w-xl space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-bold">{t.returnsPublic.title}</h1>
        {data?.order?.number ? <p className="mt-1 text-sm text-slate-500">{t.returnsPublic.orderPrefix}{data.order.number}</p> : null}
        {data?.order?.placedAt ? (
          <p className="text-sm text-slate-500">{t.returnsPublic.orderDatePrefix}{fmtDateTime("bn", data.order.placedAt)}</p>
        ) : null}
      </header>

      {!data && !error ? <p className="text-sm text-slate-500">{t.returnsPublic.loading}</p> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}

      {done ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-sm font-semibold text-emerald-800">{t.returnsPublic.doneTitle}</p>
          <p className="mt-1 text-sm text-emerald-700">{t.returnsPublic.doneText}</p>
          {data ? <p className="mt-1 text-sm text-emerald-700">{t.returnsPublic.currentStatusPrefix}{data.status}</p> : null}
        </section>
      ) : null}

      {data && data.submitted && !done ? (
        <section className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold">{t.returnsPublic.alreadySubmitted}</p>
          <p className="text-sm">{t.returnsPublic.statusLabelPrefix}<span className="font-semibold">{data.status}</span></p>
          {data.resolution ? <p className="text-sm">{t.returnsPublic.resolutionPrefix}{data.resolution}</p> : null}
          <div>
            <div className="text-sm font-medium">{t.returnsPublic.reasonTitle}</div>
            <p className="mt-1 text-sm text-slate-700">{data.reason ?? "—"}</p>
          </div>
          {submittedItems.length > 0 ? (
            <div>
              <div className="text-sm font-medium">{t.returnsPublic.itemsTitle}</div>
              <ul className="mt-1 space-y-1 text-sm text-slate-700">
                {submittedItems.map((line) => {
                  const name = data.order.items.find((i) => i.id === line.orderItemId)?.name ?? line.orderItemId;
                  return <li key={line.orderItemId}>{name} × {line.quantity}</li>;
                })}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {data && !data.submitted && !done ? (
        <section className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div>
            <div className="mb-2 text-sm font-medium">{t.returnsPublic.chooseItemsTitle}</div>
            <ul className="space-y-2">
              {(data.order.items ?? []).map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex min-w-52 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(included[item.id])}
                      onChange={(e) => setIncluded((prev) => ({ ...prev, [item.id]: e.target.checked }))}
                    />
                    <span>{item.name} <span className="text-slate-400">{t.returnsPublic.orderedSuffixPrefix}{fmtNumber("bn", item.quantity)})</span></span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-600">{t.returnsPublic.quantityLabel}
                    <input
                      type="number"
                      className="input w-20"
                      min={1}
                      max={item.quantity}
                      value={quantities[item.id] ?? item.quantity}
                      disabled={!included[item.id]}
                      onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: Number(e.target.value) }))}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <label className="block text-sm font-medium">{t.returnsPublic.reasonLabel}
            <textarea
              className="input mt-1"
              rows={4}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.returnsPublic.reasonPlaceholder}
            />
          </label>
          <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
            {busy ? t.returnsPublic.submitting : t.returnsPublic.submit}

          </button>
        </section>
      ) : null}
    </main>
  );
}
