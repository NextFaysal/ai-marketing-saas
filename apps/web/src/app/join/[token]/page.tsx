"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, getToken } from "@/lib/api";

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
      setError(e instanceof Error ? e.message : "অনুরোধ পাঠানো যায়নি");
    } finally { setBusy(false); }
  }

  const myReq = mine?.request ?? null;
  const linkOpen = mine ? mine.linkStatus === "active" : Boolean(info);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="mb-2 text-xl font-bold">টিমে যোগ দিন</h1>
        {error ? <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
        {invalid ? (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            এই লিংকটি সঠিক নয় অথবা আর সক্রিয় নেই। প্রতিষ্ঠানের OWNER/ADMIN এর কাছ থেকে নতুন লিংক নিন।
          </div>
        ) : myReq?.status === "APPROVED" ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
              অভিনন্দন! আপনার অনুরোধ অনুমোদিত হয়েছে — আপনি এখন <b>{mine?.organizationName}</b> এর সদস্য।
            </div>
            <a className="btn-primary block text-center" href="/dashboard">ড্যাশবোর্ডে যান</a>
          </div>
        ) : myReq?.status === "PENDING" ? (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            ⏳ আপনার যোগদানের অনুরোধ <b>{mine?.organizationName}</b> এর কাছে <b>অপেক্ষমাণ</b> আছে।
            OWNER/ADMIN অনুমোদন করলেই আপনি সদস্য হয়ে যাবেন — এই একই লিংক আবার খুললে অবস্থা দেখতে পাবেন।
          </div>
        ) : !loggedIn ? (
          !info ? <p className="text-sm text-slate-500">লিংক যাচাই হচ্ছে…</p> : (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                <b>{info.organizationName}</b> আপনাকে <b>{info.role}</b> ভূমিকায় টিমে যোগ দেওয়ার জন্য আমন্ত্রণ জানিয়েছে।
              </p>
              <p className="text-sm text-slate-600">
                অনুরোধ পাঠাতে প্রথমে লগইন করুন — অ্যাকাউন্ট না থাকলে রেজিস্টার করুন। তারপর এই একই লিংক আবার খুললেই অনুরোধ পাঠাতে পারবেন।
                আপনার অনুরোধ প্রতিষ্ঠানের OWNER/ADMIN অনুমোদন করার পরই আপনি সদস্য হবেন।
              </p>
              <a className="btn-primary block text-center" href="/login">লগইন করুন</a>
              <a className="btn-secondary block text-center" href="/register">নতুন অ্যাকাউন্ট (রেজিস্টার)</a>
            </div>
          )
        ) : !info && !mine ? (
          <p className="text-sm text-slate-500">লিংক যাচাই হচ্ছে…</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              <b>{(info ?? mine)?.organizationName}</b> এ <b>{(info ?? mine)?.role}</b> ভূমিকায় যোগ দিতে অনুরোধ পাঠান।
              অনুমোদনের পরই আপনি সদস্য হবেন।
            </p>
            {myReq?.status === "REJECTED" ? (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                আপনার আগের অনুরোধটি ফিরিয়ে দেওয়া হয়েছে।
                {myReq.rejectReason ? <> কারণ: {myReq.rejectReason}</> : null}
                {linkOpen ? " চাইলে আবার অনুরোধ পাঠাতে পারেন।" : " এই লিংকটি এখন আর সক্রিয় নেই।"}
              </div>
            ) : null}
            {linkOpen ? (
              <>
                <textarea
                  className="input w-full"
                  rows={3}
                  maxLength={500}
                  placeholder="চাইলে একটি ছোট বার্তা লিখুন (যেমন: আপনি কোন কাজে যোগ দিতে চান) — ঐচ্ছিক"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <button className="btn-primary w-full" disabled={busy} onClick={submit}>
                  {busy ? "অপেক্ষা করুন…" : "যোগদানের অনুরোধ পাঠান"}
                </button>
              </>
            ) : myReq?.status !== "REJECTED" ? (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">এই লিংকটি এখন আর নতুন অনুরোধ নিচ্ছে না।</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
