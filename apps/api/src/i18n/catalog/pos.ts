/**
 * MB4 (ML10) — pos catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the pos module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const posCatalog: CatalogNamespace = {
  "pos.orderWasRecordedButCouldNot": {
    bn: "Order record করা হলেও আবার load করা যায়নি",
    en: "Order was recorded but could not be reloaded",
  },
  "pos.thisTransactionReferenceHasAlreadyBeen": {
    bn: "এই transaction reference ইতিমধ্যে একটি verified payment হিসেবে recorded হয়েছে",
    en: "This transaction reference has already been recorded as a verified payment",
  },
  "pos.aRecordInThisStatusCannot": {
    bn: "এই অবস্থার রেকর্ড বাদ দেওয়া যাবে না",
    en: "A record in this status cannot be discarded",
  },
  "pos.addAtLeastOneProduct": {
    bn: "কমপক্ষে একটি পণ্য যোগ করুন",
    en: "Add at least one product",
  },
  "pos.theGiftCardFacilityIsNot": {
    bn: "গিফট কার্ড সুবিধা এই দোকানে নেই",
    en: "The gift card facility is not available in this shop",
  },
  "pos.sorryHasOnlyInStockMore": {
    bn: "দুঃখিত, \"{{productName}}\"-এর স্টকে মাত্র {{stock}}টি আছে — এর বেশি অর্ডার করা যাবে না",
    en: "Sorry, \"{{productName}}\" has only {{stock}} in stock — more cannot be ordered",
  },
  "pos.theProductWasNotFoundOr": {
    bn: "পণ্যটি পাওয়া যায়নি বা বন্ধ আছে",
    en: "The product was not found or is closed",
  },
  "pos.sendThePaymentTypePaidCash": {
    bn: "পেমেন্টের ধরন পাঠান — paid (নগদ) অথবা due (বাকি)",
    en: "Send the payment type — paid (cash) or due",
  },
  "pos.eachProductSQuantityMustBe": {
    bn: "প্রতিটি পণ্যের পরিমাণ ধনাত্মক সংখ্যা হতে হবে",
    en: "Each product's quantity must be a positive number",
  },
  "pos.theVariantDoesNotBelongTo": {
    bn: "ভ্যারিয়েন্টটি এই পণ্যের নয়",
    en: "The variant does not belong to this product",
  },
  "pos.conflict": {
    bn: "শুধু দ্বন্দ্ব (conflict) অবস্থার রেকর্ড আবার পোস্ট করা যায়",
    en: "শুধু দ্বন্দ্ব (conflict) অবস্থার রেকর্ড আবার পোস্ট করা যায়",
  },
  "pos.msg11": {
    bn: "সিঙ্ক রেকর্ডটি পাওয়া যায়নি",
    en: "সিঙ্ক রেকর্ডটি পাওয়া যায়নি",
  },
  "pos.msg12": {
    bn: "সিঙ্ক হয়ে গেছে — বাদ দেওয়া যাবে না",
    en: "সিঙ্ক হয়ে গেছে — বাদ দেওয়া যাবে না",
  },
};
