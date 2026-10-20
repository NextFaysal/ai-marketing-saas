/**
 * MB4 (ML10) — affiliates catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the affiliates module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const affiliatesCatalog: CatalogNamespace = {
  "affiliates.affiliatePartnerNotFoundInThis": {
    bn: "এই organization-এ affiliate partner পাওয়া যায়নি",
    en: "Affiliate partner not found in this organization",
  },
  "affiliates.forABankPayoutTheAccount": {
    bn: "Bank payout-এর জন্য destination-এ অ্যাকাউন্ট নম্বর ও ব্যাংকের নাম প্রয়োজন।",
    en: "For a Bank payout, the account number and bank name are required in the destination.",
  },
  "affiliates.commissionEntryNotFoundInThis": {
    bn: "এই organization-এ commission entry পাওয়া যায়নি",
    en: "Commission entry not found in this organization",
  },
  "affiliates.aConfirmedExecutionCannotBeMarked": {
    bn: "Confirmed execution-কে failed করা যাবে না — টাকা ইতিমধ্যে বেরিয়ে গেছে হিসেবে রেকর্ড আছে।",
    en: "A confirmed execution cannot be marked failed — the money is recorded as already gone out.",
  },
  "affiliates.toConfirmAnExecutionTheBank": {
    bn: "Execution confirm করতে হলে ব্যাংকের reference (bankReference) আবশ্যক।",
    en: "To confirm an Execution, the bank reference (bankReference) is required.",
  },
  "affiliates.toRecordAnExecutionAsFailed": {
    bn: "Execution failed হিসেবে রেকর্ড করতে হলে কারণ (reason) আবশ্যক।",
    en: "To record an Execution as failed, a reason is required.",
  },
  "affiliates.theExecutionAmountCannotExceedThe": {
    bn: "Execution-এর পরিমাণ ({{p1}}) executable বকেয়ার ({{p2}} = approved outstanding {{p3}} − খোলা instruction {{p4}}) বেশি হতে পারবে না — শুধু APPROVED কমিশনের বিপরীতেই execution হয়",
    en: "The Execution amount ({{p1}}) cannot exceed the executable outstanding ({{p2}} = approved outstanding {{p3}} − open instruction {{p4}}) — execution only happens against APPROVED commission",
  },
  "affiliates.payoutExecutionNotFound": {
    bn: "Payout execution পাওয়া যায়নি",
    en: "Payout execution not found",
  },
  "affiliates.thePayoutDestinationInformationIsNot": {
    bn: "Payout গন্তব্যের তথ্য সঠিক নয়।",
    en: "The payout destination information is not valid.",
  },
  "affiliates.aDestinationNumberDestinationNumberIs": {
    bn: "{{method}} payout-এর জন্য গন্তব্য নম্বর (destination.number) প্রয়োজন।",
    en: "A destination number (destination.number) is required for a {{method}} payout.",
  },
  "affiliates.theAffiliateCodeCannotBeEmpty": {
    bn: "অ্যাফিলিয়েট কোড খালি হতে পারবে না",
    en: "The affiliate code cannot be empty",
  },
  "affiliates.theAffiliateCodeCouldNotBe": {
    bn: "অ্যাফিলিয়েট কোড তৈরি করা যায়নি — আবার চেষ্টা করুন",
    en: "The affiliate code could not be created — please try again",
  },
  "affiliates.thisExecutionCannotBeConfirmedCurrent": {
    bn: "এই execution-টি confirm করা যাবে না (বর্তমান: {{executionStatus}}) — failed হলে নতুন instruction তৈরি করুন।",
    en: "This execution cannot be confirmed (current: {{executionStatus}}) — if failed, create a new instruction.",
  },
  "affiliates.thisAffiliateCodeIsAlreadyUsed": {
    bn: "এই অ্যাফিলিয়েট কোডটি ইতিমধ্যে ব্যবহৃত হয়েছে: {{code}}",
    en: "This affiliate code is already used: {{code}}",
  },
  "affiliates.theCommissionRateMustBeAn": {
    bn: "কমিশনের হার ০ থেকে ৫০ শতাংশের মধ্যে পূর্ণসংখ্যা হতে হবে",
    en: "The commission rate must be an integer between 0 and 50 percent",
  },
  "affiliates.thePartnerStatusMustBeActive": {
    bn: "পার্টনারের অবস্থা active অথবা paused হতে হবে",
    en: "The partner status must be active or paused",
  },
  "affiliates.thePartnerNameIsRequired": {
    bn: "পার্টনারের নাম আবশ্যক",
    en: "The partner name is required",
  },
  "affiliates.thePartnerPhoneNumberIsRequired": {
    bn: "পার্টনারের ফোন নম্বর আবশ্যক",
    en: "The partner phone number is required",
  },
  "affiliates.thePayoutAmountCannotExceedThe": {
    bn: "পেআউটের পরিমাণ ({{p1}}) বকেয়া কমিশনের ({{p2}})-এর বেশি হতে পারবে না",
    en: "The payout amount ({{p1}}) cannot exceed the outstanding commission ({{p2}})",
  },
  "affiliates.thePayoutAmountMustBeMore": {
    bn: "পেআউটের পরিমাণ শূন্যের বেশি হতে হবে",
    en: "The payout amount must be more than zero",
  },
  "affiliates.thePayoutMethodMustBeBkash": {
    bn: "পেআউটের মাধ্যম bkash, nagad, bank, cash অথবা other হতে হবে",
    en: "The payout method must be bkash, nagad, bank, cash or other",
  },
  "affiliates.theCurrentApprovedOutstandingIsLess": {
    bn: "বর্তমান approved outstanding ({{p1}}) এই execution-এর পরিমাণের ({{p2}}) চেয়ে কম — confirm করা যাবে না।",
    en: "The current approved outstanding ({{p1}}) is less than this execution's amount ({{p2}}) — it cannot be confirmed.",
  },
  "affiliates.onlyPendingCommissionCanBeApproved": {
    bn: "শুধুমাত্র pending কমিশন অনুমোদন করা যায় (বর্তমান অবস্থা: {{entryStatus}})",
    en: "Only pending commission can be approved (current status: {{entryStatus}})",
  },
};
