"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { formatMinorTaka } from "@/lib/storefront-money";
import { poStatusLabel, type SupplierPortalHome } from "@/lib/dropship-nf12";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { pubT, publicDicts } from "@/lib/i18n/public";
import { tr } from "@/lib/i18n/lookup";

const t = pubT();

/**
 * NF12 (FB4) — the supplier's own portal page. The token in
 * the URL is the only credential (resolved by SHA-256 hash
 * server-side). This page can ONLY ever show this supplier's
 * own purchase orders from the one org that issued the link —
 * the API behind it has no route to anything else — plus the
 * supplier's own lead-time editor. Confirm rides the org's
 * existing draft→ordered PO transition; "পাঠানো হয়েছে" is a
 * stamp the org sees, not a new status.
 */
export default function SupplierPortalPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [data, setData] = useState<SupplierPortalHome | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [leadDays, setLeadDays] = useState("");
  const [leadNote, setLeadNote] = useState("");
  const [shipNote, setShipNote] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/public/supplier/${encodeURIComponent(token)}`);
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.message ?? t.supplierPublic.notFound);
      }
      const home = (await res.json()) as SupplierPortalHome;
      setData(home);
      setLeadDays(home.supplier.leadTimeDays == null ? "" : String(home.supplier.leadTimeDays));
      setLeadNote(home.supplier.leadTimeNote ?? "");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t.supplierPublic.notFound);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const post = async (path: string, key: string, body?: unknown) => {
    setBusy(key); setNotice("");
    try {
      const res = await fetch(`${API_URL}/public/supplier/${encodeURIComponent(token)}${path}`, {
        method: body === undefined ? "POST" : "PATCH",
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.message ?? t.supplierPublic.somethingWrong);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.supplierPublic.somethingWrong);
    } finally { setBusy(""); }
  };

  if (error && !data) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <div className="rounded bg-red-50 p-4 text-red-700">{error}</div>
      </main>
    );
  }
  if (!data) return <main className="mx-auto max-w-2xl p-6">{t.supplierPublic.loading}</main>;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">{t.supplierPublic.title}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {data.organizationName ?? ""} — {data.supplier.name}{t.supplierPublic.introSuffix}
        </p>
        <p className="text-xs text-slate-500">{t.supplierPublic.linkExpiryPrefix}{fmtDateTime("bn", data.linkExpiresAt)}</p>
      </header>
      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded bg-green-50 p-3 text-sm text-green-700">{notice}</div>}

      <section className="rounded border p-4">
        <h2 className="font-semibold">{t.supplierPublic.leadTimeTitle}</h2>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-sm">{t.supplierPublic.daysLabel}
            <input className="ml-1 w-24 rounded border px-2 py-1" inputMode="numeric" value={leadDays}
              onChange={(e) => setLeadDays(e.target.value)} /></label>
          <label className="text-sm">{t.supplierPublic.noteLabel}
            <input className="ml-1 w-64 rounded border px-2 py-1" value={leadNote}
              onChange={(e) => setLeadNote(e.target.value)} /></label>
          <button className="rounded bg-blue-600 px-3 py-1 text-white" disabled={busy === "lead"}
            onClick={() => void (async () => {
              setBusy("lead");
              try {
                const res = await fetch(`${API_URL}/public/supplier/${encodeURIComponent(token)}/lead-time`, {
                  method: "PATCH", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ leadTimeDays: leadDays.trim() === "" ? null : Number(leadDays), leadTimeNote: leadNote || null }),
                });
                if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? t.supplierPublic.somethingWrong); }
                setNotice(t.supplierPublic.leadSaved); await load();
              } catch (e) { setError(e instanceof Error ? e.message : t.supplierPublic.somethingWrong); }
              finally { setBusy(""); }
            })()}>{t.supplierPublic.save}</button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">{t.supplierPublic.myOrdersTitle}</h2>
        {data.purchaseOrders.map((po) => (
          <article key={po.id} className="rounded border p-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <span className="font-medium">#{po.id.slice(0, 8)}</span>
              <span className="rounded bg-slate-100 px-2 py-0.5">{poStatusLabel(po.status)}</span>
              <span>{t.supplierPublic.totalPrefix}<b>{formatMinorTaka(po.totalMinor)}</b></span>
              <span className="text-slate-500">{fmtDateTime("bn", po.createdAt)}</span>
              {po.supplierConfirmedAt && <span className="text-green-700">{t.supplierPublic.confirmedPrefix}{fmtDateTime("bn", po.supplierConfirmedAt)}</span>}
              {po.supplierShippedAt && <span className="text-blue-700">{t.supplierPublic.shippedPrefix}{fmtDateTime("bn", po.supplierShippedAt)}</span>}
            </div>
            {po.note && <div className="mt-1 text-slate-600">{po.note}</div>}
            <ul className="mt-2 space-y-1">
              {po.items.map((i) => (
                <li key={i.id} className="flex flex-wrap gap-2 text-slate-700">
                  <span>{i.productName ?? "—"}{i.sku ? ` (${i.sku})` : ""}</span>
                  <span>{tr(publicDicts, "bn", "supplierPublic.itemsLine", { ordered: fmtNumber("bn", i.qtyOrdered), received: fmtNumber("bn", i.qtyReceived) })}</span>
                  <span>{formatMinorTaka(i.unitCostMinor)}{t.supplierPublic.perUnitSuffix}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {(po.status === "draft") && (
                <button className="rounded bg-green-600 px-3 py-1 text-white" disabled={busy === po.id}
                  onClick={() => void post(`/purchase-orders/${po.id}/confirm`, po.id)}>{t.supplierPublic.confirmButton}</button>
              )}
              {(po.status === "ordered" || po.status === "partially_received") && !po.supplierShippedAt && (
                <>
                  <input className="rounded border px-2 py-1" placeholder={t.supplierPublic.shipNotePlaceholder} value={shipNote[po.id] ?? ""}
                    onChange={(e) => setShipNote({ ...shipNote, [po.id]: e.target.value })} />
                  <button className="rounded bg-blue-600 px-3 py-1 text-white" disabled={busy === po.id}
                    onClick={() => void (async () => {
                      setBusy(po.id);
                      try {
                        const res = await fetch(`${API_URL}/public/supplier/${encodeURIComponent(token)}/purchase-orders/${po.id}/ship`, {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ note: shipNote[po.id] || undefined }),
                        });
                        if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.message ?? t.supplierPublic.somethingWrong); }
                        setNotice(t.supplierPublic.shippedNotice); await load();
                      } catch (e) { setError(e instanceof Error ? e.message : t.supplierPublic.somethingWrong); }
                      finally { setBusy(""); }
                    })()}>{t.supplierPublic.shipButton}</button>
                </>
              )}
            </div>
          </article>
        ))}
        {data.purchaseOrders.length === 0 && <p className="text-sm text-slate-500">{t.supplierPublic.empty}</p>}

      </section>
    </main>
  );
}
