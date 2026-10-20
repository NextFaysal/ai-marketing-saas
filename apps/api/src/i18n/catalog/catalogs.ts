/**
 * MB4 (ML10) — catalogs catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the catalogs module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const catalogsCatalog: CatalogNamespace = {
  "catalogs.thereIsNoWebsiteUrlIn": {
    bn: "Business Profile এ Website URL নেই — Catalog আইটেমের জন্য প্রতিটি প্রোডাক্টের URL দরকার। আগে Settings এ ওয়েবসাইট সেট করুন।",
    en: "There is no Website URL in the Business Profile — a URL is needed for every product for a Catalog item. Set the website in Settings first.",
  },
  "catalogs.catalogBatchFailed": {
    bn: "Catalog batch failed: {{p1}}",
    en: "Catalog batch failed: {{p1}}",
  },
  "catalogs.catalogNotFound": {
    bn: "Catalog পাওয়া যায়নি",
    en: "Catalog not found",
  },
  "catalogs.metaCatalogCreationFailed": {
    bn: "Meta catalog creation failed: {{p1}}",
    en: "Meta catalog creation failed: {{p1}}",
  },
  "catalogs.metaProductSetCreationDidNot": {
    bn: "Meta product set creation did NOT succeed: {{message}}",
    en: "Meta product set creation did NOT succeed: {{message}}",
  },
  "catalogs.metaReturnedNoCatalogIdCreation": {
    bn: "Meta returned no catalog id; creation is NOT confirmed",
    en: "Meta returned no catalog id; creation is NOT confirmed",
  },
  "catalogs.noActiveProductsToPush": {
    bn: "No active products to push",
    en: "No active products to push",
  },
  "catalogs.productSetNameIsRequired": {
    bn: "Product set name is required",
    en: "Product set name is required",
  },
  "catalogs.productSetNotFound": {
    bn: "Product set not found",
    en: "Product set not found",
  },
  "catalogs.thisSetHasNoFilterCriterion": {
    bn: "This set has no filter criterion Meta can use (add a category, a max price, or in-stock-only)",
    en: "This set has no filter criterion Meta can use (add a category, a max price, or in-stock-only)",
  },
};
