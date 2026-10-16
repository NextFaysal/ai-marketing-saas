"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../../lib/api";
import { getOrganizationId } from "../../../../lib/org";

/**
 * GC23 — Webhooks settings (Settings → Webhooks).
 *
 * Merchants subscribe an https endpoint to order events; Qosprey
 * POSTs each event signed with HMAC-SHA256 (header
 * X-Qosprey-Signature: sha256=<hex of the raw body>). The signing
 * secret is shown EXACTLY ONCE — in the panel right after create
 * or rotate — and can never be viewed again (rotate for a new
 * one). Delivery behaviour is the API's: retries at 1m → 5m →
 * 30m → 2h, failed after 5 attempts, driven by the
 * "Webhook ডেলিভারি" automation job (Automations page) — this
 * page says so rather than implying real-time delivery.
 */

interface WebhookSub {
  id: string; url: string; events: string[]; active: boolean;
  secretSet: boolean; createdAt: string;
  secret?: string; secretShownOnce?: boolean;
}
interface WebhookDelivery {
  id: string; subscriptionId: string; event: string; status: string;
  attempts: number; responseCode?: number | null; error?: string | null;
  createdAt: string; deliveredAt?: string | null; payload?: unknown;
}

const EVENT_OPTIONS: Array<{ key: string; label: string; hint: string }> = [
  { key: "order.created", label: "order.created — নতুন অর্ডার", hint: "নতুন অর্ডার তৈরি হলেই" },
  { key: "order.status_changed", label: "order.status_changed — স্ট্যাটাস বদল", hint: "অর্ডারের স্ট্যাটাস বদলালে (আগের/পরের স্ট্যাটাসসহ)" },
  { key: "order.paid", label: "order.paid — পেমেন্ট যাচাই সম্পন্ন", hint: "অনলাইন পেমেন্ট সার্ভার-যাচাইয়ে নিশ্চিত হলে" },
  { key: "order.returned", label: "order.returned — রিটার্ন অনুরোধ", hint: "অর্ডারের জন্য রিটার্ন লিংক তৈরি হলে" },
];

const STATUS_TEXT: Record<string, string> = { pending: "অপেক্ষমাণ", delivered: "পৌঁছেছে", failed: "ব্যর্থ" };
const STATUS_BADGE: Record<string, string> = { pending: "badge-amber", delivered: "badge-green", failed: "badge-red" };

const bnNum = (n: number) => n.toLocaleString("bn-BD", { maximumFractionDigits: 0 });
const fullLabel = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("bn-BD") : "—");

export default function WebhooksSettingsPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [subs, setSubs] = useState<WebhookSub[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["order.created"]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [freshSecret, setFreshSecret] = useState<{ subId: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [detail, setDetail] = useState<WebhookDelivery | null>(null);

  useEffect(() => { setOrgId(getOrganizationId()); }, []);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const [s, d] = await Promise.all([
        apiFetch<WebhookSub[]>(`/organizations/${orgId}/webhooks`),
        apiFetch<WebhookDelivery[]>(`/organizations/${orgId}/webhooks/deliveries?limit=50`),
      ]);
      setSubs(s); setDeliveries(d);
    } catch { /* honest empty */ }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const toggleEvent = (key: string) =>
    setEvents((prev) => (prev.includes(key) ? prev.filter((e) => e !== key) : [...prev, key]));

  const create = async () => {
    if (!orgId) return;
    setError(""); setNote(""); setBusy(true);
    try {
      const created = await apiFetch<WebhookSub>(`/organizations/${orgId}/webhooks`, {
        method: "POST", body: JSON.stringify({ url: url.trim(), events }),
      });
      setUrl(""); setEvents(["order.created"]);
      if (created.secret) setFreshSecret({ subId: created.id, secret: created.secret });
      setNote("✅ Webhook তৈরি হয়েছে। নিচের Secret-টি এখনই কপি করে রাখুন।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Webhook তৈরি হয়নি"); }
    finally { setBusy(false); }
  };

  const patch = async (sub: WebhookSub, body: Record<string, unknown>, noteText?: string) => {
    if (!orgId) return;
    setError(""); setNote("");
    try {
      const res = await apiFetch<WebhookSub>(`/organizations/${orgId}/webhooks/${sub.id}`, {
        method: "PATCH", body: JSON.stringify(body),
      });
      if ((res as WebhookSub).secret) setFreshSecret({ subId: res.id, secret: (res as WebhookSub).secret as string });
      if (noteText) setNote(noteText);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "আপডেট হয়নি"); }
  };

  const rotate = async (sub: WebhookSub) => {
    if (!orgId) return;
    setError(""); setNote("");
    try {
      const res = await apiFetch<WebhookSub>(`/organizations/${orgId}/webhooks/${sub.id}/rotate-secret`, { method: "POST" });
      if (res.secret) setFreshSecret({ subId: res.id, secret: res.secret });
      setNote("🔑 নতুন Secret তৈরি হয়েছে — পুরনোটি এখন থেকে আর কাজ করবে না। নতুনটি এখনই কপি করুন।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Secret বদলানো যায়নি"); }
  };

  const remove = async (sub: WebhookSub) => {
    if (!orgId) return;
    if (!window.confirm(`এই Webhook-টি মুছে ফেলবেন?\n${sub.url}\nএর সব অপেক্ষমাণ ডেলিভারিও বাতিল হয়ে যাবে।`)) return;
    setError(""); setNote("");
    try {
      await apiFetch(`/organizations/${orgId}/webhooks/${sub.id}`, { method: "DELETE" });
      if (freshSecret?.subId === sub.id) setFreshSecret(null);
      setNote("Webhook মুছে ফেলা হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "মোছা যায়নি"); }
  };

  const resend = async (d: WebhookDelivery) => {
    if (!orgId) return;
    setError(""); setNote("");
    try {
      await apiFetch(`/organizations/${orgId}/webhooks/deliveries/${d.id}/resend`, { method: "POST" });
      setNote("↻ ডেলিভারিটি আবার পাঠানো হয়েছে — ফলাফল তালিকায় দেখুন।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "আবার পাঠানো যায়নি"); }
  };

  const openDetail = async (d: WebhookDelivery) => {
    if (!orgId) return;
    try { setDetail(await apiFetch<WebhookDelivery>(`/organizations/${orgId}/webhooks/deliveries/${d.id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "বিস্তারিত খোলা যায়নি"); }
  };

  const copySecret = async () => {
    if (!freshSecret) return;
    try { await navigator.clipboard.writeText(freshSecret.secret); setCopied(true); }
    catch { setCopied(false); }
  };

  const subUrl = (id: string) => subs.find((s) => s.id === id)?.url ?? id;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <section className="hero-panel p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Webhooks</h1>
            <p className="mt-1 max-w-xl text-sm text-white/75">
              অর্ডারের ইভেন্ট ঘটলেই আপনার সার্ভারে স্বাক্ষরিত (HMAC-SHA256) POST পাঠানো হবে — হেডার
              {" "}<code className="rounded bg-white/15 px-1">X-Qosprey-Signature: sha256=…</code> দিয়ে যাচাই করুন।
              ডেলিভারি চলে Automations পেজের “Webhook ডেলিভারি” Job দিয়ে (প্রতি ৫ মিনিটে); ব্যর্থ হলে ১মি → ৫মি → ৩০মি → ২ঘ ব্যবধানে আবার চেষ্টা হয়, ৫ বার ব্যর্থ হলে থামে।
            </p>
          </div>
          <span className="hero-chip">🔗 Webhooks</span>
        </div>
      </section>

      {error ? <div className="alert alert-red"><span>⚠️</span><span>{error}</span></div> : null}
      {note ? <div className="alert alert-green"><span>✅</span><span>{note}</span></div> : null}

      {freshSecret ? (
        <section className="card border-amber-300 bg-amber-50 p-5">
          <h2 className="section-title">🔑 Signing Secret — এখনই কপি করুন</h2>
          <p className="mt-1 text-sm font-semibold text-amber-800">⚠️ এটি আর দেখানো হবে না — পেজ ছাড়লেই Secret-টি হারিয়ে যাবে। হারালে Rotate করে নতুন নিতে হবে।</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-xl bg-white px-3 py-2.5 font-mono text-[13px] ring-1 ring-amber-200">{freshSecret.secret}</code>
            <button onClick={copySecret} className="btn-primary min-h-[44px]">{copied ? "✓ কপি হয়েছে" : "📋 কপি করুন"}</button>
            <button onClick={() => { setFreshSecret(null); setCopied(false); }} className="btn-secondary min-h-[44px]">বুঝেছি, লুকান</button>
          </div>
        </section>
      ) : null}

      <section className="card p-5">
        <h2 className="section-title">নতুন Webhook</h2>
        <label className="mt-4 block text-[13px] font-medium text-slate-600">Endpoint URL (শুধু https, পাবলিক ঠিকানা)</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-server.example.com/webhooks/qosprey" className="input mt-1.5" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {EVENT_OPTIONS.map((opt) => (
            <label key={opt.key} className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200/70">
              <input type="checkbox" checked={events.includes(opt.key)} onChange={() => toggleEvent(opt.key)} className="mt-0.5 h-4 w-4" />
              <span>
                <span className="block font-mono text-[13px] font-semibold text-slate-800">{opt.label}</span>
                <span className="block text-xs text-slate-500">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <button onClick={create} disabled={busy || !url.trim() || events.length === 0} className="btn-primary mt-4 min-h-[44px]">
          {busy ? "তৈরি হচ্ছে…" : "＋ Webhook তৈরি করুন"}
        </button>
        <p className="mt-2 text-xs text-slate-500">তৈরি হলেই Signing Secret একবার দেখানো হবে — সেটি দিয়ে প্রতিটি ডেলিভারির স্বাক্ষর যাচাই করুন। Payload-এ গ্রাহকের নাম/ফোন/ঠিকানা পাঠানো হয় না।</p>
      </section>

      <section className="space-y-2.5">
        <h2 className="section-title">আমার Webhook সমূহ</h2>
        {subs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 text-center">
            <div className="text-3xl">🔗</div>
            <p className="mt-2 text-sm font-semibold text-slate-800">কোনো Webhook নেই।</p>
            <p className="mx-auto mt-1 max-w-[300px] text-xs leading-relaxed text-slate-500">ওপরের ফর্মে আপনার সার্ভারের ঠিকানা দিয়ে প্রথম Webhook তৈরি করুন।</p>
          </div>
        ) : subs.map((s) => (
          <div key={s.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="min-w-0 break-all font-mono text-[13.5px] font-semibold text-slate-900">{s.url}</span>
              <span className={s.active ? "badge-green" : "badge-slate"}>{s.active ? "চালু" : "বন্ধ"}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.events.map((e) => <span key={e} className="badge-brand font-mono">{e}</span>)}
            </div>
            <p className="mt-2 text-xs text-slate-500">Secret: {s.secretSet ? "সেট করা আছে (দেখানো যাবে না)" : "নেই"} · তৈরি: {fullLabel(s.createdAt)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => patch(s, { active: !s.active }, s.active ? "Webhook বন্ধ করা হয়েছে।" : "Webhook চালু করা হয়েছে।")} className="btn-secondary min-h-[40px]">{s.active ? "বন্ধ করুন" : "চালু করুন"}</button>
              <button onClick={() => rotate(s)} className="btn-secondary min-h-[40px]">🔑 Secret Rotate</button>
              <button onClick={() => remove(s)} className="btn-secondary min-h-[40px] !text-red-600">মুছুন</button>
            </div>
          </div>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="section-title">ডেলিভারি লগ</h2>
        {deliveries.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">এখনো কোনো ডেলিভারি হয়নি — ইভেন্ট ঘটলে এখানে দেখা যাবে।</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">ইভেন্ট</th>
                  <th className="py-2 pr-3 font-medium">Endpoint</th>
                  <th className="py-2 pr-3 font-medium">অবস্থা</th>
                  <th className="py-2 pr-3 font-medium">চেষ্টা</th>
                  <th className="py-2 pr-3 font-medium">HTTP</th>
                  <th className="py-2 pr-3 font-medium">সময়</th>
                  <th className="py-2 font-medium">কাজ</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-3 font-mono text-xs">{d.event}</td>
                    <td className="max-w-[220px] truncate py-2 pr-3 font-mono text-xs" title={subUrl(d.subscriptionId)}>{subUrl(d.subscriptionId)}</td>
                    <td className="py-2 pr-3"><span className={STATUS_BADGE[d.status] ?? "badge-slate"}>{STATUS_TEXT[d.status] ?? d.status}</span></td>
                    <td className="py-2 pr-3">{bnNum(d.attempts)}</td>
                    <td className="py-2 pr-3">{d.responseCode ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{fullLabel(d.deliveredAt ?? d.createdAt)}</td>
                    <td className="py-2 whitespace-nowrap">
                      <button onClick={() => openDetail(d)} className="btn-secondary mr-1.5 min-h-[36px] !px-3 !py-1 text-xs">বিস্তারিত</button>
                      <button onClick={() => resend(d)} className="btn-secondary min-h-[36px] !px-3 !py-1 text-xs">↻ আবার পাঠান</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detail ? (
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">ডেলিভারি বিস্তারিত — <span className="font-mono text-[13px]">{detail.event}</span></h2>
            <button onClick={() => setDetail(null)} className="btn-secondary min-h-[36px]">বন্ধ করুন</button>
          </div>
          <dl className="mt-3 grid gap-1.5 text-[13px] text-slate-600 sm:grid-cols-2">
            <div>অবস্থা: <b className="text-slate-900">{STATUS_TEXT[detail.status] ?? detail.status}</b></div>
            <div>চেষ্টা: <b className="text-slate-900">{bnNum(detail.attempts)}</b> · HTTP: <b className="text-slate-900">{detail.responseCode ?? "—"}</b></div>
            <div>তৈরি: <b className="text-slate-900">{fullLabel(detail.createdAt)}</b></div>
            <div>পৌঁছেছে: <b className="text-slate-900">{fullLabel(detail.deliveredAt)}</b></div>
          </dl>
          {detail.error ? <p className="alert alert-red mt-3"><span>⚠️</span><span>{detail.error}</span></p> : null}
          <p className="mt-3 text-[13px] font-medium text-slate-600">Payload (যা পাঠানো হয়েছে)</p>
          <pre className="mt-1.5 max-h-80 overflow-auto rounded-xl bg-slate-900 p-3.5 font-mono text-xs leading-relaxed text-slate-100">{JSON.stringify(detail.payload, null, 2)}</pre>
        </section>
      ) : null}
    </div>
  );
}
