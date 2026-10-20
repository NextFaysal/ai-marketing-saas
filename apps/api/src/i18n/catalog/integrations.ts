/**
 * MB4 (ML10) — integrations catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the integrations module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const integrationsCatalog: CatalogNamespace = {
  "integrations.customerSyncFailed": {
    bn: "Customer sync ব্যর্থ হয়েছে: {{message}}",
    en: "Customer sync failed: {{message}}",
  },
  "integrations.bothAppKeyAndAppSecret": {
    bn: "Daraz এর জন্য App Key ও App Secret দুটোই দরকার",
    en: "Both App Key and App Secret are needed for Daraz",
  },
  "integrations.integrationHasNoStore": {
    bn: "Integration-এর কোনো store নেই",
    en: "Integration has no store",
  },
  "integrations.integrationHasNoStoredCredentials": {
    bn: "Integration-এর কোনো stored credentials নেই",
    en: "Integration has no stored credentials",
  },
  "integrations.integrationNotFound": {
    bn: "Integration পাওয়া যায়নি",
    en: "Integration not found",
  },
  "integrations.integrationNotFoundInThisOrganization": {
    bn: "এই organization-এ integration পাওয়া যায়নি",
    en: "Integration not found in this organization",
  },
  "integrations.invalidShopifyGdprPayload": {
    bn: "অবৈধ Shopify GDPR payload",
    en: "Invalid Shopify GDPR payload",
  },
  "integrations.invalidShopifyWebhookSignature": {
    bn: "অবৈধ Shopify webhook signature",
    en: "Invalid Shopify webhook signature",
  },
  "integrations.invalidWebhookSignature": {
    bn: "অবৈধ webhook signature",
    en: "Invalid webhook signature",
  },
  "integrations.onlyTheOrganizationOwnerCanPurge": {
    bn: "Disconnect-এ store mappings purge করতে শুধু organization OWNER পারেন",
    en: "Only the organization OWNER can purge store mappings on disconnect",
  },
  "integrations.orderSyncFailed": {
    bn: "Order sync ব্যর্থ হয়েছে: {{message}}",
    en: "Order sync failed: {{message}}",
  },
  "integrations.productSyncFailed": {
    bn: "Product sync ব্যর্থ হয়েছে: {{message}}",
    en: "Product sync failed: {{message}}",
  },
  "integrations.reviewSyncFailed": {
    bn: "Review sync ব্যর্থ হয়েছে: {{message}}",
    en: "Review sync failed: {{message}}",
  },
  "integrations.reviewSyncIsOnlyAvailableFor": {
    bn: "Review sync শুধু WooCommerce/Shopify integrations-এর জন্য পাওয়া যায়",
    en: "Review sync is only available for WooCommerce/Shopify integrations",
  },
  "integrations.shopifyClientCredentialsAreMissingReconnect": {
    bn: "Shopify client credentials নেই; clientId/clientSecret দিয়ে আবার connect করুন",
    en: "Shopify client credentials are missing; reconnect with clientId/clientSecret",
  },
  "integrations.shopifyConnectionFailed": {
    bn: "Shopify connection ব্যর্থ হয়েছে: {{p1}}",
    en: "Shopify connection failed: {{p1}}",
  },
  "integrations.shopifyCredentialsAreMissingReconnect": {
    bn: "Shopify credentials নেই; আবার connect করুন",
    en: "Shopify credentials are missing; reconnect",
  },
  "integrations.shopifyCustomerSyncFailed": {
    bn: "Shopify customer sync ব্যর্থ হয়েছে: {{message}}",
    en: "Shopify customer sync failed: {{message}}",
  },
  "integrations.shopifyIntegrationHasNoStore": {
    bn: "Shopify integration-এর কোনো store নেই",
    en: "Shopify integration has no store",
  },
  "integrations.shopifyIntegrationNotFound": {
    bn: "Shopify integration পাওয়া যায়নি",
    en: "Shopify integration not found",
  },
  "integrations.shopifyOrderSyncFailed": {
    bn: "Shopify order sync ব্যর্থ হয়েছে: {{message}}",
    en: "Shopify order sync failed: {{message}}",
  },
  "integrations.shopifyProductSyncFailed": {
    bn: "Shopify product sync ব্যর্থ হয়েছে: {{message}}",
    en: "Shopify product sync failed: {{message}}",
  },
  "integrations.storeNoLongerMatchesTheWc": {
    bn: "Store আর wc-auth attempt-এর সঙ্গে মেলে না",
    en: "Store no longer matches the wc-auth attempt",
  },
  "integrations.storeNotFoundInThisOrganization": {
    bn: "এই organization-এ store পাওয়া যায়নি",
    en: "Store not found in this organization",
  },
  "integrations.thisWcAuthAttemptHasAlready": {
    bn: "এই wc-auth attempt ইতিমধ্যে ব্যবহৃত হয়েছে",
    en: "This wc-auth attempt has already been used",
  },
  "integrations.thisWcAuthAttemptHasAlready2": {
    bn: "এই wc-auth attempt ইতিমধ্যে ব্যর্থ হয়েছে{{p1}}",
    en: "This wc-auth attempt has already failed{{p1}}",
  },
  "integrations.thisWcAuthAttemptHasExpired": {
    bn: "এই wc-auth attempt-এর মেয়াদ শেষ হয়ে গেছে",
    en: "This wc-auth attempt has expired",
  },
  "integrations.unknownIntegration": {
    bn: "অজানা integration",
    en: "Unknown integration",
  },
  "integrations.unknownWcAuthAttempt": {
    bn: "অজানা wc-auth attempt",
    en: "Unknown wc-auth attempt",
  },
  "integrations.webhookEventNotFound": {
    bn: "Webhook event পাওয়া যায়নি",
    en: "Webhook event not found",
  },
  "integrations.webhookRepairIsOnlyAvailableFor": {
    bn: "Webhook repair শুধু Shopify integrations-এর জন্য পাওয়া যায়",
    en: "Webhook repair is only available for Shopify integrations",
  },
  "integrations.webhookRepairIsOnlyAvailableFor2": {
    bn: "Webhook repair শুধু WooCommerce integrations-এর জন্য পাওয়া যায়",
    en: "Webhook repair is only available for WooCommerce integrations",
  },
  "integrations.webhookRepairIsOnlyAvailableFor3": {
    bn: "Webhook repair শুধু WooCommerce/Shopify integrations-এর জন্য পাওয়া যায়",
    en: "Webhook repair is only available for WooCommerce/Shopify integrations",
  },
  "integrations.webhookSecretIsNotConfiguredFor": {
    bn: "এই integration-এর জন্য webhook secret configure করা নেই",
    en: "Webhook secret is not configured for this integration",
  },
  "integrations.webhookSecretRotationIsOnlyAvailable": {
    bn: "Webhook secret rotation শুধু WooCommerce integrations-এর জন্য পাওয়া যায়",
    en: "Webhook secret rotation is only available for WooCommerce integrations",
  },
  "integrations.webhookSecretRotationIsOnlyAvailable2": {
    bn: "Webhook secret rotation শুধু WooCommerce/Shopify integrations-এর জন্য পাওয়া যায়",
    en: "Webhook secret rotation is only available for WooCommerce/Shopify integrations",
  },
  "integrations.woocommerceCallbackDidNotIncludeConsumer": {
    bn: "WooCommerce callback-এ consumer_key/consumer_secret ছিল না",
    en: "WooCommerce callback did not include consumer_key/consumer_secret",
  },
  "integrations.woocommerceConnectionFailed": {
    bn: "WooCommerce connection ব্যর্থ হয়েছে: {{p1}}",
    en: "WooCommerce connection failed: {{p1}}",
  },
  "integrations.woocommerceReturnedUnexpectedKeyPermissions": {
    bn: "WooCommerce অপ্রত্যাশিত key permissions ফেরত দিয়েছে: {{p1}}",
    en: "WooCommerce returned unexpected key permissions: {{p1}}",
  },
  "integrations.woocommerceWcAuthIsOnlyAvailable": {
    bn: "WooCommerce wc-auth শুধু WooCommerce stores-এর জন্য পাওয়া যায়",
    en: "WooCommerce wc-auth is only available for WooCommerce stores",
  },
  "integrations.giveAccesstokenApisecretOrClientidClientsecret": {
    bn: "accessToken/apiSecret অথবা clientId/clientSecret দিন",
    en: "Give accessToken/apiSecret or clientId/clientSecret",
  },
  "integrations.giveBothClientidAndClientsecret": {
    bn: "clientId এবং clientSecret দুটোই দিন",
    en: "Give both clientId and clientSecret",
  },
  "integrations.thisConnectionSSyncIsPaused": {
    bn: "এই কানেকশনের Sync বিরতি (pause) দেওয়া আছে — আগে Connect Center থেকে Sync চালু করুন, তারপর আবার চেষ্টা করুন।",
    en: "This connection's Sync is paused — turn Sync on from the Connect Center first, then try again.",
  },
  "integrations.apiPublicUrlTheApiS": {
    bn: "১-ক্লিক কানেক্টের জন্য API_PUBLIC_URL (API-র পাবলিক ঠিকানা) সেট করা নেই — the 1-click WooCommerce flow needs API_PUBLIC_URL (public API address) configured so WooCommerce can send the generated keys back.",
    en: "API_PUBLIC_URL (the API's public address) is not set for the 1-click connect — the 1-click WooCommerce flow needs API_PUBLIC_URL (public API address) configured so WooCommerce can send the generated keys back.",
  },
};
