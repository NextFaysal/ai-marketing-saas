/**
 * MB4 (ML10) — agency catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the agency module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const agencyCatalog: CatalogNamespace = {
  "agency.youAreNotAMemberOf": {
    bn: "আপনি এই ক্লায়েন্ট প্রতিষ্ঠানের সদস্য নন — কমিশন রেকর্ড করা যাবে না।",
    en: "You are not a member of this client organization — commission cannot be recorded.",
  },
  "agency.theAgencyOrganizationCannotItselfBe": {
    bn: "এজেন্সি প্রতিষ্ঠান নিজেই ক্লায়েন্ট হতে পারে না।",
    en: "The agency organization cannot itself be a client.",
  },
  "agency.theCommissionAmountMustBeMore": {
    bn: "কমিশনের পরিমাণ শূন্যের বেশি হতে হবে।",
    en: "The commission amount must be more than zero.",
  },
  "agency.theCommissionAmountIsNotA": {
    bn: "কমিশনের পরিমাণ সঠিক সংখ্যা নয়।",
    en: "The commission amount is not a valid number.",
  },
  "agency.chooseTheClientOrganization": {
    bn: "ক্লায়েন্ট প্রতিষ্ঠান বেছে নিন।",
    en: "Choose the client organization.",
  },
  "agency.aPeriodLabelIsRequiredE": {
    bn: "সময়ের লেবেল (period) আবশ্যক — যেমন “অক্টোবর ২০২৬”।",
    en: "A period label is required — e.g. “October 2026”.",
  },
  "agency.thePeriodLabelCanBeAt": {
    bn: "সময়ের লেবেল সর্বোচ্চ ৪০ অক্ষরের হতে পারবে।",
    en: "The period label can be at most 40 characters.",
  },
};
