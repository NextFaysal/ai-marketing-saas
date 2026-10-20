/**
 * MB4 (ML10) — analytics catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the analytics module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const analyticsCatalog: CatalogNamespace = {
  "analytics.invalidFromToDateExpectedYyyy": {
    bn: "অবৈধ from/to date (প্রত্যাশিত YYYY-MM-DD)",
    en: "Invalid from/to date (expected YYYY-MM-DD)",
  },
  "analytics.rangeTooLargeMax366Days": {
    bn: "Range খুব বড়: সর্বোচ্চ ৩৬৬ দিন",
    en: "Range too large: max 366 days",
  },
  "analytics.fromMustBeBeforeTo": {
    bn: "from to-এর আগে হতে হবে",
    en: "from must be before to",
  },
};
