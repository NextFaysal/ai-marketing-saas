/**
 * MB4 (ML10) — customers catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the customers module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const customersCatalog: CatalogNamespace = {
  "customers.customFieldsAreNotAvailableIn": {
    bn: "এই deployment-এ custom fields পাওয়া যাচ্ছে না",
    en: "Custom fields are not available in this deployment",
  },
  "customers.customerNotFoundInThisOrganization": {
    bn: "এই organization-এ customer পাওয়া যায়নি",
    en: "Customer not found in this organization",
  },
  "customers.segmentNotFoundInThisOrganization": {
    bn: "এই organization-এ segment পাওয়া যায়নি",
    en: "Segment not found in this organization",
  },
  "customers.segmentsAreNotAvailableInThis": {
    bn: "এই deployment-এ segments পাওয়া যাচ্ছে না",
    en: "Segments are not available in this deployment",
  },
  "customers.sourceAndTargetMustDiffer": {
    bn: "Source ও target আলাদা হতে হবে",
    en: "Source and target must differ",
  },
  "customers.sourceCustomerWasAlreadyMerged": {
    bn: "Source customer ইতিমধ্যে merged হয়েছে",
    en: "Source customer was already merged",
  },
  "customers.survivingCustomerNotFoundInThis": {
    bn: "এই organization-এ surviving customer পাওয়া যায়নি",
    en: "Surviving customer not found in this organization",
  },
  "customers.targetCustomerWasItselfMergedInto": {
    bn: "Target customer নিজেই অন্য একটি record-এ merged হয়েছে",
    en: "Target customer was itself merged into another record",
  },
  "customers.districtMustBe1100Characters": {
    bn: "district ১–১০০ অক্ষরের হতে হবে",
    en: "district must be 1–100 characters",
  },
  "customers.isrepeatMustBeBoolean": {
    bn: "isRepeat অবশ্যই boolean হতে হবে",
    en: "isRepeat must be boolean",
  },
  "customers.isvipMustBeBoolean": {
    bn: "isVip অবশ্যই boolean হতে হবে",
    en: "isVip must be boolean",
  },
  "customers.minspentminorMustBeAnIntegerOf": {
    bn: "minSpentMinor অবশ্যই শূন্য বা তার বেশি একটি পূর্ণসংখ্যা (পয়সায়) হতে হবে",
    en: "minSpentMinor must be an integer of 0 or more (in poisha)",
  },
  "customers.tagsMustBeAListArray": {
    bn: "tags একটি তালিকা (array) হতে হবে",
    en: "tags must be a list (array)",
  },
  "customers.tagsanyMustBeAListArray": {
    bn: "tagsAny একটি তালিকা (array) হতে হবে",
    en: "tagsAny must be a list (array)",
  },
  "customers.eachTagInTagsanyMustBe": {
    bn: "tagsAny-এর প্রতিটি ট্যাগ ১–৩০ অক্ষরের হতে হবে",
    en: "Each tag in tagsAny must be 1–30 characters",
  },
  "customers.atMost10TagsCanBe": {
    bn: "tagsAny-তে সর্বোচ্চ ১০টি ট্যাগ দেওয়া যাবে",
    en: "At most 10 tags can be given in tagsAny",
  },
  "customers.unknownSegmentCriteriaAllowed": {
    bn: "অজানা segment criteria: \"{{key}}\" — অনুমোদিত: {{p2}}",
    en: "Unknown segment criteria: \"{{key}}\" — allowed: {{p2}}",
  },
  "customers.thisCustomerRecordIsNotMerged": {
    bn: "এই Customer রেকর্ডটি কারো সাথে মার্জ করা নেই — undo করার কিছু নেই।",
    en: "This Customer record is not merged with anyone — there is nothing to undo.",
  },
  "customers.thisMergePredatesIn2ThereIs": {
    bn: "এই মার্জটি IN2-এর আগের — কোনো merge record নেই, তাই স্বয়ংক্রিয়ভাবে undo করা যাবে না।",
    en: "This merge predates IN2 — there is no merge record, so it cannot be undone automatically.",
  },
  "customers.noCustomerWasFoundInThis": {
    bn: "এই সংগঠনে কাস্টমার পাওয়া যায়নি।",
    en: "No customer was found in this organization.",
  },
  "customers.theCustomerGroupWasNotFound": {
    bn: "কাস্টমার গ্রুপটি পাওয়া যায়নি — এই সংস্থার একটি গ্রুপ বেছে নিন",
    en: "The customer group was not found — choose a group of this organization",
  },
  "customers.theCreditLimitIsNotValid": {
    bn: "ক্রেডিট লিমিট সঠিক নয় — creditLimitMinor অবশ্যই শূন্য বা তার বেশি একটি পূর্ণসংখ্যা (পয়সায়) হতে হবে, অথবা লিমিট মুছতে null দিন।",
    en: "The credit limit is not valid — creditLimitMinor must be an integer of 0 or more (in poisha), or give null to clear the limit.",
  },
  "customers.theCreditTermMustBeAn": {
    bn: "ক্রেডিটের মেয়াদ ০–৯০ দিনের মধ্যে একটি পূর্ণসংখ্যা হতে হবে",
    en: "The credit term must be an integer between 0 and 90 days",
  },
  "customers.theNoteCanBeAtMost": {
    bn: "নোট সর্বোচ্চ ১০,০০০ অক্ষরের হতে হবে",
    en: "The note can be at most 10,000 characters",
  },
  "customers.eachTagMustBe130": {
    bn: "প্রতিটি ট্যাগ ১–৩০ অক্ষরের হতে হবে",
    en: "Each tag must be 1–30 characters",
  },
  "customers.theBlockReasonCanBeAt": {
    bn: "ব্লকের কারণ সর্বোচ্চ ৩০০ অক্ষরের হতে হবে",
    en: "The block reason can be at most 300 characters",
  },
  "customers.atMost10TagsCanBe2": {
    bn: "সর্বোচ্চ ১০টি ট্যাগ দেওয়া যাবে",
    en: "At most 10 tags can be given",
  },
  "customers.theSegmentCriteriaMustBeAn": {
    bn: "সেগমেন্টের criteria অবশ্যই একটি object হতে হবে",
    en: "The segment criteria must be an object",
  },
  "customers.theSegmentNameMustBe1": {
    bn: "সেগমেন্টের নাম ১–১২০ অক্ষরের হতে হবে",
    en: "The segment name must be 1–120 characters",
  },
};
