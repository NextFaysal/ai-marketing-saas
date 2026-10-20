/**
 * MB4 (ML10) — hr catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the hr module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const hrCatalog: CatalogNamespace = {
  "hr.theAdjustmentAmountCannotBe0": {
    bn: "adjustment-এর পরিমাণ ০ হতে পারে না",
    en: "The adjustment amount cannot be 0",
  },
  "hr.thereCanBeAtMost20": {
    bn: "adjustments সর্বোচ্চ ২০টি হতে পারে",
    en: "There can be at most 20 adjustments",
  },
  "hr.commissionruleCanOnlyBeOneOf": {
    bn: "commissionRule শুধু এই মানগুলোর একটি হতে পারে: {{p1}}",
    en: "commissionRule can only be one of these values: {{p1}}",
  },
  "hr.giveEffectivefromInYyyyMmDd": {
    bn: "effectiveFrom YYYY-MM-DD আকারে দিন",
    en: "Give effectiveFrom in YYYY-MM-DD form",
  },
  "hr.membershipidIsRequired": {
    bn: "membershipId আবশ্যক",
    en: "membershipId is required",
  },
  "hr.aPaidRunCannotBeChanged": {
    bn: "paid রান বদলানো যায় না — রানটি ইতিমধ্যে পরিশোধিত",
    en: "A paid run cannot be changed — the run is already paid",
  },
  "hr.unpaidleaveruleCanOnlyBeOneOf": {
    bn: "unpaidLeaveRule শুধু এই মানগুলোর একটি হতে পারে: {{p1}}",
    en: "unpaidLeaveRule can only be one of these values: {{p1}}",
  },
  "hr.weekdayMustBeBetween0And": {
    bn: "weekday ০–৬ এর মধ্যে হতে হবে (০ = রবিবার)",
    en: "weekday must be between 0 and 6 (0 = Sunday)",
  },
  "hr.isNotAValidTime": {
    bn: "{{label}} সঠিক সময় নয়",
    en: "{{label}} is not a valid time",
  },
  "hr.unknownCommissionruleTheRunCannotBe": {
    bn: "অজানা commissionRule — রান তৈরি করা যাবে না",
    en: "Unknown commissionRule — the run cannot be created",
  },
  "hr.unknownUnpaidleaveruleTheRunCannotBe": {
    bn: "অজানা unpaidLeaveRule — রান তৈরি করা যাবে না",
    en: "Unknown unpaidLeaveRule — the run cannot be created",
  },
  "hr.alreadyCheckedOutToday": {
    bn: "আজ ইতিমধ্যে চেক-আউট করা হয়েছে",
    en: "Already checked out today",
  },
  "hr.alreadyCheckedInToday": {
    bn: "আজ ইতিমধ্যে চেক-ইন করা হয়েছে",
    en: "Already checked in today",
  },
  "hr.notCheckedInYetToday": {
    bn: "আজ এখনো চেক-ইন করা হয়নি",
    en: "Not checked in yet today",
  },
  "hr.youAreNotAMemberOf": {
    bn: "আপনি এই organization-এর সদস্য নন",
    en: "You are not a member of this organization",
  },
  "hr.youCanOnlyViewYourOwn": {
    bn: "আপনি শুধু নিজের পে-স্লিপ দেখতে পারবেন",
    en: "You can only view your own pay-slip",
  },
  "hr.aDecisionHasAlreadyBeenTaken": {
    bn: "এই আবেদনের সিদ্ধান্ত ইতিমধ্যে নেওয়া হয়েছে — পুনরায় সিদ্ধান্ত দেওয়া যাবে না",
    en: "A decision has already been taken on this application — it cannot be decided again",
  },
  "hr.thisMonthSPayrollRunIs": {
    bn: "এই মাসের পে-রোল রান ইতিমধ্যে পরিশোধিত (paid) — paid রান বদলানো যায় না",
    en: "This month's payroll run is already paid — a paid run cannot be changed",
  },
  "hr.sendAtLeastOneRule": {
    bn: "কমপক্ষে একটি নিয়ম পাঠান",
    en: "Send at least one rule",
  },
  "hr.checkOutCannotBeBeforeCheck": {
    bn: "চেক-আউট চেক-ইনের আগে হতে পারে না",
    en: "Check-out cannot be before check-in",
  },
  "hr.theLeaveApplicationWasNotFound": {
    bn: "ছুটির আবেদনটি পাওয়া যায়নি",
    en: "The leave application was not found",
  },
  "hr.giveTheLeaveDatesInYyyy": {
    bn: "ছুটির তারিখ YYYY-MM-DD আকারে দিন",
    en: "Give the leave dates in YYYY-MM-DD form",
  },
  "hr.theLeaveTypeMustBePaid": {
    bn: "ছুটির ধরন paid অথবা unpaid হতে হবে",
    en: "The leave type must be paid or unpaid",
  },
  "hr.theLeaveDurationMustBeBetween": {
    bn: "ছুটির মেয়াদ ১–৩৬৬ দিনের মধ্যে হতে হবে",
    en: "The leave duration must be between 1 and 366 days",
  },
  "hr.giveTheDateInYyyyMm": {
    bn: "তারিখ YYYY-MM-DD আকারে দিন",
    en: "Give the date in YYYY-MM-DD form",
  },
  "hr.thePayrollRunWasNotFound": {
    bn: "পে-রোল রানটি পাওয়া যায়নি",
    en: "The payroll run was not found",
  },
  "hr.thePayrollLineWasNotFound": {
    bn: "পে-রোল লাইনটি পাওয়া যায়নি",
    en: "The payroll line was not found",
  },
  "hr.thePaySlipWasNotFound": {
    bn: "পে-স্লিপটি পাওয়া যায়নি",
    en: "The pay-slip was not found",
  },
  "hr.thePaySlipInformationWasNot": {
    bn: "পে-স্লিপের তথ্য পাওয়া যায়নি",
    en: "The pay-slip information was not found",
  },
  "hr.aLabelIsRequiredInEvery": {
    bn: "প্রতিটি adjustment-এ label আবশ্যক",
    en: "A label is required in every adjustment",
  },
  "hr.aNoteIsRequiredInEvery": {
    bn: "প্রতিটি adjustment-এ note আবশ্যক — কারণ ছাড়া ম্যানুয়াল লাইন যোগ করা যাবে না",
    en: "A note is required in every adjustment — a manual line cannot be added without a reason",
  },
  "hr.theYearIsNotValid": {
    bn: "বছর সঠিক নয়",
    en: "The year is not valid",
  },
  "hr.giveTheMonthInYyyyMm": {
    bn: "মাস YYYY-MM আকারে দিন",
    en: "Give the month in YYYY-MM form",
  },
  "hr.theMonthMustBeBetween1": {
    bn: "মাস ১–১২ এর মধ্যে হতে হবে",
    en: "The month must be between 1 and 12",
  },
  "hr.giveTheBaseSalaryAsA": {
    bn: "মূল বেতন ধনাত্মক পরিমাণে দিন (minor units)",
    en: "Give the base salary as a positive amount (minor units)",
  },
  "hr.theRunIsAlreadyPaidA": {
    bn: "রানটি ইতিমধ্যে paid — পুনরায় পরিশোধের রেকর্ড করা যাবে না",
    en: "The run is already paid — a payment record cannot be made again",
  },
  "hr.thereCanBeAtMost21": {
    bn: "শিফট প্যাটার্ন সর্বোচ্চ ২১টি হতে পারে",
    en: "There can be at most 21 shift patterns",
  },
  "hr.theShiftTimeIsNotValid": {
    bn: "শিফটের সময় সঠিক নয় — শেষ সময় শুরুর পরে হতে হবে (মিনিটে, ০–১৪৪০)",
    en: "The shift time is not valid — the end time must be after the start (in minutes, 0–1440)",
  },
  "hr.onlyActiveMembersCanGiveAttendance": {
    bn: "শুধু সক্রিয় সদস্যরাই হাজিরা দিতে পারবেন",
    en: "Only active members can give attendance",
  },
  "hr.theEndDateCannotBeBefore": {
    bn: "শেষের তারিখ শুরুর তারিখের আগে হতে পারে না",
    en: "The end date cannot be before the start date",
  },
  "hr.aCorrectionReasonCorrectionnoteIsRequired": {
    bn: "সংশোধনের কারণ (correctionNote) আবশ্যক",
    en: "A correction reason (correctionNote) is required",
  },
  "hr.theMemberWasNotFound": {
    bn: "সদস্যটি পাওয়া যায়নি",
    en: "The member was not found",
  },
  "hr.theDecisionMustBeApprovedOr": {
    bn: "সিদ্ধান্ত approved অথবা rejected হতে হবে",
    en: "The decision must be approved or rejected",
  },
};
