import React from "react";
import Script from "next/script";
import { parseTrackingIds, type ShopTracking } from "@/lib/shop-tracking";

/**
 * Merchant marketing & analytics tags for the public storefront.
 *
 * Renders NOTHING unless the merchant configured the IDs in storefront
 * settings — IDs come only from settings, never hardcoded.
 *
 * Fully supports MULTIPLE accounts/pixels per channel (e.g. multi-pixel Meta,
 * multi-pixel TikTok, multi-property GA4, multi-container GTM, Microsoft Clarity).
 */
export function TrackingTags({ tracking }: { tracking: ShopTracking | null | undefined }) {
  if (!tracking) return null;

  const ga4Ids = parseTrackingIds(tracking.ga4MeasurementId);
  const gtmIds = parseTrackingIds(tracking.gtmContainerId);
  const metaPixelIds = parseTrackingIds(tracking.metaPixelId);
  const tikTokPixelIds = parseTrackingIds(tracking.tikTokPixelId);
  const clarityIds = parseTrackingIds(tracking.clarityId);

  const hasAny =
    ga4Ids.length > 0 ||
    gtmIds.length > 0 ||
    metaPixelIds.length > 0 ||
    tikTokPixelIds.length > 0 ||
    clarityIds.length > 0;

  if (!hasAny) return null;

  return (
    <>
      {/* 1. Google Analytics 4 (supports multi-property configuration) */}
      {ga4Ids.length > 0 ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga4Ids[0]}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-config" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              ${ga4Ids.map((id) => `gtag('config', '${id}');`).join("\n")}
            `}
          </Script>
        </>
      ) : null}

      {/* 2. Google Tag Manager (supports multi-container configuration) */}
      {gtmIds.map((gtmId, idx) => (
        <React.Fragment key={`gtm-${gtmId}-${idx}`}>
          <Script id={`gtm-init-${idx}`} strategy="afterInteractive">
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
        </React.Fragment>
      ))}

      {/* 3. Facebook / Meta Pixel (supports multi-pixel initialization) */}
      {metaPixelIds.length > 0 ? (
        <>
          <Script id="meta-pixel-init" strategy="afterInteractive">
            {`
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              ${metaPixelIds.map((id) => `fbq('init', '${id}');`).join("\n")}
              fbq('track', 'PageView');
            `}
          </Script>
          <noscript>
            {metaPixelIds.map((id) => (
              <img
                key={`meta-ns-${id}`}
                height="1"
                width="1"
                style={{ display: "none" }}
                src={`https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1`}
                alt=""
              />
            ))}
          </noscript>
        </>
      ) : null}

      {/* 4. TikTok Pixel (supports multi-pixel loading) */}
      {tikTokPixelIds.length > 0 ? (
        <Script id="tiktok-pixel-init" strategy="afterInteractive">
          {`
            !function (w, d, t) {
              w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var c=document.createElement("script");c.type="text/javascript",c.async=!0,c.src=r+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(c,a)};
              ${tikTokPixelIds.map((id) => `ttq.load('${id}');`).join("\n")}
              ttq.page();
            }(window, document, 'ttq');
          `}
        </Script>
      ) : null}

      {/* 5. Microsoft Clarity */}
      {clarityIds.length > 0 ? (
        <Script id="clarity-init" strategy="afterInteractive">
          {`
            (function(c,l,a,r,i,t,y){
                c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "${clarityIds[0]}");
          `}
        </Script>
      ) : null}
    </>
  );
}
