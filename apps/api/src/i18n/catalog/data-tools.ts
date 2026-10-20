/**
 * MB4 (ML10) — data-tools catalog namespace (W-2 owned).
 *
 * Pure data: bn/en message pairs for the data-tools module's
 * user-visible exceptions, `{{param}}` syntax (D-MB4-10).
 * Where the pre-MB4 original was Bengali, bn is faithful and
 * en is the translation; where it was English, vice versa.
 */
import type { CatalogNamespace } from "./types";
export const dataToolsCatalog: CatalogNamespace = {
  "dataTools.exportIsNotReadyForDownload": {
    bn: "Export download-এর জন্য তৈরি নয় (status: {{rowStatus}})",
    en: "Export is not ready for download (status: {{rowStatus}})",
  },
  "dataTools.exportNotFound": {
    bn: "Export পাওয়া যায়নি",
    en: "Export not found",
  },
  "dataTools.importNotFound": {
    bn: "Import পাওয়া যায়নি",
    en: "Import not found",
  },
  "dataTools.invalidBundle": {
    bn: "অবৈধ bundle: {{p1}}",
    en: "Invalid bundle: {{p1}}",
  },
  "dataTools.organizationNotFound": {
    bn: "Organization পাওয়া যায়নি",
    en: "Organization not found",
  },
  "dataTools.targetOrganizationIsNotEmptyBundle": {
    bn: "Target organization খালি নয় — bundle restore শুধু একটি সম্পূর্ণ নতুন organization-এই অনুমোদিত",
    en: "Target organization is not empty — bundle restore is only allowed into a brand-new organization",
  },
  "dataTools.theStoredExportFileIsMissing": {
    bn: "Stored export file-টি নেই",
    en: "The stored export file is missing",
  },
  "dataTools.thisExportHasExpired": {
    bn: "এই export-এর মেয়াদ শেষ হয়ে গেছে",
    en: "This export has expired",
  },
  "dataTools.bundlejsonIsNotValidJson": {
    bn: "bundleJson বৈধ JSON নয়",
    en: "bundleJson is not valid JSON",
  },
  "dataTools.bundlejsonIsRequired": {
    bn: "bundleJson দরকার",
    en: "bundleJson is required",
  },
  "dataTools.slug": {
    bn: "নিশ্চিত করতে প্রতিষ্ঠানের slug হুবহু লিখুন",
    en: "নিশ্চিত করতে প্রতিষ্ঠানের slug হুবহু লিখুন",
  },
};
