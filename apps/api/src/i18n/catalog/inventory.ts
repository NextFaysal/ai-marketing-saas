/**
 * MB4 (ML10) — inventory catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the inventory module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const inventoryCatalog: CatalogNamespace = {
  "inventory.productNotFoundInThisOrganization": {
    bn: "এই organization-এ product পাওয়া যায়নি",
    en: "Product not found in this organization",
  },
  "inventory.targetWarehouseNotFoundInThis": {
    bn: "এই organization-এ target warehouse পাওয়া যায়নি",
    en: "Target warehouse not found in this organization",
  },
  "inventory.variantNotFoundForThisProduct": {
    bn: "এই product-এর জন্য variant পাওয়া যায়নি",
    en: "Variant not found for this product",
  },
  "inventory.deltaOrSettoExactlyOneMust": {
    bn: "delta অথবা setTo — ঠিক একটি দিতে হবে (দুটোই বা কোনোটিই নয়)।",
    en: "delta or setTo — exactly one must be given (not both or neither).",
  },
  "inventory.deltaMustBeAnInteger": {
    bn: "delta অবশ্যই পূর্ণসংখ্যা হতে হবে।",
    en: "delta must be an integer.",
  },
  "inventory.settoMustBeAnIntegerOf": {
    bn: "setTo অবশ্যই ০ বা তার বেশি পূর্ণসংখ্যা হতে হবে।",
    en: "setTo must be an integer of 0 or more.",
  },
  "inventory.thereIsNoActiveStockAllocation": {
    bn: "এই অর্ডারে সক্রিয় স্টক বরাদ্দ নেই — পুনঃবরাদ্দ করা যাচ্ছে না।",
    en: "There is no active stock allocation in this order — it cannot be re-allocated.",
  },
  "inventory.thisProductSStockIsNot": {
    bn: "এই পণ্যের স্টক ট্র্যাক করা হচ্ছে না — আগে পণ্যের স্টক সংখ্যা বসান",
    en: "This product's stock is not tracked — set the product's stock quantity first",
  },
  "inventory.thereIsNotEnoughStockIn": {
    bn: "এই বিনে পর্যাপ্ত স্টক নেই — ট্রান্সফার করা যাচ্ছে না।",
    en: "There is not enough stock in this bin — it cannot be transferred.",
  },
  "inventory.theSpecifiedBinWasNotFound": {
    bn: "নির্দিষ্ট বিনটি এই প্রতিষ্ঠানে পাওয়া যায়নি — সঠিক বিন বেছে নিন।",
    en: "The specified bin was not found in this organization — choose the correct bin.",
  },
  "inventory.theSpecifiedBinWasNotFound2": {
    bn: "নির্দিষ্ট বিনটি এই প্রতিষ্ঠানে পাওয়া যায়নি।",
    en: "The specified bin was not found in this organization.",
  },
  "inventory.binBasedStockLevelsAreNot": {
    bn: "বিন-ভিত্তিক স্টক স্তর সক্রিয় নয় — এই কাজটি করা যাচ্ছে না।",
    en: "Bin-based stock levels are not active — this action cannot be done.",
  },
  "inventory.theTargetWarehouseIsInactiveChoose": {
    bn: "লক্ষ্য গুদামটি নিষ্ক্রিয় — সক্রিয় একটি গুদাম বেছে নিন।",
    en: "The target warehouse is inactive — choose an active warehouse",
  },
};
