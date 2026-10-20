"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "@/lib/api";
import { fmtDateTime } from "@repo/contracts";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

/**
 * OU8 — public ticket tracking page. The signed token in the URL
 * is the only credential (no login): it shows the ticket's status
 * and PUBLIC replies only (the API filters internal notes at the
 * query) and lets the customer add a public reply. A bad/expired
 * token gets one honest not-found state — never a login wall.
 */
interface PublicMessage { id: string; body: string; authorKind: string; createdAt: string }
interface PublicTicket {
  id: string; subject: string; category: string; status: string; priority: string;
  createdAt: string; messages: PublicMessage[];
}

const STATUS_LABEL: Record<string, string> = {
  open: t.ticketTrack.statusOpen,
  pending: t.ticketTrack.statusPending,
  in_progress: t.ticketTrack.statusInProgress,
  resolved: t.ticketTrack.statusResolved,
  closed: t.ticketTrack.statusClosed,
};

export default function TicketTrackPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const [ticket, setTicket] = useState<PublicTicket | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/public/tickets/track/${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error("nf");
      setTicket((await res.json()) as PublicTicket);
      setState("ok");
    } catch {
      setState("notfound");
    }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim() || sending) return;
    setSending(true);
    setReplyError("");
    try {
      const res = await fetch(`${API_URL}/public/tickets/track/${encodeURIComponent(token)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply.trim() }),
      });
      if (!res.ok) throw new Error("bad");
      setReply("");
      await load();
    } catch {
      setReplyError(t.ticketTrack.replyFailed);
    } finally {
      setSending(false);
    }
  }

  if (state === "loading") {
    return <main className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-slate-500">{t.ticketTrack.loading}</main>;
  }
  if (state === "notfound" || !ticket) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-3xl">🔍</p>
        <h1 className="mt-3 text-lg font-black text-slate-900">{t.ticketTrack.notFoundTitle}</h1>
        <p className="mt-2 text-sm text-slate-500">{t.ticketTrack.notFoundText}</p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t.ticketTrack.headerPrefix}{ticket.id.slice(-6).toUpperCase()}</p>
        <h1 className="text-xl font-black text-slate-900">{ticket.subject}</h1>
        <p className="text-sm text-slate-500">
          {t.ticketTrack.statusLabel}<b className="text-slate-700">{STATUS_LABEL[ticket.status] ?? ticket.status}</b>
          {" · "}{t.ticketTrack.openedPrefix}{fmtDateTime("bn", ticket.createdAt)}
        </p>
      </header>
      <section className="space-y-3">
        {ticket.messages.map((m) => {
          const mine = m.authorKind === "customer" || m.authorKind === "tenant";
          return (
            <article key={m.id} className={`rounded-2xl border p-4 ${mine ? "border-indigo-100 bg-indigo-50/60" : "border-slate-200 bg-white"}`}>
              <p className="text-xs font-bold text-slate-400">{mine ? t.ticketTrack.you : t.ticketTrack.supportTeam} · {fmtDateTime("bn", m.createdAt)}</p>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-700">{m.body}</p>
            </article>
          );
        })}
        {ticket.messages.length === 0 ? <p className="text-sm text-slate-500">{t.ticketTrack.noMessages}</p> : null}
      </section>
      <form onSubmit={sendReply} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
        <label className="block text-sm font-semibold text-slate-700">{t.ticketTrack.replyLabel}</label>
        <textarea className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t.ticketTrack.replyPlaceholder} />
        {replyError ? <p className="text-xs font-semibold text-red-600">{replyError}</p> : null}
        <button type="submit" disabled={sending || !reply.trim()} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
          {sending ? t.ticketTrack.sending : t.ticketTrack.sendReply}

        </button>
      </form>
    </main>
  );
}
