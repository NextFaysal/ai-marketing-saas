/**
 * MB4 (ML10) — delivery catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the delivery module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const deliveryCatalog: CatalogNamespace = {
  "delivery.orderNotFoundInThisOrganization": {
    bn: "এই organization-এ order পাওয়া যায়নি",
    en: "Order not found in this organization",
  },
  "delivery.accuracyIsNotValid": {
    bn: "accuracy সঠিক নয়",
    en: "accuracy is not valid",
  },
  "delivery.dateMustBeInYyyyMm": {
    bn: "date অবশ্যই YYYY-MM-DD ফরম্যাটে হতে হবে",
    en: "date must be in YYYY-MM-DD format",
  },
  "delivery.dateIsNotValid": {
    bn: "date সঠিক নয়",
    en: "date is not valid",
  },
  "delivery.latIsNotValidMustBe": {
    bn: "lat সঠিক নয় (-90 থেকে 90 এর মধ্যে হতে হবে)",
    en: "lat is not valid (must be between -90 and 90)",
  },
  "delivery.lngIsNotValidMustBe": {
    bn: "lng সঠিক নয় (-180 থেকে 180 এর মধ্যে হতে হবে)",
    en: "lng is not valid (must be between -180 and 180)",
  },
  "delivery.recordedatIsNotValid": {
    bn: "recordedAt সঠিক নয়",
    en: "recordedAt is not valid",
  },
  "delivery.aRiderIsAlreadyActiveOn": {
    bn: "এই অর্ডারে ইতিমধ্যে একজন রাইডার সক্রিয় আছেন",
    en: "A rider is already active on this order",
  },
  "delivery.thisRiderLinkWasNotFound": {
    bn: "এই রাইডার লিংকটি পাওয়া যায়নি",
    en: "This rider link was not found",
  },
  "delivery.thisRiderIsNotActiveActivate": {
    bn: "এই রাইডার সক্রিয় নন — আগে রাইডার সক্রিয় করুন",
    en: "This rider is not active — activate the rider first",
  },
  "delivery.thisRiderIsNotActiveLocation": {
    bn: "এই রাইডার সক্রিয় নন — লোকেশন পাঠানো যাচ্ছে না",
    en: "This rider is not active — location cannot be sent",
  },
  "delivery.thisRiderHasNoShareLink": {
    bn: "এই রাইডারের কোনো শেয়ার লিংক নেই",
    en: "This rider has no share link",
  },
  "delivery.thisLocationShareLinkHasBeen": {
    bn: "এই লোকেশন শেয়ার লিংকটি বাতিল করা হয়েছে — দোকান থেকে নতুন লিংক নিন",
    en: "This location share link has been revoked — collect a new link from the shop",
  },
  "delivery.thisLocationShareLinkHasExpired": {
    bn: "এই লোকেশন শেয়ার লিংকের মেয়াদ শেষ — দোকান থেকে নতুন লিংক নিন",
    en: "This location share link has expired — collect a new link from the shop",
  },
  "delivery.thereIsNoActiveDeliveryAssignment": {
    bn: "এখন কোনো সক্রিয় ডেলিভারি অ্যাসাইনমেন্ট নেই — লোকেশন পাঠানো যাচ্ছে না",
    en: "There is no active delivery assignment now — location cannot be sent",
  },
  "delivery.theDeliveryAssignmentWasNotFound": {
    bn: "ডেলিভারি অ্যাসাইনমেন্ট পাওয়া যায়নি",
    en: "The delivery assignment was not found",
  },
  "delivery.theRiderWasNotFound": {
    bn: "রাইডার পাওয়া যায়নি",
    en: "The rider was not found",
  },
  "delivery.theRiderNameCannotBeEmpty": {
    bn: "রাইডারের নাম খালি হতে পারে না",
    en: "The rider name cannot be empty",
  },
  "delivery.aRiderNameIsRequired": {
    bn: "রাইডারের নাম দরকার",
    en: "A rider name is required",
  },
  "delivery.theRiderPhoneNumberCannotBe": {
    bn: "রাইডারের ফোন নম্বর খালি হতে পারে না",
    en: "The rider phone number cannot be empty",
  },
  "delivery.aRiderPhoneNumberIsRequired": {
    bn: "রাইডারের ফোন নম্বর দরকার",
    en: "A rider phone number is required",
  },
  "delivery.locationSharingIsOffTurnSharing": {
    bn: "লোকেশন শেয়ারিং বন্ধ আছে — আগে এই পেজ থেকে শেয়ারিং চালু করুন",
    en: "Location sharing is off — turn sharing on from this page first",
  },
};
