"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { buildCourierConnectBody, type CourierProvider, type PathaoForm, type RedxForm, type SteadfastForm } from "@/lib/connect-forms";
import type { ConnectionsOverview } from "@/lib/connections";

/**
 * CC6 (Connect Center B3) — Courier connect panel for the
 * Connect Center. Forms call the EXISTING CourierService
 * endpoints (POST courier/connect — verify-before-save against
 * each provider's real API, exactly as the Orders page does;
 * DELETE courier/connection per provider). Steadfast / Pathao /
 * RedX coexist as separate Integration rows and are listed
 * separately here.
 *
 * Default courier: the Connect Center's B1 PATCH set-default on
 * the courier Integration row (category group = courier).
 *
 * Live test: only where an existing real read endpoint exists —
 * Pathao stores and RedX areas are read with the STORED
 * credentials through the provider's own API. Steadfast exposes
 * no balance/test read endpoint in this API (its balance check
 * happens inside connect), so NO test button is offered for it —
 * the card says so instead of inventing one.
 */

interface CourierConnection { provider: string; connected: boolean; status?: string }

const PROVIDER_TITLES: Record<CourierProvider, string> = {
  steadfast: "Steadfast", pathao: "Pathao Courier", redx: "RedX",
};

export function CourierConnectPanel({ onChanged }: { onChanged?: () => void }) {
  const [conns, setConns] = useState<CourierConnection[]>([]);
  const [courierAccounts, setCourierAccounts] = useState<{ id: string; provider: string; isDefault: boolean }[]>([]);
  const [steadfast, setSteadfast] = useState<SteadfastForm>({ apiKey: "", secretKey: "" });
  const [pathao, setPathao] = useState<PathaoForm>({ clientId: "", clientSecret: "", username: "", password: "", sandbox: false });
  const [redx, setRedx] = useState<RedxForm>({ accessToken: "", baseUrl: "" });
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const all = await apiFetch<CourierConnection[]>(`/organizations/${orgId}/courier/connections`);
      setConns(all);
    } catch { /* courier is optional — the forms still render */ }
    try {
      const overview = await apiFetch<ConnectionsOverview>(`/organizations/${orgId}/connections/overview`);
      const courier = overview.categories.find((c) => c.key === "courier");
      setCourierAccounts((courier?.accounts ?? []).filter((a) => a.source === "integration").map((a) => ({ id: a.id, provider: a.provider, isDefault: a.isDefault })));
    } catch { /* default buttons simply won't render */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reload = async () => { await load(); onChanged?.(); };
  const connOf = (p: CourierProvider) => conns.find((c) => c.provider === p);
  const accountOf = (p: CourierProvider) => courierAccounts.find((a) => a.provider === p);

  async function connect(provider: CourierProvider, e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(provider); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connect`, {
        method: "POST",
        body: JSON.stringify(buildCourierConnectBody(provider, { steadfast, pathao, redx })),
      });
      setNotice(provider === "steadfast"
        ? "Steadfast যুক্ত হয়েছে (আসল API দিয়ে Balance যাচাই করা)।"
        : provider === "pathao"
          ? "Pathao যুক্ত হয়েছে (আসল API দিয়ে Token ও Store যাচাই করা)।"
          : "RedX যুক্ত হয়েছে (আসল API দিয়ে Area তালিকা যাচাই করা)।");
      if (provider === "steadfast") setSteadfast({ apiKey: "", secretKey: "" });
      if (provider === "pathao") setPathao({ clientId: "", clientSecret: "", username: "", password: "", sandbox: false });
      if (provider === "redx") setRedx({ accessToken: "", baseUrl: "" });
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Connect ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function disconnect(provider: CourierProvider) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`dc-${provider}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connection?provider=${provider}`, { method: "DELETE" });
      setNotice(`${PROVIDER_TITLES[provider]} সংযোগ বিচ্ছিন্ন হয়েছে।`);
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Disconnect ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function makeDefault(provider: CourierProvider) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const account = accountOf(provider);
    if (!account) return;
    setBusy(`def-${provider}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/connections/${account.id}/default`, { method: "PATCH" });
      setNotice(`${PROVIDER_TITLES[provider]} এখন ডিফল্ট কুরিয়ার।`);
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "ডিফল্ট করা যায়নি"); }
    finally { setBusy(""); }
  }

  /** Real read through the provider's own API with the stored
   * credentials — only for providers that expose such an
   * endpoint in this API (Pathao stores, RedX areas). */
  async function test(provider: CourierProvider) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`test-${provider}`);
    setTestResult((r) => ({ ...r, [provider]: "" }));
    try {
      if (provider === "pathao") {
        const stores = await apiFetch<unknown[]>(`/organizations/${orgId}/courier/pathao/stores`);
        setTestResult((r) => ({ ...r, [provider]: `✅ Pathao API সাড়া দিয়েছে — ${Array.isArray(stores) ? stores.length : 0}টি স্টোর পাওয়া গেছে।` }));
      } else if (provider === "redx") {
        const areas = await apiFetch<unknown[]>(`/organizations/${orgId}/courier/redx/areas`);
        setTestResult((r) => ({ ...r, [provider]: `✅ RedX API সাড়া দিয়েছে — ${Array.isArray(areas) ? areas.length : 0}টি এরিয়া পাওয়া গেছে।` }));
      }
    } catch (err) {
      setTestResult((r) => ({ ...r, [provider]: `❌ ${err instanceof Error ? err.message : "টেস্ট ব্যর্থ"}` }));
    } finally { setBusy(""); }
  }

  const inputCls = "input mt-1 w-full";

  function providerCard(provider: CourierProvider, form: React.ReactNode, help: string) {
    const conn = connOf(provider);
    const account = accountOf(provider);
    const connected = conn?.connected === true;
    return (
      <div className="space-y-2 rounded-xl bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-slate-800">{PROVIDER_TITLES[provider]}</span>
          <span className="flex items-center gap-1.5">
            {connected && account?.isDefault ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">⭐ ডিফল্ট</span> : null}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${connected ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{connected ? "যুক্ত আছে" : "যুক্ত নেই"}</span>
          </span>
        </div>
        {connected ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {account && !account.isDefault ? (
                <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => void makeDefault(provider)}>⭐ ডিফল্ট করুন</button>
              ) : null}
              {provider !== "steadfast" ? (
                <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => void test(provider)}>{busy === `test-${provider}` ? "যাচাই হচ্ছে..." : "লাইভ টেস্ট"}</button>
              ) : null}
              <button type="button" className="btn-ghost btn-sm text-red-600" disabled={busy !== ""} onClick={() => void disconnect(provider)}>সংযোগ বিচ্ছিন্ন</button>
            </div>
            {provider === "steadfast" ? (
              <p className="text-xs text-slate-400">Steadfast-এর জন্য আলাদা টেস্ট/ব্যালেন্স পড়ার endpoint এই API-তে নেই — যাচাই কানেক্টের সময়ই আসল Balance কল দিয়ে হয়।</p>
            ) : null}
            {testResult[provider] ? <p className="text-xs text-slate-600">{testResult[provider]}</p> : null}
          </div>
        ) : (
          <form onSubmit={(e) => void connect(provider, e)} className="grid gap-2">
            {form}
            <button className="btn-primary btn-sm" disabled={busy !== ""}>{busy === provider ? "যাচাই হচ্ছে..." : "যাচাই করে যুক্ত করুন"}</button>
            <p className="text-xs text-slate-400">{help}</p>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        {providerCard("steadfast", (
          <>
            <input className={inputCls} placeholder="Steadfast API Key" value={steadfast.apiKey} onChange={(e) => setSteadfast({ ...steadfast, apiKey: e.target.value })} required />
            <input className={inputCls} placeholder="Secret Key" value={steadfast.secretKey} onChange={(e) => setSteadfast({ ...steadfast, secretKey: e.target.value })} required />
          </>
        ), "Key Steadfast Portal থেকে পাবেন। যুক্ত করার আগে আসল API দিয়ে Balance যাচাই করা হয়; ভুল Key হলে Steadfast-এর নিজের ত্রুটিই দেখাবে।")}
        {providerCard("pathao", (
          <>
            <input className={inputCls} placeholder="Client ID" value={pathao.clientId} onChange={(e) => setPathao({ ...pathao, clientId: e.target.value })} required />
            <input className={inputCls} placeholder="Client Secret" value={pathao.clientSecret} onChange={(e) => setPathao({ ...pathao, clientSecret: e.target.value })} required />
            <input className={inputCls} placeholder="Merchant ইমেইল (Username)" value={pathao.username} onChange={(e) => setPathao({ ...pathao, username: e.target.value })} required />
            <input className={inputCls} type="password" placeholder="Merchant পাসওয়ার্ড" value={pathao.password} onChange={(e) => setPathao({ ...pathao, password: e.target.value })} required />
            <label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={pathao.sandbox} onChange={(e) => setPathao({ ...pathao, sandbox: e.target.checked })} /> Sandbox (টেস্ট) পরিবেশ</label>
          </>
        ), "Client ID/Secret Pathao Merchant Panel-এর Developer API অংশে পাবেন। যুক্ত করার আগে আসল API-তে Token নিয়ে Store তালিকা যাচাই করা হয়। পাসওয়ার্ড Token নবায়নের জন্য এনক্রিপ্ট করে রাখা হয়।")}
        {providerCard("redx", (
          <>
            <input className={inputCls} placeholder="API Access Token" value={redx.accessToken} onChange={(e) => setRedx({ ...redx, accessToken: e.target.value })} required />
            <input className={inputCls} placeholder="Base URL (ঐচ্ছিক — Legacy অ্যাকাউন্টের জন্য)" value={redx.baseUrl} onChange={(e) => setRedx({ ...redx, baseUrl: e.target.value })} />
          </>
        ), "Token RedX Merchant Panel-এর API Settings থেকে পাবেন। যুক্ত করার আগে আসল API থেকে Delivery Area তালিকা এনে যাচাই করা হয়।")}
      </div>
    </div>
  );
}
