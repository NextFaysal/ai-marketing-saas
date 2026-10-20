"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { googleErrorMessage } from "@/lib/google-auth";
import { loginSchema } from "@repo/contracts";

const HIGHLIGHTS = [
  { title: "Omnichannel Competitor Spy", text: "Meta, Google ও TikTok-এ প্রতিদ্বন্দীর Winning বিজ্ঞাপন ও স্টকআউট লাইভ ট্র্যাক।" },
  { title: "Unified Inbox ও ভেরিফাইড AI", text: "Facebook, WhatsApp ও Instagram চ্যাট এক ইনবক্সে; আসল ডাটাবেজ থেকে নির্ভুল উত্তর।" },
  { title: "COD Fraud Shield ও কুরিয়ার অটোমেশন", text: "ডেলিভারি হিস্ট্রি থেকে রিটার্ন রিস্ক স্কোরিং এবং Steadfast/Pathao-এ ১-ক্লিকে বাল্ক বুকিং।" },
];

interface LoginResponse { accessToken?: string; requiresTotp?: boolean; challengeToken?: string }

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Milestone 35: two-factor challenge step. The API verifies the
  // password first and only then asks for the authenticator code;
  // no access token exists until the code checks out.
  const [challengeToken, setChallengeToken] = useState("");
  const [code, setCode] = useState("");
  // AB8 (AX26): Google SSO. The button exists only when the API
  // says the platform Google OAuth config is enabled — otherwise
  // nothing renders (no dead button).
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    // A failed Google login lands back here with ?googleError=<code>:
    // show the mapped Bengali message once, then strip the param so a
    // refresh doesn't repeat it.
    const params = new URLSearchParams(window.location.search);
    const googleMsg = googleErrorMessage(params.get("googleError"));
    if (params.has("googleError")) {
      if (googleMsg) setError(googleMsg);
      params.delete("googleError");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
    let cancelled = false;
    apiFetch<{ enabled: boolean }>("/auth/google/config")
      .then((cfg) => { if (!cancelled) setGoogleEnabled(cfg.enabled === true); })
      .catch(() => { /* not configured / unreachable — button stays hidden */ });
    return () => { cancelled = true; };
  }, []);

  async function onGoogleLogin() {
    setError("");
    setGoogleBusy(true);
    try {
      const data = await apiFetch<{ url: string }>("/auth/google/start");
      if (!data.url) throw new Error("Google লগইন ব্যর্থ হয়েছে — আবার চেষ্টা করুন");
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google লগইন ব্যর্থ হয়েছে — আবার চেষ্টা করুন");
      setGoogleBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) { setError("সঠিক ইমেইল ও পাসওয়ার্ড দিন"); return; }
    setLoading(true);
    try {
      const data = await apiFetch<LoginResponse>("/auth/login", { method: "POST", body: JSON.stringify(parsed.data) });
      if (data.requiresTotp && data.challengeToken) {
        setChallengeToken(data.challengeToken);
        return;
      }
      if (!data.accessToken) throw new Error("Login failed");
      localStorage.setItem("accessToken", data.accessToken);
      router.push("/dashboard");
    } catch (err) { setError(err instanceof Error ? err.message : "Login failed"); }
    finally { setLoading(false); }
  }

  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await apiFetch<{ accessToken: string }>("/auth/totp/verify", {
        method: "POST", body: JSON.stringify({ challengeToken, code }),
      });
      localStorage.setItem("accessToken", data.accessToken);
      router.push("/dashboard");
    } catch (err) { setError(err instanceof Error ? err.message : "কোড যাচাই করা যায়নি"); }
    finally { setLoading(false); }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-ink-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-fuchsia-600/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-lg font-black text-white shadow-glow">Q</span>
          <div>
            <div className="text-lg font-bold tracking-tight text-white">AI Marketing OS</div>
            <div className="text-xs text-slate-400">by Qosprey</div>
          </div>
        </div>
        <div className="relative space-y-8">
          <h2 className="max-w-md text-4xl font-bold leading-[1.15] tracking-tight text-white">আপনার পুরো মার্কেটিং, <span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">একটা OS এ।</span></h2>
          <div className="space-y-5">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="flex gap-3.5">
                <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-[11px] text-emerald-300 ring-1 ring-inset ring-emerald-300/30">✓</span>
                <div>
                  <div className="font-semibold text-white">{h.title}</div>
                  <div className="text-sm text-slate-400">{h.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-xs text-slate-500">© 2026 Qosprey · Bangladesh থেকে, বিশ্বের জন্য</div>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[420px] animate-rise">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-base font-black text-white">Q</span>
            <div className="text-lg font-bold tracking-tight">AI Marketing OS</div>
          </div>
          <h1 className="page-title">লগইন করুন</h1>
          <p className="page-sub mt-1">আপনার মার্কেটিং ড্যাশবোর্ডে স্বাগতম</p>
          {challengeToken ? (
            <form onSubmit={onVerifyCode} className="card mt-6 space-y-4 p-6 sm:p-7">
              <p className="text-sm text-slate-600">🔐 পাসওয়ার্ড মিলেছে। এখন আপনার <b>Authenticator অ্যাপের ৬ সংখ্যার কোড</b> দিন — কোড যাচাই হলেই লগইন সম্পূর্ণ হবে।</p>
              <label className="block text-sm font-medium text-slate-700">প্রমাণীকরণ কোড
                <input className="input mt-1.5 tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required placeholder="123456" />
              </label>
              {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">{error}</p> : null}
              <button className="btn-primary w-full py-2.5 text-[15px]" disabled={loading || code.length !== 6}>
                {loading ? "যাচাই হচ্ছে..." : "যাচাই করে লগইন করুন"}
              </button>
              <button type="button" className="w-full text-center text-sm text-slate-500 hover:text-slate-700" onClick={() => { setChallengeToken(""); setCode(""); setError(""); }}>
                ← আবার শুরু করুন
              </button>
            </form>
          ) : (
          <form onSubmit={onSubmit} className="card mt-6 space-y-4 p-6 sm:p-7">
            <label className="block text-sm font-medium text-slate-700">ইমেইল
              <input className="input mt-1.5" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="email" />
            </label>
            <label className="block text-sm font-medium text-slate-700">পাসওয়ার্ড
              <input className="input mt-1.5" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" autoComplete="current-password" />
            </label>
            {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">{error}</p> : null}
            <button className="btn-primary w-full py-2.5 text-[15px]" disabled={loading}>
              {loading ? "অপেক্ষা করুন..." : "লগইন করুন"}
            </button>
            {googleEnabled ? (
              <>
                <div className="flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />অথবা<span className="h-px flex-1 bg-slate-200" /></div>
                <button type="button" className="btn-secondary w-full py-2.5 text-[15px]" disabled={googleBusy} onClick={onGoogleLogin}>
                  {googleBusy ? "Google এ যাওয়া হচ্ছে..." : "Google দিয়ে লগইন করুন"}
                </button>
              </>
            ) : null}
            <p className="text-center text-sm text-slate-500">অ্যাকাউন্ট নেই? <a className="font-semibold text-brand-600 hover:text-brand-700" href="/register">রেজিস্টার করুন</a></p>
          </form>
          )}
          <p className="mt-4 rounded-2xl bg-brand-50 px-4 py-3 text-center text-[13px] text-brand-700 ring-1 ring-inset ring-brand-100">
            Demo: <span className="font-semibold">owner@demo.local</span> / <span className="font-semibold">ChangeMe123!</span>
          </p>
        </div>
      </section>
    </main>
  );
}
