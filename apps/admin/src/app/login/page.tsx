"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { API_URL, setAdminToken } from "@/lib/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? "লগইন ব্যর্থ হয়েছে");
      if (!body.user?.isSuperAdmin) {
        setError("এই অ্যাকাউন্টটি Platform Admin নয়। Admin Console শুধু Super Admin দের জন্য — এই চেষ্টাটি লগ করা হয়েছে।");
        return;
      }
      if ((body.user as any).totpEnabled && !body.accessToken) {
        // TOTP flow returns a challenge instead of a token (Phase D)
        localStorage.setItem("admin_totp_pending", JSON.stringify(body));
        router.replace("/login/totp");
        return;
      }
      setAdminToken(body.accessToken);
      localStorage.setItem("admin_user", JSON.stringify(body.user));
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "লগইন ব্যর্থ হয়েছে");
    } finally { setBusy(false); }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-slate-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-fuchsia-600/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-lg shadow-[0_10px_24px_-8px_rgb(99_102_241/0.9)]">🛡</span>
          <div>
            <div className="text-lg font-bold tracking-tight">Qosprey Admin</div>
            <div className="text-xs text-slate-400">SaaS Operator Console</div>
          </div>
        </div>
        <div className="relative max-w-md space-y-5">
          <h2 className="text-4xl font-bold leading-[1.15] tracking-tight">পুরো প্ল্যাটফর্ম,<br /><span className="bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">এক Control Room এ।</span></h2>
          {[
            { t: "সব Tenant, এক নজরে", d: "User, Organization, সাবস্ক্রিপশন, আয় আর ব্যবহার — আসল ডেটা থেকে।" },
            { t: "কারণ ছাড়া ধ্বংসাত্মক কাজ নয়", d: "Suspend, Payment Delete, Admin Grant — প্রতিটিতে কারণ + Audit বাধ্যতামূলক।" },
            { t: "2FA সুরক্ষিত প্রবেশ", d: "Super Admin দের জন্য Authenticator যাচাই; ভুল অ্যাকাউন্ট কখনোই ঢুকতে পারে না।" },
          ].map((h) => (
            <div key={h.t} className="flex gap-3.5">
              <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-[11px] text-emerald-300 ring-1 ring-inset ring-emerald-300/30">✓</span>
              <div>
                <div className="font-semibold">{h.t}</div>
                <div className="text-sm text-slate-400">{h.d}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="relative text-xs text-slate-600">© 2026 Qosprey · Operator access only</div>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <form onSubmit={submit} className="acard w-full max-w-sm space-y-4">
          {/* ADNX14: this page has no AdminShell, so its heading
              follows the PageHead typography pattern directly
              (--a-fs-page scale: 24px, bold, tight tracking). */}
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-xl lg:hidden">🛡</div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">Admin লগইন</h1>
            <p className="text-sm text-slate-400">শুধুমাত্র Platform Admin দের জন্য</p>
          </div>
          {error ? <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300" role="alert">{error}</p> : null}
          <label className="block text-sm">ইমেইল<input className="ainput mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
          <label className="block text-sm">পাসওয়ার্ড<input className="ainput mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
          <button className="abtn w-full" disabled={busy}>{busy ? "যাচাই হচ্ছে…" : "Admin লগইন"}</button>
          <p className="text-center text-xs text-slate-400">ভুল অ্যাকাউন্ট দিয়ে চেষ্টা করলে প্রবেশ মিলবে না। সব Admin কার্যকলাপ Audit Log এ থাকে।</p>
        </form>
      </section>
    </main>
  );
}
