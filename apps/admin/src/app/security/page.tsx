"use client";
import React from "react";
import AdminShell, { reasonDialog } from "@/components/AdminShell";
import { DataTable, EmptyState, ErrorState, PageHead, Tabs, askConfirm, askInput, toast } from "@/components/ui";
import { apiFetch, setAdminToken } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { useRouter } from "next/navigation";

interface SecurityData {
  me: { id: string; email: string; tier: string; totpEnabled: boolean };
  ipAllowlistConfigured: boolean;
  admins: { id: string; email: string; name: string; adminTier?: string | null; status: string; totpEnabled: boolean; lastLoginAt?: string | null }[];
}

export default function SecurityPage() {
  const router = useRouter();
  const [data, setData] = React.useState<SecurityData | null>(null);
  const [enroll, setEnroll] = React.useState<{ secret: string; otpauthUrl: string; qrDataUrl?: string } | null>(null);
  const [code, setCode] = React.useState("");
  // ADX12: a failed security load used to sit on "লোড হচ্ছে…"
  // forever; it now gets an error state + retry.
  const [loadFailed, setLoadFailed] = React.useState(false);
  const load = React.useCallback(async () => {
    const d = await apiFetch<SecurityData>("/admin/security").catch(() => null);
    setLoadFailed(d === null);
    setData(d);
  }, []);
  React.useEffect(() => { load(); }, [load]);
  // AP2: view-as sessions (server-side registry).
  // ADNX13: the sessions load gets its own loading/failed states —
  // before, a failed fetch silently read as "কোনো সেশন নেই" (a
  // false empty of the ADX12 class).
  const [vaSessions, setVaSessions] = React.useState<{ id: string; adminEmail: string; organizationId: string; mode: string; active: boolean; expiresAt: string; createdAt: string }[]>([]);
  const [vaLoading, setVaLoading] = React.useState(true);
  const [vaFailed, setVaFailed] = React.useState(false);
  const loadSessions = React.useCallback(async () => {
    setVaLoading(true);
    const out = await apiFetch<{ id: string; adminEmail: string; organizationId: string; mode: string; active: boolean; expiresAt: string; createdAt: string }[]>("/admin/view-as/sessions").catch(() => null);
    setVaFailed(out === null);
    if (out) setVaSessions(out);
    setVaLoading(false);
  }, []);
  React.useEffect(() => { loadSessions(); }, [loadSessions]);
  // ADX10: existing cards regrouped into tabs (content unchanged;
  // the revoke-my-sessions block moves from the TOTP card into the
  // Sessions tab, handler identical).
  const [tab, setTab] = React.useState("totp");
  // ADNX13: every dangerous action on this page confirms through
  // the ONE modal pattern (askConfirm / askInput / reasonDialog)
  // and every result rides the toast system — no page banner.
  async function revokeSession(id: string) {
    if (!(await askConfirm({ title: "View-As সেশন বাতিল করবেন?", description: "বাতিল করলে ওই View-As Token সঙ্গে সঙ্গে অকার্যকর হয়ে যাবে।", confirmLabel: "বাতিল করুন", danger: true }))) return;
    try { await apiFetch(`/admin/view-as/sessions/${id}/revoke`, { method: "POST" }); toast("View-As সেশন বাতিল হয়েছে — ওই Token আর কাজ করবে না।"); await loadSessions(); }
    catch (e) { toast(e instanceof Error ? e.message : "ব্যর্থ হয়েছে", "error"); }
  }

  async function confirmEnroll() {
    try {
      await apiFetch("/admin/totp/confirm", { method: "POST", body: JSON.stringify({ code }) });
      toast("Two-Factor চালু হয়েছে। এখন থেকে লগইনে কোড লাগবে।");
      setEnroll(null); setCode("");
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : "ব্যর্থ হয়েছে", "error"); }
  }
  if (!data) return <AdminShell title="🔐 Security">{loadFailed ? <ErrorState message="Security তথ্য লোড হয়নি — আবার চেষ্টা করুন।" onRetry={load} /> : <><div className="askel-card" /><div className="askel-table mt-4" /></>}</AdminShell>;
  return (
    <AdminShell title="🔐 Security">
      <PageHead sub="TOTP, View-As সেশন ও Admin Access — প্ল্যাটফর্মের সুরক্ষা নিয়ন্ত্রণ।" />
      <div className="sticky top-0 z-20 -mx-1 mb-4 bg-slate-950/90 px-1 py-2 backdrop-blur">
        <Tabs
          tabs={[
            { id: "totp", label: "🔐 Allowlist ও TOTP" },
            { id: "sessions", label: "👁️ Sessions", badge: vaSessions.filter((x) => x.active).length },
            { id: "access", label: "🔑 Admin Access" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>
      {tab === "totp" ? (<>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="acard space-y-3">
          <div className="font-semibold">আমার Two-Factor Authentication (TOTP)</div>
          <p className="text-sm text-slate-400">অবস্থা: {data.me.totpEnabled ? <span className="abadge-green">চালু আছে</span> : <span className="abadge-amber">বন্ধ</span>} · Tier: {data.me.tier}</p>
          {!data.me.totpEnabled && !enroll ? (
            <>
              <p className="text-sm text-slate-400">SUPER Admin দের পরিবর্তন (mutation) করতে TOTP বাধ্যতামূলক। Authenticator অ্যাপ (Google Authenticator / Authy) দিয়ে চালু করুন।</p>
              <button className="abtn" onClick={async () => { setEnroll(await apiFetch("/admin/totp/enroll", { method: "POST" })); }}>TOTP চালু শুরু করুন</button>
            </>
          ) : null}
          {enroll ? (
            <div className="space-y-2 rounded-lg bg-slate-800 p-3 text-sm">
              {enroll.qrDataUrl ? (
                <div className="space-y-1">
                  <div>Authenticator অ্যাপ দিয়ে QR টি Scan করুন:</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={enroll.qrDataUrl} alt="TOTP QR" className="rounded bg-white p-1" width={180} height={180} />
                </div>
              ) : null}
              <div>Secret (Authenticator এ হাতে লিখুন):</div>
              <code className="block break-all rounded bg-slate-900 p-2 text-indigo-300">{enroll.secret}</code>
              <div className="break-all text-xs text-slate-400">{enroll.otpauthUrl}</div>
              <div className="flex gap-2">
                <input className="ainput max-w-[160px]" placeholder="৬ সংখ্যার কোড" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
                <button className="abtn" onClick={confirmEnroll}>নিশ্চিত করুন</button>
              </div>
            </div>
          ) : null}
          {data.me.totpEnabled ? (
            <div className="flex gap-2">
              <input className="ainput max-w-[160px]" placeholder="কোড (বন্ধ করতে)" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
              <button className="abtn-danger" onClick={async () => {
                if (!(await askConfirm({ title: "TOTP বন্ধ করবেন?", description: "বন্ধ করলে SUPER হিসেবে পরিবর্তন (Mutation) করতে আবার TOTP চালু করতে হবে। কোডটি সার্ভারে যাচাই হবে।", confirmLabel: "TOTP বন্ধ করুন", danger: true }))) return;
                try { await apiFetch("/admin/totp/disable", { method: "POST", body: JSON.stringify({ code }) }); toast("TOTP বন্ধ হয়েছে — SUPER হিসেবে পরিবর্তন আবার চালু করতে TOTP লাগবে।"); setCode(""); await load(); }
                catch (e) { toast(e instanceof Error ? e.message : "ব্যর্থ", "error"); }
              }}>TOTP বন্ধ করুন</button>
            </div>
          ) : null}
        </div>
        <div className="acard space-y-3">
          <div className="font-semibold">Platform Admin বৃন্দ</div>
          <p className="text-sm text-slate-400">IP Allowlist: {data.ipAllowlistConfigured ? <span className="abadge-green">সেট করা আছে</span> : <span className="abadge-slate">সেট নেই (সব নেটওয়ার্ক থেকে প্রবেশ যায়)</span>}</p>
          <ul className="space-y-2">
            {data.admins.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-lg bg-slate-800 px-3 py-2 text-sm">
                <span>{a.name}<span className="block text-xs text-slate-400">{a.email} · {a.adminTier ?? "SUPER"} · শেষ লগইন {a.lastLoginAt ? fmtDateTime(a.lastLoginAt) : "—"}</span></span>
                <span className="flex items-center gap-2">
                  {a.totpEnabled ? <span className="abadge-green">2FA</span> : <span className="abadge-amber">2FA নেই</span>}
                  {a.status !== "ACTIVE" ? <span className="abadge-red">{a.status}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-400">সব Admin হারিয়ে গেলে একমাত্র উদ্ধার পথ: সার্ভার Shell থেকে <code>node scripts/grant-admin.mjs &lt;email&gt;</code> — এটি TOTP রিসেট করে দেয় (Break-Glass) এবং Audit এ রেকর্ড থাকে।</p>
        </div>
      </div>
      </>) : null}
      {tab === "sessions" ? (<>
      <div className="acard space-y-3">
        <div className="font-semibold">👁️ View-As সেশন <span className="text-xs font-normal text-slate-400">(Admin Polish AP2 — Server-side Revocation)</span></div>
        <p className="text-xs text-slate-400">সেশন বাতিল করলে ওই View-As Token সঙ্গে সঙ্গে অকার্যকর হয়ে যাবে — Token-এর ৩০ মিনিট মেয়াদের অপেক্ষা করতে হবে না।</p>
        {/* ADNX13: the sessions list is now the ONE DataTable v3
            pattern — mobile card form with data-label per cell
            (the first 15 sessions, exactly as the old list). */}
        {vaLoading && vaSessions.length === 0 ? <div className="askel-table" /> : vaFailed && vaSessions.length === 0 ? (
          <ErrorState message="View-As সেশন লোড হয়নি — আবার চেষ্টা করুন।" onRetry={loadSessions} />
        ) : vaSessions.length === 0 ? <EmptyState title="কোনো সেশন নেই।" /> : (
          <DataTable>
            <thead className="bg-slate-900"><tr><th className="ath">Admin</th><th className="ath">Org</th><th className="ath">Mode</th><th className="ath">অবস্থা</th><th className="ath">মেয়াদ</th><th className="ath">পদক্ষেপ</th></tr></thead>
            <tbody>
              {vaSessions.slice(0, 15).map((s) => (
                <tr key={s.id} className="border-t border-slate-800">
                  <td data-label="Admin" className="atd">{s.adminEmail}</td>
                  <td data-label="Org" className="atd">{s.organizationId.slice(0, 8)}…</td>
                  <td data-label="Mode" className="atd">{s.mode}</td>
                  <td data-label="অবস্থা" className="atd">{s.active ? <span className="abadge-green">সক্রিয়</span> : <span className="abadge-amber">শেষ/বাতিল</span>}</td>
                  <td data-label="মেয়াদ" className="atd">{fmtDateTime(s.expiresAt)}</td>
                  <td data-label="পদক্ষেপ" className="atd">{s.active ? <button className="abtn-danger !px-2 !py-1 text-xs" onClick={() => revokeSession(s.id)}>বাতিল করুন</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </div>
      <div className="acard mt-4 space-y-3">
        <div className="font-semibold">🚫 আমার সব Session বাতিল করুন</div>
        <p className="text-xs text-slate-400">ডিভাইস হারালে বা সন্দেহ হলে — সব লগইন (এটাসহ) বাতিল হয়ে যাবে, আবার লগইন করতে হবে।</p>
        <button className="abtn-secondary" onClick={async () => {
          const r = await reasonDialog("Revoke My Sessions");
          if (!r) return;
          await apiFetch("/admin/security/revoke-my-sessions", { method: "POST", body: JSON.stringify({ reason: r }) });
          setAdminToken(null);
          router.replace("/login");
        }}>🚫 সব Session বাতিল</button>
      </div>
      </>) : null}
      {tab === "access" ? <ApiKeysAndAnomalies /> : null}
    </AdminShell>
  );
}

interface ApiKeyRow { id: string; name: string; keyPrefix: string; scopes?: string[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
const SCOPE_AREAS = ["tenants", "billing", "growth", "admins", "system"] as const;
interface Anomaly { email: string; failures: number; lastAt: string; note: string }

function ApiKeysAndAnomalies() {
  const [keys, setKeys] = React.useState<ApiKeyRow[]>([]);
  const [anomalies, setAnomalies] = React.useState<Anomaly[]>([]);
  const [name, setName] = React.useState("");
  const [scopeSel, setScopeSel] = React.useState<string[]>(["system:read"]);
  const [shownKey, setShownKey] = React.useState("");
  // ADNX13: form validation stays inline with the form (the NB2
  // form pattern); action results ride the toast system. The load
  // gets loading/failed states — before, a failed fetch silently
  // read as "কোনো API Key নেই" / "কোনো Anomaly নেই".
  const [formError, setFormError] = React.useState("");
  const [accessLoading, setAccessLoading] = React.useState(true);
  const [accessFailed, setAccessFailed] = React.useState(false);
  const load = React.useCallback(async () => {
    setAccessLoading(true);
    const k = await apiFetch<ApiKeyRow[]>("/admin/security/api-keys").catch(() => null);
    const a = await apiFetch<Anomaly[]>("/admin/security/login-anomalies").catch(() => null);
    setAccessFailed(k === null || a === null);
    if (k) setKeys(k);
    if (a) setAnomalies(a);
    setAccessLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {accessFailed ? <div className="lg:col-span-2"><ErrorState message="Admin Access তথ্য লোড হয়নি — আবার চেষ্টা করুন।" onRetry={load} /></div> : null}
      <div className="acard space-y-3">
        <div className="font-semibold">🔑 Admin API Keys</div>
        <p className="text-xs text-slate-400">Automation/Monitoring এর জন্য — Header <code>x-admin-api-key</code> দিয়ে /admin/* ডাকা যায়। Key শুধু তৈরির সময় একবারই দেখানো হয়; সার্ভারে থাকে শুধু Hash। Key এর ক্ষমতা = যিনি তৈরি করেছেন তাঁর বর্তমান Tier; অ্যাকাউন্ট Suspend হলে Key ও থেমে যাবে। TOTP গেট Key এর ক্ষেত্রে প্রযোজ্য নয়।</p>
        {formError ? <p className="text-sm text-red-300">{formError}</p> : null}
        <div className="flex gap-2">
          <input className="ainput" placeholder="Key এর নাম — যেমন: Uptime monitor" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="abtn" onClick={async () => {
            if (name.trim().length < 3) { setFormError("নাম দিন (কমপক্ষে ৩ অক্ষর)।"); return; }
            if (!scopeSel.length) { setFormError("অন্তত একটি Scope বেছে নিন।"); return; }
            setFormError("");
            try {
              const out = await apiFetch<{ key: string }>("/admin/security/api-keys", { method: "POST", body: JSON.stringify({ name, scopes: scopeSel }) });
              setShownKey(out.key); setName(""); toast("Key তৈরি হয়েছে — নিচে থেকে এখনই কপি করে নিরাপদে রাখুন।"); await load();
            } catch (e) { toast(e instanceof Error ? e.message : "ব্যর্থ", "error"); }
          }}>তৈরি করুন</button>
        </div>
        <div className="space-y-1 text-xs text-slate-400">
          <div>Scope (AP3) — Key শুধু বেছে দেওয়া এলাকাতেই কাজ করবে:</div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={scopeSel.includes("*")} onChange={(e) => setScopeSel(e.target.checked ? ["*"] : [])} /> <b>*</b> পূর্ণ ক্ষমতা (Full access)</label>
          {scopeSel.includes("*") ? null : SCOPE_AREAS.map((a) => (
            <span key={a} className="mr-3 inline-flex items-center gap-2">
              <span className="text-slate-400">{a}:</span>
              {(["read", "write"] as const).map((v) => (
                <label key={v} className="inline-flex items-center gap-1">
                  <input type="checkbox" checked={scopeSel.includes(`${a}:${v}`)} onChange={(e) => setScopeSel((prev) => e.target.checked ? [...prev, `${a}:${v}`] : prev.filter((g) => g !== `${a}:${v}`))} /> {v}
                </label>
              ))}
            </span>
          ))}
        </div>
        {shownKey ? <input className="ainput" readOnly value={shownKey} onFocus={(e) => e.target.select()} /> : null}
        {accessLoading && keys.length === 0 ? <div className="askel-table" /> : null}
        <ul className="space-y-2">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm">
              <span><b>{k.name}</b><span className="block text-xs text-slate-400">{k.keyPrefix}… · তৈরি {fmtDateTime(k.createdAt)} · শেষ ব্যবহার {k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : "কখনো নয়"}</span><span className="block text-xs text-indigo-300">{!k.scopes?.length ? "Scope: legacy — পূর্ণ ক্ষমতা" : `Scope: ${k.scopes.join(", ")}`}</span></span>
              {k.revokedAt ? <span className="abadge-red">বাতিল</span> : (
                <button className="abtn-danger !px-2 !py-1 text-xs" onClick={async () => {
                  const reason = await askInput({ title: "Key বাতিলের কারণ (Audit এ থাকবে):", inputLabel: "কারণ", inputRequired: true, confirmLabel: "এগিয়ে যান" });
                  if (!reason) return;
                  try {
                    await apiFetch(`/admin/security/api-keys/${k.id}/revoke`, { method: "POST", body: JSON.stringify({ reason }) });
                    toast("Key বাতিল হয়েছে।"); await load();
                  } catch (e) { toast(e instanceof Error ? e.message : "ব্যর্থ", "error"); }
                }}>বাতিল করুন</button>
              )}
            </li>
          ))}
          {keys.length === 0 && !accessLoading && !accessFailed ? <li className="text-sm text-slate-400">কোনো API Key নেই।</li> : null}
        </ul>
      </div>
      <div className="acard space-y-3">
        <div className="font-semibold">🕵 লগইন Anomaly (শেষ ২৪ ঘণ্টা, ৫+ ব্যর্থ চেষ্টা)</div>
        {accessLoading && anomalies.length === 0 ? <div className="askel-table" /> : null}
        {anomalies.length === 0 && !accessLoading && !accessFailed ? <p className="text-sm text-slate-400">কোনো Anomaly নেই — ভালো খবর।</p> : anomalies.length === 0 ? null : (
          <ul className="space-y-2">
            {anomalies.map((a) => (
              <li key={a.email} className="rounded-lg bg-red-500/10 px-3 py-2 text-sm">
                <b>{a.email}</b> — {a.failures} বার ব্যর্থ লগইন · সর্বশেষ {fmtDateTime(a.lastAt)}
                <span className="block text-xs text-slate-400">{a.note}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-400">ব্যর্থ লগইন Audit Log এ রেকর্ড হয় (শুধু ইমেইল — পাসওয়ার্ড কখনোই নয়)।</p>
      </div>

    </div>
  );
}
