"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  campaignCounts, isShopRelativeUrl, pushCampaignStatusLabel, shortenPublicKey,
  urlBase64ToUint8Array, type PushCampaign, type PushSetting,
} from "@/lib/ab7";
import { useLocale } from "@/lib/i18n/provider";
import { fmtDateTime, fmtNumber } from "@repo/contracts";

// AB7 (AX16) — web push: settings + composer + campaign history
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
  const { t, locale } = useLocale();
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
    if (!Number.isInteger(delay) || delay < 0) { setError(t("messaging.pushDelayError")); return; }
    setBusy("setting"); setError(""); setNotice("");
    try {
      const s = await apiFetch<PushSetting>(`/organizations/${orgId}/push/setting`, {
        method: "PUT",
        body: JSON.stringify({ enabled, promptDelaySec: delay }),
      });
      setSetting(s);
      setNotice(t("messaging.pushSettingsSaved"));
    } catch (e) { setError(e instanceof Error ? e.message : t("messaging.pushSaveFailed")); }
    finally { setBusy(""); }
  }

  async function addTestDevice() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setNotice("");
    if (!setting?.vapidPublicKey) {
      setError(t("messaging.pushNoKeyError"));
      return;
    }
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setError(t("messaging.pushUnsupported"));
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
        throw new Error(t("messaging.pushIncompleteSub"));
      }
      await apiFetch(`/organizations/${orgId}/push/test-device`, {
        method: "POST",
        body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
      });
      setNotice(t("messaging.pushTestDeviceAdded"));
      await loadSetting();
    } catch (e) { setError(e instanceof Error ? e.message : t("messaging.pushTestDeviceFailed")); }
    finally { setBusy(""); }
  }

  function composerBody(): { title: string; body: string; url?: string } | null {
    if (!title.trim()) { setError(t("messaging.pushTitleRequired")); return null; }
    if (!body.trim()) { setError(t("messaging.pushBodyRequired")); return null; }
    if (!isShopRelativeUrl(url)) {
      setError(t("messaging.pushLinkError"));
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
      setNotice(t("messaging.pushTestSent"));
      await loadCampaigns();
    } catch (e) { setError(e instanceof Error ? e.message : t("messaging.pushTestFailed")); }
    finally { setBusy(""); }
  }

  async function broadcast() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const payload = composerBody(); if (!payload) return;
    if (!window.confirm(t("messaging.pushConfirmBroadcast", { count: fmtNumber(locale, setting?.subscriberCount ?? 0) }))) return;
    setBusy("broadcast"); setError(""); setNotice("");
    try {
      await apiFetch<PushCampaign>(`/organizations/${orgId}/push/campaigns`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNotice(t("messaging.pushCampaignStarted"));
      await loadCampaigns();
    } catch (e) { setError(e instanceof Error ? e.message : t("messaging.pushCampaignFailed")); }
    finally { setBusy(""); }
  }

  async function showDetail(c: PushCampaign) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`detail-${c.id}`); setError("");
    try {
      const out = await apiFetch<PushCampaign>(`/organizations/${orgId}/push/campaigns/${encodeURIComponent(c.id)}`);
      setDetail(out);
    } catch (e) { setError(e instanceof Error ? e.message : t("messaging.pushDetailLoadFailed")); }
    finally { setBusy(""); }
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <div className="font-semibold">{t("messaging.pushTitle")}</div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
{t("messaging.pushIntro")}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          {t("messaging.pushStatusLabel")}: <b>{setting ? (setting.enabled ? t("messaging.pushOn") : t("messaging.pushOff")) : "…"}</b>
          {" "}· {t("messaging.pushSubscribers")}: <b>{fmtNumber(locale, setting?.subscriberCount ?? 0)}</b>{t("messaging.pushSubscriberSuffix")}
          {" "}· {t("messaging.pushTestDevices")}: <b>{fmtNumber(locale, setting?.testDeviceCount ?? 0)}</b>{t("messaging.pushDeviceSuffix")}
          {" "}· {t("messaging.pushPublicKey")}: <span className="font-mono">{setting?.hasKeys ? shortenPublicKey(setting.vapidPublicKey) : t("messaging.pushKeyNotCreated")}</span>
        </p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t("messaging.pushEnable")}
        </label>
        <label className="block text-sm">{t("messaging.pushDelayLabel")}
          <input className="input mt-1" type="number" min="0" value={promptDelaySec} onChange={(e) => setPromptDelaySec(e.target.value)} />
        </label>
      </div>
      <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={() => void saveSetting()}>
        {busy === "setting" ? t("messaging.pushSaving") : t("messaging.pushSaveSettings")}
      </button>

      <div className="space-y-3 border-t pt-4">
        <div className="font-semibold">{t("messaging.pushSendTitle")}</div>
        <label className="block text-sm">{t("messaging.pushNotifTitleLabel")} ({title.length}/{TITLE_MAX})
          <input className="input mt-1" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("messaging.pushNotifTitlePlaceholder")} />
        </label>
        <label className="block text-sm">{t("messaging.pushNotifBodyLabel")} ({body.length}/{BODY_MAX})
          <textarea className="input mt-1" rows={2} maxLength={BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("messaging.pushNotifBodyPlaceholder")} />
        </label>
        <label className="block text-sm">{t("messaging.pushLinkLabel")}
          <input className="input mt-1 font-mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/shop/…" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => void addTestDevice()}>
            {busy === "test-device" ? t("messaging.pushAdding") : t("messaging.pushAddTestDevice")}
          </button>
          <button type="button" className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => void testSend()}>
            {busy === "test-send" ? t("messaging.pushSending") : t("messaging.pushTestSend")}
          </button>
          <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={() => void broadcast()}>
            {busy === "broadcast" ? t("messaging.pushSending") : t("messaging.pushBroadcast")}
          </button>
        </div>
      </div>

      <div className="space-y-3 border-t pt-4">
        <div className="font-semibold">{t("messaging.pushHistoryTitle")}</div>
        <p className="text-xs text-slate-500">
{t("messaging.pushHistoryNote")}
        </p>
        {campaigns.length === 0 ? (
          <p className="text-sm text-slate-500">{t("messaging.pushHistoryEmpty")}</p>
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
                        {pushCampaignStatusLabel(c.status, locale)}
                      </span>
                      {c.createdAt ? (
                        <span className="ml-2 text-[11px] text-slate-400">{fmtDateTime(locale, c.createdAt)}</span>
                      ) : null}
                      <p className="mt-0.5 truncate text-xs text-slate-500">{c.body}</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold disabled:opacity-50"
                      disabled={busy !== ""}
                      onClick={() => void showDetail(c)}
                    >
                      {busy === `detail-${c.id}` ? t("messaging.pushLoading") : t("messaging.pushDetail")}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {t("messaging.pushAcceptedLine", { sent: fmtNumber(locale, counts.sent), failed: fmtNumber(locale, counts.failed), gone: fmtNumber(locale, counts.gone) })}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {detail ? (
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="font-semibold">{t("messaging.pushDetailTitle")} — {detail.title}</div>
            {(() => {
              const counts = campaignCounts(detail);
              return (
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  {t("messaging.pushDetailLine", { status: pushCampaignStatusLabel(detail.status, locale), sent: fmtNumber(locale, counts.sent), failed: fmtNumber(locale, counts.failed), gone: fmtNumber(locale, counts.gone) })}
                  {detail.url ? <> · {t("messaging.pushLinkWord")}: <span className="font-mono">{detail.url}</span></> : null}
                </p>
              );
            })()}
          </div>
        ) : null}
      </div>
    </section>
  );
}
