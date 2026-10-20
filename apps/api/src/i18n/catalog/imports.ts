/**
 * MB4 (ML10) — imports catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the imports module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const importsCatalog: CatalogNamespace = {
  "imports.importJobNotFoundInThis": {
    bn: "এই organization-এ import job পাওয়া যায়নি",
    en: "Import job not found in this organization",
  },
  "imports.orderImportIsNotAvailableIn": {
    bn: "এই deployment-এ order import পাওয়া যাচ্ছে না",
    en: "Order import is not available in this deployment",
  },
};
