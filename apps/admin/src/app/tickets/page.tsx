"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch } from "@/lib/api";

interface TicketMessage { id: string; authorKind: string; body: string; createdAt: string }
interface Ticket {
  id: string; organizationId: string; organizationName?: string | null; subject: string;
  status: string; priority: string; assignedToId?: string | null; lastMessageAt: string;
  messageCount?: number; messages?: TicketMessage[]; creatorEmail?: string | null;
}
interface Admin { id: string; email: string }

const STATUS_LABEL: Record<string, string> = { open: "🟢 Open", pending: "🟡 Pending", resolved: "✅ Resolved", closed: "⚪ Closed" };
const FILTERS = ["", "open", "pending", "resolved", "closed"] as const;

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setTickets(await apiFetch<Ticket[]>(`/admin/tickets${filter ? `?status=${filter}` : ""}`)); } catch { /* honest empty */ }
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiFetch<{ admins: Admin[] }>("/admin/security").then((s) => setAdmins(s.admins ?? [])).catch(() => undefined);
  }, []);

  const open = async (id: string) => {
    try { setSelected(await apiFetch<Ticket>(`/admin/tickets/${id}`)); } catch (e) { setError(e instanceof Error ? e.message : "Ticket খোলা যায়নি"); }
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setError(""); setNote("");
    try {
      const res = await apiFetch<{ emailSent: number; emailError: string | null }>(`/admin/tickets/${selected.id}/messages`, { method: "POST", body: JSON.stringify({ body: reply }) });
      setReply("");
      setNote(res.emailError ? `উত্তর সেভ হয়েছে, কিন্তু ইমেইল যায়নি: ${res.emailError}` : `উত্তর পাঠানো হয়েছে · ${res.emailSent} জনকে ইমেইলে জানানো হয়েছে`);
      await open(selected.id); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "উত্তর যায়নি"); }
  };

  const update = async (patch: Record<string, unknown>) => {
    if (!selected) return;
    try {
      await apiFetch(`/admin/tickets/${selected.id}/status`, { method: "POST", body: JSON.stringify(patch) });
      await open(selected.id); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "আপডেট হয়নি"); }
  };

  return (
    <AdminShell title="Support Tickets">
      {error ? <p className="anote" style={{ borderColor: "#fecaca", color: "#991b1b" }}>{error}</p> : null}
      {note ? <p className="anote">{note}</p> : null}
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f || "all"} onClick={() => setFilter(f)} className={filter === f ? "abtn abtn-primary" : "abtn"}>{f ? STATUS_LABEL[f] : "সব"}</button>
        ))}
      </div>
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="space-y-2">
          {tickets.length === 0 ? <div className="acard"><p className="amut">এই ফিল্টারে কোনো Ticket নেই।</p></div> : null}
          {tickets.map((t) => (
            <button key={t.id} onClick={() => open(t.id)} className="acard" style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", ...(selected?.id === t.id ? { outline: "2px solid #6366f1" } : {}) }}>
              <div className="flex items-center justify-between gap-2">
                <b style={{ fontSize: 14 }}>{t.priority === "high" ? "🔴 " : ""}{t.subject}</b>
                <span style={{ fontSize: 12 }}>{STATUS_LABEL[t.status] ?? t.status}</span>
              </div>
              <p className="amut" style={{ marginTop: 4 }}>{t.organizationName ?? t.organizationId} · {t.messageCount ?? 0} বার্তা · {new Date(t.lastMessageAt).toLocaleString("bn-BD")}</p>
            </button>
          ))}
        </div>
        <div className="acard">
          {!selected ? <p className="amut">একটি Ticket বেছে নিন।</p> : (
            <>
              <div className="ahead">
                <h3 style={{ margin: 0 }}>{selected.subject}</h3>
                <span className="abadge">{STATUS_LABEL[selected.status] ?? selected.status}</span>
              </div>
              <p className="amut">{selected.organizationName} · তৈরি করেছেন {selected.creatorEmail ?? "—"}</p>
              <div className="flex flex-wrap gap-2" style={{ margin: "10px 0" }}>
                <select value={selected.status} onChange={(e) => update({ status: e.target.value })} className="ainput" style={{ width: "auto" }}>
                  {Object.keys(STATUS_LABEL).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
                <select value={selected.assignedToId ?? ""} onChange={(e) => update({ assignedToId: e.target.value || null })} className="ainput" style={{ width: "auto" }}>
                  <option value="">Assign: কেউ নয়</option>
                  {admins.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
                </select>
                <select value={selected.priority} onChange={(e) => update({ priority: e.target.value })} className="ainput" style={{ width: "auto" }}>
                  <option value="normal">সাধারণ</option>
                  <option value="high">জরুরি</option>
                </select>
              </div>
              <div className="space-y-2">
                {(selected.messages ?? []).map((m) => (
                  <div key={m.id} style={{ borderRadius: 12, padding: "8px 12px", fontSize: 13.5, background: m.authorKind === "admin" ? "#eef2ff" : "#f1f5f9", marginLeft: m.authorKind === "admin" ? 0 : 32, marginRight: m.authorKind === "admin" ? 32 : 0 }}>
                    <p style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>{m.authorKind === "admin" ? "🛠 প্ল্যাটফর্ম টিম" : "Tenant"} · {new Date(m.createdAt).toLocaleString("bn-BD")}</p>
                    <p style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>{m.body}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2" style={{ marginTop: 12 }}>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} className="ainput" placeholder="উত্তর লিখুন — Tenant ইমেইলেও পাবে…" />
                <button className="abtn abtn-primary" onClick={sendReply} disabled={!reply.trim()}>পাঠান</button>
              </div>
            </>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
