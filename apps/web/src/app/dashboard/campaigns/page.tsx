"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";

interface Plan { id: string; name: string; objective: string; status: string; metaStatus?: string | null; externalCampaignId?: string | null; adSetCount: number; updatedAt: string }

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", pending_approval: "অনুমোদনের অপেক্ষায়", approved: "অনুমোদিত", rejected: "প্রত্যাখ্যাত",
  publishing: "প্রকাশ হচ্ছে", published: "প্রকাশিত", publish_failed: "প্রকাশ ব্যর্থ (আবার চেষ্টা করা যাবে)",
};

export default function CampaignsPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try { setPlans(await apiFetch<Plan[]>(`/organizations/${orgId}/campaign-plans`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="text-sm text-slate-500">প্রতিটি ক্যাম্পেইন Draft → অনুমোদন → Publish এই পথে যায়। Publish হওয়া ক্যাম্পেইন Meta তে PAUSED থাকে, সক্রিয় করা আলাদা সিদ্ধান্ত।</p>
        </div>
        <Link href="/dashboard/campaign-builder" className="btn-primary">+ নতুন Campaign Plan</Link>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {plans.length === 0 ? (
        <EmptyState title="কোনো Campaign Plan নেই" description="Campaign Builder দিয়ে প্রথম Plan তৈরি করুন। Meta তে কিছুই যাবে না যতক্ষণ না Owner/Admin অনুমোদন দিয়ে Publish চাপেন।" />
      ) : (
        <div className="space-y-2">
          {plans.map((p) => (
            <Link key={p.id} href={`/dashboard/campaign-builder?id=${p.id}`} className="flex items-center justify-between card px-4 py-3 hover:border-blue-400">
              <div>
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs text-slate-400">{p.objective} · {p.adSetCount}টি Ad Set · আপডেট {new Date(p.updatedAt).toLocaleString()}</div>
              </div>
              <div className="flex items-center gap-2">
                {p.status === "published" ? <span className={`rounded px-2 py-0.5 text-xs font-semibold ${p.metaStatus === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>Meta: {p.metaStatus ?? "PAUSED"}</span> : null}
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold">{STATUS_LABEL[p.status] ?? p.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
