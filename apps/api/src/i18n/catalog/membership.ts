/**
 * MB4 (ML10) — membership catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the membership module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const membershipCatalog: CatalogNamespace = {
  "membership.minspendminorMustBeAnIntegerOf": {
    bn: "minSpendMinor অবশ্যই শূন্য বা তার বেশি একটি পূর্ণসংখ্যা (পয়সায়) হতে হবে",
    en: "minSpendMinor must be an integer of 0 or more (in poisha)",
  },
  "membership.refundkeyIsRequiredThisKeyIs": {
    bn: "refundKey আবশ্যক — একই রিফান্ডের পুনঃচেষ্টা যাতে দ্বিতীয়বার ক্রেডিট না দেয়, তার জন্য এই চাবিটি দরকার",
    en: "refundKey is required — this key is needed so a retry of the same refund does not credit twice",
  },
  "membership.sortorderMustBeAnInteger": {
    bn: "sortOrder পূর্ণসংখ্যা হতে হবে",
    en: "sortOrder must be an integer",
  },
  "membership.mustBeAPositiveIntegerIn": {
    bn: "{{field}} অবশ্যই একটি ধনাত্মক পূর্ণসংখ্যা (পয়সায়) হতে হবে",
    en: "{{field}} must be a positive integer (in poisha)",
  },
  "membership.mustBeMoreThanZero": {
    bn: "{{field}} শূন্যের বেশি হতে হবে",
    en: "{{field}} must be more than zero",
  },
  "membership.theOrderWasNotFound": {
    bn: "অর্ডারটি পাওয়া যায়নি",
    en: "The order was not found",
  },
  "membership.noCustomerIsLinkedToThis": {
    bn: "এই অর্ডারের সাথে কোনো কাস্টমার যুক্ত নেই — স্টোর ক্রেডিট কাস্টমার-ভিত্তিক, তাই ক্রেডিটে রিফান্ড সম্ভব নয়",
    en: "No customer is linked to this order — store credit is customer-based, so a refund to credit is not possible",
  },
  "membership.thisCustomerHasBeenMergedInto": {
    bn: "এই কাস্টমারটি অন্য কাস্টমারের সাথে মার্জ হয়ে গেছে — আগে মার্জ-পরবর্তী কাস্টমার দিয়ে চেষ্টা করুন",
    en: "This customer has been merged into another customer — try again with the post-merge customer",
  },
  "membership.thisCustomerHasBeenMergedInto2": {
    bn: "এই কাস্টমারটি অন্য কাস্টমারের সাথে মার্জ হয়ে গেছে — সারভাইভর কাস্টমারে ক্রেডিট দিন",
    en: "This customer has been merged into another customer — give the credit to the survivor customer",
  },
  "membership.aTierWithThisNameAlready": {
    bn: "এই নামে ইতিমধ্যে একটি টিয়ার আছে — অন্য নাম দিন",
    en: "A tier with this name already exists — give another name",
  },
  "membership.sendAtLeastOneField": {
    bn: "কমপক্ষে একটি ক্ষেত্র পাঠান",
    en: "Send at least one field",
  },
  "membership.theCustomerWasNotFound": {
    bn: "কাস্টমার পাওয়া যায়নি",
    en: "The customer was not found",
  },
  "membership.aReasonForGivingCreditNote": {
    bn: "ক্রেডিট দেওয়ার কারণ (note) আবশ্যক",
    en: "A reason for giving credit (note) is required",
  },
  "membership.theTierNameIsRequired": {
    bn: "টিয়ারের নাম আবশ্যক",
    en: "The tier name is required",
  },
  "membership.theMembershipTierWasNotFound": {
    bn: "মেম্বারশিপ টিয়ারটি পাওয়া যায়নি",
    en: "The membership tier was not found",
  },
  "membership.theRefundAmountCannotExceedThe": {
    bn: "রিফান্ডের পরিমাণ অর্ডারের অবশিষ্ট রিফান্ডযোগ্য পরিমাণের বেশি হতে পারবে না",
    en: "The refund amount cannot exceed the order's remaining refundable amount",
  },
  "membership.refundToStoreCreditIsNot": {
    bn: "স্টোর ক্রেডিটে রিফান্ড এই দোকানে চালু নেই — Store settings-এ Refund-to-Credit চালু করলেই এই অপশনটি পাওয়া যাবে",
    en: "Refund to store credit is not enabled in this shop — this option will be available once Refund-to-Credit is turned on in Store settings",
  },
};
