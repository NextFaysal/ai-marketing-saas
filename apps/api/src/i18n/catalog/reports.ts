/**
 * MB4 (ML10) — reports catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the reports module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const reportsCatalog: CatalogNamespace = {
  "reports.aCampaignReportShareNeedsA": {
    bn: "একটি campaign report share-এর জন্য planId লাগবে",
    en: "A campaign report share needs a planId",
  },
  "reports.campaignPlanNotFoundInThis": {
    bn: "এই organization-এ campaign plan পাওয়া যায়নি",
    en: "Campaign plan not found in this organization",
  },
  "reports.goalNotFound": {
    bn: "Goal পাওয়া যায়নি",
    en: "Goal not found",
  },
  "reports.savedReportNotFound": {
    bn: "Saved report পাওয়া যায়নি",
    en: "Saved report not found",
  },
  "reports.shareLinkNotFound": {
    bn: "Share link পাওয়া যায়নি",
    en: "Share link not found",
  },
  "reports.thisReportLinkHasExpired": {
    bn: "এই report link-এর মেয়াদ শেষ হয়ে গেছে",
    en: "This report link has expired",
  },
  "reports.thisReportLinkIsInvalid": {
    bn: "এই report link অবৈধ",
    en: "This report link is invalid",
  },
  "reports.daysMustBeOneOf7": {
    bn: "days হতে হবে 7, 14, 30, 60, 90-এর যেকোনো একটি",
    en: "days must be one of 7, 14, 30, 60, 90",
  },
  "reports.dimensionMustBeOneOf": {
    bn: "dimension হতে হবে এর যেকোনো একটি {{p1}}",
    en: "dimension must be one of {{p1}}",
  },
  "reports.kindMustBeOverviewExecutiveOr": {
    bn: "kind হতে হবে overview, executive অথবা campaign",
    en: "kind must be overview, executive or campaign",
  },
  "reports.metricMustBeOneOf": {
    bn: "metric হতে হবে এর যেকোনো একটি {{p1}}",
    en: "metric must be one of {{p1}}",
  },
  "reports.monthMustBeYyyyMm": {
    bn: "month YYYY-MM হতে হবে",
    en: "month must be YYYY-MM",
  },
  "reports.rangepresetMustBeOneOf": {
    bn: "rangePreset হতে হবে এর যেকোনো একটি {{p1}}",
    en: "rangePreset must be one of {{p1}}",
  },
  "reports.targetCannotBeNegative": {
    bn: "target ঋণাত্মক হতে পারবে না",
    en: "target cannot be negative",
  },
  "reports.targetMustBeAnIntegerMinor": {
    bn: "target একটি পূর্ণসংখ্যা হতে হবে (টাকার জন্য minor units, orders-এর জন্য count)",
    en: "target must be an integer (minor units for money, count for orders)",
  },
  "reports.selectAtLeastOneMetric": {
    bn: "অন্তত একটি metric বেছে নিন",
    en: "Select at least one metric",
  },
  "reports.thisMetricIsNotAvailableIn": {
    bn: "এই dimension-এ এই metric পাওয়া যায় না: {{p1}}। পাওয়া যায়: {{p2}}",
    en: "This metric is not available in this dimension: {{p1}}. Available: {{p2}}",
  },
};
