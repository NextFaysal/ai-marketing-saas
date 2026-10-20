/**
 * MB4 (ML10) — webhooks-outgoing catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the webhooks-outgoing module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const webhooksOutgoingCatalog: CatalogNamespace = {
  "webhooksOutgoing.webhookDeliveryNotFound": {
    bn: "Webhook delivery পাওয়া যায়নি",
    en: "Webhook delivery not found",
  },
  "webhooksOutgoing.webhookSubscriptionNotFound": {
    bn: "Webhook subscription পাওয়া যায়নি",
    en: "Webhook subscription not found",
  },
  "webhooksOutgoing.unknownEventSupported": {
    bn: "অজানা ইভেন্ট: {{e}} — সমর্থিত: {{p2}}",
    en: "Unknown event: {{e}} — supported: {{p2}}",
  },
  "webhooksOutgoing.chooseAtLeastOneEvent": {
    bn: "কমপক্ষে একটি ইভেন্ট বেছে দিন",
    en: "Choose at least one event",
  },
};
