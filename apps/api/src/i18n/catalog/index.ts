/**
 * ML10 (MB4, CD-2) — the API message catalog aggregator.
 *
 * Owner: coordinator ONLY. Domain workers add their own
 * namespace files under catalog/; the coordinator wires the
 * imports here. Parity (bn key set === en key set, placeholder
 * parity) is pinned by ../i18n-catalog.spec.ts.
 *
 * Wired by the MB4 coordinator at assembly: W-1 namespaces
 * (validation..auth) + W-2 namespaces (campaigns..workflows)
 * + W-3 namespaces (messaging, notifications, documents,
 * finance, reports). W-3's send-locale.ts merges its UPPER_CASE
 * raw-entry exports separately for send/generation paths.
 */
import type { CatalogNamespace } from "./types";
import { accountingCatalog } from "./accounting";
import { adminCatalog } from "./admin";
import { adsCatalog } from "./ads";
import { affiliatesCatalog } from "./affiliates";
import { agencyCatalog } from "./agency";
import { aiCatalog } from "./ai";
import { analyticsCatalog } from "./analytics";
import { attributionCatalog } from "./attribution";
import { audiencesCatalog } from "./audiences";
import { authCatalog } from "./auth";
import { automationCatalog } from "./automation";
import { bookingCatalog } from "./booking";
import { campaignsCatalog } from "./campaigns";
import { catalogsCatalog } from "./catalogs";
import { commerceCatalog } from "./commerce";
import { commonCatalog } from "./common";
import { competitorsCatalog } from "./competitors";
import { connectionsCatalog } from "./connections";
import { conversionsCatalog } from "./conversions";
import { courierCatalog } from "./courier";
import { creativesCatalog } from "./creatives";
import { crmCatalog } from "./crm";
import { customersCatalog } from "./customers";
import { cx8Catalog } from "./cx8";
import { dataToolsCatalog } from "./data-tools";
import { deliveryCatalog } from "./delivery";
import { documentsCatalog } from "./documents";
import { dropshipCatalog } from "./dropship";
import { feedbackCatalog } from "./feedback";
import { feedsCatalog } from "./feeds";
import { financeCatalog } from "./finance";
import { fraudCatalog } from "./fraud";
import { fraudNetworkCatalog } from "./fraud-network";
import { fulfillmentCatalog } from "./fulfillment";
import { gamifiedPromotionsCatalog } from "./gamified-promotions";
import { hrCatalog } from "./hr";
import { importsCatalog } from "./imports";
import { inboxCatalog } from "./inbox";
import { installmentsCatalog } from "./installments";
import { integrationsCatalog } from "./integrations";
import { inventoryCatalog } from "./inventory";
import { knowledgeCatalog } from "./knowledge";
import { landingsCatalog } from "./landings";
import { liveCommerceCatalog } from "./live-commerce";
import { membershipCatalog } from "./membership";
import { merchantApiCatalog } from "./merchant-api";
import { messagingCatalog } from "./messaging";
import { notificationsCatalog } from "./notifications";
import { offlineConversionsCatalog } from "./offline-conversions";
import { orderAutomationCatalog } from "./order-automation";
import { ordersCatalog } from "./orders";
import { organizationsCatalog } from "./organizations";
import { paymentsCatalog } from "./payments";
import { portfolioCatalog } from "./portfolio";
import { posCatalog } from "./pos";
import { productsCatalog } from "./products";
import { publishingCatalog } from "./publishing";
import { purchasingCatalog } from "./purchasing";
import { reconciliationCatalog } from "./reconciliation";
import { reportsCatalog } from "./reports";
import { socialCatalog } from "./social";
import { socialProofCatalog } from "./social-proof";
import { storageCatalog } from "./storage";
import { storefrontCatalog } from "./storefront";
import { subscriptionsCatalog } from "./subscriptions";
import { supportCatalog } from "./support";
import { taxCatalog } from "./tax";
import { trackingCatalog } from "./tracking";
import { translationsCatalog } from "./translations";
import { validationCatalog } from "./validation";
import { videoStudioCatalog } from "./video-studio";
import { warehouseCatalog } from "./warehouse";
import { webhooksOutgoingCatalog } from "./webhooks-outgoing";
import { workflowsCatalog } from "./workflows";

export type { CatalogEntry, CatalogNamespace } from "./types";

export const MESSAGE_CATALOG: CatalogNamespace = {
  ...accountingCatalog,
  ...adminCatalog,
  ...adsCatalog,
  ...affiliatesCatalog,
  ...agencyCatalog,
  ...aiCatalog,
  ...analyticsCatalog,
  ...attributionCatalog,
  ...audiencesCatalog,
  ...authCatalog,
  ...automationCatalog,
  ...bookingCatalog,
  ...campaignsCatalog,
  ...catalogsCatalog,
  ...commerceCatalog,
  ...commonCatalog,
  ...competitorsCatalog,
  ...connectionsCatalog,
  ...conversionsCatalog,
  ...courierCatalog,
  ...creativesCatalog,
  ...crmCatalog,
  ...customersCatalog,
  ...cx8Catalog,
  ...dataToolsCatalog,
  ...deliveryCatalog,
  ...documentsCatalog,
  ...dropshipCatalog,
  ...feedbackCatalog,
  ...feedsCatalog,
  ...financeCatalog,
  ...fraudCatalog,
  ...fraudNetworkCatalog,
  ...fulfillmentCatalog,
  ...gamifiedPromotionsCatalog,
  ...hrCatalog,
  ...importsCatalog,
  ...inboxCatalog,
  ...installmentsCatalog,
  ...integrationsCatalog,
  ...inventoryCatalog,
  ...knowledgeCatalog,
  ...landingsCatalog,
  ...liveCommerceCatalog,
  ...membershipCatalog,
  ...merchantApiCatalog,
  ...messagingCatalog,
  ...notificationsCatalog,
  ...offlineConversionsCatalog,
  ...orderAutomationCatalog,
  ...ordersCatalog,
  ...organizationsCatalog,
  ...paymentsCatalog,
  ...portfolioCatalog,
  ...posCatalog,
  ...productsCatalog,
  ...publishingCatalog,
  ...purchasingCatalog,
  ...reconciliationCatalog,
  ...reportsCatalog,
  ...socialCatalog,
  ...socialProofCatalog,
  ...storageCatalog,
  ...storefrontCatalog,
  ...subscriptionsCatalog,
  ...supportCatalog,
  ...taxCatalog,
  ...trackingCatalog,
  ...translationsCatalog,
  ...validationCatalog,
  ...videoStudioCatalog,
  ...warehouseCatalog,
  ...webhooksOutgoingCatalog,
  ...workflowsCatalog,
};
