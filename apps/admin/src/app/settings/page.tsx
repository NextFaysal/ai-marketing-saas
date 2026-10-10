"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch, formatMinorStr } from "@/lib/api";

interface Settings {
  maintenanceMode: boolean; signupOpen: boolean; supportContact: string;
  killSwitches: { aiDisabledOrgIds: string[]; broadcastsPaused: boolean };
  planPrices: Record<string, number>;
}
interface Announcement { id: string; title: string; body: string; active: boolean; startsAt?: string | null; endsAt?: string | null; createdAt: string }

interface PlatformConfigView {
  llm: { source: string; provider: string | null; model: string | null; secretConfigured: boolean };
  metaApp: { source: string; appId: string | null; graphVersion: string | null; appSecretConfigured: boolean; adLibraryTokenConfigured: boolean };
  smtp: { source: string; host: string | null; port: number; user: string | null; from: string | null; secretConfigured: boolean };
  sms: { source: string; senderId: string | null; apiUrl: string | null; secretConfigured: boolean };
  note: string;
}

function PlatformConfigSection({ setMsg }: { setMsg: (m: string) => void }) {
  const [cfg, setCfg] = React.useState<PlatformConfigView | null>(null);
  const [busy, setBusy] = React.useState("");
  const loadCfg = React.useCallback(async () => {
    const v = await apiFetch<PlatformConfigView>("/admin/platform-config").catch(() => null);
    if (v) setCfg(v);
  }, []);
  React.useEffect(() => { loadCfg(); }, [loadCfg]);
  async function patch(area: string, body: Record<string, unknown>, ok: string) {
    setBusy(area);
    try { setCfg(await apiFetch<PlatformConfigView>(`/admin/platform-config/${area}`, { method: "PATCH", body: JSON.stringify(body) })); setMsg(ok); }
    catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }
  async function test(kind: "test-llm" | "test-email" | "test-sms", to?: string) {
    setBusy(kind);
    try {
      const out = await apiFetch<any>(`/admin/platform-config/${kind}`, { method: "POST", body: JSON.stringify(to ? { to } : {}) });
      setMsg(`✅ Test সফল: ${kind === "test-llm" ? `${out.provider} / ${out.model} (${out.latencyMs}ms)` : `Message ID: ${out.providerMessageId}`}`);
    } catch (e) { setMsg(`❌ ${e instanceof Error ? e.message : "Test ব্যর্থ"}`); }
    finally { setBusy(""); }
  }
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
  const secretPh = (set: boolean) => (set ? "সেট করা আছে — বদলাতে নতুন মান দিন, খালি রাখলে আগেরটাই থাকবে" : "এখনো সেট করা হয়নি");
  if (!cfg) return null;
  const srcBadge = (src: string) => src === "admin" ? <span className="abadge-green">Admin Console থেকে সেট</span> : src === "env" ? <span className="abadge-amber">Server Env থেকে আসছে</span> : <span className="abadge-red">সেট করা নেই</span>;
  return (
    <div className="mt-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">🔌 Dynamic Platform Config (Milestone 33)</h2>
        <p className="text-sm text-slate-400">এখানে সেট করলেই পুরো প্ল্যাটফর্মে কার্যকর — সার্ভার Restart লাগে না। Secret কখনো দেখানো হয় না; শুধু "সেট আছে কিনা" দেখা যায়। Tenant রা নিজেদের WooCommerce/Courier/Account নিজেরাই সেট করে — এগুলো শুধু প্ল্যাটফর্ম-পর্যায়ের সেটিং।</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="acard space-y-3">
          <div className="flex items-center justify-between"><span className="font-semibold">🤖 AI / LLM</span>{srcBadge(cfg.llm.source)}</div>
          <label className="block text-sm">Provider
            <select id="pc-llm-provider" className="ainput mt-1" defaultValue={cfg.llm.provider ?? ""}>
              <option value="">— নেই (Dev Template) —</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option>
            </select></label>
          <label className="block text-sm">Model (ঐচ্ছিক)<input id="pc-llm-model" className="ainput mt-1" defaultValue={cfg.llm.model ?? ""} placeholder="যেমন gpt-4o-mini" /></label>
          <label className="block text-sm">API Key<input id="pc-llm-key" type="password" className="ainput mt-1" placeholder={secretPh(cfg.llm.secretConfigured)} /></label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("llm", { provider: val("pc-llm-provider"), model: val("pc-llm-model"), apiKey: val("pc-llm-key") || undefined }, "LLM সেটিং সেভ হয়েছে — এখন থেকে এই Provider-ই চলবে।")}>সেভ করুন</button>
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => test("test-llm")}>{busy === "test-llm" ? "Test হচ্ছে…" : "🧪 আসল Test (ছোট্ট Completion)"}</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("llm", { clear: true }, "LLM Admin সেটিং মোছা হয়েছে (Env fallback চলবে)।")}>Admin সেটিং মুছুন</button>
          </div>
          <p className="text-xs text-slate-500">Test সফল মানে আসল Provider উত্তর দিয়েছে — Dev Template কখনো পাস হিসেবে গণনা হয় না।</p>
        </div>
        <div className="acard space-y-3">
          <div className="flex items-center justify-between"><span className="font-semibold">📘 Platform Meta App</span>{srcBadge(cfg.metaApp.source)}</div>
          <label className="block text-sm">App ID<input id="pc-meta-appid" className="ainput mt-1" defaultValue={cfg.metaApp.appId ?? ""} /></label>
          <label className="block text-sm">App Secret<input id="pc-meta-secret" type="password" className="ainput mt-1" placeholder={secretPh(cfg.metaApp.appSecretConfigured)} /></label>
          <label className="block text-sm">Ad Library Token<input id="pc-meta-adlib" type="password" className="ainput mt-1" placeholder={secretPh(cfg.metaApp.adLibraryTokenConfigured)} /></label>
          <label className="block text-sm">Graph Version<input id="pc-meta-version" className="ainput mt-1" defaultValue={cfg.metaApp.graphVersion ?? "v21.0"} /></label>
          <div className="flex flex-wrap gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("meta", { appId: val("pc-meta-appid"), appSecret: val("pc-meta-secret") || undefined, adLibraryToken: val("pc-meta-adlib") || undefined, graphVersion: val("pc-meta-version") }, "Meta App সেটিং সেভ হয়েছে।")}>সেভ করুন</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("meta", { clear: true }, "Meta App Admin সেটিং মোছা হয়েছে।")}>মুছুন</button>
          </div>
          <p className="text-xs text-slate-500">Tenant রা নিজের অ্যাপের Secret না দিলে Webhook যাচাইয়ে এই Platform Secret-ই ব্যবহৃত হয়। প্রতিটি Tenant এর Ad Account Token আলাদাই থাকে।</p>
        </div>
        <div className="acard space-y-3">
          <div className="flex items-center justify-between"><span className="font-semibold">✉️ Email (SMTP)</span>{srcBadge(cfg.smtp.source)}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">Host<input id="pc-smtp-host" className="ainput mt-1" defaultValue={cfg.smtp.host ?? ""} /></label>
            <label className="block text-sm">Port<input id="pc-smtp-port" type="number" className="ainput mt-1" defaultValue={cfg.smtp.port} /></label>
          </div>
          <label className="block text-sm">User<input id="pc-smtp-user" className="ainput mt-1" defaultValue={cfg.smtp.user ?? ""} /></label>
          <label className="block text-sm">Password<input id="pc-smtp-pass" type="password" className="ainput mt-1" placeholder={secretPh(cfg.smtp.secretConfigured)} /></label>
          <label className="block text-sm">From<input id="pc-smtp-from" className="ainput mt-1" defaultValue={cfg.smtp.from ?? ""} placeholder="noreply@qosprey.com" /></label>
          <div className="flex flex-wrap items-center gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("smtp", { host: val("pc-smtp-host"), port: Number(val("pc-smtp-port")) || 587, user: val("pc-smtp-user"), from: val("pc-smtp-from"), pass: val("pc-smtp-pass") || undefined }, "SMTP সেটিং সেভ হয়েছে।")}>সেভ করুন</button>
            <input id="pc-email-test-to" className="ainput w-52" placeholder="Test পাঠানোর Email" />
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => test("test-email", val("pc-email-test-to"))}>🧪 Test Email</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("smtp", { clear: true }, "SMTP Admin সেটিং মোছা হয়েছে।")}>মুছুন</button>
          </div>
        </div>
        <div className="acard space-y-3">
          <div className="flex items-center justify-between"><span className="font-semibold">📱 SMS (SSL Wireless)</span>{srcBadge(cfg.sms.source)}</div>
          <label className="block text-sm">Sender ID<input id="pc-sms-sender" className="ainput mt-1" defaultValue={cfg.sms.senderId ?? ""} /></label>
          <label className="block text-sm">API Token<input id="pc-sms-token" type="password" className="ainput mt-1" placeholder={secretPh(cfg.sms.secretConfigured)} /></label>
          <label className="block text-sm">API URL<input id="pc-sms-url" className="ainput mt-1" defaultValue={cfg.sms.apiUrl ?? "https://smsplus.sslwireless.com"} /></label>
          <div className="flex flex-wrap items-center gap-2">
            <button className="abtn" disabled={busy !== ""} onClick={() => patch("sms", { senderId: val("pc-sms-sender"), apiUrl: val("pc-sms-url"), apiToken: val("pc-sms-token") || undefined }, "SMS সেটিং সেভ হয়েছে।")}>সেভ করুন</button>
            <input id="pc-sms-test-to" className="ainput w-44" placeholder="01XXXXXXXXX" />
            <button className="abtn-secondary" disabled={busy !== ""} onClick={() => test("test-sms", val("pc-sms-test-to"))}>🧪 Test SMS (আসল খরচ হবে)</button>
            <button className="abtn-danger" disabled={busy !== ""} onClick={() => patch("sms", { clear: true }, "SMS Admin সেটিং মোছা হয়েছে।")}>মুছুন</button>
          </div>
          <p className="text-xs text-slate-500">{cfg.note}</p>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [s, setS] = React.useState<Settings | null>(null);
  const [anns, setAnns] = React.useState<Announcement[]>([]);
  const [msg, setMsg] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [aiOrgIds, setAiOrgIds] = React.useState("");
  const load = React.useCallback(async () => {
    const settings = await apiFetch<Settings>("/admin/settings").catch(() => null);
    if (settings) { setS(settings); setAiOrgIds(settings.killSwitches.aiDisabledOrgIds.join(", ")); }
    setAnns(await apiFetch<Announcement[]>("/admin/announcements").catch(() => []));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  async function save(patch: Partial<Settings>, ok: string) {
    try { setS(await apiFetch<Settings>("/admin/settings", { method: "PATCH", body: JSON.stringify(patch) })); setMsg(ok); }
    catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ হয়েছে"); }
  }
  if (!s) return <AdminShell title="⚙️ Settings & Flags"><p className="text-slate-400">লোড হচ্ছে…</p></AdminShell>;
  return (
    <AdminShell title="⚙️ Settings & Flags">
      {msg ? <p className="mb-3 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">{msg}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="acard space-y-4">
          <div className="font-semibold">প্ল্যাটফর্ম অবস্থা</div>
          <label className="flex items-center justify-between text-sm">Maintenance Mode (Tenant অ্যাপে নোটিশ যাবে)
            <input type="checkbox" checked={s.maintenanceMode} onChange={(e) => save({ maintenanceMode: e.target.checked }, "Maintenance mode আপডেট হয়েছে।")} /></label>
          <label className="flex items-center justify-between text-sm">নতুন Signup খোলা আছে
            <input type="checkbox" checked={s.signupOpen} onChange={(e) => save({ signupOpen: e.target.checked }, "Signup সেটিং আপডেট হয়েছে।")} /></label>
          <label className="block text-sm">Support যোগাযোগ (Tenant অ্যাপে দেখাবে)
            <input className="ainput mt-1" value={s.supportContact} onChange={(e) => setS({ ...s, supportContact: e.target.value })} placeholder="support@qosprey.com" /></label>
          <button className="abtn-secondary" onClick={() => save({ supportContact: s.supportContact }, "Support যোগাযোগ সেভ হয়েছে।")}>সেভ করুন</button>
          <div className="border-t border-slate-800 pt-3">
            <div className="mb-2 font-semibold">Plan এর দাম (প্রতি মাস, পয়সায় নয় — নিচে টাকায় দেখানো)</div>
            {Object.entries(s.planPrices).map(([tier, minor]) => (
              <div key={tier} className="mb-2 flex items-center gap-2 text-sm">
                <span className="w-20">{tier}</span>
                <input className="ainput" type="number" min={0} value={Math.round(minor / 100)} onChange={(e) => setS({ ...s, planPrices: { ...s.planPrices, [tier]: Number(e.target.value) * 100 } })} />
                <span className="text-slate-500">টাকা (= {formatMinorStr(minor)})</span>
              </div>
            ))}
            <button className="abtn-secondary" onClick={() => save({ planPrices: s.planPrices }, "Plan এর দাম আপডেট হয়েছে।")}>দাম সেভ করুন</button>
            <p className="mt-1 text-xs text-slate-500">এগুলো Operator-নির্ধারিত দাম — Billing পেজে MRR হিসাব এখান থেকেই হয়।</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="acard space-y-3">
            <div className="font-semibold">🚨 Kill Switch (Incident Mode)</div>
            <label className="flex items-center justify-between text-sm">সব Broadcast সাময়িক বন্ধ
              <input type="checkbox" checked={s.killSwitches.broadcastsPaused} onChange={(e) => save({ killSwitches: { ...s.killSwitches, broadcastsPaused: e.target.checked } }, "Broadcast kill switch আপডেট হয়েছে।")} /></label>
            <label className="block text-sm">যেসব Org এর AI বন্ধ (ID, কমা দিয়ে)
              <input className="ainput mt-1" value={aiOrgIds} onChange={(e) => setAiOrgIds(e.target.value)} placeholder="org-id-1, org-id-2" /></label>
            <button className="abtn-secondary" onClick={() => save({ killSwitches: { broadcastsPaused: s.killSwitches.broadcastsPaused, aiDisabledOrgIds: aiOrgIds.split(",").map((x) => x.trim()).filter(Boolean) } }, "AI kill switch সেভ হয়েছে।")}>সেভ করুন</button>
          </div>
          <div className="acard space-y-3">
            <div className="font-semibold">📣 Announcement (সব Tenant Dashboard এ দেখাবে)</div>
            <input className="ainput" placeholder="শিরোনাম" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className="ainput" rows={2} placeholder="বার্তা" value={body} onChange={(e) => setBody(e.target.value)} />
            <button className="abtn" onClick={async () => {
              if (!title.trim() || !body.trim()) return;
              await apiFetch("/admin/announcements", { method: "POST", body: JSON.stringify({ title, body }) });
              setTitle(""); setBody(""); setMsg("Announcement প্রকাশ হয়েছে।"); await load();
            }}>প্রকাশ করুন</button>
            <ul className="space-y-2">
              {anns.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm">
                  <span><b>{a.title}</b> — {a.body}<span className="block text-xs text-slate-500">{new Date(a.createdAt).toLocaleString("bn-BD")} · {a.active ? "সক্রিয়" : "নিষ্ক্রিয়"}</span></span>
                  <span className="flex shrink-0 gap-1">
                    <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={async () => { await apiFetch(`/admin/announcements/${a.id}/active`, { method: "POST", body: JSON.stringify({ active: !a.active }) }); await load(); }}>{a.active ? "বন্ধ" : "চালু"}</button>
                    <button className="abtn-danger !px-2 !py-1 text-xs" onClick={async () => { await apiFetch(`/admin/announcements/${a.id}`, { method: "DELETE" }); await load(); }}>মুছুন</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <PlatformConfigSection setMsg={setMsg} />
    </AdminShell>
  );
}
