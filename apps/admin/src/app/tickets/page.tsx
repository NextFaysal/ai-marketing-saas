"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { EmptyState, ErrorState, SavedViewsBar } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";

interface TicketMessage { id: string; authorKind: string; body: string; createdAt: string }
interface Ticket {
  id: string; organizationId: string; organizationName?: string | null; subject: string;
  status: string; priority: string; assignedToId?: string | null; lastMessageAt: string;
  messageCount?: number; messages?: TicketMessage[]; creatorEmail?: string | null;
  // GC23: category + read-time SLA state (admin payloads only).
  category?: string; firstRespondedAt?: string | null;
  slaBreached?: boolean; slaDueAt?: string; slaHours?: number;
}
interface Admin { id: string; email: string }

const STATUS_LABEL: Record<string, string> = { open: "🟢 Open", pending: "🟡 Pending", resolved: "✅ Resolved", closed: "⚪ Closed" };
const FILTERS = ["", "open", "pending", "resolved", "closed"] as const;
const CATEGORY_LABEL: Record<string, string> = { billing: "💳 Billing", technical: "🛠 Technical", account: "👤 Account", feature: "✨ Feature", other: "📁 Other" };
const CATEGORY_FILTERS = ["", "billing", "technical", "account", "feature", "other"] as const;

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [slaOnly, setSlaOnly] = useState(false);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  // ADX12: list loading / load-failure states — before, the initial
  // load and a failed load both showed the "no tickets" card.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    if (categoryFilter) params.set("category", categoryFilter);
    if (slaOnly) params.set("sla", "breached");
    const qs = params.toString();
    try { setTickets(await apiFetch<Ticket[]>(`/admin/tickets${qs ? `?${qs}` : ""}`)); setLoadError(""); }
    catch (e) { setLoadError(e instanceof Error ? e.message : "Ticket তালিকা লোড ব্যর্থ হয়েছে"); }
    finally { setLoading(false); }
  }, [filter, categoryFilter, slaOnly]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiFetch<{ admins: Admin[] }>("/admin/security").then((s) => setAdmins(s.admins ?? [])).catch(() => undefined);
  }, []);

  const open = async (id: string) => {
    try { setSelected(await apiFetch<Ticket>(`/admin/tickets/${id}`)); } catch (e) { setError(e instanceof Error ? e.message : "Ticket খোলা যায়নি"); }
  };

  // ADX10: inbox ordering — জরুরি (high priority) আগে, তারপর সর্বশেষ
  // বার্তার সময় অনুযায়ী নতুন আগে। সাজানো এই পেজে লোড করা
  // তালিকার ওপরেই (সার্ভারের filter আগের মতোই)।
  const shown = [...tickets].sort((a, b) => {
    const pa = a.priority === "high" ? 0 : 1;
    const pb = b.priority === "high" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  });

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
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="amut" style={{ fontSize: 12.5 }}>বিভাগ:</span>
        {CATEGORY_FILTERS.map((c) => (
          <button key={c || "all-cat"} onClick={() => setCategoryFilter(c)} className={categoryFilter === c ? "abtn abtn-primary" : "abtn"}>{c ? CATEGORY_LABEL[c] : "সব বিভাগ"}</button>
        ))}
        <button onClick={() => setSlaOnly(!slaOnly)} className={slaOnly ? "abtn abtn-primary" : "abtn"} style={slaOnly ? {} : { borderColor: "#fecaca", color: "#991b1b" }}>🔴 শুধু SLA অতিক্রম</button>
      </div>
      {/* ADX14: saved views — this page's only filter state is the
          status filter, so a view is a named status preset. */}
      <div className="mb-3 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
        <SavedViewsBar
          page="tickets"
          current={{ filter }}
          onApply={(s) => setFilter(s.filter ?? "")}
        />
      </div>
      <p className="amut" style={{ marginBottom: 8 }}>তালিকা এই পেজেই সাজানো: জরুরি Ticket আগে, তারপর সর্বশেষ বার্তা অনুযায়ী।</p>
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(300px,400px)_1fr]" style={{ alignItems: "start" }}>
        <div className={`space-y-2 ${selected ? "hidden lg:block" : ""}`}>
          {loading && tickets.length === 0 ? <><div className="askel h-20" /><div className="askel h-20" /><div className="askel h-20" /></> : null}
          {!loading && loadError && tickets.length === 0 ? <div className="acard"><ErrorState message={`Ticket লোড হয়নি: ${loadError}`} onRetry={load} /></div> : null}
          {!loading && !loadError && shown.length === 0 ? <div className="acard"><EmptyState title="এই ফিল্টারে কোনো Ticket নেই।" sub="অন্য status বেছে নিন, অথবা সব Ticket দেখতে ওপরের 'সব' ফিল্টারটি চাপুন।" /></div> : null}
          {shown.map((t) => (
            <button key={t.id} onClick={() => open(t.id)} className="acard" style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", ...(selected?.id === t.id ? { outline: "2px solid #6366f1" } : {}) }}>
              <div className="flex items-center justify-between gap-2">
                <b style={{ fontSize: 14 }}>{t.priority === "high" ? "🔴 " : ""}{t.subject}</b>
                <span style={{ fontSize: 12 }}>{STATUS_LABEL[t.status] ?? t.status}</span>
              </div>
              <p className="amut" style={{ marginTop: 4 }}>{t.organizationName ?? t.organizationId} · {t.messageCount ?? 0} বার্তা · {fmtDateTime(t.lastMessageAt)}</p>
              <p style={{ marginTop: 4, fontSize: 12 }}>
                <span className="abadge">{CATEGORY_LABEL[t.category ?? "other"] ?? t.category}</span>
                {t.slaBreached ? <span className="abadge" style={{ marginLeft: 6, background: "#fee2e2", color: "#991b1b", borderColor: "#fecaca" }}>🔴 SLA অতিক্রম — প্রথম উত্তর বাকি (সময়সীমা {t.slaDueAt ? fmtDateTime(t.slaDueAt) : "—"})</span> : null}
              </p>
            </button>
          ))}
        </div>
        <div className={`acard ${selected ? "" : "hidden lg:block"}`}>
          {!selected ? <p className="amut">একটি Ticket বেছে নিন।</p> : (
            <>
              <button className="abtn w-full sm:w-auto lg:hidden" style={{ marginBottom: 10 }} onClick={() => setSelected(null)}>← তালিকায় ফিরুন</button>
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
                <select value={selected.category ?? "other"} onChange={(e) => update({ category: e.target.value })} className="ainput" style={{ width: "auto" }} title="বিভাগ">
                  {Object.entries(CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </div>
              <p className="amut" style={{ margin: "6px 0 2px", fontSize: 12.5 }}>
                SLA: প্রথম উত্তরের সময়সীমা {selected.slaDueAt ? new Date(selected.slaDueAt).toLocaleString("bn-BD") : "—"}
                {selected.firstRespondedAt ? ` · প্রথম উত্তর: ${new Date(selected.firstRespondedAt).toLocaleString("bn-BD")}` : " · প্রথম উত্তর এখনো হয়নি"}
                {selected.slaBreached ? <b style={{ color: "#991b1b" }}> · 🔴 SLA অতিক্রম হয়েছে</b> : ""}
              </p>
              <div className="space-y-2">
                {(selected.messages ?? []).map((m) => (
                  <div key={m.id} style={{ borderRadius: 12, padding: "8px 12px", fontSize: 13.5, background: m.authorKind === "admin" ? "#eef2ff" : "#f1f5f9", marginLeft: m.authorKind === "admin" ? 0 : 32, marginRight: m.authorKind === "admin" ? 32 : 0 }}>
                    <p style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>{m.authorKind === "admin" ? "🛠 প্ল্যাটফর্ম টিম" : "Tenant"} · {fmtDateTime(m.createdAt)}</p>
                    <p style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>{m.body}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row" style={{ marginTop: 12 }}>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} className="ainput" placeholder="উত্তর লিখুন — Tenant ইমেইলেও পাবে…" />
                <button className="abtn abtn-primary w-full sm:w-auto" onClick={sendReply} disabled={!reply.trim()}>পাঠান</button>
              </div>
            </>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
