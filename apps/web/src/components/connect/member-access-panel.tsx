"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  memberCanBeRestricted,
  type MemberAccessMatrix,
} from "@/lib/connections";

/**
 * CC17 — সদস্য × অ্যাকাউন্ট অ্যাক্সেস matrix (OWNER/ADMIN)।
 *
 * টেবিলের প্রতিটি ঘর একটি DENY: টিক দিলে সেই সদস্য ওই
 * অ্যাকাউন্টে Inbox থেকে মেসেজ পাঠাতে পারবেন না এবং ওই
 * সোশ্যাল অ্যাকাউন্টে পোস্ট তৈরি/শিডিউল/প্রকাশ করতে পারবেন
 * না (সার্ভারেই আটকায় — শুধু UI-তে লুকানো নয়)। OWNER সারি
 * কখনো সীমাবদ্ধ হয় না (M72 নিয়ম) — সার্ভারও তা ফিরিয়ে
 * দেয়, তাই এখানে সেই সারি read-only। সেভ হয় পুরো তালিকা
 * একসাথে (API পুরো deny-list প্রতিস্থাপন করে)।
 */
export function MemberAccessPanel() {
  const [matrix, setMatrix] = useState<MemberAccessMatrix | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<MemberAccessMatrix>(`organizations/${orgId}/connections/member-access`);
      setMatrix(res);
      const next: Record<string, Set<string>> = {};
      for (const m of res.members) next[m.userId] = new Set(m.deniedConnectionIds);
      setDrafts(next);
    } catch { /* panel stays hidden rather than inventing data */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggle(userId: string, targetId: string, denied: boolean) {
    setDrafts((prev) => {
      const set = new Set(prev[userId] ?? []);
      if (denied) set.add(targetId); else set.delete(targetId);
      return { ...prev, [userId]: set };
    });
  }

  async function save(userId: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(userId); setError(""); setNotice("");
    try {
      await apiFetch(`organizations/${orgId}/connections/member-access/${userId}`, {
        method: "PUT",
        body: JSON.stringify({ deniedConnectionIds: [...(drafts[userId] ?? [])] }),
      });
      setNotice("সদস্যের অ্যাক্সেস সেভ হয়েছে — নিষেধ করা অ্যাকাউন্টে তিনি আর মেসেজ/পোস্ট পাঠাতে পারবেন না।");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "অ্যাক্সেস সেভ হয়নি");
    } finally { setBusy(""); }
  }

  if (!matrix || matrix.targets.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold text-slate-800">👥 সদস্যদের অ্যাকাউন্ট অ্যাক্সেস</h2>
        <p className="mt-1 text-sm text-slate-500">
          কোন সদস্য কোন অ্যাকাউন্ট ব্যবহার করতে পারবেন না তা এখান থেকে ঠিক করুন। নিষেধ করা অ্যাকাউন্টে সেই সদস্য
          Inbox থেকে উত্তর পাঠাতে বা সোশ্যাল পোস্ট করতে পারবেন না — সার্ভারেই আটকানো হয়। OWNER কখনো সীমাবদ্ধ হন না।
          শিডিউল করা পোস্ট, AI উত্তর, WhatsApp ব্রডকাস্ট ও স্বয়ংক্রিয় বার্তা পাঠানোর সময়ও এই নিষেধাজ্ঞা আবার যাচাই হয়
          (CC27) — নিষেধের পর সেগুলো থেমে যাবে ও কারণসহ রেকর্ড থাকবে। বিজ্ঞাপন অ্যাকাউন্টেও নিষেধাজ্ঞা দেওয়া যায়:
          নিষেধ করা সদস্য সেই অ্যাকাউন্টের ডেটা Sync বা ক্যাম্পেইন চালু/প্রকাশ করতে পারবেন না (ক্যাম্পেইন Pause সবসময় করা যাবে)।
        </p>
      </div>
      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      {notice ? <div className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{notice}</div> : null}
      <div className="card overflow-x-auto p-4">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-3 font-semibold">সদস্য</th>
              {matrix.targets.map((t) => (
                <th key={t.id} className="px-2 py-2 text-center font-semibold">
                  {t.displayName}
                  <span className="block font-normal normal-case text-slate-300">{t.provider}</span>
                </th>
              ))}
              <th className="py-2 pl-3" />
            </tr>
          </thead>
          <tbody>
            {matrix.members.map((member) => {
              const restricted = memberCanBeRestricted(member);
              const dirty = restricted && (
                (drafts[member.userId]?.size ?? 0) !== member.deniedConnectionIds.length
                || member.deniedConnectionIds.some((id) => !drafts[member.userId]?.has(id))
              );
              return (
                <tr key={member.userId} className="border-b border-slate-50">
                  <td className="py-2 pr-3">
                    <div className="font-semibold text-slate-700">{member.name ?? member.email ?? member.userId}</div>
                    <div className="text-slate-400">{member.role}{member.email && member.name ? ` · ${member.email}` : ""}</div>
                  </td>
                  {matrix.targets.map((t) => (
                    <td key={t.id} className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${member.name ?? member.userId} — ${t.displayName} নিষেধ`}
                        disabled={!restricted}
                        checked={drafts[member.userId]?.has(t.id) ?? false}
                        onChange={(e) => toggle(member.userId, t.id, e.target.checked)}
                        className="h-4 w-4 accent-red-500 disabled:opacity-30"
                      />
                    </td>
                  ))}
                  <td className="py-2 pl-3 text-right">
                    {restricted ? (
                      <button
                        type="button"
                        disabled={busy === member.userId || !dirty}
                        onClick={() => void save(member.userId)}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                      >
                        {busy === member.userId ? "সেভ হচ্ছে…" : "সেভ করুন"}
                      </button>
                    ) : (
                      <span className="text-slate-300">সবসময় পূর্ণ অ্যাক্সেস</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-slate-400">টিক = ওই অ্যাকাউন্টে নিষেধ (deny)। টিক তুলে সেভ করলেই অ্যাক্সেস ফিরে আসে।</p>
      </div>
    </section>
  );
}
