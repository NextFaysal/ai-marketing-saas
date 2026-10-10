"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface TotpStatus { totpEnabled: boolean; enrolmentInProgress: boolean }

export default function SettingsPage() {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await apiFetch<TotpStatus>("/auth/totp/status")); }
    catch (e) { setError(e instanceof Error ? e.message : "লোড করা যায়নি"); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function enroll() {
    setBusy(true); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ secret: string; otpauthUrl: string }>("/auth/totp/enroll", { method: "POST" });
      setSecret(out.secret);
      setOtpauthUrl(out.otpauthUrl);
      setNotice("Secret তৈরি হয়েছে — Authenticator অ্যাপে যোগ করে নিচে কোড দিয়ে নিশ্চিত করুন। নিশ্চিত না করা পর্যন্ত 2FA চালু হবে না।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "শুরু করা যায়নি"); }
    finally { setBusy(false); }
  }

  async function confirm() {
    const code = (document.getElementById("totp-code") as HTMLInputElement)?.value ?? "";
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch("/auth/totp/confirm", { method: "POST", body: JSON.stringify({ code }) });
      setSecret(""); setOtpauthUrl("");
      setNotice("✅ দ্বি-স্তর নিরাপত্তা (2FA) চালু হয়েছে। এখন থেকে লগইনে পাসওয়ার্ডের পর Authenticator কোড লাগবে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "কোড মেলেনি"); }
    finally { setBusy(false); }
  }

  async function disable() {
    const code = (document.getElementById("totp-disable-code") as HTMLInputElement)?.value ?? "";
    setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch("/auth/totp/disable", { method: "POST", body: JSON.stringify({ code }) });
      setNotice("2FA বন্ধ করা হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "বন্ধ করা যায়নি"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <h1 className="page-title">Organization Settings</h1>
      {error ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div> : null}

      <div className="card p-5">
        <h2 className="mb-1 font-semibold">🔐 আমার অ্যাকাউন্টের নিরাপত্তা — দ্বি-স্তর যাচাই (2FA)</h2>
        <p className="mb-3 max-w-2xl text-sm text-slate-500">
          চালু করলে লগইনে পাসওয়ার্ডের পর ফোনের Authenticator অ্যাপের ৬ সংখ্যার কোড লাগবে।
          অবস্থা: {status === null ? "লোড হচ্ছে…" : status.totpEnabled
            ? <b className="text-emerald-600">চালু আছে</b>
            : <b className="text-slate-600">বন্ধ{status.enrolmentInProgress ? " (Enrol শুরু হয়েছে, নিশ্চিত করা বাকি)" : ""}</b>}
        </p>

        {status && !status.totpEnabled ? (
          <div className="space-y-3">
            {!secret ? (
              <button className="btn-primary" disabled={busy} onClick={enroll}>{busy ? "অপেক্ষা করুন…" : "2FA চালু করা শুরু করুন"}</button>
            ) : (
              <div className="space-y-3 rounded-xl bg-slate-50 p-4">
                <div>
                  <div className="text-xs font-medium text-slate-500">Secret Key (একবারই দেখানো হয় — নিরাপদে রাখুন)</div>
                  <code className="mt-1 block break-all rounded bg-white p-2 text-sm ring-1 ring-slate-200">{secret}</code>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-500">otpauth URL (কিছু অ্যাপে সরাসরি ব্যবহার করা যায়)</div>
                  <code className="mt-1 block break-all rounded bg-white p-2 text-xs ring-1 ring-slate-200">{otpauthUrl}</code>
                </div>
                <p className="text-sm text-slate-600">Authenticator অ্যাপে <b>“Enter a setup key”</b> দিয়ে Secret টি যোগ করুন, তারপর অ্যাপের বর্তমান কোডটি দিন:</p>
                <div className="flex flex-wrap gap-2">
                  <input id="totp-code" inputMode="numeric" className="input w-44 tracking-[0.3em]" placeholder="123456" maxLength={6} />
                  <button className="btn-primary" disabled={busy} onClick={confirm}>কোড নিশ্চিত করুন</button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {status?.totpEnabled ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm text-slate-600">বন্ধ করতে বর্তমান কোড দিন
              <input id="totp-disable-code" inputMode="numeric" className="input mt-1 w-44 tracking-[0.3em]" placeholder="123456" maxLength={6} />
            </label>
            <button className="btn-secondary" disabled={busy} onClick={disable}>2FA বন্ধ করুন</button>
          </div>
        ) : null}

        <p className="mt-4 text-xs text-slate-400">
          ফোন/Secret হারালে প্রতিষ্ঠানের OWNER Team পেজ থেকে আপনার 2FA রিসেট করে দিতে পারবেন — তারপর এখানে আবার চালু করুন।
        </p>
      </div>
    </div>
  );
}
