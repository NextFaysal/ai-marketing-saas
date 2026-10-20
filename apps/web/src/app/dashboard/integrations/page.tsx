"use client";
import React from "react";
import Link from "next/link";
import { CommerceConnectPanel } from "@/components/connect/commerce-connect-panel";
import { useLocale } from "@/lib/i18n/provider";

/**
 * Stores & Integrations page. The connect/manage body lives in
 * the shared CommerceConnectPanel (extracted in Connect Center
 * B3/CC5) so the Connect Center's Commerce section and this page
 * run the exact same flows against the exact same APIs — this
 * page keeps its header, its Commerce Hub links and the Connect
 * Center banner.
 */
export default function IntegrationsPage() {
  const { dict } = useLocale();
  const D = dict.connections;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Stores & Integrations</h1>
          <p className="text-sm text-slate-500">{D.intIntro}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/commerce" className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold">📊 Commerce Hub</Link>
          <Link href="/dashboard/commerce/sync" className="btn-primary">{D.intSyncCenterLink}</Link>
        </div>
      </div>

      <div className="rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-800 ring-1 ring-inset ring-indigo-100">
        🔗 <b>{D.intBannerBold}</b>{D.intBannerMid}
        <Link href="/dashboard/connections" className="font-semibold underline">{D.intBannerLink}</Link>
        {D.intBannerAfter}
      </div>

      <CommerceConnectPanel />
    </div>
  );
}
