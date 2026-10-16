"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { buildCourierConnectBody, type CourierProvider, type EcourierForm, type PathaoForm, type RedxForm, type SteadfastForm } from "@/lib/connect-forms";
import type { ConnectionsOverview } from "@/lib/connections";

/**
 * CC6 (Connect Center B3) — Courier connect panel for the
 * Connect Center. Forms call the EXISTING CourierService
 * endpoints (POST courier/connect — verify-before-save against
 * each provider's real API, exactly as the Orders page does;
 * DELETE courier/connection per provider). Steadfast / Pathao /
 * RedX / eCourier (GB5) coexist as separate Integration rows and
 * are listed separately here. Paperfly is NOT offered: GB5
 * research found its API partner-gated with no published
 * developer docs (docs/gb5-courier-research.md).
 *
 * CC29 — MULTIPLE accounts per provider: connections are keyed
 * by a credential fingerprint server-side, so connecting a
 * second credential set ADDS an account (the list below shows
 * them all with the CC2 default badge), while re-entering the
 * SAME credentials updates that same account. Each account can
 * be made default or disconnected on its own; the connect form
 * stays available to add another account. The account identity
 * shown is the label (CC17) or the fingerprint prefix — never
 * any part of the credential.
 *
 * Default courier: the Connect Center's B1 PATCH set-default on
 * the courier Integration row (category group = courier).
 *
 * Live test: only where an existing real read endpoint exists —
 * Pathao stores and RedX areas are read with the STORED
 * credentials through the provider's own API (the primary
 * account). Steadfast exposes no balance/test read endpoint in
 * this API (its balance check happens inside connect), so NO
 * test button is offered for it — the card says so instead of
 * inventing one.
 */

interface CourierAccountView {
  id: string;
  externalAccountId: string | null;
  status: string;
  isDefault: boolean;
  label: string | null;
  connectedAt?: string;
}

interface CourierConnection { provider: string; connected: boolean; status?: string; accounts?: CourierAccountView[] }

const PROVIDER_TITLES: Record<CourierProvider, string> = {
  steadfast: "Steadfast", pathao: "Pathao Courier", redx: "RedX", ecourier: "eCourier",
};

export function CourierConnectPanel({ onChanged }: { onChanged?: () => void }) {
  const [conns, setConns] = useState<CourierConnection[]>([]);
  const [steadfast, setSteadfast] = useState<SteadfastForm>({ apiKey: "", secretKey: "" });
  const [pathao, setPathao] = useState<PathaoForm>({ clientId: "", clientSecret: "", username: "", password: "", sandbox: false });
  const [redx, setRedx] = useState<RedxForm>({ accessToken: "", baseUrl: "" });
  const [ecourier, setEcourier] = useState<EcourierForm>({ apiKey: "", apiSecret: "", userId: "", baseUrl: "" });
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
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reload = async () => { await load(); onChanged?.(); };
  const connOf = (p: CourierProvider) => conns.find((c) => c.provider === p);
  // CC29: the provider's accounts, straight from the courier
  // connections response (the API's own account list).
  const accountsOf = (p: CourierProvider): CourierAccountView[] => connOf(p)?.accounts ?? [];

  async function connect(provider: CourierProvider, e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(provider); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connect`, {
        method: "POST",
        body: JSON.stringify(buildCourierConnectBody(provider, { steadfast, pathao, redx, ecourier })),
      });
      setNotice(provider === "steadfast"
        ? "Steadfast যুক্ত হয়েছে (আসল API দিয়ে Balance যাচাই করা)।"
        : provider === "pathao"
          ? "Pathao যুক্ত হয়েছে (আসল API দিয়ে Token ও Store যাচাই করা)।"
          : provider === "ecourier"
            ? "eCourier যুক্ত হয়েছে (আসল API দিয়ে Package তালিকা যাচাই করা)।"
            : "RedX যুক্ত হয়েছে (আসল API দিয়ে Area তালিকা যাচাই করা)।");
      if (provider === "steadfast") setSteadfast({ apiKey: "", secretKey: "" });
      if (provider === "pathao") setPathao({ clientId: "", clientSecret: "", username: "", password: "", sandbox: false });
      if (provider === "redx") setRedx({ accessToken: "", baseUrl: "" });
      if (provider === "ecourier") setEcourier({ apiKey: "", apiSecret: "", userId: "", baseUrl: "" });
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Connect ব্যর্থ"); }
    finally { setBusy(""); }
  }

  /** CC29: disconnect exactly ONE account (its siblings keep
   * working); the API targets the row by integrationId. */
  async function disconnectAccount(provider: CourierProvider, account: CourierAccountView) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`dc-${account.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connection?provider=${provider}&integrationId=${encodeURIComponent(account.id)}`, { method: "DELETE" });
      setNotice(`${PROVIDER_TITLES[provider]}-এর একটি অ্যাকাউন্ট সংযোগ বিচ্ছিন্ন হয়েছে — বাকি অ্যাকাউন্টগুলো আগের মতোই চলবে।`);
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Disconnect ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function makeDefault(provider: CourierProvider, account: CourierAccountView) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`def-${account.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/connections/${account.id}/default`, { method: "PATCH" });
      setNotice(`${PROVIDER_TITLES[provider]}-এর বেছে নেওয়া অ্যাকাউন্টটি এখন ডিফল্ট।`);
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
      } else if (provider === "ecourier") {
        const cities = await apiFetch<unknown[]>(`/organizations/${orgId}/courier/ecourier/cities`);
        setTestResult((r) => ({ ...r, [provider]: `✅ eCourier API সাড়া দিয়েছে — ${Array.isArray(cities) ? cities.length : 0}টি শহর পাওয়া গেছে।` }));
      }
    } catch (err) {
      setTestResult((r) => ({ ...r, [provider]: `❌ ${err instanceof Error ? err.message : "টেস্ট ব্যর্থ"}` }));
    } finally { setBusy(""); }
  }

  const inputCls = "input mt-1 w-full";

  function accountName(account: CourierAccountView): string {
    if (account.label) return account.label;
    if (account.externalAccountId) return `অ্যাকাউন্ট ${account.externalAccountId.slice(0, 11)}…`;
    return "অ্যাকাউন্ট";
  }

  function providerCard(provider: CourierProvider, form: React.ReactNode, help: string) {
    const conn = connOf(provider);
    const accounts = accountsOf(provider);
    const connected = conn?.connected === true;
    const anyConnected = accounts.some((a) => a.status === "CONNECTED");
    return (
      <div className="space-y-2 rounded-xl bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-slate-800">{PROVIDER_TITLES[provider]}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${connected ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{connected ? "যুক্ত আছে" : "যুক্ত নেই"}</span>
        </div>
        {accounts.length > 0 ? (
          <ul className="space-y-1.5">
            {accounts.map((account) => (
              <li key={account.id} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs">
                <span className="font-medium text-slate-700">{accountName(account)}</span>
                {account.isDefault ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">⭐ ডিফল্ট</span> : null}
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${account.status === "CONNECTED" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>
                  {account.status === "CONNECTED" ? "যুক্ত আছে" : "বিচ্ছিন্ন"}
                </span>
                <span className="ml-auto flex gap-1">
                  {account.status === "CONNECTED" && !account.isDefault ? (
                    <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => void makeDefault(provider, account)}>⭐ ডিফল্ট করুন</button>
                  ) : null}
                  {account.status === "CONNECTED" ? (
                    <button type="button" className="btn-ghost btn-sm text-red-600" disabled={busy !== ""} onClick={() => void disconnectAccount(provider, account)}>বিচ্ছিন্ন করুন</button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {anyConnected ? (
          <div className="space-y-2">
            {provider !== "steadfast" ? (
              <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => void test(provider)}>{busy === `test-${provider}` ? "যাচাই হচ্ছে..." : "লাইভ টেস্ট (ডিফল্ট অ্যাকাউন্ট)"}</button>
            ) : (
              <p className="text-xs text-slate-400">Steadfast-এর জন্য আলাদা টেস্ট/ব্যালেন্স পড়ার endpoint এই API-তে নেই — যাচাই কানেক্টের সময়ই আসল Balance কল দিয়ে হয়।</p>
            )}
            {testResult[provider] ? <p className="text-xs text-slate-600">{testResult[provider]}</p> : null}
          </div>
        ) : null}
        <form onSubmit={(e) => void connect(provider, e)} className="grid gap-2">
          {accounts.length > 0 ? (
            <p className="text-xs font-medium text-slate-500">
              আরেকটি অ্যাকাউন্ট যুক্ত করুন — একই credential আবার দিলে সেই অ্যাকাউন্টটিই আপডেট হবে, নতুন তৈরি হবে না।
            </p>
          ) : null}
          {form}
          <button className="btn-primary btn-sm" disabled={busy !== ""}>{busy === provider ? "যাচাই হচ্ছে..." : "যাচাই করে যুক্ত করুন"}</button>
          <p className="text-xs text-slate-400">{help}</p>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
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
        {providerCard("ecourier", (
          <>
            <input className={inputCls} placeholder="API Key" value={ecourier.apiKey} onChange={(e) => setEcourier({ ...ecourier, apiKey: e.target.value })} required />
            <input className={inputCls} placeholder="API Secret" value={ecourier.apiSecret} onChange={(e) => setEcourier({ ...ecourier, apiSecret: e.target.value })} required />
            <input className={inputCls} placeholder="User ID" value={ecourier.userId} onChange={(e) => setEcourier({ ...ecourier, userId: e.target.value })} required />
            <input className={inputCls} placeholder="Base URL (ঐচ্ছিক — Partner অ্যাকাউন্টের জন্য)" value={ecourier.baseUrl} onChange={(e) => setEcourier({ ...ecourier, baseUrl: e.target.value })} />
          </>
        ), "তিনটি তথ্য eCourier আপনার মার্চেন্ট অ্যাকাউন্টের জন্য ইস্যু করে দেয় — তাদের কাছ থেকে সংগ্রহ করুন (ডকুমেন্টে নিজে-নিজে তৈরির পদ্ধতি বলা নেই)। যুক্ত করার আগে আসল API থেকে নির্ধারিত Package তালিকা এনে যাচাই করা হয়।")}
      </div>
    </div>
  );
}
