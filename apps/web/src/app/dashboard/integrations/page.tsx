"use client";
import React from "react";
import Link from "next/link";
import { CommerceConnectPanel } from "@/components/connect/commerce-connect-panel";

/**
 * Stores & Integrations page. The connect/manage body lives in
 * the shared CommerceConnectPanel (extracted in Connect Center
 * B3/CC5) so the Connect Center's Commerce section and this page
 * run the exact same flows against the exact same APIs — this
 * page keeps its header, its Commerce Hub links and the Connect
 * Center banner.
 */
export default function IntegrationsPage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Stores & Integrations</h1>
          <p className="text-sm text-slate-500">WooCommerce অথবা Shopify কানেক্ট করুন। সব Secret সার্ভারে AES-256 এনক্রিপ্ট করে রাখা হয়, ব্রাউজারে বা API উত্তরে কখনো ফেরত যায় না।</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/commerce" className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold">📊 Commerce Hub</Link>
          <Link href="/dashboard/commerce/sync" className="btn-primary">Sync Center খুলুন →</Link>
        </div>
      </div>

      <div className="rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-800 ring-1 ring-inset ring-indigo-100">
        🔗 <b>নতুন:</b> সব অ্যাকাউন্টের অবস্থা এখন এক জায়গায় —{" "}
        <Link href="/dashboard/connections" className="font-semibold underline">কানেক্ট সেন্টার খুলুন →</Link>{" "}
        (Facebook Page, WhatsApp, বিজ্ঞাপন অ্যাকাউন্ট, কুরিয়ার, পেমেন্টসহ সবকিছুর status সেখানে দেখা যাবে। এই পেজের স্টোর কানেক্ট ফ্লো আগের মতোই চলবে — এখন কানেক্ট সেন্টার থেকেও একই ফ্লো চালানো যায়।)
      </div>

      <CommerceConnectPanel />
    </div>
  );
}
