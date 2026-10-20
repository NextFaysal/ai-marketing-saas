/**
 * MB4 (ML10) — tracking catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the tracking module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const trackingCatalog: CatalogNamespace = {
  "tracking.batchTooLargeMaxEvents": {
    bn: "Batch খুব বড়: সর্বোচ্চ {{MAX_BATCH}} events",
    en: "Batch too large: max {{MAX_BATCH}} events",
  },
  "tracking.unknownTrackingKey": {
    bn: "অজানা tracking key",
    en: "Unknown tracking key",
  },
  "tracking.theEmailCouldNotBeSent": {
    bn: "ইমেইল পাঠানো যায়নি: {{p1}}",
    en: "The email could not be sent: {{p1}}",
  },
  "tracking.theEmailSendingFacilityIsNot": {
    bn: "ইমেইল পাঠানোর সুবিধা এই deployment-এ নেই",
    en: "The email sending facility is not available in this deployment",
  },
  "tracking.aRecoveryEmailHasAlreadyBeen": {
    bn: "এই কার্টের জন্য recovery ইমেইল ইতিমধ্যে পাঠানো হয়েছে",
    en: "A recovery email has already been sent for this cart",
  },
  "tracking.noAbandonedCartWasFoundFor": {
    bn: "এই ভিজিটরের কোনো abandoned cart পাওয়া যায়নি",
    en: "No abandoned cart was found for this visitor",
  },
  "tracking.thisVisitorHasNoEmailAddress": {
    bn: "এই ভিজিটরের কোনো ইমেইল ঠিকানা নেই — recovery ইমেইল পাঠানো যাবে না (দোকানে TP.identify hook বসালে ইমেইল ধরা পড়বে)",
    en: "This visitor has no email address — a recovery email cannot be sent (the email is captured if the TP.identify hook is placed in the shop)",
  },
};
