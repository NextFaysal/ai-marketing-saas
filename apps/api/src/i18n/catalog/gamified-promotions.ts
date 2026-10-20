/**
 * MB4 (ML10) — gamified-promotions catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the gamified-promotions module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const gamifiedPromotionsCatalog: CatalogNamespace = {
  "gamifiedPromotions.isNotAValidDate": {
    bn: "{{label}} সঠিক তারিখ নয়",
    en: "{{label}} is not a valid date",
  },
  "gamifiedPromotions.theAnswerIsNotCorrect": {
    bn: "উত্তর সঠিক নয়",
    en: "The answer is not correct",
  },
  "gamifiedPromotions.thisNumberIsBlockedInThis": {
    bn: "এই নম্বরটি এই দোকানে ব্লক করা আছে — অংশ নেওয়া যাবে না",
    en: "This number is blocked in this shop — cannot participate",
  },
  "gamifiedPromotions.theCampaignIsNotActiveNow": {
    bn: "ক্যাম্পেইনটি এখন সক্রিয় নয়",
    en: "The campaign is not active now",
  },
  "gamifiedPromotions.theCampaignHasNotStartedYet": {
    bn: "ক্যাম্পেইনটি এখনো শুরু হয়নি",
    en: "The campaign has not started yet",
  },
  "gamifiedPromotions.theCampaignWasNotFound": {
    bn: "ক্যাম্পেইনটি পাওয়া যায়নি",
    en: "The campaign was not found",
  },
  "gamifiedPromotions.theCampaignSTimeHasEnded": {
    bn: "ক্যাম্পেইনটির সময় শেষ হয়ে গেছে",
    en: "The campaign's time has ended",
  },
  "gamifiedPromotions.theCampaignTypeIsNotValid": {
    bn: "ক্যাম্পেইনের ধরন সঠিক নয় (spin_wheel | quiz | group_buy)",
    en: "The campaign type is not valid (spin_wheel | quiz | group_buy)",
  },
  "gamifiedPromotions.theCampaignNameIsRequired": {
    bn: "ক্যাম্পেইনের নাম আবশ্যক",
    en: "The campaign name is required",
  },
  "gamifiedPromotions.anEndTimeWindowIsRequired": {
    bn: "গ্রুপ বাইয়ের জন্য শেষের সময় (উইন্ডো) আবশ্যক",
    en: "An end time (window) is required for group buy",
  },
  "gamifiedPromotions.theShopWasNotFound": {
    bn: "দোকানটি পাওয়া যায়নি",
    en: "The shop was not found",
  },
  "gamifiedPromotions.theProductWasNotFoundIn": {
    bn: "পণ্যটি এই দোকানের ক্যাটালগে পাওয়া যায়নি",
    en: "The product was not found in this shop's catalog",
  },
  "gamifiedPromotions.whereThePopupShowsIsNot": {
    bn: "পপআপ কোথায় দেখাবে তা সঠিক নয়",
    en: "Where the popup shows is not valid",
  },
  "gamifiedPromotions.thePopupTriggerIsNotValid": {
    bn: "পপআপ ট্রিগার সঠিক নয়",
    en: "The popup trigger is not valid",
  },
  "gamifiedPromotions.thePopupTimePercentageIsNot": {
    bn: "পপআপের সময়/শতাংশ সঠিক নয়",
    en: "The popup time/percentage is not valid",
  },
  "gamifiedPromotions.theEndTimeMustBeAfter": {
    bn: "শেষের সময় শুরুর সময়ের পরে হতে হবে",
    en: "The end time must be after the start time",
  },
  "gamifiedPromotions.giveAValidBangladeshiMobileNumber": {
    bn: "সঠিক বাংলাদেশি মোবাইল নম্বর দিন",
    en: "Give a valid Bangladeshi mobile number",
  },
  "gamifiedPromotions.allQuestionsMustBeAnswered": {
    bn: "সব প্রশ্নের উত্তর দিতে হবে",
    en: "All questions must be answered",
  },
};
