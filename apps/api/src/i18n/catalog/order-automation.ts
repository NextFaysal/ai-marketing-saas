/**
 * MB4 (ML10) — order-automation catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the order-automation module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const orderAutomationCatalog: CatalogNamespace = {
  "orderAutomation.thePresetIsAlreadyInstalled": {
    bn: "\"{{presetName}}\" প্রিসেটটি ইতিমধ্যে ইনস্টল করা আছে",
    en: "The \"{{presetName}}\" preset is already installed",
  },
  "orderAutomation.orderNotFoundInThisOrganization": {
    bn: "এই organization-এ order পাওয়া যায়নি",
    en: "Order not found in this organization",
  },
  "orderAutomation.theAutomationRuleWasNotFound": {
    bn: "অটোমেশন নিয়মটি পাওয়া যায়নি",
    en: "The automation rule was not found",
  },
  "orderAutomation.theAssigneeIsNotAnActive": {
    bn: "দায়িত্বপ্রাপ্ত ব্যক্তি এই প্রতিষ্ঠানের সক্রিয় সদস্য নন",
    en: "The assignee is not an active member of this organization",
  },
  "orderAutomation.thePresetWasNotFound": {
    bn: "প্রিসেটটি পাওয়া যায়নি",
    en: "The preset was not found",
  },
};
