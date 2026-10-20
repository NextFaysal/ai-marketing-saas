/**
 * MB4 (ML10) — competitors catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the competitors module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const competitorsCatalog: CatalogNamespace = {
  "competitors.aSourceUrlIsRequiredAs": {
    bn: "প্রতিটি price observation-এর প্রমাণ হিসেবে একটি source URL দরকার",
    en: "A source URL is required as evidence for every price observation",
  },
  "competitors.adDoesNotBelongToThis": {
    bn: "Ad এই organization-এর নয়",
    en: "Ad does not belong to this organization",
  },
  "competitors.competitorAdNotFound": {
    bn: "Competitor ad পাওয়া যায়নি",
    en: "Competitor ad not found",
  },
  "competitors.competitorAdNotFound2": {
    bn: "Competitor ad {{dtoCompetitorAdId}} পাওয়া যায়নি",
    en: "Competitor ad {{dtoCompetitorAdId}} not found",
  },
  "competitors.competitorNotFoundInThisOrganization": {
    bn: "এই organization-এ competitor পাওয়া যায়নি",
    en: "Competitor not found in this organization",
  },
  "competitors.noAdLibraryAccessTokenAvailable": {
    bn: "কোনো Ad Library access token পাওয়া যাচ্ছে না। Platform admin-কে Admin Console-এ একটি সেট করতে বলুন, Meta connect করুন (Milestone 5), অথবা FACEBOOK_AD_LIBRARY_TOKEN সেট করুন। আপনার দেশের উপর নির্ভর করে Meta-র একটি identity-confirmed user token লাগতে পারে।",
    en: "No Ad Library access token available. Ask the platform admin to set one in the Admin Console, connect Meta (Milestone 5), or set FACEBOOK_AD_LIBRARY_TOKEN. Meta may require an identity-confirmed user token depending on your country.",
  },
  "competitors.noCompetitorEvidenceCollectedYetSync": {
    bn: "এখনো কোনো competitor evidence সংগ্রহ হয়নি। আগে ads sync করুন অথবা prices scan/add করুন — প্রমাণ ছাড়া insights কখনো তৈরি হয় না।",
    en: "No competitor evidence collected yet. Sync ads or scan/add prices first - insights are never generated without evidence.",
  },
  "competitors.telegramBotTokenAndChatId": {
    bn: "Telegram Bot Token এবং Chat ID প্রয়োজন।",
    en: "Telegram Bot Token and Chat ID are required.",
  },
  "competitors.thisCompetitorHasNoWebsiteUrl": {
    bn: "এই competitor-এর কোনো website URL নেই",
    en: "This competitor has no website URL",
  },
  "competitors.whatsappWebhookUrlIsRequired": {
    bn: "WhatsApp Webhook URL প্রয়োজন।",
    en: "WhatsApp Webhook URL is required.",
  },
};
