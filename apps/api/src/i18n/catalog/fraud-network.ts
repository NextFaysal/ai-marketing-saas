/**
 * MB4 (ML10) — fraud-network catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the fraud-network module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const fraudNetworkCatalog: CatalogNamespace = {
  "fraudNetwork.enabledMustBeBoolean": {
    bn: "enabled boolean হতে হবে",
    en: "enabled must be boolean",
  },
};
