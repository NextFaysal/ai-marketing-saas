"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { pubT } from "@/lib/i18n/public";

const t = pubT();

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
    if (!token || !org) { setError(t.viewAs.incompleteLink); return; }
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (!payload?.viewAs) { setError(t.viewAs.notViewAsToken); return; }
      if (payload.viewAs.orgId !== org) { setError(t.viewAs.orgMismatch); return; }
      if (payload.exp && payload.exp * 1000 < Date.now()) { setError(t.viewAs.expired); return; }
    } catch { setError(t.viewAs.unreadable); return; }
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
            <h1 className="mt-2 text-lg font-bold text-slate-900">{t.viewAs.cannotStartTitle}</h1>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
          </>
        ) : (
          <>
            <div className="text-3xl">👁</div>
            <h1 className="mt-2 text-lg font-bold text-slate-900">{t.viewAs.startingTitle}</h1>
            <p className="mt-2 text-sm text-slate-600">{t.viewAs.startingText}</p>

          </>
        )}
      </div>
    </main>
  );
}

export default function ViewAsPage() {
  return <Suspense fallback={null}><ViewAsInner /></Suspense>;
}
