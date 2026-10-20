/**
 * MB4 (ML10) — merchant-api catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the merchant-api module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const merchantApiCatalog: CatalogNamespace = {
  "merchantApi.invalidOrRevokedMerchantApiKey": {
    bn: "অবৈধ অথবা revoked merchant API key",
    en: "Invalid or revoked merchant API key",
  },
  "merchantApi.merchantApiKeyNotFound": {
    bn: "Merchant API key পাওয়া যায়নি",
    en: "Merchant API key not found",
  },
  "merchantApi.merchantApiKeyRequiredAuthorizationBearer": {
    bn: "Merchant API key দরকার (Authorization: Bearer <key> অথবা x-merchant-api-key)",
    en: "Merchant API key required (Authorization: Bearer <key> or x-merchant-api-key)",
  },
  "merchantApi.unknownScopeAllowedScopesUnknownScope": {
    bn: "অজানা scope: {{p1}} — অনুমোদিত scope: {{allowed}} (unknown scope; allowed scopes: {{allowed2}})",
    en: "Unknown scope: {{p1}} — allowed scopes: {{allowed}} (unknown scope; allowed scopes: {{allowed2}})",
  },
  "merchantApi.atLeastOneScopeMustBe": {
    bn: "অন্তত একটি scope দিতে হবে — অনুমোদিত scope: {{allowed}} (at least one scope is required; allowed scopes: {{allowed2}})",
    en: "At least one scope must be given — allowed scopes: {{allowed}} (at least one scope is required; allowed scopes: {{allowed2}})",
  },
  "merchantApi.thisKeyDoesNotHaveThe": {
    bn: "এই কী-তে প্রয়োজনীয় অনুমতি (scope) নেই: {{scope}}",
    en: "This key does not have the required permission (scope): {{scope}}",
  },
};
