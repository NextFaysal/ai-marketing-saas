/**
 * MB4 (ML10) — warehouse catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the warehouse module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const warehouseCatalog: CatalogNamespace = {
  "warehouse.unknownDistrictGiveAValidDistrict": {
    bn: "অজানা জেলা: {{entry}} — সঠিক জেলার নাম দিন",
    en: "Unknown district: {{entry}} — give a valid district name",
  },
  "warehouse.theAssignmentWasNotFoundIn": {
    bn: "অ্যাসাইনমেন্টটি এই প্রতিষ্ঠানে পাওয়া যায়নি",
    en: "The assignment was not found in this organization",
  },
  "warehouse.theInventoryServiceIsNotAvailable": {
    bn: "ইনভেন্টরি সার্ভিস পাওয়া যাচ্ছে না",
    en: "The inventory service is not available",
  },
  "warehouse.aTransferInThisStatusCannot": {
    bn: "এই অবস্থার ট্রান্সফার বাতিল করা যাবে না — বর্তমান অবস্থা: {{transferStatus}}",
    en: "A transfer in this status cannot be cancelled — current status: {{transferStatus}}",
  },
  "warehouse.thisCountIsClosed": {
    bn: "এই গণনা বন্ধ হয়ে গেছে",
    en: "This count is closed",
  },
  "warehouse.aBinWithThisCodeAlready": {
    bn: "এই গুদামে এই কোডের বিন আগেই আছে",
    en: "A bin with this code already exists in this warehouse",
  },
  "warehouse.multipleLinesForTheSameProduct": {
    bn: "একই পণ্যের একাধিক লাইন দেওয়া যাবে না — পরিমাণ এক লাইনে মিলিয়ে দিন",
    en: "Multiple lines for the same product cannot be given — merge the quantities into one line",
  },
  "warehouse.transferWithinTheSameBinIs": {
    bn: "একই বিনে ট্রান্সফার করা যাবে না — আলাদা গন্তব্য বিন বেছে নিন",
    en: "Transfer within the same bin is not possible — choose a different destination bin",
  },
  "warehouse.theCountedQuantityMustBeAn": {
    bn: "গণনা করা সংখ্যা অবশ্যই ০ বা তার বেশি পূর্ণসংখ্যা হতে হবে",
    en: "The counted quantity must be an integer of 0 or more",
  },
  "warehouse.theCountLineWasNotFound": {
    bn: "গণনার লাইনটি পাওয়া যায়নি",
    en: "The count line was not found",
  },
  "warehouse.theWarehouseWasNotFoundIn": {
    bn: "গুদামটি এই প্রতিষ্ঠানে পাওয়া যায়নি",
    en: "The warehouse was not found in this organization",
  },
  "warehouse.theWarehousePriorityMustBeAn": {
    bn: "গুদামের অগ্রাধিকার (priority) অবশ্যই ০ বা তার বেশি পূর্ণসংখ্যা হতে হবে",
    en: "The warehouse priority must be an integer of 0 or more",
  },
  "warehouse.aWarehouseNameIsRequired": {
    bn: "গুদামের নাম দরকার",
    en: "A warehouse name is required",
  },
  "warehouse.theTransferFacilityIsNotAvailable": {
    bn: "ট্রান্সফার সুবিধাটি এই ডিপ্লয়মেন্টে নেই",
    en: "The transfer facility is not available in this deployment",
  },
  "warehouse.theTransferWasNotFoundIn": {
    bn: "ট্রান্সফারটি এই প্রতিষ্ঠানে পাওয়া যায়নি",
    en: "The transfer was not found in this organization",
  },
  "warehouse.aTransferNeedsAtLeastOne": {
    bn: "ট্রান্সফারে অন্তত একটি লাইন দরকার",
    en: "A transfer needs at least one line",
  },
  "warehouse.theProductWasNotFoundIn": {
    bn: "পণ্যটি এই প্রতিষ্ঠানে পাওয়া যায়নি",
    en: "The product was not found in this organization",
  },
  "warehouse.theSentQuantityQtysentMustBe": {
    bn: "প্রেরণের পরিমাণ (qtySent) অবশ্যই ধনাত্মক পূর্ণসংখ্যা হতে হবে",
    en: "The sent quantity (qtySent) must be a positive integer",
  },
  "warehouse.theBinWasNotFoundIn": {
    bn: "বিনটি এই গুদামে পাওয়া যায়নি",
    en: "The bin was not found in this warehouse",
  },
  "warehouse.theBinDoesNotBelongTo": {
    bn: "বিনটি এই গুদামের নয়",
    en: "The bin does not belong to this warehouse",
  },
  "warehouse.theBinWasNotFoundIn2": {
    bn: "বিনটি এই প্রতিষ্ঠানে পাওয়া যায়নি — সঠিক বিন বেছে নিন",
    en: "The bin was not found in this organization — choose the correct bin",
  },
  "warehouse.aBinCodeIsRequired": {
    bn: "বিনের কোড দরকার",
    en: "A bin code is required",
  },
  "warehouse.theVariantDoesNotBelongTo": {
    bn: "ভ্যারিয়েন্টটি এই পণ্যের নয়",
    en: "The variant does not belong to this product",
  },
  "warehouse.theLineDoesNotBelongTo": {
    bn: "লাইনটি এই ট্রান্সফারের নয় — সঠিক লাইন বেছে নিন",
    en: "The line does not belong to this transfer — choose the correct line",
  },
  "warehouse.onlyADraftTransferCanBe": {
    bn: "শুধু খসড়া (draft) ট্রান্সফার পাঠানো যায় — বর্তমান অবস্থা: {{transferStatus}}",
    en: "Only a draft transfer can be sent — current status: {{transferStatus}}",
  },
  "warehouse.onlyAnInTransitTransferCan": {
    bn: "শুধু পথে-থাকা (in_transit) ট্রান্সফার গ্রহণ করা যায় — বর্তমান অবস্থা: {{transferStatus}}",
    en: "Only an in_transit transfer can be received — current status: {{transferStatus}}",
  },
  "warehouse.theServiceDistrictListMustBe": {
    bn: "সার্ভিস জেলার তালিকা অবশ্যই একটি তালিকা (array) হতে হবে",
    en: "The service district list must be a list (array)",
  },
  "warehouse.aServiceDistrictNameCannotBe": {
    bn: "সার্ভিস জেলার নাম খালি হতে পারে না",
    en: "A service district name cannot be empty",
  },
  "warehouse.theStockCountWasNotFound": {
    bn: "স্টক গণনাটি এই প্রতিষ্ঠানে পাওয়া যায়নি",
    en: "The stock count was not found in this organization",
  },
  "warehouse.theReceivedQuantityForMustBe": {
    bn: "「{{p1}}」-এর গৃহীত পরিমাণ অবশ্যই ০–{{lineQtySent}}-এর মধ্যে পূর্ণসংখ্যা হতে হবে",
    en: "The received quantity for 「{{p1}}」 must be an integer between 0 and {{lineQtySent}}",
  },
  "warehouse.thereIsNotEnoughStockIn": {
    bn: "「{{p1}}」-এর জন্য উৎস বিনে পর্যাপ্ত স্টক নেই (আছে {{onHand}}, দরকার {{lineQtySent}}) — ট্রান্সফার পাঠানো যাচ্ছে না",
    en: "There is not enough stock in the source bin for 「{{p1}}」 (have {{onHand}}, need {{lineQtySent}}) — the transfer cannot be sent",
  },
  "warehouse.theStockOfIsNotTracked": {
    bn: "「{{productName}}」-এর স্টক ট্র্যাক করা হচ্ছে না — ট্রান্সফার করা যাবে না",
    en: "The stock of 「{{productName}}」 is not tracked — it cannot be transferred",
  },
};
