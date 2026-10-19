import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { fetchShopHome } from "@/lib/storefront-server";
import { customJsAllowedOnHost, primaryHostsFromEnv } from "@/lib/shop-custom-code";
import { isWhiteLabel } from "@/lib/shop-pwa";
import { trackingFromSettings } from "@/lib/shop-tracking";
import { shopLocaleOf, shopT } from "@/lib/shop-i18n";
import { SkipLink } from "@repo/ui";
import { TrackingTags } from "./TrackingTags";
import { RouteProgress } from "@/components/route-progress";
import { effectiveThemeId, previewThemeIdFromHeaders, themeOf } from "@/lib/shop-theme";
import { ShopHeader } from "./ShopHeader";
import { ShopBottomNav } from "./ShopBottomNav";
import { ShopContactButtons } from "./ShopContactButtons";
import { ShopContactLift } from "./ShopContactLift";
import { AttributionCapture } from "./AttributionCapture";
import { ShopPushPrompt } from "./ShopPushPrompt";
import { ShopInstallBar } from "./ShopInstallBar";
// ED6: ShopPopup + ShopSocialProof load via this client wrapper's
// next/dynamic (ssr:false) — both render nothing until their
// client-side triggers fire, so their chunks leave the first load.
import { ShopPopupDeferred, ShopPromotionsDeferred, ShopSocialProofDeferred } from "./ShopDeferredOverlays";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}): Promise<Metadata> {
  try {
    const { orgSlug } = await params;
    const home = await fetchShopHome(orgSlug);
    if (!home) return {};
    // AB8 (AX22): white-label shops without any icon get the
    // neutral generated initial icon — never the platform mark.
    // Non-white-label behaviour is unchanged when no icon exists.
    const icon = home.settings.faviconUrl
      ?? home.organization.logoUrl
      ?? (isWhiteLabel(home) ? `/shop/${orgSlug}/icon.svg` : undefined);
    // GB7 (GC18): Search Console HTML-tag verification token.
    const verificationToken = trackingFromSettings(home.settings).searchConsoleVerification;
    return {
      // AB8 (AX22): per-shop manifest. This shop-layout metadata
      // overrides the root convention manifest (app/manifest.ts)
      // on shop pages only — the shop layout never wraps
      // dashboard pages, so the dashboard keeps its own manifest.
      manifest: `/shop/${orgSlug}/manifest.webmanifest`,
      ...(icon ? { icons: { icon } } : {}),
      verification: verificationToken ? { google: verificationToken } : undefined,
    };
  } catch {
    return {};
  }
}

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
  // AB8 (AX23): merchant custom code. CSS renders on any shop
  // host; JS renders ONLY when explicitly enabled AND the host
  // rule allows it (never on the primary app origin — see
  // lib/shop-custom-code for the rationale). Payload fields are
  // read defensively: older API builds may omit them entirely.
  const settingsAny = home.settings as typeof home.settings & {
    customCss?: unknown;
    customJs?: unknown;
    customJsEnabled?: unknown;
  };
  const customCss = typeof settingsAny.customCss === "string" && settingsAny.customCss.trim()
    ? settingsAny.customCss
    : null;
  const customJs = typeof settingsAny.customJs === "string" && settingsAny.customJs.trim()
    ? settingsAny.customJs
    : null;
  // ED7: ONE headers() call for this layout, reused by the
  // custom-JS host check below and the theme preview. Honest
  // cost: reading headers() opts this layout into per-request
  // rendering on every shop request (it can no longer be fully
  // static) — EB2's fetch-level revalidate:60 caching lives in
  // lib/storefront-server's fetch options and is unaffected.
  const hdrs = await headers();
  const previewId = previewThemeIdFromHeaders(hdrs);
  const effThemeId = effectiveThemeId(home.settings.themeId, previewId);
  let renderCustomJs = false;
  if (customJs && settingsAny.customJsEnabled === true) {
    const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
    renderCustomJs = customJsAllowedOnHost(host, primaryHostsFromEnv());
  }
  const paymentNote = home.businessProfile.paymentNote;
  const locale = shopLocaleOf(home.settings.locale);
  const t = shopT(locale);
  // EC18 trust copy — empty merchant fields hide the block entirely.
  const returnPolicyText = home.settings.returnPolicyText?.trim() || null;
  const supportPhone = home.settings.supportPhone?.trim() || null;

  const theme = themeOf(effThemeId);

  return (
    <div
      lang={locale}
      className={`min-h-screen ${theme.pageBgClass ?? "bg-slate-50"}`}
      data-shop-theme={effThemeId}
      style={{ "--brand": accent } as React.CSSProperties}
    >
      {/* EB6/ED16: skip link — first focusable element in the shop. */}
      <SkipLink href="#shop-main">{t.common.skipToContent}</SkipLink>
      {/* ED11 (EB4): route progress bar — inside the shop root
          so its gradient reads the org's --brand. */}
      <RouteProgress />
      <TrackingTags tracking={trackingFromSettings(home.settings)} />
      {/* AB8 (AX23): merchant custom CSS — after the tracking /
          theme inputs, before the header, so it can restyle the
          whole shop surface below it. */}
      {customCss ? <style data-custom dangerouslySetInnerHTML={{ __html: customCss }} /> : null}
      <ShopHeader
        orgSlug={orgSlug}
        shopName={shopName}
        logoUrl={home.organization.logoUrl}
        primaryColor={home.organization.primaryColor}
        locale={locale}
        pages={home.pages?.menu ?? []}
        themeId={effThemeId}
        blog={home.pages?.blog ?? false}
      />
      {home.settings.announcementText ? (
        <div className="text-center text-xs font-semibold text-white" style={{ backgroundColor: accent }}>
          <p className="mx-auto max-w-6xl px-4 py-2">{home.settings.announcementText}</p>
        </div>
      ) : null}
      <main id="shop-main" tabIndex={-1}>{children}</main>
      {/* AB7 (AX19): first-touch utm/click capture into tp_sess. */}
      <AttributionCapture />
      {/* ED6: popup deferred (renders nothing until its trigger). */}
      <ShopPopupDeferred orgSlug={orgSlug} locale={locale} />
      {/* NF6: gamified promotions overlay (same placement/trigger
          machinery as the popup; overlay-queue slot "promo"). */}
      <ShopPromotionsDeferred orgSlug={orgSlug} locale={locale} />
      {/* AB7 (AX16): push prompt (shop-scoped worker) + AX17 social proof. */}
      <ShopPushPrompt orgSlug={orgSlug} locale={locale} />
      {/* AB8 (AX22): per-shop install bar (rides the stashed
          beforeinstallprompt; iOS gets manual instructions). */}
      <ShopInstallBar orgSlug={orgSlug} locale={locale} />
      {/* ED6: social proof deferred (renders nothing until its feed loads). */}
      <ShopSocialProofDeferred orgSlug={orgSlug} themeId={effThemeId} locale={locale} />
      {/* ED9: contact buttons ride the bottom-lift wrapper (see
          ShopContactLift) so they clear the v2 bottom nav / a
          page buy bar; at lift 0 rendering is pixel-identical. */}
      <ShopContactLift>
        <ShopContactButtons
          whatsappNumber={home.settings.whatsappNumber ?? null}
          messengerUrl={home.settings.messengerUrl ?? null}
          whatsappLabel={t.pages.whatsappLabel}
          messengerLabel={t.pages.messengerLabel}
        />
      </ShopContactLift>
      {/* ED7: v2 footer — SAME content blocks, token classes only.
          Legacy themes keep theme.headerDark styling. */}
      <footer className={effThemeId === "v2" ? "mt-14 border-t border-[var(--border-soft)] bg-[var(--surface)]" : `mt-14 border-t ${theme.headerDark ? "border-slate-800 bg-slate-900/90 text-slate-300" : "border-slate-200 bg-white"}`}>
        <div className="mx-auto max-w-6xl space-y-2 px-4 py-8 text-center sm:px-6">
          <p className={effThemeId === "v2" ? "text-sm font-bold text-[var(--ink-strong)]" : `text-sm font-bold ${theme.headerDark ? "text-slate-100" : "text-slate-800"}`}>{shopName}</p>
          {(home.pages?.footer ?? []).length > 0 ? (
            <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pb-2">
              {(home.pages?.footer ?? []).map((p) => (
                <Link key={p.slug} href={`/shop/${orgSlug}/p/${p.slug}`} className={effThemeId === "v2" ? "text-xs font-semibold text-[var(--ink-body)] hover:text-[var(--brand-strong)]" : `text-xs font-semibold hover:text-indigo-500 ${theme.headerDark ? "text-slate-400" : "text-slate-600"}`}>
                  {p.title}
                </Link>
              ))}
            </nav>
          ) : null}
          {home.businessProfile.codAvailable ? (
            <p className={effThemeId === "v2" ? "text-xs text-[var(--ink-muted)]" : "text-xs text-slate-500"}>{t.common.codAvailable}</p>
          ) : null}
          {paymentNote ? <p className={effThemeId === "v2" ? "text-xs text-[var(--ink-muted)]" : "text-xs text-slate-500"}>{paymentNote}</p> : null}
          {home.businessProfile.bkashNumber ? (
            <p className={effThemeId === "v2" ? "text-xs text-[var(--ink-muted)]" : "text-xs text-slate-500"}>{t.common.bkash}: <span className="font-mono font-semibold">{home.businessProfile.bkashNumber}</span></p>
          ) : null}
          {home.businessProfile.nagadNumber ? (
            <p className={effThemeId === "v2" ? "text-xs text-[var(--ink-muted)]" : "text-xs text-slate-500"}>{t.common.nagad}: <span className="font-mono font-semibold">{home.businessProfile.nagadNumber}</span></p>
          ) : null}
          {supportPhone ? (
            <p className={effThemeId === "v2" ? "text-xs text-[var(--ink-muted)]" : "text-xs text-slate-500"}>{t.common.supportPhoneLabel}: <span className="font-mono font-semibold">{supportPhone}</span></p>
          ) : null}
          {returnPolicyText ? (
            <p className={effThemeId === "v2" ? "mx-auto max-w-xl whitespace-pre-line text-xs leading-relaxed text-[var(--ink-muted)]" : "mx-auto max-w-xl whitespace-pre-line text-xs leading-relaxed text-slate-500"}>
              <span className={effThemeId === "v2" ? "font-semibold text-[var(--ink-body)]" : "font-semibold text-slate-600"}>{t.common.returnPolicyLabel}: </span>{returnPolicyText}
            </p>
          ) : null}
        </div>
      </footer>
      {/* ED7: v2-only mobile bottom nav (fixed) + an in-flow spacer
          so page content / the footer are never covered by it.
          Legacy themes get NO extra node here. */}
      {effThemeId === "v2" ? <ShopBottomNav orgSlug={orgSlug} locale={locale} /> : null}
      {effThemeId === "v2" ? <div className="h-16 lg:hidden" aria-hidden="true" /> : null}
      {/* AB8 (AX23): merchant custom JS — the very last node of
          the layout, and only when enabled + host-allowed. */}
      {renderCustomJs && customJs ? (
        <script data-custom-js dangerouslySetInnerHTML={{ __html: customJs }} />
      ) : null}
    </div>
  );
}
