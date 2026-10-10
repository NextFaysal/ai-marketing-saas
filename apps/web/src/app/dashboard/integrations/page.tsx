"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, publicApiBase } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";

interface Store { id: string; name: string; url: string; currency: string }
interface Integration { id: string; provider: string; status: string; lastSyncAt?: string | null; lastError?: string | null; store?: Store | null }
interface SyncJob { id: string; kind: string; status: string; fetched: number; created: number; updated: number; error?: string | null }

export default function IntegrationsPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [jobs, setJobs] = useState<Record<string, SyncJob[]>>({});
  const [storeForm, setStoreForm] = useState({ name: "", url: "", platform: "WOOCOMMERCE" });
  const [connectForm, setConnectForm] = useState({ storeId: "", consumerKey: "", consumerSecret: "", webhookSecret: "" });
  const [wcSites, setWcSites] = useState<{ id: string; name: string; domain?: string | null; widgetKey: string; enabled: boolean }[]>([]);
  const [wcForm, setWcForm] = useState({ name: "", domain: "", greeting: "আসসালামু আলাইকুম! কীভাবে সাহায্য করতে পারি?", color: "#6d28d9" });
  const [shopifyForm, setShopifyForm] = useState({ storeId: "", accessToken: "", apiSecret: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      const [s, i] = await Promise.all([
        apiFetch<Store[]>(`/organizations/${orgId}/stores`),
        apiFetch<Integration[]>(`/organizations/${orgId}/integrations`),
      ]);
      setStores(s);
      apiFetch<{ id: string; name: string; domain?: string | null; widgetKey: string; enabled: boolean }[]>(`/organizations/${orgId}/webchat/sites`).then(setWcSites).catch(() => undefined); setIntegrations(i);
      if (s.length && !connectForm.storeId) setConnectForm((f) => ({ ...f, storeId: s[0].id }));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
  }, [connectForm.storeId]);

  useEffect(() => { load(); }, [load]);

  async function createStore(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setBusy("store");
    try {
      await apiFetch(`/organizations/${orgId}/stores`, { method: "POST", body: JSON.stringify(storeForm) });
      setStoreForm({ name: "", url: "", platform: "WOOCOMMERCE" }); setNotice("স্টোর যোগ হয়েছে। এবার প্ল্যাটফর্ম অনুযায়ী কানেক্ট করুন।"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setBusy("connect");
    try {
      await apiFetch(`/organizations/${orgId}/integrations/woocommerce/connect`, {
        method: "POST",
        body: JSON.stringify({ ...connectForm, webhookSecret: connectForm.webhookSecret || undefined }),
      });
      setConnectForm((f) => ({ ...f, consumerKey: "", consumerSecret: "", webhookSecret: "" }));
      setNotice("WooCommerce কানেক্ট হয়েছে। এবার Products ও Orders Sync করুন।"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Connection failed"); }
    finally { setBusy(""); }
  }

  async function connectShopify(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setBusy("shopify");
    try {
      await apiFetch(`/organizations/${orgId}/integrations/shopify/connect`, { method: "POST", body: JSON.stringify(shopifyForm) });
      setShopifyForm((f) => ({ ...f, accessToken: "", apiSecret: "" }));
      setNotice("Shopify কানেক্ট হয়েছে। এবার Products ও Orders Sync করুন।"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Shopify connection failed"); }
    finally { setBusy(""); }
  }

  async function sync(integrationId: string, kind: "products" | "orders") {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setBusy(`${integrationId}-${kind}`);
    try {
      const job = await apiFetch<SyncJob>(`/organizations/${orgId}/integrations/${integrationId}/sync/${kind}`, { method: "POST" });
      setJobs((j) => ({ ...j, [integrationId]: [job, ...(j[integrationId] ?? [])] }));
      setNotice(`${kind} Sync শেষ: মোট ${job.fetched}, নতুন ${job.created}, আপডেট ${job.updated}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed"); }
    finally { setBusy(""); }
  }

  async function disconnect(integrationId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/integrations/${integrationId}/disconnect`, { method: "POST" });
    await load();
  }

  const inputCls = "input mt-1";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Stores & Integrations</h1>
        <p className="text-sm text-slate-500">WooCommerce অথবা Shopify কানেক্ট করুন। সব Secret সার্ভারে AES-256 এনক্রিপ্ট করে রাখা হয়, ব্রাউজারে বা API উত্তরে কখনো ফেরত যায় না।</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="card p-5">
        <div className="font-semibold">সংযুক্ত ইন্টিগ্রেশন</div>
        {integrations.length === 0 ? <p className="mt-2 text-sm text-slate-500">এখনো কোনো ইন্টিগ্রেশন নেই।</p> : (
          <ul className="mt-3 space-y-3">
            {integrations.map((i) => (
              <li key={i.id} className="rounded-lg bg-slate-50 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold capitalize">{i.provider}</span>{" "}
                    <span className="text-slate-500">{i.store?.name} · {i.store?.url}</span>{" "}
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${i.status === "CONNECTED" ? "bg-green-100 text-green-700" : i.status === "ERROR" ? "bg-red-100 text-red-700" : "bg-slate-200 text-slate-600"}`}>{i.status}</span>
                  </div>
                  <div className="flex gap-2">
                    <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => sync(i.id, "products")}>Sync Products</button>
                    <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => sync(i.id, "orders")}>Sync Orders</button>
                    <button className="rounded-lg border px-3 py-1.5" onClick={() => disconnect(i.id)}>Disconnect</button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  শেষ Sync: {i.lastSyncAt ? new Date(i.lastSyncAt).toLocaleString() : "এখনো হয়নি"}
                  {i.lastError ? <span className="text-red-600"> · শেষ এরর: {i.lastError}</span> : null}
                </div>
                {i.provider === "woocommerce" ? <div className="mt-1 text-xs text-slate-400">Webhook URL (WP Admin এ বসান): <code>{`${publicApiBase()}/webhooks/woocommerce/${i.id}`}</code> · Topic: Order created/updated, Product created/updated</div> : null}
                {i.provider === "shopify" ? <div className="mt-1 text-xs text-slate-400">Webhook URL (Shopify Admin → Settings → Notifications → Webhooks): <code>{`${publicApiBase()}/webhooks/shopify/${i.id}`}</code> · Format: JSON · Event: Order creation, Order update, Product creation, Product update</div> : null}
                {(jobs[i.id] ?? []).map((j) => (
                  <div key={j.id} className="mt-1 text-xs text-slate-500">{j.kind}: {j.status} · fetched {j.fetched}, created {j.created}, updated {j.updated}{j.error ? ` · ${j.error}` : ""}</div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={createStore} className="space-y-3 card p-5">
        <div className="font-semibold">ধাপ ১: স্টোর যোগ করুন</div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-sm">প্ল্যাটফর্ম
            <select className={inputCls} value={storeForm.platform} onChange={(e) => setStoreForm({ ...storeForm, platform: e.target.value })}>
              <option value="WOOCOMMERCE">WooCommerce</option><option value="SHOPIFY">Shopify</option><option value="CUSTOM">Custom</option>
            </select>
          </label>
          <label className="block text-sm">স্টোরের নাম<input className={inputCls} value={storeForm.name} onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })} required /></label>
          <label className="block text-sm">স্টোরের URL<input className={inputCls} value={storeForm.url} onChange={(e) => setStoreForm({ ...storeForm, url: e.target.value })} required placeholder="https://yourstore.myshopify.com" /></label>
        </div>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>স্টোর যোগ করুন</button>
      </form>

      <div className="space-y-3 card p-5">
        <div className="font-semibold">💬 ওয়েবসাইট লাইভ চ্যাট</div>
        <p className="text-sm text-slate-500">নিজের ওয়েবসাইটে চ্যাট উইজেট বসান — ভিজিটরের বার্তা সরাসরি Inbox এ আসবে (চ্যানেল: webchat), এজেন্টের উত্তর উইজেটে পৌঁছে যাবে।</p>
        <form className="grid gap-2 sm:grid-cols-4" onSubmit={async (e) => {
          e.preventDefault();
          const orgId = getOrganizationId(); if (!orgId) return;
          try {
            await apiFetch(`/organizations/${orgId}/webchat/sites`, { method: "POST", body: JSON.stringify(wcForm) });
            setNotice("লাইভ চ্যাট সাইট তৈরি হয়েছে। নিচে Embed কোড পাবেন।");
            setWcForm({ name: "", domain: "", greeting: "আসসালামু আলাইকুম! কীভাবে সাহায্য করতে পারি?", color: "#6d28d9" });
            await load();
          } catch (err) { setError(err instanceof Error ? err.message : "তৈরি ব্যর্থ"); }
        }}>
          <input className="input" placeholder="সাইটের নাম" value={wcForm.name} onChange={(e) => setWcForm({ ...wcForm, name: e.target.value })} required />
          <input className="input" placeholder="ডোমেইন (ঐচ্ছিক)" value={wcForm.domain} onChange={(e) => setWcForm({ ...wcForm, domain: e.target.value })} />
          <input className="input" placeholder="শুভেচ্ছা বার্তা" value={wcForm.greeting} onChange={(e) => setWcForm({ ...wcForm, greeting: e.target.value })} />
          <span className="flex items-center gap-2"><input type="color" value={wcForm.color} onChange={(e) => setWcForm({ ...wcForm, color: e.target.value })} /><button className="btn-primary flex-1">সাইট তৈরি করুন</button></span>
        </form>
        {wcSites.map((site) => (
          <div key={site.id} className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{site.name} {site.domain ? <span className="text-slate-400">({site.domain})</span> : null}</span>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={site.enabled} onChange={async (e) => {
                const orgId = getOrganizationId(); if (!orgId) return;
                await apiFetch(`/organizations/${orgId}/webchat/sites/${site.id}`, { method: "PATCH", body: JSON.stringify({ enabled: e.target.checked }) }).catch(() => undefined);
                await load();
              }} /> চালু</label>
            </div>
            <p className="mt-1 text-xs text-slate-500">ওয়েবসাইটের &lt;/body&gt; এর আগে বসান:</p>
            <code className="mt-1 block overflow-x-auto whitespace-nowrap rounded bg-slate-900 p-2 text-[11px] text-green-300">{`<script src="${typeof window !== "undefined" ? window.location.origin : ""}/chat-widget.js" data-key="${site.widgetKey}" async></script>`}</code>
          </div>
        ))}
      </div>

      <form onSubmit={connect} className="space-y-3 card p-5">
        <div className="font-semibold">ধাপ ২: WooCommerce কানেক্ট করুন</div>
        <p className="text-sm text-slate-500">
          WordPress Admin → WooCommerce → Settings → Advanced → REST API → Add key (User: admin, Permissions: Read/Write)।
          সেখান থেকে Consumer Key ও Consumer Secret নিন। Webhook Secret ঐচ্ছিক এই ধাপে, তবে লাইভ অর্ডার আপডেটের জন্য Webhook তৈরি করে Secret বসাতে হবে।
        </p>
        <label className="block text-sm">স্টোর
          <select className={inputCls} value={connectForm.storeId} onChange={(e) => setConnectForm({ ...connectForm, storeId: e.target.value })} required>
            <option value="">নির্বাচন করুন</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.url})</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Consumer Key<input className={inputCls} value={connectForm.consumerKey} onChange={(e) => setConnectForm({ ...connectForm, consumerKey: e.target.value })} required placeholder="ck_..." /></label>
          <label className="block text-sm">Consumer Secret<input className={inputCls} type="password" value={connectForm.consumerSecret} onChange={(e) => setConnectForm({ ...connectForm, consumerSecret: e.target.value })} required placeholder="cs_..." /></label>
        </div>
        <label className="block text-sm">Webhook Secret (ঐচ্ছিক)<input className={inputCls} value={connectForm.webhookSecret} onChange={(e) => setConnectForm({ ...connectForm, webhookSecret: e.target.value })} /></label>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
          {busy === "connect" ? "কানেকশন যাচাই হচ্ছে..." : "যাচাই করে কানেক্ট করুন"}
        </button>
        <p className="text-xs text-slate-400">কানেক্ট বাটনে আগে আসল WooCommerce API দিয়ে যাচাই করা হয়। যাচাই ব্যর্থ হলে কোনো Secret সেভ হয় না।</p>
      </form>

      <form onSubmit={connectShopify} className="space-y-3 card p-5">
        <div className="font-semibold">ধাপ ২ (বিকল্প): Shopify কানেক্ট করুন</div>
        <p className="text-sm text-slate-500">
          Shopify Admin → Settings → Apps and sales channels → Develop apps → একটি Custom App তৈরি করুন,
          Admin API Scope দিন (read_products, read_orders) এবং Install করে Admin API Access Token (shpat_) নিন।
          একই App এর Client Secret টি Webhook যাচাইয়ের জন্য লাগে। দুটোই এনক্রিপ্ট করে রাখা হয়।
        </p>
        <label className="block text-sm">স্টোর (Shopify প্ল্যাটফর্মেরটি বেছে নিন)
          <select className={inputCls} value={shopifyForm.storeId} onChange={(e) => setShopifyForm({ ...shopifyForm, storeId: e.target.value })} required>
            <option value="">নির্বাচন করুন</option>
            {stores.map((st) => <option key={st.id} value={st.id}>{st.name} ({st.url})</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Admin API Access Token<input className={inputCls} type="password" value={shopifyForm.accessToken} onChange={(e) => setShopifyForm({ ...shopifyForm, accessToken: e.target.value })} required placeholder="shpat_..." /></label>
          <label className="block text-sm">App Client Secret<input className={inputCls} type="password" value={shopifyForm.apiSecret} onChange={(e) => setShopifyForm({ ...shopifyForm, apiSecret: e.target.value })} required placeholder="shpss_..." /></label>
        </div>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
          {busy === "shopify" ? "কানেকশন যাচাই হচ্ছে..." : "যাচাই করে Shopify কানেক্ট করুন"}
        </button>
        <p className="text-xs text-slate-400">আগে আসল Shop দিয়ে যাচাই করা হয়, ব্যর্থ হলে Token সেভ হয় না।</p>
      </form>

      {stores.length === 0 && integrations.length === 0 ? (
        <EmptyState title="প্রথমে একটি স্টোর যোগ করুন" description="WooCommerce বা Shopify স্টোর কানেক্ট হলে প্রোডাক্ট ও অর্ডার Sync করা যাবে।" />
      ) : null}
    </div>
  );
}
