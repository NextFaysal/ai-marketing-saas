"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch } from "@/lib/api";

interface AdminRow {
  id: string; name: string | null; email: string; tier: string; status: string;
  totpEnrolled: boolean; lastLoginAt: string | null; createdAt: string | null;
}

/** AA7 (C13): the admins roster — every platform admin in one
 * place, read-only. Grant/revoke and tier changes live on each
 * user's detail page (click the name); this page exists so the
 * operator can see the whole team — and especially who has not
 * enrolled TOTP — at a glance. */
export default function AdminsPage() {
  const [admins, setAdmins] = React.useState<AdminRow[]>([]);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    apiFetch<{ admins: AdminRow[] }>("/admin/security/admins")
      .then((o) => setAdmins(o.admins ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "লোড ব্যর্থ হয়েছে"));
  }, []);

  const superWithoutTotp = admins.filter((a) => a.tier === "SUPER" && !a.totpEnrolled && a.status === "ACTIVE");
  const fmt = (v: string | null) => (v ? new Date(v).toLocaleString("bn-BD") : "—");

  return (
    <AdminShell title="🧑‍💼 Admins (রোস্টার)">
      <p className="mb-3 text-sm text-slate-400">
        প্ল্যাটফর্মের সব Admin এক জায়গায়। এই পেজটি শুধু দেখার জন্য — Admin Grant/Revoke ও Tier বদল প্রতিটি User-এর Detail পেজ থেকে হয় (নামে ক্লিক করুন)।
        TOTP সেট না করা SUPER Admin লগইন করে শুধু পড়তে পারেন, কোনো পরিবর্তন (Mutation) করতে পারেন না — তাই সেটি লাল করে দেখানো হয়েছে।
      </p>
      {superWithoutTotp.length ? (
        <p className="mb-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-200">
          ⚠ {superWithoutTotp.length} জন সক্রিয় SUPER Admin-এর TOTP সেট করা নেই: {superWithoutTotp.map((a) => a.email).join(", ")} — তাঁরা Console-এ কোনো পরিবর্তন করতে পারবেন না যতক্ষণ না Security পেজ থেকে TOTP চালু করেন।
        </p>
      ) : null}
      {error ? <p className="mb-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
      <div className="acard overflow-hidden p-0">
        <table className="atable">
          <thead className="bg-slate-900"><tr>
            <th className="ath">নাম</th><th className="ath">Email</th><th className="ath">Tier</th><th className="ath">Status</th>
            <th className="ath">TOTP</th><th className="ath">সর্বশেষ Login</th><th className="ath">Admin হয়েছেন</th>
          </tr></thead>
          <tbody>{admins.map((a) => {
            const danger = a.tier === "SUPER" && !a.totpEnrolled && a.status === "ACTIVE";
            return (
              <tr key={a.id} className={`border-t border-slate-800 ${danger ? "bg-red-500/5" : ""}`}>
                <td className="atd"><a className="text-indigo-300 hover:underline" href={`/users/${a.id}`}>{a.name ?? "—"}</a></td>
                <td className="atd">{a.email}</td>
                <td className="atd"><span className={a.tier === "SUPER" ? "abadge-red" : "abadge-amber"}>{a.tier}</span></td>
                <td className="atd">{a.status === "ACTIVE" ? <span className="abadge-green">ACTIVE</span> : <span className="abadge-amber">{a.status}</span>}</td>
                <td className="atd">
                  {a.totpEnrolled
                    ? <span className="abadge-green">Enrolled</span>
                    : <span className={danger ? "abadge-red" : "abadge-amber"}>সেট করা নেই{danger ? " — SUPER, পরিবর্তন বন্ধ" : ""}</span>}
                </td>
                <td className="atd">{fmt(a.lastLoginAt)}</td>
                <td className="atd">{fmt(a.createdAt)}</td>
              </tr>
            );
          })}</tbody>
        </table>
        {admins.length === 0 && !error ? <p className="p-4 text-sm text-slate-500">কোনো Admin পাওয়া যায়নি।</p> : null}
      </div>
    </AdminShell>
  );
}
