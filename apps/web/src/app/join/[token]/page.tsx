"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, getToken } from "@/lib/api";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

/**
 * ORG10 (Organization Next OB3) — public join page for a
 * shareable invite link (ORG9). Following the link never makes
 * anyone a member: it files a join REQUEST that the
 * organization's OWNER/ADMIN approves or rejects from the Team
 * page queue. The public info endpoint answers uniformly (the
 * same 404) for unknown, revoked, expired and exhausted links,
 * so this page honestly cannot tell them apart either.
 */

interface LinkInfo { organizationId: string; organizationName: string; role: string; valid: boolean }
interface MyRequest {
  organizationId: string; organizationName: string; role: string; linkStatus: string;
  request: { id: string; status: string; message: string | null; rejectReason: string | null; createdAt: string; decidedAt: string | null } | null;
}

export default function JoinPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [mine, setMine] = useState<MyRequest | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const loggedIn = typeof window !== "undefined" && Boolean(getToken());

  const load = useCallback(async () => {
    if (!token) { setInvalid(true); return; }
    try { sessionStorage.setItem("pending_join_token", token); } catch { /* ignore */ }
    if (getToken()) {
      // Signed in: my own request state exists independently of
      // whether the link is still open.
      try {
        const mineOut = await apiFetch<MyRequest>(`/invitations/link/${encodeURIComponent(token)}/my-request`);
        setMine(mineOut);
        if (!mineOut.request) {
          apiFetch<LinkInfo>(`/invitations/link/${encodeURIComponent(token)}`)
            .then(setInfo)
            .catch(() => setInvalid(true));
        }
        return;
      } catch {
        // Unknown token — fall through to the public answer,
        // which is the same uniform 404.
      }
    }
    apiFetch<LinkInfo>(`/invitations/link/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch(() => setInvalid(true));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function submit() {
    setBusy(true); setError("");
    try {
      await apiFetch(`/invitations/link/${encodeURIComponent(token)}/request`, {
        method: "POST", body: JSON.stringify(message.trim() ? { message: message.trim() } : {}),
      });
      setMessage("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.join.submitFailed);
    } finally { setBusy(false); }
  }

  const myReq = mine?.request ?? null;
  const linkOpen = mine ? mine.linkStatus === "active" : Boolean(info);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="mb-2 text-xl font-bold">{t.join.title}</h1>
        {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
        {invalid ? (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {t.join.invalidLink}
          </div>
        ) : myReq?.status === "APPROVED" ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
              {t.join.approvedPrefix}<b>{mine?.organizationName}</b>{t.join.approvedSuffix}
            </div>
            <a className="btn-primary block text-center" href="/dashboard">{t.join.goDashboard}</a>
          </div>
        ) : myReq?.status === "PENDING" ? (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            {t.join.pendingPrefix}<b>{mine?.organizationName}</b>{t.join.pendingMid}<b>{t.join.pendingBold}</b>{t.join.pendingSuffix}
          </div>
        ) : !loggedIn ? (
          !info ? <p className="text-sm text-slate-500">{t.join.verifyingLink}</p> : (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                <b>{info.organizationName}</b>{t.join.invitedPrefix}<b>{info.role}</b>{t.join.invitedSuffix}
              </p>
              <p className="text-sm text-slate-600">
                {t.join.loginHelp}
              </p>
              <a className="btn-primary block text-center" href="/login">{t.join.loginButton}</a>
              <a className="btn-secondary block text-center" href="/register">{t.join.registerButton}</a>
            </div>
          )
        ) : !info && !mine ? (
          <p className="text-sm text-slate-500">{t.join.verifyingLink}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <b>{(info ?? mine)?.organizationName}</b>{t.join.requestPrefix}<b>{(info ?? mine)?.role}</b>{t.join.requestSuffix}
            </p>
            {myReq?.status === "REJECTED" ? (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {t.join.rejectedText}
                {myReq.rejectReason ? <>{t.join.rejectReasonPrefix}{myReq.rejectReason}</> : null}
                {linkOpen ? t.join.rejectedAgainOpen : t.join.rejectedLinkClosed}
              </div>
            ) : null}
            {linkOpen ? (
              <>
                <textarea
                  className="input w-full"
                  rows={3}
                  maxLength={500}
                  placeholder={t.join.messagePlaceholder}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <button className="btn-primary w-full" disabled={busy} onClick={submit}>
                  {busy ? t.join.pleaseWait : t.join.sendRequest}
                </button>
              </>
            ) : myReq?.status !== "REJECTED" ? (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t.join.linkClosed}</div>

            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
