/**
 * MB4 (ML10) — fulfillment catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the fulfillment module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const fulfillmentCatalog: CatalogNamespace = {
  "fulfillment.theQuantityOfCannotExceedThe": {
    bn: "\"{{oiName}}\"-এর পরিমাণ অর্ডারের পরিমাণের বেশি হতে পারবে না",
    en: "The quantity of \"{{oiName}}\" cannot exceed the order quantity",
  },
  "fulfillment.courierServiceIsNotAvailableIn": {
    bn: "এই deployment-এ Courier service পাওয়া যাচ্ছে না",
    en: "Courier service is not available in this deployment",
  },
  "fulfillment.courierShipmentNotFoundForThis": {
    bn: "এই order-এর জন্য courier shipment পাওয়া যায়নি",
    en: "Courier shipment not found for this order",
  },
  "fulfillment.fulfillmentNotFoundInThisOrganization": {
    bn: "এই organization-এ Fulfillment পাওয়া যায়নি",
    en: "Fulfillment not found in this organization",
  },
  "fulfillment.orderIsNotInThisWave": {
    bn: "Order এই wave-এ নেই",
    en: "Order is not in this wave",
  },
  "fulfillment.orderNotFoundInThisOrganization": {
    bn: "এই organization-এ order পাওয়া যায়নি",
    en: "Order not found in this organization",
  },
  "fulfillment.pickWaveNotFoundInThis": {
    bn: "এই organization-এ pick wave পাওয়া যায়নি",
    en: "Pick wave not found in this organization",
  },
  "fulfillment.returnLinkNotFound": {
    bn: "Return link পাওয়া যায়নি",
    en: "Return link not found",
  },
  "fulfillment.returnRequestNotFoundInThis": {
    bn: "এই organization-এ return request পাওয়া যায়নি",
    en: "Return request not found in this organization",
  },
  "fulfillment.courierProviderIsRequired": {
    bn: "courier (provider) দরকার",
    en: "courier (provider) is required",
  },
  "fulfillment.outcomeMustBeOneOf": {
    bn: "outcome অবশ্যই এর একটি হতে হবে: {{p1}}",
    en: "outcome must be one of: {{p1}}",
  },
  "fulfillment.sendTheRefundAmountAsA": {
    bn: "refund-এর পরিমাণ সঠিক সংখ্যায় পাঠান (পয়সায়)",
    en: "Send the refund amount as a proper number (in poisha)",
  },
  "fulfillment.rescheduledateIsNotValidGiveIt": {
    bn: "rescheduleDate সঠিক নয় — YYYY-MM-DD ফরম্যাটে দিন",
    en: "rescheduleDate is not valid — give it in YYYY-MM-DD format",
  },
  "fulfillment.resolutionMustBeOneOf": {
    bn: "resolution অবশ্যই এর একটি হতে হবে: {{p1}}",
    en: "resolution must be one of: {{p1}}",
  },
  "fulfillment.shipmentidIsNotAShipmentOf": {
    bn: "shipmentId এই অর্ডারের শিপমেন্ট নয়",
    en: "shipmentId is not a shipment of this order",
  },
  "fulfillment.statusMustBeOneOf": {
    bn: "status অবশ্যই এর একটি হতে হবে: {{p1}}",
    en: "status must be one of: {{p1}}",
  },
  "fulfillment.mustBeAnIntegerBetween1": {
    bn: "{{key}} অবশ্যই ১–৭২০-এর মধ্যে একটি পূর্ণসংখ্যা হতে হবে",
    en: "{{key}} must be an integer between 1 and 720",
  },
  "fulfillment.unknownBulkActionValidActions": {
    bn: "অজানা bulk action \"{{dtoAction}}\" — সঠিক action: {{p2}}",
    en: "Unknown bulk action \"{{dtoAction}}\" — valid actions: {{p2}}",
  },
  "fulfillment.unknownCourierProvider": {
    bn: "অজানা কুরিয়ার প্রোভাইডার \"{{paramsProvider}}\"",
    en: "Unknown courier provider \"{{paramsProvider}}\"",
  },
  "fulfillment.statusIsRequired": {
    bn: "অবস্থা (status) দরকার",
    en: "Status is required",
  },
  "fulfillment.thisItemIsNotInThe": {
    bn: "অর্ডারে এই আইটেমটি নেই",
    en: "This item is not in the order",
  },
  "fulfillment.theItemQuantityCannotExceedThe": {
    bn: "আইটেমের পরিমাণ বাকি পরিমাণের ({{rem}}) বেশি হতে পারবে না",
    en: "The item quantity cannot exceed the remaining quantity ({{rem}})",
  },
  "fulfillment.thisOrderHasNoShipmentA": {
    bn: "এই অর্ডারের কোনো শিপমেন্ট নেই — ডেলিভারি চেষ্টা রেকর্ড করা যাবে না",
    en: "This order has no shipment — a delivery attempt cannot be recorded",
  },
  "fulfillment.allItemsOfThisOrderHave": {
    bn: "এই অর্ডারের সব আইটেম আগেই ফুলফিল করা হয়েছে",
    en: "All items of this order have already been fulfilled",
  },
  "fulfillment.thisReturnLinkIsNoLonger": {
    bn: "এই রিটার্ন লিংকটি আর সক্রিয় নয়",
    en: "This return link is no longer active",
  },
  "fulfillment.aReturnRequestForThisReturn": {
    bn: "এই রিটার্নের আবেদন আগেই জমা দেওয়া হয়েছে",
    en: "A return request for this return has already been submitted",
  },
  "fulfillment.select1100OrdersInA": {
    bn: "একটি ওয়েভে ১–১০০টি অর্ডার বেছে নিন",
    en: "Select 1–100 orders in a wave",
  },
  "fulfillment.aCustomerPhoneNumberIsNeeded": {
    bn: "এক্সচেঞ্জ অর্ডারের জন্য কাস্টমারের ফোন নম্বর দরকার — কাস্টমার রেকর্ডে ফোন নেই",
    en: "A customer phone number is needed for an exchange order — there is no phone on the customer record",
  },
  "fulfillment.theWaveIsClosedPickingIs": {
    bn: "ওয়েভটি বন্ধ হয়ে গেছে — আর পিক করা যাবে না",
    en: "The wave is closed — picking is no longer possible",
  },
  "fulfillment.selectAtLeastOneItem": {
    bn: "কমপক্ষে একটি আইটেম বেছে দিন",
    en: "Select at least one item",
  },
  "fulfillment.theCustomerHasNotSubmittedThe": {
    bn: "কাস্টমার এখনো আবেদন জমা দেননি",
    en: "The customer has not submitted the request yet",
  },
  "fulfillment.noOrderCouldBeTakenInto": {
    bn: "কোনো অর্ডারই ওয়েভে নেওয়া যায়নি — {{reasons}}",
    en: "No order could be taken into the wave — {{reasons}}",
  },
  "fulfillment.aTagIsRequired": {
    bn: "ট্যাগ দরকার",
    en: "A tag is required",
  },
  "fulfillment.anAssigneeAssigneeidIsRequired": {
    bn: "দায়িত্বপ্রাপ্ত সদস্য (assigneeId) দরকার",
    en: "An assignee (assigneeId) is required",
  },
  "fulfillment.aRescheduledateYyyyMmDdIs": {
    bn: "পুনঃনির্ধারিত ডেলিভারির জন্য rescheduleDate (YYYY-MM-DD) দরকার",
    en: "A rescheduleDate (YYYY-MM-DD) is required for rescheduled delivery",
  },
  "fulfillment.anOrderCannotBeRemovedFrom": {
    bn: "বন্ধ ওয়েভ থেকে অর্ডার সরানো যাবে না",
    en: "An order cannot be removed from a closed wave",
  },
  "fulfillment.theMerchantSReturnAddressPhone": {
    bn: "মার্চেন্টের ফেরতের ঠিকানা/ফোন পাওয়া যায়নি — Settings-এ ব্যবসার ঠিকানা ও ফোন বসান, অথবা অনুরোধে ঠিকানা পাঠান",
    en: "The merchant's return address/phone was not found — set the business address and phone in Settings, or send the address in the request",
  },
  "fulfillment.onlyAReceivedReturnCanBe": {
    bn: "শুধু received রিটার্নই complete করা যায়",
    en: "Only a received return can be completed",
  },
  "fulfillment.aReturnCourierCanOnlyBe": {
    bn: "শুধু অনুমোদিত রিটার্নের জন্য return courier বুক করা যায়",
    en: "A return courier can only be booked for an approved return",
  },
  "fulfillment.onlyAnApprovedSentReturnCan": {
    bn: "শুধু অনুমোদিত/পাঠানো রিটার্নই received করা যায়",
    en: "Only an approved/sent return can be received",
  },
  "fulfillment.aDecisionCanOnlyBeGiven": {
    bn: "শুধু আবেদন করা (requested) রিটার্নেই সিদ্ধান্ত দেওয়া যায়",
    en: "A decision can only be given on a requested return",
  },
  "fulfillment.select1100Orders": {
    bn: "১–১০০টি অর্ডার বেছে নিন",
    en: "Select 1–100 orders",
  },
};
