/**
 * MB4 (ML10) — tax catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the tax module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const taxCatalog: CatalogNamespace = {
  "tax.orderNotFoundInThisOrganization": {
    bn: "এই organization-এ order পাওয়া যায়নি",
    en: "Order not found in this organization",
  },
  "tax.theDefaultVatRateMustBe": {
    bn: "ডিফল্ট VAT হার 0–10000 basis points-এর মধ্যে হতে হবে (1500 = 15%)",
    en: "The default VAT rate must be between 0 and 10000 basis points (1500 = 15%)",
  },
  "tax.theReportTypeIsNotValid": {
    bn: "রিপোর্টের ধরন সঠিক নয় (sales | tax | due | courier-collections)",
    en: "The report type is not valid (sales | tax | due | courier-collections)",
  },
  "tax.theStartDateCannotBeAfter": {
    bn: "শুরুর তারিখ শেষের তারিখের পরে হতে পারে না",
    en: "The start date cannot be after the end date",
  },
  "tax.aReportOfAtMost366": {
    bn: "সর্বোচ্চ ৩৬৬ দিনের রিপোর্ট একবারে নেওয়া যাবে",
    en: "A report of at most 366 days can be taken at a time",
  },
  "tax.dateInvalidGiveFromAndToYyyyMmDd": {
    bn: "তারিখ সঠিক নয় — from ও to দুটোই YYYY-MM-DD আকারে দিন",
    en: "The date is not valid — give both from and to in YYYY-MM-DD form",
  },
};
