/**
 * MB4 (ML10) — feeds catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the feeds module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const feedsCatalog: CatalogNamespace = {
  "feeds.theDarazFeedIsOnlyIn": {
    bn: "Daraz ফিড শুধু CSV ফরম্যাটে হয়",
    en: "The Daraz feed is only in CSV format",
  },
  "feeds.feedNotFound": {
    bn: "Feed পাওয়া যায়নি",
    en: "Feed not found",
  },
  "feeds.feedNotFoundInThisOrganization": {
    bn: "এই organization-এ feed পাওয়া যায়নি",
    en: "Feed not found in this organization",
  },
  "feeds.organizationNotFound": {
    bn: "Organization পাওয়া যায়নি",
    en: "Organization not found",
  },
  "feeds.theChannelIsNotValidMeta": {
    bn: "চ্যানেল সঠিক নয় (meta | google | tiktok | daraz)",
    en: "The channel is not valid (meta | google | tiktok | daraz)",
  },
};
