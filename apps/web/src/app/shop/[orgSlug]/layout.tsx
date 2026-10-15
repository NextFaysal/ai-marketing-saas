import React from "react";
import { fetchShopHome } from "@/lib/storefront-server";
import { shopLocaleOf, shopT } from "@/lib/shop-i18n";
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
  const locale = shopLocaleOf(home.settings.locale);
  const t = shopT(locale);
  // EC18 trust copy — empty merchant fields hide the block entirely.
  const returnPolicyText = home.settings.returnPolicyText?.trim() || null;
  const supportPhone = home.settings.supportPhone?.trim() || null;

  return (
    <div className="min-h-screen bg-slate-50">
      <ShopHeader
        orgSlug={orgSlug}
        shopName={shopName}
        logoUrl={home.organization.logoUrl}
        primaryColor={home.organization.primaryColor}
        locale={locale}
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
            <p className="text-xs text-slate-500">{t.common.codAvailable}</p>
          ) : null}
          {paymentNote ? <p className="text-xs text-slate-500">{paymentNote}</p> : null}
          {home.businessProfile.bkashNumber ? (
            <p className="text-xs text-slate-500">{t.common.bkash}: <span className="font-mono font-semibold">{home.businessProfile.bkashNumber}</span></p>
          ) : null}
          {home.businessProfile.nagadNumber ? (
            <p className="text-xs text-slate-500">{t.common.nagad}: <span className="font-mono font-semibold">{home.businessProfile.nagadNumber}</span></p>
          ) : null}
          {supportPhone ? (
            <p className="text-xs text-slate-500">{t.common.supportPhoneLabel}: <span className="font-mono font-semibold">{supportPhone}</span></p>
          ) : null}
          {returnPolicyText ? (
            <p className="mx-auto max-w-xl whitespace-pre-line text-xs leading-relaxed text-slate-500">
              <span className="font-semibold text-slate-600">{t.common.returnPolicyLabel}: </span>{returnPolicyText}
            </p>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
