/**
 * MB4 (ML10) — booking catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the booking module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const bookingCatalog: CatalogNamespace = {
  "booking.isRequired": {
    bn: "{{label}} আবশ্যক",
    en: "{{label}} is required",
  },
  "booking.mustBeAValidNumber": {
    bn: "{{label}} সঠিক সংখ্যা হতে হবে",
    en: "{{label}} must be a valid number",
  },
  "booking.theGuestNameIsRequired": {
    bn: "অতিথির নাম আবশ্যক",
    en: "The guest name is required",
  },
  "booking.theGuestPhoneNumberIsRequired": {
    bn: "অতিথির ফোন নম্বর আবশ্যক",
    en: "The guest phone number is required",
  },
  "booking.yourNameIsRequired": {
    bn: "আপনার নাম আবশ্যক",
    en: "Your name is required",
  },
  "booking.thisBookingHasNoRemainingManual": {
    bn: "এই বুকিংয়ে কোনো বাকি ম্যানুয়াল ডিপোজিট নেই",
    en: "This booking has no remaining manual deposit",
  },
  "booking.theStaffMemberHasAnotherBooking": {
    bn: "এই সময়ে স্টাফের অন্য বুকিং আছে",
    en: "The staff member has another booking at this time",
  },
  "booking.twoTimeRangesOnTheSame": {
    bn: "একই দিনে দুটি সময়সীমা ওভারল্যাপ করতে পারবে না",
    en: "Two time ranges on the same day cannot overlap",
  },
  "booking.theCustomerWasNotFound": {
    bn: "ক্রেতা পাওয়া যায়নি",
    en: "The customer was not found",
  },
  "booking.theDateMustBeGivenIn": {
    bn: "তারিখ YYYY-MM-DD ফরম্যাটে দিতে হবে",
    en: "The date must be given in YYYY-MM-DD format",
  },
  "booking.theShopWasNotFound": {
    bn: "দোকানটি পাওয়া যায়নি",
    en: "The shop was not found",
  },
  "booking.theBufferTimeMustBeBetween": {
    bn: "বাফার সময় ০ থেকে ২৪০ মিনিটের মধ্যে হতে হবে",
    en: "The buffer time must be between 0 and 240 minutes",
  },
  "booking.theBookingCannotBeMovedFrom": {
    bn: "বুকিংটি '{{p1}}' অবস্থা থেকে '{{p2}}' অবস্থায় নেওয়া যাবে না",
    en: "The booking cannot be moved from '{{p1}}' status to '{{p2}}' status",
  },
  "booking.theBookingWasNotFound": {
    bn: "বুকিংটি পাওয়া যায়নি",
    en: "The booking was not found",
  },
  "booking.theBookingStatusIsNotValid": {
    bn: "বুকিংয়ের অবস্থা সঠিক নয়",
    en: "The booking status is not valid",
  },
  "booking.theBookingStartTimeStartatMust": {
    bn: "বুকিংয়ের শুরুর সময় (startAt) সঠিক ISO সময় হতে হবে",
    en: "The booking start time (startAt) must be a valid ISO time",
  },
  "booking.theBookingStartTimeMustBe": {
    bn: "বুকিংয়ের শুরুর সময় সঠিক হতে হবে",
    en: "The booking start time must be valid",
  },
  "booking.onlyAnActiveMemberCanBe": {
    bn: "শুধু সক্রিয় (ACTIVE) সদস্যকেই স্টাফ হিসেবে যোগ করা যাবে",
    en: "Only an ACTIVE member can be added as staff",
  },
  "booking.theStartDateIsNotValid": {
    bn: "শুরুর তারিখ সঠিক নয়",
    en: "The start date is not valid",
  },
  "booking.theEndDateIsNotValid": {
    bn: "শেষের তারিখ সঠিক নয়",
    en: "The end date is not valid",
  },
  "booking.giveAValidPhoneNumber10": {
    bn: "সঠিক ফোন নম্বর দিন (১০–১৫ সংখ্যা)",
    en: "Give a valid phone number (10–15 digits)",
  },
  "booking.aMemberMembershipidIsRequired": {
    bn: "সদস্য (membershipId) আবশ্যক",
    en: "A member (membershipId) is required",
  },
  "booking.theMemberDoesNotBelongTo": {
    bn: "সদস্যটি এই দোকানের নয় বা পাওয়া যায়নি",
    en: "The member does not belong to this shop or was not found",
  },
  "booking.theDayOfTheWeekMust": {
    bn: "সপ্তাহের দিন ০ (রবিবার) থেকে ৬ (শনিবার) হতে হবে",
    en: "The day of the week must be 0 (Sunday) to 6 (Saturday)",
  },
  "booking.giveTheTimeInHhMm": {
    bn: "সময় HH:mm ফরম্যাটে দিতে হবে",
    en: "Give the time in HH:mm format",
  },
  "booking.theTimeMustBeValid": {
    bn: "সময় সঠিক হতে হবে",
    en: "The time must be valid",
  },
  "booking.theTimeRangeMustBeValid": {
    bn: "সময়সীমা সঠিক হতে হবে: ০ ≤ শুরু < শেষ ≤ ১৪৪০ মিনিট",
    en: "The time range must be valid: 0 ≤ start < end ≤ 1440 minutes",
  },
  "booking.theServiceWasNotFound": {
    bn: "সার্ভিসটি পাওয়া যায়নি",
    en: "The service was not found",
  },
  "booking.theServiceIsNotActive": {
    bn: "সার্ভিসটি সক্রিয় নয়",
    en: "The service is not active",
  },
  "booking.theServiceNameIsRequired": {
    bn: "সার্ভিসের নাম আবশ্যক",
    en: "The service name is required",
  },
  "booking.theServicePriceCannotBeNegative": {
    bn: "সার্ভিসের মূল্য ঋণাত্মক হতে পারে না",
    en: "The service price cannot be negative",
  },
  "booking.theServiceDurationMustBeBetween": {
    bn: "সার্ভিসের সময়কাল ৫ থেকে ১৪৪০ মিনিটের মধ্যে হতে হবে",
    en: "The service duration must be between 5 and 1440 minutes",
  },
  "booking.staffWasNotFound": {
    bn: "স্টাফ পাওয়া যায়নি",
    en: "Staff was not found",
  },
  "booking.theStaffMemberIsNotActive": {
    bn: "স্টাফ সক্রিয় নন",
    en: "The staff member is not active",
  },
};
