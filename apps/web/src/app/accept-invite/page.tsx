"use client";
import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, getToken } from "@/lib/api";

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
    if (!token) { setError("আমন্ত্রণ লিংকটি সঠিক নয় (টোকেন নেই)।"); return; }
    try { sessionStorage.setItem("pending_invite_token", token); } catch { /* ignore */ }
    if (!getToken()) return;
    apiFetch<InviteView>(`/invitations/${encodeURIComponent(token)}`)
      .then(setView)
      .catch((e) => setError(e instanceof Error ? e.message : "আমন্ত্রণ লোড করা যায়নি"));
  }, [token]);

  async function accept() {
    setBusy(true); setError("");
    try {
      const out = await apiFetch<{ alreadyMember: boolean }>("/invitations/accept", {
        method: "POST", body: JSON.stringify({ token }),
      });
      setDone(out.alreadyMember ? "আপনি ইতিমধ্যে এই প্রতিষ্ঠানের সদস্য।" : "অভিনন্দন! আপনি টিমে যোগ দিয়েছেন।");
    } catch (e) {
      setError(e instanceof Error ? e.message : "গ্রহণ করা যায়নি");
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="mb-2 text-xl font-bold">টিমে যোগ দিন</h1>
        {error ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
        {done ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{done}</div>
            <a className="btn-primary block text-center" href="/dashboard">ড্যাশবোর্ডে যান</a>
          </div>
        ) : !loggedIn ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              আমন্ত্রণ গ্রহণ করতে প্রথমে <b>আমন্ত্রিত ইমেইল দিয়ে</b> লগইন করুন — অ্যাকাউন্ট না থাকলে রেজিস্টার করুন।
              এরপর এই একই লিংক আবার খুললেই যোগ দিতে পারবেন।
            </p>
            <a className="btn-primary block text-center" href="/login">লগইন করুন</a>
            <a className="btn-secondary block text-center" href="/register">নতুন অ্যাকাউন্ট (রেজিস্টার)</a>
          </div>
        ) : !view ? (
          <p className="text-sm text-slate-500">আমন্ত্রণ যাচাই হচ্ছে…</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <b>{view.organizationName}</b> আপনাকে <b>{view.role}</b> ভূমিকায় টিমে আমন্ত্রণ জানিয়েছে।
            </p>
            <p className="text-xs text-slate-500">
              আমন্ত্রিত ইমেইল: {view.email} · অবস্থা: {view.status} · মেয়াদ: {new Date(view.expiresAt).toLocaleDateString("bn-BD")}
            </p>
            {!view.emailMatchesAccount ? (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                আপনি অন্য ইমেইল দিয়ে লগইন করেছেন। আমন্ত্রণ গ্রহণ করতে <b>{view.email}</b> দিয়ে লগইন করুন।
              </div>
            ) : view.status !== "pending" ? (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">এই আমন্ত্রণটি এখন {view.status} অবস্থায় আছে — গ্রহণ করা যাবে না।</div>
            ) : (
              <button className="btn-primary w-full" disabled={busy} onClick={accept}>{busy ? "অপেক্ষা করুন…" : "আমন্ত্রণ গ্রহণ করুন"}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">লোড হচ্ছে…</div>}>
      <AcceptInviteInner />
    </Suspense>
  );
}
