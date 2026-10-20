/**
 * MB4 (ML10) — ads catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the ads module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const adsCatalog: CatalogNamespace = {
  "ads.adAccountNotFoundInThis": {
    bn: "এই organization-এ ad account পাওয়া যায়নি",
    en: "Ad account not found in this organization",
  },
  "ads.anomalyMustBeAnIntegerBetween": {
    bn: "Anomaly % ১ থেকে ১০০০-এর মধ্যে পূর্ণ সংখ্যা হতে হবে",
    en: "Anomaly % must be an integer between 1 and 1000",
  },
  "ads.couldNotListMetaAdAccounts": {
    bn: "Meta ad accounts তালিকা করা যায়নি: {{p1}}",
    en: "Could not list Meta ad accounts: {{p1}}",
  },
  "ads.googleAdsSyncFailed": {
    bn: "Google Ads sync ব্যর্থ হয়েছে: {{p1}}",
    en: "Google Ads sync failed: {{p1}}",
  },
  "ads.googleAdsVerificationFailed": {
    bn: "Google Ads verification ব্যর্থ হয়েছে: {{p1}}",
    en: "Google Ads verification failed: {{p1}}",
  },
  "ads.invalidDateExpectedYyyyMmDd": {
    bn: "অবৈধ date: {{dateOnly}} (প্রত্যাশিত YYYY-MM-DD)",
    en: "Invalid date: {{dateOnly}} (expected YYYY-MM-DD)",
  },
  "ads.invalidNumber": {
    bn: "অবৈধ number: {{value}}",
    en: "Invalid number: {{value}}",
  },
  "ads.invalid": {
    bn: "অবৈধ {{field}}: {{value}}",
    en: "Invalid {{field}}: {{value}}",
  },
  "ads.metaAdInsightsSyncFailed": {
    bn: "Meta ad-insights sync ব্যর্থ হয়েছে: {{p1}}",
    en: "Meta ad-insights sync failed: {{p1}}",
  },
  "ads.metaBreakdownSyncFailed": {
    bn: "Meta breakdown sync ({{jobDimension}}) ব্যর্থ হয়েছে: {{p2}}",
    en: "Meta breakdown sync ({{jobDimension}}) failed: {{p2}}",
  },
  "ads.metaCredentialsAreMissingReconnectThe": {
    bn: "Meta credentials নেই; account-টি আবার connect করুন",
    en: "Meta credentials are missing; reconnect the account",
  },
  "ads.metaInsightsSyncFailed": {
    bn: "Meta insights sync ব্যর্থ হয়েছে: {{p1}}",
    en: "Meta insights sync failed: {{p1}}",
  },
  "ads.metaTokenVerificationFailed": {
    bn: "Meta token verification ব্যর্থ হয়েছে: {{p1}}",
    en: "Meta token verification failed: {{p1}}",
  },
  "ads.metaNoLongerShowsTheAccount": {
    bn: "Meta এই Token দিয়ে “{{accountExternalId}}” Accountটি আর দেখাচ্ছে না — সম্ভবত Token-এর Access তালিকা থেকে Accountটি সরে গেছে। পুনরায় কানেক্ট করে দেখুন।",
    en: "Meta no longer shows the \"{{accountExternalId}}\" Account with this Token — the Account has likely moved out of the Token's Access list. Reconnect and check.",
  },
  "ads.noMetaAdAccountsFoundFor": {
    bn: "এই token-এর জন্য কোনো Meta ad accounts পাওয়া যায়নি",
    en: "No Meta ad accounts found for this token",
  },
  "ads.thisAdAccountIsNotConnected": {
    bn: "এই ad account Meta-র সঙ্গে API দিয়ে connected নয়",
    en: "This ad account is not connected to Meta via API",
  },
  "ads.thisAdAccountIsNotConnected2": {
    bn: "এই ad account {{providerLabel}}-এর সঙ্গে API দিয়ে connected নয়",
    en: "This ad account is not connected to {{providerLabel}} via API",
  },
  "ads.thisIsNotAGoogleAds": {
    bn: "এটি Google Ads account নয়",
    en: "This is not a Google Ads account",
  },
  "ads.thisIsNotATiktokAds": {
    bn: "এটি TikTok Ads account নয়",
    en: "This is not a TikTok Ads account",
  },
  "ads.tiktokSyncFailed": {
    bn: "TikTok sync ব্যর্থ হয়েছে: {{p1}}",
    en: "TikTok sync failed: {{p1}}",
  },
  "ads.tiktokVerificationFailed": {
    bn: "TikTok verification ব্যর্থ হয়েছে: {{p1}}",
    en: "TikTok verification failed: {{p1}}",
  },
  "ads.dimensionMustBeAgeGenderPlacement": {
    bn: "dimension হতে হবে age_gender, placement, device, region অথবা hourly",
    en: "dimension must be age_gender, placement, device, region or hourly",
  },
  "ads.statusVerificationFailed": {
    bn: "{{platformLabel}} স্ট্যাটাস যাচাই ব্যর্থ: {{message}}",
    en: "{{platformLabel}} status verification failed: {{message}}",
  },
  "ads.credentialsAreMissingReconnectTheAccount": {
    bn: "{{providerLabel}} credentials নেই; account-টি আবার connect করুন",
    en: "{{providerLabel}} credentials are missing; reconnect the account",
  },
  "ads.thisAdAccountSSyncIs": {
    bn: "এই Ad Account-এর Sync বন্ধ রাখা হয়েছে (Sync Disabled) — Sync চালাতে আগে Account কার্ড থেকে Sync চালু করুন।",
    en: "This Ad Account's Sync is kept off (Sync Disabled) — turn Sync on from the Account card first to run Sync.",
  },
  "ads.thisAdAccountHasNoApi": {
    bn: "এই Ad Account-এর কোনো API সংযোগ নেই — প্ল্যাটফর্ম স্ট্যাটাস যাচাই করা যাবে না (CSV/Manual Account)।",
    en: "This Ad Account has no API connection — platform status cannot be verified (CSV/Manual Account).",
  },
  "ads.thisAdAccountHasNoApi2": {
    bn: "এই Ad Account-এর কোনো API সংযোগ নেই — বিচ্ছিন্ন করার মতো সংযোগ নেই (CSV/Manual Account)।",
    en: "This Ad Account has no API connection — there is no connection to disconnect (CSV/Manual Account).",
  },
  "ads.statusVerificationIsNotSupportedFor": {
    bn: "এই প্ল্যাটফর্মের ({{accountPlatform}}) স্ট্যাটাস যাচাই সমর্থিত নয়।",
    en: "Status verification is not supported for this platform ({{accountPlatform}}).",
  },
  "ads.youHaveNotBeenGivenPermission": {
    bn: "এই বিজ্ঞাপন অ্যাকাউন্টের ডেটা Sync করার অনুমতি আপনাকে দেওয়া হয়নি — Connect Center-এর অ্যাক্সেস সেটিংস দেখুন বা OWNER/ADMIN-কে বলুন।",
    en: "You have not been given permission to Sync this ad account's data — see the access settings in the Connect Center or ask an OWNER/ADMIN.",
  },
  "ads.noAdAccountHasBeenSelected": {
    bn: "কোনো Ad Account নির্বাচন করা হয়নি — অন্তত একটি Account বেছে নিন।",
    en: "No Ad Account has been selected — choose at least one Account.",
  },
  "ads.theDailyCapMustBeMore": {
    bn: "দৈনিক ক্যাপ ০-এর বেশি হতে হবে",
    en: "The daily cap must be more than 0",
  },
  "ads.yourOwnMetaAppIsNot": {
    bn: "নিজের Meta অ্যাপ কনফিগার করা নেই — আগে কানেক্ট সেন্টারে (কানেক্ট সেন্টার → নিজের অ্যাপ) আপনার Meta অ্যাপটি যোগ করুন, অথবা প্ল্যাটফর্মের অ্যাপ হিসেবে কানেক্ট করুন।",
    en: "Your own Meta app is not configured — add your Meta app in the Connect Center (Connect Center → Your App) first, or connect as the platform's app.",
  },
  "ads.theSelectedAdAccountsWereNot": {
    bn: "নির্বাচিত Ad Accountগুলো এই Token-এর অধীনে পাওয়া যায়নি — Tokenটি ওই Accountগুলোতে Access পায় কিনা যাচাই করুন।",
    en: "The selected Ad Accounts were not found under this Token — verify the Token has Access to those Accounts.",
  },
  "ads.theLabelCanBeAtMost": {
    bn: "লেবেল সর্বোচ্চ ৬০ অক্ষরের হতে পারবে।",
    en: "The label can be at most 60 characters.",
  },
};
