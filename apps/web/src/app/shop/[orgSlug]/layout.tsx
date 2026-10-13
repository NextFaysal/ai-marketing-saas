import React from "react";
import { fetchShopHome } from "@/lib/storefront-server";
import { ShopHeader } from "./ShopHeader";

export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const home = await fetchShopHome(orgSlug);

  // Shop missing/disabled: let the page itself answer 404.
  if (!home) return <>{children}</>;

  const shopName = home.settings.shopName;
  const accent = home.organization.primaryColor || "#4f46e5";
  const paymentNote = home.businessProfile.paymentNote;

  return (
    <div className="min-h-screen bg-slate-50">
      <ShopHeader
        orgSlug={orgSlug}
        shopName={shopName}
        logoUrl={home.organization.logoUrl}
        primaryColor={home.organization.primaryColor}
      />
      {home.settings.announcementText ? (
        <div className="text-center text-xs font-semibold text-white" style={{ backgroundColor: accent }}>
          <p className="mx-auto max-w-6xl px-4 py-2">{home.settings.announcementText}</p>
        </div>
      ) : null}
      <main>{children}</main>
      <footer className="mt-14 border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl space-y-2 px-4 py-8 text-center sm:px-6">
          <p className="text-sm font-bold text-slate-800">{shopName}</p>
          {home.businessProfile.codAvailable ? (
            <p className="text-xs text-slate-500">ক্যাশ অন ডেলিভারি সুবিধা আছে — পণ্য হাতে পেয়ে টাকা পরিশোধ করুন।</p>
          ) : null}
          {paymentNote ? <p className="text-xs text-slate-500">{paymentNote}</p> : null}
          {home.businessProfile.bkashNumber ? (
            <p className="text-xs text-slate-500">বিকাশ: <span className="font-mono font-semibold">{home.businessProfile.bkashNumber}</span></p>
          ) : null}
          {home.businessProfile.nagadNumber ? (
            <p className="text-xs text-slate-500">নগদ: <span className="font-mono font-semibold">{home.businessProfile.nagadNumber}</span></p>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
