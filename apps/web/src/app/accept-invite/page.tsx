"use client";
import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, getToken } from "@/lib/api";
import { fmtDate } from "@repo/contracts";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

interface InviteView {
  organizationName: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  emailMatchesAccount: boolean;
}

function AcceptInviteInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [view, setView] = useState<InviteView | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const loggedIn = typeof window !== "undefined" && Boolean(getToken());

  useEffect(() => {
    if (!token) { setError(t.invite.invalidLink); return; }
    try { sessionStorage.setItem("pending_invite_token", token); } catch { /* ignore */ }
    if (!getToken()) return;
    apiFetch<InviteView>(`/invitations/${encodeURIComponent(token)}`)
      .then(setView)
      .catch((e) => setError(e instanceof Error ? e.message : t.invite.loadFailed));
  }, [token]);

  async function accept() {
    setBusy(true); setError("");
    try {
      const out = await apiFetch<{ alreadyMember: boolean }>("/invitations/accept", {
        method: "POST", body: JSON.stringify({ token }),
      });
      setDone(out.alreadyMember ? t.invite.alreadyMember : t.invite.joined);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.invite.acceptFailed);
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="mb-2 text-xl font-bold">{t.invite.title}</h1>
        {error ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
        {done ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{done}</div>
            <a className="btn-primary block text-center" href="/dashboard">{t.invite.goDashboard}</a>
          </div>
        ) : !loggedIn ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {t.invite.loginIntroPrefix}<b>{t.invite.loginIntroBold}</b>{t.invite.loginIntroSuffix}
            </p>
            <a className="btn-primary block text-center" href="/login">{t.invite.loginButton}</a>
            <a className="btn-secondary block text-center" href="/register">{t.invite.registerButton}</a>
          </div>
        ) : !view ? (
          <p className="text-sm text-slate-500">{t.invite.verifying}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <b>{view.organizationName}</b>{t.invite.invitedPrefix}<b>{view.role}</b>{t.invite.invitedSuffix}
            </p>
            <p className="text-xs text-slate-500">
              {t.invite.invitedEmailLabel}{view.email}{t.invite.statusLabel}{view.status}{t.invite.expiryLabel}{fmtDate("bn", view.expiresAt)}
            </p>
            {!view.emailMatchesAccount ? (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                {t.invite.wrongEmailPrefix}<b>{view.email}</b>{t.invite.wrongEmailSuffix}
              </div>
            ) : view.status !== "pending" ? (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t.invite.notPendingPrefix}{view.status}{t.invite.notPendingSuffix}</div>
            ) : (
              <button className="btn-primary w-full" disabled={busy} onClick={accept}>{busy ? t.invite.pleaseWait : t.invite.acceptButton}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">{t.invite.loading}</div>}>

      <AcceptInviteInner />
    </Suspense>
  );
}
