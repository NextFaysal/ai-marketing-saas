/**
 * MB4 (ML10) — conversions catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the conversions module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const conversionsCatalog: CatalogNamespace = {
  "conversions.conversionsApiIsNotConfiguredFor": {
    bn: "এই organization-এর জন্য Conversions API configure করা নেই",
    en: "Conversions API is not configured for this organization",
  },
  "conversions.noConversionsApiTokenSetA": {
    bn: "কোনো Conversions API token নেই: একটি dedicated token সেট করুন অথবা আগে Meta Ads connect করুন",
    en: "No Conversions API token: set a dedicated token or connect Meta Ads first",
  },
  "conversions.setATesteventcodeFirstMetaEvents": {
    bn: "আগে একটি testEventCode সেট করুন (Meta Events Manager -> Test Events)",
    en: "Set a testEventCode first (Meta Events Manager -> Test Events)",
  },
  "conversions.pixelidDatasetIdIsRequired": {
    bn: "pixelId (dataset id) দরকার",
    en: "pixelId (dataset id) is required",
  },
  "conversions.purchasetriggerMustBePlacedCodConfirmed": {
    bn: "purchaseTrigger হতে হবে placed, cod_confirmed অথবা delivered",
    en: "purchaseTrigger must be placed, cod_confirmed or delivered",
  },
};
