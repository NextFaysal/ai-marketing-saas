"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

interface Member { id: string; role: string; status: string; user: { id: string; name: string; email: string } }
interface Invitation { id: string; email: string; role: string; status: string; expiresAt: string; emailSent: boolean; createdAt: string }

const ROLES = ["ADMIN", "MARKETING_MANAGER", "ADVERTISER", "SUPPORT_AGENT", "ANALYST", "VIEWER"];

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [lastLink, setLastLink] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      const [m, inv] = await Promise.all([
        apiFetch<Member[]>(`/organizations/${orgId}/members`),
        apiFetch<Invitation[]>(`/organizations/${orgId}/members/invitations`).catch(() => [] as Invitation[]),
      ]);
      setMembers(m);
      setInvitations(inv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "লোড করা যায়নি");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function wrap(key: string, fn: () => Promise<void>) {
    setBusy(key); setError(""); setNotice("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "কাজটি করা যায়নি"); } finally { setBusy(""); }
  }

  async function directInvite() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const email = (document.getElementById("direct-email") as HTMLInputElement).value;
    const role = (document.getElementById("direct-role") as HTMLSelectElement).value;
    await wrap("direct", async () => {
      await apiFetch(`/organizations/${orgId}/members/invite`, { method: "POST", body: JSON.stringify({ email, role }) });
      setNotice("সদস্য যোগ হয়েছে।");
      await load();
    });
  }

  async function emailInvite() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const email = (document.getElementById("inv-email") as HTMLInputElement).value;
    const role = (document.getElementById("inv-role") as HTMLSelectElement).value;
    await wrap("email-invite", async () => {
      const out = await apiFetch<{ inviteUrl: string; emailSent: boolean }>(`/organizations/${orgId}/members/email-invite`, {
        method: "POST", body: JSON.stringify({ email, role }),
      });
      setLastLink(out.inviteUrl);
      setNotice(out.emailSent
        ? "আমন্ত্রণের ইমেইল পাঠানো হয়েছে। চাইলে নিচের লিংকটিও সরাসরি পাঠাতে পারেন।"
        : "আমন্ত্রণ তৈরি হয়েছে, কিন্তু ইমেইল পাঠানো যায়নি (SMTP সেট করা নেই বা ব্যর্থ)। নিচের লিংকটি কপি করে সরাসরি পাঠিয়ে দিন।");
      await load();
    });
  }

  async function resetTotp(userId: string, name: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`totp-${userId}`, async () => {
      await apiFetch(`/organizations/${orgId}/members/${userId}/totp-reset`, { method: "POST" });
      setNotice(`${name} এর 2FA রিসেট হয়েছে — তিনি Settings থেকে আবার চালু করতে পারবেন। (শুধু OWNER এই কাজটি করতে পারে।)`);
    });
  }

  async function revoke(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`revoke-${id}`, async () => {
      await apiFetch(`/organizations/${orgId}/members/invitations/${id}`, { method: "DELETE" });
      setNotice("আমন্ত্রণ বাতিল হয়েছে।");
      await load();
    });
  }

  async function resend(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await wrap(`resend-${id}`, async () => {
      const out = await apiFetch<{ inviteUrl: string; emailSent: boolean }>(`/organizations/${orgId}/members/invitations/${id}/resend`, { method: "POST" });
      setLastLink(out.inviteUrl);
      setNotice(out.emailSent ? "আমন্ত্রণ আবার পাঠানো হয়েছে (নতুন লিংক)।" : "নতুন লিংক তৈরি হয়েছে; ইমেইল যায়নি — লিংকটি কপি করে পাঠান।");
      await load();
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="page-title">Team Settings</h1>
      {error ? <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div> : null}

      <div className="card p-5">
        <h2 className="mb-3 font-semibold">সদস্যরা ({members.length})</h2>
        {members.length === 0 ? <p className="text-sm text-slate-500">কোনো সদস্য নেই।</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="py-2">নাম</th><th>ইমেইল</th><th>ভূমিকা</th><th>অবস্থা</th><th></th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="py-2">{m.user.name}</td><td>{m.user.email}</td><td>{m.role}</td><td>{m.status}</td>
                  <td className="text-right">
                    <button className="btn-secondary" disabled={busy === `totp-${m.user.id}`} onClick={() => resetTotp(m.user.id, m.user.name)}>2FA রিসেট</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-1 font-semibold">📧 ইমেইল আমন্ত্রণ (নতুন)</h2>
          <p className="mb-3 text-sm text-slate-500">যার অ্যাকাউন্ট নেই তাকেও আমন্ত্রণ পাঠানো যায়। লিংকের মেয়াদ ৭ দিন; গ্রহণ করতে ওই ইমেইল দিয়েই লগইন/রেজিস্টার করতে হবে।</p>
          <div className="flex flex-wrap gap-2">
            <input id="inv-email" type="email" className="input flex-1" placeholder="teammate@email.com" />
            <select id="inv-role" className="input w-44">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <button className="btn-primary" disabled={busy === "email-invite"} onClick={emailInvite}>আমন্ত্রণ তৈরি</button>
          </div>
          {lastLink ? (
            <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <div className="mb-1 text-xs text-slate-500">আমন্ত্রণ লিংক (কপি করে পাঠাতে পারেন):</div>
              <code className="block overflow-x-auto whitespace-nowrap text-xs">{lastLink}</code>
            </div>
          ) : null}
        </div>

        <div className="card p-5">
          <h2 className="mb-1 font-semibold">সরাসরি যোগ (অ্যাকাউন্ট আছে যার)</h2>
          <p className="mb-3 text-sm text-slate-500">আগে থেকে রেজিস্টার করা ব্যবহারকারীকে সরাসরি সদস্য করা যায়।</p>
          <div className="flex flex-wrap gap-2">
            <input id="direct-email" type="email" className="input flex-1" placeholder="user@email.com" />
            <select id="direct-role" className="input w-44">{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <button className="btn-primary" disabled={busy === "direct"} onClick={directInvite}>যোগ করুন</button>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold">অপেক্ষমাণ আমন্ত্রণ</h2>
        {invitations.length === 0 ? <p className="text-sm text-slate-500">কোনো আমন্ত্রণ নেই।</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500"><th className="py-2">ইমেইল</th><th>ভূমিকা</th><th>অবস্থা</th><th>ইমেইল গেছে</th><th>মেয়াদ</th><th></th></tr></thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} className="border-t">
                  <td className="py-2">{inv.email}</td>
                  <td>{inv.role}</td>
                  <td>{inv.status}</td>
                  <td>{inv.emailSent ? "হ্যাঁ" : "না"}</td>
                  <td>{new Date(inv.expiresAt).toLocaleDateString("bn-BD")}</td>
                  <td className="space-x-2 text-right">
                    {inv.status === "pending" || inv.status === "expired" ? (
                      <button className="btn-secondary" disabled={busy === `resend-${inv.id}`} onClick={() => resend(inv.id)}>আবার পাঠান</button>
                    ) : null}
                    {inv.status === "pending" ? (
                      <button className="btn-secondary" disabled={busy === `revoke-${inv.id}`} onClick={() => revoke(inv.id)}>বাতিল</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
