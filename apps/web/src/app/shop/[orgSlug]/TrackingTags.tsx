import React from "react";
import Script from "next/script";
import type { ShopTracking } from "@/lib/shop-tracking";

/**
 * GB7 (GC18) — merchant tracking tags for the public shop.
 *
 * Renders NOTHING unless the merchant configured the IDs in
 * storefront settings — IDs come only from settings, never
 * hardcoded. GA4 loads gtag.js + config; GTM loads the standard
 * container snippet (+ noscript iframe). When both are set both
 * render (the dashboard warns about double counting GA4 via GTM).
 */
export function TrackingTags({ tracking }: { tracking: ShopTracking | null | undefined }) {
  if (!tracking) return null;
  const ga4Id = tracking.ga4MeasurementId;
  const gtmId = tracking.gtmContainerId;
  if (!ga4Id && !gtmId) return null;
  return (
    <>
      {ga4Id ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga4Id}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-config" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga4Id}');`}
          </Script>
        </>
      ) : null}
      {gtmId ? (
        <>
          <Script id="gtm-init" strategy="afterInteractive">
            {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`}
          </Script>
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
              height="0"
              width="0"
              style={{ display: "none", visibility: "hidden" }}
            />
          </noscript>
        </>
      ) : null}
    </>
  );
}
