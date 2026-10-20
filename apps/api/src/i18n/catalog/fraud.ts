/**
 * MB4 (ML10) — fraud catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the fraud module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const fraudCatalog: CatalogNamespace = {
  "fraud.blockedPhoneNotFoundInThis": {
    bn: "এই organization-এ blocked phone পাওয়া যায়নি",
    en: "Blocked phone not found in this organization",
  },
  "fraud.fraudRuleNotFoundInThis": {
    bn: "এই organization-এ fraud rule পাওয়া যায়নি",
    en: "Fraud rule not found in this organization",
  },
  "fraud.identifierNotFoundInThisOrganization": {
    bn: "এই organization-এ identifier পাওয়া যায়নি",
    en: "Identifier not found in this organization",
  },
  "fraud.actionMustBeHoldTagOr": {
    bn: "action হতে হবে hold, tag অথবা block_checkout",
    en: "action must be hold, tag or block_checkout",
  },
  "fraud.districtinMustBeAListOf": {
    bn: "districtIn সর্বোচ্চ ৬৪টি জেলার তালিকা হতে হবে",
    en: "districtIn must be a list of at most 64 districts",
  },
  "fraud.eachDistrictNameInDistrictinMust": {
    bn: "districtIn-এর প্রতিটি জেলার নাম সর্বোচ্চ ৮০ অক্ষরের হতে হবে",
    en: "Each district name in districtIn must be at most 80 characters",
  },
  "fraud.enabledMustBeBoolean": {
    bn: "enabled boolean হতে হবে",
    en: "enabled must be boolean",
  },
  "fraud.iscodMustBeBoolean": {
    bn: "isCod boolean হতে হবে",
    en: "isCod must be boolean",
  },
  "fraud.minriskscoreMustBeAnIntegerBetween": {
    bn: "minRiskScore ০–১০০ এর মধ্যে পূর্ণসংখ্যা হতে হবে",
    en: "minRiskScore must be an integer between 0 and 100",
  },
  "fraud.sendMintotalminorAsAProperNumber": {
    bn: "minTotalMinor সঠিক সংখ্যায় পাঠান (পয়সায়)",
    en: "Send minTotalMinor as a proper number (in poisha)",
  },
  "fraud.phoneopenordersgteMustBeAnIntegerBetween": {
    bn: "phoneOpenOrdersGte ১–১০০ এর মধ্যে পূর্ণসংখ্যা হতে হবে",
    en: "phoneOpenOrdersGte must be an integer between 1 and 100",
  },
  "fraud.forATagActionTagvalueMust": {
    bn: "tag অ্যাকশনের জন্য tagValue ১–৩০ অক্ষরের হতে হবে",
    en: "For a tag action, tagValue must be 1–30 characters",
  },
  "fraud.unknownCondition": {
    bn: "অজানা শর্ত: {{key}}",
    en: "Unknown condition: {{key}}",
  },
  "fraud.alreadyOnTheList": {
    bn: "ইতিমধ্যে তালিকায় আছে",
    en: "Already on the list",
  },
  "fraud.thisNumberIsAlreadyOnThe": {
    bn: "এই নম্বরটি ইতিমধ্যে ব্লকলিস্টে আছে",
    en: "This number is already on the blocklist",
  },
  "fraud.theListFacilityIsNotAvailable": {
    bn: "তালিকা সুবিধাটি এই ডিপ্লয়মেন্টে নেই",
    en: "The list facility is not available in this deployment",
  },
  "fraud.invalidTypeSendPhoneEmailIp": {
    bn: "ধরন সঠিক নয় — phone, email, ip অথবা device পাঠান",
    en: "Invalid type — send phone, email, ip or device",
  },
  "fraud.theRuleNameMustBe1": {
    bn: "নিয়মের নাম ১–১২০ অক্ষরের হতে হবে",
    en: "The rule name must be 1–120 characters",
  },
  "fraud.thePhoneNumberIsNotA": {
    bn: "ফোন নম্বরটি সঠিক বাংলাদেশি মোবাইল নম্বর নয়",
    en: "The phone number is not a valid Bangladeshi mobile number",
  },
  "fraud.theFraudRuleFacilityIsNot": {
    bn: "ফ্রড নিয়ম সুবিধাটি এই ডিপ্লয়মেন্টে নেই",
    en: "The fraud rule facility is not available in this deployment",
  },
  "fraud.theBlocklistFacilityIsNotAvailable": {
    bn: "ব্লকলিস্ট সুবিধাটি এই ডিপ্লয়মেন্টে নেই",
    en: "The blocklist facility is not available in this deployment",
  },
  "fraud.theConditionsMustBeAnObject": {
    bn: "শর্তগুলো একটি অবজেক্ট হতে হবে",
    en: "The conditions must be an object",
  },
};
