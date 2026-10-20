/**
 * MB4 (ML10) — feedback catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the feedback module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const feedbackCatalog: CatalogNamespace = {
  "feedback.scoreMustBeAnIntegerBetween": {
    bn: "score 0 থেকে 10-এর মধ্যে একটি পূর্ণসংখ্যা হতে হবে",
    en: "score must be an integer between 0 and 10",
  },
};
