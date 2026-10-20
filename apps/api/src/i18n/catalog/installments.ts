/**
 * MB4 (ML10) — installments catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the installments module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const installmentsCatalog: CatalogNamespace = {
  "installments.orderNotFoundInThisOrganization": {
    bn: "এই organization-এ order পাওয়া যায়নি",
    en: "Order not found in this organization",
  },
  "installments.thisTransactionReferenceHasAlreadyBeen": {
    bn: "এই transaction reference ইতিমধ্যে একটি verified payment হিসেবে recorded হয়েছে",
    en: "This transaction reference has already been recorded as a verified payment",
  },
  "installments.bucketMustBeTodayOrOverdue": {
    bn: "bucket হতে হবে today অথবা overdue",
    en: "bucket must be today or overdue",
  },
  "installments.aCancelledInstallmentPlanExistedOn": {
    bn: "এই অর্ডারে আগে একটি বাতিল কিস্তি প্ল্যান ছিল — নতুন প্ল্যান তৈরি করা যাচ্ছে না",
    en: "A cancelled installment plan existed on this order before — a new plan cannot be created",
  },
  "installments.anActiveInstallmentPlanAlreadyExists": {
    bn: "এই অর্ডারে ইতিমধ্যে একটি সক্রিয় কিস্তি প্ল্যান আছে",
    en: "An active installment plan already exists on this order",
  },
  "installments.thereIsNoOutstandingOnThis": {
    bn: "এই অর্ডারে বকেয়া নেই — কিস্তি প্ল্যান দরকার নেই",
    en: "There is no outstanding on this order — no installment plan is needed",
  },
  "installments.thisOrderSInstallmentPlanIs": {
    bn: "এই অর্ডারের কিস্তি প্ল্যান ইতিমধ্যে সম্পূর্ণ হয়েছে",
    en: "This order's installment plan is already complete",
  },
  "installments.thisInstallmentIsAlreadyFullyPaid": {
    bn: "এই কিস্তিটি ইতিমধ্যে সম্পূর্ণ পরিশোধ হয়েছে",
    en: "This installment is already fully paid",
  },
  "installments.theInstallmentPlanWasNotFound": {
    bn: "কিস্তি প্ল্যান পাওয়া যায়নি",
    en: "The installment plan was not found",
  },
  "installments.theInstallmentItemWasNotFound": {
    bn: "কিস্তির আইটেম পাওয়া যায়নি",
    en: "The installment item was not found",
  },
  "installments.theInstallmentIntervalMustBeBetween": {
    bn: "কিস্তির ব্যবধান ১ থেকে ৯০ দিনের মধ্যে হতে হবে",
    en: "The installment interval must be between 1 and 90 days",
  },
  "installments.theNumberOfInstallmentsMustBe": {
    bn: "কিস্তির সংখ্যা ২ থেকে ২৪-এর মধ্যে হতে হবে",
    en: "The number of installments must be between 2 and 24",
  },
  "installments.thePlanIsNotActiveIt": {
    bn: "প্ল্যানটি সক্রিয় নয় — বাতিল করা যাচ্ছে না",
    en: "The plan is not active — it cannot be cancelled",
  },
  "installments.thePlanIsNotActiveIt2": {
    bn: "প্ল্যানটি সক্রিয় নয় — সংগ্রহ করা যাচ্ছে না",
    en: "The plan is not active — it cannot be collected",
  },
  "installments.theOutstandingAmountIsTooSmall": {
    bn: "বকেয়া পরিমাণ কিস্তির সংখ্যার তুলনায় খুব কম",
    en: "The outstanding amount is too small compared to the number of installments",
  },
  "installments.theStartDateIsNotValid": {
    bn: "শুরুর তারিখ সঠিক নয়",
    en: "The start date is not valid",
  },
  "installments.theCollectionAmountCannotExceedThis": {
    bn: "সংগ্রহের পরিমাণ ({{p1}}) এই কিস্তির বাকি ({{p2}})-এর বেশি হতে পারবে না",
    en: "The collection amount ({{p1}}) cannot exceed this installment's remainder ({{p2}})",
  },
  "installments.theCollectionAmountMustBeMore": {
    bn: "সংগ্রহের পরিমাণ শূন্যের বেশি হতে হবে",
    en: "The collection amount must be more than zero",
  },
};
