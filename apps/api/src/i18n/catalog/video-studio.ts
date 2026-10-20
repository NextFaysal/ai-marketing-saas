/**
 * MB4 (ML10) — video-studio catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the video-studio module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const videoStudioCatalog: CatalogNamespace = {
  "videoStudio.productNotFoundInThisOrganization": {
    bn: "এই organization-এ product পাওয়া যায়নি",
    en: "Product not found in this organization",
  },
  "videoStudio.theSocialServiceIsNotAvailable": {
    bn: "Social service এই deployment-এ পাওয়া যাচ্ছে না",
    en: "The Social service is not available in this deployment",
  },
  "videoStudio.languageMustBe": {
    bn: "language হতে হবে: {{p1}}",
    en: "language must be: {{p1}}",
  },
  "videoStudio.productidIsRequired": {
    bn: "productId আবশ্যক",
    en: "productId is required",
  },
  "videoStudio.templateMustBe": {
    bn: "template হতে হবে: {{p1}}",
    en: "template must be: {{p1}}",
  },
  "videoStudio.noConnectedSocialAccountWasFound": {
    bn: "কোনো connected Social অ্যাকাউন্ট পাওয়া যায়নি — আগে Connect Center থেকে একটি অ্যাকাউন্ট যুক্ত করুন",
    en: "No connected Social account was found — connect an account from the Connect Center first",
  },
  "videoStudio.theVideoProjectWasNotFound": {
    bn: "ভিডিও প্রজেক্টটি পাওয়া যায়নি",
    en: "The video project was not found",
  },
  "videoStudio.onlyAReadyVideoCanBe": {
    bn: "শুধু ready অবস্থার ভিডিও Publish করা যাবে — আগে Render শেষ হতে দিন",
    en: "Only a ready video can be Published — let the Render finish first",
  },
};
