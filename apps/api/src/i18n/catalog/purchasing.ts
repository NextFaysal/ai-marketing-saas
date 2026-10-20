/**
 * MB4 (ML10) — purchasing catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the purchasing module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const purchasingCatalog: CatalogNamespace = {
  "purchasing.productNotFoundInThisOrganization": {
    bn: "এই organization-এ product পাওয়া যায়নি",
    en: "Product not found in this organization",
  },
  "purchasing.purchaseOrderNotFoundInThis": {
    bn: "এই organization-এ purchase order পাওয়া যায়নি",
    en: "Purchase order not found in this organization",
  },
  "purchasing.supplierNotFoundInThisOrganization": {
    bn: "এই organization-এ supplier পাওয়া যায়নি",
    en: "Supplier not found in this organization",
  },
  "purchasing.allowbackorderMustBeTrueFalse": {
    bn: "allowBackorder অবশ্যই true/false হতে হবে",
    en: "allowBackorder must be true/false",
  },
  "purchasing.modeMustBeSimpleOrVelocity": {
    bn: "mode অবশ্যই simple বা velocity হতে হবে",
    en: "mode must be simple or velocity",
  },
  "purchasing.modeMustBeSimpleOrVelocity2": {
    bn: "mode অবশ্যই simple বা velocity হতে হবে — simple মোডের জন্য বিদ্যমান সাজেশন ব্যবহার করুন",
    en: "mode must be simple or velocity — use the existing suggestion for simple mode",
  },
  "purchasing.itemsCanOnlyBeChangedIn": {
    bn: "আইটেম শুধুমাত্র ড্রাফট অবস্থায় পরিবর্তন করা যায়",
    en: "Items can only be changed in draft status",
  },
  "purchasing.theItemDoesNotBelongTo": {
    bn: "আইটেমটি এই ক্রয় অর্ডারের অন্তর্গত নয়",
    en: "The item does not belong to this purchase order",
  },
  "purchasing.theWindowWindowdaysMustBeOne": {
    bn: "উইন্ডো (windowDays) অবশ্যই ৩০, ৬০ বা ৯০ দিনের একটি হতে হবে",
    en: "The window (windowDays) must be one of 30, 60 or 90 days",
  },
  "purchasing.productsCannotBeReceivedInThis": {
    bn: "এই অবস্থায় ({{poStatus}}) পণ্য গ্রহণ করা যাবে না",
    en: "Products cannot be received in this state ({{poStatus}})",
  },
  "purchasing.atMostMoreCanBeReceived": {
    bn: "এই আইটেমে আর মাত্র {{remaining}}টি গ্রহণ করা যাবে — অর্ডার করা হয়েছে {{itemQtyOrdered}}টি, ইতিমধ্যে গৃহীত {{itemQtyReceived}}টি",
    en: "At most {{remaining}} more can be received in this item — {{itemQtyOrdered}} were ordered, {{itemQtyReceived}} have already been received",
  },
  "purchasing.allProductsOfThisPurchaseOrder": {
    bn: "এই ক্রয় অর্ডারের সব পণ্য ইতিমধ্যে গ্রহণ করা সম্পন্ন হয়েছে",
    en: "All products of this purchase order have already been received",
  },
  "purchasing.theUnitCostUnitcostminorMustBe": {
    bn: "একক খরচ (unitCostMinor) অবশ্যই ০ বা তার বেশি পূর্ণসংখ্যা (পয়সায়) হতে হবে",
    en: "The unit cost (unitCostMinor) must be an integer of 0 or more (in poisha)",
  },
  "purchasing.aPurchaseOrderMustHaveAt": {
    bn: "ক্রয় অর্ডারে অন্তত একটি আইটেম থাকতে হবে",
    en: "A purchase order must have at least one item",
  },
  "purchasing.giveAtLeastOneItemTo": {
    bn: "গ্রহণ করার জন্য অন্তত একটি আইটেম দিন",
    en: "Give at least one item to receive",
  },
  "purchasing.theReceivedQuantityMustBeAn": {
    bn: "গ্রহণের পরিমাণ অবশ্যই ০-এর বেশি পূর্ণসংখ্যা হতে হবে",
    en: "The received quantity must be an integer of more than 0",
  },
  "purchasing.theDateIsNotValid": {
    bn: "তারিখ সঠিক নয়",
    en: "The date is not valid",
  },
  "purchasing.theNumberOfDaysDaysMust": {
    bn: "দিনের সংখ্যা (days) অবশ্যই ১ থেকে ৩৬৫-এর মধ্যে পূর্ণসংখ্যা হতে হবে",
    en: "The number of days (days) must be an integer between 1 and 365",
  },
  "purchasing.theQuantityQtyorderedMustBeAn": {
    bn: "পরিমাণ (qtyOrdered) অবশ্যই ০-এর বেশি পূর্ণসংখ্যা হতে হবে",
    en: "The quantity (qtyOrdered) must be an integer of more than 0",
  },
  "purchasing.theExpectedDateExpecteddateIsNot": {
    bn: "প্রত্যাশিত তারিখ (expectedDate) সঠিক নয়",
    en: "The expected date (expectedDate) is not valid",
  },
  "purchasing.productsCannotBeReceivedInA": {
    bn: "বাতিল করা ক্রয় অর্ডারে পণ্য গ্রহণ করা যাবে না",
    en: "Products cannot be received in a cancelled purchase order",
  },
  "purchasing.theVariantDoesNotBelongTo": {
    bn: "ভ্যারিয়েন্টটি এই পণ্যের অন্তর্গত নয়",
    en: "The variant does not belong to this product",
  },
  "purchasing.theReserveTimeReserveminutesMustBe": {
    bn: "রিজার্ভ সময় (reserveMinutes) অবশ্যই ০ থেকে ১৪৪০ মিনিটের মধ্যে পূর্ণসংখ্যা হতে হবে",
    en: "The reserve time (reserveMinutes) must be an integer between 0 and 1440 minutes",
  },
  "purchasing.onlyADraftOrOrderedPurchase": {
    bn: "শুধুমাত্র ড্রাফট বা অর্ডারকৃত (draft/ordered) অবস্থার ক্রয় অর্ডার সম্পাদনা করা যাবে",
    en: "Only a draft or ordered purchase order can be edited",
  },
  "purchasing.theSupplierNameIsRequiredAn": {
    bn: "সরবরাহকারীর নাম আবশ্যক — খালি নাম দেওয়া যাবে না",
    en: "The supplier name is required — an empty name cannot be given",
  },
  "purchasing.theReceivedPartiallyReceivedStatusCannot": {
    bn: "স্ট্যাটাস received/partially_received ম্যানুয়ালি সেট করা যায় না — পণ্য গ্রহণ (receive) করার মাধ্যমেই এই স্ট্যাটাস নির্ধারিত হয়",
    en: "The received/partially_received status cannot be set manually — this status is determined by receiving products",
  },
  "purchasing.theStatusCannotBeChangedFrom": {
    bn: "স্ট্যাটাস {{poStatus}} থেকে {{dtoStatus}}-এ পরিবর্তন করা যাবে না",
    en: "The status cannot be changed from {{poStatus}} to {{dtoStatus}}",
  },
  "purchasing.leadTimeDaysMustBeIntegerBetween1And180": {
    bn: "লিড টাইম (leadTimeDays) অবশ্যই ১ থেকে ১৮০ দিনের মধ্যে পূর্ণসংখ্যা হতে হবে",
    en: "Lead time (leadTimeDays) must be an integer between 1 and 180 days",
  },
};
