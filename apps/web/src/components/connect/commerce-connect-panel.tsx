"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, publicApiBase } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import { buildShopifyConnectBody, buildWooConnectBody } from "@/lib/connect-forms";
import { useLocale } from "@/lib/i18n/provider";
import { fmtDateTime, fmtNumber } from "@repo/contracts";

/**
 * CC5 (Connect Center B3) — Commerce connect panel, extracted
 * VERBATIM from the Integrations page (B3) so the SAME component
 * serves both /dashboard/integrations and the Connect Center's
 * Commerce section: store create, WooCommerce key connect
 * (verify-before-save), WooCommerce 1-click wc-auth, Shopify
 * legacy-token and Dev Dashboard client-credentials connects,
 * per-integration sync (products/orders/customers/reviews),
 * health check, webhook repair, disconnect — plus the webchat
 * site manager that has always lived alongside. Every call goes
 * to the same APIs the integrations page has always used; the
 * optional onChanged lets the host page refresh after a mutation.
 */

interface Store { id: string; name: string; url: string; currency: string; platform?: string; syncMode?: string; trackingKey?: string | null }
interface Integration { id: string; provider: string; status: string; lastSyncAt?: string | null; lastError?: string | null; store?: Store | null; webhookStatus?: unknown; authType?: string | null; tokenExpiresAt?: string | null }
interface SyncJob { id: string; kind: string; status: string; fetched: number; created: number; updated: number; error?: string | null }
interface HealthCheck { key: string; label: string; status: string; evidence: string }
interface HealthResult { integrationId: string; provider: string; checkedAt: string; overall: "pass" | "warn" | "fail" | "unknown"; checks: HealthCheck[] }

function syncModeLabel(mode?: string): string {
  switch (mode) {
    case "co-manage": return "Co-manage";
    case "full-manage": return "Full-manage";
    default: return "Mirror";
  }
}

function webhookStatusText(ws: unknown): string | null {
  if (typeof ws === "string") return ws;
  if (ws && typeof ws === "object") {
    const s = (ws as { status?: unknown }).status;
    if (typeof s === "string") return s;
  }
  return null;
}

function healthBadge(status: string): string {
  switch (status) {
    case "pass": return "bg-green-100 text-green-700";
    case "warn": return "bg-amber-100 text-amber-700";
    case "fail": return "bg-red-100 text-red-700";
    default: return "bg-slate-200 text-slate-600";
  }
}

export function CommerceConnectPanel({ onChanged }: { onChanged?: () => void }) {
  const { dict, t, locale } = useLocale();
  const D = dict.connections;
  const [stores, setStores] = useState<Store[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [jobs, setJobs] = useState<Record<string, SyncJob[]>>({});
  const [storeForm, setStoreForm] = useState({ name: "", url: "", platform: "WOOCOMMERCE" });
  const [connectForm, setConnectForm] = useState({ storeId: "", consumerKey: "", consumerSecret: "", webhookSecret: "" });
  const [wcSites, setWcSites] = useState<{ id: string; name: string; domain?: string | null; widgetKey: string; enabled: boolean }[]>([]);
  const [wcForm, setWcForm] = useState({ name: "", domain: "", greeting: dict.connections.cmGreetingDefault, color: "#6d28d9" });
  const [shopifyForm, setShopifyForm] = useState({ storeId: "", accessToken: "", apiSecret: "" });
  const [shopifyAuthMode, setShopifyAuthMode] = useState<"legacy" | "client-credentials">("legacy");
  const [shopifyCcForm, setShopifyCcForm] = useState({ clientId: "", clientSecret: "" });
  const [health, setHealth] = useState<Record<string, HealthResult>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError(D.cmNoOrg); return; }
    try {
      const [s, i] = await Promise.all([
        apiFetch<Store[]>(`/organizations/${orgId}/stores`),
        apiFetch<Integration[]>(`/organizations/${orgId}/integrations`),
      ]);
      setStores(s);
      apiFetch<{ id: string; name: string; domain?: string | null; widgetKey: string; enabled: boolean }[]>(`/organizations/${orgId}/webchat/sites`).then(setWcSites).catch(() => undefined); setIntegrations(i);
      if (s.length && !connectForm.storeId) setConnectForm((f) => ({ ...f, storeId: s[0].id }));
    } catch (e) { setError(e instanceof Error ? e.message : D.cmLoadFailed); }
  }, [connectForm.storeId]);

  useEffect(() => { load(); }, [load]);

  // CC5: mutations reload this panel AND let a host page (the
  // Connect Center) refresh its own overview.
  const reload = async () => { await load(); onChanged?.(); };

  async function createStore(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setBusy("store");
    try {
      await apiFetch(`/organizations/${orgId}/stores`, { method: "POST", body: JSON.stringify(storeForm) });
      setStoreForm({ name: "", url: "", platform: "WOOCOMMERCE" }); setNotice(D.cmStoreAdded); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : D.cmFailed); }
    finally { setBusy(""); }
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setBusy("connect");
    try {
      await apiFetch(`/organizations/${orgId}/integrations/woocommerce/connect`, {
        method: "POST",
        body: JSON.stringify(buildWooConnectBody(connectForm)),
      });
      setConnectForm((f) => ({ ...f, consumerKey: "", consumerSecret: "", webhookSecret: "" }));
      setNotice(D.cmWooConnected); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : D.cmWooConnFailed); }
    finally { setBusy(""); }
  }

  async function connectWcAuthOneClick() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!connectForm.storeId) { setError(D.cmPickStoreFirst); return; }
    setError(""); setBusy("wc-auth");
    try {
      const res = await apiFetch<{ authorizeUrl: string }>(`/organizations/${orgId}/integrations/woocommerce/wc-auth/authorize-url`, {
        method: "POST",
        body: JSON.stringify({ storeId: connectForm.storeId }),
      });
      window.open(res.authorizeUrl, "_blank");
      setNotice(D.cmWcAuthNotice);
    } catch (e) { setError(e instanceof Error ? e.message : D.cmWcAuthFailed); }
    finally { setBusy(""); }
  }

  async function connectShopify(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setBusy("shopify");
    try {
      const body = buildShopifyConnectBody(shopifyAuthMode, shopifyForm, shopifyCcForm);
      const res = await apiFetch<{ webhookRegistration?: string }>(`/organizations/${orgId}/integrations/shopify/connect`, { method: "POST", body: JSON.stringify(body) });
      setShopifyForm((f) => ({ ...f, accessToken: "", apiSecret: "" }));
      setShopifyCcForm({ clientId: "", clientSecret: "" });
      setNotice(D.cmShopifyConnected + (res?.webhookRegistration ? t("connections.cmWebhookRegSuffix", { reg: res.webhookRegistration }) : "")); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : D.cmShopifyFailed); }
    finally { setBusy(""); }
  }

  async function checkHealth(integrationId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setBusy(`health-${integrationId}`);
    try {
      const h = await apiFetch<HealthResult>(`/organizations/${orgId}/integrations/${integrationId}/health`);
      setHealth((prev) => ({ ...prev, [integrationId]: h }));
    } catch (e) { setError(e instanceof Error ? e.message : D.cmHealthFailed); }
    finally { setBusy(""); }
  }

  async function repairWebhooks(integrationId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setBusy(`repair-${integrationId}`);
    try {
      const res = await apiFetch<{ integrationId: string; webhookRegistration: string; webhookStatus: unknown }>(`/organizations/${orgId}/integrations/${integrationId}/repair-webhooks`, { method: "POST" });
      setNotice(t("connections.cmRepairNotice", { reg: res.webhookRegistration }));
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : D.cmRepairFailed); }
    finally { setBusy(""); }
  }

  async function sync(integrationId: string, kind: "products" | "orders" | "customers" | "reviews") {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setBusy(`${integrationId}-${kind}`);
    try {
      // EC15: the reviews sync returns the SyncJob row plus
      // { platform, reviews?, total } — for Shopify with no reviews
      // source the server answers reviews:
      // "unsupported_no_reviews_source", which is an honest
      // unsupported result, NOT a successful pull of 0 reviews.
      const job = await apiFetch<SyncJob & { reviews?: string; platform?: string; total?: number }>(`/organizations/${orgId}/integrations/${integrationId}/sync/${kind}`, { method: "POST" });
      setJobs((j) => ({ ...j, [integrationId]: [job, ...(j[integrationId] ?? [])] }));
      if (kind === "reviews" && job.reviews === "unsupported_no_reviews_source") {
        setNotice(D.cmReviewsUnsupported);
      } else {
        setNotice(t("connections.cmSyncDone", { kind, fetched: fmtNumber(locale, job.fetched), created: fmtNumber(locale, job.created), updated: fmtNumber(locale, job.updated) }));
      }
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : D.cmSyncFailed); }
    finally { setBusy(""); }
  }

  async function disconnect(integrationId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/integrations/${integrationId}/disconnect`, { method: "POST" });
    await reload();
  }

  const inputCls = "input mt-1";

  return (
    <div className="space-y-8">
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="card p-5">
        <div className="font-semibold">{D.cmConnectedTitle}</div>
        {integrations.length === 0 ? <p className="mt-2 text-sm text-slate-500">{D.cmNoIntegrations}</p> : (
          <ul className="mt-3 space-y-3">
            {integrations.map((i) => (
              <li key={i.id} className="rounded-lg bg-slate-50 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold capitalize">{i.provider}</span>{" "}
                    <span className="text-slate-500">{i.store?.name} · {i.store?.url}</span>{" "}
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${i.status === "CONNECTED" ? "bg-green-100 text-green-700" : i.status === "ERROR" ? "bg-red-100 text-red-700" : "bg-slate-200 text-slate-600"}`}>{i.status}</span>
                    {(() => {
                      const st = i.store ? stores.find((s) => s.id === i.store?.id) : undefined;
                      return st?.syncMode ? <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">{t("connections.cmSyncPrefix", { mode: syncModeLabel(st.syncMode) })}</span> : null;
                    })()}
                    {i.provider === "shopify" && i.authType ? <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">{i.authType === "client_credentials" || i.authType === "client-credentials" ? "Client Credentials" : "Legacy Token"}</span> : null}
                  </div>
                  <div className="flex gap-2">
                    <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => sync(i.id, "products")}>{D.cmSyncProducts}</button>
                    <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => sync(i.id, "orders")}>{D.cmSyncOrders}</button>
                    <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => sync(i.id, "customers")}>{D.cmSyncCustomers}</button>
                    <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => sync(i.id, "reviews")}>{D.cmSyncReviews}</button>
                    <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => checkHealth(i.id)}>{busy === `health-${i.id}` ? D.cmChecking : D.cmHealthCheck}</button>
                    <button className="rounded-lg border px-3 py-1.5 disabled:opacity-50" disabled={busy !== ""} onClick={() => repairWebhooks(i.id)}>{busy === `repair-${i.id}` ? D.cmRepairing : D.cmRepairWebhooks}</button>
                    <button className="rounded-lg border px-3 py-1.5" onClick={() => disconnect(i.id)}>{D.cmDisconnect}</button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {D.cmLastSync}{i.lastSyncAt ? fmtDateTime(locale, new Date(i.lastSyncAt)) : D.cmNever}
                  {i.lastError ? <span className="text-red-600">{D.cmLastError}{i.lastError}</span> : null}
                </div>
                {webhookStatusText(i.webhookStatus) ? <div className="mt-1 text-xs text-slate-500">{D.cmWebhookReg}{webhookStatusText(i.webhookStatus)}</div> : null}
                {health[i.id] ? (
                  <div className="mt-2 rounded-lg border bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold">{D.cmHealthCheck}</span>
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${healthBadge(health[i.id].overall)}`}>{health[i.id].overall}</span>
                      <span className="text-slate-400">{fmtDateTime(locale, new Date(health[i.id].checkedAt))}</span>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {health[i.id].checks.map((c) => (
                        <li key={c.key} className="flex flex-wrap items-baseline gap-2 text-xs">
                          <span className="font-medium">{c.label}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${healthBadge(c.status)}`}>{c.status}</span>
                          <span className="text-slate-500">{c.evidence}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {i.provider === "woocommerce" ? <div className="mt-1 text-xs text-slate-400">{D.cmWooWebhookLabel}<code>{`${publicApiBase()}/webhooks/woocommerce/${i.id}`}</code> · Topic: Order created/updated, Product created/updated</div> : null}
                {i.provider === "woocommerce" ? (() => {
                  const st = i.store ? stores.find((s) => s.id === i.store?.id) : undefined;
                  const key = st?.trackingKey ?? D.cmKeyMissing;
                  const origin = typeof window !== "undefined" ? window.location.origin : "";
                  return (
                    <div className="mt-2 rounded-lg border border-dashed bg-white p-3 text-xs text-slate-600">
                      <div className="font-semibold text-slate-800">{D.cmTrackerTitle}</div>
                      <p className="mt-1">{D.cmTrackerIntro}</p>
                      <ol className="mt-2 list-decimal space-y-1 pl-5">
                        <li>{D.cmTrackerStep1}</li>
                        <li>{D.cmTrackerStep2a}<code>&lt;head&gt;</code>{D.cmTrackerStep2b}
                          <pre className="mt-1 overflow-auto rounded-lg bg-slate-900 p-2 text-[11px] text-green-300">{`<script async src="${origin}/tracker.js" data-key="${key}" data-api="${publicApiBase()}"></script>`}</pre>
                        </li>
                        <li>{D.cmTrackerStep3}</li>
                        <li>{D.cmTrackerStep4}</li>
                        <li>{D.cmTrackerStep5a}<code>TP.identify({"{"} email {"}"})</code>{D.cmTrackerStep5b}</li>
                      </ol>
                    </div>
                  );
                })() : null}
                {i.provider === "shopify" ? <div className="mt-1 text-xs text-slate-400">{D.cmShopifyWebhookLabel}<code>{`${publicApiBase()}/webhooks/shopify/${i.id}`}</code> · Format: JSON · Event: Order creation, Order update, Product creation, Product update</div> : null}
                {(jobs[i.id] ?? []).map((j) => (
                  <div key={j.id} className="mt-1 text-xs text-slate-500">{j.kind}: {j.status} · fetched {fmtNumber(locale, j.fetched)}, created {fmtNumber(locale, j.created)}, updated {fmtNumber(locale, j.updated)}{j.error ? ` · ${j.error}` : ""}</div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={createStore} className="space-y-3 card p-5">
        <div className="font-semibold">{D.cmStep1}</div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-sm">{D.cmPlatform}
            <select className={inputCls} value={storeForm.platform} onChange={(e) => setStoreForm({ ...storeForm, platform: e.target.value })}>
              <option value="WOOCOMMERCE">WooCommerce</option><option value="SHOPIFY">Shopify</option><option value="CUSTOM">Custom</option>
            </select>
          </label>
          <label className="block text-sm">{D.cmStoreName}<input className={inputCls} value={storeForm.name} onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })} required /></label>
          <label className="block text-sm">{D.cmStoreUrl}<input className={inputCls} value={storeForm.url} onChange={(e) => setStoreForm({ ...storeForm, url: e.target.value })} required placeholder="https://yourstore.myshopify.com" /></label>
        </div>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{D.cmAddStore}</button>
      </form>

      <div className="space-y-3 card p-5">
        <div className="font-semibold">{D.cmChatTitle}</div>
        <p className="text-sm text-slate-500">{D.cmChatIntro}</p>
        <form className="grid gap-2 sm:grid-cols-4" onSubmit={async (e) => {
          e.preventDefault();
          const orgId = getOrganizationId(); if (!orgId) return;
          try {
            await apiFetch(`/organizations/${orgId}/webchat/sites`, { method: "POST", body: JSON.stringify(wcForm) });
            setNotice(D.cmSiteCreated);
            setWcForm({ name: "", domain: "", greeting: D.cmGreetingDefault, color: "#6d28d9" });
            await reload();
          } catch (err) { setError(err instanceof Error ? err.message : D.cmCreateFailed); }
        }}>
          <input className="input" placeholder={D.cmPhSiteName} value={wcForm.name} onChange={(e) => setWcForm({ ...wcForm, name: e.target.value })} required />
          <input className="input" placeholder={D.cmPhDomain} value={wcForm.domain} onChange={(e) => setWcForm({ ...wcForm, domain: e.target.value })} />
          <input className="input" placeholder={D.cmPhGreeting} value={wcForm.greeting} onChange={(e) => setWcForm({ ...wcForm, greeting: e.target.value })} />
          <span className="flex items-center gap-2"><input type="color" value={wcForm.color} onChange={(e) => setWcForm({ ...wcForm, color: e.target.value })} /><button className="btn-primary flex-1">{D.cmCreateSite}</button></span>
        </form>
        {wcSites.map((site) => (
          <div key={site.id} className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{site.name} {site.domain ? <span className="text-slate-400">({site.domain})</span> : null}</span>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={site.enabled} onChange={async (e) => {
                const orgId = getOrganizationId(); if (!orgId) return;
                await apiFetch(`/organizations/${orgId}/webchat/sites/${site.id}`, { method: "PATCH", body: JSON.stringify({ enabled: e.target.checked }) }).catch(() => undefined);
                await reload();
              }} /> {D.cmEnabledLabel}</label>
            </div>
            <p className="mt-1 text-xs text-slate-500">{D.cmEmbedNote}</p>
            <code className="mt-1 block overflow-x-auto whitespace-nowrap rounded bg-slate-900 p-2 text-[11px] text-green-300">{`<script src="${typeof window !== "undefined" ? window.location.origin : ""}/chat-widget.js" data-key="${site.widgetKey}" async></script>`}</code>
          </div>
        ))}
      </div>

      <form onSubmit={connect} className="space-y-3 card p-5">
        <div className="font-semibold">{D.cmStep2Woo}</div>
        <p className="text-sm text-slate-500">{D.cmWooIntro}</p>
        <label className="block text-sm">{D.cmStoreSelect}
          <select className={inputCls} value={connectForm.storeId} onChange={(e) => setConnectForm({ ...connectForm, storeId: e.target.value })} required>
            <option value="">{D.cmSelectPlaceholder}</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.url})</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Consumer Key<input className={inputCls} value={connectForm.consumerKey} onChange={(e) => setConnectForm({ ...connectForm, consumerKey: e.target.value })} required placeholder="ck_..." /></label>
          <label className="block text-sm">Consumer Secret<input className={inputCls} type="password" value={connectForm.consumerSecret} onChange={(e) => setConnectForm({ ...connectForm, consumerSecret: e.target.value })} required placeholder="cs_..." /></label>
        </div>
        <label className="block text-sm">{D.cmWebhookSecretOpt}<input className={inputCls} value={connectForm.webhookSecret} onChange={(e) => setConnectForm({ ...connectForm, webhookSecret: e.target.value })} /></label>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
          {busy === "connect" ? D.cmConnecting : D.cmConnectVerify}
        </button>
        <p className="text-xs text-slate-400">{D.cmWooNote}</p>
        <div className="space-y-2 border-t pt-3">
          <div className="text-sm font-semibold">{D.cmOneClickTitle}</div>
          <p className="text-sm text-slate-500">{D.cmOneClickIntro}</p>
          <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== "" || !connectForm.storeId} onClick={connectWcAuthOneClick}>
            {busy === "wc-auth" ? D.cmWcAuthBusy : D.cmWcAuthBtn}
          </button>
          <p className="text-xs text-slate-400">{D.cmOneClickNote}</p>
        </div>
      </form>

      <form onSubmit={connectShopify} className="space-y-3 card p-5">
        <div className="font-semibold">{D.cmStep2Shopify}</div>
        <p className="text-sm text-slate-500">{D.cmShopifyIntro}</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="shopify-auth-mode" checked={shopifyAuthMode === "legacy"} onChange={() => setShopifyAuthMode("legacy")} />
            {D.cmAuthLegacy}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="shopify-auth-mode" checked={shopifyAuthMode === "client-credentials"} onChange={() => setShopifyAuthMode("client-credentials")} />
            {D.cmAuthCc}
          </label>
        </div>
        <label className="block text-sm">{D.cmStoreShopify}
          <select className={inputCls} value={shopifyForm.storeId} onChange={(e) => setShopifyForm({ ...shopifyForm, storeId: e.target.value })} required>
            <option value="">{D.cmSelectPlaceholder}</option>
            {stores.map((st) => <option key={st.id} value={st.id}>{st.name} ({st.url})</option>)}
          </select>
        </label>
        {shopifyAuthMode === "legacy" ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Admin API Access Token<input className={inputCls} type="password" value={shopifyForm.accessToken} onChange={(e) => setShopifyForm({ ...shopifyForm, accessToken: e.target.value })} required placeholder="shpat_..." /></label>
            <label className="block text-sm">App Client Secret<input className={inputCls} type="password" value={shopifyForm.apiSecret} onChange={(e) => setShopifyForm({ ...shopifyForm, apiSecret: e.target.value })} required placeholder="shpss_..." /></label>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">Client ID<input className={inputCls} type="password" value={shopifyCcForm.clientId} onChange={(e) => setShopifyCcForm({ ...shopifyCcForm, clientId: e.target.value })} required /></label>
              <label className="block text-sm">Client Secret<input className={inputCls} type="password" value={shopifyCcForm.clientSecret} onChange={(e) => setShopifyCcForm({ ...shopifyCcForm, clientSecret: e.target.value })} required placeholder="shpss_..." /></label>
            </div>
            <p className="text-xs text-slate-400">{D.cmCcNote}</p>
          </>
        )}
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
          {busy === "shopify" ? D.cmConnecting : D.cmConnectShopify}
        </button>
        <p className="text-xs text-slate-400">{D.cmShopifyNote}</p>
      </form>

      {stores.length === 0 && integrations.length === 0 ? (
        <EmptyState title={D.cmEmptyTitle} description={D.cmEmptyDesc} />
      ) : null}
    </div>
  );
}
