"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { getOrganizationId } from "../../../lib/org";

interface TicketMessage { id: string; authorKind: string; body: string; createdAt: string }
interface Ticket { id: string; subject: string; status: string; priority: string; category?: string; lastMessageAt: string; createdAt: string; messageCount?: number; messages?: TicketMessage[] }

/**
 * Support Design v2 — presentation layer only. Every handler below
 * (load/open/create/sendReply/setStatus, endpoints, payloads, error
 * surfacing) is the M38 behaviour unchanged; what changed is layout,
 * plus loading skeletons. All counts/badges/times on screen derive
 * from the ticket payloads this page already fetched — the status
 * vocabulary mirrors the API's STATUSES exactly (open/pending/
 * resolved/closed) and priority is normal|high, as the API coerces it.
 */
const STATUS_TEXT: Record<string, string> = { open: "খোলা", pending: "উত্তরের অপেক্ষায়", resolved: "সমাধান হয়েছে", closed: "বন্ধ" };
const STATUS_BADGE: Record<string, string> = { open: "badge-green", pending: "badge-amber", resolved: "badge-brand", closed: "badge-slate" };
const STATUS_DOT: Record<string, string> = { open: "bg-emerald-500", pending: "bg-amber-500", resolved: "bg-brand-500", closed: "bg-slate-400" };
const PRIORITY_TEXT: Record<string, string> = { normal: "সাধারণ", high: "জরুরি" };
/** GC23: ticket category vocabulary (mirrors the API's
 * TICKET_CATEGORIES) with Bengali labels. */
const CATEGORY_TEXT: Record<string, string> = { billing: "বিলিং", technical: "কারিগরি সমস্যা", account: "অ্যাকাউন্ট", feature: "ফিচার অনুরোধ", other: "অন্যান্য" };

/** Status banner in the thread — every line states a fact the API
 *  itself guarantees (admin reply → pending; tenant reply reopens a
 *  resolved/closed ticket; tenants may close/reopen). No SLA promise. */
const STATUS_BANNER: Record<string, { tone: string; text: string }> = {
  open: { tone: "alert-slate", text: "টিকিটটি খোলা আছে — প্ল্যাটফর্ম টিমের উত্তর এখানেই আসবে, ইমেইলেও জানানো হবে।" },
  pending: { tone: "alert-amber", text: "প্ল্যাটফর্ম টিম উত্তর দিয়েছে — এখন আপনার জবাবের অপেক্ষায়। নিচে উত্তর লিখুন।" },
  resolved: { tone: "alert-green", text: "টিকিটটি সমাধান হয়েছে বলে চিহ্নিত করা হয়েছে। সমস্যাটি থেকে গেলে নিচে উত্তর লিখলেই টিকিটটি আবার খুলে যাবে।" },
  closed: { tone: "alert-slate", text: "টিকিটটি বন্ধ আছে। উত্তর পাঠালে অথবা “আবার খুলুন” চাপলে এটি আবার খুলে যাবে।" },
};

const bnNum = (n: number) => n.toLocaleString("bn-BD", { maximumFractionDigits: 0 });

/** Relative time from the real timestamp (list "শেষ কার্যকলাপ"). */
function relativeBn(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "এইমাত্র";
  if (mins < 60) return `${bnNum(mins)} মিনিট আগে`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${bnNum(hours)} ঘণ্টা আগে`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${bnNum(days)} দিন আগে`;
  return new Date(iso).toLocaleDateString("bn-BD", { day: "numeric", month: "short", year: "numeric" });
}

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("bn-BD", { day: "numeric", month: "long", year: "numeric" });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("bn-BD", { hour: "numeric", minute: "2-digit" });
const fullLabel = (iso: string) => new Date(iso).toLocaleString("bn-BD");

function StatusBadge({ status }: { status: string }) {
  const known = status in STATUS_TEXT;
  return (
    <span className={known ? STATUS_BADGE[status] : "badge-slate"}>
      {known ? <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} /> : null}
      {known ? STATUS_TEXT[status] : status}
    </span>
  );
}

export default function SupportPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [error, setError] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("normal");
  const [category, setCategory] = useState("other");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setOrgId(getOrganizationId()); }, []);

  const load = useCallback(async () => {
    if (!orgId) return;
    try { setTickets(await apiFetch<Ticket[]>(`/organizations/${orgId}/tickets`)); } catch { /* honest empty */ }
    finally { setLoading(false); }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const open = async (id: string) => {
    if (!orgId) return;
    setOpening(true);
    try { setSelected(await apiFetch<Ticket>(`/organizations/${orgId}/tickets/${id}`)); } catch (e) { setError(e instanceof Error ? e.message : "Ticket খোলা যাচ্ছে না"); }
    finally { setOpening(false); }
  };

  const create = async () => {
    if (!orgId) return;
    setError("");
    try {
      const t = await apiFetch<Ticket>(`/organizations/${orgId}/tickets`, { method: "POST", body: JSON.stringify({ subject, body, priority, category }) });
      setSubject(""); setBody(""); setPriority("normal"); setCategory("other");
      await load(); setSelected(t);
    } catch (e) { setError(e instanceof Error ? e.message : "Ticket তৈরি হয়নি"); }
  };

  const sendReply = async () => {
    if (!orgId || !selected || !reply.trim()) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/tickets/${selected.id}/messages`, { method: "POST", body: JSON.stringify({ body: reply }) });
      setReply(""); await open(selected.id); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "উত্তর পাঠানো যায়নি"); }
  };

  const setStatus = async (status: string) => {
    if (!orgId || !selected) return;
    try {
      await apiFetch(`/organizations/${orgId}/tickets/${selected.id}/status`, { method: "POST", body: JSON.stringify({ status }) });
      await open(selected.id); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Status বদলায়নি"); }
  };

  // Chat-timeline nicety: keep the newest message in view when a
  // thread opens or a reply lands. Presentation only.
  const lastMsgId = selected?.messages?.length ? selected.messages[selected.messages.length - 1].id : null;
  useEffect(() => {
    if (selected && lastMsgId) threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [selected?.id, lastMsgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = {
    total: tickets.length,
    open: tickets.filter((t) => t.status === "open").length,
    pending: tickets.filter((t) => t.status === "pending").length,
    resolved: tickets.filter((t) => t.status === "resolved").length,
    closed: tickets.filter((t) => t.status === "closed").length,
  };
  const threadActive = !!selected || opening;
  // On mobile the thread takes over the screen (inbox pattern); the
  // hero/summary/feedback/list yield until the back button is used.
  const awayOnMobile = threadActive ? "hidden lg:block" : "";
  const banner = selected ? STATUS_BANNER[selected.status] : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <section className={`hero-panel p-5 sm:p-7 ${awayOnMobile}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">সাপোর্ট</h1>
            <p className="mt-1 max-w-xl text-sm text-white/75">প্ল্যাটফর্ম টিমের কাছে সাহায্য চান — Ticket খুলুন, উত্তর এখানেই পাবেন (ইমেইলেও জানানো হবে)।</p>
          </div>
          <span className="hero-chip">🎫 Support</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
          <a href="#new-ticket" className="quick-action"><span className="text-base leading-none">＋</span><span className="truncate">নতুন টিকিট</span></a>
          <a href="#ticket-list" className="quick-action"><span className="text-base leading-none">💬</span><span className="truncate">আমার টিকিট</span></a>
        </div>
      </section>

      {error ? <div className="alert alert-red"><span>⚠️</span><span>{error}</span></div> : null}

      {/* Status summary — counts of the fetched list, nothing else. */}
      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5 ${awayOnMobile}`}>
        {loading ? (
          Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-[62px]" />)
        ) : (
          <>
            <div className="count-chip"><span className="text-xl leading-none">🎫</span><span><span className="count-chip-value">{bnNum(counts.total)}</span><span className="count-chip-label block">মোট টিকিট</span></span></div>
            <div className="count-chip"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" /><span><span className="count-chip-value">{bnNum(counts.open)}</span><span className="count-chip-label block">খোলা</span></span></div>
            <div className="count-chip"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" /><span><span className="count-chip-value">{bnNum(counts.pending)}</span><span className="count-chip-label block">উত্তরের অপেক্ষায়</span></span></div>
            <div className="count-chip"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500" /><span><span className="count-chip-value">{bnNum(counts.resolved)}</span><span className="count-chip-label block">সমাধান হয়েছে</span></span></div>
            <div className="count-chip"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400" /><span><span className="count-chip-value">{bnNum(counts.closed)}</span><span className="count-chip-label block">বন্ধ</span></span></div>
          </>
        )}
      </div>

      <div className={awayOnMobile}>
        <FeedbackCard orgId={orgId} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[380px_1fr]">
        <div className={`space-y-4 ${threadActive ? "hidden lg:block" : ""}`}>
          <section id="new-ticket" className="card scroll-mt-24 p-5">
            <h2 className="section-title flex items-center gap-2"><span className="stat-icon stat-icon-brand !h-9 !w-9 !rounded-xl text-base">✉️</span>নতুন Ticket</h2>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="বিষয় — যেমন: WooCommerce Sync হচ্ছে না" className="input mt-4" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="সমস্যাটা বিস্তারিত লিখুন…" className="input mt-2 resize-none" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="input !w-auto min-h-[44px]" aria-label="বিভাগ">
                {Object.entries(CATEGORY_TEXT).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="input !w-auto min-h-[44px]" aria-label="গুরুত্ব">
                <option value="normal">সাধারণ</option>
                <option value="high">জরুরি</option>
              </select>
              <button onClick={create} disabled={!subject.trim() || !body.trim()} className="btn-primary min-h-[44px] flex-1">Ticket খুলুন</button>
            </div>
          </section>

          <section id="ticket-list" className="scroll-mt-24 space-y-2.5">
            {loading ? (
              Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton h-[84px]" />)
            ) : tickets.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 text-center">
                <div className="text-3xl">🎫</div>
                <p className="mt-2 text-sm font-semibold text-slate-800">কোনো Ticket নেই।</p>
                <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-slate-500">সমস্যা বা প্রশ্ন থাকলে ওপরের ফর্মে নতুন Ticket খুলুন — প্ল্যাটফর্ম টিম এখানেই উত্তর দেবে।</p>
                <a href="#new-ticket" className="btn-primary mt-4 min-h-[44px]">＋ নতুন Ticket খুলুন</a>
              </div>
            ) : (
              tickets.map((t) => {
                const isSel = selected?.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => open(t.id)}
                    aria-current={isSel ? "true" : undefined}
                    className="ticket-card"
                    style={isSel ? { borderColor: "var(--brand-ring)", background: "linear-gradient(180deg, var(--brand-soft), #ffffff 70%)" } : undefined}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-slate-900">{t.subject}</span>
                      <StatusBadge status={t.status} />
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
                      {t.priority === "high" ? <span className="badge-red">জরুরি</span> : null}
                      {t.category ? <span className="badge-slate">{CATEGORY_TEXT[t.category] ?? t.category}</span> : null}
                      <span>💬 {bnNum(t.messageCount ?? 0)}টি বার্তা</span>
                      <span className="ml-auto">শেষ কার্যকলাপ · {relativeBn(t.lastMessageAt)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </section>
        </div>

        {/* No overflow-hidden here: it would break the sticky composer. */}
        <section className={`card flex-col p-0 ${threadActive ? "flex" : "hidden lg:flex"}`}>
          {!selected && !opening ? (
            <div className="p-10 text-center">
              <div className="text-4xl">💬</div>
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-slate-500">বাম থেকে একটি Ticket বেছে নিন, অথবা নতুন Ticket খুলুন।</p>
            </div>
          ) : opening && !selected ? (
            <div className="space-y-4 p-5" aria-label="লোড হচ্ছে">
              <div className="skeleton h-6 w-2/3" />
              <div className="skeleton h-16 w-3/4" />
              <div className="skeleton ml-auto h-16 w-2/3" />
              <div className="skeleton h-16 w-3/4" />
            </div>
          ) : selected ? (
            <>
              <div className="border-b border-slate-100 p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setSelected(null)} className="btn-secondary btn-sm min-h-[44px] lg:hidden" aria-label="টিকিটের তালিকায় ফিরুন">← তালিকা</button>
                  <h2 className="min-w-0 flex-1 truncate text-base font-bold text-slate-900">{selected.subject}</h2>
                  <span className="ml-auto flex gap-2">
                    {selected.status !== "closed" ? <button onClick={() => setStatus("closed")} className="btn-secondary btn-sm min-h-[44px]">বন্ধ করুন</button> : null}
                    {selected.status === "closed" || selected.status === "resolved" ? <button onClick={() => setStatus("open")} className="btn-secondary btn-sm min-h-[44px]">আবার খুলুন</button> : null}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
                  <StatusBadge status={selected.status} />
                  <span className={selected.priority === "high" ? "badge-red" : "badge-slate"}>{PRIORITY_TEXT[selected.priority] ?? selected.priority}</span>
                  <span>টিকিট <span className="font-semibold text-slate-700">#{selected.id.slice(-6).toUpperCase()}</span></span>
                  <span>খোলা হয়েছে · {fullLabel(selected.createdAt)}</span>
                  <span>💬 {bnNum(selected.messages?.length ?? 0)}টি বার্তা</span>
                </div>
                {banner ? <div className={`alert ${banner.tone} mt-4`}><span>{banner.text}</span></div> : null}
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                {(selected.messages ?? []).map((m, i, arr) => {
                  const support = m.authorKind === "admin";
                  const prev = arr[i - 1];
                  const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
                  return (
                    <div key={m.id}>
                      {newDay ? <div className="date-sep mb-3"><span>{dayLabel(m.createdAt)}</span></div> : null}
                      <div className={`flex items-end gap-2.5 ${support ? "" : "flex-row-reverse"}`}>
                        <span className={`msg-avatar ${support ? "msg-avatar-support" : "msg-avatar-own"}`} aria-hidden>{support ? "প" : "আ"}</span>
                        <div className={`msg-bubble ${support ? "msg-bubble-support" : "msg-bubble-own"}`}>
                          <p className={`text-[11px] font-semibold uppercase tracking-wide ${support ? "text-slate-500" : "text-white/75"}`}>
                            {support ? "🛠 প্ল্যাটফর্ম টিম" : "আপনি"} · {timeLabel(m.createdAt)}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap leading-relaxed">{m.body}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>

              {/* Sticky composer: stays reachable above the M60 mobile
                  bottom nav (its spacer + safe-area are offset here);
                  desktop keeps a small floating margin. */}
              <div className="sticky bottom-[calc(62px+env(safe-area-inset-bottom))] z-10 px-4 pb-4 sm:px-5 lg:bottom-4">
                <div className="flex items-end gap-2 rounded-2xl border border-slate-200/90 bg-white/95 p-2 shadow-pop backdrop-blur">
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="উত্তর লিখুন…" className="input !border-0 !shadow-none flex-1 resize-none focus:!ring-0" aria-label="উত্তর লিখুন" />
                  <button onClick={sendReply} disabled={!reply.trim()} className="btn-primary min-h-[44px] shrink-0">পাঠান</button>
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/** Milestone 41: quick NPS feedback — goes straight to the platform team. */
function FeedbackCard({ orgId }: { orgId: string | null }) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  if (!orgId) return null;
  if (done) {
    return <div className="alert alert-green"><span>🙏 ধন্যবাদ! আপনার মতামত প্ল্যাটফর্ম টিমের কাছে পৌঁছেছে।</span></div>;
  }
  return (
    <div className="card p-5">
      <div className="section-title flex items-center gap-2"><span className="stat-icon stat-icon-brand !h-9 !w-9 !rounded-xl text-base">💬</span>এক মিনিটে মতামত দিন</div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">বন্ধু বা পরিচিত কারো কাছে এই প্ল্যাটফর্মটি সুপারিশ করার সম্ভাবনা কতটা? (০ = একদমই না, ১০ = অবশ্যই)</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            onClick={() => setScore(i)}
            aria-pressed={score === i}
            className={`h-11 w-11 rounded-xl border text-sm font-semibold transition active:scale-95 ${score === i ? "border-transparent text-white" : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"}`}
            style={score === i ? { backgroundImage: "linear-gradient(135deg, var(--brand-from), var(--brand-to))" } : undefined}
          >{bnNum(i)}</button>
        ))}
      </div>
      <textarea className="input mt-3 resize-none" rows={2} placeholder="কী ভালো লাগলো / কী উন্নত করা দরকার? (ঐচ্ছিক)" value={comment} onChange={(e) => setComment(e.target.value)} />
      {err ? <p className="mt-2 text-xs font-medium text-red-600">{err}</p> : null}
      <button
        className="btn-primary mt-3 min-h-[44px]"
        disabled={score === null}
        onClick={async () => {
          try {
            await apiFetch(`/organizations/${orgId}/feedback`, { method: "POST", body: JSON.stringify({ score, comment: comment.trim() || undefined }) });
            setDone(true);
          } catch (e) { setErr(e instanceof Error ? e.message : "পাঠানো যায়নি"); }
        }}
      >মতামত পাঠান</button>
    </div>
  );
}
