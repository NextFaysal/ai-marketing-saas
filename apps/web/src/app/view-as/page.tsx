"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Milestone 38 (Admin Phase A2): view-as landing. The admin
 * opens this URL from the Admin Console; the short-lived token
 * moves into localStorage and the URL is cleaned, then the app
 * continues as the impersonated member of ONE organization.
 */
function ViewAsInner() {
  const params = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    const token = params.get("token");
    const org = params.get("org");
    if (!token || !org) { setError("লিংকটি অসম্পূর্ণ — Admin Console থেকে আবার View-As শুরু করুন।"); return; }
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (!payload?.viewAs) { setError("এটি কোনো View-As টোকেন নয়।"); return; }
      if (payload.viewAs.orgId !== org) { setError("টোকেনের Organization মিলছে না।"); return; }
      if (payload.exp && payload.exp * 1000 < Date.now()) { setError("View-As লিংকটির মেয়াদ শেষ — Admin Console থেকে নতুন করে শুরু করুন।"); return; }
    } catch { setError("টোকেন পড়া যায়নি।"); return; }
    localStorage.setItem("accessToken", token);
    localStorage.setItem("organizationId", org);
    window.history.replaceState({}, "", "/view-as");
    window.location.href = "/dashboard";
  }, [params]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        {error ? (
          <>
            <div className="text-3xl">⚠️</div>
            <h1 className="mt-2 text-lg font-bold text-slate-900">View-As শুরু করা যাচ্ছে না</h1>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
          </>
        ) : (
          <>
            <div className="text-3xl">👁</div>
            <h1 className="mt-2 text-lg font-bold text-slate-900">View-As সেশন শুরু হচ্ছে…</h1>
            <p className="mt-2 text-sm text-slate-600">Tenant ওয়ার্কস্পেসে নিয়ে যাওয়া হচ্ছে।</p>
          </>
        )}
      </div>
    </main>
  );
}

export default function ViewAsPage() {
  return <Suspense fallback={null}><ViewAsInner /></Suspense>;
}
