/**
 * MB4 (ML10) — landings catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the landings module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const landingsCatalog: CatalogNamespace = {
  "landings.aLandingPageWithSlugAlready": {
    bn: "\"{{slug}}\" slug দিয়ে একটি landing page ইতিমধ্যে আছে",
    en: "A landing page with slug \"{{slug}}\" already exists",
  },
  "landings.checkoutOrderingIsUnavailableIntegrationsService": {
    bn: "Checkout ordering পাওয়া যাচ্ছে না (integrations service নেই)",
    en: "Checkout ordering is unavailable (integrations service missing)",
  },
  "landings.deliveryZonesAreUnavailableStorefrontService": {
    bn: "Delivery zones পাওয়া যাচ্ছে না (storefront service নেই)",
    en: "Delivery zones are unavailable (storefront service missing)",
  },
  "landings.landingPageNotFoundInThis": {
    bn: "এই organization-এ landing page পাওয়া যায়নি",
    en: "Landing page not found in this organization",
  },
  "landings.productIsUnavailableOrOutOf": {
    bn: "Product পাওয়া যাচ্ছে না অথবা stock শেষ",
    en: "Product is unavailable or out of stock",
  },
  "landings.productNotFoundInThisOrganization": {
    bn: "এই organization-এ product পাওয়া যায়নি",
    en: "Product not found in this organization",
  },
  "landings.variantNotFoundForThisLanding": {
    bn: "এই landing page-এর জন্য variant পাওয়া যায়নি",
    en: "Variant not found for this landing page",
  },
  "landings.slugMustBeUrlFriendlyLowercase": {
    bn: "slug অবশ্যই URL-বান্ধব হতে হবে (ছোট হাতের অক্ষর, সংখ্যা ও হাইফেন)",
    en: "slug must be URL-friendly (lowercase letters, digits and hyphens)",
  },
  "landings.weightMustBeAnIntegerBetween": {
    bn: "weight অবশ্যই ০ থেকে ১০০-এর মধ্যে পূর্ণসংখ্যা হতে হবে",
    en: "weight must be an integer between 0 and 100",
  },
  "landings.unknownLandingStatus": {
    bn: "অজানা landing status: {{status}}",
    en: "Unknown landing status: {{status}}",
  },
  "landings.readingTheTermsAndAgreeingIs": {
    bn: "অর্ডার সম্পূর্ণ করতে শর্তাবলি পড়ে সম্মতি দেওয়া বাধ্যতামূলক",
    en: "Reading the terms and agreeing is mandatory to complete the order",
  },
  "landings.theOrderDoesNotBelongTo": {
    bn: "অর্ডারটি এই ল্যান্ডিং পেজের সংস্থার নয়",
    en: "The order does not belong to this landing page's organization",
  },
  "landings.theOrderIsNowInStatus": {
    bn: "অর্ডারটি এখন \"{{orderStatus}}\" অবস্থায় আছে — আপসেল শুধু খোলা (pending/processing/on-hold) অর্ডারে যোগ করা যায়",
    en: "The order is now in \"{{orderStatus}}\" status — an upsell can only be added to an open (pending/processing/on-hold) order",
  },
  "landings.theOrderWasNotFound": {
    bn: "অর্ডারটি পাওয়া যায়নি",
    en: "The order was not found",
  },
  "landings.theOrderSFulfillmentHasStarted": {
    bn: "অর্ডারটির ফুলফিলমেন্ট শুরু হয়ে গেছে — এখন আপসেল যোগ করা যাবে না",
    en: "The order's fulfillment has started — an upsell cannot be added now",
  },
  "landings.theUpsellProductIsNotAvailable": {
    bn: "আপসেল পণ্যটি এখন পাওয়া যাচ্ছে না",
    en: "The upsell product is not available now",
  },
  "landings.theUpsellTimeLimit2Hours": {
    bn: "আপসেলের সময়সীমা (২ ঘণ্টা) পার হয়ে গেছে",
    en: "The upsell time limit (2 hours) has passed",
  },
  "landings.thisOnlinePaymentOptionIsNot": {
    bn: "এই অনলাইন পেমেন্টের অপশনটি এই দোকানে উপলব্ধ নয় — অন্য পেমেন্ট পদ্ধতি বেছে নিন।",
    en: "This online payment option is not available in this shop — choose another payment method.",
  },
  "landings.thisOrderDidNotComeFrom": {
    bn: "এই অর্ডারটি এই ল্যান্ডিং পেজ থেকে আসেনি",
    en: "This order did not come from this landing page",
  },
  "landings.thisUpsellProductHasAlreadyBeen": {
    bn: "এই আপসেল পণ্যটি ইতিমধ্যে অর্ডারে যোগ করা হয়েছে",
    en: "This upsell product has already been added to the order",
  },
  "landings.deliveryIsNotSetUpFor": {
    bn: "এই এলাকায় ডেলিভারি সেট করা নেই — অন্য জেলা বেছে নিন অথবা দোকানে যোগাযোগ করুন",
    en: "Delivery is not set up for this area — choose another district or contact the shop",
  },
  "landings.noUpsellProductIsSetOn": {
    bn: "এই ল্যান্ডিং পেজে কোনো আপসেল পণ্য সেট করা নেই",
    en: "No upsell product is set on this landing page",
  },
  "landings.thisSlotDoesNotApplyTo": {
    bn: "এই স্লটটি আপনার এলাকার জন্য প্রযোজ্য নয়",
    en: "This slot does not apply to your area",
  },
  "landings.thisSlotIsFullChooseAnother": {
    bn: "এই স্লটটি পূর্ণ — অন্য স্লট বা তারিখ বেছে নিন",
    en: "This slot is full — choose another slot or date",
  },
  "landings.theCouponCouldNotBeApplied": {
    bn: "কুপন প্রয়োগ করা যায়নি: {{p1}}",
    en: "The coupon could not be applied: {{p1}}",
  },
  "landings.theCouponFacilityIsNotAvailable": {
    bn: "কুপন সুবিধা এই deployment-এ নেই",
    en: "The coupon facility is not available in this deployment",
  },
  "landings.yourDistrictMustBeGivenTo": {
    bn: "ডেলিভারি জোন নির্ধারণে আপনার জেলা দিতে হবে",
    en: "Your district must be given to determine the delivery zone",
  },
  "landings.theDeliverySlotWasNotFound": {
    bn: "ডেলিভারি স্লটটি পাওয়া যায়নি বা বন্ধ আছে",
    en: "The delivery slot was not found or is closed",
  },
  "landings.sorryHasOnlyInStockMore": {
    bn: "দুঃখিত, \"{{pName}}\"-এর স্টকে মাত্র {{p2}}টি আছে — এর বেশি অর্ডার করা যাবে না",
    en: "Sorry, \"{{pName}}\" has only {{p2}} in stock — more cannot be ordered",
  },
  "landings.sorryCashOnDeliveryDoesNot": {
    bn: "দুঃখিত, এই অর্ডারের জন্য ক্যাশ অন ডেলিভারি প্রযোজ্য নয়",
    en: "Sorry, cash on delivery does not apply to this order",
  },
  "landings.sorryTheOrderCannotBeTaken": {
    bn: "দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না",
    en: "Sorry, the order cannot be taken at this moment",
  },
  "landings.theVariantDoesNotBelongTo": {
    bn: "ভ্যারিয়েন্টটি এই পণ্যের নয়",
    en: "The variant does not belong to this product",
  },
  "landings.theLandingPageWasNotFound": {
    bn: "ল্যান্ডিং পেজটি পাওয়া যায়নি",
    en: "The landing page was not found",
  },
  "landings.theStockCouldNotBeUpdated": {
    bn: "স্টক আপডেট করা যায়নি — আপসেল যোগ করা হয়নি",
    en: "The stock could not be updated — the upsell was not added",
  },
  "landings.ifASlotIsChosenThe": {
    bn: "স্লট বেছে নিলে তারিখও দিতে হবে",
    en: "If a slot is chosen, the date must also be given",
  },
};
