"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  campaignCounts, isShopRelativeUrl, pushCampaignStatusLabel, shortenPublicKey,
  urlBase64ToUint8Array, type PushCampaign, type PushSetting,
} from "@/lib/ab7";

// AB7 (AX16) — ওয়েব পুশ: settings + composer + campaign history
// for the storefront settings area. Consumes:
//   GET  organizations/:orgId/push/setting
//   PUT  organizations/:orgId/push/setting { enabled?, promptDelaySec? }
//   POST organizations/:orgId/push/test-device { endpoint, keys }
//   POST organizations/:orgId/push/test-send { title, body, url? }
//   POST organizations/:orgId/push/campaigns { title, body, url? }
//   GET  organizations/:orgId/push/campaigns (+ /:id detail)
// HONEST counts: a "sent" count means the push service ACCEPTED
// the message — this UI never claims a notification was read or
// opened (web push has no such signal here).

const TITLE_MAX = 80;
const BODY_MAX = 240;

export function PushPanel() {
  const [setting, setSetting] = useState<PushSetting | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [promptDelaySec, setPromptDelaySec] = useState("30");
  const [campaigns, setCampaigns] = useState<PushCampaign[]>([]);
  const [detail, setDetail] = useState<PushCampaign | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadSetting = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const s = await apiFetch<PushSetting>(`/organizations/${orgId}/push/setting`);
      setSetting(s);
      setEnabled(!!s.enabled);
      setPromptDelaySec(String(s.promptDelaySec ?? 30));
    } catch { /* card keeps defaults until the endpoint answers */ }
  }, []);
  useEffect(() => { void loadSetting(); }, [loadSetting]);

  const loadCampaigns = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const out = await apiFetch<PushCampaign[] | { items?: PushCampaign[]; campaigns?: PushCampaign[] }>(
        `/organizations/${orgId}/push/campaigns`,
      );
      const rows = Array.isArray(out) ? out : (out.items ?? out.campaigns ?? []);
      setCampaigns(rows);
    } catch { /* history stays empty until the endpoint answers */ }
  }, []);
  useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);

  async function saveSetting() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const delay = parseInt(promptDelaySec || "0", 10);
    if (!Number.isInteger(delay) || delay < 0) { setError("প্রম্পট দেখানোর দেরি সেকেন্ডে সঠিক সংখ্যা দিন (০ বা বেশি)।"); return; }
    setBusy("setting"); setError(""); setNotice("");
    try {
      const s = await apiFetch<PushSetting>(`/organizations/${orgId}/push/setting`, {
        method: "PUT",
        body: JSON.stringify({ enabled, promptDelaySec: delay }),
      });
      setSetting(s);
      setNotice("ওয়েব পুশ সেটিংস সংরক্ষণ হয়েছে।");
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function addTestDevice() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setNotice("");
    if (!setting?.vapidPublicKey) {
      setError("এখনো পাবলিক কী তৈরি হয়নি — আগে সেটিংস সংরক্ষণ করুন, কী তৈরি হলে আবার চেষ্টা করুন।");
      return;
    }
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setError("এই ব্রাউজার ওয়েব পুশ সমর্থন করে না — অন্য ব্রাউজারে চেষ্টা করুন।");
      return;
    }
    setBusy("test-device");
    try {
      // Shop push service worker: registered from the shop origin
      // path so subscriptions belong to the shop surface.
      const registration = await navigator.serviceWorker.register("/shop-push-sw", { scope: "/shop/" });
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(setting.vapidPublicKey) as BufferSource,
        });
      }
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("ব্রাউজার সম্পূর্ণ সাবস্ক্রিপশন দেয়নি — আবার চেষ্টা করুন।");
      }
      await apiFetch(`/organizations/${orgId}/push/test-device`, {
        method: "POST",
        body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
      });
      setNotice("এই ব্রাউজার টেস্ট ডিভাইস হিসেবে যোগ হয়েছে। এখন টেস্ট পাঠিয়ে দেখুন।");
      await loadSetting();
    } catch (e) { setError(e instanceof Error ? e.message : "টেস্ট ডিভাইস যোগ করা যায়নি"); }
    finally { setBusy(""); }
  }

  function composerBody(): { title: string; body: string; url?: string } | null {
    if (!title.trim()) { setError("নোটিফিকেশনের শিরোনাম দিন।"); return null; }
    if (!body.trim()) { setError("নোটিফিকেশনের লেখা দিন।"); return null; }
    if (!isShopRelativeUrl(url)) {
      setError("লিংক শুধু দোকানের ভেতরের ঠিকানা হতে পারে (যেমন: /shop/আপনার-দোকান/product) — বাইরের পূর্ণ URL নয়।");
      return null;
    }
    const u = url.trim();
    return { title: title.trim(), body: body.trim(), ...(u ? { url: u } : {}) };
  }

  async function testSend() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const payload = composerBody(); if (!payload) return;
    setBusy("test-send"); setError(""); setNotice("");
    try {
      await apiFetch<PushCampaign>(`/organizations/${orgId}/push/test-send`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNotice("টেস্ট পুশ পাঠানো হয়েছে — টেস্ট ডিভাইসে নোটিফিকেশন পৌঁছেছে কিনা দেখুন।");
      await loadCampaigns();
    } catch (e) { setError(e instanceof Error ? e.message : "টেস্ট পাঠানো ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function broadcast() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const payload = composerBody(); if (!payload) return;
    if (!window.confirm(`এই নোটিফিকেশন সব সাবস্ক্রাইবারের (${setting?.subscriberCount ?? 0}জন) কাছে পাঠাবেন?`)) return;
    setBusy("broadcast"); setError(""); setNotice("");
    try {
      await apiFetch<PushCampaign>(`/organizations/${orgId}/push/campaigns`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNotice("ক্যাম্পেইন তৈরি হয়ে সব সাবস্ক্রাইবারকে পাঠানো শুরু হয়েছে — নিচের ইতিহাসে অগ্রগতি দেখুন।");
      await loadCampaigns();
    } catch (e) { setError(e instanceof Error ? e.message : "ক্যাম্পেইন পাঠানো ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function showDetail(c: PushCampaign) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`detail-${c.id}`); setError("");
    try {
      const out = await apiFetch<PushCampaign>(`/organizations/${orgId}/push/campaigns/${encodeURIComponent(c.id)}`);
      setDetail(out);
    } catch (e) { setError(e instanceof Error ? e.message : "বিস্তারিত লোড ব্যর্থ"); }
    finally { setBusy(""); }
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <div className="font-semibold">🔔 ওয়েব পুশ</div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          দোকানের ভিজিটর ব্রাউজারে অনুমতি দিলে সাবস্ক্রাইবার হন — তাদের সরাসরি ব্রাউজার নোটিফিকেশন পাঠাতে পারবেন।
          পাবলিক কী সার্ভারেই তৈরি হয়; এখানে শুধু দেখানো হয়।
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          অবস্থা: <b>{setting ? (setting.enabled ? "চালু" : "বন্ধ") : "…"}</b>
          {" "}· সাবস্ক্রাইবার: <b>{setting?.subscriberCount ?? 0}</b>জন
          {" "}· টেস্ট ডিভাইস: <b>{setting?.testDeviceCount ?? 0}</b>টি
          {" "}· পাবলিক কী: <span className="font-mono">{setting?.hasKeys ? shortenPublicKey(setting.vapidPublicKey) : "এখনো তৈরি হয়নি"}</span>
        </p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          ওয়েব পুশ চালু করুন
        </label>
        <label className="block text-sm">অনুমতি প্রম্পট দেখানোর দেরি (সেকেন্ড)
          <input className="input mt-1" type="number" min="0" value={promptDelaySec} onChange={(e) => setPromptDelaySec(e.target.value)} />
        </label>
      </div>
      <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={() => void saveSetting()}>
        {busy === "setting" ? "সংরক্ষণ হচ্ছে…" : "পুশ সেটিংস সংরক্ষণ করুন"}
      </button>

      <div className="space-y-3 border-t pt-4">
        <div className="font-semibold">নোটিফিকেশন পাঠান</div>
        <label className="block text-sm">শিরোনাম ({title.length}/{TITLE_MAX})
          <input className="input mt-1" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="যেমন: ঈদ অফার চলছে!" />
        </label>
        <label className="block text-sm">লেখা ({body.length}/{BODY_MAX})
          <textarea className="input mt-1" rows={2} maxLength={BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} placeholder="অফারের সংক্ষিপ্ত বর্ণনা…" />
        </label>
        <label className="block text-sm">লিংক (ঐচ্ছিক — শুধু দোকানের ভেতরের ঠিকানা, যেমন /shop/…)
          <input className="input mt-1 font-mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/shop/…" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => void addTestDevice()}>
            {busy === "test-device" ? "যোগ হচ্ছে…" : "এই ব্রাউজারকে টেস্ট ডিভাইস হিসেবে যোগ করুন"}
          </button>
          <button type="button" className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => void testSend()}>
            {busy === "test-send" ? "পাঠানো হচ্ছে…" : "টেস্ট পাঠান"}
          </button>
          <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={() => void broadcast()}>
            {busy === "broadcast" ? "পাঠানো হচ্ছে…" : "সব সাবস্ক্রাইবারকে পাঠান"}
          </button>
        </div>
      </div>

      <div className="space-y-3 border-t pt-4">
        <div className="font-semibold">ক্যাম্পেইনের ইতিহাস</div>
        <p className="text-xs text-slate-500">
          "পাঠানো হয়েছে" সংখ্যা মানে পুশ সার্ভিস বার্তাটি গ্রহণ করেছে — নোটিফিকেশন পড়া হয়েছে বা খোলা হয়েছে
          এমন কোনো তথ্য ওয়েব পুশে পাওয়া যায় না, তাই এখানে সেটা দাবি করা হয় না।
        </p>
        {campaigns.length === 0 ? (
          <p className="text-sm text-slate-500">এখনো কোনো পুশ ক্যাম্পেইন পাঠানো হয়নি।</p>
        ) : (
          <ul className="divide-y">
            {campaigns.map((c) => {
              const counts = campaignCounts(c);
              return (
                <li key={c.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-sm font-bold text-slate-800">{c.title}</span>
                      <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {pushCampaignStatusLabel(c.status)}
                      </span>
                      {c.createdAt ? (
                        <span className="ml-2 text-[11px] text-slate-400">{new Date(c.createdAt).toLocaleString("bn-BD")}</span>
                      ) : null}
                      <p className="mt-0.5 truncate text-xs text-slate-500">{c.body}</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold disabled:opacity-50"
                      disabled={busy !== ""}
                      onClick={() => void showDetail(c)}
                    >
                      {busy === `detail-${c.id}` ? "লোড হচ্ছে…" : "বিস্তারিত"}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    পুশ সার্ভিস গ্রহণ করেছে: <b>{counts.sent}</b>টি · ব্যর্থ: <b>{counts.failed}</b>টি · সাবস্ক্রিপশন শেষ (gone): <b>{counts.gone}</b>টি
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {detail ? (
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="font-semibold">বিস্তারিত — {detail.title}</div>
            {(() => {
              const counts = campaignCounts(detail);
              return (
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  অবস্থা: {pushCampaignStatusLabel(detail.status)} · পুশ সার্ভিস গ্রহণ করেছে: {counts.sent}টি ·
                  ব্যর্থ: {counts.failed}টি · সাবস্ক্রিপশন শেষ (gone): {counts.gone}টি
                  {detail.url ? <> · লিংক: <span className="font-mono">{detail.url}</span></> : null}
                </p>
              );
            })()}
          </div>
        ) : null}
      </div>
    </section>
  );
}
