"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { buildCourierConnectBody, type CourierProvider, type EcourierForm, type PaperflyForm, type PathaoForm, type RedxForm, type SteadfastForm } from "@/lib/connect-forms";
import type { ConnectionsOverview } from "@/lib/connections";
import { useLocale } from "@/lib/i18n/provider";
import { fmtMoneyMinor, fmtNumber } from "@repo/contracts";

/**
 * CC6 (Connect Center B3) — Courier connect panel for the
 * Connect Center. Forms call the EXISTING CourierService
 * endpoints (POST courier/connect — verify-before-save against
 * each provider's real API, exactly as the Orders page does;
 * DELETE courier/connection per provider). Steadfast / Pathao /
 * RedX / eCourier (GB5) coexist as separate Integration rows and
 * are listed separately here. Paperfly IS listed since OU6 —
 * but only as a clearly labelled DEVELOPMENT adapter: GB5
 * research found its API partner-gated with no published
 * developer docs (docs/gb5-courier-research.md), so its card
 * is badged "লাইভ নয়", the API refuses the connect honestly
 * and saves nothing, and no booking can ever go through it.
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
 * account). Steadfast has no test-read endpoint, so NO test
 * button is offered for it — the card says so instead of
 * inventing one.
 *
 * OU6 — balance visibility: every card also renders its
 * provider's balance view from GET courier/balances. Only a
 * state "ok" view shows a number (Steadfast's real /get_balance
 * read); not_supported shows the honest no-API note and
 * not_configured the connect-first note — never a placeholder
 * figure.
 */

interface CourierAccountView {
  id: string;
  externalAccountId: string | null;
  status: string;
  isDefault: boolean;
  label: string | null;
  connectedAt?: string;
}

interface CourierConnection { provider: string; connected: boolean; status?: string; accounts?: CourierAccountView[]; capabilities?: { balance: boolean; live: boolean }; live?: boolean; developmentAdapter?: boolean }

/** OU6: one provider's balance view from GET courier/balances —
 * state is the API's honest state; balanceMinor is non-null
 * ONLY in state "ok" (a real provider read). */
interface CourierBalanceView {
  provider: string;
  state: "ok" | "not_supported" | "not_configured" | "error";
  balanceMinor: number | null;
  currency: string | null;
  supported: boolean;
  live: boolean;
  developmentAdapter: boolean;
  message: string | null;
}

const PROVIDER_TITLE_KEYS: Partial<Record<CourierProvider, string>> = { paperfly: "crTtlPaperfly" };

export function CourierConnectPanel({ onChanged }: { onChanged?: () => void }) {
  const { dict, t, locale } = useLocale();
  const D = dict.connections;
  const providerTitle = (p: CourierProvider): string => {
    const k = PROVIDER_TITLE_KEYS[p];
    return k ? D[k as keyof typeof D] : { steadfast: "Steadfast", pathao: "Pathao Courier", redx: "RedX", ecourier: "eCourier", paperfly: "Paperfly" }[p];
  };
  const [conns, setConns] = useState<CourierConnection[]>([]);
  const [steadfast, setSteadfast] = useState<SteadfastForm>({ apiKey: "", secretKey: "" });
  const [pathao, setPathao] = useState<PathaoForm>({ clientId: "", clientSecret: "", username: "", password: "", sandbox: false });
  const [redx, setRedx] = useState<RedxForm>({ accessToken: "", baseUrl: "" });
  const [ecourier, setEcourier] = useState<EcourierForm>({ apiKey: "", apiSecret: "", userId: "", baseUrl: "" });
  const [paperfly, setPaperfly] = useState<PaperflyForm>({ apiKey: "", apiSecret: "" });
  const [balances, setBalances] = useState<Record<string, CourierBalanceView>>({});
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
      const views = await apiFetch<CourierBalanceView[]>(`/organizations/${orgId}/courier/balances`);
      setBalances(Object.fromEntries(views.map((v) => [v.provider, v])));
    } catch { /* balance is a read-only extra — absence shows nothing */ }
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
        body: JSON.stringify(buildCourierConnectBody(provider, { steadfast, pathao, redx, ecourier, paperfly })),
      });
      setNotice(provider === "steadfast"
        ? D.crConnSteadfast
        : provider === "pathao"
          ? D.crConnPathao
          : provider === "ecourier"
            ? D.crConnEcourier
            : D.crConnRedx);
      if (provider === "steadfast") setSteadfast({ apiKey: "", secretKey: "" });
      if (provider === "pathao") setPathao({ clientId: "", clientSecret: "", username: "", password: "", sandbox: false });
      if (provider === "redx") setRedx({ accessToken: "", baseUrl: "" });
      if (provider === "ecourier") setEcourier({ apiKey: "", apiSecret: "", userId: "", baseUrl: "" });
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : D.crConnectFailed); }
    finally { setBusy(""); }
  }

  /** CC29: disconnect exactly ONE account (its siblings keep
   * working); the API targets the row by integrationId. */
  async function disconnectAccount(provider: CourierProvider, account: CourierAccountView) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`dc-${account.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/courier/connection?provider=${provider}&integrationId=${encodeURIComponent(account.id)}`, { method: "DELETE" });
      setNotice(t("connections.crDisconnected", { title: providerTitle(provider) }));
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : D.crDisconnectFailed); }
    finally { setBusy(""); }
  }

  async function makeDefault(provider: CourierProvider, account: CourierAccountView) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`def-${account.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/connections/${account.id}/default`, { method: "PATCH" });
      setNotice(t("connections.crDefaultNotice", { title: providerTitle(provider) }));
      await reload();
    } catch (err) { setError(err instanceof Error ? err.message : D.crDefaultFailed); }
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
        setTestResult((r) => ({ ...r, [provider]: t("connections.crTestPathao", { count: fmtNumber(locale, Array.isArray(stores) ? stores.length : 0) }) }));
      } else if (provider === "redx") {
        const areas = await apiFetch<unknown[]>(`/organizations/${orgId}/courier/redx/areas`);
        setTestResult((r) => ({ ...r, [provider]: t("connections.crTestRedx", { count: fmtNumber(locale, Array.isArray(areas) ? areas.length : 0) }) }));
      } else if (provider === "ecourier") {
        const cities = await apiFetch<unknown[]>(`/organizations/${orgId}/courier/ecourier/cities`);
        setTestResult((r) => ({ ...r, [provider]: t("connections.crTestEcourier", { count: fmtNumber(locale, Array.isArray(cities) ? cities.length : 0) }) }));
      }
    } catch (err) {
      setTestResult((r) => ({ ...r, [provider]: `❌ ${err instanceof Error ? err.message : D.crTestFailed}` }));
    } finally { setBusy(""); }
  }

  /** OU6: re-read ONE provider's balance through its own API
   * (only providers whose balance state can be "ok" get the
   * button — rendered from the API's supported flag). */
  async function refreshBalance(provider: CourierProvider) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`bal-${provider}`);
    try {
      const view = await apiFetch<CourierBalanceView>(`/organizations/${orgId}/courier/balance?provider=${provider}`);
      setBalances((b) => ({ ...b, [provider]: view }));
    } catch { /* the previous view (or its absence) stands */ }
    finally { setBusy(""); }
  }

  const inputCls = "input mt-1 w-full";

  function accountName(account: CourierAccountView): string {
    if (account.label) return account.label;
    if (account.externalAccountId) return t("connections.crAccountPrefix", { id: account.externalAccountId.slice(0, 11) });
    return D.crAccount;
  }

  function providerCard(provider: CourierProvider, form: React.ReactNode, help: string) {
    const conn = connOf(provider);
    const accounts = accountsOf(provider);
    const connected = conn?.connected === true;
    const anyConnected = accounts.some((a) => a.status === "CONNECTED");
    return (
      <div className="space-y-2 rounded-xl bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-slate-800">{providerTitle(provider)}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${connected ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{connected ? D.crConnected : D.crNotConnected}</span>
        </div>
        {accounts.length > 0 ? (
          <ul className="space-y-1.5">
            {accounts.map((account) => (
              <li key={account.id} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs">
                <span className="font-medium text-slate-700">{accountName(account)}</span>
                {account.isDefault ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{D.crDefault}</span> : null}
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${account.status === "CONNECTED" ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>
                  {account.status === "CONNECTED" ? D.crConnected : D.crDisconnectedState}
                </span>
                <span className="ml-auto flex gap-1">
                  {account.status === "CONNECTED" && !account.isDefault ? (
                    <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => void makeDefault(provider, account)}>{D.crMakeDefault}</button>
                  ) : null}
                  {account.status === "CONNECTED" ? (
                    <button type="button" className="btn-ghost btn-sm text-red-600" disabled={busy !== ""} onClick={() => void disconnectAccount(provider, account)}>{D.crDisconnect}</button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {balances[provider] ? (
          <div className="rounded-lg bg-white px-2.5 py-1.5 text-xs text-slate-600">
            {balances[provider].state === "ok" && balances[provider].balanceMinor != null ? (
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-slate-700">
                  {t("connections.crBalanceLabel", { amount: fmtMoneyMinor(locale, balances[provider].balanceMinor!) })}
                </span>
                <span className="text-slate-400">{D.crBalanceNote}</span>
                <button type="button" className="btn-ghost btn-sm" disabled={busy !== ""} onClick={() => void refreshBalance(provider)}>{busy === `bal-${provider}` ? D.crReading : dict.common.refresh}</button>
              </span>
            ) : balances[provider].state === "error" ? (
              <span>{t("connections.crBalanceErr", { msg: balances[provider].message ?? D.crBalanceErrFallback })}</span>
            ) : balances[provider].developmentAdapter ? (
              <span>{D.crBalanceDev}</span>
            ) : balances[provider].state === "not_supported" ? (
              <span>{D.crBalanceNA}</span>
            ) : (
              <span>{D.crBalanceConnect}</span>
            )}
          </div>
        ) : null}
        {anyConnected ? (
          <div className="space-y-2">
            {provider !== "steadfast" ? (
              <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => void test(provider)}>{busy === `test-${provider}` ? D.crTesting : D.crLiveTest}</button>
            ) : (
              <p className="text-xs text-slate-400">{D.crSteadfastNote}</p>
            )}
            {testResult[provider] ? <p className="text-xs text-slate-600">{testResult[provider]}</p> : null}
          </div>
        ) : null}
        <form onSubmit={(e) => void connect(provider, e)} className="grid gap-2">
          {accounts.length > 0 ? (
            <p className="text-xs font-medium text-slate-500">{D.crAddAnother}</p>
          ) : null}
          {form}
          <button className="btn-primary btn-sm" disabled={busy !== ""}>{busy === provider ? D.crVerifying : D.crConnectBtn}</button>
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
        ), D.crHelpSteadfast)}
        {providerCard("pathao", (
          <>
            <input className={inputCls} placeholder="Client ID" value={pathao.clientId} onChange={(e) => setPathao({ ...pathao, clientId: e.target.value })} required />
            <input className={inputCls} placeholder="Client Secret" value={pathao.clientSecret} onChange={(e) => setPathao({ ...pathao, clientSecret: e.target.value })} required />
            <input className={inputCls} placeholder={D.crPhMerchantEmail} value={pathao.username} onChange={(e) => setPathao({ ...pathao, username: e.target.value })} required />
            <input className={inputCls} type="password" placeholder={D.crPhMerchantPass} value={pathao.password} onChange={(e) => setPathao({ ...pathao, password: e.target.value })} required />
            <label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={pathao.sandbox} onChange={(e) => setPathao({ ...pathao, sandbox: e.target.checked })} /> {D.crSandboxEnv}</label>
          </>
        ), D.crHelpPathao)}
        {providerCard("redx", (
          <>
            <input className={inputCls} placeholder="API Access Token" value={redx.accessToken} onChange={(e) => setRedx({ ...redx, accessToken: e.target.value })} required />
            <input className={inputCls} placeholder={D.crPhBaseUrlLegacy} value={redx.baseUrl} onChange={(e) => setRedx({ ...redx, baseUrl: e.target.value })} />
          </>
        ), D.crHelpRedx)}
        {providerCard("ecourier", (
          <>
            <input className={inputCls} placeholder="API Key" value={ecourier.apiKey} onChange={(e) => setEcourier({ ...ecourier, apiKey: e.target.value })} required />
            <input className={inputCls} placeholder="API Secret" value={ecourier.apiSecret} onChange={(e) => setEcourier({ ...ecourier, apiSecret: e.target.value })} required />
            <input className={inputCls} placeholder="User ID" value={ecourier.userId} onChange={(e) => setEcourier({ ...ecourier, userId: e.target.value })} required />
            <input className={inputCls} placeholder={D.crPhBaseUrlPartner} value={ecourier.baseUrl} onChange={(e) => setEcourier({ ...ecourier, baseUrl: e.target.value })} />
          </>
        ), D.crHelpEcourier)}
        <div className="lg:col-span-2 xl:col-span-4">
          {providerCard("paperfly", (
            <>
              <p className="rounded-lg bg-amber-50 p-2.5 text-xs font-medium text-amber-800">{D.crPaperflyWarn}</p>
              <input className={inputCls} placeholder={D.crPhPaperflyKey} value={paperfly.apiKey} onChange={(e) => setPaperfly({ ...paperfly, apiKey: e.target.value })} />
              <input className={inputCls} placeholder="Paperfly API Secret" value={paperfly.apiSecret} onChange={(e) => setPaperfly({ ...paperfly, apiSecret: e.target.value })} />
            </>
          ), D.crHelpPaperfly)}
        </div>
      </div>
    </div>
  );
}
