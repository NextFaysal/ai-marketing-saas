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
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="acard w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="text-3xl">🛡</div>
          <h1 className="mt-1 text-xl font-bold">Qosprey Admin</h1>
          <p className="text-sm text-slate-400">SaaS Operator Console — শুধুমাত্র Platform Admin দের জন্য</p>
        </div>
        {error ? <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}
        <label className="block text-sm">ইমেইল<input className="ainput mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="block text-sm">পাসওয়ার্ড<input className="ainput mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="abtn w-full justify-center" disabled={busy}>{busy ? "যাচাই হচ্ছে…" : "Admin লগইন"}</button>
        <p className="text-center text-xs text-slate-500">ভুল অ্যাকাউন্ট দিয়ে চেষ্টা করলে প্রবেশ মিলবে না। সব Admin কার্যকলাপ Audit Log এ থাকে।</p>
      </form>
    </div>
  );
}
