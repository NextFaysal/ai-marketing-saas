/**
 * MB4 (ML10) — portfolio catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the portfolio module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const portfolioCatalog: CatalogNamespace = {
  "portfolio.emailIsNotConfiguredInThis": {
    bn: "এই deployment-এ email configure করা নেই",
    en: "Email is not configured in this deployment",
  },
  "portfolio.userEmailNotFound": {
    bn: "User email পাওয়া যায়নি",
    en: "User email not found",
  },
};
