/**
 * MB4 (ML10) — attribution catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the attribution module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const attributionCatalog: CatalogNamespace = {
  "attribution.orderNotFoundInThisOrganization": {
    bn: "এই organization-এ order পাওয়া যায়নি",
    en: "Order not found in this organization",
  },
  "attribution.windowdaysMustBeOneOf7": {
    bn: "windowDays হতে হবে 7, 14, 30, 60, 90-এর যেকোনো একটি",
    en: "windowDays must be one of 7, 14, 30, 60, 90",
  },
};
