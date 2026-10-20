/**
 * MB4 (ML10) — social-proof catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the social-proof module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const socialProofCatalog: CatalogNamespace = {
  "socialProof.enabledMustBeTrueOrFalse": {
    bn: "enabled অবশ্যই true বা false হতে হবে",
    en: "enabled must be true or false",
  },
  "socialProof.mustBeAnIntegerBetweenAnd": {
    bn: "{{label}} {{min}}–{{max}} এর মধ্যে পূর্ণসংখ্যা হতে হবে",
    en: "{{label}} must be an integer between {{min}} and {{max}}",
  },
  "socialProof.theShopWasNotFound": {
    bn: "দোকানটি পাওয়া যায়নি",
    en: "The shop was not found",
  },
  "socialProof.theMinimumOrderValueMintotalminorMust": {
    bn: "সর্বনিম্ন অর্ডার মূল্য (minTotalMinor) ০ বা তার বেশি পূর্ণসংখ্যা পয়সায়, সংখ্যার স্ট্রিং হিসেবে দিতে হবে",
    en: "The minimum order value (minTotalMinor) must be given as a number string, as a non-negative integer in poisha",
  },
};
