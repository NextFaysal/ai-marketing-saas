/**
 * MB4 (ML10) — publishing catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the publishing module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const publishingCatalog: CatalogNamespace = {
  "publishing.aSearchCampaignNeedsAtLeast": {
    bn: "Search campaign-এর জন্য কমপক্ষে ১টি keyword লাগে — keyword ছাড়া এটি serve করতে পারে না",
    en: "A Search campaign needs at least 1 keyword — without keywords it cannot serve",
  },
  "publishing.aLogoImageUrlIsRequired": {
    bn: "একটি logo image URL দরকার",
    en: "A logo image URL is required",
  },
  "publishing.adAccountNotFound": {
    bn: "Ad account পাওয়া যায়নি",
    en: "Ad account not found",
  },
  "publishing.atLeastOneCountryIsRequired": {
    bn: "কমপক্ষে একটি country দরকার",
    en: "At least one country is required",
  },
  "publishing.atMost100KeywordsPerAd": {
    bn: "এই flow-তে প্রতি ad group-এ সর্বোচ্চ ১০০টি keyword",
    en: "At most 100 keywords per ad group in this flow",
  },
  "publishing.businessNameIsRequiredMax25": {
    bn: "Business name দরকার (সর্বোচ্চ ২৫ অক্ষর)",
    en: "Business name is required (max 25 characters)",
  },
  "publishing.calloutTextIsLimitedTo25": {
    bn: "Callout text ২৫ অক্ষরে সীমিত",
    en: "Callout text is limited to 25 characters",
  },
  "publishing.eachKeywordNeedsTextOfAt": {
    bn: "প্রতিটি keyword-এর text সর্বোচ্চ ৮০ অক্ষরের লাগে",
    en: "Each keyword needs text of at most 80 characters",
  },
  "publishing.googleRsaNeedsAtLeast2": {
    bn: "Google RSA-র জন্য কমপক্ষে ২টি description লাগে",
    en: "Google RSA needs at least 2 descriptions",
  },
  "publishing.googleRsaNeedsAtLeast3": {
    bn: "Google RSA-র জন্য কমপক্ষে ৩টি headline লাগে",
    en: "Google RSA needs at least 3 headlines",
  },
  "publishing.googleDescriptionsAreLimitedTo90": {
    bn: "Google descriptions ৯০ অক্ষরে সীমিত",
    en: "Google descriptions are limited to 90 characters",
  },
  "publishing.googleHeadlinesAreLimitedTo30": {
    bn: "Google headlines ৩০ অক্ষরে সীমিত",
    en: "Google headlines are limited to 30 characters",
  },
  "publishing.imageUrlsMustBeHttpS": {
    bn: "Image URLs http(s) URLs হতে হবে",
    en: "Image URLs must be http(s) URLs",
  },
  "publishing.invalidMatchType": {
    bn: "অবৈধ match type: {{kwMatchType}}",
    en: "Invalid match type: {{kwMatchType}}",
  },
  "publishing.pmaxDescriptionsAreLimitedTo90": {
    bn: "PMax descriptions ৯০ অক্ষরে সীমিত",
    en: "PMax descriptions are limited to 90 characters",
  },
  "publishing.pmaxHeadlinesAreLimitedTo30": {
    bn: "PMax headlines ৩০ অক্ষরে সীমিত",
    en: "PMax headlines are limited to 30 characters",
  },
  "publishing.pmaxLongHeadlinesAreLimitedTo": {
    bn: "PMax long headlines ৯০ অক্ষরে সীমিত",
    en: "PMax long headlines are limited to 90 characters",
  },
  "publishing.performanceMaxNeeds120Marketing": {
    bn: "Performance Max-এর জন্য 1-20টি marketing image URL লাগে",
    en: "Performance Max needs 1-20 marketing image URLs",
  },
  "publishing.performanceMaxNeeds15Long": {
    bn: "Performance Max-এর জন্য 1-5টি long headline লাগে",
    en: "Performance Max needs 1-5 long headlines",
  },
  "publishing.performanceMaxNeeds25Descriptions": {
    bn: "Performance Max-এর জন্য 2-5টি description লাগে",
    en: "Performance Max needs 2-5 descriptions",
  },
  "publishing.performanceMaxNeeds315Headlines": {
    bn: "Performance Max-এর জন্য 3-15টি headline লাগে",
    en: "Performance Max needs 3-15 headlines",
  },
  "publishing.provideAnImageUrlOrA": {
    bn: "Creative-এর জন্য একটি image URL অথবা একটি video URL দিন",
    en: "Provide an image URL or a video URL for the creative",
  },
  "publishing.sitelinkUrlMustBeAnHttp": {
    bn: "Sitelink URL একটি http(s) URL হতে হবে",
    en: "Sitelink URL must be an http(s) URL",
  },
  "publishing.sitelinkTextIsLimitedTo25": {
    bn: "Sitelink text ২৫ অক্ষরে সীমিত",
    en: "Sitelink text is limited to 25 characters",
  },
  "publishing.thisAdAccountIsNotConnected": {
    bn: "এই ad account {{platform}}-এর সঙ্গে API দিয়ে connected নয়",
    en: "This ad account is not connected to {{platform}} via API",
  },
  "publishing.tiktokLeadGenerationNeedsAnInstant": {
    bn: "TikTok LEAD_GENERATION-এর জন্য ad-এর সঙ্গে একটি Instant Form bound লাগে — এই publishing flow website creatives তৈরি করে এবং সেটি দিতে পারে না, তাই create call-টি ব্যর্থ হতে পাঠানোর বদলে প্রত্যাখ্যান করা হলো",
    en: "TikTok LEAD_GENERATION needs an Instant Form bound to the ad — this publishing flow creates website creatives and cannot supply one, so the create call is refused rather than sent to fail",
  },
  "publishing.tiktokWebConversionsNeedsAPixelid": {
    bn: "TikTok WEB_CONVERSIONS-এর জন্য একটি pixelId ও একটি optimizationEvent লাগে (ad group সেই pixel event-এর উপর optimize করে)",
    en: "TikTok WEB_CONVERSIONS needs a pixelId and an optimizationEvent (the ad group optimizes on that pixel event)",
  },
  "publishing.unsupportedTiktokObjectiveForThisFlow": {
    bn: "এই flow-এর জন্য অসমর্থিত TikTok objective: {{objective}} (TRAFFIC | WEB_CONVERSIONS | LEAD_GENERATION)",
    en: "Unsupported TikTok objective for this flow: {{objective}} (TRAFFIC | WEB_CONVERSIONS | LEAD_GENERATION)",
  },
  "publishing.unsupportedCrossPlatformLifecyclePlatformGoogle": {
    bn: "অসমর্থিত cross-platform lifecycle platform: {{platform}} (google | tiktok)",
    en: "Unsupported cross-platform lifecycle platform: {{platform}} (google | tiktok)",
  },
  "publishing.unsupportedCrossPlatformStatusPlatformGoogle": {
    bn: "অসমর্থিত cross-platform status platform: {{platform}} (google | tiktok)",
    en: "Unsupported cross-platform status platform: {{platform}} (google | tiktok)",
  },
  "publishing.dailybudgetMustBeAPositiveAmount": {
    bn: "dailyBudget একটি ধনাত্মক পরিমাণ হতে হবে",
    en: "dailyBudget must be a positive amount",
  },
  "publishing.externalcampaignidIsRequiredToChangeCampaign": {
    bn: "campaign status বদলাতে externalCampaignId দরকার",
    en: "externalCampaignId is required to change campaign status",
  },
  "publishing.externalcampaignidIsRequiredToReadCampaign": {
    bn: "campaign status পড়তে externalCampaignId দরকার",
    en: "externalCampaignId is required to read campaign status",
  },
  "publishing.googleCredentialsAreMissingClientidClientsecret": {
    bn: "google credentials-এ clientId/clientSecret/refreshToken/developerToken নেই; account-টি আবার connect করুন",
    en: "google credentials are missing clientId/clientSecret/refreshToken/developerToken; reconnect the account",
  },
  "publishing.targetMustBeActiveOrPaused": {
    bn: "target হতে হবে ACTIVE অথবা PAUSED (পাওয়া গেছে \"{{target}}\")",
    en: "target must be ACTIVE or PAUSED (got \"{{target}}\")",
  },
  "publishing.tiktokCredentialsAreMissingAccesstokenReconnect": {
    bn: "tiktok credentials-এ accessToken নেই; account-টি আবার connect করুন",
    en: "tiktok credentials are missing accessToken; reconnect the account",
  },
  "publishing.credentialsAreMissingReconnectTheAccount": {
    bn: "{{platform}} credentials নেই; account-টি আবার connect করুন",
    en: "{{platform}} credentials are missing; reconnect the account",
  },
};
