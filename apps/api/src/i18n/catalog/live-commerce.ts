/**
 * MB4 (ML10) — live-commerce catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the live-commerce module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const liveCommerceCatalog: CatalogNamespace = {
  "liveCommerce.theLiveSessionWasNotFound": {
    bn: "Live সেশনটি পাওয়া যায়নি",
    en: "The Live session was not found",
  },
  "liveCommerce.bothSocialaccountidAndExternallivevideoidAreRequired": {
    bn: "Meta সেশনের জন্য socialAccountId ও externalLiveVideoId দুটোই আবশ্যক",
    en: "Both socialAccountId and externalLiveVideoId are required for a Meta session",
  },
  "liveCommerce.theSocialAccountDoesNotBelong": {
    bn: "Social অ্যাকাউন্টটি এই দোকানের নয় বা পাওয়া যায়নি",
    en: "The Social account does not belong to this shop or was not found",
  },
  "liveCommerce.theAudienceCreationFacilityIsNot": {
    bn: "অডিয়েন্স তৈরির সুবিধা এই deployment-এ নেই",
    en: "The audience creation facility is not available in this deployment",
  },
  "liveCommerce.atLeastOneItemIsRequired": {
    bn: "অন্তত একটি আইটেম আবশ্যক",
    en: "At least one item is required",
  },
  "liveCommerce.theOrderWasCreatedButIts": {
    bn: "অর্ডার তৈরি হলেও তার ID পাওয়া যায়নি",
    en: "The order was created but its ID was not received",
  },
  "liveCommerce.theOrderCreationFacilityIsNot": {
    bn: "অর্ডার তৈরির সুবিধা এই deployment-এ নেই",
    en: "The order creation facility is not available in this deployment",
  },
  "liveCommerce.sendACommentCommenternameAndMessage": {
    bn: "কমেন্ট পাঠান — commenterName ও message আবশ্যক",
    en: "Send a comment — commenterName and message are required",
  },
  "liveCommerce.theCommentWasNotFoundIn": {
    bn: "কমেন্টটি এই সেশনে পাওয়া যায়নি",
    en: "The comment was not found in this session",
  },
  "liveCommerce.someProductsDoNotBelongTo": {
    bn: "কিছু পণ্য এই দোকানের নয় বা পাওয়া যায়নি",
    en: "Some products do not belong to this shop or were not found",
  },
  "liveCommerce.theBuyerSPhoneNumberIs": {
    bn: "ক্রেতার ফোন নম্বর আবশ্যক",
    en: "The buyer's phone number is required",
  },
  "liveCommerce.theProductIsNotPinnedIn": {
    bn: "পণ্যটি এই সেশনে পিন করা নেই",
    en: "The product is not pinned in this session",
  },
  "liveCommerce.commenternameAndMessageAreRequiredIn": {
    bn: "প্রতিটি কমেন্টে commenterName ও message আবশ্যক",
    en: "commenterName and message are required in every comment",
  },
  "liveCommerce.anEndedSessionCannotBeStarted": {
    bn: "শেষ হয়ে যাওয়া সেশন আবার শুরু করা যাবে না",
    en: "An ended session cannot be started again",
  },
  "liveCommerce.theSessionTitleIsRequired": {
    bn: "সেশনের শিরোনাম আবশ্যক",
    en: "The session title is required",
  },
};
