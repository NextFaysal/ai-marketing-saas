import type { CatalogNamespace } from "./types";

/** ML10 catalog namespace: subscriptions — generated from the MB4 cluster-A conversion;
 *  bn text is faithful to the original service wording. */
export const subscriptionsCatalog: CatalogNamespace = {
  "subscriptions.consentMethodRequired": { bn: "সম্মতি রেকর্ড করতে সম্মতির পদ্ধতি আবশ্যক (phone_call | in_person | written | message)", en: "A consent method is required to record consent (phone_call | in_person | written | message)" },
  "subscriptions.consentMethodWithoutConsent": { bn: "সম্মতি দেওয়া হয়েছে না বললে সম্মতির পদ্ধতি/নোট রাখা যাবে না", en: "If consent is not given, the consent method/note cannot be kept" },
  "subscriptions.consentOnCancelledSubscription": { bn: "বাতিল সাবস্ক্রিপশনে সম্মতি রেকর্ড করা যাবে না", en: "Consent cannot be recorded on a cancelled subscription" },
  "subscriptions.pauseActiveOnly": { bn: "শুধুমাত্র সক্রিয় সাবস্ক্রিপশন বিরতি দেওয়া যায়", en: "Only an active subscription can be paused" },
  "subscriptions.productSubscriptionDisabled": { bn: "এই পণ্যে সাবস্ক্রিপশন চালু নেই", en: "Subscriptions are not enabled for this product" },
  "subscriptions.quantityAtLeastOne": { bn: "পরিমাণ কমপক্ষে ১ হতে হবে", en: "The quantity must be at least 1" },
  "subscriptions.resumePausedOnly": { bn: "শুধুমাত্র বিরতি দেওয়া সাবস্ক্রিপশন আবার চালু করা যায়", en: "Only a paused subscription can be resumed" },
  "subscriptions.startTimeInvalid": { bn: "শুরুর সময় সঠিক নয়", en: "The start time is invalid" },
  "subscriptions.subscriptionAlreadyCancelled": { bn: "সাবস্ক্রিপশনটি ইতিমধ্যে বাতিল করা হয়েছে", en: "The subscription has already been cancelled" },
  "subscriptions.subscriptionNotFoundInOrg": { bn: "এই অর্গানাইজেশনে সাবস্ক্রিপশন পাওয়া যায়নি", en: "Subscription not found in this organization" },
};
