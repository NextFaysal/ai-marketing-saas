/**
 * MB4 (ML10) — dropship catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the dropship module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const dropshipCatalog: CatalogNamespace = {
  "dropship.theDropshipOrderLinkWasNot": {
    bn: "Dropship অর্ডার লিংকটি পাওয়া যায়নি",
    en: "The Dropship order link was not found",
  },
  "dropship.theDropshipOrderFacilityIsNot": {
    bn: "Dropship অর্ডার সুবিধা এই deployment-এ নেই",
    en: "The Dropship order facility is not available in this deployment",
  },
  "dropship.orderNotFoundInThisOrganization": {
    bn: "এই organization-এ order পাওয়া যায়নি",
    en: "Order not found in this organization",
  },
  "dropship.productNotFoundInThisOrganization": {
    bn: "এই organization-এ product পাওয়া যায়নি",
    en: "Product not found in this organization",
  },
  "dropship.theSourceProductWasNotFound": {
    bn: "Source পণ্যটি পাওয়া যায়নি",
    en: "The source product was not found",
  },
  "dropship.supplierNotFoundInThisOrganization": {
    bn: "এই organization-এ supplier পাওয়া যায়নি",
    en: "Supplier not found in this organization",
  },
  "dropship.theSupplierOrderIsAlreadySupply": {
    bn: "Supplier অর্ডারটি ইতিমধ্যে \"{{status}}\" — সরবরাহ সম্পন্ন হয়ে গেছে, তাই বাতিল করা যাবে না",
    en: "The supplier order is already \"{{status}}\" — supply is complete, so it cannot be cancelled",
  },
  "dropship.theSupplierOrderWasNotFound": {
    bn: "Supplier অর্ডারটি পাওয়া যায়নি",
    en: "The supplier order was not found",
  },
  "dropship.roleMustBeSupplierOrSeller": {
    bn: "role অবশ্যই supplier অথবা seller হতে হবে — অন্য প্রতিষ্ঠানটি আপনার supplier না seller?",
    en: "role must be supplier or seller — is the other organization your supplier or seller?",
  },
  "dropship.mustBeAnIntegerOf0": {
    bn: "{{label}} অবশ্যই ০ বা তার বেশি পূর্ণসংখ্যা (পয়সায়) হতে হবে",
    en: "{{label}} must be an integer of 0 or more (in poisha)",
  },
  "dropship.theOtherOrganizationSSlugIs": {
    bn: "অন্য প্রতিষ্ঠানের স্লাগ (slug) আবশ্যক",
    en: "The other organization's slug is required",
  },
  "dropship.theOfferWasNotFoundOr": {
    bn: "অফারটি পাওয়া যায়নি অথবা সক্রিয় নয়",
    en: "The offer was not found or is not active",
  },
  "dropship.theOrderCancellationFacilityIsNot": {
    bn: "অর্ডার বাতিলের সুবিধা এই deployment-এ নেই",
    en: "The order cancellation facility is not available in this deployment",
  },
  "dropship.aPurchaseOrderCannotBeConfirmed": {
    bn: "এই অবস্থায় ({{poStatus}}) ক্রয় অর্ডার নিশ্চিত করা যাবে না",
    en: "A purchase order cannot be confirmed in this state ({{poStatus}})",
  },
  "dropship.thisInvitationHasAlreadyBeenAnswered": {
    bn: "এই আমন্ত্রণটির উত্তর ইতিমধ্যে দেওয়া হয়েছে",
    en: "This invitation has already been answered",
  },
  "dropship.thisPurchaseOrderIsAlreadyMarked": {
    bn: "এই ক্রয় অর্ডারটি ইতিমধ্যে পাঠানো হয়েছে বলে চিহ্নিত করা আছে",
    en: "This purchase order is already marked as sent",
  },
  "dropship.aListingForThisProductAlready": {
    bn: "এই পণ্যের লিস্টিং ইতিমধ্যে আছে",
    en: "A listing for this product already exists",
  },
  "dropship.thisPortalLinkHasBeenRevoked": {
    bn: "এই পোর্টাল লিংকটি বাতিল করা হয়েছে — দোকানের সাথে যোগাযোগ করুন",
    en: "This portal link has been revoked — contact the shop",
  },
  "dropship.thisPortalLinkHasExpiredContact": {
    bn: "এই পোর্টাল লিংকটির মেয়াদ শেষ হয়ে গেছে — দোকানের সাথে যোগাযোগ করুন",
    en: "This portal link has expired — contact the shop",
  },
  "dropship.thereIsAlreadyAPendingInvitation": {
    bn: "এই প্রতিষ্ঠান জুটির মধ্যে ইতিমধ্যে একটি অপেক্ষমাণ আমন্ত্রণ আছে",
    en: "There is already a pending invitation between this pair of organizations",
  },
  "dropship.thereIsAlreadyAnActiveAgreement": {
    bn: "এই প্রতিষ্ঠান জুটির মধ্যে ইতিমধ্যে একটি সক্রিয় চুক্তি আছে",
    en: "There is already an active agreement between this pair of organizations",
  },
  "dropship.thisLinkHasNoSupplierOrder": {
    bn: "এই লিংকের কোনো supplier অর্ডার নেই",
    en: "This link has no supplier order",
  },
  "dropship.thisSupplierAccountIsNotActive": {
    bn: "এই সরবরাহকারী অ্যাকাউন্টটি সক্রিয় নয়",
    en: "This supplier account is not active",
  },
  "dropship.thisSupplierIsNotActiveActivate": {
    bn: "এই সরবরাহকারী সক্রিয় নন — আগে সরবরাহকারী সক্রিয় করুন",
    en: "This supplier is not active — activate the supplier first",
  },
  "dropship.thisSupplierHasNoPortalLink": {
    bn: "এই সরবরাহকারীর কোনো পোর্টাল লিংক নেই",
    en: "This supplier has no portal link",
  },
  "dropship.noOrganizationWasFoundWithThis": {
    bn: "এই স্লাগে কোনো প্রতিষ্ঠান পাওয়া যায়নি",
    en: "No organization was found with this slug",
  },
  "dropship.nothingWasSent": {
    bn: "কিছুই পাঠানো হয়নি",
    en: "Nothing was sent",
  },
  "dropship.thePurchaseOrderWasNotFound": {
    bn: "ক্রয় অর্ডারটি পাওয়া যায়নি",
    en: "The purchase order was not found",
  },
  "dropship.aFulfilmentOrderCannotBeSent": {
    bn: "ক্রেতার ফোন নম্বর ছাড়া সরবরাহকারীর কাছে ফুলফিলমেন্ট অর্ডার পাঠানো যাবে না",
    en: "A fulfilment order cannot be sent to the supplier without the buyer's phone number",
  },
  "dropship.theAgreementHasAlreadyBeenCancelled": {
    bn: "চুক্তিটি ইতিমধ্যে বাতিল করা হয়েছে",
    en: "The agreement has already been cancelled",
  },
  "dropship.theAgreementIsNotActiveYet": {
    bn: "চুক্তিটি এখনো সক্রিয় নয় — গ্রহণ (accepted) না হওয়া পর্যন্ত কিছুই শেয়ার করা হয় না",
    en: "The agreement is not active yet — nothing is shared until it is accepted",
  },
  "dropship.theAgreementWasNotFound": {
    bn: "চুক্তিটি পাওয়া যায়নি",
    en: "The agreement was not found",
  },
  "dropship.youCannotAnswerAnInvitationYou": {
    bn: "নিজের পাঠানো আমন্ত্রণের উত্তর নিজে দেওয়া যাবে না — অন্য প্রতিষ্ঠানের মালিক/অ্যাডমিন উত্তর দেবেন",
    en: "You cannot answer an invitation you sent yourself — the other organization's owner/admin will answer",
  },
  "dropship.youCannotInviteYourOwnOrganization": {
    bn: "নিজের প্রতিষ্ঠানকেই আমন্ত্রণ জানানো যাবে না",
    en: "You cannot invite your own organization",
  },
  "dropship.thePortalLinkWasNotFound": {
    bn: "পোর্টাল লিংকটি পাওয়া যায়নি",
    en: "The portal link was not found",
  },
  "dropship.thereIsNothingToCancelIn": {
    bn: "প্রত্যাখ্যাত আমন্ত্রণ বাতিল করার কিছু নেই",
    en: "There is nothing to cancel in a rejected invitation",
  },
  "dropship.theSellingPriceCannotBeLower": {
    bn: "বিক্রয় মূল্য ফ্লোর মূল্যের ({{p1}}) চেয়ে কম হতে পারবে না",
    en: "The selling price cannot be lower than the floor price ({{p1}})",
  },
  "dropship.theLeadTimeDaysMustBe": {
    bn: "লিড টাইম (দিন) অবশ্যই ০–৩৬৫-এর মধ্যে একটি পূর্ণসংখ্যা হতে হবে",
    en: "The lead time (days) must be an integer between 0 and 365",
  },
  "dropship.theListingWasNotFound": {
    bn: "লিস্টিংটি পাওয়া যায়নি",
    en: "The listing was not found",
  },
  "dropship.onlyASellerOrganizationCanCreate": {
    bn: "শুধুমাত্র seller প্রতিষ্ঠানই তাদের দোকানে লিস্টিং তৈরি করতে পারে",
    en: "Only a seller organization can create a listing in their shop",
  },
  "dropship.onlyASourceSupplierOrganizationCan": {
    bn: "শুধুমাত্র source (supplier) প্রতিষ্ঠানই পণ্য অফার করতে পারে",
    en: "Only a source (supplier) organization can offer a product",
  },
  "dropship.onlyAConfirmedOrderedPurchaseOrder": {
    bn: "শুধুমাত্র নিশ্চিত (ordered) ক্রয় অর্ডারই পাঠানো হয়েছে বলে চিহ্নিত করা যাবে — আগে নিশ্চিত করুন",
    en: "Only a confirmed (ordered) purchase order can be marked as sent — confirm it first",
  },
};
