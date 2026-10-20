/**
 * MB4 (ML10) — offline-conversions catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the offline-conversions module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const offlineConversionsCatalog: CatalogNamespace = {
  "offlineConversions.adAccountIsNotConnectedVia": {
    bn: "Ad account API দিয়ে connected নয়",
    en: "Ad account is not connected via API",
  },
  "offlineConversions.adAccountNotFound": {
    bn: "Ad account পাওয়া যায়নি",
    en: "Ad account not found",
  },
  "offlineConversions.googleNeedsTheOfflineConversionAction": {
    bn: "Google-এর জন্য offline conversion action id লাগবে (Google Ads > Goals > Conversions থেকে)",
    en: "Google needs the offline conversion action id (from Google Ads > Goals > Conversions)",
  },
  "offlineConversions.integrationCredentialsAreMissingReconnectThe": {
    bn: "Integration credentials নেই; account-টি আবার connect করুন",
    en: "Integration credentials are missing; reconnect the account",
  },
  "offlineConversions.invalidTrigger": {
    bn: "অবৈধ trigger",
    en: "Invalid trigger",
  },
  "offlineConversions.metaNeedsTheDatasetPixelId": {
    bn: "Meta-র জন্য সেই dataset (pixel) id লাগবে যা offline events গ্রহণ করে (Events Manager > Data sources)",
    en: "Meta needs the dataset (pixel) id that receives offline events (Events Manager > Data sources)",
  },
  "offlineConversions.noOfflineConversionSettingSaved": {
    bn: "কোনো {{platform}} offline conversion setting সেভ করা নেই",
    en: "No {{platform}} offline conversion setting saved",
  },
  "offlineConversions.orderNotFound": {
    bn: "Order পাওয়া যায়নি",
    en: "Order not found",
  },
  "offlineConversions.thatAdAccountIsAAccount": {
    bn: "সেই ad account একটি {{accountPlatform}} account, {{platform}} নয়",
    en: "That ad account is a {{accountPlatform}} account, not {{platform}}",
  },
  "offlineConversions.tiktokNeedsTheEventsApiPixel": {
    bn: "TikTok-এর জন্য Events API pixel code লাগবে",
    en: "TikTok needs the Events API pixel code",
  },
  "offlineConversions.metaUploadDidNotConfirm": {
    bn: "meta upload confirm করেনি: {{message}}",
    en: "meta upload did NOT confirm: {{message}}",
  },
  "offlineConversions.platformMustBeGoogleTiktokOr": {
    bn: "platform হতে হবে google, tiktok অথবা meta",
    en: "platform must be google, tiktok or meta",
  },
  "offlineConversions.offlineConversionsAreDisabled": {
    bn: "{{platform}} offline conversions বন্ধ আছে",
    en: "{{platform}} offline conversions are disabled",
  },
  "offlineConversions.uploadDidNotConfirm": {
    bn: "{{platform}} upload confirm করেনি: {{message}}",
    en: "{{platform}} upload did NOT confirm: {{message}}",
  },
};
